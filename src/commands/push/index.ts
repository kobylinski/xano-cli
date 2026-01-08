import { Args, Command, Flags } from '@oclif/core'
import * as fs from 'node:fs'
import * as path from 'node:path'

import type {
  PathResolver,
  SanitizeFunction,
  TypeResolver,
  XanoObjectsFile,
  XanoObjectType,
  XanoPaths,
} from '../../lib/types.js'

import {
  getProfile,
  XanoApi,
} from '../../lib/api.js'
import { loadConfig } from '../../lib/config.js'
import { detectType } from '../../lib/detector.js'
import {
  computeFileSha256,
  computeSha256,
  encodeBase64,
  findApiGroupForEndpoint,
  findObjectByPath,
  loadObjects,
  saveObjects,
  upsertObject,
} from '../../lib/objects.js'
import {
  findProjectRoot,
  getDefaultPaths,
  isInitialized,
  loadLocalConfig,
} from '../../lib/project.js'
import {
  resolveInputToTypes,
} from '../../lib/resolver.js'
import {
  fetchAllObjects,
  generateObjectPath,
  hasObjectsJson,
} from '../../lib/sync.js'

export default class Push extends Command {
  static args = {
    paths: Args.string({
      description: 'Files or directories to push (space-separated)',
      required: false,
    }),
  }
  static description = 'Push local XanoScript files to Xano'
  static examples = [
    '<%= config.bin %> push',
    '<%= config.bin %> push functions/',
    '<%= config.bin %> push functions/my_function.xs apis/',
    '<%= config.bin %> push --sync',
    '<%= config.bin %> push --clean',
  ]
  static flags = {
    clean: Flags.boolean({
      default: false,
      description: 'Delete objects from Xano that do not exist locally',
    }),
    force: Flags.boolean({
      char: 'f',
      default: false,
      description: 'Force push without confirmation',
    }),
    profile: Flags.string({
      char: 'p',
      description: 'Profile to use',
      env: 'XANO_PROFILE',
    }),
    sync: Flags.boolean({
      default: false,
      description: 'Force fresh metadata fetch from Xano',
    }),
  }
  static strict = false // Allow multiple path arguments

  private customResolver?: PathResolver
  private customResolveType?: TypeResolver
  private customSanitize?: SanitizeFunction
  private paths!: XanoPaths

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(Push)
    const inputPaths = argv as string[]

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

    // Load dynamic config (xano.js) if available
    const dynamicConfig = await loadConfig(projectRoot)
    if (dynamicConfig) {
      this.customResolver = dynamicConfig.resolvePath
      this.customResolveType = dynamicConfig.resolveType
      this.customSanitize = dynamicConfig.sanitize
      this.paths = { ...getDefaultPaths(), ...dynamicConfig.config.paths }
    } else {
      this.paths = { ...getDefaultPaths(), ...config.paths }
    }

    const profile = getProfile(flags.profile)
    if (!profile) {
      this.error('No profile found. Run "xano profile:wizard" to create one.')
    }

    const api = new XanoApi(profile, config.workspaceId, config.branch)

    // Check if sync is needed (missing objects.json or --sync flag)
    const needsSync = flags.sync || !hasObjectsJson(projectRoot)

    let objects = loadObjects(projectRoot)

    if (needsSync) {
      this.log('Syncing metadata from Xano...')
      const fetchedObjects = await fetchAllObjects(api, (msg) => this.log(msg))
      this.log('')

      // Update objects.json with fetched data
      objects = []
      for (const obj of fetchedObjects) {
        const filePath = generateObjectPath(obj, this.paths, this.customSanitize, this.customResolver)
        objects = upsertObject(objects, filePath, {
          id: obj.id,
          original: encodeBase64(obj.xanoscript),
          sha256: computeSha256(obj.xanoscript),
          status: 'unchanged',
          type: obj.type,
        })
      }
      saveObjects(projectRoot, objects)
    }

    // Determine which files to push
    let filesToPush: string[]

    if (inputPaths.length === 0) {
      // Push all modified files
      filesToPush = this.getAllChangedFiles(projectRoot, objects)
    } else {
      // Smart path detection: expand directories, find modified files
      filesToPush = this.expandPaths(projectRoot, inputPaths, objects)
    }

    // Find orphan objects (in objects.json but deleted locally)
    const orphanObjects = this.findOrphanObjects(projectRoot, objects)

    if (filesToPush.length === 0 && orphanObjects.length === 0) {
      this.log('No changes to push.')
      return
    }

    this.log(`Workspace: ${config.workspaceName}`)
    this.log(`Branch: ${config.branch}`)
    this.log('')

    if (filesToPush.length > 0) {
      this.log(`Pushing ${filesToPush.length} file(s) to Xano...`)
    }

    let successCount = 0
    let errorCount = 0

