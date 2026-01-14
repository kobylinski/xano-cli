/**
 * Shared sync functionality for pull/push commands
 */

import { existsSync, mkdirSync, readdirSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

import type {
  NamingMode,
  PathResolver,
  SanitizeFunction,
  XanoObjectsFile,
  XanoObjectType,
  XanoPaths,
} from './types.js'

import { XanoApi } from './api.js'
import {
  generateFilePath,
  type PathResolverObject,
} from './detector.js'
import {
  type ApiGroupsFile,
  computeSha256,
  encodeBase64,
  extractXanoscript,
  loadObjects,
  saveGroups,
  saveObjects,
  upsertObject,
} from './objects.js'

export interface FetchedObject {
  apigroup_id?: number
  apigroup_name?: string
  id: number
  name: string
  path?: string
  table_id?: number
  table_name?: string
  type: XanoObjectType
  verb?: string
  xanoscript: string
}

export interface FetchResult {
  apiGroups: ApiGroupsFile
  objects: FetchedObject[]
}

export interface SyncResult {
  newObjects: FetchedObject[]
  objects: XanoObjectsFile
  removedObjects: XanoObjectsFile
  updatedObjects: FetchedObject[]
}

type LogFn = (message: string) => void

/**
 * Fetch all objects from Xano API
 */
export async function fetchAllObjects(
  api: XanoApi,
  log?: LogFn
): Promise<FetchResult> {
  const allObjects: FetchedObject[] = []
  const apiGroupsFile: ApiGroupsFile = {}
  const print = log || (() => {})

  // Fetch API groups first for endpoint grouping AND as objects to sync
  const apiGroups = new Map<number, string>()
  print('Fetching API groups...')
  const groupsResponse = await api.listApiGroups(1, 1000)
  if (groupsResponse.ok && groupsResponse.data?.items) {
    for (const group of groupsResponse.data.items) {
      apiGroups.set(group.id, group.name)

      // Fetch canonical ID for live API calls (different from guid)
      // eslint-disable-next-line no-await-in-loop -- Sequential API calls for rate limiting
      const groupDetails = await api.getApiGroupWithCanonical(group.id)
      const canonical = groupDetails.data?.canonical || group.guid

      // Store group info with canonical for groups.json
      apiGroupsFile[group.name] = {
        canonical,
        id: group.id,
      }
      // Add api_group to allObjects if it has xanoscript
      const xs = extractXanoscript(group.xanoscript)
      if (xs) {
        allObjects.push({
          id: group.id,
          name: group.name,
          type: 'api_group',
          xanoscript: xs,
        })
      }
    }

    print(`  Found ${apiGroups.size} API groups`)
  }

  // Fetch functions
  print('Fetching functions...')
  const functionsResponse = await api.listFunctions(1, 1000)
  if (functionsResponse.ok && functionsResponse.data?.items) {
    for (const fn of functionsResponse.data.items) {
      const xs = extractXanoscript(fn.xanoscript)
      if (xs) {
        allObjects.push({
          id: fn.id,
          name: fn.name,
          type: 'function',
          xanoscript: xs,
        })
      }
    }

    print(`  Found ${functionsResponse.data.items.length} functions`)
  }

  // Fetch API endpoints
  print('Fetching API endpoints...')
  const apisResponse = await api.listApiEndpoints(1, 1000)
  if (apisResponse.ok && apisResponse.data?.items) {
    for (const endpoint of apisResponse.data.items) {
      const xs = extractXanoscript(endpoint.xanoscript)
      if (xs) {
        allObjects.push({
          apigroup_id: endpoint.apigroup_id, // eslint-disable-line camelcase
          apigroup_name: apiGroups.get(endpoint.apigroup_id), // eslint-disable-line camelcase
          id: endpoint.id,
          name: endpoint.name,
          path: endpoint.name,
          type: 'api_endpoint',
          verb: endpoint.verb,
          xanoscript: xs,
        })
      }
    }

    print(`  Found ${apisResponse.data.items.length} API endpoints`)
  }

  // Fetch tables and their triggers
  print('Fetching tables...')
  const tablesResponse = await api.listTables(1, 1000)
  const tableMap = new Map<number, string>()
  if (tablesResponse.ok && tablesResponse.data?.items) {
    for (const table of tablesResponse.data.items) {
      tableMap.set(table.id, table.name)
      const xs = extractXanoscript(table.xanoscript)
      if (xs) {
        allObjects.push({
          id: table.id,
          name: table.name,
          type: 'table',
          xanoscript: xs,
        })
      }
    }

    print(`  Found ${tablesResponse.data.items.length} tables`)
  }

  // Fetch all table triggers
  print('Fetching table triggers...')
  const triggersResponse = await api.listTableTriggers(1, 1000)
  if (triggersResponse.ok && triggersResponse.data?.items) {
    for (const trigger of triggersResponse.data.items) {
      const xs = extractXanoscript(trigger.xanoscript)
      if (xs) {
        allObjects.push({
          id: trigger.id,
          name: trigger.name,
          table_id: trigger.table_id, // eslint-disable-line camelcase
          table_name: tableMap.get(trigger.table_id) || 'unknown', // eslint-disable-line camelcase
          type: 'table_trigger',
          xanoscript: xs,
        })
      }
    }

    print(`  Found ${triggersResponse.data.items.length} table triggers`)
  }

  // Fetch tasks
  print('Fetching tasks...')
  const tasksResponse = await api.listTasks(1, 1000)
  if (tasksResponse.ok && tasksResponse.data?.items) {
    for (const task of tasksResponse.data.items) {
      const xs = extractXanoscript(task.xanoscript)
      if (xs) {
        allObjects.push({
          id: task.id,
          name: task.name,
          type: 'task',
          xanoscript: xs,
        })
      }
    }

    print(`  Found ${tasksResponse.data.items.length} tasks`)
  }

  // Fetch workflow tests
  print('Fetching workflow tests...')
  const workflowTestsResponse = await api.listWorkflowTests(1, 1000)
  if (workflowTestsResponse.ok && workflowTestsResponse.data?.items) {
    for (const test of workflowTestsResponse.data.items) {
      const xs = extractXanoscript(test.xanoscript)
      if (xs) {
        allObjects.push({
          id: test.id,
          name: test.name,
          type: 'workflow_test',
          xanoscript: xs,
        })
      }
    }

    print(`  Found ${workflowTestsResponse.data.items.length} workflow tests`)
  }

  // Fetch addons
  print('Fetching addons...')
  const addonsResponse = await api.listAddons(1, 1000)
  if (addonsResponse.ok && addonsResponse.data?.items) {
    for (const addon of addonsResponse.data.items) {
      const xs = extractXanoscript(addon.xanoscript)
      if (xs) {
        allObjects.push({
          id: addon.id,
          name: addon.name,
          type: 'addon',
          xanoscript: xs,
        })
      }
    }

    print(`  Found ${addonsResponse.data.items.length} addons`)
  }

  // Fetch middlewares
  print('Fetching middlewares...')
  const middlewaresResponse = await api.listMiddlewares(1, 1000)
  if (middlewaresResponse.ok && middlewaresResponse.data?.items) {
    for (const middleware of middlewaresResponse.data.items) {
      const xs = extractXanoscript(middleware.xanoscript)
      if (xs) {
        allObjects.push({
          id: middleware.id,
          name: middleware.name,
          type: 'middleware',
          xanoscript: xs,
        })
      }
    }

    print(`  Found ${middlewaresResponse.data.items.length} middlewares`)
  }

  return {
    apiGroups: apiGroupsFile,
    objects: allObjects,
  }
}

/**
 * Generate file path for a fetched object
 */
export function generateObjectPath(
  obj: FetchedObject,
  paths: XanoPaths,
  options: {
    customResolver?: PathResolver
    customSanitize?: SanitizeFunction
    naming?: NamingMode
  } = {}
): string {
  const resolverObj: PathResolverObject = {
    group: obj.apigroup_name,
    id: obj.id,
    name: obj.name,
    path: obj.path,
    table: obj.table_name,
    type: obj.type,
    verb: obj.verb,
  }

  return generateFilePath(resolverObj, paths, {
    customResolver: options.customResolver,
    customSanitize: options.customSanitize,
    naming: options.naming,
  })
}

/**
 * Sync options
 */
export interface SyncOptions {
  customResolver?: PathResolver
  customSanitize?: SanitizeFunction
  log?: LogFn
  naming?: NamingMode
}

/**
 * Sync objects from Xano and update objects.json
 * Returns the sync result with categorized changes
 */
export async function syncFromXano(
  projectRoot: string,
  api: XanoApi,
  paths: XanoPaths,
  options: SyncOptions = {}
): Promise<SyncResult> {
  const { customResolver, customSanitize, log, naming } = options
  const print = log || (() => {})

  // Fetch all objects from Xano
  const fetchResult = await fetchAllObjects(api, log)
  const allObjects = fetchResult.objects
  print('')
  print(`Total: ${allObjects.length} objects with XanoScript`)

  // Load existing objects for comparison
  const existingObjects = loadObjects(projectRoot)
  const existingById = new Map<string, typeof existingObjects[0]>()
  for (const obj of existingObjects) {
    existingById.set(`${obj.type}:${obj.id}`, obj)
  }

  // Build set of remote object keys
  const remoteKeys = new Set<string>()
  for (const obj of allObjects) {
    remoteKeys.add(`${obj.type}:${obj.id}`)
  }

  // Calculate changes
  const newObjects: FetchedObject[] = []
  const updatedObjects: FetchedObject[] = []
  const removedObjects: XanoObjectsFile = []

  for (const obj of allObjects) {
    const key = `${obj.type}:${obj.id}`
    const existing = existingById.get(key)
    if (existing) {
      // Check if content changed
      const newSha256 = computeSha256(obj.xanoscript)
      if (newSha256 !== existing.sha256) {
        updatedObjects.push(obj)
      }
    } else {
      newObjects.push(obj)
    }
  }

  for (const obj of existingObjects) {
    const key = `${obj.type}:${obj.id}`
    if (!remoteKeys.has(key)) {
      removedObjects.push(obj)
    }
  }

  // Build new objects.json
  let objects: XanoObjectsFile = []

  for (const obj of allObjects) {
    const filePath = generateObjectPath(obj, paths, { customResolver, customSanitize, naming })

    objects = upsertObject(objects, filePath, {
      id: obj.id,
      original: encodeBase64(obj.xanoscript),
      sha256: computeSha256(obj.xanoscript),
      status: 'unchanged',
      type: obj.type,
    })
  }

  // Save objects.json and groups.json
  saveObjects(projectRoot, objects)
  saveGroups(projectRoot, fetchResult.apiGroups)

  return {
    newObjects,
    objects,
    removedObjects,
    updatedObjects,
  }
}

/**
 * Write options
 */
export interface WriteOptions {
  customResolver?: PathResolver
  customSanitize?: SanitizeFunction
  naming?: NamingMode
}

/**
 * Write fetched objects to local files
 */
export function writeObjectsToFiles(
  projectRoot: string,
  allObjects: FetchedObject[],
  paths: XanoPaths,
  options: WriteOptions = {}
): Set<string> {
  const { customResolver, customSanitize, naming } = options
  const writtenFiles = new Set<string>()

  for (const obj of allObjects) {
    const filePath = generateObjectPath(obj, paths, { customResolver, customSanitize, naming })
    const fullPath = join(projectRoot, filePath)

    const dir = dirname(fullPath)
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }

    writeFileSync(fullPath, obj.xanoscript, 'utf8')
    writtenFiles.add(filePath)
  }

  return writtenFiles
}

