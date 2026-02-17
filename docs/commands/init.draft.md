# xano init - Architecture Draft

> **📋 CANDIDATE**: This is the working specification for the `xano init` command redesign.

This document describes the redesigned `xano init` command architecture.

## Command Purpose

Bring a project to a workable state with the xano-cli tool.

### Use Cases

1. **Startup new project** - Fresh directory, no existing configuration
2. **Claim VS Code project** - Directory has `.xano/config.json` from VS Code extension
3. **Reinitialize from xano.json** - Has `xano.json` but needs `.xano/` setup

---

## Operating Modes

### 1. Interactive Mode (Default)

Human user at terminal. Each missing piece of information triggers an interactive prompt.

```bash
xano init
```

### 2. Non-Interactive Mode

Script automation. Relies entirely on flags and existing configuration. Missing required data causes error exit.

```bash
xano init --no-interaction --workspace=123 --branch=v1
```

### 3. Agent Mode

AI agent (Claude, Cursor, etc.). Progressive discovery with structured output. Each missing piece returns state + instructions for agent.

```bash
xano init --agent
# or auto-detected via CLAUDECODE=1, CURSOR_TRACE_ID, etc.
```

### Mode Compatibility

| Mode | Flag | Compatible With |
|------|------|-----------------|
| Interactive | (default) | — |
| Non-Interactive | `--no-interaction` | Silent scripts |
| Agent | `--agent` | AI assistants |

**Error:** `--no-interaction` and `--agent` together trigger an error (mutually exclusive).

### Dry Run Mode

The `--dry-run` flag enables preview mode. It follows the full initialization algorithm including:
- All prompts (interactive mode)
- Progressive discovery responses (agent mode)
- Conflict detection and resolution
- Validation checks

The difference: **no files are written**. Instead, the final output includes a preview of what would be written.

| Mode | With --dry-run |
|------|----------------|
| Interactive | Prompts as normal, shows preview at end |
| Non-Interactive | Validates all inputs, shows preview or errors |
| Agent | Progressive discovery as normal, final response includes preview |

---

## Command Structure

```
xano init [subcommand] [options]

Subcommands:
  (none)      Full initialization (profile + project)
  profile     Create/manage profiles only
  project     Project setup only (uses existing profile)
  login       Browser-based authentication (acquires access token)

Examples:
  xano init                          # Full interactive setup
  xano init login                    # Login via browser, save token
  xano init login --profile=MyApp    # Login and save to specific profile
  xano init profile                  # Manage profiles
  xano init project                  # Initialize project using default profile
  xano init project MyProfile        # Initialize project with specific profile
```

## Command Flags

```
xano init [options]

Authentication:
  --access-token <token>    Access token for Xano Meta API
  --profile <name>          Profile name (use existing or create new)
                            If profile exists, access token is loaded from it

Project Configuration:
  --instance <url>          Instance URL (e.g., https://db.example.com)
  --workspace <id|name>     Workspace ID or name
  --branch <name>           Default branch name
  --naming <mode>           Naming mode (default, vscode, vscode_id, vscode_name)
  --datasource <name>       Default datasource (default: live)

Path Configuration:
  --paths-functions <dir>   Functions directory (default: functions)
  --paths-tables <dir>      Tables directory (default: tables)
  --paths-apis <dir>        APIs directory (default: apis)
  --paths-tasks <dir>       Tasks directory (default: tasks)
  ... (all path options)
  --paths-autodiscover      Autodiscover paths from existing .xs files

Mode Control:
  --no-interaction          Non-interactive mode (fail on missing data)
  --agent                   Agent mode (structured output, progressive discovery)
  --force                   Override conflicts without prompting
  --json                    Output as JSON (implies structured output)
  --dry-run                 Preview changes without writing files
```

---

## Architecture

### Core Components

```
┌─────────────────────────────────────────────────────────────────┐
│                         Init Engine                              │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Configuration Data Object                   │    │
│  │  - accessToken    - workspace      - paths              │    │
│  │  - profile        - branch         - naming             │    │
│  │  - instance       - instanceName   - ...                │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│                              ▼                                   │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    Event System                          │    │
│  │  - onMissingData(field, context)                        │    │
│  │  - onConflict(field, sources, values)                   │    │
│  │  - onValidationError(field, error)                      │    │
│  │  - onProgress(step, status)                             │    │
│  │  - onComplete(result)                                   │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                               │
            ┌──────────────────┼──────────────────┐
            ▼                  ▼                  ▼
    ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
    │  Interactive │   │    Silent    │   │    Agent     │
    │   Frontend   │   │   Frontend   │   │   Frontend   │
    │              │   │              │   │              │
    │  - prompts   │   │  - errors    │   │  - JSON      │
    │  - wizards   │   │  - exit(1)   │   │  - state     │
    │  - confirm   │   │  - quiet     │   │  - guidance  │
    └──────────────┘   └──────────────┘   └──────────────┘
```

