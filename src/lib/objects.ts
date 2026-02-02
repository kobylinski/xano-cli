/**
 * Objects file management
 * Handles .xano/objects.json (VSCode compatible)
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { XanoObject, XanoObjectsFile, XanoObjectType } from './types.js'

import { logger } from './logger.js'
import { ensureXanoDir, getXanoDirPath } from './project.js'

const OBJECTS_JSON = 'objects.json'
const GROUPS_JSON = 'groups.json'
const ENDPOINTS_JSON = 'endpoints.json'

/**
 * API group info stored in groups.json
 */
export interface ApiGroupInfo {
  canonical: string
  id: number
}

/**
 * Structure of .xano/groups.json
 */
export type ApiGroupsFile = Record<string, ApiGroupInfo>

/**
 * Single endpoint entry in endpoints.json
 */
export interface EndpointEntry {
  canonical: string
  id: number
  pattern: string  // e.g., "devices/{device_id}" or "auth/login"
}

/**
 * Structure of .xano/endpoints.json
 * Indexed by HTTP verb for fast lookup
 */
export type EndpointsFile = Record<string, EndpointEntry[]>

/**
 * Get path to .xano/objects.json
 */
export function getObjectsJsonPath(projectRoot: string): string {
  return join(getXanoDirPath(projectRoot), OBJECTS_JSON)
}

/**
 * Get path to .xano/groups.json
 */
export function getGroupsJsonPath(projectRoot: string): string {
  return join(getXanoDirPath(projectRoot), GROUPS_JSON)
}

/**
 * Load .xano/objects.json
 */
export function loadObjects(projectRoot: string): XanoObjectsFile {
  const filePath = getObjectsJsonPath(projectRoot)

  if (!existsSync(filePath)) {
    return []
  }

  try {
    const content = readFileSync(filePath, 'utf8')
    return JSON.parse(content) as XanoObjectsFile
  } catch {
    return []
  }
}

/**
 * Save .xano/objects.json
 */
export function saveObjects(projectRoot: string, objects: XanoObjectsFile): void {
  ensureXanoDir(projectRoot)
  const filePath = getObjectsJsonPath(projectRoot)
  logger.fileOp('write', '.xano/objects.json')
  logger.dataStored('objects', { count: objects.length })
  writeFileSync(filePath, JSON.stringify(objects, null, 2) + '\n', 'utf8')
}

/**
 * Load .xano/groups.json
 */
export function loadGroups(projectRoot: string): ApiGroupsFile {
  const filePath = getGroupsJsonPath(projectRoot)

  if (!existsSync(filePath)) {
    return {}
  }

  try {
    const content = readFileSync(filePath, 'utf8')
    return JSON.parse(content) as ApiGroupsFile
  } catch {
    return {}
  }
}

/**
 * Save .xano/groups.json
 */
export function saveGroups(projectRoot: string, groups: ApiGroupsFile): void {
  ensureXanoDir(projectRoot)
  const filePath = getGroupsJsonPath(projectRoot)
  logger.fileOp('write', '.xano/groups.json')
  logger.dataStored('groups', { count: Object.keys(groups).length })
  writeFileSync(filePath, JSON.stringify(groups, null, 2) + '\n', 'utf8')
}

/**
 * Get path to .xano/endpoints.json
 */
export function getEndpointsJsonPath(projectRoot: string): string {
  return join(getXanoDirPath(projectRoot), ENDPOINTS_JSON)
}

/**
 * Load .xano/endpoints.json
 */
export function loadEndpoints(projectRoot: string): EndpointsFile {
  const filePath = getEndpointsJsonPath(projectRoot)

  if (!existsSync(filePath)) {
    return {}
  }

  try {
    const content = readFileSync(filePath, 'utf8')
    return JSON.parse(content) as EndpointsFile
  } catch {
    return {}
  }
}

/**
 * Save .xano/endpoints.json
 */
export function saveEndpoints(projectRoot: string, endpoints: EndpointsFile): void {
  ensureXanoDir(projectRoot)
  const filePath = getEndpointsJsonPath(projectRoot)
  writeFileSync(filePath, JSON.stringify(endpoints, null, 2) + '\n', 'utf8')
}

/**
 * Result of matching a concrete path against endpoint patterns
 */
export interface EndpointMatchResult {
  canonical: string
  endpoint: EndpointEntry
  pathParams: Record<string, string>
  queryParams: Record<string, string>
}

/**
 * Match a concrete path against a pattern
 * Pattern segments are either literals or {param} placeholders
 * Returns extracted path parameters if matched, null if no match
 */
function matchPattern(
  concretePath: string,
  pattern: string
): null | Record<string, string> {
  // Normalize: remove leading slashes and split
  const concreteSegments = concretePath.replace(/^\/+/, '').split('/').filter(Boolean)
  const patternSegments = pattern.replace(/^\/+/, '').split('/').filter(Boolean)

  if (concreteSegments.length !== patternSegments.length) {
    return null
  }

  const params: Record<string, string> = {}

  for (const [i, patternPart] of patternSegments.entries()) {
    const concretePart = concreteSegments[i]

    // Check if this is a parameter placeholder {name}
    if (patternPart.startsWith('{') && patternPart.endsWith('}')) {
      const paramName = patternPart.slice(1, -1)
      params[paramName] = concretePart
    } else if (patternPart !== concretePart) {
      // Literal segment must match exactly
      return null
    }
  }

  return params
}

