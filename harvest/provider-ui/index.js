/** @typedef {import('pear-interface')} */ /* global Pear */
import { spawn } from 'child_process'
import { join } from 'path'

const procGlobal = globalThis.process
const appDir = globalThis.Pear?.config?.dir ?? procGlobal?.cwd?.() ?? '.'
const providerPath = join(appDir, '../provider/index.mjs')
const providerStorage = join(appDir, '../provider/provider-ui-storage')

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
const nodeBin = procGlobal?.env?.NVM_BIN
  ? join(procGlobal.env.NVM_BIN, 'node')
  : procGlobal?.execPath ?? 'node'

const proc = spawn(nodeBin, [providerPath], {
  env: {
    ...(procGlobal?.env ?? {}),
    PEAR_STATE_PIPE: '1',
    PROVIDER_STORAGE: providerStorage,
  },
  stdio: ['ignore', 'pipe', 'inherit'],
  cwd: join(appDir, '../provider'),
})

let buf = ''
proc.stdout.on('data', (chunk) => {
  buf += chunk.toString()
  const lines = buf.split('\n')
  buf = lines.pop()
  for (const line of lines) {
    if (!line.trim()) continue
    try { currentState = JSON.parse(line) } catch { }
  }
})

proc.on('error', (err) => console.error('Provider spawn error:', err.message))
proc.on('exit', (code) => console.log('Provider exited:', code))

// Push state updates via Pear.pipe to the desktop window
if (globalThis.Pear?.pipe) {
  setInterval(() => {
    try {
      Pear.pipe.write(JSON.stringify({ type: 'state', data: currentState }) + '\n')
    } catch { }
  }, 1000)
}

const cleanup = () => { proc.kill('SIGTERM') }
if (globalThis.Pear) Pear.teardown(cleanup)
else procGlobal?.on?.('exit', cleanup)
