import { Args, Flags } from '@oclif/core'

import type {
  OpenApiOperation,
  OpenApiParameter,
  OpenApiSchema,
} from '../../../lib/types.js'

import BaseCommand from '../../../base-command.js'
import {
  getMissingProfileError,
  getProfile,
  XanoApi,
} from '../../../lib/api.js'
import {
  type ApiGroupsFile,
  findGroupByCanonical,
  findGroupByName,
  loadGroups,
  loadObjects,
} from '../../../lib/objects.js'
import {
  findProjectRoot,
  isInitialized,
  loadCliConfig,
  loadEffectiveConfig,
} from '../../../lib/project.js'

/**
 * Strip HTML tags from text
 */
function stripHtml(text: string): string {
  return text
    .replaceAll(/<br\s*\/?>/gi, '\n')  // Convert <br> to newlines
    .replaceAll(/<[^>]+>/g, '')         // Remove all other HTML tags
    .replaceAll(/\n\s*\n/g, '\n')       // Collapse multiple newlines
    .trim()
}

/**
 * Format response schema properties for display (recursive)
 */
function formatResponseFields(
  schema: OpenApiSchema,
  indent: number = 0
): string[] {
  const lines: string[] = []
  const prefix = '  '.repeat(indent)

  if (schema.type === 'array' && schema.items) {
    lines.push(`${prefix}(array of:)`, ...formatResponseFields(schema.items, indent + 1))
    return lines
  }

  if (schema.properties) {
    for (const [name, prop] of Object.entries(schema.properties)) {
      const required = schema.required?.includes(name) ? '' : '?'
      const type = formatSchemaType(prop)
      lines.push(`${prefix}${name}${required}: ${type}`)

      if (prop.description) {
        lines.push(`${prefix}  ${stripHtml(prop.description)}`)
      }

      // Recurse for nested objects
      if (prop.type === 'object' && prop.properties) {
        lines.push(...formatResponseFields(prop, indent + 1))
      } else if (prop.type === 'array' && prop.items?.properties) {
        lines.push(`${prefix}  (array of:)`, ...formatResponseFields(prop.items, indent + 2))
      }
    }
  }

  return lines
}

/**
 * Convert OpenAPI schema to a simplified input format
 */
function schemaToInputs(
  parameters: OpenApiParameter[] | undefined,
  requestBody?: { content?: Record<string, { schema?: OpenApiSchema }>; required?: boolean }
): Array<{
  description?: string
  in: string
  name: string
  required: boolean
  schema?: OpenApiSchema
  type: string
}> {
  const inputs: Array<{
    description?: string
    in: string
    name: string
    required: boolean
    schema?: OpenApiSchema
    type: string
  }> = []

  // Add query/path/header parameters
  if (parameters) {
    for (const param of parameters) {
      inputs.push({
        description: param.description,
        in: param.in,
        name: param.name,
        required: param.required ?? false,
        schema: param.schema,
        type: param.schema?.type || 'unknown',
      })
    }
  }

  // Add request body properties
  if (requestBody?.content) {
    const jsonContent = requestBody.content['application/json']
    if (jsonContent?.schema?.properties) {
      const requiredFields = jsonContent.schema.required || []
      for (const [name, schema] of Object.entries(jsonContent.schema.properties)) {
        inputs.push({
          description: schema.description,
          in: 'body',
          name,
          required: requiredFields.includes(name),
          schema,
          type: schema.type || 'unknown',
        })
      }
    }
  }

  return inputs
}

/**
 * Format schema type for display
 */
function formatSchemaType(schema?: OpenApiSchema): string {
  if (!schema) return 'unknown'

  if (schema.enum) {
    return `enum [${schema.enum.join(', ')}]`
  }

  if (schema.type === 'array' && schema.items) {
    return `array<${formatSchemaType(schema.items)}>`
  }

  if (schema.format) {
    return `${schema.type} (${schema.format})`
  }

  return schema.type || 'unknown'
}

/**
 * Extract endpoint path from filename
 */
