import type {
  GitProvider,
  MRInfo,
  CommitInfo,
  FileDiff,
  InlineCommentInput,
} from "./base.js";

export class GitLabProvider implements GitProvider {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/$/, "") + "/api/v4";
    this.token = token;
  }

  private async request(path: string, options: RequestInit = {}): Promise<any> {
    const url = `${this.baseUrl}${path}`;
    const response = await fetch(url, {
      ...options,
      headers: {
        "PRIVATE-TOKEN": this.token,
        "Content-Type": "application/json",
        ...(options.headers as Record<string, string>),
      },
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`GitLab API error ${response.status}: ${error}`);
    }
    const text = await response.text();
    return text ? JSON.parse(text) : {};
  }

  private pid(project: string): string {
    return encodeURIComponent(project);
  }

  async listMRs(
    project: string,
    state = "opened",
    maxResults = 20,
  ): Promise<MRInfo[]> {
    // Normalize state alias
    const glState =
      state === "open" ? "opened" : state === "all" ? "all" : state;
    const data = await this.request(
      `/projects/${this.pid(project)}/merge_requests?state=${glState}&per_page=${maxResults}`,
    );
    return data.map((mr: any) => this.mapMR(mr));
  }

  async listMyReviewRequests(
    username: string,
    maxResults = 20,
  ): Promise<MRInfo[]> {
    // Global endpoint — returns MRs across all projects where username is a reviewer
    const data = await this.request(
      `/merge_requests?reviewer_username=${encodeURIComponent(username)}&state=opened&scope=all&per_page=${maxResults}`,
    );
    return data.map((mr: any) => this.mapMR(mr));
  }

  async getMR(project: string, mrId: number): Promise<MRInfo> {
    const data = await this.request(
      `/projects/${this.pid(project)}/merge_requests/${mrId}`,
    );
    return this.mapMR(data);
  }

  async getMRDiff(project: string, mrId: number): Promise<FileDiff[]> {
    const data = await this.request(
      `/projects/${this.pid(project)}/merge_requests/${mrId}/changes`,
    );
    return (data.changes ?? []).map((c: any) => {
      const lines = (c.diff ?? "").split("\n");
      const additions = lines.filter(
        (l: string) => l.startsWith("+") && !l.startsWith("+++"),
      ).length;
      const deletions = lines.filter(
        (l: string) => l.startsWith("-") && !l.startsWith("---"),
      ).length;
      return {
        path: c.new_path,
        oldPath: c.old_path !== c.new_path ? c.old_path : undefined,
        diff: c.diff ?? "",
        additions,
        deletions,
        isNew: c.new_file ?? false,
        isDeleted: c.deleted_file ?? false,
        isRenamed: c.renamed_file ?? false,
      };
    });
  }

  async getMRCommits(project: string, mrId: number): Promise<CommitInfo[]> {
    const data = await this.request(
      `/projects/${this.pid(project)}/merge_requests/${mrId}/commits`,
    );
    return data.map((c: any) => ({
      id: c.id,
      shortId: c.short_id,
      message: c.message,
      author: c.author_name,
      date: c.created_at,
    }));
  }

  async postComment(
    project: string,
    mrId: number,
    body: string,
  ): Promise<void> {
    await this.request(
      `/projects/${this.pid(project)}/merge_requests/${mrId}/notes`,
      {
        method: "POST",
        body: JSON.stringify({ body }),
      },
    );
  }

  async postInlineComment(
    project: string,
    mrId: number,
    comment: InlineCommentInput,
  ): Promise<{ url: string }> {
    const mr = await this.getMR(project, mrId);
    if (!mr.diffRefs)
      throw new Error(
        "MR diff refs not available — try again after the pipeline runs",
      );

    const position: Record<string, any> = {
      position_type: "text",
      base_sha: mr.diffRefs.baseSha,
      head_sha: mr.diffRefs.headSha,
      start_sha: mr.diffRefs.startSha,
      new_path: comment.filePath,
      old_path: comment.filePath,
    };

    if (comment.side === "OLD") {
      position.old_line = comment.line;
    } else {
      position.new_line = comment.line;
    }

    await this.request(
      `/projects/${this.pid(project)}/merge_requests/${mrId}/discussions`,
      {
        method: "POST",
        body: JSON.stringify({ body: comment.body, position }),
      },
    );

    return { url: mr.webUrl };
  }

  async getFileContent(
    project: string,
    filePath: string,
    ref: string,
  ): Promise<string> {
    const encodedPath = encodeURIComponent(filePath);
    const data = await this.request(
      `/projects/${this.pid(project)}/repository/files/${encodedPath}?ref=${encodeURIComponent(ref)}`,
    );
    return Buffer.from(data.content, "base64").toString("utf-8");
  }

  async approveMR(project: string, mrId: number): Promise<void> {
    await this.request(
      `/projects/${this.pid(project)}/merge_requests/${mrId}/approve`,
      {
        method: "POST",
      },
    );
  }

  private mapMR(mr: any): MRInfo {
    return {
      id: mr.id,
      iid: mr.iid,
      title: mr.title,
      description: mr.description ?? "",
      state: mr.state,
      author: mr.author?.name ?? mr.author?.username ?? "Unknown",
      sourceBranch: mr.source_branch,
      targetBranch: mr.target_branch,
      createdAt: mr.created_at,
      updatedAt: mr.updated_at,
      webUrl: mr.web_url,
      sha: mr.sha,
      diffRefs: mr.diff_refs
        ? {
            baseSha: mr.diff_refs.base_sha,
            headSha: mr.diff_refs.head_sha,
            startSha: mr.diff_refs.start_sha,
          }
        : undefined,
    };
  }
}
