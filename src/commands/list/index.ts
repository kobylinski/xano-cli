import { Args, Command, Flags } from '@oclif/core'

import type {
  XanoLocalConfig,
  XanoObjectType,
} from '../../lib/types.js'

import {
  getProfile,
  XanoApi,
} from '../../lib/api.js'
import {
  loadObjects,
} from '../../lib/objects.js'
import {
  findProjectRoot,
  isInitialized,
  loadLocalConfig,
} from '../../lib/project.js'

interface RemoteObject {
  apigroup_name?: string
  id: number
  localPath?: string
  name: string
  type: XanoObjectType
  verb?: string
}

export default class List extends Command {
  static args = {
    type: Args.string({
      description: 'Object type to list (functions/, tables/, apis/, tasks/) - trailing slash optional',
      required: false,
    }),
  }
static description = 'List objects on Xano server'
static examples = [
    '<%= config.bin %> list',
    '<%= config.bin %> list tables/',
    '<%= config.bin %> list functions',
    '<%= config.bin %> list apis/ --remote-only',
    '<%= config.bin %> list -l',
  ]
static flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    long: Flags.boolean({
      char: 'l',
      default: false,
      description: 'Long format with details',
    }),
    profile: Flags.string({
      char: 'p',
      description: 'Profile to use',
      env: 'XANO_PROFILE',
    }),
    'remote-only': Flags.boolean({
      default: false,
      description: 'Show only objects not pulled locally',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(List)

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

    // Parse type and optional subfilter from argument
    const { subFilter, type: typeFilter } = this.parseTypeArg(args.type, config)

    const api = new XanoApi(profile, config.workspaceId, config.branch)
    const objects = loadObjects(projectRoot)

    // Build local path lookup
    const localPaths = new Map<string, string>()
    for (const obj of objects) {
      // Key by type:id
      localPaths.set(`${obj.type}:${obj.id}`, obj.path)
    }

    // Fetch remote objects
    const remoteObjects: RemoteObject[] = []

    if (!typeFilter || typeFilter === 'function') {
      await this.fetchFunctions(api, remoteObjects, localPaths)
    }

    if (!typeFilter || typeFilter === 'api_endpoint') {
      await this.fetchApis(api, remoteObjects, localPaths, subFilter)
    }

    if (!typeFilter || typeFilter === 'table') {
      await this.fetchTables(api, remoteObjects, localPaths)
    }

    if (!typeFilter || typeFilter === 'task') {
      await this.fetchTasks(api, remoteObjects, localPaths)
    }

    if (!typeFilter || typeFilter === 'workflow_test') {
      await this.fetchWorkflowTests(api, remoteObjects, localPaths)
    }

    // Filter remote-only if requested
    let filtered = remoteObjects
    if (flags['remote-only']) {
      filtered = remoteObjects.filter((o) => !o.localPath)
    }

    // Output
    if (flags.json) {
      this.log(JSON.stringify(filtered, null, 2))
      return
    }

    this.outputHuman(filtered, typeFilter, config, flags.long, flags['remote-only'])
  }

  private async fetchApis(
    api: XanoApi,
    results: RemoteObject[],
    localPaths: Map<string, string>,
    groupFilter?: null | string
  ): Promise<void> {
    // First fetch groups for names
    const groups = new Map<number, string>()
    const groupsResponse = await api.listApiGroups(1, 1000)
    if (!groupsResponse.ok) {
      this.warn(`Failed to fetch API groups: ${groupsResponse.error}`)
    } else if (groupsResponse.data?.items) {
      for (const g of groupsResponse.data.items) {
        groups.set(g.id, g.name)
      }
    }

    const response = await api.listApiEndpoints(1, 1000)
    if (!response.ok) {
      this.warn(`Failed to fetch API endpoints: ${response.error}`)
      return
    }

    // Handle different response structures
    const items = response.data?.items || (Array.isArray(response.data) ? response.data : [])

    for (const ep of items) {
      const groupName = groups.get(ep.apigroup_id)

      // Filter by group if specified (case-insensitive)
      if (groupFilter && groupName && groupName.toLowerCase() !== groupFilter.toLowerCase()) {
          continue
        }

      // API might return 'path', 'endpoint', or 'name' for the route
      const endpointPath = ep.path || ep.endpoint || ep.name || ep.route || '(unknown)'

      results.push({
        apigroup_name: groupName, // eslint-disable-line camelcase
        id: ep.id,
        localPath: localPaths.get(`api_endpoint:${ep.id}`),
        name: endpointPath,
        type: 'api_endpoint',
        verb: ep.verb || ep.method || 'GET',
      })
    }
  }

  private async fetchFunctions(
    api: XanoApi,
    results: RemoteObject[],
    localPaths: Map<string, string>
  ): Promise<void> {
    const response = await api.listFunctions(1, 1000)
    if (response.ok && response.data?.items) {
      for (const fn of response.data.items) {
        results.push({
          id: fn.id,
          localPath: localPaths.get(`function:${fn.id}`),
          name: fn.name,
          type: 'function',
        })
      }
    }
  }

  private async fetchTables(
    api: XanoApi,
    results: RemoteObject[],
    localPaths: Map<string, string>
  ): Promise<void> {
    const response = await api.listTables(1, 1000)
    if (response.ok && response.data?.items) {
      for (const t of response.data.items) {
        results.push({
          id: t.id,
          localPath: localPaths.get(`table:${t.id}`),
          name: t.name,
          type: 'table',
        })
      }
    }
  }

  private async fetchTasks(
    api: XanoApi,
    results: RemoteObject[],
    localPaths: Map<string, string>
  ): Promise<void> {
    const response = await api.listTasks(1, 1000)
    if (response.ok && response.data?.items) {
      for (const t of response.data.items) {
        results.push({
          id: t.id,
          localPath: localPaths.get(`task:${t.id}`),
          name: t.name,
          type: 'task',
        })
      }
    }
  }

  private async fetchWorkflowTests(
    api: XanoApi,
    results: RemoteObject[],
    localPaths: Map<string, string>
  ): Promise<void> {
    const response = await api.listWorkflowTests(1, 1000)
    if (response.ok && response.data?.items) {
      for (const t of response.data.items) {
        results.push({
          id: t.id,
          localPath: localPaths.get(`workflow_test:${t.id}`),
          name: t.name,
          type: 'workflow_test',
        })
      }
    }
  }

  private outputHuman(
    objects: RemoteObject[],
    typeFilter: null | XanoObjectType,
    config: XanoLocalConfig,
    long: boolean,
    _remoteOnly: boolean
  ): void {
    if (objects.length === 0) {
      this.log('No objects found.')
      return
    }

    // Group by type
    const byType = new Map<XanoObjectType, RemoteObject[]>()
    for (const obj of objects) {
      const list = byType.get(obj.type) || []
      list.push(obj)
      byType.set(obj.type, list)
    }

    /* eslint-disable camelcase */
    const typeLabels: Record<XanoObjectType, string> = {
      addon: 'Addons',
      agent: 'Agents',
      agent_trigger: 'Agent Triggers',
      api_endpoint: 'API Endpoints',
      api_group: 'API Groups',
      function: 'Functions',
      mcp_server: 'MCP Servers',
      mcp_server_trigger: 'MCP Server Triggers',
      middleware: 'Middleware',
      realtime_channel: 'Realtime Channels',
      realtime_trigger: 'Realtime Triggers',
      table: 'Tables',
      table_trigger: 'Table Triggers',
      task: 'Tasks',
      tool: 'Tools',
      workflow_test: 'Workflow Tests',
    }
    /* eslint-enable camelcase */

    for (const [type, list] of byType) {
      this.log(`${typeLabels[type] || type}:`)

      for (const obj of list) {
        if (long) {
          this.outputLongFormat(obj, config)
        } else {
          this.outputShortFormat(obj)
        }
      }

      // Summary for this type
      const local = list.filter((o) => o.localPath).length
      const remote = list.length - local
      this.log(`  (${list.length} total, ${local} local, ${remote} remote-only)\n`)
    }
  }

  private outputLongFormat(obj: RemoteObject, _config: XanoLocalConfig): void {
    const status = obj.localPath ? '✓' : '-'
    let {name} = obj

    if (obj.type === 'api_endpoint') {
      const group = obj.apigroup_name || 'default'
      name = `${obj.verb} ${obj.name} [${group}]`
    }

    const localInfo = obj.localPath || '(not pulled)'
    this.log(`  ${status} ${name}`)
    this.log(`      id: ${obj.id}, local: ${localInfo}`)
  }

  private outputShortFormat(obj: RemoteObject): void {
    const status = obj.localPath ? '✓' : '-'
    let {name} = obj

    if (obj.type === 'api_endpoint') {
      const group = obj.apigroup_name || 'default'
      name = `${obj.verb} ${obj.name} [${group}]`
    }

    this.log(`  ${status} ${name}`)
  }

  private parseTypeArg(
    arg: string | undefined,
    config: XanoLocalConfig
  ): { subFilter: null | string; type: null | XanoObjectType; } {
    if (!arg) return { subFilter: null, type: null }

    // Trim trailing slash
    const cleaned = arg.replace(/\/$/, '')

    // Direct type name mapping
    const directMapping: Record<string, XanoObjectType> = {
      'api': 'api_endpoint',
      'api_endpoint': 'api_endpoint',
      'apis': 'api_endpoint',
      'function': 'function',
      'functions': 'function',
      'table': 'table',
      'tables': 'table',
      'task': 'task',
      'tasks': 'task',
      'workflow_test': 'workflow_test',
      'workflow_tests': 'workflow_test',
    }

    // Check direct match first
    if (directMapping[cleaned]) {
      return { subFilter: null, type: directMapping[cleaned] }
    }

    // Check if path starts with a known directory (e.g., apis/auth → api_endpoint with subFilter)
    const pathPrefixes: Array<[string | undefined, XanoObjectType]> = [
      [config.paths.functions, 'function'],
      [config.paths.tables, 'table'],
      [config.paths.apis, 'api_endpoint'],
      [config.paths.tasks, 'task'],
      [config.paths.workflowTests, 'workflow_test'],
    ]

    for (const [prefix, type] of pathPrefixes) {
      if (!prefix) continue

      if (cleaned === prefix) {
        return { subFilter: null, type }
      }

      if (cleaned.startsWith(prefix + '/')) {
        // Extract subpath after prefix (e.g., "apis/auth" → "auth")
        const subFilter = cleaned.slice(prefix.length + 1)
        return { subFilter: subFilter || null, type }
      }
    }

    return { subFilter: null, type: null }
  }
}
