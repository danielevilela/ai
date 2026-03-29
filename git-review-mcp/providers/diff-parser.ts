export interface DiffLine {
  /** Line number in the new (head) file — undefined for deleted lines */
  newLineNo?: number;
  /** Line number in the old (base) file — undefined for added lines */
  oldLineNo?: number;
  /** 'added' | 'deleted' | 'context' */
  type: "added" | "deleted" | "context";
  content: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface ParsedFileDiff {
  path: string;
  oldPath?: string;
  additions: number;
  deletions: number;
  isNew: boolean;
  isDeleted: boolean;
  isRenamed: boolean;
  hunks: DiffHunk[];
}

/**
 * Parse a raw unified diff string into structured hunks with pre-computed line numbers.
 * The AI can read `newLineNo` directly instead of parsing hunk headers itself.
 *
 * Hunk header format: @@ -oldStart,oldCount +newStart,newCount @@
 */
export function parseDiff(rawDiff: string): DiffHunk[] {
  const hunks: DiffHunk[] = [];
  if (!rawDiff || rawDiff.trim() === "") return hunks;

  const lines = rawDiff.split("\n");
  let currentHunk: DiffHunk | null = null;
  let oldLineNo = 0;
  let newLineNo = 0;

  for (const line of lines) {
    // Hunk header
    if (line.startsWith("@@")) {
      const match = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (match) {
        oldLineNo = parseInt(match[1], 10);
        newLineNo = parseInt(match[2], 10);
      }
      currentHunk = { header: line, lines: [] };
      hunks.push(currentHunk);
      continue;
    }

    // Skip file header lines (---, +++)
    if (line.startsWith("---") || line.startsWith("+++")) continue;

    if (!currentHunk) continue;

    if (line.startsWith("+")) {
      currentHunk.lines.push({
        newLineNo,
        type: "added",
        content: line.slice(1),
      });
      newLineNo++;
    } else if (line.startsWith("-")) {
      currentHunk.lines.push({
        oldLineNo,
        type: "deleted",
        content: line.slice(1),
      });
      oldLineNo++;
    } else {
      // Context line (space or empty at end of hunk)
      const content = line.startsWith(" ") ? line.slice(1) : line;
      currentHunk.lines.push({
        newLineNo,
        oldLineNo,
        type: "context",
        content,
      });
      newLineNo++;
      oldLineNo++;
    }
  }

  return hunks;
}

/** Known noise file patterns that don't need code review */
const NOISE_PATTERNS: RegExp[] = [
  /package-lock\.json$/,
  /yarn\.lock$/,
  /pnpm-lock\.yaml$/,
  /composer\.lock$/,
  /Gemfile\.lock$/,
  /Pipfile\.lock$/,
  /poetry\.lock$/,
  /\.lock$/,
  /\.min\.(js|css)$/,
  /\.map$/,
  /dist\//,
  /build\//,
  /\.snap$/,
  /node_modules\//,
  /coverage\//,
  /\.png$/,
  /\.jpe?g$/,
  /\.gif$/,
  /\.svg$/,
  /\.ico$/,
  /\.woff2?$/,
  /\.ttf$/,
  /\.eot$/,
  /\.pdf$/,
];

export function isNoisePath(filePath: string): boolean {
  return NOISE_PATTERNS.some((re) => re.test(filePath));
}
