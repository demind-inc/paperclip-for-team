export type GithubIntegration = {
  id: string;
  companyId: string;
  owner: string;
  repo: string;
  tokenSecretId: string;
  enabled: boolean;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type GithubSyncResult = {
  owner: string;
  repo: string;
  fetched: number;
  created: number;
  updated: number;
};

export type GithubIssueSummary = {
  id: number;
  number: number;
  title: string;
  bodySnippet: string;
  url: string;
  state: "open" | "closed";
  updatedAt: string;
  isImported: boolean;
};

export type GithubIssueSearchResult = {
  owner: string;
  repo: string;
  total: number;
  items: GithubIssueSummary[];
};

export type GithubImportResult = {
  owner: string;
  repo: string;
  imported: number;
  alreadyImported: number;
  updatedExisting: number;
};

