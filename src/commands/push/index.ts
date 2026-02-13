import { Args, Flags } from '@oclif/core'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import * as readline from 'node:readline'

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
import { detectType, extractApiDetails, extractName, validateSingleBlock } from '../../lib/detector.js'
import {
  computeFileSha256,
  computeSha256,
  encodeBase64,
  findApiGroupForEndpoint,
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
  fetchAllObjects,
  generateObjectPath,
  hasObjectsJson,
} from '../../lib/sync.js'

/**
 * Common PostgreSQL error codes and their meanings
 * https://www.postgresql.org/docs/current/errcodes-appendix.html
 */
const SQL_ERROR_EXPLANATIONS: Record<string, { explanation: string; recovery: string }> = {
  '22P02': {
    explanation: 'Invalid text representation - data type mismatch',
    recovery: 'The column type change is incompatible with existing data (e.g., int → uuid). Delete the table in Xano admin panel and re-push, or migrate data manually.',
  },
  '42P01': {
    explanation: 'Table does not exist',
    recovery: 'Run "xano pull --sync" to refresh metadata',
  },
  '42P07': {
    explanation: 'Table already exists',
    recovery: 'Run "xano pull --sync" to refresh metadata',
  },
  '22001': {
    explanation: 'String data is too long for the column',
    recovery: 'Increase the column length or truncate the data',
  },
  '22003': {
    explanation: 'Numeric value out of range',
    recovery: 'Change the column type to support larger numbers or adjust the data',
  },
  '22007': {
    explanation: 'Invalid datetime format',
    recovery: 'Check date/time values match the expected format',
  },
  '22008': {
    explanation: 'Datetime field overflow - value doesn\'t fit in target type',
    recovery: 'The column type change is incompatible with existing data (e.g., timestamp → date loses time info). Delete the table in Xano admin panel and re-push, or migrate data manually.',
  },
  '22012': {
    explanation: 'Division by zero',
    recovery: 'Check computed columns or constraints for division operations',
  },
  '23502': {
    explanation: 'NOT NULL constraint violation',
    recovery: 'Existing rows have NULL values in a column that is now NOT NULL. Provide default values or update existing data first.',
  },
  '23503': {
    explanation: 'Foreign key constraint violation',
    recovery: 'Referenced data doesn\'t exist or would be orphaned',
  },
  '23505': {
    explanation: 'Unique constraint violation',
    recovery: 'Duplicate values exist for a column that requires uniqueness',
  },
  '23514': {
    explanation: 'Check constraint violation',
    recovery: 'Data doesn\'t meet the column\'s validation rules',
  },
  '42701': {
    explanation: 'Duplicate column name',
    recovery: 'A column with this name already exists in the table',
  },
  '42703': {
    explanation: 'Column does not exist',
    recovery: 'Referenced column name not found. Check spelling and case sensitivity.',
  },
}

/**
 * Parse SQL error from API response and provide helpful explanation
 */
function explainSqlError(error: string, objectType: string): string {
  // Match pattern: "SQL Error: XXXXX, ERROR_NAME" or just "SQL Error: XXXXX"
  const sqlMatch = error.match(/SQL Error:\s*([A-Z0-9]+)(?:,\s*([A-Z_]+))?/i)

  if (!sqlMatch) {
    return error
  }

  const errorCode = sqlMatch[1]
  const errorName = sqlMatch[2] || ''

  const info = SQL_ERROR_EXPLANATIONS[errorCode]

  if (info) {
    const isSchemaChange = objectType === 'table' && ['22P02', '22003', '22007', '22008'].includes(errorCode)

    let message = `SQL Error ${errorCode}: ${info.explanation}`

    if (isSchemaChange) {
      message += `\n\n    SCHEMA MIGRATION CONFLICT: Existing data is incompatible with new schema.`
      message += `\n    Recovery: ${info.recovery}`
      message += `\n\n    Note: Xano CLI cannot automatically drop/recreate tables.`
      message += `\n    To force the schema change, delete the table in Xano admin panel, then run "xano push".`
    } else {
      message += `\n    Recovery: ${info.recovery}`
    }

    return message
  }

  // Unknown error code - return original with code highlighted
  return `${error}\n    (SQL Error Code: ${errorCode}${errorName ? ` - ${errorName}` : ''})`
}

