import { pgTable, uuid, text, timestamp, boolean, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { companySecrets } from "./company_secrets.js";

export const githubIntegrations = pgTable(
  "github_integrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    owner: text("owner").notNull(),
    repo: text("repo").notNull(),
    tokenSecretId: uuid("token_secret_id").notNull().references(() => companySecrets.id),
    enabled: boolean("enabled").notNull().default(true),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("github_integrations_company_idx").on(table.companyId),
    companyRepoUq: uniqueIndex("github_integrations_company_repo_uq").on(table.companyId, table.owner, table.repo),
    companyEnabledIdx: index("github_integrations_company_enabled_idx").on(table.companyId, table.enabled),
  }),
);

