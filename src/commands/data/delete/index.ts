import { Args, Command, Flags } from '@oclif/core'
import * as readline from 'node:readline'

import {
  getProfile,
  XanoApi,
} from '../../../lib/api.js'
import { checkDatasourcePermission } from '../../../lib/datasource.js'
import {
  findProjectRoot,
  isInitialized,
  loadLocalConfig,
} from '../../../lib/project.js'

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

export default class DataDelete extends Command {
  /* eslint-disable perfectionist/sort-objects -- positional arg order matters in oclif */
  static args = {
    table: Args.string({
      description: 'Table name or ID',
      required: true,
    }),
    pk: Args.string({
      description: 'Primary key value (optional with --filter or --ids)',
      required: false,
    }),
  }
  /* eslint-enable perfectionist/sort-objects */
  static description = 'Delete records by primary key, filter, or ID list'
  static examples = [
    '<%= config.bin %> data:delete users 1 --force',
    '<%= config.bin %> data:delete users --filter "status=deleted" --force',
    '<%= config.bin %> data:delete users --ids "1,2,3,4,5" --force',
    '<%= config.bin %> data:delete users --filter "last_login<2024-01-01" --dry-run',
  ]
  static flags = {
    datasource: Flags.string({
      char: 's',
      description: 'Data source to use (e.g., "live", "test")',
    }),
    'dry-run': Flags.boolean({
      default: false,
      description: 'Preview deletions without executing',
    }),
    filter: Flags.string({
      description: 'Filter expression to select records (e.g., "status=deleted")',
      multiple: true,
    }),
    force: Flags.boolean({
      char: 'f',
      default: false,
      description: 'Skip confirmation',
    }),
    ids: Flags.string({
      description: 'Comma-separated list of IDs to delete',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output results as JSON',
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

    // Resolve table name to ID
    const tableId = await this.resolveTableId(api, args.table)
    if (!tableId) {
      this.error(`Table not found: ${args.table}`)
    }

    // Determine delete mode
    const isBulkMode = flags.filter || flags.ids

    if (isBulkMode) {
      await this.bulkDelete(api, tableId, flags, args.table)
    } else {
      if (!args.pk) {
        this.error('Primary key is required (or use --filter/--ids for bulk delete)')
      }

      await this.singleDelete(api, tableId, args.pk, flags)
    }
  }

  private async bulkDelete(
    api: XanoApi,
    tableId: number,
    flags: { datasource?: string; 'dry-run': boolean; filter?: string[]; force: boolean; ids?: string; json: boolean },
    tableName: string
  ): Promise<void> {
    // Get records to delete
    const recordIds = await this.getTargetRecordIds(api, tableId, flags)

    if (recordIds.length === 0) {
      this.log('No records match the specified criteria.')
      return
    }

    // Dry run - just show what would be deleted
    if (flags['dry-run']) {
      this.log(`Would delete ${recordIds.length} records from ${tableName}:`)
      this.log(`  IDs: ${recordIds.slice(0, 10).join(', ')}${recordIds.length > 10 ? ` ... and ${recordIds.length - 10} more` : ''}`)
      return
    }

    // Confirmation prompt
    if (!flags.force) {
      const confirmed = await this.confirm(
        `This will DELETE ${recordIds.length} records from "${tableName}". This cannot be undone. Continue?`
      )
      if (!confirmed) {
        this.log('Cancelled.')
        return
      }
    }

    this.log(`Deleting ${recordIds.length} records...`)

    let deleted = 0
    let failed = 0
    const results: Array<{ error?: string; id: number | string; success: boolean }> = []

    /* eslint-disable no-await-in-loop -- Sequential deletes with progress */
    for (const id of recordIds) {
      const response = await api.deleteTableContent(tableId, id, flags.datasource)
      if (response.ok) {
        deleted++
        results.push({ id, success: true })
      } else {
        failed++
        results.push({ error: response.error, id, success: false })
      }

      // Progress every 100 records
      if ((deleted + failed) % 100 === 0) {
        this.log(`  Progress: ${deleted + failed}/${recordIds.length} (${deleted} deleted, ${failed} failed)`)
      }
    }
    /* eslint-enable no-await-in-loop */

    if (flags.json) {
      this.log(JSON.stringify({ deleted, failed, results }, null, 2))
      return
    }

    this.log('')
    this.log(`Delete complete: ${deleted} deleted${failed > 0 ? `, ${failed} failed` : ''}`)
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

  private async getTargetRecordIds(
    api: XanoApi,
    tableId: number,
    flags: { datasource?: string; filter?: string[]; ids?: string }
  ): Promise<Array<number | string>> {
    // If IDs are provided directly
    if (flags.ids) {
      return flags.ids.split(',').map(id => {
        const num = Number(id.trim())
        return Number.isNaN(num) ? id.trim() : num
      })
    }

    // Otherwise, search using filters
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

    // Fetch all matching records
    const allIds: Array<number | string> = []
    let page = 1
    const perPage = 100

    /* eslint-disable no-await-in-loop -- Paginated fetching */
    let hasMore = true
    while (hasMore) {
      const response = await api.searchTableContent(tableId, {
        datasource: flags.datasource,
        page,
        perPage,
        search: search.length > 0 ? search : undefined,
      })

      if (!response.ok) {
        this.error(`Failed to search records: ${response.error}`)
      }

      const items = response.data?.items || []
      for (const item of items) {
        if (item.id !== undefined) {
          allIds.push(item.id as number | string)
        }
      }

      const data = response.data as { nextPage?: null | number }
      hasMore = items.length >= perPage && data.nextPage !== null && data.nextPage !== undefined
      page++
    }
    /* eslint-enable no-await-in-loop */

    return allIds
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

  private async singleDelete(
    api: XanoApi,
    tableId: number,
    pk: string,
    flags: { datasource?: string; 'dry-run': boolean; force: boolean; json: boolean }
  ): Promise<void> {
    // Fetch record first to show what will be deleted
    const getResponse = await api.getTableContent(tableId, pk, flags.datasource)
    if (!getResponse.ok) {
      this.error(`Record not found: ${pk}`)
    }

    if (flags['dry-run']) {
      this.log(`Would delete record ${pk}:`)
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

      return
    }

    if (!flags.force) {
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

    const response = await api.deleteTableContent(tableId, pk, flags.datasource)

    if (!response.ok) {
      this.error(`Failed to delete record: ${response.error}`)
    }

    if (flags.json) {
      this.log(JSON.stringify({ deleted: true, id: pk }, null, 2))
      return
    }

    this.log(`Record ${pk} deleted successfully.`)
  }
}
