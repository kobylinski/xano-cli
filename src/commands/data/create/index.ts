import { Args, Command, Flags } from '@oclif/core'
import * as fs from 'node:fs'

import {
  getProfile,
  XanoApi,
} from '../../../lib/api.js'
import {
  findProjectRoot,
  isInitialized,
  loadLocalConfig,
} from '../../../lib/project.js'

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

    const config = loadLocalConfig(projectRoot)
    if (!config) {
      this.error('Failed to load .xano/config.json')
    }

    const profile = getProfile(flags.profile)
    if (!profile) {
      this.error('No profile found. Run "xano profile:wizard" to create one.')
    }

    // Parse data
    let data: Record<string, unknown>
    try {
      if (flags.file) {
        const content = fs.readFileSync(flags.file, 'utf-8')
        data = JSON.parse(content)
      } else {
        data = JSON.parse(flags.data!)
      }
    } catch (error: any) {
      this.error(`Invalid JSON: ${error.message}`)
    }

    const api = new XanoApi(profile, config.workspaceId, config.branch)

    // Resolve table name to ID if needed
    const tableId = await this.resolveTableId(api, args.table)
    if (!tableId) {
      this.error(`Table not found: ${args.table}`)
    }

    const response = await api.createTableContent(tableId, data, flags.datasource)

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
