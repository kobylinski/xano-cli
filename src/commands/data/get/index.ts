import { Args, Command, Flags } from '@oclif/core'

import { isAgentMode } from '../../../base-command.js'
import {
  getProfile,
  XanoApi,
} from '../../../lib/api.js'
import {
  checkDatasourcePermission,
  formatAgentDatasourceBlockedMessage,
  resolveEffectiveDatasource,
} from '../../../lib/datasource.js'
import {
  findProjectRoot,
  isInitialized,
  loadEffectiveConfig,
} from '../../../lib/project.js'
import {
  formatTableNotFoundError,
  resolveTableFromLocal,
} from '../../../lib/resolver.js'

export default class DataGet extends Command {
  static args = {
    pk: Args.string({
      description: 'Primary key value',
      required: true,
    }),
    table: Args.string({
      description: 'Table name or ID',
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
    remote: Flags.boolean({
      default: false,
      description: 'Force remote API lookup instead of local cache',
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

    const config = loadEffectiveConfig(projectRoot)
    if (!config) {
      this.error('Failed to load .xano/config.json')
    }

    const profile = getProfile(flags.profile, config.profile)
    if (!profile) {
      this.error('No profile found. Run "xano init" first.')
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

    // Resolve table name to ID
    // With --remote: skip local cache, query Xano API directly
    // Without --remote: try local cache first (fast path)
    let tableId: null | number = null
    let usedRemoteLookup = false

    if (flags.remote) {
      usedRemoteLookup = true
      tableId = await this.resolveTableIdRemote(api, args.table)
    } else {
      const localResult = resolveTableFromLocal(projectRoot, args.table)
      if (localResult) {
        tableId = localResult.id
      }
    }

    if (!tableId) {
      this.error(formatTableNotFoundError(args.table, isAgentMode(), usedRemoteLookup))
    }

    const response = await api.getTableContent(tableId, args.pk, datasource)

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
}
