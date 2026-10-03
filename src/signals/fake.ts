import type { BleSighting, SignalListener, SignalSource } from './types'
import { DEVICE_CAP } from '../art/regions'

const NAMES = [
  'Pixel',
  'iPhone',
  'Galaxy',
  'Watch',
  'AirPods',
  'Fitbit',
  'Nothing',
  'OnePlus',
]

type FakeDevice = BleSighting & {
  targetRssi: number
  alive: boolean
}

export type FakeSignalOptions = {
  crowdSize: number
  /** RSSI shimmer amount — keeps the picture breathing */
  rssiNoise: number
  deviceCap?: number
}

function toSighting(d: FakeDevice, now: number): BleSighting {
  return {
    id: d.id,
    name: d.name,
    manufacturerId: d.manufacturerId,
    rssi: d.rssi,
    seenAt: now,
  }
}

export function createFakeSignalSource(
  initial: FakeSignalOptions = { crowdSize: 0, rssiNoise: 4 },
): SignalSource & {
  setCrowdSize: (n: number) => void
  setRssiNoise: (n: number) => void
  walkPast: () => void
  readonly deviceCap: number
} {
  const deviceCap = initial.deviceCap ?? DEVICE_CAP
  let crowdSize = Math.max(0, Math.min(deviceCap, initial.crowdSize))
  let rssiNoise = initial.rssiNoise
  let devices: FakeDevice[] = []
  let guests: FakeDevice[] = []
  let nextIndex = 0
  let timer: number | undefined
  const listeners = new Set<SignalListener>()

  function allLive(): FakeDevice[] {
    return [...devices, ...guests].filter((d) => d.alive)
  }

  function liveSightings(): BleSighting[] {
    const now = Date.now()
    return allLive().map((d) => toSighting(d, now))
  }

  function emit() {
    const sightings = liveSightings()
    for (const listener of listeners) listener(sightings)
  }

  function makeDevice(): FakeDevice {
    const index = nextIndex++
    const name = NAMES[index % NAMES.length]
    return {
      id: `fake-${index}-${Math.random().toString(36).slice(2, 7)}`,
      name: `${name}-${index + 1}`,
      manufacturerId: 0x004c + (index % 8),
      rssi: -85 + Math.random() * 15,
      targetRssi: -50 - Math.random() * 25,
      seenAt: Date.now(),
      alive: true,
    }
  }

  function syncCrowd() {
    while (devices.length < crowdSize) {
      devices.push(makeDevice())
    }
    for (let i = 0; i < devices.length; i++) {
      devices[i].alive = i < crowdSize
    }
  }

  function tickDevice(d: FakeDevice) {
    const drift = (Math.random() - 0.5) * rssiNoise
    d.rssi += (d.targetRssi - d.rssi) * 0.08 + drift
    d.rssi = Math.max(-100, Math.min(-35, d.rssi))
    if (Math.random() < 0.02) {
      d.targetRssi = -45 - Math.random() * 40
    }
  }

  function tick() {
    syncCrowd()
    for (const d of allLive()) tickDevice(d)
    guests = guests.filter((d) => d.alive)
    emit()
  }

  return {
    get deviceCap() {
      return deviceCap
    },
    start() {
      if (timer !== undefined) return
      syncCrowd()
      tick()
      timer = window.setInterval(tick, 200)
    },
    stop() {
      if (timer === undefined) return
      window.clearInterval(timer)
      timer = undefined
    },
    subscribe(listener) {
      listeners.add(listener)
      listener(liveSightings())
      return () => {
        listeners.delete(listener)
      }
    },
    getSightings: liveSightings,
    setCrowdSize(n: number) {
      crowdSize = Math.max(0, Math.min(deviceCap, Math.round(n)))
      syncCrowd()
      emit()
    },
    setRssiNoise(n: number) {
      rssiNoise = Math.max(0, n)
    },
    walkPast() {
      if (allLive().length >= deviceCap) return
      const guest = makeDevice()
      guest.targetRssi = -40
      guest.rssi = -95
      guests.push(guest)
      window.setTimeout(() => {
        guest.targetRssi = -98
        window.setTimeout(() => {
          guest.alive = false
          emit()
        }, 2500)
      }, 4000)
      emit()
    },
  }
}
