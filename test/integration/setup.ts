/**
 * Integration test setup
 *
 * These tests require:
 * - XANO_INTEGRATION_TEST=true (to enable)
 * - A configured profile with valid credentials
 * - XANO_TEST_WORKSPACE_ID (workspace ID to test against)
 *
 * Run with: npm run test:integration
 */

import type { XanoProfile } from '../../src/lib/types.js'

import { getProfile, listProfileNames } from '../../src/lib/api.js'

export const INTEGRATION_ENABLED = process.env.XANO_INTEGRATION_TEST === 'true'
export const TEST_WORKSPACE_ID = Number.parseInt(process.env.XANO_TEST_WORKSPACE_ID || '0', 10)
export const TEST_BRANCH = process.env.XANO_TEST_BRANCH || 'main'
export const TEST_INSTANCE = process.env.XANO_TEST_INSTANCE || ''

/**
 * Skip integration tests if not enabled
 */
export function skipIfNoIntegration(): void {
  if (!INTEGRATION_ENABLED) {
    console.log('  Skipping integration tests (set XANO_INTEGRATION_TEST=true to enable)')
  }
}

/**
 * Get test profile or throw
 */
export function getTestProfile(): XanoProfile {
  const profileName = process.env.XANO_PROFILE
  const profile = getProfile(profileName)

  if (!profile) {
    const available = listProfileNames()
    throw new Error(
      `No profile found. Available profiles: ${available.join(', ') || 'none'}. ` +
      'Run "xano profile:wizard" to create one.'
    )
  }

  return profile
}

/**
 * Validate integration test configuration
 */
export function validateConfig(): { branch: string; instance: string; profile: XanoProfile; workspaceId: number; } {
  if (!INTEGRATION_ENABLED) {
    throw new Error('Integration tests not enabled')
  }

  if (!TEST_WORKSPACE_ID) {
    throw new Error('XANO_TEST_WORKSPACE_ID environment variable required')
  }

  const profile = getTestProfile()

  // Extract instance from profile origin or use env var
  let instance = TEST_INSTANCE
  if (!instance && profile.instance_origin) {
    const match = profile.instance_origin.match(/https?:\/\/([^./]+)/)
    instance = match ? match[1] : ''
  }

  if (!instance) {
    throw new Error('XANO_TEST_INSTANCE environment variable required (or set in profile)')
  }

  return {
    branch: TEST_BRANCH,
    instance,
    profile,
    workspaceId: TEST_WORKSPACE_ID,
  }
}
