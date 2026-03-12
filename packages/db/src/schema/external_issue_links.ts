import { pgTable, uuid, text, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { companies } from "./companies.js";
import { issues } from "./issues.js";

export const externalIssueLinks = pgTable(
  "external_issue_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").notNull().references(() => companies.id),
    provider: text("provider").notNull(), // e.g. "github"
    externalId: text("external_id").notNull(), // provider-native ID (GitHub issue id)
    externalNumber: text("external_number"), // provider-native number (GitHub issue number)
    externalUrl: text("external_url"),
    externalRepo: text("external_repo"), // "owner/repo"
    issueId: uuid("issue_id").notNull().references(() => issues.id, { onDelete: "cascade" }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    companyIdx: index("external_issue_links_company_idx").on(table.companyId),
    issueIdx: index("external_issue_links_issue_idx").on(table.companyId, table.issueId),
    providerExternalUq: uniqueIndex("external_issue_links_provider_external_uq").on(
      table.companyId,
      table.provider,
      table.externalId,
    ),
    providerIssueUq: uniqueIndex("external_issue_links_provider_issue_uq").on(
      table.companyId,
      table.provider,
      table.issueId,
    ),
  }),
);

