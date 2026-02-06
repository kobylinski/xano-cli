import { Args, Flags } from '@oclif/core'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, relative, resolve } from 'node:path'

import type { XsDbRef, XsFunctionCall, XsFunctionRunRef, XsInputEntry, XsVariableRef } from '../../lib/xs-language.js'

import BaseCommand, { isAgentMode } from '../../base-command.js'
import { detectType, extractName } from '../../lib/detector.js'
import { findProjectRoot } from '../../lib/project.js'
import {
  extractDbRefs,
  extractFunctionCalls,
  extractFunctionRunRefs,
  extractVariableRefs,
  parseXanoScript,
} from '../../lib/xs-language.js'
import { resolveAllRefs } from '../../lib/xs-resolver.js'

export default class Inspect extends BaseCommand {
  static args = {
    file: Args.string({
      description: 'XanoScript file to inspect',
      required: true,
    }),
  }
  static description = 'Analyze a XanoScript file showing inputs, variables, function calls, and diagnostics'
  static examples = [
    '<%= config.bin %> inspect functions/my_function.xs',
    '<%= config.bin %> inspect functions/my_function.xs --json',
    '<%= config.bin %> inspect functions/my_function.xs --calls',
    '<%= config.bin %> inspect functions/my_function.xs --vars',
    '<%= config.bin %> inspect functions/my_function.xs --inputs',
  ]
  static flags = {
    ...BaseCommand.baseFlags,
    calls: Flags.boolean({
      default: false,
      description: 'Show only function calls',
    }),
    inputs: Flags.boolean({
      default: false,
      description: 'Show only inputs',
    }),
    json: Flags.boolean({
      default: false,
      description: 'Output as JSON',
    }),
    vars: Flags.boolean({
      default: false,
      description: 'Show only variables',
    }),
  }

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Inspect)

    const filePath = resolve(args.file)
    if (!existsSync(filePath)) {
      this.error(`File not found: ${args.file}`)
    }

    if (statSync(filePath).isDirectory()) {
      this.error(`Expected a file, got a directory: ${args.file}`)
    }

    if (!filePath.endsWith('.xs')) {
      this.error(`Expected a .xs file: ${args.file}`)
    }

    const content = readFileSync(filePath, 'utf8')
    const projectRoot = findProjectRoot() || process.cwd()
    const relativePath = relative(projectRoot, filePath)

    // Parse file
    const result = parseXanoScript(content)
    const calls = extractFunctionCalls(result.rawTokens)
    const refs = extractVariableRefs(result.rawTokens)
    const dbRefs = extractDbRefs(result.rawTokens)
    const functionRunRefs = extractFunctionRunRefs(result.rawTokens)
    const objectType = detectType(content)
    const objectName = extractName(content) || basename(filePath, '.xs')

    // Resolve cross-references to file paths
    const { dbPaths, functionPaths } = resolveAllRefs(dbRefs, functionRunRefs, projectRoot)

    // Group variable refs by name
    const refsByName = new Map<string, number[]>()
    for (const ref of refs) {
      const lines = refsByName.get(ref.name) || []
      lines.push(ref.line)
      refsByName.set(ref.name, lines)
    }

    // Determine which sections to show (all if none specified)
    const showAll = !flags.calls && !flags.vars && !flags.inputs
    const showCalls = showAll || flags.calls
    const showVars = showAll || flags.vars
    const showInputs = showAll || flags.inputs
    const showRefs = showAll
    const showDiagnostics = showAll

    const agentMode = isAgentMode(flags.agent)

    if (flags.json) {
      this.outputJson(relativePath, result, calls, refs, refsByName, objectType, objectName, dbRefs, functionRunRefs, dbPaths, functionPaths)
    } else if (agentMode) {
      this.outputAgent(relativePath, result, calls, refs, refsByName, objectType, objectName, showInputs, showVars, showCalls, showRefs, showDiagnostics, dbRefs, functionRunRefs, dbPaths, functionPaths)
    } else {
      this.outputHuman(relativePath, result, calls, refs, refsByName, objectType, objectName, showInputs, showVars, showCalls, showRefs, showDiagnostics, dbRefs, functionRunRefs, dbPaths, functionPaths)
    }
  }

  private formatInputAttrs(info: XsInputEntry): string {
    const attrs: string[] = []
    if (info.optional) attrs.push('optional')
    if (info.nullable) attrs.push('nullable')
    if (info.iterable) attrs.push('iterable')
    if (attrs.length === 0) return ' (required)'
    return ` (${attrs.join(', ')})`
  }

  private outputAgent(
    relativePath: string,
    result: ReturnType<typeof parseXanoScript>,
    calls: XsFunctionCall[],
    _refs: XsVariableRef[],
    refsByName: Map<string, number[]>,
    objectType: null | string,
    objectName: string,
    showInputs: boolean,
    showVars: boolean,
    showCalls: boolean,
    showRefs: boolean,
    showDiagnostics: boolean,
    dbRefs: XsDbRef[] = [],
    functionRunRefs: XsFunctionRunRef[] = [],
    dbPaths: Map<number, string> = new Map(),
    functionPaths: Map<number, string> = new Map(),
  ): void {
    const inputs = Object.entries(result.symbolTable.input)
    const vars = Object.entries(result.symbolTable.var)
    const { errors, warnings } = result.diagnostics

    this.log('AGENT_INSPECT:')
    this.log(`file=${relativePath}`)
    this.log(`scheme=${result.scheme}`)
    if (objectType) this.log(`type=${objectType}`)
    this.log(`name=${objectName}`)
    this.log(`inputs=${inputs.length}`)
    this.log(`variables=${vars.length}`)
    this.log(`calls=${calls.length}`)
    this.log(`errors=${errors.length}`)
    this.log(`warnings=${warnings.length}`)

    if (showInputs && inputs.length > 0) {
      this.log('AGENT_INPUTS:')
      for (const [name, info] of inputs) {
        const attrs = this.formatInputAttrs(info)
        this.log(`- ${name}: ${info.type}${attrs}`)
      }
    }

    if (showVars && vars.length > 0) {
      this.log('AGENT_VARIABLES:')
      for (const [name, info] of vars) {
        const val = info.value !== null && info.value !== undefined ? ` = ${JSON.stringify(info.value)}` : ''
        this.log(`- ${name}: ${info.type}${val}`)
      }
    }

    if (showCalls && calls.length > 0) {
      this.log('AGENT_CALLS:')
      for (const call of calls) {
        this.log(`- ${call.name} (line ${call.line})`)
      }
    }

    if (showRefs && refsByName.size > 0) {
      this.log('AGENT_REFS:')
      for (const [name, lines] of refsByName) {
        this.log(`- ${name}: lines ${lines.join(', ')}`)
      }
    }

    // Cross-references
    if (showRefs && dbRefs.length > 0) {
      this.log('AGENT_DB_REFS:')
      for (const [i, ref] of dbRefs.entries()) {
        const resolved = dbPaths.get(i)
        const arrow = resolved ? ` \u2192 ${resolved}` : ''
        this.log(`- ${ref.operation} ${ref.table} (line ${ref.line})${arrow}`)
      }
    }

    if (showRefs && functionRunRefs.length > 0) {
      this.log('AGENT_FUNCTION_REFS:')
      for (const [i, ref] of functionRunRefs.entries()) {
        const resolved = functionPaths.get(i)
        const arrow = resolved ? ` \u2192 ${resolved}` : ''
        this.log(`- "${ref.name}" (line ${ref.line})${arrow}`)
      }
    }

    if (showDiagnostics) {
      if (errors.length > 0) {
        this.log('AGENT_ERRORS:')
        for (const d of errors) {
          this.log(`- line ${d.line}:${d.column}: ${d.message}`)
        }
      }

      if (warnings.length > 0) {
        this.log('AGENT_WARNINGS:')
        for (const d of warnings) {
          this.log(`- line ${d.line}:${d.column}: ${d.message}`)
        }
      }
    }

    this.log('AGENT_COMPLETE: inspect_done')
  }

  private outputHuman(
    relativePath: string,
    result: ReturnType<typeof parseXanoScript>,
    calls: XsFunctionCall[],
    _refs: XsVariableRef[],
    refsByName: Map<string, number[]>,
    objectType: null | string,
    objectName: string,
    showInputs: boolean,
    showVars: boolean,
    showCalls: boolean,
    showRefs: boolean,
    showDiagnostics: boolean,
    dbRefs: XsDbRef[] = [],
    functionRunRefs: XsFunctionRunRef[] = [],
    dbPaths: Map<number, string> = new Map(),
    functionPaths: Map<number, string> = new Map(),
  ): void {
    const inputs = Object.entries(result.symbolTable.input)
    const vars = Object.entries(result.symbolTable.var)
    const { errors, hints, informations: infos, warnings } = result.diagnostics

    // Header
    this.log(relativePath)
    const typePart = objectType ? `Type: ${objectType}` : `Scheme: ${result.scheme}`
    this.log(`${typePart} | Name: ${objectName}`)

    // Inputs
    if (showInputs && inputs.length > 0) {
      this.log('')
      this.log('Inputs:')
      for (const [name, info] of inputs) {
        const attrs = this.formatInputAttrs(info)
        const pad = Math.max(0, 16 - name.length)
        this.log(`  ${info.type.padEnd(8)} ${name}${' '.repeat(pad)}${attrs}`)
      }
    }

    // Variables
    if (showVars && vars.length > 0) {
      this.log('')
      this.log('Variables:')
      for (const [name, info] of vars) {
        const val = info.value !== null && info.value !== undefined ? ` = ${JSON.stringify(info.value)}` : ''
        this.log(`  ${name.padEnd(16)} ${info.type}${val}`)
      }
    }

    // Function calls
    if (showCalls && calls.length > 0) {
      this.log('')
      this.log('Function Calls:')
      for (const call of calls) {
        this.log(`  ${call.name.padEnd(24)} line ${call.line}`)
      }
    }

    // Variable references
    if (showRefs && refsByName.size > 0) {
      this.log('')
      this.log('Variable References:')
      for (const [name, lines] of refsByName) {
        const unique = [...new Set(lines)].sort((a, b) => a - b)
        this.log(`  ${name.padEnd(16)} lines ${unique.join(', ')}`)
      }
    }

    // Cross-References
    if (showRefs && (dbRefs.length > 0 || functionRunRefs.length > 0)) {
      this.log('')
      this.log('Cross-References:')

      if (dbRefs.length > 0) {
        this.log('  Tables:')
        for (const [i, ref] of dbRefs.entries()) {
          const resolved = dbPaths.get(i)
          const arrow = resolved ? `  \u2192 ${resolved}` : ''
          this.log(`    db.${ref.operation.padEnd(12)} ${ref.table.padEnd(20)} line ${ref.line}${arrow}`)
        }
      }

      if (functionRunRefs.length > 0) {
        this.log('  Functions:')
        for (const [i, ref] of functionRunRefs.entries()) {
          const resolved = functionPaths.get(i)
          const arrow = resolved ? `  \u2192 ${resolved}` : ''
          const label = `function.run "${ref.name}"`
          this.log(`    ${label.padEnd(40)} line ${ref.line}${arrow}`)
        }
      }
    }

    // Diagnostics
    if (showDiagnostics) {
      this.log('')
      this.log(`Diagnostics: ${errors.length} errors, ${warnings.length} warnings, ${hints.length} hints`)

      for (const d of errors) {
        this.log(`  \u274C line ${d.line}:${d.column} - ${d.message}`)
      }

      for (const d of warnings) {
        this.log(`  \u26A0\uFE0F  line ${d.line}:${d.column} - ${d.message}`)
      }

      for (const d of infos) {
        this.log(`  \u2139\uFE0F  line ${d.line}:${d.column} - ${d.message}`)
      }

      for (const d of hints) {
        this.log(`  \uD83D\uDCA1 line ${d.line}:${d.column} - ${d.message}`)
      }
    }
  }

  private outputJson(
    relativePath: string,
    result: ReturnType<typeof parseXanoScript>,
    calls: XsFunctionCall[],
    _refs: XsVariableRef[],
    refsByName: Map<string, number[]>,
    objectType: null | string,
    objectName: string,
    dbRefs: XsDbRef[] = [],
    functionRunRefs: XsFunctionRunRef[] = [],
    dbPaths: Map<number, string> = new Map(),
    functionPaths: Map<number, string> = new Map(),
  ): void {
    const output = {
      calls,
      dbRefs: dbRefs.map((ref, i) => ({
        ...ref,
        resolvedPath: dbPaths.get(i) ?? null,
      })),
      diagnostics: result.diagnostics,
      file: relativePath,
      functionRunRefs: functionRunRefs.map((ref, i) => ({
        ...ref,
        resolvedPath: functionPaths.get(i) ?? null,
      })),
      inputs: result.symbolTable.input,
      name: objectName,
      refs: Object.fromEntries(
        [...refsByName].map(([name, lines]) => [name, [...new Set(lines)].sort((a, b) => a - b)]),
      ),
      scheme: result.scheme,
      type: objectType,
      variables: result.symbolTable.var,
    }
    this.log(JSON.stringify(output, null, 2))
  }
}
