#!/bin/sh
# Build the client into out/dist (static files, served with an SPA fallback).
set -e
cd "$(dirname "$0")/../out"
bun build src/main.jsx --outdir dist/assets --target browser --external '/assets/*'
cp -r public/. dist/
