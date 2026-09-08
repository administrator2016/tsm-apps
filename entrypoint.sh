#!/bin/bash
set -e
echo "--- Initializing TSM Suite Persistence ---"
timeout 15 mkdir -p /app/data || { echo "FATAL: mkdir /app/data timed out/failed"; exit 1; }
echo "  data dir ready"

seed() {
  local file="$1" content="$2"
  if [ ! -f "$file" ]; then
    if timeout 10 bash -c "echo '$content' > '$file'"; then
      echo "  seeded $file"
    else
      echo "FATAL: writing $file timed out/failed"; exit 1
    fi
  else
    echo "  $file already present"
  fi
}

seed /app/data/bpo-tasks.json '{"tasks":[]}'
seed /app/data/hc-strategist-memory.json '{"items":[]}'
seed /app/data/wip-master.json '{"jobs":[]}'

echo "--- Starting Node Server ---"
exec node server.js
