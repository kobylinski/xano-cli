import { expect } from 'chai'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import type { XanoObjectsFile } from '../../src/lib/types.js'

import {
  computeFileSha256,
  computeSha256,
  decodeBase64,
  encodeBase64,
  findObjectById,
  findObjectByPath,
  findObjectsByType,
  getAllObjectPaths,
  getObjectsJsonPath,
  loadObjects,
  markObjectSynced,
  removeObjectById,
  removeObjectByPath,
  saveObjects,
  updateObjectStatus,
  upsertObject,
} from '../../src/lib/objects.js'

describe('lib/objects', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xano-cli-test-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { force: true, recursive: true })
  })

  describe('getObjectsJsonPath', () => {
    it('returns correct path', () => {
      expect(getObjectsJsonPath(tempDir)).to.equal(path.join(tempDir, '.xano', 'objects.json'))
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
      expect(fs.existsSync(path.join(tempDir, '.xano'))).to.be.true
    })

    it('returns empty array for invalid JSON', () => {
      fs.mkdirSync(path.join(tempDir, '.xano'))
      fs.writeFileSync(path.join(tempDir, '.xano', 'objects.json'), 'invalid json')
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
      expect(computeFileSha256(path.join(tempDir, 'nonexistent.txt'))).to.be.null
    })

    it('computes hash of file content', () => {
      const filePath = path.join(tempDir, 'test.txt')
      fs.writeFileSync(filePath, 'test content')
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
      const filePath = path.join(tempDir, 'test.xs')
      fs.writeFileSync(filePath, 'function test {}')

      const result = upsertObject(objects, filePath, { id: 1, type: 'function' })
      expect(result).to.have.length(1)
      expect(result[0].id).to.equal(1)
      expect(result[0].type).to.equal('function')
      expect(result[0].path).to.equal(filePath)
    })

    it('updates existing object', () => {
      const filePath = path.join(tempDir, 'test.xs')
      fs.writeFileSync(filePath, 'function test {}')

      const objects: XanoObjectsFile = [
        { id: 1, original: 'old', path: filePath, sha256: 'old', staged: true, status: 'modified', type: 'function' },
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
    it('marks deleted files as deleted', () => {
      const objects: XanoObjectsFile = [
        { id: 1, original: '', path: 'nonexistent.xs', sha256: '', staged: false, status: 'unchanged', type: 'function' },
      ]

      const result = updateObjectStatus(objects, tempDir)
      expect(result[0].status).to.equal('deleted')
    })

    it('marks modified files as modified', () => {
      const filePath = 'test.xs'
      const fullPath = path.join(tempDir, filePath)
      fs.writeFileSync(fullPath, 'new content')

      const objects: XanoObjectsFile = [
        { id: 1, original: '', path: filePath, sha256: 'oldhash', staged: false, status: 'unchanged', type: 'function' },
      ]

      const result = updateObjectStatus(objects, tempDir)
      expect(result[0].status).to.equal('modified')
    })

    it('keeps unchanged files as unchanged', () => {
      const filePath = 'test.xs'
      const fullPath = path.join(tempDir, filePath)
      const content = 'test content'
      fs.writeFileSync(fullPath, content)

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
        { id: 1, original: 'old', path: 'test.xs', sha256: 'old', staged: true, status: 'modified', type: 'function' },
      ]

      const newContent = 'new content'
      const result = markObjectSynced(objects, 'test.xs', newContent)

      expect(result[0].status).to.equal('unchanged')
      expect(result[0].staged).to.equal(false)
      expect(result[0].sha256).to.equal(computeSha256(newContent))
      expect(decodeBase64(result[0].original)).to.equal(newContent)
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
})
