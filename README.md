# PullWeights MCP Server

MCP (Model Context Protocol) server for [PullWeights](https://pullweights.com) — search, pull, and push AI models from any MCP-compatible client (Claude Desktop, Cursor, Windsurf, etc.).

Available in **TypeScript** and **Python**.

## Tools

| Tool | Description | Auth Required |
|------|-------------|:---:|
| `search` | Search models by query, framework, sort order | No |
| `ls` | List models in an org, or list your orgs | Orgs: Yes |
| `inspect` | Get model manifest (files, checksums, metadata) | No* |
| `tags` | List tags for a model | No* |
| `pull` | Download model files with SHA-256 verification | Yes |
| `push` | Upload model files (init → upload → finalize) | Yes |

\* Private models require authentication.

## Configuration

Set these environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `PULLWEIGHTS_API_KEY` | API key (`pw_...`) from [dashboard](https://pullweights.com/dashboard/api-keys) | — |
| `PULLWEIGHTS_API_URL` | API base URL override | `https://api.pullweights.com` |

## TypeScript

### Install

```bash
npm install -g @pullweights/mcp
```

### Claude Desktop config

```json
{
  "mcpServers": {
    "pullweights": {
      "command": "npx",
      "args": ["-y", "@pullweights/mcp"],
      "env": {
        "PULLWEIGHTS_API_KEY": "pw_your_key_here"
      }
    }
  }
}
```

### Build from source

```bash
cd typescript
npm install
npm run build
node dist/index.js
```

## Python

### Install

```bash
pip install pullweights-mcp
```

### Claude Desktop config

```json
{
  "mcpServers": {
    "pullweights": {
      "command": "uvx",
      "args": ["pullweights-mcp"],
      "env": {
        "PULLWEIGHTS_API_KEY": "pw_your_key_here"
      }
    }
  }
}
```

### Run from source

```bash
cd python
pip install -e .
pullweights-mcp
```

## Development

### TypeScript

```bash
cd typescript
npm install
npm run build
npm run lint
```

### Python

```bash
cd python
pip install -e ".[dev]"
ruff check .
mypy src/
```

### Testing with MCP Inspector

```bash
# TypeScript
npx @modelcontextprotocol/inspector node typescript/dist/index.js

# Python
npx @modelcontextprotocol/inspector python -m pullweights_mcp.server
```

## License

MIT
