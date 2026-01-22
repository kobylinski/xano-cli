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

/**
 * Parse XanoScript input block to extract parameter definitions
 */
function parseInputBlock(xanoscript: string): Array<{
  description?: string
  filters?: string[]
  name: string
  required: boolean
  type: string
  values?: string[]
}> {
  const inputs: Array<{
    description?: string
    filters?: string[]
    name: string
    required: boolean
    type: string
    values?: string[]
  }> = []

  // Find the input block - handle nested braces
  const inputStart = xanoscript.indexOf('input {')
  if (inputStart === -1) {
    return inputs
  }

  // Find matching closing brace, accounting for nested braces
  let depth = 0
  let inputEnd = -1
  for (let i = inputStart + 6; i < xanoscript.length; i++) {
    if (xanoscript[i] === '{') depth++
    if (xanoscript[i] === '}') {
      if (depth === 0) {
        inputEnd = i
        break
      }
      depth--
    }
  }

  if (inputEnd === -1) return inputs

  const inputBlock = xanoscript.slice(inputStart + 7, inputEnd)

  // Split into lines and process
  const lines = inputBlock.split('\n')
  let currentComment: string | undefined
  let i = 0

  while (i < lines.length) {
    const line = lines[i].trim()

    // Skip empty lines
    if (!line) {
      i++
      continue
    }

    // Capture comment for next input
    if (line.startsWith('//')) {
      currentComment = line.slice(2).trim()
      i++
      continue
    }

    // Parse input definition: type? name? [filters=...] [{ ... }]
    // Examples:
    //   enum? status? { values = [...] }
    //   text? type? filters=trim
    //   int? page?
    const inputMatch = line.match(/^(\w+)(\?)?\s+(\w+)(\?)?\s*(filters\s*=\s*[\w,]+)?/)
    if (inputMatch) {
      const [, type, typeOptional, name, nameOptional, filtersStr] = inputMatch
      const isRequired = !typeOptional && !nameOptional

      const input: {
        description?: string
        filters?: string[]
        name: string
        required: boolean
        type: string
        values?: string[]
      } = {
        name,
        required: isRequired,
        type,
      }

      if (currentComment) {
        input.description = currentComment
        currentComment = undefined
      }

      if (filtersStr) {
        const filterMatch = filtersStr.match(/filters\s*=\s*([\w,]+)/)
        if (filterMatch) {
          input.filters = filterMatch[1].split(',').map(f => f.trim())
        }
      }

      // Check if there's a block with values (for enum)
      if (line.includes('{')) {
        // Find the closing brace - might span multiple lines
        let blockContent = line.slice(line.indexOf('{') + 1)
        let braceDepth = 1
        let j = i + 1

        while (braceDepth > 0 && j < lines.length) {
          const nextLine = lines[j]
          for (const char of nextLine) {
            if (char === '{') braceDepth++
            if (char === '}') braceDepth--
          }
          if (braceDepth > 0) {
            blockContent += '\n' + nextLine
          } else {
            blockContent += '\n' + nextLine.slice(0, nextLine.lastIndexOf('}'))
          }
          j++
        }

        // Parse enum values
        if (type === 'enum') {
          const valuesMatch = blockContent.match(/values\s*=\s*\[([^\]]*)\]/)
          if (valuesMatch) {
            input.values = valuesMatch[1]
              .split(',')
              .map(v => v.trim().replace(/^["']|["']$/g, ''))
              .filter(v => v.length > 0)
          }
        }

        i = j
      } else {
        i++
      }

      inputs.push(input)
    } else {
      i++
    }
  }

  return inputs
}

/**
 * Parse XanoScript to extract endpoint metadata
 */
function parseEndpointMetadata(xanoscript: string): {
  auth?: string
  description?: string
  inputs: ReturnType<typeof parseInputBlock>
  middleware?: unknown
  response?: string
  tags?: string[]
} {
  const metadata: {
    auth?: string
    description?: string
    inputs: ReturnType<typeof parseInputBlock>
    middleware?: unknown
    response?: string
    tags?: string[]
  } = {
    inputs: parseInputBlock(xanoscript),
  }

  // Extract auth
  const authMatch = xanoscript.match(/auth\s*=\s*"([^"]*)"/)
  if (authMatch) {
    metadata.auth = authMatch[1]
  }

  // Extract response
  const responseMatch = xanoscript.match(/response\s*=\s*([^\n]+)/)
  if (responseMatch) {
    metadata.response = responseMatch[1].trim()
  }

  // Extract tags
  const tagsMatch = xanoscript.match(/tags\s*=\s*\[([^\]]*)\]/)
  if (tagsMatch) {
    metadata.tags = tagsMatch[1]
      .split(',')
      .map(t => t.trim().replace(/^["']|["']$/g, ''))
      .filter(t => t.length > 0)
  }

  // Extract middleware
  const middlewareMatch = xanoscript.match(/middleware\s*=\s*(\{[^}]*(?:\{[^}]*\}[^}]*)*\})/)
  if (middlewareMatch) {
    try {
      // Convert XanoScript object notation to JSON-like
      const jsonLike = middlewareMatch[1]
        .replaceAll(/(\w+)\s*:/g, '"$1":')
        .replaceAll(/:\s*\[([^\]]*)\]/g, (_, content) => {
          const items = content.split(/\},\s*\{/).map((item: string) => {
            return item
              .replace(/^\{?\s*/, '{')
              .replace(/\s*\}?$/, '}')
              .replaceAll(/(\w+)\s*:/g, '"$1":')
          })
          return `: [${items.join(', ')}]`
        })
      metadata.middleware = JSON.parse(jsonLike)
    } catch {
      // Keep as string if parsing fails
      metadata.middleware = middlewareMatch[1]
    }
  }

  // Extract description (first comment line)
  const descMatch = xanoscript.match(/^\/\/\s*([^\n]+)/m)
  if (descMatch) {
    metadata.description = descMatch[1].trim()
  }

  return metadata
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
    // Filename format: path_part_VERB.xs (e.g., admin_queue_GET.xs)
    const extractEndpointPath = (filename: string, verb: string): string => {
      // Remove _VERB.xs suffix
      const withoutSuffix = filename.replace(new RegExp(`_${verb}\\.xs$`), '')
      // Convert underscores back to slashes for path matching
      return '/' + withoutSuffix.replaceAll('_', '/')
    }

    // If group is specified, filter by group
    if (groupName) {
      const groupInfo = findGroupNameByDir(groupName)
      if (!groupInfo) {
        this.error(`API group not found: ${groupName}`)
      }

      // Search in objects for matching endpoint
      for (const obj of objects) {
        if (obj.type !== 'api_endpoint') continue

        const parts = obj.path.split('/')
        const groupDir = parts.at(-2)

        if (groupDir?.toLowerCase() !== groupName.toLowerCase()) continue

        const filename = parts.at(-1)!
        const match = filename.match(/^(.+)_([A-Z]+)\.xs$/)
        if (!match) continue

        const [, , verb] = match
        if (verb !== method) continue

        // Extract the endpoint path from the filename and compare
        const extractedPath = extractEndpointPath(filename, verb)

        // Match if the extracted path matches or if the normalized input path is contained
        if (extractedPath === endpointPath ||
            normalizedPath === extractedPath.slice(1) ||
            extractedPath.includes(normalizedPath.replaceAll('/', '_'))) {
          foundEndpoint = {
            apigroup_id: groupInfo.id,
            groupCanonical: groupInfo.canonical,
            groupName: groupInfo.name,
            id: obj.id,
            path: endpointPath,
            verb: method,
          }
          break
        }
      }
    } else {
      // Search all endpoints
      for (const obj of objects) {
        if (obj.type !== 'api_endpoint') continue

        const parts = obj.path.split('/')
        const filename = parts.at(-1)!
        const match = filename.match(/^(.+)_([A-Z]+)\.xs$/)
        if (!match) continue

        const [, , verb] = match
        if (verb !== method) continue

        // Extract the endpoint path from the filename and compare
        const extractedPath = extractEndpointPath(filename, verb)

        // Match if the extracted path matches or if the normalized input path is contained
        if (extractedPath === endpointPath ||
            normalizedPath === extractedPath.slice(1) ||
            extractedPath.includes(normalizedPath.replaceAll('/', '_'))) {
          const groupDir = parts.at(-2)!
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
    }

    if (!foundEndpoint) {
      this.error(
        `Endpoint not found: ${method} ${endpointPath}\n` +
        'Run "xano pull --sync" to refresh metadata, or check the path is correct.'
      )
    }

    // Fetch full endpoint details with XanoScript
    const endpointResponse = await api.getApiEndpoint(foundEndpoint.id, foundEndpoint.apigroup_id)

    if (!endpointResponse.ok || !endpointResponse.data) {
      this.error(`Failed to fetch endpoint details: ${endpointResponse.error}`)
    }

    const endpoint = endpointResponse.data
    const xanoscript = typeof endpoint.xanoscript === 'string'
      ? endpoint.xanoscript
      : endpoint.xanoscript?.value || ''

    if (!xanoscript) {
      this.error('Endpoint has no XanoScript content. Try running "xano pull" first.')
    }

    // Parse the XanoScript
    const metadata = parseEndpointMetadata(xanoscript)

    const result = {
      auth: metadata.auth,
      description: metadata.description,
      group: foundEndpoint.groupName,
      groupCanonical: foundEndpoint.groupCanonical,
      inputs: metadata.inputs,
      method: foundEndpoint.verb,
      middleware: metadata.middleware,
      path: foundEndpoint.path,
      response: metadata.response,
      tags: metadata.tags,
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

    if (result.auth) {
      this.log(`Auth: ${result.auth}`)
    }

    if (result.tags && result.tags.length > 0) {
      this.log(`Tags: ${result.tags.join(', ')}`)
    }

    if (result.middleware) {
      this.log(`Middleware: ${JSON.stringify(result.middleware)}`)
    }

    this.log('')
    this.log('Inputs:')
    if (result.inputs.length === 0) {
      this.log('  (none)')
    } else {
      for (const input of result.inputs) {
        const required = input.required ? '(required)' : '(optional)'
        let line = `  ${input.name}: ${input.type} ${required}`

        if (input.values) {
          line += ` [${input.values.join(', ')}]`
        }

        if (input.filters) {
          line += ` filters=${input.filters.join(',')}`
        }

        this.log(line)

        if (input.description) {
          this.log(`    ${input.description}`)
        }
      }
    }

    this.log('')
    this.log(`Response: ${result.response || '(not specified)'}`)
  }
}
