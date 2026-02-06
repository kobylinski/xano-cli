import { Args, Flags } from '@oclif/core'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import type { XsInputEntry } from '../../lib/xs-language.js'

import BaseCommand, { isAgentMode } from '../../base-command.js'
import { detectType, extractName } from '../../lib/detector.js'
import { findProjectRoot } from '../../lib/project.js'
import { resolveAllRefs, resolveIdentifier } from '../../lib/xs-resolver.js'

// Lazy-loaded heavy module (~2s startup cost)
let xsLanguage: null | typeof import('../../lib/xs-language.js') = null
let xsLanguageLoadTime = 0
async function getXsLanguage() {
  if (!xsLanguage) {
    const t0 = performance.now()
    xsLanguage = await import('../../lib/xs-language.js')
    xsLanguageLoadTime = performance.now() - t0
  }

  return xsLanguage
}

function getXsLanguageLoadTime(): number {
  return xsLanguageLoadTime
}

export default class Explain extends BaseCommand {
  static args = {
    keyword: Args.string({
      description: 'Function, filter, language construct, or workspace object to look up',
      required: true,
    }),
  }
  static description = 'Look up documentation for XanoScript builtins or resolve workspace objects with context'
  static examples = [
    '<%= config.bin %> explain db.query',
    '<%= config.bin %> explain trim',
    '<%= config.bin %> explain stack',
    '<%= config.bin %> explain db',
    '<%= config.bin %> explain brands_POST',
    '<%= config.bin %> explain db.query --builtin',
    '<%= config.bin %> explain db.query --json',
  ]
  static flags = {
    ...BaseCommand.baseFlags,
    builtin: Flags.boolean({
      default: false,
      description: 'Force static doc lookup only (skip workspace resolution)',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Explain)
    const { keyword } = args
    const agentMode = isAgentMode(flags.agent)
    const timing = flags.verbose >= 2

    const t0 = timing ? performance.now() : 0

    // 1. Builtin match (dot-separated names or --builtin flag)
    // Only load heavy xs-language module if we need builtins
    if (flags.builtin || keyword.includes('.')) {
      const { getDocSummary, lookupDoc, searchDocs } = await getXsLanguage()
      if (timing) console.error(`[timing] xs-language load: ${getXsLanguageLoadTime().toFixed(0)}ms`)
      const doc = lookupDoc(keyword)
      if (doc) {
        this.outputBuiltinDoc(doc, keyword, agentMode, flags.json)
        return
      }

      // Try prefix search for builtins only
      const prefixResults = searchDocs(keyword)
      if (prefixResults.length > 0) {
        this.outputPrefixResults(prefixResults, keyword, agentMode, flags.json, getDocSummary)
        return
      }

      if (flags.builtin) {
        this.outputNotFound(keyword, agentMode)
        return
      }
    }

    // 2. Workspace resolution
    const projectRoot = findProjectRoot()
    if (timing) console.error(`[timing] findProjectRoot: ${(performance.now() - t0).toFixed(0)}ms`)

    if (projectRoot) {
      const t1 = timing ? performance.now() : 0
      const resolved = resolveIdentifier(keyword, projectRoot)
      if (timing) console.error(`[timing] resolveIdentifier: ${(performance.now() - t1).toFixed(0)}ms`)

      if (resolved.length > 0) {
        const best = resolved[0]
        const fullPath = join(projectRoot, best.filePath)
        if (existsSync(fullPath)) {
          const t2 = timing ? performance.now() : 0
          const content = readFileSync(fullPath, 'utf8')
          if (timing) console.error(`[timing] readFile: ${(performance.now() - t2).toFixed(0)}ms`)

          await this.outputWorkspaceContext(best, content, projectRoot, agentMode, flags.json, timing)
          return
        }
      }
    }

    // 3. Builtin exact match and prefix search (non-dot-separated, checked after workspace)
    // Only load heavy module now if we didn't find in workspace
    const { getDocSummary, lookupDoc, searchDocs } = await getXsLanguage()
    if (timing) console.error(`[timing] xs-language load: ${getXsLanguageLoadTime().toFixed(0)}ms`)
    const doc = lookupDoc(keyword)
    if (doc) {
      this.outputBuiltinDoc(doc, keyword, agentMode, flags.json)
      return
    }

    // 4. Prefix search
    const results = searchDocs(keyword)
    if (results.length > 0) {
      this.outputPrefixResults(results, keyword, agentMode, flags.json, getDocSummary)
      return
    }

    // Nothing found
    this.outputNotFound(keyword, agentMode)
  }

  private formatInputAttrs(info: XsInputEntry): string {
    const attrs: string[] = []
    if (info.optional) attrs.push('optional')
    if (info.nullable) attrs.push('nullable')
    if (info.iterable) attrs.push('iterable')
    if (attrs.length === 0) return ' (required)'
    return ` (${attrs.join(', ')})`
  }

  private outputBuiltinDoc(
    doc: { body: string; category: string; name: string },
    keyword: string,
    agentMode: boolean,
    json: boolean,
  ): void {
    if (json) {
      this.log(JSON.stringify({
        body: doc.body,
        category: doc.category,
        matchType: 'builtin',
        name: doc.name,
      }, null, 2))
    } else if (agentMode) {
      this.log('AGENT_EXPLAIN:')
      this.log(`name=${doc.name}`)
      this.log(`category=${doc.category}`)
      this.log('match_type=builtin')
      this.log('AGENT_DOC:')
      this.log(doc.body)
      this.log('AGENT_COMPLETE: explain_found')
    } else {
      this.log(`${doc.name} (${doc.category})`)
      this.log('')
      this.log(doc.body)
    }
  }

  private outputNotFound(keyword: string, agentMode: boolean): void {
    if (agentMode) {
      this.log('AGENT_EXPLAIN:')
      this.log(`query=${keyword}`)
      this.log('match_type=none')
      this.log('AGENT_MESSAGE: No documentation or workspace object found for this keyword.')
      this.log('AGENT_SUGGEST: Check spelling or try a broader prefix (e.g., "db" instead of "db.querx").')
    } else {
      this.error(`No documentation or workspace object found for "${keyword}". Try a broader search like "db" or "math", or a workspace object name.`)
    }
  }

  private outputPrefixResults(
    results: Array<{ body: string; category: string; name: string }>,
    keyword: string,
    agentMode: boolean,
    json: boolean,
    getDocSummary: (body: string) => string,
  ): void {
    if (json) {
      this.log(JSON.stringify({
        matchType: 'prefix',
        query: keyword,
        results: results.map(r => ({
          category: r.category,
          name: r.name,
          summary: getDocSummary(r.body),
        })),
      }, null, 2))
    } else if (agentMode) {
      this.log('AGENT_EXPLAIN:')
      this.log(`query=${keyword}`)
      this.log('match_type=prefix')
      this.log(`results=${results.length}`)
      this.log('AGENT_RESULTS:')
      for (const r of results) {
        const summary = getDocSummary(r.body)
        this.log(`- ${r.name} (${r.category}): ${summary}`)
      }

      this.log('AGENT_COMPLETE: explain_list')
    } else {
      this.log(`${results.length} results for "${keyword}":`)
      this.log('')
      for (const r of results) {
        const summary = getDocSummary(r.body)
        this.log(`  ${r.name.padEnd(30)} ${summary}`)
      }

      this.log('')
      this.log(`Use "xano explain ${results[0].name}" for full documentation.`)
    }
  }

  private async outputWorkspaceContext(
    resolved: { filePath: string; matchType: string; name: string; type: null | string },
    content: string,
    projectRoot: string,
    agentMode: boolean,
    json: boolean,
    timing = false,
  ): Promise<void> {
    const {
      extractDbRefs,
      extractFunctionCalls,
      extractFunctionRunRefs,
      parseXanoScript,
    } = await getXsLanguage()
    if (timing) console.error(`[timing] xs-language load: ${getXsLanguageLoadTime().toFixed(0)}ms`)

    const t0 = timing ? performance.now() : 0
    const result = parseXanoScript(content)
    if (timing) console.error(`[timing] parseXanoScript: ${(performance.now() - t0).toFixed(0)}ms`)

    const objectType = detectType(content) || resolved.type
    const objectName = extractName(content) || resolved.name
    const inputs = Object.entries(result.symbolTable.input)
    const vars = Object.entries(result.symbolTable.var)
    const calls = extractFunctionCalls(result.rawTokens)

    const t1 = timing ? performance.now() : 0
    const dbRefs = extractDbRefs(result.rawTokens)
    const functionRunRefs = extractFunctionRunRefs(result.rawTokens)
    if (timing) console.error(`[timing] extractRefs: ${(performance.now() - t1).toFixed(0)}ms`)

    const t2 = timing ? performance.now() : 0
    const { dbPaths, functionPaths } = resolveAllRefs(dbRefs, functionRunRefs, projectRoot)
    if (timing) console.error(`[timing] resolveAllRefs: ${(performance.now() - t2).toFixed(0)}ms`)

    const { errors, hints, warnings } = result.diagnostics

    if (json) {
      this.log(JSON.stringify({
        calls,
        dbRefs: dbRefs.map((ref, i) => ({
          ...ref,
          resolvedPath: dbPaths.get(i) ?? null,
        })),
        diagnostics: result.diagnostics,
        file: resolved.filePath,
        functionRunRefs: functionRunRefs.map((ref, i) => ({
          ...ref,
          resolvedPath: functionPaths.get(i) ?? null,
        })),
        inputs: result.symbolTable.input,
        matchType: 'workspace',
        name: objectName,
        type: objectType,
        variables: result.symbolTable.var,
      }, null, 2))
      return
    }

    if (agentMode) {
      this.log('AGENT_EXPLAIN:')
      this.log(`name=${objectName}`)
      if (objectType) this.log(`type=${objectType}`)
      this.log(`file=${resolved.filePath}`)
      this.log('match_type=workspace')

      if (inputs.length > 0) {
        this.log('AGENT_INPUTS:')
        for (const [name, info] of inputs) {
          const attrs = this.formatInputAttrs(info)
          this.log(`- ${name}: ${info.type}${attrs}`)
        }
      }

      if (vars.length > 0) {
        this.log('AGENT_VARIABLES:')
        for (const [name, info] of vars) {
          const val = info.value !== null && info.value !== undefined ? ` = ${JSON.stringify(info.value)}` : ''
          this.log(`- ${name}: ${info.type}${val}`)
        }
      }

      if (dbRefs.length > 0) {
        this.log('AGENT_DB_REFS:')
        for (const [i, ref] of dbRefs.entries()) {
          const path = dbPaths.get(i)
          const arrow = path ? ` \u2192 ${path}` : ''
          this.log(`- ${ref.operation} ${ref.table} (line ${ref.line})${arrow}`)
        }
      }

      if (functionRunRefs.length > 0) {
        this.log('AGENT_FUNCTION_REFS:')
        for (const [i, ref] of functionRunRefs.entries()) {
          const path = functionPaths.get(i)
          const arrow = path ? ` \u2192 ${path}` : ''
          this.log(`- "${ref.name}" (line ${ref.line})${arrow}`)
        }
      }

      this.log('AGENT_COMPLETE: explain_resolved')
      return
    }

    // Human output
    this.log(`${objectName} (${objectType || 'unknown'})`)
    this.log(`File: ${resolved.filePath}`)

    if (inputs.length > 0) {
      this.log('')
      this.log('Inputs:')
      for (const [name, info] of inputs) {
        const attrs = this.formatInputAttrs(info)
        const pad = Math.max(0, 16 - name.length)
        this.log(`  ${info.type.padEnd(8)} ${name}${' '.repeat(pad)}${attrs}`)
      }
    }

    if (vars.length > 0) {
      this.log('')
      this.log('Variables:')
      for (const [name, info] of vars) {
        const val = info.value !== null && info.value !== undefined ? ` = ${JSON.stringify(info.value)}` : ''
        this.log(`  ${name.padEnd(16)} ${info.type}${val}`)
      }
    }

    if (dbRefs.length > 0 || functionRunRefs.length > 0) {
      this.log('')
      this.log('Cross-References:')
      for (const [i, ref] of dbRefs.entries()) {
        const path = dbPaths.get(i)
        const arrow = path ? ` \u2192 ${path}` : ''
        this.log(`  db.${ref.operation} ${ref.table} (line ${ref.line})${arrow}`)
      }

      for (const [i, ref] of functionRunRefs.entries()) {
        const path = functionPaths.get(i)
        const arrow = path ? ` \u2192 ${path}` : ''
        this.log(`  function.run "${ref.name}" (line ${ref.line})${arrow}`)
      }
    }

    this.log('')
    this.log(`Diagnostics: ${errors.length} errors, ${warnings.length} warnings, ${hints.length} hints`)
  }
}
