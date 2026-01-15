import { Args, Command, Flags } from '@oclif/core'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

import type { XanoColumnType, XanoTableSchema } from '../../../../lib/types.js'

import {
  getProfile,
  XanoApi,
} from '../../../../lib/api.js'
import { loadConfig } from '../../../../lib/config.js'
import { detectType, extractName } from '../../../../lib/detector.js'
import {
  computeSha256,
  encodeBase64,
  loadObjects,
  saveObjects,
} from '../../../../lib/objects.js'
import {
  findProjectRoot,
  getDefaultPaths,
  isInitialized,
  loadLocalConfig,
} from '../../../../lib/project.js'
import { generateObjectPath } from '../../../../lib/sync.js'

const VALID_TYPES: XanoColumnType[] = [
  'attachment', 'audio', 'bool', 'date', 'decimal', 'email', 'enum',
  'geo_linestring', 'geo_multilinestring', 'geo_multipoint', 'geo_multipolygon',
  'geo_point', 'geo_polygon', 'image', 'int', 'json', 'object', 'password',
  'text', 'timestamp', 'uuid', 'vector', 'video',
]

export default class SchemaAddColumn extends Command {
  /* eslint-disable perfectionist/sort-objects -- positional arg order matters in oclif */
  static args = {
    table: Args.string({
      description: 'Table name, ID, or file path',
      required: true,
    }),
    column: Args.string({
      description: 'New column name',
      required: true,
    }),
  }
  /* eslint-enable perfectionist/sort-objects */
  static description = 'Add a column to a table schema'
  static examples = [
    '<%= config.bin %> schema add column users bio --type text',
    '<%= config.bin %> schema add column users age --type int --default 0',
    '<%= config.bin %> schema add column users status --type enum --values "active,inactive,pending"',
    '<%= config.bin %> schema add column users notes --type text --nullable',
    '<%= config.bin %> schema add column users email --type email --after name',
    '<%= config.bin %> schema add column users created_at --type timestamp --before id',
  ]
  static flags = {
    after: Flags.string({
      description: 'Insert column after this column',
      exclusive: ['before'],
    }),
    before: Flags.string({
      description: 'Insert column before this column',
      exclusive: ['after'],
    }),
    default: Flags.string({
      char: 'd',
      description: 'Default value for the column',
    }),
    description: Flags.string({
      description: 'Column description',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    'no-sync': Flags.boolean({
      default: false,
      description: 'Skip syncing XanoScript after adding',
    }),
    nullable: Flags.boolean({
      default: false,
      description: 'Allow null values',
    }),
    profile: Flags.string({
      description: 'Profile to use',
      env: 'XANO_PROFILE',
    }),
    required: Flags.boolean({
      default: true,
      description: 'Make column required (default: true)',
    }),
    sensitive: Flags.boolean({
      default: false,
      description: 'Mark column as sensitive',
    }),
    type: Flags.string({
      char: 't',
      description: 'Column type (text, int, bool, timestamp, json, enum, etc.)',
      required: true,
    }),
    values: Flags.string({
      description: 'Comma-separated enum values (required for enum type)',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SchemaAddColumn)

    const columnType = flags.type.toLowerCase() as XanoColumnType
    if (!VALID_TYPES.includes(columnType)) {
      this.error(`Invalid column type: ${flags.type}\nValid types: ${VALID_TYPES.join(', ')}`)
    }

    if (columnType === 'enum' && !flags.values) {
      this.error('Enum type requires --values flag with comma-separated values')
    }

    const projectRoot = findProjectRoot()
    if (!projectRoot) {
      this.error('Not in a xano project. Run "xano init" first.')
    }

    if (!isInitialized(projectRoot)) {
      this.error('Project not initialized. Run "xano init" first.')
    }

    const localConfig = loadLocalConfig(projectRoot)
    if (!localConfig) {
      this.error('Failed to load .xano/config.json')
    }

    const profile = getProfile(flags.profile)
    if (!profile) {
      this.error('No profile found. Run "xano profile:wizard" to create one.')
    }

    const api = new XanoApi(profile, localConfig.workspaceId, localConfig.branch)

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

    const schemaResponse = await api.getTableSchema(tableId)
    if (!schemaResponse.ok || !schemaResponse.data) {
      this.error(`Failed to fetch schema: ${schemaResponse.error}`)
    }

    const currentSchema = schemaResponse.data

    const existingColumn = currentSchema.find(
      c => c.name.toLowerCase() === args.column.toLowerCase()
    )
    if (existingColumn) {
      this.error(`Column '${args.column}' already exists in table '${tableName}'`)
    }

    const newColumn: XanoTableSchema = {
      access: 'public',
      default: flags.default || '',
      description: flags.description || '',
      name: args.column,
      nullable: flags.nullable,
      required: flags.required && !flags.nullable,
      sensitive: flags.sensitive,
      style: 'single',
      type: columnType,
    }

    if (flags.values && columnType === 'enum') {
      newColumn.values = flags.values.split(',').map(v => ({
        value: v.trim(),
      }))
    }

    // Determine insertion position
    let newSchema: XanoTableSchema[]

    if (flags.after) {
      const refIndex = currentSchema.findIndex(
        c => c.name.toLowerCase() === flags.after!.toLowerCase()
      )
      if (refIndex === -1) {
        this.error(`Column '${flags.after}' not found in table '${tableName}'`)
      }

      newSchema = [
        ...currentSchema.slice(0, refIndex + 1),
        newColumn,
        ...currentSchema.slice(refIndex + 1),
      ]
    } else if (flags.before) {
      const refIndex = currentSchema.findIndex(
        c => c.name.toLowerCase() === flags.before!.toLowerCase()
      )
      if (refIndex === -1) {
        this.error(`Column '${flags.before}' not found in table '${tableName}'`)
      }

      newSchema = [
        ...currentSchema.slice(0, refIndex),
        newColumn,
        ...currentSchema.slice(refIndex),
      ]
    } else {
      newSchema = [...currentSchema, newColumn]
    }

    const response = await api.replaceTableSchema(tableId, newSchema)

    if (!response.ok) {
      this.error(`Failed to add column '${args.column}':\n  ${response.error}`)
    }

    if (flags.json) {
      this.log(JSON.stringify({
        column: newColumn,
        success: true,
        table: tableName,
      }, null, 2))
    } else {
      this.log(`Added column '${args.column}' (${columnType}${flags.nullable ? '?' : ''}) to table '${tableName}'`)
    }

    if (!flags['no-sync']) {
      await this.syncTable(api, tableId, tableName, projectRoot, flags.json)
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

  private async syncTable(
    api: XanoApi,
    tableId: number,
    tableName: string,
    projectRoot: string,
    jsonOutput: boolean
  ): Promise<void> {
    const tableResponse = await api.getTable(tableId)
    if (!tableResponse.ok || !tableResponse.data) {
      this.warn(`Failed to sync table: ${tableResponse.error}`)
      return
    }

    const table = tableResponse.data
    const rawXanoscript = table.xanoscript
    if (!rawXanoscript) {
      this.warn('Table has no XanoScript to sync')
      return
    }

    const xanoscript = typeof rawXanoscript === 'object' && rawXanoscript !== null
      ? (rawXanoscript as { value?: string }).value || ''
      : rawXanoscript

    const loadedConfig = await loadConfig(projectRoot)
    const paths = loadedConfig?.config.paths || getDefaultPaths()
    const naming = loadedConfig?.config.naming || 'default'

    const tablePath = generateObjectPath(
      { id: tableId, name: tableName, type: 'table', xanoscript },
      paths,
      {
        customResolver: loadedConfig?.resolvePath,
        customSanitize: loadedConfig?.sanitize,
        naming,
      }
    )

    const fullPath = resolve(projectRoot, tablePath)
    const dir = dirname(fullPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    writeFileSync(fullPath, xanoscript, 'utf8')

    const objects = loadObjects(projectRoot)
    const sha256 = computeSha256(xanoscript)
    const existingIndex = objects.findIndex(o => o.id === tableId && o.type === 'table')

    const updatedObject = {
      id: tableId,
      original: encodeBase64(xanoscript),
      path: tablePath,
      sha256,
      staged: false,
      status: 'unchanged' as const,
      type: 'table' as const,
    }

    if (existingIndex === -1) {
      objects.push(updatedObject)
    } else {
      objects[existingIndex] = updatedObject
    }

    saveObjects(projectRoot, objects)

    if (!jsonOutput) {
      this.log(`Synced: ${tablePath}`)
    }
  }
}
