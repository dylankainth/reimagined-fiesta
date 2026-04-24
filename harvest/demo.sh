#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Harvest — demo script
# Run this from the repo root: bash demo.sh
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; CYAN='\033[0;36m'
YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'

header() { echo -e "\n${BOLD}${CYAN}══════════════════════════════════════${NC}"; \
           echo -e "${BOLD}${CYAN}  $1${NC}"; \
           echo -e "${BOLD}${CYAN}══════════════════════════════════════${NC}"; }

# ── Pre-flight checks ─────────────────────────────────────────────────────────
header "HARVEST — Peer-to-Peer Compute Marketplace"

echo -e "${YELLOW}Checking dependencies…${NC}"

# Node.js >= 18 required (for optional chaining, top-level await in ESM)
if command -v node &>/dev/null; then
  NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
  if [ "$NODE_VER" -lt 18 ]; then
    echo -e "${YELLOW}! Node $(node -v) too old — need >= 18${NC}"
    echo "  If you have nvm: nvm use 22"
    if [ -s "$HOME/.nvm/nvm.sh" ]; then
      echo -e "${YELLOW}  Loading nvm…${NC}"
      export NVM_DIR="$HOME/.nvm"
      . "$NVM_DIR/nvm.sh"
      nvm use 22 2>/dev/null || nvm install 22
    fi
  fi
fi
echo -e "${GREEN}✓ node $(node -v)${NC}"

if ! command -v python3 &>/dev/null; then
  echo -e "${RED}✗ python3 not found — required for job subprocess${NC}"
  exit 1
fi
echo -e "${GREEN}✓ python3 $(python3 --version 2>&1)${NC}"

# ── Install npm deps if needed ────────────────────────────────────────────────
for dir in provider requester; do
  if [ ! -d "$REPO_DIR/$dir/node_modules" ]; then
    echo -e "${YELLOW}Installing deps in $dir/…${NC}"
    (cd "$REPO_DIR/$dir" && npm install --silent)
    echo -e "${GREEN}✓ $dir deps installed${NC}"
  fi
done

# ── Print run instructions ────────────────────────────────────────────────────
header "HOW TO RUN"

echo ""
echo "Open TWO terminal windows/tabs, then run:"
echo ""
echo -e "  ${GREEN}Terminal 1 — Provider:${NC}"
echo -e "  ${BOLD}  cd $REPO_DIR/provider && node index.mjs${NC}"
echo ""
echo -e "  ${YELLOW}Terminal 2 — Requester:${NC}"
echo -e "  ${BOLD}  cd $REPO_DIR/requester && node index.mjs${NC}"
echo ""
echo -e "  ${CYAN}Pear runtime (alternative):${NC}"
echo -e "  ${BOLD}  cd $REPO_DIR/provider && pear run --dev .${NC}"
echo -e "  ${BOLD}  cd $REPO_DIR/requester && pear run --dev .${NC}"
echo ""
echo "  The requester discovers the provider via Hyperswarm DHT within ~10 s,"
echo "  submits the MNIST training job, and streams epoch/loss/accuracy output."
echo ""
echo "  Payment ticks appear every 10 s on the provider console."
echo "  Heartbeats appear every  5 s on the requester console."
echo "  On completion, the requester prints the Hyperbee log key for"
echo "  tamper-evident proof of execution."
echo ""

# ── Kill test instructions ────────────────────────────────────────────────────
header "KILL TEST — Simulate Provider Failure"

echo ""
echo "  While a job is running, kill the provider with Ctrl-C (or kill the process)."
echo "  The requester detects the disconnection immediately and stops payments:"
echo ""
echo -e "  ${RED}  ⚠  Provider disconnected mid-job — stopping payments${NC}"
echo ""
echo "  If the connection stalls (network partition), the watchdog triggers"
echo "  after 25 s of heartbeat silence:"
echo ""
echo -e "  ${RED}  ⚠  WATCHDOG: no heartbeat for Xs — pausing payments!${NC}"
echo ""
echo "  NOTE: The demo job completes in ~5 s, so kill the provider within"
echo "  2-3 seconds of seeing 'Accepted' in the provider terminal."
echo ""

# ── Auto-launch ──────────────────────────────────────────────────────────────
header "AUTO-LAUNCH (optional)"

echo ""
echo "  To auto-launch both nodes in this terminal (interleaved output):"
echo ""
echo -e "  ${BOLD}  cd $REPO_DIR/provider && node index.mjs &${NC}"
echo -e "  ${BOLD}  sleep 3${NC}"
echo -e "  ${BOLD}  cd $REPO_DIR/requester && node index.mjs${NC}"
echo ""
echo "  (Recommended: use two separate terminals for clean UI.)"
echo ""
