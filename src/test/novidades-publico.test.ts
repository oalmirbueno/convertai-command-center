import { describe, expect, it } from "vitest";
import {
  RELEASE_NOTES,
  agruparPorMes,
  filtrarPorPublico,
  novidadesPara,
  veTodasAsNovidades,
  type ReleaseEntry,
} from "@/lib/releaseNotes";

/**
 * Novidades por público (19/11/2026): o cliente só lê o que mudou para ele;
 * a equipe lê tudo. Toda entrada diz para quem é.
 */
describe("Novidades: público de cada entrada", () => {
  it("toda entrada tem publico cliente ou equipe", () => {
    expect(RELEASE_NOTES.length).toBeGreaterThan(0);
    for (const entrada of RELEASE_NOTES) {
      expect(["cliente", "equipe"], entrada.id).toContain(entrada.publico);
    }
  });

  it("existem entradas dos dois públicos", () => {
    expect(RELEASE_NOTES.some((e) => e.publico === "cliente")).toBe(true);
    expect(RELEASE_NOTES.some((e) => e.publico === "equipe")).toBe(true);
  });

  it("o cliente nunca recebe entrada da equipe", () => {
    const doCliente = novidadesPara("client");
    expect(doCliente.length).toBeGreaterThan(0);
    expect(doCliente.every((e) => e.publico === "cliente")).toBe(true);
    expect(doCliente.length).toBe(RELEASE_NOTES.filter((e) => e.publico === "cliente").length);
  });

  it("sem papel conhecido (carregando, membro) também só vê as do cliente", () => {
    for (const papel of [undefined, null, "", "member", "qualquer"]) {
      expect(veTodasAsNovidades(papel)).toBe(false);
      expect(novidadesPara(papel).every((e) => e.publico === "cliente")).toBe(true);
    }
  });

  it("admin e equipe veem todas", () => {
    for (const papel of ["admin", "manager", "design", "traffic"]) {
      expect(veTodasAsNovidades(papel)).toBe(true);
      expect(novidadesPara(papel)).toHaveLength(RELEASE_NOTES.length);
    }
  });

  it("o filtro da equipe separa Para clientes e Da equipe", () => {
    const amostra: ReleaseEntry[] = [
      { id: "a", date: "2026-11-02", status: "no-ar", publico: "cliente", title: "A", summary: "", items: [] },
      { id: "b", date: "2026-11-01", status: "no-ar", publico: "equipe", title: "B", summary: "", items: [] },
    ];
    expect(filtrarPorPublico(amostra, "todas").map((e) => e.id)).toEqual(["a", "b"]);
    expect(filtrarPorPublico(amostra, "cliente").map((e) => e.id)).toEqual(["a"]);
    expect(filtrarPorPublico(amostra, "equipe").map((e) => e.id)).toEqual(["b"]);
    expect(novidadesPara("client", amostra).map((e) => e.id)).toEqual(["a"]);
  });
});

describe("Novidades: ordem, datas e texto", () => {
  it("mais nova primeiro", () => {
    for (let i = 1; i < RELEASE_NOTES.length; i++) {
      expect(RELEASE_NOTES[i - 1].date >= RELEASE_NOTES[i].date, RELEASE_NOTES[i].id).toBe(true);
    }
  });

  it("ids únicos, datas válidas e nada no futuro de quando foi escrito", () => {
    const ids = new Set(RELEASE_NOTES.map((e) => e.id));
    expect(ids.size).toBe(RELEASE_NOTES.length);
    for (const e of RELEASE_NOTES) {
      expect(e.date, e.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.date <= "2026-11-19", e.id).toBe(true);
    }
  });

  it("sem travessão e com pelo menos um item", () => {
    for (const e of RELEASE_NOTES) {
      const texto = [e.title, e.summary, ...e.items.flatMap((i) => [i.title, i.description])].join(" ");
      expect(texto.includes("—"), e.id).toBe(false);
      expect(e.items.length, e.id).toBeGreaterThan(0);
    }
  });

  it("agrupa por mês na ordem da lista", () => {
    const meses = agruparPorMes(RELEASE_NOTES);
    expect(meses[0].chave).toBe(RELEASE_NOTES[0].date.slice(0, 7));
    expect(meses.reduce((n, m) => n + m.entradas.length, 0)).toBe(RELEASE_NOTES.length);
    expect(new Set(meses.map((m) => m.chave)).size).toBe(meses.length);
  });
});
