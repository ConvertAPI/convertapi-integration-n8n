#!/usr/bin/env bash
# Runs the live tests against the production ConvertAPI service.
# Usage: CONVERTAPI_TOKEN_FILE=/path/to/token-file scripts/test-live.sh
# The token is read from the file, never passed on the command line, and masked in the output.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ ! -s "${CONVERTAPI_TOKEN_FILE:-}" ]; then
	echo "Set CONVERTAPI_TOKEN_FILE to a file that holds a ConvertAPI API token." >&2
	exit 2
fi
export CONVERTAPI_TOKEN_FILE
npm run test:live 2>&1 | node -e '
const fs = require("node:fs");
const readline = require("node:readline");
const token = fs.readFileSync(process.env.CONVERTAPI_TOKEN_FILE, "utf8").trim();
readline.createInterface({ input: process.stdin }).on("line", (line) => {
	console.log(token ? line.split(token).join("***") : line);
});
'
