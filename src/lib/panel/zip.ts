/**
 * A ZIP archive of stored (uncompressed) files, written in the panel.
 *
 * Enough of the format (APPNOTE 6.3.x, method 0) for an evidence bundle: the
 * files are already compressed images or short Markdown, so deflating them
 * would cost code and time for little. Names are UTF-8 (general purpose bit
 * 11), so a page title in any script survives. No dependency, no network.
 */

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export interface ZipEntry {
  /** A relative path inside the archive, `/`-separated. */
  name: string
  bytes: Uint8Array
}

/** MS-DOS date and time, as ZIP stores them; local time, two-second steps. */
function dosDateTime(at: Date): { time: number; date: number } {
  const year = Math.max(1980, at.getFullYear())
  return {
    time: (at.getHours() << 11) | (at.getMinutes() << 5) | Math.floor(at.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((at.getMonth() + 1) << 5) | at.getDate(),
  }
}

/** A path that cannot climb out of the folder it is unpacked in. */
export function safeEntryName(name: string): string {
  const parts = name
    .replace(/\\/g, "/")
    .split("/")
    .map((part) => part.replace(/[\u0000-\u001f<>:"|?*]/g, "_").trim())
    .filter((part) => part && part !== "." && part !== "..")
  return parts.join("/") || "file"
}

export function zipStore(entries: readonly ZipEntry[], at: Date = new Date()): Uint8Array {
  const encoder = new TextEncoder()
  const { time, date } = dosDateTime(at)
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0
  for (const entry of entries) {
    const name = encoder.encode(safeEntryName(entry.name))
    const crc = crc32(entry.bytes)
    const size = entry.bytes.byteLength
    const local = new Uint8Array(30 + name.byteLength)
    const view = new DataView(local.buffer)
    view.setUint32(0, 0x04034b50, true)
    view.setUint16(4, 20, true) // version needed
    view.setUint16(6, 0x0800, true) // UTF-8 names
    view.setUint16(8, 0, true) // stored
    view.setUint16(10, time, true)
    view.setUint16(12, date, true)
    view.setUint32(14, crc, true)
    view.setUint32(18, size, true)
    view.setUint32(22, size, true)
    view.setUint16(26, name.byteLength, true)
    view.setUint16(28, 0, true)
    local.set(name, 30)
    locals.push(local, entry.bytes)

    const central = new Uint8Array(46 + name.byteLength)
    const cview = new DataView(central.buffer)
    cview.setUint32(0, 0x02014b50, true)
    cview.setUint16(4, 20, true) // made by
    cview.setUint16(6, 20, true) // needed
    cview.setUint16(8, 0x0800, true)
    cview.setUint16(10, 0, true)
    cview.setUint16(12, time, true)
    cview.setUint16(14, date, true)
    cview.setUint32(16, crc, true)
    cview.setUint32(20, size, true)
    cview.setUint32(24, size, true)
    cview.setUint16(28, name.byteLength, true)
    cview.setUint32(42, offset, true)
    central.set(name, 46)
    centrals.push(central)
    offset += local.byteLength + size
  }
  const centralSize = centrals.reduce((sum, part) => sum + part.byteLength, 0)
  const end = new Uint8Array(22)
  const eview = new DataView(end.buffer)
  eview.setUint32(0, 0x06054b50, true)
  eview.setUint16(8, entries.length, true)
  eview.setUint16(10, entries.length, true)
  eview.setUint32(12, centralSize, true)
  eview.setUint32(16, offset, true)
  const parts = [...locals, ...centrals, end]
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.byteLength, 0))
  let at2 = 0
  for (const part of parts) {
    out.set(part, at2)
    at2 += part.byteLength
  }
  return out
}

/** Unpack what {@link zipStore} wrote; for tests and for checking a bundle. */
export function readStoredZip(bytes: Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder()
  const entries: ZipEntry[] = []
  let at = 0
  while (at + 30 <= bytes.byteLength && view.getUint32(at, true) === 0x04034b50) {
    const size = view.getUint32(at + 18, true)
    const nameLength = view.getUint16(at + 26, true)
    const extra = view.getUint16(at + 28, true)
    const name = decoder.decode(bytes.subarray(at + 30, at + 30 + nameLength))
    const start = at + 30 + nameLength + extra
    const data = bytes.slice(start, start + size)
    if (crc32(data) !== view.getUint32(at + 14, true)) throw new Error(`bad crc for ${name}`)
    entries.push({ name, bytes: data })
    at = start + size
  }
  return entries
}
