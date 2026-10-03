/**
 * BLEnum BLE bridge
 * Scans nearby BLE advertisements and pushes sightings to the browser over WebSocket.
 *
 * Run: npm start (from /bridge)
 * Default: ws://127.0.0.1:8787
 */

const http = require('http')
const { WebSocketServer } = require('ws')
const noble = require('@abandonware/noble')

const PORT = Number(process.env.BLENUM_BRIDGE_PORT || 8787)
const HOST = process.env.BLENUM_BRIDGE_HOST || '127.0.0.1'
const DEVICE_CAP = Number(process.env.BLENUM_DEVICE_CAP || 20)
const STALE_MS = Number(process.env.BLENUM_STALE_MS || 6000)
const BROADCAST_MS = Number(process.env.BLENUM_BROADCAST_MS || 200)

/** @type {Map<string, { id: string, name?: string, manufacturerId?: number, rssi: number, seenAt: number }>} */
const devices = new Map()
/** @type {import('ws').WebSocket[]} */
const clients = []

let scanning = false
let lastError = ''

function prune() {
  const now = Date.now()
  for (const [id, d] of devices) {
    if (now - d.seenAt > STALE_MS) devices.delete(id)
  }
}

function sightings() {
  prune()
  return [...devices.values()]
    .sort((a, b) => b.rssi - a.rssi)
    .slice(0, DEVICE_CAP)
}

function broadcast(msg) {
  const data = JSON.stringify(msg)
  for (const ws of clients) {
    if (ws.readyState === 1) ws.send(data)
  }
}

function pushSightings() {
  broadcast({
    type: 'sightings',
    devices: sightings(),
    scanning,
    error: lastError || undefined,
  })
}

function manufacturerIdFrom(peripheral) {
  const md = peripheral.advertisement && peripheral.advertisement.manufacturerData
  if (!md || md.length < 2) return undefined
  return md[0] | (md[1] << 8)
}

function softId(peripheral) {
  if (peripheral.uuid) return String(peripheral.uuid)
  if (peripheral.id) return String(peripheral.id)
  const name = (peripheral.advertisement && peripheral.advertisement.localName) || ''
  const company = manufacturerIdFrom(peripheral)
  return `anon-${name || 'dev'}-${company ?? 'x'}`
}

function startScan() {
  noble.startScanning([], true, (err) => {
    if (err) {
      scanning = false
      lastError = err.message || String(err)
      console.error('[bridge] startScanning failed:', lastError)
      broadcast({ type: 'status', scanning: false, error: lastError })
      return
    }
    scanning = true
    lastError = ''
    console.log('[bridge] Scanning for BLE advertisements…')
    broadcast({ type: 'status', scanning: true })
  })
}

function stopScan() {
  try {
    noble.stopScanning()
  } catch {
    // ignore
  }
  scanning = false
}

noble.on('stateChange', (state) => {
  console.log(`[bridge] Bluetooth state: ${state}`)
  if (state === 'poweredOn') {
    startScan()
  } else {
    stopScan()
    broadcast({ type: 'status', scanning: false, error: `Bluetooth ${state}` })
  }
})

noble.on('discover', (peripheral) => {
  const id = softId(peripheral)
  const name =
    (peripheral.advertisement && peripheral.advertisement.localName) || undefined
  const manufacturerId = manufacturerIdFrom(peripheral)
  const rssi = typeof peripheral.rssi === 'number' ? peripheral.rssi : -80
  devices.set(id, {
    id,
    name,
    manufacturerId,
    rssi,
    seenAt: Date.now(),
  })
})

noble.on('warning', (msg) => {
  console.warn('[bridge] warning:', msg)
})

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(
    [
      'BLEnum BLE bridge',
      `WebSocket: ws://${HOST}:${PORT}`,
      `scanning: ${scanning}`,
      `devices: ${sightings().length}`,
      lastError ? `error: ${lastError}` : '',
      '',
    ]
      .filter(Boolean)
      .join('\n'),
  )
})

const wss = new WebSocketServer({ server })

wss.on('connection', (ws) => {
  clients.push(ws)
  console.log(`[bridge] client connected (${clients.length})`)
  ws.send(
    JSON.stringify({
      type: 'hello',
      scanning,
      error: lastError || undefined,
      port: PORT,
    }),
  )
  ws.send(
    JSON.stringify({
      type: 'sightings',
      devices: sightings(),
      scanning,
    }),
  )

  ws.on('close', () => {
    const i = clients.indexOf(ws)
    if (i >= 0) clients.splice(i, 1)
    console.log(`[bridge] client disconnected (${clients.length})`)
  })
})

setInterval(pushSightings, BROADCAST_MS)

server.listen(PORT, HOST, () => {
  console.log(`[bridge] listening on ws://${HOST}:${PORT}`)
  console.log('[bridge] Keep this running, then choose Bridge in the BLEnum UI.')
  console.log('[bridge] macOS: allow Bluetooth for Terminal/Node if prompted.')
})

function shutdown() {
  console.log('[bridge] shutting down…')
  stopScan()
  wss.close()
  server.close(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
