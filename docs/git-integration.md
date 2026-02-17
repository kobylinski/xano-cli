# Git Integration

Rules and guidelines for how xano-cli integrates with Git repositories.

## Overview

The xano-cli creates local state files in the `.xano/` directory that should not be committed to version control. The CLI provides warnings and integrations to help manage this.

## .xano/ Directory

The `.xano/` directory contains:
- `config.json` - Local workspace state (shared with VSCode extension)
- `objects.json` - Tracked object registry
- `datasources.json` - Datasource access configuration (CLI-only)
- `search.json` - Search index cache

These files contain local paths, cached state, and potentially sensitive configuration that should not be shared.

## Gitignore Warning

### When to Show Warning

The CLI shows a gitignore warning **only when**:
1. The project directory is inside a Git repository (`.git/` exists in current or parent directory)
2. The `.xano/` directory is not listed in `.gitignore`

### When NOT to Show Warning

Do **not** show the warning when:
- No `.git/` directory exists (not a Git repository)
- `.xano/` is already in `.gitignore`
- The `--no-git-warning` flag is passed

### Implementation

```typescript
function shouldShowGitignoreWarning(projectRoot: string): boolean {
  // Check if this is a git repository
  if (!isGitRepository(projectRoot)) {
    return false
  }

  // Check if .xano is already gitignored
  return !isXanoGitignored(projectRoot)
}

function isGitRepository(dir: string): boolean {
  let current = dir
  while (current !== '/') {
    if (existsSync(join(current, '.git'))) {
      return true
    }
    current = dirname(current)
  }
  return false
}
```

## Recommended .gitignore Entries

```gitignore
# Xano CLI local state
.xano/

# Keep xano.json versioned (project configuration)
!xano.json
```

## xano.json vs .xano/

| File | Versioned | Purpose |
|------|-----------|---------|
| `xano.json` | Yes | Project configuration (instance, workspace, paths, datasources) |
| `.xano/config.json` | No | Local state (branch, resolved paths) |
| `.xano/objects.json` | No | Object registry with local paths |
| `.xano/datasources.json` | No | CLI datasource settings |

## Git Hooks

Future versions may provide optional Git hooks for:
- Pre-commit validation of XanoScript files
- Post-checkout branch synchronization
- Merge conflict detection for `.xs` files

## Branch Tracking

The CLI does not automatically track Git branches. The `branch` setting in configuration refers to the **Xano branch**, not the Git branch.

For workflows that need Git branch to Xano branch mapping, use:
```bash
xano pull --branch=$(git branch --show-current)
```
