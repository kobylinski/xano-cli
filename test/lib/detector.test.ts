import { expect } from 'chai'

import {
  detectType,
  detectTypeFromPath,
  extractApiDetails,
  extractName,
  extractTriggerDetails,
  generateFilePath,
  generateKey,
  generateKeyFromPath,
} from '../../src/lib/detector.js'

describe('lib/detector', () => {
  describe('detectType', () => {
    it('detects function type', () => {
      expect(detectType('function calculate_total { }')).to.equal('function')
    })

    it('detects table type', () => {
      expect(detectType('table users { }')).to.equal('table')
    })

    it('detects api_endpoint type from query keyword', () => {
      expect(detectType('query GET /users { }')).to.equal('api_endpoint')
    })

    it('detects task type', () => {
      expect(detectType('task daily_cleanup { }')).to.equal('task')
    })

    it('detects table_trigger type', () => {
      expect(detectType('table_trigger audit_log on users after_insert { }')).to.equal('table_trigger')
    })

    it('detects api_group type', () => {
      expect(detectType('api_group users { }')).to.equal('api_group')
    })

    it('detects middleware type', () => {
      expect(detectType('middleware auth_check { }')).to.equal('middleware')
    })

    it('detects addon type', () => {
      expect(detectType('addon custom_addon { }')).to.equal('addon')
    })

    it('skips comments at the beginning', () => {
      const content = `// This is a comment
// Another comment

function my_func { }`
      expect(detectType(content)).to.equal('function')
    })

    it('returns null for unknown content', () => {
      expect(detectType('unknown_keyword foo { }')).to.be.null
    })

    it('returns null for empty content', () => {
      expect(detectType('')).to.be.null
    })

    it('returns null for comment-only content', () => {
      expect(detectType('// just a comment')).to.be.null
    })
  })

  describe('extractName', () => {
    it('extracts function name', () => {
      expect(extractName('function calculate_total { }')).to.equal('calculate_total')
    })

    it('extracts table name', () => {
      expect(extractName('table users { }')).to.equal('users')
    })

    it('extracts task name', () => {
      expect(extractName('task daily_cleanup { }')).to.equal('daily_cleanup')
    })

    it('extracts name with leading comments', () => {
      const content = `// Description
function my_func { }`
      expect(extractName(content)).to.equal('my_func')
    })

    it('handles names with underscores and numbers', () => {
      expect(extractName('function calculate_total_v2 { }')).to.equal('calculate_total_v2')
    })

    it('returns null for no match', () => {
      expect(extractName('invalid content')).to.be.null
    })
  })

  describe('extractApiDetails', () => {
    it('extracts GET endpoint', () => {
      const result = extractApiDetails('query GET /users { }')
      expect(result).to.deep.equal({ path: '/users', verb: 'GET' })
    })

    it('extracts POST endpoint', () => {
      const result = extractApiDetails('query POST /users { }')
      expect(result).to.deep.equal({ path: '/users', verb: 'POST' })
    })

    it('extracts PUT endpoint', () => {
      const result = extractApiDetails('query PUT /users/{id} { }')
      expect(result).to.deep.equal({ path: '/users/{id}', verb: 'PUT' })
    })

    it('extracts DELETE endpoint', () => {
      const result = extractApiDetails('query DELETE /users/{id} { }')
      expect(result).to.deep.equal({ path: '/users/{id}', verb: 'DELETE' })
    })

    it('extracts PATCH endpoint', () => {
      const result = extractApiDetails('query PATCH /users/{id} { }')
      expect(result).to.deep.equal({ path: '/users/{id}', verb: 'PATCH' })
    })

    it('normalizes verb to uppercase', () => {
      const result = extractApiDetails('query get /users { }')
      expect(result?.verb).to.equal('GET')
    })

    it('returns null for non-query content', () => {
      expect(extractApiDetails('function test { }')).to.be.null
    })
  })

  describe('extractTriggerDetails', () => {
    it('extracts after_insert trigger', () => {
      const result = extractTriggerDetails('table_trigger audit_log on users after_insert { }')
      expect(result).to.deep.equal({ event: 'after_insert', table: 'users' })
    })

    it('extracts before_update trigger', () => {
      const result = extractTriggerDetails('table_trigger validate on orders before_update { }')
      expect(result).to.deep.equal({ event: 'before_update', table: 'orders' })
    })

    it('returns null for non-trigger content', () => {
      expect(extractTriggerDetails('function test { }')).to.be.null
    })
  })

  describe('generateKey', () => {
    it('generates key for function', () => {
      expect(generateKey('function calculate_total { }')).to.equal('function:calculate_total')
    })

    it('generates key for table', () => {
      expect(generateKey('table users { }')).to.equal('table:users')
    })

    it('generates key for task', () => {
      expect(generateKey('task cleanup { }')).to.equal('task:cleanup')
    })

    it('generates key for api_endpoint', () => {
      expect(generateKey('query GET /users { }')).to.equal('api:GET:/users')
    })

    it('generates key for table_trigger', () => {
      expect(generateKey('table_trigger audit on users after_insert { }')).to.equal('trigger:users:after_insert:audit')
    })

    it('returns null for unknown type', () => {
      expect(generateKey('unknown foo { }')).to.be.null
    })
  })

  describe('generateKeyFromPath', () => {
    it('generates key from function path', () => {
      expect(generateKeyFromPath('functions/calculate_total.xs')).to.equal('function:calculate_total')
    })

    it('generates key from table path', () => {
      expect(generateKeyFromPath('tables/users.xs')).to.equal('table:users')
    })

    it('generates key from task path', () => {
      expect(generateKeyFromPath('tasks/cleanup.xs')).to.equal('task:cleanup')
    })

    it('generates key from api path with verb pattern', () => {
      expect(generateKeyFromPath('apis/users/123_GET_users.xs')).to.equal('api:GET:123_GET_users')
    })

    it('returns null for non-.xs files', () => {
      expect(generateKeyFromPath('functions/readme.md')).to.be.null
    })

    it('returns null for unknown directory', () => {
      expect(generateKeyFromPath('unknown/test.xs')).to.be.null
    })
  })

  describe('detectTypeFromPath', () => {
    it('detects function from path', () => {
      expect(detectTypeFromPath('functions/test.xs')).to.equal('function')
    })

    it('detects table from path', () => {
      expect(detectTypeFromPath('tables/users.xs')).to.equal('table')
    })

    it('detects api_endpoint from path', () => {
      expect(detectTypeFromPath('apis/users/get_all.xs')).to.equal('api_endpoint')
    })

    it('detects task from path', () => {
      expect(detectTypeFromPath('tasks/cleanup.xs')).to.equal('task')
    })

    it('detects trigger from path with trigger in name', () => {
      expect(detectTypeFromPath('tables/users_trigger_audit.xs')).to.equal('table_trigger')
    })

    it('returns null for unknown path', () => {
      expect(detectTypeFromPath('unknown/test.xs')).to.be.null
    })
  })

  describe('generateFilePath', () => {
    const paths = {
      apis: 'apis',
      functions: 'functions',
      tables: 'tables',
      tasks: 'tasks',
    }

    it('generates function path', () => {
      expect(generateFilePath('function', 'calculate_total', 123, paths)).to.equal('functions/123_calculate_total.xs')
    })

    it('generates table path', () => {
      expect(generateFilePath('table', 'users', 456, paths)).to.equal('tables/456_users.xs')
    })

    it('generates task path', () => {
      expect(generateFilePath('task', 'cleanup', 789, paths)).to.equal('tasks/789_cleanup.xs')
    })

    it('generates api_endpoint path with group and verb', () => {
      const result = generateFilePath('api_endpoint', '/users', 100, paths, 'auth', 'POST')
      expect(result).to.equal('apis/auth/100_POST__users.xs')
    })

    it('generates api_endpoint path with default group and verb', () => {
      const result = generateFilePath('api_endpoint', '/users', 100, paths)
      expect(result).to.equal('apis/default/100_GET__users.xs')
    })

    it('generates table_trigger path', () => {
      expect(generateFilePath('table_trigger', 'audit', 200, paths)).to.equal('tables/triggers/200_audit.xs')
    })

    it('generates api_group path', () => {
      expect(generateFilePath('api_group', 'auth', 300, paths)).to.equal('apis/auth/_group.xs')
    })

    it('sanitizes path characters in api endpoint names', () => {
      const result = generateFilePath('api_endpoint', '/users/{id}', 100, paths, 'default', 'GET')
      expect(result).to.equal('apis/default/100_GET__users_id.xs')
    })
  })
})
