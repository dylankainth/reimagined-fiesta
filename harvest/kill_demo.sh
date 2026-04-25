#!/bin/bash
# ═══════════════════════════════════════════════════════════════════
#  Harvest — Kill Switch Demo
#  Demonstrates P2P fault tolerance with automatic double failover
#
#  What you'll see:
#    1. Three provider nodes start on separate storage paths
#    2. Requester connects and jobs are dispatched to best provider
#    3. Provider 1 is killed at epoch ~10 (1/3 through)
#    4. Requester detects disconnect → failover to Provider 2
#    5. Provider 2 is killed at epoch ~10 of its run
#    6. Requester failover to Provider 3
#    7. Job completes on Provider 3
#    8. Summary of the whole run printed
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

# ─── Paths ────────────────────────────────────────────────────────
NODE="/home/dylan/.nvm/versions/node/v22.22.2/bin/node"
HARVEST_DIR="$(cd "$(dirname "$0")" && pwd)"
PROV_DIR="$HARVEST_DIR/provider"
REQ_DIR="$HARVEST_DIR/requester"

PROV_A_LOG="/tmp/harvest-prov-a.log"
PROV_B_LOG="/tmp/harvest-prov-b.log"
PROV_C_LOG="/tmp/harvest-prov-c.log"
REQ_LOG="/tmp/harvest-req.log"

PROV_A_STORE="/tmp/harvest-prov-a-store"
PROV_B_STORE="/tmp/harvest-prov-b-store"
PROV_C_STORE="/tmp/harvest-prov-c-store"
REQ_STORE="/tmp/harvest-req-store"

PROV_A_PID=""
PROV_B_PID=""
PROV_C_PID=""
REQ_PID=""

FAILOVER_COUNT=0
DEMO_START=$(date +%s%3N)  # ms

# ─── Colours ──────────────────────────────────────────────────────
RED='\033[0;31m'
GRN='\033[0;32m'
YLW='\033[1;33m'
CYN='\033[0;36m'
MAG='\033[0;35m'
BLD='\033[1m'
DIM='\033[2m'
NC='\033[0m'

# ─── Helpers ──────────────────────────────────────────────────────
ts()       { date '+%H:%M:%S'; }
elapsed()  { echo $(( ($(date +%s%3N) - DEMO_START) / 1000 )); }

info()     { echo -e "${CYN}[$(ts)]${NC} $*"; }
success()  { echo -e "${GRN}[$(ts)]${NC} ${BLD}$*${NC}"; }
warn()     { echo -e "${YLW}[$(ts)]${NC} $*"; }
drama()    { echo -e "${MAG}[$(ts)]${NC} ${BLD}$*${NC}"; }
kill_msg() {
  echo ""
  echo -e "${RED}╔══════════════════════════════════════════╗${NC}"
  echo -e "${RED}║  [$(ts)]  >>> KILLING $1  <<<  ║${NC}"
  echo -e "${RED}╚══════════════════════════════════════════╝${NC}"
  echo ""
}

# ─── Cleanup ──────────────────────────────────────────────────────
cleanup() {
  echo ""
  info "Cleaning up..."
  [ -n "$PROV_A_PID" ] && kill "$PROV_A_PID" 2>/dev/null || true
  [ -n "$PROV_B_PID" ] && kill "$PROV_B_PID" 2>/dev/null || true
  [ -n "$PROV_C_PID" ] && kill "$PROV_C_PID" 2>/dev/null || true
  [ -n "$REQ_PID"    ] && kill "$REQ_PID"    2>/dev/null || true
  rm -rf "$PROV_A_STORE" "$PROV_B_STORE" "$PROV_C_STORE" "$REQ_STORE"
  info "Done."
}
trap cleanup EXIT

# ─── Wait for pattern in file ─────────────────────────────────────
# Usage: wait_for FILE GREP_PATTERN [TIMEOUT_SECS]
wait_for() {
  local file="$1" pattern="$2" timeout="${3:-90}"
  local elapsed=0
  while ! grep -qP "$pattern" "$file" 2>/dev/null; do
    sleep 1
    elapsed=$((elapsed + 1))
    if [ "$elapsed" -ge "$timeout" ]; then
      echo -e "${RED}[$(ts)] TIMEOUT: waiting for '${pattern}' in ${file}${NC}" >&2
      return 1
    fi
  done
}

# ─── Extract provider ID from log ─────────────────────────────────
get_provider_id() {
  local file="$1"
  grep -oP 'Provider ID: \K[0-9a-f]{16}' "$file" 2>/dev/null | tail -1
}

