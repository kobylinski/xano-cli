/**
 * Sync Operations
 *
 * Shared logic for syncing XanoScript files between local and Xano.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import type { XanoObjectType } from '../types.js'
import type { OperationContext } from './context.js'

import { detectType, validateSingleBlock } from '../detector.js'
import {
  computeFileSha256,
  computeSha256,
  encodeBase64,
  findApiGroupForEndpoint,
  findObjectByPath,
  loadObjects,
  saveEndpoints,
  saveGroups,
  saveObjects,
  upsertObject,
} from '../objects.js'
import { getDefaultPaths } from '../project.js'
import {
  fetchAllObjects,
  type FetchedObject,
  generateObjectPath,
  hasObjectsJson,
  syncFromXano,
} from '../sync.js'

/**
 * Error thrown when sync operation fails
 */
export class SyncOperationError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
    this.name = 'SyncOperationError'
  }
}

/**
 * Result of a sync metadata operation
 */
export interface SyncMetadataResult {
  error?: string
  newCount: number
  ok: boolean
  removedCount: number
  totalCount: number
  updatedCount: number
}

/**
 * Result of a pull operation
 */
export interface PullResult {
  error?: string
  errors: number
  ok: boolean
  pulled: number
  skipped: number
}

/**
 * Result of a push operation
 */
export interface PushResult {
  error?: string
  errors: number
  failed: Array<{ error: string; path: string }>
  ok: boolean
  pushed: number
}

/**
 * Get sync paths configuration from context
 */
function getSyncPaths(ctx: OperationContext) {
  const { config } = ctx
  return {
    ...getDefaultPaths(),
    ...config?.paths,
  }
}

/**
 * Sync metadata from Xano (objects.json, groups.json, endpoints.json)
 * Does not pull/write actual code files.
 */
export async function syncMetadata(ctx: OperationContext): Promise<SyncMetadataResult> {
  if (!ctx.projectRoot) {
    throw new SyncOperationError('NO_PROJECT', 'Not in a Xano project')
  }

  if (!ctx.api) {
    throw new SyncOperationError('NO_API', 'API not initialized. Check profile configuration.')
  }

  const paths = getSyncPaths(ctx)

  try {
    const result = await syncFromXano(ctx.projectRoot, ctx.api, paths)

    return {
      newCount: result.newObjects.length,
      ok: true,
      removedCount: result.removedObjects.length,
      totalCount: result.objects.length,
      updatedCount: result.updatedObjects.length,
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Sync failed',
      newCount: 0,
      ok: false,
      removedCount: 0,
      totalCount: 0,
      updatedCount: 0,
    }
  }
}

/**
 * Pull files from Xano to local
 *
 * @param ctx Operation context
 * @param filePaths Optional specific files to pull (if empty, pulls all)
 * @param force Overwrite local changes without checking
 */
