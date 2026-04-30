# Credentials Setup Guide

This guide tells you exactly where to get each credential and which project's `.env` file it goes in.

Your project has two `.env` files:

| File | Purpose |
|------|---------|
| `repitair-backend/.env` | All server-side credentials (database, APIs, email, storage) |
| `repitair-app/apps/mobile/.env` | Mobile app config (API URL, analytics) |

---

## Step 1 — Copy the example files

```bash
# Backend
cd repitair-backend
cp .env.example .env

# Mobile (already has one, but reset if needed)
cd ../repitair-app/apps/mobile
cp .env.example .env
```

---

## Step 2 — Backend credentials (`repitair-backend/.env`)

### 2.1 JWT Secret (required)

This secures all user authentication tokens.

**Where:** Generate it in your terminal — no website needed.

```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

**What to do:** Paste the output into `repitair-backend/.env`:
```
JWT_SECRET=paste-the-long-hex-string-here
```

**Used by:** `src/common/modules/jwt-auth.module.ts` — signs and verifies all JWTs.

---

### 2.2 PostgreSQL (required)

**Where:** Run locally with Docker, or use a cloud provider (Railway, Supabase, Neon).

**Option A — Local Docker:**
```bash
docker run -d --name repitair-db \
  -e POSTGRES_USER=repitair \
  -e POSTGRES_PASSWORD=repitair \
  -e POSTGRES_DB=repitair \
  -p 5432:5432 \
  postgres:16-alpine
```

Then in `repitair-backend/.env`:
```
DATABASE_URL=postgresql://repitair:repitair@localhost:5432/repitair
```

**Option B — Railway (you already have this):**
Your current Railway database URL is already in your `.env`. Keep it for now, but generate a new password if it's been exposed.

**Used by:** `src/data-source.ts` and `src/app.module.ts` — TypeORM database connection.

---

### 2.3 Redis (optional)

Without Redis, token blacklisting uses an in-memory Map (fine for a single server).

**Where:** Docker locally, or Railway/Upstash for cloud.

```bash
docker run -d --name repitair-redis -p 6379:6379 redis:7-alpine
```

Then in `repitair-backend/.env`:
```
REDIS_URL=redis://localhost:6379
```

**Used by:** `src/common/services/token-blacklist.service.ts` — logout token invalidation.

---

### 2.4 Spotify API (required for song features)

**Where:** https://developer.spotify.com/dashboard

**Steps:**
1. Log in with your Spotify account
2. Click **"Create App"**
3. Fill in the app name ("Repitair") and description
4. Under **Redirect URIs**, add:
   - Dev: `http://localhost:4000/api/auth/spotify/callback`
   - Prod: `https://repitair-api-production.up.railway.app/api/auth/spotify/callback`
5. Check **"Web API"** under "Which API/SDKs are you planning to use?"
6. Click **Save**
7. Go to **Settings** and copy the **Client ID** and **Client Secret**

Then in `repitair-backend/.env`:
```
SPOTIFY_CLIENT_ID=your-client-id
SPOTIFY_CLIENT_SECRET=your-client-secret
SPOTIFY_REDIRECT_URI=http://localhost:4000/api/auth/spotify/callback
```

**Used by:**
- `src/modules/auth/auth.service.ts` — Spotify OAuth (connect account flow)
- `src/modules/music/music.service.ts` — fetching song metadata from Spotify links

**Note:** You already have live Spotify credentials. If they're still valid, no action needed.

---

### 2.5 Apple Music API (needed for Apple Music links)

**Where:** https://developer.apple.com/account — requires Apple Developer Program ($99/year)

**Steps:**
1. Sign in at https://developer.apple.com/account
2. Go to **Certificates, Identifiers & Profiles** > **Keys**
3. Click the **+** button to register a new key
4. Name it "Repitair MusicKit"
5. Check **"MusicKit"** and click **Configure** > **Continue** > **Register**
6. **Download** the `.p8` file (you can only download it once!)
7. Note the **Key ID** shown on the key page
8. Your **Team ID** is in the top-right corner of the developer portal (10 characters)

Then in `repitair-backend/.env`:
```
APPLE_MUSIC_TEAM_ID=ABC1234DEF
APPLE_MUSIC_KEY_ID=XYZ9876543
APPLE_MUSIC_PRIVATE_KEY=-----BEGIN PRIVATE KEY-----\nMIGT...contents-of-p8-file...\n-----END PRIVATE KEY-----
```

To get the private key value, open the `.p8` file in a text editor and paste the entire content, replacing newlines with `\n`.

**Used by:** `src/modules/music/music.service.ts` — fetching song metadata from Apple Music links.

---

### 2.6 SMTP / Email (needed for password resets)

Without this, password reset emails are logged to console (fine for dev).

**Where:** Choose one provider:

**Option A — SendGrid (recommended for production):**
1. Create a free account at https://sendgrid.com
2. Go to **Settings** > **API Keys** > **Create API Key** (Full Access)
3. Go to **Settings** > **Sender Authentication** > verify a sender email or domain

```
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=SG.your-sendgrid-api-key
SMTP_FROM=Repitair <noreply@repitair.com>
SUPPORT_EMAIL=mauriceogbebor@gmail.com
```

**Option B — Gmail (quick dev testing):**
1. Go to https://myaccount.google.com/security
2. Enable **2-Step Verification** if not already on
3. Go to https://myaccount.google.com/apppasswords
4. Select **Mail** and generate a password

```
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=mauriceogbebor@gmail.com
SMTP_PASS=your-16-char-app-password
SMTP_FROM=Repitair <mauriceogbebor@gmail.com>
SUPPORT_EMAIL=mauriceogbebor@gmail.com
```

