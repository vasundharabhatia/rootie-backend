# Rootie — Deployment Guide

Deploy to Render in ~15 minutes.

---

## Step 1 — Upload Code to GitHub

1. Create a free account at [github.com](https://github.com)
2. Download [GitHub Desktop](https://desktop.github.com) and sign in
3. Click **File → New Repository** → name it `rootie-backend` → Private → Create
4. Click **Show in Finder / Explorer** to open the folder
5. Copy all files from the `rootie` folder into it
6. Back in GitHub Desktop: write commit message `Initial commit` → **Commit to main** → **Push origin**

---

## Step 2 — Create a Render Account

1. Go to [render.com](https://render.com) → **Get Started for Free**
2. Sign up with your GitHub account

---

## Step 3 — Create a Web Service

1. In Render dashboard, click **New +** → **Web Service**
2. Click **Connect a repository** → select `rootie-backend`
3. Configure:
   - **Name:** `rootie-backend`
   - **Region:** pick closest to your users
   - **Branch:** `main`
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `npm start`
   - **Instance Type:** Free (to start)
4. Click **Create Web Service**

---

## Step 4 — Add Environment Variables

In your Render service, go to **Environment** tab and add:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | Your Supabase connection string |
| `WHATSAPP_PHONE_NUMBER_ID` | From Meta |
| `WHATSAPP_ACCESS_TOKEN` | Permanent System User token |
| `WHATSAPP_APP_SECRET` | From Meta App Settings |
| `WHATSAPP_WEBHOOK_VERIFY_TOKEN` | Your chosen password |
| `OPENAI_API_KEY` | From OpenAI |
| `OPENAI_MODEL` | `gpt-4o-mini` |
| `ADMIN_API_KEY` | Your chosen admin password |
| `FREE_QUESTION_LIMIT` | `1` |

Click **Save Changes** — Render will redeploy automatically.

---

## Step 5 — Get Your URL

After deployment, Render gives you a URL like:
```
https://rootie-backend.onrender.com
```

Test it: open `https://rootie-backend.onrender.com/health` in your browser.
You should see: `{"status":"ok","service":"Rootie by Kind Roots",...}`

---

## Step 6 — Register the Webhook with Meta

1. Go to [developers.facebook.com](https://developers.facebook.com) → your app
2. Left sidebar → **WhatsApp** → **Configuration**
3. Under **Webhook**, click **Edit**
4. Fill in:
   - **Callback URL:** `https://rootie-backend.onrender.com/webhook`
   - **Verify Token:** your `WHATSAPP_WEBHOOK_VERIFY_TOKEN` value
5. Click **Verify and Save** — you should see a green ✅
6. Under **Webhook Fields**, click **Manage** → toggle **messages** ON → **Done**

---

## Step 7 — Test It

Send a WhatsApp message to your business number.
You should receive the Rootie welcome message within a few seconds.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Render build fails | Check Build Command is `npm install` |
| Webhook verification fails | Make sure server is running; check WHATSAPP_WEBHOOK_VERIFY_TOKEN matches |
| Bot doesn't reply | Check WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN in Render env |
| Database error | Re-copy DATABASE_URL from Supabase; make sure password is filled in |
| Free plan on Render sleeps | Upgrade to Starter ($7/mo) or use Railway — free tier spins down after 15 min of inactivity |

---

## Keeping the Server Awake (Free Tier)

Render's free tier spins down after 15 minutes of inactivity. To prevent this:
- Use [UptimeRobot](https://uptimerobot.com) (free) to ping `https://rootie-backend.onrender.com/health` every 5 minutes
- Or upgrade to Render Starter ($7/month) for always-on service
