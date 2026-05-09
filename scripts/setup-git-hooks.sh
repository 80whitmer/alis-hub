#!/bin/bash

# Setup Git Hooks for automated deployment
# Usage: npm run setup:hooks

set -e

HOOKS_DIR=".git/hooks"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "🔧 Setting up Git hooks..."

# Create post-push hook for automatic HubSpot deployment
cat > "$HOOKS_DIR/post-push" << 'EOF'
#!/bin/bash

# Auto-deploy to HubSpot after successful push
# Triggered after: git push

set -e

# Get the branch name
BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Only deploy from main or develop branches
if [[ "$BRANCH" == "main" || "$BRANCH" == "develop" ]]; then
  echo "📤 Post-push: Deploying $BRANCH to HubSpot..."
  npm run deploy 2>&1 || echo "⚠️  Deployment encountered errors (see above)"
else
  echo "ℹ️  Skipping deployment for branch: $BRANCH (only main/develop are auto-deployed)"
fi

exit 0
EOF

# Create pre-commit hook for linting (optional)
cat > "$HOOKS_DIR/pre-commit" << 'EOF'
#!/bin/bash

# Pre-commit: Run basic validation before committing
# Triggered before: git commit

set -e

echo "✅ Pre-commit: Running validation..."

# Example: check for uncommitted .env files
if git diff --cached --name-only | grep -q "\.env$"; then
  echo "❌ Error: .env file should not be committed!"
  exit 1
fi

# Add other linting, testing, or validation here
# npm run lint
# npm run test:unit

echo "✅ Pre-commit checks passed"
exit 0
EOF

# Make hooks executable
chmod +x "$HOOKS_DIR/post-push"
chmod +x "$HOOKS_DIR/pre-commit"

echo "✅ Git hooks installed:"
echo "   • post-push: Auto-deploy on push to main/develop"
echo "   • pre-commit: Validate before commit"
echo ""
echo "ℹ️  To remove hooks: rm .git/hooks/post-push .git/hooks/pre-commit"
