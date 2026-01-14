import { Args, Command, Flags } from '@oclif/core'

import type { RequestHistoryItem } from '../../lib/types.js'

import { createApiClientFromProfile, getDefaultProfileName } from '../../lib/api.js'
import { findProjectRoot, loadLocalConfig } from '../../lib/project.js'

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
 * Parse timestamp from API (can be number ms or string)
 */
function parseTimestamp(timestamp: number | string): number {
  if (typeof timestamp === 'number') {
    return timestamp
  }
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
  if (status >= 200 && status < 300) return '\x1b[32m' // Green
  if (status >= 300 && status < 400) return '\x1b[33m' // Yellow
  if (status >= 400 && status < 500) return '\x1b[31m' // Red
  if (status >= 500) return '\x1b[91m' // Bright red
  return '\x1b[0m'
}

const RESET = '\x1b[0m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'

export default class HistoryGet extends Command {
  static args = {
    id: Args.string({
      description: 'Request ID to fetch',
      required: true,
    }),
  }

  static description = 'Get details of a specific request from history'

  static examples = [
    '<%= config.bin %> history:get 2777374',
    '<%= config.bin %> history:get 2777374 --json',
  ]

  static flags = {
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    profile: Flags.string({
      char: 'p',
      description: 'Profile to use',
      env: 'XANO_PROFILE',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(HistoryGet)

    const requestId = parseInt(args.id, 10)
    if (isNaN(requestId)) {
      this.error(`Invalid request ID: ${args.id}`)
    }

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

    // Fetch history with output included
    const response = await api.browseRequestHistory({
      includeOutput: true,
      perPage: 500,
    })

    if (!response.ok) {
      this.error(`Failed to fetch request history: ${response.error}`)
    }

    // Find the specific request
    const items = response.data?.items || []
    const item = items.find((i: RequestHistoryItem) => i.id === requestId || String(i.id) === args.id)

    if (!item) {
      this.error(
        `Request ID ${args.id} not found.\n` +
        `Note: Request history retention is 24 hours for API endpoints.\n` +
        `The request may have expired or the ID may be incorrect.`
      )
    }

    // Output
    if (flags.json) {
      this.log(JSON.stringify(item, null, 2))
      return
    }

    // Pretty print the request details
    this.log('')
    this.log(`${BOLD}Request Details: ${item.id}${RESET}`)
    this.log('')

    // Basic info
    const statusColor = getStatusColor(item.status)
    this.log(`${DIM}Time:${RESET}      ${formatTime(item.created_at)}`)
    this.log(`${DIM}Status:${RESET}    ${statusColor}${item.status}${RESET}`)
    this.log(`${DIM}Duration:${RESET}  ${formatDuration(item.duration)}`)
    this.log(`${DIM}Method:${RESET}    ${item.verb || '-'}`)
    this.log(`${DIM}URI:${RESET}       ${item.uri || '-'}`)

    if (item.branch) {
      this.log(`${DIM}Branch:${RESET}    ${item.branch}`)
    }

    // Input
    if (item.input) {
      this.log('')
      this.log(`${BOLD}Input:${RESET}`)
      this.log(JSON.stringify(item.input, null, 2))
    }

    // Output
    if (item.output) {
      this.log('')
      this.log(`${BOLD}Output:${RESET}`)
      const outputStr = JSON.stringify(item.output, null, 2)
      // Truncate if too long
      if (outputStr.length > 2000) {
        this.log(outputStr.substring(0, 2000) + '\n... (truncated, use --json for full output)')
      } else {
        this.log(outputStr)
      }
    }

    // Request headers
    if (item.request_headers && item.request_headers.length > 0) {
      this.log('')
      this.log(`${BOLD}Request Headers:${RESET}`)
      for (const header of item.request_headers) {
        this.log(`  ${header}`)
      }
    }

    // Response headers
    if (item.response_headers && item.response_headers.length > 0) {
      this.log('')
      this.log(`${BOLD}Response Headers:${RESET}`)
      for (const header of item.response_headers) {
        this.log(`  ${header}`)
      }
    }

    this.log('')
  }
}
