import type { BleSighting, SignalListener, SignalSource } from './types'
import { DEVICE_CAP } from '../art/regions'
import { DEFAULT_NEAR_RSSI } from '../vibe/map'

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

/** Standing crowd stays above the default near gate, with headroom for shimmer. */
const NEAR_FLOOR = DEFAULT_NEAR_RSSI + 3 // -62
const NEAR_CEIL = -45

type FakeDevice = BleSighting & {
  targetRssi: number
  alive: boolean
  guest: boolean
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

function randomNearRssi(): number {
  return NEAR_CEIL - Math.random() * (NEAR_CEIL - NEAR_FLOOR)
}

function randomFarRssi(): number {
  return -78 - Math.random() * 16
}

export function createFakeSignalSource(
  initial: FakeSignalOptions = { crowdSize: 0, rssiNoise: 8 },
): SignalSource & {
  setCrowdSize: (n: number) => void
  setRssiNoise: (n: number) => void
  walkPast: () => void
  readonly deviceCap: number
} {
  const deviceCap = initial.deviceCap ?? DEVICE_CAP
  let crowdSize = Math.max(0, Math.min(deviceCap, initial.crowdSize))
  let rssiNoise = Math.max(0, Math.min(25, initial.rssiNoise))
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

  function makeStandingDevice(): FakeDevice {
    const index = nextIndex++
    const name = NAMES[index % NAMES.length]
    const rssi = randomNearRssi()
    return {
      id: `fake-${index}-${Math.random().toString(36).slice(2, 7)}`,
      name: `${name}-${index + 1}`,
      manufacturerId: 0x004c + (index % 8),
      rssi,
      targetRssi: rssi,
      seenAt: Date.now(),
      alive: true,
      guest: false,
    }
  }

  function syncCrowd() {
    while (devices.length < crowdSize) {
      devices.push(makeStandingDevice())
    }
    for (let i = 0; i < devices.length; i++) {
      const want = i < crowdSize
      if (want && !devices[i].alive) {
        const rssi = randomNearRssi()
        devices[i].rssi = rssi
        devices[i].targetRssi = rssi
      }
      devices[i].alive = want
    }
    // Standing crowd owns the cap; drop guests if over
    while (allLive().length > deviceCap && guests.length > 0) {
      const g = guests.shift()
      if (g) g.alive = false
    }
  }

  function tickDevice(d: FakeDevice) {
    // Shimmer for breath, but keep standing devices from dumping below near gate
    const driftScale = d.guest ? 0.35 : 0.2
    const drift = (Math.random() - 0.5) * rssiNoise * driftScale
    d.rssi += (d.targetRssi - d.rssi) * 0.22 + drift

    if (!d.guest) {
      // Soft clamp: standing crowd stays countable as Near
      d.rssi = Math.max(NEAR_FLOOR - 1, Math.min(-35, d.rssi))
      if (Math.random() < 0.04) {
        d.targetRssi =
          Math.random() < 0.92 ? randomNearRssi() : randomFarRssi()
      }
      // If target wandered far, still bias live rssi toward near most of the time
      if (d.targetRssi < NEAR_FLOOR && Math.random() < 0.7) {
        d.targetRssi = randomNearRssi()
      }
    } else {
      d.rssi = Math.max(-100, Math.min(-35, d.rssi))
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
      rssiNoise = Math.max(0, Math.min(25, n))
    },
    walkPast() {
      const room = deviceCap - allLive().length
      if (room <= 0) return
      const index = nextIndex++
      const name = NAMES[index % NAMES.length]
      const guest: FakeDevice = {
        id: `guest-${index}-${Math.random().toString(36).slice(2, 7)}`,
        name: `${name}-walk`,
        manufacturerId: 0x004c + (index % 8),
        rssi: -95,
        targetRssi: -42,
        seenAt: Date.now(),
        alive: true,
        guest: true,
      }
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
