#!/bin/sh
set -eu
if [ -n "${WORKER_READY_FILE:-}" ]; then
  rm -f "$WORKER_READY_FILE"
fi
if [ "${PROJECT_BOOTSTRAP:-true}" = "true" ]; then
  node dist/scripts/project-db.js bootstrap
fi
exec "$@"