export default class Push extends BaseCommand {
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
    ...BaseCommand.baseFlags,
    clean: Flags.boolean({
      default: false,
      description: 'Delete objects from Xano that do not exist locally',
    }),
    force: Flags.boolean({
      char: 'f',
      default: false,
      description: 'Force push without confirmation',
    }),
    'no-validate-blocks': Flags.boolean({
      default: false,
      description: 'Skip validation that checks for multiple XanoScript blocks in a file',
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
  private skipBlockValidation = false

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
      this.naming = dynamicConfig.config.naming || config.naming
    } else {
      this.paths = { ...getDefaultPaths(), ...config.paths }
      this.naming = config.naming
    }

    // Set validation options from flags
    this.skipBlockValidation = flags['no-validate-blocks']

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

    // Cache for API group mappings - populated during sync, used for deletions
    let apiGroupCache: Map<number, number> | null = null // endpoint_id -> apigroup_id

    if (needsSync) {
      this.log('Syncing metadata from Xano...')
      const fetchResult = await fetchAllObjects(api, (msg) => this.log(msg))
      const fetchedObjects = fetchResult.objects
      this.log('')

      // Build apigroup cache from fetched data (before we lose apigroup_id)
      apiGroupCache = new Map()
      for (const obj of fetchedObjects) {
        if (obj.type === 'api_endpoint' && obj.apigroup_id) {
          apiGroupCache.set(obj.id, obj.apigroup_id)
        }
      }

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

    // Determine which files to push
    const filesToPush = inputPaths.length === 0
      ? this.getAllChangedFiles(projectRoot, objects) // Push all modified files
      : this.expandPaths(projectRoot, inputPaths, objects) // Expand directories, find modified files

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
    let schemaErrorCount = 0

    for (const file of filesToPush) {
      // eslint-disable-next-line no-await-in-loop -- Sequential operations for progress logging
      const result = await this.pushFile(projectRoot, file, api, objects)

      if (result.success) {
        objects = result.objects
        successCount++
        this.log(`  ✓ ${file}`)
      } else {
        errorCount++
        // Track schema migration errors for guidance
        if (result.error?.includes('SQL Error') || result.error?.includes('SCHEMA MIGRATION')) {
          schemaErrorCount++
        }

        this.log(`  ✗ ${file}: ${result.error}`)
      }
    }

    // Delete orphan objects from Xano if --clean
    let deletedCount = 0
    if (flags.clean && orphanObjects.length > 0) {
      this.log('')
      this.log(`Deleting ${orphanObjects.length} orphan object(s) from Xano...`)

      for (const obj of orphanObjects) {
        let deleteOptions: undefined | { apigroup_id?: number }

        // For api_endpoints, we need to find the apigroup_id
        if (obj.type === 'api_endpoint') {
          // First try local lookup via path hierarchy
          const apiGroup = findApiGroupForEndpoint(objects, obj.path)

          if (apiGroup) {
            deleteOptions = { apigroup_id: apiGroup.id } // eslint-disable-line camelcase
          } else {
            // Fetch from Xano on-demand (once per session)
            if (!apiGroupCache) {
              this.log('  Fetching API group mappings from Xano...')
              // eslint-disable-next-line no-await-in-loop -- Only fetched once per session
              apiGroupCache = await this.fetchApiGroupMappings(api)
            }

            const cachedGroupId = apiGroupCache.get(obj.id)
            if (cachedGroupId) {
              deleteOptions = { apigroup_id: cachedGroupId } // eslint-disable-line camelcase
            } else {
              this.log(`  ✗ Cannot delete ${obj.path}: API group not found locally or on Xano`)
              continue
            }
          }
        }

        // eslint-disable-next-line no-await-in-loop -- Sequential deletions for progress logging
        const response = await api.deleteObject(obj.type, obj.id, deleteOptions)
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
      this.log('╔════════════════════════════════════════════════════════════════╗')
      this.log(`║  ${orphanObjects.length} file(s) deleted locally but still exist on Xano`)
      this.log('╚════════════════════════════════════════════════════════════════╝')
      this.log('')
      for (const obj of orphanObjects.slice(0, 10)) {
        this.log(`  - ${obj.path}`)
      }

      if (orphanObjects.length > 10) {
        this.log(`  ... and ${orphanObjects.length - 10} more`)
      }

      this.log('')

      // In agent mode or with --force, just show the message
      if (agentMode) {
        this.log('AGENT_ORPHAN_FILES:')
        this.log(`count=${orphanObjects.length}`)
        this.log('AGENT_ACTION: Run "xano push --clean" to delete these from Xano')
      } else if (flags.force) {
        this.log('Use "xano push --clean" to delete these from Xano.')
      } else {
        // Prompt user for interactive deletion
        const confirmed = await this.confirmOrphanDeletion(orphanObjects.length)
        if (confirmed) {
          this.log('')
          this.log(`Deleting ${orphanObjects.length} orphan object(s) from Xano...`)

          for (const obj of orphanObjects) {
            let deleteOptions: undefined | { apigroup_id?: number }

            if (obj.type === 'api_endpoint') {
              const apiGroup = findApiGroupForEndpoint(objects, obj.path)
              if (apiGroup) {
                deleteOptions = { apigroup_id: apiGroup.id } // eslint-disable-line camelcase
              } else {
                if (!apiGroupCache) {
                  this.log('  Fetching API group mappings from Xano...')
                  // eslint-disable-next-line no-await-in-loop -- Only fetched once
                  apiGroupCache = await this.fetchApiGroupMappings(api)
                }

                const cachedGroupId = apiGroupCache.get(obj.id)
                if (cachedGroupId) {
                  deleteOptions = { apigroup_id: cachedGroupId } // eslint-disable-line camelcase
                } else {
                  this.log(`  ✗ Cannot delete ${obj.path}: API group not found`)
                  continue
                }
              }
            }

            // eslint-disable-next-line no-await-in-loop -- Sequential deletions
            const response = await api.deleteObject(obj.type, obj.id, deleteOptions)
            if (response.ok) {
              objects = objects.filter((o) => o.path !== obj.path)
              deletedCount++
              this.log(`  ✓ Deleted ${obj.path}`)
            } else {
              this.log(`  ✗ Failed to delete ${obj.path}: ${response.error}`)
            }
          }
        } else {
          this.log('Skipped. Use "xano push --clean" to delete them later.')
        }
      }
    }

    // Save updated objects.json
    saveObjects(projectRoot, objects)

    this.log('')

    // Build detailed summary
    const summaryParts: string[] = []
    if (successCount > 0) summaryParts.push(`${successCount} pushed`)
    if (errorCount > 0) summaryParts.push(`${errorCount} failed`)
    if (deletedCount > 0) summaryParts.push(`${deletedCount} deleted`)

    if (summaryParts.length > 0) {
      this.log(`Summary: ${summaryParts.join(', ')}`)
    }

    // Provide guidance for schema errors
    if (schemaErrorCount > 0) {
      this.log('')
      this.log(`${schemaErrorCount} file(s) failed due to schema migration conflicts.`)
      this.log('To resolve, you must manually delete the affected tables in Xano admin panel,')
      this.log('then run "xano push" again. WARNING: This will delete all data in those tables.')
    } else if (errorCount > 0) {
      // Generic guidance for other errors
      this.log('')
      this.log('Some files failed to push. Review the errors above.')
    }
  }

  /**
   * Prompt user to confirm deletion of orphan files
   */
  private async confirmOrphanDeletion(count: number): Promise<boolean> {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })

    return new Promise(resolve => {
      rl.question(`Delete these ${count} object(s) from Xano? [y/N] `, answer => {
        rl.close()
        resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes')
      })
    })
  }

