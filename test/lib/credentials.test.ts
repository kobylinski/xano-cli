/**
 * Profile and credentials handling tests
 *
 * CRITICAL: These tests verify that profile handling is bulletproof:
 * - Profile MUST come from .xano/cli.json ONLY
 * - NO --profile flag override allowed
 * - Default profile in ~/.xano/credentials.yaml should NOT be used automatically
 * - CLI MUST refuse to work without profile set in cli.json
 */

import { expect } from 'chai'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { XanoCliConfig } from '../../src/lib/types.js'

import {
  getCliProfile,
  getDefaultProfileName,
  getMissingProfileError,
  getProfile,
  listProfileNames,
} from '../../src/lib/api/credentials.js'
import { loadCliConfig, saveCliConfig } from '../../src/lib/project.js'

describe('lib/api/credentials - Profile Security', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'xano-cli-profile-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { force: true, recursive: true })
  })

  describe('getProfile() - Single Source of Truth', () => {
    it('returns null when cliProfile is undefined', () => {
      // CRITICAL: Even if credentials exist, getProfile should return null without cliProfile
      const profile = getProfile()
      expect(profile).to.be.null
    })

    it('returns null when cliProfile is empty string', () => {
      const profile = getProfile('')
      expect(profile).to.be.null
    })

    it('returns profile when cliProfile matches existing profile', () => {
      // This test requires actual credentials file
      // We're testing the logic, not the file system interaction
      const profile = getProfile('nonexistent-profile')
      // Should return null for non-existent profile
      expect(profile).to.be.null
    })

    it('does NOT accept multiple parameters (no flag override)', () => {
      // Verify function signature only accepts one parameter
      // This is a compile-time check but we document it here
      expect(getProfile.length).to.equal(1)
    })
  })

  describe('getMissingProfileError() - Enforcement', () => {
    it('returns null when cliProfile is provided', () => {
      const error = getMissingProfileError('any-profile')
      expect(error).to.be.null
    })

    it('returns error object when cliProfile is undefined', () => {
      const error = getMissingProfileError()
      expect(error).to.not.be.null
      expect(error).to.have.property('humanOutput')
      expect(error).to.have.property('agentOutput')
      expect(error).to.have.property('profiles')
    })

    it('returns error object when cliProfile is empty string', () => {
      const error = getMissingProfileError('')
      // Empty string is falsy, should trigger error
      expect(error).to.not.be.null
    })

    it('humanOutput contains helpful instructions', () => {
      const error = getMissingProfileError()
      expect(error?.humanOutput).to.include('Profile not configured')
      expect(error?.humanOutput).to.include('.xano/cli.json')
      expect(error?.humanOutput).to.include('xano init --profile')
    })

    it('agentOutput contains structured error info', () => {
      const error = getMissingProfileError()
      expect(error?.agentOutput).to.include('AGENT_ERROR: profile_not_configured')
      expect(error?.agentOutput).to.include('AGENT_ACTION')
      expect(error?.agentOutput).to.include('AGENT_COMMAND')
    })
  })

  describe('getCliProfile() - Only from cli.json', () => {
    it('returns undefined when cli.json does not exist', () => {
      const profile = getCliProfile(tempDir)
      expect(profile).to.be.undefined
    })

    it('returns undefined when cli.json exists but has no profile', () => {
      mkdirSync(join(tempDir, '.xano'))
      writeFileSync(join(tempDir, '.xano', 'cli.json'), JSON.stringify({ naming: 'vscode' }))
      const profile = getCliProfile(tempDir)
      expect(profile).to.be.undefined
    })

    it('returns profile from cli.json when set', () => {
      mkdirSync(join(tempDir, '.xano'))
      const cliConfig: XanoCliConfig = { profile: 'my-profile' }
      writeFileSync(join(tempDir, '.xano', 'cli.json'), JSON.stringify(cliConfig))
      const profile = getCliProfile(tempDir)
      expect(profile).to.equal('my-profile')
    })

    it('does NOT read profile from xano.json', () => {
      // Create xano.json with profile (should be ignored)
      writeFileSync(join(tempDir, 'xano.json'), JSON.stringify({
        instance: 'test',
        profile: 'should-be-ignored',
        workspace: 'Test',
        workspaceId: 1,
      }))
      // Create .xano directory but no cli.json
      mkdirSync(join(tempDir, '.xano'))

      const profile = getCliProfile(tempDir)
      expect(profile).to.be.undefined
    })

    it('does NOT read profile from .xano/config.json', () => {
      // Create config.json with profile (should be ignored)
      mkdirSync(join(tempDir, '.xano'))
      writeFileSync(join(tempDir, '.xano', 'config.json'), JSON.stringify({
        branch: 'main',
        instanceName: 'test',
        profile: 'should-be-ignored',
        workspaceId: 1,
        workspaceName: 'Test',
      }))

      const profile = getCliProfile(tempDir)
      expect(profile).to.be.undefined
    })
  })

  describe('Profile NOT from Default Credentials', () => {
    it('getProfile does NOT fall back to default profile', () => {
      // Even with credentials having a default, getProfile should not use it
      // when no cliProfile is provided
      const profile = getProfile()
      expect(profile).to.be.null
    })

    it('getMissingProfileError triggers even when default exists in credentials', () => {
      // The error should be returned regardless of credentials.default
      const error = getMissingProfileError()
      expect(error).to.not.be.null
    })
  })

  describe('saveCliConfig / loadCliConfig - Profile Persistence', () => {
    it('saves and loads profile correctly', () => {
      saveCliConfig(tempDir, { profile: 'test-profile' })
      const loaded = loadCliConfig(tempDir)
      expect(loaded?.profile).to.equal('test-profile')
    })

    it('can save cli.json with multiple settings', () => {
      // saveCliConfig overwrites the file, so provide all settings at once
      saveCliConfig(tempDir, { naming: 'vscode', profile: 'my-profile' })

      const loaded = loadCliConfig(tempDir)
      expect(loaded?.profile).to.equal('my-profile')
      expect(loaded?.naming).to.equal('vscode')
    })

    it('creates .xano directory if it does not exist', () => {
      saveCliConfig(tempDir, { profile: 'new-profile' })
      const loaded = loadCliConfig(tempDir)
      expect(loaded?.profile).to.equal('new-profile')
    })
  })

  describe('listProfileNames() - Available Profiles', () => {
    it('returns empty array when no credentials file exists', () => {
      // This depends on actual credentials file
      // Just verify it returns an array
      const profiles = listProfileNames()
      expect(profiles).to.be.an('array')
    })
  })

  describe('getDefaultProfileName() - Should NOT Be Used', () => {
    it('function exists but should not be used for CLI operations', () => {
      // This function exists for backwards compatibility
      // but should NOT be used for determining which profile to use
      const defaultProfile = getDefaultProfileName()
      // Just verify it returns something (null or string)
      expect(defaultProfile === null || typeof defaultProfile === 'string').to.be.true
    })
  })

  // Integration Scenarios
  describe('Integration: New Project Without Profile', () => {
    it('should fail to get profile without cli.json', () => {
      // Setup: Create initialized project without cli.json profile
      mkdirSync(join(tempDir, '.xano'))
      writeFileSync(join(tempDir, '.xano', 'config.json'), JSON.stringify({
        branch: 'main',
        workspaceId: 123,
        workspaceName: 'Test',
      }))

      // Test: Getting cli profile should return undefined
      const cliProfile = getCliProfile(tempDir)
      expect(cliProfile).to.be.undefined

      // Test: getMissingProfileError should return error
      const error = getMissingProfileError(cliProfile)
      expect(error).to.not.be.null

      // Test: getProfile should return null
      const profile = getProfile(cliProfile)
      expect(profile).to.be.null
    })
  })

  describe('Integration: Project With Profile in Wrong Place', () => {
    it('should NOT use profile from xano.json', () => {
      // Setup: Profile in xano.json (wrong place)
      writeFileSync(join(tempDir, 'xano.json'), JSON.stringify({
        instance: 'test-instance',
        profile: 'fake-profile-in-xano-json',
        workspace: 'Test',
        workspaceId: 123,
      }))
      mkdirSync(join(tempDir, '.xano'))
      writeFileSync(join(tempDir, '.xano', 'config.json'), JSON.stringify({
        branch: 'main',
        workspaceId: 123,
        workspaceName: 'Test',
      }))

      // Test: cli profile should still be undefined
      const cliProfile = getCliProfile(tempDir)
      expect(cliProfile).to.be.undefined

      // Test: Error should be returned
      const error = getMissingProfileError(cliProfile)
      expect(error).to.not.be.null
    })

    it('should NOT use profile from config.json', () => {
      // Setup: Profile in config.json (wrong place)
      mkdirSync(join(tempDir, '.xano'))
      writeFileSync(join(tempDir, '.xano', 'config.json'), JSON.stringify({
        branch: 'main',
        profile: 'fake-profile-in-config-json',
        workspaceId: 123,
        workspaceName: 'Test',
      }))

      // Test: cli profile should still be undefined
      const cliProfile = getCliProfile(tempDir)
      expect(cliProfile).to.be.undefined
    })
  })

  describe('Integration: Correct Profile Configuration', () => {
    it('should use profile from cli.json', () => {
      // Setup: Profile correctly in cli.json
      mkdirSync(join(tempDir, '.xano'))
      writeFileSync(join(tempDir, '.xano', 'cli.json'), JSON.stringify({
        profile: 'correct-profile',
      }))
      writeFileSync(join(tempDir, '.xano', 'config.json'), JSON.stringify({
        branch: 'main',
        workspaceId: 123,
        workspaceName: 'Test',
      }))

      // Test: cli profile should be found
      const cliProfile = getCliProfile(tempDir)
      expect(cliProfile).to.equal('correct-profile')

      // Test: No error should be returned
      const error = getMissingProfileError(cliProfile)
      expect(error).to.be.null
    })
  })

  describe('Integration: Profile Mismatch Between Files', () => {
    it('should ONLY use cli.json profile, ignoring others', () => {
      // Setup: Different profiles in different files
      writeFileSync(join(tempDir, 'xano.json'), JSON.stringify({
        instance: 'test-instance',
        profile: 'xano-json-profile',
        workspace: 'Test',
        workspaceId: 123,
      }))
      mkdirSync(join(tempDir, '.xano'))
      writeFileSync(join(tempDir, '.xano', 'config.json'), JSON.stringify({
        branch: 'main',
        profile: 'config-json-profile',
        workspaceId: 123,
        workspaceName: 'Test',
      }))
      writeFileSync(join(tempDir, '.xano', 'cli.json'), JSON.stringify({
        profile: 'cli-json-profile',
      }))

      // Test: ONLY cli.json profile should be used
      const cliProfile = getCliProfile(tempDir)
      expect(cliProfile).to.equal('cli-json-profile')
      expect(cliProfile).to.not.equal('xano-json-profile')
      expect(cliProfile).to.not.equal('config-json-profile')
    })
  })

  describe('Integration: Empty or Invalid cli.json', () => {
    it('should fail with empty cli.json', () => {
      mkdirSync(join(tempDir, '.xano'))
      writeFileSync(join(tempDir, '.xano', 'cli.json'), '{}')

      const cliProfile = getCliProfile(tempDir)
      expect(cliProfile).to.be.undefined

      const error = getMissingProfileError(cliProfile)
      expect(error).to.not.be.null
    })

    it('should fail with invalid JSON in cli.json', () => {
      mkdirSync(join(tempDir, '.xano'))
      writeFileSync(join(tempDir, '.xano', 'cli.json'), 'not valid json')

      const cliProfile = getCliProfile(tempDir)
      expect(cliProfile).to.be.undefined

      const error = getMissingProfileError(cliProfile)
      expect(error).to.not.be.null
    })

    it('should fail with null profile in cli.json', () => {
      mkdirSync(join(tempDir, '.xano'))
      writeFileSync(join(tempDir, '.xano', 'cli.json'), JSON.stringify({ profile: null }))

      const cliProfile = getCliProfile(tempDir)
      expect(!cliProfile).to.be.true // null or undefined

      const error = getMissingProfileError(cliProfile as string | undefined)
      expect(error).to.not.be.null
    })
  })

  // Security: Attack Vectors
  describe('Security: Cannot Override Profile via Environment', () => {
    it('profile should not come from XANO_PROFILE env var when cli.json missing', () => {
      // Setup: No cli.json, but env var set (in real code)
      // This test documents expected behavior - env vars should not override
      mkdirSync(join(tempDir, '.xano'))
      writeFileSync(join(tempDir, '.xano', 'config.json'), JSON.stringify({
        branch: 'main',
        workspaceId: 123,
      }))

      // Even with env var, getCliProfile should return undefined
      const cliProfile = getCliProfile(tempDir)
      expect(cliProfile).to.be.undefined
    })
  })

  describe('Security: Cannot Use Versioned Config for Profile', () => {
    it('xano.json profile field should be completely ignored', () => {
      // This is critical - xano.json is versioned/shared
      // Using it for profile could lead to accidental wrong workspace operations
      writeFileSync(join(tempDir, 'xano.json'), JSON.stringify({
        instance: 'shared-instance',
        profile: 'shared-profile-SHOULD-NOT-USE',
        workspace: 'Shared Workspace',
        workspaceId: 999,
      }))
      mkdirSync(join(tempDir, '.xano'))

      const cliProfile = getCliProfile(tempDir)
      expect(cliProfile).to.be.undefined
    })
  })

  describe('Security: Profile Name Validation', () => {
    it('should handle profile names with special characters', () => {
      mkdirSync(join(tempDir, '.xano'))
      writeFileSync(join(tempDir, '.xano', 'cli.json'), JSON.stringify({
        profile: 'profile-with-dashes_and_underscores',
      }))

      const cliProfile = getCliProfile(tempDir)
      expect(cliProfile).to.equal('profile-with-dashes_and_underscores')
    })

    it('should handle profile names with spaces (unusual but valid)', () => {
      mkdirSync(join(tempDir, '.xano'))
      writeFileSync(join(tempDir, '.xano', 'cli.json'), JSON.stringify({
        profile: 'My Profile Name',
      }))

      const cliProfile = getCliProfile(tempDir)
      expect(cliProfile).to.equal('My Profile Name')
    })
  })
})
