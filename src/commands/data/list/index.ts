import { Args, Command, Flags } from '@oclif/core'

import {
  getProfile,
  XanoApi,
} from '../../../lib/api.js'
import {
  findProjectRoot,
  isInitialized,
  loadLocalConfig,
} from '../../../lib/project.js'

export default class DataList extends Command {
  static args = {
    table: Args.string({
      description: 'Table name or ID',
      required: true,
    }),
  }
  static description = 'List records from a table'
  static examples = [
    '<%= config.bin %> data:list users',
    '<%= config.bin %> data:list 271',
    '<%= config.bin %> data:list users --page 2 --per-page 50',
    '<%= config.bin %> data:list users --json',
  ]
  static flags = {
    datasource: Flags.string({
      char: 's',
      description: 'Data source to use (e.g., "live", "test")',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    page: Flags.integer({
      char: 'p',
      default: 1,
      description: 'Page number',
    }),
    'per-page': Flags.integer({
      default: 100,
      description: 'Records per page',
    }),
    profile: Flags.string({
      description: 'Profile to use',
      env: 'XANO_PROFILE',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DataList)

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

    // Resolve table name to ID if needed
    const tableId = await this.resolveTableId(api, args.table)
    if (!tableId) {
      this.error(`Table not found: ${args.table}`)
    }

    const response = await api.listTableContent(tableId, flags.page, flags['per-page'], flags.datasource)

    if (!response.ok) {
      this.error(`Failed to list records: ${response.error}`)
    }

    if (flags.json) {
      this.log(JSON.stringify(response.data, null, 2))
      return
    }

    const items = response.data?.items || []
    if (items.length === 0) {
      this.log('No records found.')
      return
    }

    // Get column names from first record
    const columns = Object.keys(items[0])

    // Print table header
    this.log(columns.join('\t'))
    this.log('-'.repeat(columns.length * 16))

    // Print records
    for (const record of items) {
      const values = columns.map(col => {
        const val = record[col]
        if (val === null || val === undefined) return ''
        if (typeof val === 'object') return JSON.stringify(val)
        return String(val)
      })
      this.log(values.join('\t'))
    }

    // Pagination info
    this.log('')
    this.log(`Page ${response.data?.curPage || flags.page}, showing ${items.length} records`)
    if (response.data?.nextPage) {
      this.log(`Use --page ${response.data.nextPage} for next page`)
    }
  }

  private async resolveTableId(api: XanoApi, tableRef: string): Promise<number | null> {
    // If it's a number, use directly
    const numId = Number.parseInt(tableRef, 10)
    if (!Number.isNaN(numId)) {
      return numId
    }

    // Otherwise, search by name
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
