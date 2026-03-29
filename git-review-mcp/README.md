# git-review-mcp

MCP server for AI-powered code review. Connect any AI assistant (GitHub Copilot, Claude, etc.) to GitLab or GitHub to list review requests, inspect diffs, and post accurate inline comments — with minimal token usage.

## Features

- **Multi-provider** — GitLab and GitHub (including self-hosted / Enterprise)
- **Review queue** — list all MRs/PRs where you are a requested reviewer, across all projects
- **Token-efficient review** — lazy-loading design: index first, fetch diffs one file at a time
- **Accurate inline comments** — diffs are parsed server-side with pre-computed line numbers; the AI reads `lineNo` directly, no hunk-math guessing
- **Noise filtering** — lock files, `dist/`, `*.map`, images and other non-reviewable files are automatically skipped
- **Post inline & general comments** — targeted per-line notes or overall MR summary
- **Read file content** — fetch any file at a given ref for broader context
- **Approve** — approve an MR/PR directly from the AI assistant

## Tools

| # | Tool | Description |
|---|------|-------------|
| 1 | `git_list_my_reviews` | List all open MRs/PRs where **you** are a requested reviewer (uses `GITLAB_USER` / `GITHUB_USER`) |
| 2 | `git_review_mr` | Start a review — returns a lightweight index (metadata, commits, file list with stats). No full diffs yet. |
| 3 | `git_list_mrs` | List MRs/PRs for a specific project |
| 4 | `git_get_mr` | Get full details of an MR/PR |
| 5 | `git_get_mr_diff` | Get the parsed diff for a **single file** — returns structured hunks with `newLineNo`/`oldLineNo` per line |
| 6 | `git_get_mr_commits` | Get commit history (git log) |
| 7 | `git_post_comment` | Post a general review comment on an MR/PR |
| 8 | `git_post_inline_comment` | Post an inline comment on a specific file + line |
| 9 | `git_get_file` | Get file content at a git ref |
| 10 | `git_approve_mr` | Approve the MR/PR |

## Token-efficient design

Raw unified diffs sent wholesale to an AI are expensive and cause line-number errors. This server solves both problems:

### Lazy loading
`git_review_mr` returns only a **file index** (~500–800 tokens for a typical MR). The AI then calls `git_get_mr_diff` for each file it decides to review — one file at a time. Files that don't need review (config tweaks, renamed files, etc.) are never fetched.

### Pre-computed line numbers
`git_get_mr_diff` parses the raw unified diff server-side and returns structured hunks:

```json
{
  "path": "src/auth.ts",
  "hunks": [
    {
      "header": "@@ -45,8 +47,9 @@",
      "lines": [
        { "newLineNo": 47, "oldLineNo": 45, "type": "context",  "content": "const user = getUser();" },
        { "newLineNo": 48,                  "type": "added",    "content": "if (!user.verified) throw new Error();" },
        {                  "oldLineNo": 46, "type": "deleted",  "content": "if (!user) return null;" }
      ]
    }
  ]
}
```

The AI reads `newLineNo: 48` directly — no hunk header parsing, no counting `+` lines. This eliminates the most common source of comments landing on the wrong line.

Use `newLineNo` for comments on added/context lines (`side: "NEW"`) and `oldLineNo` for deleted lines (`side: "OLD"`).

### Automatic noise filtering
`git_review_mr` silently skips files matching these patterns and lists them in `stats.skipped`:

`package-lock.json`, `yarn.lock`, `*.lock`, `dist/`, `build/`, `*.min.js`, `*.map`, `*.snap`, `node_modules/`, `coverage/`, images, fonts, PDFs.

## Configuration

Copy `.env.example` to `.env` and fill in your values.

### GitLab

```
GITLAB_URL=https://gitlab.example.com
GITLAB_TOKEN=<personal-access-token>   # needs "api" scope
GITLAB_USER=your-username              # used by git_list_my_reviews
```

### GitHub

```
GITHUB_TOKEN=<personal-access-token>  # needs "repo" scope
GITHUB_USER=your-login                # used by git_list_my_reviews
# For GitHub Enterprise:
GITHUB_URL=https://github.example.com/api/v3
```

When both providers are configured, GitLab takes precedence. Override with:
```
GIT_PROVIDER=github   # or gitlab
```

## VS Code MCP setup

Add to your `.vscode/mcp.json`:

```jsonc
{
  "servers": {
    "git-review": {
      "command": "npx",
      "args": ["-y", "@danielevilela/git-review-mcp"],
      "env": {
        "GITLAB_URL": "https://gitlab.example.com",
        "GITLAB_TOKEN": "${input:gitlabToken}",
        "GITLAB_USER": "your-username"
      }
    }
  }
}
```

## Review workflow

The AI follows this flow automatically when you say *"review MR #42 in project owner/repo"*:

```
git_list_my_reviews          → see what needs your attention
  ↓
git_review_mr                → lightweight index: title, commits, file list (~600 tokens)
  ↓
git_get_mr_diff (file 1)     → parsed hunks with line numbers (~300 tokens)
git_get_mr_diff (file 2)     → ...only files worth reviewing
  ↓
[AI produces comment list]   → { filePath, line, side, body } per issue found
  ↓
[You confirm / skip each]
  ↓
git_post_inline_comment × N  → comments land on the exact right lines
git_post_comment             → optional overall summary
git_approve_mr               → approve when satisfied
```

## Running locally

```bash
cp .env.example .env   # fill in your values
npm install
npm run build
node dist/index.js
```

### Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector node dist/index.js
```

Opens `http://localhost:5173` — pick `git_list_my_reviews`, run with no arguments to see your pending reviews.
