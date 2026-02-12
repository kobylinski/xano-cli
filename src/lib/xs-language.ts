/**
 * Shared library wrapping @xano/xanoscript-language-server
 * for parsing, lexing, and documentation lookup.
 *
 * All providers are lazily initialized on first use.
 */

// @ts-expect-error - no TypeScript types available
import { lexDocument } from '@xano/xanoscript-language-server/lexer/lexer.js'
// @ts-expect-error - no TypeScript types available
import { FilterMessageProvider } from '@xano/xanoscript-language-server/onHover/FilterMessageProvider.js'
// @ts-expect-error - no TypeScript types available
import { FunctionMessageProvider } from '@xano/xanoscript-language-server/onHover/FunctionMessageProvider.js'
// @ts-expect-error - no TypeScript types available
import { InputFilterMessageProvider } from '@xano/xanoscript-language-server/onHover/InputFilterMessageProvider.js'
// @ts-expect-error - no TypeScript types available
import { QueryFilterMessageProvider } from '@xano/xanoscript-language-server/onHover/queryFilterMessageProvider.js'
// @ts-expect-error - no TypeScript types available
import { xanoscriptParser } from '@xano/xanoscript-language-server/parser/parser.js'
// @ts-expect-error - no TypeScript types available
import { getSchemeFromContent } from '@xano/xanoscript-language-server/utils.js'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

// ── Types ──────────────────────────────────────────────────────────

export interface XsDiagnostic {
  column: number
  line: number
  message: string
  severity: 'error' | 'hint' | 'info' | 'warning'
}

export interface XsInputEntry {
  iterable: boolean
  nullable: boolean
  optional: boolean
  type: string
}

export interface XsVarEntry {
  type: string
  value: unknown
}

export interface XsParseResult {
  diagnostics: {
    errors: XsDiagnostic[]
    hints: XsDiagnostic[]
    informations: XsDiagnostic[]
    warnings: XsDiagnostic[]
  }
  rawTokens: any[] // eslint-disable-line @typescript-eslint/no-explicit-any
  scheme: string
  symbolTable: {
    input: Record<string, XsInputEntry>
    var: Record<string, XsVarEntry>
  }
}

export interface XsFunctionCall {
  column: number
  line: number
  name: string
}

export interface XsVariableRef {
  column: number
  line: number
  name: string
}

export interface XsDbRef {
  column: number
  line: number
  operation: string
  table: string
}

export interface XsFunctionRunRef {
  column: number
  line: number
  name: string
}

export interface XsAgentRunRef {
  column: number
  line: number
  name: string
}

export interface XsToolRef {
  column: number
  line: number
  name: string
}

export interface XsDocEntry {
  body: string
  category: 'filter' | 'function' | 'input_filter' | 'query_filter'
  name: string
}

// ── Lazy-initialized providers ─────────────────────────────────────

let functionProvider: any // eslint-disable-line @typescript-eslint/no-explicit-any
let filterProvider: any // eslint-disable-line @typescript-eslint/no-explicit-any
let inputFilterProvider: any // eslint-disable-line @typescript-eslint/no-explicit-any
let queryFilterProvider: any // eslint-disable-line @typescript-eslint/no-explicit-any

function getPackageDir(): string {
  const require = createRequire(import.meta.url)
  const pkgPath = require.resolve('@xano/xanoscript-language-server/package.json')
  return dirname(pkgPath)
}

function loadMd(filename: string): string {
  const pkgDir = getPackageDir()
  return readFileSync(join(pkgDir, 'onHover', filename), 'utf8')
}

function ensureProviders(): void {
  if (functionProvider) return

  functionProvider = new FunctionMessageProvider(loadMd('functions.md'))
  filterProvider = new FilterMessageProvider(loadMd('filters.md'))
  inputFilterProvider = new InputFilterMessageProvider(loadMd('inputFilters.md'))
  queryFilterProvider = new QueryFilterMessageProvider(loadMd('queryFilters.md'))
}

// ── Helpers ────────────────────────────────────────────────────────

function getLineAndColumn(content: string, offset: number): { column: number; line: number } {
  const lines = content.slice(0, offset).split('\n')
  return {
    column: (lines.at(-1)?.length ?? 0) + 1,
    line: lines.length,
  }
}

