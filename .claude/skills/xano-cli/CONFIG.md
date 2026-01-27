# Xano CLI Configuration Reference

Detailed reference for all configuration files used by xano-cli.

## File Overview

| File | Location | Versioned | VSCode Compatible | Purpose |
|------|----------|-----------|-------------------|---------|
| `xano.json` | project root | Yes | - | Project template (human-managed) |
| `config.json` | `.xano/` | No | Yes | Local workspace config |
| `cli.json` | `.xano/` | No | No | CLI-only settings |
| `objects.json` | `.xano/` | No | Yes | Object registry |
| `groups.json` | `.xano/` | No | No | API group canonical IDs |
| `datasources.json` | `.xano/` | No | No | Datasource permissions |
| `credentials.yaml` | `~/.xano/` | No | No | Global auth profiles |

---

## 1. xano.json (Project Template)

**Location:** `{project}/xano.json`
**Managed by:** Human/Agent (NOT by CLI commands)
**Versioned:** Yes (committed to git)

```typescript
interface XanoProjectConfig {
  instance: string              // Instance ID (e.g., "a1b2-c3d4")
  workspace: string             // Workspace name
  workspaceId: number           // Workspace ID
  paths: XanoPaths              // File path mappings
  naming?: NamingMode           // 'default' | 'vscode' | 'vscode_id' | 'vscode_name'
  profile?: string              // Default profile name
  datasources?: Record<string, 'locked' | 'read-only' | 'read-write'>
  defaultDatasource?: string    // Default datasource label
}

interface XanoPaths {
  apis: string                  // Required: "apis"
  functions: string             // Required: "functions"
  tables: string                // Required: "tables"
  tasks: string                 // Required: "tasks"
  workflowTests: string         // Required: "workflow_tests"
  addOns?: string               // "addons"
  agents?: string               // "agents"
  agentTriggers?: string        // "agents/triggers"
  mcpServers?: string           // "mcp_servers"
  mcpServerTriggers?: string    // "mcp_servers/triggers"
  middlewares?: string          // "middlewares"
  realtimeChannels?: string     // "realtime"
  realtimeTriggers?: string     // "realtime/triggers"
  tableTriggers?: string        // "tables/triggers"
  tools?: string                // "tools"
}
```

**Commands:**
| Action | Commands |
|--------|----------|
| Read | `init` (as template for config.json) |
| Write | None (human-managed) |

---

## 2. .xano/config.json (Local Config)

**Location:** `{project}/.xano/config.json`
**Managed by:** CLI + VSCode extension
**Versioned:** No (gitignored)

**WARNING:** VSCode extension overwrites this file with only its known keys. CLI-only settings go in `cli.json`.

```typescript
interface XanoLocalConfig {
  branch: string                // Current branch (e.g., "main")
  instanceName: string          // Instance ID
  workspaceId: number           // Workspace ID
  workspaceName: string         // Workspace name
  paths: XanoPaths              // File path mappings
  // Below are read but may be overwritten by VSCode:
  naming?: NamingMode           // File naming mode
  profile?: string              // Profile name
  datasources?: Record<string, AccessLevel>
  defaultDatasource?: string
}
```

**Commands:**
| Action | Commands |
|--------|----------|
| Read | All project commands |
| Write | `init`, `branch:switch` |

---

## 3. .xano/cli.json (CLI-Only Settings)

**Location:** `{project}/.xano/cli.json`
**Managed by:** CLI only
**Versioned:** No (gitignored)

Created to preserve settings that VSCode would overwrite in config.json.

```typescript
interface XanoCliConfig {
  naming?: NamingMode           // 'default' | 'vscode' | 'vscode_id' | 'vscode_name'
  profile?: string              // Profile name from credentials.yaml
}
```

**Commands:**
| Action | Commands |
|--------|----------|
| Read | All commands (via `loadEffectiveConfig`) |
| Write | `init` |

---

## 4. .xano/objects.json (Object Registry)

**Location:** `{project}/.xano/objects.json`
**Managed by:** CLI + VSCode extension
**Versioned:** No (gitignored)

