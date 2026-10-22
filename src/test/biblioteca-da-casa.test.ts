import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { AGENTES_COM_BASE, ehDaCasa } from "../../supabase/functions/_shared/agentes-com-base";
import { BIBLIOTECA_DA_CASA, NOME_DA_FONTE_DA_CASA, urlDoDocumento, VERSAO_DA_BIBLIOTECA } from "../../supabase/functions/base-dos-agentes/biblioteca-da-casa";

// 23/10 (dono): "carregue de documentos e informações relevantes todos os agentes para evoluir".
const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");
const MIGRATION = "supabase/migrations/20261023110000_biblioteca_da_casa.sql";

describe("Biblioteca da casa", () => {
  it("todo agente da Base tem de 5 a 15 documentos da casa, versão 2026-10-23", () => {
    expect(VERSAO_DA_BIBLIOTECA).toBe("2026-10-23");
    expect(Object.keys(BIBLIOTECA_DA_CASA).sort()).toEqual(AGENTES_COM_BASE.map((a) => a.chave).sort());
    for (const [agente, docs] of Object.entries(BIBLIOTECA_DA_CASA)) {
      expect(docs.length, agente).toBeGreaterThanOrEqual(5);
      expect(docs.length, agente).toBeLessThanOrEqual(15);
      for (const d of docs) {
        expect(ehDaCasa(urlDoDocumento(agente, d.slug))).toBe(true);
        expect(d.tecnica.length, d.titulo).toBeLessThanOrEqual(2400);
      }
    }
  });

  it("o seed está na migration: fonte por agente, ficha geral por documento, idempotente e sem apagar nada", () => {
    const sql = ler(MIGRATION);
    expect(sql).toContain(`'${NOME_DA_FONTE_DA_CASA}'`);
    expect(sql).toContain("WHERE NOT EXISTS (SELECT 1 FROM public.agente_base_fichas x WHERE x.agente = d.agente AND x.fonte_url = d.fonte_url)");
    expect(sql).toContain("'casa_desligada'");
    expect(sql).not.toMatch(/\bDELETE\b|\bTRUNCATE\b|DROP TABLE/);
    for (const [agente, docs] of Object.entries(BIBLIOTECA_DA_CASA)) {
      for (const d of docs) expect(sql, d.slug).toContain(`'${urlDoDocumento(agente, d.slug)}'`);
    }
  });

  it("os documentos ficam no banco, não em _shared (limite do bundle)", () => {
    expect(ler("supabase/functions/base-dos-agentes/index.ts")).not.toContain("biblioteca-da-casa");
    expect(ler("supabase/functions/_shared/base-do-agente.ts")).not.toContain("biblioteca-da-casa");
  });

  it("na geração: no máximo 3 da casa por pedido, metade do teto, e o Jev avalia os da casa", () => {
    const g = ler("supabase/functions/_shared/base-do-agente.ts");
    expect(g).toContain("export const MAX_DA_CASA = 3;");
    expect(g).toContain("if (casa >= maxDaCasa || casaTotal + t > tetoDaCasa) continue;");
    expect(g).toContain("const daCasa = fichas.filter((f) => ehDaCasa(f.fonte_url)).slice(0, CASA_AVALIADA);");
    expect(g).toContain("client_id, fonte_url, aprovadas");
  });

  it("a função liga e desliga por agente, e a faxina não mexe na casa", () => {
    const f = ler("supabase/functions/base-dos-agentes/index.ts");
    expect(f).toContain("biblioteca_da_casa: bibliotecaDaCasa,");
    expect(f).toContain('arquivada_por: "casa_desligada"');
    expect(f).toContain('base.eq("arquivada_por", "casa_desligada")');
    expect(f).toContain(".filter((f) => !ehDaCasa(f.fonte_url))");
  });

  it("a tela marca \"Biblioteca da casa\" e tem a chave por agente", () => {
    const p = ler("src/pages/BaseDosAgentes.tsx");
    expect(p).toContain("data-biblioteca-da-casa=");
    expect(p).toContain("data-da-casa=\"\"");
    expect(p).toContain("await ligarBibliotecaDaCasa(agente.chave, v);");
    expect(p).toContain("Biblioteca desligada");
    expect(ler("src/components/base-dos-agentes/baseDosAgentesApi.ts")).toContain('acao: "biblioteca_da_casa"');
  });
});
