import { DATABASE_NAME } from './manualDatabase'
import { hashFile } from './manualLibrary'

type LegacyRecord = Record<string, unknown> & { id: string; file: Blob }
type BackupRecord = Record<string, unknown> & {
  id: string
  file: { type: string; base64: string; sha256: string }
}

// Dexie's schema version 1 is IndexedDB version 10. Probe without upgrading.
export function hasLegacyLibrary(name = DATABASE_NAME): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name)
    let absent = false
    request.onupgradeneeded = () => {
      absent = true
      request.transaction!.abort() // Do not create an empty database just to inspect it.
    }
    request.onerror = () => absent ? resolve(false) : reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const legacy = database.version === 10
      database.close()
      resolve(legacy)
    }
    request.onblocked = () => reject(new Error('Close other library tabs and try again.'))
  })
}

async function readLegacyRecords(name: string): Promise<LegacyRecord[]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 10)
    request.onupgradeneeded = () => request.transaction!.abort()
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('manuals', 'readonly')
      const records = transaction.objectStore('manuals').getAll()
      transaction.oncomplete = () => { database.close(); resolve(records.result) }
      transaction.onabort = () => { database.close(); reject(transaction.error) }
    }
  })
}

export async function createLegacyBackup(name = DATABASE_NAME) {
  const records = await readLegacyRecords(name)
  const manuals: BackupRecord[] = []
  for (const record of records) {
    const bytes = new Uint8Array(await record.file.arrayBuffer())
    const chunks: string[] = []
    for (let offset = 0; offset < bytes.length; offset += 32768) {
      chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 32768)))
    }
    manuals.push({
      ...record,
      file: { type: record.file.type, base64: btoa(chunks.join('')), sha256: await hashFile(record.file) },
    })
  }
  const json = JSON.stringify({ format: 'nocturnix-library-v1', createdAt: new Date().toISOString(), manuals })
  // Verify decoding and hashes before offering this backup for download.
  await decodeLegacyBackup(json)
  return new Blob([json], { type: 'application/json' })
}

async function decodeLegacyBackup(json: string): Promise<LegacyRecord[]> {
  const backup = JSON.parse(json)
  if (backup.format !== 'nocturnix-library-v1' || !Array.isArray(backup.manuals)) {
    throw new Error('Select a Nocturnix v1 library backup.')
  }
  const records: LegacyRecord[] = []
  const ids = new Set<string>()
  for (const entry of backup.manuals as BackupRecord[]) {
    if (typeof entry.id !== 'string' || ids.has(entry.id) ||
        typeof entry.file?.base64 !== 'string' || typeof entry.file.type !== 'string') {
      throw new Error('The backup contains an invalid or repeated record.')
    }
    const file = new Blob([Uint8Array.from(atob(entry.file.base64), (character) => character.charCodeAt(0))], {
      type: entry.file.type,
    })
    if (await hashFile(file) !== entry.file.sha256) throw new Error('A backup PDF failed its integrity check.')
    ids.add(entry.id)
    records.push({ ...entry, file })
  }
  return records
}

export async function restoreLegacyBackup(json: string, name = DATABASE_NAME) {
  const records = await decodeLegacyBackup(json)
  return new Promise<number>((resolve, reject) => {
    let created = false
    const request = indexedDB.open(name, 10)
    request.onupgradeneeded = (event) => {
      if (event.oldVersion !== 0) {
        request.transaction!.abort()
        return
      }
      created = true
      const store = request.result.createObjectStore('manuals', { keyPath: 'id' })
      for (const index of ['title', 'manufacturer', 'deviceType', 'importedAt']) {
        store.createIndex(index, index)
      }
      // Restoration and database creation either both commit or both roll back.
      for (const record of records) store.add(record)
    }
    request.onerror = () => reject(new Error('Restore requires an empty browser profile or unused origin. Existing libraries are never overwritten.'))
    request.onblocked = () => reject(new Error('Close other library tabs before restoring.'))
    request.onsuccess = () => {
      request.result.close()
      if (!created) reject(new Error('A library already exists here. Use an empty browser profile or unused origin.'))
      else resolve(records.length)
    }
  })
}

export function downloadBackup(blob: Blob) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `nocturnix-v1-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
