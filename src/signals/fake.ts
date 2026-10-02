import type { BleSighting, SignalListener, SignalSource } from './types'

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
  rssiNoise: number
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
  initial: FakeSignalOptions = { crowdSize: 4, rssiNoise: 4 },
): SignalSource & {
  setCrowdSize: (n: number) => void
  setRssiNoise: (n: number) => void
  walkPast: () => void
} {
  let crowdSize = initial.crowdSize
  let rssiNoise = initial.rssiNoise
  let devices: FakeDevice[] = []
  let timer: number | undefined
  const listeners = new Set<SignalListener>()

  function liveSightings(): BleSighting[] {
    const now = Date.now()
    return devices.filter((d) => d.alive).map((d) => toSighting(d, now))
  }

  function emit() {
    const sightings = liveSightings()
    for (const listener of listeners) listener(sightings)
  }

  function makeDevice(index: number): FakeDevice {
    const name = NAMES[index % NAMES.length]
    return {
      id: `fake-${index}-${Math.random().toString(36).slice(2, 7)}`,
      name: `${name}-${index + 1}`,
      manufacturerId: 0x004c + (index % 8),
      rssi: -90 + Math.random() * 20,
      targetRssi: -55 - Math.random() * 30,
      seenAt: Date.now(),
      alive: true,
    }
  }

  function syncCrowd() {
    while (devices.length < crowdSize) {
      devices.push(makeDevice(devices.length))
    }
    for (let i = 0; i < devices.length; i++) {
      devices[i].alive = i < crowdSize
    }
  }

  function tick() {
    syncCrowd()
    for (const d of devices) {
      if (!d.alive) continue
      const drift = (Math.random() - 0.5) * rssiNoise
      d.rssi += (d.targetRssi - d.rssi) * 0.08 + drift
      d.rssi = Math.max(-100, Math.min(-35, d.rssi))
      if (Math.random() < 0.02) {
        d.targetRssi = -45 - Math.random() * 45
      }
    }
    emit()
  }

  return {
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
      crowdSize = Math.max(0, Math.min(24, Math.round(n)))
      syncCrowd()
      emit()
    },
    setRssiNoise(n: number) {
      rssiNoise = Math.max(0, n)
    },
    walkPast() {
      const guest = makeDevice(devices.length)
      guest.targetRssi = -40
      guest.rssi = -95
      devices.push(guest)
      crowdSize = Math.max(crowdSize, devices.filter((d) => d.alive).length)
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
