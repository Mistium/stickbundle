#!/bin/sh
# Build the client into out/dist (static files, served with an SPA fallback).
# Set ROTUR_APP_ID=app_… to sign in with a registered Rotur app (OAuth);
# without it the login button uses rotur.dev/auth.
set -e
cd "$(dirname "$0")/../out"
[ -d node_modules/rotur-sdk ] || bun install
bun build src/main.jsx --outdir dist/assets --target browser --external '/assets/*' \
  --define "__ROTUR_APP_ID__=\"${ROTUR_APP_ID:-}\""
cp -r public/. dist/
