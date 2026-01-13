import { Args, Command, Flags } from '@oclif/core'
import * as fs from 'node:fs'

import {
  getProfile,
  XanoApi,
} from '../../../lib/api.js'
import {
  findGroupByName,
  loadGroups,
  loadObjects,
} from '../../../lib/objects.js'
import {
  findProjectRoot,
  isInitialized,
  loadLocalConfig,
} from '../../../lib/project.js'

export default class ApiCall extends Command {
  static args = {
    groupOrPath: Args.string({
      description: 'API group name or endpoint path (e.g., "auth" or "/auth/login")',
      required: true,
    }),
    path: Args.string({
      description: 'Endpoint path when group is specified (e.g., "/auth/login")',
      required: false,
    }),
  }
  static description = 'Call a live API endpoint'
  static examples = [
    '<%= config.bin %> api:call /auth/login --method POST --body \'{"email":"test@example.com"}\'',
    '<%= config.bin %> api:call auth /auth/login --method POST',
    '<%= config.bin %> api:call /users --method GET',
    '<%= config.bin %> api:call /users --header "Authorization: Bearer <token>"',
  ]
  static flags = {
    body: Flags.string({
      char: 'b',
      description: 'Request body as JSON string',
      exclusive: ['body-file'],
    }),
    'body-file': Flags.string({
      description: 'Read request body from JSON file',
      exclusive: ['body'],
    }),
    header: Flags.string({
      char: 'H',
      description: 'Add header (format: "Name: Value")',
      multiple: true,
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output response as formatted JSON',
    }),
    method: Flags.string({
      char: 'm',
      default: 'GET',
      description: 'HTTP method (GET, POST, PUT, DELETE, PATCH)',
    }),
    profile: Flags.string({
      description: 'Profile to use',
      env: 'XANO_PROFILE',
    }),
    raw: Flags.boolean({
      default: false,
      description: 'Output raw response (no formatting)',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ApiCall)

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

    // Resolve group and path from arguments
    const method = flags.method.toUpperCase()
    const { canonical, endpointPath } = this.resolveGroupAndPath(
      projectRoot,
      args.groupOrPath,
      args.path,
      method
    )

    // Parse headers
    const headers: Record<string, string> = {}
    if (flags.header) {
      for (const h of flags.header) {
        const colonIndex = h.indexOf(':')
        if (colonIndex === -1) {
          this.error(`Invalid header format: "${h}". Use "Name: Value" format.`)
        }
        const name = h.slice(0, colonIndex).trim()
        const value = h.slice(colonIndex + 1).trim()
        headers[name] = value
      }
    }

    // Parse body
    let body: Record<string, unknown> | undefined
    if (flags.body) {
      try {
        body = JSON.parse(flags.body)
      } catch (error: any) {
        this.error(`Invalid JSON body: ${error.message}`)
      }
    } else if (flags['body-file']) {
      try {
        const content = fs.readFileSync(flags['body-file'], 'utf-8')
        body = JSON.parse(content)
      } catch (error: any) {
        this.error(`Failed to read body file: ${error.message}`)
      }
    }

    const api = new XanoApi(profile, config.workspaceId, config.branch)

    const response = await api.callLiveApi(
      canonical,
      endpointPath,
      method,
      body,
      Object.keys(headers).length > 0 ? headers : undefined
    )

    if (flags.raw) {
      this.log(JSON.stringify(response.data))
      return
    }

    if (!response.ok) {
      this.log(`Error: ${response.error}`)
      this.log(`Status: ${response.status}`)
      return
    }

    if (flags.json) {
      this.log(JSON.stringify(response.data, null, 2))
      return
    }

    // Pretty print response
    this.log(`Status: ${response.status}`)
    this.log('')
    this.log('Response:')
    this.log(JSON.stringify(response.data, null, 2))
  }

  /**
   * Resolve the canonical ID and endpoint path from arguments
   */
  private resolveGroupAndPath(
    projectRoot: string,
    groupOrPath: string,
    pathArg: string | undefined,
    method: string
  ): { canonical: string; endpointPath: string } {
    const groups = loadGroups(projectRoot)

    // If first arg starts with /, it's a path - auto-resolve group
    if (groupOrPath.startsWith('/')) {
      const endpointPath = groupOrPath
      const canonical = this.resolveCanonicalFromPath(projectRoot, endpointPath, method, groups)
      return { canonical, endpointPath }
    }

    // First arg is group name or canonical, second is path
    if (!pathArg) {
      this.error('Endpoint path is required when specifying a group.')
    }

    let endpointPath = pathArg
    if (!endpointPath.startsWith('/')) {
      endpointPath = '/' + endpointPath
    }

    // Try to resolve as group name first
    const groupInfo = findGroupByName(groups, groupOrPath)
    if (groupInfo) {
      return { canonical: groupInfo.canonical, endpointPath }
    }

    // Assume it's a canonical ID
    return { canonical: groupOrPath, endpointPath }
  }

  /**
   * Resolve canonical ID from endpoint path by looking up in objects.json
   */
  private resolveCanonicalFromPath(
    projectRoot: string,
    endpointPath: string,
    method: string,
    groups: ReturnType<typeof loadGroups>
  ): string {
    const objects = loadObjects(projectRoot)

    // Normalize the path for comparison
    const normalizedPath = endpointPath.startsWith('/') ? endpointPath.slice(1) : endpointPath

    // Find matching api_endpoint objects
    const matchingEndpoints: { groupName: string; path: string }[] = []

    for (const obj of objects) {
      if (obj.type !== 'api_endpoint') continue

      // Extract endpoint path and group from the file path
      // File path format: app/apis/{group}/{path}_{VERB}.xs
      const parts = obj.path.split('/')
      if (parts.length < 3) continue

      const filename = parts[parts.length - 1]
      const groupDir = parts[parts.length - 2]

      // Parse filename to get endpoint path and verb
      // Format: path_part_VERB.xs (e.g., auth_login_POST.xs, users_id_GET.xs)
      const match = filename.match(/^(.+)_([A-Z]+)\.xs$/)
      if (!match) continue

      const [, pathPart, verb] = match

      // Check if verb matches the requested method
      if (verb !== method) continue

      // Convert path_part back to path (approximate)
      // This is tricky because we don't have the exact original path
      // We'll try a simpler match: check if the normalized path contains the key parts

      // For exact matching, we need to compare with the actual endpoint path
      // Let's check if the path contains similar segments
      const pathSegments = normalizedPath.replace(/[{}]/g, '').split('/').filter(Boolean)
      const filePathSegments = pathPart.split('_').filter(Boolean)

      // Simple match: all path segments should appear in the file path
      const isMatch = pathSegments.every(seg =>
        filePathSegments.some(fileSeg =>
          fileSeg.toLowerCase() === seg.toLowerCase() ||
          fileSeg.toLowerCase() === 'id' && /^\{.*\}$/.test(seg)
        )
      )

      if (isMatch || pathPart.toLowerCase().includes(pathSegments.join('_').toLowerCase())) {
        matchingEndpoints.push({
          groupName: groupDir,
          path: obj.path,
        })
      }
    }

    if (matchingEndpoints.length === 0) {
      this.error(
        `Could not find API endpoint for path "${endpointPath}".\n` +
        'Run "xano pull --sync" to refresh metadata, or specify the group explicitly:\n' +
        `  xano api:call <group> ${endpointPath}`
      )
    }

    if (matchingEndpoints.length > 1) {
      // Check if all matches are in the same group
      const uniqueGroups = [...new Set(matchingEndpoints.map(e => e.groupName))]
      if (uniqueGroups.length > 1) {
        this.error(
          `Ambiguous endpoint "${endpointPath}" found in multiple groups: ${uniqueGroups.join(', ')}\n` +
          `Specify the group explicitly: xano api:call <group> ${endpointPath}`
        )
      }
    }

    const groupName = matchingEndpoints[0].groupName
    const groupInfo = findGroupByName(groups, groupName)

    if (!groupInfo) {
      this.error(
        `API group "${groupName}" not found in groups.json.\n` +
        'Run "xano pull --sync" to refresh metadata.'
      )
    }

    return groupInfo.canonical
  }
}
