#!/bin/bash
# =============================================================
# Rook's Cloud Brain - Automated Test Suite
# Tests security hardening, health, and basic functionality
#
# Usage:
#   ./test.sh                    # Uses http://localhost:8787
#   ./test.sh https://custom.url # Custom worker URL
#
# Requires: ROOK_BRAIN_API_KEY env var set
# =============================================================

set -euo pipefail

# --- Config ---
BASE_URL="${1:-http://localhost:8787}"
API_KEY="${ROOK_BRAIN_API_KEY:-}"

if [ -z "$API_KEY" ]; then
    echo "ERROR: Set ROOK_BRAIN_API_KEY environment variable"
    echo "  export ROOK_BRAIN_API_KEY=your-key-here"
    exit 1
fi

# --- Counters ---
PASS=0
FAIL=0
TOTAL=0

# --- Helpers ---
test_result() {
    local name="$1"
    local expected="$2"
    local actual="$3"
    TOTAL=$((TOTAL + 1))

    if [ "$actual" = "$expected" ]; then
        echo "  PASS: $name"
        PASS=$((PASS + 1))
    else
        echo "  FAIL: $name (expected $expected, got $actual)"
        FAIL=$((FAIL + 1))
    fi
}

test_contains() {
    local name="$1"
    local needle="$2"
    local haystack="$3"
    TOTAL=$((TOTAL + 1))

    if echo "$haystack" | grep -q "$needle"; then
        echo "  PASS: $name"
        PASS=$((PASS + 1))
    else
        echo "  FAIL: $name (expected to contain '$needle')"
        FAIL=$((FAIL + 1))
    fi
}

# --- Tests ---
echo ""
echo "========================================="
echo "  Brain Test Suite: $BASE_URL"
echo "========================================="
echo ""

# ---- 1. Health Endpoint ----
echo "[1] Health Endpoint (no auth required)"

HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/health")
test_result "Health returns 200" "200" "$HEALTH"

HEALTH_BODY=$(curl -s "$BASE_URL/health")
test_contains "Health reports status" '"status"' "$HEALTH_BODY"
test_contains "Health reports storage" '"storage"' "$HEALTH_BODY"

echo ""

# ---- 2. Auth: No Token ----
echo "[2] Auth - No Token"

NO_AUTH=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/mcp" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"tools/list","id":1}')
test_result "No auth returns 401" "401" "$NO_AUTH"

echo ""

# ---- 3. Auth: Wrong Token ----
echo "[3] Auth - Wrong Token"

WRONG_AUTH=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/mcp" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer definitely-wrong-key-12345" \
    -d '{"jsonrpc":"2.0","method":"tools/list","id":1}')
test_result "Wrong auth returns 401" "401" "$WRONG_AUTH"

echo ""

# ---- 4. Auth: Correct Token ----
echo "[4] Auth - Correct Token"

CORRECT_AUTH=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/mcp" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -d '{"jsonrpc":"2.0","method":"tools/list","id":1}')
test_result "Correct auth returns 200" "200" "$CORRECT_AUTH"

echo ""

# ---- 5. Auth: Query Parameter (legacy support) ----
echo "[5] Auth - Query Parameter"

QUERY_AUTH=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/mcp?key=$API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"jsonrpc":"2.0","method":"tools/list","id":1}')
test_result "Query param auth returns 200" "200" "$QUERY_AUTH"

echo ""

# ---- 6. Path Traversal: Territory ----
echo "[6] Path Traversal - Territory Validation"

TRAVERSAL_BODY=$(curl -s -X POST "$BASE_URL/mcp" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -d '{"jsonrpc":"2.0","method":"tools/call","id":2,"params":{"name":"mind_observe","arguments":{"content":"traversal test","territory":"../../etc/passwd"}}}')
test_contains "Path traversal rejected" "Invalid territory" "$TRAVERSAL_BODY"

TRAVERSAL_BODY2=$(curl -s -X POST "$BASE_URL/mcp" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -d '{"jsonrpc":"2.0","method":"tools/call","id":3,"params":{"name":"mind_read_territory","arguments":{"territory":"../secrets"}}}')
test_contains "Read traversal rejected" "nvalid territory\|Unknown territory" "$TRAVERSAL_BODY2"

echo ""

# ---- 7. Payload Size Limit ----
echo "[7] Payload Size - 1MB Limit"

# Generate a >1MB payload via temp file (too large for shell args)
TMPFILE=$(mktemp)
python3 -c "print('{\"jsonrpc\":\"2.0\",\"method\":\"tools/call\",\"id\":4,\"params\":{\"name\":\"mind_observe\",\"arguments\":{\"content\":\"' + 'A' * 1100000 + '\"}}}')" > "$TMPFILE"
OVERSIZE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$BASE_URL/mcp" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -d @"$TMPFILE")
rm -f "$TMPFILE"
test_result "Oversized payload returns 413" "413" "$OVERSIZE"

echo ""

# ---- 8. Basic Functionality: Tool List ----
echo "[8] Functionality - Tool List"

TOOLS_BODY=$(curl -s -X POST "$BASE_URL/mcp" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -d '{"jsonrpc":"2.0","method":"tools/list","id":5}')
test_contains "Tools list returns tools" '"tools"' "$TOOLS_BODY"
test_contains "Contains mind_observe" 'mind_observe' "$TOOLS_BODY"
test_contains "Contains mind_recall" 'mind_recall' "$TOOLS_BODY"

echo ""

# ---- 9. Basic Functionality: Brain State ----
echo "[9] Functionality - Brain State"

STATE_BODY=$(curl -s -X POST "$BASE_URL/mcp" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $API_KEY" \
    -d '{"jsonrpc":"2.0","method":"tools/call","id":6,"params":{"name":"mind_state","arguments":{}}}')
test_contains "Brain state returns mood" 'mood' "$STATE_BODY"

echo ""

# ---- 10. 404 for Unknown Paths ----
echo "[10] Unknown Paths"

NOT_FOUND=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/nonexistent" \
    -H "Authorization: Bearer $API_KEY")
test_result "Unknown path returns 404" "404" "$NOT_FOUND"

echo ""

# ---- 11. Root Info Endpoint ----
echo "[11] Root Info Endpoint"

ROOT_BODY=$(curl -s "$BASE_URL/" \
    -H "Authorization: Bearer $API_KEY")
test_contains "Root returns brain name" 'Cloud Brain' "$ROOT_BODY"
test_contains "Root returns tool count" '"tools"' "$ROOT_BODY"

echo ""

# --- Summary ---
echo "========================================="
echo "  Results: $PASS/$TOTAL passed"
if [ "$FAIL" -gt 0 ]; then
    echo "  FAILURES: $FAIL"
    echo "========================================="
    exit 1
else
    echo "  All tests passed!"
    echo "========================================="
    exit 0
fi