/**
 * Find matching endpoint for a concrete path and HTTP method
 *
 * @param endpoints - Loaded endpoints.json
 * @param method - HTTP method (GET, POST, etc.)
 * @param path - Concrete path like "/devices/abc-123"
 * @returns Match result with canonical, extracted params, or null if no match
 * @throws Error if multiple endpoints match across different canonicals
 */
export function findMatchingEndpoint(
  endpoints: EndpointsFile,
  method: string,
  path: string
): EndpointMatchResult | null {
  const verb = method.toUpperCase()
  const verbEndpoints = endpoints[verb]

  if (!verbEndpoints || verbEndpoints.length === 0) {
    return null
  }

  // Separate path from query string
  const [pathPart, queryString] = path.split('?')

  // Parse query parameters
  const queryParams: Record<string, string> = {}
  if (queryString) {
    for (const pair of queryString.split('&')) {
      const [key, value] = pair.split('=')
      if (key) {
        queryParams[decodeURIComponent(key)] = value ? decodeURIComponent(value) : ''
      }
    }
  }

  // Find all matching endpoints
  const matches: Array<{ endpoint: EndpointEntry; pathParams: Record<string, string> }> = []

  for (const endpoint of verbEndpoints) {
    const pathParams = matchPattern(pathPart, endpoint.pattern)
    if (pathParams !== null) {
      matches.push({ endpoint, pathParams })
    }
  }

  if (matches.length === 0) {
    return null
  }

  // Check for ambiguity across different canonicals
  const uniqueCanonicals = new Set(matches.map(m => m.endpoint.canonical))
  if (uniqueCanonicals.size > 1) {
    const canonicalList = [...uniqueCanonicals].join(', ')
    throw new Error(
      `Ambiguous endpoint: path "${path}" matches endpoints in multiple API groups.\n` +
      `Canonicals: ${canonicalList}\n` +
      `Specify the group explicitly: xano api:call <group> ${method} ${path}`
    )
  }

  // Return first match (all have same canonical)
  const match = matches[0]
  return {
    canonical: match.endpoint.canonical,
    endpoint: match.endpoint,
    pathParams: match.pathParams,
    queryParams,
  }
}

/**
 * Find API group info by name
 */
export function findGroupByName(groups: ApiGroupsFile, name: string): ApiGroupInfo | undefined {
  // Try exact match first
  if (groups[name]) {
    return groups[name]
  }

  // Try case-insensitive match
  const lowerName = name.toLowerCase()
  for (const [groupName, info] of Object.entries(groups)) {
    if (groupName.toLowerCase() === lowerName) {
      return info
    }
  }

  return undefined
}

/**
 * Find API group name by canonical ID
 */
export function findGroupByCanonical(groups: ApiGroupsFile, canonical: string): string | undefined {
  for (const [name, info] of Object.entries(groups)) {
    if (info.canonical === canonical) {
      return name
    }
  }

  return undefined
}

/**
 * Find object by file path
 */
export function findObjectByPath(objects: XanoObjectsFile, filePath: string): undefined | XanoObject {
  return objects.find((obj) => obj.path === filePath)
}

/**
 * Find object by ID
 */
export function findObjectById(objects: XanoObjectsFile, id: number): undefined | XanoObject {
  return objects.find((obj) => obj.id === id)
}

/**
 * Find objects by type
 */
export function findObjectsByType(objects: XanoObjectsFile, type: XanoObjectType): XanoObject[] {
  return objects.filter((obj) => obj.type === type)
}

/**
 * Compute SHA256 hash of content
 */
export function computeSha256(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex')
}

/**
 * Compute SHA256 hash of file
 */
export function computeFileSha256(filePath: string): null | string {
  if (!existsSync(filePath)) {
    return null
  }

  const content = readFileSync(filePath, 'utf8')
  return computeSha256(content)
}

/**
 * Encode content to base64
 */
export function encodeBase64(content: string): string {
  return Buffer.from(content, 'utf8').toString('base64')
}

/**
 * Decode content from base64
 */
export function decodeBase64(base64: string): string {
  return Buffer.from(base64, 'base64').toString('utf8')
}

/**
 * Add or update object in objects list
 */
export function upsertObject(
  objects: XanoObjectsFile,
  filePath: string,
  data: Partial<XanoObject> & { id: number; type: XanoObjectType }
): XanoObjectsFile {
  const existingIndex = objects.findIndex((obj) => obj.path === filePath)
  const fileContent = existsSync(filePath) ? readFileSync(filePath, 'utf8') : ''

  const newObject: XanoObject = {
    id: data.id,
    original: data.original ?? encodeBase64(fileContent),
    path: filePath,
    sha256: data.sha256 ?? computeSha256(fileContent),
    staged: false, // always false, kept for VSCode extension compatibility
    status: data.status ?? 'unchanged',
    type: data.type,
  }

  if (existingIndex === -1) {
    objects.push(newObject)
  } else {
    objects[existingIndex] = newObject
  }

  return objects
}

