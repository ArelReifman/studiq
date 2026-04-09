#!/bin/sh
export PATH="/usr/local/bin:/Users/arelreifman/.npm-global/bin:$PATH"
cd "$(dirname "$0")"
exec pnpm dev
