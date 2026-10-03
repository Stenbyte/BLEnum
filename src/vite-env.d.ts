/// <reference types="vite/client" />

type BluetoothManufacturerDataMap = Map<number, DataView>
type BluetoothServiceDataMap = Map<string, DataView>

interface BluetoothAdvertisingEvent extends Event {
  readonly device: BluetoothDevice
  readonly rssi?: number
  readonly txPower?: number
  readonly uuids: string[]
  readonly name?: string
  readonly manufacturerData: BluetoothManufacturerDataMap
  readonly serviceData: BluetoothServiceDataMap
}

interface BluetoothLEScanOptions {
  filters?: BluetoothLEScanFilter[]
  keepRepeatedDevices?: boolean
  acceptAllAdvertisements?: boolean
}

interface BluetoothLEScan {
  readonly active: boolean
  readonly acceptAllAdvertisements: boolean
  readonly keepRepeatedDevices: boolean
  stop: () => void
}

interface Bluetooth {
  getAvailability?: () => Promise<boolean>
  requestLEScan: (options?: BluetoothLEScanOptions) => Promise<BluetoothLEScan>
  addEventListener(
    type: 'advertisementreceived',
    listener: (ev: BluetoothAdvertisingEvent) => void,
    options?: boolean | AddEventListenerOptions,
  ): void
  removeEventListener(
    type: 'advertisementreceived',
    listener: (ev: BluetoothAdvertisingEvent) => void,
    options?: boolean | EventListenerOptions,
  ): void
}

interface Navigator {
  readonly bluetooth?: Bluetooth
}