### Configuration Data Object

```typescript
interface InitConfig {
  // Authentication
  accessToken?: string
  profile?: string

  // Instance
  instance?: string         // User input: URL or short name
  instanceName?: string     // Resolved: canonical ID (e.g., "x8yf-zrk9-qtux")
  instanceDisplay?: string  // Profile name chosen by user (e.g., "Greenroom")
  instanceOrigin?: string   // Resolved: https://x8yf-zrk9-qtux.xano.io

  // Project
  workspace?: number       // Workspace ID only
  workspaceName?: string   // Derived from API
  branch?: string          // Default branch

  // Configuration
  naming?: NamingMode
  paths?: XanoPaths
  datasource?: string      // Default datasource
  datasources?: Record<string, 'read-write' | 'read-only' | 'locked'>

  // Metadata
  sources: {
    [field: string]: 'flag' | 'config.json' | 'xano.json' | 'credentials.yaml' | 'api' | 'prompt' | 'autodiscovery'
  }
}
```

### Event Types

```typescript
interface InitEvents {
  onMissingData: (event: {
    field: string
    description: string
    required: boolean
    suggestions?: string[]
  }) => Promise<string | undefined>

  onConflict: (event: {
    field: string
    sources: Array<{ source: string; value: unknown }>
    recommendation: string
  }) => Promise<'keep' | 'override' | 'abort'>

  onValidationError: (event: {
    field: string
    value: unknown
    error: string
    suggestions?: string[]
  }) => Promise<string | undefined>

  onProgress: (event: {
    step: string
    status: 'pending' | 'running' | 'complete' | 'error'
    message?: string
  }) => void

  onComplete: (event: {
    success: boolean
    config: InitConfig
    filesCreated: string[]
    warnings: string[]
  }) => void
}
```

---

## Initialization Flow

### Step 1: Organize Access

Determine if user has access to Xano.

```
┌─────────────────────────────────────────────────────┐
│                  Check Access                        │
└─────────────────────────────────────────────────────┘
                         │
          ┌──────────────┴──────────────┐
          ▼                             ▼
   --access-token?                 --profile?
          │                             │
          ▼                             ▼
   Create new profile          Load existing profile
          │                             │
          └──────────────┬──────────────┘
                         ▼
              Both provided? ──────► Conflict: override profile?
                         │
                         ▼
                  Neither? ──────► Search files:
                         │         1. ~/.xano/credentials.yaml
                         │         2. .xano/config.json
                         │         3. xano.json
                         ▼
                  Resolve access
```

#### Access Resolution Priority

1. `--access-token` flag → Create/update profile
2. `--profile` flag → Load from credentials.yaml
3. `.xano/config.json` → Extract instanceName, try to match profile
4. `xano.json` → Extract profile reference
5. `~/.xano/credentials.yaml` → Use default profile
6. **(Interactive only)** No credentials found → Prompt for authentication method

#### Interactive Authentication Prompt

When no existing credentials are found, interactive mode prompts:

```
How would you like to authenticate?
  ❯ Login via browser (opens Xano login page)
    Enter access token manually
```

| Choice | Action |
|--------|--------|
| Login via browser | Start local HTTP server, open browser to Xano login, wait for callback |
| Enter access token | Prompt for token input (password field) |

After successful authentication, the CLI prompts for a profile name:

```
? Profile name: (Deligo)
```

The suggested name is derived from the instance display name (TitleCase), but the user can customize it. After authentication, continue with instance/workspace resolution.

#### Agent Mode Authentication

In agent mode, when no credentials are found:

1. Agent calls `xano init login`
2. Command opens browser, waits for user to login
3. On success, command outputs the token (last line of output)
4. Agent captures token from stdout
5. Agent continues: `xano init --agent --access-token=<token>`

This allows the agent to handle the browser-based flow without interactive prompts.

### Step 2: Resolve Instance

```
┌─────────────────────────────────────────────────────┐
│                 Resolve Instance                     │
└─────────────────────────────────────────────────────┘
                         │
          ┌──────────────┴──────────────┐
          ▼                             ▼
   --instance flag?              Profile has instance?
          │                             │
          ▼                             ▼
   Parse URL/name               Use profile.instance_origin
          │                             │
          └──────────────┬──────────────┘
                         ▼
              Validate via API: GET /api:meta/instance
                         │
                         ▼
              Store: instanceName, instanceOrigin
```

#### Instance Input Formats

| Input | Resolution |
|-------|------------|
| `https://db.example.com` | Extract subdomain → resolve via API |
| `db.example.com` | Add https:// → resolve via API |
| `db` | Match against profile instances |
| `a1b2-c3d4-e5f6` | Direct canonical ID |

