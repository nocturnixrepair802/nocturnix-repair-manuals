import 'fake-indexeddb/auto'
import Dexie from 'dexie'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NocturnixManualDatabase, V1_SCHEMA, type ManualMetadata } from './manualDatabase'
import { deleteManual, editManual, hashFile, importManual, prepareLibrary, findLegacyDuplicates } from './manualLibrary'
import { createLegacyBackup, hasLegacyLibrary, restoreLegacyBackup } from './libraryBackup'

const opened: Dexie[] = []
const names: string[] = []
const metadata: ManualMetadata = {
  title: 'Test guide', manufacturer: 'Apple', deviceType: 'Phone',
  deviceModel: 'iPhone 14', deviceModelId: 'A2649', documentCategory: 'Repair Guide',
}
function name() { const result = `test-${crypto.randomUUID()}`; names.push(result); return result }
function database(databaseName = name()) {
  const result = new NocturnixManualDatabase(databaseName)
  opened.push(result)
  return result
}
function pdf(content = 'synthetic') {
  return new File([`%PDF-1.4\n${content}\n%%EOF`], `${content}.pdf`, { type: 'application/pdf' })
}
async function seedLegacy(databaseName = name()) {
  const legacy = new Dexie(databaseName)
  opened.push(legacy)
  legacy.version(1).stores({ manuals: V1_SCHEMA })
  const records = [
    { id: 'b', title: 'Later', manufacturer: 'Samsung', deviceType: 'Watch', file: pdf('same'), fileName: 'later.pdf', fileSize: pdf('same').size, importedAt: '2026-02-01T00:00:00Z' },
    { id: 'c', title: 'Earlier C', manufacturer: 'Unassigned', deviceType: 'Tablet', file: pdf('same'), fileName: 'earlier.pdf', fileSize: pdf('same').size, importedAt: '2026-01-01T00:00:00Z' },
    { id: 'a', title: 'Earlier A', manufacturer: 'Apple', deviceType: 'Phone', file: pdf('other'), fileName: 'a.pdf', fileSize: pdf('other').size, importedAt: '2026-01-01T00:00:00Z' },
  ]
  await legacy.table('manuals').bulkAdd(records)
  legacy.close()
  return { databaseName, records }
}

afterEach(async () => {
  vi.restoreAllMocks()
  for (const connection of opened.splice(0)) connection.close()
  for (const databaseName of names.splice(0)) await Dexie.delete(databaseName)
})