interface ParseError {
  message: string
  token?: {
    endOffset: number
    startOffset: number
  }
}

function collectDiagnostics(
  items: ParseError[],
  severity: XsDiagnostic['severity'],
  content: string,
): XsDiagnostic[] {
  return items.map((item) => {
    const pos = item.token
      ? getLineAndColumn(content, item.token.startOffset)
      : { column: 1, line: 1 }
    return {
      column: pos.column,
      line: pos.line,
      message: item.message,
      severity,
    }
  })
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Detect the XanoScript scheme from source text.
 */
export function detectScheme(text: string): string {
  return getSchemeFromContent(text) as string
}

/**
 * Parse XanoScript text, returning structured analysis.
 */
export function parseXanoScript(text: string, scheme?: string): XsParseResult {
  const resolvedScheme = scheme ?? detectScheme(text)
  const lexResult = lexDocument(text)
  const parser = xanoscriptParser(text, resolvedScheme, lexResult)

  return {
    diagnostics: {
      errors: collectDiagnostics(parser.errors ?? [], 'error', text),
      hints: collectDiagnostics(parser.hints ?? [], 'hint', text),
      informations: collectDiagnostics(parser.informations ?? [], 'info', text),
      warnings: collectDiagnostics(parser.warnings ?? [], 'warning', text),
    },
    rawTokens: lexResult.tokens,
    scheme: resolvedScheme,
    symbolTable: {
      input: parser.__symbolTable?.input ?? {},
      var: parser.__symbolTable?.var ?? {},
    },
  }
}

/**
 * Extract function calls (db.query, math.add, etc.) from raw lexer tokens.
 * Uses FunctionMessageProvider.findFunction to walk backward through dot-separated tokens.
 */
export function extractFunctionCalls(rawTokens: any[]): XsFunctionCall[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  ensureProviders()

  const calls: XsFunctionCall[] = []
  const seen = new Set<string>() // dedupe by "name:startLine:startColumn"

  for (let i = 0; i < rawTokens.length; i++) {
    const next = rawTokens[i + 1]
    // Skip if next token is a dot - we wait for the last segment
    if (next && next.image === '.') continue

    const fnName = functionProvider.findFunction(i, rawTokens)
    if (fnName) {
      const token = rawTokens[i]
      const line = token.startLine ?? 0
      const column = token.startColumn ?? 0
      const key = `${fnName}:${line}:${column}`
      if (!seen.has(key)) {
        seen.add(key)
        calls.push({ column, line, name: fnName })
      }
    }
  }

  return calls
}

/**
 * Extract $variable references from raw lexer tokens.
 */
export function extractVariableRefs(rawTokens: any[]): XsVariableRef[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  const refs: XsVariableRef[] = []

  for (const token of rawTokens) {
    if (token.image && token.image.startsWith('$')) {
      refs.push({
        column: token.startColumn ?? 0,
        line: token.startLine ?? 0,
        name: token.image,
      })
    }
  }

  return refs
}

/**
 * Look up documentation for a specific function, filter, or language construct.
 * Searches providers in order: functions -> filters -> input filters -> query filters.
 */
export function lookupDoc(name: string): null | XsDocEntry {
  ensureProviders()

  // Check functions (dot-separated names like db.query)
  if (functionProvider.__functionDoc[name]) {
    return {
      body: functionProvider.__functionDoc[name],
      category: 'function',
      name,
    }
  }

  // Check filters
  if (filterProvider.__filterDoc[name]) {
    return {
      body: filterProvider.__filterDoc[name],
      category: 'filter',
      name,
    }
  }

  // Check input filters
  if (inputFilterProvider.__filterDoc[name]) {
    return {
      body: inputFilterProvider.__filterDoc[name],
      category: 'input_filter',
      name,
    }
  }

  // Check query filters
  if (queryFilterProvider.__filterDoc[name]) {
    return {
      body: queryFilterProvider.__filterDoc[name],
      category: 'query_filter',
      name,
    }
  }

  return null
}

/**
 * Search documentation by prefix.
 * e.g., "db" returns all db.* functions.
 */
export function searchDocs(prefix: string): XsDocEntry[] {
  ensureProviders()

  const results: XsDocEntry[] = []
  const dotPrefix = prefix + '.'

  // Search functions
  for (const name of Object.keys(functionProvider.__functionDoc)) {
    if (name === prefix || name.startsWith(dotPrefix)) {
      results.push({
        body: functionProvider.__functionDoc[name],
        category: 'function',
        name,
      })
    }
  }

  // Search filters
  for (const name of Object.keys(filterProvider.__filterDoc)) {
    if (name === prefix || name.startsWith(dotPrefix)) {
      results.push({
        body: filterProvider.__filterDoc[name],
        category: 'filter',
        name,
      })
    }
  }

  // Search input filters
  for (const name of Object.keys(inputFilterProvider.__filterDoc)) {
    if (name === prefix || name.startsWith(dotPrefix)) {
      results.push({
        body: inputFilterProvider.__filterDoc[name],
        category: 'input_filter',
        name,
      })
    }
  }

  // Search query filters
  for (const name of Object.keys(queryFilterProvider.__filterDoc)) {
    if (name === prefix || name.startsWith(dotPrefix)) {
      results.push({
        body: queryFilterProvider.__filterDoc[name],
        category: 'query_filter',
        name,
      })
    }
  }

  return results.sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Get the first line of prose from a doc body (skipping code blocks).
 */
export function getDocSummary(body: string): string {
  const lines = body.split('\n')
  let inCodeBlock = false

  for (const line of lines) {
    if (line.trimStart().startsWith('```')) {
      inCodeBlock = !inCodeBlock
      continue
    }

    if (!inCodeBlock) {
      const trimmed = line.trim()
      if (trimmed.length > 0) {
        return trimmed.length > 80 ? trimmed.slice(0, 77) + '...' : trimmed
      }
    }
  }

  return ''
}

const DB_OPERATIONS = new Set([
  'add', 'add_or_edit', 'del', 'edit', 'get', 'get_all', 'query', 'query_all',
])

/**
 * Extract database operation references (db.query, db.add, etc.) from raw lexer tokens.
 * Walks the token stream looking for `db` `.` `<operation>` `<tablename>` patterns.
 */
export function extractDbRefs(rawTokens: any[]): XsDbRef[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  const refs: XsDbRef[] = []

  for (let i = 0; i < rawTokens.length; i++) {
    const token = rawTokens[i]
    if (token.image !== 'db') continue

    // Expect: db . <operation> <tablename>
    const dot = rawTokens[i + 1]
    if (!dot || dot.image !== '.') continue

    const opToken = rawTokens[i + 2]
    if (!opToken || !DB_OPERATIONS.has(opToken.image)) continue

    // Find the next non-whitespace identifier token after the operation
    let tableToken = null
    for (let j = i + 3; j < rawTokens.length && j <= i + 6; j++) {
      const t = rawTokens[j]
      // Skip whitespace tokens (no image or whitespace-only)
      if (!t.image || t.image.trim() === '') continue
      // Skip punctuation
      if (t.image === '(' || t.image === ')' || t.image === '{' || t.image === '}') break
      // This should be the table name identifier
      tableToken = t
      break
    }

    if (tableToken && tableToken.image && /^[a-zA-Z_]\w*$/.test(tableToken.image)) {
      refs.push({
        column: token.startColumn ?? 0,
        line: token.startLine ?? 0,
        operation: opToken.image,
        table: tableToken.image,
      })
    }
  }

  return refs
}

/**
 * Extract function.run references from raw lexer tokens.
 * Walks tokens looking for `function` `.` `run` `"path/name"` patterns.
 */
export function extractFunctionRunRefs(rawTokens: any[]): XsFunctionRunRef[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  const refs: XsFunctionRunRef[] = []

  for (let i = 0; i < rawTokens.length; i++) {
    const token = rawTokens[i]
    if (token.image !== 'function') continue

    // Expect: function . run "name"
    const dot = rawTokens[i + 1]
    if (!dot || dot.image !== '.') continue

    const runToken = rawTokens[i + 2]
    if (!runToken || runToken.image !== 'run') continue

    // Find the next string literal token (starts and ends with ")
    let nameToken = null
    for (let j = i + 3; j < rawTokens.length && j <= i + 6; j++) {
      const t = rawTokens[j]
      if (!t.image || t.image.trim() === '') continue
      if (t.image.startsWith('"') && t.image.endsWith('"') && t.image.length > 1) {
        nameToken = t
        break
      }

      // Also accept unquoted identifiers (some function.run calls may use identifiers)
      if (/^[a-zA-Z_][\w/]*$/.test(t.image)) {
        nameToken = t
        break
      }

      break
    }

    if (nameToken) {
      // Strip quotes if present
      const name = nameToken.image.startsWith('"')
        ? nameToken.image.slice(1, -1)
        : nameToken.image

      refs.push({
        column: token.startColumn ?? 0,
        line: token.startLine ?? 0,
        name,
      })
    }
  }

  return refs
}

/**
 * Extract ai.agent.run references from raw lexer tokens.
 * Walks tokens looking for `ai` `.` `agent` `.` `run` `"name"` patterns.
 */
export function extractAgentRunRefs(rawTokens: any[]): XsAgentRunRef[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  const refs: XsAgentRunRef[] = []

  for (let i = 0; i < rawTokens.length; i++) {
    const token = rawTokens[i]
    if (token.image !== 'ai') continue

    // Expect: ai . agent . run "name"
    const dot1 = rawTokens[i + 1]
    if (!dot1 || dot1.image !== '.') continue

    const agentToken = rawTokens[i + 2]
    if (!agentToken || agentToken.image !== 'agent') continue

    const dot2 = rawTokens[i + 3]
    if (!dot2 || dot2.image !== '.') continue

    const runToken = rawTokens[i + 4]
    if (!runToken || runToken.image !== 'run') continue

    // Find the next string literal token
    let nameToken = null
    for (let j = i + 5; j < rawTokens.length && j <= i + 8; j++) {
      const t = rawTokens[j]
      if (!t.image || t.image.trim() === '') continue
      if (t.image.startsWith('"') && t.image.endsWith('"') && t.image.length > 1) {
        nameToken = t
        break
      }

      break
    }

    if (nameToken) {
      const name = nameToken.image.slice(1, -1) // Strip quotes
      refs.push({
        column: token.startColumn ?? 0,
        line: token.startLine ?? 0,
        name,
      })
    }
  }

  return refs
}

/**
 * Extract tool references from agent's tools array.
 * Looks for `tools` `=` `[` ... `{` `name` `:` `"toolname"` `}` ... `]` patterns.
 */
export function extractToolRefs(rawTokens: any[]): XsToolRef[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  const refs: XsToolRef[] = []
  let inToolsArray = false
  let bracketDepth = 0

  for (let i = 0; i < rawTokens.length; i++) {
    const token = rawTokens[i]

    // Look for `tools` `=` `[`
    if (token.image === 'tools') {
      const eq = rawTokens[i + 1]
      const bracket = rawTokens[i + 2]
      if (eq?.image === '=' && bracket?.image === '[') {
        inToolsArray = true
        bracketDepth = 1
        i += 2
        continue
      }
    }

    if (!inToolsArray) continue

    // Track bracket depth
    if (token.image === '[') {
      bracketDepth++
    } else if (token.image === ']') {
      bracketDepth--
      if (bracketDepth === 0) {
        inToolsArray = false
      }
    }

    // Look for `name` `:` `"toolname"` inside tools array
    if (token.image === 'name') {
      const colon = rawTokens[i + 1]
      if (colon?.image === ':') {
        // Find the string value
        for (let j = i + 2; j < rawTokens.length && j <= i + 4; j++) {
          const t = rawTokens[j]
          if (!t.image || t.image.trim() === '') continue
          if (t.image.startsWith('"') && t.image.endsWith('"') && t.image.length > 1) {
            const name = t.image.slice(1, -1) // Strip quotes
            refs.push({
              column: token.startColumn ?? 0,
              line: token.startLine ?? 0,
              name,
            })
            break
          }

          break
        }
      }
    }
  }

  return refs
}
