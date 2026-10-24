#!/bin/bash
# Publish all @agentix-e/micro-kinetic-* packages to npm with sigstore provenance.
# Requires npm 11.x+ (for OIDC sigstore support) and NPM_TOKEN env var.
# 
# Usage:
#   export NPM_TOKEN=npm_xxxxxxxxxxxx
#   bash scripts/publish.sh
#
# Or via CI (OIDC token exchange):
#   bash scripts/publish.sh
set -e

echo "=== Publishing @agentix-e/micro-kinetic packages to npm ==="

# Build all packages
pnpm build

# Verify tests pass
pnpm test:all

# Publish in dependency order
packages=(
  "@agentix-e/micro-kinetic-core"
  "@agentix-e/micro-kinetic-tree"
  "@agentix-e/micro-kinetic-cutting"
  "@agentix-e/micro-kinetic-noise"
  "@agentix-e/micro-kinetic-scaling"
  "@agentix-e/micro-kinetic-wave"  
  "@agentix-e/micro-kinetic"
)

for pkg in "${packages[@]}"; do
  dir=$(echo "$pkg" | sed 's/@agentix-e\/micro-kinetic-//' | sed 's/@agentix-e\/micro-kinetic$/kinetic/')
  echo ""
  echo "Publishing $pkg (packages/$dir)..."
  cd "packages/$dir"
  npm publish --access public --provenance 2>&1 || {
    echo "WARNING: $pkg publish failed (may already exist or need auth)"
  }
  cd ../..
done

echo ""
echo "=== Publish complete ==="
for pkg in "${packages[@]}"; do
  echo "https://www.npmjs.com/package/$pkg"
done
