#!/usr/bin/env bash
# Cleans ephemeral build artifacts and temporary files.
# Preserves runtime data (.seurat/runtime/obras, .seurat/runtime/inbox) by default.
set -euo pipefail
cd "$(dirname "$0")/.."

CLEAN_RUNTIME=false
for arg in "$@"; do
  case "$arg" in
    --runtime)
      CLEAN_RUNTIME=true
      ;;
    --all)
      CLEAN_RUNTIME=true
      ;;
    --help|-h)
      echo "Usage: bash scripts/clean.sh [--runtime|--all]"
      echo "  (no args)  Cleans .seurat/build/ (.class files)"
      echo "  --runtime  Also cleans unpacked inbox caches and a leftover .seurat/runtime/cobertura/ (unused since ADR-05)"
      exit 0
      ;;
  esac
done

echo "Cleaning ephemeral build artifacts (.seurat/build/)..."
rm -rf .seurat/build/classes/* .seurat/build/test-classes/*

if [ "$CLEAN_RUNTIME" = true ]; then
  echo "Cleaning runtime caches (unpacked caches, leftover cobertura/)..."
  rm -rf .seurat/runtime/cobertura .seurat/runtime/inbox/*.d/
fi

echo "Clean complete."
