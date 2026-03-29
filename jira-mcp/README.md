# jira-mcp

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server that exposes Jira operations to AI assistants — search issues, create tickets, add comments, transition statuses, update fields, and attach files, all from within your AI chat.

Works with **VS Code + GitHub Copilot**, **Claude Desktop**, **Cursor**, and any MCP-compatible client.

---

## Tools

| Tool | Description |
|---|---|
| `jira_search` | Search issues using JQL |
| `jira_get_issue` | Get full details of an issue by key |
| `jira_create_issue` | Create a new issue (Bug, Story, Task, etc.) |
| `jira_add_comment` | Add a comment to an issue |
| `jira_get_my_issues` | List open issues assigned to the current user |
| `jira_transition_issue` | Move an issue to a new status |
| `jira_update_issue` | Update fields (summary, priority, assignee, labels, team, epic link, etc.) |
| `jira_attach_file` | Attach a local file to an issue |

---

## Prerequisites

- **Node.js** 18 or later
- A **Jira Personal Access Token (PAT)**

### Getting a Jira PAT

1. Log in to your Jira instance
2. Go to **Profile → Personal Access Tokens** (or `<your-jira-url>/secure/ViewProfile.jspa`)
3. Click **Create token**, give it a name, and copy the value

---

## Installation

```bash
npm install -g @danielevilela/jira-mcp
```

Or use directly with `npx` — no install needed (see Configuration below).

---

## Configuration

### VS Code (GitHub Copilot Agent Mode)

Create or edit `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "jira-mcp": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@danielevilela/jira-mcp"],
      "env": {
        "JIRA_URL": "https://your-company.atlassian.net",
        "JIRA_PAT": "your_personal_access_token"
      }
    }
  }
}
```

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "jira-mcp": {
      "command": "npx",
      "args": ["-y", "@danielevilela/jira-mcp"],
      "env": {
        "JIRA_URL": "https://your-company.atlassian.net",
        "JIRA_PAT": "your_personal_access_token"
      }
    }
  }
}
```

### Cursor

Add to **Settings → MCP**:

```json
{
  "jira-mcp": {
    "command": "npx",
    "args": ["-y", "@danielevilela/jira-mcp"],
    "env": {
      "JIRA_URL": "https://your-company.atlassian.net",
      "JIRA_PAT": "your_personal_access_token"
    }
  }
}
```

---

## Testing with MCP Inspector

The fastest way to manually test the server without an AI client:

```bash
JIRA_URL=https://your-company.atlassian.net \
JIRA_PAT=your_token \
npx @modelcontextprotocol/inspector npx @danielevilela/jira-mcp
```

This opens a browser UI where you can call each tool interactively.

---

## Usage Examples

Once connected, you can ask your AI assistant things like:

> *"Search for open critical bugs in the DROP project"*  
> *"Create a story in DROP: [API] Add rate limiting to the auth endpoint"*  
> *"Transition DROP-1234 to In Progress"*  
> *"Add a comment to DROP-5678 saying the fix is deployed to staging"*  
> *"Show me all issues assigned to me"*  
> *"Update DROP-9999 priority to High and assign it to john.doe"*

---

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `JIRA_URL` | ✅ | Base URL of your Jira instance (e.g. `https://company.atlassian.net`) |
| `JIRA_PAT` | ✅ | Personal Access Token for authentication |

---

## License

MIT
