/**
 * Rootie — Growth Reports Route
 *
 * GET /reports/growth/:userId/:childId
 *   Returns a growth report for a specific child.
 *   Aggregates moment counts by category and generates a narrative via OpenAI.
 *   Paid plan only.
 *
 * POST /reports/growth/:userId/:childId/send
 *   Generates the report and sends it to the parent via WhatsApp.
 *   Admin-only endpoint.
 */

const express    = require('express');
const router     = express.Router();
const OpenAI     = require('openai');
const { logger } = require('../utils/logger');
const { query }  = require('../db/database');
const { aggregateMoments,
        getMomentsForChild }  = require('../services/momentService');
const { getChildById,
        buildChildProfile }   = require('../services/childService');
const { sendMessage }         = require('../services/whatsappService');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ─── Auth middleware for admin endpoints ──────────────────────────────────
function adminAuth(req, res, next) {
  const key = req.headers['x-admin-key'];
  if (key !== process.env.ADMIN_API_KEY) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  next();
}

// ─── GET /reports/growth/:userId/:childId ─────────────────────────────────
router.get('/growth/:userId/:childId', adminAuth, async (req, res) => {
  try {
    const { userId, childId } = req.params;

    const child  = await getChildById(parseInt(childId, 10));
    if (!child) return res.status(404).json({ error: 'Child not found' });

    const aggregated = await aggregateMoments(parseInt(childId, 10));
    const recent     = await getMomentsForChild(parseInt(childId, 10), { limit: 20 });

    // Build report data
    const categoryCounts = {};
    aggregated.forEach(row => { categoryCounts[row.category] = parseInt(row.count, 10); });

    const totalMoments = Object.values(categoryCounts).reduce((a, b) => a + b, 0);
    const topCategory  = aggregated[0]?.category || 'kindness';

    // Generate narrative via OpenAI
    let narrative = null;
    if (totalMoments > 0) {
      const prompt = `You are Rootie, a warm parenting companion. Write a brief, warm monthly growth report for a child.

Child: ${buildChildProfile(child)}
Total moments logged: ${totalMoments}
Moments by category: ${JSON.stringify(categoryCounts)}
Recent moments (last 20): ${recent.map(m => m.summary || m.raw_parent_message).join('; ')}

Write a 3–4 sentence narrative that:
- Celebrates the child's growth
- Highlights their strongest quality (${topCategory})
- Encourages the parent
- Is warm, specific, and not generic

Keep it under 150 words.`;

      const response = await openai.chat.completions.create({
        model:       process.env.OPENAI_MODEL || 'gpt-4o-mini',
        temperature: 0.7,
        max_tokens:  200,
        messages:    [{ role: 'user', content: prompt }],
      });
      narrative = response.choices[0].message.content.trim();
    }

    res.json({
      child: {
        child_id:   child.child_id,
        child_name: child.child_name,
        child_age:  child.child_age,
      },
      total_moments:   totalMoments,
      category_counts: categoryCounts,
      top_quality:     topCategory,
      narrative,
      generated_at:    new Date().toISOString(),
    });

  } catch (err) {
    logger.error('Growth report error', { error: err.message });
    res.status(500).json({ error: 'Failed to generate report' });
  }
});

// ─── POST /reports/growth/:userId/:childId/send ───────────────────────────
// Generate and send the growth report to the parent via WhatsApp
router.post('/growth/:userId/:childId/send', adminAuth, async (req, res) => {
  try {
    const { userId, childId } = req.params;

    // Get user's WhatsApp number
    const userResult = await query(
      'SELECT * FROM users WHERE user_id = $1 LIMIT 1',
      [parseInt(userId, 10)]
    );
    const user = userResult.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const child = await getChildById(parseInt(childId, 10));
    if (!child) return res.status(404).json({ error: 'Child not found' });

    const aggregated     = await aggregateMoments(parseInt(childId, 10));
    const totalMoments   = aggregated.reduce((a, r) => a + parseInt(r.count, 10), 0);
    const topCategory    = aggregated[0]?.category || 'kindness';

    // Build WhatsApp message
    const categoryLines = aggregated
      .map(r => `  • ${r.category.replace('_', ' ')}: ${r.count} moments`)
      .join('\n');

    const message =
      `*${child.child_name}'s Kind Roots Growth Report* 🌱\n\n` +
      `*Total moments logged:* ${totalMoments}\n\n` +
      `*Moments by quality:*\n${categoryLines || '  No moments yet'}\n\n` +
      `*Strongest quality:* ${topCategory.replace('_', ' ')} ⭐\n\n` +
      `Keep noticing these beautiful moments — they're building something wonderful. 💛`;

    await sendMessage(user.whatsapp_number, message);
    logger.info('Growth report sent', { userId, childId });

    res.json({ success: true, message: 'Growth report sent via WhatsApp' });

  } catch (err) {
    logger.error('Send growth report error', { error: err.message });
    res.status(500).json({ error: 'Failed to send report' });
  }
});

module.exports = router;
