/**
 * Functions API module
 */

import type { RequestHistoryItem, XanoApiFunction } from '../types.js'

import { BaseApi } from './base.js'
import { apiRequest, ApiResponse } from './request.js'

export class FunctionsApi extends BaseApi {
  async create(xanoscript: string): Promise<ApiResponse<XanoApiFunction>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/function?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async delete(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/function/${id}?${this.branchParam}`
    )
  }

  async get(id: number): Promise<ApiResponse<XanoApiFunction>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/function/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  async getHistory(
    functionId: number,
    options: { includeOutput?: boolean; page?: number; perPage?: number } = {}
  ): Promise<ApiResponse<{ items: RequestHistoryItem[] }>> {
    const params = new URLSearchParams()
    params.set('branch', this.branch)
    if (options.page) params.set('page', options.page.toString())
    if (options.perPage) params.set('per_page', options.perPage.toString())
    if (options.includeOutput) params.set('include_output', 'true')

    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/function/${functionId}/request_history?${params.toString()}`
    )
  }

  async list(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiFunction[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/function?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  async update(id: number, xanoscript: string): Promise<ApiResponse<XanoApiFunction>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/function/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }
}
