#!/usr/bin/env bash
set -euo pipefail

base="${1:-origin/main}"
changed="$(git diff --name-only "$base"...HEAD)"
if ! printf '%s\n' "$changed" | grep -E '^(packages|skills|template)/' >/dev/null; then
  exit 0
fi
changesets="$(git diff --name-only --diff-filter=AM "$base"...HEAD -- .changeset)"
if ! printf '%s\n' "$changesets" | grep -E '^\.changeset/.+\.md$' | grep -v '^\.changeset/README\.md$' >/dev/null; then
  echo "::error::packages/, skills/ or template/ changed but the PR has no .changeset/*.md; run 'pnpm changeset'"
  exit 1
fi
