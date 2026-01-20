import { Args, Command, Flags } from '@oclif/core'
import * as fs from 'node:fs'
import * as readline from 'node:readline'

import {
  getProfile,
  XanoApi,
} from '../../../lib/api.js'
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

export default class DataUpdate extends Command {
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
  static description = 'Update records by primary key, filter, or ID list'
  static examples = [
    '<%= config.bin %> data:update users 1 --data \'{"name":"Updated Name"}\'',
    '<%= config.bin %> data:update users --filter "status=pending" --data \'{"status":"active"}\'',
    '<%= config.bin %> data:update users --ids "1,2,3,4,5" --data \'{"verified":true}\'',
    '<%= config.bin %> data:update users --filter "role=guest" --data \'{"role":"user"}\' --dry-run',
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
    'dry-run': Flags.boolean({
      default: false,
      description: 'Preview changes without executing',
    }),
    file: Flags.string({
      char: 'f',
      description: 'Read record data from JSON file',
      exclusive: ['data'],
    }),
    filter: Flags.string({
      description: 'Filter expression to select records (e.g., "status=pending")',
      multiple: true,
    }),
    force: Flags.boolean({
      default: false,
      description: 'Skip confirmation for bulk updates',
    }),
    ids: Flags.string({
      description: 'Comma-separated list of IDs to update',
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
    const { args, flags } = await this.parse(DataUpdate)

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

    const profile = getProfile(flags.profile, config.profile)
    if (!profile) {
      this.error('No profile found. Run "xano profile:wizard" to create one.')
    }

    // Parse update data
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

    // Resolve table name to ID
    const tableId = await this.resolveTableId(api, args.table)
    if (!tableId) {
      this.error(`Table not found: ${args.table}`)
    }

    // Determine update mode
    const isBulkMode = flags.filter || flags.ids

    if (isBulkMode) {
      await this.bulkUpdate(api, tableId, data, flags, args.table)
    } else {
      if (!args.pk) {
        this.error('Primary key is required (or use --filter/--ids for bulk update)')
      }

      await this.singleUpdate(api, tableId, args.pk, data, flags)
    }
  }

  private async bulkUpdate(
    api: XanoApi,
    tableId: number,
    data: Record<string, unknown>,
    flags: { datasource?: string; 'dry-run': boolean; filter?: string[]; force: boolean; ids?: string; json: boolean },
    tableName: string
  ): Promise<void> {
    // Get records to update
    const recordIds = await this.getTargetRecordIds(api, tableId, flags)

    if (recordIds.length === 0) {
      this.log('No records match the specified criteria.')
      return
    }

    // Dry run - just show what would be updated
    if (flags['dry-run']) {
      this.log(`Would update ${recordIds.length} records in ${tableName}:`)
      this.log(`  IDs: ${recordIds.slice(0, 10).join(', ')}${recordIds.length > 10 ? ` ... and ${recordIds.length - 10} more` : ''}`)
      this.log(`  Data: ${JSON.stringify(data)}`)
      return
    }

    // Confirmation prompt
    if (!flags.force) {
      const confirmed = await this.confirm(
        `This will update ${recordIds.length} records in "${tableName}". Continue?`
      )
      if (!confirmed) {
        this.log('Cancelled.')
        return
      }
    }

    this.log(`Updating ${recordIds.length} records...`)

    let updated = 0
    let failed = 0
    const results: Array<{ error?: string; id: number | string; success: boolean }> = []

    /* eslint-disable no-await-in-loop -- Sequential updates with progress */
    for (const id of recordIds) {
      const response = await api.updateTableContent(tableId, id, data, flags.datasource)
      if (response.ok) {
        updated++
        results.push({ id, success: true })
      } else {
        failed++
        results.push({ error: response.error, id, success: false })
      }

      // Progress every 100 records
      if ((updated + failed) % 100 === 0) {
        this.log(`  Progress: ${updated + failed}/${recordIds.length} (${updated} updated, ${failed} failed)`)
      }
    }
    /* eslint-enable no-await-in-loop */

    if (flags.json) {
      this.log(JSON.stringify({ failed, results, updated }, null, 2))
      return
    }

    this.log('')
    this.log(`Update complete: ${updated} updated${failed > 0 ? `, ${failed} failed` : ''}`)
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

  private async singleUpdate(
    api: XanoApi,
    tableId: number,
    pk: string,
    data: Record<string, unknown>,
    flags: { datasource?: string; 'dry-run': boolean; json: boolean }
  ): Promise<void> {
    if (flags['dry-run']) {
      this.log(`Would update record ${pk}:`)
      this.log(`  Data: ${JSON.stringify(data)}`)
      return
    }

    const response = await api.updateTableContent(tableId, pk, data, flags.datasource)

    if (!response.ok) {
      this.error(`Failed to update record: ${response.error}`)
    }

    if (flags.json) {
      this.log(JSON.stringify(response.data, null, 2))
      return
    }

    this.log('Record updated successfully:')
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
}
