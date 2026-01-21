import { Args, Flags } from '@oclif/core'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import type { XanoObjectsFile } from '../../lib/types.js'

import BaseCommand, { isAgentMode } from '../../base-command.js'
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

export default class Branch extends BaseCommand {
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
    '<%= config.bin %> branch list --json',
    '<%= config.bin %> branch list --profile myprofile --workspace 123 --json',
    '<%= config.bin %> branch v2',
    '<%= config.bin %> branch v2 --force',
    '<%= config.bin %> branch v2 --sync',
  ]
static flags = {
    ...BaseCommand.baseFlags,
    force: Flags.boolean({
      char: 'f',
      default: false,
      description: 'Force switch even if local changes exist',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON (takes precedence over --agent)',
    }),
    list: Flags.boolean({
      char: 'l',
      default: false,
      description: 'List available branches',
    }),
    switch: Flags.string({
      char: 's',
      description: 'Switch to branch',
    }),
    sync: Flags.boolean({
      default: false,
      description: 'Sync (pull --sync) after switching branch',
    }),
    workspace: Flags.integer({
      char: 'w',
      description: 'Workspace ID (for standalone branch listing without project)',
    }),
  }
private agentMode = false
private jsonMode = false

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Branch)

    // --json takes precedence over --agent
    this.jsonMode = flags.json
    this.agentMode = !flags.json && isAgentMode(flags.agent)

    // Standalone mode: list branches with --profile and --workspace (no project needed)
    const isListMode = args.branch === 'list' || flags.list
    if (isListMode && flags.workspace) {
      const profile = getProfile(flags.profile)
      if (!profile) {
        if (this.jsonMode) {
          this.log(JSON.stringify({ error: 'No profile found', success: false }, null, 2))
          this.exit(1)
        }

        this.error('No profile found. Run "xano init" first.')
      }

      await this.listBranchesStandalone(profile, flags.workspace)
      return
    }

    // Project-based mode
    const projectRoot = findProjectRoot()
    if (!projectRoot) {
      if (this.jsonMode) {
        this.log(JSON.stringify({ error: 'Not in a xano project', success: false }, null, 2))
        this.exit(1)
      }

      this.error('Not in a xano project. Run "xano init" first.')
    }

    if (!isInitialized(projectRoot)) {
      if (this.jsonMode) {
        this.log(JSON.stringify({ error: 'Project not initialized', success: false }, null, 2))
        this.exit(1)
      }

      this.error('Project not initialized. Run "xano init" first.')
    }

    const config = loadLocalConfig(projectRoot)
    if (!config) {
      this.error('Failed to load .xano/config.json')
    }

    const profile = getProfile(flags.profile, config.profile)
    if (!profile) {
      if (this.jsonMode) {
        this.log(JSON.stringify({ error: 'No profile found', success: false }, null, 2))
        this.exit(1)
      }

      this.error('No profile found. Run "xano init" first.')
    }

    // Determine action
    if (isListMode) {
      await this.listBranches(config, profile)
      return
    }

    const switchTo = args.branch || flags.switch

    if (switchTo) {
      await this.switchBranch(projectRoot, config, profile, switchTo, flags.force, flags.sync)
      return
    }

    // Default: show current branch
    if (this.jsonMode) {
      this.log(JSON.stringify({
        branch: config.branch,
        workspace: config.workspaceName,
        workspaceId: config.workspaceId,
      }, null, 2))
    } else if (this.agentMode) {
      this.log('AGENT_BRANCH_CURRENT:')
      this.log(`branch=${config.branch}`)
      this.log(`workspace=${config.workspaceName}`)
      this.log('AGENT_SUGGEST: Use "xano branch list" to see available branches or "xano branch <name>" to switch')
    } else {
      this.log(`Current branch: ${config.branch}`)
      this.log('')
      this.log('Usage:')
      this.log('  xano branch list        List available branches')
      this.log('  xano branch <name>      Switch to branch (safe)')
      this.log('  xano branch <name> -f   Force switch (skip sync check)')
      this.log('  xano branch <name> --sync   Switch and sync new branch')
    }
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

    if (!this.agentMode) {
      this.log(`Checking sync status for branch "${config.branch}"...`)
    }

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
      if (this.jsonMode) {
        this.log(JSON.stringify({ error: response.error, success: false }, null, 2))
        this.exit(1)
      }

      this.error(`Failed to fetch branches: ${response.error}`)
    }

    // Filter out backup branches by default
    const branches = response.data.filter((b) => !b.backup)
    const liveBranch = branches.find(b => b.live)

    // JSON output (takes precedence)
    if (this.jsonMode) {
      this.log(JSON.stringify({
        branches: branches.map(b => ({
          isLive: b.live || false,
          name: b.label,
        })),
        current: config.branch,
        live: liveBranch?.label || null,
      }, null, 2))
      return
    }

    // Agent mode output
    if (this.agentMode) {
      this.log('AGENT_BRANCH_LIST:')
      this.log(`current=${config.branch}`)
      this.log(`live=${liveBranch?.label || ''}`)
      this.log(`workspace=${config.workspaceName}`)
      this.log('AGENT_BRANCHES:')
      for (const branch of branches) {
        const markers: string[] = []
        if (branch.label === config.branch) markers.push('current')
        if (branch.live) markers.push('live')
        const suffix = markers.length > 0 ? ` (${markers.join(', ')})` : ''
        this.log(`- ${branch.label}${suffix}`)
      }

      this.log('AGENT_SUGGEST: Use "xano branch <name>" to switch branches')
      return
    }

    // Human-readable output
    this.log(`Branches for ${config.workspaceName}:\n`)

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

  private async listBranchesStandalone(
    profile: ReturnType<typeof getProfile>,
    workspaceId: number
  ): Promise<void> {
    if (!profile) return

    const api = new XanoApi(profile, workspaceId, '')
    const response = await api.listBranches()

    if (!response.ok || !response.data) {
      if (this.jsonMode) {
        this.log(JSON.stringify({ error: response.error, success: false }, null, 2))
        this.exit(1)
      }

      this.error(`Failed to fetch branches: ${response.error}`)
    }

    // Filter out backup branches by default
    const branches = response.data.filter((b) => !b.backup)
    const liveBranch = branches.find(b => b.live)

    // JSON output (takes precedence)
    if (this.jsonMode) {
      this.log(JSON.stringify({
        branches: branches.map(b => ({
          isLive: b.live || false,
          name: b.label,
        })),
        live: liveBranch?.label || null,
      }, null, 2))
      return
    }

    // Agent mode output
    if (this.agentMode) {
      this.log('AGENT_BRANCH_LIST:')
      this.log(`live=${liveBranch?.label || ''}`)
      this.log('AGENT_BRANCHES:')
      for (const branch of branches) {
        const markers: string[] = []
        if (branch.live) markers.push('live')
        const suffix = markers.length > 0 ? ` (${markers.join(', ')})` : ''
        this.log(`- ${branch.label}${suffix}`)
      }

      return
    }

    // Human-readable output
    this.log('Available branches:\n')

    for (const branch of branches) {
      let displayLabel = branch.label
      if (branch.live) {
        displayLabel += ' (live)'
      }

      const prefix = branch.live ? '* ' : '  '
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
      if (this.agentMode) {
        const availableBranches = response.data.filter((b) => !b.backup).map((b) => b.label)
        this.log('AGENT_ERROR: branch_not_found')
        this.log(`AGENT_MESSAGE: Branch "${branchName}" not found.`)
        this.log('AGENT_BRANCHES:')
        for (const b of availableBranches) {
          this.log(`- ${b}`)
        }

        this.log('AGENT_ACTION: Ask user which branch they want to switch to from the list above.')
        this.exit(1)
      }

      const availableBranches = response.data.filter((b) => !b.backup).map((b) => `  ${b.label}`).join('\n')
      this.error(`Branch "${branchName}" not found.\n\nAvailable branches:\n${availableBranches}`)
    }

    if (config.branch === branchName) {
      if (this.agentMode) {
        this.log('AGENT_BRANCH_ALREADY_CURRENT:')
        this.log(`branch=${branchName}`)
      } else {
        this.log(`Already on branch "${branchName}"`)
      }

      return
    }

    // Safe switch: check if local is in sync with remote (unless --force)
    if (!force) {
      const syncStatus = await this.checkSyncStatus(projectRoot, config, profile)

      if (!syncStatus.inSync) {
        if (this.agentMode) {
          this.log('AGENT_ERROR: local_changes_detected')
          this.log('AGENT_MESSAGE: Cannot switch branch due to local changes.')
          this.log(`target_branch=${branchName}`)
          this.log(`current_branch=${config.branch}`)
          this.log(`modified_count=${syncStatus.modified.length}`)
          this.log(`local_only_count=${syncStatus.localOnly.length}`)
          this.log(`remote_only_count=${syncStatus.remoteOnly.length}`)
          if (syncStatus.modified.length > 0) {
            this.log('AGENT_MODIFIED:')
            for (const f of syncStatus.modified.slice(0, 10)) {
              this.log(`- ${f}`)
            }
          }

          if (syncStatus.localOnly.length > 0) {
            this.log('AGENT_LOCAL_ONLY:')
            for (const f of syncStatus.localOnly.slice(0, 10)) {
              this.log(`- ${f}`)
            }
          }

          if (syncStatus.remoteOnly.length > 0) {
            this.log('AGENT_REMOTE_ONLY:')
            for (const f of syncStatus.remoteOnly.slice(0, 10)) {
              this.log(`- ${f}`)
            }
          }

          this.log('AGENT_OPTIONS:')
          this.log('- Run "xano push" to push local changes first')
          this.log('- Run "xano pull --force" to discard local changes')
          this.log(`- Run "xano branch ${branchName} --force" to force switch (may lose changes)`)
          this.log('AGENT_ACTION: Ask user how to resolve the local changes before switching.')
          this.exit(1)
        }

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

      if (!this.agentMode) {
        this.log(`Branch "${config.branch}" is in sync.`)
      }
    }

    // Update config
    config.branch = branchName
    saveLocalConfig(projectRoot, config)

    if (this.agentMode) {
      this.log('AGENT_BRANCH_SWITCHED:')
      this.log(`from=${config.branch}`)
      this.log(`to=${branchName}`)
      this.log(`synced=${syncAfter}`)
    } else {
      this.log(`Switched to branch "${branchName}"`)
    }

    if (syncAfter) {
      if (!this.agentMode) {
        this.log('')
        this.log('Syncing new branch...')
      }

      // Run sync by fetching and updating objects
      const newApi = new XanoApi(profile, config.workspaceId, branchName)
      await this.syncBranch(projectRoot, newApi, config)
    } else if (this.agentMode) {
      this.log('AGENT_SUGGEST: Run "xano pull --sync" to update local files for this branch')
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

    if (!this.agentMode) {
      this.log(`Fetched ${allObjects.length} objects from branch "${config.branch}"`)
    }

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

    if (this.agentMode) {
      this.log('AGENT_SYNC_COMPLETE:')
      this.log(`files_synced=${newObjects.length}`)
      this.log(`branch=${config.branch}`)
    } else {
      this.log(`Synced ${newObjects.length} files.`)
    }
  }
}
