#!/usr/bin/env node
/**
 * Lightweight resolver - bypasses oclif for fast startup (~300ms vs ~6s)
 * Usage: resolve.js <identifier> [projectRoot]
 *
 * Output: JSON with resolved file path and type, or error
 */

const path = require('path');

// Minimal project root finder (no oclif dependencies)
function findProjectRoot(startDir) {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    const xanoDir = path.join(dir, '.xano');
    const configPath = path.join(xanoDir, 'config.json');
    try {
      require('fs').accessSync(configPath);
      return dir;
    } catch {}

    const xanoJson = path.join(dir, 'xano.json');
    try {
      require('fs').accessSync(xanoJson);
      return dir;
    } catch {}

    dir = path.dirname(dir);
  }
  return null;
}

async function main() {
  const identifier = process.argv[2];
  if (!identifier) {
    console.error('Usage: resolve.js <identifier> [projectRoot]');
    process.exit(1);
  }

  const projectRoot = process.argv[3] || findProjectRoot(process.cwd());
  if (!projectRoot) {
    console.log(JSON.stringify({ error: 'not_in_xano_project' }));
    process.exit(0);
  }

  try {
    const { resolveIdentifier } = require('../dist/lib/xs-resolver.js');
    const results = resolveIdentifier(identifier, projectRoot);

    if (results.length === 0) {
      console.log(JSON.stringify({ error: 'not_found', identifier }));
    } else {
      console.log(JSON.stringify({
        filePath: results[0].filePath,
        matchType: results[0].matchType,
        name: results[0].name,
        type: results[0].type,
      }));
    }
  } catch (err) {
    console.log(JSON.stringify({ error: 'resolve_failed', message: err.message }));
  }
}

main();
