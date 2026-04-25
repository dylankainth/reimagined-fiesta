/** @typedef {import('pear-interface')} */ /* global Pear */
import { spawn } from 'child_process'
import { createServer } from 'http'
import { fileURLToPath } from 'url'
import { join, dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const providerPath = join(__dirname, '../provider/index.mjs')

let currentState = {
  providerId: null,
  uptime: '0s',
  peers: 0,
  totalEarned: 0,
  capacity: { cores: 4, ramGB: 8, maxJobs: 3 },
  activeJobs: [],
  recentLog: ['Starting provider…'],
  logKey: null,
  completedJobs: 0,
}

// Resolve node binary
const nodeBin = process.env.NVM_BIN
  ? join(process.env.NVM_BIN, 'node')
  : 'node'

const proc = spawn(nodeBin, [providerPath], {
  env: { ...process.env, PEAR_STATE_PIPE: '1' },
  stdio: ['ignore', 'pipe', 'inherit'],
  cwd: join(__dirname, '../provider'),
})

let buf = ''
proc.stdout.on('data', (chunk) => {
  buf += chunk.toString()
  const lines = buf.split('\n')
  buf = lines.pop()
  for (const line of lines) {
    if (!line.trim()) continue
    try { currentState = JSON.parse(line) } catch {}
  }
})

proc.on('error', (err) => console.error('Provider spawn error:', err.message))
proc.on('exit', (code) => console.log('Provider exited:', code))

// SSE server — renderer polls this
const SSE_PORT = 4321
const server = createServer((req, res) => {
  if (req.url !== '/state') { res.writeHead(404); res.end(); return }
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*',
  })
  const send = () => {
    try { res.write(`data: ${JSON.stringify(currentState)}\n\n`) } catch {}
  }
  send()
  const id = setInterval(send, 1000)
  req.on('close', () => clearInterval(id))
})
server.listen(SSE_PORT, '127.0.0.1')

// Also push via Pear.pipe if desktop IPC is available
if (globalThis.Pear?.pipe) {
  setInterval(() => {
    try {
      Pear.pipe.write(JSON.stringify({ type: 'state', data: currentState }) + '\n')
    } catch {}
  }, 1000)
}

const cleanup = () => { proc.kill('SIGTERM'); server.close() }
if (globalThis.Pear) Pear.teardown(cleanup)
else process.on('exit', cleanup)