/**
 * Delete local files not in the given set
 */
export function cleanLocalFiles(
  projectRoot: string,
  keepFiles: Set<string>,
  paths: XanoPaths
): number {
  const dirs = [
    paths.functions,
    paths.apis,
    paths.tables,
    paths.tasks,
    paths.workflowTests,
  ].filter((d): d is string => d !== undefined)

  let deletedCount = 0

  for (const dir of dirs) {
    const fullDir = join(projectRoot, dir)
    if (existsSync(fullDir)) {
      deletedCount += walkAndDelete(fullDir, projectRoot, keepFiles)
    }
  }

  return deletedCount
}

function walkAndDelete(
  dir: string,
  projectRoot: string,
  keepFiles: Set<string>
): number {
  let deletedCount = 0
  const entries = readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      deletedCount += walkAndDelete(fullPath, projectRoot, keepFiles)
      // Remove empty directories
      if (readdirSync(fullPath).length === 0) {
        rmdirSync(fullPath)
      }
    } else if (entry.name.endsWith('.xs')) {
      const relativePath = relative(projectRoot, fullPath)
      if (!keepFiles.has(relativePath)) {
        unlinkSync(fullPath)
        deletedCount++
      }
    }
  }

  return deletedCount
}

/**
 * Check if objects.json exists and has entries
 */
export function hasObjectsJson(projectRoot: string): boolean {
  const objects = loadObjects(projectRoot)
  return objects.length > 0
}
