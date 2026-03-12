/**
 * Rootie — Database
 *
 * 5 tables, all created automatically on first startup.
 *
 * Tables:
 *   users          — one row per parent (WhatsApp number = primary identity)
 *   children       — one or more children per parent (Child Personality Blueprint)
 *   moments        — positive behaviors logged by parents
 *   conversations  — recent message history (last N messages only)
 *   family_summary — compact long-term memory (replaces full history in AI prompts)
 *   usage_tracking — daily free-plan usage counters
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
  ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone      VARCHAR(50)  DEFAULT 'UTC';
  ALTER TABLE users ADD COLUMN IF NOT EXISTS reminder_hour SMALLINT     DEFAULT 8;

  -- ── Children ────────────────────────────────────────────────────────────────
  -- Multiple children per parent. These fields form the Child Personality Blueprint
  -- used to personalise AI responses.
  CREATE TABLE IF NOT EXISTS children (
    child_id          SERIAL PRIMARY KEY,
    user_id           INTEGER      NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
    child_name        VARCHAR(100) NOT NULL,
    child_age         SMALLINT,
    temperament       VARCHAR(100),   -- e.g. "slow-to-warm", "easy-going", "spirited"
    sensitivity_level VARCHAR(50),    -- e.g. "high", "medium", "low"
    social_style      VARCHAR(100),   -- e.g. "introverted", "extroverted"
    strengths         TEXT,           -- free text: "empathy, curiosity"
    challenges        TEXT,           -- free text: "transitions, loud environments"
    created_at        TIMESTAMPTZ  DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_children_user_id ON children (user_id);

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
