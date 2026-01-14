import { Args, Command, Flags } from '@oclif/core'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

import type {
  NamingMode,
  PathResolver,
  SanitizeFunction,
  StatusEntry,
  TypeResolver,
  XanoPaths,
} from '../../lib/types.js'

import {
  getProfile,
  XanoApi,
} from '../../lib/api.js'
import { loadConfig } from '../../lib/config.js'
import {
  computeFileSha256,
  computeSha256,
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
  type FetchedObject,
  generateObjectPath,
} from '../../lib/sync.js'

export default class Status extends Command {
  static args = {
    paths: Args.string({
      description: 'Files or directories to check (space-separated)',
      required: false,
    }),
  }
  static description = 'Show status of local files compared to Xano (always fetches remote state)'
  static examples = [
    '<%= config.bin %> status',
    '<%= config.bin %> status functions/',
    '<%= config.bin %> status functions/my_function.xs apis/',
    '<%= config.bin %> status --json',
  ]
  static flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    profile: Flags.string({
      char: 'p',
      description: 'Profile to use',
      env: 'XANO_PROFILE',
    }),
  }
  static strict = false // Allow multiple path arguments
private customResolver?: PathResolver
  private customResolveType?: TypeResolver
  private customSanitize?: SanitizeFunction
  private naming?: NamingMode
  private paths!: XanoPaths

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(Status)
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

    const profile = getProfile(flags.profile)
    if (!profile) {
      this.error('No profile found. Run "xano profile:wizard" to create one.')
    }

    const api = new XanoApi(profile, config.workspaceId, config.branch)

    // Always sync first - fetch all remote objects
    if (!flags.json) {
      this.log('Fetching remote state from Xano...')
    }

    const fetchResult = await fetchAllObjects(api)
    const remoteObjects = fetchResult.objects

    // Build map of remote objects by path
    const remoteByPath = new Map<string, FetchedObject>()
    for (const obj of remoteObjects) {
      const filePath = generateObjectPath(obj, this.paths, {
        customResolver: this.customResolver,
        customSanitize: this.customSanitize,
        naming: this.naming,
      })
      remoteByPath.set(filePath, obj)
    }

    // Collect all paths to check
    const allPaths = new Set<string>()

    // Add all remote object paths
    for (const filePath of remoteByPath.keys()) {
      allPaths.add(filePath)
    }

    // Add all local .xs files
    const localFiles = this.findAllLocalFiles(projectRoot)
    for (const filePath of localFiles) {
      allPaths.add(filePath)
    }

    // Filter paths if input paths specified
    const pathsToCheck = inputPaths.length > 0 ? this.filterPaths(projectRoot, inputPaths, allPaths, remoteByPath) : [...allPaths];

    // Collect status entries
    const entries: StatusEntry[] = []

    for (const filePath of pathsToCheck) {
      const fullPath = join(projectRoot, filePath)
      const fileExists = existsSync(fullPath)
      const remoteObj = remoteByPath.get(filePath)

      if (fileExists && remoteObj) {
        // Both local and remote exist - check if modified
        const localSha256 = computeFileSha256(fullPath)
        const remoteSha256 = computeSha256(remoteObj.xanoscript)

        if (localSha256 === remoteSha256) {
          entries.push({
            id: remoteObj.id,
            path: filePath,
            status: 'unchanged',
            type: remoteObj.type,
          })
        } else {
          entries.push({
            id: remoteObj.id,
            path: filePath,
            status: 'modified',
            type: remoteObj.type,
          })
        }
      } else if (fileExists && !remoteObj) {
        // Local only - new file
        entries.push({
          path: filePath,
          status: 'new',
        })
      } else if (!fileExists && remoteObj) {
        // Remote only - not pulled locally
        entries.push({
          id: remoteObj.id,
          path: filePath,
          status: 'remote_only',
          type: remoteObj.type,
        })
      }
      // If neither exists, skip (shouldn't happen)
    }

    // Sort entries by path
    entries.sort((a, b) => a.path.localeCompare(b.path))

    // Output
    if (flags.json) {
      this.log(JSON.stringify(entries, null, 2))
      return
    }

    // Human-readable output
    this.log('')
    this.log(`Workspace: ${config.workspaceName}`)
    this.log(`Branch: ${config.branch}`)
    this.log('')

    const modified = entries.filter((e) => e.status === 'modified')
    const newEntries = entries.filter((e) => e.status === 'new')
    const remoteOnly = entries.filter((e) => e.status === 'remote_only')
    const unchanged = entries.filter((e) => e.status === 'unchanged')

    const hasLocalChanges = modified.length > 0 || newEntries.length > 0
    const hasRemoteOnly = remoteOnly.length > 0

    if (!hasLocalChanges && !hasRemoteOnly) {
      this.log('All files in sync.')
      this.log('')
    }

    if (modified.length > 0) {
      this.log('Modified (local differs from Xano):')
      for (const entry of modified) {
        this.log(`  M ${entry.path}`)
      }

      this.log('')
    }

    if (newEntries.length > 0) {
      this.log('New (local only, not on Xano):')
      for (const entry of newEntries) {
        this.log(`  A ${entry.path}`)
      }

      this.log('')
    }

    if (remoteOnly.length > 0) {
      this.log('Remote only (on Xano, not local):')
      for (const entry of remoteOnly) {
        this.log(`  R ${entry.path}`)
      }

      this.log('')
    }

    // Summary
    const total = entries.length
    const changedCount = modified.length + newEntries.length + remoteOnly.length
    this.log(`${unchanged.length}/${total} files in sync, ${changedCount} with differences`)

    if (hasLocalChanges) {
      this.log('')
      this.log("Run 'xano push' to push local changes to Xano")
    }

    if (hasRemoteOnly) {
      this.log('')
      this.log("Run 'xano pull' to download remote-only files")
    }
  }

  /**
   * Filter paths based on input path arguments
   * Uses type-based filtering when input matches a known type mapping,
   * falls back to path prefix matching otherwise
   */
  private filterPaths(
    projectRoot: string,
    inputPaths: string[],
    allPaths: Set<string>,
    remoteByPath: Map<string, FetchedObject>
  ): string[] {
    const result: string[] = []

    for (const inputPath of inputPaths) {
      // Normalize path: resolve from cwd first, then make relative to project root
      // This ensures "." in a subdirectory means that subdirectory, not project root
      const absolutePath = resolve(inputPath)
      const normalizedPath = relative(projectRoot, absolutePath)

      // Remove trailing slash for type resolution
      const cleanPath = normalizedPath.replace(/\/$/, '')

      // Try type-based filtering first
      const types = resolveInputToTypes(
        cleanPath,
        this.paths,
        this.customResolveType
      )

      if (types && types.length > 0) {
        // Filter by type - include paths where remote object matches type
        // or local file is in a directory for that type
        for (const p of allPaths) {
          const remoteObj = remoteByPath.get(p)
          if (remoteObj && types.includes(remoteObj.type)) {
            result.push(p)
          } else if (!remoteObj) {
            // Local-only file - check if path is under a type directory
            for (const type of types) {
              const typeDir = this.getDirectoryForType(type)
              if (typeDir && (p.startsWith(typeDir + '/') || p.startsWith(typeDir + sep))) {
                result.push(p)
                break
              }
            }
          }
        }
      } else {
        // Fallback to path prefix matching
        const fullPath = join(projectRoot, normalizedPath)
        const isDir = normalizedPath.endsWith('/') ||
          (existsSync(fullPath) && statSync(fullPath).isDirectory()) ||
          this.isKnownDirectory(normalizedPath)

        if (isDir) {
          // Find all paths under this directory
          const dirPrefix = normalizedPath.endsWith('/') ? normalizedPath : `${normalizedPath}/`
          for (const p of allPaths) {
            if (p.startsWith(dirPrefix) || p.startsWith(normalizedPath + sep)) {
              result.push(p)
            }
          }
        } else if (allPaths.has(normalizedPath)) {
          // Single file - add if it exists in allPaths
          result.push(normalizedPath)
        }
      }
    }

    return [...new Set(result)] // Remove duplicates
  }

  /**
   * Find all local .xs files
   */
  private findAllLocalFiles(projectRoot: string): string[] {
    const files: string[] = []
    const dirs = [
      this.paths.functions,
      this.paths.apis,
      this.paths.tables,
      this.paths.tasks,
      this.paths.workflowTests,
    ].filter((d): d is string => d !== undefined)

    for (const dir of dirs) {
      const fullDir = join(projectRoot, dir)
      if (existsSync(fullDir)) {
        this.walkDir(fullDir, projectRoot, files)
      }
    }

    return files
  }

  /**
   * Get the configured directory for a given type
   */
  private getDirectoryForType(type: string): string | undefined {
    switch (type) {
      case 'api_endpoint':
      case 'api_group': { return this.paths.apis
      }

      case 'function': { return this.paths.functions
      }

      case 'table': { return this.paths.tables
      }

      case 'table_trigger': { return this.paths.tableTriggers || `${this.paths.tables}/triggers`
      }

      case 'task': { return this.paths.tasks
      }

      case 'workflow_test': { return this.paths.workflowTests
      }

      default: { return undefined
      }
    }
  }

  /**
   * Check if path is a known directory prefix
   */
  private isKnownDirectory(normalizedPath: string): boolean {
    const knownDirs = [
      this.paths.functions,
      this.paths.apis,
      this.paths.tables,
      this.paths.tasks,
      this.paths.workflowTests,
    ].filter((d): d is string => d !== undefined)

    for (const dir of knownDirs) {
      if (normalizedPath === dir || normalizedPath.startsWith(`${dir}/`)) {
        return true
      }
    }

    return false
  }

  private walkDir(
    dir: string,
    projectRoot: string,
    files: string[]
  ): void {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        this.walkDir(fullPath, projectRoot, files)
      } else if (entry.name.endsWith('.xs')) {
        const relativePath = relative(projectRoot, fullPath)
        files.push(relativePath)
      }
    }
  }
}
