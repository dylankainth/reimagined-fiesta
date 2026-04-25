# Harvest — Claude Code Guide

Harvest is a peer-to-peer compute marketplace built on the Pear protocol
(Holepunch). Providers sell idle CPU/RAM. Requesters buy compute jobs.
USDT payments stream over Lightning per payment interval. No central server
exists at any layer — discovery, execution logging, and payment are all P2P.

---

## Architecture

```
Requester                        Provider
─────────────────                ─────────────────────────
Hyperswarm DHT  ←── topic ──→   Hyperswarm DHT
     │                                │
     │  JOB_REQUEST                   │
     │ ─────────────────────────────→ │
     │  JOB_ACCEPT                    │  spawn python3 subprocess
     │ ←───────────────────────────── │  (nsjail sandbox)
     │                                │
     │  PAYMENT_TICK (every 10s)      │  HEARTBEAT (every 5s)
     │ ─────────────────────────────→ │ ←─────────────────────
     │ ←───────────────────────────── │  append to Hyperbee log
     │                                │
     │  JOB_COMPLETE + logKey         │
     │ ←───────────────────────────── │
     │                                │
Verify log at logKey            Hyperbee (tamper-evident
(independent of provider)       proof of execution)
```

DHT topic is derived from the constant `HARVEST_TOPIC` via `crypto.hash()`.
All peers who know this string find each other — no bootstrap server needed.

---

## File map

```
harvest/
├── shared/
│   └── protocol.js          Message types, job statuses, timing constants.
│                            Every other file imports from here. Touch last.
│
├── provider/
│   ├── index.mjs            Provider node. Advertises capacity, accepts jobs,
│   │                        spawns Python subprocess, sends heartbeats,
│   │                        logs to Hyperbee, receives USDT payment ticks.
│   └── index.js             Symlink copy of index.mjs (Pear compat).
│
├── requester/
│   ├── index.mjs            Requester node. Scans providers, scores them,
│   │                        submits jobs, streams payments, watchdog timer,
│   │                        handles failover when provider drops.
│   └── index.js             Symlink copy of index.mjs (Pear compat).
│
├── provider-ui/             Pear Desktop app — provider dashboard window.
│   ├── package.json         type: desktop
│   ├── index.js             IPC bridge — runs backend, pushes state to HTML.
│   └── index.html           Live dashboard UI (dark theme, green accents).
│
├── requester-ui/            Pear Desktop app — requester dashboard window.
│   ├── package.json         type: desktop
│   ├── index.js             IPC bridge — runs backend, pushes state to HTML.
│   └── index.html           Job progress, payment ticker, provider market.
│
├── demo.sh                  Instructions for running provider + requester.
├── kill_demo.sh             Automated double-failover demo script.
│                            Starts 3 providers, kills them sequentially,
│                            prints timestamped play-by-play of failover.
├── start_two_providers.sh   Starts 2 provider instances with isolated
│                            storage paths for failover testing.
├── README.md                Project overview, quickstart, ASCII architecture.
├── pitch.md                 5-slide 3-minute pitch deck in markdown.
└── .gitignore               Ignores node_modules/, *-storage/ dirs.
```

---

## Shared protocol

`shared/protocol.js` is the contract between all nodes. Never modify it
without telling the whole team — everyone imports from it.

### MSG types

| Constant        | Direction            | Purpose                                       |
| --------------- | -------------------- | --------------------------------------------- |
| `ADVERTISE`     | provider → swarm     | Capacity + price broadcast                    |
| `JOB_REQUEST`   | requester → provider | Submit a job                                  |
| `JOB_ACCEPT`    | provider → requester | Confirmed + estimated cost                    |
| `JOB_REJECT`    | provider → requester | Too busy / budget mismatch / unsupported type |
| `HEARTBEAT`     | provider → requester | Signed proof of liveness every 5s             |
| `JOB_COMPLETE`  | provider → requester | Done + output + Hyperbee log key              |
| `JOB_FAILED`    | provider → requester | Failed + reason                               |
| `PAYMENT_TICK`  | requester → provider | USDT payment for this interval                |
| `CANCEL_JOB`    | requester → provider | Stop the job                                  |
| `CHANNEL_OPEN`  | requester → provider | Payment channel opening                       |
| `CHANNEL_PAUSE` | requester → provider | Paused — watchdog or disconnect               |
| `CHANNEL_CLOSE` | requester → provider | Final settlement                              |

### JOB_STATUS values

`pending` `matched` `running` `complete` `failed` `cancelled`

### Key constants

```js
HEARTBEAT_INTERVAL = 5_000; // ms — provider sends heartbeat
PAYMENT_INTERVAL = 10_000; // ms — requester sends payment tick
HARVEST_TOPIC = "harvest-compute-marketplace-v1";
```

---

## Run commands

### With Node directly (development)

```bash
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 22

# Terminal 1 — provider
cd provider && node index.mjs

# Terminal 2 — requester (wait ~5s)
cd requester && node index.mjs
```

