import { Command, Flags } from '@oclif/core'
import * as fs from 'node:fs'
import * as path from 'node:path'

import type {
  XanoLocalConfig,
  XanoObjectsFile,
  XanoObjectType,
  XanoStateFile,
} from '../../lib/types.js'

import {
  getProfile,
  XanoApi,
} from '../../lib/api.js'
import {
  generateFilePath,
  generateKey,
} from '../../lib/detector.js'
import {
  computeSha256,
  encodeBase64,
  extractXanoscript,
  loadObjects,
  saveObjects,
  upsertObject,
} from '../../lib/objects.js'
import {
  findProjectRoot,
  isInitialized,
  loadLocalConfig,
} from '../../lib/project.js'
import {
  loadState,
  saveState,
  setStateEntry,
} from '../../lib/state.js'

interface FetchedObject {
  apigroup_id?: number
  apigroup_name?: string
  id: number
  name: string
  path?: string
  type: XanoObjectType
  verb?: string
  xanoscript: string
}

export default class Sync extends Command {
  static description = 'Sync local state with Xano - fetch all objects and update mappings'
static examples = [
    '<%= config.bin %> sync',
    '<%= config.bin %> sync --pull',
    '<%= config.bin %> sync --pull --clean',
  ]
static flags = {
    clean: Flags.boolean({
      default: false,
      description: 'Delete local files not on Xano (use with --pull)',
    }),
    profile: Flags.string({
      char: 'p',
      description: 'Profile to use',
      env: 'XANO_PROFILE',
    }),
    pull: Flags.boolean({
      default: false,
      description: 'Also write files locally (pull from Xano)',
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(Sync)

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

    this.log(`Syncing with Xano...`)
    this.log(`  Workspace: ${config.workspaceName}`)
    this.log(`  Branch: ${config.branch}`)
    this.log('')

    const api = new XanoApi(profile, config.workspaceId, config.branch)

    // Fetch all objects
    const allObjects: FetchedObject[] = []

    // Fetch API groups first for endpoint grouping
    const apiGroups = new Map<number, string>()
    this.log('Fetching API groups...')
    const groupsResponse = await api.listApiGroups(1, 1000)
    if (groupsResponse.ok && groupsResponse.data?.items) {
      for (const group of groupsResponse.data.items) {
        apiGroups.set(group.id, group.name)
      }

      this.log(`  Found ${apiGroups.size} API groups`)
    }

    // Fetch functions
    this.log('Fetching functions...')
    const functionsResponse = await api.listFunctions(1, 1000)
    if (functionsResponse.ok && functionsResponse.data?.items) {
      for (const fn of functionsResponse.data.items) {
        const xs = extractXanoscript(fn.xanoscript)
        if (xs) {
          allObjects.push({
            id: fn.id,
            name: fn.name,
            type: 'function',
            xanoscript: xs,
          })
        }
      }

      this.log(`  Found ${functionsResponse.data.items.length} functions`)
    }

    // Fetch API endpoints
    this.log('Fetching API endpoints...')
    const apisResponse = await api.listApiEndpoints(1, 1000)
    if (apisResponse.ok && apisResponse.data?.items) {
      for (const endpoint of apisResponse.data.items) {
        const xs = extractXanoscript(endpoint.xanoscript)
        if (xs) {
          allObjects.push({
            apigroup_id: endpoint.apigroup_id,
            apigroup_name: apiGroups.get(endpoint.apigroup_id),
            id: endpoint.id,
            name: endpoint.name,
            path: endpoint.name,
            type: 'api_endpoint',
            verb: endpoint.verb,
            xanoscript: xs,
          })
        }
      }

      this.log(`  Found ${apisResponse.data.items.length} API endpoints`)
    }

    // Fetch tables
    this.log('Fetching tables...')
    const tablesResponse = await api.listTables(1, 1000)
    if (tablesResponse.ok && tablesResponse.data?.items) {
      for (const table of tablesResponse.data.items) {
        const xs = extractXanoscript(table.xanoscript)
        if (xs) {
          allObjects.push({
            id: table.id,
            name: table.name,
            type: 'table',
            xanoscript: xs,
          })
        }
      }

      this.log(`  Found ${tablesResponse.data.items.length} tables`)
    }

    // Fetch tasks
    this.log('Fetching tasks...')
    const tasksResponse = await api.listTasks(1, 1000)
    if (tasksResponse.ok && tasksResponse.data?.items) {
      for (const task of tasksResponse.data.items) {
        const xs = extractXanoscript(task.xanoscript)
        if (xs) {
          allObjects.push({
            id: task.id,
            name: task.name,
            type: 'task',
            xanoscript: xs,
          })
        }
      }

      this.log(`  Found ${tasksResponse.data.items.length} tasks`)
    }

    this.log('')
    this.log(`Total: ${allObjects.length} objects with XanoScript`)

    // Build objects.json and state.json
    let objects: XanoObjectsFile = []
    let state: XanoStateFile = {}

    // Track existing local files for cleanup
    const existingLocalFiles = new Set<string>()
    if (flags.pull) {
      this.collectExistingFiles(projectRoot, config, existingLocalFiles)
    }

    const syncedFiles = new Set<string>()

    for (const obj of allObjects) {
      const filePath = this.generateObjectPath(obj, config)
      const fullPath = path.join(projectRoot, filePath)
      const key = generateKey(obj.xanoscript) || `${obj.type}:${obj.name}`

      syncedFiles.add(filePath)

      // Update objects.json
      objects = upsertObject(objects, filePath, {
        id: obj.id,
        original: encodeBase64(obj.xanoscript),
        sha256: computeSha256(obj.xanoscript),
        staged: false,
        status: 'unchanged',
        type: obj.type,
      })

      // Update state.json
      state = setStateEntry(state, filePath, {
        etag: undefined, // Will be set on individual fetch
        key,
      })

      // Write file if --pull
      if (flags.pull) {
        const dir = path.dirname(fullPath)
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }

        fs.writeFileSync(fullPath, obj.xanoscript, 'utf-8')
      }
    }

    // Clean up files not on Xano
    if (flags.pull && flags.clean) {
      let deletedCount = 0
      for (const existingFile of existingLocalFiles) {
        if (!syncedFiles.has(existingFile)) {
          const fullPath = path.join(projectRoot, existingFile)
          if (fs.existsSync(fullPath)) {
            fs.unlinkSync(fullPath)
            deletedCount++
          }
        }
      }

      if (deletedCount > 0) {
        this.log(`\nDeleted ${deletedCount} local files not on Xano`)
      }
    }

    // Save files
    saveObjects(projectRoot, objects)
    saveState(projectRoot, state)

    this.log('')
    this.log(`Saved .xano/objects.json (${objects.length} entries)`)
    this.log(`Saved .xano/state.json (${Object.keys(state).length} entries)`)

    if (flags.pull) {
      this.log(`\nPulled ${syncedFiles.size} files to local directory`)
    } else {
      this.log(`\nRun 'xano sync --pull' to also write files locally`)
    }
  }

  private collectExistingFiles(
    projectRoot: string,
    config: XanoLocalConfig,
    files: Set<string>
  ): void {
    const dirs = [
      config.paths.functions,
      config.paths.apis,
      config.paths.tables,
      config.paths.tasks,
    ]

    for (const dir of dirs) {
      const fullDir = path.join(projectRoot, dir)
      if (fs.existsSync(fullDir)) {
        this.walkDir(fullDir, projectRoot, files)
      }
    }
  }

  private generateObjectPath(obj: FetchedObject, config: XanoLocalConfig): string {
    switch (obj.type) {
      case 'api_endpoint': {
        const group = obj.apigroup_name || 'default'
        const verb = obj.verb?.toUpperCase() || 'GET'
        const pathName = this.sanitizePath(obj.path || obj.name)
        return `${config.paths.apis}/${this.sanitizeName(group)}/${obj.id}_${verb}_${pathName}.xs`
      }

      case 'function': {
        return `${config.paths.functions}/${obj.id}_${this.sanitizeName(obj.name)}.xs`
      }

      case 'table': {
        return `${config.paths.tables}/${obj.id}_${this.sanitizeName(obj.name)}.xs`
      }

      case 'task': {
        return `${config.paths.tasks}/${obj.id}_${this.sanitizeName(obj.name)}.xs`
      }

      default: {
        return `other/${obj.id}_${this.sanitizeName(obj.name)}.xs`
      }
    }
  }

  private sanitizeName(name: string | undefined): string {
    if (!name) return 'unnamed'
    return name.replaceAll(/[^a-zA-Z0-9_-]/g, '_')
  }

  private sanitizePath(apiPath: string | undefined): string {
    if (!apiPath) return 'unnamed'
    return apiPath
      .replace(/^\//, '')
      .replaceAll('/', '_')
      .replaceAll(/[{}]/g, '')
      .replaceAll(/[^a-zA-Z0-9_-]/g, '_')
  }

  private walkDir(dir: string, projectRoot: string, files: Set<string>): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        this.walkDir(fullPath, projectRoot, files)
      } else if (entry.name.endsWith('.xs')) {
        const relativePath = path.relative(projectRoot, fullPath)
        files.add(relativePath)
      }
    }
  }
}
