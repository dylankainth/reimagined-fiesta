# Harvest — 3-Minute Pitch

---

## Slide 1 — The Hook

# AWS made $91 billion last year renting computers.

They own no hardware.  
They write no models.  
They just sit between you and your compute — and take 60 cents of every dollar.

**What if the computers just talked to each other directly?**

---

## Slide 2 — The Solution

```
  Your laptop                              Their server
  (idle 22h/day)                           (needs GPU)

       │                                        │
       │         Hyperswarm DHT                 │
       │    (no server, no account)             │
       │                                        │
       └────────── direct P2P ─────────────────►│
                   pay-as-you-go
                   USDT every 10s
                   fail-safe failover
```

**Harvest is a P2P compute marketplace.**  
Idle machines earn. Builders compute. No cloud in the middle.

- Provider advertises capacity on a DHT topic
- Requester scores providers, dispatches job to best match
- Payment streams in real-time — you pay only for what runs
- If a provider dies, the requester fails over automatically in < 30s

---

## Slide 3 — The Live Demo

**What judges will see:**

1. Three terminal windows open. Three provider nodes join the DHT.
2. Requester connects, scores providers, dispatches an ML training job.
3. Live output streams: `epoch: 15/30  loss: 0.041  accuracy: 0.96`
4. We kill Provider 1 — **live, on screen, with `kill -9`**
5. Requester: `⚠ Provider a3f8b2c1 disconnected — seeking failover...`
6. Job resumes on Provider 2 from where it left off.
7. We kill Provider 2.
8. Job completes on Provider 3.
9. Terminal prints: `Total cost: $0.002400 USDT across 3 providers`
10. Hypercore log key printed — anyone can verify the execution history.

**The whole thing runs on localhost. No cloud touched. No account needed.**

---

## Slide 4 — The Tech

| What | Why |
|---|---|
| **Hyperswarm** | DHT with built-in hole-punching. Peers find each other globally with no server, no signalling, no registration. |
| **Protomux** | Typed multiplexed channels over a raw socket. One connection = many message types, zero overhead. |
| **Hypercore** | Append-only log, cryptographically signed by the writer. Every job produces a tamper-evident receipt anyone can verify with just a public key. |
| **Hyperbee** | B-tree on Hypercore. Provider stats and payment history persist locally and are auditable. |
| **Pear runtime** | Local-first app model. Harvest runs without a browser, without a server, without any cloud dependency whatsoever. |
| **USDT** | Stable payment. No volatility between job start and job end. Streaming settlement — provider earns as the job runs, not after. |

**Why not just use AWS Lambda?**  
Because every abstraction layer you add is margin someone else extracts. Harvest has no layers.

---

## Slide 5 — The Ask

**What we've built in 24 hours:**
- [x] Full P2P job marketplace (provider + requester)
- [x] Live payment streaming with CHANNEL_OPEN / PAUSE / CLOSE lifecycle
- [x] Automatic double-failover with deterministic scoring
- [x] Tamper-evident Hypercore execution log
- [x] 4 job types: ML training, 3D rendering, data pipelines, compression
- [x] Kill-switch demo script — runs the full double failover automatically

**What we want from judges:**

> **From Holepunch:** Is Hyperswarm the right substrate for a marketplace with 10,000 providers? What's the DHT lookup latency at scale? Would you back a production version?

> **From everyone:** Is the payment channel model (streaming USDT ticks + CHANNEL_CLOSE settlement) sound enough for a real launch? What's the one thing that would make you actually use this?

**The vision:**  
Every GPU sitting idle is a node on the network. Every model training run pays directly to the machine running it. AWS's 60% margin returns to the people who own the hardware.

*AWS has a data centre. We have everyone else's laptop.*

---

*Built at HackUPC 2025 — 24 hours, one P2P stack, zero cloud.*
