import { Args, Command, Flags } from '@oclif/core'

import {
  getProfile,
  XanoApi,
} from '../../../lib/api.js'
import {
  findProjectRoot,
  isInitialized,
  loadLocalConfig,
} from '../../../lib/project.js'

export default class ApiEndpoints extends Command {
  static args = {
    group: Args.string({
      description: 'API group name or ID',
      required: false,
    }),
  }
  static description = 'List API endpoints (optionally filtered by group)'
  static examples = [
    '<%= config.bin %> api:endpoints',
    '<%= config.bin %> api:endpoints auth',
    '<%= config.bin %> api:endpoints --json',
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
    const { args, flags } = await this.parse(ApiEndpoints)

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

    // Fetch groups for names
    const groupsResponse = await api.listApiGroups(1, 1000)
    const groupsMap = new Map<number, { canonical?: string; name: string }>()

    if (groupsResponse.ok && groupsResponse.data?.items) {
      for (const group of groupsResponse.data.items) {
        // eslint-disable-next-line no-await-in-loop -- Sequential API calls for rate limiting
        const details = await api.getApiGroupWithCanonical(group.id)
        groupsMap.set(group.id, {
          canonical: details.data?.canonical,
          name: group.name,
        })
      }
    }

    // Filter by group if specified
    let filterGroupId: null | number = null
    if (args.group) {
      const numId = Number.parseInt(args.group, 10)
      if (Number.isNaN(numId)) {
        // Find by name
        for (const [id, info] of groupsMap) {
          if (info.name.toLowerCase() === args.group.toLowerCase()) {
            filterGroupId = id
            break
          }
        }

        if (filterGroupId === null) {
          this.error(`API group not found: ${args.group}`)
        }
      } else {
        filterGroupId = numId
      }
    }

    // Fetch endpoints
    const response = await api.listApiEndpoints(1, 1000)

    if (!response.ok) {
      this.error(`Failed to list API endpoints: ${response.error}`)
    }

    let endpoints = response.data?.items || []

    // Filter by group if specified
    if (filterGroupId !== null) {
      endpoints = endpoints.filter(ep => ep.apigroup_id === filterGroupId)
    }

    if (endpoints.length === 0) {
      this.log('No API endpoints found.')
      return
    }

    // Enrich with group info
    const enriched = endpoints.map(ep => {
      const groupInfo = groupsMap.get(ep.apigroup_id)
      return {
        group: groupInfo?.name || 'unknown',
        groupCanonical: groupInfo?.canonical || '(unknown)',
        id: ep.id,
        path: ep.name,
        verb: ep.verb || 'GET',
      }
    })

    if (flags.json) {
      this.log(JSON.stringify(enriched, null, 2))
      return
    }

    // Group by API group
    const byGroup = new Map<string, typeof enriched>()
    for (const ep of enriched) {
      const list = byGroup.get(ep.group) || []
      list.push(ep)
      byGroup.set(ep.group, list)
    }

    for (const [groupName, eps] of byGroup) {
      const canonical = eps[0]?.groupCanonical || '(unknown)'
      this.log(`${groupName} (canonical: ${canonical}):`)
      for (const ep of eps) {
        this.log(`  ${ep.verb.padEnd(6)} ${ep.path}`)
      }

      this.log('')
    }

    this.log('To call an endpoint: xano api:call <canonical> <path> [--method POST] [--body \'{"key":"value"}\']')
  }
}
