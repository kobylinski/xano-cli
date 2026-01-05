/**
 * Objects file management
 * Handles .xano/objects.json (VSCode compatible)
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import type { XanoObject, XanoObjectsFile, XanoObjectType } from './types.js'
import { ensureXanoDir, getXanoDirPath } from './project.js'

const OBJECTS_JSON = 'objects.json'

/**
 * Get path to .xano/objects.json
 */
export function getObjectsJsonPath(projectRoot: string): string {
  return path.join(getXanoDirPath(projectRoot), OBJECTS_JSON)
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
    const content = fs.readFileSync(filePath, 'utf-8')
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
 * Find object by file path
 */
export function findObjectByPath(objects: XanoObjectsFile, filePath: string): XanoObject | undefined {
  return objects.find((obj) => obj.path === filePath)
}

/**
 * Find object by ID
 */
export function findObjectById(objects: XanoObjectsFile, id: number): XanoObject | undefined {
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
export function computeFileSha256(filePath: string): string | null {
  if (!fs.existsSync(filePath)) {
    return null
  }

  const content = fs.readFileSync(filePath, 'utf-8')
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
  const fileContent = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8') : ''

  const newObject: XanoObject = {
    id: data.id,
    type: data.type,
    path: filePath,
    status: data.status ?? 'unchanged',
    staged: data.staged ?? false,
    sha256: data.sha256 ?? computeSha256(fileContent),
    original: data.original ?? encodeBase64(fileContent),
  }

  if (existingIndex >= 0) {
    objects[existingIndex] = newObject
  } else {
    objects.push(newObject)
  }

  return objects
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
 */
export function updateObjectStatus(
  objects: XanoObjectsFile,
  projectRoot: string
): XanoObjectsFile {
  return objects.map((obj) => {
    const fullPath = path.join(projectRoot, obj.path)

    if (!fs.existsSync(fullPath)) {
      return { ...obj, status: 'deleted' as const }
    }

    const currentSha256 = computeFileSha256(fullPath)
    if (currentSha256 !== obj.sha256) {
      return { ...obj, status: 'modified' as const }
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

  if (index >= 0) {
    objects[index] = {
      ...objects[index],
      status: 'unchanged',
      staged: false,
      sha256: computeSha256(content),
      original: encodeBase64(content),
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
