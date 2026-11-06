#!/bin/sh
# Build the client into out/dist (static files, served with an SPA fallback).
# Set ROTUR_APP_ID=app_… to sign in with a registered Rotur app (OAuth);
# without it the login button uses rotur.dev/auth.
set -e
cd "$(dirname "$0")/../out"
[ -d node_modules ] || bun install
bun run build
