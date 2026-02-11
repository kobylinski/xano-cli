/**
 * Core API request utilities and types
 */

import type { XanoProfile } from '../types.js'

import { logger } from '../logger.js'

/**
 * Debug information for request/response
 */
export interface RequestDebugInfo {
  request: {
    body?: string
    headers: Record<string, string>
    method: string
    url: string
  }
  response?: {
    headers: Record<string, string>
    status: number
    statusText: string
  }
}

/**
 * API response wrapper
 */
export interface ApiResponse<T> {
  _debug?: RequestDebugInfo
  data?: T
  error?: string
  etag?: string
  ok: boolean
  status: number
}

/**
 * Make authenticated API request
 */
export async function apiRequest<T>(
  profile: XanoProfile,
  method: string,
  endpoint: string,
  body?: object | string,
  contentType: string = 'application/json',
  extraHeaders?: Record<string, string>
): Promise<ApiResponse<T>> {
  const url = `${profile.instance_origin}${endpoint}`

  // Verbose: Log API call
  logger.apiCall(method, endpoint)

  // Debug: Log request body
  if (body) {
    logger.requestBody(body)
  }

  // Trace: Start timing
  const requestId = `api-${Date.now()}`
  logger.timeStart(requestId, `${method} ${endpoint}`)

  const headers: Record<string, string> = {
    accept: 'application/json',
    Authorization: `Bearer ${profile.access_token}`,
    ...extraHeaders,
  }

  let requestBody: string | undefined
  if (body) {
    headers['Content-Type'] = contentType
    requestBody = typeof body === 'string' ? body : JSON.stringify(body)
  }

  try {
    const startTime = performance.now()
    const response = await fetch(url, {
      body: requestBody,
      headers,
      method,
    })
    const durationMs = Math.round(performance.now() - startTime)

    // Trace: End timing
    logger.timeEnd(requestId)

    const etag = response.headers.get('etag') || undefined

    if (!response.ok) {
      let errorMessage = `HTTP ${response.status}`
      try {
        const errorData = await response.json()
        errorMessage = errorData.message || errorData.error || errorMessage
      } catch {
        // Ignore JSON parse error
      }

      // Verbose: Log error response
      logger.apiResponse(response.status, response.statusText, durationMs)
      logger.debug('Error:', errorMessage)

      return {
        error: errorMessage,
        etag,
        ok: false,
        status: response.status,
      }
    }

    // Verbose: Log success response
    logger.apiResponse(response.status, response.statusText, durationMs)

    const data = await response.json() as T

    // Debug: Log response data
    logger.responseData(data)

    return {
      data,
      etag,
      ok: true,
      status: response.status,
    }
  } catch (error) {
    // Trace: End timing on error
    logger.timeEnd(requestId)
    logger.debug('Request failed:', error instanceof Error ? error.message : 'Unknown error')

    return {
      error: error instanceof Error ? error.message : 'Unknown error',
      ok: false,
      status: 0,
    }
  }
}
