/**
 * Verbosity levels for CLI output
 *
 * -1 (silent):  Errors only
 *  0 (normal):  Standard output (default)
 *  1 (verbose): + API endpoints called, files read/written
 *  2 (debug):   + Request bodies, response data, file contents
 *  3 (trace):   + Timing breakdown, cache hits/misses, memory usage
 */
export type VerbosityLevel = -1 | 0 | 1 | 2 | 3

export const VERBOSITY = {
  DEBUG: 2 as VerbosityLevel,
  NORMAL: 0 as VerbosityLevel,
  SILENT: -1 as VerbosityLevel,
  TRACE: 3 as VerbosityLevel,
  VERBOSE: 1 as VerbosityLevel,
}

interface TimingEntry {
  label: string
  start: number
}

class Logger {
  private level: VerbosityLevel = VERBOSITY.NORMAL
  private timings: Map<string, TimingEntry> = new Map()

  /**
   * API request being made (level 1+)
   */
  apiCall(method: string, endpoint: string): void {
    if (this.level >= VERBOSITY.VERBOSE) {
      console.error(`  → ${method} ${endpoint}`)
    }
  }

  /**
   * API response received (level 1+)
   */
  apiResponse(status: number, statusText: string, durationMs?: number): void {
    if (this.level >= VERBOSITY.VERBOSE) {
      const timing = durationMs === undefined ? '' : ` (${durationMs}ms)`
      console.error(`  ← ${status} ${statusText}${timing}`)
    }
  }

