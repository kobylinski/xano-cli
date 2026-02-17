# Configuration Key Map

This document maps all configuration keys across xano-cli configuration files.

---

## Complete Configuration Matrix

| Key | Flag | `xano.json` | `.xano/config.json` | `.xano/datasources.json` | `credentials.yaml` | Priority | Conflicts | Origin | Acquisition |
|-----|------|-------------|---------------------|--------------------------|-------------------|----------|-----------|--------|-------------|
| **accessToken** | `--access-token` | - | - | - | `profiles.{name}.access_token` | 1. flag, 2. profile (via --profile) | flag vs profile: use flag | User input / Profile | Flag, browser login, manual entry, or from profile |
| **profile** | `--profile` | `profile` | - | - | `default` + `profiles.*` | 1. flag, 2. xano.json, 3. credentials default | flag vs xano.json: use flag | User selection | Flag, prompt, or auto-detect from credentials |
| **instance** | `--instance` | `instance` (URL) | - | - | `profiles.{name}.instance_origin` | 1. flag, 2. xano.json, 3. profile | flag vs xano.json: prompt or --force | User input | URL/domain input, resolved via API |
| **instanceName** | - | - | `instanceName` | - | - | Derived | - | API | Resolved from `instance` via `GET /api:meta/instance` |
| **instanceDisplay** | - | - | `instanceDisplay` | - | - | Derived | - | Profile | Profile name chosen by user (falls back to API display name) |
| **instanceOrigin** | - | - | - | - | `profiles.{name}.instance_origin` | Derived | - | API | Constructed as `https://{instanceName}.xano.io` |
| **workspace** | `--workspace` | `workspace` (ID) | `workspaceId` | - | `profiles.{name}.workspace` | 1. flag, 2. xano.json, 3. config.json, 4. profile | Multiple sources: prompt or --force | User selection | Flag (ID or name), API lookup, or prompt |
| **workspaceName** | - | - | `workspaceName` | - | - | Derived | - | API | Resolved from workspace ID via `GET /api:meta/workspace` |
| **branch** | `--branch` | `branch` | `branch` | - | `profiles.{name}.branch` | 1. flag, 2. xano.json (default), 3. config.json, 4. profile, 5. live | flag vs config: use flag | User selection | Flag, xano.json default, prompt, or live branch |
| **naming** | `--naming` | `naming` | - | - | - | 1. flag, 2. xano.json, 3. default | - | User choice | Flag or xano.json; default: `'default'` |
| **paths.*** | `--paths-*` | `paths.*` | `paths.*` | - | - | 1. flags, 2. xano.json, 3. autodiscovery, 4. defaults | xano.json vs autodiscovery: use xano.json | Config / Autodiscovery | Flags, xano.json, SDK autodiscovery, or defaults |
| **datasource** | `--datasource` | `defaultDatasource` | - | `defaultDatasource` | - | 1. flag, 2. xano.json, 3. datasources.json, 4. `'live'` | - | Config | Flag, xano.json, or default `'live'` |
| **datasources** | - | `datasources` | - | `datasources` | - | 1. xano.json, 2. datasources.json | - | Config | xano.json only (CLI-specific) |

### Legend

- **Priority**: Order of precedence when multiple sources provide the value (1 = highest)
- **Conflicts**: Situations where multiple sources disagree
- **Origin**: Where the authoritative value comes from
- **Acquisition**: How the value is obtained during init

---

## Configuration Files

| File | Purpose | Versioned | Shared with VS Code |
|------|---------|-----------|---------------------|
| `xano.json` | Project configuration (source of truth) | Yes | Yes |
| `.xano/config.json` | Local state, runtime values | No | Yes |
| `.xano/datasources.json` | Datasource cache (CLI-only) | No | No |
| `.xano/cli.json` | **Deprecated** - migrate to xano.json | No | No |
| `xano.js` | Dynamic configuration with custom functions | Yes | No |

---

## File Specifications

### `xano.json` (Versioned, Source of Truth)

