#!/bin/sh
set -eu

if [ -f dist/scripts/report-composition-readiness.js ]; then
  node dist/scripts/report-composition-readiness.js "$@"
else
  npx ts-node src/scripts/report-composition-readiness.ts "$@"
fi
