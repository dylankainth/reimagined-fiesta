# Harvest

> AWS made $91 billion last year renting computers.  
> Every cent of margin is a tax on builders.  
> Harvest cuts out the cloud.

---

## What it is

Harvest is a peer-to-peer compute marketplace. Idle machines rent their CPU and RAM directly to whoever needs it — no cloud provider, no account, no invoice, no lock-in. Payments stream in real time over a cryptographic payment channel. If a provider dies mid-job, the requester automatically fails over to the next best machine. The whole run is logged on an append-only, tamper-evident Hypercore — verifiable forever.

## The problem it solves

| Cloud (AWS/GCP/Azure) | Harvest |
|---|---|
| 60%+ gross margins | Market-rate pricing |
| Account required | Keypair only |
| Region lock-in | Global DHT mesh |
| Opaque billing | On-chain payment log |
| Single point of failure | Automatic failover |
| Centralised trust | Cryptographic proof |

AWS EC2 alone generated $91B in 2023. That margin is extracted from developers. Harvest routes it back to the machines doing the actual work.

## How it works

- **Providers** advertise capacity (cores, RAM, price) on a Hyperswarm DHT topic
- **Requesters** score providers by price × reputation × availability and submit jobs to the best match
- **Payments** stream every 10 seconds as signed `PAYMENT_TICK` messages — pay only for what runs
- **Failover** is automatic: if a provider dies, the requester re-routes to the next best node in under 30 seconds, carrying the accumulated spend with it

## Tech stack

| Layer | Technology | Why |
|---|---|---|
| P2P networking | [Hyperswarm](https://github.com/holepunchto/hyperswarm) | DHT hole-punching, no servers |
| Multiplexing | [Protomux](https://github.com/mafintosh/protomux) | Typed channels over a raw socket |
| Execution log | [Hypercore](https://github.com/holepunchto/hypercore) | Append-only, cryptographically signed, shareable by public key |
| Persistence | [Hyperbee](https://github.com/holepunchto/hyperbee) | B-tree on Hypercore for provider stats and job receipts |
| Payments | USDT (stub → on-chain) | Stablecoin, no volatility during a job run |
| Runtime | [Pear](https://docs.pears.com) | Local-first app runtime, works without a browser |

## Quick start

```bash
# Terminal 1 — run a provider node (earn USDT)
cd provider && node index.mjs

# Terminal 2 — submit a compute job (spend USDT)
cd requester && node index.mjs --type ml-training --cores 2 --ram 4 --budget 0.05

# Watch the payment stream, live progress, and heartbeat on screen
```

Or run the full kill-switch demo (double failover, automated):

```bash
./kill_demo.sh
```

## The demo

What you'll see when you run `kill_demo.sh`:

1. Three provider nodes start, each advertising capacity on the DHT
2. The requester connects, scores all providers, and dispatches an ML training job to the best one
3. Live progress streams: epoch, loss, accuracy — one line per second
4. **Kill 1** — Provider 1 is killed at epoch 10. The requester detects the disconnect within 25 seconds (watchdog), logs `CHANNEL_PAUSE`, and re-routes to Provider 2
5. **Kill 2** — Provider 2 is killed at epoch 10 of *its* run. Same failover fires again, job lands on Provider 3
6. Provider 3 runs to epoch 30. `JOB_COMPLETE` fires. The requester sends `CHANNEL_CLOSE` with the final total
7. The terminal prints a full play-by-play: which providers were killed, at what time, total cost, and the Hypercore log key for verification

## Architecture

```
  ┌─────────────────────────────────────────────────────────────────┐
  │                    Hyperswarm DHT (global)                      │
  │   topic: sha256("harvest-compute-marketplace-v1")               │
  └──────────────────────┬──────────────────────────────────────────┘
                         │  hole-punched P2P connections
          ┌──────────────┼──────────────┐
          │              │              │
   ┌──────▼──────┐ ┌─────▼──────┐ ┌────▼────────┐
   │ Provider A  │ │ Provider B │ │ Provider C  │
   │ 4c · 8GB   │ │ 4c · 8GB   │ │ 4c · 8GB    │
   │ $0.001/min │ │ $0.001/min │ │ $0.001/min  │
   │ rep: 12    │ │ rep: 3     │ │ rep: 0      │
   └──────┬──────┘ └─────┬──────┘ └────┬────────┘
          │  Protomux     │              │
          │  channels     │              │
          └──────────┬────┘──────────────┘
                     │
              ┌──────▼──────────────────────┐
              │       Requester Node        │
              │                             │
              │  score()  →  best provider  │
              │  PAYMENT_TICK every 10s     │
              │  CHANNEL_OPEN/PAUSE/CLOSE   │
              │  watchdog (25s silence)     │
              │  failedPeers set            │
              └──────────┬──────────────────┘
                         │
              ┌──────────▼──────────────────┐
              │   Hypercore job log         │
              │   (tamper-evident, public)  │
              │   key: sha256(job receipts) │
              └─────────────────────────────┘
```

### Message flow (happy path)

```
Requester                                          Provider
    │                                                  │
    │──── ADVERTISE ←──────────────────────────────────│  on connect
    │──── JOB_REQUEST ────────────────────────────────►│
    │◄─── JOB_ACCEPT ──────────────────────────────────│
    │──── CHANNEL_OPEN ───────────────────────────────►│
    │◄─── HEARTBEAT (every 5s) ────────────────────────│
    │◄─── JOB_PROGRESS (every epoch) ─────────────────│
    │──── PAYMENT_TICK (every 10s) ───────────────────►│
    │──── PAYMENT_TICK ───────────────────────────────►│
    │◄─── JOB_COMPLETE ────────────────────────────────│
    │──── CHANNEL_CLOSE ──────────────────────────────►│
```

### Failover path

```
Requester                         Dead Provider      New Provider
    │                                  │                  │
    │   [provider killed]              │                  │
    │◄═══ connection dropped ══════════╡                  │
    │   watchdog: 25s silence          │                  │
    │   CHANNEL_PAUSE logged           │                  │
    │   failedPeers.add(deadId)        │                  │
    │   findAndSubmitJob()             │                  │
    │──── JOB_REQUEST ────────────────────────────────►  │
    │◄─── JOB_ACCEPT ─────────────────────────────────   │
    │──── CHANNEL_OPEN ───────────────────────────────►  │
    │   (payment resumes)              │                  │
```

## Job types supported

| Type | Multiplier | Simulation |
|---|---|---|
| `ml-training` | 1.0× | epoch / loss / accuracy |
| `rendering` | 1.2× | frame / render_time / ray_count |
| `data-process` | 0.8× | batch / rows / anomalies |
| `compression` | 0.6× | chunk / MB_in / ratio |

## Requester CLI flags

```bash
node index.mjs \
  --type ml-training   \  # job type (see above)
  --cores 2            \  # vCPUs required
  --ram 4              \  # GB RAM required
  --budget 0.05        \  # max USDT to spend
  --minutes 1             # estimated runtime
```

## Provider storage isolation

Run multiple providers on one machine:

```bash
node index.mjs --storage ./node-a-storage --cores 4 --price 0.001
node index.mjs --storage ./node-b-storage --cores 2 --price 0.0008
```

## Team

Built at HackUPC 2025 in 24 hours.

## Built at HackUPC 2025

> *"No cloud. No account. No invoice."*
