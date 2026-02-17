/**
 * Objects file management
 * Handles .xano/branches/{branch}/objects.json (VSCode compatible)
 */

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

import type { XanoObject, XanoObjectsFile, XanoObjectType } from './types.js'

import { sanitize, sanitizePath, snakeCase } from './detector.js'
import { logger } from './logger.js'
import { ensureXanoDir, getXanoDirPath, loadLocalConfig } from './project.js'

const OBJECTS_JSON = 'objects.json'
const GROUPS_JSON = 'groups.json'
const ENDPOINTS_JSON = 'endpoints.json'
const SEARCH_JSON = 'search.json'
const BRANCHES_DIR = 'branches'

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
 * Get path to .xano/branches/{branch}/objects.json (VSCode compatible)
 * Falls back to .xano/objects.json if branch is not specified (legacy)
 */
export function getObjectsJsonPath(projectRoot: string, branch?: string): string {
  const xanoDir = getXanoDirPath(projectRoot)

  // If branch specified, use branch-namespaced path
  if (branch) {
    return join(xanoDir, BRANCHES_DIR, branch, OBJECTS_JSON)
  }

  // Try to get branch from config
  const config = loadLocalConfig(projectRoot)
  if (config?.branch) {
    return join(xanoDir, BRANCHES_DIR, config.branch, OBJECTS_JSON)
  }

  // Legacy fallback: .xano/objects.json
  return join(xanoDir, OBJECTS_JSON)
}

/**
 * Ensure .xano/branches/{branch}/ directory exists
 */
export function ensureBranchDir(projectRoot: string, branch: string): string {
  const branchDir = join(getXanoDirPath(projectRoot), BRANCHES_DIR, branch)

  if (!existsSync(branchDir)) {
    mkdirSync(branchDir, { recursive: true })
  }

  return branchDir
}

/**
 * Get path to .xano/groups.json
 */
export function getGroupsJsonPath(projectRoot: string): string {
  return join(getXanoDirPath(projectRoot), GROUPS_JSON)
}

/**
 * Load .xano/branches/{branch}/objects.json
 */
