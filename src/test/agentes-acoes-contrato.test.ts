import { describe, expect, it, vi } from "vitest";
import {
  acaoGuardadaNaMensagem,
  apelidoDoTipo,
  blocoDosAlvos,
  comApelido,
  confirmarAcaoGuardada,
  desfazerAcaoGuardada,
  esquemaDasAcoes,
  executarItemAItem,
  normalizarAcaoDoAgente,
  type RegraDaOperacao,
} from "../../supabase/functions/_shared/acoes-do-agente";
import { acaoDoAnexo, acoesDaMensagem, estadoDaAcao } from "@/lib/agentes/acoesDoAgente";

/**
 * Contrato comum das ações dos agentes (25/09 à noite): apelido no lugar de
 * UUID, lista exata antes de fazer, travas com motivo, execução item a item e
 * Desfazer. Modelo: o agente do mês na agenda (agente-mes-acoes-agenda.test.ts).
 */

const UUID_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const UUID_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const UUID_C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const alvos = comApelido(
  [
    { id: UUID_A, titulo: "Foto da fachada", detalhe: "pasta Loja", dados: { travada: false } },
    { id: UUID_B, titulo: "Foto aprovada pelo cliente", detalhe: "pasta Loja", dados: { travada: true } },
    { id: UUID_C, titulo: "Logo antiga", detalhe: null, dados: { travada: false } },
  ],
  "f",
);

const regras: Record<string, RegraDaOperacao> = {
  arquivar: { rotulo: "arquivar", trava: (a) => (a.dados && a.dados.travada ? "A aprovação do cliente não pode sumir." : null) },
  mover: { rotulo: "mover", combina: true, para: (bruto) => (typeof bruto === "string" && bruto.trim() ? bruto.trim() : null) },
  renomear: { rotulo: "renomear", combina: true, para: (bruto) => (typeof bruto === "string" && bruto.trim() ? bruto.trim() : null) },
};

describe("contrato comum das ações dos agentes", () => {
  it("apelidos curtos e o bloco do prompt nunca leva o id", () => {
    expect(alvos.map((a) => a.ref)).toEqual(["f1", "f2", "f3"]);
    const bloco = blocoDosAlvos("FOTOS", alvos);
    expect(bloco).toContain("f1 | Foto da fachada | pasta Loja");
    expect(bloco).not.toContain(UUID_A);
    expect(apelidoDoTipo("f12", ["f"])).toBe(true);
    expect(apelidoDoTipo("l1", ["f"])).toBe(false);
    expect(apelidoDoTipo("f1a", ["f"])).toBe(false);
  });

  it("troca apelido por id e recusa apelido inventado, repetido ou UUID escrito pelo modelo", () => {
    const a = normalizarAcaoDoAgente(
      { resumo: "Arquivar fotos.", itens: [{ operacao: "arquivar", ref: "F1", para: "" }, { operacao: "arquivar", ref: "f9", para: "" }, { operacao: "arquivar", ref: "f1", para: "" }, { operacao: "arquivar", ref: UUID_C, para: "" }] },
      alvos,
      regras,
      { agente: "teste", id: "x1" },
    );
    expect(a).not.toBeNull();
    expect(a!.itens.map((i) => i.alvo_id)).toEqual([UUID_A]);
    expect(a!.ignorados).toEqual(["f9", "f1", UUID_C.slice(0, 12)]);
    expect(a!.tipo).toBe("acao_agente");
    expect(a!.resumo).toBe("Arquivar fotos.");
  });

  it("a trava tira o item da lista e diz o motivo", () => {
    const a = normalizarAcaoDoAgente({ resumo: "", itens: [{ operacao: "arquivar", ref: "f2", para: "" }, { operacao: "arquivar", ref: "f3", para: "" }] }, alvos, regras, { agente: "teste" });
    expect(a!.itens.map((i) => i.ref)).toEqual(["f3"]);
    expect(a!.recusados).toEqual([{ ref: "f2", titulo: "Foto aprovada pelo cliente", operacao: "arquivar", motivo: "A aprovação do cliente não pode sumir." }]);
    expect(a!.resumo).toContain("arquivar 1 item");
  });

  it("operação que não combina fica sozinha no alvo; as que combinam se juntam", () => {
    const a = normalizarAcaoDoAgente(
      {
        resumo: "",
        itens: [
          { operacao: "mover", ref: "f1", para: "Loja / Fachada" },
          { operacao: "renomear", ref: "f1", para: "fachada.jpg" },
          { operacao: "arquivar", ref: "f1", para: "" },
          { operacao: "arquivar", ref: "f3", para: "" },
          { operacao: "mover", ref: "f3", para: "Outra" },
          { operacao: "mover", ref: "f1", para: "Outra" },
          { operacao: "apagar_de_vez", ref: "f1", para: "" },
          { operacao: "renomear", ref: "f3", para: "   " },
        ],
      },
      alvos,
      regras,
      { agente: "teste" },
    );
    expect(a!.itens.map((i) => `${i.operacao}:${i.ref}`)).toEqual(["mover:f1", "renomear:f1", "arquivar:f3"]);
    expect(a!.ignorados).toEqual(["f1", "f3", "f1", "f1", "f3"]);
  });

  it("prefixo de alvo: a operação só vale para o tipo certo", () => {
    const mistos = [...alvos, { id: "1", titulo: "Lâmina 1", ref: "l1", dados: {} }];
    const a = normalizarAcaoDoAgente(
      { resumo: "", itens: [{ operacao: "refazer", ref: "f1", para: "" }, { operacao: "refazer", ref: "l1", para: "" }] },
      mistos,
      { refazer: { rotulo: "refazer", alvos: ["l"] } },
      { agente: "teste" },
    );
    expect(a!.itens.map((i) => i.ref)).toEqual(["l1"]);
    expect(a!.ignorados).toEqual(["f1"]);
  });

  it("sem nada para confirmar, null; o esquema pede operacao, ref e para", () => {
    expect(normalizarAcaoDoAgente(null, alvos, regras, { agente: "t" })).toBeNull();
    expect(normalizarAcaoDoAgente({ resumo: "x", itens: [{ operacao: "arquivar", ref: "f99", para: "" }] }, alvos, regras, { agente: "t" })).toBeNull();
    const e = esquemaDasAcoes(["arquivar"]) as any;
    expect(e.type).toEqual(["object", "null"]);
    expect(e.properties.itens.items.required).toEqual(["operacao", "ref", "para"]);
    expect(e.properties.itens.items.properties.operacao.enum).toEqual(["arquivar"]);
  });

  it("executa item a item: o que falha volta com o motivo e não para os outros", async () => {
    const a = normalizarAcaoDoAgente({ resumo: "", itens: [{ operacao: "arquivar", ref: "f1", para: "" }, { operacao: "arquivar", ref: "f3", para: "" }] }, alvos, regras, { agente: "t" })!;
    const r = await executarItemAItem(a.itens, async (it) => {
      if (it.ref === "f3") throw new Error("Esta foto não está mais no acervo.");
      return { desfazer: { ativa: true } };
    });
    expect(r).toEqual([
      { ref: "f1", alvo_id: UUID_A, titulo: "Foto da fachada", operacao: "arquivar", ok: true, desfazer: { ativa: true } },
      { ref: "f3", alvo_id: UUID_C, titulo: "Logo antiga", operacao: "arquivar", ok: false, motivo: "Esta foto não está mais no acervo." },
    ]);
  });
});

