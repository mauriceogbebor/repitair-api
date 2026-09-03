# Repitair capacity test

Run only against staging or a production-like rehearsal environment. Do not
stress Spotify, Apple Music, SendGrid, Expo, or remove.bg from this suite.

## Prerequisites

- Install k6: https://grafana.com/docs/k6/latest/set-up/install-k6/
- Create dedicated load-test accounts and obtain short-lived access tokens.
  Authenticated profiles require one unique token per peak virtual user: 1,000
  for `load`, 2,000 for `spike`, and 500 for `soak`. This prevents one account's
  intentional rate limit from being mistaken for a capacity failure.
- Use production-like PostgreSQL, Redis, S3, API, and worker sizing.

## Commands

```sh
BASE_URL=https://api-staging.repitair.com PROFILE=smoke k6 run performance/k6/repitair-load.js
BASE_URL=https://api-staging.repitair.com PROFILE=load AUTH_TOKENS="$(paste -sd, load.tokens)" k6 run performance/k6/repitair-load.js
BASE_URL=https://api-staging.repitair.com PROFILE=spike AUTH_TOKENS="$(paste -sd, spike.tokens)" k6 run performance/k6/repitair-load.js
BASE_URL=https://api-staging.repitair.com PROFILE=soak AUTH_TOKENS="$(paste -sd, soak.tokens)" k6 run performance/k6/repitair-load.js
```

Uploads are off by default to avoid storage pollution. Set
`ENABLE_UPLOADS=true` only in a disposable rehearsal environment.

The built-in gates are under 1% request failures, p95 under 800 ms, p99 under
1.5 seconds, and over 99% checks passing. Also inspect API/worker CPU, memory,
database and Redis connection usage, S3 errors, queue depth, and oldest queue
age while the test runs.
