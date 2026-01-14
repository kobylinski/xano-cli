import { Args, Command, Flags } from '@oclif/core'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, extname, isAbsolute, join, resolve } from 'node:path'
import Papa from 'papaparse'

import {
  getProfile,
  XanoApi,
} from '../../../lib/api.js'
import { detectType, extractName } from '../../../lib/detector.js'
import { loadObjects } from '../../../lib/objects.js'
import {
  findProjectRoot,
  isInitialized,
  loadLocalConfig,
} from '../../../lib/project.js'

type ImportMode = 'insert' | 'update' | 'upsert'

export default class DataImport extends Command {
  static args = {
    file: Args.string({
      description: 'Input file (.json or .csv) or directory for batch import',
      required: false,
    }),
    table: Args.string({
      description: 'Table name, ID, or file path (optional if auto-detected from filename)',
      required: false,
    }),
  }
  static description = 'Import data from JSON or CSV file into a table'
  static examples = [
    '<%= config.bin %> data:import users users.json',
    '<%= config.bin %> data:import users records.csv',
    '<%= config.bin %> data:import tables/users.xs backup/users.json',
    '<%= config.bin %> data:import users.json',
    '<%= config.bin %> data:import import/',
    '<%= config.bin %> data:import users --data \'[{"name":"John"},{"name":"Jane"}]\'',
    '<%= config.bin %> data:import users data.json --mode insert',
    '<%= config.bin %> data:import users data.json --mode update',
    '<%= config.bin %> data:import users data.json --dry-run',
  ]
  static flags = {
    'allow-id': Flags.boolean({
      default: false,
      description: 'Allow setting custom ID values in records',
    }),
    data: Flags.string({
      char: 'd',
      description: 'Inline JSON data (array of objects)',
      exclusive: ['file'],
    }),
    datasource: Flags.string({
      char: 's',
      description: 'Data source to use (e.g., "live", "test")',
    }),
    'dry-run': Flags.boolean({
      default: false,
      description: 'Show what would be imported without executing',
    }),
    mode: Flags.string({
      default: 'upsert',
      description: 'Import mode: upsert (insert or update), insert (only new), update (only existing)',
      options: ['upsert', 'insert', 'update'],
    }),
    profile: Flags.string({
      description: 'Profile to use',
      env: 'XANO_PROFILE',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DataImport)

    const projectRoot = findProjectRoot()
    if (!projectRoot) {
      this.error('Not in a xano project. Run "xano init" first.')
    }

    if (!isInitialized(projectRoot)) {
      this.error('Project not initialized. Run "xano init" first.')
    }

    const config = loadLocalConfig(projectRoot)
    if (!config) {
      this.error('Failed to load .xano/config.json')
    }

    const profile = getProfile(flags.profile)
    if (!profile) {
      this.error('No profile found. Run "xano profile:wizard" to create one.')
    }

    const api = new XanoApi(profile, config.workspaceId, config.branch)
    const mode = flags.mode as ImportMode

    // Handle inline data
    if (flags.data) {
      if (!args.table && !args.file) {
        this.error('TABLE argument is required when using --data')
      }

      const tableName = this.resolveTableName(args.table || args.file!, projectRoot)
      const records = this.parseJsonData(flags.data)
      await this.importRecords(api, tableName, records, mode, flags)
      return
    }

    // Handle directory import (batch)
    const inputPath = args.file || args.table
    if (!inputPath) {
      this.error('FILE or TABLE argument is required')
    }

    if (inputPath.endsWith('/') || this.isDirectory(inputPath)) {
      await this.importDirectory(api, inputPath, projectRoot, mode, flags)
      return
    }

    // Single file import
    const { records, tableName } = this.resolveFileImport(args, projectRoot)
    await this.importRecords(api, tableName, records, mode, flags)
  }

  private async checkRecordExists(
    api: XanoApi,
    tableId: number,
    pk: number | string,
    datasource?: string
  ): Promise<boolean> {
    const response = await api.getTableContent(tableId, pk, datasource)
    return response.ok
  }

  private async importDirectory(
    api: XanoApi,
    dirPath: string,
    projectRoot: string,
    mode: ImportMode,
    flags: { 'allow-id': boolean; datasource?: string; 'dry-run': boolean }
  ): Promise<void> {
    const inputDir = dirPath.replace(/\/$/, '')
    const resolvedDir = isAbsolute(inputDir) ? inputDir : resolve(inputDir)

    if (!existsSync(resolvedDir)) {
      this.error(`Directory not found: ${inputDir}`)
    }

    // Get list of JSON/CSV files
    const files = readdirSync(resolvedDir)
      .filter(f => ['.csv', '.json'].includes(extname(f).toLowerCase()))

    if (files.length === 0) {
      this.error(`No JSON or CSV files found in ${inputDir}`)
    }

    // Load available tables for matching
    const objects = loadObjects(projectRoot)
    const tables = new Map(
      objects
        .filter(o => o.type === 'table')
        .map(o => [basename(o.path, '.xs').toLowerCase(), o])
    )

    this.log(`Importing ${files.length} files from ${inputDir}/...`)
    if (flags['dry-run']) {
      this.log('(dry-run mode - no changes will be made)')
    }

    let successCount = 0
    let errorCount = 0
    let skippedCount = 0

    /* eslint-disable no-await-in-loop -- Sequential file processing for progress logging */
    for (const file of files) {
      const filePath = join(resolvedDir, file)
      const ext = extname(file).toLowerCase()
      const baseName = basename(file, ext).toLowerCase()

      // Check if table exists
      if (!tables.has(baseName)) {
        this.log(`  - ${file}: skipped (no matching table)`)
        skippedCount++
        continue
      }

      try {
        const content = readFileSync(filePath, 'utf8')
        const records = ext === '.csv'
          ? this.parseCsvData(content)
          : this.parseJsonData(content)

        if (flags['dry-run']) {
          this.log(`  ○ ${file}: would import ${records.length} records to ${baseName}`)
          successCount++
          continue
        }

        const result = await this.importRecordsInternal(api, baseName, records, mode, flags, false)
        this.log(`  ✓ ${file}: ${result.inserted} inserted, ${result.updated} updated, ${result.skipped} skipped`)
        successCount++
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.log(`  ✗ ${file}: ${message}`)
        errorCount++
      }
    }
    /* eslint-enable no-await-in-loop */

    this.log('')
    this.log(`Processed ${successCount} files${errorCount > 0 ? `, ${errorCount} failed` : ''}${skippedCount > 0 ? `, ${skippedCount} skipped` : ''}`)
  }

  private async importRecords(
    api: XanoApi,
    tableName: string,
    records: Record<string, unknown>[],
    mode: ImportMode,
    flags: { 'allow-id': boolean; datasource?: string; 'dry-run': boolean }
  ): Promise<void> {
    if (records.length === 0) {
      this.log('No records to import.')
      return
    }

    if (flags['dry-run']) {
      this.log(`Would import ${records.length} records to ${tableName} (mode: ${mode})`)
      this.log('Sample records:')
      for (const record of records.slice(0, 3)) {
        this.log(`  ${JSON.stringify(record)}`)
      }

      if (records.length > 3) {
        this.log(`  ... and ${records.length - 3} more`)
      }

      return
    }

    const result = await this.importRecordsInternal(api, tableName, records, mode, flags, true)
    this.log('')
    this.log(`Import complete: ${result.inserted} inserted, ${result.updated} updated, ${result.skipped} skipped`)
  }

  private async importRecordsInternal(
    api: XanoApi,
    tableName: string,
    records: Record<string, unknown>[],
    mode: ImportMode,
    flags: { 'allow-id': boolean; datasource?: string },
    verbose: boolean
  ): Promise<{ inserted: number; skipped: number; updated: number }> {
    // Resolve table ID
    const tableId = await this.resolveTableId(api, tableName)
    if (!tableId) {
      throw new Error(`Table not found: ${tableName}`)
    }

    let inserted = 0
    let updated = 0
    let skipped = 0

    // For insert-only mode, use bulk insert
    if (mode === 'insert') {
      // Filter out records that have an ID (they might exist)
      // For true insert-only, we could either skip records with IDs or insert anyway
      // Let's use bulk insert and let Xano handle duplicates
      const response = await api.bulkCreateTableContent(
        tableId,
        records,
        flags.datasource,
        flags['allow-id']
      )

      if (!response.ok) {
        throw new Error(response.error || 'Bulk insert failed')
      }

      inserted = records.length
      if (verbose) {
        this.log(`Inserted ${inserted} records into ${tableName}`)
      }

      return { inserted, skipped, updated }
    }

    // For upsert/update modes, process records individually
    if (verbose) {
      this.log(`Importing ${records.length} records to ${tableName} (mode: ${mode})...`)
    }

    /* eslint-disable no-await-in-loop -- Sequential record processing for upsert logic */
    for (const record of records) {
      const pk = record.id as number | string | undefined

      if (pk === undefined) {
        // No ID - insert as new
        if (mode === 'update') {
          skipped++
          continue
        }

        const response = await api.createTableContent(tableId, record, flags.datasource)
        if (response.ok) {
          inserted++
        } else {
          if (verbose) {
            this.warn(`Failed to insert record: ${response.error}`)
          }

          skipped++
        }
      } else {
        // Check if record exists
        const exists = await this.checkRecordExists(api, tableId, pk, flags.datasource)

        if (exists) {
          // Update existing record (exclude id from update payload)
          // eslint-disable-next-line @typescript-eslint/no-unused-vars
          const { id: _id, ...updateData } = record
          const response = await api.updateTableContent(tableId, pk, updateData, flags.datasource)
          if (response.ok) {
            updated++
          } else {
            if (verbose) {
              this.warn(`Failed to update record ${pk}: ${response.error}`)
            }

            skipped++
          }
        } else {
          if (mode === 'update') {
            skipped++
            continue
          }

          // Insert new record
          const response = await api.createTableContent(tableId, record, flags.datasource)
          if (response.ok) {
            inserted++
          } else {
            if (verbose) {
              this.warn(`Failed to insert record: ${response.error}`)
            }

            skipped++
          }
        }
      }
    }
    /* eslint-enable no-await-in-loop */

    return { inserted, skipped, updated }
  }

  private isDirectory(inputPath: string): boolean {
    try {
      return statSync(inputPath).isDirectory()
    } catch {
      return false
    }
  }

  private parseCsvData(content: string): Record<string, unknown>[] {
    const result = Papa.parse<Record<string, unknown>>(content, {
      dynamicTyping: true,
      header: true,
      skipEmptyLines: true,
    })

    if (result.errors.length > 0) {
      const firstError = result.errors[0]
      throw new Error(`CSV parse error: ${firstError.message} (row ${firstError.row})`)
    }

    return result.data
  }

  private parseJsonData(content: string): Record<string, unknown>[] {
    try {
      const data = JSON.parse(content)
      if (!Array.isArray(data)) {
        throw new TypeError('JSON data must be an array of objects')
      }

      return data as Record<string, unknown>[]
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new TypeError(`Invalid JSON: ${error.message}`)
      }

      throw error
    }
  }

