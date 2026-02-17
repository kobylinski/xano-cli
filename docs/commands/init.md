# xano init

> **⚠️ OBSOLETE**: This document is outdated. See [init.draft.md](init.draft.md) for the current working specification.

Initialize a Xano project and/or configure authentication profiles.

## Synopsis

```bash
xano init                              # Full setup (profile + project)
xano init profile                      # Create/manage profiles only
xano init project                      # Project setup only (uses default profile)
xano init project <profile>            # Project setup with specific profile
```

## Description

The `init` command handles two related tasks:

1. **Profile Setup** - Configure authentication credentials stored in `~/.xano/credentials.yaml`
2. **Project Setup** - Initialize a project directory with `xano.json` and `.xano/config.json`

## Subcommands

### `xano init` (Full Setup)

Runs both profile and project setup in sequence.

**Flow:**
1. Check for existing profiles
2. If no profiles exist, prompt for access token and create one
3. Select or create a profile
4. Initialize project with selected profile

### `xano init profile`

Manage authentication profiles without initializing a project.

**Flow:**
1. Show list of existing profiles
2. Option to create new profile or view existing
3. For new profile:
   - **Browser Login** (default): Opens browser, captures token via local callback server
   - **Manual Token**: Prompt for access token directly
   - Validate token against `https://app.xano.com/api:meta/auth/me`
   - Fetch available instances
   - Select instance
   - Enter profile name
   - Optionally set default workspace and branch

### `xano init project [profile]`

Initialize a project in the current directory.

**Flow:**
1. Check if already initialized (`.xano/config.json` exists)
2. Use specified profile or default profile
3. If `xano.json` exists, use its workspace settings
4. Otherwise, prompt for workspace selection
5. Prompt for branch selection
6. Create configuration files

## Flags

