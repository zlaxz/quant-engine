#!/bin/bash
# Memory Integrity Verification
# Ensures CRITICAL memories haven't been corrupted or deleted

SUPABASE_URL="${SUPABASE_URL:-https://ynaqtawyynqikfyranda.supabase.co}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  🔒 MEMORY INTEGRITY VERIFICATION"
echo "  Date: $(date +%Y-%m-%d\ %H:%M:%S)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo

# Check 1: Verify IMMUTABLE memories still exist
echo "Check 1: Verifying immutable memories..."
IMMUTABLE_COUNT=$(npx supabase db execute --workdir /Users/zstoc/GitHub/quant-chat-scaffold "
SELECT COUNT(*) as count
FROM memories
WHERE protection_level = 0 AND immutable = true;
" 2>/dev/null | grep -oE '[0-9]+' | head -1)

if [ "$IMMUTABLE_COUNT" -eq "0" ]; then
  echo "🚨 CRITICAL: No immutable memories found! May indicate data loss."
elif [ "$IMMUTABLE_COUNT" -lt "16" ]; then
  echo "⚠️  WARNING: Only $IMMUTABLE_COUNT immutable memories (expected ~16 from LESSONS_LEARNED)"
else
  echo "✅ $IMMUTABLE_COUNT immutable memories intact"
fi

echo

# Check 2: Verify RLS policies are active
echo "Check 2: Verifying RLS policies..."
RLS_ENABLED=$(npx supabase db execute --workdir /Users/zstoc/GitHub/quant-chat-scaffold "
SELECT relrowsecurity
FROM pg_class
WHERE relname = 'memories';
" 2>/dev/null | grep -oE 't|f' | head -1)

if [ "$RLS_ENABLED" = "t" ]; then
  echo "✅ RLS enabled on memories table"
else
  echo "🚨 CRITICAL: RLS not enabled - immutable memories not protected!"
fi

echo

# Check 3: Check for orphaned evidence
echo "Check 3: Checking for orphaned evidence..."
ORPHANED=$(npx supabase db execute --workdir /Users/zstoc/GitHub/quant-chat-scaffold "
SELECT COUNT(*) as count
FROM memory_evidence me
WHERE NOT EXISTS (
  SELECT 1 FROM memories m WHERE m.id = me.memory_id
);
" 2>/dev/null | grep -oE '[0-9]+' | head -1)

if [ "$ORPHANED" -gt "0" ]; then
  echo "⚠️  WARNING: $ORPHANED orphaned evidence records"
else
  echo "✅ No orphaned evidence"
fi

echo

# Check 4: Verify regime performance matrix populated
echo "Check 4: Checking regime-profile matrix..."
MATRIX_ENTRIES=$(npx supabase db execute --workdir /Users/zstoc/GitHub/quant-chat-scaffold "
SELECT COUNT(*) as count
FROM regime_profile_performance;
" 2>/dev/null | grep -oE '[0-9]+' | head -1)

echo "📊 $MATRIX_ENTRIES regime-profile combinations tracked"

echo

# Check 5: Verify overfitting warnings exist
echo "Check 5: Checking overfitting warnings..."
WARNING_COUNT=$(npx supabase db execute --workdir /Users/zstoc/GitHub/quant-chat-scaffold "
SELECT COUNT(*) as count
FROM overfitting_warnings;
" 2>/dev/null | grep -oE '[0-9]+' | head -1)

echo "⚠️  $WARNING_COUNT overfitting warnings recorded"

echo
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Integrity check complete"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