function extractEndpointPath(filename: string, verb: string): string {
  const withoutSuffix = filename.replace(new RegExp(`_${verb}\\.xs$`), '')
  return '/' + withoutSuffix.replaceAll('_', '/')
}

export default class ApiDescribe extends BaseCommand {
   
  static args = {
    groupOrMethod: Args.string({
      description: 'API group name OR HTTP method (GET, POST, PUT, DELETE, PATCH)',
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
static description = 'Describe an API endpoint schema (inputs, outputs, auth)'
  static examples = [
    '<%= config.bin %> api:describe GET /admin/queue',
    '<%= config.bin %> api:describe bootstrap GET /admin/queue',
    '<%= config.bin %> api:describe POST /auth/login --json',
  ]
  static flags = {
    ...BaseCommand.baseFlags,
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(ApiDescribe)

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
      this.error('Profile not found in credentials. Run "xano init" to configure.')
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
      this.error('Missing endpoint path. Usage: xano api:describe [group] <method> <path>')
    }

    if (!httpMethods.includes(method)) {
      this.error(`Invalid HTTP method: ${method}. Must be one of: ${httpMethods.join(', ')}`)
    }

    if (!endpointPath.startsWith('/')) {
      endpointPath = '/' + endpointPath
    }

    const api = new XanoApi(profile, config.workspaceId, config.branch)

    // Load local metadata
    const groups = loadGroups(projectRoot)
    const objects = loadObjects(projectRoot)
    const hasLocalMetadata = objects.length > 0 && Object.keys(groups).length > 0

    // Variables for result
    let openApi: import('../../../lib/types.js').OpenApiSpec
    let operation: OpenApiOperation | undefined
    let actualPath = ''
    let resolvedGroupName = groupName || ''
    let resolvedGroupCanonical = ''

    // Fast path: when group canonical is provided, fetch OpenAPI directly
    if (groupName && this.looksLikeCanonical(groupName)) {
      // Use fast direct fetch by canonical
      const openApiResponse = await api.getApiGroupOpenApiByCanonical(groupName)

      if (!openApiResponse.ok || !openApiResponse.data) {
        this.error(`Failed to fetch OpenAPI spec for group "${groupName}": ${openApiResponse.error}`)
      }

      openApi = openApiResponse.data
      resolvedGroupCanonical = groupName

      // Extract group name from OpenAPI info if available
      if (openApi.info?.title) {
        resolvedGroupName = openApi.info.title
      }

      // Find the operation in the OpenAPI spec
      const found = this.findOperationInOpenApi(openApi, method, endpointPath)
      if (found) {
        operation = found.operation
        actualPath = found.path
      }
    } else if (hasLocalMetadata) {
      // Have objects.json - use local metadata with name/canonical lookup
      const foundEndpoint = this.findEndpointFromLocal(groups, objects, groupName, method, endpointPath)

      if (!foundEndpoint) {
        this.error(
          `Endpoint not found: ${method} ${endpointPath}\n` +
          'Run "xano sync" to refresh metadata, or check the path is correct.'
        )
      }

      resolvedGroupName = foundEndpoint.groupName
      resolvedGroupCanonical = foundEndpoint.groupCanonical || ''

      // Use canonical for fast fetch if available, otherwise fall back to ID-based fetch
      const openApiResponse = resolvedGroupCanonical
        ? await api.getApiGroupOpenApiByCanonical(resolvedGroupCanonical)
        : await api.getApiEndpointOpenApi(foundEndpoint.apigroup_id, foundEndpoint.id)

      if (!openApiResponse.ok || !openApiResponse.data) {
        this.error(`Failed to fetch OpenAPI spec: ${openApiResponse.error}`)
      }

      openApi = openApiResponse.data

      // Find the operation
      const found = this.findOperationInOpenApi(openApi, method, endpointPath)
      if (found) {
        operation = found.operation
        actualPath = found.path
      }
    } else {
      // No objects.json and no group provided (or group looks like a name, not canonical)
      this.error(
        'No metadata found. Either:\n' +
        '  1. Run "xano sync" to fetch metadata first, or\n' +
        '  2. Provide the API group canonical: xano api:describe <canonical> <method> <path>'
      )
    }

    if (!operation) {
      this.error('Could not find operation in OpenAPI spec')
    }

    // Extract inputs from OpenAPI
    const inputs = schemaToInputs(operation.parameters, operation.requestBody)

    // Extract response schema
    const successResponse = operation.responses?.['200'] || operation.responses?.['201']
    let responseSchema: OpenApiSchema | undefined
    if (successResponse?.content?.['application/json']?.schema) {
      responseSchema = successResponse.content['application/json'].schema
    }

    // Build result
    const result = {
      description: operation.description || operation.summary,
      group: resolvedGroupName,
      groupCanonical: resolvedGroupCanonical,
      inputs: inputs.map(i => ({
        description: i.description,
        enum: i.schema?.enum,
        in: i.in,
        name: i.name,
        required: i.required,
        type: formatSchemaType(i.schema),
      })),
      method,
      path: actualPath || endpointPath,
      response: responseSchema,
      security: operation.security,
      servers: openApi.servers,
      tags: operation.tags,
    }

    if (flags.json) {
      this.log(JSON.stringify(result, null, 2))
      return
    }

    // Human-readable output
    this.log(`${result.method} ${result.path}`)
    this.log(`Group: ${result.group} (canonical: ${result.groupCanonical || 'unknown'})`)

    if (result.description) {
      this.log(`Description: ${stripHtml(result.description)}`)
    }

    if (result.tags && result.tags.length > 0) {
      this.log(`Tags: ${result.tags.join(', ')}`)
    }

    if (result.security && result.security.length > 0) {
      const securityNames = result.security.map(s => Object.keys(s).join(', ')).join('; ')
      this.log(`Security: ${securityNames}`)
    }

    if (result.servers && result.servers.length > 0) {
      this.log(`Server: ${result.servers[0].url}`)
    }

    this.log('')
    this.log('Inputs:')
    if (result.inputs.length === 0) {
      this.log('  (none)')
    } else {
      for (const input of result.inputs) {
        const required = input.required ? '(required)' : '(optional)'
        const location = input.in === 'body' ? '' : ` [${input.in}]`
        this.log(`  ${input.name}: ${input.type} ${required}${location}`)

        if (input.description) {
          this.log(`    ${stripHtml(input.description)}`)
        }
      }
    }

    this.log('')
    this.log('Response:')
    if (result.response) {
      const responseLines = formatResponseFields(result.response, 1)
      if (responseLines.length > 0) {
        for (const line of responseLines) {
          this.log(line)
        }
      } else {
        // Fallback for schemas without properties (e.g., primitives)
        this.log(`  ${formatSchemaType(result.response)}`)
      }
    } else {
      this.log('  (not specified)')
    }
  }

  /**
   * Find endpoint from local objects.json metadata
   * Supports lookup by group name or canonical
   */
  private findEndpointFromLocal(
    groups: ApiGroupsFile,
    objects: Array<{ id: number; path: string; type: string }>,
    groupIdentifier: string | undefined,
    method: string,
    endpointPath: string
  ): undefined | {
    apigroup_id: number
    groupCanonical?: string
    groupName: string
    id: number
    path: string
    verb: string
  } {
    // Normalize the path for comparison
    const normalizedPath = endpointPath.startsWith('/') ? endpointPath.slice(1) : endpointPath

    // Helper to find group info
    const findGroup = (identifier: string): undefined | { canonical?: string; id: number; name: string } => {
      // First try by name
      const byName = findGroupByName(groups, identifier)
      if (byName) {
        // Find the name key for this group
        for (const [name, info] of Object.entries(groups)) {
          if (info.id === byName.id) {
            return { canonical: info.canonical, id: info.id, name }
          }
        }
      }

      // Then try by canonical
      const nameByCanonical = findGroupByCanonical(groups, identifier)
      if (nameByCanonical) {
        const info = groups[nameByCanonical]
        return { canonical: info.canonical, id: info.id, name: nameByCanonical }
      }

      return undefined
    }

    // Helper to find group name from directory name
    const findGroupNameByDir = (dirName: string): undefined | { canonical?: string; id: number; name: string } => {
      for (const [name, info] of Object.entries(groups)) {
        if (name.toLowerCase() === dirName.toLowerCase()) {
          return { canonical: info.canonical, id: info.id, name }
        }
      }

      return undefined
    }

    // If group identifier is provided, resolve it first
    let targetGroupInfo: undefined | { canonical?: string; id: number; name: string }
    if (groupIdentifier) {
      targetGroupInfo = findGroup(groupIdentifier)
      if (!targetGroupInfo) {
        // Group identifier not found in local metadata
        return undefined
      }
    }

    // Search for the endpoint in objects
    for (const obj of objects) {
      if (obj.type !== 'api_endpoint') continue

      const parts = obj.path.split('/')
      const groupDir = parts.at(-2)!
      const filename = parts.at(-1)!

      // Get group info for this endpoint
      const groupInfo = findGroupNameByDir(groupDir)

      // If target group specified, filter by it
      if (targetGroupInfo && groupInfo?.id !== targetGroupInfo.id) continue

      const match = filename.match(/^(.+)_([A-Z]+)\.xs$/)
      if (!match) continue

      const verb = match[2]
      if (verb !== method) continue

      const extractedPath = extractEndpointPath(filename, verb)

      if (extractedPath === endpointPath ||
          normalizedPath === extractedPath.slice(1) ||
          extractedPath.includes(normalizedPath.replaceAll('/', '_'))) {
        return {
          apigroup_id: groupInfo?.id || 0, // eslint-disable-line camelcase
          groupCanonical: groupInfo?.canonical,
          groupName: groupInfo?.name || groupDir,
          id: obj.id,
          path: endpointPath,
          verb: method,
        }
      }
    }

    return undefined
  }

  /**
   * Find an operation in an OpenAPI spec by method and path
   */
  private findOperationInOpenApi(
    openApi: import('../../../lib/types.js').OpenApiSpec,
    method: string,
    endpointPath: string
  ): undefined | { operation: OpenApiOperation; path: string } {
    const methodLower = method.toLowerCase()
    const normalizedPath = endpointPath.startsWith('/') ? endpointPath : '/' + endpointPath

    for (const [pathKey, pathItem] of Object.entries(openApi.paths)) {
      const op = pathItem[methodLower as keyof typeof pathItem] as OpenApiOperation | undefined
      if (!op) continue

      // Match exact path or path pattern (e.g., /users/{id} matches /users/123)
      if (pathKey === normalizedPath || this.pathMatches(pathKey, normalizedPath)) {
        return { operation: op, path: pathKey }
      }
    }

    return undefined
  }

  /**
   * Check if a string looks like a canonical ID (short alphanumeric with possible dash)
   * Canonicals are typically like "KM1dKCw-" - short, alphanumeric with possible special chars
   */
  private looksLikeCanonical(value: string): boolean {
    // Canonicals are typically 6-12 chars, alphanumeric with possible dash/underscore
    // Group names are usually longer and contain spaces or are full words
    return /^[\w-]{4,16}$/.test(value) && !/\s/.test(value) && !/^[a-z_]+$/.test(value)
  }

  /**
   * Check if a path pattern matches a concrete path
   * e.g., /users/{id} matches /users/123
   */
  private pathMatches(pattern: string, path: string): boolean {
    const patternParts = pattern.split('/')
    const pathParts = path.split('/')

    if (patternParts.length !== pathParts.length) {
      return false
    }

    for (const [i, patternPart] of patternParts.entries()) {
      const pathPart = pathParts[i]

      // Path parameter (e.g., {id}) matches anything
      if (patternPart.startsWith('{') && patternPart.endsWith('}')) {
        continue
      }

      if (patternPart !== pathPart) {
        return false
      }
    }

    return true
  }
}
