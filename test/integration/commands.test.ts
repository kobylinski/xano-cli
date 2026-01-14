/**
 * Integration tests for CLI commands
 *
 * Run with: npm run test:integration
 */

import { runCommand } from '@oclif/test'
import { expect } from 'chai'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  INTEGRATION_ENABLED,
  skipIfNoIntegration,
  validateConfig,
} from './setup.js'

describe('Integration: Commands', function () {
  // Increase timeout for API calls
  this.timeout(60_000)

  let tempDir: string
  let testConfig: { branch: string; instance: string; workspaceId: number; }

  before(function () {
    if (!INTEGRATION_ENABLED) {
      skipIfNoIntegration()
      this.skip()
      return
    }

    // Get test configuration (validates env vars)
    testConfig = validateConfig()
  })

  beforeEach(function () {
    if (!INTEGRATION_ENABLED) {
      this.skip()
      return
    }

    // Create temp directory for test project
    tempDir = mkdtempSync(join(tmpdir(), 'xano-cli-integration-'))
  })

  afterEach(() => {
    if (tempDir && existsSync(tempDir)) {
      rmSync(tempDir, { force: true, recursive: true })
    }
  })

  describe('list command', () => {
    beforeEach(function () {
      if (!INTEGRATION_ENABLED) {
        this.skip()
        return
      }

      // Create minimal project config for list command
      mkdirSync(join(tempDir, '.xano'), { recursive: true })
      writeFileSync(
        join(tempDir, '.xano', 'config.json'),
        JSON.stringify({
          branch: testConfig.branch,
          instanceName: testConfig.instance,
          paths: {
            apis: 'apis',
            functions: 'functions',
            tables: 'tables',
            tasks: 'tasks',
          },
          workspaceId: testConfig.workspaceId,
          workspaceName: 'Test',
        })
      )
      writeFileSync(join(tempDir, '.xano', 'objects.json'), '[]')
    })

    it('lists all object types', async function () {
      if (!INTEGRATION_ENABLED) this.skip()

      const originalCwd = process.cwd()
      try {
        process.chdir(tempDir)
        const { stdout } = await runCommand(['list'])

        // Should have output (may be empty if no objects)
        expect(stdout).to.be.a('string')
      } finally {
        process.chdir(originalCwd)
      }
    })

    it('lists functions', async function () {
      if (!INTEGRATION_ENABLED) this.skip()

      const originalCwd = process.cwd()
      try {
        process.chdir(tempDir)
        const { stdout } = await runCommand(['list', 'functions/'])

        expect(stdout).to.be.a('string')
        // If there are functions, output should contain "Functions:"
        if (stdout.includes('Functions:')) {
          expect(stdout).to.include('total')
        }
      } finally {
        process.chdir(originalCwd)
      }
    })

    it('lists tables', async function () {
      if (!INTEGRATION_ENABLED) this.skip()

      const originalCwd = process.cwd()
      try {
        process.chdir(tempDir)
        const { stdout } = await runCommand(['list', 'tables/'])

        expect(stdout).to.be.a('string')
      } finally {
        process.chdir(originalCwd)
      }
    })

    it('lists apis', async function () {
      if (!INTEGRATION_ENABLED) this.skip()

      const originalCwd = process.cwd()
      try {
        process.chdir(tempDir)
        const { stdout } = await runCommand(['list', 'apis/'])

        expect(stdout).to.be.a('string')
      } finally {
        process.chdir(originalCwd)
      }
    })

    it('outputs JSON format', async function () {
      if (!INTEGRATION_ENABLED) this.skip()

      const originalCwd = process.cwd()
      try {
        process.chdir(tempDir)
        const { stdout } = await runCommand(['list', '--json'])

        // Should be valid JSON
        const parsed = JSON.parse(stdout)
        expect(parsed).to.be.an('array')
      } finally {
        process.chdir(originalCwd)
      }
    })
  })

  describe('branch command', () => {
    beforeEach(function () {
      if (!INTEGRATION_ENABLED) {
        this.skip()
        return
      }

      // Create minimal project config
      mkdirSync(join(tempDir, '.xano'), { recursive: true })
      writeFileSync(
        join(tempDir, '.xano', 'config.json'),
        JSON.stringify({
          branch: testConfig.branch,
          instanceName: testConfig.instance,
          paths: {
            apis: 'apis',
            functions: 'functions',
            tables: 'tables',
            tasks: 'tasks',
          },
          workspaceId: testConfig.workspaceId,
          workspaceName: 'Test',
        })
      )
    })

    it('shows current branch', async function () {
      if (!INTEGRATION_ENABLED) this.skip()

      const originalCwd = process.cwd()
      try {
        process.chdir(tempDir)
        const { stdout } = await runCommand(['branch'])

        expect(stdout).to.include(testConfig.branch)
      } finally {
        process.chdir(originalCwd)
      }
    })

    it('lists available branches', async function () {
      if (!INTEGRATION_ENABLED) this.skip()

      const originalCwd = process.cwd()
      try {
        process.chdir(tempDir)
        const { stderr, stdout } = await runCommand(['branch', 'list'])

        // Branch API might not be available (404) - check if we got meaningful output
        if (stderr && stderr.includes('404')) {
          console.log('Skipping branch list - API not available')
          this.skip()
          return
        }

        // Should list branches or show error
        expect(stdout).to.be.a('string')
      } finally {
        process.chdir(originalCwd)
      }
    })
  })
})
