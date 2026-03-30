# 🎯 SeatSniper ASU

Get a text the second a class opens at Arizona State University. Free. Built with Node.js, Express, SQLite, and Twilio.

---

## Quick Start (Local)

```bash
# 1. Install dependencies
npm install

# 2. Copy env file and fill in your credentials
cp .env.example .env

# 3. Start the server
npm start
# OR for development with auto-reload:
npm run dev
```

Open http://localhost:3000

---

## Environment Variables

Edit your `.env` file:

```
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_PHONE_NUMBER=+14805551234
PORT=3000
CHECK_INTERVAL_MINUTES=1
```

---

## Getting Twilio Credentials (Free to start)

1. Sign up at **twilio.com** (free trial gives you ~$15 credit)
2. Get your **Account SID** and **Auth Token** from the Twilio Console
3. Buy a phone number (~$1/month) or use your free trial number
4. Add all three to your `.env` file

> **Cost estimate:** Twilio charges ~$0.0079/SMS. 1,000 alerts = ~$8.

---

## Deploying to Railway (Recommended — ~$5/month)

1. Push this folder to a GitHub repo
2. Go to **railway.app** → New Project → Deploy from GitHub
3. Add your environment variables in Railway's dashboard
4. Railway auto-detects Node.js and deploys — done!

Your site will be live at `yourapp.railway.app` (or a custom domain).

### Other hosting options:
- **Render** (render.com) — free tier available, may spin down
- **Fly.io** — generous free tier
- **DigitalOcean App Platform** — ~$5/month

---

## How the ASU API Works

SeatSniper hits ASU's class search API:
```
GET https://eadvs-cscc-catalog-api.apps.asu.edu/catalog-microservices/api/v1/search/classes
  ?term=2281&classNbr=64766&campusOrOnlineSelection=A&...
```

The server-side fetch works **without auth** because:
- It sends proper headers (Referer, Origin, User-Agent)
- It captures and reuses ASU's session cookies automatically
- Server IPs are not blocked the same way browser extensions are

---

## Project Structure

```
seatsniper/
├── src/
│   ├── server.js       # Express app + startup
│   ├── db.js           # SQLite database
│   ├── checker.js      # ASU API polling
│   ├── scheduler.js    # Cron job (checks every minute)
│   ├── sms.js          # Twilio SMS sender
│   └── routes/
│       └── api.js      # REST endpoints
├── public/
│   └── index.html      # Frontend
├── data/               # SQLite DB stored here (auto-created)
├── .env.example
└── package.json
```

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/terms` | Get available ASU terms |
| `POST` | `/api/watch` | Add a class to watch |
| `GET` | `/api/status/:phone` | Get all watches for a phone |
| `DELETE` | `/api/watch/:id` | Remove a watch |
| `GET` | `/api/stats` | Public stats (total watching, alerts sent) |

---

## Limits

- Max **5 active watches** per phone number
- Rate limited to **10 watch requests/hour** per IP
- Notifications throttled to **once per hour** per class (so you don't get spammed if it keeps opening/closing)

---

## Notes

- The SQLite database is stored at `data/seatsniper.db` and persists between restarts
- On Railway/Render, use a persistent disk or swap to PostgreSQL for production scale
- ASU's term codes follow the pattern: Fall=x261, Spring=x271, Summer=x277 where x increments each year
