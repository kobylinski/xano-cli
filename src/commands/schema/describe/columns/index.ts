import { Args, Command, Flags } from '@oclif/core'
import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

import type { XanoTableSchema } from '../../../../lib/types.js'

import {
  getProfile,
  XanoApi,
} from '../../../../lib/api.js'
import { detectType, extractName } from '../../../../lib/detector.js'
import {
  findProjectRoot,
  isInitialized,
  loadLocalConfig,
} from '../../../../lib/project.js'

export default class SchemaDescribeColumns extends Command {
  static args = {
    table: Args.string({
      description: 'Table name, ID, or file path',
      required: true,
    }),
  }
  static description = 'Show column schema for a table'
  static examples = [
    '<%= config.bin %> schema describe columns users',
    '<%= config.bin %> schema describe columns 271',
    '<%= config.bin %> schema describe columns tables/users.xs',
    '<%= config.bin %> schema describe columns users --json',
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
    const { args, flags } = await this.parse(SchemaDescribeColumns)

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

    const api = new XanoApi(profile, config.workspaceId, config.branch)

    // Determine if input is a file path or table reference
    const isFilePath = args.table.includes('/') || args.table.endsWith('.xs')
    let tableId: null | number = null
    let tableName: string

    if (isFilePath) {
      const filePath = isAbsolute(args.table)
        ? args.table
        : resolve(args.table)

      if (!existsSync(filePath)) {
        this.error(`File not found: ${args.table}`)
      }

      const xanoscript = readFileSync(filePath, 'utf8')
      const type = detectType(xanoscript)

      if (type !== 'table') {
        this.error(`File is not a table definition (detected type: ${type || 'unknown'})`)
      }

      tableName = extractName(xanoscript) || args.table
      tableId = await this.resolveTableId(api, tableName)
      if (!tableId) {
        this.error(`Table '${tableName}' not found on remote. Push the table first.`)
      }
    } else {
      tableId = await this.resolveTableId(api, args.table)
      if (!tableId) {
        this.error(`Table not found: ${args.table}`)
      }

      const tableResponse = await api.getTable(tableId)
      if (!tableResponse.ok || !tableResponse.data) {
        this.error(`Failed to fetch table: ${tableResponse.error}`)
      }

      tableName = tableResponse.data.name
    }

    // Fetch schema from API
    const schemaResponse = await api.getTableSchema(tableId)
    if (!schemaResponse.ok) {
      this.error(`Failed to fetch schema: ${schemaResponse.error}`)
    }

    const schema = schemaResponse.data || []

    if (schema.length === 0) {
      this.log(`No columns found in table '${tableName}'`)
      return
    }

    if (flags.json) {
      this.log(JSON.stringify({ columns: schema, table: tableName }, null, 2))
      return
    }

    // Pretty print columns
    this.log(`Table: ${tableName}`)
    this.log('')

    // Calculate column widths
    const allColumns = this.flattenColumns(schema)
    const nameWidth = Math.max(6, ...allColumns.map(c => c.displayName.length))
    const typeWidth = Math.max(4, ...allColumns.map(c => this.formatType(c.column).length))

    // Print header
    this.log(`${'Column'.padEnd(nameWidth)}  ${'Type'.padEnd(typeWidth)}  Info`)
    this.log(`${'-'.repeat(nameWidth)}  ${'-'.repeat(typeWidth)}  ${'-'.repeat(50)}`)

    // Print columns
    this.printColumns(schema, nameWidth, typeWidth, 0)

    this.log('')
    this.log(`Total: ${schema.length} columns`)
  }

  private flattenColumns(
    columns: XanoTableSchema[],
    prefix = ''
  ): Array<{ column: XanoTableSchema; displayName: string }> {
    const result: Array<{ column: XanoTableSchema; displayName: string }> = []

    for (const col of columns) {
      const displayName = prefix ? `${prefix}.${col.name}` : col.name
      result.push({ column: col, displayName })

      if (col.children && col.children.length > 0) {
        result.push(...this.flattenColumns(col.children, displayName))
      }
    }

    return result
  }

  private formatInfo(col: XanoTableSchema): string {
    const parts: string[] = []

    if (col.required && !col.nullable) {
      parts.push('required')
    } else if (col.nullable) {
      parts.push('nullable')
    }

    if (col.default !== undefined && col.default !== '') {
      parts.push(`default: ${col.default}`)
    }

    if (col.description) {
      parts.push(col.description)
    }

    if (col.tableref_id) {
      parts.push(`FK -> table:${col.tableref_id}`)
    }

    if (col.values && col.values.length > 0) {
      const vals = col.values.map(v => v.value).join(', ')
      parts.push(`[${vals}]`)
    }

    if (col.vector?.size) {
      parts.push(`size: ${col.vector.size}`)
    }

    if (col.access && col.access !== 'public') {
      parts.push(col.access)
    }

    if (col.sensitive) {
      parts.push('sensitive')
    }

    if (col.style === 'list') {
      parts.push('list')
    }

    if (col.validators) {
      if (col.validators.trim) parts.push('trim')
      if (col.validators.lower) parts.push('lowercase')
    }

    return parts.join(', ')
  }

  private formatType(col: XanoTableSchema): string {
    let typeStr = col.type
    if (col.nullable) {
      typeStr += '?'
    }

    return typeStr
  }

  private printColumns(
    columns: XanoTableSchema[],
    nameWidth: number,
    typeWidth: number,
    indent: number
  ): void {
    for (const col of columns) {
      const indentStr = '  '.repeat(indent)
      const displayName = `${indentStr}${col.name}`
      const typeStr = this.formatType(col)
      const info = this.formatInfo(col)

      this.log(`${displayName.padEnd(nameWidth)}  ${typeStr.padEnd(typeWidth)}  ${info}`)

      if (col.children && col.children.length > 0) {
        this.printColumns(col.children, nameWidth, typeWidth, indent + 1)
      }
    }
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
}
