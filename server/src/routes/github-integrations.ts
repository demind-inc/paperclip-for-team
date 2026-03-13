/// <reference path="../types/express.d.ts" />
import { Router } from "express";
import type { Db } from "@paperclipai/db";
import {
  deleteGithubIntegrationSchema,
  importGithubIssuesSchema,
  searchGithubIssuesSchema,
  setGithubIntegrationEnabledSchema,
  syncGithubIntegrationSchema,
  upsertGithubIntegrationSchema,
  type GithubIntegration,
  type GithubImportResult,
  type GithubIssueSearchResult,
  type GithubSyncResult,
} from "@paperclipai/shared";
import { validate } from "../middleware/validate.js";
import { assertBoard, assertCompanyAccess } from "./authz.js";
import { logActivity } from "../services/activity-log.js";
import { githubIntegrationService } from "../services/github-integrations.js";

export function githubIntegrationRoutes(db: Db) {
  const router = Router();
  const svc = githubIntegrationService(db);

  router.get("/companies/:companyId/integrations/github", async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);
    const integrations = await svc.list(companyId);
    res.json(integrations);
  });

  router.post("/companies/:companyId/integrations/github", validate(upsertGithubIntegrationSchema), async (req, res) => {
    assertBoard(req);
    const companyId = req.params.companyId as string;
    assertCompanyAccess(req, companyId);

    const integration = await svc.upsert({
      companyId,
      owner: req.body.owner,
      repo: req.body.repo,
      tokenSecretId: req.body.tokenSecretId,
      enabled: req.body.enabled,
    });

    await logActivity(db, {
      companyId,
      actorType: "user",
      actorId: req.actor.userId ?? "board",
      action: "integration.github.upserted",
      entityType: "github_integration",
      entityId: integration.id,
      details: { owner: integration.owner, repo: integration.repo, enabled: integration.enabled },
    });

    res.status(201).json(integration satisfies GithubIntegration);
  });

  router.patch(
    "/companies/:companyId/integrations/github",
    validate(setGithubIntegrationEnabledSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const updated = await svc.setEnabled(companyId, req.body.owner, req.body.repo, req.body.enabled);

      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "integration.github.enabled_set",
        entityType: "github_integration",
        entityId: updated.id,
        details: { owner: updated.owner, repo: updated.repo, enabled: updated.enabled },
      });

      res.json(updated satisfies GithubIntegration);
    },
  );

  router.delete(
    "/companies/:companyId/integrations/github",
    validate(deleteGithubIntegrationSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const removed = await svc.remove(companyId, req.body.owner, req.body.repo);

      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "integration.github.deleted",
        entityType: "github_integration",
        entityId: removed.id,
        details: { owner: removed.owner, repo: removed.repo },
      });

      res.json({ ok: true });
    },
  );

  router.post(
    "/companies/:companyId/integrations/github/sync",
    validate(syncGithubIntegrationSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const result = await svc.sync(companyId, req.body.owner, req.body.repo);

      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "integration.github.synced",
        entityType: "github_integration",
        entityId: `${result.owner}/${result.repo}`,
        details: result,
      });

      res.json(result satisfies GithubSyncResult);
    },
  );

  router.post(
    "/companies/:companyId/integrations/github/issues/search",
    validate(searchGithubIssuesSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const result = await svc.searchIssues({
        companyId,
        owner: req.body.owner,
        repo: req.body.repo,
        q: req.body.q,
        state: req.body.state,
        page: req.body.page,
        perPage: req.body.perPage,
      });

      res.json(result satisfies GithubIssueSearchResult);
    },
  );

  router.post(
    "/companies/:companyId/integrations/github/issues/import",
    validate(importGithubIssuesSchema),
    async (req, res) => {
      assertBoard(req);
      const companyId = req.params.companyId as string;
      assertCompanyAccess(req, companyId);

      const result = await svc.importIssues({
        companyId,
        owner: req.body.owner,
        repo: req.body.repo,
        issueNumbers: req.body.issueNumbers,
      });

      await logActivity(db, {
        companyId,
        actorType: "user",
        actorId: req.actor.userId ?? "board",
        action: "integration.github.issues_imported",
        entityType: "github_integration",
        entityId: `${result.owner}/${result.repo}`,
        details: result,
      });

      res.json(result satisfies GithubImportResult);
    },
  );

  return router;
}

