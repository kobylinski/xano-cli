import { Args, Command, Flags } from '@oclif/core'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

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
import { detectType, extractName } from '../../../lib/detector.js'
import {
  findProjectRoot,
  isInitialized,
  loadEffectiveConfig,
} from '../../../lib/project.js'
import {
  formatTableNotFoundError,
  resolveTableFromLocal,
} from '../../../lib/resolver.js'

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

export default class DataList extends Command {
  static args = {
    table: Args.string({
      description: 'Table name, ID, or file path (e.g., data/tables/users.xs)',
      required: true,
    }),
  }
  static description = 'List and search records from a table'
  static examples = [
    '<%= config.bin %> data:list users',
    '<%= config.bin %> data:list 271',
    '<%= config.bin %> data:list data/tables/users.xs',
    '<%= config.bin %> data:list users --columns "id,email,name"',
    '<%= config.bin %> data:list users --filter "status=active"',
    '<%= config.bin %> data:list orders --filter "price>30" --filter "price<70"',
    '<%= config.bin %> data:list products --filter "id in 2,3,7"',
    '<%= config.bin %> data:list users --sort "created_at:desc" --per-page 50',
    '<%= config.bin %> data:list users --json',
  ]
  static flags = {
    columns: Flags.string({
      char: 'c',
      description: 'Comma-separated list of columns to display',
    }),
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
    remote: Flags.boolean({
      default: false,
      description: 'Force remote API lookup instead of local cache',
    }),
    sort: Flags.string({
      description: 'Sort by field (field:asc or field:desc)',
      multiple: true,
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

    // Resolve table reference (name, ID, or file path) to table name
    const tableName = this.resolveTableName(args.table, projectRoot)

    // Resolve table name to ID
    // With --remote: skip local cache, query Xano API directly
    // Without --remote: try local cache first (fast path)
    let tableId: null | number = null
    let usedRemoteLookup = false

    if (flags.remote) {
      // --remote flag: bypass local cache entirely
      usedRemoteLookup = true
      tableId = await this.resolveTableIdRemote(api, tableName)
    } else {
      // Try local resolution first (fast path)
      const localResult = resolveTableFromLocal(projectRoot, tableName)
      if (localResult) {
        tableId = localResult.id
      }
    }

    if (!tableId) {
      this.error(formatTableNotFoundError(tableName, isAgentMode(), usedRemoteLookup))
    }

    // Check if we need search (filters or sort provided)
    const hasFilters = flags.filter && flags.filter.length > 0
    const hasSort = flags.sort && flags.sort.length > 0

    // Use search endpoint when filters/sort provided, otherwise browse endpoint
    const response = hasFilters || hasSort
      ? await this.searchRecords(api, tableId, { ...flags, datasource })
      : await api.listTableContent(tableId, flags.page, flags['per-page'], datasource)

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

    // Get column names from first record, filter if --columns specified
    let columns = Object.keys(items[0])
    if (flags.columns) {
      const requestedColumns = flags.columns.split(',').map(c => c.trim())
      // Filter to only requested columns that exist
      columns = requestedColumns.filter(c => columns.includes(c))
      if (columns.length === 0) {
        this.error(`None of the specified columns exist. Available columns: ${Object.keys(items[0]).join(', ')}`)
      }
    }

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
    const data = response.data as { curPage?: number; itemsTotal?: number; nextPage?: null | number; pageTotal?: number }
    const total = data?.itemsTotal
    const pageTotal = data?.pageTotal
    if (total === undefined) {
      this.log(`Page ${data?.curPage || flags.page}, showing ${items.length} records`)
    } else {
      this.log(`Page ${data?.curPage || flags.page} of ${pageTotal}, showing ${items.length} of ${total} records`)
    }

    if (data?.nextPage) {
      this.log(`Use --page ${data.nextPage} for next page`)
    }
  }

  private async resolveTableIdRemote(api: XanoApi, tableRef: string): Promise<null | number> {
    // If it's a number, use directly
    const numId = Number.parseInt(tableRef, 10)
    if (!Number.isNaN(numId)) {
      return numId
    }

    // Otherwise, search by name via API
    const response = await api.listTables(1, 1000)
    if (!response.ok || !response.data?.items) {
      return null
    }

    const table = response.data.items.find(
      t => t.name.toLowerCase() === tableRef.toLowerCase()
    )

    return table?.id || null
  }

  /**
   * Resolve table reference to table name
   * Handles: table name, table ID, or file path
   */
  private resolveTableName(tableRef: string, _projectRoot: string): string {
    // Check if it looks like a file path (contains / or ends with .xs)
    if (tableRef.includes('/') || tableRef.endsWith('.xs')) {
      // Resolve from current working directory, not project root
      const filePath = isAbsolute(tableRef)
        ? tableRef
        : resolve(tableRef)

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

    // Return as-is (table name or ID)
    return tableRef
  }

  private async searchRecords(
    api: XanoApi,
    tableId: number,
    flags: { datasource?: string; filter?: string[]; page: number; 'per-page': number; sort?: string[] }
  ) {
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
    return api.searchTableContent(tableId, {
      datasource: flags.datasource,
      page: flags.page,
      perPage: flags['per-page'],
      search: search.length > 0 ? search : undefined,
      sort: sort.length > 0 ? sort : undefined,
    })
  }
}
