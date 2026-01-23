import { Args, Flags } from '@oclif/core'

import type { DatasourceAccessLevel, DatasourcePermissions } from '../../lib/types.js'

import BaseCommand, { isAgentMode } from '../../base-command.js'
import {
  getProfile,
  XanoApi,
} from '../../lib/api.js'
import { describeAccessLevel } from '../../lib/datasource.js'
import {
  findProjectRoot,
  isInitialized,
  loadEffectiveConfig,
  loadLocalConfig,
  loadXanoJson,
  saveLocalConfig,
  saveXanoJson,
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

    // List mode (no name provided)
    if (!args.name) {
      await this.listPermissions(effectiveConfig.datasources, flags.profile, effectiveConfig, flags.json)
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
      const hadPermission = Boolean(config.datasources?.[args.name])
      if (hadPermission) {
        delete config.datasources![args.name]
        if (Object.keys(config.datasources!).length === 0) {
          delete config.datasources
        }

        saveLocalConfig(projectRoot, config)

        // Also update xano.json if it exists
        const projectConfig = loadXanoJson(projectRoot)
        if (projectConfig?.datasources?.[args.name]) {
          delete projectConfig.datasources[args.name]
          if (Object.keys(projectConfig.datasources).length === 0) {
            delete projectConfig.datasources
          }

          saveXanoJson(projectRoot, projectConfig)
        }
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

    const level = args.level as DatasourceAccessLevel

    // Update local config
    if (!config.datasources) {
      config.datasources = {}
    }

    config.datasources[exactName] = level
    saveLocalConfig(projectRoot, config)

    // Also update xano.json if it exists
    const projectConfig = loadXanoJson(projectRoot)
    if (projectConfig) {
      if (!projectConfig.datasources) {
        projectConfig.datasources = {}
      }

      projectConfig.datasources[exactName] = level
      saveXanoJson(projectRoot, projectConfig)
    }

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
    profileFlag: string | undefined,
    config: { branch: string; profile?: string; workspaceId: number },
    jsonOutput: boolean
  ): Promise<void> {
    // Get actual datasources from API
    const profile = getProfile(profileFlag, config.profile)
    if (!profile) {
      this.error('No profile found. Run "xano init" first.')
    }

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