  private resolveFileImport(
    args: { file?: string; table?: string },
    projectRoot: string
  ): { records: Record<string, unknown>[]; tableName: string } {
    // Determine which arg is the file and which is the table
    let filePath: string
    let tableName: string

    if (args.table && args.file) {
      // Both provided
      tableName = this.resolveTableName(args.table, projectRoot)
      filePath = args.file
    } else {
      // Single arg - determine if it's a file
      const arg = args.file || args.table
      if (!arg) {
        this.error('FILE argument is required')
      }

      const ext = extname(arg).toLowerCase()
      if (ext === '.json' || ext === '.csv') {
        filePath = arg
        // Derive table name from filename
        tableName = basename(arg, ext)
      } else {
        this.error(`Cannot determine file type for: ${arg}. Use .json or .csv extension.`)
      }
    }

    // Resolve file path
    const resolvedPath = isAbsolute(filePath) ? filePath : resolve(filePath)
    if (!existsSync(resolvedPath)) {
      this.error(`File not found: ${filePath}`)
    }

    // Read and parse file
    const content = readFileSync(resolvedPath, 'utf8')
    const ext = extname(filePath).toLowerCase()

    const records = ext === '.csv'
      ? this.parseCsvData(content)
      : this.parseJsonData(content)

    return { records, tableName }
  }

  private async resolveTableId(api: XanoApi, tableRef: string): Promise<null | number> {
    const numId = Number.parseInt(tableRef, 10)
    if (!Number.isNaN(numId)) {
      return numId
    }

    const response = await api.listTables(1, 1000)
    if (!response.ok || !response.data?.items) {
      return null
    }

    const table = response.data.items.find(
      t => t.name.toLowerCase() === tableRef.toLowerCase()
    )

    return table?.id || null
  }

  private resolveTableName(tableRef: string, _projectRoot: string): string {
    if (tableRef.includes('/') || tableRef.endsWith('.xs')) {
      const filePath = isAbsolute(tableRef) ? tableRef : resolve(tableRef)

      if (!existsSync(filePath)) {
        this.error(`File not found: ${tableRef}`)
      }

      const content = readFileSync(filePath, 'utf8')
      const type = detectType(content)

      if (type !== 'table') {
        this.error(`File is not a table definition (detected type: ${type || 'unknown'})`)
      }

      const name = extractName(content)
      if (!name) {
        this.error(`Could not extract table name from file: ${tableRef}`)
      }

      return name
    }

    return tableRef
  }
}
