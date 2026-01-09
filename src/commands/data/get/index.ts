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

export default class DataGet extends Command {
  static args = {
    table: Args.string({
      description: 'Table name or ID',
      required: true,
    }),
    pk: Args.string({
      description: 'Primary key value',
      required: true,
    }),
  }
  static description = 'Get a single record by primary key'
  static examples = [
    '<%= config.bin %> data:get users 1',
    '<%= config.bin %> data:get 271 42',
    '<%= config.bin %> data:get users 1 --json',
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
    profile: Flags.string({
      description: 'Profile to use',
      env: 'XANO_PROFILE',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DataGet)

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

    const response = await api.getTableContent(tableId, args.pk, flags.datasource)

    if (!response.ok) {
      this.error(`Failed to get record: ${response.error}`)
    }

    if (flags.json) {
      this.log(JSON.stringify(response.data, null, 2))
      return
    }

    // Pretty print the record
    const record = response.data
    if (!record) {
      this.log('Record not found.')
      return
    }

    for (const [key, value] of Object.entries(record)) {
      let displayValue: string
      if (value === null || value === undefined) {
        displayValue = '(null)'
      } else if (typeof value === 'object') {
        displayValue = JSON.stringify(value)
      } else {
        displayValue = String(value)
      }
      this.log(`${key}: ${displayValue}`)
    }
  }

  private async resolveTableId(api: XanoApi, tableRef: string): Promise<number | null> {
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
