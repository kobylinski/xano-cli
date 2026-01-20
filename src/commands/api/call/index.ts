import { Args, Command, Flags } from '@oclif/core'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

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

/**
 * Extract a value from an object using JSONPath-like syntax
 * Supports: .field, .field.nested, .array[0], .array[0].field
 */
function extractByPath(data: unknown, jsonPath: string): unknown {
  if (!jsonPath.startsWith('.')) {
    throw new Error(`Invalid path: "${jsonPath}". Path must start with "."`)
  }

  const pathWithoutDot = jsonPath.slice(1)
  if (!pathWithoutDot) {
    return data
  }

  // Parse path segments: field, field[0], etc.
  const segments: Array<{ type: 'field' | 'index'; value: number | string }> = []
  const regex = /([^.[\]]+)|\[(\d+)\]/g
  let match

  while ((match = regex.exec(pathWithoutDot)) !== null) {
    if (match[1] !== undefined) {
      segments.push({ type: 'field', value: match[1] })
    } else if (match[2] !== undefined) {
      segments.push({ type: 'index', value: Number.parseInt(match[2], 10) })
    }
  }

  let current: unknown = data

  for (const segment of segments) {
    if (current === null || current === undefined) {
      return undefined
    }

    if (segment.type === 'field') {
      if (typeof current !== 'object') {
        return undefined
      }

      current = (current as Record<string, unknown>)[segment.value as string]
    } else if (segment.type === 'index') {
      if (!Array.isArray(current)) {
        return undefined
      }

      current = current[segment.value as number]
    }
  }

  return current
}

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
    '<%= config.bin %> api:call /auth/login -m POST -b \'{"email":"test@example.com","password":"secret"}\'',
    '<%= config.bin %> api:call /auth/login -m POST -b \'{"email":"...","password":"..."}\' --extract .authToken --save .xano/token.txt',
    '<%= config.bin %> api:call /profile --token-file .xano/token.txt',
    '<%= config.bin %> api:call /users --token "eyJhbG..."',
    '<%= config.bin %> api:call auth /login -m POST',
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
    extract: Flags.string({
      char: 'e',
      description: 'Extract field from response using JSONPath (e.g., ".authToken", ".data.user.id")',
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
    save: Flags.string({
      char: 's',
      description: 'Save output to file',
    }),
    token: Flags.string({
      char: 't',
      description: 'Auth token (adds "Authorization: Bearer <token>" header)',
      exclusive: ['token-file'],
    }),
    'token-file': Flags.string({
      description: 'Read auth token from file',
      exclusive: ['token'],
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

    const profile = getProfile(flags.profile, config.profile)
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

    // Handle token authentication
    const token = this.resolveToken(flags.token, flags['token-file'])
    if (token) {
      headers.Authorization = `Bearer ${token}`
    }

    // Parse custom headers
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
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.error(`Invalid JSON body: ${message}`)
      }
    } else if (flags['body-file']) {
      try {
        const content = readFileSync(flags['body-file'], 'utf8')
        body = JSON.parse(content)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.error(`Failed to read body file: ${message}`)
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

    // Handle error responses
    if (!response.ok) {
      const errorOutput = {
        error: response.error,
        status: response.status,
      }

      if (flags.raw) {
        this.log(JSON.stringify(errorOutput))
      } else if (flags.json) {
        this.log(JSON.stringify(errorOutput, null, 2))
      } else {
        this.log(`Error: ${response.error}`)
        this.log(`Status: ${response.status}`)
      }

      // Still allow saving error response
      if (flags.save) {
        const savePath = flags.save
        const saveDir = dirname(savePath)
        if (saveDir && !existsSync(saveDir)) {
          mkdirSync(saveDir, { recursive: true })
        }

        writeFileSync(savePath, JSON.stringify(errorOutput, null, 2) + '\n', 'utf8')
        if (!flags.raw) {
          this.log(`Saved to ${savePath}`)
        }
      }

      return
    }

    // Determine output value
    let output: unknown = response.data

    // Extract field if requested
    if (flags.extract) {
      try {
        output = extractByPath(response.data, flags.extract)
        if (output === undefined) {
          this.error(`Field "${flags.extract}" not found in response`)
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        this.error(`Extract error: ${message}`)
      }
    }

    // Format output
    let outputString: string
    if (flags.extract) {
      // When extracting, output just the value (string or JSON)
      outputString = typeof output === 'string' ? output : JSON.stringify(output, null, 2)
    } else if (flags.raw) {
      outputString = JSON.stringify(output)
    } else if (flags.json) {
      outputString = JSON.stringify(output, null, 2)
    } else {
      outputString = `Status: ${response.status}\n\nResponse:\n${JSON.stringify(output, null, 2)}`
    }

    // Save to file if requested
    if (flags.save) {
      const savePath = flags.save
      const saveDir = dirname(savePath)

      // Create directory if it doesn't exist
      if (saveDir && !existsSync(saveDir)) {
        mkdirSync(saveDir, { recursive: true })
      }

      // For extracted values, save just the raw value (no JSON wrapping for strings)
      const saveContent = flags.extract && typeof output === 'string'
        ? output
        : typeof output === 'string' ? output : JSON.stringify(output, null, 2)

      writeFileSync(savePath, saveContent + '\n', 'utf8')

      // When saving, also output to console unless using --raw
      if (!flags.raw) {
        this.log(`Saved to ${savePath}`)
      }
    }

    // Output to console (unless only saving with --raw)
    if (!flags.save || !flags.raw) {
      this.log(outputString)
    }
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

      const filename = parts.at(-1)!
      const groupDir = parts.at(-2)!

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
      const pathSegments = normalizedPath.replaceAll(/[{}]/g, '').split('/').filter(Boolean)
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

    const {groupName} = matchingEndpoints[0]
    const groupInfo = findGroupByName(groups, groupName)

    if (!groupInfo) {
      this.error(
        `API group "${groupName}" not found in groups.json.\n` +
        'Run "xano pull --sync" to refresh metadata.'
      )
    }

    return groupInfo.canonical
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
   * Resolve auth token from flags
   */
  private resolveToken(token?: string, tokenFile?: string): string | undefined {
    if (token) {
      return token
    }

    if (tokenFile) {
      if (!existsSync(tokenFile)) {
        this.error(`Token file not found: ${tokenFile}`)
      }

      const content = readFileSync(tokenFile, 'utf8').trim()

      // Try to parse as JSON and extract common token fields
      try {
        const json = JSON.parse(content)
        if (json.authToken) return json.authToken
        if (json.token) return json.token
        if (json.access_token) return json.access_token
        if (json.jwt) return json.jwt
        // If JSON but no known token field, use the whole content
        return content
      } catch {
        // Not JSON, use content as-is (trimmed)
        return content
      }
    }

    return undefined
  }
}