describe('v1 to v2 migration', () => {
  it('preserves every old field, key and PDF byte while assigning deterministic IDs', async () => {
    const { databaseName, records } = await seedLegacy()
    const upgraded = database(databaseName)
    await upgraded.open()
    expect(upgraded.verno).toBe(2)
    for (const original of records) {
      const saved = (await upgraded.manuals.get(original.id))!
      const { file: originalFile, ...originalMetadata } = original
      expect(saved).toMatchObject(originalMetadata)
      expect(await saved.file.arrayBuffer()).toEqual(await originalFile.arrayBuffer())
      expect(saved).toMatchObject({ deviceModel: '', deviceModelId: '', documentCategory: 'Unassigned', updatedAt: original.importedAt })
      expect(saved.fileHash).toBeUndefined()
    }
    expect((await upgraded.manuals.get('a'))!.manualId).toBe('NMR-MAN-000001')
    expect((await upgraded.manuals.get('c'))!.manualId).toBe('NMR-MAN-000002')
    expect((await upgraded.manuals.get('b'))!.manualId).toBe('NMR-MAN-000003')
    await prepareLibrary(upgraded)
    expect(await upgraded.manuals.count()).toBe(3)
    expect(findLegacyDuplicates(await upgraded.manuals.toArray())).toHaveLength(1)
    const result = await importManual(pdf('new'), metadata, upgraded)
    expect(result.manual.manualId).toBe('NMR-MAN-000004')
  })

  it('leaves v1 records and schema intact if an upgrade fails', async () => {
    const { databaseName, records } = await seedLegacy()
    const upgraded = database(databaseName)
    upgraded.manuals.hook('updating', () => { throw new Error('Simulated upgrade failure') })
    await expect(upgraded.open()).rejects.toThrow('Simulated upgrade failure')
    upgraded.close()
    const legacy = new Dexie(databaseName)
    opened.push(legacy)
    legacy.version(1).stores({ manuals: V1_SCHEMA })
    await legacy.open()
    expect(legacy.verno).toBe(1)
    expect(await legacy.table('manuals').count()).toBe(3)
    const saved = await legacy.table('manuals').get('b')
    expect(saved.manualId).toBeUndefined()
    expect(await saved.file.arrayBuffer()).toEqual(await records[0].file.arrayBuffer())
    expect(legacy.tables.map((table) => table.name)).toEqual(['manuals'])
  })

  it('resumes a partially completed hash pass and blocks imports until it finishes', async () => {
    const { databaseName } = await seedLegacy()
    const upgraded = database(databaseName)
    const digest = crypto.subtle.digest.bind(crypto.subtle)
    const spy = vi.spyOn(crypto.subtle, 'digest').mockImplementation(digest)
    spy.mockImplementationOnce(digest).mockRejectedValueOnce(new Error('Interrupted'))
    await expect(prepareLibrary(upgraded)).rejects.toThrow('Interrupted')
    expect((await upgraded.manuals.toArray()).filter((manual) => manual.fileHash)).toHaveLength(1)
    await expect(importManual(pdf('new'), metadata, upgraded)).rejects.toThrow('not ready')
    spy.mockClear()
    await prepareLibrary(upgraded)
    expect(spy).toHaveBeenCalledTimes(2)
    expect((await upgraded.manuals.toArray()).every((manual) => manual.fileHash?.length === 64)).toBe(true)
  })

  it('handles legacy records without a usable import date without inventing original metadata', async () => {
    const { databaseName } = await seedLegacy()
    const legacy = new Dexie(databaseName)
    opened.push(legacy)
    legacy.version(1).stores({ manuals: V1_SCHEMA })
    await legacy.table('manuals').update('a', { importedAt: undefined })
    legacy.close()
    const upgraded = database(databaseName)
    await upgraded.open()
    expect((await upgraded.manuals.get('a'))!.manualId).toBe('NMR-MAN-000001')
    expect((await upgraded.manuals.get('a'))!.importedAt).toBeUndefined()
    expect((await upgraded.manuals.get('a'))!.updatedAt).toBeTruthy()
  })
})

