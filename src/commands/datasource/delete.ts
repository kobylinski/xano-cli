import { Args, Command, Flags } from '@oclif/core'

import {
  getProfile,
  XanoApi,
} from '../../lib/api.js'
import {
  findProjectRoot,
  isInitialized,
  loadLocalConfig,
} from '../../lib/project.js'

export default class DataSourceDelete extends Command {
  static args = {
    label: Args.string({
      description: 'Data source label (name)',
      required: true,
    }),
  }
  static description = 'Delete a data source'
  static examples = [
    '<%= config.bin %> datasource:delete staging',
    '<%= config.bin %> datasource:delete test --force',
  ]
  static flags = {
    force: Flags.boolean({
      char: 'f',
      default: false,
      description: 'Skip confirmation',
    }),
    profile: Flags.string({
      char: 'p',
      description: 'Profile to use',
      env: 'XANO_PROFILE',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DataSourceDelete)

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

    const profile = getProfile(flags.profile, config.profile)
    if (!profile) {
      this.error('No profile found. Run "xano init" first.')
    }

    if (!flags.force) {
      this.log(`About to delete data source: ${args.label}`)
      this.log('Use --force to confirm deletion')
      return
    }

    const api = new XanoApi(profile, config.workspaceId, config.branch)
    const response = await api.deleteDataSource(args.label)

    if (!response.ok) {
      this.error(`Failed to delete data source: ${response.error}`)
    }

    this.log(`Deleted data source: ${args.label}`)
  }
}
