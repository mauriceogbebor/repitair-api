# Runbook: Music provider account connection (Spotify / Apple Music)

How the "Connect your music app" flow is gated, how to onboard testers, and how to
diagnose the failures we have actually hit. Applies to the staging and production
API deployments (Railway).

## TL;DR

A user can only connect a provider when **all** of these hold:

1. The **app build** has the feature flag on (`EXPO_PUBLIC_MUSIC_PROVIDER_CONNECTIONS_ENABLED=true`).
2. The **backend** has the feature enabled (`MUSIC_PROVIDER_CONNECTIONS_ENABLED=true`).
3. That provider is enabled (`SPOTIFY_CONNECTIONS_ENABLED` or `APPLE_MUSIC_CONNECTIONS_ENABLED`).
4. The user's **Repitair account email** passes the allowlist (`MUSIC_PROVIDER_CONNECTION_ALLOWLIST` — empty means "allow everyone").
5. The **provider OAuth app** is configured correctly (redirect URI registered + client credentials) and permits that user (Spotify mode — see below).

If a user "can't connect," walk these five in order. Gates 1–4 are Repitair-side
and show as a locked/"not available" screen; gate 5 is where the provider (Spotify)
takes over and shows its own error.

## Environment variables

Set on the API service (Railway) for each environment.

| Variable | Purpose | Notes |
| --- | --- | --- |
| `MUSIC_PROVIDER_CONNECTIONS_ENABLED` | Master on/off for provider connections | Must be `"true"`. If unset/false, every connect attempt 404s → app shows "Music account connections are not available." |
| `SPOTIFY_CONNECTIONS_ENABLED` | Spotify account-connection rollout | Keep `"false"` in production until Spotify Extended Quota is approved. Public Spotify links still work. |
| `APPLE_MUSIC_CONNECTIONS_ENABLED` | Apple Music account-connection rollout | Set `"true"` after the production MusicKit smoke test passes. |
| `MUSIC_PROVIDER_CONNECTION_ALLOWLIST` | Comma-separated **Repitair login emails** allowed to connect | **Empty = open to all authenticated users.** A populated list restricts to exactly those emails. This one **is** a list (split on comma). |
| `SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` | Spotify app credentials | From the Spotify developer dashboard app. |
| `SPOTIFY_REDIRECT_URI` | The single OAuth callback URL | **Exactly one URL**, e.g. `https://api-staging.repitair.com/api/auth/spotify/callback`. NOT a comma-separated list (see gotcha below). |
| `APPLE_MUSIC_TEAM_ID` / `APPLE_MUSIC_KEY_ID` / `APPLE_MUSIC_PRIVATE_KEY` | MusicKit developer token inputs | Private key is the PEM including `BEGIN PRIVATE KEY`. |
| `APPLE_MUSIC_AUTH_BASE_URL` | Host serving the MusicKit authorize page | https, backend host. |

The app build's `EXPO_PUBLIC_MUSIC_PROVIDER_CONNECTIONS_ENABLED` and
`EXPO_PUBLIC_API_URL` live in `eas.json` per build profile. The `staging-testflight`
and `preview` profiles point at `api-staging.repitair.com` with the flag on; the
`production` profile currently has the flag **off**.

## Diagnostics endpoint

`GET /api/auth/oauth/diagnostics` (admin-only; JWT + admin-email guard) returns a
secret-free readiness report. Use it first — it tells you exactly what is
misconfigured without leaking credentials. Key Spotify fields:

- `redirectUri` — the exact string being sent to Spotify.
- `redirectUriValid` — `true` only when it is a single https URL with path
  `/api/auth/spotify/callback` and no query/fragment.
- `redirectUriProblem` — a human-readable reason when invalid (e.g. comma list).
- `ready` — client id present AND redirect URI valid.

The same validation runs at boot: a bad `SPOTIFY_REDIRECT_URI` logs a warning in
the Railway deploy logs, and `buildSpotifyAuthUrl` / the token exchange throw a
clear "Spotify OAuth is misconfigured: …" instead of forwarding a broken value.

