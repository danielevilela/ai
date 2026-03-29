import type {
  GitProvider,
  MRInfo,
  CommitInfo,
  FileDiff,
  InlineCommentInput,
} from "./base.js";

export class GitHubProvider implements GitProvider {
  private baseUrl: string;
  private token: string;

  constructor(token: string, baseUrl = "https://api.github.com") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.token = token;
  }

  private async request(path: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
        ...(options.headers as Record<string, string>),
      },
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitHub API error ${response.status}: ${error}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }

  private splitProject(project: string): [string, string] {
    const slash = project.indexOf("/");
    if (slash === -1) throw new Error('GitHub project must be "owner/repo"');
    return [project.slice(0, slash), project.slice(slash + 1)];
  }

  async listMRs(
    project: string,
    state = "open",
    maxResults = 20,
  ): Promise<MRInfo[]> {
    const [owner, repo] = this.splitProject(project);
    // Normalize GitLab-style "opened" → "open", "merged" → "closed"
    const ghState =
      state === "opened"
        ? "open"
        : state === "merged"
          ? "closed"
          : state === "all"
            ? "all"
            : state;
    const data = await this.request(
      `/repos/${owner}/${repo}/pulls?state=${ghState}&per_page=${maxResults}`,
    );
    return data.map((pr: any) => this.mapPR(pr));
  }

  async listMyReviewRequests(
    username: string,
    maxResults = 20,
  ): Promise<MRInfo[]> {
    // GitHub search API — PRs where the user is a requested reviewer and review is pending
    const q = encodeURIComponent(`is:pr is:open review-requested:${username}`);
    const data = await this.request(
      `/search/issues?q=${q}&per_page=${maxResults}`,
    );
    return (data.items ?? []).map((item: any) => ({
      id: item.id,
      iid: item.number,
      title: item.title,
      description: item.body ?? "",
      state: item.state,
      author: item.user?.login ?? "Unknown",
      sourceBranch: "",
      targetBranch: "",
      createdAt: item.created_at,
      updatedAt: item.updated_at,
      webUrl: item.html_url,
      sha: "",
      // Extract owner/repo from the repository_url
      ...(item.repository_url
        ? {
            _project: item.repository_url.replace(
              "https://api.github.com/repos/",
              "",
            ),
          }
        : {}),
    })) as any;
  }

  async getMR(project: string, mrId: number): Promise<MRInfo> {
    const [owner, repo] = this.splitProject(project);
    const pr = await this.request(`/repos/${owner}/${repo}/pulls/${mrId}`);
    return this.mapPR(pr);
  }

  async getMRDiff(project: string, mrId: number): Promise<FileDiff[]> {
    const [owner, repo] = this.splitProject(project);
    // GitHub paginates at 100; for very large PRs this could miss files — acceptable for review use
    const data = await this.request(
      `/repos/${owner}/${repo}/pulls/${mrId}/files?per_page=100`,
    );
    return data.map((file: any) => ({
      path: file.filename,
      oldPath: file.previous_filename,
      diff: file.patch ?? "",
      additions: file.additions,
      deletions: file.deletions,
      isNew: file.status === "added",
      isDeleted: file.status === "removed",
      isRenamed: file.status === "renamed",
    }));
  }

  async getMRCommits(project: string, mrId: number): Promise<CommitInfo[]> {
    const [owner, repo] = this.splitProject(project);
    const data = await this.request(
      `/repos/${owner}/${repo}/pulls/${mrId}/commits?per_page=100`,
    );
    return data.map((c: any) => ({
      id: c.sha,
      shortId: c.sha.slice(0, 8),
      message: c.commit.message,
      author: c.commit.author?.name ?? c.author?.login ?? "Unknown",
      date: c.commit.author?.date ?? "",
    }));
  }

  async postComment(
    project: string,
    mrId: number,
    body: string,
  ): Promise<void> {
    const [owner, repo] = this.splitProject(project);
    await this.request(`/repos/${owner}/${repo}/issues/${mrId}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  }

  async postInlineComment(
    project: string,
    mrId: number,
    comment: InlineCommentInput,
  ): Promise<{ url: string }> {
    const [owner, repo] = this.splitProject(project);
    const pr = await this.getMR(project, mrId);

    // GitHub inline comment: LEFT = old (removed), RIGHT = new (added, default)
    const side = comment.side === "OLD" ? "LEFT" : "RIGHT";

    const data = await this.request(
      `/repos/${owner}/${repo}/pulls/${mrId}/comments`,
      {
        method: "POST",
        body: JSON.stringify({
          body: comment.body,
          commit_id: pr.sha,
          path: comment.filePath,
          line: comment.line,
          side,
        }),
      },
    );

    return { url: data.html_url ?? pr.webUrl };
  }

  async getFileContent(
    project: string,
    filePath: string,
    ref: string,
  ): Promise<string> {
    const [owner, repo] = this.splitProject(project);
    const data = await this.request(
      `/repos/${owner}/${repo}/contents/${filePath}?ref=${encodeURIComponent(ref)}`,
    );
    if (data.encoding === "base64") {
      return Buffer.from(data.content.replace(/\n/g, ""), "base64").toString(
        "utf-8",
      );
    }
    return data.content;
  }

  async approveMR(project: string, mrId: number): Promise<void> {
    const [owner, repo] = this.splitProject(project);
    await this.request(`/repos/${owner}/${repo}/pulls/${mrId}/reviews`, {
      method: "POST",
      body: JSON.stringify({ event: "APPROVE" }),
    });
  }

  private mapPR(pr: any): MRInfo {
    return {
      id: pr.id,
      iid: pr.number,
      title: pr.title,
      description: pr.body ?? "",
      state: pr.state,
      author: pr.user?.login ?? "Unknown",
      sourceBranch: pr.head?.ref,
      targetBranch: pr.base?.ref,
      createdAt: pr.created_at,
      updatedAt: pr.updated_at,
      webUrl: pr.html_url,
      sha: pr.head?.sha,
      diffRefs: {
        baseSha: pr.base?.sha,
        headSha: pr.head?.sha,
        startSha: pr.base?.sha,
      },
    };
  }
}
