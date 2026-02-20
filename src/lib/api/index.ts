/**
 * Xano Metadata API client
 * Main entry point that composes all API modules
 */

import type {
  OpenApiSpec,
  RequestHistoryItem,
  XanoApiAddon,
  XanoApiAgent,
  XanoApiAgentTrigger,
  XanoApiBranch,
  XanoApiEndpoint,
  XanoApiFunction,
  XanoApiGroup,
  XanoApiMcpServer,
  XanoApiMcpServerTrigger,
  XanoApiMiddleware,
  XanoApiTable,
  XanoApiTableTrigger,
  XanoApiTask,
  XanoApiTool,
  XanoApiWorkflowTest,
  XanoDataSource,
  XanoObjectType,
  XanoProfile,
  XanoTableIndex,
  XanoTableSchema,
} from '../types.js'

// Import getProfile for internal use
import { getProfile } from './credentials.js'

// Re-export credentials functions
export {
  getCliProfile,
  getDefaultProfileName,
  getMissingProfileError,
  getProfile,
  getProfileWarning,
  listProfileNames,
  loadCredentials,
} from './credentials.js'

// Re-export credentials types
export type { ProfileRequirementError } from './credentials.js'

// Import domain APIs
import { AddonsApi } from './addons.js'
import { AIApi } from './ai.js'
import { ApisApi } from './apis.js'
import { FunctionsApi } from './functions.js'
import { LiveApi } from './live.js'
import { MiddlewareApi } from './middleware.js'
import { ApiResponse } from './request.js'
import { TablesApi } from './tables.js'
import { TasksApi } from './tasks.js'
import { TriggersApi } from './triggers.js'
import { WorkflowTestsApi } from './workflow-tests.js'
import { WorkspaceApi } from './workspace.js'

/**
 * Xano API client class - facade that composes all domain APIs
 * Maintains backward compatibility with original monolithic interface
 */
export class XanoApi {
  // Domain API instances (internal use)
  private readonly addonsApi: AddonsApi
  private readonly aiApi: AIApi
  private readonly apisApi: ApisApi
  private readonly functionsApi: FunctionsApi
  private readonly liveApi: LiveApi
  private readonly middlewareApi: MiddlewareApi
  private readonly tablesApi: TablesApi
  private readonly tasksApi: TasksApi
  private readonly triggersApi: TriggersApi
  private readonly workflowTestsApi: WorkflowTestsApi
  private readonly workspaceApi: WorkspaceApi

  constructor(
    private profile: XanoProfile,
    private workspaceId: number,
    private branch: string
  ) {
    // Initialize domain APIs
    this.addonsApi = new AddonsApi(profile, workspaceId, branch)
    this.aiApi = new AIApi(profile, workspaceId, branch)
    this.apisApi = new ApisApi(profile, workspaceId, branch)
    this.functionsApi = new FunctionsApi(profile, workspaceId, branch)
    this.liveApi = new LiveApi(profile, workspaceId, branch)
    this.middlewareApi = new MiddlewareApi(profile, workspaceId, branch)
    this.tablesApi = new TablesApi(profile, workspaceId, branch)
    this.tasksApi = new TasksApi(profile, workspaceId, branch)
    this.triggersApi = new TriggersApi(profile, workspaceId, branch)
    this.workflowTestsApi = new WorkflowTestsApi(profile, workspaceId, branch)
    this.workspaceApi = new WorkspaceApi(profile, workspaceId, branch)
  }

  // ========== Tables ==========

  addTableIndex(tableId: number, index: XanoTableIndex): Promise<ApiResponse<XanoTableIndex>> {
    return this.tablesApi.addIndex(tableId, index)
  }

  // ========== Workspace ==========

  browseRequestHistory(options: {
    apiId?: number
    branchId?: string
    includeOutput?: boolean
    page?: number
    perPage?: number
    queryId?: number
  } = {}): Promise<ApiResponse<{ items: RequestHistoryItem[] }>> {
    return this.workspaceApi.browseRequestHistory(options)
  }

