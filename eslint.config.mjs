import {includeIgnoreFile} from '@eslint/compat'
import oclif from 'eslint-config-oclif'
import prettier from 'eslint-config-prettier'
import path from 'node:path'
import {fileURLToPath} from 'node:url'

const gitignorePath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '.gitignore')

export default [
  includeIgnoreFile(gitignorePath),
  ...oclif,
  prettier,
  {
    rules: {
      // Disable complexity warnings - some functions are inherently complex
      'complexity': 'off',
      // TypeScript types provide better documentation than JSDoc for options objects
      'jsdoc/check-param-names': 'off',
      // Allow deeply nested blocks in complex command logic
      'max-depth': 'off',
      // Allow many parameters - refactoring to options objects not always practical
      'max-params': 'off',
      // fetch and FormData are stable in Node.js 18+ (our minimum version)
      'n/no-unsupported-features/node-builtins': ['error', {
        ignores: ['fetch', 'FormData'],
      }],
    },
  },
]
