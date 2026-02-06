#!/usr/bin/env node

/**
 * Lightweight RPC server launcher - bypasses oclif for fast startup
 * Usage: node bin/rpc.js
 */

import { runRpcServer } from '../dist/rpc/server.js'

await runRpcServer()