# ─── Banner ───────────────────────────────────────────────────────
clear
echo -e "${BLD}"
echo "  ██╗  ██╗ █████╗ ██████╗ ██╗   ██╗███████╗███████╗████████╗"
echo "  ██║  ██║██╔══██╗██╔══██╗██║   ██║██╔════╝██╔════╝╚══██╔══╝"
echo "  ███████║███████║██████╔╝██║   ██║█████╗  ███████╗   ██║   "
echo "  ██╔══██║██╔══██║██╔══██╗╚██╗ ██╔╝██╔══╝  ╚════██║   ██║   "
echo "  ██║  ██║██║  ██║██║  ██║ ╚████╔╝ ███████╗███████║   ██║   "
echo "  ╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝  ╚═══╝  ╚══════╝╚══════╝   ╚═╝   "
echo -e "${NC}"
echo -e "${DIM}  P2P Compute Marketplace — Kill Switch Demo${NC}"
echo -e "${DIM}  Double failover: 3 providers, 2 kills, 1 job${NC}"
echo ""
sleep 1

# ─── Step 1: Wipe old storage ─────────────────────────────────────
info "Wiping old demo storage..."
rm -rf "$PROV_A_STORE" "$PROV_B_STORE" "$PROV_C_STORE" "$REQ_STORE"
rm -f  "$PROV_A_LOG" "$PROV_B_LOG" "$PROV_C_LOG" "$REQ_LOG"

# ─── Step 2: Start 3 provider nodes ───────────────────────────────
info "Starting Provider A..."
nohup "$NODE" "$PROV_DIR/index.mjs" --storage "$PROV_A_STORE" \
  > "$PROV_A_LOG" 2>&1 &
PROV_A_PID=$!

info "Starting Provider B..."
nohup "$NODE" "$PROV_DIR/index.mjs" --storage "$PROV_B_STORE" \
  > "$PROV_B_LOG" 2>&1 &
PROV_B_PID=$!

info "Starting Provider C..."
nohup "$NODE" "$PROV_DIR/index.mjs" --storage "$PROV_C_STORE" \
  > "$PROV_C_LOG" 2>&1 &
PROV_C_PID=$!

# Wait for all three to join DHT
info "Waiting for providers to join DHT..."
wait_for "$PROV_A_LOG" "Provider ID:" 30
wait_for "$PROV_B_LOG" "Provider ID:" 30
wait_for "$PROV_C_LOG" "Provider ID:" 30

PROV_A_ID=$(get_provider_id "$PROV_A_LOG")
PROV_B_ID=$(get_provider_id "$PROV_B_LOG")
PROV_C_ID=$(get_provider_id "$PROV_C_LOG")

success "Provider A online: ${PROV_A_ID}"
success "Provider B online: ${PROV_B_ID}"
success "Provider C online: ${PROV_C_ID}"
echo ""

# ─── Step 3: Start requester ──────────────────────────────────────
info "Starting Requester..."
PROVIDER_STORAGE="$REQ_STORE" nohup "$NODE" "$REQ_DIR/index.mjs" \
  > "$REQ_LOG" 2>&1 &
REQ_PID=$!

# Wait for job to be accepted
info "Waiting for job to be accepted by a provider..."
wait_for "$REQ_LOG" "JOB_ACCEPT" 60

# Figure out which provider got the job
ACTIVE_PROV=$(grep -oP 'Provider\s+:\s+\K[0-9a-f]{16}' "$REQ_LOG" 2>/dev/null | tail -1)
if [ -z "$ACTIVE_PROV" ]; then
  ACTIVE_PROV=$(grep -oP 'Submitting job \w+ to \K[0-9a-f]{16}' "$REQ_LOG" 2>/dev/null | tail -1)
fi
echo ""
drama "Job started on provider ${ACTIVE_PROV}"

# Map active provider to PID and log
if   [ "$ACTIVE_PROV" = "$PROV_A_ID" ]; then ACTIVE_PID=$PROV_A_PID; ACTIVE_LOG=$PROV_A_LOG
elif [ "$ACTIVE_PROV" = "$PROV_B_ID" ]; then ACTIVE_PID=$PROV_B_PID; ACTIVE_LOG=$PROV_B_LOG
else                                          ACTIVE_PID=$PROV_C_PID; ACTIVE_LOG=$PROV_C_LOG
fi

# ─── Step 4: Wait for epoch 10 on Provider 1 ─────────────────────
info "Waiting for epoch 10 on ${ACTIVE_PROV}..."
wait_for "$ACTIVE_LOG" '"epoch":\s*10' 60
info "Epoch 10 reached on ${ACTIVE_PROV}. Preparing kill..."
sleep 1

kill_msg "$ACTIVE_PROV"
kill -9 "$ACTIVE_PID" 2>/dev/null || true
FAILOVER_COUNT=$((FAILOVER_COUNT + 1))
KILL1_TS=$(ts)
KILL1_PROV="$ACTIVE_PROV"

# ─── Step 5: Watch requester detect disconnect + failover ─────────
info "Watching for failover detection..."
wait_for "$REQ_LOG" "seeking failover" 30
drama "Failover detected — requester routing to next provider"

