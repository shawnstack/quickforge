#!/usr/bin/env bash
# QuickForge baseline verification.
# Run with: bash init.sh   (no dependency install; runs npm scripts only)
set -e

cd "$(dirname "$0")"

echo "==> npm run test"
npm run test

echo "==> npm run lint"
npm run lint

echo "==> npm run build"
npm run build

echo ""
echo "Next steps:"
echo "  1. All three gates passed (exit code 0)."
echo "  2. Update progress.md and session-handoff.md with results."
echo "  3. Proceed with the current feature or close it in feature_list.json."
