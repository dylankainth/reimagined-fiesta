#!/bin/bash

# Get nvm node binary
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22 --silent

NODE=$(which node)
REPO=$(cd "$(dirname "$0")" && pwd)

echo "Using Node: $NODE"
echo "Repo: $REPO"

# Clean up old storage
rm -rf "$REPO/provider/provider-storage-1"
rm -rf "$REPO/provider/provider-storage-2"

# Start Provider 1
PROVIDER_STORAGE="$REPO/provider/provider-storage-1" \
  "$NODE" "$REPO/provider/index.mjs" > /tmp/prov1.log 2>&1 &
PID1=$!
echo $PID1 > /tmp/harvest_prov1.pid
echo "Provider 1 started (PID: $PID1)"

sleep 3

# Start Provider 2
PROVIDER_STORAGE="$REPO/provider/provider-storage-2" \
  "$NODE" "$REPO/provider/index.mjs" > /tmp/prov2.log 2>&1 &
PID2=$!
echo $PID2 > /tmp/harvest_prov2.pid
echo "Provider 2 started (PID: $PID2)"

echo ""
echo "Both providers running."
echo ""
echo "To kill Provider 1:  kill -9 $(cat /tmp/harvest_prov1.pid)"
echo "To kill Provider 2:  kill -9 $(cat /tmp/harvest_prov2.pid)"
echo ""
echo "Provider 1 logs: tail -f /tmp/prov1.log"
echo "Provider 2 logs: tail -f /tmp/prov2.log"
