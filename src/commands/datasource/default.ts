import { Args, Flags } from '@oclif/core'

import BaseCommand, { isAgentMode } from '../../base-command.js'
import {
  getProfile,
  XanoApi,
} from '../../lib/api.js'
import {
  findProjectRoot,
  isInitialized,
  loadLocalConfig,
  loadXanoJson,
  saveLocalConfig,
  saveXanoJson,
} from '../../lib/project.js'

export default class DataSourceDefault extends BaseCommand {
  static args = {
    name: Args.string({
      description: 'Datasource name to set as default (omit to show current)',
      required: false,
    }),
  }
  static description = 'Get or set the default datasource for data commands'
  static examples = [
    '<%= config.bin %> datasource:default',
    '<%= config.bin %> datasource:default test',
    '<%= config.bin %> datasource:default live',
    '<%= config.bin %> datasource:default --clear',
  ]
  static flags = {
    ...BaseCommand.baseFlags,
    clear: Flags.boolean({
      default: false,
      description: 'Clear default datasource (use Xano default)',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DataSourceDefault)

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

    // Block write operations in agent mode
    const isWriteOperation = flags.clear || args.name
    if (isWriteOperation && isAgentMode(flags.agent)) {
      this.error([
        'AGENT_ERROR: datasource_config_blocked',
        'AGENT_MESSAGE: Agents cannot modify datasource configuration.',
        'AGENT_ACTION: Ask the human to run this command manually.',
        `AGENT_COMMAND: xano datasource:default${args.name ? ` ${args.name}` : ''}${flags.clear ? ' --clear' : ''}`,
      ].join('\n'))
    }

    // Clear mode
    if (flags.clear) {
      if (config.defaultDatasource) {
        delete config.defaultDatasource
        saveLocalConfig(projectRoot, config)

        // Also update xano.json if it exists
        const projectConfig = loadXanoJson(projectRoot)
        if (projectConfig?.defaultDatasource) {
          delete projectConfig.defaultDatasource
          saveXanoJson(projectRoot, projectConfig)
        }

        this.log('Default datasource cleared. Using Xano default (live).')
      } else {
        this.log('No default datasource configured.')
      }

      return
    }

    // Get mode (no name provided)
    if (!args.name) {
      if (config.defaultDatasource) {
        this.log(`Default datasource: ${config.defaultDatasource}`)
      } else {
        this.log('No default datasource configured. Using Xano default (live).')
      }

      return
    }

    // Set mode - validate datasource exists
    const profile = getProfile(flags.profile, config.profile)
    if (!profile) {
      this.error('No profile found. Run "xano init" first.')
    }

    const api = new XanoApi(profile, config.workspaceId, config.branch)
    const response = await api.listDataSources()

    if (!response.ok) {
      this.error(`Failed to fetch data sources: ${response.error}`)
    }

    const dataSources = response.data || []
    const validNames = dataSources.map(ds => ds.label.toLowerCase())

    if (!validNames.includes(args.name.toLowerCase())) {
      const available = dataSources.map(ds => ds.label).join(', ')
      this.error(`Datasource "${args.name}" not found.\nAvailable: ${available || '(none)'}`)
    }

    // Find the exact name (case-sensitive)
    const exactName = dataSources.find(
      ds => ds.label.toLowerCase() === args.name!.toLowerCase()
    )?.label || args.name!

    // Update local config
    config.defaultDatasource = exactName
    saveLocalConfig(projectRoot, config)

    // Also update xano.json if it exists
    const projectConfig = loadXanoJson(projectRoot)
    if (projectConfig) {
      projectConfig.defaultDatasource = exactName
      saveXanoJson(projectRoot, projectConfig)
    }

    this.log(`Default datasource set to: ${exactName}`)
  }
}
