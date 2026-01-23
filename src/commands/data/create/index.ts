import { Args, Command, Flags } from '@oclif/core'
import * as fs from 'node:fs'

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

export default class DataCreate extends Command {
  static args = {
    table: Args.string({
      description: 'Table name or ID',
      required: true,
    }),
  }
  static description = 'Create a new record in a table. Password fields are automatically hashed.'
  static examples = [
    '<%= config.bin %> data:create users --data \'{"email":"test@example.com","password":"secret123"}\'',
    '<%= config.bin %> data:create users --file record.json',
    '<%= config.bin %> data:create 271 --data \'{"name":"Test"}\'',
  ]
  static flags = {
    data: Flags.string({
      char: 'd',
      description: 'Record data as JSON string',
      exclusive: ['file'],
    }),
    datasource: Flags.string({
      char: 's',
      description: 'Data source to use (e.g., "live", "test")',
    }),
    file: Flags.string({
      char: 'f',
      description: 'Read record data from JSON file',
      exclusive: ['data'],
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
    const { args, flags } = await this.parse(DataCreate)

    if (!flags.data && !flags.file) {
      this.error('Either --data or --file is required')
    }

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

    // Check datasource permission for write operation
    try {
      checkDatasourcePermission(datasource, 'write', config.datasources)
    } catch (error) {
      if (error instanceof Error) {
        this.error(error.message)
      }

      throw error
    }

    // Parse data
    let data: Record<string, unknown>
    try {
      if (flags.file) {
        const content = fs.readFileSync(flags.file, 'utf8')
        data = JSON.parse(content)
      } else {
        data = JSON.parse(flags.data!)
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.error(`Invalid JSON: ${message}`)
    }

    const api = new XanoApi(profile, config.workspaceId, config.branch)

    // Resolve table name to ID (local-first, unless --remote flag is set)
    let tableId: null | number = null

    if (!flags.remote) {
      const localResult = resolveTableFromLocal(projectRoot, args.table)
      if (localResult) {
        tableId = localResult.id
      }
    }

    if (tableId === null && flags.remote) {
      tableId = await this.resolveTableIdRemote(api, args.table)
    }

    if (!tableId) {
      this.error(formatTableNotFoundError(args.table, isAgentMode()))
    }

    const response = await api.createTableContent(tableId, data, datasource)

    if (!response.ok) {
      this.error(`Failed to create record: ${response.error}`)
    }

    if (flags.json) {
      this.log(JSON.stringify(response.data, null, 2))
      return
    }

    this.log('Record created successfully:')
    const record = response.data
    if (record) {
      for (const [key, value] of Object.entries(record)) {
        let displayValue: string
        if (value === null || value === undefined) {
          displayValue = '(null)'
        } else if (typeof value === 'object') {
          displayValue = JSON.stringify(value)
        } else {
          displayValue = String(value)
        }

        this.log(`  ${key}: ${displayValue}`)
      }
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