export function loadObjects(projectRoot: string, branch?: string): XanoObjectsFile {
  const filePath = getObjectsJsonPath(projectRoot, branch)

  if (!existsSync(filePath)) {
    // Try legacy path as fallback
    const legacyPath = join(getXanoDirPath(projectRoot), OBJECTS_JSON)
    if (existsSync(legacyPath)) {
      try {
        const content = readFileSync(legacyPath, 'utf8')
        return JSON.parse(content) as XanoObjectsFile
      } catch {
        return []
      }
    }

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
 * Save .xano/branches/{branch}/objects.json
 */
export function saveObjects(projectRoot: string, objects: XanoObjectsFile, branch?: string): void {
  ensureXanoDir(projectRoot)

  // Determine branch from parameter or config
  const config = loadLocalConfig(projectRoot)
  const effectiveBranch = branch || config?.branch

  if (effectiveBranch) {
    ensureBranchDir(projectRoot, effectiveBranch)
  }

  const filePath = getObjectsJsonPath(projectRoot, effectiveBranch)
  const relativePath = effectiveBranch
    ? `.xano/branches/${effectiveBranch}/objects.json`
    : '.xano/objects.json'

  logger.fileOp('write', relativePath)
  logger.dataStored('objects', { count: objects.length })
  writeFileSync(filePath, JSON.stringify(objects, null, 2) + '\n', 'utf8')
  saveSearchIndex(projectRoot, objects)
}

/**
 * Get path to .xano/search.json
 */
export function getSearchIndexPath(projectRoot: string): string {
  return join(getXanoDirPath(projectRoot), SEARCH_JSON)
}

// ── Search Index Types ─────────────────────────────────────────────

export interface SearchEntry {
  path: string
  type: null | string
}

export interface SearchFunctionEntry {
  basename: string
  path: string
  pathNoExt: string
  sanitizedBasename: string
  sanitizedPathNoExt: string
  snakeBasename: string
  snakePathNoExt: string
}

export interface SearchIndexData {
  byBasename: Record<string, SearchEntry[]>
  byPath: Record<string, SearchEntry>
  bySanitized: Record<string, SearchEntry[]>
  functions: SearchFunctionEntry[]
  objects: SearchObjectEntry[]
  tables: Record<string, string>
  version: number
}

export interface SearchObjectEntry {
  basename: string
  path: string
  pathNoExt: string
  sanitizedPathNoExt: string
  snakePathNoExt: string
  type: null | string
}

// ── Search Index Operations ────────────────────────────────────────

/**
 * Build precomputed search index from objects list.
 * Stores all sanitized/snakeCase variants so queries
 * can resolve without calling sanitize() at lookup time.
 */
export function buildSearchIndex(objects: XanoObjectsFile): SearchIndexData {
  const byPath: Record<string, SearchEntry> = {}
  const byBasename: Record<string, SearchEntry[]> = {}
  const bySanitized: Record<string, SearchEntry[]> = {}
  const tables: Record<string, string> = {}
  const functions: SearchFunctionEntry[] = []
  const allObjects: SearchObjectEntry[] = []

  for (const obj of objects) {
    const entry: SearchEntry = { path: obj.path, type: obj.type }
    const base = basename(obj.path, '.xs')
    const pathNoExt = obj.path.replace(/\.xs$/, '')
    const sanitizedBase = sanitize(base)
    const snakeBase = snakeCase(base)

    // Index by exact path (with and without .xs extension)
    byPath[obj.path] = entry
    if (obj.path.endsWith('.xs')) {
      byPath[pathNoExt] = entry
    }

    // Index by basename
    if (!byBasename[base]) byBasename[base] = []
    byBasename[base].push(entry)

    // Index by sanitized and snakeCase variants
    if (!bySanitized[sanitizedBase]) bySanitized[sanitizedBase] = []
    bySanitized[sanitizedBase].push(entry)
    if (snakeBase !== sanitizedBase) {
      if (!bySanitized[snakeBase]) bySanitized[snakeBase] = []
      bySanitized[snakeBase].push(entry)
    }

    // Table lookup: basename and variants → path
    if (obj.type === 'table') {
      tables[base] = obj.path
      if (sanitizedBase !== base) tables[sanitizedBase] = obj.path
      if (snakeBase !== base && snakeBase !== sanitizedBase) tables[snakeBase] = obj.path
    }

    // Function entries with precomputed path variants
    if (obj.type === 'function') {
      functions.push({
        basename: base,
        path: obj.path,
        pathNoExt,
        sanitizedBasename: sanitizedBase,
        sanitizedPathNoExt: sanitizePath(pathNoExt),
        snakeBasename: snakeBase,
        snakePathNoExt: sanitizePath(pathNoExt, snakeCase),
      })
    }

    // All objects with precomputed path variants (for suffix matching)
    allObjects.push({
      basename: base,
      path: obj.path,
      pathNoExt,
      sanitizedPathNoExt: sanitizePath(pathNoExt),
      snakePathNoExt: sanitizePath(pathNoExt, snakeCase),
      type: obj.type,
    })
  }

  return {
    byBasename,
    byPath,
    bySanitized,
    functions,
    objects: allObjects,
    tables,
    version: 1,
  }
}

/**
 * Save precomputed search index to .xano/search.json.
 * Called automatically by saveObjects().
 */
export function saveSearchIndex(projectRoot: string, objects: XanoObjectsFile): void {
  ensureXanoDir(projectRoot)
  const index = buildSearchIndex(objects)
  const filePath = getSearchIndexPath(projectRoot)
  writeFileSync(filePath, JSON.stringify(index) + '\n', 'utf8')
}

/**
 * Load precomputed search index from .xano/search.json.
 * Returns null if the file does not exist or is invalid.
 */
export function loadSearchIndex(projectRoot: string): null | SearchIndexData {
  const filePath = getSearchIndexPath(projectRoot)
  if (!existsSync(filePath)) {
    return null
  }

  try {
    const content = readFileSync(filePath, 'utf8')
    const data = JSON.parse(content) as SearchIndexData
    if (data.version !== 1) return null
    return data
  } catch {
    return null
  }
}

/**
 * Remove all search index entries for a given file path.
 * Mutates and returns the index.
 */
export function removeSearchEntry(data: SearchIndexData, filePath: string): SearchIndexData {
  const pathNoExt = filePath.replace(/\.xs$/, '')

  // Remove from byPath
  delete data.byPath[filePath]
  delete data.byPath[pathNoExt]

  // Remove from byBasename
  for (const key of Object.keys(data.byBasename)) {
    data.byBasename[key] = data.byBasename[key].filter(e => e.path !== filePath)
    if (data.byBasename[key].length === 0) delete data.byBasename[key]
  }

  // Remove from bySanitized
  for (const key of Object.keys(data.bySanitized)) {
    data.bySanitized[key] = data.bySanitized[key].filter(e => e.path !== filePath)
    if (data.bySanitized[key].length === 0) delete data.bySanitized[key]
  }

  // Remove from tables
  for (const [key, path] of Object.entries(data.tables)) {
    if (path === filePath) delete data.tables[key]
  }

  // Remove from functions and objects
  data.functions = data.functions.filter(f => f.path !== filePath)
  data.objects = data.objects.filter(o => o.path !== filePath)

  return data
}

/**
 * Add a single file entry to the search index.
 * Mutates and returns the index.
 */
export function addSearchEntry(
  data: SearchIndexData,
  filePath: string,
  type: null | XanoObjectType,
): SearchIndexData {
  const entry: SearchEntry = { path: filePath, type }
  const base = basename(filePath, '.xs')
  const pathNoExt = filePath.replace(/\.xs$/, '')
  const sanitizedBase = sanitize(base)
  const snakeBase = snakeCase(base)

  // Add to byPath
  data.byPath[filePath] = entry
  if (filePath.endsWith('.xs')) {
    data.byPath[pathNoExt] = entry
  }

  // Add to byBasename
  if (!data.byBasename[base]) data.byBasename[base] = []
  data.byBasename[base].push(entry)

  // Add to bySanitized
  if (!data.bySanitized[sanitizedBase]) data.bySanitized[sanitizedBase] = []
  data.bySanitized[sanitizedBase].push(entry)
  if (snakeBase !== sanitizedBase) {
    if (!data.bySanitized[snakeBase]) data.bySanitized[snakeBase] = []
    data.bySanitized[snakeBase].push(entry)
  }

  // Add to tables if table type
  if (type === 'table') {
    data.tables[base] = filePath
    if (sanitizedBase !== base) data.tables[sanitizedBase] = filePath
    if (snakeBase !== base && snakeBase !== sanitizedBase) data.tables[snakeBase] = filePath
  }

  // Add to functions if function type
  if (type === 'function') {
    data.functions.push({
      basename: base,
      path: filePath,
      pathNoExt,
      sanitizedBasename: sanitizedBase,
      sanitizedPathNoExt: sanitizePath(pathNoExt),
      snakeBasename: snakeBase,
      snakePathNoExt: sanitizePath(pathNoExt, snakeCase),
    })
  }

  // Add to objects
  data.objects.push({
    basename: base,
    path: filePath,
    pathNoExt,
    sanitizedPathNoExt: sanitizePath(pathNoExt),
    snakePathNoExt: sanitizePath(pathNoExt, snakeCase),
    type,
  })

  return data
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
 * Field order matches VS Code extension: id, type, path, status, staged, sha256, original
 */
export function upsertObject(
  objects: XanoObjectsFile,
  filePath: string,
  data: Partial<XanoObject> & { id: number; type: XanoObjectType }
): XanoObjectsFile {
  const existingIndex = objects.findIndex((obj) => obj.path === filePath)
  const fileContent = existsSync(filePath) ? readFileSync(filePath, 'utf8') : ''

  // Field order matches VS Code extension expectation
  /* eslint-disable perfectionist/sort-objects */
  const newObject: XanoObject = {
    id: data.id,
    type: data.type,
    path: filePath,
    status: data.status ?? 'unchanged',
    staged: false, // always false, kept for VSCode extension compatibility
    sha256: data.sha256 ?? computeSha256(fileContent),
    original: data.original ?? encodeBase64(fileContent),
  }
  /* eslint-enable perfectionist/sort-objects */

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
