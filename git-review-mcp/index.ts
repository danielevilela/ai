#!/usr/bin/env node
import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { GitLabProvider } from "./providers/gitlab.js";
import { GitHubProvider } from "./providers/github.js";
import type { GitProvider } from "./providers/base.js";
import { parseDiff, isNoisePath } from "./providers/diff-parser.js";

function createProvider(): GitProvider {
  const providerName = process.env.GIT_PROVIDER?.toLowerCase();
  const hasGitLab = !!(process.env.GITLAB_URL && process.env.GITLAB_TOKEN);
  const hasGitHub = !!process.env.GITHUB_TOKEN;

  if (providerName === "github" || (!providerName && !hasGitLab && hasGitHub)) {
    return new GitHubProvider(
      process.env.GITHUB_TOKEN!,
      process.env.GITHUB_URL,
    );
  }
  if (providerName === "gitlab" || (!providerName && hasGitLab)) {
    return new GitLabProvider(
      process.env.GITLAB_URL!,
      process.env.GITLAB_TOKEN!,
    );
  }

  process.stderr.write(
    "Missing provider config.\n" +
      "  GitLab: set GITLAB_URL and GITLAB_TOKEN\n" +
      "  GitHub: set GITHUB_TOKEN (optionally GIT_PROVIDER=github)\n",
  );
  process.exit(1);
}

