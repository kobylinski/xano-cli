/**
 * Tables API module (schema, indexes, content)
 */

import type { XanoApiTable, XanoTableIndex, XanoTableSchema } from '../types.js'

import { BaseApi } from './base.js'
import { apiRequest, ApiResponse } from './request.js'

export class TablesApi extends BaseApi {
  async addIndex(tableId: number, index: XanoTableIndex): Promise<ApiResponse<XanoTableIndex>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/table/${tableId}/index?${this.branchParam}`,
      {
        fields: index.fields,
        type: index.type,
      }
    )
  }

  async bulkCreateContent(
    tableId: number,
    records: Record<string, unknown>[],
    datasource?: string,
    allowIdField = false
  ): Promise<ApiResponse<Record<string, unknown>[]>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/table/${tableId}/content/bulk?${this.branchParam}`,
      { allow_id_field: allowIdField, items: records }, // eslint-disable-line camelcase
      'application/json',
      this.datasourceHeaders(datasource)
    )
  }

  async create(xanoscript: string): Promise<ApiResponse<XanoApiTable>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/table?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async createContent(tableId: number, data: Record<string, unknown>, datasource?: string): Promise<ApiResponse<Record<string, unknown>>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/table/${tableId}/content?${this.branchParam}`,
      data,
      'application/json',
      this.datasourceHeaders(datasource)
    )
  }

  async delete(id: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/table/${id}?${this.branchParam}`
    )
  }

  async deleteContent(tableId: number, pk: number | string, datasource?: string): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/table/${tableId}/content/${encodeURIComponent(pk)}?${this.branchParam}`,
      undefined,
      'application/json',
      this.datasourceHeaders(datasource)
    )
  }

  async deleteIndex(tableId: number, indexId: number): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'DELETE',
      `/api:meta/workspace/${this.workspaceId}/table/${tableId}/index/${indexId}?${this.branchParam}`
    )
  }

  async get(id: number): Promise<ApiResponse<XanoApiTable>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/table/${id}?${this.branchParam}&include_xanoscript=true`
    )
  }

  async getContent(tableId: number, pk: number | string, datasource?: string): Promise<ApiResponse<Record<string, unknown>>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/table/${tableId}/content/${encodeURIComponent(pk)}?${this.branchParam}`,
      undefined,
      'application/json',
      this.datasourceHeaders(datasource)
    )
  }

  async getIndexes(tableId: number): Promise<ApiResponse<XanoTableIndex[]>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/table/${tableId}/index?${this.branchParam}`
    )
  }

  async getSchema(tableId: number): Promise<ApiResponse<XanoTableSchema[]>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/table/${tableId}/schema?${this.branchParam}`
    )
  }

  async list(page = 1, perPage = 100): Promise<ApiResponse<{ items: XanoApiTable[] }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/table?${this.branchParam}&page=${page}&per_page=${perPage}&include_xanoscript=true`
    )
  }

  async listContent(
    tableId: number,
    page = 1,
    perPage = 100,
    datasource?: string
  ): Promise<ApiResponse<{ curPage: number; items: Record<string, unknown>[]; itemsReceived: number; itemsTotal: number; nextPage: null | number; offset: number; pageTotal: number; prevPage: null | number }>> {
    return apiRequest(
      this.profile,
      'GET',
      `/api:meta/workspace/${this.workspaceId}/table/${tableId}/content?${this.branchParam}&page=${page}&per_page=${perPage}`,
      undefined,
      'application/json',
      this.datasourceHeaders(datasource)
    )
  }

  async renameColumn(tableId: number, oldName: string, newName: string): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/table/${tableId}/schema/rename?${this.branchParam}`,
      { new_name: newName, old_name: oldName } // eslint-disable-line camelcase
    )
  }

  async replaceIndexes(tableId: number, indexes: XanoTableIndex[]): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/table/${tableId}/index?${this.branchParam}`,
      { index: indexes }
    )
  }

  async replaceSchema(tableId: number, schema: XanoTableSchema[]): Promise<ApiResponse<void>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/table/${tableId}/schema?${this.branchParam}`,
      { schema }
    )
  }

  async searchContent(
    tableId: number,
    options: {
      datasource?: string
      page?: number
      perPage?: number
      search?: Record<string, unknown> | Record<string, unknown>[]
      sort?: Record<string, 'asc' | 'desc'> | Record<string, 'asc' | 'desc'>[]
    } = {}
  ): Promise<ApiResponse<{ curPage: number; items: Record<string, unknown>[]; itemsReceived: number; itemsTotal: number; nextPage: null | number; offset: number; pageTotal: number; prevPage: null | number }>> {
    const body: {
      page?: number
      per_page?: number
      search?: Record<string, unknown> | Record<string, unknown>[]
      sort?: Record<string, 'asc' | 'desc'> | Record<string, 'asc' | 'desc'>[]
    } = {}

    if (options.page) body.page = options.page
    if (options.perPage) body.per_page = options.perPage // eslint-disable-line camelcase
    if (options.search) body.search = options.search
    if (options.sort) body.sort = options.sort

    return apiRequest(
      this.profile,
      'POST',
      `/api:meta/workspace/${this.workspaceId}/table/${tableId}/content/search?branch=${this.branch}`,
      body,
      'application/json',
      this.datasourceHeaders(options.datasource)
    )
  }

  async update(id: number, xanoscript: string): Promise<ApiResponse<XanoApiTable>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/table/${id}?${this.branchParam}`,
      xanoscript,
      'text/x-xanoscript'
    )
  }

  async updateContent(tableId: number, pk: number | string, data: Record<string, unknown>, datasource?: string): Promise<ApiResponse<Record<string, unknown>>> {
    return apiRequest(
      this.profile,
      'PUT',
      `/api:meta/workspace/${this.workspaceId}/table/${tableId}/content/${encodeURIComponent(pk)}?${this.branchParam}`,
      data,
      'application/json',
      this.datasourceHeaders(datasource)
    )
  }
}
