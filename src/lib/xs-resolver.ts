/**
 * Workspace name resolution engine
 * Resolves identifiers (from agent or user) to workspace objects with file paths.
 */

import { basename } from 'node:path'

import type { SearchIndexData } from './objects.js'
import type { XanoObject, XanoObjectsFile, XanoObjectType } from './types.js'
import type { XsDbRef, XsFunctionRunRef } from './xs-language.js'

import { sanitize, sanitizePath, snakeCase } from './detector.js'
import { loadObjects, loadSearchIndex } from './objects.js'

// ── Types ──────────────────────────────────────────────────────────

export interface ResolvedObject {
  filePath: string
  matchType: 'basename' | 'content_name' | 'exact_path' | 'sanitized'
  name: string
  type: null | XanoObjectType
}

interface WorkspaceIndex {
  byBasename: Map<string, XanoObject[]>
  bySanitized: Map<string, XanoObject[]>
  objects: XanoObjectsFile
}

// ── Index ──────────────────────────────────────────────────────────

/**
 * Build a search index from .xano/objects.json
 */
export function buildIndex(projectRoot: string): WorkspaceIndex {
  const objects = loadObjects(projectRoot)
  const byBasename = new Map<string, XanoObject[]>()
  const bySanitized = new Map<string, XanoObject[]>()

  for (const obj of objects) {
    // Index by basename (filename without .xs)
    const base = basename(obj.path, '.xs')
    const existing = byBasename.get(base) || []
    existing.push(obj)
    byBasename.set(base, existing)

    // Index by sanitized basename
    const sanitized = sanitize(base)
    const existingSanitized = bySanitized.get(sanitized) || []
    existingSanitized.push(obj)
    bySanitized.set(sanitized, existingSanitized)
  }

  return { byBasename, bySanitized, objects }
}

// ── Resolution ─────────────────────────────────────────────────────

/**
 * Resolve an identifier string to workspace objects.
 *
 * Resolution strategy (in order):
 * 1. Exact path match
 * 2. Basename match
 * 3. Sanitized match
 * 4. Endpoint pattern (name_VERB)
 * 5. Function path match (with /)
 */
export function resolveIdentifier(query: string, projectRoot: string): ResolvedObject[] {
  // Fast path: use precomputed search index
  const searchIndex = loadSearchIndex(projectRoot)
  if (searchIndex) {
    return resolveFromSearchIndex(query, searchIndex)
  }

  // Fallback: build index from objects.json
  const index = buildIndex(projectRoot)
  const results: ResolvedObject[] = []
  const seen = new Set<string>()

  const addResult = (obj: XanoObject, matchType: ResolvedObject['matchType'], name: string) => {
    if (seen.has(obj.path)) return
    seen.add(obj.path)
    results.push({
      filePath: obj.path,
      matchType,
      name,
      type: obj.type,
    })
  }

  // 1. Exact path match
  const stripped = query.endsWith('.xs') ? query : query + '.xs'
  for (const obj of index.objects) {
    if (obj.path === query || obj.path === stripped) {
      addResult(obj, 'exact_path', basename(obj.path, '.xs'))
    }
  }

  if (results.length > 0) return results

  // 2. Basename match
  const basenameMatches = index.byBasename.get(query) || []
  for (const obj of basenameMatches) {
    addResult(obj, 'basename', basename(obj.path, '.xs'))
  }

  if (results.length > 0) return results

  // 3. Sanitized match
  const sanitizedQuery = sanitize(query)
  const sanitizedMatches = index.bySanitized.get(sanitizedQuery) || []
  for (const obj of sanitizedMatches) {
    addResult(obj, 'sanitized', basename(obj.path, '.xs'))
  }

  if (results.length > 0) return results

  // 4. Endpoint pattern: name_VERB (e.g., brands_POST, users_id_GET)
  const endpointMatch = query.match(/^(.+?)_(GET|POST|PUT|DELETE|PATCH)$/i)
  if (endpointMatch) {
    const pathPart = sanitize(endpointMatch[1])
    const verb = endpointMatch[2].toUpperCase()
    const pattern = `${pathPart}_${verb}`

    for (const obj of index.objects) {
      const objBase = basename(obj.path, '.xs')
      if (objBase === pattern || sanitize(objBase) === pattern) {
        addResult(obj, 'sanitized', objBase)
      }
    }

    if (results.length > 0) return results
  }

  // 5. Function path match (query contains /)
  if (query.includes('/')) {
    const sanitizedPath = sanitizePath(query)
    const snakePath = sanitizePath(query, snakeCase)
    for (const obj of index.objects) {
      // Check if the object path ends with the sanitized query path
      const objWithoutExt = obj.path.replace(/\.xs$/, '')
      if (
        objWithoutExt.endsWith(sanitizedPath) ||
        objWithoutExt.endsWith(snakePath) ||
        sanitizePath(objWithoutExt).endsWith(sanitizedPath) ||
        sanitizePath(objWithoutExt).endsWith(snakePath)
      ) {
        addResult(obj, 'sanitized', basename(obj.path, '.xs'))
      }
    }
  }

  return results
}