```json
{
  "instance": "https://db.example.com",
  "workspace": 123,
  "branch": "v1",
  "profile": "MyProfile",
  "naming": "vscode",
  "paths": {
    "functions": "functions",
    "tables": "tables",
    "apis": "apis",
    "tasks": "tasks",
    "tools": "tools",
    "workflowTests": "workflow_tests",
    "agents": "agents",
    "agentTriggers": "agents/triggers",
    "mcpServers": "mcp_servers",
    "mcpServerTriggers": "mcp_servers/triggers",
    "tableTriggers": "tables/triggers",
    "addOns": "addons",
    "middlewares": "middlewares",
    "realtimeChannels": "realtime",
    "realtimeTriggers": "realtime/triggers"
  },
  "datasources": {
    "live": "read-write",
    "staging": "read-only",
    "production": "locked"
  },
  "defaultDatasource": "live"
}
```

**Key changes:**
- `workspace` - Workspace ID only (number), not name
- `branch` - Default/initial branch for project
- `datasources` - CLI-specific, defines access levels
- `defaultDatasource` - Which datasource to use by default

### `.xano/config.json` (Local State, VS Code Compatible)

This file must be **100% compatible with the VSCode extension** format.

```json
{
  "instanceName": "x8yf-zrk9-qtux",
  "instanceDisplay": "Greenroom",
  "workspaceName": "My Workspace",
  "workspaceId": 123,
  "branch": "v1",
  "paths": {
    "functions": "functions",
    "tables": "tables",
    "apis": "apis",
    "tasks": "tasks",
    "tools": "tools",
    "workflowTests": "workflow_tests",
    "agents": "agents",
    "agentTriggers": "agents/triggers",
    "mcpServers": "mcp_servers",
    "mcpServerTriggers": "mcp_servers/triggers",
    "tableTriggers": "tables/triggers",
    "addOns": "addons",
    "middlewares": "middlewares",
    "realtimeChannels": "realtime",
    "realtimeTriggers": "realtime/triggers"
  }
}
```

**Field descriptions:**

| Field | Type | Description |
|-------|------|-------------|
| `instanceName` | string | Canonical instance ID from Xano API (e.g., `x8yf-zrk9-qtux`) |
| `instanceDisplay` | string | Profile name chosen by user (e.g., `Greenroom`) |
| `workspaceName` | string | Workspace name from Xano API |
| `workspaceId` | number | Workspace ID |
| `branch` | string | Current working branch |
| `paths` | object | Directory mappings for each XanoScript type |

**Note:** No datasources here - that's CLI-only.

### `.xano/datasources.json` (CLI-Only Cache)

```json
{
  "datasources": {
    "live": "read-write",
    "staging": "read-only",
    "production": "locked"
  },
  "defaultDatasource": "live"
}
```

Cached from `xano.json` for CLI operations. Not shared with VS Code.

### `credentials.yaml` (Global, User Home)

Located at `~/.xano/credentials.yaml`, this file stores authentication profiles.

```yaml
default: MyProfile
profiles:
  MyProfile:
    access_token: xat_xxxxxxxxxxxx
    account_origin: https://app.xano.com
    instance_origin: https://a1b2-c3d4-e5f6.xano.io
    workspace: 123
    branch: v1
```

**Field descriptions:**

| Field | Type | Description |
|-------|------|-------------|
| `access_token` | string | Xano API access token |
| `account_origin` | string | Xano account URL (usually `https://app.xano.com`) |
| `instance_origin` | string | Full URL to the Xano instance (e.g., `https://x8yf-zrk9-qtux.xano.io`) |
| `workspace` | number | Workspace ID (populated after project setup) |
| `branch` | string | Default branch (populated after project setup) |

**Notes:**

- The `workspace` and `branch` fields are optional and populated when `xano init` completes project setup
- Browser login initially creates a profile with only authentication fields; workspace/branch are added after project configuration
- The CLI (not VSCode extension) uses credentials.yaml - VSCode uses its own secure storage

---

## Conflict Resolution by Mode

| Conflict Type | Interactive | Non-Interactive | Agent |
|---------------|-------------|-----------------|-------|
| Flag vs Config | Use flag (silent) | Use flag (silent) | Use flag (silent) |
| xano.json vs config.json | Prompt user | Error (use --force to override) | Return state + guidance |
| xano.json vs credentials | Prompt user | Error (use --force to override) | Return state + guidance |
| Workspace name mismatch | Show list, confirm | Error | Return list + suggestion |
| Branch not found | Use live, warn | Use live, warn in output | Use live, include warning |

---

## Value Resolution Flow

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Configuration Resolution                          │
└─────────────────────────────────────────────────────────────────────────┘

For each configuration key:

