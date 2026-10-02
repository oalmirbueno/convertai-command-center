import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import type { ModeloIa } from "@/lib/mesa/api";
import { projetoDosTakes, type ProjetoDeEdicao } from "../../supabase/functions/_shared/projeto-de-edicao";

/**
 * 02/10, na tela do agente editor: a resposta é o que mudou de verdade (o
 * código conta), o texto do modelo que afirma sem ter feito não aparece, e o
 * atalho "Edição completa" monta o EDIT IA PRO inteiro sem modelo, na hora,
 * com Desfazer. O pedido de painel (trocar cenário) chega ao editor pela ponte.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    from: () => {
      const b: any = {};
      for (const m of ["select", "eq", "in", "order", "limit", "is", "not", "or"]) b[m] = () => b;
      b.then = (ok: any, f: any) => Promise.resolve({ data: [], error: null }).then(ok, f);
      return b;
    },
    storage: { from: () => ({ createSignedUrls: () => Promise.resolve({ data: [], error: null }) }) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

import AgenteEditor from "@/components/mesa-edicao/editor/AgenteEditor";
import type { ControleDePropostas } from "@/components/mesa-edicao/editor/PainelDeSkills";
import { ouvirPedidosDePainel, pedirPainel } from "@/components/mesa-edicao/editor/ponteDoAgente";
import { aplicarOperacao, trilhaPrincipal } from "@/lib/editor/operacoes";
import { retratoDoProjeto } from "@/lib/editor/relatorio";

const CLIENTE = "4dd691a7-d481-451f-800b-5e6b6fdc8721";
const VERSAO = "22222222-2222-4222-8222-222222222222";
const AGORA = "2026-10-02T15:00:00.000Z";

function projetoDaThaina(): ProjetoDeEdicao {
  const p = projetoDosTakes({
    titulo: "Thainá: rescisão",
    fps: 30,
    takes: [{ id: "t1", nome: "thaina-fala.mp4", tipo: "bruto", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/brutos/t1.mp4`, cena_ref: null, melhor: true, duracao_s: 30, largura: 1080, altura: 1920 }],
    agora: AGORA,
  });
  const frases = ["Você foi demitido e não sabe o que receber?", "Presta atenção!", "Existem 3 erros que as empresas cometem.", "Aviso prévio, férias e multa.", "Comenta DIREITOS que eu te explico."];
  const segmentos: { t: string; i: number; f: number }[] = [];
  let t = 0.4;
  frases.forEach((f) => {
    f.split(" ").forEach((w) => {
      segmentos.push({ t: w, i: Math.round(t * 1000) / 1000, f: Math.round((t + 0.3) * 1000) / 1000 });
      t += 0.36;
    });
    t += 0.9;
  });
  return aplicarOperacao(p, { op: "transcricao", fonte: "thaina-fala", transcricao: { segmentos, por_palavra: true, origem: "teste", versao: 1, em: AGORA } });
}

const modelo: ModeloIa = { id: "openrouter:openai/gpt-6-luna", provedor: "openrouter", modelo_api: "openai/gpt-6-luna", tipo: "texto", rotulo: "GPT-6 Luna", preco_entrada_1m: 0.1, preco_saida_1m: 0.5, preco_cache_1m: null, preco_imagem: null, raciocinio: null, padrao_para: ["diretor_arte"], ativo: true } as unknown as ModeloIa;
const valor = (): MesaValor =>
  ({ clientId: CLIENTE, clientName: "Thainá", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 10, catalogo: [modelo], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn() }) as unknown as MesaValor;
const corpos = (acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === "editor-video" && c[1].body.acao === acao).map((c: any[]) => c[1].body);

function responder(mapa: Record<string, unknown | ((b: any) => unknown)>) {
  mock.invoke.mockImplementation((_f: string, { body }: any) => {
    const r = mapa[body.acao];
    const data = typeof r === "function" ? (r as (b: any) => unknown)(body) : r;
    return Promise.resolve({ data: data === undefined ? {} : data, error: null });
  });
}

function controleDeVerdade(inicial: ProjetoDeEdicao) {
  const estado = { projeto: inicial, passos: 0 };
  const controle: ControleDePropostas = {
    aplicar: (prop) => {
      estado.projeto = prop.resultado;
      estado.passos++;
      return true;
    },
    desfazer: () => {
      estado.projeto = inicial;
      return true;
    },
  };
  return { estado, controle };
}

function montar(p: ProjetoDeEdicao, controle: ControleDePropostas) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(TooltipProvider, null, h(MesaProvider, { valor: valor(), children: h(AgenteEditor, { projeto: p, controle, onAplicarProjeto: vi.fn(), urls: {}, versaoId: VERSAO, selecao: [], cursor: () => 0 }) })))),
  );
}

const passo = (x: Record<string, unknown>) => ({ passo: { plano: "", chamadas: [], resposta: "", terminou: true, recusadas: [], opcoes: [], ...x }, gasto_usd: 0.002 });

beforeEach(() => {
  vi.clearAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

describe("tela: o agente não afirma o que não fez", () => {
  it("modelo diz 'pus legendas', sem ferramenta: a tela diz que nada mudou e não mostra a afirmação", async () => {
    const p = projetoDaThaina();
    const { estado, controle } = controleDeVerdade(p);
    responder({ conversa_ler: { mensagens: [] }, agente_passo: passo({ resposta: "Pus legendas na cor da marca e cortei os silêncios." }), conversa_gravar: { mensagem_id: "33333333-3333-4333-8333-333333333333" } });
    montar(p, controle);
    const campo = await screen.findByRole("textbox", { name: "Pedido para o agente editor" });
    fireEvent.change(campo, { target: { value: "deixa a cor mais quente" } });
    fireEvent.click(screen.getByRole("button", { name: "Mandar para o agente" }));
    await waitFor(() => expect(screen.getAllByText(/Nada mudou na linha do tempo/).length).toBeGreaterThan(0));
    expect(screen.queryByText(/Pus legendas na cor da marca/)).toBeNull();
    expect(estado.passos).toBe(0);
    // Pedido de edição sem mudança: o laço lembrou o modelo uma vez (2 passos), sem inventar edição.
    expect(corpos("agente_passo")).toHaveLength(2);
  }, 20000);
});

describe("tela: atalho Edição completa (EDIT IA PRO sem modelo)", () => {
  it("monta a edição inteira na hora, com Desfazer, e a resposta é o relatório do código", async () => {
    const p = projetoDaThaina();
    const { estado, controle } = controleDeVerdade(p);
    responder({ conversa_ler: { mensagens: [] }, conversa_gravar: { mensagem_id: "33333333-3333-4333-8333-333333333333" } });
    montar(p, controle);
    const botao = await screen.findByRole("button", { name: "Edição completa" });
    await waitFor(() => expect(botao.hasAttribute("disabled")).toBe(false));
    fireEvent.click(botao);
    await waitFor(() => expect(estado.passos).toBe(1), { timeout: 8000 });
    expect(corpos("agente_passo")).toHaveLength(0);
    const r = retratoDoProjeto(estado.projeto);
    expect(r.legendas).toBeGreaterThan(5);
    expect(r.zooms).toBeGreaterThan(0);
    expect(trilhaPrincipal(estado.projeto)!.clipes.length).toBeGreaterThan(1);
    expect(screen.getAllByText(/Mudei: Corte: duração/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Desfazer" })).toBeTruthy();
  }, 20000);
});

describe("ponte: o agente abre painel no editor", () => {
  it("o pedido de painel chega a quem ouve, só do mesmo cliente", () => {
    const recebidos: unknown[] = [];
    const parar = ouvirPedidosDePainel((cid, x) => cid === CLIENTE && recebidos.push(x));
    pedirPainel(CLIENTE, { aba: "cenario", clipe: "v1", cenario: "escritório" });
    pedirPainel("outro", { aba: "timestamp" });
    parar();
    pedirPainel(CLIENTE, { aba: "cor" });
    expect(recebidos).toEqual([{ aba: "cenario", clipe: "v1", cenario: "escritório" }]);
  });
});
