/**
 * Profile and credentials management
 */

import * as yaml from 'js-yaml'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { XanoCredentials, XanoProfile } from '../types.js'

import { loadCliConfig } from '../project.js'

const CREDENTIALS_PATH = join(homedir(), '.xano', 'credentials.yaml')

/**
 * Load credentials from ~/.xano/credentials.yaml
 */
export function loadCredentials(): null | XanoCredentials {
  if (!existsSync(CREDENTIALS_PATH)) {
    return null
  }

  try {
    const content = readFileSync(CREDENTIALS_PATH, 'utf8')
    return yaml.load(content) as XanoCredentials
  } catch {
    return null
  }
}

/**
 * Get profile by name from .xano/cli.json
 *
 * IMPORTANT: Profile MUST be set in .xano/cli.json for CLI operations.
 * This is the ONLY source of truth - no flag overrides allowed.
 */
export function getProfile(cliProfile?: string): null | XanoProfile {
  const credentials = loadCredentials()
  if (!credentials) return null

  if (!cliProfile) return null

  return credentials.profiles[cliProfile] || null
}

/**
 * Profile requirement error info
 */
export interface ProfileRequirementError {
  agentOutput: string    // Structured output for AI agents
  humanOutput: string    // Human-readable error message
  profiles: string[]     // Available profile names
}

/**
 * Check if profile is properly configured and return error info if not.
 *
 * Profile MUST be set in .xano/cli.json for CLI operations.
 * This is the ONLY source of truth - no flag overrides allowed.
 *
 * Returns null if profile is properly configured, error info otherwise.
 */
export function getMissingProfileError(cliProfile?: string): null | ProfileRequirementError {
  // If profile is set in cli.json, no error
  if (cliProfile) return null

  const credentials = loadCredentials()
  const profileNames = credentials ? Object.keys(credentials.profiles) : []

  // Build human-readable error
  let humanOutput = 'Profile not configured in .xano/cli.json\n\n'
  humanOutput += 'The CLI requires a profile to be set in .xano/cli.json to prevent\n'
  humanOutput += 'accidental operations on the wrong workspace.\n\n'

  if (profileNames.length > 0) {
    humanOutput += 'Available profiles:\n'
    for (const name of profileNames) {
      humanOutput += `  - ${name}\n`
    }

    humanOutput += '\n'
  }

  humanOutput += 'To configure a profile for this project, run:\n'
  humanOutput += '  xano init --profile=<profile_name>\n\n'
  humanOutput += 'Or create .xano/cli.json manually:\n'
  humanOutput += '  {"profile": "<profile_name>"}'

  // Build agent-mode structured output
  const agentLines = [
    'AGENT_ERROR: profile_not_configured',
    'AGENT_MESSAGE: Profile is not configured in .xano/cli.json. This is required for CLI operations.',
    'AGENT_REASON: Each project must have its profile explicitly set to prevent accidental operations on wrong workspace.',
  ]

  if (profileNames.length > 0) {
    agentLines.push('AGENT_PROFILES:')
    for (const name of profileNames) {
      agentLines.push(`- ${name}`)
    }
  }

  agentLines.push(
    'AGENT_ACTION: Ask user which profile to use for this project, then run:',
    'AGENT_COMMAND: xano init --profile=<selected_profile>',
    'AGENT_ALTERNATIVE: Or create .xano/cli.json with {"profile": "<profile_name>"}'
  )

  return {
    agentOutput: agentLines.join('\n'),
    humanOutput,
    profiles: profileNames,
  }
}

/**
 * @deprecated Use getMissingProfileError instead
 * Kept for backwards compatibility during transition
 */
export function getProfileWarning(cliProfile?: string, agentMode?: boolean): null | string {
  const error = getMissingProfileError(cliProfile)
  if (!error) return null
  return agentMode ? error.agentOutput : error.humanOutput
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
 * Get profile name from project configuration
 * Profile is ONLY read from .xano/cli.json - the single source of truth
 */
export function getCliProfile(projectRoot: string): string | undefined {
  const cliConfig = loadCliConfig(projectRoot)
  return cliConfig?.profile
}
