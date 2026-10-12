import type { AgentTask } from "./task";

export const agentConfigured = () => !!process.env.AGENT_GITHUB_TOKEN;

const headers = (token: string) => ({ authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "content-type": "application/json", "x-github-api-version": "2022-11-28" });

/**
 * The open issue with exactly this title, if any, so a second click links to it instead of opening a duplicate.
 * Uses the plain issues list (the same Issues permission as creating one), not the search API, which fine-grained
 * tokens are refused for private repos with a 422.
 */
export async function findOpenIssue(repo: string, title: string, token = process.env.AGENT_GITHUB_TOKEN): Promise<string | null> {
  if (!token) throw new Error("AGENT_GITHUB_TOKEN is not set.");
  const res = await fetch(`https://api.github.com/repos/${repo}/issues?state=open&per_page=100`, { headers: headers(token) });
  if (!res.ok) throw new Error(`GitHub returned ${res.status} listing issues in ${repo}.`);
  const items = (await res.json()) as { title: string; html_url: string; pull_request?: unknown }[];
  return items.find((x) => x.title === title && !x.pull_request)?.html_url ?? null;
}

/** Opens the work order as a GitHub issue; the Claude workflow in that repo picks up the @claude mention. */
export async function createIssue(task: AgentTask, token = process.env.AGENT_GITHUB_TOKEN): Promise<{ url: string; number: number }> {
  if (!token) throw new Error("AGENT_GITHUB_TOKEN is not set.");
  const post = (labels: string[]) => fetch(`https://api.github.com/repos/${task.repo}/issues`, { method: "POST", headers: headers(token), body: JSON.stringify({ title: task.title, body: task.body, labels }) });
  let res = await post(task.labels);
  // Labels are a convenience. A token without permission to create them gets a 422; the ticket matters more than its labels.
  if (res.status === 422 && task.labels.length) res = await post([]);
  if (!res.ok) throw new Error(`GitHub returned ${res.status} creating the issue in ${task.repo}.`);
  const json = (await res.json()) as { html_url?: string; number?: number };
  if (!json.html_url || typeof json.number !== "number") throw new Error("GitHub did not return an issue URL.");
  return { url: json.html_url, number: json.number };
}

/** A plain comment on an issue (used to mark the work order with its support ticket). */
export async function commentOnIssue(repo: string, issueNumber: number, body: string, token = process.env.AGENT_GITHUB_TOKEN): Promise<void> {
  if (!token) throw new Error("AGENT_GITHUB_TOKEN is not set.");
  const res = await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`, { method: "POST", headers: headers(token), body: JSON.stringify({ body }) });
  if (!res.ok) throw new Error(`GitHub returned ${res.status} commenting on issue ${issueNumber} in ${repo}.`);
}