### Step 3: Resolve Workspace

```
┌─────────────────────────────────────────────────────┐
│                 Resolve Workspace                    │
└─────────────────────────────────────────────────────┘
                         │
          ┌──────────────┴──────────────┐
          ▼                             ▼
   --workspace flag?            xano.json has workspace?
          │                             │
          ▼                             ▼
   Validate ID/name              Use existing value
          │                             │
          └──────────────┬──────────────┘
                         │
          No flag or xano.json? ─────────────────────────┐
                         │                               │
                         ▼                               ▼
              Interactive/Agent?                   Non-interactive
                         │                         (use profile value)
                         ▼
              Prompt/output selection required
              (profile workspace as default)
                         │
                         ▼
              Store: workspace (ID), workspaceName
```

**Interactive Mode:** Always prompts for workspace selection. Profile's workspace shown as "(current)" and pre-selected.

**Agent Mode:** Always outputs selection required with available workspaces. Profile's workspace marked as default.

### Step 4: Resolve Branch

```
┌─────────────────────────────────────────────────────┐
│                  Resolve Branch                      │
└─────────────────────────────────────────────────────┘
                         │
          ┌──────────────┴──────────────┐
          ▼                             ▼
   --branch flag?                       │
          │                             │
          ▼                             ▼
   Validate exists              Interactive/Agent?
          │                             │
          └──────────────┬──────────────┘
                         │
                    ┌────┴────────────────────────────────┐
                    ▼                                     ▼
          Interactive/Agent                        Non-interactive
          (prompt/selection)                    (use profile or live)
                    │
                    ▼
          Profile branch as default
          Live branch marked "(live)"
```

**Interactive Mode:** Always prompts for branch selection (unless only one branch exists). Profile's branch shown as "(current)", live branch marked as "(live)".

**Agent Mode:** Always outputs selection required with available branches. Profile's branch marked as default, live branch indicated.

### Step 5: Resolve Configuration

```
┌─────────────────────────────────────────────────────┐
│              Resolve Configuration                   │
└─────────────────────────────────────────────────────┘
                         │
          ┌──────────────┴──────────────┐
          ▼                             ▼
   --naming flag?               xano.json has naming?
          │                             │
          ▼                             ▼
   Use specified            Use existing config value
          │                             │
          └──────────────┬──────────────┘
                         │
          No naming specified? ──────────────────────────┐
                         │                               │
                         ▼                               ▼
                  Interactive?                      Agent/Non-interactive
                         │                               │
                         ▼                               ▼
               Prompt for naming             Use default ('default')
                         │
          ├── --paths-* flags?
          │         │
          │         ▼
          │   Merge with defaults
          │
          ├── --paths-autodiscover or no paths?
          │         │
          │         ▼
          │   Scan .xs files, infer paths by type
          │
          ├── --datasource flag?
          │         │
          │         ▼
          │   Set defaultDatasource
          │
          └──────────────┬──────────────┘
                         ▼
              Final configuration object
```

#### Interactive Naming Prompt

When no naming scheme is specified via flag or existing config, interactive mode prompts:

```
Select naming scheme:
  ❯ vscode - VSCode extension compatible (recommended)
    default - CLI native naming
    vscode_id - VSCode with ID prefix (123_function.xs)
```

| Naming Mode | Description |
|-------------|-------------|
| `vscode` | VSCode extension compatible naming (recommended for interoperability) |
| `default` | CLI native naming with nested triggers and flat API groups |
| `vscode_id` | VSCode with ID prefix for easier identification |

### Step 5a: Paths Autodiscovery

When `--paths-autodiscover` is set or no paths are configured:

```
┌─────────────────────────────────────────────────────┐
│              Paths Autodiscovery                     │
└─────────────────────────────────────────────────────┘
                         │
                         ▼
              Scan project for *.xs files
                         │
                         ▼
              Parse each file with Xano SDK
                         │
                         ▼
              Detect XanoScript type (function, table, etc.)
                         │
                         ▼
              Group files by type
                         │
                         ▼
              Infer path pattern from directory structure:
              - functions/*.xs → paths.functions = "functions"
              - src/xano/apis/**/*.xs → paths.apis = "src/xano/apis"
                         │
                         ▼
              Apply discovered paths (if not already set)
```

**Autodiscovery Priority:**

| Source | Priority |
|--------|----------|
| `--paths-*` flags | 1 (highest) |
| `xano.json` paths | 2 |
| Autodiscovery | 3 |
| Built-in defaults | 4 (lowest) |

### Step 6: Write Files

