import { Args, Command, Flags } from '@oclif/core'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { XanoObjectsFile } from '../../lib/types.js'

import {
  getProfile,
  XanoApi,
} from '../../lib/api.js'
import { computeSha256, loadObjects } from '../../lib/objects.js'
import {
  findProjectRoot,
  isInitialized,
  loadLocalConfig,
  saveLocalConfig,
} from '../../lib/project.js'
import { fetchAllObjects } from '../../lib/sync.js'

export default class Branch extends Command {
  static args = {
    branch: Args.string({
      description: 'Branch name to switch to, or "list" to list branches',
      required: false,
    }),
  }
  static description = 'Show or switch Xano branch (safe switch by default)'
  static examples = [
    '<%= config.bin %> branch',
    '<%= config.bin %> branch list',
    '<%= config.bin %> branch v2',
    '<%= config.bin %> branch v2 --force',
    '<%= config.bin %> branch v2 --sync',
  ]
  static flags = {
    force: Flags.boolean({
      char: 'f',
      default: false,
      description: 'Force switch even if local changes exist',
    }),
    list: Flags.boolean({
      char: 'l',
      default: false,
      description: 'List available branches',
    }),
    profile: Flags.string({
      char: 'p',
      description: 'Profile to use',
      env: 'XANO_PROFILE',
    }),
    switch: Flags.string({
      char: 's',
      description: 'Switch to branch',
    }),
    sync: Flags.boolean({
      default: false,
      description: 'Sync (pull --sync) after switching branch',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Branch)

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

    // Determine action
    if (args.branch === 'list' || flags.list) {
      await this.listBranches(config, profile)
      return
    }

    const switchTo = args.branch || flags.switch

    if (switchTo) {
      await this.switchBranch(projectRoot, config, profile, switchTo, flags.force, flags.sync)
      return
    }

    // Default: show current branch
    this.log(`Current branch: ${config.branch}`)
    this.log('')
    this.log('Usage:')
    this.log('  xano branch list        List available branches')
    this.log('  xano branch <name>      Switch to branch (safe)')
    this.log('  xano branch <name> -f   Force switch (skip sync check)')
    this.log('  xano branch <name> --sync   Switch and sync new branch')
  }

  private async checkSyncStatus(
    projectRoot: string,
    config: ReturnType<typeof loadLocalConfig>,
    profile: ReturnType<typeof getProfile>
  ): Promise<{
    inSync: boolean
    localOnly: string[]
    modified: string[]
    remoteOnly: string[]
  }> {
    if (!config || !profile) {
      return { inSync: true, localOnly: [], modified: [], remoteOnly: [] }
    }

    this.log(`Checking sync status for branch "${config.branch}"...`)

    const api = new XanoApi(profile, config.workspaceId, config.branch)
    const objects = loadObjects(projectRoot) || []

    // Fetch remote state
    const fetchResult = await fetchAllObjects(api)
    const remoteObjects = fetchResult.objects

    // Build maps for comparison
    const localByPath = new Map<string, XanoObjectsFile[number]>()
    for (const obj of objects) {
      localByPath.set(obj.path, obj)
    }

    const remoteByPath = new Map<string, typeof remoteObjects[number]>()
    for (const obj of remoteObjects) {
      // Generate path for remote object (simplified - use name as path indicator)
      const key = `${obj.type}:${obj.id}`
      remoteByPath.set(key, obj)
    }

    // Find local objects by their remote ID
    const localByRemoteId = new Map<string, XanoObjectsFile[number]>()
    for (const obj of objects) {
      if (obj.id) {
        const key = `${obj.type}:${obj.id}`
        localByRemoteId.set(key, obj)
      }
    }

    const modified: string[] = []
    const localOnly: string[] = []
    const remoteOnly: string[] = []

    // Check local objects against remote
    for (const localObj of objects) {
      const key = `${localObj.type}:${localObj.id}`
      const remoteObj = remoteByPath.get(key)

      if (remoteObj) {
        // Compare content
        const localPath = join(projectRoot, localObj.path)
        if (existsSync(localPath)) {
          const localContent = readFileSync(localPath, 'utf8')
          const localSha = computeSha256(localContent)
          const remoteSha = computeSha256(remoteObj.xanoscript)

          if (localSha !== remoteSha) {
            modified.push(localObj.path)
          }
        }
      } else {
        // Local only (new file not on remote)
        localOnly.push(localObj.path)
      }
    }

    // Check for remote-only objects
    for (const remoteObj of remoteObjects) {
      const key = `${remoteObj.type}:${remoteObj.id}`
      if (!localByRemoteId.has(key)) {
        remoteOnly.push(`${remoteObj.type}/${remoteObj.name || remoteObj.id}`)
      }
    }

    const inSync = modified.length === 0 && localOnly.length === 0 && remoteOnly.length === 0

    return { inSync, localOnly, modified, remoteOnly }
  }

  private async listBranches(
    config: ReturnType<typeof loadLocalConfig>,
    profile: ReturnType<typeof getProfile>
  ): Promise<void> {
    if (!config || !profile) return

    const api = new XanoApi(profile, config.workspaceId, '')
    const response = await api.listBranches()

    if (!response.ok || !response.data) {
      this.error(`Failed to fetch branches: ${response.error}`)
    }

    this.log(`Branches for ${config.workspaceName}:\n`)

    // Filter out backup branches by default
    const branches = response.data.filter((b) => !b.backup)

    for (const branch of branches) {
      let displayLabel = branch.label
      const markers: string[] = []

      if (branch.label === config.branch) markers.push('current')
      if (branch.live) markers.push('live')

      if (markers.length > 0) {
        displayLabel += ` (${markers.join(', ')})`
      }

      const prefix = branch.label === config.branch ? '* ' : '  '
      this.log(`${prefix}${displayLabel}`)
    }
  }

  private async switchBranch(
    projectRoot: string,
    config: ReturnType<typeof loadLocalConfig>,
    profile: ReturnType<typeof getProfile>,
    branchName: string,
    force: boolean,
    syncAfter: boolean
  ): Promise<void> {
    if (!config || !profile) return

    // Verify branch exists
    const api = new XanoApi(profile, config.workspaceId, config.branch)
    const response = await api.listBranches()

    if (!response.ok || !response.data) {
      this.error(`Failed to fetch branches: ${response.error}`)
    }

    const branch = response.data.find((b) => b.label === branchName)

    if (!branch) {
      const availableBranches = response.data.filter((b) => !b.backup).map((b) => `  ${b.label}`).join('\n')
      this.error(`Branch "${branchName}" not found.\n\nAvailable branches:\n${availableBranches}`)
    }

    if (config.branch === branchName) {
      this.log(`Already on branch "${branchName}"`)
      return
    }

    // Safe switch: check if local is in sync with remote (unless --force)
    if (!force) {
      const syncStatus = await this.checkSyncStatus(projectRoot, config, profile)

      if (!syncStatus.inSync) {
        this.log('Cannot switch branch: local changes detected.\n')

        if (syncStatus.modified.length > 0) {
          this.log(`Modified (${syncStatus.modified.length}):`)
          for (const f of syncStatus.modified.slice(0, 5)) {
            this.log(`  M ${f}`)
          }

          if (syncStatus.modified.length > 5) {
            this.log(`  ... and ${syncStatus.modified.length - 5} more`)
          }
        }

        if (syncStatus.localOnly.length > 0) {
          this.log(`\nLocal only (${syncStatus.localOnly.length}):`)
          for (const f of syncStatus.localOnly.slice(0, 5)) {
            this.log(`  A ${f}`)
          }

          if (syncStatus.localOnly.length > 5) {
            this.log(`  ... and ${syncStatus.localOnly.length - 5} more`)
          }
        }

        if (syncStatus.remoteOnly.length > 0) {
          this.log(`\nRemote only (${syncStatus.remoteOnly.length}):`)
          for (const f of syncStatus.remoteOnly.slice(0, 5)) {
            this.log(`  R ${f}`)
          }

          if (syncStatus.remoteOnly.length > 5) {
            this.log(`  ... and ${syncStatus.remoteOnly.length - 5} more`)
          }
        }

        this.log('')
        this.log('Options:')
        this.log('  xano push              Push local changes first')
        this.log('  xano pull --force      Discard local changes')
        this.log(`  xano branch ${branchName} --force   Force switch (may lose changes)`)
        this.error('Resolve changes before switching branch.')
      }

      this.log(`Branch "${config.branch}" is in sync.`)
    }

    // Update config
    config.branch = branchName
    saveLocalConfig(projectRoot, config)

    this.log(`Switched to branch "${branchName}"`)

    if (syncAfter) {
      this.log('')
      this.log('Syncing new branch...')
      // Run sync by fetching and updating objects
      const newApi = new XanoApi(profile, config.workspaceId, branchName)
      await this.syncBranch(projectRoot, newApi, config)
    } else {
      this.log('')
      this.log('Run "xano pull --sync" to update local files for this branch.')
    }
  }

  private async syncBranch(
    projectRoot: string,
    api: XanoApi,
    config: ReturnType<typeof loadLocalConfig>
  ): Promise<void> {
    if (!config) return

    const fetchResult = await fetchAllObjects(api)
    const allObjects = fetchResult.objects

    this.log(`Fetched ${allObjects.length} objects from branch "${config.branch}"`)

    // Update objects.json with new branch data
    const { saveGroups, saveObjects } = await import('../../lib/objects.js')
    const { generateObjectPath } = await import('../../lib/sync.js')
    const { loadConfig } = await import('../../lib/config.js')
    const { getDefaultPaths } = await import('../../lib/project.js')

    const loadedConfig = await loadConfig(projectRoot)
    const paths = loadedConfig?.config?.paths || getDefaultPaths()
    const naming = loadedConfig?.config?.naming || 'default'

    const newObjects: XanoObjectsFile = []

    for (const obj of allObjects) {
      const filePath = generateObjectPath(obj, paths, {
        customResolver: loadedConfig?.resolvePath,
        customSanitize: loadedConfig?.sanitize,
        naming,
      })
      if (!filePath) continue

      newObjects.push({
        id: obj.id,
        original: '',
        path: filePath,
        sha256: computeSha256(obj.xanoscript),
        staged: false,
        status: 'unchanged',
        type: obj.type,
      })

      // Write file
      const fullPath = join(projectRoot, filePath)
      const dir = dirname(fullPath)
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }

      writeFileSync(fullPath, obj.xanoscript, 'utf8')
    }

    saveObjects(projectRoot, newObjects)
    saveGroups(projectRoot, fetchResult.apiGroups)

    this.log(`Synced ${newObjects.length} files.`)
  }
}
