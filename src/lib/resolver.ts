/**
 * Type resolution for CLI input paths
 * Resolves user input to XanoObjectTypes based on paths config
 */

import * as path from 'node:path'

import type {
  TypeResolver,
  XanoObjectType,
  XanoPaths,
} from './types.js'

/**
 * Map paths config key to XanoObjectType(s)
 * Uses VSCode extension's camelCase naming convention
 */
function getTypesForPathKey(key: string): XanoObjectType[] | null {
  switch (key) {
    case 'addOns': return ['addon']
    case 'apis': return ['api_endpoint', 'api_group']
    case 'functions': return ['function']
    case 'middlewares': return ['middleware']
    case 'tables': return ['table']
    case 'tableTriggers': return ['table_trigger']
    case 'tasks': return ['task']
    case 'workflowTests': return ['workflow_test']
    default: return null
  }
}

/**
 * Get all path keys that match the input path
 * Returns the matched key AND all keys whose paths are nested under the input
 */
function getMatchingPathKeys(inputPath: string, paths: XanoPaths): string[] {
  const entries = Object.entries(paths)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')

  const matchedKeys: string[] = []

  for (const [key, basePath] of entries) {
    // Check if input matches this path (input is same or inside basePath)
    const relToBase = path.relative(basePath, inputPath)
    const inputMatchesBase = relToBase === '' || (!relToBase.startsWith('..') && !path.isAbsolute(relToBase))

    // Check if this path is nested under input (basePath is same or inside input)
    const relToInput = path.relative(inputPath, basePath)
    const baseIsUnderInput = relToInput === '' || (!relToInput.startsWith('..') && !path.isAbsolute(relToInput))

    if (inputMatchesBase || baseIsUnderInput) {
      matchedKeys.push(key)
    }
  }

  return matchedKeys
}

/**
 * Resolve input path to object types
 *
 * Priority:
 * 1. Dynamic resolver (xano.js resolveType function) - if provided
 * 2. Match against configured paths using path.relative
 *
 * Returns types for matched path AND all nested paths under it
 */
export function resolveInputToTypes(
  inputPath: string,
  paths: XanoPaths,
  dynamicResolver?: TypeResolver
): XanoObjectType[] | null {
  // Normalize input - remove trailing slash
  const normalized = inputPath.replace(/\/$/, '')

  // 1. Try dynamic resolver first (highest priority)
  if (dynamicResolver) {
    const result = dynamicResolver(normalized, paths)
    if (result && result.length > 0) {
      return result
    }
  }

  // 2. Match against configured paths
  const matchedKeys = getMatchingPathKeys(normalized, paths)

  if (matchedKeys.length === 0) {
    return null
  }

  // Collect all types for matched keys
  const types: XanoObjectType[] = []
  for (const key of matchedKeys) {
    const keyTypes = getTypesForPathKey(key)
    if (keyTypes) {
      for (const t of keyTypes) {
        if (!types.includes(t)) {
          types.push(t)
        }
      }
    }
  }

  return types.length > 0 ? types : null
}