/**
 * Find API group for an api_endpoint based on path hierarchy
 *
 * Path structure:
 * - API endpoint: app/apis/{group_name}/{endpoint}_VERB.xs (e.g., app/apis/bootstrap/auth_login_POST.xs)
 * - API group (default naming):  app/apis/{group_name}.xs (e.g., app/apis/bootstrap.xs)
 * - API group (VSCode naming):   app/apis/{group_name}/api_group.xs (e.g., app/apis/bootstrap/api_group.xs)
 *
 * So we extract the directory name and look for the group file in both locations
 */
export function findApiGroupForEndpoint(
  objects: XanoObjectsFile,
  endpointPath: string
): undefined | XanoObject {
  // Get the parent directory of the endpoint
  // e.g., app/apis/bootstrap/auth_login_POST.xs -> ['app', 'apis', 'bootstrap', 'auth_login_POST.xs']
  const parts = endpointPath.split('/')
  if (parts.length < 3) return undefined

  // Remove the filename to get the group directory
  parts.pop()
  // Now parts = ['app', 'apis', 'bootstrap']

  // Get the group name (last directory)
  const groupName = parts.pop()
  if (!groupName) return undefined

  // Build expected paths for both naming conventions
  const apisDir = parts.join('/')
  // Default naming: app/apis/bootstrap.xs
  const defaultApiGroupPath = `${apisDir}/${groupName}.xs`
  // VSCode naming: app/apis/bootstrap/api_group.xs
  const vscodeApiGroupPath = `${apisDir}/${groupName}/api_group.xs`

  // Look for the api_group with exact path (check both naming conventions)
  const apiGroup = objects.find(
    (obj) => obj.type === 'api_group' && (obj.path === defaultApiGroupPath || obj.path === vscodeApiGroupPath)
  )

  if (apiGroup) return apiGroup

  // Fallback: find any api_group whose path matches the group directory
  // This handles cases where the group might be at a different path
  return objects.find(
    (obj) => obj.type === 'api_group' && (obj.path.endsWith(`/${groupName}.xs`) || obj.path.endsWith(`/${groupName}/api_group.xs`))
  )
}

/**
 * Remove object from objects list by path
 */
export function removeObjectByPath(objects: XanoObjectsFile, filePath: string): XanoObjectsFile {
  return objects.filter((obj) => obj.path !== filePath)
}

/**
 * Remove object from objects list by ID
 */
export function removeObjectById(objects: XanoObjectsFile, id: number): XanoObjectsFile {
  return objects.filter((obj) => obj.id !== id)
}

/**
 * Update object status based on file content
 * Status values match VSCode extension: new, unchanged, changed, error, notfound
 * NOTE: If sha256 is missing (VSCode-created record), we compute it and update the object
 */
export function updateObjectStatus(
  objects: XanoObjectsFile,
  projectRoot: string
): XanoObjectsFile {
  return objects.map((obj) => {
    const fullPath = join(projectRoot, obj.path)

    if (!existsSync(fullPath)) {
      return { ...obj, status: 'notfound' as const }
    }

    const currentSha256 = computeFileSha256(fullPath)

    // If sha256 is missing (VSCode-created record), set it now
    if (!obj.sha256) {
      const content = readFileSync(fullPath, 'utf8')
      return {
        ...obj,
        original: encodeBase64(content),
        sha256: currentSha256!,
        status: 'unchanged' as const,
      }
    }

    if (currentSha256 !== obj.sha256) {
      return { ...obj, status: 'changed' as const }
    }

    return { ...obj, status: 'unchanged' as const }
  })
}

/**
 * Mark object as unchanged after successful sync
 */
export function markObjectSynced(
  objects: XanoObjectsFile,
  filePath: string,
  content: string
): XanoObjectsFile {
  const index = objects.findIndex((obj) => obj.path === filePath)

  if (index !== -1) {
    objects[index] = {
      ...objects[index],
      original: encodeBase64(content),
      sha256: computeSha256(content),
      staged: false,
      status: 'unchanged',
    }
  }

  return objects
}

/**
 * Get all file paths from objects
 */
export function getAllObjectPaths(objects: XanoObjectsFile): string[] {
  return objects.map((obj) => obj.path)
}

/**
 * Extract xanoscript string from API response
 * Handles both string format and object format { value, status }
 */
export function extractXanoscript(xs: unknown): null | string {
  if (!xs) {
    return null
  }

  if (typeof xs === 'string') {
    return xs
  }

  if (typeof xs === 'object' && xs !== null && 'value' in xs) {
    const {value} = (xs as { value: unknown })
    if (typeof value === 'string') {
      return value
    }
  }

  return null
}
