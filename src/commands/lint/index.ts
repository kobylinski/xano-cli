import { Args, Flags } from '@oclif/core'
// @ts-expect-error - no TypeScript types available
import { xanoscriptParser } from '@xano/xanoscript-language-server/parser/parser.js'
import { execSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

import BaseCommand, { isAgentMode } from '../../base-command.js'
import {
  findProjectRoot,
  loadLocalConfig,
} from '../../lib/project.js'

interface ParseError {
  message: string
  token?: {
    endOffset: number
    startOffset: number
  }
}

interface Diagnostic {
  column: number
  file: string
  line: number
  message: string
  severity: 'error' | 'hint' | 'info' | 'warning'
}

interface FileResult {
  diagnostics: Diagnostic[]
  errorCount: number
  file: string
  hintCount: number
  infoCount: number
  warningCount: number
}

export default class Lint extends BaseCommand {
  static args = {
    files: Args.string({
      description: 'Files or directories to lint',
      required: false,
    }),
  }
  static description = 'Lint XanoScript files'
  static examples = [
    '<%= config.bin %> lint',
    '<%= config.bin %> lint functions/my_function.xs',
    '<%= config.bin %> lint functions/',
    '<%= config.bin %> lint --staged',
  ]
  static flags = {
    ...BaseCommand.baseFlags,
    fix: Flags.boolean({
      default: false,
      description: 'Attempt to fix issues (if supported)',
    }),
    staged: Flags.boolean({
      default: false,
      description: 'Lint only git-staged .xs files',
    }),
  }
  static strict = false // Allow multiple file arguments
  private agentMode = false

  async run(): Promise<void> {
    const { argv, flags } = await this.parse(Lint)
    const files = argv as string[]

    this.agentMode = isAgentMode(flags.agent)
    const projectRoot = findProjectRoot() || process.cwd()

    // Determine which files to lint
    let filesToLint: string[] = []

    if (flags.staged) {
      filesToLint = this.getGitStagedFiles(projectRoot)
    } else if (files.length > 0) {
      filesToLint = this.expandFiles(projectRoot, files)
    } else {
      // Default: lint all .xs files in project
      filesToLint = this.getAllXsFiles(projectRoot)
    }

    if (filesToLint.length === 0) {
      if (this.agentMode) {
        this.log('AGENT_LINT_RESULT:')
        this.log('files_checked=0')
        this.log('AGENT_MESSAGE: No .xs files found to lint.')
      } else {
        this.log('No .xs files to lint.')
      }

      return
    }

    if (!this.agentMode) {
      this.log(`Linting ${filesToLint.length} file(s)...\n`)
    }

    const results: FileResult[] = []
    let totalErrors = 0
    let totalWarnings = 0

    for (const relativePath of filesToLint) {
      const absolutePath = join(projectRoot, relativePath)
      const result = this.lintFile(absolutePath, relativePath)
      results.push(result)
      totalErrors += result.errorCount
      totalWarnings += result.warningCount
    }

    // Collect all diagnostics for agent output
    const allDiagnostics: Diagnostic[] = []

    // Display results
    for (const result of results) {
      if (result.errorCount > 0) {
        if (!this.agentMode) {
          this.log(`${result.file}: errors`)
        }

        for (const diag of result.diagnostics) {
          if (diag.severity === 'error') {
            if (this.agentMode) {
              allDiagnostics.push(diag)
            } else {
              this.log(`  ❌ Line ${diag.line}:${diag.column} - ${diag.message}`)
            }
          }
        }
      } else if (result.warningCount > 0) {
        if (!this.agentMode) {
          this.log(`${result.file}: warnings`)
        }

        for (const diag of result.diagnostics) {
          if (diag.severity === 'warning') {
            if (this.agentMode) {
              allDiagnostics.push(diag)
            } else {
              this.log(`  ⚠️  Line ${diag.line}:${diag.column} - ${diag.message}`)
            }
          }
        }
      } else if (!this.agentMode) {
        this.log(`${result.file}: ok`)
      }
    }

    const hasErrors = totalErrors > 0

    if (this.agentMode) {
      this.log('AGENT_LINT_RESULT:')
      this.log(`files_checked=${results.length}`)
      this.log(`errors=${totalErrors}`)
      this.log(`warnings=${totalWarnings}`)
      this.log(`has_errors=${hasErrors}`)

      if (allDiagnostics.length > 0) {
        // Group by severity
        const errors = allDiagnostics.filter(d => d.severity === 'error')
        const warnings = allDiagnostics.filter(d => d.severity === 'warning')

        if (errors.length > 0) {
          this.log('AGENT_LINT_ERRORS:')
          for (const diag of errors.slice(0, 30)) {
            this.log(`- ${diag.file}:${diag.line}:${diag.column}: ${diag.message}`)
          }

          if (errors.length > 30) {
            this.log(`- ... and ${errors.length - 30} more errors`)
          }
        }

        if (warnings.length > 0) {
          this.log('AGENT_LINT_WARNINGS:')
          for (const diag of warnings.slice(0, 20)) {
            this.log(`- ${diag.file}:${diag.line}:${diag.column}: ${diag.message}`)
          }

          if (warnings.length > 20) {
            this.log(`- ... and ${warnings.length - 20} more warnings`)
          }
        }

        if (hasErrors) {
          this.log('AGENT_ACTION: Fix the errors above before pushing to Xano.')
        }
      } else {
        this.log('AGENT_COMPLETE: lint_passed')
        this.log('AGENT_MESSAGE: All files passed linting.')
      }
    } else {
      this.log('')
      this.log(`Checked ${results.length} file(s): ${totalErrors} error(s), ${totalWarnings} warning(s)`)
    }

    if (hasErrors) {
      this.exit(1)
    }
  }

  private expandFiles(projectRoot: string, inputs: string[]): string[] {
    const files: string[] = []

    for (const input of inputs) {
      // Trim trailing slash
      const cleaned = input.replace(/\/$/, '')
      // Resolve from cwd first, so "." in a subdirectory means that subdirectory
      const fullPath = resolve(cleaned)

      if (!existsSync(fullPath)) {
        this.warn(`Path not found: ${input}`)
        continue
      }

      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        this.walkDir(fullPath, projectRoot, files)
      } else if (fullPath.endsWith('.xs')) {
        files.push(relative(projectRoot, fullPath))
      }
    }

    return files
  }

  private getAllXsFiles(projectRoot: string): string[] {
    const config = loadLocalConfig(projectRoot)
    const dirs = config
      ? [config.paths.functions, config.paths.tables, config.paths.apis, config.paths.tasks]
      : ['functions', 'tables', 'apis', 'tasks']

    const files: string[] = []
    for (const dir of dirs) {
      const fullDir = join(projectRoot, dir)
      if (existsSync(fullDir)) {
        this.walkDir(fullDir, projectRoot, files)
      }
    }

    return files
  }

  private getGitStagedFiles(projectRoot: string): string[] {
    try {
      const output = execSync('git diff --cached --name-only --diff-filter=ACM', {
        cwd: projectRoot,
        encoding: 'utf8',
      })
      return output
        .split('\n')
        .filter((f) => f.endsWith('.xs'))
        .filter(Boolean)
    } catch {
      this.warn('Failed to get git staged files.')
      return []
    }
  }

  /**
   * Convert a character offset to line and column numbers
   */
  private getLineAndColumn(content: string, offset: number): { column: number; line: number } {
    const lines = content.slice(0, offset).split('\n')
    return {
      column: (lines.at(-1)?.length ?? 0) + 1,
      line: lines.length,
    }
  }

  /**
   * Lint a single file using the official @xano/xanoscript-language-server parser
   */
  private lintFile(absolutePath: string, relativePath: string): FileResult {
    const diagnostics: Diagnostic[] = []
    let errorCount = 0
    let warningCount = 0
    let infoCount = 0
    let hintCount = 0

    try {
      const content = readFileSync(absolutePath, 'utf8')
      const parser = xanoscriptParser(content)

      // Process errors
      for (const error of parser.errors as ParseError[]) {
        const pos = error.token
          ? this.getLineAndColumn(content, error.token.startOffset)
          : { column: 1, line: 1 }

        diagnostics.push({
          column: pos.column,
          file: relativePath,
          line: pos.line,
          message: error.message,
          severity: 'error',
        })
        errorCount++
      }

      // Process warnings
      for (const warning of parser.warnings as ParseError[]) {
        const pos = warning.token
          ? this.getLineAndColumn(content, warning.token.startOffset)
          : { column: 1, line: 1 }

        diagnostics.push({
          column: pos.column,
          file: relativePath,
          line: pos.line,
          message: warning.message,
          severity: 'warning',
        })
        warningCount++
      }

      // Process informations
      for (const info of parser.informations as ParseError[]) {
        const pos = info.token
          ? this.getLineAndColumn(content, info.token.startOffset)
          : { column: 1, line: 1 }

        diagnostics.push({
          column: pos.column,
          file: relativePath,
          line: pos.line,
          message: info.message,
          severity: 'info',
        })
        infoCount++
      }

      // Process hints
      for (const hint of parser.hints as ParseError[]) {
        const pos = hint.token
          ? this.getLineAndColumn(content, hint.token.startOffset)
          : { column: 1, line: 1 }

        diagnostics.push({
          column: pos.column,
          file: relativePath,
          line: pos.line,
          message: hint.message,
          severity: 'hint',
        })
        hintCount++
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      diagnostics.push({
        column: 1,
        file: relativePath,
        line: 1,
        message: `Parse error: ${message}`,
        severity: 'error',
      })
      errorCount++
    }

    return {
      diagnostics,
      errorCount,
      file: relativePath,
      hintCount,
      infoCount,
      warningCount,
    }
  }

  private walkDir(dir: string, projectRoot: string, files: string[]): void {
    const entries = readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = join(dir, entry.name)
      if (entry.isDirectory()) {
        this.walkDir(fullPath, projectRoot, files)
      } else if (entry.name.endsWith('.xs')) {
        files.push(relative(projectRoot, fullPath))
      }
    }
  }
}