    for (const file of filesToPush) {
      const result = await this.pushFile(projectRoot, file, api, objects)

      if (result.success) {
        objects = result.objects
        successCount++
        this.log(`  ✓ ${file}`)
      } else {
        errorCount++
        this.log(`  ✗ ${file}: ${result.error}`)
      }
    }

    // Delete orphan objects from Xano if --clean
    let deletedCount = 0
    if (flags.clean && orphanObjects.length > 0) {
      this.log('')
      this.log(`Deleting ${orphanObjects.length} orphan object(s) from Xano...`)

      for (const obj of orphanObjects) {
        const response = await api.deleteObject(obj.type, obj.id)
        if (response.ok) {
          // Remove from objects.json
          objects = objects.filter((o) => o.path !== obj.path)
          deletedCount++
          this.log(`  ✓ Deleted ${obj.path}`)
        } else {
          this.log(`  ✗ Failed to delete ${obj.path}: ${response.error}`)
        }
      }
    } else if (orphanObjects.length > 0) {
      this.log('')
      this.log(`${orphanObjects.length} local file(s) deleted (use --clean to remove from Xano):`)
      for (const obj of orphanObjects.slice(0, 5)) {
        this.log(`  ${obj.path}`)
      }
      if (orphanObjects.length > 5) {
        this.log(`  ... and ${orphanObjects.length - 5} more`)
      }
    }

    // Save updated objects.json
    saveObjects(projectRoot, objects)

