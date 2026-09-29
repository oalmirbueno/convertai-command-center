import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: vi.fn() } } }));

// O jsdom não tem AbortSignal.timeout (o Deno e o Node têm): o Jev usa para o tempo limite.
if (typeof (AbortSignal as unknown as { timeout?: unknown }).timeout !== "function") {
  (AbortSignal as unknown as { timeout: (ms: number) => AbortSignal }).timeout = () => new AbortController().signal;
}

import { toast } from "sonner";
import CartaoDeAcao, { assinaturaDaAcao, maisAvancada } from "@/components/agentes/CartaoDeAcao";
import type { AcaoDoAgente } from "@/lib/agentes/acoesDoAgente";
import {
  anexosSeguros,
  blocoDaReferencia,
  gravarTroca,
  lerEscolha,
  pedidoAponta,
  referenciaDoPedido,
} from "../../supabase/functions/_shared/conversa-das-mesas";

/**
 * Frente AG2 (29/09): peças comuns dos agentes das mesas de mídia.
 * - a conversa grava pergunta e resposta sem perder a mensagem (anexos nunca null, erro nunca engolido);
 * - "essa", "a segunda", "todas" viram apelidos pelo Jev (Choice);
 * - o cartão de ação não volta a oferecer Confirmar depois de feito.
 */

// ------------------------------------------------------------------ gravarTroca

function servicoFalso(opcoes: { loteFalha?: boolean; linhaFalha?: string } = {}) {
  const chamadas: unknown[] = [];
  let n = 0;
  const servico = {
    from: (tabela: string) => ({
      insert: (linhas: unknown) => {
        chamadas.push({ tabela, linhas });
        const lista = Array.isArray(linhas) ? linhas : [linhas];
        const sel = {
          select: () => {
            if (Array.isArray(linhas)) {
              if (opcoes.loteFalha) return Promise.resolve({ data: null, error: { message: "null value in column \"anexos\"", code: "23502" } });
              return Promise.resolve({ data: lista.map((l) => ({ id: `id-${++n}`, papel: (l as { papel: string }).papel })), error: null });
            }
            return {
              single: () => {
                const papel = (lista[0] as { papel: string }).papel;
                if (opcoes.linhaFalha === papel) return Promise.resolve({ data: null, error: { message: "recusado" } });
                return Promise.resolve({ data: { id: `um-${papel}` }, error: null });
              },
            };
          },
        };
        return sel;
      },
    }),
  };
  return { servico, chamadas };
}

describe("gravarTroca", () => {
  it("grava as duas linhas com anexos sempre em lista (NOT NULL) e devolve o id da resposta", async () => {
    const { servico, chamadas } = servicoFalso();
    const r = await gravarTroca(servico, { conversaId: "c", clientId: "k", usuario: { conteudo: "oi" }, agente: { conteudo: "olá", anexos: [{ tipo: "acao_agente" }], uso_id: "u" }, onde: "teste", agora: 1000 });
    expect(r).toEqual({ usuarioId: "id-1", agenteId: "id-2", erro: null });
    const linhas = (chamadas[0] as { linhas: Array<Record<string, unknown>> }).linhas;
    expect(linhas[0].anexos).toEqual([]);
    expect(linhas[0].uso_id).toBeNull();
    expect(linhas[1].anexos).toEqual([{ tipo: "acao_agente" }]);
    expect(new Date(String(linhas[1].criado_em)).getTime() - new Date(String(linhas[0].criado_em)).getTime()).toBe(1);
  });

  it("quando o lote falha, tenta linha a linha uma vez (sem laço) e a resposta não se perde", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { servico, chamadas } = servicoFalso({ loteFalha: true });
    const r = await gravarTroca(servico, { conversaId: "c", clientId: "k", usuario: { conteudo: "oi" }, agente: { conteudo: "olá" }, onde: "teste" });
    expect(r).toEqual({ usuarioId: "um-usuario", agenteId: "um-agente", erro: null });
    expect(chamadas.length).toBe(3);
    expect(erro).toHaveBeenCalled();
    erro.mockRestore();
  });

  it("sem a linha do agente, devolve o motivo (a tela avisa) e nunca lança", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { servico } = servicoFalso({ loteFalha: true, linhaFalha: "agente" });
    const r = await gravarTroca(servico, { conversaId: "c", clientId: "k", usuario: { conteudo: "oi" }, agente: { conteudo: "olá" }, onde: "teste" });
    expect(r.agenteId).toBeNull();
    expect(r.erro).toMatch(/recusado/);
    erro.mockRestore();
  });

  it("anexosSeguros troca qualquer coisa que não é lista por []", () => {
    expect(anexosSeguros(null)).toEqual([]);
    expect(anexosSeguros(undefined)).toEqual([]);
    expect(anexosSeguros({})).toEqual([]);
    expect(anexosSeguros([1])).toEqual([1]);
  });
});

