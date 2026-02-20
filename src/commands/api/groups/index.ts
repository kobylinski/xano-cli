import { Command, Flags } from '@oclif/core'

import {
  getMissingProfileError,
  getProfile,
  XanoApi,
} from '../../../lib/api.js'
import {
  findProjectRoot,
  isInitialized,
  loadCliConfig,
  loadEffectiveConfig,
} from '../../../lib/project.js'

export default class ApiGroups extends Command {
  static description = 'List API groups with their canonical IDs (for live API calls)'
  static examples = [
    '<%= config.bin %> api:groups',
    '<%= config.bin %> api:groups --json',
  ]
  static flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    profile: Flags.string({
      description: 'Profile to use',
      env: 'XANO_PROFILE',
    }),
  }

  async run(): Promise<void> {
    const { flags } = await this.parse(ApiGroups)

    const projectRoot = findProjectRoot()
    if (!projectRoot) {
      this.error('Not in a xano project. Run "xano init" first.')
    }

    if (!isInitialized(projectRoot)) {
      this.error('Project not initialized. Run "xano init" first.')
    }

    const config = loadEffectiveConfig(projectRoot)
    if (!config) {
      this.error('Failed to load .xano/config.json')
    }

    // Profile is ONLY read from .xano/cli.json - no flag overrides
    const cliConfig = loadCliConfig(projectRoot)
    const cliProfile = cliConfig?.profile

    const profileError = getMissingProfileError(cliProfile)
    if (profileError) {
      this.error(profileError.humanOutput)
    }

    const profile = getProfile(cliProfile)
    if (!profile) {
      this.error('Profile not found in credentials. Run "xano init" to configure.')
    }

    const api = new XanoApi(profile, config.workspaceId, config.branch)

    const response = await api.listApiGroups(1, 1000)

    if (!response.ok) {
      this.error(`Failed to list API groups: ${response.error}`)
    }

    const groups = response.data?.items || []

    if (groups.length === 0) {
      this.log('No API groups found.')
      return
    }

    // Fetch canonical IDs for each group
    const groupsWithCanonical = await Promise.all(
      groups.map(async (group) => {
        const details = await api.getApiGroupWithCanonical(group.id)
        return {
          canonical: details.data?.canonical || '(unknown)',
          id: group.id,
          name: group.name,
        }
      })
    )

    if (flags.json) {
      this.log(JSON.stringify(groupsWithCanonical, null, 2))
      return
    }

    this.log('API Groups:')
    this.log('')
    for (const group of groupsWithCanonical) {
      this.log(`  ${group.name}`)
      this.log(`    ID: ${group.id}, Canonical: ${group.canonical}`)
    }

    this.log('')
    this.log('Use group name or canonical ID with "xano api:call <group> <method> <path>" to invoke live endpoints.')
  }
}
