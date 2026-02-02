import { expect } from 'chai'

import type { PathResolver, ResolverContext, SanitizeFunction } from '../../src/lib/types.js'

import {
  countBlocks,
  detectType,
  detectTypeFromPath,
  extractApiDetails,
  extractName,
  extractTriggerDetails,
  generateFilePath,
  generateKey,
  generateKeyFromPath,
  sanitize,
  sanitizePath,
  validateSingleBlock,
} from '../../src/lib/detector.js'

describe('lib/detector', () => {
  describe('sanitize', () => {
    it('converts camelCase to snake_case', () => {
      expect(sanitize('calculateTotal')).to.equal('calculate_total')
    })

    it('converts to lowercase', () => {
      expect(sanitize('MyFunction')).to.equal('my_function')
    })

    it('replaces spaces with underscores', () => {
      expect(sanitize('my function')).to.equal('my_function')
    })

    it('replaces hyphens with underscores', () => {
      expect(sanitize('my-function')).to.equal('my_function')
    })

    it('removes invalid characters', () => {
      expect(sanitize('my@function!')).to.equal('my_function')
    })

    it('collapses multiple underscores', () => {
      expect(sanitize('my__function')).to.equal('my_function')
    })

    it('trims leading and trailing underscores', () => {
      expect(sanitize('_myfunction_')).to.equal('myfunction')
    })

    it('handles API paths', () => {
      expect(sanitize('/users/{id}')).to.equal('users_id')
    })
  })

  describe('sanitizePath', () => {
    it('converts slashes to directory separators', () => {
      expect(sanitizePath('User/Security Events/Log Auth')).to.equal('user/security_events/log_auth')
    })

    it('handles single segment (no slashes)', () => {
      expect(sanitizePath('myFunction')).to.equal('my_function')
    })

    it('trims whitespace around segments', () => {
      expect(sanitizePath('User / Events / Log')).to.equal('user/events/log')
    })

    it('filters out empty segments', () => {
      expect(sanitizePath('User//Events')).to.equal('user/events')
    })

    it('uses custom sanitize function', () => {
      // eslint-disable-next-line unicorn/consistent-function-scoping
      const upper = (s: string) => s.toUpperCase()
      expect(sanitizePath('user/events', upper)).to.equal('USER/EVENTS')
    })
  })

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
      triggers: 'tables',
      workflowTests: 'workflow_tests',
    }

    describe('default naming mode (CLI native)', () => {
      it('generates function path', () => {
        const result = generateFilePath({ id: 123, name: 'calculate_total', type: 'function' }, paths)
        expect(result).to.equal('functions/calculate_total.xs')
      })

      it('generates table path', () => {
        const result = generateFilePath({ id: 456, name: 'users', type: 'table' }, paths)
        expect(result).to.equal('tables/users.xs')
      })

      it('generates task path', () => {
        const result = generateFilePath({ id: 789, name: 'cleanup', type: 'task' }, paths)
        expect(result).to.equal('tasks/cleanup.xs')
      })

      it('generates api_endpoint path with group and verb', () => {
        const result = generateFilePath({ group: 'auth', id: 100, name: '/users', path: '/users', type: 'api_endpoint', verb: 'POST' }, paths)
        expect(result).to.equal('apis/auth/users_POST.xs')
      })

      it('generates api_endpoint path with default group and verb', () => {
        const result = generateFilePath({ id: 100, name: '/users', path: '/users', type: 'api_endpoint' }, paths)
        expect(result).to.equal('apis/default/users_GET.xs')
      })

      it('generates table_trigger path with table subdirectory (nested)', () => {
        // Default mode: nested structure - tables/{tableName}/{triggerName}.xs
        const result = generateFilePath({ id: 200, name: 'audit', table: 'users', type: 'table_trigger' }, paths)
        expect(result).to.equal('tables/users/audit.xs')
      })

      it('generates api_group path as flat file', () => {
        // Default mode: flat file (apis/groupName.xs)
        const result = generateFilePath({ id: 300, name: 'auth', type: 'api_group' }, paths)
        expect(result).to.equal('apis/auth.xs')
      })

      it('sanitizes path characters in api endpoint names', () => {
        const result = generateFilePath({ group: 'default', id: 100, name: '/users/{id}', path: '/users/{id}', type: 'api_endpoint', verb: 'GET' }, paths)
        expect(result).to.equal('apis/default/users_id_GET.xs')
      })

      it('generates workflow_test path', () => {
        const result = generateFilePath({ id: 500, name: 'login_flow', type: 'workflow_test' }, paths)
        expect(result).to.equal('workflow_tests/login_flow.xs')
      })

      it('converts camelCase to snake_case', () => {
        const result = generateFilePath({ id: 1, name: 'calculateTotal', type: 'function' }, paths)
        expect(result).to.equal('functions/calculate_total.xs')
      })

      it('converts function names with slashes to subdirectories', () => {
        const result = generateFilePath({ id: 1, name: 'User/Security Events/Log Auth', type: 'function' }, paths)
        expect(result).to.equal('functions/user/security_events/log_auth.xs')
      })

      it('converts task names with slashes to subdirectories', () => {
        const result = generateFilePath({ id: 1, name: 'Maintenance/Daily Cleanup', type: 'task' }, paths)
        expect(result).to.equal('tasks/maintenance/daily_cleanup.xs')
      })

      it('converts api group names with slashes to subdirectories', () => {
        const result = generateFilePath({ id: 1, name: 'Admin/User Management', type: 'api_group' }, paths)
        expect(result).to.equal('apis/admin/user_management.xs')
      })
    })

    describe('vscode naming mode', () => {
      it('generates table_trigger path as flat file', () => {
        // VSCode: flat structure - tables/triggers/{triggerName}.xs
        const result = generateFilePath({ id: 200, name: 'users_after_insert', table: 'users', type: 'table_trigger' }, paths, { naming: 'vscode' })
        expect(result).to.equal('tables/triggers/users_after_insert.xs')
      })

      it('generates api_group path as folder with api_group.xs', () => {
        // VSCode: apis/groupName/api_group.xs
        const result = generateFilePath({ id: 300, name: 'auth', type: 'api_group' }, paths, { naming: 'vscode' })
        expect(result).to.equal('apis/auth/api_group.xs')
      })

      it('flattens task names with slashes', () => {
        // VSCode uses snakeCase which flattens slashes
        const result = generateFilePath({ id: 1, name: 'Maintenance/Daily Cleanup', type: 'task' }, paths, { naming: 'vscode' })
        expect(result).to.equal('tasks/maintenance_daily_cleanup.xs')
      })

      it('flattens api group names with slashes', () => {
        const result = generateFilePath({ id: 1, name: 'Admin/User Management', type: 'api_group' }, paths, { naming: 'vscode' })
        expect(result).to.equal('apis/admin_user_management/api_group.xs')
      })
    })

    describe('vscode_id naming mode', () => {
      it('generates function path with ID prefix', () => {
        const result = generateFilePath({ id: 123, name: 'calculate_total', type: 'function' }, paths, { naming: 'vscode_id' })
        expect(result).to.equal('functions/123_calculate_total.xs')
      })

      it('generates api_endpoint path with ID prefix', () => {
        const result = generateFilePath({ group: 'auth', id: 100, name: '/users', path: '/users', type: 'api_endpoint', verb: 'POST' }, paths, { naming: 'vscode_id' })
        expect(result).to.equal('apis/auth/100_users_POST.xs')
      })
    })

    describe('custom resolver with context', () => {
      it('receives context with default path', () => {
        let receivedContext: null | ResolverContext = null
        const customResolver: PathResolver = (_obj, _paths, ctx) => {
          receivedContext = ctx
          return null // Use default
        }

        generateFilePath({ id: 123, name: 'test', type: 'function' }, paths, { customResolver })
        expect(receivedContext).to.not.be.null
        expect(receivedContext!.type).to.equal('function')
        expect(receivedContext!.naming).to.equal('default')
        expect(receivedContext!.default).to.equal('functions/test.xs')
      })

      it('can override path selectively', () => {
        // eslint-disable-next-line unicorn/consistent-function-scoping
        const customResolver: PathResolver = (obj, _paths, _ctx) => {
          if (obj.type === 'function' && obj.name.startsWith('test_')) {
            return `tests/${obj.name}.xs`
          }

          return null // Use default from ctx.default
        }

        const result1 = generateFilePath({ id: 1, name: 'test_login', type: 'function' }, paths, { customResolver })
        const result2 = generateFilePath({ id: 2, name: 'calculate', type: 'function' }, paths, { customResolver })
        expect(result1).to.equal('tests/test_login.xs')
        expect(result2).to.equal('functions/calculate.xs')
      })
    })

    describe('custom sanitize with context', () => {
      it('receives context with default sanitized result', () => {
        let receivedContext: null | ResolverContext = null
        const customSanitize: SanitizeFunction = (_name, ctx) => {
          receivedContext = ctx
          return ctx.default // Use default
        }

        generateFilePath({ id: 123, name: 'MyFunction', type: 'function' }, paths, { customSanitize })
        expect(receivedContext).to.not.be.null
        expect(receivedContext!.type).to.equal('function')
        expect(receivedContext!.naming).to.equal('default')
        expect(receivedContext!.default).to.equal('my_function')
      })

      it('can override sanitization selectively', () => {
        // eslint-disable-next-line unicorn/consistent-function-scoping
        const customSanitize: SanitizeFunction = (name, ctx) => {
          if (ctx.type === 'table') {
            return name.toUpperCase()
          }

          return ctx.default
        }

        const result1 = generateFilePath({ id: 1, name: 'users', type: 'table' }, paths, { customSanitize })
        const result2 = generateFilePath({ id: 2, name: 'myFunction', type: 'function' }, paths, { customSanitize })
        expect(result1).to.equal('tables/USERS.xs')
        expect(result2).to.equal('functions/my_function.xs')
      })
    })
  })

  describe('countBlocks', () => {
    it('counts single function block', () => {
      const content = `function my_func {
  // body
}`
      const blocks = countBlocks(content)
      expect(blocks).to.have.length(1)
      expect(blocks[0]).to.deep.include({ keyword: 'function', name: 'my_func' })
    })

    it('counts single workflow_test block with quoted name', () => {
      const content = `workflow_test "My Test Case" {
  // body
}`
      const blocks = countBlocks(content)
      expect(blocks).to.have.length(1)
      expect(blocks[0]).to.deep.include({ keyword: 'workflow_test', name: 'My Test Case' })
    })

    it('detects multiple workflow_test blocks', () => {
      const content = `workflow_test "First Test" {
  // test 1
}

workflow_test "Second Test" {
  // test 2
}`
      const blocks = countBlocks(content)
      expect(blocks).to.have.length(2)
      expect(blocks[0]).to.deep.include({ keyword: 'workflow_test', name: 'First Test' })
      expect(blocks[1]).to.deep.include({ keyword: 'workflow_test', name: 'Second Test' })
    })

    it('detects multiple different block types', () => {
      const content = `function helper {
  // helper
}

workflow_test "Test" {
  // test
}`
      const blocks = countBlocks(content)
      expect(blocks).to.have.length(2)
      expect(blocks[0].keyword).to.equal('function')
      expect(blocks[1].keyword).to.equal('workflow_test')
    })

    it('ignores nested keywords inside blocks', () => {
      const content = `function outer {
  // This is not a real block:
  // function inner { }
  var x = "function fake { }"
}`
      const blocks = countBlocks(content)
      expect(blocks).to.have.length(1)
      expect(blocks[0].keyword).to.equal('function')
    })

    it('ignores api_group property assignment inside query block', () => {
      const content = `query POST /users {
  api_group = "User Management"

  input {
    text user_id
  }

  response = {
    success: true
  }
}`
      const blocks = countBlocks(content)
      expect(blocks).to.have.length(1)
      expect(blocks[0].keyword).to.equal('query')
    })

    it('ignores property assignments that look like block keywords (regression test)', () => {
      // Regression test: api_group = "..." property assignments inside query blocks
      // were incorrectly detected as separate api_group blocks
      const content = `// List items endpoint
query items verb=GET {
  api_group = "Public API"
  auth = "users"

  input {
    bool? active_only?
  }

  stack {
    var $filter {
      value = $input.active_only ?? false
    }
  }

  response = {items: []}
}`
      const blocks = countBlocks(content)
      expect(blocks).to.have.length(1)
      expect(blocks[0].keyword).to.equal('query')
      expect(blocks[0].name).to.equal('items')
    })

    it('ignores function calls inside stack blocks', () => {
      const content = `query POST /auth/login {
  stack {
    function validate_input input={email: $input.email} {
    }

    function create_session input={user_id: $var.user.id} {
    }
  }

  response = $var.token
}`
      const blocks = countBlocks(content)
      expect(blocks).to.have.length(1)
      expect(blocks[0].keyword).to.equal('query')
    })

    it('handles nested object literals with braces', () => {
      const content = `query GET /test {
  response = {
    data: {
      nested: {
        value: 1
      }
    }
  }
}`
      const blocks = countBlocks(content)
      expect(blocks).to.have.length(1)
      expect(blocks[0].keyword).to.equal('query')
    })

    it('handles backtick expressions with braces (potential false positive)', () => {
      // If XanoScript uses backticks for expressions, braces inside might throw off tracking
      // eslint-disable-next-line no-template-curly-in-string
      const content = "query GET /test {\n  message = `Value: ${var.x}`\n  response = {\n    ok: true\n  }\n}"
      const blocks = countBlocks(content)
      expect(blocks).to.have.length(1)
      expect(blocks[0].keyword).to.equal('query')
    })

    it('handles closing brace in string that could reset depth', () => {
      const content = `query GET /test {
  message = "}"
  function_name = "something"
  response = true
}`
      const blocks = countBlocks(content)
      expect(blocks).to.have.length(1)
      expect(blocks[0].keyword).to.equal('query')
    })

    it('handles comments before first block', () => {
      const content = `// This is a comment
// Another comment

workflow_test "Test" {
  // body
}`
      const blocks = countBlocks(content)
      expect(blocks).to.have.length(1)
      expect(blocks[0]).to.deep.include({ keyword: 'workflow_test', name: 'Test' })
    })

    it('returns empty array for empty content', () => {
      expect(countBlocks('')).to.have.length(0)
    })

    it('returns empty array for comment-only content', () => {
      expect(countBlocks('// just a comment')).to.have.length(0)
    })

    it('includes line numbers', () => {
      const content = `// comment
workflow_test "First" {
}

workflow_test "Second" {
}`
      const blocks = countBlocks(content)
      expect(blocks[0].line).to.equal(2)
      expect(blocks[1].line).to.equal(5)
    })
  })

  describe('validateSingleBlock', () => {
    it('returns null for valid single block', () => {
      const content = `function my_func {
  // body
}`
      expect(validateSingleBlock(content)).to.be.null
    })

    it('returns error for multiple blocks', () => {
      const content = `workflow_test "First" {
}

workflow_test "Second" {
}`
      const error = validateSingleBlock(content)
      expect(error).to.not.be.null
      expect(error).to.include('Multiple XanoScript blocks')
      expect(error).to.include('First')
      expect(error).to.include('Second')
      expect(error).to.include('Split into separate files')
    })

    it('returns error for empty content', () => {
      const error = validateSingleBlock('')
      expect(error).to.not.be.null
      expect(error).to.include('No valid XanoScript block found')
    })

    it('returns error for comment-only content', () => {
      const error = validateSingleBlock('// just a comment')
      expect(error).to.not.be.null
      expect(error).to.include('No valid XanoScript block found')
    })
  })
})
