# Rootie by Kind Roots 🌱

WhatsApp parenting companion backend — Node.js + Express + PostgreSQL + WhatsApp Cloud API + OpenAI.

---

## What Rootie Does

Rootie is a WhatsApp bot that helps parents raise kind, confident, and emotionally intelligent children through:

- **Moment logging** — parents share positive behaviors they notice in their child; Rootie logs them
- **Parenting guidance** — parents ask questions; Rootie gives warm, practical advice
- **Daily prompts** — every morning, Rootie sends a small "noticing challenge"
- **Weekly bonding activities** — every Monday, a 5-minute activity for parent and child
- **Growth reports** — monthly summary of a child's logged moments (paid plan)

---

## Architecture

```
WhatsApp message
      ↓
POST /webhook
      ↓
Meta signature verified
      ↓
Deduplication check
      ↓
Read receipt sent
      ↓
User looked up / created
      ↓
  ┌─────────────────────────────────────────┐
  │  Onboarding incomplete?                 │
  │  YES → onboardingService (steps 0–4)    │
  │  NO  → continue                         │
  └─────────────────────────────────────────┘
      ↓
Safety check (crisis keywords)
      ↓
Step 1: Classify message (gpt-4o-mini, cheap)
      ↓
  ┌─────────────────────────────────────────────────────────────┐
  │  moment_log           → log moment → template reply         │
  │  child_selection_needed → ask which child                   │
  │  parenting_question   → check free plan limit → Step 2 AI  │
  │  general / other      → template or Step 2 AI              │
  └─────────────────────────────────────────────────────────────┘
      ↓
Save to DB, update usage
```

---

## Database (5 tables)

| Table | Purpose |
|---|---|
| `users` | One row per parent |
| `children` | One or more children per parent (Child Personality Blueprint) |
| `moments` | Positive behaviors logged by parents |
| `conversations` | Recent message history (last 30 messages) |
| `family_summary` | Compact long-term memory for AI prompts |
| `usage_tracking` | Daily free-plan usage counters |

Tables are created automatically on first startup. No manual setup needed.

---

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Set up environment
cp .env.example .env
# Fill in your values in .env

# 3. Start the server
npm run dev

# 4. Expose locally for testing (in a second terminal)
ngrok http 3000
```

---

## Environment Variables

See `.env.example` for the full list with explanations. Required variables:

| Variable | Description |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (from Supabase) |
| `WHATSAPP_PHONE_NUMBER_ID` | From Meta → WhatsApp → API Setup |
| `WHATSAPP_ACCESS_TOKEN` | Permanent System User token from Meta |
| `WHATSAPP_APP_SECRET` | From Meta App → Settings → Basic |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Password you invent for webhook verification |
| `OPENAI_API_KEY` | From platform.openai.com |
| `ADMIN_API_KEY` | Password you invent for the admin panel |

---

## API Endpoints

### Webhook
| Method | Path | Description |
|---|---|---|
| GET | `/webhook` | Meta verification handshake |
| POST | `/webhook` | Inbound WhatsApp messages |

### Admin (requires `x-admin-key` header)
| Method | Path | Description |
|---|---|---|
| GET | `/admin/stats` | Dashboard summary |
| GET | `/admin/users` | List all users |
| GET | `/admin/users/:phone` | Single user detail |
| GET | `/admin/users/:phone/children` | User's children |
| GET | `/admin/users/:phone/moments` | User's logged moments |
| GET | `/admin/users/:phone/history` | Conversation history |
| POST | `/admin/users/:phone/plan` | Update plan (free/paid) |
| POST | `/admin/trigger/daily` | Manually send daily prompt |
| POST | `/admin/trigger/weekly` | Manually send weekly activity |

### Reports (requires `x-admin-key` header)
| Method | Path | Description |
|---|---|---|
| GET | `/reports/growth/:userId/:childId` | Generate growth report |
| POST | `/reports/growth/:userId/:childId/send` | Send report via WhatsApp |

---

## Plans

| Feature | Free | Paid |
|---|---|---|
| Moment logging | Unlimited | Unlimited |
| Daily prompts | ✅ | ✅ |
| Weekly activities | ✅ | ✅ |
| Parenting questions | 1/day | Unlimited |
| Growth reports | ❌ | ✅ |
| Child Personality Blueprint | ❌ | ✅ |

To upgrade a user to paid: `POST /admin/users/:phone/plan` with `{ "plan_type": "paid" }`.

---

## Testing

```bash
# Start the server first
npm run dev

# In a second terminal
npm test
```

---

## Deployment

See `DEPLOYMENT.md` for step-by-step instructions for Render.
