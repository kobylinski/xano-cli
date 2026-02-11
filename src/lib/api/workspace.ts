/**
 * Workspace API module (branches, datasources, request history)
 */

import type { RequestHistoryItem, XanoApiBranch, XanoDataSource } from '../types.js'

import { BaseApi } from './base.js'
import { apiRequest, ApiResponse } from './request.js'

export class WorkspaceApi extends BaseApi {
  async browseRequestHistory(options: {
    apiId?: number
    branchId?: string
    includeOutput?: boolean
    page?: number
    perPage?: number
    queryId?: number
  } = {}): Promise<ApiResponse<{ items: RequestHistoryItem[] }>> {
    const params = new URLSearchParams()
    params.set('branch', this.branch)
    if (options.page) params.set('page', options.page.toString())
    if (options.perPage) params.set('per_page', options.perPage.toString())
    if (options.apiId) params.set('api_id', options.apiId.toString())
    if (options.queryId) params.set('query_id', options.queryId.toString())
    if (options.includeOutput) params.set('include_output', 'true')

    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/request_history?${params.toString()}`
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

  async searchRequestHistory(
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
    const params = new URLSearchParams()
    params.set('branch', this.branch)
    if (options.page) params.set('page', options.page.toString())
    if (options.perPage) params.set('per_page', options.perPage.toString())
    if (options.apiId) params.set('api_id', options.apiId.toString())
    if (options.queryId) params.set('query_id', options.queryId.toString())
    if (options.includeOutput) params.set('include_output', 'true')

    const body: { filter?: typeof filter; sort?: typeof options.sort } = {}
    if (Object.keys(filter).length > 0) body.filter = filter
    if (options.sort) body.sort = options.sort

    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/request_history/search?${params.toString()}`,
      body
    )
  }
}
