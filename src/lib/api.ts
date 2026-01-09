/**
 * Xano Metadata API client
 * Handles all API calls to Xano
 */

import * as yaml from 'js-yaml'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import type {
  XanoApiAddon,
  XanoApiBranch,
  XanoApiEndpoint,
  XanoApiMiddleware,
  XanoApiFunction,
  XanoApiGroup,
  XanoApiTable,
  XanoApiTableTrigger,
  XanoApiTask,
  XanoApiWorkflowTest,
  XanoCredentials,
  XanoDataSource,
  XanoObjectType,
  XanoProfile,
} from './types.js'

const CREDENTIALS_PATH = path.join(os.homedir(), '.xano', 'credentials.yaml')

/**
 * Load credentials from ~/.xano/credentials.yaml
 */
export function loadCredentials(): null | XanoCredentials {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    return null
  }

  try {
    const content = fs.readFileSync(CREDENTIALS_PATH, 'utf8')
    return yaml.load(content) as XanoCredentials
  } catch {
    return null
  }
}

/**
 * Get profile by name or default
 */
export function getProfile(profileName?: string): null | XanoProfile {
  const credentials = loadCredentials()
  if (!credentials) return null

  const name = profileName || credentials.default || 'default'
  return credentials.profiles[name] || null
}

/**
 * Get default profile name
 */
export function getDefaultProfileName(): null | string {
  const credentials = loadCredentials()
  return credentials?.default || null
}

/**
 * List all profile names
 */
export function listProfileNames(): string[] {
  const credentials = loadCredentials()
  if (!credentials) return []
  return Object.keys(credentials.profiles)
}

/**
 * API response wrapper
 */
export interface ApiResponse<T> {
  data?: T
  error?: string
  etag?: string
  ok: boolean
  status: number
}

/**
 * Make authenticated API request
 */
