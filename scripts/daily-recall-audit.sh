#!/bin/bash
# Daily Recall Audit
# Checks for CRITICAL memories that haven't been recalled in their expected interval

SUPABASE_URL="${SUPABASE_URL:-https://ynaqtawyynqikfyranda.supabase.co}"
SUPABASE_KEY="${SUPABASE_ANON_KEY}"

if [ -z "$SUPABASE_KEY" ]; then
  echo "Error: SUPABASE_ANON_KEY not set"
  exit 1
fi

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🧠 DAILY MEMORY RECALL AUDIT"
echo "  Date: $(date +%Y-%m-%d)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

# Find CRITICAL (Level 0) memories not recalled in >3 days
echo "🔴 LEVEL 0 (IMMUTABLE) - Expected recall: Every 3 days"
LEVEL0_STALE=$(npx supabase db execute --workdir /Users/zstoc/GitHub/quant-chat-scaffold "
SELECT
  summary,
  COALESCE(EXTRACT(DAY FROM NOW() - last_recalled_at)::INTEGER, 9999) as days_since_recall,
  financial_impact
FROM memories
WHERE protection_level = 0
  AND (last_recalled_at IS NULL OR last_recalled_at < NOW() - INTERVAL '3 days')
ORDER BY financial_impact DESC NULLS LAST
LIMIT 10;
" 2>/dev/null)

if [ -n "$LEVEL0_STALE" ]; then
  echo "$LEVEL0_STALE"
  echo
  echo "⚠️  CRITICAL: These expensive lessons need reinforcement"
else
  echo "✅ All Level 0 memories recalled recently"
fi

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

# Find PROTECTED (Level 1) memories not recalled in >7 days
echo "🟡 LEVEL 1 (PROTECTED) - Expected recall: Every 7 days"
LEVEL1_STALE=$(npx supabase db execute --workdir /Users/zstoc/GitHub/quant-chat-scaffold "
SELECT
  summary,
  COALESCE(EXTRACT(DAY FROM NOW() - last_recalled_at)::INTEGER, 9999) as days_since_recall
FROM memories
WHERE protection_level = 1
  AND (last_recalled_at IS NULL OR last_recalled_at < NOW() - INTERVAL '7 days')
ORDER BY importance_score DESC
LIMIT 10;
" 2>/dev/null)

if [ -n "$LEVEL1_STALE" ]; then
  echo "$LEVEL1_STALE"
  echo
  echo "⚠️  These protected memories should be reviewed"
else
  echo "✅ All Level 1 memories recalled recently"
fi

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Audit complete"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
