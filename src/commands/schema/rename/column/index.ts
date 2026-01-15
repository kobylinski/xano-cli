import { Args, Command, Flags } from '@oclif/core'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

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

export default class SchemaRenameColumn extends Command {
  /* eslint-disable perfectionist/sort-objects -- positional arg order matters in oclif */
  static args = {
    table: Args.string({
      description: 'Table name, ID, or file path',
      required: true,
    }),
    oldName: Args.string({
      description: 'Current column name',
      required: true,
    }),
    newName: Args.string({
      description: 'New column name',
      required: true,
    }),
  }
  /* eslint-enable perfectionist/sort-objects */
  static description = 'Rename a column in a table schema'
  static examples = [
    '<%= config.bin %> schema rename column users name full_name',
    '<%= config.bin %> schema rename column users old_email email',
    '<%= config.bin %> schema rename column 271 field1 field2',
    '<%= config.bin %> schema rename column users name full_name --no-sync',
  ]
  static flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    'no-sync': Flags.boolean({
      default: false,
      description: 'Skip syncing XanoScript after rename',
    }),
    profile: Flags.string({
      description: 'Profile to use',
      env: 'XANO_PROFILE',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SchemaRenameColumn)

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

    const response = await api.renameColumn(tableId, args.oldName, args.newName)

    if (!response.ok) {
      this.error(`Failed to rename column '${args.oldName}' to '${args.newName}':\n  ${response.error}`)
    }

    if (flags.json) {
      this.log(JSON.stringify({
        newName: args.newName,
        oldName: args.oldName,
        success: true,
        table: tableName,
      }, null, 2))
    } else {
      this.log(`Renamed column '${args.oldName}' → '${args.newName}' in table '${tableName}'`)
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
