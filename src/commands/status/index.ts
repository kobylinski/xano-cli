import { Args, Command, Flags } from '@oclif/core'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

import type {
  FileStatus,
  NamingMode,
  PathResolver,
  SanitizeFunction,
  StatusDetail,
  StatusEntry,
  TypeResolver,
  XanoObject,
  XanoPaths,
} from '../../lib/types.js'

import {
  getProfile,
  getProfileWarning,
  XanoApi,
} from '../../lib/api.js'
import { loadConfig } from '../../lib/config.js'
import {
  computeFileSha256,
  computeSha256,
  loadObjects,
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

/**
 * Extract xanoscript string from API response
 * Handles both string format and object format { value: string }
 */
function extractXanoscript(xanoscript: string | undefined | { status?: string; value: string }): string | undefined {
  if (!xanoscript) return undefined
  if (typeof xanoscript === 'string') return xanoscript
  return xanoscript.value
}

export default class Status extends Command {
  static args = {
    paths: Args.string({
      description: 'Files or directories to check (space-separated)',
      required: false,
    }),
  }
  static description = 'Show synchronization status of local files with Xano'
  static examples = [
    '<%= config.bin %> status',
    '<%= config.bin %> status functions/',
    '<%= config.bin %> status data/tables/users.xs',
    '<%= config.bin %> status --json',
    '<%= config.bin %> status --extended',
  ]
  static flags = {
    extended: Flags.boolean({
      char: 'e',
      default: false,
      description: 'Show extended info (record counts for tables)',
    }),
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

    const profile = getProfile(flags.profile, config.profile)
    if (!profile) {
      this.error('No profile found. Run "xano profile:wizard" to create one.')
    }

    // Warn if multiple profiles exist but none specified in project config
    const profileWarning = getProfileWarning(flags.profile, config.profile)
    if (profileWarning) {
      this.warn(profileWarning)
    }

    const api = new XanoApi(profile, config.workspaceId, config.branch)

    // Load objects.json - the source of truth for last synced state
    const objects = loadObjects(projectRoot)
    const objectsByPath = new Map<string, XanoObject>()
    for (const obj of objects) {
      objectsByPath.set(obj.path, obj)
    }

    // Determine what paths to check
    const { pathsToCheck, remoteByPath } = await this.resolvePathsAndFetchRemote(
      api,
      projectRoot,
      inputPaths,
      objectsByPath,
      flags.json
    )

    // Three-way comparison for each path
    const entries: StatusEntry[] = []

    for (const filePath of pathsToCheck) {
      const entry = this.compareThreeWay(
        projectRoot,
        filePath,
        objectsByPath.get(filePath),
        remoteByPath.get(filePath)
      )
      if (entry) {
        entries.push(entry)
      }
    }

    // Sort entries by path
    entries.sort((a, b) => a.path.localeCompare(b.path))

    // Fetch extended info if requested
    if (flags.extended) {
      await this.fetchExtendedInfo(api, entries, flags.json)
    }

    // Output
    if (flags.json) {
      this.log(JSON.stringify(entries, null, 2))
      return
    }

    this.displayResults(entries, config.workspaceName, config.branch, flags.extended)
  }

  /**
   * Three-way comparison: local file vs objects.json vs remote
   */
  private compareThreeWay(
    projectRoot: string,
    filePath: string,
    syncedObj: undefined | XanoObject,
    remoteObj: FetchedObject | undefined
  ): null | StatusEntry {
    const fullPath = join(projectRoot, filePath)
    const localExists = existsSync(fullPath)
    const localHash = localExists ? computeFileSha256(fullPath) : null
    const syncedHash = syncedObj?.sha256
    const remoteHash = remoteObj?.xanoscript ? computeSha256(remoteObj.xanoscript) : null

    // Determine status based on three-way comparison
    let status: FileStatus
    let detail: StatusDetail | undefined

    if (localExists && syncedObj && remoteObj) {
      // All three exist - compare hashes
      const localMatchesSynced = localHash === syncedHash
      const syncedMatchesRemote = syncedHash === remoteHash

      if (localMatchesSynced && syncedMatchesRemote) {
        status = 'unchanged'
      } else if (!localMatchesSynced && syncedMatchesRemote) {
        status = 'modified'
        detail = 'local'
      } else if (localMatchesSynced && !syncedMatchesRemote) {
        status = 'modified'
        detail = 'remote'
      } else {
        // Both changed - conflict
        status = 'modified'
        detail = 'both'
      }
    } else if (localExists && syncedObj && !remoteObj) {
      // Local and synced exist, but remote deleted
      status = 'deleted'
      detail = 'remote'
    } else if (localExists && !syncedObj && remoteObj) {
      // Local exists, not synced, but exists on remote (unusual - maybe synced elsewhere)
      status = 'modified'
      detail = 'local'
    } else if (localExists && !syncedObj && !remoteObj) {
      // New local file
      status = 'new'
    } else if (!localExists && syncedObj && remoteObj) {
      // Deleted locally
      status = 'deleted'
      detail = 'local'
    } else if (!localExists && syncedObj && !remoteObj) {
      // Both deleted (synced but neither local nor remote exist)
      // This is a cleanup case - could skip or report
      return null
    } else if (!localExists && !syncedObj && remoteObj) {
      // Remote only (not pulled yet)
      status = 'remote_only'
    } else {
      // Nothing exists anywhere - skip
      return null
    }

    return {
      detail,
      id: remoteObj?.id || syncedObj?.id,
      path: filePath,
      status,
      type: remoteObj?.type || syncedObj?.type,
    }
  }

  /**
   * Display results in human-readable format
   */
  private displayResults(
    entries: StatusEntry[],
    workspaceName: string,
    branch: string,
    showExtended: boolean
  ): void {
    this.log('')
    this.log(`Workspace: ${workspaceName}`)
    this.log(`Branch: ${branch}`)
    this.log('')

    const modified = entries.filter((e) => e.status === 'modified')
    const newEntries = entries.filter((e) => e.status === 'new')
    const deleted = entries.filter((e) => e.status === 'deleted')
    const remoteOnly = entries.filter((e) => e.status === 'remote_only')
    const unchanged = entries.filter((e) => e.status === 'unchanged')

    const hasChanges = modified.length > 0 || newEntries.length > 0 || deleted.length > 0 || remoteOnly.length > 0

    if (!hasChanges) {
      this.log('All files in sync.')
      this.log('')
    }

    // Helper to format entry
    const formatEntry = (entry: StatusEntry) => {
      const parts: string[] = []

      // Status indicator
      let indicator = '  '
      switch (entry.status) {
      case 'deleted': {
        if (entry.detail === 'local') indicator = 'D '
        else if (entry.detail === 'remote') indicator = 'D↑'
        else indicator = 'D '
      
      break;
      }

      case 'modified': {
        switch (entry.detail) {
        case 'both': {
        indicator = 'M!'
        break;
        }

        case 'local': {
        indicator = 'M '
        break;
        }

        case 'remote': {
        indicator = 'M↓'
        break;
        }

        default: { indicator = 'M '
        }
        }
      
      break;
      }

      case 'new': {
        indicator = 'A '
      
      break;
      }

      case 'remote_only': {
        indicator = 'R '
      
      break;
      }
      // No default
      }

      parts.push(`  ${indicator} ${entry.path}`)

      // Extended info
      if (showExtended && entry.extendedInfo?.recordCount !== undefined) {
        parts[0] += ` (${entry.extendedInfo.recordCount.toLocaleString()} records)`
      }

      return parts.join('')
    }

    // Group modified by detail
    const modifiedLocal = modified.filter(e => e.detail === 'local')
    const modifiedRemote = modified.filter(e => e.detail === 'remote')
    const modifiedBoth = modified.filter(e => e.detail === 'both')

    if (modifiedLocal.length > 0) {
      this.log('Modified locally (push to sync):')
      for (const entry of modifiedLocal) {
        this.log(formatEntry(entry))
      }

      this.log('')
    }

    if (modifiedRemote.length > 0) {
      this.log('Modified remotely (pull to sync):')
      for (const entry of modifiedRemote) {
        this.log(formatEntry(entry))
      }

      this.log('')
    }

    if (modifiedBoth.length > 0) {
      this.log('Conflicts (both local and remote changed):')
      for (const entry of modifiedBoth) {
        this.log(formatEntry(entry))
      }

      this.log('')
    }

    if (newEntries.length > 0) {
      this.log('New (local only, push to add):')
      for (const entry of newEntries) {
        this.log(formatEntry(entry))
      }

      this.log('')
    }

    if (deleted.length > 0) {
      const deletedLocal = deleted.filter(e => e.detail === 'local')
      const deletedRemote = deleted.filter(e => e.detail === 'remote')

      if (deletedLocal.length > 0) {
        this.log('Deleted locally:')
        for (const entry of deletedLocal) {
          this.log(formatEntry(entry))
        }

        this.log('')
      }

      if (deletedRemote.length > 0) {
        this.log('Deleted remotely:')
        for (const entry of deletedRemote) {
          this.log(formatEntry(entry))
        }

        this.log('')
      }
    }

    if (remoteOnly.length > 0) {
      this.log('Remote only (pull to download):')
      for (const entry of remoteOnly) {
        this.log(formatEntry(entry))
      }

      this.log('')
    }

    // Summary
    const total = entries.length
    const changedCount = modified.length + newEntries.length + deleted.length + remoteOnly.length
    this.log(`${unchanged.length}/${total} files in sync, ${changedCount} with differences`)

    // Extended report for tables
    if (showExtended) {
      const tablesWithCounts = entries
        .filter(e => e.type === 'table' && e.extendedInfo?.recordCount !== undefined)
        .sort((a, b) => (b.extendedInfo?.recordCount || 0) - (a.extendedInfo?.recordCount || 0))

      if (tablesWithCounts.length > 0) {
        const totalRecords = tablesWithCounts.reduce((sum, e) => sum + (e.extendedInfo?.recordCount || 0), 0)

        // Extract table name from path (e.g., "data/tables/users.xs" -> "users")
        const getTableName = (path: string) => {
          const filename = path.split('/').pop() || path
          return filename.replace(/\.xs$/, '')
        }

        // Calculate max name width for alignment
        const maxNameWidth = Math.min(
          30,
          Math.max(...tablesWithCounts.map(e => getTableName(e.path).length))
        )

        this.log('')
        this.log(`Tables: ${tablesWithCounts.length}`)
        this.log('')

        for (const entry of tablesWithCounts) {
          const name = getTableName(entry.path).padEnd(maxNameWidth)
          const count = (entry.extendedInfo?.recordCount || 0).toLocaleString().padStart(10)
          this.log(`  ${name}  ${count} records`)
        }

        this.log('')
        this.log(`${'Total'.padEnd(maxNameWidth)}  ${totalRecords.toLocaleString().padStart(10)} records`)
      }
    }

    // Hints
    if (modifiedLocal.length > 0 || newEntries.length > 0) {
      this.log('')
      this.log("Run 'xano push' to push local changes to Xano")
    }

    if (modifiedRemote.length > 0 || remoteOnly.length > 0) {
      this.log('')
      this.log("Run 'xano pull' to download remote changes")
    }

    if (modifiedBoth.length > 0) {
      this.log('')
      this.log('Resolve conflicts manually before syncing')
    }
  }

  /**
   * Fetch extended info for entries (e.g., record counts for tables)
   */
  private async fetchExtendedInfo(
    api: XanoApi,
    entries: StatusEntry[],
    jsonOutput: boolean
  ): Promise<void> {
    const tableEntries = entries.filter(e => e.type === 'table' && e.id)

    if (tableEntries.length === 0) return

    if (!jsonOutput) {
      this.log(`Fetching extended info for ${tableEntries.length} tables...`)
    }

    /* eslint-disable no-await-in-loop -- Sequential API calls for record counts */
    for (const entry of tableEntries) {
      if (entry.id) {
        const response = await api.listTableContent(entry.id, 1, 1)
        if (response.ok && response.data) {
          entry.extendedInfo = {
            recordCount: response.data.itemsTotal,
          }
        }
      }
    }
    /* eslint-enable no-await-in-loop */
  }

  /**
   * Filter paths based on input path arguments
   */
  private filterPaths(
    projectRoot: string,
    inputPaths: string[],
    allPaths: Set<string>,
    remoteByPath: Map<string, FetchedObject>
  ): string[] {
    const result: string[] = []

    for (const inputPath of inputPaths) {
      const absolutePath = resolve(inputPath)
      const normalizedPath = relative(projectRoot, absolutePath)
      const cleanPath = normalizedPath.replace(/\/$/, '')

      // Try type-based filtering first
      const types = resolveInputToTypes(cleanPath, this.paths, this.customResolveType)

      if (types && types.length > 0) {
        for (const p of allPaths) {
          const remoteObj = remoteByPath.get(p)
          if (remoteObj && types.includes(remoteObj.type)) {
            result.push(p)
          } else if (!remoteObj) {
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
        // Path prefix matching
        const fullPath = join(projectRoot, normalizedPath)
        const isDir = normalizedPath.endsWith('/') ||
          (existsSync(fullPath) && statSync(fullPath).isDirectory()) ||
          this.isKnownDirectory(normalizedPath)

        if (isDir) {
          const dirPrefix = normalizedPath.endsWith('/') ? normalizedPath : `${normalizedPath}/`
          for (const p of allPaths) {
            if (p.startsWith(dirPrefix) || p.startsWith(normalizedPath + sep)) {
              result.push(p)
            }
          }
        } else if (allPaths.has(normalizedPath)) {
          result.push(normalizedPath)
        }
      }
    }

    return [...new Set(result)]
  }

  /**
   * Find all local .xs files in configured directories
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

  /**
   * Resolve input paths and fetch appropriate remote data
   * Uses smart fetching: specific files fetch only those, directories fetch by type
   */
  private async resolvePathsAndFetchRemote(
    api: XanoApi,
    projectRoot: string,
    inputPaths: string[],
    objectsByPath: Map<string, XanoObject>,
    jsonOutput: boolean
  ): Promise<{ pathsToCheck: string[]; remoteByPath: Map<string, FetchedObject> }> {
    const remoteByPath = new Map<string, FetchedObject>()

    // Case 1: No input paths - check everything
    if (inputPaths.length === 0) {
      if (!jsonOutput) {
        this.log('Fetching remote state from Xano...')
      }

      const fetchResult = await fetchAllObjects(api)

      // Build remote map by path
      for (const obj of fetchResult.objects) {
        const filePath = generateObjectPath(obj, this.paths, {
          customResolver: this.customResolver,
          customSanitize: this.customSanitize,
          naming: this.naming,
        })
        remoteByPath.set(filePath, obj)
      }

      // Collect all paths: from objects.json + local files + remote
      const allPaths = new Set<string>()
      for (const path of objectsByPath.keys()) allPaths.add(path)
      for (const path of remoteByPath.keys()) allPaths.add(path)
      for (const path of this.findAllLocalFiles(projectRoot)) allPaths.add(path)

      return { pathsToCheck: [...allPaths], remoteByPath }
    }

    // Case 2: Specific files provided
    const specificFiles = this.resolveSpecificFiles(projectRoot, inputPaths)
    if (specificFiles.length > 0 && specificFiles.length === inputPaths.length) {
      // All inputs are specific files - targeted fetch
      /* eslint-disable no-await-in-loop -- Sequential fetch for specific files */
      for (const filePath of specificFiles) {
        const syncedObj = objectsByPath.get(filePath)
        if (syncedObj?.id && syncedObj.type) {
          // Fetch this specific object from remote
          const response = await api.getObject(syncedObj.type, syncedObj.id)
          if (response.ok && response.data) {
            const data = response.data as { id: number; name?: string; xanoscript?: string | { status?: string; value: string } }
            const xanoscript = extractXanoscript(data.xanoscript)
            if (xanoscript) {
              remoteByPath.set(filePath, {
                id: syncedObj.id,
                name: data.name || '',
                type: syncedObj.type,
                xanoscript,
              })
            }
          }
        }
        // If not in objects.json, no remote to fetch (it's new or doesn't exist)
      }
      /* eslint-enable no-await-in-loop */

      return { pathsToCheck: specificFiles, remoteByPath }
    }

    // Case 3: Directories or mixed - need full fetch then filter
    if (!jsonOutput) {
      this.log('Fetching remote state from Xano...')
    }

    const fetchResult = await fetchAllObjects(api)

    // Build remote map by path
    for (const obj of fetchResult.objects) {
      const filePath = generateObjectPath(obj, this.paths, {
        customResolver: this.customResolver,
        customSanitize: this.customSanitize,
        naming: this.naming,
      })
      remoteByPath.set(filePath, obj)
    }

    // Collect all paths
    const allPaths = new Set<string>()
    for (const path of objectsByPath.keys()) allPaths.add(path)
    for (const path of remoteByPath.keys()) allPaths.add(path)
    for (const path of this.findAllLocalFiles(projectRoot)) allPaths.add(path)

    // Filter to requested paths
    const filteredPaths = this.filterPaths(projectRoot, inputPaths, allPaths, remoteByPath)

    return { pathsToCheck: filteredPaths, remoteByPath }
  }

  /**
   * Resolve input paths to specific .xs files
   */
  private resolveSpecificFiles(projectRoot: string, inputPaths: string[]): string[] {
    const result: string[] = []

    for (const inputPath of inputPaths) {
      if (inputPath.endsWith('/')) continue

      const absolutePath = resolve(inputPath)
      const relativePath = relative(projectRoot, absolutePath)

      if (relativePath.endsWith('.xs')) {
        const fullPath = join(projectRoot, relativePath)
        if (existsSync(fullPath) && statSync(fullPath).isFile()) {
          result.push(relativePath)
        } else {
          // File doesn't exist locally but might be checking a known path
          result.push(relativePath)
        }
      }
    }

    return result
  }

  private walkDir(dir: string, projectRoot: string, files: string[]): void {
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
