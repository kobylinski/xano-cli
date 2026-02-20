import { Args, Command, Flags } from '@oclif/core'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

import type { XanoTableIndex } from '../../../../lib/types.js'

import {
  getMissingProfileError,
  getProfile,
  XanoApi,
} from '../../../../lib/api.js'
import { detectType, extractName } from '../../../../lib/detector.js'
import {
  findProjectRoot,
  isInitialized,
  loadCliConfig,
  loadEffectiveConfig,
} from '../../../../lib/project.js'

export default class SchemaDescribeIndexes extends Command {
  static args = {
    table: Args.string({
      description: 'Table name, ID, or file path',
      required: true,
    }),
  }
  static description = 'Show indexes for a table'
  static examples = [
    '<%= config.bin %> schema describe indexes users',
    '<%= config.bin %> schema describe indexes 271',
    '<%= config.bin %> schema describe indexes tables/users.xs',
    '<%= config.bin %> schema describe indexes users --json',
  ]
  static flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    profile: Flags.string({
      description: 'Profile to use',
      env: 'XANO_PROFILE',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SchemaDescribeIndexes)

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

    const api = new XanoApi(profile, config.workspaceId, config.branch)

    // Determine if input is a file path or table reference
    const isFilePath = args.table.includes('/') || args.table.endsWith('.xs')
    let tableId: null | number = null
    let tableName: string

    if (isFilePath) {
      const filePath = isAbsolute(args.table)
        ? args.table
        : resolve(args.table)

      if (!existsSync(filePath)) {
        this.error(`File not found: ${args.table}`)
      }

      const xanoscript = readFileSync(filePath, 'utf8')
      const type = detectType(xanoscript)

      if (type !== 'table') {
        this.error(`File is not a table definition (detected type: ${type || 'unknown'})`)
      }

      tableName = extractName(xanoscript) || args.table
      tableId = await this.resolveTableId(api, tableName)
      if (!tableId) {
        this.error(`Table '${tableName}' not found on remote. Push the table first.`)
      }
    } else {
      tableId = await this.resolveTableId(api, args.table)
      if (!tableId) {
        this.error(`Table not found: ${args.table}`)
      }

      const tableResponse = await api.getTable(tableId)
      if (!tableResponse.ok || !tableResponse.data) {
        this.error(`Failed to fetch table: ${tableResponse.error}`)
      }

      tableName = tableResponse.data.name
    }

    // Fetch indexes from API
    const indexResponse = await api.getTableIndexes(tableId)
    if (!indexResponse.ok) {
      this.error(`Failed to fetch indexes: ${indexResponse.error}`)
    }

    const indexes = indexResponse.data || []

    if (indexes.length === 0) {
      this.log(`No indexes found for table '${tableName}'`)
      return
    }

    if (flags.json) {
      this.log(JSON.stringify({ indexes, table: tableName }, null, 2))
      return
    }

    // Pretty print indexes
    this.log(`Table: ${tableName}`)
    this.log('')

    // Calculate column widths
    const idWidth = 4
    const typeWidth = Math.max(8, ...indexes.map(i => (i.type || '').length))

    // Print header
    this.log(`${'#'.padEnd(idWidth)}  ${'Type'.padEnd(typeWidth)}  Fields`)
    this.log(`${'-'.repeat(idWidth)}  ${'-'.repeat(typeWidth)}  ${'-'.repeat(50)}`)

    // Print indexes
    for (const [i, idx] of indexes.entries()) {
      const fields = this.formatFields(idx)
      const indexType = idx.type || 'unknown'
      this.log(`${String(i + 1).padEnd(idWidth)}  ${indexType.padEnd(typeWidth)}  ${fields}`)
    }

    this.log('')
    this.log(`Total: ${indexes.length} indexes`)
  }

  private formatFields(index: XanoTableIndex): string {
    if (!index.fields || !Array.isArray(index.fields)) {
      return '(no fields)'
    }

    return index.fields.map(f => {
      if (f.op) {
        return `${f.name} (${f.op})`
      }

      return f.name
    }).join(', ')
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
}
