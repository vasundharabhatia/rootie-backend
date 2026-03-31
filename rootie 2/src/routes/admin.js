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
 * POST /admin/trigger/daily               — manually trigger daily prompt (Mon)
 * POST /admin/trigger/open-question       — manually trigger weekly open question (Tue)
 * POST /admin/trigger/nudge               — manually trigger moment nudge (Wed)
 * POST /admin/trigger/weekly              — manually trigger weekly bonding activity (Sat)
 * POST /admin/trigger/evening-nudge       — manually trigger evening connection nudge (Mon–Fri)
 * POST /admin/trigger/weekend-followup    — manually trigger weekend activity follow-up (Sun)
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
const { sendDailyPrompts,
        sendMomentNudge,
        sendWeeklyActivities,
        sendWeeklyOpenQuestion,
        sendEveningNudge,
        sendWeekendActivityFollowups } = require('../scheduler/index');
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

    res.json({ user, children, usage_last_7_days: usage });
  } catch (err) {
    logger.error('Admin user detail error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch user' });
  }
});

// ─── GET /admin/users/:phone/children ─────────────────────────────────────
router.get('/users/:phone/children', async (req, res) => {
  try {
    const user = await getUserByPhone(req.params.phone);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const children = await getChildrenByUserId(user.user_id);
    res.json({ children });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch children' });
  }
});

// ─── GET /admin/users/:phone/moments ──────────────────────────────────────
router.get('/users/:phone/moments', async (req, res) => {
  try {
    const user = await getUserByPhone(req.params.phone);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const moments = await getRecentMomentsByUser(user.user_id, { limit: 50 });
    res.json({ moments });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch moments' });
  }
});

// ─── GET /admin/users/:phone/history ──────────────────────────────────────
router.get('/users/:phone/history', async (req, res) => {
  try {
    const user = await getUserByPhone(req.params.phone);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const history = await getFullHistory(user.user_id, 30);
    res.json({ history });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch history' });
  }
});

// ─── POST /admin/users/:phone/plan ────────────────────────────────────────
router.post('/users/:phone/plan', async (req, res) => {
  try {
    const { plan_type } = req.body;
    if (!['free', 'paid'].includes(plan_type)) {
      return res.status(400).json({ error: 'plan_type must be "free" or "paid"' });
    }
    const user = await updateUser(req.params.phone, { plan_type });
    if (!user) return res.status(404).json({ error: 'User not found' });
    logger.info('Plan updated', { phone: req.params.phone, plan_type });
    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update plan' });
  }
});

// ─── POST /admin/trigger/daily ────────────────────────────────────────────
router.post('/trigger/daily', async (req, res) => {
  try {
    res.json({ success: true, message: 'Daily prompt job triggered' });
    await sendDailyPrompts(); // run after responding
  } catch (err) {
    logger.error('Manual daily trigger error', { error: err.message });
    res.status(500).json({ error: 'Failed to trigger daily prompts' });
  }
});

// ─── POST /admin/trigger/open-question ────────────────────────────────────
router.post('/trigger/open-question', async (req, res) => {
  try {
    res.json({ success: true, message: 'Weekly open question job triggered' });
    await sendWeeklyOpenQuestion(); // run after responding
  } catch (err) {
    logger.error('Manual open-question trigger error', { error: err.message });
    res.status(500).json({ error: 'Failed to trigger weekly open question' });
  }
});

// ─── POST /admin/trigger/nudge ────────────────────────────────────────────
router.post('/trigger/nudge', async (req, res) => {
  try {
    res.json({ success: true, message: 'Moment nudge job triggered' });
    await sendMomentNudge(); // run after responding
  } catch (err) {
    logger.error('Manual nudge trigger error', { error: err.message });
    res.status(500).json({ error: 'Failed to trigger moment nudge' });
  }
});

// ─── POST /admin/trigger/weekly ───────────────────────────────────────────
router.post('/trigger/weekly', async (req, res) => {
  try {
    res.json({ success: true, message: 'Weekly activity job triggered' });
    await sendWeeklyActivities(); // run after responding
  } catch (err) {
    logger.error('Manual weekly trigger error', { error: err.message });
    res.status(500).json({ error: 'Failed to trigger weekly activities' });
  }
});

// ─── POST /admin/trigger/evening-nudge ────────────────────────────────────
router.post('/trigger/evening-nudge', async (req, res) => {
  try {
    res.json({ success: true, message: 'Evening nudge job triggered' });
    await sendEveningNudge(); // run after responding
  } catch (err) {
    logger.error('Manual evening-nudge trigger error', { error: err.message });
    res.status(500).json({ error: 'Failed to trigger evening nudge' });
  }
});

// ─── POST /admin/trigger/weekend-followup ─────────────────────────────────
router.post('/trigger/weekend-followup', async (req, res) => {
  try {
    res.json({ success: true, message: 'Weekend follow-up job triggered' });
    await sendWeekendActivityFollowups(); // run after responding
  } catch (err) {
    logger.error('Manual weekend-followup trigger error', { error: err.message });
    res.status(500).json({ error: 'Failed to trigger weekend follow-up' });
  }
});

// ─── POST /admin/trigger/custom-nudge ─────────────────────────────────────────────────────────────────────────────────────
// Sends a one-time custom message to a specific user by their user_id.
// Body: { user_id: number, message: string }
router.post('/trigger/custom-nudge', async (req, res) => {
  try {
    const { user_id, message } = req.body;

    if (!user_id || !message) {
      return res.status(400).json({ error: 'user_id and message are required' });
    }

    const user = await getUserById(user_id);
    if (!user) {
      return res.status(404).json({ error: `User ${user_id} not found` });
    }
    if (!user.whatsapp_number) {
      return res.status(400).json({ error: `User ${user_id} has no WhatsApp number` });
    }

    await sendMessage(user.whatsapp_number, message);
    await saveMessage(user_id, 'assistant', message, null);

    logger.info('Custom nudge sent', { userId: user_id, phone: user.whatsapp_number, message });
    res.json({ success: true, sent_to: user.whatsapp_number, message });
  } catch (err) {
    logger.error('Custom nudge error', { error: err.message });
    res.status(500).json({ error: 'Failed to send custom nudge' });
  }
});

// ─── GET /admin/cron-logs ─────────────────────────────────────────────────────────────────────────────────────
// Returns recent cron job fire records from the DB.
// Query params: ?limit=100 (default 100, max 500)
router.get('/cron-logs', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const logs  = await getCronLogs(limit);
    res.json({
      logging_active: isLoggingActive(),
      minutes_remaining: minutesRemaining(),
      count: logs.length,
      logs,
    });
  } catch (err) {
    logger.error('Cron logs fetch error', { error: err.message });
    res.status(500).json({ error: 'Failed to fetch cron logs' });
  }
});

module.exports = router;
