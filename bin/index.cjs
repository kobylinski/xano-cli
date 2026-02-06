#!/usr/bin/env node
/**
 * Lightweight incremental indexer - bypasses oclif for fast startup (~300ms vs ~6s)
 * Usage: index.cjs [filePath] [projectRoot]
 *
 * - No args: full rebuild from objects.json
 * - With filePath: incremental update for that file
 */

const fs = require('fs');
const path = require('path');

// Minimal project root finder
function findProjectRoot(startDir) {
  let dir = startDir;
  while (dir !== path.dirname(dir)) {
    const configPath = path.join(dir, '.xano', 'config.json');
    try {
      fs.accessSync(configPath);
      return dir;
    } catch {}

    const xanoJson = path.join(dir, 'xano.json');
    try {
      fs.accessSync(xanoJson);
      return dir;
    } catch {}

    dir = path.dirname(dir);
  }
  return null;
}

async function main() {
  const filePath = process.argv[2];
  const explicitRoot = process.argv[3];
  const projectRoot = explicitRoot || findProjectRoot(process.cwd());

  if (!projectRoot) {
    console.log(JSON.stringify({ error: 'not_in_xano_project' }));
    process.exit(0);
  }

  try {
    const {
      addSearchEntry,
      buildSearchIndex,
      getSearchIndexPath,
      loadObjects,
      loadSearchIndex,
      removeSearchEntry,
    } = require('../dist/lib/objects.js');
    const { detectTypeFromPath } = require('../dist/lib/detector.js');

    if (!filePath) {
      // Full rebuild
      const objects = loadObjects(projectRoot);
      const index = buildSearchIndex(objects);
      const indexPath = getSearchIndexPath(projectRoot);
      fs.writeFileSync(indexPath, JSON.stringify(index) + '\n', 'utf8');
      console.log(JSON.stringify({ mode: 'full', objects: objects.length }));
      return;
    }

    // Incremental update
    let relPath = filePath;
    if (path.isAbsolute(filePath)) {
      relPath = path.relative(projectRoot, filePath);
    }
    relPath = relPath.replace(/^\.\//, '');

    // Skip non-.xs files
    if (!relPath.endsWith('.xs')) {
      console.log(JSON.stringify({ mode: 'skip', reason: 'not_xs_file' }));
      return;
    }

    let data = loadSearchIndex(projectRoot);
    if (!data) {
      // No index - do full rebuild
      const objects = loadObjects(projectRoot);
      const index = buildSearchIndex(objects);
      const indexPath = getSearchIndexPath(projectRoot);
      fs.writeFileSync(indexPath, JSON.stringify(index) + '\n', 'utf8');
      console.log(JSON.stringify({ mode: 'full', objects: objects.length }));
      return;
    }

    const objects = loadObjects(projectRoot);
    const obj = objects.find(o => o.path === relPath);
    const type = obj?.type ?? detectTypeFromPath(relPath);

    // Remove old entry and add new one
    data = removeSearchEntry(data, relPath);
    if (obj || fs.existsSync(path.join(projectRoot, relPath))) {
      data = addSearchEntry(data, relPath, type);
    }

    const indexPath = getSearchIndexPath(projectRoot);
    fs.writeFileSync(indexPath, JSON.stringify(data) + '\n', 'utf8');
    console.log(JSON.stringify({ mode: 'incremental', path: relPath, type }));

  } catch (err) {
    console.log(JSON.stringify({ error: 'index_failed', message: err.message }));
  }
}

main();
