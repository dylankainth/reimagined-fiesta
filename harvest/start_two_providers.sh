#!/bin/bash
# Starts two provider instances with isolated storage
NODE=/home/dylan/.nvm/versions/node/v22.22.2/bin/node
REPO=/home/dylan/hackupc-26/harvest

# Clear old storage
rm -rf $REPO/provider/provider-storage-1
rm -rf $REPO/provider/provider-storage-2

# Start provider 1 with storage path override
PROVIDER_STORAGE=$REPO/provider/provider-storage-1 \
  $NODE $REPO/provider/index.mjs > /tmp/prov1.log 2>&1 &
P1=$!
echo "Provider 1 PID: $P1"

sleep 2

# Start provider 2 with storage path override
PROVIDER_STORAGE=$REPO/provider/provider-storage-2 \
  $NODE $REPO/provider/index.mjs > /tmp/prov2.log 2>&1 &
P2=$!
echo "Provider 2 PID: $P2"

echo $P1 > /tmp/harvest_prov1.pid
echo $P2 > /tmp/harvest_prov2.pid
echo ""
echo "Both providers running. Start requester in another terminal:"
echo "  cd $REPO/requester && node index.mjs"
echo ""
echo "To kill provider 1 mid-demo: kill -9 $P1"
echo "  (or: kill -9 \$(cat /tmp/harvest_prov1.pid))"
