#!/bin/bash
set -e

export HOME=/home/node
export BUN_INSTALL="$HOME/.bun"
export PATH="$BUN_INSTALL/bin:$HOME/.costrict/bin:/usr/local/bin:$PATH"

echo "🔍 Checking Bun installation..."

if ! command -v bun >/dev/null 2>&1; then
  echo "❌ Bun not found. Installing..."
  curl -fsSL https://bun.sh/install | bash
  
  if ! command -v bun >/dev/null 2>&1; then
    echo "❌ Failed to install Bun. Exiting."
    exit 1
  fi
  
  echo "✅ Bun installed successfully"
else
  BUN_VERSION=$(bun --version 2>&1 || echo "unknown")
  echo "✅ Bun is installed (version: $BUN_VERSION)"
fi

echo "🔍 Checking CoStrict installation..."

MIN_COSTRICT_VERSION="1.0.137"

version_gte() {
  printf '%s\n%s\n' "$2" "$1" | sort -V -C
}

if ! command -v costrict >/dev/null 2>&1; then
  echo "⚠️  CoStrict not found. Installing..."
  curl -fsSL https://costrict.ai/install | bash

  if ! command -v costrict >/dev/null 2>&1; then
    echo "❌ Failed to install CoStrict. Exiting."
    exit 1
  fi
  echo "✅ CoStrict installed successfully"
fi

COSTRICT_VERSION=$(costrict --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "unknown")
echo "✅ CoStrict is installed (version: $COSTRICT_VERSION)"

if [ "$COSTRICT_VERSION" != "unknown" ]; then
  if version_gte "$COSTRICT_VERSION" "$MIN_COSTRICT_VERSION"; then
    echo "✅ CoStrict version meets minimum requirement (>=$MIN_COSTRICT_VERSION)"
  else
    echo "⚠️  CoStrict version $COSTRICT_VERSION is below minimum required version $MIN_COSTRICT_VERSION"
    echo "🔄 Upgrading CoStrict..."
    costrict upgrade || curl -fsSL https://costrict.ai/install | bash

    COSTRICT_VERSION=$(costrict --version 2>&1 | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || echo "unknown")
    echo "✅ CoStrict upgraded to version: $COSTRICT_VERSION"
  fi
fi

echo "🔍 Checking memory plugin..."

if [ -d "$NODE_PATH/@costrict-manager/memory" ]; then
    echo "✅ Memory plugin found at $NODE_PATH/@costrict-manager/memory"
else
    echo "⚠️  Memory plugin not found at $NODE_PATH/@costrict-manager/memory"
fi

echo "🚀 Starting CoStrict Manager Backend..."

if [ -z "$AUTH_SECRET" ]; then
  echo "❌ AUTH_SECRET is required but not set"
  echo ""
  echo "Please set AUTH_SECRET environment variable with a secure random string."
  echo "Generate one with: openssl rand -base64 32"
  echo ""
  echo "Example in docker-compose.yml:"
  echo "  environment:"
  echo "    - AUTH_SECRET=your-secure-random-secret-here"
  echo ""
  echo "Example with Docker run:"
  echo "  docker run -e AUTH_SECRET=\$(openssl rand -base64 32) ..."
  echo ""
  exit 1
fi

exec "$@"