/**
 * Fast-path resolution using precomputed search index.
 * Avoids computing sanitize()/snakeCase() on every object — only on the query.
 */
function resolveFromSearchIndex(query: string, data: SearchIndexData): ResolvedObject[] {
  const results: ResolvedObject[] = []
  const seen = new Set<string>()

  const addResult = (entry: { path: string; type: null | string }, matchType: ResolvedObject['matchType'], name: string) => {
    if (seen.has(entry.path)) return
    seen.add(entry.path)
    results.push({
      filePath: entry.path,
      matchType,
      name,
      type: entry.type as null | XanoObjectType,
    })
  }

  // 1. Exact path match
  const stripped = query.endsWith('.xs') ? query : query + '.xs'
  const exactMatch = data.byPath[query] || data.byPath[stripped]
  if (exactMatch) {
    addResult(exactMatch, 'exact_path', basename(exactMatch.path, '.xs'))
    return results
  }

  // 2. Basename match
  const basenameMatches = data.byBasename[query]
  if (basenameMatches && basenameMatches.length > 0) {
    for (const entry of basenameMatches) {
      addResult(entry, 'basename', basename(entry.path, '.xs'))
    }

    return results
  }

  // 3. Sanitized match (check both sanitize and snakeCase of query)
  const sanitizedQuery = sanitize(query)
  const snakeQuery = snakeCase(query)
  const sanitizedMatches = data.bySanitized[sanitizedQuery] || []
  for (const entry of sanitizedMatches) {
    addResult(entry, 'sanitized', basename(entry.path, '.xs'))
  }

  if (snakeQuery !== sanitizedQuery) {
    const snakeMatches = data.bySanitized[snakeQuery] || []
    for (const entry of snakeMatches) {
      addResult(entry, 'sanitized', basename(entry.path, '.xs'))
    }
  }

  if (results.length > 0) return results

  // 4. Endpoint pattern: name_VERB (e.g., brands_POST, users_id_GET)
  const endpointMatch = query.match(/^(.+?)_(GET|POST|PUT|DELETE|PATCH)$/i)
  if (endpointMatch) {
    const pathPart = sanitize(endpointMatch[1])
    const verb = endpointMatch[2].toUpperCase()
    const pattern = `${pathPart}_${verb}`

    const bnMatches = data.byBasename[pattern] || []
    for (const entry of bnMatches) {
      addResult(entry, 'sanitized', basename(entry.path, '.xs'))
    }

    const snMatches = data.bySanitized[pattern] || []
    for (const entry of snMatches) {
      addResult(entry, 'sanitized', basename(entry.path, '.xs'))
    }

    if (results.length > 0) return results
  }

  // 5. Function path match (query contains /)
  if (query.includes('/')) {
    const sanitizedPath = sanitizePath(query)
    const snakePath = sanitizePath(query, snakeCase)
    for (const obj of data.objects) {
      if (
        obj.pathNoExt.endsWith(sanitizedPath) ||
        obj.pathNoExt.endsWith(snakePath) ||
        obj.sanitizedPathNoExt.endsWith(sanitizedPath) ||
        obj.snakePathNoExt.endsWith(snakePath)
      ) {
        addResult({ path: obj.path, type: obj.type }, 'sanitized', basename(obj.path, '.xs'))
      }
    }
  }

  return results
}

/**
 * Resolve a db reference to a file path.
 */
export function resolveDbRef(ref: XsDbRef, index: WorkspaceIndex): null | string {
  const sanitizedTable = sanitize(ref.table)

  // Search for table objects
  for (const obj of index.objects) {
    if (obj.type !== 'table') continue
    const base = basename(obj.path, '.xs')
    if (base === ref.table || sanitize(base) === sanitizedTable) {
      return obj.path
    }
  }

  return null
}

/**
 * Resolve a function.run reference to a file path.
 */
