import { Args, Command, Flags } from '@oclif/core'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path'
import Papa from 'papaparse'

import { isAgentMode } from '../../../base-command.js'
import {
  getMissingProfileError,
  getProfile,
  XanoApi,
} from '../../../lib/api.js'
import {
  checkDatasourcePermission,
  formatAgentDatasourceBlockedMessage,
  resolveEffectiveDatasource,
} from '../../../lib/datasource.js'
import { detectType, extractName } from '../../../lib/detector.js'
import { loadObjects } from '../../../lib/objects.js'
import {
  findProjectRoot,
  isInitialized,
  loadCliConfig,
  loadEffectiveConfig,
} from '../../../lib/project.js'
import {
  formatTableNotFoundError,
  resolveTableFromLocal,
} from '../../../lib/resolver.js'

// Supported filter operators
type Operator = '!=' | '<' | '<=' | '=' | '>' | '>=' | 'in' | 'not in'

// Map CLI operators to Xano API format
const OPERATOR_MAP: Record<Operator, string> = {
  '!=': '|!=',
  '<': '|<',
  '<=': '|<=',
  '=': '',
  '>': '|>',
  '>=': '|>=',
  'in': '|in',
  'not in': '|not in',
}

/**
 * Parse a filter string into field, operator, and value
 */
function parseFilter(filter: string): null | { field: string; operator: Operator; value: unknown } {
  const operatorPatterns: [RegExp, Operator][] = [
    [/^([a-zA-Z_][a-zA-Z0-9_]*)\s+not\s+in\s+(.+)$/i, 'not in'],
    [/^([a-zA-Z_][a-zA-Z0-9_]*)\s+in\s+(.+)$/i, 'in'],
    [/^([a-zA-Z_][a-zA-Z0-9_]*)>=(.+)$/, '>='],
    [/^([a-zA-Z_][a-zA-Z0-9_]*)<=(.+)$/, '<='],
    [/^([a-zA-Z_][a-zA-Z0-9_]*)!=(.+)$/, '!='],
    [/^([a-zA-Z_][a-zA-Z0-9_]*)>(.+)$/, '>'],
    [/^([a-zA-Z_][a-zA-Z0-9_]*)<(.+)$/, '<'],
    [/^([a-zA-Z_][a-zA-Z0-9_]*)=(.+)$/, '='],
  ]

  for (const [pattern, operator] of operatorPatterns) {
    const match = filter.match(pattern)
    if (match) {
      const [, field, rawValue] = match
      const value = operator === 'in' || operator === 'not in'
        ? rawValue.split(',').map(v => parseValue(v.trim()))
        : parseValue(rawValue.trim())
      return { field, operator, value }
    }
  }

  return null
}

/**
 * Parse a value string to appropriate type
 */
function parseValue(str: string): unknown {
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1)
  }

  if (str.toLowerCase() === 'true') return true
  if (str.toLowerCase() === 'false') return false
  if (str.toLowerCase() === 'null') return null

  const num = Number(str)
  if (!Number.isNaN(num) && str !== '') return num

  return str
}

/**
 * Parse sort string
 */
function parseSort(sort: string): null | { direction: 'asc' | 'desc'; field: string } {
  const colonMatch = sort.match(/^([a-zA-Z_][a-zA-Z0-9_]*):?(asc|desc)?$/i)
  if (colonMatch) {
    return {
      direction: (colonMatch[2]?.toLowerCase() as 'asc' | 'desc') || 'asc',
      field: colonMatch[1],
    }
  }

  const spaceMatch = sort.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+(asc|desc)$/i)
  if (spaceMatch) {
    return {
      direction: spaceMatch[2].toLowerCase() as 'asc' | 'desc',
      field: spaceMatch[1],
    }
  }

  return null
}

