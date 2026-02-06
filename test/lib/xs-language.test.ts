import { expect } from 'chai'

import {
  detectScheme,
  extractDbRefs,
  extractFunctionCalls,
  extractFunctionRunRefs,
  extractVariableRefs,
  getDocSummary,
  lookupDoc,
  parseXanoScript,
  searchDocs,
} from '../../src/lib/xs-language.js'

describe('lib/xs-language', () => {
  describe('detectScheme', () => {
    it('detects function scheme', () => {
      expect(detectScheme('function test { }')).to.equal('cfn')
    })

    it('detects query (api) scheme', () => {
      expect(detectScheme('query GET /users { }')).to.equal('api')
    })

    it('detects table scheme', () => {
      expect(detectScheme('table users { }')).to.equal('db')
    })

    it('detects task scheme', () => {
      expect(detectScheme('task cleanup { }')).to.equal('task')
    })

    it('detects api_group scheme', () => {
      expect(detectScheme('api_group users { }')).to.equal('api_group')
    })

    it('detects table_trigger scheme', () => {
      expect(detectScheme('table_trigger audit on users after_insert { }')).to.equal('table_trigger')
    })

    it('skips comments', () => {
      expect(detectScheme('// comment\nfunction test { }')).to.equal('cfn')
    })

    it('defaults to cfn for unknown', () => {
      expect(detectScheme('unknown_keyword test { }')).to.equal('cfn')
    })
  })

  describe('parseXanoScript', () => {
    it('parses a simple function with inputs', () => {
      const result = parseXanoScript(`function test_expect {
  input {
    int a
    int b
  }

  stack {
    var $sum {
      value = $input.a
    }
    math.add $sum {
      value = $input.b
    }
  }

  response = $sum
}`)
      expect(result.scheme).to.equal('cfn')
      expect(result.symbolTable.input).to.have.property('a')
      expect(result.symbolTable.input.a.type).to.equal('int')
      expect(result.symbolTable.input).to.have.property('b')
      expect(result.symbolTable.input.b.type).to.equal('int')
      expect(result.diagnostics.errors).to.have.length(0)
      expect(result.rawTokens).to.be.an('array').that.is.not.empty
    })

    it('returns errors for invalid syntax', () => {
      const result = parseXanoScript('function test { invalid!!! }')
      const totalIssues = result.diagnostics.errors.length + result.diagnostics.warnings.length
      expect(totalIssues).to.be.greaterThan(0)
    })

    it('detects nullable and optional input parameters', () => {
      const result = parseXanoScript(`function my_func {
  input {
    text username
    int? age?
  }
  stack {
    var $result {
      value = $input.username
    }
  }
  response = $result
}`)
      expect(result.symbolTable.input).to.have.property('username')
      expect(result.symbolTable.input.username.type).to.equal('text')
      expect(result.symbolTable.input.username.nullable).to.be.false
      expect(result.symbolTable.input.username.optional).to.be.false
      expect(result.symbolTable.input).to.have.property('age')
      expect(result.symbolTable.input.age.nullable).to.be.true
      expect(result.symbolTable.input.age.optional).to.be.true
    })

    it('accepts explicit scheme parameter', () => {
      const result = parseXanoScript(`function test {
  input {
    int x
  }
  stack {
    var $r { value = $input.x }
  }
  response = $r
}`, 'cfn')
      expect(result.scheme).to.equal('cfn')
      expect(result.diagnostics.errors).to.have.length(0)
    })

    it('detects variables in symbol table', () => {
      const result = parseXanoScript(`function test {
  input {
    int x
  }
  stack {
    var $counter {
      value = 0
    }
    math.add $counter {
      value = $input.x
    }
  }
  response = $counter
}`)
      expect(result.symbolTable.var).to.have.property('$counter')
    })
  })

  describe('extractFunctionCalls', () => {
    it('extracts function calls from parsed tokens', () => {
      const result = parseXanoScript(`function test {
  input {
    int x
  }
  stack {
    var $r { value = 0 }
    math.add $r { value = $input.x }
  }
  response = $r
}`)
      const calls = extractFunctionCalls(result.rawTokens)
      const names = calls.map(c => c.name)
      expect(names).to.include('math.add')
    })

    it('returns line numbers for calls', () => {
      const result = parseXanoScript(`function test {
  input {
    int x
  }
  stack {
    var $r { value = 0 }
    math.add $r {
      value = $input.x
    }
  }
  response = $r
}`)
      const calls = extractFunctionCalls(result.rawTokens)
      const mathAdd = calls.find(c => c.name === 'math.add')
      expect(mathAdd).to.not.be.undefined
      expect(mathAdd!.line).to.be.greaterThan(0)
      expect(mathAdd!.column).to.be.greaterThan(0)
    })

    it('deduplicates calls at same position', () => {
      const result = parseXanoScript(`function test {
  input {
    int x
  }
  stack {
    var $r { value = 0 }
    math.add $r { value = $input.x }
  }
  response = $r
}`)
      const calls = extractFunctionCalls(result.rawTokens)
      const mathAdds = calls.filter(c => c.name === 'math.add')
      expect(mathAdds.length).to.equal(1)
    })

    it('extracts multiple different function calls', () => {
      const result = parseXanoScript(`function test_expect {
  input {
    int a
    int b
  }

  stack {
    var $sum {
      value = $input.a
    }
    math.add $sum {
      value = $input.b
    }
  }

  response = $sum

  test "should add" {
    input = {a: 20, b: 22}
    expect.to_equal ($response) {
      value = 42
    }
  }
}`)
      const calls = extractFunctionCalls(result.rawTokens)
      const names = calls.map(c => c.name)
      expect(names).to.include('math.add')
      expect(names).to.include('expect.to_equal')
    })
  })

  describe('extractVariableRefs', () => {
    it('extracts $variable references', () => {
      const result = parseXanoScript(`function test {
  input {
    int x
  }
  stack {
    var $result {
      value = $input.x
    }
  }
  response = $result
}`)
      const refs = extractVariableRefs(result.rawTokens)
      const names = refs.map(r => r.name)
      expect(names).to.include('$result')
      expect(names).to.include('$input')
    })

    it('returns line numbers for refs', () => {
      const result = parseXanoScript(`function test {
  input {
    int x
  }
  stack {
    var $r {
      value = $input.x
    }
  }
  response = $r
}`)
      const refs = extractVariableRefs(result.rawTokens)
      expect(refs.length).to.be.greaterThan(0)
      expect(refs[0].line).to.be.greaterThan(0)
    })

    it('finds multiple references to same variable', () => {
      const result = parseXanoScript(`function test {
  input {
    int x
    int y
  }
  stack {
    var $sum {
      value = $input.x
    }
    math.add $sum {
      value = $input.y
    }
  }
  response = $sum
}`)
      const refs = extractVariableRefs(result.rawTokens)
      const inputRefs = refs.filter(r => r.name === '$input')
      expect(inputRefs.length).to.be.greaterThanOrEqual(2)
      const sumRefs = refs.filter(r => r.name === '$sum')
      expect(sumRefs.length).to.be.greaterThanOrEqual(2)
    })
  })

  describe('lookupDoc', () => {
    it('finds a function doc', () => {
      const doc = lookupDoc('stack')
      expect(doc).to.not.be.null
      expect(doc!.category).to.equal('function')
      expect(doc!.name).to.equal('stack')
      expect(doc!.body).to.be.a('string').that.is.not.empty
    })

    it('finds a dot-notation function doc', () => {
      const doc = lookupDoc('math.add')
      expect(doc).to.not.be.null
      expect(doc!.category).to.equal('function')
      expect(doc!.name).to.equal('math.add')
    })

    it('finds a filter doc', () => {
      const doc = lookupDoc('deg2rad')
      expect(doc).to.not.be.null
      expect(doc!.category).to.equal('filter')
      expect(doc!.name).to.equal('deg2rad')
    })

    it('returns null for unknown keyword', () => {
      const doc = lookupDoc('nonexistent_xyz_keyword_12345')
      expect(doc).to.be.null
    })
  })

  describe('searchDocs', () => {
    it('finds functions by prefix', () => {
      const results = searchDocs('db')
      expect(results.length).to.be.greaterThan(0)
      for (const r of results) {
        expect(r.name === 'db' || r.name.startsWith('db.')).to.be.true
      }
    })

    it('finds math functions', () => {
      const results = searchDocs('math')
      expect(results.length).to.be.greaterThan(0)
      const names = results.map(r => r.name)
      expect(names.some(n => n.startsWith('math.'))).to.be.true
    })

    it('returns empty array for no matches', () => {
      const results = searchDocs('nonexistent_xyz_prefix_12345')
      expect(results).to.have.length(0)
    })

    it('results are sorted by name', () => {
      const results = searchDocs('db')
      for (let i = 1; i < results.length; i++) {
        expect(results[i].name.localeCompare(results[i - 1].name)).to.be.greaterThanOrEqual(0)
      }
    })
  })

  describe('getDocSummary', () => {
    it('extracts first prose line', () => {
      const summary = getDocSummary('This is a function.\n\nMore details.')
      expect(summary).to.equal('This is a function.')
    })

    it('skips code blocks', () => {
      const summary = getDocSummary('```xs\ncode here\n```\n\nThe description.')
      expect(summary).to.equal('The description.')
    })

    it('truncates long lines', () => {
      const longLine = 'A'.repeat(100)
      const summary = getDocSummary(longLine)
      expect(summary.length).to.be.lessThanOrEqual(80)
      expect(summary).to.include('...')
    })

    it('returns empty string for empty input', () => {
      expect(getDocSummary('')).to.equal('')
    })

    it('returns empty string for code-only content', () => {
      expect(getDocSummary('```\ncode\n```')).to.equal('')
    })
  })

  describe('extractDbRefs', () => {
    it('extracts db.query references', () => {
      const result = parseXanoScript(`function test {
  input {
    int user_id
  }
  stack {
    var $users {
      value = null
    }
    db.query users $users {
    }
  }
  response = $users
}`)
      const refs = extractDbRefs(result.rawTokens)
      expect(refs.length).to.be.greaterThanOrEqual(1)
      const queryRef = refs.find(r => r.operation === 'query')
      expect(queryRef).to.not.be.undefined
      expect(queryRef!.table).to.equal('users')
    })

    it('extracts db.add references', () => {
      const result = parseXanoScript(`function test {
  input {
    text name
  }
  stack {
    var $record {
      value = null
    }
    db.add orders $record {
      value = {name: $input.name}
    }
  }
  response = $record
}`)
      const refs = extractDbRefs(result.rawTokens)
      const addRef = refs.find(r => r.operation === 'add')
      expect(addRef).to.not.be.undefined
      expect(addRef!.table).to.equal('orders')
    })

    it('extracts multiple db operations', () => {
      const result = parseXanoScript(`function test {
  input {
    int id
  }
  stack {
    var $user {
      value = null
    }
    db.get users $user {
      where = {id: $input.id}
    }
    var $orders {
      value = null
    }
    db.query orders $orders {
    }
  }
  response = $user
}`)
      const refs = extractDbRefs(result.rawTokens)
      expect(refs.length).to.be.greaterThanOrEqual(2)
      const tables = refs.map(r => r.table)
      expect(tables).to.include('users')
      expect(tables).to.include('orders')
    })

    it('returns empty array when no db refs', () => {
      const result = parseXanoScript(`function test {
  input {
    int x
  }
  stack {
    var $r { value = $input.x }
  }
  response = $r
}`)
      const refs = extractDbRefs(result.rawTokens)
      expect(refs).to.have.length(0)
    })

    it('includes line numbers', () => {
      const result = parseXanoScript(`function test {
  input {
    int id
  }
  stack {
    var $r {
      value = null
    }
    db.query accounts $r {
    }
  }
  response = $r
}`)
      const refs = extractDbRefs(result.rawTokens)
      expect(refs.length).to.be.greaterThanOrEqual(1)
      expect(refs[0].line).to.be.greaterThan(0)
      expect(refs[0].column).to.be.greaterThan(0)
    })
  })

  describe('extractFunctionRunRefs', () => {
    it('extracts function.run with quoted name', () => {
      const result = parseXanoScript(`function test {
  stack {
    var $result {
      value = null
    }
    function.run "Discord/GetMessageByID" $result {
    }
  }
  response = $result
}`)
      const refs = extractFunctionRunRefs(result.rawTokens)
      expect(refs.length).to.be.greaterThanOrEqual(1)
      expect(refs[0].name).to.equal('Discord/GetMessageByID')
    })

    it('extracts multiple function.run refs', () => {
      const result = parseXanoScript(`function test {
  stack {
    var $a {
      value = null
    }
    function.run "Auth/ValidateToken" $a {
    }
    var $b {
      value = null
    }
    function.run "Notifications/Send" $b {
    }
  }
  response = $a
}`)
      const refs = extractFunctionRunRefs(result.rawTokens)
      expect(refs.length).to.be.greaterThanOrEqual(2)
      const names = refs.map(r => r.name)
      expect(names).to.include('Auth/ValidateToken')
      expect(names).to.include('Notifications/Send')
    })

    it('returns empty array when no function.run refs', () => {
      const result = parseXanoScript(`function test {
  input {
    int x
  }
  stack {
    var $r { value = $input.x }
    math.add $r { value = 1 }
  }
  response = $r
}`)
      const refs = extractFunctionRunRefs(result.rawTokens)
      expect(refs).to.have.length(0)
    })

    it('includes line numbers', () => {
      const result = parseXanoScript(`function test {
  stack {
    var $r {
      value = null
    }
    function.run "MyFunc" $r {
    }
  }
  response = $r
}`)
      const refs = extractFunctionRunRefs(result.rawTokens)
      expect(refs.length).to.be.greaterThanOrEqual(1)
      expect(refs[0].line).to.be.greaterThan(0)
      expect(refs[0].column).to.be.greaterThan(0)
    })
  })
})
