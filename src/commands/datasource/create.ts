import { Args, Command, Flags } from '@oclif/core'

import type { DatasourceAccessLevel } from '../../lib/types.js'

import {
  getProfile,
  XanoApi,
} from '../../lib/api.js'
import {
  findProjectRoot,
  isInitialized,
  loadDatasourcesConfig,
  loadLocalConfig,
  saveDatasourcesConfig,
} from '../../lib/project.js'

const ACCESS_LEVELS: DatasourceAccessLevel[] = ['locked', 'read-only', 'read-write']

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
    '<%= config.bin %> datasource:create test --permission read-write',
    '<%= config.bin %> datasource:create staging --permission read-only --default',
  ]
  static flags = {
    color: Flags.string({
      char: 'c',
      default: '#808080',
      description: 'Color for the data source (hex)',
    }),
    default: Flags.boolean({
      default: false,
      description: 'Set as default datasource',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    permission: Flags.string({
      char: 'm',
      default: 'read-write',
      description: 'Initial permission level',
      options: ACCESS_LEVELS,
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

    const profile = getProfile(flags.profile, config.profile)
    if (!profile) {
      this.error('No profile found. Run "xano init" first.')
    }

    const api = new XanoApi(profile, config.workspaceId, config.branch)
    const response = await api.createDataSource(args.label, flags.color)

    if (!response.ok) {
      if (flags.json) {
        this.log(JSON.stringify({
          datasource: args.label,
          error: response.error,
          success: false,
        }, null, 2))
        return
      }

      this.error(`Failed to create data source: ${response.error}`)
    }

    // Add permission to datasources.json
    const permission = flags.permission as DatasourceAccessLevel
    const datasourcesConfig = loadDatasourcesConfig(projectRoot) || {}

    if (!datasourcesConfig.datasources) {
      datasourcesConfig.datasources = {}
    }

    datasourcesConfig.datasources[args.label] = permission

    // Set as default if requested
    if (flags.default) {
      datasourcesConfig.defaultDatasource = args.label
    }

    saveDatasourcesConfig(projectRoot, datasourcesConfig)

    if (flags.json) {
      this.log(JSON.stringify({
        color: flags.color,
        datasource: args.label,
        default: flags.default,
        permission,
        success: true,
      }, null, 2))
      return
    }

    this.log(`Created data source: ${args.label} (${flags.color})`)
    this.log(`  Permission: ${permission}`)
    if (flags.default) {
      this.log(`  Set as default datasource`)
    }
  }
}
