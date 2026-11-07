import Dexie, { type Table } from 'dexie'

export type DeviceType = 'Phone' | 'Tablet' | 'Watch'
export type Manufacturer = 'Apple' | 'Samsung' | 'Unassigned'

export interface StoredManual {
  id: string
  title: string
  manufacturer: Manufacturer
  deviceType: DeviceType
  file: Blob
  fileName: string
  fileSize: number
  importedAt: string
}

class NocturnixManualDatabase extends Dexie {
  manuals!: Table<StoredManual, string>

  constructor() {
    super('NocturnixRepairManuals')

    this.version(1).stores({
      manuals: 'id, title, manufacturer, deviceType, importedAt',
    })
  }
}

export const db = new NocturnixManualDatabase()