  /**
   * Cache hit/miss (level 3+)
   */
  cache(hit: boolean, key: string): void {
    if (this.level >= VERBOSITY.TRACE) {
      const status = hit ? '✓ HIT' : '✗ MISS'
      console.error(`      📦 Cache ${status}: ${key}`)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Standard output (level 0+)
  // ─────────────────────────────────────────────────────────────

  /**
   * Config resolution step (level 3+)
   */
  configResolution(source: string, value: unknown): void {
    if (this.level >= VERBOSITY.TRACE) {
      const preview = this.truncateJson(value, 100)
      console.error(`      ⚙️ Config [${source}]: ${preview}`)
    }
  }

  /**
   * Data being stored (level 2+)
   */
  dataStored(label: string, data: unknown): void {
    if (this.level >= VERBOSITY.DEBUG) {
      const preview = this.truncateJson(data, 300)
      console.error(`    Stored ${label}: ${preview}`)
    }
  }

  /**
   * General debug message (level 2+)
   */
  debug(...args: unknown[]): void {
    if (this.level >= VERBOSITY.DEBUG) {
      console.error('    [DEBUG]', ...args)
    }
  }

  /**
   * Error message (always shown, even in silent mode)
   * Goes to stderr
   */
  error(...args: unknown[]): void {
    console.error(...args)
  }

  /**
   * Failure message with X (level 0+)
   */
  fail(message: string): void {
    if (this.level >= VERBOSITY.NORMAL) {
      console.log(`✗ ${message}`)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Verbose output (level 1+)
  // ─────────────────────────────────────────────────────────────

  /**
   * File operation (level 1+)
   */
  fileOp(operation: 'read' | 'write', filePath: string): void {
    if (this.level >= VERBOSITY.VERBOSE) {
      const symbol = operation === 'read' ? '📖' : '💾'
      console.error(`  ${symbol} ${operation}: ${filePath}`)
    }
  }

  /**
   * Get current verbosity level
   */
  getLevel(): VerbosityLevel {
    return this.level
  }

  /**
   * Standard info message (level 0+)
   * Goes to stdout for normal output
   */
  info(...args: unknown[]): void {
    if (this.level >= VERBOSITY.NORMAL) {
      console.log(...args)
    }
  }

  /**
   * Check if a level is enabled
   */
  isEnabled(level: VerbosityLevel): boolean {
    return this.level >= level
  }

  // ─────────────────────────────────────────────────────────────
  // Debug output (level 2+)
  // ─────────────────────────────────────────────────────────────

  /**
   * Memory usage (level 3+)
   */
  memory(label: string): void {
    if (this.level >= VERBOSITY.TRACE) {
      const used = process.memoryUsage()
      const heapMB = (used.heapUsed / 1024 / 1024).toFixed(2)
      const rssMB = (used.rss / 1024 / 1024).toFixed(2)
      console.error(`      🧠 Memory [${label}]: heap=${heapMB}MB, rss=${rssMB}MB`)
    }
  }

  /**
   * Request body being sent (level 2+)
   */
  requestBody(body: unknown): void {
    if (this.level >= VERBOSITY.DEBUG) {
      const preview = this.truncateJson(body, 500)
      console.error(`    Body: ${preview}`)
    }
  }

  /**
   * Response data received (level 2+)
   */
  responseData(data: unknown): void {
    if (this.level >= VERBOSITY.DEBUG) {
      const preview = this.truncateJson(data, 500)
      console.error(`    Response: ${preview}`)
    }
  }

  /**
   * Set verbosity level
   */
  setLevel(level: VerbosityLevel): void {
    this.level = level
  }

  // ─────────────────────────────────────────────────────────────
  // Trace output (level 3+)
  // ─────────────────────────────────────────────────────────────

  /**
   * Success message with checkmark (level 0+)
   */
  success(message: string): void {
    if (this.level >= VERBOSITY.NORMAL) {
      console.log(`✓ ${message}`)
    }
  }

  /**
   * End timing an operation (level 3+)
   */
  timeEnd(id: string): void {
    if (this.level >= VERBOSITY.TRACE) {
      const entry = this.timings.get(id)
      if (entry) {
        const duration = (performance.now() - entry.start).toFixed(2)
        console.error(`      ⏱ ${entry.label}: ${duration}ms`)
        this.timings.delete(id)
      }
    }
  }

  /**
   * Start timing an operation (level 3+)
   */
  timeStart(id: string, label: string): void {
    if (this.level >= VERBOSITY.TRACE) {
      this.timings.set(id, { label, start: performance.now() })
      console.error(`      ⏱ ${label} started`)
    }
  }

  /**
   * General trace message (level 3+)
   */
  trace(...args: unknown[]): void {
    if (this.level >= VERBOSITY.TRACE) {
      console.error('      [TRACE]', ...args)
    }
  }

  /**
   * General verbose message (level 1+)
   */
  verbose(...args: unknown[]): void {
    if (this.level >= VERBOSITY.VERBOSE) {
      console.error('  ', ...args)
    }
  }

  /**
   * Warning message (level 0+)
   * Goes to stderr
   */
  warn(...args: unknown[]): void {
    if (this.level >= VERBOSITY.NORMAL) {
      console.error('Warning:', ...args)
    }
  }

  // ─────────────────────────────────────────────────────────────
  // Utilities
  // ─────────────────────────────────────────────────────────────

  /**
   * Truncate JSON for preview
   */
  private truncateJson(data: unknown, maxLength: number): string {
    try {
      const json = JSON.stringify(data)
      if (json.length <= maxLength) return json
      return json.slice(0, maxLength) + '...'
    } catch {
      return String(data)
    }
  }
}

// Singleton instance
export const logger = new Logger()

/**
 * Resolve verbosity level from multiple sources
 * Priority: flag > env > config > default
 */
export function resolveVerbosity(
  flagVerbose?: number,
  flagSilent?: boolean,
  configVerbose?: number
): VerbosityLevel {
  // Silent flag takes precedence
  if (flagSilent) {
    return VERBOSITY.SILENT
  }

  // Verbose flag (can be stacked: -v, -vv, -vvv)
  if (flagVerbose !== undefined && flagVerbose > 0) {
    return Math.min(flagVerbose, 3) as VerbosityLevel
  }

  // Environment variable: XANO_VERBOSE=0|1|2|3 or XANO_DEBUG=1
  if (process.env.XANO_DEBUG === '1' || process.env.XANO_DEBUG === 'true') {
    return VERBOSITY.DEBUG
  }

  if (process.env.XANO_VERBOSE) {
    const envLevel = Number.parseInt(process.env.XANO_VERBOSE, 10)
    if (!Number.isNaN(envLevel) && envLevel >= -1 && envLevel <= 3) {
      return envLevel as VerbosityLevel
    }
  }

  // Config file
  if (configVerbose !== undefined && configVerbose >= -1 && configVerbose <= 3) {
    return configVerbose as VerbosityLevel
  }

  // Default
  return VERBOSITY.NORMAL
}
