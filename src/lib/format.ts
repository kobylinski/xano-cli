/**
 * Output formatting utilities
 * YAML-like format with optional ANSI styling
 */

// ANSI escape codes
const ANSI = {
  bold: '\u001B[1m',
  cyan: '\u001B[36m',
  dim: '\u001B[2m',
  green: '\u001B[32m',
  magenta: '\u001B[35m',
  red: '\u001B[31m',
  reset: '\u001B[0m',
  yellow: '\u001B[33m',
}

type StyleFn = (text: string) => string

interface Styles {
  boolean: StyleFn
  category: StyleFn
  null: StyleFn
  number: StyleFn
  string: StyleFn
}

function createStyles(useColors: boolean): Styles {
  if (!useColors) {
    const identity: StyleFn = (text) => text
    return {
      boolean: identity,
      category: identity,
      null: identity,
      number: identity,
      string: identity,
    }
  }

  return {
    boolean: (text) => `${ANSI.yellow}${text}${ANSI.reset}`,
    category: (text) => `${ANSI.bold}${text}${ANSI.reset}`,
    null: (text) => `${ANSI.dim}${text}${ANSI.reset}`,
    number: (text) => `${ANSI.cyan}${text}${ANSI.reset}`,
    string: (text) => `${ANSI.green}${text}${ANSI.reset}`,
  }
}

/**
 * Format a value with appropriate color based on type
 */
function formatValue(value: unknown, styles: Styles): string {
  if (value === null) {
    return styles.null('null')
  }

  if (value === undefined) {
    return styles.null('undefined')
  }

  if (typeof value === 'boolean') {
    return styles.boolean(String(value))
  }

  if (typeof value === 'number') {
    return styles.number(String(value))
  }

  if (typeof value === 'string') {
    // Multi-line strings get special handling
    if (value.includes('\n')) {
      return styles.string(`"${value.replaceAll('\n', String.raw`\n`)}"`)
    }

    return styles.string(`"${value}"`)
  }

  // For objects/arrays, return JSON representation
  return JSON.stringify(value)
}

/**
 * Format data in YAML-like format
 *
 * Output format:
 *   **category**:
 *     label: (colored) value
 */
export function formatYamlLike(
  data: unknown,
  options: { styled?: boolean } = {}
): string {
  const { styled = true } = options
  const styles = createStyles(styled)
  const lines: string[] = []

  function formatObject(obj: Record<string, unknown>, indent: number): void {
    const prefix = '  '.repeat(indent)

    for (const [key, value] of Object.entries(obj)) {
      if (value === null || value === undefined) {
        lines.push(`${prefix}${key}: ${formatValue(value, styles)}`)
      } else if (Array.isArray(value)) {
        if (value.length === 0) {
          lines.push(`${prefix}${key}: []`)
        } else if (typeof value[0] === 'object' && value[0] !== null) {
          // Array of objects
          lines.push(`${prefix}${key}:`)
          for (const item of value) {
            lines.push(`${prefix}  -`)
            if (typeof item === 'object' && item !== null) {
              for (const [k, v] of Object.entries(item as Record<string, unknown>)) {
                if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
                  lines.push(`${prefix}    ${k}:`)
                  formatObject(v as Record<string, unknown>, indent + 3)
                } else {
                  lines.push(`${prefix}    ${k}: ${formatValue(v, styles)}`)
                }
              }
            } else {
              lines.push(`${prefix}    ${formatValue(item, styles)}`)
            }
          }
        } else {
          // Array of primitives
          lines.push(`${prefix}${key}: [${value.map(v => formatValue(v, styles)).join(', ')}]`)
        }
      } else if (typeof value === 'object') {
        lines.push(`${prefix}${styles.category(key)}:`)
        formatObject(value as Record<string, unknown>, indent + 1)
      } else {
        lines.push(`${prefix}${key}: ${formatValue(value, styles)}`)
      }
    }
  }

  if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
    formatObject(data as Record<string, unknown>, 0)
  } else if (Array.isArray(data)) {
    if (data.length === 0) {
      lines.push('[]')
    } else {
      for (const item of data) {
        if (typeof item === 'object' && item !== null) {
          lines.push('-')
          formatObject(item as Record<string, unknown>, 1)
        } else {
          lines.push(`- ${formatValue(item, styles)}`)
        }
      }
    }
  } else {
    lines.push(formatValue(data, styles))
  }

  return lines.join('\n')
}

/**
 * Format API response with request/response metadata
 */
export function formatApiResponse(
  status: number,
  data: unknown,
  options: { styled?: boolean } = {}
): string {
  const { styled = true } = options
  const styles = createStyles(styled)
  const lines: string[] = []

  // Status line
  const statusColor = status >= 200 && status < 300 ? ANSI.green : ANSI.red
  if (styled) {
    lines.push(`${styles.category('status')}: ${statusColor}${status}${ANSI.reset}`)
  } else {
    lines.push(`status: ${status}`)
  }

  lines.push('')

  // Response data
  if (styled) {
    lines.push(`${styles.category('response')}:`)
  } else {
    lines.push('response:')
  }

  const responseLines = formatYamlLike(data, options)
  for (const line of responseLines.split('\n')) {
    lines.push(`  ${line}`)
  }

  return lines.join('\n')
}

/**
 * Format error response
 */
export function formatErrorResponse(
  status: number | undefined,
  error: string,
  options: { styled?: boolean } = {}
): string {
  const { styled = true } = options
  const styles = createStyles(styled)
  const lines: string[] = []

  if (styled) {
    lines.push(`${styles.category('error')}: ${ANSI.red}${error}${ANSI.reset}`)
  } else {
    lines.push(`error: ${error}`)
  }

  if (status !== undefined) {
    lines.push(`status: ${styles.number(String(status))}`)
  }

  return lines.join('\n')
}
