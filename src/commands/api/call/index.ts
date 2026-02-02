import { Args, Flags } from '@oclif/core'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import BaseCommand, { isAgentMode } from '../../../base-command.js'
import {
  getProfile,
  XanoApi,
} from '../../../lib/api.js'
import {
  formatAgentDatasourceBlockedMessage,
  resolveEffectiveDatasource,
} from '../../../lib/datasource.js'
import { formatApiResponse, formatErrorResponse, formatYamlLike } from '../../../lib/format.js'
import {
  findGroupByName,
  findMatchingEndpoint,
  loadEndpoints,
  loadGroups,
} from '../../../lib/objects.js'
import {
  findProjectRoot,
  isInitialized,
  loadEffectiveConfig,
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

export default class ApiCall extends BaseCommand {
   
  static args = {
    groupOrMethod: Args.string({
      description: 'API group name/canonical OR HTTP method (GET, POST, PUT, DELETE, PATCH)',
      required: true,
    }),
    methodOrPath: Args.string({
      description: 'HTTP method OR endpoint path (when group is specified)',
      required: true,
    }),
    path: Args.string({
      description: 'Endpoint path (when group and method are specified)',
      required: false,
    }),
  }
static description = 'Call a live API endpoint'
  static examples = [
    '<%= config.bin %> api:call GET /users',
    '<%= config.bin %> api:call POST /auth/login -b \'{"email":"test@example.com","password":"secret"}\'',
    '<%= config.bin %> api:call auth POST /login -b \'{"email":"...","password":"..."}\'',
    '<%= config.bin %> api:call KM1dKCw- POST /auth/login -b \'{"email":"..."}\'',
    '<%= config.bin %> api:call GET /profile --token-file .xano/token.txt',
    '<%= config.bin %> api:call POST /auth/login -b \'...\' --extract .authToken --save .xano/token.txt',
  ]
  static flags = {
    ...BaseCommand.baseFlags,
    body: Flags.string({
      char: 'b',
      description: 'Request body as JSON string',
      exclusive: ['body-file'],
    }),
    'body-file': Flags.string({
      description: 'Read request body from JSON file',
      exclusive: ['body'],
    }),
    datasource: Flags.string({
      char: 'd',
      description: 'Target datasource (e.g., "live", "test")',
      env: 'XANO_DATASOURCE',
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

    const config = loadEffectiveConfig(projectRoot)
    if (!config) {
      this.error('Failed to load config. Check .xano/config.json exists.')
    }

    const profile = getProfile(flags.profile, config.profile)
    if (!profile) {
      this.error('No profile found. Run "xano init" first.')
    }

    // Resolve effective datasource (respecting agent mode restrictions)
    const agentMode = isAgentMode(flags.agent)
    const { blocked, datasource } = resolveEffectiveDatasource(
      flags.datasource,
      config.defaultDatasource,
      agentMode
    )
    if (blocked && flags.datasource) {
      this.warn(formatAgentDatasourceBlockedMessage(flags.datasource, datasource))
    }

    // Parse arguments: [group] <method> <path>
    const httpMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS']
    let groupName: string | undefined
    let method: string
    let endpointPath: string

    if (args.path) {
      // All three provided: group method path
      groupName = args.groupOrMethod
      method = args.methodOrPath.toUpperCase()
      endpointPath = args.path
    } else if (httpMethods.includes(args.groupOrMethod.toUpperCase())) {
      // Two provided and first is method: method path
      method = args.groupOrMethod.toUpperCase()
      endpointPath = args.methodOrPath
    } else {
      // Two provided and first is group: group method (path missing)
      this.error('Missing endpoint path. Usage: xano api:call [group] <method> <path>')
    }

    if (!httpMethods.includes(method)) {
      this.error(`Invalid HTTP method: ${method}. Must be one of: ${httpMethods.join(', ')}`)
    }

    if (!endpointPath.startsWith('/')) {
      endpointPath = '/' + endpointPath
    }

    // Resolve canonical from group name if provided
    const canonical = this.resolveCanonical(projectRoot, groupName, method, endpointPath)

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
      Object.keys(headers).length > 0 ? headers : undefined,
      datasource
    )

    // Handle error responses
    if (!response.ok) {
      const errorOutput = {
        error: response.error,
        status: response.status,
      }

      // JSON flag has priority
      if (flags.json) {
        this.log(JSON.stringify(errorOutput, null, 2))
      } else if (flags.raw) {
        this.log(JSON.stringify(errorOutput))
      } else {
        // YAML-like format: styled for humans, plain for agents
        this.log(formatErrorResponse(response.status, response.error || 'Unknown error', { styled: !agentMode }))
      }

      // Still allow saving error response
      if (flags.save) {
        const savePath = flags.save
        const saveDir = dirname(savePath)
        if (saveDir && !existsSync(saveDir)) {
          mkdirSync(saveDir, { recursive: true })
        }

        writeFileSync(savePath, JSON.stringify(errorOutput, null, 2) + '\n', 'utf8')
        if (!flags.raw && !flags.json) {
          this.log(`\nSaved to ${savePath}`)
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

    // Format output based on mode priority: --json > --raw > YAML-like (styled/plain)
    let outputString: string
    if (flags.extract) {
      // When extracting, output just the value
      if (flags.json) {
        outputString = typeof output === 'string' ? JSON.stringify(output) : JSON.stringify(output, null, 2)
      } else {
        outputString = typeof output === 'string' ? output : formatYamlLike(output, { styled: !agentMode })
      }
    } else if (flags.json) {
      // JSON flag has priority
      outputString = JSON.stringify(output, null, 2)
    } else if (flags.raw) {
      outputString = JSON.stringify(output)
    } else {
      // YAML-like format with status: styled for humans, plain for agents
      outputString = formatApiResponse(response.status, output, { styled: !agentMode })
    }

    // Save to file if requested
    if (flags.save) {
      const savePath = flags.save
      const saveDir = dirname(savePath)

      // Create directory if it doesn't exist
      if (saveDir && !existsSync(saveDir)) {
        mkdirSync(saveDir, { recursive: true })
      }

      // Save as JSON for machine-readable format
      const saveContent = flags.extract && typeof output === 'string'
        ? output
        : typeof output === 'string' ? output : JSON.stringify(output, null, 2)

      writeFileSync(savePath, saveContent + '\n', 'utf8')

      // Show saved message unless using --raw or --json
      if (!flags.raw && !flags.json) {
        this.log(`\nSaved to ${savePath}`)
      }
    }

    // Output to console (unless only saving with --raw)
    if (!flags.save || !flags.raw) {
      this.log(outputString)
    }
  }

  /**
   * Resolve the canonical ID from arguments
   * If group is provided, use it; otherwise auto-resolve from path using endpoints.json
   */
  private resolveCanonical(
    projectRoot: string,
    groupName: string | undefined,
    method: string,
    endpointPath: string
  ): string {
    const groups = loadGroups(projectRoot)

    // If group is provided, use it directly
    if (groupName) {
      // Try to resolve as group name first
      const groupInfo = findGroupByName(groups, groupName)
      if (groupInfo) {
        return groupInfo.canonical
      }

      // Assume it's a canonical ID
      return groupName
    }

    // Auto-resolve from path using endpoints.json
    const endpoints = loadEndpoints(projectRoot)

    // Check if endpoints.json exists and has data
    if (Object.keys(endpoints).length === 0) {
      this.error(
        `Could not find API endpoint for path "${endpointPath}".\n` +
        'Run "xano pull --sync" to refresh metadata, or specify the group explicitly:\n' +
        `  xano api:call <group> ${method} ${endpointPath}`
      )
    }

    try {
      const match = findMatchingEndpoint(endpoints, method, endpointPath)

      if (!match) {
        this.error(
          `Could not find API endpoint for ${method} "${endpointPath}".\n` +
          'Run "xano pull --sync" to refresh metadata, or specify the group explicitly:\n' +
          `  xano api:call <group> ${method} ${endpointPath}`
        )
      }

      return match.canonical
    } catch (error) {
      // Handle ambiguity error from findMatchingEndpoint
      if (error instanceof Error) {
        this.error(error.message)
      }

      throw error
    }
  }

  /**
   * Resolve auth token from flags
   */
  private resolveToken(token?: string, tokenFile?: string): string | undefined {
    if (token) {
      return token.trim()
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
