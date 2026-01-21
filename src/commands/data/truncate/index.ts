import { Args, Command, Flags } from '@oclif/core'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import * as readline from 'node:readline'

import {
  getProfile,
  XanoApi,
} from '../../../lib/api.js'
import { checkDatasourcePermission } from '../../../lib/datasource.js'
import { detectType, extractName } from '../../../lib/detector.js'
import {
  findProjectRoot,
  isInitialized,
  loadLocalConfig,
} from '../../../lib/project.js'

export default class DataTruncate extends Command {
  static args = {
    table: Args.string({
      description: 'Table name, ID, or file path',
      required: true,
    }),
  }
  static description = 'Delete all records from a table'
  static examples = [
    '<%= config.bin %> data:truncate users',
    '<%= config.bin %> data:truncate users --force',
    '<%= config.bin %> data:truncate tables/users.xs',
    '<%= config.bin %> data:truncate 271 --force',
  ]
  static flags = {
    datasource: Flags.string({
      char: 's',
      description: 'Data source to use (e.g., "live", "test")',
    }),
    force: Flags.boolean({
      char: 'f',
      default: false,
      description: 'Skip confirmation prompt',
    }),
    profile: Flags.string({
      description: 'Profile to use',
      env: 'XANO_PROFILE',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DataTruncate)

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

    const profile = getProfile(flags.profile, config.profile)
    if (!profile) {
      this.error('No profile found. Run "xano init" first.')
    }

    // Check datasource permission for write operation
    try {
      checkDatasourcePermission(flags.datasource, 'write', config.datasources)
    } catch (error) {
      if (error instanceof Error) {
        this.error(error.message)
      }

      throw error
    }

    const api = new XanoApi(profile, config.workspaceId, config.branch)

    // Resolve table
    const tableName = this.resolveTableName(args.table, projectRoot)
    const tableId = await this.resolveTableId(api, tableName)
    if (!tableId) {
      this.error(`Table not found: ${tableName}`)
    }

    // Get record count first
    const countResponse = await api.listTableContent(tableId, 1, 1, flags.datasource)
    if (!countResponse.ok) {
      this.error(`Failed to access table: ${countResponse.error}`)
    }

    const totalRecords = (countResponse.data as { itemsTotal?: number })?.itemsTotal || 0

    if (totalRecords === 0) {
      this.log(`Table ${tableName} is already empty.`)
      return
    }

    // Confirmation prompt
    if (!flags.force) {
      const confirmed = await this.confirm(
        `This will DELETE ALL ${totalRecords} records from table "${tableName}". Continue?`
      )
      if (!confirmed) {
        this.log('Cancelled.')
        return
      }
    }

    this.log(`Deleting ${totalRecords} records from ${tableName}...`)

    let deleted = 0
    let failed = 0
    const page = 1
    const perPage = 100

    /* eslint-disable no-await-in-loop -- Sequential deletion with progress logging */
    // Delete records in batches
    while (deleted + failed < totalRecords) {
      // Fetch a batch of records (always page 1 since we're deleting)
      const response = await api.listTableContent(tableId, page, perPage, flags.datasource)
      if (!response.ok || !response.data?.items) {
        break
      }

      const {items} = response.data
      if (items.length === 0) {
        break
      }

      // Delete each record
      for (const record of items) {
        const pk = record.id as number | string
        if (pk === undefined) {
          failed++
          continue
        }

        const deleteResponse = await api.deleteTableContent(tableId, pk, flags.datasource)
        if (deleteResponse.ok) {
          deleted++
        } else {
          failed++
        }

        // Progress indicator every 100 records
        if ((deleted + failed) % 100 === 0) {
          this.log(`  Progress: ${deleted + failed}/${totalRecords} (${deleted} deleted, ${failed} failed)`)
        }
      }
    }
    /* eslint-enable no-await-in-loop */

    this.log('')
    this.log(`Truncate complete: ${deleted} deleted${failed > 0 ? `, ${failed} failed` : ''}`)
  }

  private async confirm(message: string): Promise<boolean> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    return new Promise(resolve => {
      rl.question(`${message} [y/N] `, answer => {
        rl.close()
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
      })
    })
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