  /**
   * Auto-create api_group.xs for new API group directories
   * Only creates if:
   * - Directory is directly under the apis path
   * - No api_group.xs or {groupName}.xs file exists
   */
  private ensureApiGroupFile(projectRoot: string, dirPath: string): void {
    const apisPath = this.paths.apis

    // Check if this directory is directly under apis path
    // e.g., "app/apis/new_group" when apis = "app/apis"
    const parent = dirname(dirPath)
    if (parent !== apisPath) {
      return // Not a direct child of apis directory
    }

    const groupDirName = basename(dirPath)
    const fullDirPath = join(projectRoot, dirPath)

    // Check if directory exists
    if (!existsSync(fullDirPath)) {
      // Create the directory
      mkdirSync(fullDirPath, { recursive: true })
    }

    // Check for existing api_group file (VSCode mode: api_group.xs, default mode: {name}.xs in parent)
    const apiGroupFile = join(fullDirPath, 'api_group.xs')
    const flatGroupFile = join(projectRoot, apisPath, `${groupDirName}.xs`)

    if (existsSync(apiGroupFile) || existsSync(flatGroupFile)) {
      return // API group file already exists
    }

    // Convert snake_case to Title Case
    const groupName = groupDirName
      .split('_')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ')

    // Create api_group.xs file
    const content = `api_group "${groupName}" {\n}\n`
    writeFileSync(apiGroupFile, content, 'utf8')

    this.log(`  Created ${dirPath}/api_group.xs`)
  }

