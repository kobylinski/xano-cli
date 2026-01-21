import { Args, Command, Flags } from '@oclif/core'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

import {
  getProfile,
  XanoApi,
} from '../../../lib/api.js'
import { detectType, extractName } from '../../../lib/detector.js'
import {
  findProjectRoot,
  isInitialized,
  loadLocalConfig,
} from '../../../lib/project.js'

interface ColumnInfo {
  comment?: string
  default?: string
  name: string
  nullable: boolean
  properties?: Record<string, string>
  type: string
}

/**
 * Parse the schema block from XanoScript table definition
 */
function parseSchema(xanoscript: string): ColumnInfo[] {
  const columns: ColumnInfo[] = []

  // Find the schema block - match until we find a closing brace at the same indentation level
  const schemaStart = xanoscript.indexOf('schema {')
  if (schemaStart === -1) {
    return columns
  }

  // Find the matching closing brace
  let braceCount = 0
  let schemaEnd = -1
  let inSchema = false

  for (let i = schemaStart; i < xanoscript.length; i++) {
    if (xanoscript[i] === '{') {
      braceCount++
      inSchema = true
    } else if (xanoscript[i] === '}') {
      braceCount--
      if (inSchema && braceCount === 0) {
        schemaEnd = i
        break
      }
    }
  }

  if (schemaEnd === -1) {
    return columns
  }

  const schemaContent = xanoscript.slice(schemaStart + 'schema {'.length, schemaEnd)

  // Parse each column definition
  // Column format: type? name?{props}?=default
  // We need to handle multi-line properties blocks

  let currentComment = ''
  let i = 0
  const content = schemaContent

  while (i < content.length) {
    // Skip whitespace
    while (i < content.length && /\s/.test(content[i])) i++
    if (i >= content.length) break

    // Check for comment
    if (content.slice(i, i + 2) === '//') {
      const lineEnd = content.indexOf('\n', i)
      const commentText = content.slice(i + 2, lineEnd === -1 ? content.length : lineEnd).trim()
      currentComment = currentComment ? `${currentComment} ${commentText}` : commentText
      i = lineEnd === -1 ? content.length : lineEnd + 1
      continue
    }

    // Try to parse a column definition
    // Match: type? name?{...}?=...
    const remaining = content.slice(i)

    // Match type and name
    const typeNameMatch = remaining.match(/^(\w+)(\?)?\s+(\w+)(\?)?/)
    if (!typeNameMatch) {
      // Skip to next line
      const lineEnd = content.indexOf('\n', i)
      i = lineEnd === -1 ? content.length : lineEnd + 1
      currentComment = ''
      continue
    }

    const [fullMatch, type, typeNullable, name, nameNullable] = typeNameMatch
    i += fullMatch.length

    // Skip whitespace
    while (i < content.length && /[ \t]/.test(content[i])) i++

    const column: ColumnInfo = {
      name,
      nullable: Boolean(typeNullable || nameNullable),
      type,
    }

    if (currentComment) {
      column.comment = currentComment
      currentComment = ''
    }

    // Check for properties block
    if (content[i] === '{') {
      // Find matching closing brace
      let propBraceCount = 1
      const propStart = i + 1
      let propEnd = propStart

      while (propEnd < content.length && propBraceCount > 0) {
        if (content[propEnd] === '{') propBraceCount++
        else if (content[propEnd] === '}') propBraceCount--
        propEnd++
      }

      const propsStr = content.slice(propStart, propEnd - 1)
      column.properties = {}

      // Parse properties
      const propMatches = propsStr.matchAll(/(\w+)\s*=\s*("[^"]*"|\[[^\]]*\]|\w+)/g)
      for (const match of propMatches) {
        column.properties[match[1]] = match[2]
      }

      i = propEnd
    }

    // Skip whitespace
    while (i < content.length && /[ \t]/.test(content[i])) i++

    // Check for default value
    if (content[i] === '=') {
      i++ // skip =
      // Read until end of line or next whitespace
      const defaultMatch = content.slice(i).match(/^([^\s\n]+)/)
      if (defaultMatch) {
        column.default = defaultMatch[1]
        i += defaultMatch[1].length
      }
    }

    columns.push(column)
  }

  return columns
}

export default class DataColumns extends Command {
  static args = {
    table: Args.string({
      description: 'Table name, ID, or file path (e.g., data/tables/users.xs)',
      required: true,
    }),
  }
  static description = 'Show column definitions for a table'
  static examples = [
    '<%= config.bin %> data:columns users',
    '<%= config.bin %> data:columns 271',
    '<%= config.bin %> data:columns data/tables/users.xs',
    '<%= config.bin %> data:columns users --json',
  ]
  static flags = {
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
    const { args, flags } = await this.parse(DataColumns)

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

    // Try to get xanoscript from local file first, then from API
    let xanoscript: string | undefined
    let tableName: string

    if (args.table.includes('/') || args.table.endsWith('.xs')) {
      // File path provided - read from file
      // Resolve from current working directory, not project root
      const filePath = isAbsolute(args.table)
        ? args.table
        : resolve(args.table)

      if (!existsSync(filePath)) {
        this.error(`File not found: ${args.table}`)
      }

      xanoscript = readFileSync(filePath, 'utf8')
      const type = detectType(xanoscript)

      if (type !== 'table') {
        this.error(`File is not a table definition (detected type: ${type || 'unknown'})`)
      }

      tableName = extractName(xanoscript) || args.table
    } else {
      // Table name or ID provided - fetch from API
      const profile = getProfile(flags.profile, config.profile)
      if (!profile) {
        this.error('No profile found. Run "xano init" first.')
      }

      const api = new XanoApi(profile, config.workspaceId, config.branch)

      // Resolve table reference to ID
      const tableId = await this.resolveTableId(api, args.table)
      if (!tableId) {
        this.error(`Table not found: ${args.table}`)
      }

      // Fetch table with xanoscript
      const response = await api.getTable(tableId)
      if (!response.ok || !response.data) {
        this.error(`Failed to fetch table: ${response.error}`)
      }

      const rawXanoscript = response.data.xanoscript
      tableName = response.data.name

      if (!rawXanoscript) {
        this.error('Table has no schema definition')
      }

      // Handle xanoscript being an object with value property
      xanoscript = typeof rawXanoscript === 'object' && rawXanoscript !== null
        ? (rawXanoscript as { value?: string }).value || ''
        : rawXanoscript
    }

    // Parse the schema
    const columns = parseSchema(xanoscript!)

    if (columns.length === 0) {
      this.log(`No columns found in table ${tableName}`)
      return
    }

    if (flags.json) {
      this.log(JSON.stringify({ columns, table: tableName }, null, 2))
      return
    }

    // Pretty print columns
    this.log(`Table: ${tableName}`)
    this.log('')

    // Calculate column widths
    const nameWidth = Math.max(6, ...columns.map(c => c.name.length))
    const typeWidth = Math.max(4, ...columns.map(c => c.type.length + (c.nullable ? 1 : 0)))

    // Print header
    this.log(`${'Column'.padEnd(nameWidth)}  ${'Type'.padEnd(typeWidth)}  Description`)
    this.log(`${'-'.repeat(nameWidth)}  ${'-'.repeat(typeWidth)}  ${'-'.repeat(40)}`)

    // Print columns
    for (const col of columns) {
      const typeStr = col.type + (col.nullable ? '?' : '')
      let description = col.comment || ''

      // Add default if present
      if (col.default) {
        description += description ? ` (default: ${col.default})` : `default: ${col.default}`
      }

      // Add FK reference if present
      if (col.properties?.table) {
        description += description ? ` -> ${col.properties.table}` : `-> ${col.properties.table}`
      }

      // Add enum values if present
      if (col.properties?.values) {
        description += description ? ` ${col.properties.values}` : col.properties.values
      }

      this.log(`${col.name.padEnd(nameWidth)}  ${typeStr.padEnd(typeWidth)}  ${description}`)
    }

    this.log('')
    this.log(`Total: ${columns.length} columns`)
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
