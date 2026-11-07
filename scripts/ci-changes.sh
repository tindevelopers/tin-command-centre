#!/usr/bin/env bash
# Classifies a change set for CI (adapted from tin-boss-api scripts/ci-changes.sh).
# Reads changed paths (one per line) on stdin and prints a GitHub step output:
#   code=true|false  run the quality job (lint, type-check, test, build)
# Fail-safe: an empty list or the sentinel "*" (unknown base, or a push to main) runs everything.
# No test or lint rule reads docs/ (checked 2026-11-07: src/, db/, scripts/, vitest.config.mts, eslint.config.mjs).
set -euo pipefail

code=false
seen=0

# Pure documentation: prose and images under docs/, and root-level Markdown (CLAUDE.md, AGENTS.md, README.md).
docs_only() {
  case "$1" in
    docs/*.md | docs/*.html | docs/*.png | docs/*.jpg | docs/*.svg | docs/*.json | docs/*.mmd | docs/*.txt) return 0 ;;
  esac
  [[ "$1" != */* && "$1" == *.md ]]
}

while IFS= read -r path || [[ -n "$path" ]]; do
  [[ -z "$path" ]] && continue
  seen=1
  if [[ "$path" == "*" ]]; then
    code=true
    continue
  fi
  docs_only "$path" || code=true
done

if [[ "$seen" -eq 0 ]]; then
  code=true
fi

printf 'code=%s\n' "$code"
