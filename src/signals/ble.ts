import type { BleSighting, SignalListener, SignalSource } from './types'
import { DEVICE_CAP } from '../art/regions'

export type BleSignalOptions = {
  deviceCap?: number
  /** Drop devices not seen for this long */
  staleMs?: number
}

export type BleScanError = Error & {
  code?: string
  causeName?: string
}

function hashId(parts: string[]): string {
  let h = 2166136261
  const s = parts.join('|')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return `ble-${(h >>> 0).toString(16)}`
}

function manufacturerIdFrom(event: BluetoothAdvertisingEvent): number | undefined {
  let first: number | undefined
  event.manufacturerData?.forEach((_value, key) => {
    if (first === undefined) first = key
  })
  return first
}

function softDeviceId(event: BluetoothAdvertisingEvent): string {
  const company = manufacturerIdFrom(event)
  const uuids = [...(event.uuids ?? [])].sort().join(',')
  if (event.device?.id && event.device.id !== 'unknown') {
    return event.device.id
  }
  return hashId([
    event.device?.name ?? event.name ?? '',
    company !== undefined ? String(company) : '',
    uuids,
  ])
}

export function isBleScanSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.bluetooth &&
    typeof navigator.bluetooth.requestLEScan === 'function'
  )
}

function toBleScanError(err: unknown): BleScanError {
  const name =
    err && typeof err === 'object' && 'name' in err
      ? String((err as { name: string }).name)
      : 'Error'
  const message =
    err instanceof Error ? err.message : typeof err === 'string' ? err : String(err)
  const canceled = /cancel|denied|not allowed|abort/i.test(`${name} ${message}`)

  const nice = canceled
    ? [
        'Chrome closed the scan permission without starting (often still happens after Allow).',
        'This is a known flaky experimental API — not your flag setup.',
        'Checklist: macOS System Settings → Privacy → Bluetooth → Chrome ON;',
        'Bluetooth on; reload this tab; try Allow again.',
        'If it keeps failing, use Fake BLE for now. Real installs usually need a native BLE bridge.',
      ].join(' ')
    : message

  const out: BleScanError = new Error(nice)
  out.code = canceled ? 'permission-canceled' : 'scan-failed'
  out.causeName = name
  return out
}

/**
 * Live Web Bluetooth Scanning source (Chrome experimental).
 * Call startScan() from a user gesture after enabling
 * chrome://flags/#enable-experimental-web-platform-features
 */
export function createBleSignalSource(
  initial: BleSignalOptions = {},
): SignalSource & {
  startScan: () => Promise<void>
  readonly scanning: boolean
  readonly supported: boolean
} {
  const deviceCap = initial.deviceCap ?? DEVICE_CAP
  const staleMs = initial.staleMs ?? 6000
  const devices = new Map<string, BleSighting>()
  const listeners = new Set<SignalListener>()
  let scan: BluetoothLEScan | null = null
  let pruneTimer: number | undefined
  let onAdvert: ((ev: BluetoothAdvertisingEvent) => void) | null = null

  function emit() {
    const sightings = liveSightings()
    for (const listener of listeners) listener(sightings)
  }

  function liveSightings(): BleSighting[] {
    return [...devices.values()]
      .sort((a, b) => b.rssi - a.rssi)
      .slice(0, deviceCap)
  }

  function prune() {
    const now = Date.now()
    let changed = false
    for (const [id, s] of devices) {
      if (now - s.seenAt > staleMs) {
        devices.delete(id)
        changed = true
      }
    }
    if (devices.size > deviceCap) {
      const ranked = [...devices.entries()].sort((a, b) => b[1].rssi - a[1].rssi)
      devices.clear()
      for (const [id, s] of ranked.slice(0, deviceCap)) devices.set(id, s)
      changed = true
    }
    if (changed) emit()
  }

  function handleAdvert(event: BluetoothAdvertisingEvent) {
    const id = softDeviceId(event)
    const company = manufacturerIdFrom(event)
    const name = event.device?.name || event.name || undefined
    const rssi = typeof event.rssi === 'number' ? event.rssi : -70
    devices.set(id, {
      id,
      name,
      manufacturerId: company,
      rssi,
      seenAt: Date.now(),
    })
    prune()
    emit()
  }

  function attachScan(next: BluetoothLEScan) {
    scan = next
    onAdvert = handleAdvert
    navigator.bluetooth!.addEventListener('advertisementreceived', onAdvert)
    if (pruneTimer === undefined) {
      pruneTimer = window.setInterval(prune, 1000)
    }
    emit()
  }

  return {
    get supported() {
      return isBleScanSupported()
    },
    get scanning() {
      return !!scan?.active
    },
    start() {
      // Scanning requires user gesture — use startScan()
    },
    async startScan() {
      if (!isBleScanSupported()) {
        throw new Error(
          'Web Bluetooth Scanning not available. Use Chrome with chrome://flags/#enable-experimental-web-platform-features enabled.',
        )
      }
      if (scan?.active) return

      // Clean any half-open scan from a previous cancel
      this.stop()

      try {
        if (typeof navigator.bluetooth!.getAvailability === 'function') {
          const available = await navigator.bluetooth!.getAvailability()
          if (!available) {
            throw new Error(
              'Bluetooth adapter unavailable. Turn Bluetooth on, then try again.',
            )
          }
        }

        // Official Chrome sample shape — acceptAllAdvertisements scan permission.
        const next = await navigator.bluetooth!.requestLEScan({
          acceptAllAdvertisements: true,
          keepRepeatedDevices: true,
        })
        attachScan(next)
      } catch (err) {
        this.stop()
        throw toBleScanError(err)
      }
    },
    stop() {
      if (onAdvert && navigator.bluetooth) {
        navigator.bluetooth.removeEventListener('advertisementreceived', onAdvert)
        onAdvert = null
      }
      if (scan) {
        try {
          scan.stop()
        } catch {
          // ignore
        }
        scan = null
      }
      if (pruneTimer !== undefined) {
        window.clearInterval(pruneTimer)
        pruneTimer = undefined
      }
      devices.clear()
      emit()
    },
    subscribe(listener) {
      listeners.add(listener)
      listener(liveSightings())
      return () => {
        listeners.delete(listener)
      }
    },
    getSightings: liveSightings,
  }
}
