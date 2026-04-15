#!/bin/sh
set -eu

mkdir -p /data/storage /data/reports /data/report-runs

if [ -d /app-defaults/reports ]; then
  mkdir -p /data/reports
  cp -an /app-defaults/reports/. /data/reports/ 2>/dev/null || true
fi

mkdir -p /data/storage/task-documents
mkdir -p /data/storage/db-backups

exec "$@"
