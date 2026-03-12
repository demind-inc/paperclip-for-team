CREATE TABLE "external_issue_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"external_number" text,
	"external_url" text,
	"external_repo" text,
	"issue_id" uuid NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "github_integrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_id" uuid NOT NULL,
	"owner" text NOT NULL,
	"repo" text NOT NULL,
	"token_secret_id" uuid NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"last_synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_issue_links" ADD CONSTRAINT "external_issue_links_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "external_issue_links" ADD CONSTRAINT "external_issue_links_issue_id_issues_id_fk" FOREIGN KEY ("issue_id") REFERENCES "public"."issues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_integrations" ADD CONSTRAINT "github_integrations_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_integrations" ADD CONSTRAINT "github_integrations_token_secret_id_company_secrets_id_fk" FOREIGN KEY ("token_secret_id") REFERENCES "public"."company_secrets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "external_issue_links_company_idx" ON "external_issue_links" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "external_issue_links_issue_idx" ON "external_issue_links" USING btree ("company_id","issue_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_issue_links_provider_external_uq" ON "external_issue_links" USING btree ("company_id","provider","external_id");--> statement-breakpoint
CREATE UNIQUE INDEX "external_issue_links_provider_issue_uq" ON "external_issue_links" USING btree ("company_id","provider","issue_id");--> statement-breakpoint
CREATE INDEX "github_integrations_company_idx" ON "github_integrations" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "github_integrations_company_repo_uq" ON "github_integrations" USING btree ("company_id","owner","repo");--> statement-breakpoint
CREATE INDEX "github_integrations_company_enabled_idx" ON "github_integrations" USING btree ("company_id","enabled");