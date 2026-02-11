/**
 * Profile and credentials management
 */

import * as yaml from 'js-yaml'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

import type { XanoCredentials, XanoProfile } from '../types.js'

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
 * Get profile by name or default
 * Priority: flagProfile (--profile/XANO_PROFILE) > projectProfile (xano.json) > credentials.default > 'default'
 */
export function getProfile(flagProfile?: string, projectProfile?: string): null | XanoProfile {
  const credentials = loadCredentials()
  if (!credentials) return null

  const name = flagProfile || projectProfile || credentials.default || 'default'
  return credentials.profiles[name] || null
}

/**
 * Check if a warning should be shown about missing profile in project config
 * Returns warning message if:
 * - Multiple profiles exist in credentials.yaml
 * - No profile specified via flag, env, or project config
 *
 * In agent mode, returns structured output for AI agents
 */
export function getProfileWarning(flagProfile?: string, projectProfile?: string, agentMode?: boolean): null | string {
  // If profile explicitly specified, no warning needed
  if (flagProfile || projectProfile) return null

  const credentials = loadCredentials()
  if (!credentials) return null

  const profileNames = Object.keys(credentials.profiles)

  // Single profile or no profiles - no ambiguity
  if (profileNames.length <= 1) return null

  const usedProfile = credentials.default || 'default'

  if (agentMode) {
    // Structured output for AI agents
    const lines = [
      'AGENT_WARNING: profile_not_configured',
      'AGENT_MESSAGE: Multiple Xano profiles found but project has no profile configured.',
      'AGENT_ACTION: Remind the user to configure a profile in xano.json for this project.',
      `AGENT_CURRENT: ${usedProfile}`,
      'AGENT_PROFILES:',
      ...profileNames.map(name => `- ${name}${name === usedProfile ? ' (currently used)' : ''}${name === credentials.default ? ' (default)' : ''}`),
      'AGENT_SUGGEST: Ask user which profile to use, then run: xano init --profile=<selected_profile>',
    ]
    return lines.join('\n')
  }

  return `Multiple profiles found but no profile specified in xano.json.\n` +
    `Using '${usedProfile}' profile. Consider adding "profile": "${usedProfile}" to xano.json.`
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
