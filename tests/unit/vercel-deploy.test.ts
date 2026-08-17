// L9_META: layer=source, role=tracked_file, status=active, version=1.0.0

import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import test from "node:test";
import { FileEvidenceStore } from "../../src/pipeline/evidence/FileEvidenceStore.js";
import { VercelDeployStage } from "../../src/stages/VercelDeployStage.js";
import {
  cleanupContext,
  fixtureAssemblyManifest,
  fixtureContext,
  persistFixtureBuildProof,
  persistFixturePublicationEvidence,
  withEnv,
} from "../helpers/siteFactoryFixture.js";

const commit = "e".repeat(40);

async function prepareContext() {
  const ctx = fixtureContext({
    deploy: {
      github_repo: "example/disposable-site",
      github_repo_id: "123",
      vercel_project_id: "prj_123",
    },
  });
  if (!ctx.evidenceStore.rootDir.startsWith("memory://"))
    rmSync(ctx.evidenceStore.rootDir, { recursive: true, force: true });
  ctx.mode = "end-to-end";
  ctx.evidenceStore = new FileEvidenceStore({
    rootDir: `${ctx.outputDir}.e2e-evidence`,
    clientId: ctx.clientId,
    buildId: ctx.buildId,
    mode: "end-to-end",
    now: () => new Date("2026-07-20T00:00:00.000Z"),
  });
  ctx.deployTarget = {
    githubRepo: "example/disposable-site",
    githubRepoId: "123",
    sourceBranch: "main",
    vercelProjectId: "prj_123",
  };
  const assembly = fixtureAssemblyManifest(ctx);
  await ctx.evidenceStore.writeAssembly(assembly);
  await persistFixtureBuildProof(ctx, assembly.sourceDigest);
  await persistFixturePublicationEvidence(ctx, commit);
  return ctx;
}

void test("correlates READY Vercel deployment to persisted publication evidence", async () => {
  const ctx = await prepareContext();
  try {
    const fakeFetch = async (
      input: string | URL | Request,
      init: RequestInit = {},
    ): Promise<Response> => {
      const url = String(input);
      if (url.split("?")[0].endsWith("/v13/deployments")) {
        assert.equal(init.method, "POST");
        const body = JSON.parse(String(init.body)) as { gitSource?: { sha?: string } };
        assert.equal(body.gitSource?.sha, commit);
        return Response.json({ id: "dep_123", url: "preview.example.vercel.app" });
      }
      if (url.includes("/v13/deployments/dep_123"))
        return Response.json({
          id: "dep_123",
          readyState: "READY",
          url: "preview.example.vercel.app",
          aliases: ["preview.example.com"],
          projectId: "prj_123",
          meta: { githubCommitSha: commit },
          createdAt: 1_721_436_000_000,
          ready: 1_721_436_001_000,
        });
      throw new Error(`Unexpected Vercel request ${url}`);
    };
    await withEnv(
      { VERCEL_TOKEN: "test-token", VERCEL_TARGET: "preview", VERCEL_TEAM_ID: undefined },
      async () => {
        await new VercelDeployStage(
          fakeFetch,
          async () => {},
          () => new Date("2026-07-20T00:00:02.000Z"),
          0,
          2,
        ).run(ctx);
      },
    );
    const stored = await ctx.evidenceStore.readDeployment();
    assert.ok(stored);
    assert.equal(stored.value.requestedCommitSha, commit);
    assert.equal(stored.value.observedCommitSha, commit);
    assert.equal(stored.value.state, "READY");
    assert.equal(ctx.deploymentUrl, "https://preview.example.com");
    assert.equal(
      stored.value.publicationSha256,
      (await ctx.evidenceStore.readPublication())?.record.sha256,
    );
  } finally {
    cleanupContext(ctx);
  }
});