    this.log('')
    this.log(`Pushed: ${successCount}, Errors: ${errorCount}${deletedCount > 0 ? `, Deleted: ${deletedCount}` : ''}`)
  }

  /**
   * Find all modified or new files
   */
  private getAllChangedFiles(projectRoot: string, objects: XanoObjectsFile): string[] {
    const changedFiles: string[] = []

    // Check existing objects for modifications
    for (const obj of objects) {
      const fullPath = path.join(projectRoot, obj.path)
      if (fs.existsSync(fullPath)) {
        const currentSha256 = computeFileSha256(fullPath)
        if (currentSha256 !== obj.sha256) {
          changedFiles.push(obj.path)
        }
      }
    }

    // Find new files
    const knownPaths = new Set(objects.map((o) => o.path))
    const dirs = [
      this.paths.functions,
      this.paths.apis,
      this.paths.tables,
      this.paths.tableTriggers,
      this.paths.tasks,
      this.paths.workflowTests,
      this.paths.addOns,
      this.paths.middlewares,
    ].filter((d): d is string => d !== undefined)

    for (const dir of dirs) {
      const fullDir = path.join(projectRoot, dir)
      if (fs.existsSync(fullDir)) {
        this.walkDir(fullDir, projectRoot, knownPaths, changedFiles)
      }
    }

    return changedFiles
  }

  /**
   * Expand input paths to actual file paths
   * Uses type-based filtering when input matches a known type mapping,
   * falls back to path prefix matching otherwise
   */
  private expandPaths(
    projectRoot: string,
    inputPaths: string[],
    objects: XanoObjectsFile
  ): string[] {
    const result: string[] = []
    const objectPaths = new Set(objects.map((o) => o.path))

    for (const inputPath of inputPaths) {
      let normalizedPath = inputPath
      if (path.isAbsolute(inputPath)) {
        normalizedPath = path.relative(projectRoot, inputPath)
      }

      // Remove trailing slash for type resolution
      const cleanPath = normalizedPath.replace(/\/$/, '')

      // Try type-based filtering first
      const types = resolveInputToTypes(
        cleanPath,
        this.paths,
        this.customResolveType
      )

      if (types && types.length > 0) {
        // Filter by type - find modified tracked files and new files of matching types
        for (const obj of objects) {
          if (types.includes(obj.type)) {
            const objFullPath = path.join(projectRoot, obj.path)
            if (fs.existsSync(objFullPath)) {
              const currentSha256 = computeFileSha256(objFullPath)
              if (currentSha256 !== obj.sha256) {
                result.push(obj.path)
              }
            }
          }
        }

        // Also find new files in directories for these types
        for (const type of types) {
          const typeDir = this.getDirectoryForType(type)
          if (typeDir) {
            const fullDir = path.join(projectRoot, typeDir)
            if (fs.existsSync(fullDir)) {
              this.walkDir(fullDir, projectRoot, objectPaths, result)
            }
          }
        }
      } else {
        // Fallback to path prefix matching
        const fullPath = path.join(projectRoot, normalizedPath)
        const isDir = normalizedPath.endsWith('/') ||
          (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory())

        if (isDir) {
          // Find all files under this directory (both tracked and new)
          const dirPrefix = normalizedPath.endsWith('/') ? normalizedPath : `${normalizedPath}/`

          // Add tracked files that are modified
          for (const obj of objects) {
            if (obj.path.startsWith(dirPrefix) || obj.path.startsWith(normalizedPath + path.sep)) {
              const objFullPath = path.join(projectRoot, obj.path)
              if (fs.existsSync(objFullPath)) {
                const currentSha256 = computeFileSha256(objFullPath)
                if (currentSha256 !== obj.sha256) {
                  result.push(obj.path)
                }
              }
            }
          }

          // Add new files in directory
          if (fs.existsSync(fullPath)) {
            this.walkDir(fullPath, projectRoot, objectPaths, result)
          }
        } else if (fs.existsSync(fullPath)) {
          // Single file - add if it exists
          result.push(normalizedPath)
        }
      }
    }

    return [...new Set(result)]
  }

  /**
   * Get the configured directory for a given type
   */
  private getDirectoryForType(type: string): string | undefined {
    switch (type) {
      case 'function': return this.paths.functions
      case 'api_endpoint':
      case 'api_group': return this.paths.apis
      case 'table': return this.paths.tables
      case 'table_trigger': return this.paths.tableTriggers || this.paths.tables
      case 'task': return this.paths.tasks
      case 'workflow_test': return this.paths.workflowTests
      case 'addon': return this.paths.addOns
      case 'middleware': return this.paths.middlewares
      default: return undefined
    }
  }

  /**
   * Find objects in objects.json whose local files have been deleted
   */
  private findOrphanObjects(projectRoot: string, objects: XanoObjectsFile): XanoObjectsFile {
    return objects.filter((obj) => {
      const fullPath = path.join(projectRoot, obj.path)
      return !fs.existsSync(fullPath)
    })
  }

  private async pushFile(
    projectRoot: string,
    filePath: string,
    api: XanoApi,
    objects: XanoObjectsFile
  ): Promise<{ error?: string; objects: XanoObjectsFile; success: boolean }> {
    const fullPath = path.join(projectRoot, filePath)

    if (!fs.existsSync(fullPath)) {
      return { error: 'File not found', objects, success: false }
    }

    const content = fs.readFileSync(fullPath, 'utf8')
    const existingObj = findObjectByPath(objects, filePath)
    let newId: number
    let objectType: XanoObjectType

    if (existingObj?.id) {
      // Update existing object - use stored type (authoritative)
      objectType = existingObj.type

      // For api_endpoint, look up the API group from the path hierarchy (VSCode compatible)
      const updateOptions: { apigroup_id?: number } = {}
      if (objectType === 'api_endpoint') {
        const apiGroup = findApiGroupForEndpoint(objects, filePath)
        if (apiGroup) {
          updateOptions.apigroup_id = apiGroup.id
        } else {
          return {
            error: `Cannot find API group for endpoint. Ensure the api_group.xs file exists in the parent directory. Run "xano pull --sync" to refresh.`,
            objects,
            success: false,
          }
        }
      }

      const response = await api.updateObject(objectType, existingObj.id, content, updateOptions)

      if (!response.ok) {
        // Provide helpful error message for common issues
        if (response.error?.includes('Unable to locate')) {
          return {
            error: `${response.error} (ID: ${existingObj.id}, type: ${objectType}). The object may have been deleted from Xano. Run "xano pull --sync" to refresh mappings.`,
            objects,
            success: false,
          }
        }

        if (response.error?.includes('apigroup_id is required')) {
          return {
            error: `${response.error} (path: ${filePath})`,
            objects,
            success: false,
          }
        }

        return { error: response.error || 'Update failed', objects, success: false }
      }

      newId = existingObj.id
    } else {
      // Create new object - detect type from content
      const detectedType = detectType(content)

      if (!detectedType) {
        return { error: 'Cannot detect XanoScript type from content. Ensure file starts with a valid keyword (function, query, table, task, addon, middleware, etc.)', objects, success: false }
      }

      objectType = detectedType
      const response = await api.createObject(objectType, content)

      if (!response.ok) {
        if (response.status === 409 || response.error?.includes('already exists')) {
          return {
            error: 'Object already exists on Xano. Run "xano pull --sync" to update mappings.',
            objects,
            success: false,
          }
        }

        return { error: response.error || 'Create failed', objects, success: false }
      }

      if (!response.data?.id) {
        return { error: 'No ID returned from API', objects, success: false }
      }

      newId = response.data.id
    }

    // Update objects.json
    objects = upsertObject(objects, filePath, {
      id: newId,
      original: encodeBase64(content),
      sha256: computeSha256(content),
      status: 'unchanged',
      type: objectType,
    })

    return { objects, success: true }
  }

  private walkDir(
    dir: string,
    projectRoot: string,
    knownPaths: Set<string>,
    newFiles: string[]
  ): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        this.walkDir(fullPath, projectRoot, knownPaths, newFiles)
      } else if (entry.name.endsWith('.xs')) {
        const relativePath = path.relative(projectRoot, fullPath)
        if (!knownPaths.has(relativePath)) {
          newFiles.push(relativePath)
        }
      }
    }
  }
}
