#!/usr/bin/env bash
cd "$(dirname "$0")"
NODE_BIN="./.runtime/node"
if [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="node"
fi
echo "Starting Studio Inventory at http://localhost:3847"
echo "Press Ctrl+C to stop."
open "http://localhost:3847" 2>/dev/null || xdg-open "http://localhost:3847" 2>/dev/null || true
"$NODE_BIN" server.js
