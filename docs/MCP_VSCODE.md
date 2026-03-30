# OzyBase MCP in VS Code

As of March 30, 2026, OzyBase exposes a standard remote MCP endpoint that VS Code can consume over HTTP.

## Where to find it in OzyBase

Open:

`Settings > API Keys > MCP Gateway`

Reveal the active `service_role` key. That panel now shows:

- the remote MCP server URL
- copyable JSON-RPC test commands
- a ready-to-paste `mcp.json` snippet for VS Code

## VS Code configuration

Add this to `.vscode/mcp.json` in your workspace, or to your user MCP configuration:

```json
{
  "servers": {
    "ozybase": {
      "type": "http",
      "url": "https://YOUR_DOMAIN/api/project/mcp",
      "headers": {
        "apikey": "YOUR_SERVICE_ROLE_KEY"
      }
    }
  }
}
```

## What this endpoint supports

OzyBase currently exposes these MCP methods:

- `initialize`
- `ping`
- `tools/list`
- `tools/call`

Current built-in tools:

- `system.health`
- `collections.list`
- `collections.create`
- `vector.status`
- `nlq.translate`
- `nlq.query`

## Transport note

OzyBase still keeps the original native HTTP helper endpoints:

- `GET /api/project/mcp/tools`
- `POST /api/project/mcp/invoke`

Those are useful for direct scripts and diagnostics.

For MCP-aware editors such as VS Code, prefer:

- `POST /api/project/mcp`

## Security note

Use only the `service_role` key for MCP admin automation.

Do not place that key in:

- browser code
- mobile apps
- public repos
- client-side environment files
