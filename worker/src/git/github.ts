import { getOriginRepo } from "./worktree.js";

const pickGithubToken = (): string | null => {
  const token =
    process.env.GITHUB_TOKEN ??
    process.env.GH_TOKEN ??
    process.env.GITHUB_API_TOKEN ??
    "";
  return token.trim() ? token.trim() : null;
};

export const createPullRequest = async (args: {
  repoPath: string;
  head: string;
  base: string;
  title: string;
  body?: string;
}): Promise<{ url: string; number: number }> => {
  const token = pickGithubToken();
  if (!token) {
    throw new Error("Missing GitHub token (set GITHUB_TOKEN or GH_TOKEN) for PR creation");
  }

  const { owner, repo } = await getOriginRepo(args.repoPath);
  const url = `https://api.github.com/repos/${owner}/${repo}/pulls`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/vnd.github+json",
      "User-Agent": "mc-worker",
    },
    body: JSON.stringify({
      title: args.title,
      head: args.head,
      base: args.base,
      body: args.body ?? "",
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`GitHub PR create failed: HTTP ${res.status} ${res.statusText}: ${text.slice(0, 600)}`);
  }

  const data = (await res.json()) as { html_url?: unknown; number?: unknown };
  if (typeof data.html_url !== "string" || typeof data.number !== "number") {
    throw new Error("GitHub PR create returned unexpected payload");
  }

  return { url: data.html_url, number: data.number };
};

