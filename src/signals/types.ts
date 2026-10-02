export type BleSighting = {
  id: string
  name?: string
  manufacturerId?: number
  rssi: number
  seenAt: number
}

export type SignalListener = (sightings: BleSighting[]) => void

export type SignalSource = {
  start: () => void
  stop: () => void
  subscribe: (listener: SignalListener) => () => void
  getSightings: () => BleSighting[]
}
