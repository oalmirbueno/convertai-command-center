import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { gravarAnexosConfirmados, gravarSnapshotConfirmado } from "../../supabase/functions/agente-calendario/gravacao-confirmada";
import { contratoDoPedido, formatosAusentes, pecasNoEscopo } from "../../supabase/functions/agente-calendario/pedido-do-mes";

function transporte(respostas: any[]) {
  const pedidos: { url: string; body: any; method: string }[] = [];
  const fetch = vi.fn(async (input: any, init: any) => {
    pedidos.push({ url: String(input), body: init?.body ? JSON.parse(init.body) : null, method: init?.method || "GET" });
    return new Response(JSON.stringify(respostas.shift()), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  const db = createClient("https://teste.supabase.co", "anon-teste", { global: { fetch }, auth: { persistSession: false } });
  return { db, pedidos };
}
describe("Mês: transporte real do SDK, sem JSON no filtro", () => {
  it("grava cartão de 200 KB com filtro curto e revisão para concorrência", async () => {
    const b = transporte([[{ id: "m" }], []]);
    const antes = [{ tipo: "acao_agenda", editar_textos: [{ copy: "á".repeat(200_000) }] }];
    const depois = await gravarAnexosConfirmados(b.db, { id: "m", client_id: "c" }, antes, [{ ...antes[0], executando_em: "agora" }]);
    const url = new URL(b.pedidos[0].url);
    expect(url.href.length).toBeLessThan(2000);
    expect(url.searchParams.has("anexos")).toBe(false);
    expect(url.searchParams.get("anexos->0->>revisao_gravacao")).toBe("is.null");
    expect(b.pedidos[0].body.anexos[0].editar_textos[0].copy).toHaveLength(200_000);
    expect(depois[0].revisao_gravacao).toBeTruthy();
    await expect(gravarAnexosConfirmados(b.db, { id: "m", client_id: "c" }, antes, depois)).rejects.toThrow("não foi confirmada");
  });
  it("usa o timestamp real da proposta e compara JSON sem depender da ordem das chaves", async () => {
    const textos = "á".repeat(150_000), revisao = "2026-10-06T12:00:00.123456Z";
    const b = transporte([{ id: "p", atualizado_em: revisao, itens: [{ copy: textos, formato: "foto" }] }, [{ id: "p" }]]);
    await gravarSnapshotConfirmado(b.db, "calendario_propostas", "p", "c", { itens: [{ formato: "foto", copy: textos }] }, { itens: [{ formato: "video", copy: textos }] });
    const url = new URL(b.pedidos[1].url);
    expect(url.href.length).toBeLessThan(1000);
    expect(url.searchParams.get("atualizado_em")).toBe(`eq.${revisao}`);
    expect(url.searchParams.has("itens")).toBe(false);
    expect(b.pedidos[1].body.itens[0].formato).toBe("video");
  });
  it("não sobrescreve proposta que mudou nem grava sem timestamp", async () => {
    for (const row of [{ id: "p", atualizado_em: "hoje", itens: ["novo"] }, { id: "p", itens: ["antes"] }]) {
      const b = transporte([row]);
      await expect(gravarSnapshotConfirmado(b.db, "calendario_propostas", "p", "c", { itens: ["antes"] }, { itens: [] })).rejects.toThrow("mudou");
      expect(b.pedidos).toHaveLength(1);
    }
  });
});

describe("contrato do pedido do Mês", () => {
  it("todos os conteúdos fica no mês; só escopo explícito amplia", () => {
    const pecas = [{ due_date: "2026-10-12" }, { due_date: "2026-12-14" }, { due_date: null }];
    expect(pecasNoEscopo(pecas, "2026-10", false)).toEqual([pecas[0]]);
    expect(pecasNoEscopo(pecas, "2026-10", true)).toEqual(pecas);
    expect(contratoDoPedido({ outros_meses: { noul: .6 } }).outrosMeses).toBe(false);
    expect(contratoDoPedido({ outros_meses: { noul: .99 } }).outrosMeses).toBe(true);
  });
  it("cobrança de foto e vídeo exige ação de formato, não reescrita de título", () => {
    const contrato = contratoDoPedido({ quer_foto: { noul: .99 }, quer_video: { noul: .98 } });
    expect(formatosAusentes(contrato.formatos, { editar_textos: [{ titulo: "Foto e vídeo" }] }, null)).toEqual(["foto", "video"]);
    expect(formatosAusentes(contrato.formatos, { mudar_formato: [{ formato_para: "foto" }] }, { itens: [{ formato: "video" }] })).toEqual([]);
    expect(formatosAusentes(contrato.formatos, { mudar_formato: [{ formato_para: "carousel" }] }, null)).toEqual(["foto", "video"]);
  });
});