// ------------------------------------------------------------------ referência do pedido

const itens = [
  { ref: "a1", titulo: "Café na varanda" },
  { ref: "a2", titulo: "Escritório", detalhe: "4:5" },
  { ref: "a3", titulo: "No carro" },
];

describe("referenciaDoPedido", () => {
  it("só chama o Jev quando o pedido aponta sem dizer qual", async () => {
    const f = vi.fn();
    expect(pedidoAponta("gere a segunda")).toBe(true);
    expect(pedidoAponta("refaça essa")).toBe(true);
    expect(pedidoAponta("apague todas")).toBe(true);
    expect(pedidoAponta("gere uma foto de café")).toBe(false);
    expect(await referenciaDoPedido("gere uma foto de café", itens, { agente: "t", chave: "k", fetchImpl: f as unknown as typeof fetch })).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("manda os itens na ordem da tela como opções e lê a escolha", async () => {
    const f = vi.fn().mockResolvedValue(new Response(JSON.stringify({ answers: { alvo: { choice: "a2", confidence: 0.9, probabilities: { a2: 0.92, a1: 0.04 } } } }), { status: 200 }));
    const r = await referenciaDoPedido("troca a luz da segunda", itens, { agente: "diretor", chave: "k", fetchImpl: f as unknown as typeof fetch });
    expect(r).toEqual({ refs: ["a2"], alcance: "um", probabilidade: 0.92, incerta: false, fonte: "jev" });
    const corpo = JSON.parse(String((f.mock.calls[0][1] as RequestInit).body));
    expect(corpo.questions.alvo.type).toBe("choice");
    expect(Object.keys(corpo.questions.alvo.criteria)).toEqual(["a1", "a2", "a3", "todas_da_lista", "nenhum_item"]);
    expect(corpo.state.itens_na_ordem_da_tela[1]).toEqual(expect.objectContaining({ posicao: 2, apelido: "a2" }));
    expect(JSON.stringify(corpo)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  it("\"todas\" vira a lista inteira; \"nenhum\" e apelido fora da lista viram null", () => {
    expect(lerEscolha({ choice: "todas_da_lista", probabilities: { todas_da_lista: 0.8 } }, itens)).toEqual(expect.objectContaining({ refs: ["a1", "a2", "a3"], alcance: "todas" }));
    expect(lerEscolha({ choice: "nenhum_item", probabilities: { nenhum_item: 0.9 } }, itens)).toBeNull();
    expect(lerEscolha({ choice: "a9", probabilities: { a9: 0.9 } }, itens)).toBeNull();
  });

  it("sem Jev (erro de rede), o modelo decide sozinho: devolve null e não lança", async () => {
    const erro = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const f = vi.fn().mockRejectedValue(new Error("rede"));
    expect(await referenciaDoPedido("refaça essa", itens, { agente: "t", chave: "k", fetchImpl: f as unknown as typeof fetch })).toBeNull();
    erro.mockRestore();
  });

  it("bloco para o modelo: fato quando certo, pergunta curta quando incerto", () => {
    expect(blocoDaReferencia(null, itens)).toBe("");
    expect(blocoDaReferencia({ refs: ["a2"], alcance: "um", probabilidade: 0.9, incerta: false, fonte: "jev" }, itens)).toMatch(/a2 \("Escritório"\)/);
    expect(blocoDaReferencia({ refs: ["a2"], alcance: "um", probabilidade: 0.4, incerta: true, fonte: "jev" }, itens)).toMatch(/UMA pergunta curta/);
  });
});

// ------------------------------------------------------------------ cartão que não volta atrás

const proposta = (extra: Partial<AcaoDoAgente> = {}): AcaoDoAgente => ({
  tipo: "acao_agente",
  agente: "roteiros",
  id: "r-1",
  resumo: "Aprovar o roteiro.",
  itens: [{ ref: "r1", alvo_id: "x", titulo: "Roteiro 1", detalhe: null, operacao: "aprovar_roteiro", rotulo: "aprovar", para: null }],
  ignorados: [],
  recusados: [],
  ...extra,
});

describe("CartaoDeAcao não volta a oferecer Confirmar", () => {
  it("depois de confirmar, um re-render do pai com o MESMO anexo antigo (objeto novo) mantém \"Feito\"", async () => {
    const feita = proposta({ executada_em: "2026-09-29T12:00:00Z", resultados: [{ ref: "r1", alvo_id: "x", titulo: "Roteiro 1", operacao: "aprovar_roteiro", ok: true, desfazer: { tipo: "status" } }] });
    const onPedido = vi.fn().mockResolvedValue({ anexo: feita });
    const { rerender } = render(h(CartaoDeAcao, { acao: proposta(), onPedido }));
    fireEvent.click(screen.getByRole("button", { name: /Confirmar/ }));
    await waitFor(() => expect(document.querySelector("[data-acao-agente]")!.getAttribute("data-acao-agente")).toBe("feita"));
    // O pai re-renderiza (ex.: digitar no campo) e manda o anexo antigo como objeto novo.
    rerender(h(CartaoDeAcao, { acao: proposta(), onPedido }));
    expect(document.querySelector("[data-acao-agente]")!.getAttribute("data-acao-agente")).toBe("feita");
    expect(screen.queryByRole("button", { name: /Confirmar/ })).toBeNull();
    expect(onPedido).toHaveBeenCalledTimes(1);
  });

  it("remontar o cartão (lateral recolhida e aberta) com o anexo antigo também mantém \"Feito\"", async () => {
    const base = proposta({ id: "r-2" });
    const feita = { ...base, executada_em: "2026-09-29T12:00:00Z", resultados: [{ ref: "r1", alvo_id: "x", titulo: "Roteiro 1", operacao: "aprovar_roteiro", ok: true, desfazer: { tipo: "status" } }] };
    const onPedido = vi.fn().mockResolvedValue({ anexo: feita });
    const primeira = render(h(CartaoDeAcao, { acao: base, onPedido }));
    fireEvent.click(screen.getByRole("button", { name: /Confirmar/ }));
    await waitFor(() => expect(document.querySelector("[data-acao-agente]")!.getAttribute("data-acao-agente")).toBe("feita"));
    primeira.unmount();
    render(h(CartaoDeAcao, { acao: { ...base }, onPedido }));
    expect(document.querySelector("[data-acao-agente]")!.getAttribute("data-acao-agente")).toBe("feita");
    expect(screen.getByRole("button", { name: /Desfazer/ })).toBeTruthy();
  });

  it("anexo novo do servidor (conteúdo mudou) atualiza o cartão", () => {
    const { rerender } = render(h(CartaoDeAcao, { acao: proposta({ id: "r-3" }), onPedido: vi.fn() }));
    rerender(h(CartaoDeAcao, { acao: proposta({ id: "r-3", descartada_em: "2026-09-29T12:00:00Z" }), onPedido: vi.fn() }));
    expect(document.querySelector("[data-acao-agente]")!.getAttribute("data-acao-agente")).toBe("descartada");
  });

  it("maisAvancada escolhe o estado mais adiantado e a assinatura ignora a identidade do objeto", () => {
    const a = proposta({ id: "r-4" });
    const f = proposta({ id: "r-4", executada_em: "x", resultados: [] });
    expect(maisAvancada(a, f)).toBe(f);
    expect(maisAvancada(f, a)).toBe(f);
    expect(maisAvancada(a, proposta({ id: "outra" }))).toBe(a);
    expect(assinaturaDaAcao(proposta({ id: "r-4" }))).toBe(assinaturaDaAcao(proposta({ id: "r-4" })));
  });

  it("Desfazer com parte que não voltou avisa o que falhou (antes dizia \"Voltou como estava\")", async () => {
    const feita = proposta({ id: "r-5", executada_em: "2026-09-29T12:00:00Z", resultados: [{ ref: "r1", alvo_id: "x", titulo: "Roteiro 1", operacao: "aprovar_roteiro", ok: true, desfazer: { tipo: "status" } }] });
    const onPedido = vi.fn().mockResolvedValue({ anexo: { ...feita, desfeita_em: "2026-09-29T12:01:00Z" }, voltaram: 0, falharam: [{ ref: "r1", titulo: "Roteiro 1", motivo: "O roteiro mudou depois desta ação." }] });
    render(h(CartaoDeAcao, { acao: feita, onPedido }));
    fireEvent.click(screen.getByRole("button", { name: /Desfazer/ }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    expect(String((toast.warning as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1] && JSON.stringify((toast.warning as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][1]))).toMatch(/O roteiro mudou/);
  });
});
