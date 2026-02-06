/**
 * MCP Server for Xano CLI
 *
 * Provides tools for workspace context resolution, file inspection,
 * and documentation lookup via the Model Context Protocol.
 *
 * This is a thin adapter over the shared operations layer.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { existsSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { z } from 'zod'

import { detectType, extractName, sanitize } from '../lib/detector.js'
import { loadEndpoints, loadObjects } from '../lib/objects.js'
import {
  ApiCallError,
  bulkCreateRecords,
  callApiEndpoint,
  createContext,
  createRecord,
  DataOperationError,
  deleteRecord,
  getFileStatus,
  getRecord,
  listRecords,
  listTables,
  type OperationContext,
  pullFiles,
  pushFiles,
  resolveTableId,
  syncMetadata,
  SyncOperationError,
  updateRecord,
} from '../lib/operations/index.js'
import { findProjectRoot, loadXanoJson } from '../lib/project.js'
import { resolveAllRefs, resolveIdentifier } from '../lib/xs-resolver.js'

// ── Shared State ───────────────────────────────────────────────────

let mcpContext: null | OperationContext = null

function getContext(): OperationContext {
  if (!mcpContext) {
    mcpContext = createContext()
  }

  return mcpContext
}

// Lazy-loaded heavy module
let xsLanguage: null | typeof import('../lib/xs-language.js') = null
async function getXsLanguage() {
  if (!xsLanguage) {
    xsLanguage = await import('../lib/xs-language.js')
  }

  return xsLanguage
}

/**
 * Format MCP response in human-readable markdown format.
 */
function formatResponse(summary: string, data: Record<string, unknown>): string {
  const lines: string[] = [summary, '']

  function formatValue(value: unknown, indent: number): string {
    const prefix = '  '.repeat(indent)

    if (value === null || value === undefined) {
      return 'null'
    }

    if (typeof value === 'boolean' || typeof value === 'number') {
      return String(value)
    }

    if (typeof value === 'string') {
      if (value.includes('\n')) {
        return `|\n${value.split('\n').map(l => prefix + '  ' + l).join('\n')}`
      }

      return value
    }

    if (Array.isArray(value)) {
      if (value.length === 0) return '[]'
      if (typeof value[0] !== 'object') {
        return `[${value.join(', ')}]`
      }

      return '\n' + value.map(item => {
        if (typeof item === 'object' && item !== null) {
          const objLines = Object.entries(item as Record<string, unknown>)
            .map(([k, v]) => `${prefix}  ${k}: ${formatValue(v, indent + 1)}`)
          return `${prefix}- ${objLines.join('\n' + prefix + '  ')}`
        }

        return `${prefix}- ${item}`
      }).join('\n')
    }

    if (typeof value === 'object') {
      const objLines = Object.entries(value as Record<string, unknown>)
        .map(([k, v]) => `${prefix}${k}: ${formatValue(v, indent)}`)
      return '\n' + objLines.join('\n')
    }

    return String(value)
  }

  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      lines.push(`${key}:`)
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        lines.push(`  ${k}: ${formatValue(v, 1)}`)
      }
    } else {
      lines.push(`${key}: ${formatValue(value, 0)}`)
    }
  }

  return lines.join('\n')
}

/**
 * Format error response
 */
function formatError(summary: string, details?: Record<string, unknown>): string {
  if (details) {
    return formatResponse(`❌ ${summary}`, details)
  }

  return `❌ ${summary}`
}

/**
 * Convert operation errors to formatted error response
 */
function handleOperationError(error: unknown): { content: Array<{ text: string; type: 'text' }> } {
  if (error instanceof ApiCallError || error instanceof DataOperationError || error instanceof SyncOperationError) {
    return { content: [{ text: formatError(error.message), type: 'text' }] }
  }

  return { content: [{ text: formatError(error instanceof Error ? error.message : 'Unknown error'), type: 'text' }] }
}

