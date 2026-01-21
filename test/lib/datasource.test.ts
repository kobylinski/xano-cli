import { expect } from 'chai'

import type { DatasourcePermissions } from '../../src/lib/types.js'

import {
  checkDatasourcePermission,
  DatasourcePermissionError,
  describeAccessLevel,
  formatDatasourceName,
  getDatasourceAccessLevel,
  isOperationAllowed,
} from '../../src/lib/datasource.js'

describe('datasource', () => {
  describe('getDatasourceAccessLevel', () => {
    it('returns read-only for undefined datasource with no permissions', () => {
      // eslint-disable-next-line unicorn/no-useless-undefined
      expect(getDatasourceAccessLevel(undefined, undefined)).to.equal('read-only')
    })

    it('returns read-only for unlisted datasource', () => {
      const permissions: DatasourcePermissions = { test: 'read-write' }
      expect(getDatasourceAccessLevel('staging', permissions)).to.equal('read-only')
    })

    it('returns configured level for listed datasource', () => {
      const permissions: DatasourcePermissions = {
        live: 'locked',
        staging: 'read-only',
        test: 'read-write',
      }
      expect(getDatasourceAccessLevel('live', permissions)).to.equal('locked')
      expect(getDatasourceAccessLevel('staging', permissions)).to.equal('read-only')
      expect(getDatasourceAccessLevel('test', permissions)).to.equal('read-write')
    })

    it('uses live permission for default datasource (undefined)', () => {
      const permissions: DatasourcePermissions = { live: 'locked' }
      expect(getDatasourceAccessLevel(undefined, permissions)).to.equal('locked')
    })
  })

  describe('isOperationAllowed', () => {
    it('allows read on read-only datasource', () => {
      const permissions: DatasourcePermissions = { test: 'read-only' }
      expect(isOperationAllowed('test', 'read', permissions)).to.be.true
    })

    it('denies write on read-only datasource', () => {
      const permissions: DatasourcePermissions = { test: 'read-only' }
      expect(isOperationAllowed('test', 'write', permissions)).to.be.false
    })

    it('allows both read and write on read-write datasource', () => {
      const permissions: DatasourcePermissions = { test: 'read-write' }
      expect(isOperationAllowed('test', 'read', permissions)).to.be.true
      expect(isOperationAllowed('test', 'write', permissions)).to.be.true
    })

    it('denies both read and write on locked datasource', () => {
      const permissions: DatasourcePermissions = { live: 'locked' }
      expect(isOperationAllowed('live', 'read', permissions)).to.be.false
      expect(isOperationAllowed('live', 'write', permissions)).to.be.false
    })

    it('defaults to read-only for unconfigured datasources', () => {
      // eslint-disable-next-line unicorn/no-useless-undefined
      expect(isOperationAllowed('unknown', 'read', undefined)).to.be.true
      // eslint-disable-next-line unicorn/no-useless-undefined
      expect(isOperationAllowed('unknown', 'write', undefined)).to.be.false
    })
  })

  describe('checkDatasourcePermission', () => {
    it('does not throw for allowed read operation', () => {
      const permissions: DatasourcePermissions = { test: 'read-only' }
      expect(() => checkDatasourcePermission('test', 'read', permissions)).to.not.throw()
    })

    it('does not throw for allowed write operation', () => {
      const permissions: DatasourcePermissions = { test: 'read-write' }
      expect(() => checkDatasourcePermission('test', 'write', permissions)).to.not.throw()
    })

    it('throws DatasourcePermissionError for denied write on read-only', () => {
      const permissions: DatasourcePermissions = { test: 'read-only' }
      expect(() => checkDatasourcePermission('test', 'write', permissions))
        .to.throw(DatasourcePermissionError)
        .with.property('message')
        .that.includes('read-only')
    })

    it('throws DatasourcePermissionError for denied operation on locked', () => {
      const permissions: DatasourcePermissions = { live: 'locked' }
      expect(() => checkDatasourcePermission('live', 'read', permissions))
        .to.throw(DatasourcePermissionError)
        .with.property('message')
        .that.includes('locked')
    })

    it('includes datasource name in error', () => {
      const permissions: DatasourcePermissions = { production: 'locked' }
      try {
        checkDatasourcePermission('production', 'read', permissions)
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).to.be.instanceOf(DatasourcePermissionError)
        expect((error as DatasourcePermissionError).datasource).to.equal('production')
      }
    })
  })

  describe('formatDatasourceName', () => {
    it('returns datasource name if provided', () => {
      expect(formatDatasourceName('test')).to.equal('test')
    })

    it('returns default label for undefined', () => {
      // eslint-disable-next-line unicorn/no-useless-undefined
      expect(formatDatasourceName(undefined)).to.equal('live (default)')
    })
  })

  describe('describeAccessLevel', () => {
    it('describes locked level', () => {
      expect(describeAccessLevel('locked')).to.equal('no access')
    })

    it('describes read-only level', () => {
      expect(describeAccessLevel('read-only')).to.equal('read-only access')
    })

    it('describes read-write level', () => {
      expect(describeAccessLevel('read-write')).to.equal('full read-write access')
    })
  })
})
