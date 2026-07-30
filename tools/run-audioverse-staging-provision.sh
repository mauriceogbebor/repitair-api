#!/bin/sh
set -eu

if [ -f dist/scripts/provision-audioverse-staging.js ]; then
  node dist/scripts/provision-audioverse-staging.js "$@"
else
  npx ts-node src/scripts/provision-audioverse-staging.ts "$@"
fi