  bulkCreateTableContent(
    tableId: number,
    records: Record<string, unknown>[],
    datasource?: string,
    allowIdField = false
  ): Promise<ApiResponse<Record<string, unknown>[]>> {
    return this.tablesApi.bulkCreateContent(tableId, records, datasource, allowIdField)
  }

  // ========== Live API ==========

  callLiveApi(
    canonical: string,
    endpointPath: string,
    method: string = 'GET',
    body?: Record<string, unknown>,
    headers?: Record<string, string>,
    datasource?: string
  ): Promise<ApiResponse<unknown>> {
    return this.liveApi.call(canonical, endpointPath, method, body, headers, datasource)
  }

  // ========== Addons ==========

  createAddon(xanoscript: string): Promise<ApiResponse<XanoApiAddon>> {
    return this.addonsApi.create(xanoscript)
  }

  // ========== AI Objects ==========

  createAgent(xanoscript: string): Promise<ApiResponse<XanoApiAgent>> {
    return this.aiApi.createAgent(xanoscript)
  }

  createAgentTrigger(xanoscript: string): Promise<ApiResponse<XanoApiAgentTrigger>> {
    return this.aiApi.createAgentTrigger(xanoscript)
  }

  // ========== APIs ==========

  createApiEndpoint(xanoscript: string, apiGroupId: number): Promise<ApiResponse<XanoApiEndpoint>> {
    return this.apisApi.createEndpoint(xanoscript, apiGroupId)
  }

  createApiGroup(xanoscript: string): Promise<ApiResponse<XanoApiGroup>> {
    return this.apisApi.createGroup(xanoscript)
  }

  createDataSource(label: string, color: string): Promise<ApiResponse<XanoDataSource>> {
    return this.workspaceApi.createDataSource(label, color)
  }

  // ========== Functions ==========

  createFunction(xanoscript: string): Promise<ApiResponse<XanoApiFunction>> {
    return this.functionsApi.create(xanoscript)
  }

  createMcpServer(xanoscript: string): Promise<ApiResponse<XanoApiMcpServer>> {
    return this.aiApi.createMcpServer(xanoscript)
  }

  createMcpServerTrigger(xanoscript: string): Promise<ApiResponse<XanoApiMcpServerTrigger>> {
    return this.aiApi.createMcpServerTrigger(xanoscript)
  }

  // ========== Middleware ==========

  createMiddleware(xanoscript: string): Promise<ApiResponse<XanoApiMiddleware>> {
    return this.middlewareApi.create(xanoscript)
  }