export async function pullFiles(
  ctx: OperationContext,
  filePaths?: string[],
  force = false
): Promise<PullResult> {
  if (!ctx.projectRoot) {
    throw new SyncOperationError('NO_PROJECT', 'Not in a Xano project')
  }

  if (!ctx.api) {
    throw new SyncOperationError('NO_API', 'API not initialized. Check profile configuration.')
  }

  const { projectRoot } = ctx
  const paths = getSyncPaths(ctx)

  // Check if sync is needed
  const needsSync = !hasObjectsJson(projectRoot)
  // Bulk fetch when pulling all files (no specific paths) to avoid N+1 API calls
  const pullAllFiles = !filePaths || filePaths.length === 0

  let objects = loadObjects(projectRoot)
  let fetchedObjects: FetchedObject[] | null = null

  // Always do bulk fetch when pulling all files OR when sync is needed
  if (needsSync || pullAllFiles) {
    const fetchResult = await fetchAllObjects(ctx.api)
    fetchedObjects = fetchResult.objects

    // Update objects.json when syncing
    if (needsSync) {
      objects = []
      for (const obj of fetchedObjects) {
        const filePath = generateObjectPath(obj, paths, {})
        objects = upsertObject(objects, filePath, {
          id: obj.id,
          original: encodeBase64(obj.xanoscript),
          sha256: computeSha256(obj.xanoscript),
          status: 'unchanged',
          type: obj.type,
        })
      }

      saveObjects(projectRoot, objects)
      saveGroups(projectRoot, fetchResult.apiGroups)
      saveEndpoints(projectRoot, fetchResult.endpoints)
    }
  }

  // Determine which files to pull
  const filesToPull = pullAllFiles
    ? objects.map(o => o.path)
    : filePaths.filter(p => objects.some(o => o.path === p))

  if (filesToPull.length === 0) {
    return { errors: 0, ok: true, pulled: 0, skipped: 0 }
  }

  // Build lookup from fetched objects
  const fetchedByPath = new Map<string, FetchedObject>()
  if (fetchedObjects) {
    for (const obj of fetchedObjects) {
      const filePath = generateObjectPath(obj, paths, {})
      fetchedByPath.set(filePath, obj)
    }
  }

  let pulled = 0
  let skipped = 0
  let errors = 0

  for (const file of filesToPull) {
    const obj = findObjectByPath(objects, file)
    if (!obj) {
      skipped++
      continue
    }

    const fetched = fetchedByPath.get(file)
    let serverContent: string

    if (fetched) {
      serverContent = fetched.xanoscript
    } else {
      // Fetch individually
      // eslint-disable-next-line no-await-in-loop -- Sequential for rate limiting
      const response = await ctx.api.getObject(obj.type, obj.id)
      if (!response.ok || !response.data?.xanoscript) {
        errors++
        continue
      }

      const xs = response.data.xanoscript
      serverContent = typeof xs === 'string' ? xs : (xs as { value: string }).value
    }

    const fullPath = join(projectRoot, file)
    const serverSha256 = computeSha256(serverContent)

    // Check for local changes
    if (existsSync(fullPath) && !force) {
      const localContent = readFileSync(fullPath, 'utf8')
      const localSha256 = computeSha256(localContent)
      const hasLocalChanges = !obj.sha256 || localSha256 !== obj.sha256

      if (hasLocalChanges) {
        skipped++
        continue
      }
    }

    // Write file
    const dir = dirname(fullPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    writeFileSync(fullPath, serverContent, 'utf8')

    // Update objects.json
    objects = upsertObject(objects, file, {
      id: obj.id,
      original: encodeBase64(serverContent),
      sha256: serverSha256,
      status: 'unchanged',
      type: obj.type,
    })

    pulled++
  }

  // Save updated objects.json
  saveObjects(projectRoot, objects)

  return { errors, ok: errors === 0, pulled, skipped }
}

/**
 * Push files from local to Xano
 *
 * @param ctx Operation context
 * @param filePaths Optional specific files to push (if empty, pushes all changed)
 */
export async function pushFiles(
  ctx: OperationContext,
  filePaths?: string[]
): Promise<PushResult> {
  if (!ctx.projectRoot) {
    throw new SyncOperationError('NO_PROJECT', 'Not in a Xano project')
  }

  if (!ctx.api) {
    throw new SyncOperationError('NO_API', 'API not initialized. Check profile configuration.')
  }

  const { api, projectRoot } = ctx
  const paths = getSyncPaths(ctx)

  let objects = loadObjects(projectRoot)

  // Determine files to push
  let filesToPush: string[]

  if (filePaths && filePaths.length > 0) {
    // Push specific files
    filesToPush = filePaths.filter(p => existsSync(join(projectRoot, p)))
  } else {
    // Find all changed files
    filesToPush = []
    for (const obj of objects) {
      const fullPath = join(projectRoot, obj.path)
      if (existsSync(fullPath)) {
        const currentSha256 = computeFileSha256(fullPath)
        if (currentSha256 !== obj.sha256) {
          filesToPush.push(obj.path)
        }
      }
    }

    // Also find new files in standard directories
    const knownPaths = new Set(objects.map(o => o.path))
    const dirs = [
      paths.functions,
      paths.apis,
      paths.tables,
      paths.tableTriggers,
      paths.tasks,
      paths.workflowTests,
      paths.addOns,
      paths.middlewares,
    ].filter((d): d is string => d !== undefined)

    for (const dir of dirs) {
      const fullDir = join(projectRoot, dir)
      if (existsSync(fullDir)) {
        findNewFiles(fullDir, projectRoot, knownPaths, filesToPush)
      }
    }
  }

  if (filesToPush.length === 0) {
    return { errors: 0, failed: [], ok: true, pushed: 0 }
  }

  let pushed = 0
  const failed: Array<{ error: string; path: string }> = []

  for (const file of filesToPush) {
    const fullPath = join(projectRoot, file)
    if (!existsSync(fullPath)) {
      failed.push({ error: 'File not found', path: file })
      continue
    }

    const content = readFileSync(fullPath, 'utf8')

    // Validate single block
    const blockError = validateSingleBlock(content)
    if (blockError) {
      failed.push({ error: blockError, path: file })
      continue
    }

    const existingObj = findObjectByPath(objects, file)
    let newId: number
    let objectType: XanoObjectType

    if (existingObj?.id) {
      // Update existing object
      objectType = existingObj.type

      const updateOptions: { apigroup_id?: number } = {}
      if (objectType === 'api_endpoint') {
        const apiGroup = findApiGroupForEndpoint(objects, file)
        if (apiGroup) {
          updateOptions.apigroup_id = apiGroup.id // eslint-disable-line camelcase
        } else {
          failed.push({ error: 'Cannot find API group for endpoint', path: file })
          continue
        }
      }

      // eslint-disable-next-line no-await-in-loop -- Sequential for rate limiting
      let response = await api.updateObject(objectType, existingObj.id, content, updateOptions)

      // Workaround for Xano bug: "name is already being used" on update
      // This happens when updating agents/tools/mcp_servers - delete and recreate
      const nameConflictTypes: XanoObjectType[] = ['agent', 'agent_trigger', 'tool', 'mcp_server', 'mcp_server_trigger']
      if (!response.ok && response.error?.includes('name is already being used') && nameConflictTypes.includes(objectType)) {
        // eslint-disable-next-line no-await-in-loop -- Sequential for workaround
        const deleteResponse = await api.deleteObject(objectType, existingObj.id)
        if (!deleteResponse.ok) {
          failed.push({ error: `Failed to delete for recreate: ${deleteResponse.error}`, path: file })
          continue
        }

        // eslint-disable-next-line no-await-in-loop -- Sequential for workaround
        const createResponse = await api.createObject(objectType, content)
        if (!createResponse.ok) {
          failed.push({ error: `Deleted but failed to recreate: ${createResponse.error}`, path: file })
          continue
        }

        if (!createResponse.data?.id) {
          failed.push({ error: 'No ID returned after recreate', path: file })
          continue
        }

        newId = createResponse.data.id
        response = createResponse
      } else if (!response.ok) {
        failed.push({ error: response.error || 'Update failed', path: file })
        continue
      } else {
        newId = existingObj.id
      }
    } else {
      // Create new object
      const detectedType = detectType(content)
      if (!detectedType) {
        failed.push({ error: 'Cannot detect XanoScript type from content', path: file })
        continue
      }

      objectType = detectedType

      const createOptions: { apigroup_id?: number } = {}
      if (objectType === 'api_endpoint') {
        const apiGroup = findApiGroupForEndpoint(objects, file)
        if (apiGroup) {
          createOptions.apigroup_id = apiGroup.id // eslint-disable-line camelcase
        } else {
          failed.push({ error: 'Cannot find API group for new endpoint', path: file })
          continue
        }
      }

      // eslint-disable-next-line no-await-in-loop -- Sequential for rate limiting
      const response = await api.createObject(objectType, content, createOptions)
      if (!response.ok) {
        failed.push({ error: response.error || 'Create failed', path: file })
        continue
      }

      if (!response.data?.id) {
        failed.push({ error: 'No ID returned from API', path: file })
        continue
      }

      newId = response.data.id
    }

    // Update objects.json
    objects = upsertObject(objects, file, {
      id: newId,
      original: encodeBase64(content),
      sha256: computeSha256(content),
      status: 'unchanged',
      type: objectType,
    })

    pushed++
  }

  // Save updated objects.json
  saveObjects(projectRoot, objects)

  return { errors: failed.length, failed, ok: failed.length === 0, pushed }
}

/**
 * Get status of local files compared to Xano
 */
export interface FileStatus {
  modified: string[]
  new: string[]
  unchanged: string[]
}

export function getFileStatus(ctx: OperationContext): FileStatus {
  if (!ctx.projectRoot) {
    throw new SyncOperationError('NO_PROJECT', 'Not in a Xano project')
  }

  const { projectRoot } = ctx
  const objects = loadObjects(projectRoot)

  const modified: string[] = []
  const unchanged: string[] = []

  for (const obj of objects) {
    const fullPath = join(projectRoot, obj.path)
    if (existsSync(fullPath)) {
      const currentSha256 = computeFileSha256(fullPath)
      if (currentSha256 === obj.sha256) {
        unchanged.push(obj.path)
      } else {
        modified.push(obj.path)
      }
    }
  }

  // Find new files
  const newFiles: string[] = []
  const knownPaths = new Set(objects.map(o => o.path))
  const paths = getSyncPaths(ctx)

  const dirs = [
    paths.functions,
    paths.apis,
    paths.tables,
    paths.tableTriggers,
    paths.tasks,
    paths.workflowTests,
    paths.addOns,
    paths.middlewares,
  ].filter((d): d is string => d !== undefined)

  for (const dir of dirs) {
    const fullDir = join(projectRoot, dir)
    if (existsSync(fullDir)) {
      findNewFiles(fullDir, projectRoot, knownPaths, newFiles)
    }
  }

  return { modified, new: newFiles, unchanged }
}

/**
 * Helper to recursively find new .xs files
 */
function findNewFiles(
  dir: string,
  projectRoot: string,
  knownPaths: Set<string>,
  result: string[]
): void {
  const entries = readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      findNewFiles(fullPath, projectRoot, knownPaths, result)
    } else if (entry.name.endsWith('.xs')) {
      const relativePath = relative(projectRoot, fullPath)
      if (!knownPaths.has(relativePath)) {
        result.push(relativePath)
      }
    }
  }
}
