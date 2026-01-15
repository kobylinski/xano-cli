# Xano CLI - Unimplemented API Features

Features from the Xano Metadata API not yet implemented in the CLI.

> **Note:** Branch creation is NOT available via Metadata API (tested Jan 2026).
> Only list and delete are supported. Branches must be created via Xano UI.

## Workspace Management

- [~] ~~**Delete branch**~~ - Not implementing (branch creation not available via API)
- [~] ~~Export workspace archive~~ - Out of scope
- [~] ~~Export database schema~~ - Out of scope
- [~] ~~Import database schema~~ - Out of scope
- [~] ~~Replace workspace~~ - Out of scope
- [~] ~~**File management**~~ - Out of scope for CLI tool

## API Groups & Endpoints

- [x] **Create API group** - POST new API group ✓
- [x] **Update API group** - Modify via XanoScript push ✓
- [x] **Delete API group** - DELETE group and all endpoints ✓
- [~] ~~Get OpenAPI spec~~ - Out of scope for CLI tool
- [ ] **Update API group security** - Configure access permissions
- [ ] **Update endpoint security** - Configure endpoint access controls

## Tables & Schema

- [x] **Get table schema via API** - `schema:columns` command ✓
- [x] **Replace table schema** - Used internally by schema:add/delete ✓
- [x] **Rename column** - `schema:rename` command ✓
- [x] **Delete column** - `schema:delete` command ✓
- [x] **Add column** - `schema:add` command ✓
- [x] **Get indexes** - `schema:indexes` command ✓
- [x] **Add index** - `schema add index` command ✓
- [x] **Delete index** - `schema drop index` command ✓
- [x] **Truncate table** - `data:truncate` command (deletes records iteratively) ✓

## Table Content (Data Operations)

- [x] **List/search records** - `data:list` with filters, sort, pagination ✓
- [x] **Export data** - `data:export` to JSON/CSV, batch export with --tags/--tables ✓
- [x] **Import data** - `data:import` with upsert/insert/update modes, chunking ✓
- [x] **Bulk insert** - `data:bulk` command ✓
- [x] **Bulk update** - `data:update --filter/--ids` with iterative API calls ✓
- [x] **Update by criteria** - `data:update --filter` ✓
- [x] **Bulk delete by IDs** - `data:delete --ids` ✓
- [x] **Delete by criteria** - `data:delete --filter` ✓

## Functions

- [ ] Update function security - Configure access controls
- [x] Function history - `history` command supports function runs ✓

## Tasks

- [ ] Update task security - Configure access controls
- [x] Task history - `history` command supports task runs ✓

## Real-time

- [?] Get real-time metrics - To consider
- [?] Update real-time settings - To consider

## Audit & History

- [?] Browse audit logs (all workspaces) - To evaluate usefulness
- [?] Search audit logs (all workspaces) - To evaluate usefulness
- [?] Workspace audit logs - To evaluate usefulness
- [?] Search workspace audit logs - To evaluate usefulness
- [x] **API request history** - `xano history` with filters, `history:get` for details ✓
- [x] **Middleware history** - Supported via history command ✓
- [?] Tool history - To consider
- [x] **Trigger history** - Supported via history command ✓

---

## Implementation Summary

### ✓ Completed Features

| Feature | Command | Notes |
|---------|---------|-------|
| Create API group | `push` | Auto-creates from XanoScript |
| Update API group | `push` | Updates via XanoScript |
| Delete API group | `push --clean` | Deletes when file removed |
| Truncate table | `data:truncate` | Iterative deletion |
| Data export | `data:export` | JSON/CSV, batch with --tags/--tables |
| Data import | `data:import` | upsert/insert/update modes |
| Bulk insert | `data:bulk` | With chunking support |
| Bulk update | `data:update --filter/--ids` | Filter or ID-based bulk update |
| Bulk delete | `data:delete --filter/--ids` | Filter or ID-based bulk delete |
| Request history | `history` | Browse and filter |
| History details | `history:get` | View full request/response |
| View schema | `schema describe columns` | Column definitions from API |
| View indexes | `schema describe indexes` | Table index list |
| Rename column | `schema rename column` | Atomic rename with sync |
| Add column | `schema add column` | Add column with type validation, --after/--before positioning |
| Move column | `schema move column` | Move column to new position --after/--before/--first/--last |
| Drop column | `schema drop column` | Remove column with confirmation |
| Add index | `schema add index` | Add btree, unique, fulltext, gin, gist, hash indexes |
| Drop index | `schema drop index` | Remove index by number |

### Priority Features - Next Sprint

1. **Security config** - API group and endpoint access controls

### To Consider Later

- **Real-time** - Metrics and settings
- **Tool history** - Browse and search
- **Audit logs** - Cross-workspace and workspace audit (needs evaluation of usefulness)

### Not Implementing

- **Branch deletion** - Limited branch management via API (no creation), implementing only deletion has no practical value
- **File management** - Static hosting file operations (out of scope for CLI tool)
- **OpenAPI spec** - Swagger export (out of scope for CLI tool)
- **Workspace archive** - Export/import/replace operations (out of scope)
