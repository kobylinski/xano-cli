import { Args, Flags } from '@oclif/core'

import BaseCommand from '../../../base-command.js'
import {
  getProfile,
  XanoApi,
} from '../../../lib/api.js'
import {
  loadGroups,
  loadObjects,
} from '../../../lib/objects.js'
import {
  findProjectRoot,
  isInitialized,
  loadLocalConfig,
} from '../../../lib/project.js'
import type {
  OpenApiOperation,
  OpenApiParameter,
  OpenApiSchema,
} from '../../../lib/types.js'

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

export default class ApiDescribe extends BaseCommand {
  /* eslint-disable perfectionist/sort-objects -- positional arg order matters in oclif */
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
  /* eslint-enable perfectionist/sort-objects */
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

    const config = loadLocalConfig(projectRoot)
    if (!config) {
      this.error('Failed to load .xano/config.json')
    }

    const profile = getProfile(flags.profile, config.profile)
    if (!profile) {
      this.error('No profile found. Run "xano init" first.')
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

    // Find the endpoint
    const groups = loadGroups(projectRoot)
    const objects = loadObjects(projectRoot)

    // Normalize the path for comparison
    const normalizedPath = endpointPath.startsWith('/') ? endpointPath.slice(1) : endpointPath

    // Find matching endpoint
    let foundEndpoint: {
      apigroup_id: number
      groupCanonical?: string
      groupName: string
      id: number
      path: string
      verb: string
    } | undefined

    // Helper to find group name from groups map
    const findGroupNameByDir = (dirName: string): { canonical?: string; id: number; name: string } | undefined => {
      for (const [name, info] of Object.entries(groups)) {
        if (name.toLowerCase() === dirName.toLowerCase()) {
          return { canonical: info.canonical, id: info.id, name }
        }
      }
      return undefined
    }

    // Helper to extract endpoint path from filename
    const extractEndpointPath = (filename: string, verb: string): string => {
      const withoutSuffix = filename.replace(new RegExp(`_${verb}\\.xs$`), '')
      return '/' + withoutSuffix.replaceAll('_', '/')
    }

    // Search for the endpoint
    for (const obj of objects) {
      if (obj.type !== 'api_endpoint') continue

      const parts = obj.path.split('/')
      const groupDir = parts.at(-2)!
      const filename = parts.at(-1)!

      // If group is specified, filter by group
      if (groupName && groupDir?.toLowerCase() !== groupName.toLowerCase()) continue

      const match = filename.match(/^(.+)_([A-Z]+)\.xs$/)
      if (!match) continue

      const [, , verb] = match
      if (verb !== method) continue

      const extractedPath = extractEndpointPath(filename, verb)

      if (extractedPath === endpointPath ||
          normalizedPath === extractedPath.slice(1) ||
          extractedPath.includes(normalizedPath.replaceAll('/', '_'))) {
        const groupInfo = findGroupNameByDir(groupDir)

        foundEndpoint = {
          apigroup_id: groupInfo?.id || 0,
          groupCanonical: groupInfo?.canonical,
          groupName: groupInfo?.name || groupDir,
          id: obj.id,
          path: endpointPath,
          verb: method,
        }
        break
      }
    }

    if (!foundEndpoint) {
      this.error(
        `Endpoint not found: ${method} ${endpointPath}\n` +
        'Run "xano pull --sync" to refresh metadata, or check the path is correct.'
      )
    }

    // Fetch OpenAPI spec for the endpoint
    const openApiResponse = await api.getApiEndpointOpenApi(foundEndpoint.apigroup_id, foundEndpoint.id)

    if (!openApiResponse.ok || !openApiResponse.data) {
      this.error(`Failed to fetch endpoint OpenAPI spec: ${openApiResponse.error}`)
    }

    const openApi = openApiResponse.data

    // Find the operation in the OpenAPI spec
    let operation: OpenApiOperation | undefined
    let actualPath = ''

    for (const [pathKey, pathItem] of Object.entries(openApi.paths)) {
      const methodLower = method.toLowerCase() as keyof typeof pathItem
      if (pathItem[methodLower]) {
        operation = pathItem[methodLower]
        actualPath = pathKey
        break
      }
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
      group: foundEndpoint.groupName,
      groupCanonical: foundEndpoint.groupCanonical,
      inputs: inputs.map(i => ({
        description: i.description,
        enum: i.schema?.enum,
        in: i.in,
        name: i.name,
        required: i.required,
        type: formatSchemaType(i.schema),
      })),
      method: foundEndpoint.verb,
      path: actualPath || foundEndpoint.path,
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
      this.log(`Description: ${result.description}`)
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
        const location = input.in !== 'body' ? ` [${input.in}]` : ''
        this.log(`  ${input.name}: ${input.type} ${required}${location}`)

        if (input.description) {
          this.log(`    ${input.description}`)
        }
      }
    }

    this.log('')
    if (result.response) {
      this.log('Response:')
      this.log(`  ${JSON.stringify(result.response, null, 2).split('\n').join('\n  ')}`)
    } else {
      this.log('Response: (not specified)')
    }
  }
}
