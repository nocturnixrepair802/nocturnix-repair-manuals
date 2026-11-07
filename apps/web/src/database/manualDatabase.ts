import Dexie, { type Table } from 'dexie'

export const DEVICE_TYPES = ['Phone', 'Tablet', 'Watch'] as const
export const MANUFACTURERS = ['Apple', 'Samsung', 'Unassigned'] as const
export const DOCUMENT_CATEGORIES = [
  'Unassigned', 'Service Manual', 'Repair Guide', 'Schematic',
  'Boardview', 'Parts Catalog', 'Other',
] as const

export type DeviceType = typeof DEVICE_TYPES[number]
export type Manufacturer = typeof MANUFACTURERS[number]
export type DocumentCategory = typeof DOCUMENT_CATEGORIES[number]

export interface ManualMetadata {
  title: string
  manufacturer: Manufacturer
  deviceType: DeviceType
  deviceModel: string
  deviceModelId: string
  documentCategory: DocumentCategory
}

export interface StoredManual extends ManualMetadata {
  id: string
  manualId: string
  file: Blob
  fileName: string
  fileSize: number
  importedAt: string
  updatedAt: string
  fileHash?: string
}

export interface ManualCounter {
  key: string
  lastValue: number
}

export const DATABASE_NAME = 'NocturnixRepairManuals'
export const V1_SCHEMA = 'id, title, manufacturer, deviceType, importedAt'

export function formatManualId(sequence: number) {
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw new Error('The manual ID counter is invalid.')
  }
  return `NMR-MAN-${String(sequence).padStart(6, '0')}`
}

export class NocturnixManualDatabase extends Dexie {
  manuals!: Table<StoredManual, string>
  counters!: Table<ManualCounter, string>

  constructor(name = DATABASE_NAME) {
    super(name)
    this.version(1).stores({ manuals: V1_SCHEMA })
    this.version(2).stores({
      manuals: `${V1_SCHEMA}, &manualId, deviceModel, deviceModelId, documentCategory, fileHash`,
      counters: 'key',
    }).upgrade(async (transaction) => {
      const table = transaction.table<StoredManual, string>('manuals')
      // Change metadata only. Never merge or remove legacy PDFs.
      const records = await table.orderBy(':id').toArray()
      records.sort((a, b) => {
        const first = typeof a.importedAt === 'string' ? a.importedAt : ''
        const second = typeof b.importedAt === 'string' ? b.importedAt : ''
        return first < second ? -1 : first > second ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0
      })
      for (const [index, record] of records.entries()) {
        await table.update(record.id, {
          manualId: formatManualId(index + 1),
          deviceModel: '',
          deviceModelId: '',
          documentCategory: 'Unassigned',
          updatedAt: record.importedAt || new Date().toISOString(),
        })
      }
      await transaction.table('counters').put({ key: 'manualId', lastValue: records.length })
    })
  }
}

export const db = new NocturnixManualDatabase()