  /**
   * Expand input paths to actual file paths
   * Priority:
   * 1. Exact file match (tracked or new)
   * 2. Directory prefix match (for directories)
   * 3. Type-based filtering (only for directory paths, not specific files)
   */
  private expandPaths(
    projectRoot: string,
    inputPaths: string[],
    objects: XanoObjectsFile
  ): string[] {
    const result: string[] = []
    const objectPaths = new Set(objects.map((o) => o.path))

    for (const inputPath of inputPaths) {
      // Normalize path: resolve from cwd first, then make relative to project root
      // This ensures "." in a subdirectory means that subdirectory, not project root
      const absolutePath = resolve(inputPath)
      const normalizedPath = relative(projectRoot, absolutePath)

      // Remove trailing slash for comparisons
      const cleanPath = normalizedPath.replace(/\/$/, '')
      const fullPath = join(projectRoot, cleanPath)

      // 1. Check for exact file match first (highest priority)
      if (existsSync(fullPath) && statSync(fullPath).isFile()) {
        result.push(cleanPath)
        continue
      }

      // 2. Check if it's a directory
      const isDir = normalizedPath.endsWith('/') ||
        (existsSync(fullPath) && statSync(fullPath).isDirectory())

      if (isDir) {
        // Auto-create api_group.xs for new API group directories
        this.ensureApiGroupFile(projectRoot, cleanPath)

        // Find all files under this directory (both tracked modified and new)
        const dirPrefix = cleanPath + '/'
        let foundAny = false

        // Add tracked files that are modified
        for (const obj of objects) {
          if (obj.path.startsWith(dirPrefix)) {
            const objFullPath = join(projectRoot, obj.path)
            if (existsSync(objFullPath)) {
              const currentSha256 = computeFileSha256(objFullPath)
              if (currentSha256 !== obj.sha256) {
                result.push(obj.path)
                foundAny = true
              }
            }
          }
        }

        // Add new files in directory
        if (existsSync(fullPath)) {
          const beforeCount = result.length
          this.walkDir(fullPath, projectRoot, objectPaths, result)
          if (result.length > beforeCount) foundAny = true
        }

        // If no files found via prefix, try type-based filtering
        if (!foundAny) {
          const types = resolveInputToTypes(
            cleanPath,
            this.paths,
            this.customResolveType
          )

          if (types && types.length > 0) {
            // Filter by type - find modified tracked files
            for (const obj of objects) {
              if (types.includes(obj.type)) {
                const objFullPath = join(projectRoot, obj.path)
                if (existsSync(objFullPath)) {
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
                const fullDir = join(projectRoot, typeDir)
                if (existsSync(fullDir)) {
                  this.walkDir(fullDir, projectRoot, objectPaths, result)
                }
              }
            }
          }
        }
      }
      // If file doesn't exist and it's not a directory, skip it (nothing to push)
    }

    return [...new Set(result)]
  }

  /**
   * Fetch API endpoint -> API group mappings from Xano
   * Returns a Map of endpoint_id -> apigroup_id
   */
  private async fetchApiGroupMappings(api: XanoApi): Promise<Map<number, number>> {
    const mappings = new Map<number, number>()

    // listApiEndpoints already fetches per-group and includes apigroup_id
    const endpointsResponse = await api.listApiEndpoints(1, 1000)
    if (endpointsResponse.ok && endpointsResponse.data?.items) {
      for (const endpoint of endpointsResponse.data.items) {
        if (endpoint.apigroup_id) {
          mappings.set(endpoint.id, endpoint.apigroup_id)
        }
      }
    }

    return mappings
  }

  /**
   * Find an existing endpoint in objects.json that matches the same verb+path
   * Used to detect duplicates before pushing
   */
  private findExistingEndpointByVerbPath(
    projectRoot: string,
    objects: XanoObjectsFile,
    verb: string,
    endpointPath: string,
    excludeFilePath?: string
  ): null | string {
    // Normalize the path for comparison
    const normalizedPath = endpointPath.replace(/^\/+/, '').toLowerCase()
    const normalizedVerb = verb.toUpperCase()

    for (const obj of objects) {
      if (obj.type !== 'api_endpoint') continue
      if (excludeFilePath && obj.path === excludeFilePath) continue

      // Read the file content to extract verb+path
      const fullPath = join(projectRoot, obj.path)
      if (!existsSync(fullPath)) continue

      try {
        const content = readFileSync(fullPath, 'utf8')
        const details = extractApiDetails(content)
        if (details) {
          const objPath = details.path.replace(/^\/+/, '').toLowerCase()
          if (details.verb.toUpperCase() === normalizedVerb && objPath === normalizedPath) {
            return obj.path
          }
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return null
  }

  /**
   * Find an existing workflow test in objects.json that matches the same name
   * Used to detect duplicates before pushing (Xano uses NAME for uniqueness, not filename)
   */
  private findExistingWorkflowTestByName(
    projectRoot: string,
    objects: XanoObjectsFile,
    testName: string,
    excludeFilePath?: string
  ): null | string {
    const normalizedName = testName.toLowerCase()

    for (const obj of objects) {
      if (obj.type !== 'workflow_test') continue
      if (excludeFilePath && obj.path === excludeFilePath) continue

      // Read the file content to extract the test name
      const fullPath = join(projectRoot, obj.path)
      if (!existsSync(fullPath)) continue

      try {
        const content = readFileSync(fullPath, 'utf8')
        const objName = extractName(content)
        if (objName && objName.toLowerCase() === normalizedName) {
          return obj.path
        }
      } catch {
        // Skip files that can't be read
      }
    }

    return null
  }

  /**
   * Find objects in objects.json whose local files have been deleted
   */
  private findOrphanObjects(projectRoot: string, objects: XanoObjectsFile): XanoObjectsFile {
    return objects.filter((obj) => {
      const fullPath = join(projectRoot, obj.path)
      return !existsSync(fullPath)
    })
  }

  /**
   * Find all modified or new files
   */
  private getAllChangedFiles(projectRoot: string, objects: XanoObjectsFile): string[] {
    const changedFiles: string[] = []

    // Check existing objects for modifications
    for (const obj of objects) {
      const fullPath = join(projectRoot, obj.path)
      if (existsSync(fullPath)) {
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
      const fullDir = join(projectRoot, dir)
      if (existsSync(fullDir)) {
        this.walkDir(fullDir, projectRoot, knownPaths, changedFiles)
      }
    }

    return changedFiles
  }

  /**
   * Get the configured directory for a given type
   */
  private getDirectoryForType(type: string): string | undefined {
    switch (type) {
      case 'addon': { return this.paths.addOns
      }

      case 'api_endpoint':
      case 'api_group': { return this.paths.apis
      }

      case 'function': { return this.paths.functions
      }

      case 'middleware': { return this.paths.middlewares
      }

      case 'table': { return this.paths.tables
      }

      case 'table_trigger': { return this.paths.tableTriggers || this.paths.tables
      }

      case 'task': { return this.paths.tasks
      }

      case 'workflow_test': { return this.paths.workflowTests
      }

      default: { return undefined
      }
    }
  }

  private async pushFile(
    projectRoot: string,
    filePath: string,
    api: XanoApi,
    objects: XanoObjectsFile
  ): Promise<{ error?: string; objects: XanoObjectsFile; success: boolean }> {
    const fullPath = join(projectRoot, filePath)

    if (!existsSync(fullPath)) {
      return { error: 'File not found', objects, success: false }
    }

    let content = readFileSync(fullPath, 'utf8')

    // Validate single block before pushing (unless skipped)
    if (!this.skipBlockValidation) {
      const blockError = validateSingleBlock(content)
      if (blockError) {
        return { error: blockError, objects, success: false }
      }
    }

    const existingObj = findObjectByPath(objects, filePath)
    let newId!: number // Will be assigned in all code paths before use
    let objectType: XanoObjectType

    if (existingObj?.id) {
      // Update existing object - use stored type (authoritative)
      objectType = existingObj.type

      // For api_endpoint, look up the API group from the path hierarchy (VSCode compatible)
      const updateOptions: { apigroup_id?: number } = {}
      if (objectType === 'api_endpoint') {
        const apiGroup = findApiGroupForEndpoint(objects, filePath)
        if (apiGroup) {
          updateOptions.apigroup_id = apiGroup.id // eslint-disable-line camelcase
        } else {
          // Extract expected group name from path for better error message
          const parts = filePath.split('/')
          const groupName = parts.length >= 3 ? parts.at(-2) : 'unknown'
          return {
            error: `Cannot find API group for endpoint. Expected "${groupName}.xs" file in apis directory. Run "xano pull --sync" to fetch API groups.`,
            objects,
            success: false,
          }
        }
      }

      let response = await api.updateObject(objectType, existingObj.id, content, updateOptions)
      let wasRecreated = false

      // Workaround for Xano bug: "name is already being used" on update
      // This happens when updating various object types - delete and recreate
      const nameConflictTypes: XanoObjectType[] = ['agent', 'agent_trigger', 'tool', 'mcp_server', 'mcp_server_trigger', 'function', 'task', 'middleware', 'addon']
      if (!response.ok && response.error?.includes('name is already being used') && nameConflictTypes.includes(objectType)) {
        // Delete the existing object
        const deleteResponse = await api.deleteObject(objectType, existingObj.id)
        if (!deleteResponse.ok) {
          return {
            error: `Failed to delete for recreate: ${deleteResponse.error}`,
            objects,
            success: false,
          }
        }

        // Create new object with same content
        const createResponse = await api.createObject(objectType, content)
        if (!createResponse.ok) {
          return {
            error: `Deleted but failed to recreate: ${createResponse.error}`,
            objects,
            success: false,
          }
        }

        if (!createResponse.data?.id) {
          return { error: 'No ID returned after recreate', objects, success: false }
        }

        // Update newId with the newly created object's ID
        newId = createResponse.data.id
        wasRecreated = true

        // Write back the xanoscript returned by Xano (includes real canonical, etc.)
        const responseData = createResponse.data as { id: number; xanoscript?: string | { status?: string; value: string } }
        if (responseData.xanoscript) {
          const xsValue = typeof responseData.xanoscript === 'string'
            ? responseData.xanoscript
            : responseData.xanoscript.value
          if (xsValue) {
            writeFileSync(fullPath, xsValue, 'utf8')
            content = xsValue
          }
        }

        // Skip the normal error handling below
        response = createResponse
      }

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

        // Provide helpful message for cryptic schema errors
        if (response.error?.includes('Invalid schema')) {
          return {
            error: `${response.error} - This usually means the file has invalid XanoScript syntax or structure. Check for: multiple blocks in one file, mismatched braces, or unsupported syntax.`,
            objects,
            success: false,
          }
        }

        // Provide helpful message for SQL errors (schema migrations, constraint violations)
        if (response.error?.includes('SQL Error')) {
          return {
            error: explainSqlError(response.error, objectType),
            objects,
            success: false,
          }
        }

        return { error: response.error || 'Update failed', objects, success: false }
      }

      // Only set newId if we didn't already set it in the workaround above
      if (!wasRecreated) {
        newId = existingObj.id
      }
    } else {
      // Create new object - detect type from content
      const detectedType = detectType(content)

      if (!detectedType) {
        return { error: 'Cannot detect XanoScript type from content. Ensure file starts with a valid keyword (function, query, table, task, addon, middleware, etc.)', objects, success: false }
      }

      objectType = detectedType

      // For api_endpoint, we need to find the apigroup_id from the path hierarchy
      const createOptions: { apigroup_id?: number } = {}
      let endpointDetails: ReturnType<typeof extractApiDetails> = null

      if (objectType === 'api_endpoint') {
        const apiGroup = findApiGroupForEndpoint(objects, filePath)
        if (apiGroup) {
          createOptions.apigroup_id = apiGroup.id // eslint-disable-line camelcase
        } else {
          // Extract expected group name from path for better error message
          const parts = filePath.split('/')
          const groupName = parts.length >= 3 ? parts.at(-2) : 'unknown'
          return {
            error: `Cannot find API group for new endpoint. Expected "${groupName}.xs" file in apis directory. Create the API group first or run "xano pull --sync".`,
            objects,
            success: false,
          }
        }

        // Check for local duplicates before pushing
        endpointDetails = extractApiDetails(content)
        if (endpointDetails) {
          const duplicateFile = this.findExistingEndpointByVerbPath(
            projectRoot,
            objects,
            endpointDetails.verb,
            endpointDetails.path,
            filePath
          )
          if (duplicateFile) {
            return {
              error: `Duplicate endpoint: ${endpointDetails.verb} /${endpointDetails.path} is already defined in "${duplicateFile}". Delete one of the conflicting files.`,
              objects,
              success: false,
            }
          }
        }
      }

      // For workflow_test, check for duplicate test names before pushing
      let workflowTestName: null | string = null
      if (objectType === 'workflow_test') {
        workflowTestName = extractName(content)
        if (workflowTestName) {
          const duplicateFile = this.findExistingWorkflowTestByName(
            projectRoot,
            objects,
            workflowTestName,
            filePath
          )
          if (duplicateFile) {
            return {
              error: `Duplicate workflow test: "${workflowTestName}" is already defined in "${duplicateFile}". Xano uses the test NAME (not filename) for uniqueness. Rename the test or delete one of the conflicting files.`,
              objects,
              success: false,
            }
          }
        }
      }

      const response = await api.createObject(objectType, content, createOptions)

      if (!response.ok) {
        if (response.status === 409 || response.error?.includes('already exists') || response.error?.includes('Duplicate record')) {
          // Provide context about which endpoint is duplicated
          if (objectType === 'api_endpoint' && endpointDetails) {
            return {
              error: `Endpoint ${endpointDetails.verb} /${endpointDetails.path} already exists on Xano. Run "xano pull --sync" to update mappings, then delete the duplicate local file.`,
              objects,
              success: false,
            }
          }

          // Provide context about which workflow test is duplicated
          if (objectType === 'workflow_test' && workflowTestName) {
            return {
              error: `Workflow test "${workflowTestName}" already exists on Xano (Xano uses NAME for uniqueness). Run "xano pull --sync" to update mappings, then rename or delete the duplicate.`,
              objects,
              success: false,
            }
          }

          return {
            error: 'Object already exists on Xano. Run "xano pull --sync" to update mappings.',
            objects,
            success: false,
          }
        }

        // Provide helpful message for cryptic schema errors
        if (response.error?.includes('Invalid schema')) {
          return {
            error: `${response.error} - This usually means the file has invalid XanoScript syntax or structure. Check for: multiple blocks in one file, mismatched braces, or unsupported syntax.`,
            objects,
            success: false,
          }
        }

        // Provide helpful message for SQL errors (schema migrations, constraint violations)
        if (response.error?.includes('SQL Error')) {
          return {
            error: explainSqlError(response.error, objectType),
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

      // Write back the xanoscript returned by Xano (includes real canonical, etc.)
      const responseData = response.data as { id: number; xanoscript?: string | { status?: string; value: string } }
      if (responseData.xanoscript) {
        const xsValue = typeof responseData.xanoscript === 'string'
          ? responseData.xanoscript
          : responseData.xanoscript.value
        if (xsValue) {
          writeFileSync(fullPath, xsValue, 'utf8')
          content = xsValue // Update content for objects.json
        }
      }
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
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        this.walkDir(fullPath, projectRoot, knownPaths, newFiles)
      } else if (entry.name.endsWith('.xs')) {
        const relativePath = relative(projectRoot, fullPath)
        if (!knownPaths.has(relativePath)) {
          newFiles.push(relativePath)
        }
      }
    }
  }
}