async function apiRequest<T>(
  profile: XanoProfile,
  method: string,
  endpoint: string,
  body?: object | string,
  contentType: string = 'application/json'
): Promise<ApiResponse<T>> {
  const url = `${profile.instance_origin}${endpoint}`

  const headers: Record<string, string> = {
    accept: 'application/json',
    Authorization: `Bearer ${profile.access_token}`,
  }

  let requestBody: string | undefined
  if (body) {
    headers['Content-Type'] = contentType
    requestBody = typeof body === 'string' ? body : JSON.stringify(body)
  }

  try {
    const response = await fetch(url, {
      body: requestBody,
      headers,
      method,
    })

    const etag = response.headers.get('etag') || undefined

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}`
      try {
        const errorData = await response.json()
        errorMessage = errorData.message || errorData.error || errorMessage
      } catch {
        // Ignore JSON parse error
      }

      return {
        error: errorMessage,
        etag,
        ok: false,
        status: response.status,
      }
    }

    const data = await response.json() as T
    return {
      data,
      etag,
      ok: true,
      status: response.status,
    }
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Unknown error',
      ok: false,
      status: 0,
    }
  }
}

/**
 * Xano API client class
 */
export class XanoApi {
  constructor(
    private profile: XanoProfile,
    private workspaceId: number,
    private branch: string
  ) {}

  private get branchParam(): string {
    return `branch=${encodeURIComponent(this.branch)}`
  }

  // ========== Branches ==========

  async createApiEndpoint(xanoscript: string): Promise<ApiResponse<XanoApiEndpoint>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/api?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  // ========== Functions ==========

  async createFunction(xanoscript: string): Promise<ApiResponse<XanoApiFunction>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/function?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  /**
   * Create object by type
   */
  async createObject(type: XanoObjectType, xanoscript: string): Promise<ApiResponse<{ id: number; name?: string }>> {
    switch (type) {
      case 'api_endpoint': {
        return this.createApiEndpoint(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'function': {
        return this.createFunction(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'table': {
        return this.createTable(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'task': {
        return this.createTask(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'workflow_test': {
        return this.createWorkflowTest(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'table_trigger': {
        return this.createTableTrigger(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'addon': {
        return this.createAddon(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'middleware': {
        return this.createMiddleware(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      default: {
        return { error: `Unsupported type: ${type}`, ok: false, status: 0 }
      }
    }
  }

  async createTable(xanoscript: string): Promise<ApiResponse<XanoApiTable>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/table?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async createTask(xanoscript: string): Promise<ApiResponse<XanoApiTask>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/task?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async createWorkflowTest(xanoscript: string): Promise<ApiResponse<XanoApiWorkflowTest>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/workflow_test?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async deleteApiEndpoint(apiGroupId: number, id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/apigroup/${apiGroupId}/api/${id}?${this.branchParam}`
    )
  }

  // ========== API Groups ==========

  async deleteFunction(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/function/${id}?${this.branchParam}`
    )
  }

  /**
   * Delete object by type and ID
   * @param type Object type
   * @param id Object ID
   * @param options Additional options (apigroup_id required for api_endpoint)
   */
  async deleteObject(
    type: XanoObjectType,
    id: number,
    options?: { apigroup_id?: number }
  ): Promise<ApiResponse<void>> {
    switch (type) {
      case 'api_endpoint': {
        if (!options?.apigroup_id) {
          return { error: 'apigroup_id is required for deleting API endpoints', ok: false, status: 0 }
        }

        return this.deleteApiEndpoint(options.apigroup_id, id)
      }

      case 'function': {
        return this.deleteFunction(id)
      }

      case 'table': {
        return this.deleteTable(id)
      }

      case 'task': {
        return this.deleteTask(id)
      }

      case 'workflow_test': {
        return this.deleteWorkflowTest(id)
      }

      case 'table_trigger': {
        return this.deleteTableTrigger(id)
      }

      case 'addon': {
        return this.deleteAddon(id)
      }

      case 'middleware': {
        return this.deleteMiddleware(id)
      }

      case 'api_group': {
        return this.deleteApiGroup(id)
      }

      default: {
        return { error: `Unsupported type: ${type}`, ok: false, status: 0 }
      }
    }
  }

  // ========== API Endpoints ==========

  async deleteTable(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/table/${id}?${this.branchParam}`
    )
  }

  async deleteTask(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/task/${id}?${this.branchParam}`
    )
  }

  async deleteWorkflowTest(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/workflow_test/${id}?${this.branchParam}`
    )
  }

  async deleteApiGroup(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/apigroup/${id}?${this.branchParam}`
    )
  }

  async getApiEndpoint(id: number): Promise<ApiResponse<XanoApiEndpoint>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/api/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  async getApiGroup(id: number): Promise<ApiResponse<XanoApiGroup>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/apigroup/${id}?${this.branchParam}`
    )
  }

  async getFunction(id: number): Promise<ApiResponse<XanoApiFunction>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/function/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  // ========== Tables ==========

  /**
   * Get object by type and ID
   */
  async getObject(type: XanoObjectType, id: number): Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>> {
    switch (type) {
      case 'api_endpoint': {
        return this.getApiEndpoint(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'function': {
        return this.getFunction(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'table': {
        return this.getTable(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'task': {
        return this.getTask(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'workflow_test': {
        return this.getWorkflowTest(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'table_trigger': {
        return this.getTableTrigger(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'addon': {
        return this.getAddon(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      case 'middleware': {
        return this.getMiddleware(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      }

      default: {
        return { error: `Unsupported type: ${type}`, ok: false, status: 0 }
      }
    }
  }

  async getTable(id: number): Promise<ApiResponse<XanoApiTable>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/table/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  async getTask(id: number): Promise<ApiResponse<XanoApiTask>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/task/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  async getWorkflowTest(id: number): Promise<ApiResponse<XanoApiWorkflowTest>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/workflow_test/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  async listApiEndpoints(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiEndpoint[] }>> {
    // Always fetch per API group to ensure apigroup_id is captured
    // The workspace-level /api endpoint may not return apigroup_id
    const groupsResult = await this.listApiGroups(1, 1000)
    if (!groupsResult.ok || !groupsResult.data?.items) {
      // Fallback to workspace-level listing if groups fail
      return apiRequest<{ items: XanoApiEndpoint[] }>(
        this.profile,
        'GET',
        `/api:meta/workspace/${this.workspaceId}/api?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
      )
    }

    const allEndpoints: XanoApiEndpoint[] = []

    for (const group of groupsResult.data.items) {
      const groupEndpoints = await apiRequest<{ items: XanoApiEndpoint[] }>(
        this.profile,
        'GET',
        `/api:meta/workspace/${this.workspaceId}/apigroup/${group.id}/api?${this.branchParam}&page=1&per_page=1000&include_xanoscript=true`
      )

      if (groupEndpoints.ok && groupEndpoints.data?.items) {
        for (const ep of groupEndpoints.data.items) {
          // Ensure apigroup_id is set (required for updates)
          allEndpoints.push({ ...ep, apigroup_id: group.id })
        }
      }
    }

    return {
      data: { items: allEndpoints },
      ok: true,
      status: 200,
    }
  }

  async listApiGroups(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiGroup[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/apigroup?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  // ========== Tasks ==========

  async listBranches(): Promise<ApiResponse<XanoApiBranch[]>> {
    return apiRequest<XanoApiBranch[]>(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/branch`
    )
  }

  async listDataSources(): Promise<ApiResponse<XanoDataSource[]>> {
    return apiRequest<XanoDataSource[]>(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/datasource`
    )
  }

  async createDataSource(label: string, color: string): Promise<ApiResponse<XanoDataSource>> {
    return apiRequest<XanoDataSource>(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/datasource`,
      { color, label }
    )
  }

  async deleteDataSource(label: string): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/datasource/${encodeURIComponent(label)}`
    )
  }

  async listFunctions(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiFunction[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/function?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  async listTables(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiTable[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/table?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  async listTasks(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiTask[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/task?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  async listWorkflowTests(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiWorkflowTest[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/workflow_test?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  /**
   * List all table triggers in the workspace
   */
  async listTableTriggers(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiTableTrigger[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/table/trigger?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  /**
   * List addons
   */
  async listAddons(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiAddon[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/addon?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  // ========== Table Trigger CRUD ==========

  async getTableTrigger(id: number): Promise<ApiResponse<XanoApiTableTrigger>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/table/trigger/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  async createTableTrigger(xanoscript: string): Promise<ApiResponse<XanoApiTableTrigger>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/table/trigger?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async updateTableTrigger(id: number, xanoscript: string): Promise<ApiResponse<XanoApiTableTrigger>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/table/trigger/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async deleteTableTrigger(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/table/trigger/${id}?${this.branchParam}`
    )
  }

  // ========== Addon CRUD ==========

  async getAddon(id: number): Promise<ApiResponse<XanoApiAddon>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/addon/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  async createAddon(xanoscript: string): Promise<ApiResponse<XanoApiAddon>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/addon?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async updateAddon(id: number, xanoscript: string): Promise<ApiResponse<XanoApiAddon>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/addon/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async deleteAddon(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/addon/${id}?${this.branchParam}`
    )
  }

  // ========== Middleware CRUD ==========

  async listMiddlewares(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiMiddleware[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/middleware?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  async getMiddleware(id: number): Promise<ApiResponse<XanoApiMiddleware>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/middleware/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  async createMiddleware(xanoscript: string): Promise<ApiResponse<XanoApiMiddleware>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/middleware?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async updateMiddleware(id: number, xanoscript: string): Promise<ApiResponse<XanoApiMiddleware>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/middleware/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async deleteMiddleware(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/middleware/${id}?${this.branchParam}`
    )
  }

  async updateApiEndpoint(apiGroupId: number, id: number, xanoscript: string): Promise<ApiResponse<XanoApiEndpoint>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/apigroup/${apiGroupId}/api/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  // ========== Generic object operations ==========

  async updateFunction(id: number, xanoscript: string): Promise<ApiResponse<XanoApiFunction>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/function/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  /**
   * Update object by type and ID
   * @param type Object type
   * @param id Object ID
   * @param xanoscript XanoScript content
   * @param options Additional options (apigroup_id for api_endpoint, table_id for table_trigger)
   */
  async updateObject(
    type: XanoObjectType,
    id: number,
    xanoscript: string,
    options?: { apigroup_id?: number; table_id?: number }
  ): Promise<ApiResponse<{ id: number; name?: string }>> {
    switch (type) {
      case 'api_endpoint': {
        if (!options?.apigroup_id) {
          return { error: 'apigroup_id is required for updating API endpoints. Run "xano pull --sync" to refresh metadata.', ok: false, status: 0 }
        }

        return this.updateApiEndpoint(options.apigroup_id, id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'function': {
        return this.updateFunction(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'table': {
        return this.updateTable(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'task': {
        return this.updateTask(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'workflow_test': {
        return this.updateWorkflowTest(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'table_trigger': {
        return this.updateTableTrigger(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'addon': {
        return this.updateAddon(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      case 'middleware': {
        return this.updateMiddleware(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      }

      default: {
        return { error: `Unsupported type: ${type}`, ok: false, status: 0 }
      }
    }
  }

  async updateTable(id: number, xanoscript: string): Promise<ApiResponse<XanoApiTable>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/table/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async updateTask(id: number, xanoscript: string): Promise<ApiResponse<XanoApiTask>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/task/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async updateWorkflowTest(id: number, xanoscript: string): Promise<ApiResponse<XanoApiWorkflowTest>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/workflow_test/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  // ========== Table Content (Data) ==========

  /**
   * List records from a table
   */
  async listTableContent(
    tableId: number,
    page = 1,
    perPage = 100
  ): Promise<ApiResponse<{ items: Record<string, unknown>[]; curPage: number; nextPage: number | null; prevPage: number | null }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/table/${tableId}/content?${this.branchParam}&page=${page}&per_page=${perPage}`
    )
  }

  /**
   * Get a single record by primary key
   */
  async getTableContent(tableId: number, pk: number | string): Promise<ApiResponse<Record<string, unknown>>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/table/${tableId}/content/${encodeURIComponent(pk)}?${this.branchParam}`
    )
  }

  /**
   * Create a new record in a table
   * Note: Password fields are automatically hashed by Xano
   */
  async createTableContent(tableId: number, data: Record<string, unknown>): Promise<ApiResponse<Record<string, unknown>>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/table/${tableId}/content?${this.branchParam}`,
      data
    )
  }

  /**
   * Update an existing record by primary key
   */
  async updateTableContent(tableId: number, pk: number | string, data: Record<string, unknown>): Promise<ApiResponse<Record<string, unknown>>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/table/${tableId}/content/${encodeURIComponent(pk)}?${this.branchParam}`,
      data
    )
  }

  /**
   * Delete a record by primary key
   */
  async deleteTableContent(tableId: number, pk: number | string): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/table/${tableId}/content/${encodeURIComponent(pk)}?${this.branchParam}`
    )
  }

  /**
   * Bulk insert multiple records
   */
  async bulkCreateTableContent(tableId: number, records: Record<string, unknown>[]): Promise<ApiResponse<Record<string, unknown>[]>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/table/${tableId}/content/bulk?${this.branchParam}`,
      records
    )
  }

  // ========== Live API Calls ==========

  /**
   * Get detailed info about an API group including canonical ID
   */
  async getApiGroupWithCanonical(groupId: number): Promise<ApiResponse<XanoApiGroup & { canonical?: string }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/apigroup/${groupId}?${this.branchParam}`
    )
  }

  /**
   * Call a live API endpoint
   * @param canonical - The API group canonical ID (e.g., "QV7RcVYt")
   * @param endpointPath - The endpoint path (e.g., "/auth/login")
   * @param method - HTTP method (GET, POST, PUT, DELETE, PATCH)
   * @param body - Request body (for POST/PUT/PATCH)
   * @param headers - Additional headers (e.g., Authorization token)
   */
  async callLiveApi(
    canonical: string,
    endpointPath: string,
    method: string = 'GET',
    body?: Record<string, unknown>,
    headers?: Record<string, string>
  ): Promise<ApiResponse<unknown>> {
    const url = `${this.profile.instance_origin}/api:${canonical}:${this.branch}${endpointPath}`

    const requestHeaders: Record<string, string> = {
      accept: 'application/json',
      ...headers,
    }

    let requestBody: string | undefined
    if (body) {
      requestHeaders['Content-Type'] = 'application/json'
      requestBody = JSON.stringify(body)
    }

    try {
      const response = await fetch(url, {
        body: requestBody,
        headers: requestHeaders,
        method,
      })

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`
        try {
          const errorData = await response.json()
          errorMessage = errorData.message || errorData.error || errorMessage
        } catch {
          // Ignore JSON parse error
        }

        return {
          error: errorMessage,
          ok: false,
          status: response.status,
        }
      }

      const data = await response.json()
      return {
        data,
        ok: true,
        status: response.status,
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
        ok: false,
        status: 0,
      }
    }
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
    access_token: accessToken,
    instance_origin: instanceOrigin,
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
