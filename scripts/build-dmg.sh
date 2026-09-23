#!/usr/bin/env bash
# D1 #43: one-command DMG pipeline. Local dev and CI run THIS SAME script.
# Signing degrades loudly, never silently: no CSC_LINK → unsigned build + warning.
set -euo pipefail
cd "$(dirname "$0")/.."

export PATH="$HOME/.nvm/versions/node/v24.16.0/bin:$PATH"

echo '==> building renderer/main/preload'
npm run build

echo '==> electron-builder --mac'
# China-network fallback: binaries come from npmmirror when GitHub stalls
export ELECTRON_MIRROR="${ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
export ELECTRON_BUILDER_BINARIES_MIRROR="${ELECTRON_BUILDER_BINARIES_MIRROR:-https://npmmirror.com/mirrors/electron-builder-binaries/}"
npx electron-builder --mac

APP=$(ls -d release/mac*/DeskApp.app 2>/dev/null | head -1 || true)
if [ -z "$APP" ]; then
  echo 'ERROR: DeskApp.app not found under release/' >&2
  exit 1
fi

echo '==> verifying Mach-O signatures'
if [ -n "${CSC_LINK:-}" ]; then
  codesign -v --deep "$APP" && echo "signed: $APP"
else
  echo '⚠️  WARNING: CSC_LINK not set — UNSIGNED build.' >&2
  echo '⚠️  Gatekeeper will quarantine this DMG on other machines.' >&2
  echo '⚠️  Set CSC_LINK (+ CSC_KEY_PASSWORD) for a signed, notarized build.' >&2
fi

# Notarize only when explicitly asked (needs APPLE_ID/APPLE_APP_SPECIFIC_PASSWORD/APPLE_TEAM_ID)
if [ -n "${CSC_LINK:-}" ] && [ "${NOTARIZE:-0}" = "1" ]; then
  DMG=$(ls release/DeskApp-*-arm64.dmg 2>/dev/null | head -1 || true)
  if [ -n "$DMG" ]; then
    echo '==> notarizing'
    xcrun notarytool submit "$DMG" --apple-id "$APPLE_ID" --password "$APPLE_APP_SPECIFIC_PASSWORD" --team-id "$APPLE_TEAM_ID" --wait
    xcrun stapler staple "$DMG"
    echo "notarized + stapled: $DMG"
  fi
fi

echo '==> done. artifacts in release/'
ls -la release/*.dmg release/*.zip 2>/dev/null || true
