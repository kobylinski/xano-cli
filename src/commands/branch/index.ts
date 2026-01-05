import { Args, Command, Flags } from '@oclif/core'
import inquirer from 'inquirer'

import {
  getProfile,
  XanoApi,
} from '../../lib/api.js'
import {
  findProjectRoot,
  isInitialized,
  loadLocalConfig,
  saveLocalConfig,
} from '../../lib/project.js'

export default class Branch extends Command {
  static args = {
    branch: Args.string({
      description: 'Branch name to switch to, or "list" to list branches',
      required: false,
    }),
  }
static description = 'Show or switch Xano branch'
static examples = [
    '<%= config.bin %> branch',
    '<%= config.bin %> branch list',
    '<%= config.bin %> branch v2',
    '<%= config.bin %> branch --switch live',
  ]
static flags = {
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
      await this.switchBranch(projectRoot, config, profile, switchTo)
      return
    }

    // Default: show current branch
    this.log(`Current branch: ${config.branch}`)
    this.log('')
    this.log('Usage:')
    this.log('  xano branch list      List available branches')
    this.log('  xano branch <name>    Switch to branch')
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

    for (const branch of response.data) {
      let label = branch.name
      const markers: string[] = []

      if (branch.name === config.branch) markers.push('current')
      if (branch.is_default) markers.push('default')
      if (branch.is_live) markers.push('live')

      if (markers.length > 0) {
        label += ` (${markers.join(', ')})`
      }

      const prefix = branch.name === config.branch ? '* ' : '  '
      this.log(`${prefix}${label}`)
    }
  }

  private async switchBranch(
    projectRoot: string,
    config: ReturnType<typeof loadLocalConfig>,
    profile: ReturnType<typeof getProfile>,
    branchName: string
  ): Promise<void> {
    if (!config || !profile) return

    // Verify branch exists
    const api = new XanoApi(profile, config.workspaceId, '')
    const response = await api.listBranches()

    if (!response.ok || !response.data) {
      this.error(`Failed to fetch branches: ${response.error}`)
    }

    const branch = response.data.find((b) => b.name === branchName)

    if (!branch) {
      this.error(`Branch "${branchName}" not found.\n\nAvailable branches:\n${response.data.map((b) => `  ${b.name}`).join('\n')}`)
    }

    if (config.branch === branchName) {
      this.log(`Already on branch "${branchName}"`)
      return
    }

    // Update config
    config.branch = branchName
    saveLocalConfig(projectRoot, config)

    this.log(`Switched to branch "${branchName}"`)
    this.log('')
    this.log('Note: Run "xano sync" to update object mappings for this branch.')
  }
}
