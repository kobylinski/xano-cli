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
  extractCanonical,
  generateFilePath,
  type PathResolverObject,
} from './detector.js'
import {
  type ApiGroupsFile,
  computeSha256,
  encodeBase64,
  type EndpointsFile,
  extractXanoscript,
  loadObjects,
  saveEndpoints,
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
  endpoints: EndpointsFile
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
 * Options for fetching objects
 */
export interface FetchOptions {
  /** Optional logger function */
  log?: LogFn
  /** Optional filter to fetch only specific object types */
  types?: XanoObjectType[]
}

/**
 * Check if a type should be fetched based on filter
 */
function shouldFetch(type: XanoObjectType, types?: XanoObjectType[]): boolean {
  return !types || types.includes(type)
}

/**
 * Fetch objects from Xano API
 * @param api - XanoApi instance
 * @param options - Fetch options (log function, types filter)
 */
export async function fetchAllObjects(
  api: XanoApi,
  options: FetchOptions | LogFn = {}
): Promise<FetchResult> {
  // Support legacy signature: fetchAllObjects(api, log)
  const opts: FetchOptions = typeof options === 'function' ? { log: options } : options
  const { log, types } = opts

  const allObjects: FetchedObject[] = []
  const apiGroupsFile: ApiGroupsFile = {}
  const endpointsFile: EndpointsFile = {}
  const print = log || (() => {})

  // Track canonical IDs for each API group (by ID)
  const apiGroupCanonicals = new Map<number, string>()

  // API groups are always fetched if we need endpoints (for apigroup_id mapping)
  // or if explicitly requested
  const needApiGroups = shouldFetch('api_group', types) || shouldFetch('api_endpoint', types)
  const apiGroups = new Map<number, string>()

  if (needApiGroups) {
    print('Fetching API groups...')
    const groupsResponse = await api.listApiGroups(1, 1000)
    if (groupsResponse.ok && groupsResponse.data?.items) {
      for (const group of groupsResponse.data.items) {
        apiGroups.set(group.id, group.name)

        // Extract canonical from XanoScript content, fall back to guid
        const xs = extractXanoscript(group.xanoscript)
        const canonical = (xs ? extractCanonical(xs) : null) || group.guid

        // Store group info with canonical for groups.json
        apiGroupsFile[group.name] = {
          canonical,
          id: group.id,
        }

        // Track canonical for endpoint lookup
        apiGroupCanonicals.set(group.id, canonical)

        // Add api_group to allObjects if requested and has xanoscript
        if (shouldFetch('api_group', types)) {
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
      }

      print(`  Found ${apiGroups.size} API groups`)
    }
  }

  // Fetch functions
  if (shouldFetch('function', types)) {
    print('Fetching functions...')
    const functionsResponse = await api.listFunctions(1, 1000)
    if (functionsResponse.ok && functionsResponse.data?.items) {
      let withXs = 0
      let withoutXs = 0
      for (const fn of functionsResponse.data.items) {
        const xs = extractXanoscript(fn.xanoscript)
        if (xs) {
          withXs++
          allObjects.push({
            id: fn.id,
            name: fn.name,
            type: 'function',
            xanoscript: xs,
          })
        } else {
          withoutXs++
        }
      }

      print(`  Found ${functionsResponse.data.items.length} functions (${withXs} with xanoscript, ${withoutXs} without)`)
    }
  }

  // Fetch API endpoints
  if (shouldFetch('api_endpoint', types)) {
    print('Fetching API endpoints...')
    const apisResponse = await api.listApiEndpoints(1, 1000)
    if (apisResponse.ok && apisResponse.data?.items) {
      let epWithXs = 0
      let epWithoutXs = 0
      for (const endpoint of apisResponse.data.items) {
        const xs = extractXanoscript(endpoint.xanoscript)
        if (xs) {
          epWithXs++
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
        } else {
          epWithoutXs++
        }

        // Add to endpoints.json (for all endpoints, not just those with xanoscript)
        const verb = endpoint.verb.toUpperCase()
        const canonical = apiGroupCanonicals.get(endpoint.apigroup_id)
        if (canonical) {
          if (!endpointsFile[verb]) {
            endpointsFile[verb] = []
          }

          endpointsFile[verb].push({
            canonical,
            id: endpoint.id,
            pattern: endpoint.name,
          })
        }
      }

      print(`  Found ${apisResponse.data.items.length} API endpoints (${epWithXs} with xanoscript, ${epWithoutXs} without)`)
    }
  }

  // Tables are always fetched if we need table_trigger (for table_id mapping)
  const needTables = shouldFetch('table', types) || shouldFetch('table_trigger', types)
  const tableMap = new Map<number, string>()

  if (needTables) {
    print('Fetching tables...')
    const tablesResponse = await api.listTables(1, 1000)
    if (tablesResponse.ok && tablesResponse.data?.items) {
      let tblWithXs = 0
      let tblWithoutXs = 0
      for (const table of tablesResponse.data.items) {
        tableMap.set(table.id, table.name)

        // Add table to allObjects if requested
        if (shouldFetch('table', types)) {
          const xs = extractXanoscript(table.xanoscript)
          if (xs) {
            tblWithXs++
            allObjects.push({
              id: table.id,
              name: table.name,
              type: 'table',
              xanoscript: xs,
            })
          } else {
            tblWithoutXs++
          }
        }
      }

      print(`  Found ${tablesResponse.data.items.length} tables${shouldFetch('table', types) ? ` (${tblWithXs} with xanoscript, ${tblWithoutXs} without)` : ''}`)
    }
  }

  // Fetch table triggers
  if (shouldFetch('table_trigger', types)) {
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
  }

  // Fetch tasks
  if (shouldFetch('task', types)) {
    print('Fetching tasks...')
    const tasksResponse = await api.listTasks(1, 1000)
    if (tasksResponse.ok && tasksResponse.data?.items) {
      let taskWithXs = 0
      let taskWithoutXs = 0
      for (const task of tasksResponse.data.items) {
        const xs = extractXanoscript(task.xanoscript)
        if (xs) {
          taskWithXs++
          allObjects.push({
            id: task.id,
            name: task.name,
            type: 'task',
            xanoscript: xs,
          })
        } else {
          taskWithoutXs++
        }
      }

      print(`  Found ${tasksResponse.data.items.length} tasks (${taskWithXs} with xanoscript, ${taskWithoutXs} without)`)
    }
  }

  // Fetch workflow tests
  if (shouldFetch('workflow_test', types)) {
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
  }

  // Fetch addons
  if (shouldFetch('addon', types)) {
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
  }

  // Fetch middlewares
  if (shouldFetch('middleware', types)) {
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
  }

  // Fetch AI agents
  if (shouldFetch('agent', types)) {
    print('Fetching agents...')
    const agentsResponse = await api.listAgents(1, 1000)
    if (agentsResponse.ok && agentsResponse.data?.items) {
      for (const agent of agentsResponse.data.items) {
        const xs = extractXanoscript(agent.xanoscript)
        if (xs) {
          allObjects.push({
            id: agent.id,
            name: agent.name,
            type: 'agent',
            xanoscript: xs,
          })
        }
      }

      print(`  Found ${agentsResponse.data.items.length} agents`)
    }
  }

  // Fetch agent triggers
  if (shouldFetch('agent_trigger', types)) {
    print('Fetching agent triggers...')
    const agentTriggersResponse = await api.listAgentTriggers(1, 1000)
    if (agentTriggersResponse.ok && agentTriggersResponse.data?.items) {
      for (const trigger of agentTriggersResponse.data.items) {
        const xs = extractXanoscript(trigger.xanoscript)
        if (xs) {
          allObjects.push({
            id: trigger.id,
            name: trigger.name,
            type: 'agent_trigger',
            xanoscript: xs,
          })
        }
      }

      print(`  Found ${agentTriggersResponse.data.items.length} agent triggers`)
    }
  }

  // Fetch AI tools
  if (shouldFetch('tool', types)) {
    print('Fetching tools...')
    const toolsResponse = await api.listTools(1, 1000)
    if (toolsResponse.ok && toolsResponse.data?.items) {
      for (const tool of toolsResponse.data.items) {
        const xs = extractXanoscript(tool.xanoscript)
        if (xs) {
          allObjects.push({
            id: tool.id,
            name: tool.name,
            type: 'tool',
            xanoscript: xs,
          })
        }
      }

      print(`  Found ${toolsResponse.data.items.length} tools`)
    }
  }

  // Fetch MCP servers
  if (shouldFetch('mcp_server', types)) {
    print('Fetching MCP servers...')
    const mcpServersResponse = await api.listMcpServers(1, 1000)
    if (mcpServersResponse.ok && mcpServersResponse.data?.items) {
      for (const mcpServer of mcpServersResponse.data.items) {
        const xs = extractXanoscript(mcpServer.xanoscript)
        if (xs) {
          allObjects.push({
            id: mcpServer.id,
            name: mcpServer.name,
            type: 'mcp_server',
            xanoscript: xs,
          })
        }
      }

      print(`  Found ${mcpServersResponse.data.items.length} MCP servers`)
    }
  }

  // Fetch MCP server triggers
  if (shouldFetch('mcp_server_trigger', types)) {
    print('Fetching MCP server triggers...')
    const mcpServerTriggersResponse = await api.listMcpServerTriggers(1, 1000)
    if (mcpServerTriggersResponse.ok && mcpServerTriggersResponse.data?.items) {
      for (const trigger of mcpServerTriggersResponse.data.items) {
        const xs = extractXanoscript(trigger.xanoscript)
        if (xs) {
          allObjects.push({
            id: trigger.id,
            name: trigger.name,
            type: 'mcp_server_trigger',
            xanoscript: xs,
          })
        }
      }

      print(`  Found ${mcpServerTriggersResponse.data.items.length} MCP server triggers`)
    }
  }

  return {
    apiGroups: apiGroupsFile,
    endpoints: endpointsFile,
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

  // Save objects.json, groups.json, and endpoints.json
  saveObjects(projectRoot, objects)
  saveGroups(projectRoot, fetchResult.apiGroups)
  saveEndpoints(projectRoot, fetchResult.endpoints)

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
    paths.agents,
    paths.agentTriggers,
    paths.tools,
    paths.mcpServers,
    paths.mcpServerTriggers,
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
