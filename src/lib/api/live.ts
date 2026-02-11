/**
 * Live API calls module
 */

import { createRequire } from 'node:module'

import { BaseApi } from './base.js'
import { ApiResponse, RequestDebugInfo } from './request.js'

const require = createRequire(import.meta.url)
const { version: CLI_VERSION } = require('../../../package.json') as { version: string }

export class LiveApi extends BaseApi {
  /**
   * Call a live API endpoint
   * @param canonical - The API group canonical ID (e.g., "QV7RcVYt")
   * @param endpointPath - The endpoint path (e.g., "/auth/login")
   * @param method - HTTP method (GET, POST, PUT, DELETE, PATCH)
   * @param body - Request body (for POST/PUT/PATCH)
   * @param headers - Additional headers (e.g., Authorization token)
   * @param datasource - Optional datasource to target
   */
  async call(
    canonical: string,
    endpointPath: string,
    method: string = 'GET',
    body?: Record<string, unknown>,
    headers?: Record<string, string>,
    datasource?: string
  ): Promise<ApiResponse<unknown>> {
    const url = `${this.profile.instance_origin}/api:${canonical}:${this.branch}${endpointPath}`

    const requestHeaders: Record<string, string> = {
      accept: 'application/json',
      'User-Agent': `xano-cli/${CLI_VERSION}`,
      ...this.datasourceHeaders(datasource),
      ...headers,
    }

    let requestBody: string | undefined
    if (body) {
      requestHeaders['Content-Type'] = 'application/json'
      requestBody = JSON.stringify(body)
    }

    // Build debug info for request
    const debugInfo: RequestDebugInfo = {
      request: {
        body: requestBody,
        headers: requestHeaders,
        method,
        url,
      },
    }

    try {
      const response = await fetch(url, {
        body: requestBody,
        headers: requestHeaders,
        method,
      })

      // Capture response headers
      const responseHeaders: Record<string, string> = {}
      for (const [key, value] of response.headers.entries()) {
        responseHeaders[key] = value
      }

      debugInfo.response = {
        headers: responseHeaders,
        status: response.status,
        statusText: response.statusText,
      }

      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`
        try {
          const errorData = await response.json()
          errorMessage = errorData.message || errorData.error || errorMessage
        } catch {
          // Ignore JSON parse error
        }

        return {
          _debug: debugInfo,
          error: errorMessage,
          ok: false,
          status: response.status,
        }
      }

      const data = await response.json()
      return {
        _debug: debugInfo,
        data,
        ok: true,
        status: response.status,
      }
    } catch (error) {
      return {
        _debug: debugInfo,
        error: error instanceof Error ? error.message : 'Unknown error',
        ok: false,
        status: 0,
      }
    }
  }
}
