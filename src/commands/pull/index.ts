import { Args, Flags } from '@oclif/core'
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

import type {
  NamingMode,
  PathResolver,
  SanitizeFunction,
  TypeResolver,
  XanoObjectsFile,
  XanoObjectType,
  XanoPaths,
} from '../../lib/types.js'

import BaseCommand, { isAgentMode } from '../../base-command.js'
import {
  getProfile,
  getProfileWarning,
  XanoApi,
} from '../../lib/api.js'
import { loadConfig } from '../../lib/config.js'
import {
  computeSha256,
  encodeBase64,
  findObjectByPath,
  loadObjects,
  saveGroups,
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

export default class Pull extends BaseCommand {
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
    ...BaseCommand.baseFlags,
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
    sync: Flags.boolean({
      default: false,
      description: 'Force fresh metadata fetch from Xano',
    }),
  }
  static strict = false // Allow multiple path arguments
private customResolver?: PathResolver
  private customResolveType?: TypeResolver
  private customSanitize?: SanitizeFunction
  private naming?: NamingMode
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
      this.naming = dynamicConfig.config.naming || config.naming
    } else {
      this.paths = { ...getDefaultPaths(), ...config.paths }
      this.naming = config.naming
    }

    const profile = getProfile(flags.profile, config.profile)
    if (!profile) {
      this.error('No profile found. Run "xano init" first.')
    }

    // Warn if multiple profiles exist but none specified in project config
    const agentMode = isAgentMode(flags.agent)
    const profileWarning = getProfileWarning(flags.profile, config.profile, agentMode)
    if (profileWarning) {
      if (agentMode) {
        this.log(profileWarning)
      } else {
        this.warn(profileWarning)
      }
    }

    const api = new XanoApi(profile, config.workspaceId, config.branch)

    // Check if sync is needed (missing objects.json or --sync flag)
    const needsSync = flags.sync || !hasObjectsJson(projectRoot)

    let objects = loadObjects(projectRoot)
    let fetchedObjects: FetchedObject[] | null = null

    if (needsSync) {
      this.log('Syncing metadata from Xano...')
      const fetchResult = await fetchAllObjects(api, (msg) => this.log(msg))
      fetchedObjects = fetchResult.objects
      this.log('')

      // Update objects.json with fetched data
      objects = []
      for (const obj of fetchedObjects) {
        const filePath = generateObjectPath(obj, this.paths, {
          customResolver: this.customResolver,
          customSanitize: this.customSanitize,
          naming: this.naming,
        })
        objects = upsertObject(objects, filePath, {
          id: obj.id,
          original: encodeBase64(obj.xanoscript),
          sha256: computeSha256(obj.xanoscript),
          status: 'unchanged',
          type: obj.type,
        })
      }

      saveObjects(projectRoot, objects)
      saveGroups(projectRoot, fetchResult.apiGroups)
    }

    // Determine which files to pull
    const filesToPull = inputPaths.length === 0
      ? objects.map((o) => o.path) // Pull all known objects
      : this.expandPaths(projectRoot, inputPaths, objects) // Expand directories, normalize files

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
        const filePath = generateObjectPath(obj, this.paths, {
          customResolver: this.customResolver,
          customSanitize: this.customSanitize,
          naming: this.naming,
        })
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
      /* eslint-disable no-await-in-loop -- Sequential operations for progress logging */
      const result = fetched
        ? await this.pullFromFetched(projectRoot, file, fetched, objects, flags.force, flags.merge)
        : await this.pullFromApi(projectRoot, file, obj.id, obj.type, api, objects, flags.force, flags.merge)
      /* eslint-enable no-await-in-loop */

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

  private attemptMerge(
    projectRoot: string,
    filePath: string,
    localContent: string,
    serverContent: string,
    originalBase64: string
  ): { error?: string; hasConflicts: boolean; success: boolean } {
    try {
      const baseContent = Buffer.from(originalBase64, 'base64').toString('utf8')
      const tmpDir = mkdtempSync(join(projectRoot, '.xano-merge-'))
      const basePath = join(tmpDir, 'base.xs')
      const localPath = join(tmpDir, 'local.xs')
      const serverPath = join(tmpDir, 'server.xs')

      writeFileSync(basePath, baseContent)
      writeFileSync(localPath, localContent)
      writeFileSync(serverPath, serverContent)

      try {
        execSync(`git merge-file -p "${localPath}" "${basePath}" "${serverPath}" > "${filePath}"`, {
          cwd: projectRoot,
          encoding: 'utf8',
        })
        rmSync(tmpDir, { recursive: true })
        return { hasConflicts: false, success: true }
      } catch (mergeError) {
        // execSync throws an error object with status property for non-zero exit codes
        const exitStatus = mergeError && typeof mergeError === 'object' && 'status' in mergeError
          ? (mergeError as { status: number }).status
          : null
        if (exitStatus === 1) {
          const mergedContent = readFileSync(localPath, 'utf8')
          writeFileSync(filePath, mergedContent)
          rmSync(tmpDir, { recursive: true })
          return { hasConflicts: true, success: true }
        }

        rmSync(tmpDir, { recursive: true })
        return { error: 'Git merge-file failed', hasConflicts: false, success: false }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { error: message, hasConflicts: false, success: false }
    }
  }

  /**
   * Expand input paths to actual file paths
   * Priority:
   * 1. Exact file match in objects.json
   * 2. Directory prefix match (for directories)
   * 3. Type-based filtering (only for directory paths, not specific files)
   */
  private expandPaths(
    projectRoot: string,
    inputPaths: string[],
    objects: XanoObjectsFile
  ): string[] {
    const result: string[] = []

    for (const inputPath of inputPaths) {
      // Normalize path: resolve from cwd first, then make relative to project root
      // This ensures "." in a subdirectory means that subdirectory, not project root
      const absolutePath = resolve(inputPath)
      const normalizedPath = relative(projectRoot, absolutePath)

      // Remove trailing slash for comparisons
      const cleanPath = normalizedPath.replace(/\/$/, '')

      // 1. Check for exact file match first (highest priority)
      const exactMatch = objects.find(obj => obj.path === cleanPath)
      if (exactMatch) {
        result.push(exactMatch.path)
        continue
      }

      // 2. Check if it's a directory (by path or by existence)
      const fullPath = join(projectRoot, normalizedPath)
      const isDir = normalizedPath.endsWith('/') ||
        (existsSync(fullPath) && statSync(fullPath).isDirectory())

      if (isDir) {
        // Find all tracked files under this directory
        const dirPrefix = cleanPath + '/'
        let foundAny = false
        for (const obj of objects) {
          if (obj.path.startsWith(dirPrefix)) {
            result.push(obj.path)
            foundAny = true
          }
        }

        // If no files found via prefix, try type-based filtering
        if (!foundAny) {
          const types = resolveInputToTypes(
            cleanPath,
            this.paths,
            this.customResolveType
          )

          if (types && types.length > 0) {
            for (const obj of objects) {
              if (types.includes(obj.type)) {
                result.push(obj.path)
              }
            }
          }
        }
      } else {
        // Single file not found in objects - add it anyway (will be marked as "Not tracked")
        result.push(cleanPath)
      }
    }

    return [...new Set(result)] // Remove duplicates
  }

  private async pullFromApi(
    projectRoot: string,
    filePath: string,
    id: number,
    type: XanoObjectType,
    api: XanoApi,
    objects: XanoObjectsFile,
    force: boolean,
    merge: boolean
  ): Promise<{ error?: string; objects: XanoObjectsFile; skipped?: boolean; success: boolean }> {
    const response = await api.getObject(type, id)

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
    type: XanoObjectType,
    serverContent: string,
    objects: XanoObjectsFile,
    force: boolean,
    merge: boolean
  ): { error?: string; objects: XanoObjectsFile; skipped?: boolean; success: boolean } {
    const fullPath = join(projectRoot, filePath)
    const serverSha256 = computeSha256(serverContent)

    // Check if local file exists and has changes
    if (existsSync(fullPath) && !force) {
      const localContent = readFileSync(fullPath, 'utf8')
      const localSha256 = computeSha256(localContent)
      const obj = findObjectByPath(objects, filePath)

      if (obj && localSha256 !== obj.sha256) {
        if (merge) {
          const mergeResult = this.attemptMerge(projectRoot, fullPath, localContent, serverContent, obj.original)

          if (!mergeResult.success) {
            return { error: mergeResult.error || 'Merge failed', objects, success: false }
          }

          const mergedContent = readFileSync(fullPath, 'utf8')
          objects = upsertObject(objects, filePath, {
            id,
            original: encodeBase64(serverContent),
            sha256: computeSha256(mergedContent),
            status: mergeResult.hasConflicts ? 'changed' : 'unchanged',
            type,
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
    const dir = dirname(fullPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    writeFileSync(fullPath, serverContent, 'utf8')

    // Update objects.json
    objects = upsertObject(objects, filePath, {
      id,
      original: encodeBase64(serverContent),
      sha256: serverSha256,
      status: 'unchanged',
      type,
    })

    return { objects, success: true }
  }
}
