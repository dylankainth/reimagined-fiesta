/** @typedef {import('pear-interface')} */ /* global Pear */
import { spawn } from 'child_process'
import { createServer } from 'http'
import { join } from 'path'

const isPear = Boolean(globalThis.Pear)
const procGlobal = globalThis.process
const appDir = globalThis.Pear?.config?.dir ?? procGlobal?.cwd?.() ?? '.'
const requesterPath = join(appDir, '../requester/index.mjs')

let currentState = {
  requesterId: null,
  budget: 0.05,
  providers: [],
  activeJob: null,
  recentLog: ['Starting requester…'],
  jobComplete: null,
  jobStatus: 'pending',
}

const nodeBin = !isPear && procGlobal?.env?.NVM_BIN
  ? join(procGlobal.env.NVM_BIN, 'node')
  : 'node'

const proc = spawn(nodeBin, [requesterPath], {
  env: procGlobal?.env ? { ...procGlobal.env, PEAR_STATE_PIPE: '1' } : undefined,
  stdio: ['ignore', 'pipe', 'inherit'],
  cwd: join(appDir, '../requester'),
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

proc.on('error', (err) => console.error('Requester spawn error:', err.message))
proc.on('exit', (code) => console.log('Requester exited:', code))

const SSE_PORT = 4322
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

if (globalThis.Pear?.pipe) {
  setInterval(() => {
    try {
      Pear.pipe.write(JSON.stringify({ type: 'state', data: currentState }) + '\n')
    } catch {}
  }, 1000)
}

const cleanup = () => { proc.kill('SIGTERM'); server.close() }
if (globalThis.Pear) Pear.teardown(cleanup)
else procGlobal?.on?.('exit', cleanup)
