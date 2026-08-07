import { beforeEach, describe, expect, it, vi } from "vitest";

const readSheetMock = vi.hoisted(() => vi.fn());

vi.mock("read-excel-file/browser", () => ({
  readSheet: readSheetMock,
}));

import { parseFile } from "./adsParser";

function boundedZipEnvelope(uncompressedBytes = 4): ArrayBuffer {
  const bytes = new Uint8Array(68);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x02014b50, true);
  view.setUint32(20, 4, true);
  view.setUint32(24, uncompressedBytes, true);
  view.setUint32(46, 0x06054b50, true);
  view.setUint16(56, 1, true);
  view.setUint32(58, 46, true);
  view.setUint32(62, 0, true);
  return bytes.buffer;
}

describe("spreadsheet report parser", () => {
  beforeEach(() => {
    readSheetMock.mockReset();
  });

  it("parses a bounded XLSX workbook with the browser-only reader", async () => {
    readSheetMock.mockResolvedValue([
      ["Campaign", "Impressions", "Clicks", "Amount spent"],
      ["Launch", 1_000, 50, 125],
    ]);
    const bytes = boundedZipEnvelope();
    const file = {
      name: "ads.xlsx",
      size: bytes.byteLength,
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      arrayBuffer: async () => bytes,
    } as File;
    const parsed = await parseFile(file);

    expect(parsed.source).toBe("meta_ads");
    expect(parsed.metrics.impressions).toBe(1_000);
    expect(parsed.metrics.clicks).toBe(50);
    expect(parsed.metrics.ad_spend).toBe(125);
    expect(readSheetMock).toHaveBeenCalledOnce();
  });

  it("rejects oversized spreadsheet files before parsing", async () => {
    const oversized = new File(
      [new Uint8Array(15 * 1024 * 1024 + 1)],
      "oversized.xlsx",
    );

    await expect(parseFile(oversized)).rejects.toThrow("máximo 15 MB");
  });

  it("rejects the legacy XLS format explicitly", async () => {
    const legacy = new File(["legacy"], "report.xls");
    await expect(parseFile(legacy)).rejects.toThrow("CSV, TSV ou XLSX");
    expect(readSheetMock).not.toHaveBeenCalled();
  });

  it("applies file and matrix limits to CSV too", async () => {
    const oversized = new File(
      [new Uint8Array(15 * 1024 * 1024 + 1)],
      "oversized.csv",
    );
    await expect(parseFile(oversized)).rejects.toThrow("máximo 15 MB");

    const csv = Array.from({ length: 20_001 }, () => "a,b").join("\n");
    const tooManyRows = {
      name: "rows.csv",
      size: new TextEncoder().encode(csv).byteLength,
      text: async () => csv,
    } as File;
    await expect(parseFile(tooManyRows)).rejects.toThrow("limite seguro");
  });

  it("rejects an XLSX expansion bomb before workbook parsing", async () => {
    const archive = boundedZipEnvelope(51 * 1024 * 1024);
    const file = {
      name: "bomb.xlsx",
      size: archive.byteLength,
      arrayBuffer: async () => archive,
    } as File;
    await expect(parseFile(file)).rejects.toThrow("descompactado");
    expect(readSheetMock).not.toHaveBeenCalled();
  });
});
