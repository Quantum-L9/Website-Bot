-- schema.sql — Shared runtime accounting tables for Website-Bot
-- Apply via: psql $POSTGRES_URL < src/lib/schema.sql
-- These tables are additive — safe to run on an empty or existing database.

CREATE TABLE IF NOT EXISTS agent_jobs (
    job_id           VARCHAR(255) PRIMARY KEY,
    repo             VARCHAR(100)  NOT NULL,             -- 'website-bot'
    trigger_type     VARCHAR(50)   NOT NULL,             -- 'cron' | 'webhook' | 'dispatch' | 'inngest'
    trigger_payload  JSONB,
    status           VARCHAR(20)   NOT NULL DEFAULT 'queued',  -- queued | running | success | failed | suspended
    assigned_worker  VARCHAR(100),
    attempt_count    INT           NOT NULL DEFAULT 0,
    max_attempts     INT           NOT NULL DEFAULT 3,
    cost_usd         NUMERIC(10,6) NOT NULL DEFAULT 0,
    cost_cap_usd     NUMERIC(10,6) NOT NULL DEFAULT 1.00,
    created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
    started_at       TIMESTAMPTZ,
    completed_at     TIMESTAMPTZ,
    error_message    TEXT,
    result_artifact  JSONB,
    idempotency_key  VARCHAR(255)  UNIQUE
);

CREATE INDEX IF NOT EXISTS idx_agent_jobs_status_created
    ON agent_jobs (status, created_at)
    WHERE status IN ('queued', 'running');

-- ─── Budget violations ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS budget_violations (
    id           BIGSERIAL    PRIMARY KEY,
    job_id       VARCHAR(255) NOT NULL REFERENCES agent_jobs(job_id),
    repo         VARCHAR(100) NOT NULL,
    cost_usd     NUMERIC(10,6) NOT NULL,
    cost_cap_usd NUMERIC(10,6) NOT NULL,
    overage_usd  NUMERIC(10,6) NOT NULL,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION log_budget_violation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.cost_usd IS NOT NULL
       AND NEW.cost_cap_usd IS NOT NULL
       AND NEW.cost_usd > NEW.cost_cap_usd
       AND (OLD.cost_usd IS NULL OR OLD.cost_usd <= OLD.cost_cap_usd)
    THEN
        INSERT INTO budget_violations (job_id, repo, cost_usd, cost_cap_usd, overage_usd)
        VALUES (NEW.job_id, NEW.repo, NEW.cost_usd, NEW.cost_cap_usd, NEW.cost_usd - NEW.cost_cap_usd);
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_budget_violation ON agent_jobs;
CREATE TRIGGER trg_budget_violation
    AFTER INSERT OR UPDATE OF cost_usd, cost_cap_usd ON agent_jobs
    FOR EACH ROW EXECUTE FUNCTION log_budget_violation();

-- ─── Compensation log ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS compensation_log (
    id              BIGSERIAL    PRIMARY KEY,
    job_id          VARCHAR(255) NOT NULL,
    step_id         VARCHAR(255) NOT NULL,
    action_type     VARCHAR(100) NOT NULL,   -- e.g. 'vercel-rollback', 'git-revert'
    status          VARCHAR(20)  NOT NULL,   -- 'success' | 'failed'
    error_message   TEXT,
    compensated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);