/**
 * Create and configure the MCP server
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: 'xano',
    version: '1.0.0',
  })

  // ── Tool: xano_resolve ─────────────────────────────────────────────
  server.registerTool(
    'xano_resolve',
    {
      description: 'Resolve an identifier (function name, endpoint, table) to its workspace file path',
      inputSchema: {
        identifier: z.string().describe('Identifier to resolve (e.g., brands_POST, my_function, Discord/GetMessageByID)'),
      },
    },
    async ({ identifier }) => {
      const projectRoot = findProjectRoot()
      if (!projectRoot) {
        return { content: [{ text: formatError('Not in a Xano project'), type: 'text' }] }
      }

      const resolved = resolveIdentifier(identifier, projectRoot)
      if (resolved.length === 0) {
        return { content: [{ text: formatError(`Not found: "${identifier}"`), type: 'text' }] }
      }

      const best = resolved[0]
      const summary = `✓ ${best.name} (${best.type || 'unknown'}) → ${best.filePath}`
      return {
        content: [{
          text: formatResponse(summary, {
            file: best.filePath,
            matchType: best.matchType,
            name: best.name,
            type: best.type,
          }),
          type: 'text',
        }],
      }
    },
  )

  // ── Tool: xano_inspect ─────────────────────────────────────────────
  server.registerTool(
    'xano_inspect',
    {
      description: 'Parse and analyze a XanoScript file, returning inputs, variables, cross-references, and diagnostics',
      inputSchema: {
        filePath: z.string().describe('Relative path to the .xs file within the project'),
      },
    },
    async ({ filePath }) => {
      const projectRoot = findProjectRoot()
      if (!projectRoot) {
        return { content: [{ text: formatError('Not in a Xano project'), type: 'text' }] }
      }

      const fullPath = join(projectRoot, filePath)
      if (!existsSync(fullPath)) {
        return { content: [{ text: formatError(`File not found: ${filePath}`), type: 'text' }] }
      }

      const content = readFileSync(fullPath, 'utf8')
      const {
        extractDbRefs,
        extractFunctionCalls,
        extractFunctionRunRefs,
        parseXanoScript,
      } = await getXsLanguage()

      const result = parseXanoScript(content)
      const objectType = detectType(content)
      const objectName = extractName(content)

      const dbRefs = extractDbRefs(result.rawTokens)
      const functionRunRefs = extractFunctionRunRefs(result.rawTokens)
      const calls = extractFunctionCalls(result.rawTokens)

      const { dbPaths, functionPaths } = resolveAllRefs(dbRefs, functionRunRefs, projectRoot)

      const inputCount = Object.keys(result.symbolTable.input).length
      const varCount = Object.keys(result.symbolTable.var).length
      const { errors, hints, warnings } = result.diagnostics
      const summary = `✓ ${objectName || basename(filePath, '.xs')} (${objectType || 'unknown'}) | ${inputCount} inputs, ${varCount} vars | ${errors.length} errors, ${warnings.length} warnings`

      return {
        content: [{
          text: formatResponse(summary, {
            dbRefs: dbRefs.map((ref, i) => `db.${ref.operation} ${ref.table}${dbPaths.get(i) ? ' → ' + dbPaths.get(i) : ''}`),
            diagnostics: { errors: errors.length, hints: hints.length, warnings: warnings.length },
            file: filePath,
            functionCalls: calls.map(c => c.name),
            functionRefs: functionRunRefs.map((ref, i) => `${ref.name}${functionPaths.get(i) ? ' → ' + functionPaths.get(i) : ''}`),
            inputs: result.symbolTable.input,
            name: objectName,
            type: objectType,
            variables: result.symbolTable.var,
          }),
          type: 'text',
        }],
      }
    },
  )

  // ── Tool: xano_explain ─────────────────────────────────────────────
  server.registerTool(
    'xano_explain',
    {
      description: 'Get documentation for a XanoScript builtin or resolve workspace object with full context',
      inputSchema: {
        keyword: z.string().describe('Function, filter, or workspace object to look up (e.g., db.query, trim, brands_POST)'),
      },
    },
    async ({ keyword }) => {
      const { getDocSummary, lookupDoc, searchDocs } = await getXsLanguage()

      // 1. Try builtin exact match first for dot-separated names
      if (keyword.includes('.')) {
        const doc = lookupDoc(keyword)
        if (doc) {
          const summary = `📖 ${doc.name} (${doc.category})`
          return {
            content: [{
              text: formatResponse(summary, {
                category: doc.category,
                documentation: doc.body,
                name: doc.name,
              }),
              type: 'text',
            }],
          }
        }
      }

      // 2. Try workspace resolution
      const projectRoot = findProjectRoot()
      if (projectRoot) {
        const resolved = resolveIdentifier(keyword, projectRoot)
        if (resolved.length > 0) {
          const best = resolved[0]
          const fullPath = join(projectRoot, best.filePath)
          if (existsSync(fullPath)) {
            const content = readFileSync(fullPath, 'utf8')
            const { extractDbRefs, extractFunctionRunRefs, parseXanoScript } = await getXsLanguage()

            const result = parseXanoScript(content)
            const objectType = detectType(content) || best.type
            const objectName = extractName(content) || best.name

            const dbRefs = extractDbRefs(result.rawTokens)
            const functionRunRefs = extractFunctionRunRefs(result.rawTokens)
            const { dbPaths, functionPaths } = resolveAllRefs(dbRefs, functionRunRefs, projectRoot)

            const inputCount = Object.keys(result.symbolTable.input).length
            const summary = `✓ ${objectName} (${objectType || 'unknown'}) → ${best.filePath}`

            return {
              content: [{
                text: formatResponse(summary, {
                  dbRefs: dbRefs.length > 0 ? dbRefs.map((ref, i) => `db.${ref.operation} ${ref.table}${dbPaths.get(i) ? ' → ' + dbPaths.get(i) : ''}`) : undefined,
                  file: best.filePath,
                  functionRefs: functionRunRefs.length > 0 ? functionRunRefs.map((ref, i) => `${ref.name}${functionPaths.get(i) ? ' → ' + functionPaths.get(i) : ''}`) : undefined,
                  inputs: inputCount > 0 ? result.symbolTable.input : undefined,
                  name: objectName,
                  type: objectType,
                  variables: Object.keys(result.symbolTable.var).length > 0 ? result.symbolTable.var : undefined,
                }),
                type: 'text',
              }],
            }
          }
        }
      }

      // 3. Try builtin exact match (non-dot-separated)
      const doc = lookupDoc(keyword)
      if (doc) {
        const summary = `📖 ${doc.name} (${doc.category})`
        return {
          content: [{
            text: formatResponse(summary, {
              category: doc.category,
              documentation: doc.body,
              name: doc.name,
            }),
            type: 'text',
          }],
        }
      }

      // 4. Try prefix search
      const results = searchDocs(keyword)
      if (results.length > 0) {
        const summary = `📚 ${results.length} matches for "${keyword}"`
        return {
          content: [{
            text: formatResponse(summary, {
              matches: results.slice(0, 20).map(r => `${r.name} (${r.category}): ${getDocSummary(r.body)}`),
              query: keyword,
            }),
            type: 'text',
          }],
        }
      }

      return { content: [{ text: formatError(`Not found: "${keyword}"`), type: 'text' }] }
    },
  )

  // ── Tool: xano_search ──────────────────────────────────────────────
  server.registerTool(
    'xano_search',
    {
      description: 'Search workspace objects by pattern (functions, tables, endpoints, etc.)',
      inputSchema: {
        pattern: z.string().describe('Search pattern to match against object names and paths'),
        type: z.string().optional().describe('Filter by object type: function, table, api_endpoint, task, etc.'),
      },
    },
    async ({ pattern, type }) => {
      const projectRoot = findProjectRoot()
      if (!projectRoot) {
        return { content: [{ text: formatError('Not in a Xano project'), type: 'text' }] }
      }

      const objects = loadObjects(projectRoot)
      const lowerPattern = pattern.toLowerCase()

      let filtered = objects.filter(obj => {
        const objName = basename(obj.path, '.xs')
        const nameLower = objName.toLowerCase()
        const pathLower = obj.path.toLowerCase()
        return nameLower.includes(lowerPattern) || pathLower.includes(lowerPattern)
      })

      if (type) {
        filtered = filtered.filter(obj => obj.type === type)
      }

      // Build endpoint lookup for enriching api_endpoint results
      const endpointLookup = new Map<string, { method: string; path: string }>()
      if (!type || type === 'api_endpoint') {
        const endpoints = loadEndpoints(projectRoot)
        for (const [method, entries] of Object.entries(endpoints)) {
          for (const entry of entries) {
            const pathPart = entry.pattern.replaceAll(/\{([^}]+)\}/g, '$1')
            const sanitizedPath = sanitize(pathPart.replaceAll('/', '_'))
            const fileName = `${sanitizedPath}_${method}`
            endpointLookup.set(fileName.toLowerCase(), { method, path: '/' + entry.pattern })
          }
        }
      }

      const results = filtered.slice(0, 50).map(obj => {
        const name = basename(obj.path, '.xs')
        const info: { file: string; method?: string; name: string; path?: string; type: null | string } = {
          file: obj.path,
          name,
          type: obj.type,
        }

        if (obj.type === 'api_endpoint') {
          const lookup = endpointLookup.get(name.toLowerCase())
          if (lookup) {
            info.method = lookup.method
            info.path = lookup.path
          }
        }

        return info
      })

      const summary = `🔍 ${filtered.length} matches for "${pattern}"${type ? ` (type: ${type})` : ''}`

      const formattedResults = results.map(r => {
        if (r.type === 'api_endpoint' && r.method && r.path) {
          return `${r.method} ${r.path} → ${r.file}`
        }

        return `${r.name} (${r.type}) → ${r.file}`
      })

      return {
        content: [{
          text: formatResponse(summary, {
            results: formattedResults,
            truncated: filtered.length > 50 ? `showing 50 of ${filtered.length}` : undefined,
          }),
          type: 'text',
        }],
      }
    },
  )

  // ── Tool: xano_lint ────────────────────────────────────────────────
  server.registerTool(
    'xano_lint',
    {
      description: 'Lint a XanoScript file and return diagnostics (errors, warnings, hints)',
      inputSchema: {
        filePath: z.string().describe('Relative path to the .xs file within the project'),
      },
    },
    async ({ filePath }) => {
      const projectRoot = findProjectRoot()
      if (!projectRoot) {
        return { content: [{ text: formatError('Not in a Xano project'), type: 'text' }] }
      }

      const fullPath = join(projectRoot, filePath)
      if (!existsSync(fullPath)) {
        return { content: [{ text: formatError(`File not found: ${filePath}`), type: 'text' }] }
      }

      const content = readFileSync(fullPath, 'utf8')
      const { parseXanoScript } = await getXsLanguage()
      const result = parseXanoScript(content)

      const { errors, hints, warnings } = result.diagnostics
      const hasIssues = errors.length > 0 || warnings.length > 0
      const icon = errors.length > 0 ? '❌' : warnings.length > 0 ? '⚠️' : '✓'
      const summary = `${icon} ${filePath}: ${errors.length} errors, ${warnings.length} warnings, ${hints.length} hints`

      const data: Record<string, unknown> = { file: filePath }
      if (errors.length > 0) {
        data.errors = errors.map(e => `line ${e.line}: ${e.message}`)
      }

      if (warnings.length > 0) {
        data.warnings = warnings.map(w => `line ${w.line}: ${w.message}`)
      }

      if (hints.length > 0 && !hasIssues) {
        data.hints = hints.map(h => `line ${h.line}: ${h.message}`)
      }

      return { content: [{ text: formatResponse(summary, data), type: 'text' }] }
    },
  )

  // ── Tool: xano_project ─────────────────────────────────────────────
  server.registerTool(
    'xano_project',
    {
      description: 'Get information about the current Xano project (workspace, instance, paths, object counts)',
      inputSchema: {},
    },
    async () => {
      const projectRoot = findProjectRoot()
      if (!projectRoot) {
        return { content: [{ text: formatError('Not in a Xano project'), type: 'text' }] }
      }

      const config = loadXanoJson(projectRoot)
      const objects = loadObjects(projectRoot)

      const counts: Record<string, number> = {}
      for (const obj of objects) {
        const t = obj.type ?? 'unknown'
        counts[t] = (counts[t] ?? 0) + 1
      }

      const workspaceName = config?.workspace || 'Unknown'
      const summary = `📁 ${workspaceName} | ${objects.length} objects | ${projectRoot}`

      return {
        content: [{
          text: formatResponse(summary, {
            instance: config?.instance,
            objects: counts,
            paths: config?.paths,
            projectRoot,
            totalObjects: objects.length,
            workspace: config?.workspace,
            workspaceId: config?.workspaceId,
          }),
          type: 'text',
        }],
      }
    },
  )

  // ── Tool: xano_api_call ────────────────────────────────────────────
  server.registerTool(
    'xano_api_call',
    {
      description: 'Call a live Xano API endpoint. Returns the response data or error.',
      inputSchema: {
        body: z.record(z.unknown()).optional().describe('Request body as JSON object'),
        headers: z.record(z.string()).optional().describe('Additional headers as key-value pairs'),
        method: z.enum(['GET', 'POST', 'PUT', 'DELETE', 'PATCH']).describe('HTTP method'),
        path: z.string().describe('Endpoint path (e.g., /users, /auth/login)'),
        token: z.string().optional().describe('Auth token (adds Authorization: Bearer header)'),
      },
    },
    async ({ body, headers, method, path, token }) => {
      const ctx = getContext()

      // Build headers with optional token
      const requestHeaders: Record<string, string> = { ...headers }
      if (token) {
        requestHeaders.Authorization = `Bearer ${token}`
      }

      try {
        const result = await callApiEndpoint(ctx, {
          body: body as Record<string, unknown> | undefined,
          headers: Object.keys(requestHeaders).length > 0 ? requestHeaders : undefined,
          method,
          path,
        })

        if (!result.ok) {
          const summary = `❌ ${method} ${path} → ${result.status}`
          return {
            content: [{
              text: formatResponse(summary, { error: result.error, status: result.status }),
              type: 'text',
            }],
          }
        }

        const summary = `✓ ${method} ${path} → ${result.status}`
        return {
          content: [{
            text: formatResponse(summary, { data: result.data, status: result.status }),
            type: 'text',
          }],
        }
      } catch (error) {
        return handleOperationError(error)
      }
    },
  )

  // ── Tool: xano_tables ─────────────────────────────────────────────
  server.registerTool(
    'xano_tables',
    {
      description: 'List all tables in the workspace',
      inputSchema: {
        page: z.number().optional().describe('Page number (default: 1)'),
        perPage: z.number().optional().describe('Items per page (default: 100)'),
      },
    },
    async ({ page = 1, perPage = 100 }) => {
      const ctx = getContext()

      try {
        const result = await listTables(ctx, page, perPage)
        if (!result.ok) {
          return { content: [{ text: formatError(`Failed to list tables: ${result.error}`), type: 'text' }] }
        }

        const tables = result.data ?? []
        const summary = `📋 ${tables.length} tables`
        return {
          content: [{
            text: formatResponse(summary, {
              tables: tables.map(t => `${t.name} (id: ${t.id})`),
            }),
            type: 'text',
          }],
        }
      } catch (error) {
        return handleOperationError(error)
      }
    },
  )

  // ── Tool: xano_data_list ──────────────────────────────────────────
  server.registerTool(
    'xano_data_list',
    {
      description: 'List records from a table with optional filtering and sorting. Filter format: [{field: value}] for exact match, [{field|!=: value}] for not equal, [{field|>: value}] for greater than, etc. Sort format: [{field: "asc"}] or [{field: "desc"}]',
      inputSchema: {
        page: z.number().optional().describe('Page number (default: 1)'),
        perPage: z.number().optional().describe('Items per page (default: 50)'),
        search: z.array(z.record(z.unknown())).optional().describe('Search filters: [{email: "user@example.com"}] for exact match, [{age|>: 18}] for greater than, [{status|!=: "deleted"}] for not equal'),
        sort: z.array(z.record(z.enum(['asc', 'desc']))).optional().describe('Sort order: [{created_at: "desc"}]'),
        table: z.union([z.string(), z.number()]).describe('Table name or ID'),
      },
    },
    async ({ page = 1, perPage = 50, search, sort, table }) => {
      const ctx = getContext()

      try {
        const result = await listRecords(ctx, table, { page, perPage, search, sort })
        if (!result.ok) {
          return { content: [{ text: formatError(`Failed: ${result.error}`), type: 'text' }] }
        }

        const summary = `📄 ${result.data?.length ?? 0} of ${result.pagination?.total ?? 0} records (page ${result.pagination?.page}/${result.pagination?.pageTotal})`
        return {
          content: [{
            text: formatResponse(summary, {
              page: result.pagination?.page,
              pageTotal: result.pagination?.pageTotal,
              records: result.data,
              total: result.pagination?.total,
            }),
            type: 'text',
          }],
        }
      } catch (error) {
        return handleOperationError(error)
      }
    },
  )

  // ── Tool: xano_data_get ───────────────────────────────────────────
  server.registerTool(
    'xano_data_get',
    {
      description: 'Get a single record by ID',
      inputSchema: {
        id: z.union([z.string(), z.number()]).describe('Record primary key'),
        table: z.union([z.string(), z.number()]).describe('Table name or ID'),
      },
    },
    async ({ id, table }) => {
      const ctx = getContext()

      try {
        const result = await getRecord(ctx, table, id)
        if (!result.ok) {
          return { content: [{ text: formatError(`Failed: ${result.error}`), type: 'text' }] }
        }

        const summary = `✓ Record ${id} from ${table}`
        return {
          content: [{
            text: formatResponse(summary, { record: result.data }),
            type: 'text',
          }],
        }
      } catch (error) {
        return handleOperationError(error)
      }
    },
  )

  // ── Tool: xano_data_create ────────────────────────────────────────
  server.registerTool(
    'xano_data_create',
    {
      description: 'Create a new record in a table',
      inputSchema: {
        data: z.record(z.unknown()).describe('Record data as key-value pairs'),
        table: z.union([z.string(), z.number()]).describe('Table name or ID'),
      },
    },
    async ({ data, table }) => {
      const ctx = getContext()

      try {
        const result = await createRecord(ctx, table, data)
        if (!result.ok) {
          return { content: [{ text: formatError(`Failed: ${result.error}`), type: 'text' }] }
        }

        const newId = (result.data as Record<string, unknown>)?.id
        const summary = `✓ Created record${newId ? ` (id: ${newId})` : ''}`
        return {
          content: [{
            text: formatResponse(summary, { record: result.data }),
            type: 'text',
          }],
        }
      } catch (error) {
        return handleOperationError(error)
      }
    },
  )

  // ── Tool: xano_data_update ────────────────────────────────────────
  server.registerTool(
    'xano_data_update',
    {
      description: 'Update a record by ID',
      inputSchema: {
        data: z.record(z.unknown()).describe('Fields to update'),
        id: z.union([z.string(), z.number()]).describe('Record primary key'),
        table: z.union([z.string(), z.number()]).describe('Table name or ID'),
      },
    },
    async ({ data, id, table }) => {
      const ctx = getContext()

      try {
        const result = await updateRecord(ctx, table, id, data)
        if (!result.ok) {
          return { content: [{ text: formatError(`Failed: ${result.error}`), type: 'text' }] }
        }

        const summary = `✓ Updated record ${id}`
        return {
          content: [{
            text: formatResponse(summary, { record: result.data }),
            type: 'text',
          }],
        }
      } catch (error) {
        return handleOperationError(error)
      }
    },
  )

  // ── Tool: xano_data_delete ────────────────────────────────────────
  server.registerTool(
    'xano_data_delete',
    {
      description: 'Delete a record by ID',
      inputSchema: {
        id: z.union([z.string(), z.number()]).describe('Record primary key'),
        table: z.union([z.string(), z.number()]).describe('Table name or ID'),
      },
    },
    async ({ id, table }) => {
      const ctx = getContext()

      try {
        const result = await deleteRecord(ctx, table, id)
        if (!result.ok) {
          return { content: [{ text: formatError(`Failed: ${result.error}`), type: 'text' }] }
        }

        return { content: [{ text: `✓ Deleted record ${id} from ${table}`, type: 'text' }] }
      } catch (error) {
        return handleOperationError(error)
      }
    },
  )

  // ── Tool: xano_data_bulk ──────────────────────────────────────────
  server.registerTool(
    'xano_data_bulk',
    {
      description: 'Bulk create multiple records',
      inputSchema: {
        records: z.array(z.record(z.unknown())).describe('Array of records to create'),
        table: z.union([z.string(), z.number()]).describe('Table name or ID'),
      },
    },
    async ({ records, table }) => {
      const ctx = getContext()

      try {
        const result = await bulkCreateRecords(ctx, table, records)
        if (!result.ok) {
          return { content: [{ text: formatError(`Failed: ${result.error}`), type: 'text' }] }
        }

        const created = Array.isArray(result.data) ? result.data.length : 0
        return { content: [{ text: `✓ Created ${created} records in ${table}`, type: 'text' }] }
      } catch (error) {
        return handleOperationError(error)
      }
    },
  )

  // ── Tool: xano_schema_columns ─────────────────────────────────────
  server.registerTool(
    'xano_schema_columns',
    {
      description: 'Get table column definitions (schema)',
      inputSchema: {
        table: z.union([z.string(), z.number()]).describe('Table name or ID'),
      },
    },
    async ({ table }) => {
      const ctx = getContext()
      if (!ctx.api) {
        return { content: [{ text: formatError('API not initialized'), type: 'text' }] }
      }

      try {
        const tableId = await resolveTableId(ctx, table)
        const response = await ctx.api.getTableSchema(tableId)

        if (!response.ok) {
          return { content: [{ text: formatError(`Failed: ${response.error}`), type: 'text' }] }
        }

        const columns = response.data ?? []
        const summary = `📊 ${columns.length} columns in ${table}`
        return {
          content: [{
            text: formatResponse(summary, {
              columns: columns.map(c => `${c.name} (${c.type}${c.nullable ? ', nullable' : ''})`),
            }),
            type: 'text',
          }],
        }
      } catch (error) {
        return handleOperationError(error)
      }
    },
  )

  // ── Tool: xano_schema_indexes ─────────────────────────────────────
  server.registerTool(
    'xano_schema_indexes',
    {
      description: 'Get table indexes',
      inputSchema: {
        table: z.union([z.string(), z.number()]).describe('Table name or ID'),
      },
    },
    async ({ table }) => {
      const ctx = getContext()
      if (!ctx.api) {
        return { content: [{ text: formatError('API not initialized'), type: 'text' }] }
      }

      try {
        const tableId = await resolveTableId(ctx, table)
        const response = await ctx.api.getTableIndexes(tableId)

        if (!response.ok) {
          return { content: [{ text: formatError(`Failed: ${response.error}`), type: 'text' }] }
        }

        const indexes = response.data ?? []
        const summary = `🔑 ${indexes.length} indexes on ${table}`
        return {
          content: [{
            text: formatResponse(summary, {
              indexes: indexes.map(i => `${i.type}: [${i.fields.join(', ')}]`),
            }),
            type: 'text',
          }],
        }
      } catch (error) {
        return handleOperationError(error)
      }
    },
  )

  // ── Tool: xano_schema_add_column ──────────────────────────────────
  server.registerTool(
    'xano_schema_add_column',
    {
      description: 'Add a column to a table',
      inputSchema: {
        default: z.string().optional().describe('Default value'),
        name: z.string().describe('Column name'),
        nullable: z.boolean().optional().describe('Allow null values (default: false)'),
        table: z.union([z.string(), z.number()]).describe('Table name or ID'),
        type: z.string().describe('Column type (text, int, bool, decimal, timestamp, json, etc.)'),
      },
    },
    async ({ default: defaultValue, name, nullable = false, table, type }) => {
      const ctx = getContext()
      if (!ctx.api) {
        return { content: [{ text: formatError('API not initialized'), type: 'text' }] }
      }

      try {
        const tableId = await resolveTableId(ctx, table)

        const schemaResponse = await ctx.api.getTableSchema(tableId)
        if (!schemaResponse.ok || !schemaResponse.data) {
          return { content: [{ text: formatError(`Failed to get schema: ${schemaResponse.error}`), type: 'text' }] }
        }

        if (schemaResponse.data.some(c => c.name.toLowerCase() === name.toLowerCase())) {
          return { content: [{ text: formatError(`Column "${name}" already exists`), type: 'text' }] }
        }

        const newSchema = [...schemaResponse.data, {
          access: 'public' as const,
          default: defaultValue || '',
          description: '',
          name,
          nullable,
          required: !nullable,
          sensitive: false,
          style: 'single' as const,
          type: type as 'text',
        }]

        const response = await ctx.api.replaceTableSchema(tableId, newSchema)
        if (!response.ok) {
          return { content: [{ text: formatError(`Failed: ${response.error}`), type: 'text' }] }
        }

        return { content: [{ text: `✓ Added column "${name}" (${type}) to ${table}`, type: 'text' }] }
      } catch (error) {
        return handleOperationError(error)
      }
    },
  )

  // ── Tool: xano_schema_add_index ───────────────────────────────────
  server.registerTool(
    'xano_schema_add_index',
    {
      description: 'Add an index to a table',
      inputSchema: {
        fields: z.array(z.string()).describe('Column names to index'),
        table: z.union([z.string(), z.number()]).describe('Table name or ID'),
        type: z.enum(['btree', 'unique', 'hash', 'gin', 'gist', 'fulltext']).describe('Index type'),
      },
    },
    async ({ fields, table, type }) => {
      const ctx = getContext()
      if (!ctx.api) {
        return { content: [{ text: formatError('API not initialized'), type: 'text' }] }
      }

      try {
        const tableId = await resolveTableId(ctx, table)
        const response = await ctx.api.addTableIndex(tableId, {
          fields: fields.map(f => ({ name: f })),
          type,
        })

        if (!response.ok) {
          return { content: [{ text: formatError(`Failed: ${response.error}`), type: 'text' }] }
        }

        return { content: [{ text: `✓ Added ${type} index on [${fields.join(', ')}] to ${table}`, type: 'text' }] }
      } catch (error) {
        return handleOperationError(error)
      }
    },
  )

  // ── Tool: xano_schema_rename_column ───────────────────────────────
  server.registerTool(
    'xano_schema_rename_column',
    {
      description: 'Rename a table column',
      inputSchema: {
        newName: z.string().describe('New column name'),
        oldName: z.string().describe('Current column name'),
        table: z.union([z.string(), z.number()]).describe('Table name or ID'),
      },
    },
    async ({ newName, oldName, table }) => {
      const ctx = getContext()
      if (!ctx.api) {
        return { content: [{ text: formatError('API not initialized'), type: 'text' }] }
      }

      try {
        const tableId = await resolveTableId(ctx, table)
        const response = await ctx.api.renameColumn(tableId, oldName, newName)

        if (!response.ok) {
          return { content: [{ text: formatError(`Failed: ${response.error}`), type: 'text' }] }
        }

        return { content: [{ text: `✓ Renamed column "${oldName}" to "${newName}" in ${table}`, type: 'text' }] }
      } catch (error) {
        return handleOperationError(error)
      }
    },
  )

  // ── Tool: xano_schema_drop_column ─────────────────────────────────
  server.registerTool(
    'xano_schema_drop_column',
    {
      description: 'Drop (delete) a column from a table',
      inputSchema: {
        column: z.string().describe('Column name to drop'),
        table: z.union([z.string(), z.number()]).describe('Table name or ID'),
      },
    },
    async ({ column, table }) => {
      const ctx = getContext()
      if (!ctx.api) {
        return { content: [{ text: formatError('API not initialized'), type: 'text' }] }
      }

      try {
        const tableId = await resolveTableId(ctx, table)

        const schemaResponse = await ctx.api.getTableSchema(tableId)
        if (!schemaResponse.ok || !schemaResponse.data) {
          return { content: [{ text: formatError(`Failed to get schema: ${schemaResponse.error}`), type: 'text' }] }
        }

        const newSchema = schemaResponse.data.filter(c => c.name.toLowerCase() !== column.toLowerCase())
        if (newSchema.length === schemaResponse.data.length) {
          return { content: [{ text: formatError(`Column "${column}" not found`), type: 'text' }] }
        }

        const response = await ctx.api.replaceTableSchema(tableId, newSchema)
        if (!response.ok) {
          return { content: [{ text: formatError(`Failed: ${response.error}`), type: 'text' }] }
        }

        return { content: [{ text: `✓ Dropped column "${column}" from ${table}`, type: 'text' }] }
      } catch (error) {
        return handleOperationError(error)
      }
    },
  )

  // ── Tool: xano_schema_drop_index ──────────────────────────────────
  server.registerTool(
    'xano_schema_drop_index',
    {
      description: 'Drop (delete) an index from a table',
      inputSchema: {
        fields: z.array(z.string()).describe('Column names of the index to drop'),
        table: z.union([z.string(), z.number()]).describe('Table name or ID'),
        type: z.enum(['btree', 'unique', 'hash', 'gin', 'gist', 'fulltext']).describe('Index type'),
      },
    },
    async ({ fields, table, type }) => {
      const ctx = getContext()
      if (!ctx.api) {
        return { content: [{ text: formatError('API not initialized'), type: 'text' }] }
      }

      try {
        const tableId = await resolveTableId(ctx, table)

        const indexResponse = await ctx.api.getTableIndexes(tableId)
        if (!indexResponse.ok || !indexResponse.data) {
          return { content: [{ text: formatError(`Failed to get indexes: ${indexResponse.error}`), type: 'text' }] }
        }

        const fieldsSet = new Set(fields.map(f => f.toLowerCase()))
        const newIndexes = indexResponse.data.filter(idx => {
          if (idx.type !== type) return true
          const idxFields = new Set(idx.fields.map(f => f.name.toLowerCase()))
          return fieldsSet.size !== idxFields.size || ![...fieldsSet].every(f => idxFields.has(f))
        })

        if (newIndexes.length === indexResponse.data.length) {
          return { content: [{ text: formatError(`Index not found`), type: 'text' }] }
        }

        const response = await ctx.api.replaceTableIndexes(tableId, newIndexes)
        if (!response.ok) {
          return { content: [{ text: formatError(`Failed: ${response.error}`), type: 'text' }] }
        }

        return { content: [{ text: `✓ Dropped ${type} index on [${fields.join(', ')}] from ${table}`, type: 'text' }] }
      } catch (error) {
        return handleOperationError(error)
      }
    },
  )

  // ── Tool: xano_history ────────────────────────────────────────────
  server.registerTool(
    'xano_history',
    {
      description: 'Get request history for an object (function, task, trigger, etc.)',
      inputSchema: {
        id: z.number().describe('Object ID'),
        includeOutput: z.boolean().optional().describe('Include response output (default: false)'),
        page: z.number().optional().describe('Page number (default: 1)'),
        perPage: z.number().optional().describe('Items per page (default: 20)'),
        type: z.enum(['function', 'task', 'trigger', 'middleware']).describe('Object type'),
      },
    },
    async ({ id, includeOutput = false, page = 1, perPage = 20, type }) => {
      const ctx = getContext()
      if (!ctx.api) {
        return { content: [{ text: formatError('API not initialized'), type: 'text' }] }
      }

      try {
        const options = { includeOutput, page, perPage }
        let response

        switch (type) {
          case 'function': {
            response = await ctx.api.getFunctionHistory(id, options)
            break
          }

          case 'middleware': {
            response = await ctx.api.getMiddlewareHistory(id, options)
            break
          }

          case 'task': {
            response = await ctx.api.getTaskHistory(id, options)
            break
          }

          case 'trigger': {
            response = await ctx.api.getTriggerHistory(id, options)
            break
          }
        }

        if (!response?.ok) {
          return { content: [{ text: formatError(`Failed: ${response?.error}`), type: 'text' }] }
        }

        const items = response.data?.items ?? []
        const summary = `📜 ${items.length} history entries for ${type} ${id}`
        return {
          content: [{
            text: formatResponse(summary, {
              entries: items.map(item => ({
                duration: `${item.duration}s`,
                status: item.status,
                timestamp: new Date(item.created_at).toISOString(),
              })),
            }),
            type: 'text',
          }],
        }
      } catch (error) {
        return handleOperationError(error)
      }
    },
  )

  // ── Tool: xano_sync ──────────────────────────────────────────────
  server.registerTool(
    'xano_sync',
    {
      description: 'Sync metadata from Xano (objects.json, groups.json, endpoints.json) without pulling code files',
      inputSchema: {},
    },
    async () => {
      const ctx = getContext()

      try {
        const result = await syncMetadata(ctx)
        if (!result.ok) {
          return { content: [{ text: formatError(result.error || 'Sync failed'), type: 'text' }] }
        }

        const changes = []
        if (result.newCount > 0) changes.push(`${result.newCount} new`)
        if (result.updatedCount > 0) changes.push(`${result.updatedCount} updated`)
        if (result.removedCount > 0) changes.push(`${result.removedCount} removed`)

        const summary = `✓ Synced ${result.totalCount} objects${changes.length > 0 ? ` (${changes.join(', ')})` : ''}`
        return {
          content: [{
            text: formatResponse(summary, {
              newCount: result.newCount,
              removedCount: result.removedCount,
              totalCount: result.totalCount,
              updatedCount: result.updatedCount,
            }),
            type: 'text',
          }],
        }
      } catch (error) {
        return handleOperationError(error)
      }
    },
  )

  // ── Tool: xano_pull ──────────────────────────────────────────────
  server.registerTool(
    'xano_pull',
    {
      description: 'Pull XanoScript files from Xano to local. By default, syncs metadata and pulls all files.',
      inputSchema: {
        files: z.array(z.string()).optional().describe('Specific file paths to pull (if omitted, pulls all)'),
        force: z.boolean().optional().describe('Overwrite local changes (default: false)'),
      },
    },
    async ({ files, force = false }) => {
      const ctx = getContext()

      try {
        const result = await pullFiles(ctx, files, force)
        if (!result.ok && result.errors > 0 && result.pulled === 0) {
          return { content: [{ text: formatError(`Pull failed with ${result.errors} errors`), type: 'text' }] }
        }

        const parts = []
        if (result.pulled > 0) parts.push(`${result.pulled} pulled`)
        if (result.skipped > 0) parts.push(`${result.skipped} skipped`)
        if (result.errors > 0) parts.push(`${result.errors} errors`)

        const icon = result.errors > 0 ? '⚠️' : '✓'
        const summary = `${icon} ${parts.join(', ')}`
        return {
          content: [{
            text: formatResponse(summary, {
              errors: result.errors,
              pulled: result.pulled,
              skipped: result.skipped,
            }),
            type: 'text',
          }],
        }
      } catch (error) {
        return handleOperationError(error)
      }
    },
  )

  // ── Tool: xano_push ──────────────────────────────────────────────
  server.registerTool(
    'xano_push',
    {
      description: 'Push local XanoScript files to Xano. By default, pushes all changed files.',
      inputSchema: {
        files: z.array(z.string()).optional().describe('Specific file paths to push (if omitted, pushes all changed)'),
      },
    },
    async ({ files }) => {
      const ctx = getContext()

      try {
        const result = await pushFiles(ctx, files)
        if (!result.ok && result.errors > 0 && result.pushed === 0) {
          const errorDetails = result.failed.slice(0, 5).map(f => `${f.path}: ${f.error}`)
          return {
            content: [{
              text: formatError(`Push failed with ${result.errors} errors`, { failures: errorDetails }),
              type: 'text',
            }],
          }
        }

        const parts = []
        if (result.pushed > 0) parts.push(`${result.pushed} pushed`)
        if (result.errors > 0) parts.push(`${result.errors} failed`)

        const icon = result.errors > 0 ? '⚠️' : '✓'
        const summary = `${icon} ${parts.join(', ')}`

        const data: Record<string, unknown> = {
          errors: result.errors,
          pushed: result.pushed,
        }

        if (result.failed.length > 0) {
          data.failures = result.failed.slice(0, 10).map(f => `${f.path}: ${f.error}`)
        }

        return {
          content: [{
            text: formatResponse(summary, data),
            type: 'text',
          }],
        }
      } catch (error) {
        return handleOperationError(error)
      }
    },
  )

  // ── Tool: xano_status ────────────────────────────────────────────
  server.registerTool(
    'xano_status',
    {
      description: 'Get status of local files compared to Xano (modified, new, unchanged)',
      inputSchema: {},
    },
    async () => {
      const ctx = getContext()

      try {
        const status = getFileStatus(ctx)
        const total = status.modified.length + status.new.length + status.unchanged.length
        const summary = `📊 ${total} files: ${status.modified.length} modified, ${status.new.length} new, ${status.unchanged.length} unchanged`

        const data: Record<string, unknown> = {
          modified: status.modified.length,
          new: status.new.length,
          total,
          unchanged: status.unchanged.length,
        }

        if (status.modified.length > 0) {
          data.modifiedFiles = status.modified.slice(0, 20)
          if (status.modified.length > 20) {
            data.modifiedTruncated = `showing 20 of ${status.modified.length}`
          }
        }

        if (status.new.length > 0) {
          data.newFiles = status.new.slice(0, 20)
          if (status.new.length > 20) {
            data.newTruncated = `showing 20 of ${status.new.length}`
          }
        }

        return {
          content: [{
            text: formatResponse(summary, data),
            type: 'text',
          }],
        }
      } catch (error) {
        return handleOperationError(error)
      }
    },
  )

  return server
}

/**
 * Run the MCP server with stdio transport
 */
export async function runServer(): Promise<void> {
  const server = createServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('Xano MCP Server running on stdio')
}
