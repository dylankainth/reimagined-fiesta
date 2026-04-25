const { spawn } = require('child_process')
const { join } = require('path')

// Global states
let providerState = {
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

let requesterState = {
    requesterId: null,
    budget: 0.05,
    providers: [],
    activeJob: null,
    recentLog: ['Starting requester…'],
    jobComplete: null,
    jobStatus: 'pending',
}

// Tab switching
function switchTab(tab) {
    // Update tab buttons
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'))
    event.target.classList.add('active')

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'))
    document.getElementById(`${tab}-tab`).classList.add('active')
}

// Provider functions
function typeBadge(type) {
    const map = {
        'ml-training': ['ML-TRAIN', 'badge-ml'],
        'rendering': ['RENDER', 'badge-render'],
        'data-process': ['DATA', 'badge-data'],
        'compression': ['COMPRESS', 'badge-comp'],
    }
    const [label, cls] = map[type] ?? [type.toUpperCase(), 'badge-comp']
    return `<span class="type-badge ${cls}">${label}</span>`
}

function logClass(line) {
    if (line.includes('JOB_COMPLETE') || line.includes('COMPLETE')) return 'complete'
    if (line.includes('PAYMENT') || line.includes('CHANNEL')) return 'payment'
    if (line.includes('HB #')) return 'hb'
    if (line.includes('err') || line.includes('ERR') || line.includes('Failed')) return 'error'
    return ''
}

function escHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderProviderState(s) {
    if (!s) return

    // Update provider UI
    const $ = id => document.getElementById(id)

    $('provider-id').textContent = s.providerId ? s.providerId.slice(0, 16) + '…' : 'loading…'
    $('provider-uptime').textContent = s.uptime ?? '0s'
    $('provider-peers').textContent = s.peers ?? 0

    // Earned
    const earned = s.totalEarned ?? 0
    const earnEl = $('provider-earned')
    earnEl.textContent = '$' + earned.toFixed(6)

    const maxJobs = s.capacity?.maxJobs ?? 3
    $('provider-active-jobs').textContent = `${(s.activeJobs ?? []).length} / ${maxJobs}`
    $('provider-completed-jobs').textContent = `${s.completedJobs ?? 0} completed`

    // Jobs
    const jobs = s.activeJobs ?? []
    const container = $('provider-jobs-container')
    if (jobs.length === 0) {
        container.innerHTML = '<div class="no-jobs">○&nbsp; Waiting for work…</div>'
    } else {
        container.innerHTML = jobs.map(job => {
            const elapsed = job.startedAt ? (Date.now() - job.startedAt) / 1000 : 0
            const epoch = Math.min(Math.round(elapsed), 30)
            const pct = Math.round((epoch / 30) * 100)
            return `
      <div class="job-card">
        <div class="job-header">
          ${typeBadge(job.type)}
          <span class="job-id">${job.jobId.slice(0, 16)}…</span>
          <span class="job-earned">$${(job.paymentReceived || 0).toFixed(6)}</span>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width:${pct}%"></div>
        </div>
        <div class="job-footer">
          <span class="job-epoch">epoch ${epoch} / 30&nbsp;·&nbsp;${pct}%</span>
          <span class="hb-indicator">
            <span class="hb-dot"></span>
            HB #${job.heartbeatCount}
          </span>
        </div>
      </div>`
        }).join('')
    }

    // Log
    const lines = (s.recentLog ?? []).slice().reverse()
    $('provider-log-lines').innerHTML = lines.map(l =>
        `<div class="log-line ${logClass(l)}">${escHtml(l)}</div>`
    ).join('')

    // Footer
    if (s.logKey) $('provider-logkey').textContent = 'logKey: ' + s.logKey.slice(0, 24) + '…'
    $('provider-last-update').textContent = 'updated ' + new Date().toISOString().slice(11, 19)
}

function renderRequesterState(s) {
    if (!s) return

    const $ = id => document.getElementById(id)

    $('requester-id').textContent = s.requesterId ? s.requesterId.slice(0, 16) + '…' : 'loading…'
    $('requester-budget').textContent = '$' + (s.budget ?? 0.05).toFixed(4)

    // Job status
    const jobInner = $('requester-job-inner')
    if (s.activeJob) {
        jobInner.innerHTML = `
      <div style="font-family:var(--mono);font-size:13px;color:var(--green);">
        Active Job: ${s.activeJob.jobId?.slice(0, 16) || 'Unknown'}…
      </div>
      <div style="font-family:var(--mono);font-size:12px;color:var(--dim);margin-top:4px;">
        Status: ${s.jobStatus || 'Running'}
      </div>
    `
    } else {
        jobInner.innerHTML = '<div class="no-job"><span class="spin">◌</span> Scanning for providers…</div>'
    }

    // Payment stream
    const chanDot = $('requester-chan-dot')
    const chanLabel = $('requester-chan-label')
    if (s.activeJob) {
        chanDot.className = 'chan-dot chan-open'
        chanLabel.textContent = '● STREAMING'
        chanLabel.style.color = 'var(--green)'
    } else {
        chanDot.className = 'chan-dot chan-none'
        chanLabel.textContent = '○ NONE'
        chanLabel.style.color = 'var(--dim)'
    }

    $('requester-tick-line').textContent = s.activeJob ?
        `Tick #${Math.floor(Math.random() * 100)}&nbsp; +$0.001 USDT` :
        'Tick #—&nbsp; +$— USDT'

    // Provider market
    const providerList = $('requester-provider-list')
    if (s.providers && s.providers.length > 0) {
        providerList.innerHTML = s.providers.map(provider => `
      <div class="provider-row">
        <div class="prov-dot ${provider.active ? 'active' : 'inactive'}"></div>
        <div class="prov-id">${provider.id?.slice(0, 12) || 'Unknown'}…</div>
        <div class="prov-caps">${provider.cores || 4}c/${provider.ram || 8}GB</div>
        <div class="prov-price">$${(provider.pricePerHour || 0.001).toFixed(3)}/h</div>
      </div>
    `).join('')
    } else {
        providerList.innerHTML = `
      <div style="color:var(--dim);font-family:var(--mono);font-size:12px;padding:8px 0;">
        Scanning for providers…
      </div>
    `
    }

    // Log
    const lines = (s.recentLog ?? []).slice().reverse()
    $('requester-log-lines').innerHTML = lines.map(l =>
        `<div class="log-line ${logClass(l)}">${escHtml(l)}</div>`
    ).join('')

    // Footer
    $('requester-job-id-footer').textContent = s.activeJob ?
        `Job ID: ${s.activeJob.jobId?.slice(0, 16) || 'Unknown'}…` :
        'Job ID: —'
    $('requester-last-update').textContent = 'updated ' + new Date().toISOString().slice(11, 19)
}

// Spawn processes
function startBackendProcesses() {
    const appDir = process.cwd()
    const providerPath = join(appDir, '../provider/index.mjs')
    const requesterPath = join(appDir, '../requester/index.mjs')
    const providerStorage = join(appDir, '../provider/provider-ui-storage')
    const requesterStorage = join(appDir, '../requester/requester-ui-storage')

    // Resolve node binary
    const nodeBin = process.env.NVM_BIN
        ? join(process.env.NVM_BIN, 'node')
        : process.execPath || 'node'

    // Start provider process
    const providerProc = spawn(nodeBin, [providerPath], {
        env: {
            ...process.env,
            PEAR_STATE_PIPE: '1',
            PROVIDER_STORAGE: providerStorage,
        },
        stdio: ['ignore', 'pipe', 'inherit'],
        cwd: join(appDir, '../provider'),
    })

    let providerBuf = ''
    providerProc.stdout.on('data', (chunk) => {
        providerBuf += chunk.toString()
        const lines = providerBuf.split('\n')
        providerBuf = lines.pop()
        for (const line of lines) {
            if (!line.trim()) continue
            try {
                const newState = JSON.parse(line)
                providerState = { ...providerState, ...newState }
                renderProviderState(providerState)
            } catch { }
        }
    })

    providerProc.on('error', (err) => console.error('Provider spawn error:', err.message))
    providerProc.on('exit', (code) => console.log('Provider exited:', code))

    // Start requester process
    const requesterProc = spawn(nodeBin, [requesterPath, '--storage', requesterStorage], {
        env: {
            ...process.env,
            PEAR_STATE_PIPE: '1'
        },
        stdio: ['ignore', 'pipe', 'inherit'],
        cwd: join(appDir, '../requester'),
    })

    let requesterBuf = ''
    requesterProc.stdout.on('data', (chunk) => {
        requesterBuf += chunk.toString()
        const lines = requesterBuf.split('\n')
        requesterBuf = lines.pop()
        for (const line of lines) {
            if (!line.trim()) continue
            try {
                const newState = JSON.parse(line)
                requesterState = { ...requesterState, ...newState }
                renderRequesterState(requesterState)
            } catch { }
        }
    })

    requesterProc.on('error', (err) => console.error('Requester spawn error:', err.message))
    requesterProc.on('exit', (code) => console.log('Requester exited:', code))

    // Cleanup
    const cleanup = () => {
        providerProc.kill('SIGTERM')
        requesterProc.kill('SIGTERM')
    }

    process.on('exit', cleanup)
    window.addEventListener('beforeunload', cleanup)

    return { providerProc, requesterProc }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    console.log('Starting Harvest Combined UI...')

    // Initial render
    renderProviderState(providerState)
    renderRequesterState(requesterState)

    // Start backend processes
    startBackendProcesses()

    // Make switchTab globally available
    window.switchTab = switchTab
})