describe('library operations', () => {
  it('serializes IDs and duplicate checks across independent connections', async () => {
    const first = database()
    const second = database(first.name)
    await Promise.all([first.open(), second.open()])
    const results = await Promise.all([
      importManual(pdf('same'), metadata, first),
      importManual(new File([await pdf('same').arrayBuffer()], 'renamed.pdf'), metadata, second),
      importManual(pdf('different'), metadata, second),
    ])
    expect(results.filter((result) => result.status === 'duplicate')).toHaveLength(1)
    expect((await first.manuals.orderBy('manualId').toArray()).map((manual) => manual.manualId)).toEqual(['NMR-MAN-000001', 'NMR-MAN-000002'])
  })

  it('never reuses IDs after deleting even the entire library', async () => {
    const store = database()
    const first = await importManual(pdf('one'), metadata, store)
    await deleteManual(first.manual.id, store)
    const second = await importManual(pdf('one'), metadata, store)
    expect(second.status).toBe('imported')
    expect(second.manual.manualId).toBe('NMR-MAN-000002')
  })

  it('rolls back the counter when a write fails', async () => {
    const store = database()
    await store.open()
    const fail = () => { throw new Error('Simulated storage failure') }
    store.manuals.hook('creating', fail)
    await expect(importManual(pdf(), metadata, store)).rejects.toThrow('Simulated storage failure')
    expect(await store.manuals.count()).toBe(0)
    expect(await store.counters.get('manualId')).toBeUndefined()
    store.manuals.hook('creating').unsubscribe(fail)
    expect((await importManual(pdf(), metadata, store)).manual.manualId).toBe('NMR-MAN-000001')
  })

  it('edits only metadata, preserving identity, file contents, and import timestamp after reopening', async () => {
    const store = database()
    const original = (await importManual(pdf(), metadata, store)).manual
    await editManual(original.id, { ...metadata, title: '  Revised  ', deviceType: 'Tablet', documentCategory: 'Schematic' }, store)
    store.close()
    await store.open()
    const edited = (await store.manuals.get(original.id))!
    expect(edited).toMatchObject({ title: 'Revised', deviceType: 'Tablet', documentCategory: 'Schematic', id: original.id, manualId: original.manualId, fileHash: original.fileHash, importedAt: original.importedAt, fileName: original.fileName })
    expect(await edited.file.arrayBuffer()).toEqual(await original.file.arrayBuffer())
    await deleteManual(original.id, store)
    await expect(editManual(original.id, metadata, store)).rejects.toThrow('no longer exists')
    expect(await store.manuals.count()).toBe(0)
  })

  it('rejects empty titles, invalid classifications, and disguised non-PDF files without allocating IDs', async () => {
    const store = database()
    await expect(importManual(pdf(), { ...metadata, title: ' ' }, store)).rejects.toThrow('title')
    await expect(importManual(pdf(), { ...metadata, documentCategory: 'Unknown' as ManualMetadata['documentCategory'] }, store)).rejects.toThrow('valid')
    await expect(importManual(new File(['plain text'], 'fake.pdf', { type: 'application/pdf' }), metadata, store)).rejects.toThrow('PDF header')
    expect(await store.manuals.count()).toBe(0)
    expect(await store.counters.count()).toBe(0)
  })

  it('computes SHA-256 by file bytes', async () => {
    expect(await hashFile(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
})

describe('v1 backup and recovery', () => {
  it('does not create a database when checking an unused origin', async () => {
    const unused = name()
    expect(await hasLegacyLibrary(unused)).toBe(false)
    expect((await indexedDB.databases()).some((entry) => entry.name === unused)).toBe(false)
  })

  it('round-trips v1 metadata and PDF bytes and refuses to overwrite an existing library', async () => {
    const { databaseName, records } = await seedLegacy()
    expect(await hasLegacyLibrary(databaseName)).toBe(true)
    const backup = await createLegacyBackup(databaseName)
    const target = name()
    expect(await restoreLegacyBackup(await backup.text(), target)).toBe(3)
    expect(await hasLegacyLibrary(target)).toBe(true)
    const restored = new Dexie(target)
    opened.push(restored)
    restored.version(1).stores({ manuals: V1_SCHEMA })
    const saved = await restored.table('manuals').get('b')
    expect(saved.title).toBe(records[0].title)
    expect(await saved.file.arrayBuffer()).toEqual(await records[0].file.arrayBuffer())
    restored.close()
    await expect(restoreLegacyBackup(await backup.text(), target)).rejects.toThrow('already exists')
    const upgraded = database(target)
    await upgraded.open()
    await expect(restoreLegacyBackup(await backup.text(), target)).rejects.toThrow('never overwritten')
  })

  it('rejects damaged PDF data before creating a database', async () => {
    const { databaseName } = await seedLegacy()
    const backup = JSON.parse(await (await createLegacyBackup(databaseName)).text())
    backup.manuals[0].file.base64 = btoa('damaged')
    const target = name()
    await expect(restoreLegacyBackup(JSON.stringify(backup), target)).rejects.toThrow('integrity')
    expect(await hasLegacyLibrary(target)).toBe(false)
  })
})
