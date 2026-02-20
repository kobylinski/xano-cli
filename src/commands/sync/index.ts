import { Flags } from '@oclif/core'

import type {
  NamingMode,
  PathResolver,
  SanitizeFunction,
  XanoObjectsFile,
  XanoPaths,
} from '../../lib/types.js'

import BaseCommand, { isAgentMode } from '../../base-command.js'
import {
  getMissingProfileError,
  getProfile,
  XanoApi,
} from '../../lib/api.js'
import { loadConfig } from '../../lib/config.js'
import {
  computeSha256,
  encodeBase64,
  loadObjects,
  saveEndpoints,
  saveGroups,
  saveObjects,
  upsertObject,
} from '../../lib/objects.js'
import {
  findProjectRoot,
  getDefaultPaths,
  isInitialized,
  loadCliConfig,
  loadLocalConfig,
} from '../../lib/project.js'
import {
  fetchAllObjects,
  generateObjectPath,
} from '../../lib/sync.js'

export default class Sync extends BaseCommand {
  static description = 'Sync metadata from Xano (objects.json, groups.json) without pulling code files'
  static examples = [
    '<%= config.bin %> sync',
    '<%= config.bin %> sync --quiet',
  ]
  static flags = {
    ...BaseCommand.baseFlags,
    quiet: Flags.boolean({
      char: 'q',
      default: false,
      description: 'Only show summary, not individual objects',
    }),
  }
private customResolver?: PathResolver
  private customSanitize?: SanitizeFunction
  private naming?: NamingMode
  private paths!: XanoPaths

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

    // Load dynamic config (xano.js) if available
    // Precedence: defaults → xano.json → .xano/config.json
    const dynamicConfig = await loadConfig(projectRoot)
    if (dynamicConfig) {
      this.customResolver = dynamicConfig.resolvePath
      this.customSanitize = dynamicConfig.sanitize
    }

    this.paths = { ...getDefaultPaths(), ...dynamicConfig?.config.paths, ...config.paths }
    this.naming = config.naming || dynamicConfig?.config.naming

    // Profile is ONLY read from .xano/cli.json - no flag overrides
    const cliConfig = loadCliConfig(projectRoot)
    const cliProfile = cliConfig?.profile
    const agentMode = isAgentMode(flags.agent)

    // Check for missing profile - this is now an error
    const profileError = getMissingProfileError(cliProfile)
    if (profileError) {
      if (agentMode) {
        this.log(profileError.agentOutput)
      } else {
        this.error(profileError.humanOutput)
      }

      return
    }

    const profile = getProfile(cliProfile)
    if (!profile) {
      this.error('Profile not found in credentials. Run "xano init" to configure.')
    }

    const api = new XanoApi(profile, config.workspaceId, config.branch)

    // Fetch metadata from Xano
    if (!flags.quiet) {
      this.log('Syncing metadata from Xano...')
      this.log(`  Workspace: ${config.workspaceName}`)
      this.log(`  Branch: ${config.branch}`)
      this.log('')
    }

    const fetchResult = await fetchAllObjects(api, flags.quiet ? undefined : (msg) => this.log(msg))

    // Load existing objects to track changes
    const existingObjects = loadObjects(projectRoot)
    const existingById = new Map<string, XanoObjectsFile[0]>()
    for (const obj of existingObjects) {
      existingById.set(`${obj.type}:${obj.id}`, obj)
    }

    // Build new objects.json
    let objects: XanoObjectsFile = []
    let newCount = 0
    let updatedCount = 0

    for (const obj of fetchResult.objects) {
      const filePath = generateObjectPath(obj, this.paths, {
        customResolver: this.customResolver,
        customSanitize: this.customSanitize,
        naming: this.naming,
      })

      const key = `${obj.type}:${obj.id}`
      const existing = existingById.get(key)
      const newSha256 = computeSha256(obj.xanoscript)

      if (!existing) {
        newCount++
      } else if (newSha256 !== existing.sha256) {
        updatedCount++
      }

      objects = upsertObject(objects, filePath, {
        id: obj.id,
        original: encodeBase64(obj.xanoscript),
        sha256: newSha256,
        status: 'unchanged',
        type: obj.type,
      })
    }

    // Count removed objects
    const remoteKeys = new Set(fetchResult.objects.map(o => `${o.type}:${o.id}`))
    const removedCount = existingObjects.filter(o => !remoteKeys.has(`${o.type}:${o.id}`)).length

    // Save metadata files
    saveObjects(projectRoot, objects)
    saveGroups(projectRoot, fetchResult.apiGroups)
    saveEndpoints(projectRoot, fetchResult.endpoints)

    // Summary
    this.log('')
    this.log(`Synced ${objects.length} objects`)
    if (newCount > 0 || updatedCount > 0 || removedCount > 0) {
      const changes = []
      if (newCount > 0) changes.push(`${newCount} new`)
      if (updatedCount > 0) changes.push(`${updatedCount} updated`)
      if (removedCount > 0) changes.push(`${removedCount} removed`)
      this.log(`  Changes: ${changes.join(', ')}`)
    }

    this.log('')
    this.log('Metadata synced. Run "xano pull" to download code files.')
  }
}
