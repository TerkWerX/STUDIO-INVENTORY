#!/usr/bin/env bash
cd "$(dirname "$0")"
echo "Starting Studio Inventory at http://localhost:3847"
echo "Press Ctrl+C to stop."
open "http://localhost:3847" 2>/dev/null || xdg-open "http://localhost:3847" 2>/dev/null || true
node server.js