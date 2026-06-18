#!/bin/sh
set -eu

if [ -f dist/scripts/backfill-compositions.js ]; then
  node dist/scripts/backfill-compositions.js "$@"
else
  npx ts-node src/scripts/backfill-compositions.ts "$@"
fi