**Used by:** `src/common/services/mail.service.ts` — sends password reset codes and contact form emails.

---

### 2.7 Expo Push Notifications (needed to send push notifications)

**Where:** https://expo.dev

**Steps:**
1. Log in at https://expo.dev (you already have account "mauricemcbig")
2. Click your avatar (top-right) > **Account Settings**
3. Go to **Access Tokens** in the left sidebar
4. Click **Create Token**, name it "repitair-backend"
5. Copy the token

Then in `repitair-backend/.env`:
```
EXPO_ACCESS_TOKEN=your-expo-access-token
```

**Also needed for CI/CD:** This same token must be added as a GitHub secret for EAS builds:
1. Go to your GitHub repo > **Settings** > **Secrets and variables** > **Actions**
2. Click **New repository secret**
3. Name: `EXPO_TOKEN`, Value: the same access token

**Used by:** `src/modules/notifications/notifications.service.ts` — sends push notifications via Expo's servers.

---

### 2.8 remove.bg (needed for background removal feature)

**Where:** https://www.remove.bg/api

**Steps:**
1. Create an account at https://www.remove.bg
2. Go to **API** in the top menu
3. Click **Get API Key**
4. Copy the key (free tier: 50 images/month, paid plans available)

Then in `repitair-backend/.env`:
```
REMOVE_BG_API_KEY=your-api-key
```

**Used by:** `src/modules/images/images.service.ts` — the "Remove Background" feature in the Customize Photo screen.

---

### 2.9 AWS S3 (optional — only if you want cloud file storage)

By default, uploaded images are stored on local disk. Only set this up if you need cloud storage.

**Where:** https://console.aws.amazon.com

**Steps:**
1. Create an S3 bucket
2. Create an IAM user with S3 permissions
3. Generate access keys

Then in `repitair-backend/.env`:
```
UPLOAD_PROVIDER=s3
AWS_S3_BUCKET=repitair-uploads
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
```

And install the SDK:
```bash
cd repitair-backend
npm install @aws-sdk/client-s3
```

**Used by:** `src/modules/uploads/uploads.service.ts` — file upload storage.

---

## Step 3 — Mobile app config (`repitair-app/apps/mobile/.env`)

The mobile app only has 3 environment variables. All API keys live on the backend — the mobile app just talks to your backend URL.

### 3.1 API URL (required)

This tells the mobile app where to find your backend.

In `repitair-app/apps/mobile/.env`:
```
# iOS Simulator / web
EXPO_PUBLIC_API_URL=http://localhost:4000/api

# Android Emulator — use this instead:
# EXPO_PUBLIC_API_URL=http://10.0.2.2:4000/api

# Physical device on same Wi-Fi — use your computer's LAN IP:
# EXPO_PUBLIC_API_URL=http://192.168.1.XXX:4000/api
```

**Note:** For EAS builds (preview/production), the API URL is set in `eas.json` under each build profile, not in `.env`. Your `eas.json` already has the correct URLs configured.

### 3.2 Mixpanel (optional analytics)

**Where:** https://mixpanel.com

1. Create a project
2. Copy the project token from **Settings** > **Project Settings**

```
EXPO_PUBLIC_MIXPANEL_TOKEN=your-project-token
```

### 3.3 Sentry (optional error tracking)

**Where:** https://sentry.io

1. Create a project for React Native
2. Copy the DSN from **Settings** > **Client Keys (DSN)**

```
EXPO_PUBLIC_SENTRY_DSN=https://your-key@sentry.io/your-project-id
```

---

## Step 4 — App Store / Play Store submission (`eas.json`)

When you're ready to publish, you'll need to fill in two things in `repitair-app/apps/mobile/eas.json`:

### iOS — Apple App Store

**Where:** https://appstoreconnect.apple.com

1. Create a new app in App Store Connect
2. Copy the **Apple ID** (numeric, from App Information page)
3. Your **Apple Team ID** is in https://developer.apple.com/account under Membership

Then update `eas.json` > `submit.production.ios`:
```json
"appleId": "mauriceogbebor@gmail.com",
"ascAppId": "1234567890",
"appleTeamId": "ABC1234DEF"
```

### Android — Google Play Store

**Where:** https://play.google.com/console

1. Go to **Setup** > **API access**
2. Create a service account with "Release Manager" role
3. Download the JSON key file
4. Save it as `repitair-app/apps/mobile/google-service-account.json`

Your `eas.json` already references this file path.

---

## Quick reference — what to do first

| Priority | Credential | Where it goes | How long |
|----------|-----------|---------------|----------|
| Do now | JWT_SECRET | `repitair-backend/.env` | 30 seconds |
| Do now | PostgreSQL | `repitair-backend/.env` | Already done (Railway) |
| Do now | Spotify | `repitair-backend/.env` | Already done |
| Do next | Gmail SMTP | `repitair-backend/.env` | 5 minutes |
| Do next | Expo token | `repitair-backend/.env` + GitHub secret | 5 minutes |
| When needed | Apple Music | `repitair-backend/.env` | 15 min (needs $99 dev account) |
| When needed | remove.bg | `repitair-backend/.env` | 2 minutes |
| When needed | Sentry | `repitair-app/apps/mobile/.env` | 5 minutes |
| When needed | Mixpanel | `repitair-app/apps/mobile/.env` | 5 minutes |
| When needed | S3 | `repitair-backend/.env` | 15 minutes |
| At launch | App Store IDs | `eas.json` | Varies |
| At launch | Google Play key | `eas.json` + JSON file | 15 minutes |
