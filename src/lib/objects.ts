/**
 * Objects file management
 * Handles .xano/objects.json (VSCode compatible)
 */

import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

import type { XanoObject, XanoObjectsFile, XanoObjectType } from './types.js'

import { ensureXanoDir, getXanoDirPath } from './project.js'

const OBJECTS_JSON = 'objects.json'
const GROUPS_JSON = 'groups.json'

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
 * Get path to .xano/objects.json
 */
export function getObjectsJsonPath(projectRoot: string): string {
  return path.join(getXanoDirPath(projectRoot), OBJECTS_JSON)
}

/**
 * Get path to .xano/groups.json
 */
export function getGroupsJsonPath(projectRoot: string): string {
  return path.join(getXanoDirPath(projectRoot), GROUPS_JSON)
}

/**
 * Load .xano/objects.json
 */
export function loadObjects(projectRoot: string): XanoObjectsFile {
  const filePath = getObjectsJsonPath(projectRoot)

  if (!fs.existsSync(filePath)) {
    return []
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8')
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
  fs.writeFileSync(filePath, JSON.stringify(objects, null, 2) + '\n', 'utf-8')
}

/**
 * Load .xano/groups.json
 */
export function loadGroups(projectRoot: string): ApiGroupsFile {
  const filePath = getGroupsJsonPath(projectRoot)

  if (!fs.existsSync(filePath)) {
    return {}
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8')
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
  fs.writeFileSync(filePath, JSON.stringify(groups, null, 2) + '\n', 'utf-8')
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
  return crypto.createHash('sha256').update(content, 'utf-8').digest('hex')
}

/**
 * Compute SHA256 hash of file
 */
export function computeFileSha256(filePath: string): null | string {
  if (!fs.existsSync(filePath)) {
    return null
  }

  const content = fs.readFileSync(filePath, 'utf8')
  return computeSha256(content)
}

/**
 * Encode content to base64
 */
export function encodeBase64(content: string): string {
  return Buffer.from(content, 'utf-8').toString('base64')
}

/**
 * Decode content from base64
 */
export function decodeBase64(base64: string): string {
  return Buffer.from(base64, 'base64').toString('utf-8')
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
  const fileContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : ''

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
 * - API group:    app/apis/{group_name}.xs (e.g., app/apis/bootstrap.xs)
 *
 * So we extract the directory name and look for {group_name}.xs at the parent level
 */
export function findApiGroupForEndpoint(
  objects: XanoObjectsFile,
  endpointPath: string
): XanoObject | undefined {
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

  // Build the expected api_group path: app/apis/bootstrap.xs
  const apisDir = parts.join('/')
  const apiGroupPath = `${apisDir}/${groupName}.xs`

  // Look for the api_group with this exact path
  const apiGroup = objects.find(
    (obj) => obj.type === 'api_group' && obj.path === apiGroupPath
  )

  if (apiGroup) return apiGroup

  // Fallback: find any api_group whose name matches the group directory
  // This handles cases where the group might be at a different path
  return objects.find(
    (obj) => obj.type === 'api_group' && obj.path.endsWith(`/${groupName}.xs`)
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
 */
export function updateObjectStatus(
  objects: XanoObjectsFile,
  projectRoot: string
): XanoObjectsFile {
  return objects.map((obj) => {
    const fullPath = path.join(projectRoot, obj.path)

    if (!fs.existsSync(fullPath)) {
      return { ...obj, status: 'notfound' as const }
    }

    const currentSha256 = computeFileSha256(fullPath)
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
