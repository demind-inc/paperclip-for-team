import { z } from "zod";

export const upsertGithubIntegrationSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  tokenSecretId: z.string().uuid(),
  enabled: z.boolean().optional(),
});

export type UpsertGithubIntegration = z.infer<typeof upsertGithubIntegrationSchema>;

export const syncGithubIntegrationSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

export type SyncGithubIntegration = z.infer<typeof syncGithubIntegrationSchema>;

export const setGithubIntegrationEnabledSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  enabled: z.boolean(),
});

export type SetGithubIntegrationEnabled = z.infer<typeof setGithubIntegrationEnabledSchema>;

export const deleteGithubIntegrationSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
});

export type DeleteGithubIntegration = z.infer<typeof deleteGithubIntegrationSchema>;

export const searchGithubIssuesSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  q: z.string().optional(),
  state: z.enum(["open", "closed", "all"]).optional(),
  page: z.number().int().min(1).optional(),
  perPage: z.number().int().min(1).max(50).optional(),
});

export type SearchGithubIssues = z.infer<typeof searchGithubIssuesSchema>;

export const importGithubIssuesSchema = z.object({
  owner: z.string().min(1),
  repo: z.string().min(1),
  issueNumbers: z.array(z.number().int().positive()).min(1),
});

export type ImportGithubIssues = z.infer<typeof importGithubIssuesSchema>;

