import { expect } from 'chai'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { XanoObjectsFile } from '../../src/lib/types.js'

import { loadSearchIndex, saveSearchIndex } from '../../src/lib/objects.js'
import { buildIndex, resolveAllRefs, resolveDbRef, resolveFunctionRunRef, resolveIdentifier } from '../../src/lib/xs-resolver.js'

function createTestProject(objects: XanoObjectsFile): string {
  const dir = join(tmpdir(), `xs-resolver-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  const xanoDir = join(dir, '.xano')
  mkdirSync(xanoDir, { recursive: true })
  writeFileSync(join(xanoDir, 'objects.json'), JSON.stringify(objects, null, 2), 'utf8')
  return dir
}

function createTestProjectWithIndex(objects: XanoObjectsFile): string {
  const dir = createTestProject(objects)
  saveSearchIndex(dir, objects)
  return dir
}

function cleanupTestProject(dir: string): void {
  if (existsSync(dir)) {
    rmSync(dir, { force: true, recursive: true })
  }
}

describe('lib/xs-resolver', () => {
  let testDir: string

  afterEach(() => {
    if (testDir) {
      cleanupTestProject(testDir)
    }
  })

  describe('buildIndex', () => {
    it('builds index from objects.json', () => {
      testDir = createTestProject([
        { id: 1, path: 'functions/my_func.xs', staged: false, status: 'unchanged', type: 'function' },
        { id: 2, path: 'tables/users.xs', staged: false, status: 'unchanged', type: 'table' },
      ])

      const index = buildIndex(testDir)
      expect(index.objects).to.have.length(2)
      expect(index.byBasename.get('my_func')).to.have.length(1)
      expect(index.byBasename.get('users')).to.have.length(1)
    })

    it('returns empty index when no objects.json', () => {
      testDir = join(tmpdir(), `xs-resolver-empty-${Date.now()}`)
      mkdirSync(testDir, { recursive: true })

      const index = buildIndex(testDir)
      expect(index.objects).to.have.length(0)
      expect(index.byBasename.size).to.equal(0)
    })
  })

  describe('resolveIdentifier', () => {
    it('resolves exact path', () => {
      testDir = createTestProject([
        { id: 1, path: 'functions/my_func.xs', staged: false, status: 'unchanged', type: 'function' },
      ])

      const results = resolveIdentifier('functions/my_func.xs', testDir)
      expect(results).to.have.length(1)
      expect(results[0].filePath).to.equal('functions/my_func.xs')
      expect(results[0].matchType).to.equal('exact_path')
    })

    it('resolves by basename', () => {
      testDir = createTestProject([
        { id: 1, path: 'functions/auth/validate_token.xs', staged: false, status: 'unchanged', type: 'function' },
      ])

      const results = resolveIdentifier('validate_token', testDir)
      expect(results).to.have.length(1)
      expect(results[0].filePath).to.equal('functions/auth/validate_token.xs')
      expect(results[0].matchType).to.equal('basename')
    })

    it('resolves by sanitized name', () => {
      testDir = createTestProject([
        { id: 1, path: 'functions/validate_token.xs', staged: false, status: 'unchanged', type: 'function' },
      ])

      const results = resolveIdentifier('ValidateToken', testDir)
      expect(results).to.have.length(1)
      expect(results[0].matchType).to.equal('sanitized')
    })

    it('resolves endpoint pattern (name_VERB)', () => {
      testDir = createTestProject([
        { id: 1, path: 'apis/brands/brands_POST.xs', staged: false, status: 'unchanged', type: 'api_endpoint' },
        { id: 2, path: 'apis/brands/brands_GET.xs', staged: false, status: 'unchanged', type: 'api_endpoint' },
      ])

      const results = resolveIdentifier('brands_POST', testDir)
      expect(results).to.have.length(1)
      expect(results[0].filePath).to.equal('apis/brands/brands_POST.xs')
    })

    it('resolves function path with /', () => {
      testDir = createTestProject([
        { id: 1, path: 'functions/discord/get_message_by_id.xs', staged: false, status: 'unchanged', type: 'function' },
      ])

      const results = resolveIdentifier('Discord/GetMessageByID', testDir)
      expect(results).to.have.length(1)
      expect(results[0].filePath).to.equal('functions/discord/get_message_by_id.xs')
    })

    it('returns empty for no match', () => {
      testDir = createTestProject([
        { id: 1, path: 'functions/my_func.xs', staged: false, status: 'unchanged', type: 'function' },
      ])

      const results = resolveIdentifier('nonexistent_thing', testDir)
      expect(results).to.have.length(0)
    })

    it('returns multiple matches when ambiguous', () => {
      testDir = createTestProject([
        { id: 1, path: 'functions/utils.xs', staged: false, status: 'unchanged', type: 'function' },
        { id: 2, path: 'tables/utils.xs', staged: false, status: 'unchanged', type: 'table' },
      ])

      const results = resolveIdentifier('utils', testDir)
      expect(results).to.have.length(2)
    })
  })

  describe('resolveDbRef', () => {
    it('resolves table name to file path', () => {
      testDir = createTestProject([
        { id: 1, path: 'tables/users.xs', staged: false, status: 'unchanged', type: 'table' },
        { id: 2, path: 'tables/orders.xs', staged: false, status: 'unchanged', type: 'table' },
      ])

      const index = buildIndex(testDir)
      const result = resolveDbRef({ column: 1, line: 1, operation: 'query', table: 'users' }, index)
      expect(result).to.equal('tables/users.xs')
    })

    it('resolves sanitized table name', () => {
      testDir = createTestProject([
        { id: 1, path: 'tables/discord_messages.xs', staged: false, status: 'unchanged', type: 'table' },
      ])

      const index = buildIndex(testDir)
      const result = resolveDbRef({ column: 1, line: 1, operation: 'query', table: 'discord_messages' }, index)
      expect(result).to.equal('tables/discord_messages.xs')
    })

    it('returns null for unknown table', () => {
      testDir = createTestProject([
        { id: 1, path: 'tables/users.xs', staged: false, status: 'unchanged', type: 'table' },
      ])

      const index = buildIndex(testDir)
      const result = resolveDbRef({ column: 1, line: 1, operation: 'query', table: 'nonexistent' }, index)
      expect(result).to.be.null
    })

    it('only matches table type objects', () => {
      testDir = createTestProject([
        { id: 1, path: 'functions/users.xs', staged: false, status: 'unchanged', type: 'function' },
        { id: 2, path: 'tables/users.xs', staged: false, status: 'unchanged', type: 'table' },
      ])

      const index = buildIndex(testDir)
      const result = resolveDbRef({ column: 1, line: 1, operation: 'query', table: 'users' }, index)
      expect(result).to.equal('tables/users.xs')
    })
  })

  describe('resolveFunctionRunRef', () => {
    it('resolves function name to file path', () => {
      testDir = createTestProject([
        { id: 1, path: 'functions/discord/get_message_by_id.xs', staged: false, status: 'unchanged', type: 'function' },
      ])

      const index = buildIndex(testDir)
      const result = resolveFunctionRunRef({ column: 1, line: 1, name: 'Discord/GetMessageByID' }, index)
      expect(result).to.equal('functions/discord/get_message_by_id.xs')
    })

    it('resolves simple function name', () => {
      testDir = createTestProject([
        { id: 1, path: 'functions/validate_brand.xs', staged: false, status: 'unchanged', type: 'function' },
      ])

      const index = buildIndex(testDir)
      const result = resolveFunctionRunRef({ column: 1, line: 1, name: 'ValidateBrand' }, index)
      expect(result).to.equal('functions/validate_brand.xs')
    })

    it('returns null for unknown function', () => {
      testDir = createTestProject([
        { id: 1, path: 'functions/my_func.xs', staged: false, status: 'unchanged', type: 'function' },
      ])

      const index = buildIndex(testDir)
      const result = resolveFunctionRunRef({ column: 1, line: 1, name: 'NonExistent/Function' }, index)
      expect(result).to.be.null
    })

    it('only matches function type objects', () => {
      testDir = createTestProject([
        { id: 1, path: 'tables/validate.xs', staged: false, status: 'unchanged', type: 'table' },
        { id: 2, path: 'functions/validate.xs', staged: false, status: 'unchanged', type: 'function' },
      ])

      const index = buildIndex(testDir)
      const result = resolveFunctionRunRef({ column: 1, line: 1, name: 'validate' }, index)
      expect(result).to.equal('functions/validate.xs')
    })
  })

  describe('search index (fast path)', () => {
    it('saveSearchIndex creates search.json', () => {
      testDir = createTestProjectWithIndex([
        { id: 1, path: 'functions/my_func.xs', staged: false, status: 'unchanged', type: 'function' },
      ])

      const data = loadSearchIndex(testDir)
      expect(data).to.not.be.null
      expect(data!.version).to.equal(1)
      expect(data!.objects).to.have.length(1)
    })

    it('resolveIdentifier uses search index for exact path', () => {
      testDir = createTestProjectWithIndex([
        { id: 1, path: 'functions/my_func.xs', staged: false, status: 'unchanged', type: 'function' },
      ])

      const results = resolveIdentifier('functions/my_func.xs', testDir)
      expect(results).to.have.length(1)
      expect(results[0].matchType).to.equal('exact_path')
    })

    it('resolveIdentifier uses search index for basename', () => {
      testDir = createTestProjectWithIndex([
        { id: 1, path: 'functions/auth/validate_token.xs', staged: false, status: 'unchanged', type: 'function' },
      ])

      const results = resolveIdentifier('validate_token', testDir)
      expect(results).to.have.length(1)
      expect(results[0].matchType).to.equal('basename')
    })

    it('resolveIdentifier uses search index for sanitized match', () => {
      testDir = createTestProjectWithIndex([
        { id: 1, path: 'functions/validate_token.xs', staged: false, status: 'unchanged', type: 'function' },
      ])

      const results = resolveIdentifier('ValidateToken', testDir)
      expect(results).to.have.length(1)
      expect(results[0].matchType).to.equal('sanitized')
    })

    it('resolveIdentifier uses search index for endpoint pattern', () => {
      testDir = createTestProjectWithIndex([
        { id: 1, path: 'apis/brands/brands_POST.xs', staged: false, status: 'unchanged', type: 'api_endpoint' },
        { id: 2, path: 'apis/brands/brands_GET.xs', staged: false, status: 'unchanged', type: 'api_endpoint' },
      ])

      const results = resolveIdentifier('brands_POST', testDir)
      expect(results).to.have.length(1)
      expect(results[0].filePath).to.equal('apis/brands/brands_POST.xs')
    })

    it('resolveIdentifier uses search index for function path with /', () => {
      testDir = createTestProjectWithIndex([
        { id: 1, path: 'functions/discord/get_message_by_id.xs', staged: false, status: 'unchanged', type: 'function' },
      ])

      const results = resolveIdentifier('Discord/GetMessageByID', testDir)
      expect(results).to.have.length(1)
      expect(results[0].filePath).to.equal('functions/discord/get_message_by_id.xs')
    })

    it('resolveAllRefs uses search index for db refs', () => {
      testDir = createTestProjectWithIndex([
        { id: 1, path: 'tables/users.xs', staged: false, status: 'unchanged', type: 'table' },
        { id: 2, path: 'functions/my_func.xs', staged: false, status: 'unchanged', type: 'function' },
      ])

      const { dbPaths } = resolveAllRefs(
        [{ column: 1, line: 1, operation: 'query', table: 'users' }],
        [],
        testDir,
      )
      expect(dbPaths.get(0)).to.equal('tables/users.xs')
    })

    it('resolveAllRefs uses search index for function.run refs', () => {
      testDir = createTestProjectWithIndex([
        { id: 1, path: 'functions/discord/get_message_by_id.xs', staged: false, status: 'unchanged', type: 'function' },
      ])

      const { functionPaths } = resolveAllRefs(
        [],
        [{ column: 1, line: 1, name: 'Discord/GetMessageByID' }],
        testDir,
      )
      expect(functionPaths.get(0)).to.equal('functions/discord/get_message_by_id.xs')
    })

    it('returns empty for no match via search index', () => {
      testDir = createTestProjectWithIndex([
        { id: 1, path: 'functions/my_func.xs', staged: false, status: 'unchanged', type: 'function' },
      ])

      const results = resolveIdentifier('nonexistent_thing', testDir)
      expect(results).to.have.length(0)
    })
  })
})