const provider = createProvider();
const server = new Server(
  { name: "git-review-mcp", version: "1.0.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "git_list_my_reviews",
      description:
        "List all open merge requests / pull requests across all projects where the current user (GITLAB_USER / GITHUB_USER) has been requested as a reviewer.",
      inputSchema: {
        type: "object",
        properties: {
          maxResults: {
            type: "number",
            description: "Max results to return (default 20)",
          },
        },
      },
    },
    {
      name: "git_review_mr",
      description:
        "Start a code review for a merge request / pull request. " +
        "IMPORTANT: After receiving the response you MUST immediately and autonomously: " +
        "(1) Call git_get_mr_diff for EACH file in fileIndex (one at a time). " +
        "(2) Analyze every hunk — look for bugs, security issues, code smells, missing error handling, naming, logic errors. " +
        '(3) Build a comment list: for each issue found produce { filePath, line (use newLineNo for added/context lines, oldLineNo for deleted), side ("NEW" or "OLD"), severity ("bug" | "risk" | "suggestion"), body }. ' +
        '(4) IMPORTANT: Every comment body MUST start with the tag "🤖 AI REVIEW" on its own line, followed by the content. ' +
        '(5) Present the full comment list to the user grouped by severity (bugs first, then risks, then suggestions), then ask for confirmation before posting. ' +
        "Do NOT stop after showing stats. Do NOT wait for the user to ask you to fetch diffs.",
      inputSchema: {
        type: "object",
        properties: {
          project: {
            type: "string",
            description: 'Project path, e.g. "owner/repo"',
          },
          mrId: { type: "number", description: "MR/PR number" },
        },
        required: ["project", "mrId"],
      },
    },
    {
      name: "git_list_mrs",
      description:
        "List merge requests (GitLab) or pull requests (GitHub) for a project/repo",
      inputSchema: {
        type: "object",
        properties: {
          project: {
            type: "string",
            description:
              'Project path, e.g. "owner/repo" or "group/subgroup/project"',
          },
          state: {
            type: "string",
            description:
              "State filter: open/opened (default), closed, merged, all",
          },
          maxResults: {
            type: "number",
            description: "Max results to return (default 20)",
          },
        },
        required: ["project"],
      },
    },
    {
      name: "git_get_mr",
      description:
        "Get full details of a merge request / pull request including description, branches and diff refs",
      inputSchema: {
        type: "object",
        properties: {
          project: {
            type: "string",
            description: 'Project path, e.g. "owner/repo"',
          },
          mrId: {
            type: "number",
            description: "MR/PR number (iid for GitLab, PR number for GitHub)",
          },
        },
        required: ["project", "mrId"],
      },
    },
    {
      name: "git_get_mr_diff",
      description:
        "Get the diff for a specific file in a merge request / pull request. " +
        "Returns structured hunks with pre-computed line numbers (newLineNo / oldLineNo) per line — " +
        "use newLineNo for comments on added/context lines (side=NEW) and oldLineNo for deleted lines (side=OLD). " +
        "Always pass filePath — fetch one file at a time to keep token usage low.",
      inputSchema: {
        type: "object",
        properties: {
          project: {
            type: "string",
            description: 'Project path, e.g. "owner/repo"',
          },
          mrId: { type: "number", description: "MR/PR number" },
          filePath: {
            type: "string",
            description:
              "Path of the file to fetch (as listed in git_review_mr fileIndex.path)",
          },
        },
        required: ["project", "mrId", "filePath"],
      },
    },
    {
      name: "git_get_mr_commits",
      description:
        "Get the commit history (git log) for a merge request / pull request",
      inputSchema: {
        type: "object",
        properties: {
          project: {
            type: "string",
            description: 'Project path, e.g. "owner/repo"',
          },
          mrId: { type: "number", description: "MR/PR number" },
        },
        required: ["project", "mrId"],
      },
    },
    {
      name: "git_post_comment",
      description:
        "Post a general review comment (discussion note) on a merge request / pull request",
      inputSchema: {
        type: "object",
        properties: {
          project: {
            type: "string",
            description: 'Project path, e.g. "owner/repo"',
          },
          mrId: { type: "number", description: "MR/PR number" },
          body: {
            type: "string",
            description: "Comment text — markdown is supported",
          },
        },
        required: ["project", "mrId", "body"],
      },
    },
    {
      name: "git_post_inline_comment",
      description:
        "Post an inline review comment on a specific file and line number within a merge request / pull request diff. Use after git_get_mr_diff to target exact lines.",
      inputSchema: {
        type: "object",
        properties: {
          project: {
            type: "string",
            description: 'Project path, e.g. "owner/repo"',
          },
          mrId: { type: "number", description: "MR/PR number" },
          filePath: {
            type: "string",
            description:
              'File path relative to repository root, e.g. "src/utils/auth.ts"',
          },
          line: {
            type: "number",
            description:
              "Line number in the file to comment on (new file line for NEW side)",
          },
          body: {
            type: "string",
            description: "Comment text — markdown is supported",
          },
          side: {
            type: "string",
            description:
              "Which version to comment on: NEW (added lines, default) or OLD (removed lines)",
          },
        },
        required: ["project", "mrId", "filePath", "line", "body"],
      },
    },
    {
      name: "git_get_file",
      description:
        "Get the full content of a file at a specific git ref (branch, SHA, tag)",
      inputSchema: {
        type: "object",
        properties: {
          project: {
            type: "string",
            description: 'Project path, e.g. "owner/repo"',
          },
          filePath: {
            type: "string",
            description:
              'File path relative to repository root, e.g. "src/utils/auth.ts"',
          },
          ref: {
            type: "string",
            description: "Git ref: branch name, commit SHA, or tag",
          },
        },
        required: ["project", "filePath", "ref"],
      },
    },
    {
      name: "git_approve_mr",
      description: "Approve a merge request / pull request",
      inputSchema: {
        type: "object",
        properties: {
          project: {
            type: "string",
            description: 'Project path, e.g. "owner/repo"',
          },
          mrId: { type: "number", description: "MR/PR number" },
        },
        required: ["project", "mrId"],
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  try {
    switch (name) {
      case "git_list_my_reviews": {
        const username = process.env.GITLAB_USER ?? process.env.GITHUB_USER;
        if (!username)
          throw new Error("GITLAB_USER (or GITHUB_USER) env var is not set");
        const { maxResults = 20 } = args as any;
        const mrs = await provider.listMyReviewRequests(username, maxResults);
        return {
          content: [{ type: "text", text: JSON.stringify(mrs, null, 2) }],
        };
      }

      case "git_list_mrs": {
        const { project, state = "opened", maxResults = 20 } = args as any;
        const mrs = await provider.listMRs(project, state, maxResults);
        return {
          content: [{ type: "text", text: JSON.stringify(mrs, null, 2) }],
        };
      }

      case "git_get_mr": {
        const { project, mrId } = args as any;
        const mr = await provider.getMR(project, mrId);
        return {
          content: [{ type: "text", text: JSON.stringify(mr, null, 2) }],
        };
      }

      case "git_get_mr_diff": {
        const { project, mrId, filePath } = args as any;
        const diffs = await provider.getMRDiff(project, mrId);
        const match = diffs.find(
          (d) => d.path === filePath || d.oldPath === filePath,
        );
        if (!match)
          throw new Error(`File "${filePath}" not found in MR #${mrId} diff`);
        const result = {
          path: match.path,
          ...(match.oldPath ? { oldPath: match.oldPath } : {}),
          additions: match.additions,
          deletions: match.deletions,
          isNew: match.isNew,
          isDeleted: match.isDeleted,
          isRenamed: match.isRenamed,
          hunks: parseDiff(match.diff),
        };
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "git_get_mr_commits": {
        const { project, mrId } = args as any;
        const commits = await provider.getMRCommits(project, mrId);
        return {
          content: [{ type: "text", text: JSON.stringify(commits, null, 2) }],
        };
      }

      case "git_post_comment": {
        const { project, mrId, body } = args as any;
        await provider.postComment(project, mrId, body);
        return {
          content: [{ type: "text", text: `Comment posted on MR/PR #${mrId}` }],
        };
      }

      case "git_post_inline_comment": {
        const { project, mrId, filePath, line, body, side } = args as any;
        const result = await provider.postInlineComment(project, mrId, {
          filePath,
          line,
          body,
          side,
        });
        return {
          content: [
            {
              type: "text",
              text: `Inline comment posted on ${filePath}:${line}\n${result.url}`,
            },
          ],
        };
      }

      case "git_get_file": {
        const { project, filePath, ref } = args as any;
        const content = await provider.getFileContent(project, filePath, ref);
        return { content: [{ type: "text", text: content }] };
      }

      case "git_approve_mr": {
        const { project, mrId } = args as any;
        await provider.approveMR(project, mrId);
        return { content: [{ type: "text", text: `MR/PR #${mrId} approved` }] };
      }

      case "git_review_mr": {
        const { project, mrId } = args as any;

        const [mr, commits, diffs] = await Promise.all([
          provider.getMR(project, mrId),
          provider.getMRCommits(project, mrId),
          provider.getMRDiff(project, mrId),
        ]);

        const reviewable = diffs.filter((d) => !isNoisePath(d.path));
        const skipped = diffs
          .filter((d) => isNoisePath(d.path))
          .map((d) => d.path);

        const fileIndex = reviewable.map((d) => ({
          path: d.path,
          ...(d.oldPath ? { oldPath: d.oldPath } : {}),
          additions: d.additions,
          deletions: d.deletions,
          isNew: d.isNew,
          isDeleted: d.isDeleted,
          isRenamed: d.isRenamed,
        }));

        const bundle = {
          _instructions:
            `NEXT STEPS — execute these now without waiting for further input: ` +
            `(1) Call git_get_mr_diff for each of the ${reviewable.length} file(s) in fileIndex, one at a time. ` +
            `(2) For each file analyze the hunks: look for bugs, security issues, code smells, missing error handling, unclear naming, logic errors. ` +
            `(3) Classify each finding by severity: "bug" (incorrect behaviour / data loss / security), "risk" (potential regression or unintended behaviour), "suggestion" (style, clarity, test coverage). ` +
            `(4) Build a review comment list — each item: { filePath, line (newLineNo for added/context lines, oldLineNo for deleted), side ('NEW' or 'OLD'), severity, body }. ` +
            `(5) EVERY comment body MUST start with the line "🤖 AI REVIEW" followed by the comment text. ` +
            `(6) Present the full list to the user grouped by severity — bugs first, then risks, then suggestions. ` +
            `(7) Ask for confirmation before posting. When posting, submit bugs first, then risks, then suggestions.`,
          mr: {
            iid: mr.iid,
            title: mr.title,
            description: mr.description,
            author: mr.author,
            sourceBranch: mr.sourceBranch,
            targetBranch: mr.targetBranch,
            webUrl: mr.webUrl,
          },
          commits: commits.map((c) => ({
            id: c.shortId,
            message: c.message,
            author: c.author,
          })),
          fileIndex,
          stats: {
            totalFiles: diffs.length,
            reviewableFiles: reviewable.length,
            skippedFiles: skipped.length,
            skipped,
            totalAdditions: reviewable.reduce((s, d) => s + d.additions, 0),
            totalDeletions: reviewable.reduce((s, d) => s + d.deletions, 0),
          },
        };

        return {
          content: [{ type: "text", text: JSON.stringify(bundle, null, 2) }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (err: any) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
