import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { githubIntegrationsApi } from "@/api/githubIntegrations";
import { queryKeys } from "@/lib/queryKeys";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { GithubIntegration } from "@paperclipai/shared";

type RepoRef = { owner: string; repo: string };

function repoLabel(r: RepoRef) {
  return `${r.owner}/${r.repo}`;
}

export function GithubIssueImportDialog({
  open,
  onOpenChange,
  companyId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
}) {
  const queryClient = useQueryClient();
  const [selectedRepoId, setSelectedRepoId] = useState<string>("");
  const [q, setQ] = useState("");
  const [selectedIssueNumbers, setSelectedIssueNumbers] = useState<Set<number>>(new Set());

  const integrationsQuery = useQuery({
    queryKey: queryKeys.githubIntegrations.list(companyId),
    queryFn: () => githubIntegrationsApi.list(companyId),
    enabled: !!companyId && open,
  });

  const enabledIntegrations = useMemo(
    () => (integrationsQuery.data ?? []).filter((i) => i.enabled),
    [integrationsQuery.data],
  );

  useEffect(() => {
    if (!open) return;
    if (selectedRepoId) return;
    const first = enabledIntegrations[0];
    if (first) setSelectedRepoId(first.id);
  }, [open, enabledIntegrations, selectedRepoId]);

  const selectedIntegration: GithubIntegration | null =
    (integrationsQuery.data ?? []).find((i) => i.id === selectedRepoId) ?? null;
  const repo: RepoRef | null = selectedIntegration ? { owner: selectedIntegration.owner, repo: selectedIntegration.repo } : null;

  const searchQuery = useQuery({
    queryKey: repo
      ? ["github-issue-search", companyId, repo.owner, repo.repo, q.trim()]
      : ["github-issue-search", "none"],
    queryFn: () =>
      githubIntegrationsApi.searchIssues(companyId, {
        owner: repo!.owner,
        repo: repo!.repo,
        q: q.trim() || undefined,
        state: "open",
        page: 1,
        perPage: 25,
      }),
    enabled: open && !!repo,
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!repo) throw new Error("Select a repo");
      const issueNumbers = Array.from(selectedIssueNumbers.values());
      if (issueNumbers.length === 0) throw new Error("Select at least one issue");
      return githubIntegrationsApi.importIssues(companyId, {
        owner: repo.owner,
        repo: repo.repo,
        issueNumbers,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.issues.list(companyId) });
      onOpenChange(false);
    },
  });

  const items = searchQuery.data?.items ?? [];
  const selectedCount = selectedIssueNumbers.size;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (importMutation.isPending) return;
        onOpenChange(next);
        if (!next) {
          setSelectedRepoId("");
          setQ("");
          setSelectedIssueNumbers(new Set());
        }
      }}
    >
      <DialogContent className="sm:max-w-2xl" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle>Import GitHub issues</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            <div className="sm:col-span-1">
              <div className="text-xs text-muted-foreground mb-1">Repository</div>
              <select
                className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none"
                value={selectedRepoId}
                onChange={(e) => {
                  setSelectedRepoId(e.target.value);
                  setSelectedIssueNumbers(new Set());
                  setQ("");
                }}
                disabled={integrationsQuery.isLoading || enabledIntegrations.length === 0}
              >
                <option value="" disabled>
                  {enabledIntegrations.length === 0 ? "No enabled repos" : "Select repo"}
                </option>
                {enabledIntegrations.map((i) => (
                  <option key={i.id} value={i.id}>
                    {repoLabel({ owner: i.owner, repo: i.repo })}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <div className="text-xs text-muted-foreground mb-1">Search</div>
              <div className="flex items-center gap-2">
                <input
                  className="w-full rounded-md border border-border bg-transparent px-2.5 py-2 text-sm outline-none"
                  type="text"
                  value={q}
                  placeholder="Search title/body..."
                  onChange={(e) => setQ(e.target.value)}
                  disabled={!repo}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => searchQuery.refetch()}
                  disabled={!repo || searchQuery.isFetching}
                >
                  {searchQuery.isFetching ? "Searching..." : "Search"}
                </Button>
              </div>
            </div>
          </div>

          <div className="max-h-[55vh] overflow-y-auto rounded-md border border-border">
            {integrationsQuery.isLoading ? (
              <div className="p-3 text-sm text-muted-foreground">Loading repos…</div>
            ) : enabledIntegrations.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">
                No enabled GitHub repos. Enable one in Company Settings first.
              </div>
            ) : searchQuery.isLoading ? (
              <div className="p-3 text-sm text-muted-foreground">Loading issues…</div>
            ) : searchQuery.isError ? (
              <div className="p-3 text-sm text-destructive">Failed to load GitHub issues.</div>
            ) : items.length === 0 ? (
              <div className="p-3 text-sm text-muted-foreground">No matching issues.</div>
            ) : (
              <div className="divide-y divide-border">
                {items.map((it) => {
                  const checked = selectedIssueNumbers.has(it.number);
                  const disabled = it.isImported;
                  return (
                    <label key={it.id} className="flex cursor-pointer items-start gap-3 p-3 hover:bg-muted/20">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={checked}
                        disabled={disabled}
                        onChange={(e) => {
                          const next = new Set(selectedIssueNumbers);
                          if (e.target.checked) next.add(it.number);
                          else next.delete(it.number);
                          setSelectedIssueNumbers(next);
                        }}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <div className="truncate text-sm font-medium">
                            #{it.number} {it.title}
                          </div>
                          {it.isImported && (
                            <div className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                              Imported
                            </div>
                          )}
                        </div>
                        {it.bodySnippet && (
                          <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{it.bodySnippet}</div>
                        )}
                        <div className="mt-1 text-xs text-muted-foreground">
                          <a
                            className="underline underline-offset-2"
                            href={it.url}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Open on GitHub
                          </a>
                        </div>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <div className="flex flex-1 items-center justify-between gap-2">
            <div className="text-xs text-muted-foreground">Selected: {selectedCount}</div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setSelectedIssueNumbers(new Set())}
                disabled={selectedCount === 0}
              >
                Clear
              </Button>
              <Button
                size="sm"
                onClick={() => importMutation.mutate()}
                disabled={importMutation.isPending || selectedCount === 0}
              >
                {importMutation.isPending ? "Importing..." : "Import selected"}
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

