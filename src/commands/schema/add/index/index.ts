import { Args, Command, Flags } from '@oclif/core'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, resolve } from 'node:path'

import type { XanoIndexType, XanoTableIndex } from '../../../../lib/types.js'

import {
  getMissingProfileError,
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
  loadCliConfig,
  loadEffectiveConfig,
} from '../../../../lib/project.js'
import { generateObjectPath } from '../../../../lib/sync.js'

const VALID_INDEX_TYPES: XanoIndexType[] = [
  'btree', 'fulltext', 'gin', 'gist', 'hash', 'unique',
]

export default class SchemaAddIndex extends Command {
  static args = {
    table: Args.string({
      description: 'Table name, ID, or file path',
      required: true,
    }),
  }
  static description = 'Add an index to a table'
  static examples = [
    '<%= config.bin %> schema add index users --type btree --fields email',
    '<%= config.bin %> schema add index users --type unique --fields "email,username"',
    '<%= config.bin %> schema add index users --type fulltext --fields "bio"',
    '<%= config.bin %> schema add index users --type gin --fields "metadata"',
  ]
  static flags = {
    fields: Flags.string({
      char: 'f',
      description: 'Comma-separated field names for the index',
      required: true,
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    'no-sync': Flags.boolean({
      default: false,
      description: 'Skip syncing XanoScript after adding',
    }),
    profile: Flags.string({
      description: 'Profile to use',
      env: 'XANO_PROFILE',
    }),
    type: Flags.string({
      char: 't',
      default: 'btree',
      description: 'Index type (btree, unique, fulltext, gin, gist, hash)',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(SchemaAddIndex)

    const indexType = flags.type.toLowerCase() as XanoIndexType
    if (!VALID_INDEX_TYPES.includes(indexType)) {
      this.error(`Invalid index type: ${flags.type}\nValid types: ${VALID_INDEX_TYPES.join(', ')}`)
    }

    const projectRoot = findProjectRoot()
    if (!projectRoot) {
      this.error('Not in a xano project. Run "xano init" first.')
    }

    if (!isInitialized(projectRoot)) {
      this.error('Project not initialized. Run "xano init" first.')
    }

    const localConfig = loadEffectiveConfig(projectRoot)
    if (!localConfig) {
      this.error('Failed to load .xano/config.json')
    }

    // Profile is ONLY read from .xano/cli.json - no flag overrides
    const cliConfig = loadCliConfig(projectRoot)
    const cliProfile = cliConfig?.profile

    const profileError = getMissingProfileError(cliProfile)
    if (profileError) {
      this.error(profileError.humanOutput)
    }

    const profile = getProfile(cliProfile)
    if (!profile) {
      this.error('Profile not found in credentials. Run "xano init" to configure.')
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

    // Parse fields
    const fieldNames = flags.fields.split(',').map(f => f.trim()).filter(Boolean)
    if (fieldNames.length === 0) {
      this.error('At least one field is required for the index')
    }

    // Verify fields exist in table schema
    const schemaResponse = await api.getTableSchema(tableId)
    if (!schemaResponse.ok || !schemaResponse.data) {
      this.error(`Failed to fetch schema: ${schemaResponse.error}`)
    }

    const columnNames = new Set(schemaResponse.data.map(c => c.name.toLowerCase()))
    for (const fieldName of fieldNames) {
      if (!columnNames.has(fieldName.toLowerCase())) {
        this.error(`Column '${fieldName}' not found in table '${tableName}'`)
      }
    }

    // Fetch current indexes to append to
    const indexResponse = await api.getTableIndexes(tableId)
    if (!indexResponse.ok) {
      this.error(`Failed to fetch indexes: ${indexResponse.error}`)
    }

    const currentIndexes = indexResponse.data || []

    // Build new index
    const newIndex: XanoTableIndex = {
      fields: fieldNames.map(name => ({ name })),
      type: indexType,
    }

    // Check for duplicate
    const fieldsKey = fieldNames.map(f => f.toLowerCase()).sort().join(',')
    const isDuplicate = currentIndexes.some(idx => {
      if (!idx.fields || idx.type !== indexType) return false
      const existingKey = idx.fields.map(f => f.name.toLowerCase()).sort().join(',')
      return existingKey === fieldsKey
    })

    if (isDuplicate) {
      this.error(`An index of type '${indexType}' on fields '${flags.fields}' already exists`)
    }

    // Append new index and replace all
    const newIndexes = [...currentIndexes, newIndex]

    // Debug output
    if (process.env.DEBUG) {
      this.log('Current indexes:')
      this.log(JSON.stringify(currentIndexes, null, 2))
      this.log('New indexes to send:')
      this.log(JSON.stringify(newIndexes, null, 2))
    }

    const response = await api.replaceTableIndexes(tableId, newIndexes)

    if (!response.ok) {
      this.error(`Failed to add index:\n  ${response.error}`)
    }

    if (flags.json) {
      this.log(JSON.stringify({
        fields: fieldNames,
        success: true,
        table: tableName,
        type: indexType,
      }, null, 2))
    } else {
      this.log(`Added ${indexType} index on (${fieldNames.join(', ')}) to table '${tableName}'`)
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
