/**
 * State file management
 * Handles .xano/state.json (CLI owned - etag, key by filepath)
 */

import * as fs from 'node:fs'
import * as path from 'node:path'

import type { XanoStateEntry, XanoStateFile } from './types.js'

import { ensureXanoDir, getXanoDirPath } from './project.js'

const STATE_JSON = 'state.json'

/**
 * Get path to .xano/state.json
 */
export function getStateJsonPath(projectRoot: string): string {
  return path.join(getXanoDirPath(projectRoot), STATE_JSON)
}

/**
 * Load .xano/state.json
 */
export function loadState(projectRoot: string): XanoStateFile {
  const filePath = getStateJsonPath(projectRoot)

  if (!fs.existsSync(filePath)) {
    return {}
  }

  try {
    const content = fs.readFileSync(filePath, 'utf8')
    return JSON.parse(content) as XanoStateFile
  } catch {
    return {}
  }
}

/**
 * Save .xano/state.json
 */
export function saveState(projectRoot: string, state: XanoStateFile): void {
  ensureXanoDir(projectRoot)
  const filePath = getStateJsonPath(projectRoot)
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2) + '\n', 'utf-8')
}

/**
 * Get state entry for a file
 */
export function getStateEntry(state: XanoStateFile, filePath: string): undefined | XanoStateEntry {
  return state[filePath]
}

/**
 * Set state entry for a file
 */
export function setStateEntry(
  state: XanoStateFile,
  filePath: string,
  entry: XanoStateEntry
): XanoStateFile {
  return {
    ...state,
    [filePath]: entry,
  }
}

/**
 * Remove state entry for a file
 */
export function removeStateEntry(state: XanoStateFile, filePath: string): XanoStateFile {
  const newState = { ...state }
  delete newState[filePath]
  return newState
}

/**
 * Update etag for a file
 */
export function updateEtag(
  state: XanoStateFile,
  filePath: string,
  etag: string
): XanoStateFile {
  const existing = state[filePath] || { key: '' }
  return {
    ...state,
    [filePath]: {
      ...existing,
      etag,
    },
  }
}

/**
 * Update key for a file
 */
export function updateKey(
  state: XanoStateFile,
  filePath: string,
  key: string
): XanoStateFile {
  const existing = state[filePath] || {}
  return {
    ...state,
    [filePath]: {
      ...existing,
      key,
    },
  }
}

/**
 * Get etag for a file
 */
export function getEtag(state: XanoStateFile, filePath: string): string | undefined {
  return state[filePath]?.etag
}

/**
 * Get key for a file
 */
export function getKey(state: XanoStateFile, filePath: string): string | undefined {
  return state[filePath]?.key
}

/**
 * Find file path by key
 */
export function findPathByKey(state: XanoStateFile, key: string): string | undefined {
  for (const [filePath, entry] of Object.entries(state)) {
    if (entry.key === key) {
      return filePath
    }
  }

  return undefined
}

/**
 * Get all file paths from state
 */
export function getAllStatePaths(state: XanoStateFile): string[] {
  return Object.keys(state)
}

/**
 * Clean up state entries for files that no longer exist
 */
export function cleanupState(
  state: XanoStateFile,
  projectRoot: string
): XanoStateFile {
  const newState: XanoStateFile = {}

  for (const [filePath, entry] of Object.entries(state)) {
    const fullPath = path.join(projectRoot, filePath)
    if (fs.existsSync(fullPath)) {
      newState[filePath] = entry
    }
  }

  return newState
}

/**
 * Merge state entries from another state file
 */
export function mergeState(
  base: XanoStateFile,
  updates: XanoStateFile
): XanoStateFile {
  return {
    ...base,
    ...updates,
  }
}
