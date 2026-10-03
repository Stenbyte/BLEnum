import type { BleSighting, SignalListener, SignalSource } from './types'
import { DEVICE_CAP } from '../art/regions'

export const DEFAULT_BRIDGE_URL = 'ws://127.0.0.1:8787'

export type BridgeSignalOptions = {
  url?: string
  deviceCap?: number
}

type BridgeMessage =
  | {
      type: 'hello' | 'status'
      scanning?: boolean
      error?: string
      port?: number
    }
  | {
      type: 'sightings'
      devices: BleSighting[]
      scanning?: boolean
      error?: string
    }

/**
 * Browser client for the local BLE bridge (WebSocket).
 * Run `npm run bridge` in another terminal, then connect().
 */
export function createBridgeSignalSource(
  initial: BridgeSignalOptions = {},
): SignalSource & {
  connect: () => void
  disconnect: () => void
  readonly connected: boolean
  readonly url: string
  readonly lastError: string
} {
  const url = initial.url ?? DEFAULT_BRIDGE_URL
  const deviceCap = initial.deviceCap ?? DEVICE_CAP
  const listeners = new Set<SignalListener>()
  let ws: WebSocket | null = null
  let sightings: BleSighting[] = []
  let lastError = ''
  let intentionalClose = false

  function emit() {
    const slice = sightings.slice(0, deviceCap)
    for (const listener of listeners) listener(slice)
  }

  function handleMessage(raw: string) {
    let msg: BridgeMessage
    try {
      msg = JSON.parse(raw) as BridgeMessage
    } catch {
      return
    }

    if (msg.type === 'sightings' && Array.isArray(msg.devices)) {
      sightings = msg.devices
        .map((d) => ({
          id: String(d.id),
          name: d.name ? String(d.name) : undefined,
          manufacturerId:
            typeof d.manufacturerId === 'number' ? d.manufacturerId : undefined,
          rssi: typeof d.rssi === 'number' ? d.rssi : -80,
          seenAt: typeof d.seenAt === 'number' ? d.seenAt : Date.now(),
        }))
        .sort((a, b) => b.rssi - a.rssi)
        .slice(0, deviceCap)
      if (msg.error) lastError = msg.error
      emit()
      return
    }

    if ((msg.type === 'hello' || msg.type === 'status') && msg.error) {
      lastError = msg.error
    }
  }

  function connect() {
    if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
      return
    }
    intentionalClose = false
    lastError = ''
    ws = new WebSocket(url)

    ws.addEventListener('open', () => {
      lastError = ''
      emit()
    })

    ws.addEventListener('message', (ev) => {
      handleMessage(String(ev.data))
    })

    ws.addEventListener('error', () => {
      lastError = `Bridge unreachable at ${url}. Run: npm run bridge`
    })

    ws.addEventListener('close', () => {
      ws = null
      sightings = []
      if (!intentionalClose && !lastError) {
        lastError = `Bridge disconnected (${url})`
      }
      emit()
    })
  }

  function disconnect() {
    intentionalClose = true
    if (ws) {
      ws.close()
      ws = null
    }
    sightings = []
    emit()
  }

  return {
    get url() {
      return url
    },
    get connected() {
      return !!ws && ws.readyState === WebSocket.OPEN
    },
    get lastError() {
      return lastError
    },
    start() {
      // Use connect() from a button so failures are visible
    },
    stop() {
      disconnect()
    },
    connect,
    disconnect,
    subscribe(listener) {
      listeners.add(listener)
      listener(sightings.slice(0, deviceCap))
      return () => {
        listeners.delete(listener)
      }
    },
    getSightings() {
      return sightings.slice(0, deviceCap)
    },
  }
}
