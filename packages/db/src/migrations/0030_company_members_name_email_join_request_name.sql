-- Add display name and email to company_memberships (for user principals)
ALTER TABLE "company_memberships" ADD COLUMN "name" text;
ALTER TABLE "company_memberships" ADD COLUMN "email" text;

-- Add name snapshot to join_requests (set when user accepts invite)
ALTER TABLE "join_requests" ADD COLUMN "request_name_snapshot" text;
