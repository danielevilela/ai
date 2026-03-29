export interface MRInfo {
  /** Provider-internal numeric ID */
  id: number;
  /** Per-project number — use this in tool calls (iid in GitLab / number in GitHub) */
  iid: number;
  title: string;
  description: string;
  state: string;
  author: string;
  sourceBranch: string;
  targetBranch: string;
  createdAt: string;
  updatedAt: string;
  webUrl: string;
  /** Head commit SHA */
  sha: string;
  diffRefs?: {
    baseSha: string;
    headSha: string;
    startSha: string;
  };
}

export interface CommitInfo {
  id: string;
  shortId: string;
  message: string;
  author: string;
  date: string;
}

export interface FileDiff {
  path: string;
  oldPath?: string;
  diff: string;
  additions: number;
  deletions: number;
  isNew: boolean;
  isDeleted: boolean;
  isRenamed: boolean;
}

export interface InlineCommentInput {
  filePath: string;
  /** Line number in the diff to attach the comment to */
  line: number;
  /** NEW = added lines (default), OLD = removed lines */
  side?: "NEW" | "OLD";
  body: string;
}

export interface GitProvider {
  listMRs(
    project: string,
    state?: string,
    maxResults?: number,
  ): Promise<MRInfo[]>;
  /** Cross-project: all open MRs/PRs where the given user is a requested reviewer */
  listMyReviewRequests(
    username: string,
    maxResults?: number,
  ): Promise<MRInfo[]>;
  getMR(project: string, mrId: number): Promise<MRInfo>;
  getMRDiff(project: string, mrId: number): Promise<FileDiff[]>;
  getMRCommits(project: string, mrId: number): Promise<CommitInfo[]>;
  postComment(project: string, mrId: number, body: string): Promise<void>;
  postInlineComment(
    project: string,
    mrId: number,
    comment: InlineCommentInput,
  ): Promise<{ url: string }>;
  getFileContent(
    project: string,
    filePath: string,
    ref: string,
  ): Promise<string>;
  approveMR(project: string, mrId: number): Promise<void>;
}