| Flag | Short | Description |
|------|-------|-------------|
| `--profile` | `-p` | Profile to use or create (loads access token from it) |
| `--access-token` | | Access token (creates/updates profile) |
| `--workspace` | `-w` | Workspace ID or name |
| `--branch` | `-b` | Default branch |
| `--instance` | | Instance URL (e.g., https://db.example.com) |
| `--naming` | | Naming mode (default, vscode, vscode_id, vscode_name) |
| `--datasource` | | Default datasource (default: live) |
| `--force` | `-f` | Force reinitialize existing project |
| `--no-interaction` | | Non-interactive mode (fail on missing data) |
| `--agent` | | Agent mode: output structured markdown for AI agents |
| `--dry-run` | | Preview changes without writing files |
| `--paths-*` | | Path configuration (functions, tables, apis, etc.) |
| `--paths-autodiscover` | | Autodiscover paths from existing .xs files |

## Browser Login Flow

The CLI supports browser-based authentication similar to the VSCode extension.

### How It Works

1. CLI starts a temporary local HTTP server on a random available port
2. Opens browser to `https://app.xano.com/login?dest=cli&callback=http://localhost:{port}/callback`
3. User authenticates in browser
4. Xano redirects to callback URL with `?token=<access_token>`
5. Local server captures token and shuts down
6. Token is validated and saved to profile

### Implementation

```typescript
async function browserLogin(): Promise<string> {
  const port = await getAvailablePort()
  const callbackUrl = `http://localhost:${port}/callback`

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url!, `http://localhost:${port}`)
      if (url.pathname === '/callback') {
        const token = url.searchParams.get('token')
        if (token) {
          res.writeHead(200, { 'Content-Type': 'text/html' })
          res.end('<html><body><h1>Login successful!</h1><p>You can close this window.</p></body></html>')
          server.close()
          resolve(token)
        } else {
          res.writeHead(400)
          res.end('No token received')
          server.close()
          reject(new Error('No token in callback'))
        }
      }
    })

    server.listen(port, () => {
      const loginUrl = `https://app.xano.com/login?dest=cli&callback=${encodeURIComponent(callbackUrl)}`
      open(loginUrl) // Opens in default browser
    })

    // Timeout after 5 minutes
    setTimeout(() => {
      server.close()
      reject(new Error('Login timeout'))
    }, 300000)
  })
}
```

## Files Created

### `xano.json` (Project Root)

Created if it doesn't exist. Contains versioned project configuration:

```json
{
  "instance": "https://db.example.com",
  "workspaceId": 123,
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
- `instance` - Full instance URL (e.g., `https://db.example.com`)
- `workspaceId` - Workspace ID only (number)
- `branch` - Default/initial branch for the project
- `datasources` - CLI-specific access level configuration
- `defaultDatasource` - Which datasource to use by default

**Note:** The `workspace` field with workspace name is deprecated. Use `workspaceId` for the ID.

### `.xano/config.json` (Local State)

Created in `.xano/` directory. Contains local state shared with VS Code extension:

```json
{
  "instanceName": "a1b2-c3d4-e5f6",
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

**Note:** No datasources here - that's CLI-only.

### `.xano/datasources.json` (CLI-Only)

Cached datasource configuration for CLI operations:

```json
{
  "datasources": {
    "live": "read-write",
    "staging": "read-only"
  },
  "defaultDatasource": "live"
}
```

### `~/.xano/credentials.yaml` (Global)

Profile credentials stored in user's home directory:

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

**Profile Name Convention:** TitleCase (e.g., `InvoiceCaddyV2`, `MyProfile`)

**Note:** YAML keys (`access_token`, `instance_origin`, etc.) are defined by the Xano VSCode extension and must remain in snake_case for compatibility.

**Note:** When `--profile` is provided, the access token is loaded from the profile, eliminating the need for `--access-token`.

### `.xano/cli.json` (Deprecated)

This file is deprecated. Settings should be in `xano.json`:

| Old Location | New Location |
|--------------|--------------|
| `cli.json` → `naming` | `xano.json` → `naming` |
| `cli.json` → `profile` | `xano.json` → `profile` |

## Agent Mode

For automation and AI agents, use `--agent` flag. Agent mode outputs markdown for better AI consumption.

### Structured Output

Agent mode outputs markdown instead of interactive prompts:

**Selection Required:**
```markdown
# Selection Required

## Step: workspace

Select workspace

## Options

| Label | Value | Default |
|-------|-------|---------|
| My Workspace | 123 | ✓ |

## Next Step

After user selects, run:

\`\`\`bash
xano init --profile=MyProfile --workspace=<selected_value>
\`\`\`
```

**Input Required:**
```markdown
# Input Required

## Step: token

Enter your Xano access token

**Type:** secret

## Next Step

\`\`\`bash
xano init --access-token=<user_input>
\`\`\`
```

**Complete:**
```markdown
# Initialization Complete

## Configuration

| Setting | Value |
|---------|-------|
| Profile | MyProfile |
| Workspace | My Workspace (123) |
| Branch | v1 |

## Next Step

\`\`\`bash
xano pull
\`\`\`
```

## API Endpoints Used

| Endpoint | Purpose |
|----------|---------|
| `GET /api:meta/instance` | List instances for access token |
| `GET /api:meta/workspace` | List workspaces for instance |
| `GET /api:meta/workspace/{id}/branch` | List branches for workspace |

Base URL: `https://app.xano.com` for instance discovery, then instance-specific origin for workspace/branch.

## Examples

```bash
# First-time setup
xano init

# Create a new profile
xano init profile

# Initialize project with existing profile
xano init project MyProfile

# Non-interactive initialization (access token from profile)
xano init --profile=MyProfile --workspace=123 --branch=v1

# Non-interactive with explicit token
xano init --access-token=xat_xxx --workspace=123 --branch=v1

# Force reinitialize
xano init --force

# Autodiscover paths from existing .xs files
xano init --paths-autodiscover

# Specify datasource
xano init --datasource=staging

# Preview changes without writing files
xano init --dry-run --profile=MyProfile --workspace=123

# Dry run in agent mode
xano init --dry-run --agent --profile=MyProfile --workspace=123
```

## Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| "No profiles found" | No credentials configured | Run `xano init profile` |
| "Invalid access token" | Token validation failed | Check token in Xano dashboard |
| "Profile not found" | Specified profile doesn't exist | Run `xano init profile` to create |
| "Project already initialized" | `.xano/config.json` exists | Use `--force` to reinitialize |

## Implementation Details

**Source:** `src/commands/init/`

### Architecture

The init command uses an engine + frontend architecture:

```
┌─────────────────────────────────────────────────────────┐
│                    Init Command                          │
│  - Gathers initial config from flags/env/files          │
│  - Creates appropriate frontend based on mode           │
│  - Delegates to InitEngine for logic                    │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    InitEngine                            │
│  - Pure logic, no I/O                                   │
│  - Returns boolean success from each step               │
│  - Delegates user interaction to frontend               │
└─────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    Frontend                              │
│  - InteractiveFrontend: inquirer prompts               │
│  - SilentFrontend: errors on missing data              │
│  - AgentFrontend: markdown output                       │
└─────────────────────────────────────────────────────────┘
```

### Engine Flow

The engine uses a step-by-step flow where each step returns success/failure:

```typescript
async run(): Promise<void> {
  const config = this.gatherConfiguration()
  const frontend = this.getCurrentFrontend()
  const engine = this.getInitEngine(frontend, config)

  if (!await engine.organizeAccess()) {
    return // Missing access token, frontend handled response
  }

  if (!await engine.resolveInstance()) {
    return // Missing instance selection
  }

  if (!await engine.resolveWorkspace()) {
    return // Missing workspace selection
  }

  if (!await engine.resolveBranch()) {
    return // Missing branch selection
  }

  // All data gathered, write files
  await engine.complete()
}
```

### Frontend Interface

Each frontend implements the same interface:

```typescript
interface InitFrontend {
  // Called when data is missing - returns user input or undefined
  onMissingData(field: string): Promise<string | undefined>

  // Called when validation fails - returns corrected value or undefined
  onValidationError(field: string, error: string): Promise<string | undefined>

  // Called when conflicting values found
  onConflict(field: string, sources: ConflictSource[]): Promise<'keep' | 'override' | 'abort'>

  // Called to report progress
  onProgress(step: string, status: 'pending' | 'running' | 'complete' | 'error'): void

  // Called when initialization completes
  onComplete(result: InitResult): void
}
```

The frontend controls **what** to display and **how** to prompt. The engine controls **when** to ask and **what data** is needed.

### Credentials Abstraction

Credentials are managed through a typed abstraction that handles YAML format internally.

**Profile Name Convention:** TitleCase (e.g., `InvoiceCaddyV2`, `MyProfile`)

```typescript
// Internal application type (camelCase)
interface XanoCredentialProfile {
  name: string
  accessToken: string
  accountOrigin: string
  instanceOrigin: string
  workspace?: number
  branch?: string
}

// Credentials manager handles format conversion
class CredentialsManager {
  private profiles: Map<string, XanoCredentialProfile>

  static load(path: string): CredentialsManager
  save(path: string): void

  get(name: string): XanoCredentialProfile | undefined
  add(profile: XanoCredentialProfile): void
  remove(name: string): boolean
  setDefault(name: string): void
  getDefault(): string | undefined
  list(): XanoCredentialProfile[]
}

// Usage
const credentials = CredentialsManager.load('~/.xano/credentials.yaml')
credentials.add({
  name: 'MyProfile',
  accessToken: 'xat_xxx',
  accountOrigin: 'https://app.xano.com',
  instanceOrigin: 'https://db.example.com',
  workspace: 123,
  branch: 'v1'
})
credentials.save('~/.xano/credentials.yaml')

// Result in YAML (profile name in TitleCase):
// profiles:
//   MyProfile:
//     access_token: xat_xxx
//     account_origin: https://app.xano.com
//     instance_origin: https://db.example.com
//     workspace: 123
//     branch: v1
```

### Config Abstraction

Similarly, config files use typed abstractions:

```typescript
// Each config file type has its own manager
class XanoJsonConfig {
  static load(projectRoot: string): XanoProjectConfig | null
  static save(projectRoot: string, config: XanoProjectConfig): void
}

class LocalConfig {
  static load(projectRoot: string): XanoLocalConfig | null
  static save(projectRoot: string, config: XanoLocalConfig): void
}

class DatasourcesConfig {
  static load(projectRoot: string): XanoDatasourcesConfig | null
  static save(projectRoot: string, config: XanoDatasourcesConfig): void
}
```

### Dry-Run Mode

In dry-run mode, configs are prepared but not saved. The engine builds the complete config state, then calls `onComplete` with preview data:

```typescript
if (engine.isDryRun()) {
  const preview = engine.buildPreview() // Returns FilePreview[]
  frontend.onComplete({
    success: true,
    preview,
    filesCreated: [],
    warnings
  })
} else {
  engine.writeFiles()
  frontend.onComplete({
    success: true,
    filesCreated: ['xano.json', '.xano/config.json'],
    warnings
  })
}
```

### Git Integration

See [Git Integration](../git-integration.md) for rules about:
- When to show gitignore warnings
- What files should be versioned
- Branch tracking behavior