export function resolveFunctionRunRef(ref: XsFunctionRunRef, index: WorkspaceIndex): null | string {
  const sanitizedName = sanitizePath(ref.name)
  const snakeName = sanitizePath(ref.name, snakeCase)

  // Search for function objects whose path matches
  for (const obj of index.objects) {
    if (obj.type !== 'function') continue
    const objWithoutExt = obj.path.replace(/\.xs$/, '')
    if (
      objWithoutExt.endsWith(sanitizedName) ||
      objWithoutExt.endsWith(snakeName) ||
      sanitizePath(objWithoutExt).endsWith(sanitizedName) ||
      sanitizePath(objWithoutExt).endsWith(snakeName)
    ) {
      return obj.path
    }
  }

  // Fallback: try basename-only match
  const nameParts = ref.name.split('/')
  const lastPart = nameParts.at(-1)!
  const lastSanitized = sanitize(lastPart)
  const lastSnake = snakeCase(lastPart)
  for (const obj of index.objects) {
    if (obj.type !== 'function') continue
    const base = basename(obj.path, '.xs')
    if (base === lastSanitized || base === lastSnake || sanitize(base) === lastSanitized || snakeCase(base) === lastSnake) {
      return obj.path
    }
  }

  return null
}

/**
 * Resolve all db refs and function.run refs to file paths.
 * Returns maps from ref index to resolved path.
 */
export function resolveAllRefs(
  dbRefs: XsDbRef[],
  functionRunRefs: XsFunctionRunRef[],
  projectRoot: string,
): {
  dbPaths: Map<number, string>
  functionPaths: Map<number, string>
} {
  // Fast path: use precomputed search index
  const searchIndex = loadSearchIndex(projectRoot)
  if (searchIndex) {
    return resolveAllRefsFast(dbRefs, functionRunRefs, searchIndex)
  }

  // Fallback: build index from objects.json
  const index = buildIndex(projectRoot)
  const dbPaths = new Map<number, string>()
  const functionPaths = new Map<number, string>()

  for (const [i, ref] of dbRefs.entries()) {
    const path = resolveDbRef(ref, index)
    if (path) dbPaths.set(i, path)
  }

  for (const [i, ref] of functionRunRefs.entries()) {
    const path = resolveFunctionRunRef(ref, index)
    if (path) functionPaths.set(i, path)
  }

  return { dbPaths, functionPaths }
}

// ── Fast-path helpers (precomputed search index) ────────────────────

function resolveDbRefFast(ref: XsDbRef, data: SearchIndexData): null | string {
  const sanitizedTable = sanitize(ref.table)
  return data.tables[ref.table] ?? data.tables[sanitizedTable] ?? null
}

function resolveFunctionRunRefFast(ref: XsFunctionRunRef, data: SearchIndexData): null | string {
  const sanitizedName = sanitizePath(ref.name)
  const snakeName = sanitizePath(ref.name, snakeCase)

  // Path suffix matching on precomputed variants
  for (const fn of data.functions) {
    if (
      fn.pathNoExt.endsWith(sanitizedName) ||
      fn.pathNoExt.endsWith(snakeName) ||
      fn.sanitizedPathNoExt.endsWith(sanitizedName) ||
      fn.snakePathNoExt.endsWith(snakeName)
    ) {
      return fn.path
    }
  }

  // Fallback: basename-only match
  const nameParts = ref.name.split('/')
  const lastPart = nameParts.at(-1)!
  const lastSanitized = sanitize(lastPart)
  const lastSnake = snakeCase(lastPart)
  for (const fn of data.functions) {
    if (
      fn.basename === lastSanitized ||
      fn.basename === lastSnake ||
      fn.sanitizedBasename === lastSanitized ||
      fn.snakeBasename === lastSnake
    ) {
      return fn.path
    }
  }

  return null
}

function resolveAllRefsFast(
  dbRefs: XsDbRef[],
  functionRunRefs: XsFunctionRunRef[],
  data: SearchIndexData,
): {
  dbPaths: Map<number, string>
  functionPaths: Map<number, string>
} {
  const dbPaths = new Map<number, string>()
  const functionPaths = new Map<number, string>()

  for (const [i, ref] of dbRefs.entries()) {
    const path = resolveDbRefFast(ref, data)
    if (path) dbPaths.set(i, path)
  }

  for (const [i, ref] of functionRunRefs.entries()) {
    const path = resolveFunctionRunRefFast(ref, data)
    if (path) functionPaths.set(i, path)
  }

  return { dbPaths, functionPaths }
}
