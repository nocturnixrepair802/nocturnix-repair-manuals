import {
  db, DEVICE_TYPES, DOCUMENT_CATEGORIES, MANUFACTURERS, formatManualId,
  type ManualMetadata, type NocturnixManualDatabase, type StoredManual,
} from './manualDatabase'

export function validateMetadata(input: ManualMetadata): ManualMetadata {
  const metadata = {
    title: input.title.trim(),
    manufacturer: input.manufacturer,
    deviceType: input.deviceType,
    deviceModel: input.deviceModel.trim(),
    deviceModelId: input.deviceModelId.trim(),
    documentCategory: input.documentCategory,
  }
  if (!metadata.title || metadata.title.length > 200) {
    throw new Error('Enter a title of 1–200 characters.')
  }
  if (!MANUFACTURERS.includes(metadata.manufacturer) ||
      !DEVICE_TYPES.includes(metadata.deviceType) ||
      !DOCUMENT_CATEGORIES.includes(metadata.documentCategory)) {
    throw new Error('Select valid manufacturer, device type, and category values.')
  }
  if (metadata.deviceModel.length > 120 || metadata.deviceModelId.length > 120) {
    throw new Error('Model fields must be 120 characters or fewer.')
  }
  return metadata
}

export async function hashFile(file: Blob) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('Duplicate checking requires HTTPS or localhost with Web Crypto support.')
  }
  const hash = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

export async function validatePdf(file: File) {
  const prefix = new Uint8Array(await file.slice(0, 1024).arrayBuffer())
  if (!new TextDecoder().decode(prefix).includes('%PDF-')) {
    throw new Error('The file does not contain a PDF header.')
  }
}

export async function prepareLibrary(
  database: NocturnixManualDatabase = db,
  onProgress?: (completed: number, total: number) => void,
) {
  await database.open()
  // Load one blob at a time. A failed/interrupted pass resumes at missing hashes.
  const keys = await database.manuals.toCollection().primaryKeys()
  let completed = 0
  for (const key of keys) {
    const record = await database.manuals.get(key)
    if (record && !record.fileHash) {
      const fileHash = await hashFile(record.file)
      // Updating a missing record is a no-op: do not resurrect deleted manuals.
      await database.manuals.update(key, { fileHash })
    }
    onProgress?.(++completed, keys.length)
  }
}

export type ImportResult =
  | { status: 'imported'; manual: StoredManual }
  | { status: 'duplicate'; manual: StoredManual }

export async function importManual(
  file: File,
  input: ManualMetadata,
  database: NocturnixManualDatabase = db,
): Promise<ImportResult> {
  const metadata = validateMetadata(input)
  await validatePdf(file)
  const fileHash = await hashFile(file)
  // Async crypto stays outside the transaction. All cooperating tabs serialize
  // the duplicate check, counter increment, and insert through these stores.
  return database.transaction('rw', database.manuals, database.counters, async () => {
    const total = await database.manuals.count()
    const hashed = await database.manuals.where('fileHash').above('').count()
    if (hashed !== total) throw new Error('Duplicate checking is not ready. Reload to finish preparing the library.')
    const existing = await database.manuals.where('fileHash').equals(fileHash).first()
    if (existing) return { status: 'duplicate', manual: existing }
    const counter = await database.counters.get('manualId')
    const sequence = (counter?.lastValue ?? 0) + 1
    const now = new Date().toISOString()
    const manual: StoredManual = {
      ...metadata,
      id: crypto.randomUUID(),
      manualId: formatManualId(sequence),
      file, fileName: file.name, fileSize: file.size,
      fileHash, importedAt: now, updatedAt: now,
    }
    await database.counters.put({ key: 'manualId', lastValue: sequence })
    await database.manuals.add(manual)
    return { status: 'imported', manual }
  })
}

export async function editManual(
  id: string, metadata: ManualMetadata, database: NocturnixManualDatabase = db,
) {
  // Pick only editable fields; never spread a full record into the database.
  const changes = validateMetadata(metadata)
  const count = await database.manuals.update(id, { ...changes, updatedAt: new Date().toISOString() })
  if (!count) throw new Error('This manual no longer exists. It may have been deleted in another tab.')
}

export async function deleteManual(id: string, database: NocturnixManualDatabase = db) {
  await database.manuals.delete(id)
}

export function findLegacyDuplicates(manuals: StoredManual[]) {
  const groups = new Map<string, StoredManual[]>()
  for (const manual of manuals) {
    if (!manual.fileHash) continue
    const group = groups.get(manual.fileHash) ?? []
    group.push(manual)
    groups.set(manual.fileHash, group)
  }
  return [...groups.values()].filter((group) => group.length > 1)
}
