import { Command, Flags } from '@oclif/core'

import {
  getProfile,
  XanoApi,
} from '../../lib/api.js'
import {
  findProjectRoot,
  isInitialized,
  loadLocalConfig,
} from '../../lib/project.js'

export default class DataSourceList extends Command {
  static description = 'List data sources in the workspace'
  static examples = [
    '<%= config.bin %> datasource:list',
    '<%= config.bin %> datasource:list --json',
  ]
  static flags = {
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
    const { flags } = await this.parse(DataSourceList)

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
      this.error('No profile found. Run "xano profile:wizard" to create one.')
    }

    const api = new XanoApi(profile, config.workspaceId, config.branch)
    const response = await api.listDataSources()

    if (!response.ok) {
      this.error(`Failed to fetch data sources: ${response.error}`)
    }

    const dataSources = response.data || []

    if (flags.json) {
      this.log(JSON.stringify(dataSources, null, 2))
      return
    }

    if (dataSources.length === 0) {
      this.log('No data sources found.')
      return
    }

    this.log(`Data Sources (${dataSources.length}):`)
    for (const ds of dataSources) {
      this.log(`  ${ds.label} (${ds.color})`)
    }
  }
}