void test("sends the full deployment identity and auth for a preview deployment", async () => {
  const ctx = await prepareContext();
  try {
    let deployInit: RequestInit | undefined;
    const fakeFetch = async (
      input: string | URL | Request,
      init: RequestInit = {},
    ): Promise<Response> => {
      const url = String(input);
      if (url.split("?")[0].endsWith("/v13/deployments")) {
        deployInit = init;
        return Response.json({ id: "dep_123", url: "preview.example.vercel.app" });
      }
      if (url.includes("/v13/deployments/dep_123"))
        return Response.json({
          id: "dep_123",
          readyState: "READY",
          url: "preview.example.vercel.app",
          aliases: ["preview.example.com"],
          projectId: "prj_123",
          meta: { githubCommitSha: commit },
          createdAt: 1_721_436_000_000,
          ready: 1_721_436_001_000,
        });
      throw new Error(`Unexpected Vercel request ${url}`);
    };
    await withEnv(
      { VERCEL_TOKEN: "test-token", VERCEL_TARGET: "preview", VERCEL_TEAM_ID: undefined },
      async () => {
        await new VercelDeployStage(
          fakeFetch,
          async () => {},
          () => new Date("2026-07-20T00:00:02.000Z"),
          0,
          2,
        ).run(ctx);
      },
    );

    const headers = (deployInit?.headers ?? {}) as Record<string, string>;
    assert.equal(headers.Authorization, "Bearer test-token");
    assert.equal(headers["Content-Type"], "application/json");

    const body = JSON.parse(String(deployInit?.body)) as {
      name?: string;
      project?: string;
      target?: unknown;
      gitSource?: { type?: string; repoId?: string; ref?: string; sha?: string };
      meta?: { websiteBotBuildId?: string; githubCommitSha?: string };
    };
    assert.equal(body.name, "prj_123");
    assert.equal(body.project, "prj_123");
    assert.equal(body.gitSource?.type, "github");
    assert.equal(body.gitSource?.repoId, "123");
    assert.equal(body.gitSource?.ref, "main");
    assert.equal(body.gitSource?.sha, commit);
    assert.equal(body.meta?.websiteBotBuildId, ctx.buildId);
    assert.equal(body.meta?.githubCommitSha, commit);
    // A preview deployment must not request the production target.
    assert.equal(body.target, undefined);
  } finally {
    cleanupContext(ctx);
  }
});

void test("requests the production target only under explicit production authorization", async () => {
  const ctx = await prepareContext();
  try {
    let deployInit: RequestInit | undefined;
    const fakeFetch = async (
      input: string | URL | Request,
      init: RequestInit = {},
    ): Promise<Response> => {
      const url = String(input);
      if (url.split("?")[0].endsWith("/v13/deployments")) {
        deployInit = init;
        return Response.json({ id: "dep_prod", url: "prod.example.vercel.app" });
      }
      if (url.includes("/v13/deployments/dep_prod"))
        return Response.json({
          id: "dep_prod",
          readyState: "READY",
          url: "prod.example.vercel.app",
          aliases: ["acme.example.com"],
          projectId: "prj_123",
          meta: { githubCommitSha: commit },
          createdAt: 1_721_436_000_000,
          ready: 1_721_436_001_000,
        });
      throw new Error(`Unexpected Vercel request ${url}`);
    };
    await withEnv(
      {
        VERCEL_TOKEN: "test-token",
        VERCEL_TARGET: "production",
        WEBSITE_BOT_ALLOW_PRODUCTION: "true",
        VERCEL_TEAM_ID: undefined,
      },
      async () => {
        await new VercelDeployStage(
          fakeFetch,
          async () => {},
          () => new Date("2026-07-20T00:00:02.000Z"),
          0,
          2,
        ).run(ctx);
      },
    );
    const body = JSON.parse(String(deployInit?.body)) as { target?: unknown };
    assert.equal(body.target, "production");
  } finally {
    cleanupContext(ctx);
  }
});

void test("fails closed and writes no deployment evidence when Vercel reports another commit", async () => {
  const ctx = await prepareContext();
  try {
    const fakeFetch = async (input: string | URL | Request): Promise<Response> =>
      String(input).split("?")[0].endsWith("/v13/deployments")
        ? Response.json({ id: "dep_bad", url: "bad.vercel.app" })
        : Response.json({
            id: "dep_bad",
            readyState: "READY",
            url: "bad.vercel.app",
            projectId: "prj_123",
            meta: { githubCommitSha: "f".repeat(40) },
          });
    await withEnv(
      { VERCEL_TOKEN: "test-token", VERCEL_TARGET: "preview", VERCEL_TEAM_ID: undefined },
      async () => {
        await assert.rejects(
          () =>
            new VercelDeployStage(
              fakeFetch,
              async () => {},
              () => new Date(),
              0,
              1,
            ).run(ctx),
          /different commit/,
        );
      },
    );
    assert.equal(await ctx.evidenceStore.readDeployment(), undefined);
  } finally {
    cleanupContext(ctx);
  }
});
