import { crc32, readStoredZip, safeEntryName, zipStore } from "./zip"

describe("zipStore", () => {
  it("computes the standard CRC-32", () => {
    expect(crc32(new TextEncoder().encode("123456789"))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array())).toBe(0)
  })

  it("writes a stored archive whose entries read back byte for byte", () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 255])
    const archive = zipStore(
      [
        { name: "notes — 页面.md", bytes: new TextEncoder().encode("# Hi\n") },
        { name: "attachments/shot.png", bytes: png },
      ],
      new Date(2026, 10, 19, 10, 30, 0)
    )
    const view = new DataView(archive.buffer)
    // Local header, UTF-8 names, stored.
    expect(view.getUint32(0, true)).toBe(0x04034b50)
    expect(view.getUint16(6, true)).toBe(0x0800)
    expect(view.getUint16(8, true)).toBe(0)
    // End of central directory: two entries.
    const end = archive.byteLength - 22
    expect(view.getUint32(end, true)).toBe(0x06054b50)
    expect(view.getUint16(end + 10, true)).toBe(2)
    const entries = readStoredZip(archive)
    expect(entries.map((entry) => entry.name)).toEqual(["notes — 页面.md", "attachments/shot.png"])
    expect(new TextDecoder().decode(entries[0]!.bytes)).toBe("# Hi\n")
    expect([...entries[1]!.bytes]).toEqual([...png])
  })

  it("never names a path outside the folder it unpacks into", () => {
    expect(safeEntryName("../../etc/passwd")).toBe("etc/passwd")
    expect(safeEntryName("C:\\a\\..\\b.png")).toBe("C_/a/b.png")
    expect(safeEntryName("a/./b?.png")).toBe("a/b_.png")
    expect(safeEntryName("..")).toBe("file")
  })
})
