// L9_META: layer=pipeline, role=state_store, status=active, version=2.0.0
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { sqliteTable, text, integer, real } from 'drizzle-orm/sqlite-core';

// ── Schema ──────────────────────────────────────────────────────────────────
export const builds = sqliteTable('builds', {
  id:          text('id').primaryKey(),
  clientId:    text('client_id').notNull(),
  status:      text('status', { enum: ['running', 'success', 'failed', 'partial'] }).notNull().default('running'),
  startedAt:   text('started_at').notNull(),
  completedAt: text('completed_at'),
  deployUrl:   text('deploy_url'),
  dryRun:      integer('dry_run', { mode: 'boolean' }).notNull().default(false),
  errorCode:   text('error_code'),
  errorMsg:    text('error_msg'),
});

export const stageRuns = sqliteTable('stage_runs', {
  id:          integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  buildId:     text('build_id').notNull().references(() => builds.id),
  stageName:   text('stage_name').notNull(),
  status:      text('status', { enum: ['ok', 'skipped', 'failed'] }).notNull(),
  durationMs:  integer('duration_ms'),
  errorMsg:    text('error_msg'),
  ranAt:       text('ran_at').notNull(),
});

export const llmUsage = sqliteTable('llm_usage', {
  id:           integer('id', { mode: 'number' }).primaryKey({ autoIncrement: true }),
  buildId:      text('build_id').notNull().references(() => builds.id),
  stage:        text('stage').notNull(),
  taskType:     text('task_type').notNull(),
  model:        text('model').notNull(),
  inputTokens:  integer('input_tokens').notNull(),
  outputTokens: integer('output_tokens').notNull(),
  costUsd:      real('cost_usd').notNull(),
  recordedAt:   text('recorded_at').notNull(),
});

export const buildSchema = { builds, stageRuns, llmUsage };

// ── Factory ─────────────────────────────────────────────────────────────────
export function getBuildDb(path?: string) {
  const dbPath = path ?? process.env.BUILD_DB_PATH ?? './website-bot.db';
  const sqlite = new Database(dbPath);
  sqlite.pragma('journal_mode = WAL');

  const db = drizzle(sqlite, { schema: buildSchema });

  // Idempotent schema creation
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS builds (
      id TEXT PRIMARY KEY,
      client_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      started_at TEXT NOT NULL,
      completed_at TEXT,
      deploy_url TEXT,
      dry_run INTEGER NOT NULL DEFAULT 0,
      error_code TEXT,
      error_msg TEXT
    );
    CREATE TABLE IF NOT EXISTS stage_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      build_id TEXT NOT NULL REFERENCES builds(id),
      stage_name TEXT NOT NULL,
      status TEXT NOT NULL,
      duration_ms INTEGER,
      error_msg TEXT,
      ran_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS llm_usage (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      build_id TEXT NOT NULL REFERENCES builds(id),
      stage TEXT NOT NULL,
      task_type TEXT NOT NULL,
      model TEXT NOT NULL,
      input_tokens INTEGER NOT NULL,
      output_tokens INTEGER NOT NULL,
      cost_usd REAL NOT NULL,
      recorded_at TEXT NOT NULL
    );
  `);

  return { db, sqlite };
}