```typescript
type XanoObjectsFile = XanoObject[]

interface XanoObject {
  id: number                    // Xano object ID
  path: string                  // Local file path (e.g., "functions/my_func.xs")
  type: XanoObjectType          // Object type
  status: 'new' | 'unchanged' | 'changed' | 'error' | 'notfound'
  staged: boolean               // VSCode compatibility (always false in CLI)
  sha256?: string               // Content hash (CLI-only, missing if VSCode-created)
  original?: string             // Base64 original content (CLI-only, missing if VSCode-created)
}

type XanoObjectType =
  | 'addon' | 'agent' | 'agent_trigger' | 'api_endpoint' | 'api_group'
  | 'function' | 'mcp_server' | 'mcp_server_trigger' | 'middleware'
  | 'realtime_channel' | 'realtime_trigger' | 'table' | 'table_trigger'
  | 'task' | 'tool' | 'workflow_test'
```

**Commands:**
| Action | Commands |
|--------|----------|
| Read | `status`, `push`, `pull`, `api:call`, `api:describe` |
| Write | `sync`, `pull`, `push`, `branch:switch` |

---

## 5. .xano/groups.json (API Group Registry)

**Location:** `{project}/.xano/groups.json`
**Managed by:** CLI only
**Versioned:** No (gitignored)

```typescript
type ApiGroupsFile = Record<string, ApiGroupInfo>

interface ApiGroupInfo {
  id: number                    // API group ID
  canonical: string             // Canonical identifier for fast lookup
}
```

**Example:**
```json
{
  "bootstrap": { "id": 123, "canonical": "abc123def456" },
  "users": { "id": 456, "canonical": "xyz789abc012" }
}
```

**Commands:**
| Action | Commands |
|--------|----------|
| Read | `api:call`, `api:describe` |
| Write | `sync`, `pull`, `push`, `branch:switch` |

---

## 6. .xano/datasources.json (Datasource Permissions)

**Location:** `{project}/.xano/datasources.json`
**Managed by:** CLI only
**Versioned:** No (gitignored)

```typescript
interface XanoDatasourcesConfig {
  datasources?: Record<string, 'locked' | 'read-only' | 'read-write'>
  defaultDatasource?: string    // Default datasource label (e.g., "live")
}
```

**Example:**
```json
{
  "defaultDatasource": "dev",
  "datasources": {
    "live": "read-only",
    "dev": "read-write",
    "staging": "read-write"
  }
}
```

**Commands:**
| Action | Commands |
|--------|----------|
| Read | `data:*` commands (list, get, create, update, delete, bulk) |
| Write | `datasource:permission`, `datasource:default`, `datasource:create` |

---

## 7. ~/.xano/credentials.yaml (Global Credentials)

**Location:** `~/.xano/credentials.yaml`
**Managed by:** CLI only
**Versioned:** No (user home directory)

```yaml
default: myprofile              # Default profile name

profiles:
  myprofile:
    instance_origin: https://a1b2-c3d4.xano.io
    access_token: xano_pat_...
    account_origin: https://app.xano.com  # Optional
    workspace: 123                         # Optional: default workspace
    branch: main                           # Optional: default branch

  another:
    instance_origin: https://x9y8-z7w6.xano.io
    access_token: xano_pat_...
```

**Commands:**
| Action | Commands |
|--------|----------|
| Read | All commands needing auth |
| Write | `profile:create`, `profile:edit`, `profile:delete`, `init` (creates if missing) |

---

## Config Load Priority

`loadEffectiveConfig()` merges configs with this priority (highest first):

1. **cli.json** - CLI-only settings (naming, profile)
2. **datasources.json** - Datasource settings
3. **config.json** - VSCode-compatible local config
4. **xano.json** - Project template defaults

---

## Command Config Matrix

| Command | config.json | cli.json | objects.json | groups.json | datasources.json | credentials.yaml |
|---------|:-----------:|:--------:|:------------:|:-----------:|:----------------:|:----------------:|
| `init` | W | W | - | - | - | R/W |
| `sync` | R | R | W | W | - | R |
| `pull` | R | R | W | W | - | R |
| `push` | R | R | W | W | - | R |
| `status` | R | R | R | - | - | R |
| `api:call` | R | R | R | R | - | R |
| `api:describe` | R | R | R | R | - | R |
| `data:*` | R | R | - | - | R | R |
| `datasource:*` | R | - | - | - | W | R |
| `branch:switch` | W | - | W | W | - | R |
| `profile:*` | - | - | - | - | - | W |

**Legend:** R = Read, W = Write, - = Not used
