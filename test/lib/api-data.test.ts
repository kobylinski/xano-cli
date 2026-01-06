import { expect } from 'chai'

import { XanoApi } from '../../src/lib/api.js'
import type { XanoProfile } from '../../src/lib/types.js'

describe('lib/api - Table Content Methods', () => {
  // Mock profile for testing
  const mockProfile: XanoProfile = {
    access_token: 'test-token',
    instance_origin: 'https://test.xano.io',
  }

  const workspaceId = 123
  const branch = 'main'

  describe('XanoApi table content methods exist', () => {
    let api: XanoApi

    beforeEach(() => {
      api = new XanoApi(mockProfile, workspaceId, branch)
    })

    it('has listTableContent method', () => {
      expect(api.listTableContent).to.be.a('function')
    })

    it('has getTableContent method', () => {
      expect(api.getTableContent).to.be.a('function')
    })

    it('has createTableContent method', () => {
      expect(api.createTableContent).to.be.a('function')
    })

    it('has updateTableContent method', () => {
      expect(api.updateTableContent).to.be.a('function')
    })

    it('has deleteTableContent method', () => {
      expect(api.deleteTableContent).to.be.a('function')
    })

    it('has bulkCreateTableContent method', () => {
      expect(api.bulkCreateTableContent).to.be.a('function')
    })
  })

  describe('XanoApi live API methods exist', () => {
    let api: XanoApi

    beforeEach(() => {
      api = new XanoApi(mockProfile, workspaceId, branch)
    })

    it('has getApiGroupWithCanonical method', () => {
      expect(api.getApiGroupWithCanonical).to.be.a('function')
    })

    it('has callLiveApi method', () => {
      expect(api.callLiveApi).to.be.a('function')
    })
  })

  describe('XanoApi method signatures', () => {
    let api: XanoApi

    beforeEach(() => {
      api = new XanoApi(mockProfile, workspaceId, branch)
    })

    it('listTableContent accepts tableId, page, perPage', () => {
      // Just verify the method can be called with these params (will fail due to network, but signature is correct)
      const promise = api.listTableContent(1, 1, 10)
      expect(promise).to.be.a('promise')
    })

    it('getTableContent accepts tableId and pk', () => {
      const promise = api.getTableContent(1, 1)
      expect(promise).to.be.a('promise')
    })

    it('createTableContent accepts tableId and data object', () => {
      const promise = api.createTableContent(1, { name: 'test' })
      expect(promise).to.be.a('promise')
    })

    it('updateTableContent accepts tableId, pk, and data object', () => {
      const promise = api.updateTableContent(1, 1, { name: 'updated' })
      expect(promise).to.be.a('promise')
    })

    it('deleteTableContent accepts tableId and pk', () => {
      const promise = api.deleteTableContent(1, 1)
      expect(promise).to.be.a('promise')
    })

    it('bulkCreateTableContent accepts tableId and array of records', () => {
      const promise = api.bulkCreateTableContent(1, [{ name: 'a' }, { name: 'b' }])
      expect(promise).to.be.a('promise')
    })

    it('callLiveApi accepts canonical, path, method, body, headers', () => {
      const promise = api.callLiveApi('abc123', '/test', 'POST', { key: 'value' }, { 'X-Custom': 'header' })
      expect(promise).to.be.a('promise')
    })
  })
})
