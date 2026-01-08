import { Args, Command, Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

import type {
  PathResolver,
  SanitizeFunction,
  TypeResolver,
  XanoObjectsFile,
  XanoPaths,
} from '../../lib/types.js'

import {
  getProfile,
  XanoApi,
} from '../../lib/api.js'
import { loadConfig } from '../../lib/config.js'
import {
  computeSha256,
  encodeBase64,
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
  cleanLocalFiles,
  fetchAllObjects,
  type FetchedObject,
  generateObjectPath,
  hasObjectsJson,
} from '../../lib/sync.js'

export default class Pull extends Command {
  static args = {
    paths: Args.string({
      description: 'Files or directories to pull (space-separated)',
      required: false,
    }),
  }
  static description = 'Pull XanoScript files from Xano to local'
  static examples = [
    '<%= config.bin %> pull',
    '<%= config.bin %> pull functions/',
    '<%= config.bin %> pull functions/my_function.xs apis/',
    '<%= config.bin %> pull --sync',
    '<%= config.bin %> pull --clean',
  ]
  static flags = {
    clean: Flags.boolean({
      default: false,
      description: 'Delete local files not on Xano',
    }),
    force: Flags.boolean({
      char: 'f',
      default: false,
      description: 'Overwrite local changes without confirmation',
    }),
    merge: Flags.boolean({
      default: false,
      description: 'Attempt 3-way merge with local changes',
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
    const { argv, flags } = await this.parse(Pull)
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
    let fetchedObjects: FetchedObject[] | null = null

    if (needsSync) {
      this.log('Syncing metadata from Xano...')
      fetchedObjects = await fetchAllObjects(api, (msg) => this.log(msg))
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

    // Determine which files to pull
    let filesToPull: string[]

    if (inputPaths.length === 0) {
      // Pull all known objects
      filesToPull = objects.map((o) => o.path)
    } else {
      // Smart path detection: expand directories, normalize files
      filesToPull = this.expandPaths(projectRoot, inputPaths, objects)
    }

    if (filesToPull.length === 0) {
      this.log('No files to pull.')
      return
    }

    this.log(`Pulling ${filesToPull.length} file(s) from Xano...`)
    this.log(`  Workspace: ${config.workspaceName}`)
    this.log(`  Branch: ${config.branch}`)
    this.log('')

    let successCount = 0
    let errorCount = 0
    let skippedCount = 0

    // If we already fetched objects during sync, use them directly
    const fetchedByPath = new Map<string, FetchedObject>()
    if (fetchedObjects) {
      for (const obj of fetchedObjects) {
        const filePath = generateObjectPath(obj, this.paths, this.customSanitize, this.customResolver)
        fetchedByPath.set(filePath, obj)
      }
    }

    for (const file of filesToPull) {
      const obj = findObjectByPath(objects, file)

      if (!obj) {
        this.log(`  - ${file}: Not tracked`)
        skippedCount++
        continue
      }

      // Use already-fetched content if available, otherwise fetch individually
      const fetched = fetchedByPath.get(file)
      const result = fetched
        ? await this.pullFromFetched(projectRoot, file, fetched, objects, flags.force, flags.merge)
        : await this.pullFromApi(projectRoot, file, obj.id, obj.type, api, objects, flags.force, flags.merge)

      if (result.success) {
        objects = result.objects
        successCount++
        this.log(`  ✓ ${file}`)
      } else if (result.skipped) {
        skippedCount++
        this.log(`  - ${file}: ${result.error}`)
      } else {
        errorCount++
        this.log(`  ✗ ${file}: ${result.error}`)
      }
    }

    // Save updated objects.json
    saveObjects(projectRoot, objects)

    // Clean local files if requested
    if (flags.clean) {
      const keepFiles = new Set(objects.map((o) => o.path))
      const deletedCount = cleanLocalFiles(projectRoot, keepFiles, this.paths)
      if (deletedCount > 0) {
        this.log('')
        this.log(`Deleted ${deletedCount} local files not on Xano`)
      }
    }

    this.log('')
    this.log(`Pulled: ${successCount}, Skipped: ${skippedCount}, Errors: ${errorCount}`)
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

    for (const inputPath of inputPaths) {
      // Normalize path
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
        // Filter objects by resolved types
        for (const obj of objects) {
          if (types.includes(obj.type)) {
            result.push(obj.path)
          }
        }
      } else {
        // Fallback to path prefix matching
        const fullPath = path.join(projectRoot, normalizedPath)
        const isDir = normalizedPath.endsWith('/') ||
          (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory())

        if (isDir) {
          // Find all tracked files under this directory
          const dirPrefix = normalizedPath.endsWith('/') ? normalizedPath : `${normalizedPath}/`
          for (const obj of objects) {
            if (obj.path.startsWith(dirPrefix) || obj.path.startsWith(normalizedPath + path.sep)) {
              result.push(obj.path)
            }
          }
        } else {
          // Single file
          result.push(normalizedPath)
        }
      }
    }

    return [...new Set(result)] // Remove duplicates
  }

  private attemptMerge(
    projectRoot: string,
    filePath: string,
    localContent: string,
    serverContent: string,
    originalBase64: string
  ): { error?: string; hasConflicts: boolean; success: boolean } {
    try {
      const baseContent = Buffer.from(originalBase64, 'base64').toString('utf-8')
      const tmpDir = fs.mkdtempSync(path.join(projectRoot, '.xano-merge-'))
      const basePath = path.join(tmpDir, 'base.xs')
      const localPath = path.join(tmpDir, 'local.xs')
      const serverPath = path.join(tmpDir, 'server.xs')

      fs.writeFileSync(basePath, baseContent)
      fs.writeFileSync(localPath, localContent)
      fs.writeFileSync(serverPath, serverContent)

      try {
        execSync(`git merge-file -p "${localPath}" "${basePath}" "${serverPath}" > "${filePath}"`, {
          cwd: projectRoot,
          encoding: 'utf-8',
        })
        fs.rmSync(tmpDir, { recursive: true })
        return { hasConflicts: false, success: true }
      } catch (mergeError: any) {
        if (mergeError.status === 1) {
          const mergedContent = fs.readFileSync(localPath, 'utf8')
          fs.writeFileSync(filePath, mergedContent)
          fs.rmSync(tmpDir, { recursive: true })
          return { hasConflicts: true, success: true }
        }
        fs.rmSync(tmpDir, { recursive: true })
        return { error: 'Git merge-file failed', hasConflicts: false, success: false }
      }
    } catch (error: any) {
      return { error: error.message, hasConflicts: false, success: false }
    }
  }

  private async pullFromApi(
    projectRoot: string,
    filePath: string,
    id: number,
    type: string,
    api: XanoApi,
    objects: XanoObjectsFile,
    force: boolean,
    merge: boolean
  ): Promise<{ error?: string; objects: XanoObjectsFile; skipped?: boolean; success: boolean }> {
    const response = await api.getObject(type as any, id)

    if (!response.ok) {
      return {
        error: response.error || `HTTP ${response.status}`,
        objects,
        success: false,
      }
    }

    const xs = response.data?.xanoscript
    if (!xs) {
      return { error: 'No xanoscript content in response', objects, success: false }
    }

    let serverContent: string
    if (typeof xs === 'string') {
      serverContent = xs
    } else if (typeof xs === 'object' && 'value' in xs) {
      serverContent = (xs as { value: string }).value
    } else {
      return { error: `Unexpected xanoscript format: ${typeof xs}`, objects, success: false }
    }

    return this.writeFile(projectRoot, filePath, id, type, serverContent, objects, force, merge)
  }

  private async pullFromFetched(
    projectRoot: string,
    filePath: string,
    fetched: FetchedObject,
    objects: XanoObjectsFile,
    force: boolean,
    merge: boolean
  ): Promise<{ error?: string; objects: XanoObjectsFile; skipped?: boolean; success: boolean }> {
    return this.writeFile(projectRoot, filePath, fetched.id, fetched.type, fetched.xanoscript, objects, force, merge)
  }

  private writeFile(
    projectRoot: string,
    filePath: string,
    id: number,
    type: string,
    serverContent: string,
    objects: XanoObjectsFile,
    force: boolean,
    merge: boolean
  ): { error?: string; objects: XanoObjectsFile; skipped?: boolean; success: boolean } {
    const fullPath = path.join(projectRoot, filePath)
    const serverSha256 = computeSha256(serverContent)

    // Check if local file exists and has changes
    if (fs.existsSync(fullPath) && !force) {
      const localContent = fs.readFileSync(fullPath, 'utf8')
      const localSha256 = computeSha256(localContent)
      const obj = findObjectByPath(objects, filePath)

      if (obj && localSha256 !== obj.sha256) {
        if (merge) {
          const mergeResult = this.attemptMerge(projectRoot, fullPath, localContent, serverContent, obj.original)

          if (!mergeResult.success) {
            return { error: mergeResult.error || 'Merge failed', objects, success: false }
          }

          const mergedContent = fs.readFileSync(fullPath, 'utf8')
          objects = upsertObject(objects, filePath, {
            id,
            original: encodeBase64(serverContent),
            sha256: computeSha256(mergedContent),
            status: mergeResult.hasConflicts ? 'changed' : 'unchanged',
            type: type as any,
          })

          if (mergeResult.hasConflicts) {
            return { error: 'Merged with conflicts - please resolve manually', objects, success: true }
          }

          return { objects, success: true }
        }

        return {
          error: 'Local changes exist. Use --force to overwrite or --merge to attempt merge.',
          objects,
          skipped: true,
          success: false,
        }
      }
    }

    // Write file
    const dir = path.dirname(fullPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    fs.writeFileSync(fullPath, serverContent, 'utf-8')

    // Update objects.json
    objects = upsertObject(objects, filePath, {
      id,
      original: encodeBase64(serverContent),
      sha256: serverSha256,
      status: 'unchanged',
      type: type as any,
    })

    return { objects, success: true }
  }
}