## `SPOTIFY_REDIRECT_URI` — the comma gotcha

OAuth's `redirect_uri` is a **single** value per request, and the backend sends it
verbatim (the authorize call and the token exchange must be byte-identical).

- ✅ `https://api-staging.repitair.com/api/auth/spotify/callback`
- ❌ `https://a.up.railway.app/api/auth/spotify/callback,https://api-staging.repitair.com/api/auth/spotify/callback`

The comma-separated form is the mistake we hit: it gets sent as one malformed
value and Spotify replies **`redirect_uri: Not matching configuration`**. To allow
multiple callback URLs, register each of them **in the Spotify dashboard**, and set
the env var to the single one that matches the host the app calls
(`EXPO_PUBLIC_API_URL`). Contrast: `MUSIC_PROVIDER_CONNECTION_ALLOWLIST` **is** a
comma list — commas are correct there, wrong here.

The registered dashboard URI must be byte-identical to the env value: same scheme,
host, path, and no trailing slash difference.

## Spotify app mode (Development vs Extended Quota)

This determines **which Spotify accounts** may authorize, independently of the
Repitair allowlist:

- **Development mode** — only the app **owner** and up to **5** authenticated
  accounts explicitly added under the app's **User Management** may
  authorize. The owner can always connect without being listed, which is why an
  owner test can succeed while a fresh tester still fails with "not approved"
  (`SPOTIFY_ACCOUNT_NOT_ALLOWED`, a 403 from `GET /v1/me`).
- **Extended quota mode** — approved apps can authorize users outside the
  development allowlist. Request this from the Spotify dashboard before a
  public connection rollout; approval is not an automatic launch entitlement.

Check the app's mode in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard).
If it's Extended Quota, ignore Spotify user management entirely and manage access
purely via the Repitair allowlist. If it's Development, each non-owner tester's
**Spotify** account must be added under User Management (or request extended quota).

## Onboarding a tester

1. Confirm the tester installs a build with the feature flag on
   (`staging-testflight` / `preview`, or `production` once its flag is flipped).
2. Add the tester's **Repitair login email** to `MUSIC_PROVIDER_CONNECTION_ALLOWLIST`
   (or leave the allowlist empty to open it to all). Redeploy for env changes.
3. Ensure `MUSIC_PROVIDER_CONNECTIONS_ENABLED=true` and the provider-specific flag is true.
4. If the Spotify app is in **Development mode**, add the tester's **Spotify**
   account under the dashboard's User Management (skip if Extended Quota).

Collect two emails per tester: their **Repitair login email** (for the allowlist)
and their **Spotify account email** (for Spotify User Management, Development mode
only) — they are often different.

## Failure → cause map

| Symptom | Gate | Fix |
| --- | --- | --- |
| Connect screen shows "Music account connections are not available." | 2 or 3 | Set `MUSIC_PROVIDER_CONNECTIONS_ENABLED=true`; add the user's Repitair email to the allowlist (or empty it). Redeploy. |
| Connect button/feature absent entirely | 1 | Build has `EXPO_PUBLIC_MUSIC_PROVIDER_CONNECTIONS_ENABLED=false` (the `production` profile). Use a staging/preview build or flip the flag. |
| Spotify page shows `redirect_uri: Not matching configuration` | 4 | `SPOTIFY_REDIRECT_URI` mismatch — single value, and register the exact URI in the Spotify dashboard for the same app as `SPOTIFY_CLIENT_ID`. |
| Spotify login succeeds then app shows "Could not connect" / "not approved for the staging Spotify app" | 4 | Development mode: add the tester's Spotify account under User Management, or request Extended Quota. |
| "Spotify OAuth is misconfigured: …" from the API | 4 | Read the message (comma list / wrong path / non-https); fix `SPOTIFY_REDIRECT_URI`. Confirm via `/api/auth/oauth/diagnostics`. |
