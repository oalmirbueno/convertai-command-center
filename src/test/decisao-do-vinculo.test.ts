import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { eRuidoDoDiario, pedidoEmAberto, planoDaDecisao, registrarDecisaoDoDono, type ClienteDaDecisao } from "@/lib/decisaoDoVinculo";

/**
 * 26/10/2026 (diagnóstico): "Pode seguir" e "Aprovado: pode seguir" gravavam
 * instrução e devolviam o vínculo para `queued`; cada toque gerava ~100
 * comentários e um pedido de revisão novo. Agora: a decisão é gravada uma vez,
 * com metadata.reply_to_entry_id do pedido, e libera o dono sem reenfileirar.
 */

type Linha = Record<string, unknown>;
function clienteFalso(entradas: Linha[], opcoes: { semColuna?: boolean } = {}) {
  const inseridas: Linha[] = [];
  const rpc = vi.fn(async () => ({ data: { status: "in_progress" }, error: null }));
  const cliente: ClienteDaDecisao = {
    rpc,
    from: () => {
      const q: any = {};
      ["select", "eq", "order"].forEach((m) => (q[m] = () => q));
      q.limit = async () => ({ data: entradas, error: null });
      q.insert = async (linha: Linha) => {
        if (opcoes.semColuna && "metadata" in linha) return { data: null, error: { message: "Could not find the 'metadata' column of 'operator_participations' in the schema cache" } };
        inseridas.push(linha);
        return { data: null, error: null };
      };
      return q;
    },
  };
  return { cliente, rpc, inseridas };
}

const pedido = { id: "p-1", entry_type: "pedido_insumo", author_kind: "operador", created_at: "2026-10-26T10:00:00Z", body: "Preciso que confirme a verba." };
const ruido = { id: "r-1", entry_type: "comentario", author_kind: "operador", created_at: "2026-10-26T10:05:00Z", body: "Heartbeat: estado preservado, sem alteração." };
const base = { linkId: "l-1", autorId: "u-1", quem: "Almir", titulo: "Pode seguir", corpo: "Pode seguir com o seu melhor julgamento." };

describe("Pode seguir / Aprovado: decisão de verdade", () => {
  it("travado: devolve à fila do dono uma vez (queued, de onde os agentes pegam) e grava UMA decisão respondendo ao pedido", async () => {
    const { cliente, rpc, inseridas } = clienteFalso([ruido, pedido]);
    const r = await registrarDecisaoDoDono(cliente, { ...base, status: "blocked" });
    expect(rpc).toHaveBeenCalledTimes(1);
    const args = (rpc.mock.calls[0] as unknown as [string, Record<string, unknown>]);
    expect(args[0]).toBe("operator_human_action");
    expect(args[1]._new_status).toBe("queued");
    expect(inseridas).toHaveLength(1);
    expect(inseridas[0].entry_type).toBe("decisao");
    expect(inseridas[0].entry_type).not.toBe("instrucao");
    expect((inseridas[0].metadata as Record<string, unknown>).reply_to_entry_id).toBe("p-1");
    expect(r).toMatchObject({ liberou: true, repetida: false, respondeA: "p-1" });
  });

  it("já com quem executa: só registra (sem mexer na situação)", async () => {
    const { cliente, rpc, inseridas } = clienteFalso([pedido]);
    const r = await registrarDecisaoDoDono(cliente, { ...base, status: "in_progress" });
    expect(rpc).not.toHaveBeenCalled();
    expect(inseridas).toHaveLength(1);
    expect(r.liberou).toBe(false);
    expect(planoDaDecisao("queued").liberar).toBe(false);
  });

  it("toque repetido não grava de novo", async () => {
    const decisao = { id: "d-1", entry_type: "decisao", author_kind: "humano", created_at: "2026-10-26T10:10:00Z", title: "Pode seguir", metadata: { reply_to_entry_id: "p-1" } };
    const { cliente, rpc, inseridas } = clienteFalso([decisao, pedido]);
    const r = await registrarDecisaoDoDono(cliente, { ...base, status: "blocked" });
    expect(r.repetida).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
    expect(inseridas).toHaveLength(0);
  });

  it("banco ainda sem a coluna metadata: grava a decisão sem o vínculo da resposta", async () => {
    const { cliente, inseridas } = clienteFalso([pedido], { semColuna: true });
    const r = await registrarDecisaoDoDono(cliente, { ...base, status: "review", titulo: "Aprovado: pode seguir" });
    expect(r.semRespostaNoBanco).toBe(true);
    expect(inseridas).toHaveLength(1);
    expect(inseridas[0].entry_type).toBe("decisao");
  });

  it("pedido em aberto some depois da decisão do dono; ruído é reconhecido", () => {
    expect(pedidoEmAberto([pedido] as never)).toMatchObject({ id: "p-1" });
    expect(pedidoEmAberto([{ id: "d", entry_type: "decisao", author_kind: "humano", created_at: "x" }, pedido] as never)).toBeNull();
    expect(eRuidoDoDiario(ruido as never)).toBe(true);
    expect(eRuidoDoDiario(pedido as never)).toBe(false);
    expect(eRuidoDoDiario({ ...ruido, author_kind: "humano" } as never)).toBe(false);
  });

  it("a Execução usa a decisão única nos dois botões e mostra dono, espera e entrega", () => {
    const pagina = readFileSync(resolve(__dirname, "../..", "src/pages/AdminExecucao.tsx"), "utf8");
    const trecho = pagina.slice(pagina.indexOf("const decidirELiberar"), pagina.indexOf("const responderVinculo"));
    expect(trecho).toContain("registrarDecisaoDoDono(");
    expect(trecho).not.toContain('"queued"');
    expect(trecho).not.toContain('entry_type: "instrucao"');
    expect(pagina).toContain("<DonoDaTarefa linkId={v.id}");
    const diario = readFileSync(resolve(__dirname, "../..", "src/components/execucao/DiarioDaExecucao.tsx"), "utf8");
    expect(diario).toContain("eRuidoDoDiario(e)");
    expect(diario).toContain("Mostrar tudo (");
  });
});
