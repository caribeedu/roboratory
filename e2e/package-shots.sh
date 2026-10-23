#!/bin/sh
# Rebuilds the packaged app and takes screenshots with Playwright.
set -e
cd "$(dirname "$0")/.."
npx electron-forge package > /tmp/roboratory-package.log 2>&1 || { tail -30 /tmp/roboratory-package.log; exit 1; }
node e2e/shoot.mjs "$@"