  /**
   * Create object by type
   */
  async createObject(type: XanoObjectType, xanoscript: string, options?: { apigroup_id?: number }): Promise<ApiResponse<{ id: number; name?: string }>> {
    switch (type) {
      case 'addon': {
        return this.createAddon(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'agent': {
        return this.createAgent(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'agent_trigger': {
        return this.createAgentTrigger(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'api_endpoint': {
        if (!options?.apigroup_id) {
          return { error: 'apigroup_id is required to create an API endpoint', ok: false, status: 400 }
        }

        return this.createApiEndpoint(xanoscript, options.apigroup_id) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'api_group': {
        return this.createApiGroup(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'function': {
        return this.createFunction(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'mcp_server': {
        return this.createMcpServer(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'mcp_server_trigger': {
        return this.createMcpServerTrigger(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'middleware': {
        return this.createMiddleware(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'table': {
        return this.createTable(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'table_trigger': {
        return this.createTableTrigger(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'task': {
        return this.createTask(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'tool': {
        return this.createTool(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'workflow_test': {
        return this.createWorkflowTest(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      default: {
        return { error: `Unsupported type: ${type}`, ok: false, status: 0 }
      }
    }
  }

  createTable(xanoscript: string): Promise<ApiResponse<XanoApiTable>> {
    return this.tablesApi.create(xanoscript)
  }

  createTableContent(tableId: number, data: Record<string, unknown>, datasource?: string): Promise<ApiResponse<Record<string, unknown>>> {
    return this.tablesApi.createContent(tableId, data, datasource)
  }

  // ========== Triggers ==========

  createTableTrigger(xanoscript: string): Promise<ApiResponse<XanoApiTableTrigger>> {
    return this.triggersApi.create(xanoscript)
  }

  // ========== Tasks ==========

  createTask(xanoscript: string): Promise<ApiResponse<XanoApiTask>> {
    return this.tasksApi.create(xanoscript)
  }

  createTool(xanoscript: string): Promise<ApiResponse<XanoApiTool>> {
    return this.aiApi.createTool(xanoscript)
  }

  // ========== Workflow Tests ==========

  createWorkflowTest(xanoscript: string): Promise<ApiResponse<XanoApiWorkflowTest>> {
    return this.workflowTestsApi.create(xanoscript)
  }

  deleteAddon(id: number): Promise<ApiResponse<void>> {
    return this.addonsApi.delete(id)
  }

  deleteAgent(id: number): Promise<ApiResponse<void>> {
    return this.aiApi.deleteAgent(id)
  }

  deleteAgentTrigger(id: number): Promise<ApiResponse<void>> {
    return this.aiApi.deleteAgentTrigger(id)
  }

  deleteApiEndpoint(apiGroupId: number, id: number): Promise<ApiResponse<void>> {
    return this.apisApi.deleteEndpoint(apiGroupId, id)
  }

  deleteApiGroup(id: number): Promise<ApiResponse<void>> {
    return this.apisApi.deleteGroup(id)
  }

  deleteDataSource(label: string): Promise<ApiResponse<void>> {
    return this.workspaceApi.deleteDataSource(label)
  }

  deleteFunction(id: number): Promise<ApiResponse<void>> {
    return this.functionsApi.delete(id)
  }

  deleteMcpServer(id: number): Promise<ApiResponse<void>> {
    return this.aiApi.deleteMcpServer(id)
  }

  deleteMcpServerTrigger(id: number): Promise<ApiResponse<void>> {
    return this.aiApi.deleteMcpServerTrigger(id)
  }

  deleteMiddleware(id: number): Promise<ApiResponse<void>> {
    return this.middlewareApi.delete(id)
  }

  /**
   * Delete object by type and ID
   */
  async deleteObject(
    type: XanoObjectType,
    id: number,
    options?: { apigroup_id?: number }
  ): Promise<ApiResponse<void>> {
    switch (type) {
      case 'addon': {
        return this.deleteAddon(id)
      }

      case 'agent': {
        return this.deleteAgent(id)
      }

      case 'agent_trigger': {
        return this.deleteAgentTrigger(id)
      }

      case 'api_endpoint': {
        if (!options?.apigroup_id) {
          return { error: 'apigroup_id is required for deleting API endpoints', ok: false, status: 0 }
        }

        return this.deleteApiEndpoint(options.apigroup_id, id)
      }

      case 'api_group': {
        return this.deleteApiGroup(id)
      }

      case 'function': {
        return this.deleteFunction(id)
      }

      case 'mcp_server': {
        return this.deleteMcpServer(id)
      }

      case 'mcp_server_trigger': {
        return this.deleteMcpServerTrigger(id)
      }

      case 'middleware': {
        return this.deleteMiddleware(id)
      }

      case 'table': {
        return this.deleteTable(id)
      }

      case 'table_trigger': {
        return this.deleteTableTrigger(id)
      }

      case 'task': {
        return this.deleteTask(id)
      }

      case 'tool': {
        return this.deleteTool(id)
      }

      case 'workflow_test': {
        return this.deleteWorkflowTest(id)
      }

      default: {
        return { error: `Unsupported type: ${type}`, ok: false, status: 0 }
      }
    }
  }

  deleteTable(id: number): Promise<ApiResponse<void>> {
    return this.tablesApi.delete(id)
  }

  deleteTableContent(tableId: number, pk: number | string, datasource?: string): Promise<ApiResponse<void>> {
    return this.tablesApi.deleteContent(tableId, pk, datasource)
  }

  deleteTableIndex(tableId: number, indexId: number): Promise<ApiResponse<void>> {
    return this.tablesApi.deleteIndex(tableId, indexId)
  }

  deleteTableTrigger(id: number): Promise<ApiResponse<void>> {
    return this.triggersApi.delete(id)
  }

  deleteTask(id: number): Promise<ApiResponse<void>> {
    return this.tasksApi.delete(id)
  }

  deleteTool(id: number): Promise<ApiResponse<void>> {
    return this.aiApi.deleteTool(id)
  }

  deleteWorkflowTest(id: number): Promise<ApiResponse<void>> {
    return this.workflowTestsApi.delete(id)
  }

  getAddon(id: number): Promise<ApiResponse<XanoApiAddon>> {
    return this.addonsApi.get(id)
  }

  getAgent(id: number): Promise<ApiResponse<XanoApiAgent>> {
    return this.aiApi.getAgent(id)
  }

  getAgentTrigger(id: number): Promise<ApiResponse<XanoApiAgentTrigger>> {
    return this.aiApi.getAgentTrigger(id)
  }

  getApiEndpoint(id: number, apiGroupId?: number): Promise<ApiResponse<XanoApiEndpoint>> {
    return this.apisApi.getEndpoint(id, apiGroupId)
  }

  getApiEndpointOpenApi(apiGroupId: number, apiId: number): Promise<ApiResponse<OpenApiSpec>> {
    return this.apisApi.getEndpointOpenApi(apiGroupId, apiId)
  }

  getApiGroup(id: number): Promise<ApiResponse<XanoApiGroup>> {
    return this.apisApi.getGroup(id)
  }

  getApiGroupOpenApi(apiGroupId: number): Promise<ApiResponse<OpenApiSpec>> {
    return this.apisApi.getGroupOpenApi(apiGroupId)
  }

  getApiGroupOpenApiByCanonical(canonical: string): Promise<ApiResponse<OpenApiSpec>> {
    return this.apisApi.getGroupOpenApiByCanonical(canonical)
  }

  getApiGroupWithCanonical(groupId: number): Promise<ApiResponse<XanoApiGroup & { canonical?: string }>> {
    return this.apisApi.getGroupWithCanonical(groupId)
  }

  getFunction(id: number): Promise<ApiResponse<XanoApiFunction>> {
    return this.functionsApi.get(id)
  }

  getFunctionHistory(
    functionId: number,
    options: { includeOutput?: boolean; page?: number; perPage?: number } = {}
  ): Promise<ApiResponse<{ items: RequestHistoryItem[] }>> {
    return this.functionsApi.getHistory(functionId, options)
  }

  getMcpServer(id: number): Promise<ApiResponse<XanoApiMcpServer>> {
    return this.aiApi.getMcpServer(id)
  }

  getMcpServerTrigger(id: number): Promise<ApiResponse<XanoApiMcpServerTrigger>> {
    return this.aiApi.getMcpServerTrigger(id)
  }

  getMiddleware(id: number): Promise<ApiResponse<XanoApiMiddleware>> {
    return this.middlewareApi.get(id)
  }

  getMiddlewareHistory(
    middlewareId: number,
    options: { includeOutput?: boolean; page?: number; perPage?: number } = {}
  ): Promise<ApiResponse<{ items: RequestHistoryItem[] }>> {
    return this.middlewareApi.getHistory(middlewareId, options)
  }

  /**
   * Get object by type and ID
   */
  async getObject(type: XanoObjectType, id: number): Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>> {
    switch (type) {
      case 'addon': {
        return this.getAddon(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'agent': {
        return this.getAgent(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'agent_trigger': {
        return this.getAgentTrigger(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'api_endpoint': {
        return this.getApiEndpoint(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'api_group': {
        return this.getApiGroup(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'function': {
        return this.getFunction(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'mcp_server': {
        return this.getMcpServer(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'mcp_server_trigger': {
        return this.getMcpServerTrigger(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'middleware': {
        return this.getMiddleware(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'table': {
        return this.getTable(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'table_trigger': {
        return this.getTableTrigger(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'task': {
        return this.getTask(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'tool': {
        return this.getTool(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'workflow_test': {
        return this.getWorkflowTest(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      default: {
        return { error: `Unsupported type: ${type}`, ok: false, status: 0 }
      }
    }
  }

  getTable(id: number): Promise<ApiResponse<XanoApiTable>> {
    return this.tablesApi.get(id)
  }

  getTableContent(tableId: number, pk: number | string, datasource?: string): Promise<ApiResponse<Record<string, unknown>>> {
    return this.tablesApi.getContent(tableId, pk, datasource)
  }

  getTableIndexes(tableId: number): Promise<ApiResponse<XanoTableIndex[]>> {
    return this.tablesApi.getIndexes(tableId)
  }

  getTableSchema(tableId: number): Promise<ApiResponse<XanoTableSchema[]>> {
    return this.tablesApi.getSchema(tableId)
  }

  getTableTrigger(id: number): Promise<ApiResponse<XanoApiTableTrigger>> {
    return this.triggersApi.get(id)
  }

  getTask(id: number): Promise<ApiResponse<XanoApiTask>> {
    return this.tasksApi.get(id)
  }

  getTaskHistory(
    taskId: number,
    options: { includeOutput?: boolean; page?: number; perPage?: number } = {}
  ): Promise<ApiResponse<{ items: RequestHistoryItem[] }>> {
    return this.tasksApi.getHistory(taskId, options)
  }

  getTool(id: number): Promise<ApiResponse<XanoApiTool>> {
    return this.aiApi.getTool(id)
  }

  getTriggerHistory(
    triggerId: number,
    options: { includeOutput?: boolean; page?: number; perPage?: number } = {}
  ): Promise<ApiResponse<{ items: RequestHistoryItem[] }>> {
    return this.triggersApi.getHistory(triggerId, options)
  }

  getWorkflowTest(id: number): Promise<ApiResponse<XanoApiWorkflowTest>> {
    return this.workflowTestsApi.get(id)
  }

  getWorkspaceOpenApi(): Promise<ApiResponse<OpenApiSpec>> {
    return this.apisApi.getWorkspaceOpenApi()
  }

  listAddons(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiAddon[] }>> {
    return this.addonsApi.list(page, perPage)
  }

  listAgents(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiAgent[] }>> {
    return this.aiApi.listAgents(page, perPage)
  }

  listAgentTriggers(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiAgentTrigger[] }>> {
    return this.aiApi.listAgentTriggers(page, perPage)
  }

  listApiEndpoints(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiEndpoint[] }>> {
    return this.apisApi.listEndpoints(page, perPage)
  }

  listApiEndpointsByGroup(groups: Array<{ id: number }>): Promise<ApiResponse<{ items: XanoApiEndpoint[] }>> {
    return this.apisApi.listEndpointsByGroup(groups)
  }

  listApiGroups(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiGroup[] }>> {
    return this.apisApi.listGroups(page, perPage)
  }

  listBranches(): Promise<ApiResponse<XanoApiBranch[]>> {
    return this.workspaceApi.listBranches()
  }

  listDataSources(): Promise<ApiResponse<XanoDataSource[]>> {
    return this.workspaceApi.listDataSources()
  }

  listFunctions(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiFunction[] }>> {
    return this.functionsApi.list(page, perPage)
  }

  listMcpServers(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiMcpServer[] }>> {
    return this.aiApi.listMcpServers(page, perPage)
  }

  listMcpServerTriggers(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiMcpServerTrigger[] }>> {
    return this.aiApi.listMcpServerTriggers(page, perPage)
  }

  listMiddlewares(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiMiddleware[] }>> {
    return this.middlewareApi.list(page, perPage)
  }

  listTableContent(
    tableId: number,
    page = 1,
    perPage = 100,
    datasource?: string
  ): Promise<ApiResponse<{ curPage: number; items: Record<string, unknown>[]; itemsReceived: number; itemsTotal: number; nextPage: null | number; offset: number; pageTotal: number; prevPage: null | number }>> {
    return this.tablesApi.listContent(tableId, page, perPage, datasource)
  }

  listTables(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiTable[] }>> {
    return this.tablesApi.list(page, perPage)
  }

  listTableTriggers(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiTableTrigger[] }>> {
    return this.triggersApi.list(page, perPage)
  }

  listTasks(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiTask[] }>> {
    return this.tasksApi.list(page, perPage)
  }

  listTools(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiTool[] }>> {
    return this.aiApi.listTools(page, perPage)
  }

  listWorkflowTests(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiWorkflowTest[] }>> {
    return this.workflowTestsApi.list(page, perPage)
  }

  renameColumn(tableId: number, oldName: string, newName: string): Promise<ApiResponse<void>> {
    return this.tablesApi.renameColumn(tableId, oldName, newName)
  }

  replaceTableIndexes(tableId: number, indexes: XanoTableIndex[]): Promise<ApiResponse<void>> {
    return this.tablesApi.replaceIndexes(tableId, indexes)
  }

  replaceTableSchema(tableId: number, schema: XanoTableSchema[]): Promise<ApiResponse<void>> {
    return this.tablesApi.replaceSchema(tableId, schema)
  }

  searchRequestHistory(
    filter: {
      'created_at|<|'?: number
      'created_at|>|'?: number
      'duration|<|'?: number
      'duration|>|'?: number
      'status'?: number
      'status|<|'?: number
      'status|>|'?: number
    },
    options: {
      apiId?: number
      includeOutput?: boolean
      page?: number
      perPage?: number
      queryId?: number
      sort?: { [key: string]: 'asc' | 'desc' }
    } = {}
  ): Promise<ApiResponse<{ items: RequestHistoryItem[] }>> {
    return this.workspaceApi.searchRequestHistory(filter, options)
  }

  searchTableContent(
    tableId: number,
    options: {
      datasource?: string
      page?: number
      perPage?: number
      search?: Record<string, unknown> | Record<string, unknown>[]
      sort?: Record<string, 'asc' | 'desc'> | Record<string, 'asc' | 'desc'>[]
    } = {}
  ): Promise<ApiResponse<{ curPage: number; items: Record<string, unknown>[]; itemsReceived: number; itemsTotal: number; nextPage: null | number; offset: number; pageTotal: number; prevPage: null | number }>> {
    return this.tablesApi.searchContent(tableId, options)
  }

  updateAddon(id: number, xanoscript: string): Promise<ApiResponse<XanoApiAddon>> {
    return this.addonsApi.update(id, xanoscript)
  }

  updateAgent(id: number, xanoscript: string): Promise<ApiResponse<XanoApiAgent>> {
    return this.aiApi.updateAgent(id, xanoscript)
  }

  updateAgentTrigger(id: number, xanoscript: string): Promise<ApiResponse<XanoApiAgentTrigger>> {
    return this.aiApi.updateAgentTrigger(id, xanoscript)
  }

  updateApiEndpoint(apiGroupId: number, id: number, xanoscript: string): Promise<ApiResponse<XanoApiEndpoint>> {
    return this.apisApi.updateEndpoint(apiGroupId, id, xanoscript)
  }

  updateApiGroup(id: number, xanoscript: string): Promise<ApiResponse<XanoApiGroup>> {
    return this.apisApi.updateGroup(id, xanoscript)
  }

  updateFunction(id: number, xanoscript: string): Promise<ApiResponse<XanoApiFunction>> {
    return this.functionsApi.update(id, xanoscript)
  }

  updateMcpServer(id: number, xanoscript: string): Promise<ApiResponse<XanoApiMcpServer>> {
    return this.aiApi.updateMcpServer(id, xanoscript)
  }

  updateMcpServerTrigger(id: number, xanoscript: string): Promise<ApiResponse<XanoApiMcpServerTrigger>> {
    return this.aiApi.updateMcpServerTrigger(id, xanoscript)
  }

  updateMiddleware(id: number, xanoscript: string): Promise<ApiResponse<XanoApiMiddleware>> {
    return this.middlewareApi.update(id, xanoscript)
  }

  /**
   * Update object by type and ID
   */
  async updateObject(
    type: XanoObjectType,
    id: number,
    xanoscript: string,
    options?: { apigroup_id?: number; table_id?: number }
  ): Promise<ApiResponse<{ id: number; name?: string }>> {
    switch (type) {
      case 'addon': {
        return this.updateAddon(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'agent': {
        return this.updateAgent(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'agent_trigger': {
        return this.updateAgentTrigger(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'api_endpoint': {
        if (!options?.apigroup_id) {
          return { error: 'apigroup_id is required for updating API endpoints. Run "xano pull --sync" to refresh metadata.', ok: false, status: 0 }
        }

        return this.updateApiEndpoint(options.apigroup_id, id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'api_group': {
        return this.updateApiGroup(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'function': {
        return this.updateFunction(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'mcp_server': {
        return this.updateMcpServer(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'mcp_server_trigger': {
        return this.updateMcpServerTrigger(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'middleware': {
        return this.updateMiddleware(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'table': {
        return this.updateTable(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'table_trigger': {
        return this.updateTableTrigger(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'task': {
        return this.updateTask(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'tool': {
        return this.updateTool(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'workflow_test': {
        return this.updateWorkflowTest(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      default: {
        return { error: `Unsupported type: ${type}`, ok: false, status: 0 }
      }
    }
  }

  updateTable(id: number, xanoscript: string): Promise<ApiResponse<XanoApiTable>> {
    return this.tablesApi.update(id, xanoscript)
  }

  updateTableContent(tableId: number, pk: number | string, data: Record<string, unknown>, datasource?: string): Promise<ApiResponse<Record<string, unknown>>> {
    return this.tablesApi.updateContent(tableId, pk, data, datasource)
  }

  updateTableTrigger(id: number, xanoscript: string): Promise<ApiResponse<XanoApiTableTrigger>> {
    return this.triggersApi.update(id, xanoscript)
  }

  updateTask(id: number, xanoscript: string): Promise<ApiResponse<XanoApiTask>> {
    return this.tasksApi.update(id, xanoscript)
  }

  updateTool(id: number, xanoscript: string): Promise<ApiResponse<XanoApiTool>> {
    return this.aiApi.updateTool(id, xanoscript)
  }

  updateWorkflowTest(id: number, xanoscript: string): Promise<ApiResponse<XanoApiWorkflowTest>> {
    return this.workflowTestsApi.update(id, xanoscript)
  }
}

/**
 * Create API client from project config
 */
export function createApiClient(
  instanceOrigin: string,
  accessToken: string,
  workspaceId: number,
  branch: string
): XanoApi {
  const profile: XanoProfile = {
    access_token: accessToken, // eslint-disable-line camelcase
    instance_origin: instanceOrigin, // eslint-disable-line camelcase
  }

  return new XanoApi(profile, workspaceId, branch)
}

/**
 * Create API client from profile name
 */
export function createApiClientFromProfile(
  profileName: string | undefined,
  workspaceId: number,
  branch: string
): null | XanoApi {
  const profile = getProfile(profileName)
  if (!profile) return null

  return new XanoApi(profile, workspaceId, branch)
}

// Re-export types
export type { ApiResponse, RequestDebugInfo } from './request.js'