#!/bin/bash
# DeskApp restart — kill old, clean lock, rebuild, start fresh
set -e

DESKAPP_DIR="$(cd "$(dirname "$0")" && pwd)"

# Kill ONLY deskapp processes. Child processes (GPU, network, renderers, bridge)
# all have ~/deskapp in their full command line. The main process
# (Electron .) uses a relative path in ps, but it loses all children and exits
# within 1-2 seconds.
pkill -9 -f "$DESKAPP_DIR" 2>/dev/null || true
sleep 1
rm -f "$HOME/Library/Application Support/deskapp/SingletonLock"
cd "$DESKAPP_DIR"
npm run build
# Use explicit Electron path — npx may pick up other projects' Electron
./node_modules/electron/dist/Electron.app/Contents/MacOS/Electron . &
echo "DeskApp started (PID $!)"
