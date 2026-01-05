/**
 * Xano Metadata API client
 * Handles all API calls to Xano
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import * as yaml from 'js-yaml'
import * as os from 'node:os'
import type {
  XanoCredentials,
  XanoProfile,
  XanoApiBranch,
  XanoApiFunction,
  XanoApiEndpoint,
  XanoApiGroup,
  XanoApiTable,
  XanoApiTask,
  XanoObjectType,
} from './types.js'

const CREDENTIALS_PATH = path.join(os.homedir(), '.xano', 'credentials.yaml')

/**
 * Load credentials from ~/.xano/credentials.yaml
 */
export function loadCredentials(): XanoCredentials | null {
  if (!fs.existsSync(CREDENTIALS_PATH)) {
    return null
  }

  try {
    const content = fs.readFileSync(CREDENTIALS_PATH, 'utf-8')
    return yaml.load(content) as XanoCredentials
  } catch {
    return null
  }
}

/**
 * Get profile by name or default
 */
export function getProfile(profileName?: string): XanoProfile | null {
  const credentials = loadCredentials()
  if (!credentials) return null

  const name = profileName || credentials.default || 'default'
  return credentials.profiles[name] || null
}

/**
 * Get default profile name
 */
export function getDefaultProfileName(): string | null {
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
  ok: boolean
  status: number
  data?: T
  error?: string
  etag?: string
}

/**
 * Make authenticated API request
 */
async function apiRequest<T>(
  profile: XanoProfile,
  method: string,
  endpoint: string,
  body?: string | object,
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
      method,
      headers,
      body: requestBody,
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
        ok: false,
        status: response.status,
        error: errorMessage,
        etag,
      }
    }

    const data = await response.json() as T
    return {
      ok: true,
      status: response.status,
      data,
      etag,
    }
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error instanceof Error ? error.message : 'Unknown error',
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

  async listBranches(): Promise<ApiResponse<XanoApiBranch[]>> {
    return apiRequest<XanoApiBranch[]>(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/branch`
    )
  }

  // ========== Functions ==========

  async listFunctions(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiFunction[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/function?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  async getFunction(id: number): Promise<ApiResponse<XanoApiFunction>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/function/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  async createFunction(xanoscript: string): Promise<ApiResponse<XanoApiFunction>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/function?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async updateFunction(id: number, xanoscript: string): Promise<ApiResponse<XanoApiFunction>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/function/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async deleteFunction(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/function/${id}?${this.branchParam}`
    )
  }

  // ========== API Groups ==========

  async listApiGroups(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiGroup[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/apigroup?${this.branchParam}&page=${page}&per_page=${perPage}`
    )
  }

  async getApiGroup(id: number): Promise<ApiResponse<XanoApiGroup>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/apigroup/${id}?${this.branchParam}`
    )
  }

  // ========== API Endpoints ==========

  async listApiEndpoints(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiEndpoint[] }>> {
    // First try workspace-level API listing
    const result = await apiRequest<{ items: XanoApiEndpoint[] }>(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/api?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )

    // If that works, return it
    if (result.ok && result.data?.items && result.data.items.length > 0) {
      return result
    }

    // Otherwise, try fetching per group
    const groupsResult = await this.listApiGroups(1, 1000)
    if (!groupsResult.ok || !groupsResult.data?.items) {
      return result // Return original error
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
          allEndpoints.push({ ...ep, apigroup_id: group.id })
        }
      }
    }

    return {
      ok: true,
      status: 200,
      data: { items: allEndpoints },
    }
  }

  async getApiEndpoint(id: number): Promise<ApiResponse<XanoApiEndpoint>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/api/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  async createApiEndpoint(xanoscript: string): Promise<ApiResponse<XanoApiEndpoint>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/api?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async updateApiEndpoint(id: number, xanoscript: string): Promise<ApiResponse<XanoApiEndpoint>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/api/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async deleteApiEndpoint(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/api/${id}?${this.branchParam}`
    )
  }

  // ========== Tables ==========

  async listTables(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiTable[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/table?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  async getTable(id: number): Promise<ApiResponse<XanoApiTable>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/table/${id}?${this.branchParam}&include_xanoscript=true`
    )
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

  async updateTable(id: number, xanoscript: string): Promise<ApiResponse<XanoApiTable>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/table/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async deleteTable(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/table/${id}?${this.branchParam}`
    )
  }

  // ========== Tasks ==========

  async listTasks(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiTask[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/task?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  async getTask(id: number): Promise<ApiResponse<XanoApiTask>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/task/${id}?${this.branchParam}&include_xanoscript=true`
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

  async updateTask(id: number, xanoscript: string): Promise<ApiResponse<XanoApiTask>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/task/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async deleteTask(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/task/${id}?${this.branchParam}`
    )
  }

  // ========== Generic object operations ==========

  /**
   * Create object by type
   */
  async createObject(type: XanoObjectType, xanoscript: string): Promise<ApiResponse<{ id: number; name?: string }>> {
    switch (type) {
      case 'function':
        return this.createFunction(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      case 'api_endpoint':
        return this.createApiEndpoint(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      case 'table':
        return this.createTable(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      case 'task':
        return this.createTask(xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      default:
        return { ok: false, status: 0, error: `Unsupported type: ${type}` }
    }
  }

  /**
   * Update object by type and ID
   */
  async updateObject(type: XanoObjectType, id: number, xanoscript: string): Promise<ApiResponse<{ id: number; name?: string }>> {
    switch (type) {
      case 'function':
        return this.updateFunction(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      case 'api_endpoint':
        return this.updateApiEndpoint(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      case 'table':
        return this.updateTable(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      case 'task':
        return this.updateTask(id, xanoscript) as Promise<ApiResponse<{ id: number; name?: string }>>
      default:
        return { ok: false, status: 0, error: `Unsupported type: ${type}` }
    }
  }

  /**
   * Delete object by type and ID
   */
  async deleteObject(type: XanoObjectType, id: number): Promise<ApiResponse<void>> {
    switch (type) {
      case 'function':
        return this.deleteFunction(id)
      case 'api_endpoint':
        return this.deleteApiEndpoint(id)
      case 'table':
        return this.deleteTable(id)
      case 'task':
        return this.deleteTask(id)
      default:
        return { ok: false, status: 0, error: `Unsupported type: ${type}` }
    }
  }

  /**
   * Get object by type and ID
   */
  async getObject(type: XanoObjectType, id: number): Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>> {
    switch (type) {
      case 'function':
        return this.getFunction(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      case 'api_endpoint':
        return this.getApiEndpoint(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      case 'table':
        return this.getTable(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      case 'task':
        return this.getTask(id) as Promise<ApiResponse<{ id: number; name?: string; xanoscript?: string }>>
      default:
        return { ok: false, status: 0, error: `Unsupported type: ${type}` }
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
    instance_origin: instanceOrigin,
    access_token: accessToken,
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
): XanoApi | null {
  const profile = getProfile(profileName)
  if (!profile) return null

  return new XanoApi(profile, workspaceId, branch)
}
