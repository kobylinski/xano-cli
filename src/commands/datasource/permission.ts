import { Args, Flags } from '@oclif/core'

import type { DatasourceAccessLevel, DatasourcePermissions, XanoProfile } from '../../lib/types.js'

import BaseCommand, { isAgentMode } from '../../base-command.js'
import {
  getMissingProfileError,
  getProfile,
  XanoApi,
} from '../../lib/api.js'
import { describeAccessLevel } from '../../lib/datasource.js'
import {
  findProjectRoot,
  isInitialized,
  loadCliConfig,
  loadDatasourcesConfig,
  loadEffectiveConfig,
  loadLocalConfig,
  saveDatasourcesConfig,
} from '../../lib/project.js'

const ACCESS_LEVELS: DatasourceAccessLevel[] = ['locked', 'read-only', 'read-write']

export default class DataSourcePermission extends BaseCommand {
  /* eslint-disable perfectionist/sort-objects -- positional arg order matters in oclif */
  static args = {
    name: Args.string({
      description: 'Datasource name (omit to list all permissions)',
      required: false,
    }),
    level: Args.string({
      description: 'Access level: locked, read-only, read-write (omit to show current)',
      options: ACCESS_LEVELS,
      required: false,
    }),
  }
  /* eslint-enable perfectionist/sort-objects */
  static description = 'Get or set datasource access permissions'
  static examples = [
    '<%= config.bin %> datasource:permission',
    '<%= config.bin %> datasource:permission --json',
    '<%= config.bin %> datasource:permission live',
    '<%= config.bin %> datasource:permission live read-only',
    '<%= config.bin %> datasource:permission test read-write',
    '<%= config.bin %> datasource:permission production locked',
    '<%= config.bin %> datasource:permission live --clear',
  ]
  static flags = {
    ...BaseCommand.baseFlags,
    clear: Flags.boolean({
      default: false,
      description: 'Clear permission for datasource (use default: read-only)',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(DataSourcePermission)

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

    // List mode (no name provided)
    if (!args.name) {
      await this.listPermissions(effectiveConfig.datasources, profile, effectiveConfig, flags.json)
      return
    }

    // Block write operations in agent mode (clear or set level)
    const isWriteOperation = flags.clear || args.level
    if (isWriteOperation && isAgentMode(flags.agent)) {
      this.error([
        'AGENT_ERROR: datasource_config_blocked',
        'AGENT_MESSAGE: Agents cannot modify datasource permissions.',
        'AGENT_ACTION: Ask the human to run this command manually.',
        `AGENT_COMMAND: xano datasource:permission ${args.name}${args.level ? ` ${args.level}` : ''}${flags.clear ? ' --clear' : ''}`,
      ].join('\n'))
    }

    // Clear mode
    if (flags.clear) {
      const datasourcesConfig = loadDatasourcesConfig(projectRoot) || {}
      const hadPermission = Boolean(datasourcesConfig.datasources?.[args.name])

      if (hadPermission) {
        delete datasourcesConfig.datasources![args.name]
        if (Object.keys(datasourcesConfig.datasources!).length === 0) {
          delete datasourcesConfig.datasources
        }

        saveDatasourcesConfig(projectRoot, datasourcesConfig)
      }

      if (flags.json) {
        this.log(JSON.stringify({
          action: 'clear',
          datasource: args.name,
          effective: 'read-only',
          level: null,
          success: true,
        }, null, 2))
      } else if (hadPermission) {
        this.log(`Permission for "${args.name}" cleared. Using default (read-only).`)
      } else {
        this.log(`No custom permission configured for "${args.name}".`)
      }

      return
    }

    // Get mode (name but no level)
    if (!args.level) {
      const level = effectiveConfig.datasources?.[args.name]
      const effectiveLevelValue = level || 'read-only'

      if (flags.json) {
        this.log(JSON.stringify({
          datasource: args.name,
          description: describeAccessLevel(effectiveLevelValue),
          effective: effectiveLevelValue,
          isDefault: !level,
          level: level || null,
        }, null, 2))
      } else if (level) {
        this.log(`${args.name}: ${level} (${describeAccessLevel(level)})`)
      } else {
        this.log(`${args.name}: read-only (default - ${describeAccessLevel('read-only')})`)
      }

      return
    }

    // Set mode - validate datasource exists
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

    const level = args.level as DatasourceAccessLevel

    // Update datasources.json (dedicated file for datasource config)
    const datasourcesConfig = loadDatasourcesConfig(projectRoot) || {}
    if (!datasourcesConfig.datasources) {
      datasourcesConfig.datasources = {}
    }

    datasourcesConfig.datasources[exactName] = level
    saveDatasourcesConfig(projectRoot, datasourcesConfig)

    if (flags.json) {
      this.log(JSON.stringify({
        action: 'set',
        datasource: exactName,
        description: describeAccessLevel(level),
        effective: level,
        level,
        success: true,
      }, null, 2))
    } else {
      this.log(`Permission for "${exactName}" set to: ${level} (${describeAccessLevel(level)})`)
    }
  }

  private async listPermissions(
    permissions: DatasourcePermissions | undefined,
    profile: XanoProfile,
    config: { branch: string; workspaceId: number },
    jsonOutput: boolean
  ): Promise<void> {
    // Get actual datasources from API
    const api = new XanoApi(profile, config.workspaceId, config.branch)
    const response = await api.listDataSources()

    if (!response.ok) {
      this.error(`Failed to fetch data sources: ${response.error}`)
    }

    const dataSources = response.data || []

    if (jsonOutput) {
      const result = {
        datasources: dataSources.map(ds => {
          const level = permissions?.[ds.label]
          return {
            description: describeAccessLevel(level || 'read-only'),
            effective: level || 'read-only',
            isDefault: !level,
            level: level || null,
            name: ds.label,
          }
        }),
        orphaned: [] as Array<{ level: string; name: string }>,
      }

      // Add orphaned permissions
      if (permissions) {
        const remoteNames = new Set(dataSources.map(ds => ds.label))
        result.orphaned = Object.keys(permissions)
          .filter(name => !remoteNames.has(name))
          .map(name => ({ level: permissions[name], name }))
      }

      this.log(JSON.stringify(result, null, 2))
      return
    }

    if (dataSources.length === 0) {
      this.log('No data sources found.')
      return
    }

    this.log('Datasource Permissions:')
    for (const ds of dataSources) {
      const level = permissions?.[ds.label] || 'read-only'
      const isDefault = !permissions?.[ds.label]
      const suffix = isDefault ? ' (default)' : ''
      this.log(`  ${ds.label}: ${level}${suffix}`)
    }

    // Show any permissions for datasources that no longer exist
    if (permissions) {
      const remoteNames = new Set(dataSources.map(ds => ds.label))
      const orphanedPermissions = Object.keys(permissions).filter(name => !remoteNames.has(name))

      if (orphanedPermissions.length > 0) {
        this.log('')
        this.log('Orphaned permissions (datasource no longer exists):')
        for (const name of orphanedPermissions) {
          this.log(`  ${name}: ${permissions[name]}`)
        }
      }
    }
  }
}
