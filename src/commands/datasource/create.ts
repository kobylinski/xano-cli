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

export default class DataSourceCreate extends Command {
  static args = {
    label: Args.string({
      description: 'Data source label (name)',
      required: true,
    }),
  }
  static description = 'Create a new data source'
  static examples = [
    '<%= config.bin %> datasource:create staging',
    '<%= config.bin %> datasource:create test --color "#FF5500"',
  ]
  static flags = {
    color: Flags.string({
      char: 'c',
      default: '#808080',
      description: 'Color for the data source (hex)',
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

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DataSourceCreate)

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

    const api = new XanoApi(profile, config.workspaceId, config.branch)
    const response = await api.createDataSource(args.label, flags.color)

    if (!response.ok) {
      this.error(`Failed to create data source: ${response.error}`)
    }

    if (flags.json) {
      this.log(JSON.stringify(response.data, null, 2))
      return
    }

    this.log(`Created data source: ${args.label} (${flags.color})`)
  }
}