wait_for "$REQ_LOG" "Submitting job" 20
FAILOVER2_PROV=$(grep -oP 'Submitting job \w+ to \K[0-9a-f]{16}' "$REQ_LOG" 2>/dev/null | tail -1)
success "Failover 1 complete → routing to ${FAILOVER2_PROV}"
echo ""

# Map second provider
if   [ "$FAILOVER2_PROV" = "$PROV_A_ID" ]; then ACTIVE2_PID=$PROV_A_PID; ACTIVE2_LOG=$PROV_A_LOG
elif [ "$FAILOVER2_PROV" = "$PROV_B_ID" ]; then ACTIVE2_PID=$PROV_B_PID; ACTIVE2_LOG=$PROV_B_LOG
else                                             ACTIVE2_PID=$PROV_C_PID; ACTIVE2_LOG=$PROV_C_LOG
fi

# Wait for second accept
wait_for "$REQ_LOG" "JOB_ACCEPT" 60

# ─── Step 6: Wait for epoch 10 on Provider 2, then kill ──────────
info "Waiting for epoch 10 on ${FAILOVER2_PROV}..."
# The provider log grows with repeated UI, so watch for a new epoch 10 entry
sleep 5  # small buffer before counting new progress lines
wait_for "$ACTIVE2_LOG" '"epoch":\s*10' 60
info "Epoch 10 reached on ${FAILOVER2_PROV}. Preparing kill..."
sleep 1

kill_msg "$FAILOVER2_PROV"
kill -9 "$ACTIVE2_PID" 2>/dev/null || true
FAILOVER_COUNT=$((FAILOVER_COUNT + 1))
KILL2_TS=$(ts)
KILL2_PROV="$FAILOVER2_PROV"

# ─── Step 7: Watch failover to Provider 3 ────────────────────────
info "Watching for second failover detection..."
wait_for "$REQ_LOG" "seeking failover.*\|.*seeking failover" 30 || \
  wait_for "$REQ_LOG" "CHANNEL_PAUSE" 30

# Wait for the third accept
wait_for "$REQ_LOG" "Submitting job" 20
FINAL_PROV=$(grep -oP 'Submitting job \w+ to \K[0-9a-f]{16}' "$REQ_LOG" 2>/dev/null | tail -1)
success "Failover 2 complete → routing to ${FINAL_PROV}"
echo ""

wait_for "$REQ_LOG" "JOB_ACCEPT" 60
drama "Job now running on ${FINAL_PROV} — waiting for completion..."

# ─── Step 8: Wait for JOB_COMPLETE ───────────────────────────────
wait_for "$REQ_LOG" "JOB_COMPLETE\|CHANNEL_CLOSE" 120
wait_for "$REQ_LOG" "totalCost=" 10 || true

TOTAL_COST=$(grep -oP 'totalCost=\$\K[0-9.]+' "$REQ_LOG" 2>/dev/null | tail -1)
TOTAL_PAID=$(grep -oP 'totalPaid=\$\K[0-9.]+' "$REQ_LOG" 2>/dev/null | tail -1)
LOG_KEY=$(grep -oP 'Log key\s+:\s+\K[0-9a-f]+' "$REQ_LOG" 2>/dev/null | tail -1)

DEMO_ELAPSED=$(elapsed)

# ─── Summary ──────────────────────────────────────────────────────
echo ""
echo -e "${BLD}${GRN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BLD}${GRN}║              DEMO COMPLETE — PLAY BY PLAY               ║${NC}"
echo -e "${BLD}${GRN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${CYN}[start    ]${NC} Job dispatched to    ${BLD}${KILL1_PROV}${NC}"
echo -e "  ${RED}[${KILL1_TS}]${NC} ${RED}>>> KILLED provider   ${BLD}${KILL1_PROV}${NC}"
echo -e "  ${YLW}[         ]${NC} Failover detected  → routing to ${BLD}${FAILOVER2_PROV}${NC}"
echo -e "  ${RED}[${KILL2_TS}]${NC} ${RED}>>> KILLED provider   ${BLD}${KILL2_PROV}${NC}"
echo -e "  ${YLW}[         ]${NC} Failover detected  → routing to ${BLD}${FINAL_PROV}${NC}"
echo -e "  ${GRN}[$(ts)   ]${NC} ${GRN}Job COMPLETE on       ${BLD}${FINAL_PROV}${NC}"
echo ""
echo -e "  Failovers    : ${BLD}${FAILOVER_COUNT}${NC} (providers killed mid-job)"
echo -e "  Total cost   : ${BLD}\$${TOTAL_COST:-???} USDT${NC}"
echo -e "  Total paid   : ${BLD}\$${TOTAL_PAID:-???} USDT${NC}"
echo -e "  Demo runtime : ${BLD}${DEMO_ELAPSED}s${NC}"
[ -n "$LOG_KEY" ] && \
echo -e "  Log key      : ${DIM}${LOG_KEY:0:32}…${NC}"
echo ""
echo -e "${DIM}  Tamper-evident execution log on Hypercore — immutable, verifiable${NC}"
echo ""