1. Command-line flag provided?
   ├─ YES → Use flag value
   └─ NO  → Continue

2. Environment variable set?
   ├─ YES → Use env value
   └─ NO  → Continue

3. xano.json has value?
   ├─ YES → Use xano.json value (check for conflicts with other sources)
   └─ NO  → Continue

4. .xano/config.json has value?
   ├─ YES → Use config.json value
   └─ NO  → Continue

5. credentials.yaml has value (for auth-related keys)?
   ├─ YES → Use credentials value
   └─ NO  → Continue

6. Can autodiscover? (for paths)
   ├─ YES → Use SDK to scan .xs files and infer paths
   └─ NO  → Continue

7. Can derive from API?
   ├─ YES → Call API to resolve
   └─ NO  → Continue

8. Has default value?
   ├─ YES → Use default
   └─ NO  → Trigger onMissingData event
```

---

## Paths Autodiscovery

When no paths are configured, the CLI can autodiscover paths using the Xano SDK:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Paths Autodiscovery                               │
└─────────────────────────────────────────────────────────────────────────┘

1. Scan project for all .xs files
2. Parse each file to detect XanoScript type (function, table, api_group, etc.)
3. Group files by type
4. Infer path pattern from file locations:
   - functions/*.xs → paths.functions = "functions"
   - src/apis/**/*.xs → paths.apis = "src/apis"
5. Apply discovered paths (if not already set in xano.json)
```

### Autodiscovery Priority

| Source | Priority |
|--------|----------|
| `--paths-*` flags | 1 (highest) |
| `xano.json` paths | 2 |
| Autodiscovery | 3 |
| Built-in defaults | 4 (lowest) |

---

## Access Token Acquisition

Access tokens can be obtained from multiple sources:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                      Access Token Resolution                             │
└─────────────────────────────────────────────────────────────────────────┘

1. --access-token flag provided?
   ├─ YES → Use token, create/update profile
   └─ NO  → Continue

2. --profile flag provided?
   ├─ YES → Load access_token from profile in credentials.yaml
   └─ NO  → Continue

3. xano.json has profile reference?
   ├─ YES → Load access_token from that profile
   └─ NO  → Continue

4. Default profile exists in credentials.yaml?
   ├─ YES → Use default profile's access_token
   └─ NO  → Continue

5. Trigger onMissingData event
   ├─ Interactive → Prompt for token or browser login
   ├─ Non-Interactive → Error exit
   └─ Agent → Return input_required response
```

---

## Dynamic Configuration (xano.js)

Additional keys available only in `xano.js`:

| Key | Type | Description |
|-----|------|-------------|
| **resolvePath** | `function` | Custom path resolver |
| **resolveType** | `function` | Custom type resolver |
| **sanitize** | `function` | Custom name sanitization |

Example:

```javascript
module.exports = {
  instance: 'https://db.example.com',
  workspace: 123,
  branch: 'v1',
  paths: {
    functions: 'src/functions',
    apis: 'src/apis'
  },

  // Custom sanitization
  sanitize(name) {
    return name.toLowerCase().replace(/[^a-z0-9]/g, '_')
  },

  // Custom path resolution
  resolvePath(obj, paths) {
    if (obj.type === 'function' && obj.name.startsWith('test_')) {
      return `tests/${obj.name}.xs`
    }
    return null // Use default resolution
  }
}
```

---

## Datasource Access Levels

| Level | Description |
|-------|-------------|
| `read-write` | Full access - can read and write data |
| `read-only` | Read access only - data commands will warn/fail on write |
| `locked` | No access - data commands are blocked |

Example configuration in `xano.json`:

```json
{
  "datasources": {
    "live": "read-write",
    "staging": "read-only",
    "production": "locked"
  },
  "defaultDatasource": "live"
}
```

Usage:

```bash
# Use default datasource
xano data:list users

# Specify datasource explicitly
xano data:list users --datasource=staging

# Will fail if production is locked
xano data:create users --datasource=production
```

---

## Deprecated: `.xano/cli.json`

This file is deprecated. Settings should be migrated to `xano.json`:

| Old Location | New Location |
|--------------|--------------|
| `.xano/cli.json` → `naming` | `xano.json` → `naming` |
| `.xano/cli.json` → `profile` | `xano.json` → `profile` |

The CLI will read from `cli.json` for backward compatibility but will not write to it.
