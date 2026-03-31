/**
 * Rootie — Database
 *
 * Tables created automatically on first startup:
 *
 * Tables:
 *   users              — one row per parent (WhatsApp number = primary identity)
 *   children           — one or more children per parent (Child Personality Blueprint)
 *   moments            — positive behaviors logged by parents
 *   conversations      — recent message history (last N messages only)
 *   family_summary     — compact long-term memory (replaces full history in AI prompts)
 *   usage_tracking     — daily free-plan usage counters
 *   weekend_activities — record of every weekend activity sent and its completion status
 *   cron_logs          — diagnostic log of every cron job fire (auto-expires after 4 hours)
 */

const { Pool } = require('pg');
const { logger } = require('../utils/logger');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', err => logger.error('DB pool error', { error: err.message }));

const SCHEMA = `
  -- ── Users (Parents) ────────────────────────────────────────────────────────
  CREATE TABLE IF NOT EXISTS users (
    user_id            SERIAL PRIMARY KEY,
    whatsapp_number    VARCHAR(20)  UNIQUE NOT NULL,
    parent_name        VARCHAR(100),
    plan_type          VARCHAR(10)  DEFAULT 'free'  CHECK (plan_type IN ('free','paid')),
    onboarding_complete BOOLEAN     DEFAULT false,
    onboarding_step    SMALLINT     DEFAULT 0,
    last_active_date   DATE,                          -- updated on every inbound message
    timezone           VARCHAR(50)  DEFAULT 'UTC',    -- IANA timezone, e.g. 'Asia/Kolkata'
    reminder_hour      SMALLINT     DEFAULT 8         -- preferred local hour to receive messages (0–23)
                         CHECK (reminder_hour >= 0 AND reminder_hour <= 23),
    created_at         TIMESTAMPTZ  DEFAULT NOW(),
    updated_at         TIMESTAMPTZ  DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_users_whatsapp ON users (whatsapp_number);

  -- ── Migrate existing tables: add new columns if they don't exist ────────────
  -- Safe to run on every startup — ALTER TABLE IF NOT EXISTS column is idempotent.
  ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone         VARCHAR(50)  DEFAULT 'UTC';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS reminder_hour    SMALLINT     DEFAULT 8;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS last_active_date DATE;

  ALTER TABLE users ADD COLUMN IF NOT EXISTS rootie_plus_interested  BOOLEAN DEFAULT false;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS rootie_plus_interest_at TIMESTAMPTZ;

  -- ── Children ────────────────────────────────────────────────────────────────
  -- Multiple children per parent. These fields form the Child Personality Blueprint
  -- used to personalise AI responses.
    CREATE TABLE IF NOT EXISTS children (
    child_id           SERIAL PRIMARY KEY,
    user_id            INTEGER      NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    child_name         VARCHAR(100) NOT NULL,
    child_age          SMALLINT,
    temperament        VARCHAR(100),   -- e.g. "slow-to-warm", "easy-going", "spirited"
    sensitivity_level  VARCHAR(50),    -- e.g. "high", "medium", "low"
    social_style       VARCHAR(100),   -- e.g. "introverted", "extroverted"
    strengths          TEXT,           -- free text: "empathy, curiosity"
    challenges         TEXT,           -- free text: "transitions, loud environments"
    is_archived        BOOLEAN      DEFAULT false,
    archived_at        TIMESTAMPTZ,
    created_at         TIMESTAMPTZ  DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_children_user_id ON children (user_id);
  ALTER TABLE children ADD COLUMN IF NOT EXISTS is_archived   BOOLEAN  DEFAULT false;
  ALTER TABLE children ADD COLUMN IF NOT EXISTS archived_at   TIMESTAMPTZ;
  -- Birthday fields (added in v2): child_dob stores full date when known,
  -- birth_year stores year-only when parent only shared the year.
  -- child_age is kept for backward compatibility but is now derived on read.
  ALTER TABLE children ADD COLUMN IF NOT EXISTS child_dob     DATE;
  ALTER TABLE children ADD COLUMN IF NOT EXISTS birth_year    SMALLINT;

  -- ── Moments ─────────────────────────────────────────────────────────────────
  -- Positive behaviors noticed by parents. Logged automatically when the
  -- classifier detects a moment_log message type.
  CREATE TABLE IF NOT EXISTS moments (
    moment_id          SERIAL PRIMARY KEY,
    user_id            INTEGER      NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    child_id           INTEGER      REFERENCES children(child_id) ON DELETE SET NULL,
    category           VARCHAR(50)  NOT NULL
                         CHECK (category IN (
                           'kindness','empathy','resilience','confidence',
                           'emotional_expression','curiosity','responsibility'
                         )),
    summary            TEXT,
    raw_parent_message TEXT         NOT NULL,
    confidence_score   NUMERIC(4,2),
    created_at         TIMESTAMPTZ  DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_moments_user_id   ON moments (user_id);
  CREATE INDEX IF NOT EXISTS idx_moments_child_id  ON moments (child_id);
  CREATE INDEX IF NOT EXISTS idx_moments_created   ON moments (created_at DESC);

  -- ── Conversations ───────────────────────────────────────────────────────────
  -- Minimal recent message history. Old messages pruned automatically.
  CREATE TABLE IF NOT EXISTS conversations (
    message_id     SERIAL PRIMARY KEY,
    user_id        INTEGER     NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    role           VARCHAR(10) NOT NULL CHECK (role IN ('user','assistant')),
    message_text   TEXT        NOT NULL,
    wa_message_id  VARCHAR(100),
    created_at     TIMESTAMPTZ DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_conv_user_id  ON conversations (user_id);
  CREATE INDEX IF NOT EXISTS idx_conv_created  ON conversations (user_id, created_at DESC);

  -- ── Family Summary ──────────────────────────────────────────────────────────
  -- One row per user. Compact long-term memory string passed to OpenAI
  -- instead of full conversation history. Updated periodically.
  CREATE TABLE IF NOT EXISTS family_summary (
    summary_id   SERIAL PRIMARY KEY,
    user_id      INTEGER  UNIQUE NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    summary_text TEXT,
    updated_at   TIMESTAMPTZ DEFAULT NOW()
  );

  -- ── Usage Tracking ──────────────────────────────────────────────────────────
  -- One row per user per day. Tracks free-plan limits.
  CREATE TABLE IF NOT EXISTS usage_tracking (
    usage_id        SERIAL PRIMARY KEY,
    user_id         INTEGER  NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    date            DATE     NOT NULL DEFAULT CURRENT_DATE,
    questions_used  SMALLINT DEFAULT 0,
    moments_logged  SMALLINT DEFAULT 0,
    messages_sent   SMALLINT DEFAULT 0,
    hit_limit_count SMALLINT DEFAULT 0,  -- times free user hit the daily question limit
    UNIQUE (user_id, date)
  );
  CREATE INDEX IF NOT EXISTS idx_usage_user_date ON usage_tracking (user_id, date);

  -- ── Weekend Activities ───────────────────────────────────────────────────────
  -- One row per activity sent to a user. Tracks whether the parent completed it
  -- and when the Monday follow-up was sent. Used for the Connection Award system.
  CREATE TABLE IF NOT EXISTS weekend_activities (
    activity_id          SERIAL PRIMARY KEY,
    user_id              INTEGER      NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    activity_text        TEXT         NOT NULL,          -- the activity that was sent
    sent_at              TIMESTAMPTZ  DEFAULT NOW(),     -- when the activity was sent
    followup_sent_at     TIMESTAMPTZ,                    -- when the Monday follow-up was sent
    completed            BOOLEAN      DEFAULT false,     -- did the parent confirm completion?
    completed_at         TIMESTAMPTZ,                    -- when they confirmed
    award_sent           BOOLEAN      DEFAULT false      -- has the milestone award been sent for this activity?
  );
  CREATE INDEX IF NOT EXISTS idx_wa_user_id   ON weekend_activities (user_id);
  CREATE INDEX IF NOT EXISTS idx_wa_sent_at   ON weekend_activities (sent_at DESC);
  CREATE INDEX IF NOT EXISTS idx_wa_completed ON weekend_activities (user_id, completed);

  -- ── Migrate: add activity tracking columns to users for quick award lookups ──
  ALTER TABLE users ADD COLUMN IF NOT EXISTS activities_completed  SMALLINT DEFAULT 0;
  ALTER TABLE users ADD COLUMN IF NOT EXISTS last_award_milestone  SMALLINT DEFAULT 0;

   -- ── Pending Parent Actions ────────────────────────────────────────────────
  -- Stores short-lived conversational state that must survive restarts.
  -- Example: Rootie asked "Which child was this about?" and is waiting for
  -- the parent to reply with a child name/number.
  CREATE TABLE IF NOT EXISTS pending_parent_actions (
    action_id     SERIAL PRIMARY KEY,
    user_id       INTEGER      UNIQUE NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    action_type   VARCHAR(50)  NOT NULL,
    payload       JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ  DEFAULT NOW(),
    expires_at    TIMESTAMPTZ  NOT NULL DEFAULT (NOW() + interval '30 minutes')
  );
  CREATE INDEX IF NOT EXISTS idx_pending_parent_actions_user_id
    ON pending_parent_actions (user_id);
  CREATE INDEX IF NOT EXISTS idx_pending_parent_actions_expires_at
    ON pending_parent_actions (expires_at);
      -- ── User Flow Sessions ────────────────────────────────────────────────────
  -- DB-backed conversational sessions so profile / family edit flows survive
  -- restarts, deploys, and temporary crashes.
  CREATE TABLE IF NOT EXISTS user_flow_sessions (
    session_id    SERIAL PRIMARY KEY,
    user_id       INTEGER      UNIQUE NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    flow_type     VARCHAR(50)  NOT NULL,
    step          VARCHAR(50)  NOT NULL,
    data          JSONB        NOT NULL DEFAULT '{}'::jsonb,
    created_at    TIMESTAMPTZ  DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  DEFAULT NOW(),
    expires_at    TIMESTAMPTZ  NOT NULL DEFAULT (NOW() + interval '24 hours')
  );
  CREATE INDEX IF NOT EXISTS idx_user_flow_sessions_user_id
    ON user_flow_sessions (user_id);
  CREATE INDEX IF NOT EXISTS idx_user_flow_sessions_expires_at
    ON user_flow_sessions (expires_at);
  -- ── Cron Diagnostic Logs ──────────────────────────────────────────────────────────────────────────────
  -- One row per cron job fire. Stores per-user timezone diagnostics.
  -- Logging is active only while cron_log_enabled = true in the app.
  CREATE TABLE IF NOT EXISTS cron_logs (
    log_id       SERIAL PRIMARY KEY,
    fired_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    job_name     VARCHAR(60)  NOT NULL,
    utc_time     VARCHAR(30)  NOT NULL,
    total_users  SMALLINT     NOT NULL DEFAULT 0,
    matched      SMALLINT     NOT NULL DEFAULT 0,
    sent         SMALLINT,
    failed       SMALLINT,
    user_details JSONB,
    notes        TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_cron_logs_fired_at ON cron_logs (fired_at DESC);
`;


async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(SCHEMA);
    logger.info('DB schema verified — all tables ready');
  } finally {
    client.release();
  }
}

async function query(text, params) {
  try {
    return await pool.query(text, params);
  } catch (err) {
    logger.error('DB query error', { q: text.substring(0, 100), error: err.message });
    throw err;
  }
}

module.exports = { pool, query, initDatabase };