### With Pear runtime (production)

```bash
cd provider && pear run --dev .
cd requester && pear run --dev .
```

### Desktop UI

```bash
cd provider-ui && pear run --dev .
cd requester-ui && pear run --dev .
```

### Two providers for failover demo

```bash
./start_two_providers.sh
# then in another terminal:
cd requester && node index.mjs
# kill provider 1 at epoch 10:
kill -9 $(cat /tmp/harvest_prov1.pid)
```

### Automated kill demo

```bash
./kill_demo.sh
```

---

## Environment

- **OS**: WSL2 Ubuntu on Windows
- **Node**: v22 via nvm — always run `nvm use 22` first
- **Python**: python3 required for job subprocess simulation
- **nsjail**: `sudo apt-get install nsjail` — used for job sandboxing
- **Storage**: each node creates its own `*-storage/` dir (gitignored)
- **Pear**: `npm install -g pear` — run `pear --version` to verify

---

## Key implementation details

### Provider scoring (requester side)

```js
score = (1 / pricePerCorePerMin) * (1 + completedJobs * 0.1) * availableSlots;
```

Higher score = cheaper + more reputable + more capacity available.

### Heartbeat watchdog

Requester expects a heartbeat every `HEARTBEAT_INTERVAL` (5s).
If no heartbeat for `2.5 × PAYMENT_INTERVAL` (25s):

- Payment stream pauses
- `CHANNEL_PAUSE` sent to provider
- Failover attempted to next provider in market

### Failover

When provider TCP connection drops (`conn.on('close')`):

- Payment timer cleared immediately
- `CHANNEL_PAUSE` logged
- Dead provider removed from `providers` Map
- `findAndSubmitJob()` called with same job config
- Picks next highest-scoring provider from market

### Hyperbee job log

Provider appends to Hyperbee at these keys:

```
job:{id}:start              — job accepted, task metadata
job:{id}:heartbeat:{n}      — each heartbeat (cpu%, mem%, timestamp)
job:{id}:complete           — final result + totalCost
job:{id}:channel:{event}    — OPEN / PAUSE / CLOSE with amount
```

The log's public key (`logKey`) is sent to requester at completion.
Anyone with the key can replay the entire execution history.

### Job types + pricing multipliers

```
ml-training   1.0×   epoch/loss/accuracy loop
rendering     1.2×   frame/render_time loop
data-process  0.8×   rows_processed/anomalies loop
compression   0.6×   mb_processed/ratio loop
```

### Python subprocess (30s demo job)

```python
for epoch in range(30):
    # compute fake metrics
    print(json.dumps({"epoch": epoch+1, "total": 30, "loss": ..., "accuracy": ...}))
    time.sleep(1)
```

30 epochs × 1s = 30s window to kill provider mid-job during demo.

---

## What is and isn't production-ready

| Feature          | Status     | Notes                               |
| ---------------- | ---------- | ----------------------------------- |
| P2P discovery    | Production | Hyperswarm DHT, real                |
| Job logging      | Production | Hyperbee, tamper-evident            |
| Heartbeat proof  | Production | Signed appends                      |
| Job sandboxing   | Production | nsjail namespaces + seccomp         |
| Payment stream   | Stubbed    | Signed messages, not real Lightning |
| Lightning USDT   | Roadmap    | LNBits / Breez SDK integration      |
| Pear Desktop UI  | Built      | pear run --dev .                    |
| Failover routing | Built      | Automatic on TCP disconnect         |

---

## Common issues

**DHT discovery slow or stuck at 0 peers**
WSL2 NAT can delay public DHT bootstrap. Wait 20-30s before assuming broken.
Both processes must be running for discovery to work.

**`node: command not found` or wrong version**
Run `nvm use 22` first. Add to `~/.bashrc` to make it permanent:

```bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
nvm use 22 --silent
```

**Job finishes before you can kill provider**
The demo job runs 30 epochs × 1s. Kill provider between epoch 8-20
for the most dramatic demo moment.

**`pear run --dev .` fails**
Make sure `package.json` has `"pear": { "name": "...", "type": "terminal" }`
and all imports use `bare-*` equivalents not Node built-ins.

**Storage conflicts between runs**

```bash
rm -rf provider/provider-storage requester/requester-storage
```

---

## Team

| Person           | Owns                                                                  |
| ---------------- | --------------------------------------------------------------------- |
| Person 1 (Dylan) | shared/protocol.js, Hyperswarm layer, Corestore/Hyperbee, integration |
| Person 2         | provider/index.mjs — job types, reputation, dashboard                 |
| Person 3         | requester/index.mjs — failover, scoring, progress UI                  |
| Person 4         | payments, kill_demo.sh, README, pitch deck                            |

---

## The pitch (30 seconds)

> "AWS made $91 billion last year renting computers.
> Every dollar is friction between people who have spare compute
> and people who need it. Harvest removes the friction.
> Pear connects the peers. USDT settles the payment.
> No AWS. No account. No invoice.
> Just compute, flowing peer to peer."
