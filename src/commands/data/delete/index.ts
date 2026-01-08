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

export default class DataDelete extends Command {
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
  static description = 'Delete a record by primary key'
  static examples = [
    '<%= config.bin %> data:delete users 1',
    '<%= config.bin %> data:delete 271 42',
    '<%= config.bin %> data:delete users 1 --force',
  ]
  static flags = {
    force: Flags.boolean({
      char: 'f',
      default: false,
      description: 'Skip confirmation',
    }),
    profile: Flags.string({
      description: 'Profile to use',
      env: 'XANO_PROFILE',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DataDelete)

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

    if (!flags.force) {
      // Show what we're about to delete
      const getResponse = await api.getTableContent(tableId, args.pk)
      if (!getResponse.ok) {
        this.error(`Record not found: ${args.pk}`)
      }

      this.log('About to delete:')
      const record = getResponse.data
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
      this.log('')
      this.log('Use --force to confirm deletion')
      return
    }

    const response = await api.deleteTableContent(tableId, args.pk)

    if (!response.ok) {
      this.error(`Failed to delete record: ${response.error}`)
    }

    this.log(`Record ${args.pk} deleted successfully.`)
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
