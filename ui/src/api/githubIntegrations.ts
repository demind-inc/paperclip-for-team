import type {
  GithubImportResult,
  GithubIntegration,
  GithubIssueSearchResult,
  GithubSyncResult,
} from "@paperclipai/shared";
import { api } from "./client";

export const githubIntegrationsApi = {
  list: (companyId: string) => api.get<GithubIntegration[]>(`/companies/${companyId}/integrations/github`),
  upsert: (
    companyId: string,
    data: { owner: string; repo: string; tokenSecretId: string; enabled?: boolean },
  ) => api.post<GithubIntegration>(`/companies/${companyId}/integrations/github`, data),
  setEnabled: (companyId: string, data: { owner: string; repo: string; enabled: boolean }) =>
    api.patch<GithubIntegration>(`/companies/${companyId}/integrations/github`, data),
  remove: (companyId: string, data: { owner: string; repo: string }) =>
    api.delete<{ ok: true }>(`/companies/${companyId}/integrations/github`, data),
  sync: (companyId: string, data: { owner: string; repo: string }) =>
    api.post<GithubSyncResult>(`/companies/${companyId}/integrations/github/sync`, data),
  searchIssues: (
    companyId: string,
    data: {
      owner: string;
      repo: string;
      q?: string;
      state?: "open" | "closed" | "all";
      page?: number;
      perPage?: number;
    },
  ) => api.post<GithubIssueSearchResult>(`/companies/${companyId}/integrations/github/issues/search`, data),
  importIssues: (
    companyId: string,
    data: { owner: string; repo: string; issueNumbers: number[] },
  ) => api.post<GithubImportResult>(`/companies/${companyId}/integrations/github/issues/import`, data),
};

