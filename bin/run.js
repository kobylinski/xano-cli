#!/usr/bin/env node

import {execute} from '@oclif/core'

// Preprocess args to transform -v, -vv, -vvv into --verbose=N
// oclif doesn't natively support counting repeated flags
const args = process.argv.slice(2)
const processedArgs = []

for (const arg of args) {
  // Match -v, -vv, -vvv (standalone verbose flags)
  if (/^-v+$/.test(arg)) {
    const level = Math.min(arg.length - 1, 3) // -v=1, -vv=2, -vvv=3
    processedArgs.push(`--verbose=${level}`)
  } else {
    processedArgs.push(arg)
  }
}

// Replace process.argv for oclif
process.argv = [process.argv[0], process.argv[1], ...processedArgs]

await execute({dir: import.meta.url})
