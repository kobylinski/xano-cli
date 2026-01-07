import { expect } from 'chai'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import type { XanoLocalConfig, XanoProjectConfig } from '../../src/lib/types.js'

import {
  createLocalConfig,
  ensureXanoDir,
  findProjectRoot,
  getConfigJsonPath,
  getCurrentBranch,
  getDefaultPaths,
  getXanoDirPath,
  getXanoJsonPath,
  isInitialized,
  isXanoProject,
  loadLocalConfig,
  loadXanoJson,
  saveLocalConfig,
  saveXanoJson,
  setCurrentBranch,
} from '../../src/lib/project.js'

describe('lib/project', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xano-cli-test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { force: true, recursive: true })
  })

  describe('findProjectRoot', () => {
    it('returns null when no project files exist', () => {
      const result = findProjectRoot(tempDir)
      expect(result).to.be.null
    })

    it('finds project root by xano.json', () => {
      fs.writeFileSync(path.join(tempDir, 'xano.json'), '{}')
      const result = findProjectRoot(tempDir)
      expect(result).to.equal(tempDir)
    })

    it('finds project root by .xano/config.json', () => {
      fs.mkdirSync(path.join(tempDir, '.xano'))
      fs.writeFileSync(path.join(tempDir, '.xano', 'config.json'), '{}')
      const result = findProjectRoot(tempDir)
      expect(result).to.equal(tempDir)
    })

    it('prefers .xano/config.json over xano.json', () => {
      fs.writeFileSync(path.join(tempDir, 'xano.json'), '{}')
      fs.mkdirSync(path.join(tempDir, '.xano'))
      fs.writeFileSync(path.join(tempDir, '.xano', 'config.json'), '{}')
      const result = findProjectRoot(tempDir)
      expect(result).to.equal(tempDir)
    })

    it('finds project root from nested directory', () => {
      fs.mkdirSync(path.join(tempDir, '.xano'))
      fs.writeFileSync(path.join(tempDir, '.xano', 'config.json'), '{}')
      const nestedDir = path.join(tempDir, 'src', 'functions')
      fs.mkdirSync(nestedDir, { recursive: true })
      const result = findProjectRoot(nestedDir)
      expect(result).to.equal(tempDir)
    })
  })

  describe('isXanoProject', () => {
    it('returns false when not a xano project', () => {
      expect(isXanoProject(tempDir)).to.be.false
    })

    it('returns true when xano.json exists', () => {
      fs.writeFileSync(path.join(tempDir, 'xano.json'), '{}')
      expect(isXanoProject(tempDir)).to.be.true
    })

    it('returns true when .xano/config.json exists', () => {
      fs.mkdirSync(path.join(tempDir, '.xano'))
      fs.writeFileSync(path.join(tempDir, '.xano', 'config.json'), '{}')
      expect(isXanoProject(tempDir)).to.be.true
    })
  })

  describe('path helpers', () => {
    it('getXanoJsonPath returns correct path', () => {
      expect(getXanoJsonPath(tempDir)).to.equal(path.join(tempDir, 'xano.json'))
    })

    it('getXanoDirPath returns correct path', () => {
      expect(getXanoDirPath(tempDir)).to.equal(path.join(tempDir, '.xano'))
    })

    it('getConfigJsonPath returns correct path', () => {
      expect(getConfigJsonPath(tempDir)).to.equal(path.join(tempDir, '.xano', 'config.json'))
    })
  })

  describe('loadXanoJson / saveXanoJson', () => {
    const sampleConfig: XanoProjectConfig = {
      instance: 'a1b2-c3d4-e5f6',
      paths: {
        apis: 'apis',
        functions: 'functions',
        tables: 'tables',
        tasks: 'tasks',
        workflow_tests: 'workflow_tests',
      },
      workspace: 'Test Workspace',
      workspaceId: 123,
    }

    it('returns null when file does not exist', () => {
      expect(loadXanoJson(tempDir)).to.be.null
    })

    it('saves and loads xano.json correctly', () => {
      saveXanoJson(tempDir, sampleConfig)
      const loaded = loadXanoJson(tempDir)
      expect(loaded).to.deep.equal(sampleConfig)
    })

    it('returns null for invalid JSON', () => {
      fs.writeFileSync(path.join(tempDir, 'xano.json'), 'not valid json')
      expect(loadXanoJson(tempDir)).to.be.null
    })
  })

  describe('loadLocalConfig / saveLocalConfig', () => {
    const sampleLocalConfig: XanoLocalConfig = {
      branch: 'main',
      instanceName: 'a1b2-c3d4-e5f6',
      paths: {
        apis: 'apis',
        functions: 'functions',
        tables: 'tables',
        tasks: 'tasks',
        workflow_tests: 'workflow_tests',
      },
      workspaceId: 123,
      workspaceName: 'Test Workspace',
    }

    it('returns null when file does not exist', () => {
      expect(loadLocalConfig(tempDir)).to.be.null
    })

    it('saves and loads local config correctly', () => {
      saveLocalConfig(tempDir, sampleLocalConfig)
      const loaded = loadLocalConfig(tempDir)
      expect(loaded).to.deep.equal(sampleLocalConfig)
    })

    it('creates .xano directory when saving', () => {
      saveLocalConfig(tempDir, sampleLocalConfig)
      expect(fs.existsSync(path.join(tempDir, '.xano'))).to.be.true
    })
  })

  describe('createLocalConfig', () => {
    it('creates local config from project config and branch', () => {
      const projectConfig: XanoProjectConfig = {
        instance: 'a1b2-c3d4-e5f6',
        paths: {
          apis: 'apis',
          functions: 'functions',
          tables: 'tables',
          tasks: 'tasks',
          workflow_tests: 'workflow_tests',
        },
        workspace: 'Test Workspace',
        workspaceId: 123,
      }

      const localConfig = createLocalConfig(projectConfig, 'dev')

      expect(localConfig.instanceName).to.equal('a1b2-c3d4-e5f6')
      expect(localConfig.workspaceName).to.equal('Test Workspace')
      expect(localConfig.workspaceId).to.equal(123)
      expect(localConfig.branch).to.equal('dev')
      expect(localConfig.paths).to.deep.equal(projectConfig.paths)
    })
  })

  describe('ensureXanoDir', () => {
    it('creates .xano directory if it does not exist', () => {
      ensureXanoDir(tempDir)
      expect(fs.existsSync(path.join(tempDir, '.xano'))).to.be.true
    })

    it('does not fail if directory already exists', () => {
      fs.mkdirSync(path.join(tempDir, '.xano'))
      expect(() => ensureXanoDir(tempDir)).not.to.throw()
    })
  })

  describe('isInitialized', () => {
    it('returns false when .xano/config.json does not exist', () => {
      expect(isInitialized(tempDir)).to.be.false
    })

    it('returns true when .xano/config.json exists', () => {
      fs.mkdirSync(path.join(tempDir, '.xano'))
      fs.writeFileSync(path.join(tempDir, '.xano', 'config.json'), '{}')
      expect(isInitialized(tempDir)).to.be.true
    })
  })

  describe('getCurrentBranch / setCurrentBranch', () => {
    const sampleLocalConfig: XanoLocalConfig = {
      branch: 'main',
      instanceName: 'a1b2-c3d4-e5f6',
      paths: {
        apis: 'apis',
        functions: 'functions',
        tables: 'tables',
        tasks: 'tasks',
        workflow_tests: 'workflow_tests',
      },
      workspaceId: 123,
      workspaceName: 'Test Workspace',
    }

    it('returns null when config does not exist', () => {
      expect(getCurrentBranch(tempDir)).to.be.null
    })

    it('returns current branch from config', () => {
      saveLocalConfig(tempDir, sampleLocalConfig)
      expect(getCurrentBranch(tempDir)).to.equal('main')
    })

    it('sets and gets branch correctly', () => {
      saveLocalConfig(tempDir, sampleLocalConfig)
      setCurrentBranch(tempDir, 'dev')
      expect(getCurrentBranch(tempDir)).to.equal('dev')
    })
  })

  describe('getDefaultPaths', () => {
    it('returns default path configuration', () => {
      const paths = getDefaultPaths()
      expect(paths).to.deep.equal({
        apis: 'apis',
        functions: 'functions',
        tables: 'tables',
        tasks: 'tasks',
        triggers: 'tables',
        workflow_tests: 'workflow_tests',
      })
    })
  })
})
