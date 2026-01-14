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

// Supported filter operators
type Operator = '!=' | '<' | '<=' | '=' | '>' | '>=' | 'in' | 'not in'

// Map CLI operators to Xano API format
const OPERATOR_MAP: Record<Operator, string> = {
  '!=': '|!=',
  '<': '|<',
  '<=': '|<=',
  '=': '',  // exact match uses plain field name
  '>': '|>',
  '>=': '|>=',
  'in': '|in',
  'not in': '|not in',
}

/**
 * Parse a filter string into field, operator, and value
 * Supports formats:
 * - field=value (exact match)
 * - field!=value (not equal)
 * - field>value (greater than)
 * - field>=value (greater or equal)
 * - field<value (less than)
 * - field<=value (less or equal)
 * - field in value1,value2,value3 (in array)
 * - field not in value1,value2,value3 (not in array)
 */
function parseFilter(filter: string): null | { field: string; operator: Operator; value: unknown } {
  // Try each operator in order (longer operators first to avoid partial matches)
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

      // Parse value type - array for 'in'/'not in' operators, single value otherwise
      const value = operator === 'in' || operator === 'not in'
        ? rawValue.split(',').map(v => parseValue(v.trim()))
        : parseValue(rawValue.trim())

      return { field, operator, value }
    }
  }

  return null
}

/**
 * Parse a value string to appropriate type
 */
function parseValue(str: string): unknown {
  // Remove surrounding quotes if present
  if ((str.startsWith('"') && str.endsWith('"')) || (str.startsWith("'") && str.endsWith("'"))) {
    return str.slice(1, -1)
  }

  // Boolean
  if (str.toLowerCase() === 'true') return true
  if (str.toLowerCase() === 'false') return false

  // Null
  if (str.toLowerCase() === 'null') return null

  // Number
  const num = Number(str)
  if (!Number.isNaN(num) && str !== '') return num

  // String (default)
  return str
}

/**
 * Parse sort string (field:direction or field direction)
 */
function parseSort(sort: string): null | { direction: 'asc' | 'desc'; field: string } {
  // Try field:direction format
  const colonMatch = sort.match(/^([a-zA-Z_][a-zA-Z0-9_]*):?(asc|desc)?$/i)
  if (colonMatch) {
    return {
      direction: (colonMatch[2]?.toLowerCase() as 'asc' | 'desc') || 'asc',
      field: colonMatch[1],
    }
  }

  // Try "field direction" format
  const spaceMatch = sort.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+(asc|desc)$/i)
  if (spaceMatch) {
    return {
      direction: spaceMatch[2].toLowerCase() as 'asc' | 'desc',
      field: spaceMatch[1],
    }
  }

  return null
}

export default class DataSearch extends Command {
  static args = {
    table: Args.string({
      description: 'Table name or ID',
      required: true,
    }),
  }
  static description = 'Search and filter records in a table'
  static examples = [
    '<%= config.bin %> data:search users --filter "id=10"',
    '<%= config.bin %> data:search users --filter "status=active"',
    '<%= config.bin %> data:search orders --filter "price>30" --filter "price<70"',
    '<%= config.bin %> data:search products --filter "id in 2,3,7"',
    '<%= config.bin %> data:search items --filter "id not in 1,2,3"',
    '<%= config.bin %> data:search users --sort "created_at:desc" --limit 50',
    '<%= config.bin %> data:search users --filter "age>=18" --filter "age<=65"',
  ]
  static flags = {
    datasource: Flags.string({
      char: 's',
      description: 'Data source to use (e.g., "live", "test")',
    }),
    filter: Flags.string({
      char: 'f',
      description: 'Filter expression (field=value, field>value, field in a,b,c)',
      multiple: true,
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    limit: Flags.integer({
      char: 'l',
      default: 100,
      description: 'Maximum records per page',
    }),
    page: Flags.integer({
      char: 'p',
      default: 1,
      description: 'Page number',
    }),
    profile: Flags.string({
      description: 'Profile to use',
      env: 'XANO_PROFILE',
    }),
    sort: Flags.string({
      description: 'Sort by field (field:asc or field:desc)',
      multiple: true,
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DataSearch)

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

    // Build search conditions array
    const search: Record<string, unknown>[] = []
    if (flags.filter) {
      for (const f of flags.filter) {
        const parsed = parseFilter(f)
        if (!parsed) {
          this.error(`Invalid filter format: ${f}\nUse: field=value, field>value, field in a,b,c, field not in a,b,c`)
        }

        // Build the search condition object
        const apiField = parsed.operator === '='
          ? parsed.field
          : `${parsed.field}${OPERATOR_MAP[parsed.operator]}`

        search.push({ [apiField]: parsed.value })
      }
    }

    // Build sort array
    const sort: Record<string, 'asc' | 'desc'>[] = []
    if (flags.sort) {
      for (const s of flags.sort) {
        const parsed = parseSort(s)
        if (!parsed) {
          this.error(`Invalid sort format: ${s}\nUse: field:asc or field:desc`)
        }

        sort.push({ [parsed.field]: parsed.direction })
      }
    }

    // Perform search
    const response = await api.searchTableContent(tableId, {
      datasource: flags.datasource,
      page: flags.page,
      perPage: flags.limit,
      search: search.length > 0 ? search : undefined,
      sort: sort.length > 0 ? sort : undefined,
    })

    if (!response.ok) {
      this.error(`Failed to search records: ${response.error}`)
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

    // Calculate column widths (max 30 chars each)
    const widths = columns.map(col => {
      const maxLen = Math.max(
        col.length,
        ...items.map(r => {
          const val = r[col]
          if (val === null || val === undefined) return 0
          const str = typeof val === 'object' ? JSON.stringify(val) : String(val)
          return str.length
        })
      )
      return Math.min(maxLen, 30)
    })

    // Print table header
    const header = columns.map((col, i) => col.slice(0, widths[i]).padEnd(widths[i])).join('  ')
    this.log(header)
    this.log(widths.map(w => '-'.repeat(w)).join('  '))

    // Print records
    for (const record of items) {
      const values = columns.map((col, i) => {
        const val = record[col]
        let str: string
        if (val === null || val === undefined) {
          str = ''
        } else if (typeof val === 'object') {
          str = JSON.stringify(val)
        } else {
          str = String(val)
        }

        // Truncate if too long
        if (str.length > widths[i]) {
          str = str.slice(0, widths[i] - 1) + '\u2026'
        }

        return str.padEnd(widths[i])
      })
      this.log(values.join('  '))
    }

    // Pagination info
    this.log('')
    const total = response.data?.itemsTotal
    const pageTotal = response.data?.pageTotal
    if (total === undefined) {
      this.log(`Page ${response.data?.curPage || flags.page}, showing ${items.length} records`)
    } else {
      this.log(`Page ${response.data?.curPage || flags.page} of ${pageTotal}, showing ${items.length} of ${total} records`)
    }

    if (response.data?.nextPage) {
      this.log(`Use --page ${response.data.nextPage} for next page`)
    }
  }

  private async resolveTableId(api: XanoApi, tableRef: string): Promise<null | number> {
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