```
┌─────────────────────────────────────────────────────┐
│                   Write Files                        │
└─────────────────────────────────────────────────────┘
                         │
    ┌────────────┬───────┼───────┬────────────────────┐
    ▼            ▼       ▼       ▼                    ▼
xano.json  config.json  datasources.json  credentials.yaml
    │            │       │                    │
    ▼            ▼       ▼                    ▼
If new or   Always    If datasources      If new profile
--force     write     configured          or --force
```

**Files written:**
- `xano.json` - Project config (if new or --force)
- `.xano/config.json` - Local state (always)
- `.xano/datasources.json` - Datasource cache (if configured)
- `~/.xano/credentials.yaml` - Profile credentials (if new/updated)

---

## Frontend Behaviors

### Interactive Frontend

```typescript
class InteractiveFrontend implements InitFrontend {
  async onMissingData(event) {
    // Prompt user for input
    const answer = await inquirer.prompt({
      type: event.suggestions ? 'list' : 'input',
      name: 'value',
      message: event.description,
      choices: event.suggestions,
    })
    return answer.value
  }

  async onConflict(event) {
    // Show conflict and ask for resolution
    const answer = await inquirer.prompt({
      type: 'list',
      name: 'action',
      message: `Conflict in ${event.field}`,
      choices: [
        { name: `Keep: ${event.sources[0].value}`, value: 'keep' },
        { name: `Override with: ${event.sources[1].value}`, value: 'override' },
        { name: 'Abort', value: 'abort' },
      ],
    })
    return answer.action
  }

  onProgress(event) {
    // Show spinner or progress message
    console.log(`${event.status === 'running' ? '⏳' : '✓'} ${event.step}`)
  }
}
```

### Silent Frontend (Non-Interactive)

```typescript
class SilentFrontend implements InitFrontend {
  async onMissingData(event) {
    if (event.required) {
      console.error(`Error: Missing required field: ${event.field}`)
      console.error(`  ${event.description}`)
      process.exit(1)
    }
    return undefined // Use default
  }

  async onConflict(event) {
    if (this.force) {
      return 'override' // --force: always override
    }
    console.error(`Error: Conflict in ${event.field}`)
    event.sources.forEach(s => console.error(`  ${s.source}: ${s.value}`))
    process.exit(1)
  }

  onProgress(event) {
    // Silent unless error
    if (event.status === 'error') {
      console.error(`Error: ${event.step}: ${event.message}`)
    }
  }
}
```

### Agent Frontend

Agent mode outputs markdown for better AI agent consumption:

```typescript
class AgentFrontend implements InitFrontend {
  private state: InitConfig = {}

  async onMissingData(event) {
    // Return markdown guidance for agent
    console.log(`# Input Required

## Current State

${this.formatState()}

## Missing: ${event.field}

${event.description}

${event.required ? '**This field is required.**' : 'This field is optional.'}

${event.suggestions ? `### Suggestions\n${event.suggestions.map(s => `- ${s}`).join('\n')}` : ''}

## Next Step

Ask the user for ${event.field}, then run:

\`\`\`bash
xano init --${event.field}=<value> ${this.buildFlags()}
\`\`\`
`)
    process.exit(0) // Exit cleanly, agent will re-run
  }

  async onConflict(event) {
    console.log(`# Conflict Detected

## Field: ${event.field}

| Source | Value |
|--------|-------|
${event.sources.map(s => `| ${s.source} | ${s.value} |`).join('\n')}

## Recommendation

${event.recommendation}

## Resolution Options

1. **Keep**: Use value from ${event.sources[0].source}
2. **Override**: Use value from ${event.sources[1].source}
3. **Manual**: User should manually edit the config files

Ask the user which option to choose.
`)
    process.exit(0)
  }

  onComplete(event) {
    console.log(`# Initialization Complete

## Configuration

| Setting | Value |
|---------|-------|
${Object.entries(event.config).map(([k, v]) => `| ${k} | ${v} |`).join('\n')}

## Files Created

${event.filesCreated.map(f => `- ${f}`).join('\n')}

${event.warnings.length > 0 ? `## Warnings\n${event.warnings.map(w => `- ${w}`).join('\n')}` : ''}

## Next Step

\`\`\`bash
xano pull
\`\`\`
`)
  }
}
```

---

## Dry Run Output

The `--dry-run` flag follows the full algorithm but instead of writing files, outputs a preview of the changes.

### Interactive Mode with --dry-run

```
$ xano init --dry-run

✓ Profile: my-profile
✓ Instance: https://db.example.com (a1b2-c3d4-e5f6)
✓ Workspace: My Workspace (123)
✓ Branch: v1
✓ Naming: vscode
✓ Paths: autodiscovered from 15 .xs files

═══════════════════════════════════════════════════════════════════
                        DRY RUN - No files written
═══════════════════════════════════════════════════════════════════

Files that would be created/updated:

