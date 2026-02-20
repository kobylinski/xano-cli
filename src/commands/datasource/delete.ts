import { Args, Command, Flags } from '@oclif/core'

import {
  getMissingProfileError,
  getProfile,
  XanoApi,
} from '../../lib/api.js'
import {
  findProjectRoot,
  isInitialized,
  loadCliConfig,
  loadEffectiveConfig,
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
    '<%= config.bin %> datasource:delete test --force --json',
  ]
  static flags = {
    force: Flags.boolean({
      char: 'f',
      default: false,
      description: 'Skip confirmation',
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
    const { args, flags } = await this.parse(DataSourceDelete)

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
      this.error('No profile found. Run "xano init" first.')
    }

    if (!flags.force) {
      if (flags.json) {
        this.log(JSON.stringify({
          action: 'confirm_required',
          datasource: args.label,
          message: 'Use --force to confirm deletion',
          success: false,
        }, null, 2))
      } else {
        this.log(`About to delete data source: ${args.label}`)
        this.log('Use --force to confirm deletion')
      }

      return
    }

    const api = new XanoApi(profile, config.workspaceId, config.branch)
    const response = await api.deleteDataSource(args.label)

    if (!response.ok) {
      if (flags.json) {
        this.log(JSON.stringify({
          action: 'delete',
          datasource: args.label,
          error: response.error,
          success: false,
        }, null, 2))
        return
      }

      this.error(`Failed to delete data source: ${response.error}`)
    }

    if (flags.json) {
      this.log(JSON.stringify({
        action: 'delete',
        datasource: args.label,
        success: true,
      }, null, 2))
    } else {
      this.log(`Deleted data source: ${args.label}`)
    }
  }
}
