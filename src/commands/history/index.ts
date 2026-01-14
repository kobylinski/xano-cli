import { Args, Command, Flags } from '@oclif/core'
import * as fs from 'node:fs'
import path from 'node:path'

import type { RequestHistoryItem, XanoObject, XanoObjectType } from '../../lib/types.js'

import { createApiClientFromProfile, getDefaultProfileName } from '../../lib/api.js'
import { loadObjects } from '../../lib/objects.js'
import { findProjectRoot, loadLocalConfig } from '../../lib/project.js'

// Retention periods in hours
// Keys use snake_case to match Xano API object types
/* eslint-disable camelcase */
const RETENTION: Record<string, number> = {
  api_endpoint: 24,
  function: 24,
  middleware: 24,
  table_trigger: 168, // 7 days
  task: 168, // 7 days
}
/* eslint-enable camelcase */

// Types that support request history
const HISTORY_TYPES: Set<XanoObjectType> = new Set([
  'api_endpoint',
  'function',
  'middleware',
  'table_trigger',
  'task',
])

/**
 * Parse human-readable duration to milliseconds
 * Supports: 30m, 1h, 2h, 1d, 7d, etc.
 */
function parseDuration(input: string): null | { hours: number; ms: number; } {
  const match = input.match(/^(\d+(?:\.\d+)?)\s*(m|min|mins|minutes?|h|hr|hrs|hours?|d|days?)$/i)
  if (!match) return null

  const value = Number.parseFloat(match[1])
  const unit = match[2].toLowerCase()

  let hours: number
  if (unit.startsWith('m')) {
    hours = value / 60
  } else if (unit.startsWith('h')) {
    hours = value
  } else if (unit.startsWith('d')) {
    hours = value * 24
  } else {
    return null
  }

  return { hours, ms: hours * 60 * 60 * 1000 }
}

/**
 * Format duration in seconds to human-readable string
 */
function formatDuration(seconds: number): string {
  if (seconds < 0.001) return '<1ms'
  if (seconds < 1) return `${Math.round(seconds * 1000)}ms`
  if (seconds < 60) return `${seconds.toFixed(2)}s`
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
}

/**
 * Format bytes to human-readable string
 */
function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return '-'
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

/**
 * Parse timestamp from API (can be number ms or string)
 */
function parseTimestamp(timestamp: number | string): number {
  if (typeof timestamp === 'number') {
    return timestamp
  }

  // Parse string format: "2026-01-13 09:30:55+0000"
  const date = new Date(timestamp.replace(' ', 'T').replace('+0000', 'Z'))
  return date.getTime()
}

/**
 * Format timestamp to local time string
 */
function formatTime(timestamp: number | string): string {
  const ms = parseTimestamp(timestamp)
  const date = new Date(ms)
  return date.toLocaleString('en-US', {
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    year: 'numeric',
  })
}

/**
 * Get status color for terminal output
 */
function getStatusColor(status: number): string {
  if (status >= 200 && status < 300) return '\u001B[32m' // Green
  if (status >= 300 && status < 400) return '\u001B[33m' // Yellow
  if (status >= 400 && status < 500) return '\u001B[31m' // Red
  if (status >= 500) return '\u001B[91m' // Bright red
  return '\u001B[0m' // Default
}

const RESET = '\u001B[0m'

