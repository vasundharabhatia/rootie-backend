/**
 * Rootie — Admin Routes
 *
 * All endpoints require x-admin-key header.
 *
 * GET  /admin/stats                       — dashboard summary
 * GET  /admin/users                       — list all users
 * GET  /admin/users/:phone                — single user detail
 * GET  /admin/users/:phone/children       — children for a user
 * GET  /admin/users/:phone/moments        — recent moments for a user
 * GET  /admin/users/:phone/history        — conversation history
 * POST /admin/users/:phone/plan           — update plan type (free/paid)
 * POST /admin/trigger/weekly              — manually trigger weekly bonding activity (Sat)
 * POST /admin/trigger/evening-nudge       — manually trigger evening connection nudge (Mon–Fri)
 * POST /admin/trigger/custom-nudge        — send a one-time custom message to a specific user by ID
 * GET  /admin/cron-logs                    — read recent cron diagnostic logs from the DB
 */

const express    = require('express');
const router     = express.Router();
const { logger } = require('../utils/logger');
const { query }  = require('../db/database');
const { getAllUsers,
        getUserByPhone,
        getUserById,
        updateUser }            = require('../services/userService');
const { getChildrenByUserId }   = require('../services/childService');
const { getRecentMomentsByUser }= require('../services/momentService');
const { getFullHistory }        = require('../services/conversationService');
const { getUsageStats }         = require('../services/usageService');
const { sendWeeklyActivities,
        sendEveningNudge }      = require('../scheduler/index');
const { sendMessage }               = require('../services/whatsappService');
const { saveMessage }               = require('../services/conversationService');
const { getCronLogs, isLoggingActive, minutesRemaining } = require('../services/cronLogService');

// ─── Admin auth middleware ─────────────────────────────────────────────────
function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (!key || key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  next();
}
router.use(adminAuth);

// ─── GET /admin/stats ──────────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  try {
    const [totalUsers, onboarded, freeUsers, paidUsers,
           totalMoments, totalMessages, activeToday] = await Promise.all([
      query('SELECT COUNT(*) AS n FROM users'),
      query('SELECT COUNT(*) AS n FROM users WHERE onboarding_complete = true'),
      query("SELECT COUNT(*) AS n FROM users WHERE plan_type = 'free'"),
      query("SELECT COUNT(*) AS n FROM users WHERE plan_type = 'paid'"),
      query('SELECT COUNT(*) AS n FROM moments'),
      query('SELECT COUNT(*) AS n FROM conversations'),
      query(`SELECT COUNT(DISTINCT user_id) AS n FROM usage_tracking
             WHERE date = CURRENT_DATE AND messages_sent > 0`),
    ]);

    res.json({
      total_users:    parseInt(totalUsers.rows[0].n, 10),
      onboarded:      parseInt(onboarded.rows[0].n, 10),
      free_plan:      parseInt(freeUsers.rows[0].n, 10),
      paid_plan:      parseInt(paidUsers.rows[0].n, 10),
      total_moments:  parseInt(totalMoments.rows[0].n, 10),
      total_messages: parseInt(totalMessages.rows[0].n, 10),
      active_today:   parseInt(activeToday.rows[0].n, 10),
      generated_at:   new Date().toISOString(),
    });
  } catch (err) {
    logger.error('Admin stats error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// ─── GET /admin/users ──────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const limit  = parseInt(req.query.limit  || '50',  10);
    const offset = parseInt(req.query.offset || '0',   10);
    const users  = await getAllUsers({ limit, offset });
    res.json({ users, count: users.length });
  } catch (err) {
    logger.error('Admin users list error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ─── GET /admin/users/:phone ───────────────────────────────────────────────
router.get('/users/:phone', async (req, res) => {
  try {
    const user = await getUserByPhone(req.params.phone);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const [children, usage] = await Promise.all([
      getChildrenByUserId(user.user_id),
      getUsageStats(user.user_id, 7),
    ]);
