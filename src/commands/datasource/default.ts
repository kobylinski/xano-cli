import { Args, Flags } from '@oclif/core'

import BaseCommand, { isAgentMode } from '../../base-command.js'
import {
  getMissingProfileError,
  getProfile,
  XanoApi,
} from '../../lib/api.js'
import {
  findProjectRoot,
  isInitialized,
  loadCliConfig,
  loadDatasourcesConfig,
  loadEffectiveConfig,
  loadLocalConfig,
  saveDatasourcesConfig,
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
    '<%= config.bin %> datasource:default --json',
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
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
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

    // Load effective config for reading (merges xano.json defaults)
    const effectiveConfig = loadEffectiveConfig(projectRoot)!

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
      const datasourcesConfig = loadDatasourcesConfig(projectRoot) || {}
      const hadDefault = Boolean(datasourcesConfig.defaultDatasource)

      if (hadDefault) {
        delete datasourcesConfig.defaultDatasource
        saveDatasourcesConfig(projectRoot, datasourcesConfig)
      }

      if (flags.json) {
        this.log(JSON.stringify({
          action: 'clear',
          default: null,
          effective: 'live',
          success: true,
        }, null, 2))
      } else if (hadDefault) {
        this.log('Default datasource cleared. Using Xano default (live).')
      } else {
        this.log('No default datasource configured.')
      }

      return
    }

    // Get mode (no name provided)
    if (!args.name) {
      if (flags.json) {
        this.log(JSON.stringify({
          default: effectiveConfig.defaultDatasource || null,
          effective: effectiveConfig.defaultDatasource || 'live',
        }, null, 2))
      } else if (effectiveConfig.defaultDatasource) {
        this.log(`Default datasource: ${effectiveConfig.defaultDatasource}`)
      } else {
        this.log('No default datasource configured. Using Xano default (live).')
      }

      return
    }

    // Set mode - validate datasource exists
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

    // Update datasources.json (dedicated file for datasource config)
    const datasourcesConfig = loadDatasourcesConfig(projectRoot) || {}
    datasourcesConfig.defaultDatasource = exactName
    saveDatasourcesConfig(projectRoot, datasourcesConfig)

    if (flags.json) {
      this.log(JSON.stringify({
        action: 'set',
        default: exactName,
        effective: exactName,
        success: true,
      }, null, 2))
    } else {
      this.log(`Default datasource set to: ${exactName}`)
    }
  }
}
