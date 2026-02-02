import { expect } from 'chai'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { XanoObjectsFile } from '../../src/lib/types.js'

import {
  computeFileSha256,
  computeSha256,
  decodeBase64,
  encodeBase64,
  type EndpointsFile,
  findMatchingEndpoint,
  findObjectById,
  findObjectByPath,
  findObjectsByType,
  getAllObjectPaths,
  getEndpointsJsonPath,
  getObjectsJsonPath,
  loadEndpoints,
  loadObjects,
  markObjectSynced,
  removeObjectById,
  removeObjectByPath,
  saveEndpoints,
  saveObjects,
  updateObjectStatus,
  upsertObject,
} from '../../src/lib/objects.js'

describe('lib/objects', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'xano-cli-test-'))
  })

  afterEach(() => {
    rmSync(tempDir, { force: true, recursive: true })
  })

  describe('getObjectsJsonPath', () => {
    it('returns correct path', () => {
      expect(getObjectsJsonPath(tempDir)).to.equal(join(tempDir, '.xano', 'objects.json'))
    })
  })

  describe('loadObjects / saveObjects', () => {
    const sampleObjects: XanoObjectsFile = [
      {
        id: 1,
        original: 'base64content',
        path: 'functions/1_test_func.xs',
        sha256: 'abc123',
        staged: false,
        status: 'unchanged',
        type: 'function',
      },
    ]

    it('returns empty array when file does not exist', () => {
      expect(loadObjects(tempDir)).to.deep.equal([])
    })

    it('saves and loads objects correctly', () => {
      saveObjects(tempDir, sampleObjects)
      const loaded = loadObjects(tempDir)
      expect(loaded).to.deep.equal(sampleObjects)
    })

    it('creates .xano directory when saving', () => {
      saveObjects(tempDir, sampleObjects)
      expect(existsSync(join(tempDir, '.xano'))).to.be.true
    })

    it('returns empty array for invalid JSON', () => {
      mkdirSync(join(tempDir, '.xano'))
      writeFileSync(join(tempDir, '.xano', 'objects.json'), 'invalid json')
      expect(loadObjects(tempDir)).to.deep.equal([])
    })
  })

  describe('findObjectByPath', () => {
    const objects: XanoObjectsFile = [
      { id: 1, original: '', path: 'functions/1_func.xs', sha256: '', staged: false, status: 'unchanged', type: 'function' },
      { id: 2, original: '', path: 'tables/2_table.xs', sha256: '', staged: false, status: 'unchanged', type: 'table' },
    ]

    it('finds object by path', () => {
      const result = findObjectByPath(objects, 'functions/1_func.xs')
      expect(result?.id).to.equal(1)
    })

    it('returns undefined when path not found', () => {
      const result = findObjectByPath(objects, 'nonexistent.xs')
      expect(result).to.be.undefined
    })
  })

  describe('findObjectById', () => {
    const objects: XanoObjectsFile = [
      { id: 1, original: '', path: 'functions/1_func.xs', sha256: '', staged: false, status: 'unchanged', type: 'function' },
      { id: 2, original: '', path: 'tables/2_table.xs', sha256: '', staged: false, status: 'unchanged', type: 'table' },
    ]

    it('finds object by id', () => {
      const result = findObjectById(objects, 2)
      expect(result?.path).to.equal('tables/2_table.xs')
    })

    it('returns undefined when id not found', () => {
      const result = findObjectById(objects, 999)
      expect(result).to.be.undefined
    })
  })

  describe('findObjectsByType', () => {
    const objects: XanoObjectsFile = [
      { id: 1, original: '', path: 'functions/1_func.xs', sha256: '', staged: false, status: 'unchanged', type: 'function' },
      { id: 2, original: '', path: 'functions/2_func.xs', sha256: '', staged: false, status: 'unchanged', type: 'function' },
      { id: 3, original: '', path: 'tables/3_table.xs', sha256: '', staged: false, status: 'unchanged', type: 'table' },
    ]

    it('filters objects by type', () => {
      const functions = findObjectsByType(objects, 'function')
      expect(functions).to.have.length(2)
      expect(functions[0].id).to.equal(1)
      expect(functions[1].id).to.equal(2)
    })

    it('returns empty array when no matches', () => {
      const tasks = findObjectsByType(objects, 'task')
      expect(tasks).to.have.length(0)
    })
  })

  describe('computeSha256', () => {
    it('computes consistent hash', () => {
      const hash1 = computeSha256('hello world')
      const hash2 = computeSha256('hello world')
      expect(hash1).to.equal(hash2)
    })

    it('produces different hashes for different content', () => {
      const hash1 = computeSha256('hello')
      const hash2 = computeSha256('world')
      expect(hash1).to.not.equal(hash2)
    })

    it('produces 64-character hex string', () => {
      const hash = computeSha256('test')
      expect(hash).to.have.length(64)
      expect(hash).to.match(/^[a-f0-9]+$/)
    })
  })

  describe('computeFileSha256', () => {
    it('returns null for nonexistent file', () => {
      expect(computeFileSha256(join(tempDir, 'nonexistent.txt'))).to.be.null
    })

    it('computes hash of file content', () => {
      const filePath = join(tempDir, 'test.txt')
      writeFileSync(filePath, 'test content')
      const hash = computeFileSha256(filePath)
      expect(hash).to.equal(computeSha256('test content'))
    })
  })

  describe('encodeBase64 / decodeBase64', () => {
    it('encodes and decodes correctly', () => {
      const original = 'function test { return 1 }'
      const encoded = encodeBase64(original)
      const decoded = decodeBase64(encoded)
      expect(decoded).to.equal(original)
    })

    it('handles unicode characters', () => {
      const original = 'hello \u4E16\u754C'
      const encoded = encodeBase64(original)
      const decoded = decodeBase64(encoded)
      expect(decoded).to.equal(original)
    })
  })

  describe('upsertObject', () => {
    it('adds new object', () => {
      const objects: XanoObjectsFile = []
      const filePath = join(tempDir, 'test.xs')
      writeFileSync(filePath, 'function test {}')

      const result = upsertObject(objects, filePath, { id: 1, type: 'function' })
      expect(result).to.have.length(1)
      expect(result[0].id).to.equal(1)
      expect(result[0].type).to.equal('function')
      expect(result[0].path).to.equal(filePath)
    })

    it('updates existing object', () => {
      const filePath = join(tempDir, 'test.xs')
      writeFileSync(filePath, 'function test {}')

      const objects: XanoObjectsFile = [
        { id: 1, original: 'old', path: filePath, sha256: 'old', staged: true, status: 'changed', type: 'function' },
      ]

      const result = upsertObject(objects, filePath, { id: 1, staged: false, status: 'unchanged', type: 'function' })
      expect(result).to.have.length(1)
      expect(result[0].status).to.equal('unchanged')
      expect(result[0].staged).to.equal(false)
    })
  })

  describe('removeObjectByPath', () => {
    it('removes object by path', () => {
      const objects: XanoObjectsFile = [
        { id: 1, original: '', path: 'a.xs', sha256: '', staged: false, status: 'unchanged', type: 'function' },
        { id: 2, original: '', path: 'b.xs', sha256: '', staged: false, status: 'unchanged', type: 'function' },
      ]

      const result = removeObjectByPath(objects, 'a.xs')
      expect(result).to.have.length(1)
      expect(result[0].id).to.equal(2)
    })

    it('returns same array if path not found', () => {
      const objects: XanoObjectsFile = [
        { id: 1, original: '', path: 'a.xs', sha256: '', staged: false, status: 'unchanged', type: 'function' },
      ]

      const result = removeObjectByPath(objects, 'nonexistent.xs')
      expect(result).to.have.length(1)
    })
  })

  describe('removeObjectById', () => {
    it('removes object by id', () => {
      const objects: XanoObjectsFile = [
        { id: 1, original: '', path: 'a.xs', sha256: '', staged: false, status: 'unchanged', type: 'function' },
        { id: 2, original: '', path: 'b.xs', sha256: '', staged: false, status: 'unchanged', type: 'function' },
      ]

      const result = removeObjectById(objects, 1)
      expect(result).to.have.length(1)
      expect(result[0].id).to.equal(2)
    })
  })

  describe('updateObjectStatus', () => {
    it('marks deleted files as notfound', () => {
      const objects: XanoObjectsFile = [
        { id: 1, original: '', path: 'nonexistent.xs', sha256: '', staged: false, status: 'unchanged', type: 'function' },
      ]

      const result = updateObjectStatus(objects, tempDir)
      expect(result[0].status).to.equal('notfound')
    })

    it('marks modified files as changed', () => {
      const filePath = 'test.xs'
      const fullPath = join(tempDir, filePath)
      writeFileSync(fullPath, 'new content')

      const objects: XanoObjectsFile = [
        { id: 1, original: '', path: filePath, sha256: 'oldhash', staged: false, status: 'unchanged', type: 'function' },
      ]

      const result = updateObjectStatus(objects, tempDir)
      expect(result[0].status).to.equal('changed')
    })

    it('keeps unchanged files as unchanged', () => {
      const filePath = 'test.xs'
      const fullPath = join(tempDir, filePath)
      const content = 'test content'
      writeFileSync(fullPath, content)

      const objects: XanoObjectsFile = [
        { id: 1, original: '', path: filePath, sha256: computeSha256(content), staged: false, status: 'unchanged', type: 'function' },
      ]

      const result = updateObjectStatus(objects, tempDir)
      expect(result[0].status).to.equal('unchanged')
    })
  })

  describe('markObjectSynced', () => {
    it('updates object with new content hash', () => {
      const objects: XanoObjectsFile = [
        { id: 1, original: 'old', path: 'test.xs', sha256: 'old', staged: true, status: 'changed', type: 'function' },
      ]

      const newContent = 'new content'
      const result = markObjectSynced(objects, 'test.xs', newContent)

      expect(result[0].status).to.equal('unchanged')
      expect(result[0].staged).to.equal(false)
      expect(result[0].sha256).to.equal(computeSha256(newContent))
      expect(decodeBase64(result[0].original!)).to.equal(newContent)
    })
  })

  describe('getAllObjectPaths', () => {
    it('returns all paths', () => {
      const objects: XanoObjectsFile = [
        { id: 1, original: '', path: 'a.xs', sha256: '', staged: false, status: 'unchanged', type: 'function' },
        { id: 2, original: '', path: 'b.xs', sha256: '', staged: false, status: 'unchanged', type: 'table' },
      ]

      const paths = getAllObjectPaths(objects)
      expect(paths).to.deep.equal(['a.xs', 'b.xs'])
    })
  })

  describe('getEndpointsJsonPath', () => {
    it('returns correct path', () => {
      expect(getEndpointsJsonPath(tempDir)).to.equal(join(tempDir, '.xano', 'endpoints.json'))
    })
  })

  describe('loadEndpoints / saveEndpoints', () => {
    const sampleEndpoints: EndpointsFile = {
      DELETE: [
        { canonical: 'abc123', id: 100, pattern: 'devices/{device_id}' },
      ],
      GET: [
        { canonical: 'abc123', id: 101, pattern: 'devices' },
        { canonical: 'abc123', id: 102, pattern: 'devices/{device_id}' },
      ],
      POST: [
        { canonical: 'abc123', id: 103, pattern: 'devices/{device_id}/block' },
      ],
    }

    it('returns empty object when file does not exist', () => {
      expect(loadEndpoints(tempDir)).to.deep.equal({})
    })

    it('saves and loads endpoints correctly', () => {
      saveEndpoints(tempDir, sampleEndpoints)
      const loaded = loadEndpoints(tempDir)
      expect(loaded).to.deep.equal(sampleEndpoints)
    })

    it('creates .xano directory when saving', () => {
      saveEndpoints(tempDir, sampleEndpoints)
      expect(existsSync(join(tempDir, '.xano'))).to.be.true
    })
  })

  describe('findMatchingEndpoint', () => {
    const endpoints: EndpointsFile = {
      DELETE: [
        { canonical: 'abc123', id: 100, pattern: 'devices/{device_id}' },
      ],
      GET: [
        { canonical: 'abc123', id: 101, pattern: 'devices' },
        { canonical: 'abc123', id: 102, pattern: 'devices/{device_id}' },
        { canonical: 'abc123', id: 103, pattern: 'users/{user_id}/devices' },
      ],
      POST: [
        { canonical: 'abc123', id: 104, pattern: 'devices/{device_id}/block' },
        { canonical: 'abc123', id: 105, pattern: 'auth/login' },
      ],
    }

    describe('pattern matching', () => {
      it('matches exact literal path', () => {
        const result = findMatchingEndpoint(endpoints, 'GET', '/devices')
        expect(result).to.not.be.null
        expect(result!.endpoint.id).to.equal(101)
        expect(result!.canonical).to.equal('abc123')
      })

      it('matches path with single parameter', () => {
        const result = findMatchingEndpoint(endpoints, 'GET', '/devices/abc-123-def')
        expect(result).to.not.be.null
        expect(result!.endpoint.id).to.equal(102)
        // eslint-disable-next-line camelcase
        expect(result!.pathParams).to.deep.equal({ device_id: 'abc-123-def' })
      })

      it('matches DELETE with parameter', () => {
        const result = findMatchingEndpoint(endpoints, 'DELETE', '/devices/my-device-uuid')
        expect(result).to.not.be.null
        expect(result!.endpoint.id).to.equal(100)
        // eslint-disable-next-line camelcase
        expect(result!.pathParams).to.deep.equal({ device_id: 'my-device-uuid' })
      })

      it('matches path with parameter in middle', () => {
        const result = findMatchingEndpoint(endpoints, 'GET', '/users/123/devices')
        expect(result).to.not.be.null
        expect(result!.endpoint.id).to.equal(103)
        // eslint-disable-next-line camelcase
        expect(result!.pathParams).to.deep.equal({ user_id: '123' })
      })

      it('matches path with parameter and trailing literal', () => {
        const result = findMatchingEndpoint(endpoints, 'POST', '/devices/xyz-789/block')
        expect(result).to.not.be.null
        expect(result!.endpoint.id).to.equal(104)
        // eslint-disable-next-line camelcase
        expect(result!.pathParams).to.deep.equal({ device_id: 'xyz-789' })
      })

      it('matches literal POST path', () => {
        const result = findMatchingEndpoint(endpoints, 'POST', '/auth/login')
        expect(result).to.not.be.null
        expect(result!.endpoint.id).to.equal(105)
        expect(result!.pathParams).to.deep.equal({})
      })
    })

    describe('path normalization', () => {
      it('handles path without leading slash', () => {
        const result = findMatchingEndpoint(endpoints, 'GET', 'devices')
        expect(result).to.not.be.null
        expect(result!.endpoint.id).to.equal(101)
      })

      it('handles path with multiple leading slashes', () => {
        const result = findMatchingEndpoint(endpoints, 'GET', '///devices')
        expect(result).to.not.be.null
        expect(result!.endpoint.id).to.equal(101)
      })
    })

    describe('query parameters', () => {
      it('extracts query parameters from path', () => {
        const result = findMatchingEndpoint(endpoints, 'GET', '/devices?page=1&limit=10')
        expect(result).to.not.be.null
        expect(result!.endpoint.id).to.equal(101)
        expect(result!.queryParams).to.deep.equal({ limit: '10', page: '1' })
      })

      it('handles query parameters with parameterized path', () => {
        const result = findMatchingEndpoint(endpoints, 'GET', '/devices/abc-123?include=owner')
        expect(result).to.not.be.null
        expect(result!.endpoint.id).to.equal(102)
        // eslint-disable-next-line camelcase
        expect(result!.pathParams).to.deep.equal({ device_id: 'abc-123' })
        expect(result!.queryParams).to.deep.equal({ include: 'owner' })
      })
    })

    describe('no match cases', () => {
      it('returns null for unknown verb', () => {
        const result = findMatchingEndpoint(endpoints, 'PATCH', '/devices')
        expect(result).to.be.null
      })

      it('returns null for path with wrong segment count', () => {
        const result = findMatchingEndpoint(endpoints, 'GET', '/devices/123/extra/segments')
        expect(result).to.be.null
      })

      it('returns null for non-matching literal segment', () => {
        const result = findMatchingEndpoint(endpoints, 'GET', '/users')
        expect(result).to.be.null
      })

      it('returns null for empty endpoints', () => {
        const result = findMatchingEndpoint({}, 'GET', '/devices')
        expect(result).to.be.null
      })
    })

    describe('ambiguity handling', () => {
      it('throws error when path matches endpoints in different canonicals', () => {
        const ambiguousEndpoints: EndpointsFile = {
          GET: [
            { canonical: 'group-a', id: 1, pattern: 'users/{id}' },
            { canonical: 'group-b', id: 2, pattern: 'users/{user_id}' },
          ],
        }

        let error: Error | undefined
        try {
          findMatchingEndpoint(ambiguousEndpoints, 'GET', '/users/123')
        } catch (error_) {
          error = error_ as Error
        }

        expect(error).to.not.be.undefined
        expect(error!.message).to.include('Ambiguous endpoint')
        expect(error!.message).to.include('group-a')
        expect(error!.message).to.include('group-b')
      })

      it('does not throw when multiple patterns match same canonical', () => {
        // This shouldn't happen in practice, but if it does, same canonical is fine
        const sameCanonicalEndpoints: EndpointsFile = {
          GET: [
            { canonical: 'same-group', id: 1, pattern: 'items/{id}' },
            { canonical: 'same-group', id: 2, pattern: 'items/{item_id}' },
          ],
        }

        // Should not throw, returns first match
        const result = findMatchingEndpoint(sameCanonicalEndpoints, 'GET', '/items/123')
        expect(result).to.not.be.null
        expect(result!.canonical).to.equal('same-group')
      })
    })
  })
})
