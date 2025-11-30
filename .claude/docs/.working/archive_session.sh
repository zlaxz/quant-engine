#!/bin/bash
#
# archive_session.sh
# Helper script to archive current session work
#
# Usage: ./.working/archive_session.sh "session description"
#
# What it does:
#   1. Creates timestamp-based archive directory
#   2. Moves .working/agents/* to archive/
#   3. Moves .working/drafts/* to archive/
#   4. Preserves this_session/ for reference
#   5. Clears working directories for next session
#

set -euo pipefail

# Get timestamp for archive folder
TIMESTAMP=$(date -u '+%Y-%m-%d_%H-%M-%S_UTC')
SESSION_DESC="${1:-unspecified}"

# Validate we're in a project root
if [[ ! -d ".working" ]]; then
    echo "ERROR: .working directory not found. Run from project root."
    exit 1
fi

echo "Archiving session: $SESSION_DESC"
echo "Timestamp: $TIMESTAMP"
echo ""

# Create archive directory for this session
ARCHIVE_DIR=".working/archive/$TIMESTAMP-$SESSION_DESC"
mkdir -p "$ARCHIVE_DIR"

# Archive agents
if [[ -d ".working/agents" ]] && [[ -n "$(ls -A .working/agents)" ]]; then
    echo "Archiving agents..."
    mv .working/agents/* "$ARCHIVE_DIR/" 2>/dev/null || true
fi

# Archive drafts
if [[ -d ".working/drafts" ]] && [[ -n "$(ls -A .working/drafts)" ]]; then
    echo "Archiving drafts..."
    mv .working/drafts/* "$ARCHIVE_DIR/" 2>/dev/null || true
fi

# Archive this_session
if [[ -d ".working/this_session" ]] && [[ -n "$(ls -A .working/this_session)" ]]; then
    echo "Archiving session temp files..."
    mkdir -p "$ARCHIVE_DIR/this_session"
    mv .working/this_session/* "$ARCHIVE_DIR/this_session/" 2>/dev/null || true
fi

echo "✓ Session archived to: $ARCHIVE_DIR"
echo ""
echo "Next steps:"
echo "  1. Update SESSION_STATE.md with new findings"
echo "  2. Commit changes: git add SESSION_STATE.md && git commit"
echo "  3. Push if working from remote"
