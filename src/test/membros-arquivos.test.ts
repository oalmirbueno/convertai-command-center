import { File as NodeFile } from "node:buffer";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { validarMaterial } from "@/lib/membros/arquivos";
beforeEach(() => vi.stubGlobal("File", NodeFile));
afterEach(() => vi.unstubAllGlobals());
describe("arquivos da biblioteca", () => {
  it("aceita PDF e recusa arquivo renomeado como PDF", async () => {
    await expect(
      validarMaterial(
        new File(["%PDF-1.7\nconteudo de teste"], "guia.pdf", {
          type: "application/pdf",
        }),
      ),
    ).resolves.toBe("application/pdf");
    await expect(
      validarMaterial(
        new File(["<html>arquivo disfarçado</html>"], "guia.pdf", {
          type: "application/pdf",
        }),
      ),
    ).rejects.toThrow("PDF válido");
  });
  it("recusa executáveis e tipos que não correspondem à extensão", async () => {
    await expect(
      validarMaterial(new File(["teste"], "codigo.js", { type: "text/plain" })),
    ).rejects.toThrow("executáveis");
    await expect(
      validarMaterial(
        new File(["teste"], "foto.svg", { type: "image/svg+xml" }),
      ),
    ).rejects.toThrow("executáveis");
    await expect(
      validarMaterial(new File(["teste"], "video.mp4", { type: "text/html" })),
    ).rejects.toThrow("executáveis");
  });
  it("não aceita pacote sem diretório verificável", async () => {
    await expect(
      validarMaterial(
        new File(["PKconteudo inválido"], "kit.zip", {
          type: "application/zip",
        }),
      ),
    ).rejects.toThrow("compactado inválido");
  });
});