┌─────────────────────────────────────────────────────────────────┐
│ xano.json (CREATE)                                               │
├─────────────────────────────────────────────────────────────────┤
│ {                                                                │
│   "instance": "https://db.example.com",                          │
│   "workspace": 123,                                              │
│   "branch": "v1",                                                │
│   "profile": "MyProfile",                                       │
│   "naming": "vscode",                                            │
│   "paths": { ... },                                              │
│   "datasources": { "live": "read-write" },                       │
│   "defaultDatasource": "live"                                    │
│ }                                                                │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ .xano/config.json (CREATE)                                       │
├─────────────────────────────────────────────────────────────────┤
│ {                                                                │
│   "instanceName": "a1b2-c3d4-e5f6",                              │
│   "instanceDisplay": "MyProfile",                                │
│   "workspaceName": "My Workspace",                               │
│   "workspaceId": 123,                                            │
│   "branch": "v1",                                                │
│   "paths": { ... }                                               │
│ }                                                                │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│ .xano/datasources.json (CREATE)                                  │
├─────────────────────────────────────────────────────────────────┤
│ {                                                                │
│   "datasources": { "live": "read-write" },                       │
│   "defaultDatasource": "live"                                    │
│ }                                                                │
└─────────────────────────────────────────────────────────────────┘

Run without --dry-run to apply these changes.
```

### Agent Mode with --dry-run

Agent mode outputs markdown for better AI agent consumption:

```markdown
# Dry Run Complete

## Configuration Summary

| Setting | Value |
|---------|-------|
| Profile | my-profile |
| Instance | https://db.example.com |
| Instance ID | a1b2-c3d4-e5f6 |
| Workspace | My Workspace (123) |
| Branch | v1 |
| Naming | vscode |
| Datasource | live |

## Files Preview

### xano.json (CREATE)

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
    "apis": "apis"
  },
  "datasources": { "live": "read-write" },
  "defaultDatasource": "live"
}
```

### .xano/config.json (CREATE)

```json
{
  "instanceName": "a1b2-c3d4-e5f6",
  "instanceDisplay": "MyProfile",
  "workspaceName": "My Workspace",
  "workspaceId": 123,
  "branch": "v1",
  "paths": { ... }
}
```

### .xano/datasources.json (CREATE)

```json
{
  "datasources": { "live": "read-write" },
  "defaultDatasource": "live"
}
```

## Next Step

Run without `--dry-run` to apply changes:

```bash
xano init --profile=my-profile --workspace=123 --branch=v1
```
```

### Non-Interactive Mode with --dry-run

Same as interactive but without prompts. Outputs preview if all required data is provided, or errors if missing.

```bash
# Success - shows preview
$ xano init --no-interaction --profile=my-profile --workspace=123 --dry-run

# Error - missing required data
$ xano init --no-interaction --dry-run
Error: Missing required field: workspace
  Workspace ID is required for non-interactive mode
```

### File Action Types

| Action | Description |
|--------|-------------|
| `create` | File does not exist, will be created |
| `update` | File exists, will be modified |
| `unchanged` | File exists with same content, no change needed |
| `skip` | File exists, would be overwritten (use --force) |

---

## Conflict Resolution

### Detection

Conflicts occur when the same field has different values from multiple sources.

| Field | Sources | Example Conflict |
|-------|---------|------------------|
| workspace | flag vs xano.json | `--workspace=123` vs `"workspaceId": 15` |
| branch | flag vs config.json | `--branch=v2` vs `"branch": "v1"` |
| instance | flag vs profile | `--instance=db.x.io` vs credentials.yaml |

### Resolution by Mode

| Mode | Default Behavior | With --force |
|------|------------------|--------------|
| Interactive | Prompt user | Override with newest |
| Non-Interactive | Error exit | Override with newest |
| Agent | Return conflict state | Override with newest |

### Source Priority (with --force)

1. Command-line flags (highest)
2. Environment variables
3. `.xano/config.json`
4. `xano.json`
5. `~/.xano/credentials.yaml` (lowest)

---

## Error Handling

### Error Categories

1. **Missing Required Data** - Field required but not provided
2. **Validation Error** - Value provided but invalid (e.g., workspace ID not found)
3. **API Error** - Xano API returned error
4. **Conflict Error** - Unresolved conflict between sources
5. **Permission Error** - Cannot write files

### Error Response by Mode

| Error Type | Interactive | Non-Interactive | Agent |
|------------|-------------|-----------------|-------|
| Missing Data | Prompt | Exit(1) + message | JSON state |
| Validation | Re-prompt | Exit(1) + message | JSON state + fix hints |
| API Error | Show + retry option | Exit(1) + message | JSON error |
| Conflict | Prompt choice | Exit(1) | JSON conflict state |
| Permission | Show + suggest fix | Exit(1) + message | JSON error + fix guide |

