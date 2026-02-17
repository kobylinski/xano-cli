# VS Code Extension Compatibility

## Goal

Enable xano-cli to work seamlessly with projects created by the Xano VS Code extension, and vice versa. Both tools should be able to read and write the same `.xano/` directory structure without conflicts.

## Desired Effects

### 1. File Path Generation

When `naming: 'vscode'` or `naming: 'vscode_name'` is configured, xano-cli should generate identical file paths to the VS Code extension:

| Object Type | VS Code Path Pattern |
|-------------|---------------------|
| Function | `functions/{snake_case_name}.xs` |
| Table | `tables/{snake_case_name}.xs` |
| Task | `tasks/{snake_case_name}.xs` |
| API Group | `apis/{group_name}/api_group.xs` |
| API Endpoint | `apis/{group_name}/{path}_{VERB}.xs` |
| Table Trigger | `tables/triggers/{trigger_name}.xs` |
| Workflow Test | `workflow_tests/{snake_case_name}.xs` |

### 2. Name Sanitization

VS Code uses lodash-style `snakeCase` which differs from CLI's `sanitize`:

| Input | CLI sanitize() | VS Code snakeCase() |
|-------|---------------|---------------------|
| `calculateTotal` | `calculate_total` | `calculate_total` |
| `phase4` | `phase4` | `phase_4` |
| `processPM_jobs` | `processpm_jobs` | `process_pm_jobs` |
| `ABCDef` | `abcdef` | `abc_def` |

**Key difference**: snakeCase adds underscore before digits (`phase4` → `phase_4`)

### 3. Directory Structure

```
.xano/
├── config.json                    # Local config (both tools)
├── branches/
│   └── {branch}/
│       └── objects.json           # Object tracking (both tools)
├── cli.json                       # CLI-only settings (ignored by VS Code)
├── endpoints.json                 # CLI-only API endpoint cache
├── groups.json                    # CLI-only API group cache
└── search.json                    # CLI-only search index

~/.xano/
└── credentials.yaml               # CLI-only authentication profiles
```

**Authentication differences:**
- **CLI**: Uses `~/.xano/credentials.yaml` to store multiple profiles with access tokens
- **VS Code**: Uses VS Code's secure secret storage API for the access token

### 4. objects.json Field Ordering

VS Code expects fields in this order:
```json
{
  "id": 123,
  "type": "function",
  "path": "functions/my_func.xs",
  "status": "unchanged",
  "staged": false,
  "sha256": "...",
  "original": "..."
}
```

### 5. config.json Structure

Both VS Code and CLI now produce compatible config.json:

```json
{
  "instanceName": "x8yf-zrk9-qtux",
  "instanceDisplay": "Greenroom",
  "workspaceName": "Workspace Name",
  "workspaceId": 123,
  "branch": "v1",
  "paths": { ... }
}
```

**Field descriptions:**

| Field | Description |
|-------|-------------|
| `instanceName` | Canonical instance ID from Xano API (e.g., `x8yf-zrk9-qtux`) |
| `instanceDisplay` | Profile name chosen by user (e.g., `Greenroom`) |
| `workspaceName` | Workspace name from Xano API |
| `workspaceId` | Workspace ID (number) |
| `branch` | Current working branch |
| `paths` | Directory mappings for each XanoScript type |

**Note:** Field ordering may differ but JSON parsers handle this correctly.

### 6. Canonical Values for Live API Calls

API groups have two different identifiers:
- `guid`: Internal metadata identifier (e.g., `PO9XM_km6KcC8aLonl9-tDm5dqA`)
- `canonical`: Live API URL identifier (e.g., `538SmIk8`)

The canonical for live API calls is stored in XanoScript content:
```
api_group Audit {
  canonical = "538SmIk8"
}
```

`groups.json` and `endpoints.json` must store the **XanoScript canonical**, not the guid.

---

## Current Code Architecture

### NamingMode System (src/lib/types.ts)

```typescript
export type NamingMode = 'default' | 'vscode' | 'vscode_id' | 'vscode_name'
```

- `default`: CLI native behavior
- `vscode` / `vscode_name`: VS Code extension compatible (no ID prefix)
- `vscode_id`: VS Code with ID prefix (e.g., `123_function.xs`)

### Path Generation (src/lib/detector.ts)

Two separate functions handle path generation:

1. `generateVSCodePath()` - Handles vscode/vscode_name/vscode_id modes
2. `generateDefaultPath()` - Handles default mode (CLI native)

The `generateFilePath()` function dispatches to the correct generator based on naming mode.

### Sanitization (src/lib/detector.ts)

Two sanitization functions:

1. `sanitize()` - CLI native (simpler conversion)
2. `snakeCase()` - VS Code compatible (lodash-style)

`getDefaultSanitizer()` returns the appropriate function based on naming mode.

### Key Files

| File | Purpose |
|------|---------|
| `src/lib/detector.ts` | Path generation, sanitization, type detection |
| `src/lib/objects.ts` | objects.json management, field ordering |
| `src/lib/sync.ts` | Fetch from Xano, build objects/groups/endpoints |
| `src/lib/project.ts` | Config loading/saving, directory structure |
| `src/commands/init/index.ts` | Project initialization |

---

## Implementation Strategy

### Principle: Respect NamingMode

Changes for VS Code compatibility should:
1. **Only affect vscode/vscode_name/vscode_id modes**
2. **Leave 'default' mode unchanged** for backward compatibility
3. **Use naming mode from config** to determine behavior

### Required Changes

1. **snakeCase function**: Add letter-before-digit handling (`phase4` → `phase_4`)
   - Affects: vscode modes only (via getDefaultSanitizer)

2. **objects.json location**: Store in `branches/{branch}/` subdirectory
   - Affects: All modes (structural compatibility)

3. **objects.json field ordering**: Match VS Code order
   - Affects: All modes (structural compatibility)

4. **Canonical extraction**: Use XanoScript canonical, not guid
   - Affects: groups.json, endpoints.json (CLI-only files)

5. **Path generation**: Already correct in generateVSCodePath()
   - No changes needed if naming mode is respected

### What NOT to Change

- `generateDefaultPath()` behavior
- `sanitize()` function
- `getDefaultSanitizer()` return value for 'default' mode

---

## Testing Compatibility

### Test Procedure

1. Create test directory with VS Code extension
2. Create test directory with xano-cli using `naming: 'vscode'`
3. Compare:
   - `.xano/branches/{branch}/objects.json` paths
   - `.xano/config.json` structure
   - Generated `.xs` file paths

### Expected Result

With `naming: 'vscode'` configured, all paths in objects.json should be identical between xano-cli and VS Code extension.
