# Plausible Analytics Setup

## 1. Create account
Go to https://plausible.io and sign up (or use the free trial).

## 2. Add your site
- Click "Add a website"
- Enter `digit-ai.ai` as the domain
- Select your timezone (Amsterdam / CET)

## 3. The tracking script is already installed
`index.html` already contains:
```html
<script defer data-domain="digit-ai.ai" src="https://plausible.io/js/script.js"></script>
```
No further changes to index.html needed.

## 4. Share the dashboard (for /admin/analytics embed)
- Go to your Plausible site → Settings → Visibility
- Enable "Public dashboard" or create a "Shared link"
- Copy the shared dashboard URL (looks like: `https://plausible.io/share/digit-ai.ai?auth=xxxxx`)

## 5. Add to Vercel environment variables
In Vercel dashboard → Project → Settings → Environment Variables, add:
```
PLAUSIBLE_DASHBOARD_URL = https://plausible.io/share/digit-ai.ai?auth=xxxxx
```
This will automatically embed in `/admin/analytics`.

## What Plausible tracks (privacy-first, no cookies)
- Page views and unique visitors
- Top pages
- Referrer sources
- Country / city
- Device type
- Browser

No GDPR consent banner required for Plausible (cookieless).
