/**
 * Rootie by Kind Roots — Main Server Entry Point
 *
 * Starts the Express server, registers all routes, initialises the database,
 * and launches the daily + weekly schedulers.
 */

require('dotenv').config();

const express    = require('express');
const rateLimit  = require('express-rate-limit');
const { logger } = require('./utils/logger');

const { initDatabase }        = require('./db/database');
const webhookRoutes           = require('./routes/webhook');
const adminRoutes             = require('./routes/admin');
const reportRoutes            = require('./routes/reports');
const { startDailyScheduler,
        startWeeklyScheduler } = require('./scheduler');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─── Raw body capture (required for Meta signature verification) ───────────
app.use((req, res, next) => {
  let data = '';
  req.on('data', chunk => { data += chunk; });
  req.on('end', () => {
    req.rawBody = data;
    try { req.body = JSON.parse(data); } catch { req.body = {}; }
    next();
  });
});

// ─── Global rate limiter (protects against floods) ────────────────────────
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests. Please try again later.' },
}));

// ─── Routes ────────────────────────────────────────────────────────────────
app.use('/webhook', webhookRoutes);   // WhatsApp Cloud API
app.use('/admin',   adminRoutes);     // Admin panel
app.use('/reports', reportRoutes);    // Growth reports

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Rootie by Kind Roots', ts: new Date().toISOString() });
});

// ─── Start ─────────────────────────────────────────────────────────────────
async function start() {
  try {
    await initDatabase();
    app.listen(PORT, () => {
      logger.info(`Rootie backend running on port ${PORT}`);
      startDailyScheduler();
      startWeeklyScheduler();
    });
  } catch (err) {
    logger.error('Failed to start server', { error: err.message });
    process.exit(1);
  }
}

start();
