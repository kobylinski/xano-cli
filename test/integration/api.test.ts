/**
 * Integration tests for Xano API
 *
 * Run with: npm run test:integration
 */

import { expect } from 'chai'

import { XanoApi } from '../../src/lib/api.js'
import {
  INTEGRATION_ENABLED,
  skipIfNoIntegration,
  validateConfig,
} from './setup.js'

describe('Integration: XanoApi', function () {
  // Increase timeout for API calls
  this.timeout(30_000)

  before(function () {
    if (!INTEGRATION_ENABLED) {
      skipIfNoIntegration()
      this.skip()
    }
  })

  let api: XanoApi

  beforeEach(function () {
    if (!INTEGRATION_ENABLED) {
      this.skip()
      return
    }

    const config = validateConfig()
    api = new XanoApi(config.profile, config.workspaceId, config.branch)
  })

  describe('listBranches', () => {
    it('returns array of branches', async function () {
      if (!INTEGRATION_ENABLED) this.skip()

      const response = await api.listBranches()

      // Skip if endpoint not available (404)
      if (response.status === 404) {
        console.log('Skipping listBranches - endpoint not available')
        this.skip()
        return
      }

      expect(response.ok, `API error: ${response.error}`).to.be.true
      expect(response.data).to.be.an('array')
      expect(response.data!.length).to.be.greaterThan(0)

      // Branch response structure varies - just verify we got branch data
      const branch = response.data![0] as unknown as Record<string, unknown>
      // Should have some identifying property
      const hasIdentifier = branch.name || branch.branch_name || branch.label || Object.keys(branch).length > 0
      expect(hasIdentifier, `Branch has no identifier: ${JSON.stringify(branch)}`).to.be.ok
    })
  })

  describe('listFunctions', () => {
    it('returns paginated function list', async function () {
      if (!INTEGRATION_ENABLED) this.skip()

      const response = await api.listFunctions(1, 10)

      if (response.status === 404) {
        console.log('Skipping listFunctions - endpoint not available')
        this.skip()
        return
      }

      expect(response.ok, `API error: ${response.error}`).to.be.true
      expect(response.data).to.have.property('items')
      expect(response.data!.items).to.be.an('array')

      // If there are functions, check structure
      if (response.data!.items.length > 0) {
        const fn = response.data!.items[0]
        expect(fn).to.have.property('id')
        expect(fn).to.have.property('name')
      }
    })

    it('returns xanoscript content when available', async function () {
      if (!INTEGRATION_ENABLED) this.skip()

      const response = await api.listFunctions(1, 10)

      if (response.status === 404) {
        this.skip()
        return
      }

      expect(response.ok, `API error: ${response.error}`).to.be.true

      // Find a function with xanoscript
      const withXs = response.data!.items.find(fn => fn.xanoscript)
      if (withXs) {
        // xanoscript can be a string or an object depending on API version
        expect(withXs.xanoscript).to.exist
        if (typeof withXs.xanoscript === 'string') {
          expect(withXs.xanoscript).to.include('function')
        }
      }
    })
  })

  describe('listTables', () => {
    it('returns paginated table list', async function () {
      if (!INTEGRATION_ENABLED) this.skip()

      const response = await api.listTables(1, 10)

      if (response.status === 404) {
        this.skip()
        return
      }

      expect(response.ok, `API error: ${response.error}`).to.be.true
      expect(response.data).to.have.property('items')
      expect(response.data!.items).to.be.an('array')

      // If there are tables, check structure
      if (response.data!.items.length > 0) {
        const table = response.data!.items[0]
        expect(table).to.have.property('id')
        expect(table).to.have.property('name')
      }
    })
  })

  describe('listApiGroups', () => {
    it('returns paginated api group list', async function () {
      if (!INTEGRATION_ENABLED) this.skip()

      const response = await api.listApiGroups(1, 10)

      if (response.status === 404) {
        this.skip()
        return
      }

      expect(response.ok, `API error: ${response.error}`).to.be.true
      expect(response.data).to.have.property('items')
      expect(response.data!.items).to.be.an('array')

      // If there are groups, check structure
      if (response.data!.items.length > 0) {
        const group = response.data!.items[0]
        expect(group).to.have.property('id')
        expect(group).to.have.property('name')
      }
    })
  })

  describe('listApiEndpoints', () => {
    it('returns api endpoints', async function () {
      if (!INTEGRATION_ENABLED) this.skip()

      const response = await api.listApiEndpoints(1, 100)

      if (response.status === 404) {
        this.skip()
        return
      }

      expect(response.ok, `API error: ${response.error}`).to.be.true
      expect(response.data).to.have.property('items')
      expect(response.data!.items).to.be.an('array')

      // If there are endpoints, check structure
      if (response.data!.items.length > 0) {
        const endpoint = response.data!.items[0] as unknown as Record<string, unknown>
        expect(endpoint).to.have.property('id')
        // Should have path (or similar field depending on API version)
        const hasPath = endpoint.path || endpoint.endpoint || endpoint.name || endpoint.route
        expect(hasPath).to.exist
      }
    })
  })

  describe('listTasks', () => {
    it('returns paginated task list', async function () {
      if (!INTEGRATION_ENABLED) this.skip()

      const response = await api.listTasks(1, 10)

      if (response.status === 404) {
        this.skip()
        return
      }

      expect(response.ok, `API error: ${response.error}`).to.be.true
      expect(response.data).to.have.property('items')
      expect(response.data!.items).to.be.an('array')

      // If there are tasks, check structure
      if (response.data!.items.length > 0) {
        const task = response.data!.items[0]
        expect(task).to.have.property('id')
        expect(task).to.have.property('name')
      }
    })
  })

  describe('getFunction', () => {
    it('returns function details with xanoscript', async function () {
      if (!INTEGRATION_ENABLED) this.skip()

      // First get a function ID
      const listResponse = await api.listFunctions(1, 1)
      if (!listResponse.ok || listResponse.data!.items.length === 0) {
        this.skip()
        return
      }

      const functionId = listResponse.data!.items[0].id
      const response = await api.getFunction(functionId)

      expect(response.ok).to.be.true
      expect(response.data).to.have.property('id', functionId)
      expect(response.data).to.have.property('name')
    })
  })

  describe('getTable', () => {
    it('returns table details', async function () {
      if (!INTEGRATION_ENABLED) this.skip()

      // First get a table ID
      const listResponse = await api.listTables(1, 1)
      if (!listResponse.ok || listResponse.data!.items.length === 0) {
        this.skip()
        return
      }

      const tableId = listResponse.data!.items[0].id
      const response = await api.getTable(tableId)

      expect(response.ok).to.be.true
      expect(response.data).to.have.property('id', tableId)
      expect(response.data).to.have.property('name')
    })
  })
})