/** Banco de mentira: uma linha de agente_mensagens com a proposta nos anexos. */
function bancoFalso(anexos: unknown[], clientId = "cliente-1") {
  const linha = { id: "11111111-1111-4111-8111-111111111111", client_id: clientId, conversa_id: "conv", anexos };
  const updates: unknown[] = [];
  const servico = {
    from: () => {
      const b: any = {};
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = () => Promise.resolve({ data: linha, error: null });
      b.update = (v: any) => {
        updates.push(v);
        linha.anexos = v.anexos;
        const u: any = { eq: () => u, then: (ok: any) => Promise.resolve({ error: null }).then(ok) };
        return u;
      };
      return b;
    },
  };
  return { servico, linha, updates };
}

describe("proposta guardada na mensagem: confirmar, cancelar e desfazer", () => {
  const proposta = () => normalizarAcaoDoAgente({ resumo: "", itens: [{ operacao: "arquivar", ref: "f1", para: "" }] }, alvos, regras, { agente: "foto", id: "p1" })!;

  it("confere o acesso ao cliente antes de tudo", async () => {
    const { servico } = bancoFalso([proposta()]);
    const negar = vi.fn(async () => {
      throw new Error("sem acesso");
    });
    await expect(acaoGuardadaNaMensagem(servico, "11111111-1111-4111-8111-111111111111", negar)).rejects.toThrow("sem acesso");
    expect(negar).toHaveBeenCalledWith("cliente-1");
    await expect(acaoGuardadaNaMensagem(servico, "nao-e-uuid", async () => undefined)).rejects.toThrow("UUID");
  });

  it("confirmar executa uma vez, grava o resultado e depois dá para desfazer", async () => {
    const { servico, linha } = bancoFalso([{ tipo: "plano" }, proposta()]);
    const g = await acaoGuardadaNaMensagem(servico, linha.id, async () => undefined, { acaoId: "p1", agente: "foto" });
    const exec = vi.fn(async () => ({ desfazer: { ativa: true } }));
    const r = await confirmarAcaoGuardada(g, exec, { userId: "u1" });
    expect(exec).toHaveBeenCalledTimes(1);
    expect(r.anexo.executada_em).toBeTruthy();
    expect((linha.anexos as any[])[0]).toEqual({ tipo: "plano" });
    expect(estadoDaAcao(acaoDoAnexo((linha.anexos as any[])[1])!)).toBe("feita");

    const de2 = await acaoGuardadaNaMensagem(servico, linha.id, async () => undefined);
    await expect(confirmarAcaoGuardada(de2, exec, { userId: "u1" })).rejects.toThrow("já foi feita");

    const reverter = vi.fn(async () => undefined);
    const d = await desfazerAcaoGuardada(de2, reverter, { userId: "u1" });
    expect(reverter).toHaveBeenCalledTimes(1);
    expect(d.voltaram).toBe(1);
    expect(estadoDaAcao(d.anexo)).toBe("desfeita");
  });

  it("cancelar não executa nada", async () => {
    const { servico, linha } = bancoFalso([proposta()]);
    const g = await acaoGuardadaNaMensagem(servico, linha.id, async () => undefined);
    const exec = vi.fn();
    const r = await confirmarAcaoGuardada(g, exec as any, { userId: "u1", descartar: true });
    expect(exec).not.toHaveBeenCalled();
    expect(estadoDaAcao(r.anexo)).toBe("descartada");
    await expect(desfazerAcaoGuardada(await acaoGuardadaNaMensagem(servico, linha.id, async () => undefined), vi.fn(), { userId: "u1" })).rejects.toThrow("ainda não foi feita");
  });

  it("a tela lê as propostas dos anexos", () => {
    const lidas = acoesDaMensagem([{ tipo: "mudancas" }, proposta(), null, { tipo: "acao_agente", id: "p2", itens: "x" }]);
    expect(lidas.map((a) => a.id)).toEqual(["p1", "p2"]);
    expect(lidas[1].itens).toEqual([]);
  });
});
