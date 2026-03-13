import { and, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { companies, externalIssueLinks, githubIntegrations, issues } from "@paperclipai/db";
import { conflict, notFound, unprocessable } from "../errors.js";
import { secretService } from "./secrets.js";

type GithubIntegrationRow = typeof githubIntegrations.$inferSelect;

type GithubIssueApi = {
  id: number;
  number: number;
  title: string;
  body: string | null;
  html_url: string;
  state: "open" | "closed";
  pull_request?: unknown;
  updated_at?: string;
};

type GithubSearchResponse = {
  total_count: number;
  items: Array<{
    id: number;
    number: number;
    title: string;
    body?: string | null;
    html_url: string;
    state: "open" | "closed";
    updated_at?: string;
    pull_request?: unknown;
  }>;
};

function normalizeOwnerRepo(input: { owner: string; repo: string }) {
  const owner = input.owner.trim().replaceAll(/^@+/g, "");
  const repo = input.repo.trim().replaceAll(/\.git$/gi, "");
  if (!owner) throw unprocessable("owner is required");
  if (!repo) throw unprocessable("repo is required");
  return { owner, repo };
}

function parseNextLink(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  // <url>; rel="next", <url>; rel="last"
  const parts = linkHeader.split(",").map((p) => p.trim());
  for (const part of parts) {
    const m = part.match(/^<([^>]+)>\s*;\s*rel="next"$/);
    if (m) return m[1] ?? null;
  }
  return null;
}

function snippet(input: string | null | undefined, maxLen: number = 140) {
  const raw = (input ?? "").trim().replace(/\s+/g, " ");
  if (!raw) return "";
  return raw.length > maxLen ? `${raw.slice(0, maxLen - 1)}…` : raw;
}

async function fetchAllGithubIssues(input: {
  owner: string;
  repo: string;
  token: string;
  maxPages?: number;
}): Promise<GithubIssueApi[]> {
  const { owner, repo, token } = input;
  const maxPages = Math.max(1, input.maxPages ?? 10);

  let url: string | null = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues?state=all&per_page=100`;
  const out: GithubIssueApi[] = [];
  let page = 0;

  while (url && page < maxPages) {
    page++;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "paperclip",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw unprocessable(`GitHub API error (${res.status}): ${text || res.statusText}`);
    }
    const json = (await res.json()) as unknown;
    if (!Array.isArray(json)) {
      throw unprocessable("Unexpected GitHub API response");
    }
    for (const raw of json) {
      if (!raw || typeof raw !== "object") continue;
      const issue = raw as GithubIssueApi;
      // Skip PRs (GitHub returns PRs in /issues endpoint)
      if (issue.pull_request) continue;
      if (typeof issue.id !== "number" || typeof issue.number !== "number") continue;
      if (typeof issue.title !== "string") continue;
      if (typeof issue.html_url !== "string") continue;
      if (issue.state !== "open" && issue.state !== "closed") continue;
      out.push({
        id: issue.id,
        number: issue.number,
        title: issue.title,
        body: typeof issue.body === "string" ? issue.body : null,
        html_url: issue.html_url,
        state: issue.state,
      });
    }

    url = parseNextLink(res.headers.get("link"));
  }
  return out;
}

async function searchGithubIssuesViaApi(input: {
  owner: string;
  repo: string;
  token: string;
  q?: string;
  state?: "open" | "closed" | "all";
  page?: number;
  perPage?: number;
}): Promise<GithubSearchResponse> {
  const owner = input.owner;
  const repo = input.repo;
  const q = (input.q ?? "").trim();
  const state = input.state ?? "open";
  const page = Math.max(1, input.page ?? 1);
  const perPage = Math.max(1, Math.min(50, input.perPage ?? 25));

  const terms: string[] = [`repo:${owner}/${repo}`, "type:issue"];
  if (state !== "all") terms.push(`state:${state}`);
  if (q) {
    // Search title/body. (GitHub Search supports "in:title,body".)
    terms.push("in:title,body");
    terms.push(q);
  }
  const query = encodeURIComponent(terms.join(" "));
  const url = `https://api.github.com/search/issues?q=${query}&sort=updated&order=desc&page=${page}&per_page=${perPage}`;

  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${input.token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "paperclip",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw unprocessable(`GitHub API error (${res.status}): ${text || res.statusText}`);
  }
  const json = (await res.json()) as unknown;
  if (!json || typeof json !== "object") throw unprocessable("Unexpected GitHub API response");
  const payload = json as GithubSearchResponse;
  if (!Array.isArray(payload.items) || typeof payload.total_count !== "number") {
    throw unprocessable("Unexpected GitHub Search response");
  }
  return payload;
}

function toPaperclipStatus(state: "open" | "closed") {
  return state === "closed" ? "done" : "todo";
}

function toImportedDescription(input: { body: string | null; url: string; repoFullName: string; number: number }) {
  const body = input.body?.trim() || "";
  const header = `Imported from GitHub: ${input.repoFullName}#${input.number}\n${input.url}\n`;
  if (!body) return header;
  return `${header}\n---\n\n${body}`;
}

export function githubIntegrationService(db: Db) {
  const secrets = secretService(db);

  async function list(companyId: string): Promise<GithubIntegrationRow[]> {
    return db
      .select()
      .from(githubIntegrations)
      .where(eq(githubIntegrations.companyId, companyId))
      .orderBy(githubIntegrations.owner, githubIntegrations.repo, githubIntegrations.createdAt);
  }

  async function get(companyId: string, ownerRaw: string, repoRaw: string): Promise<GithubIntegrationRow | null> {
    const { owner, repo } = normalizeOwnerRepo({ owner: ownerRaw, repo: repoRaw });
    return db
      .select()
      .from(githubIntegrations)
      .where(and(eq(githubIntegrations.companyId, companyId), eq(githubIntegrations.owner, owner), eq(githubIntegrations.repo, repo)))
      .then((rows) => rows[0] ?? null);
  }

  async function upsert(input: {
    companyId: string;
    owner: string;
    repo: string;
    tokenSecretId: string;
    enabled?: boolean;
  }): Promise<GithubIntegrationRow> {
    const { owner, repo } = normalizeOwnerRepo({ owner: input.owner, repo: input.repo });
    const now = new Date();
    const existing = await get(input.companyId, owner, repo);
    if (existing) {
      const updated = await db
        .update(githubIntegrations)
        .set({
          tokenSecretId: input.tokenSecretId,
          enabled: input.enabled ?? true,
          updatedAt: now,
        })
        .where(eq(githubIntegrations.id, existing.id))
        .returning()
        .then((rows) => rows[0] ?? null);
      if (!updated) throw notFound("Integration not found");
      return updated;
    }

    const [created] = await db
      .insert(githubIntegrations)
      .values({
        companyId: input.companyId,
        owner,
        repo,
        tokenSecretId: input.tokenSecretId,
        enabled: input.enabled ?? true,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return created;
  }

  async function setEnabled(companyId: string, ownerRaw: string, repoRaw: string, enabled: boolean) {
    const { owner, repo } = normalizeOwnerRepo({ owner: ownerRaw, repo: repoRaw });
    const existing = await get(companyId, owner, repo);
    if (!existing) throw notFound("GitHub integration not found");
    const updated = await db
      .update(githubIntegrations)
      .set({ enabled, updatedAt: new Date() })
      .where(eq(githubIntegrations.id, existing.id))
      .returning()
      .then((rows) => rows[0] ?? null);
    if (!updated) throw notFound("GitHub integration not found");
    return updated;
  }

  async function remove(companyId: string, ownerRaw: string, repoRaw: string) {
    const { owner, repo } = normalizeOwnerRepo({ owner: ownerRaw, repo: repoRaw });
    const existing = await get(companyId, owner, repo);
    if (!existing) throw notFound("GitHub integration not found");
    await db.delete(githubIntegrations).where(eq(githubIntegrations.id, existing.id));
    return existing;
  }

  async function searchIssues(input: {
    companyId: string;
    owner: string;
    repo: string;
    q?: string;
    state?: "open" | "closed" | "all";
    page?: number;
    perPage?: number;
  }) {
    const { owner, repo } = normalizeOwnerRepo({ owner: input.owner, repo: input.repo });
    const integration = await get(input.companyId, owner, repo);
    if (!integration) throw notFound("GitHub integration not found");
    if (!integration.enabled) throw conflict("GitHub integration is disabled");

    const token = await secrets.resolveValue(input.companyId, integration.tokenSecretId, "latest");
    const result = await searchGithubIssuesViaApi({
      owner,
      repo,
      token,
      q: input.q,
      state: input.state,
      page: input.page,
      perPage: input.perPage,
    });

    const issueIds = result.items
      .filter((it) => !it.pull_request)
      .map((it) => String(it.id));

    const existingLinks =
      issueIds.length === 0
        ? []
        : await db
            .select({ externalId: externalIssueLinks.externalId })
            .from(externalIssueLinks)
            .where(
              and(
                eq(externalIssueLinks.companyId, input.companyId),
                eq(externalIssueLinks.provider, "github"),
                inArray(externalIssueLinks.externalId, issueIds),
              ),
            );

    const importedSet = new Set(existingLinks.map((r) => r.externalId));

    return {
      owner,
      repo,
      total: result.total_count,
      items: result.items
        .filter((it) => !it.pull_request)
        .map((it) => ({
          id: it.id,
          number: it.number,
          title: it.title,
          bodySnippet: snippet(it.body, 160),
          url: it.html_url,
          state: it.state,
          updatedAt: it.updated_at ?? "",
          isImported: importedSet.has(String(it.id)),
        })),
    };
  }

  async function importIssues(input: {
    companyId: string;
    owner: string;
    repo: string;
    issueNumbers: number[];
  }) {
    const { owner, repo } = normalizeOwnerRepo({ owner: input.owner, repo: input.repo });
    const integration = await get(input.companyId, owner, repo);
    if (!integration) throw notFound("GitHub integration not found");
    if (!integration.enabled) throw conflict("GitHub integration is disabled");

    const token = await secrets.resolveValue(input.companyId, integration.tokenSecretId, "latest");
    const repoFullName = `${owner}/${repo}`;
    const now = new Date();

    let imported = 0;
    let alreadyImported = 0;
    let updatedExisting = 0;

    for (const issueNumber of input.issueNumbers) {
      const res = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${issueNumber}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/vnd.github+json",
            "User-Agent": "paperclip",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw unprocessable(`GitHub API error (${res.status}): ${text || res.statusText}`);
      }
      const gh = (await res.json()) as GithubIssueApi;
      if (gh.pull_request) continue;

      const externalId = String(gh.id);
      const existingLink = await db
        .select()
        .from(externalIssueLinks)
        .where(
          and(
            eq(externalIssueLinks.companyId, input.companyId),
            eq(externalIssueLinks.provider, "github"),
            eq(externalIssueLinks.externalId, externalId),
          ),
        )
        .then((rows) => rows[0] ?? null);

      const nextDescription = toImportedDescription({
        body: gh.body,
        url: gh.html_url,
        repoFullName,
        number: gh.number,
      });
      const nextStatus = toPaperclipStatus(gh.state);

      if (existingLink) {
        alreadyImported++;
        await db
          .update(issues)
          .set({
            title: gh.title,
            description: nextDescription,
            status: nextStatus,
            ...(nextStatus === "done" ? { completedAt: now } : { completedAt: null }),
            updatedAt: now,
          })
          .where(and(eq(issues.id, existingLink.issueId), eq(issues.companyId, input.companyId)));
        updatedExisting++;
        continue;
      }

      await db.transaction(async (tx) => {
        const [company] = await tx
          .update(companies)
          .set({ issueCounter: sql`${companies.issueCounter} + 1` })
          .where(eq(companies.id, input.companyId))
          .returning({ issueCounter: companies.issueCounter, issuePrefix: companies.issuePrefix });
        const nextIssueNumber = company.issueCounter;
        const identifier = `${company.issuePrefix}-${nextIssueNumber}`;

        const [createdIssue] = await tx
          .insert(issues)
          .values({
            companyId: input.companyId,
            title: gh.title,
            description: nextDescription,
            status: nextStatus,
            priority: "medium",
            issueNumber: nextIssueNumber,
            identifier,
            requestDepth: 0,
            createdAt: now,
            updatedAt: now,
            ...(nextStatus === "done" ? { completedAt: now } : {}),
          })
          .returning();

        await tx.insert(externalIssueLinks).values({
          companyId: input.companyId,
          provider: "github",
          externalId,
          externalNumber: String(gh.number),
          externalUrl: gh.html_url,
          externalRepo: repoFullName,
          issueId: createdIssue.id,
          lastSyncedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      });

      imported++;
    }

    return { owner, repo, imported, alreadyImported, updatedExisting };
  }

  async function sync(companyId: string, ownerRaw: string, repoRaw: string) {
    const { owner, repo } = normalizeOwnerRepo({ owner: ownerRaw, repo: repoRaw });
    const integration = await get(companyId, owner, repo);
    if (!integration) throw notFound("GitHub integration not found");
    if (!integration.enabled) throw conflict("GitHub integration is disabled");

    const token = await secrets.resolveValue(companyId, integration.tokenSecretId, "latest");
    const repoFullName = `${owner}/${repo}`;

    const ghIssues = await fetchAllGithubIssues({ owner, repo, token, maxPages: 20 });
    const now = new Date();

    return db.transaction(async (tx) => {
      let updated = 0;

      for (const gh of ghIssues) {
        const externalId = String(gh.id);
        const existingLink = await tx
          .select()
          .from(externalIssueLinks)
          .where(
            and(
              eq(externalIssueLinks.companyId, companyId),
              eq(externalIssueLinks.provider, "github"),
              eq(externalIssueLinks.externalId, externalId),
            ),
          )
          .then((rows) => rows[0] ?? null);

        const nextDescription = toImportedDescription({
          body: gh.body,
          url: gh.html_url,
          repoFullName,
          number: gh.number,
        });
        const nextStatus = toPaperclipStatus(gh.state);

        if (existingLink) {
          await tx
            .update(issues)
            .set({
              title: gh.title,
              description: nextDescription,
              status: nextStatus,
              ...(nextStatus === "done" ? { completedAt: now } : { completedAt: null }),
              updatedAt: now,
            })
            .where(and(eq(issues.id, existingLink.issueId), eq(issues.companyId, companyId)));
          await tx
            .update(externalIssueLinks)
            .set({
              externalNumber: String(gh.number),
              externalUrl: gh.html_url,
              externalRepo: repoFullName,
              lastSyncedAt: now,
              updatedAt: now,
            })
            .where(eq(externalIssueLinks.id, existingLink.id));
          updated++;
          continue;
        }
      }

      await tx
        .update(githubIntegrations)
        .set({ lastSyncedAt: now, updatedAt: now })
        .where(eq(githubIntegrations.id, integration.id));

      return { created: 0, updated, fetched: ghIssues.length, owner, repo };
    });
  }

  return { list, get, upsert, setEnabled, remove, searchIssues, importIssues, sync };
}

