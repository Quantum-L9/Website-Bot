// L9_META: layer=pipeline, role=state_store, status=active, version=4.0.0
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import type { EvidenceIndex } from './evidence/EvidenceIndex.js';

export const builds = sqliteTable('builds', {
  id: text('id').primaryKey(),
  clientId: text('client_id').notNull(),
  status: text('status', { enum: ['running', 'success', 'failed', 'partial'] }).notNull().default('running'),
  startedAt: text('started_at').notNull(),
  completedAt: text('completed_at'),
  deployUrl: text('deploy_url'),
  dryRun: integer('dry_run', { mode: 'boolean' }).notNull().default(false),
  errorCode: text('error_code'),
  errorMsg: text('error_msg'),
});

export const stageRuns = sqliteTable('stage_runs', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  buildId: text('build_id').notNull().references(() => builds.id),
  stageName: text('stage_name').notNull(),
  status: text('status', { enum: ['running', 'ok', 'skipped', 'failed'] }).notNull(),
  durationMs: integer('duration_ms'),
  errorMsg: text('error_msg'),
  ranAt: text('ran_at').notNull(),
});

export const llmUsage = sqliteTable('llm_usage', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  buildId: text('build_id').notNull().references(() => builds.id),
  stage: text('stage').notNull(),
  taskType: text('task_type').notNull(),
  model: text('model').notNull(),
  inputTokens: integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  costUsd: real('cost_usd').notNull(),
  recordedAt: text('recorded_at').notNull(),
});

export const evidenceArtifacts = sqliteTable('evidence_artifacts', {
  id: integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  buildId: text('build_id').notNull().references(() => builds.id),
  clientId: text('client_id').notNull(),
  kind: text('kind').notNull(),
  schemaId: text('schema_id').notNull(),
  logicalId: text('logical_id').notNull(),
  relativePath: text('relative_path').notNull(),
  sha256: text('sha256').notNull(),
  createdAt: text('created_at').notNull(),
});

export const evidenceChainStatus = sqliteTable('evidence_chain_status', {
  buildId: text('build_id').primaryKey().references(() => builds.id),
  clientId: text('client_id').notNull(),
  mode: text('mode').notNull(),
  status: text('status').notNull(),
  lastSuccessfulStage: text('last_successful_stage'),
  failedStage: text('failed_stage'),
  evidenceIndexPath: text('evidence_index_path').notNull(),
  indexRevision: integer('index_revision').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const buildSchema = { builds, stageRuns, llmUsage, evidenceArtifacts, evidenceChainStatus };

export function getBuildDb(path?: string) {
  const dbPath = path ?? process.env.BUILD_DB_PATH ?? './website-bot.db';
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema: buildSchema });
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS builds (
      id TEXT PRIMARY KEY, client_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'running',
      started_at TEXT NOT NULL, completed_at TEXT, deploy_url TEXT, dry_run INTEGER NOT NULL DEFAULT 0,
      error_code TEXT, error_msg TEXT
    );
    CREATE TABLE IF NOT EXISTS stage_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, build_id TEXT NOT NULL REFERENCES builds(id),
      stage_name TEXT NOT NULL, status TEXT NOT NULL, duration_ms INTEGER, error_msg TEXT, ran_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS llm_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT, build_id TEXT NOT NULL REFERENCES builds(id),
      stage TEXT NOT NULL, task_type TEXT NOT NULL, model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cost_usd REAL NOT NULL, recorded_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS evidence_artifacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT, build_id TEXT NOT NULL REFERENCES builds(id), client_id TEXT NOT NULL,
      kind TEXT NOT NULL, schema_id TEXT NOT NULL, logical_id TEXT NOT NULL, relative_path TEXT NOT NULL,
      sha256 TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(build_id, kind), UNIQUE(logical_id)
    );
    CREATE TABLE IF NOT EXISTS evidence_chain_status (
      build_id TEXT PRIMARY KEY REFERENCES builds(id), client_id TEXT NOT NULL, mode TEXT NOT NULL,
      status TEXT NOT NULL, last_successful_stage TEXT, failed_stage TEXT, evidence_index_path TEXT NOT NULL,
      index_revision INTEGER NOT NULL, updated_at TEXT NOT NULL
    );
  `);
  return { db, sqlite };
}

export function syncEvidenceIndexToDb(sqlite: Database.Database, index: EvidenceIndex, evidenceRoot: string): void {
  const transaction = sqlite.transaction(() => {
    const upsertArtifact = sqlite.prepare(`
      INSERT INTO evidence_artifacts
        (build_id, client_id, kind, schema_id, logical_id, relative_path, sha256, created_at)
      VALUES
        (@build_id, @client_id, @kind, @schema_id, @logical_id, @relative_path, @sha256, @created_at)
      ON CONFLICT(build_id, kind) DO UPDATE SET
        schema_id=excluded.schema_id, logical_id=excluded.logical_id, relative_path=excluded.relative_path,
        sha256=excluded.sha256, created_at=excluded.created_at
    `);
    for (const record of Object.values(index.artifacts)) {
      if (!record) continue;
      upsertArtifact.run({
        build_id: index.build_id,
        client_id: index.client_id,
        kind: record.kind,
        schema_id: record.schema,
        logical_id: record.logicalId,
        relative_path: record.relativePath,
        sha256: record.sha256,
        created_at: record.writtenAt,
      });
    }
    sqlite.prepare(`
      INSERT INTO evidence_chain_status
        (build_id, client_id, mode, status, last_successful_stage, failed_stage, evidence_index_path, index_revision, updated_at)
      VALUES
        (@build_id, @client_id, @mode, @status, @last_successful_stage, @failed_stage, @evidence_index_path, @index_revision, @updated_at)
      ON CONFLICT(build_id) DO UPDATE SET
        status=excluded.status, last_successful_stage=excluded.last_successful_stage,
        failed_stage=excluded.failed_stage, evidence_index_path=excluded.evidence_index_path,
        index_revision=excluded.index_revision, updated_at=excluded.updated_at
    `).run({
      build_id: index.build_id,
      client_id: index.client_id,
      mode: index.mode,
      status: index.chain_status,
      last_successful_stage: index.last_successful_stage ?? null,
      failed_stage: index.failed_stage ?? null,
      evidence_index_path: `${evidenceRoot}/evidence-index.json`,
      index_revision: index.revision,
      updated_at: index.updated_at,
    });
  });
  transaction();
}
