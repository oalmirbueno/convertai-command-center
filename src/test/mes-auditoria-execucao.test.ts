import { describe, expect, it, vi } from "vitest";
import { promptAtualDoMes, podeAplicarDireto, atualizarConfirmado } from "../../supabase/functions/agente-calendario/execucao-do-mes";
import { camposDoFormato, gravarPassosDoFormato, desfazerPassosDoFormato } from "../../supabase/functions/agente-calendario/mudanca-de-formato";
import { criarLoteNaAgenda } from "../../supabase/functions/agente-calendario/criar-lote-na-agenda";
import { normalizarAcoesNaAgenda, pecasComApelido } from "../../supabase/functions/agente-calendario/acoes-agenda";
import { modoDaPauta } from "@/components/mesa/modoDaPauta";

function banco(seed: Record<string, any[]>) {
  const tabelas = structuredClone(seed);
  let falhar = "";
  const db = { from(t: string) {
    let campos: any, filtros: Array<(r: any) => boolean> = [];
    const q: any = {
      update(v: any) { campos = v; return q; },
      eq(k: string, v: any) { filtros.push(r => { const a = k.includes("->>") ? r[k.split("->>")[0]]?.[k.split("->>")[1]] : r[k]; return typeof a === "object" && a !== null ? JSON.stringify(a) === v : a === v; }); return q; },
      is(k: string, v: any) { filtros.push(r => r[k] === v); return q; },
      order() { return q; }, limit() { return q; }, select() { return q; },
      then(ok: any, err: any) {
        if (campos && falhar === t) { falhar = ""; return Promise.resolve({ data: null, error: { message: "falhou" } }).then(ok, err); }
        const rows = (tabelas[t] || []).filter(r => filtros.every(f => f(r)));
        if (campos) rows.forEach(r => Object.assign(r, structuredClone(campos)));
        return Promise.resolve({ data: structuredClone(rows), error: null }).then(ok, err);
      },
    }; return q;
  }};
  return { db, tabelas, falharEm: (t: string) => { falhar = t; } };
}
const task = { id: "t", title: "Jardim", description: "Antes", delivery_type: "carousel", deleted_at: null };
const item = { task_id: "t", tema: "Jardim", formato: "carrossel", cards: [{ ordem: 1, texto: "x" }] };

describe("auditoria do mês: formato e execução real", () => {
  it("retira somente a limitação técnica antiga, preservando o briefing", () => {
    const p = "Use o tom do cliente. Não crie formatos além de carrossel e post estático. Não invente preços.";
    expect(promptAtualDoMes(p)).toContain("foto e vídeo rápido");
    expect(promptAtualDoMes(p)).toContain("Não invente preços.");
    expect(promptAtualDoMes("Só fotos neste cliente")).toBe("Só fotos neste cliente");
  });
  it("permite aplicar simples e impede exclusão, refazer ou ambiguidade automaticamente", () => {
    expect(podeAplicarDireto({ mudar_formato: [{}] })).toBe(true);
    for (const bloqueio of [{ apagar: [{}] }, { refazer: [{}] }, { escolher_um: { task_ids: ["t"] } }]) expect(podeAplicarDireto({ mudar_formato: [{}], ...bloqueio })).toBe(false);
    expect(podeAplicarDireto({ resumo: "feito" })).toBe(false);
  });
  it("foto e vídeo sobrevivem da ação até a escolha do Estúdio", () => {
    const pecas = pecasComApelido([{ ...task, due_date: "2026-10-12", status: "todo" }]);
    const foto = normalizarAcoesNaAgenda({ mudar_formato: [{ ref: "a1", formato: "carrossel de fotos", foto: { assunto: "Jardim antes e depois", quantidade: 2 } }] }, pecas)!.mudar_formato[0];
    expect(foto.formato_para).toBe("foto");
    const f = camposDoFormato(task, foto, item);
    expect(f.novo.formato).toBe("foto");
    expect(f.novo.foto.assunto).toContain("Jardim");
    expect(modoDaPauta(f.tarefa, { direcao: f.direcao })).toBe("fotos");
    const v = camposDoFormato(task, { formato_para: "video", video: { estilo: "jardim", prompt: "Compare o mesmo jardim" } }, item);
    expect(v.novo.video.estilo).toBe("jardim");
    expect(v.novo.cards).toEqual([]);
    expect(modoDaPauta(v.tarefa, { direcao: v.direcao })).toBe("video");
  });
  it("não relata sucesso se o banco não retornou uma linha", async () => {
    await expect(atualizarConfirmado({ select: async () => ({ data: [], error: null }) })).rejects.toThrow("não foi confirmada");
  });
  it("compensa falha entre proposta e tarefa, e desfaz o sucesso com os snapshots", async () => {
    const b = banco({ calendario_propostas: [{ id: "p", client_id: "c", itens: [item] }], tasks: [task] });
    const f = camposDoFormato(task, { formato_para: "video" }, item);
    const passos = [
      { tabela: "calendario_propostas", id: "p", antes: { itens: [item] }, depois: { itens: [f.novo] } },
      { tabela: "tasks", id: "t", antes: { delivery_type: "carousel" }, depois: { delivery_type: "video" } },
    ];
    b.falharEm("tasks");
    await expect(gravarPassosDoFormato(b.db, passos, "c")).rejects.toThrow("revertidas");
    expect(b.tabelas.calendario_propostas[0].itens).toEqual([item]);
    await gravarPassosDoFormato(b.db, passos, "c");
    expect(b.tabelas.tasks[0].delivery_type).toBe("video");
    await desfazerPassosDoFormato(b.db, passos, "c");
    expect(b.tabelas.tasks[0].delivery_type).toBe("carousel");
  });
});