export default class DataExport extends Command {
  /* eslint-disable perfectionist/sort-objects -- positional arg order matters in oclif */
  static args = {
    table: Args.string({
      description: 'Table name, ID, or file path (e.g., tables/users.xs)',
      required: false,
    }),
    file: Args.string({
      description: 'Output file path (.json or .csv) or directory for batch export',
      required: false,
    }),
  }
  /* eslint-enable perfectionist/sort-objects */
  static description = 'Export table data to JSON or CSV file'
  static examples = [
    '<%= config.bin %> data:export users',
    '<%= config.bin %> data:export users users.json',
    '<%= config.bin %> data:export users export/users.csv',
    '<%= config.bin %> data:export tables/users.xs backup/users.json',
    '<%= config.bin %> data:export users.json',
    '<%= config.bin %> data:export users --filter "status=active" --sort "created_at:desc"',
    '<%= config.bin %> data:export users --all --format csv',
    '<%= config.bin %> data:export backup --all',
    '<%= config.bin %> data:export --all',
    '<%= config.bin %> data:export backup --tags "Users,Authorization"',
    '<%= config.bin %> data:export backup --tables "users,roles,permissions"',
  ]
  static flags = {
    all: Flags.boolean({
      default: false,
      description: 'Export all records (fetch all pages)',
    }),
    columns: Flags.string({
      char: 'c',
      description: 'Comma-separated list of columns to export',
    }),
    datasource: Flags.string({
      char: 's',
      description: 'Data source to use (e.g., "live", "test")',
    }),
    filter: Flags.string({
      char: 'f',
      description: 'Filter expression (field=value, field>value, field in a,b,c)',
      multiple: true,
    }),
    format: Flags.string({
      description: 'Output format (json or csv) - auto-detected from file extension',
      options: ['json', 'csv'],
    }),
    profile: Flags.string({
      description: 'Profile to use',
      env: 'XANO_PROFILE',
    }),
    remote: Flags.boolean({
      default: false,
      description: 'Force remote API lookup instead of local cache',
    }),
    sort: Flags.string({
      description: 'Sort by field (field:asc or field:desc)',
      multiple: true,
    }),
    tables: Flags.string({
      char: 't',
      description: 'Comma-separated list of table names to export (batch mode)',
    }),
    tags: Flags.string({
      description: 'Comma-separated list of tags to filter tables (batch mode)',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DataExport)

    const projectRoot = findProjectRoot()
    if (!projectRoot) {
      this.error('Not in a xano project. Run "xano init" first.')
    }

    if (!isInitialized(projectRoot)) {
      this.error('Project not initialized. Run "xano init" first.')
    }

    const config = loadEffectiveConfig(projectRoot)
    if (!config) {
      this.error('Failed to load .xano/config.json')
    }

    // Profile is ONLY read from .xano/cli.json - no flag overrides
    const cliConfig = loadCliConfig(projectRoot)
    const cliProfile = cliConfig?.profile

    const profileError = getMissingProfileError(cliProfile)
    if (profileError) {
      this.error(profileError.humanOutput)
    }

    const profile = getProfile(cliProfile)
    if (!profile) {
      this.error('Profile not found in credentials. Run "xano init" to configure.')
    }

    // Resolve effective datasource (handles agent protection)
    const agentMode = isAgentMode()
    const { blocked, datasource } = resolveEffectiveDatasource(
      flags.datasource,
      config.defaultDatasource,
      agentMode
    )

    if (blocked && flags.datasource) {
      this.warn(formatAgentDatasourceBlockedMessage(flags.datasource, datasource))
    }

    // Check datasource permission for read operation
    try {
      checkDatasourcePermission(datasource, 'read', config.datasources)
    } catch (error) {
      if (error instanceof Error) {
        this.error(error.message)
      }

      throw error
    }

    const api = new XanoApi(profile, config.workspaceId, config.branch)

    // Handle directory export (batch)
    if (this.isBatchExport(args, flags)) {
      const dirPath = args.table || args.file || 'export'
      await this.exportDirectory(api, dirPath, projectRoot, { ...flags, datasource })
      return
    }

    // Determine table and output file
    const { outputFile, tableName } = this.resolveArgs(args, projectRoot)

    // Resolve table ID
    // With --remote: skip local cache, query Xano API directly
    // Without --remote: try local cache first (fast path)
    let tableId: null | number = null
    let usedRemoteLookup = false

    if (flags.remote) {
      usedRemoteLookup = true
      tableId = await this.resolveTableIdRemote(api, tableName)
    } else {
      const localResult = resolveTableFromLocal(projectRoot, tableName)
      if (localResult) {
        tableId = localResult.id
      }
    }

    if (!tableId) {
      this.error(formatTableNotFoundError(tableName, isAgentMode(), usedRemoteLookup))
    }

    // Determine format
    const format = this.determineFormat(outputFile, flags.format)

    // Fetch records
    const records = await this.fetchRecords(api, tableId, { ...flags, datasource })

    // Filter columns if specified
    const filteredRecords = this.filterColumns(records, flags.columns)

    // Format output
    const output = format === 'csv'
      ? Papa.unparse(filteredRecords)
      : JSON.stringify(filteredRecords, null, 2)

    // Write to file or stdout
    if (outputFile) {
      const outputDir = dirname(outputFile)
      if (outputDir && !existsSync(outputDir)) {
        mkdirSync(outputDir, { recursive: true })
      }

      writeFileSync(outputFile, output, 'utf8')
      this.log(`Exported ${filteredRecords.length} records to ${outputFile}`)
    } else {
      this.log(output)
    }
  }

  private determineFormat(outputFile: string | undefined, flagFormat: string | undefined): 'csv' | 'json' {
    if (flagFormat) {
      return flagFormat as 'csv' | 'json'
    }

    if (outputFile) {
      const ext = extname(outputFile).toLowerCase()
      if (ext === '.csv') return 'csv'
    }

    return 'json'
  }

  private async exportDirectory(
    api: XanoApi,
    dirPath: string,
    projectRoot: string,
    flags: { all: boolean; columns?: string; datasource?: string; filter?: string[]; format?: string; sort?: string[]; tables?: string; tags?: string }
  ): Promise<void> {
    // Get tables - from API if filtering by tags, otherwise from objects.json
    let tablesToExport: { id: number; name: string }[] = []

    if (flags.tags || flags.tables) {
      // Fetch from API to get tag information
      const response = await api.listTables(1, 1000)
      if (!response.ok || !response.data?.items) {
        this.error('Failed to fetch tables from API')
      }

      let apiTables = response.data.items

      // Filter by tags
      if (flags.tags) {
        const tagFilter = new Set(flags.tags.split(',').map(t => t.trim().toLowerCase()))
        apiTables = apiTables.filter(t => {
          const tableTags = t.tag || []
          return tableTags.some(tag => tagFilter.has(tag.toLowerCase()))
        })
      }

      // Filter by table names
      if (flags.tables) {
        const nameFilter = new Set(flags.tables.split(',').map(n => n.trim().toLowerCase()))
        apiTables = apiTables.filter(t => nameFilter.has(t.name.toLowerCase()))
      }

      tablesToExport = apiTables.map(t => ({ id: t.id, name: t.name }))
    } else {
      // Use objects.json
      const objects = loadObjects(projectRoot)
      const tables = objects.filter(o => o.type === 'table')

      if (tables.length === 0) {
        this.error('No tables found. Run "xano pull --sync" to sync tables first.')
      }

      tablesToExport = tables.map(t => ({
        id: t.id,
        name: basename(t.path, '.xs'),
      }))
    }

    if (tablesToExport.length === 0) {
      this.error('No tables match the specified filters')
    }

    const outputDir = dirPath.replace(/\/$/, '') || 'export'
    const format = (flags.format as 'csv' | 'json') || 'json'

    // Create output directory if needed
    mkdirSync(outputDir, { recursive: true })

    this.log(`Exporting ${tablesToExport.length} tables to ${outputDir}/...`)

    let successCount = 0
    let errorCount = 0

    /* eslint-disable no-await-in-loop -- Sequential table export for progress logging */
    for (const table of tablesToExport) {
      const outputFile = `${outputDir}/${table.name}.${format}`

      try {
        const records = await this.fetchRecords(api, table.id, flags)
        const filteredRecords = this.filterColumns(records, flags.columns)

        const output = format === 'csv'
          ? Papa.unparse(filteredRecords)
          : JSON.stringify(filteredRecords, null, 2)

        writeFileSync(outputFile, output, 'utf8')
        this.log(`  ✓ ${table.name}: ${filteredRecords.length} records`)
        successCount++
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.log(`  ✗ ${table.name}: ${message}`)
        errorCount++
      }
    }
    /* eslint-enable no-await-in-loop */

    this.log('')
    this.log(`Exported ${successCount} tables${errorCount > 0 ? `, ${errorCount} failed` : ''}`)
  }

  private async fetchRecords(
    api: XanoApi,
    tableId: number,
    flags: { all: boolean; datasource?: string; filter?: string[]; sort?: string[] }
  ): Promise<Record<string, unknown>[]> {
    const hasFilters = flags.filter && flags.filter.length > 0
    const hasSort = flags.sort && flags.sort.length > 0

    const allRecords: Record<string, unknown>[] = []
    let page = 1
    const perPage = 100

    /* eslint-disable no-await-in-loop -- Paginated fetching requires sequential requests */
    do {
      const response = hasFilters || hasSort
        ? await this.searchRecords(api, tableId, { ...flags, page, 'per-page': perPage })
        : await api.listTableContent(tableId, page, perPage, flags.datasource)

      if (!response.ok) {
        throw new Error(response.error || 'Failed to fetch records')
      }

      const items = response.data?.items || []
      allRecords.push(...items)

      // Check if we should continue fetching
      if (!flags.all || items.length < perPage) {
        break
      }

      const data = response.data as { nextPage?: null | number }
      if (!data.nextPage) {
        break
      }

      page++
    } while (flags.all)
    /* eslint-enable no-await-in-loop */

    return allRecords
  }

  private filterColumns(
    records: Record<string, unknown>[],
    columnsFlag: string | undefined
  ): Record<string, unknown>[] {
    if (!columnsFlag || records.length === 0) {
      return records
    }

    const columns = columnsFlag.split(',').map(c => c.trim())

    return records.map(record => {
      const filtered: Record<string, unknown> = {}
      for (const col of columns) {
        if (col in record) {
          filtered[col] = record[col]
        }
      }

      return filtered
    })
  }

  private isBatchExport(
    args: { file?: string; table?: string },
    flags: { all: boolean; tables?: string; tags?: string }
  ): boolean {
    const path = args.table || args.file

    // --tags or --tables flags always trigger batch mode
    if (flags.tags || flags.tables) {
      return true
    }

    // Explicit directory syntax (trailing slash)
    if (path?.endsWith('/')) {
      return true
    }

    // Existing directory
    if (path && existsSync(path)) {
      try {
        if (statSync(path).isDirectory()) {
          return true
        }
      } catch {
        // Not a directory
      }
    }

    // With --all flag and no file extension, treat as directory
    if (flags.all && path) {
      const ext = extname(path).toLowerCase()
      if (ext !== '.json' && ext !== '.csv' && ext !== '.xs') {
        return true
      }
    }

    // No arguments at all with --all flag
    if (flags.all && !path) {
      return true
    }

    return false
  }

  private resolveArgs(
    args: { file?: string; table?: string },
    projectRoot: string
  ): { outputFile?: string; tableName: string } {
    // Case 1: Both table and file provided
    if (args.table && args.file) {
      return {
        outputFile: args.file,
        tableName: this.resolveTableName(args.table, projectRoot),
      }
    }

    // Case 2: Only one arg - could be table or file
    const arg = args.table || args.file
    if (!arg) {
      this.error('TABLE argument is required')
    }

    // Check if it looks like an output file (has .json or .csv extension)
    const ext = extname(arg).toLowerCase()
    if (ext === '.json' || ext === '.csv') {
      // Try to derive table name from filename
      const baseName = basename(arg, ext)
      return {
        outputFile: arg,
        tableName: baseName,
      }
    }

    // Treat as table name, output to stdout
    return {
      tableName: this.resolveTableName(arg, projectRoot),
    }
  }

  private async resolveTableIdRemote(api: XanoApi, tableRef: string): Promise<null | number> {
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

  private async searchRecords(
    api: XanoApi,
    tableId: number,
    flags: { datasource?: string; filter?: string[]; page: number; 'per-page': number; sort?: string[] }
  ) {
    const search: Record<string, unknown>[] = []
    if (flags.filter) {
      for (const f of flags.filter) {
        const parsed = parseFilter(f)
        if (!parsed) {
          this.error(`Invalid filter format: ${f}\nUse: field=value, field>value, field in a,b,c`)
        }

        const apiField = parsed.operator === '='
          ? parsed.field
          : `${parsed.field}${OPERATOR_MAP[parsed.operator]}`

        search.push({ [apiField]: parsed.value })
      }
    }

    const sort: Record<string, 'asc' | 'desc'>[] = []
    if (flags.sort) {
      for (const s of flags.sort) {
        const parsed = parseSort(s)
        if (!parsed) {
          this.error(`Invalid sort format: ${s}\nUse: field:asc or field:desc`)
        }

        sort.push({ [parsed.field]: parsed.direction })
      }
    }

    return api.searchTableContent(tableId, {
      datasource: flags.datasource,
      page: flags.page,
      perPage: flags['per-page'],
      search: search.length > 0 ? search : undefined,
      sort: sort.length > 0 ? sort : undefined,
    })
  }
}