### Common Error Messages

| Error | Message | Cause |
|-------|---------|-------|
| Profile not found | `Profile "{name}" not found.` | `--profile` references non-existent profile without `--access-token` |
| Workspace not found (ID) | `Workspace with ID {id} not found.` | `--workspace` ID doesn't exist in the instance |
| Workspace not found (name) | `Workspace "{name}" not found.` | `--workspace` name doesn't match any workspace |
| Branch not found | `Branch "{name}" not found.` | `--branch` doesn't exist in the workspace |
| No profiles | `No profiles found. Run "xano init login" first.` | No credentials.yaml profiles exist |
| Invalid token | `Invalid access token.` | `--access-token` is expired or invalid |

---

## File Outputs

### xano.json (Project Config - Versioned)

```json
{
  "instance": "https://db.example.com",
  "workspace": 123,
  "branch": "v1",
  "profile": "MyProfile",
  "naming": "vscode",
  "paths": {
    "addOns": "addons",
    "agents": "agents",
    "agentTriggers": "agents/triggers",
    "apis": "apis",
    "functions": "functions",
    "mcpServers": "mcp_servers",
    "mcpServerTriggers": "mcp_servers/triggers",
    "middlewares": "middlewares",
    "realtimeChannels": "realtime",
    "realtimeTriggers": "realtime/triggers",
    "tables": "tables",
    "tableTriggers": "tables/triggers",
    "tasks": "tasks",
    "tools": "tools",
    "workflowTests": "workflow_tests"
  },
  "datasources": {
    "live": "read-write",
    "staging": "read-only"
  },
  "defaultDatasource": "live"
}
```

**Key fields:**
- `workspace` - Workspace ID only (number)
- `branch` - Default/initial branch for the project
- `datasources` - CLI-specific access level configuration
- `defaultDatasource` - Which datasource to use by default

### .xano/config.json (Local State - Not Versioned)

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

**Note:** No datasources here - that's CLI-only, stored in datasources.json.

### .xano/datasources.json (CLI-Only Cache)

```json
{
  "datasources": {
    "live": "read-write",
    "staging": "read-only"
  },
  "defaultDatasource": "live"
}
```

Cached from `xano.json` for CLI operations. Not shared with VS Code.

### ~/.xano/credentials.yaml (Global Credentials)

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

| Field | Required | Description |
|-------|----------|-------------|
| `access_token` | Yes | Xano API access token |
| `account_origin` | Yes | Xano account URL (usually `https://app.xano.com`) |
| `instance_origin` | Yes | Full URL to the Xano instance |
| `workspace` | No | Workspace ID (added after project setup) |
| `branch` | No | Default branch (added after project setup) |

**Profile Name Convention:** TitleCase (e.g., `MyProfile`, `InvoiceCaddyV2`)

**Profile Lifecycle:**

1. **Browser Login / Token Entry**: Creates profile with `access_token`, `account_origin`, and `instance_origin`
2. **Project Setup**: Updates profile with `workspace` and `branch` after successful initialization

**Note:** Access tokens can be loaded from profiles when `--profile` is provided, eliminating the need to always provide `--access-token`.

---

## Implementation Plan

### Phase 1: Core Engine

1. Create `InitEngine` class with configuration data object
2. Implement event system
3. Create data source readers (flags, files, API)
4. Implement resolution logic
5. Add profile-based access token loading

### Phase 2: Frontends

1. Implement `InteractiveFrontend`
2. Implement `SilentFrontend`
3. Implement `AgentFrontend`

### Phase 3: Integration

1. Refactor existing `init` command to use engine
2. Add new flags:
   - `--no-interaction`
   - `--paths-*` (all path options)
   - `--paths-autodiscover`
   - `--datasource`
3. Implement paths autodiscovery using Xano SDK
4. Implement datasources.json generation
5. Update tests

### Phase 4: Browser Login

Implement browser-based authentication for acquiring access tokens.

#### Where Browser Login is Available

Browser login is available in two places:

1. **`xano init login` subcommand** - Dedicated command for browser authentication
2. **Interactive mode auth prompt** - When creating a new profile during `xano init`

#### Subcommand: `xano init login`

Pure token acquisition via browser. No file writes - just outputs the token.

**Purpose:**
- Agent mode (agent captures token from stdout without user pasting)
- Scripts that need to acquire a token before running `xano init`
- Users who want to manually manage their tokens

```bash
xano init login
# Opens browser → user logs in → outputs token
```

**Flow:**
1. Opens browser to Xano login page
2. User authenticates in browser
3. Browser redirects to local callback server
4. Command outputs "Login successful!" followed by the token on its own line

**Note:** This command does NOT save to credentials.yaml. Use the token with `xano init --access-token=<token> --profile=<name>` to create a profile.

