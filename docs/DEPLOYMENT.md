# Deployment guide

This document walks through deploying AiRightHand from a fresh clone.

## 0. Prerequisites

- Node.js 20+
- A Cloudflare account (the **primary** one, where the Worker will live)
- The bot token from [@BotFather](https://t.me/BotFather)
- (Optional) Additional Cloudflare accounts whose tokens go into the AI pool

## 1. Create Cloudflare resources

```bash
npm install
npx wrangler login   # log into the primary account

npx wrangler kv namespace create AIRH_KV
npx wrangler kv namespace create AIRH_KV --preview
npx wrangler d1 create airighthand
npx wrangler r2 bucket create airighthand-media
```

Paste the returned IDs into `wrangler.toml` (`REPLACE_WITH_*` placeholders).

Then create the D1 tables — they're created automatically on first webhook
request via `initDB()`, but you can do it explicitly with:

```bash
npx wrangler d1 execute airighthand --remote --command "SELECT 1"
```

## 2. Set Worker secrets

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET   # any random 32-byte hex
npx wrangler secret put OWNER_ID                   # 6954322783
npx wrangler secret put CF_ACCOUNTS_JSON           # JSON array, see below
# optional:
npx wrangler secret put TELEGRAM_PAYMENT_PROVIDER_TOKEN
```

`CF_ACCOUNTS_JSON` example:

```json
[
  {"id":"AAA...","token":"cfat_..."},
  {"id":"BBB...","token":"cfat_..."}
]
```

> ⚠ The **primary** account's credentials must also be in this JSON if you want
> the pool to use it for AI calls. The primary account is also where the
> *Worker itself* runs, separate from AI usage.

## 3. Deploy

### Option A — manual

```bash
npx wrangler deploy
```

### Option B — GitHub Actions (recommended)

Add the following repository secrets in *Settings → Secrets and variables → Actions*:

| Name                       | Value                                                |
|----------------------------|------------------------------------------------------|
| `CLOUDFLARE_API_TOKEN`     | API token of the primary CF account with `Workers Scripts:Edit` + `Workers AI:Read` |
| `CLOUDFLARE_ACCOUNT_ID`    | Primary account's ID                                 |
| `TELEGRAM_BOT_TOKEN`       | Bot token (for the post-deploy `setWebhook` step)    |
| `TELEGRAM_WEBHOOK_SECRET`  | Same secret you set in the Worker                    |

Add a repository **variable** (not secret):

| Name          | Value                                              |
|---------------|----------------------------------------------------|
| `WORKER_URL`  | Deployed Worker URL, e.g. `https://airighthand-bot.<subdomain>.workers.dev` |

Push to `main` — the workflow deploys the Worker and registers the webhook.

## 4. Verify

1. `curl https://<worker>/` → `AiRightHand is awake. 🤖`
2. DM the bot `/start`
3. Try `/image a tabby cat in a tea cup` and `/model heavy` then ask a hard question.