describe("criar e gravar sem cobrar geração duplicada", () => {
  const mensagem = { id: "m", client_id: "c", anexos: [{ tipo: "criar_conteudos", itens: [{ data: "2026-10-12", formato: "video", tema: "Jardim", referencia: "Antes e depois" }], orientacao: "Realista" }] };
  it("marca gravado só após task_id, e não cria de novo ao repetir", async () => {
    const b = banco({ agente_mensagens: [mensagem], calendario_propostas: [] });
    const criar = vi.fn(async (_corpo: Record<string, any>) => ({ proposta: { id: "p" }, custo_usd: .1 }));
    const gravar = vi.fn(async () => ({ proposta: { id: "p", itens: [{ task_id: "t" }] }, faltam_na_agenda: 0 }));
    const r = await criarLoteNaAgenda(b.db, mensagem, 0, { criar, gravar });
    expect(r.gravado).toBe(true);
    expect(criar.mock.calls[0][0].pecas[0].formato).toBe("video");
    const novo = structuredClone(b.tabelas.agente_mensagens[0]);
    expect((await criarLoteNaAgenda(b.db, novo, 0, { criar, gravar })).ja_gravado).toBe(true);
    expect(criar).toHaveBeenCalledTimes(1);
  });
  it("retoma uma proposta persistida após falha, sem nova chamada de IA", async () => {
    const b = banco({ agente_mensagens: [mensagem], calendario_propostas: [{ id: "p", client_id: "c", parametros: { criacao_ref: "m:0" } }] });
    const criar = vi.fn();
    const gravar = vi.fn().mockRejectedValueOnce(new Error("falha de gravação")).mockResolvedValue({ proposta: { itens: [{ task_id: "t" }] } });
    await expect(criarLoteNaAgenda(b.db, mensagem, 0, { criar, gravar })).rejects.toThrow("falha");
    expect(b.tabelas.agente_mensagens[0].anexos[0].lotes[0].estado).toBe("pendente");
    const r = await criarLoteNaAgenda(b.db, structuredClone(b.tabelas.agente_mensagens[0]), 0, { criar, gravar });
    expect(r.gravado).toBe(true);
    expect(criar).not.toHaveBeenCalled();
  });
  it("bloqueia envio concorrente", async () => {
    const m: any = structuredClone(mensagem); m.anexos[0].lotes = { 0: { estado: "gerando", desde: new Date().toISOString() } };
    const b = banco({ agente_mensagens: [m], calendario_propostas: [] });
    const criar = vi.fn();
    await expect(criarLoteNaAgenda(b.db, m, 0, { criar, gravar: vi.fn() })).rejects.toThrow("já está sendo processado");
    expect(criar).not.toHaveBeenCalled();
  });
  it("não conclui um lote quando apenas parte das tarefas foi gravada", async () => {
    const m = structuredClone(mensagem);
    m.anexos[0].itens.push({ ...m.anexos[0].itens[0], data: "2026-10-14" });
    const b = banco({ agente_mensagens: [m], calendario_propostas: [{ id: "p", client_id: "c", parametros: { criacao_ref: "m:0" } }] });
    await expect(criarLoteNaAgenda(b.db, m, 0, { criar: vi.fn(), gravar: vi.fn(async () => ({ proposta: { itens: [{ task_id: "t" }] } })) })).rejects.toThrow("não foi todo gravado");
    expect(b.tabelas.agente_mensagens[0].anexos[0].lotes[0].estado).toBe("pendente");
  });
});