#### Interactive Mode Flow

When selecting "+ Create new profile" during `xano init` or `xano init profile`, the user is prompted:

```
? How would you like to authenticate?
  ❯ Login via browser (opens Xano login page)
    Enter access token manually
```

Selecting "Login via browser" triggers the browser login flow.

#### Browser Login Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                      Browser Login Flow                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
              1. Start local HTTP server on random port (localhost only)
                              │
                              ▼
              2. Generate callback URL:
                 http://localhost:{port}/callback
                              │
                              ▼
              3. Open browser to:
                 https://app.xano.com/login?dest=vscode&callback={encoded_url}
                              │
                              ▼
              4. User completes login in browser
                              │
                              ▼
              5. Xano redirects to callback with token:
                 http://localhost:{port}/callback?token={access_token}
                              │
                              ▼
              6. HTTP server receives token, shows success page in browser
                              │
                              ▼
              7. Token validated via GET /api:meta/auth/me
                              │
                              ▼
              8. Server shuts down, profile created in credentials.yaml
                 (with access_token, account_origin, instance_origin)
                              │
                              ▼
              9. Profile updated with workspace/branch after project setup
```

**Note:** The `dest=vscode` parameter is used because Xano's login page recognizes this
parameter and redirects to the callback URL with the access token. This is the same
mechanism used by the Xano VSCode extension.

**Profile Completion:** The profile created by browser login initially contains only
authentication fields (`access_token`, `account_origin`, `instance_origin`). The `workspace`
and `branch` fields are added when the user completes project initialization.

#### Implementation Details

```typescript
interface BrowserLoginOptions {
  apiUrl?: string       // Default: https://app.xano.com
  timeout?: number      // Default: 300000 (5 minutes)
}

async function browserLogin(options: BrowserLoginOptions): Promise<{
  accessToken: string
  user: { name: string; email: string }
}> {
  // 1. Start HTTP server on random port, localhost only
  const { port, server, waitForToken } = await startCallbackServer()
  const callbackUrl = `http://localhost:${port}/callback`

  // 2. Build auth URL (using dest=vscode for Xano compatibility)
  const authUrl = `https://app.xano.com/login?dest=vscode&callback=${encodeURIComponent(callbackUrl)}`

  // 3. Open browser
  await openBrowser(authUrl)

  // 4. Wait for callback with timeout
  const token = await waitForToken()

  // 5. Validate token
  const user = await validateToken(token)

  // 6. Cleanup
  server.close()

  return { accessToken: token, user }
}
```

#### Callback Server

The callback server:
- Listens on `http://localhost:{port}/callback`
- Extracts `token` query parameter
- Returns success HTML page to browser
- Resolves promise with token

```typescript
// Success page shown in browser after login
const successHtml = `
<!DOCTYPE html>
<html>
<head><title>Xano CLI - Login Successful</title></head>
<body>
  <h1>✓ Login Successful</h1>
  <p>You can close this window and return to the terminal.</p>
</body>
</html>
`
```

#### Mode Compatibility

| Mode | Browser Login |
|------|---------------|
| Interactive | First auth prompt offers browser login option |
| Non-Interactive | Use `xano init login` first, then `xano init --profile=X` |
| Agent | Call `xano init login`, capture token from stdout, continue flow |

#### Agent Mode Output

When `xano init login` completes successfully, it outputs the token for agent consumption:

```bash
$ xano init login
Opening browser for Xano login...
Waiting for authentication (timeout: 5 minutes)...

# After user completes login in browser:
Login successful!

xat_xxxxxxxxxxxxxxxxxxxx
```

The agent can capture the last line (the token) and use it:

```bash
xano init --access-token=xat_xxxxxxxxxxxxxxxxxxxx --profile=MyApp
```

Or the agent can let the login command save directly to a profile:

```bash
$ xano init login --profile=MyApp
# ... browser login ...
Login successful! Token saved to profile: MyApp

$ xano init --profile=MyApp
# Continues with saved profile
```

#### Security Considerations

1. **Localhost only**: Server binds to `127.0.0.1`, not `0.0.0.0`
2. **Random port**: Avoids conflicts and predictability
3. **Single-use**: Server closes immediately after receiving token
4. **Timeout**: 5-minute default prevents abandoned servers
5. **Token validation**: Always validate token via API before saving

### Phase 5: Deprecate cli.json

1. Migrate `naming` to `xano.json` only
2. Migrate `profile` to `xano.json` only
3. Add backward compatibility read from cli.json
4. Remove cli.json writes

---

## Resolved Decisions

### 1. Profile Auto-naming

When creating from `--access-token`:

**Priority:** If `--profile` is explicitly provided, use that name. Otherwise, derive from instance display name.

