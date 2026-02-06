#!/usr/bin/env node

/**
 * Lightweight MCP server launcher - bypasses oclif for fast startup
 * Usage: node bin/mcp.js
 */

import { runServer } from '../dist/mcp/server.js'

await runServer()
