#!/bin/sh
# Git does not version .git/hooks, so each clone installs them once:
#   sh scripts/install-hooks.sh
set -e
repo="$(git rev-parse --show-toplevel)"
cp "$repo/scripts/pre-commit" "$repo/.git/hooks/pre-commit"
chmod +x "$repo/.git/hooks/pre-commit"
echo "installed .git/hooks/pre-commit"