```typescript
// Profile name resolution
const profileName = flags.profile || toTitleCase(instance.display || 'Default')

function toTitleCase(displayName: string): string {
  return displayName
    .split(/[\s_-]+/)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join('')
}
// "My Company Instance" → "MyCompanyInstance"
// "invoice-caddy-v2" → "InvoiceCaddyV2"
```

| Mode | With `--profile` | Without `--profile` |
|------|------------------|---------------------|
| Interactive | Use provided name | Show suggested name, prompt for confirmation/override |
| Non-Interactive | Use provided name, create profile | Use TitleCase name; requires `--force` if profile exists |
| Agent | Use provided name | Return suggested name with guidance |

**Profile Name Convention:** TitleCase without separators (e.g., `MyProfile`, `InvoiceCaddyV2`).

### 2. Instance URL Parsing

**Strategy:** Parse then normalize. Support custom domains.

| Input | Processing |
|-------|------------|
| `https://db.example.com` | Extract subdomain → API lookup |
| `db.example.com` | Add `https://` → extract subdomain → API lookup |
| `db` | Try as short name → match against known instances |
| `a1b2-c3d4-e5f6` | Direct canonical ID |
| `https://api.mycompany.com` | Custom domain → API call to `/api:meta/instance` to resolve |

Normalization ensures consistent storage regardless of input format.

### 3. Workspace Validation

#### Workspace by ID

When `--workspace` is a numeric ID, the CLI validates it exists before proceeding.

```typescript
// Workspace ID validation
const workspaces = await engine.fetchWorkspaces(accessToken, instanceOrigin)
const found = workspaces.find(w => w.id === workspaceId)
if (!found) {
  this.error(`Workspace with ID ${workspaceId} not found.`)
}
```

| Mode | Workspace ID Not Found |
|------|------------------------|
| Interactive | Error with message, available workspaces suggested |
| Non-Interactive | Error: `Workspace with ID {id} not found.` |
| Agent | Return error with available workspaces for user selection |

#### Workspace by Name

**Strategy:** Exact match first. If no exact match, fuzzy handling per mode.

```typescript
function findWorkspace(workspaces: Workspace[], input: string): MatchResult {
  // Try exact match (case-sensitive)
  const exact = workspaces.find(w => w.name === input)
  if (exact) return { type: 'exact', workspace: exact }

  // Try case-insensitive
  const caseInsensitive = workspaces.find(
    w => w.name.toLowerCase() === input.toLowerCase()
  )
  if (caseInsensitive) return { type: 'similar', workspace: caseInsensitive }

  // Try partial match
  const partial = workspaces.filter(
    w => w.name.toLowerCase().includes(input.toLowerCase())
  )
  if (partial.length > 0) return { type: 'partial', matches: partial }

  return { type: 'none' }
}
```

| Mode | Exact Match | Similar Match | Partial/None |
|------|-------------|---------------|--------------|
| Interactive | Use it | Confirm with suggestion | Select from list |
| Non-Interactive | Use it | Error (ambiguous) | Error |
| Agent | Use it | Return list + suggestion to auto-fix if close enough | Return list for user selection |

**Agent guidance:** If similarity is high (e.g., only case difference), agent can proceed with auto-fix. Otherwise, ask user.

### 4. Branch Validation

**Strategy:** When `--branch` flag is provided, validate it exists. Error if not found.

```typescript
// Branch validation when flag provided
const found = branches.find(b => b.label === branchFlag)
if (!found) {
  this.error(`Branch "${branchFlag}" not found.`)
}
```

| Mode | Branch Flag Not Found |
|------|----------------------|
| Interactive | Error: `Branch "{name}" not found.` |
| Non-Interactive | Error: `Branch "{name}" not found.` |
| Agent | Return error with available branches for user selection |

**Fallback behavior (no flag):** When no `--branch` flag is provided, the CLI uses the profile's saved branch if valid, otherwise defaults to the live branch.

---

## YAML Key Constraints (Verified)

Tested with js-yaml - YAML supports all these key formats without issues:

```yaml
profiles:
  Simple Name:           # Spaces OK
  profile-with-dashes:   # Dashes OK
  profile_with_underscores:  # Underscores OK
  CamelCase:             # Mixed case OK
  special!@#chars:       # Special chars OK
  unicode-ąćę:           # Unicode OK
```

**Conclusion:** YAML supports any key format, but we use **TitleCase** for:
1. Cleaner command-line usage: `--profile=MyCompany` (no quotes needed)
2. Easier typing and tab-completion
3. Consistent naming convention matching code style

**Recommendation:** Convert to TitleCase by default, but allow override in interactive mode. Display both:
```
Suggested profile name: MyCompanyInstance
(based on "My Company Instance")
Press Enter to accept or type a different name:
```