export default class History extends Command {
  static args = {
    file: Args.string({
      description: 'File or directory path (optional - omit to see all workspace history)',
      required: false,
    }),
  }
static description = 'View request history for the workspace or specific files'
static examples = [
    '<%= config.bin %> history                              # All workspace history',
    '<%= config.bin %> history --last 1h                    # All history in last hour',
    '<%= config.bin %> history app/apis/auth/login_POST.xs  # Specific endpoint',
    '<%= config.bin %> history app/apis/auth/               # All endpoints in group',
    '<%= config.bin %> history --status error               # All errors',
    '<%= config.bin %> history --slow                       # All slow requests',
  ]
static flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    last: Flags.string({
      char: 'l',
      description: 'Time range (e.g., 30m, 1h, 2h, 1d, 7d)',
    }),
    limit: Flags.integer({
      default: 25,
      description: 'Number of results to show (max 500)',
    }),
    output: Flags.boolean({
      char: 'o',
      default: false,
      description: 'Include request/response bodies',
    }),
    profile: Flags.string({
      char: 'p',
      description: 'Profile to use',
      env: 'XANO_PROFILE',
    }),
    slow: Flags.string({
      description: 'Show slow requests (default >1s, or specify threshold like --slow 2)',
    }),
    status: Flags.string({
      char: 's',
      description: 'Filter by status (e.g., 200, 4xx, 5xx, error, success)',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(History)

    // Find project root
    const projectRoot = findProjectRoot()
    if (!projectRoot) {
      this.error('Not in a xano project. Run "xano init" first.')
    }

    // Load config
    const config = loadLocalConfig(projectRoot)
    if (!config) {
      this.error('Project not initialized. Run "xano init" first.')
    }

    // Get profile
    const profileName = flags.profile || getDefaultProfileName()
    if (!profileName) {
      this.error('No profile found. Run "xano profile:wizard" first.')
    }

    // Create API client
    const api = createApiClientFromProfile(profileName, config.workspaceId, config.branch)
    if (!api) {
      this.error(`Profile "${profileName}" not found.`)
    }

    // If no file specified, fetch all workspace history
    if (!args.file) {
      await this.fetchWorkspaceHistory(api, flags, config)
      return
    }

    // Load objects for file-based lookup
    const objects = loadObjects(projectRoot)
    if (!objects || objects.length === 0) {
      this.error('No objects found. Run "xano pull --sync" first.')
    }

    // Resolve file path from cwd, so "." in a subdirectory means that subdirectory
    const filePath = path.resolve(args.file)

    // Check if it's a directory (for API group)
    const isDirectory = fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()

    // Find object(s) matching the path
    let matchingObjects = objects.filter((obj: XanoObject) => {
      const objFullPath = path.resolve(projectRoot, obj.path)
      if (isDirectory) {
        return objFullPath.startsWith(filePath)
      }

      return objFullPath === filePath || obj.path === args.file
    })

    if (matchingObjects.length === 0) {
      this.error(`No object found for path: ${args.file}\nRun "xano pull --sync" to update local state.`)
    }

    // Filter to only types that have history
    matchingObjects = matchingObjects.filter((obj: XanoObject) => HISTORY_TYPES.has(obj.type))

    if (matchingObjects.length === 0) {
      // Get the type of the original objects to give a helpful message
      const originalTypes = objects
        .filter((obj: XanoObject) => {
          const objFullPath = path.resolve(projectRoot, obj.path)
          if (isDirectory) return objFullPath.startsWith(filePath)
          return objFullPath === filePath || obj.path === args.file
        })
        .map((obj: XanoObject) => obj.type)
        .filter((v, i, a) => a.indexOf(v) === i) // unique

      const typeList = originalTypes.length > 0 ? originalTypes.join(', ') : 'unknown'
      this.error(
        `Object type "${typeList}" does not support request history.\n` +
        `Supported types: api_endpoint, function, task, middleware, table_trigger\n` +
        `Path: ${args.file}`
      )
    }

    // Parse time filter
    let timeFilter: undefined | { hours: number; ms: number; }
    if (flags.last) {
      const parsed = parseDuration(flags.last)
      if (!parsed) {
        this.error(`Invalid time format: ${flags.last}\nUse formats like: 30m, 1h, 2h, 1d, 7d`)
      }

      timeFilter = parsed
    }

    // Check retention warnings
    const objectType = matchingObjects[0].type
    const retentionHours = RETENTION[objectType] || 24
    if (timeFilter && timeFilter.hours > retentionHours) {
      const retentionDays = retentionHours / 24
      const retentionStr = retentionHours >= 24 ? `${retentionDays} day${retentionDays > 1 ? 's' : ''}` : `${retentionHours} hours`
      this.warn(`Retention for ${objectType} is ${retentionStr}. Results may be incomplete.`)
    }

    // Parse status filter
    let statusFilter: undefined | { exact?: number; max?: number; min?: number; }
    if (flags.status) {
      const status = flags.status.toLowerCase()
      switch (status) {
      case '2xx': {
        statusFilter = { max: 299, min: 200 }
      
      break;
      }
 
      case '3xx': {
        statusFilter = { max: 399, min: 300 }
      
      break;
      }

      case '4xx': {
        statusFilter = { max: 499, min: 400 }
      
      break;
      }

      case '5xx': {
        statusFilter = { max: 599, min: 500 }
      
      break;
      }

      case 'error':
      case 'errors': {
        statusFilter = { min: 400 }
      
      break;
      }

      case 'success': {
        statusFilter = { max: 399, min: 200 }
      
      break;
      }

      default: {
        const code = Number.parseInt(status, 10)
        if (Number.isNaN(code)) {
          this.error(`Invalid status filter: ${flags.status}\nUse: 200, 4xx, 5xx, error, success`)
        }

        statusFilter = { exact: code }
      }
      }
    }

    // Parse slow filter
    let slowThreshold: number | undefined
    if (flags.slow !== undefined) {
      slowThreshold = flags.slow === '' ? 1 : Number.parseFloat(flags.slow)
      if (Number.isNaN(slowThreshold)) {
        this.error(`Invalid slow threshold: ${flags.slow}\nUse a number in seconds (e.g., --slow 2)`)
      }
    }

    // Fetch history for each matching object in parallel
    const fetchHistoryForObject = async (obj: XanoObject) => {
      const { type } = obj

      try {
        let response
        switch (type) {
          case 'api_endpoint': {
            response = await api.browseRequestHistory({
              includeOutput: flags.output,
              perPage: Math.min(flags.limit * 2, 500),
              queryId: obj.id,
            })
            break
          }

          case 'function': {
            response = await api.getFunctionHistory(obj.id, {
              includeOutput: flags.output,
              perPage: Math.min(flags.limit, 500),
            })
            break
          }

          case 'middleware': {
            response = await api.getMiddlewareHistory(obj.id, {
              includeOutput: flags.output,
              perPage: Math.min(flags.limit, 500),
            })
            break
          }

          case 'table_trigger': {
            response = await api.getTriggerHistory(obj.id, {
              includeOutput: flags.output,
              perPage: Math.min(flags.limit, 500),
            })
            break
          }

          case 'task': {
            response = await api.getTaskHistory(obj.id, {
              includeOutput: flags.output,
              perPage: Math.min(flags.limit, 500),
            })
            break
          }

          default: {
            return { error: `Unsupported type: ${type}`, items: [], path: obj.path, success: false, type }
          }
        }

        if (response?.ok && response.data?.items) {
          let { items } = response.data

          // Apply client-side filters (server-side filters are unreliable)
          if (timeFilter) {
            const cutoff = Date.now() - timeFilter.ms
            items = items.filter(item => parseTimestamp(item.created_at) >= cutoff)
          }

          if (statusFilter) {
            items = items.filter(item => {
              if (statusFilter.exact !== undefined) return item.status === statusFilter.exact
              if (statusFilter.min !== undefined && item.status < statusFilter.min) return false
              if (statusFilter.max !== undefined && item.status > statusFilter.max) return false
              return true
            })
          }

          if (slowThreshold) {
            items = items.filter(item => item.duration > slowThreshold)
          }

          return { items, path: obj.path, success: true, type }
        }

        return { error: response?.error || 'Unknown error', items: [], path: obj.path, success: false, type }
      } catch (error) {
        return { error: error instanceof Error ? error.message : 'Unknown error', items: [], path: obj.path, success: false, type }
      }
    }

    // Fetch all history in parallel
    const results = await Promise.all(matchingObjects.map(obj => fetchHistoryForObject(obj)))

    const allItems: RequestHistoryItem[] = []
    const errors: { error: string; path: string; type: string }[] = []
    let successCount = 0

    for (const result of results) {
      if (result.success) {
        successCount++
        allItems.push(...result.items)
      } else if (result.error) {
        errors.push({ error: result.error, path: result.path, type: result.type })
      }
    }

    // Report errors (aggregated for directories, individual for single files)
    if (errors.length > 0) {
      if (matchingObjects.length === 1) {
        // Single file - show detailed error
        this.error(
          `Failed to fetch request history for ${errors[0].path}\n` +
          `Error: ${errors[0].error}\n` +
          `Type: ${errors[0].type}\n` +
          `\nNote: Request history may not be available for this object, or the history retention period may have expired.`
        )
      } else if (successCount === 0) {
        // Directory with all failures - aggregate by error type
        const errorsByType: Record<string, number> = {}
        for (const e of errors) {
          errorsByType[e.type] = (errorsByType[e.type] || 0) + 1
        }

        const summary = Object.entries(errorsByType)
          .map(([type, count]) => `${type}: ${count} failed`)
          .join(', ')

        this.error(
          `Failed to fetch request history for all ${errors.length} objects.\n` +
          `Summary: ${summary}\n` +
          `\nNote: Request history may not be available for these objects, or the history retention period may have expired.`
        )
      } else {
        // Directory with partial success - just note the failures
        this.warn(`${errors.length} of ${matchingObjects.length} objects had no history available.`)
      }
    }

    // Sort by timestamp descending
    allItems.sort((a, b) => parseTimestamp(b.created_at) - parseTimestamp(a.created_at))

    // Limit results
    const limitedItems = allItems.slice(0, flags.limit)

    // Output
    if (flags.json) {
      this.log(JSON.stringify(limitedItems, null, 2))
      return
    }

    if (limitedItems.length === 0) {
      this.log('No request history found.')
      return
    }

    // Print header
    const objectName = matchingObjects.length === 1
      ? matchingObjects[0].path
      : `${matchingObjects.length} objects in ${args.file}`

    this.log(`\nRequest History: ${objectName}`)
    this.log('')

    // Print table header
    this.log('Time                     Status  Duration    Input     Output')
    this.log('─'.repeat(70))

    // Print items
    for (const item of limitedItems) {
      const time = formatTime(item.created_at)
      const statusColor = getStatusColor(item.status)
      const status = `${statusColor}${item.status}${RESET}`
      const duration = formatDuration(item.duration).padEnd(10)
      const inputSize = formatBytes(item.input_size).padEnd(8)
      const outputSize = formatBytes(item.output_size)

      this.log(`${time}  ${status}    ${duration}  ${inputSize}  ${outputSize}`)

      // Print input/output if requested
      if (flags.output && (item.input || item.output)) {
        if (item.input) {
          this.log(`  Input: ${JSON.stringify(item.input)}`)
        }

        if (item.output) {
          const outputStr = JSON.stringify(item.output)
          const truncated = outputStr.length > 200 ? outputStr.slice(0, 200) + '...' : outputStr
          this.log(`  Output: ${truncated}`)
        }

        this.log('')
      }
    }

    // Print footer
    this.log('')
    if (allItems.length > flags.limit) {
      this.log(`Showing ${limitedItems.length} of ${allItems.length} requests. Use --limit to show more.`)
    } else {
      this.log(`Showing ${limitedItems.length} request${limitedItems.length === 1 ? '' : 's'}.`)
    }
  }

  /**
   * Fetch all workspace request history (when no file specified)
   */
  private async fetchWorkspaceHistory(
    api: ReturnType<typeof createApiClientFromProfile>,
    flags: { json: boolean; last?: string; limit: number; output: boolean; slow?: string; status?: string },
    config: { branch: string; workspaceName: string }
  ): Promise<void> {
    // Parse time filter
    let timeFilter: undefined | { hours: number; ms: number; }
    if (flags.last) {
      const parsed = parseDuration(flags.last)
      if (!parsed) {
        this.error(`Invalid time format: ${flags.last}\nUse formats like: 30m, 1h, 2h, 1d, 7d`)
      }

      timeFilter = parsed

      // Warn about retention (24h for API endpoints)
      if (parsed.hours > 24) {
        this.warn('Retention for API endpoints is 1 day. Results may be incomplete.')
      }
    }

    // Parse status filter
    let statusFilter: undefined | { exact?: number; max?: number; min?: number; }
    if (flags.status) {
      const status = flags.status.toLowerCase()
      switch (status) {
      case '2xx': {
        statusFilter = { max: 299, min: 200 }
      
      break;
      }
 
      case '3xx': {
        statusFilter = { max: 399, min: 300 }
      
      break;
      }

      case '4xx': {
        statusFilter = { max: 499, min: 400 }
      
      break;
      }

      case '5xx': {
        statusFilter = { max: 599, min: 500 }
      
      break;
      }

      case 'error':
      case 'errors': {
        statusFilter = { min: 400 }
      
      break;
      }

      case 'success': {
        statusFilter = { max: 399, min: 200 }
      
      break;
      }

      default: {
        const code = Number.parseInt(status, 10)
        if (Number.isNaN(code)) {
          this.error(`Invalid status filter: ${flags.status}\nUse: 200, 4xx, 5xx, error, success`)
        }

        statusFilter = { exact: code }
      }
      }
    }

    // Parse slow filter
    let slowThreshold: number | undefined
    if (flags.slow !== undefined) {
      slowThreshold = flags.slow === '' ? 1 : Number.parseFloat(flags.slow)
      if (Number.isNaN(slowThreshold)) {
        this.error(`Invalid slow threshold: ${flags.slow}\nUse a number in seconds (e.g., --slow 2)`)
      }
    }

    // Fetch workspace history
    const response = await api!.browseRequestHistory({
      includeOutput: flags.output,
      perPage: Math.min(flags.limit * 2, 500),
    })

    if (!response.ok) {
      this.error(`Failed to fetch request history: ${response.error}`)
    }

    let items = response.data?.items || []

    // Apply client-side filters
    if (timeFilter) {
      const cutoff = Date.now() - timeFilter.ms
      items = items.filter(item => parseTimestamp(item.created_at) >= cutoff)
    }

    if (statusFilter) {
      items = items.filter(item => {
        if (statusFilter.exact !== undefined) return item.status === statusFilter.exact
        if (statusFilter.min !== undefined && item.status < statusFilter.min) return false
        if (statusFilter.max !== undefined && item.status > statusFilter.max) return false
        return true
      })
    }

    if (slowThreshold) {
      items = items.filter(item => item.duration > slowThreshold)
    }

    // Sort by timestamp descending
    items.sort((a, b) => parseTimestamp(b.created_at) - parseTimestamp(a.created_at))

    // Limit results
    const limitedItems = items.slice(0, flags.limit)

    // Output
    if (flags.json) {
      this.log(JSON.stringify(limitedItems, null, 2))
      return
    }

    if (limitedItems.length === 0) {
      this.log('No request history found.')
      return
    }

    // Print header
    this.log(`\nRequest History: ${config.workspaceName} (branch: ${config.branch})`)
    this.log('')

    // Print table header
    this.log('Time                     Status  Duration    Method  Path')
    this.log('─'.repeat(80))

    // Print items
    for (const item of limitedItems) {
      const time = formatTime(item.created_at)
      const statusColor = getStatusColor(item.status)
      const status = `${statusColor}${item.status}${RESET}`
      const duration = formatDuration(item.duration).padEnd(10)
      const method = (item.verb || '-').padEnd(6)
      const itemPath = item.uri ? new URL(item.uri).pathname : '-'

      this.log(`${time}  ${status}    ${duration}  ${method}  ${itemPath}`)

      // Print input/output if requested
      if (flags.output && (item.input || item.output)) {
        if (item.input) {
          this.log(`  Input: ${JSON.stringify(item.input)}`)
        }

        if (item.output) {
          const outputStr = JSON.stringify(item.output)
          const truncated = outputStr.length > 200 ? outputStr.slice(0, 200) + '...' : outputStr
          this.log(`  Output: ${truncated}`)
        }

        this.log('')
      }
    }

    // Print footer
    this.log('')
    if (items.length > flags.limit) {
      this.log(`Showing ${limitedItems.length} of ${items.length} requests. Use --limit to show more.`)
    } else {
      this.log(`Showing ${limitedItems.length} request${limitedItems.length === 1 ? '' : 's'}.`)
    }
  }
}
