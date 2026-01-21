import { Args, Command, Flags } from '@oclif/core'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

import type { XanoTableSchema } from '../../../../lib/types.js'

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

export default class SchemaMoveColumn extends Command {
  /* eslint-disable perfectionist/sort-objects -- positional arg order matters in oclif */
  static args = {
    table: Args.string({
      description: 'Table name, ID, or file path',
      required: true,
    }),
    column: Args.string({
      description: 'Column name to move',
      required: true,
    }),
  }
  /* eslint-enable perfectionist/sort-objects */
  static description = 'Move a column to a different position in the table schema'
  static examples = [
    '<%= config.bin %> schema move column users email --after name',
    '<%= config.bin %> schema move column users created_at --before updated_at',
    '<%= config.bin %> schema move column users status --first',
    '<%= config.bin %> schema move column users notes --last',
  ]
  static flags = {
    after: Flags.string({
      description: 'Move column after this column',
      exclusive: ['before', 'first', 'last'],
    }),
    before: Flags.string({
      description: 'Move column before this column',
      exclusive: ['after', 'first', 'last'],
    }),
    first: Flags.boolean({
      default: false,
      description: 'Move column to the first position (after id)',
      exclusive: ['after', 'before', 'last'],
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    last: Flags.boolean({
      default: false,
      description: 'Move column to the last position',
      exclusive: ['after', 'before', 'first'],
    }),
    'no-sync': Flags.boolean({
      default: false,
      description: 'Skip syncing XanoScript after moving',
    }),
    profile: Flags.string({
      description: 'Profile to use',
      env: 'XANO_PROFILE',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SchemaMoveColumn)

    // Validate that at least one position flag is provided
    if (!flags.after && !flags.before && !flags.first && !flags.last) {
      this.error('Must specify position: --after <column>, --before <column>, --first, or --last')
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

    const profile = getProfile(flags.profile, localConfig.profile)
    if (!profile) {
      this.error('No profile found. Run "xano init" first.')
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

    // Find the column to move
    const columnIndex = currentSchema.findIndex(
      c => c.name.toLowerCase() === args.column.toLowerCase()
    )
    if (columnIndex === -1) {
      this.error(`Column '${args.column}' not found in table '${tableName}'`)
    }

    // Cannot move the id column
    if (currentSchema[columnIndex].name === 'id') {
      this.error('Cannot move the primary key column \'id\'')
    }

    const columnToMove = currentSchema[columnIndex]

    // Remove column from current position
    const schemaWithoutColumn = currentSchema.filter((_, i) => i !== columnIndex)

    // Determine new position and insert
    let newSchema: XanoTableSchema[]
    let positionDescription: string

    if (flags.after) {
      const refIndex = schemaWithoutColumn.findIndex(
        c => c.name.toLowerCase() === flags.after!.toLowerCase()
      )
      if (refIndex === -1) {
        this.error(`Column '${flags.after}' not found in table '${tableName}'`)
      }

      newSchema = [
        ...schemaWithoutColumn.slice(0, refIndex + 1),
        columnToMove,
        ...schemaWithoutColumn.slice(refIndex + 1),
      ]
      positionDescription = `after '${flags.after}'`
    } else if (flags.before) {
      const refIndex = schemaWithoutColumn.findIndex(
        c => c.name.toLowerCase() === flags.before!.toLowerCase()
      )
      if (refIndex === -1) {
        this.error(`Column '${flags.before}' not found in table '${tableName}'`)
      }

      newSchema = [
        ...schemaWithoutColumn.slice(0, refIndex),
        columnToMove,
        ...schemaWithoutColumn.slice(refIndex),
      ]
      positionDescription = `before '${flags.before}'`
    } else if (flags.first) {
      // Insert after 'id' column if it exists, otherwise at position 0
      const idIndex = schemaWithoutColumn.findIndex(c => c.name === 'id')
      if (idIndex === -1) {
        newSchema = [columnToMove, ...schemaWithoutColumn]
        positionDescription = 'to first position'
      } else {
        newSchema = [
          ...schemaWithoutColumn.slice(0, idIndex + 1),
          columnToMove,
          ...schemaWithoutColumn.slice(idIndex + 1),
        ]
        positionDescription = 'to first position (after id)'
      }
    } else {
      // --last
      newSchema = [...schemaWithoutColumn, columnToMove]
      positionDescription = 'to last position'
    }

    const response = await api.replaceTableSchema(tableId, newSchema)

    if (!response.ok) {
      this.error(`Failed to move column '${args.column}':\n  ${response.error}`)
    }

    if (flags.json) {
      this.log(JSON.stringify({
        column: args.column,
        position: positionDescription,
        success: true,
        table: tableName,
      }, null, 2))
    } else {
      this.log(`Moved column '${args.column}' ${positionDescription} in table '${tableName}'`)
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
