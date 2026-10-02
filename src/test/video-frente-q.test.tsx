import { createElement as h } from "react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import type { ModeloIa } from "@/lib/mesa/api";
import { projetoDosTakes, type ProjetoDeEdicao } from "../../supabase/functions/_shared/projeto-de-edicao";
import { catalogoEmUso, estadoDoMotor, motorDoNivel, MOTORES_DE_VIDEO } from "../../supabase/functions/mesa-videos/modulos/modelos-de-video";
import { sistemaDoAgente } from "../../supabase/functions/editor-video/ferramentas";

/**
 * Frente Q (26/09): correção e teste de ponta a ponta da área de VÍDEO.
 * 1. Etapa Editar: o editor completo abre direto e a lateral é o agente editor
 *    com o seletor de modelo (catálogo ia_modelos ativo) e o custo por pedido.
 * 2. "Edite com a skill do Brabo" vira operações aplicáveis na linha do tempo.
 * 3. Motores do fal disponíveis sem semente na tabela video_motores.
 * 4. Toda ação que a tela chama existe na função publicada.
 * Função, Storage e tabelas simulados; nada sai para o Supabase real.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), tabelas: {} as Record<string, unknown> }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update", "insert"]) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: Array.isArray(dados) ? dados[0] || null : dados, error: null });
    b.single = b.maybeSingle;
    b.then = (ok: any, falha: any) => Promise.resolve({ data: dados, error: null }).then(ok, falha);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      from: (t: string) => consulta(t),
      storage: {
        from: () => ({
          upload: vi.fn().mockResolvedValue({ data: { path: "x" }, error: null }),
          list: vi.fn().mockResolvedValue({ data: [], error: null }),
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://x.supabase.co/v.mp4" }, error: null }),
          createSignedUrls: (caminhos: string[]) => Promise.resolve({ data: caminhos.map((p) => ({ path: p, signedUrl: `https://x.supabase.co/${p}`, error: null })), error: null }),
        }),
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
vi.mock("@remotion/player", () => ({ Player: () => h("div", { "data-player-falso": "" }) }));

import AreaDoEditor from "@/components/mesa-edicao/AreaDoEditor";
import AgenteDaEdicao from "@/components/mesa-edicao/AgenteDaEdicao";
import EtapaGerar from "@/components/mesa-videos/EtapaGerar";
import { custoDoPedido, familiaDoModelo, modelosDoAgente, pedidoComDica, precoDoModelo } from "@/components/mesa-edicao/editor/AgenteEditor";
import { rodarAgente } from "@/lib/editor/agente";
import { aplicarOperacoes, assinaturaDoProjeto, trilhaPrincipal } from "@/lib/editor/operacoes";
import { custoDaFala, fontesSemFala, guardarFalaDaEntrada, marcarFalaDoProjeto, pedidoPrecisaDeFala } from "@/lib/editor/fala";
import { deixarPedidoParaOEditor } from "@/components/mesa-edicao/editor/ponteDoAgente";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const VERSAO = "22222222-2222-4222-8222-222222222222";

const modelo = (id: string, provedor: string, api: string, rotulo: string, entrada: number, saida: number, ativo = true, padrao: string[] = []): ModeloIa => ({
  id,
  provedor,
  modelo_api: api,
  tipo: "texto",
  rotulo,
  preco_entrada_1m: entrada,
  preco_saida_1m: saida,
  preco_cache_1m: null,
  preco_imagem: null,
  raciocinio: ["low", "medium", "high"],
  padrao_para: padrao,
  ativo,
});

// O catálogo ativo de hoje (ia_modelos, 26/09): GPT pela OpenAI e pela OpenRouter, Claude Opus 5.5 pela OpenRouter; Astra desligado.
const CATALOGO: ModeloIa[] = [
  modelo("openai:gpt-6-sol", "openai", "gpt-6-sol", "GPT-6 Sol", 2, 10),
  modelo("openrouter:openai/gpt-6-luna", "openrouter", "openai/gpt-6-luna", "GPT-6 Luna", 0.1, 0.5, true, ["diretor_arte"]),
  modelo("openrouter:anthropic/claude-opus-5.5", "openrouter", "anthropic/claude-opus-5.5", "Claude Opus 5.5", 4, 20),
  modelo("openrouter:openai/gpt-6-astra", "openrouter", "openai/gpt-6-astra", "GPT-6 Astra", 10, 50, false),
];

const valor = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Café Sintético",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 10,
  catalogo: CATALOGO,
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

function projeto(): ProjetoDeEdicao {
  return projetoDosTakes({
    titulo: "Reel",
    fps: 25,
    takes: [
      { id: "a", nome: "IMG_1.MOV", tipo: "bruto", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/brutos/a.mov`, cena_ref: null, melhor: true, duracao_s: 10, largura: 1080, altura: 1920 },
      { id: "b", nome: "IMG_2.MOV", tipo: "bruto", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/brutos/b.mov`, cena_ref: null, melhor: true, duracao_s: 6, largura: 1080, altura: 1920 },
    ],
  });
}

const versao = () => ({ id: VERSAO, client_id: CLIENTE, video_id: "33333333-3333-4333-8333-333333333333", titulo: "Reel", numero: 1, estado: "rascunho", criado_em: "2026-09-26T10:00:00Z", feedback: [], projeto: { ...projeto(), revisao: 1 } });

const corpos = (fn: string, acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === fn && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

function montar(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: [`/mesa-edicao?client=${CLIENTE}&etapa=editar`] }, h(TooltipProvider, null, h(MesaProvider, { valor: valor(), children: filho })))));
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.tabelas = { video_versoes: [versao()], video_arquivos: [], video_pedidos: [], video_motores: [] };
  mock.invoke.mockImplementation((_f: string, { body }: any) => Promise.resolve({ data: body.acao === "projeto_salvar" ? { versao: { projeto: { revisao: body.revisao_lida + 1 } } } : {}, error: null }));
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  (window as any).IntersectionObserver = class {
    observe() {}
    disconnect() {}
  };
  (globalThis as any).CSS = { supports: () => true };
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

// ------------------------------------------------------------------ 1. etapa Editar

describe("etapa Editar: editor completo e agente editor na lateral", () => {
  it("abre o editor direto (sem clique) e a lateral é o agente editor com modelo, preço e custo por pedido", async () => {
    montar(h("div", null, h(AreaDoEditor, { projeto: projeto(), roteiroId: null }), h("aside", { "data-teste-lateral": "" }, h(AgenteDaEdicao, { mesa: "edicao", etapa: "editar", irPara: vi.fn() }))));
    await waitFor(() => expect(document.querySelector('[data-editor-de-video="completo"]')).toBeTruthy(), { timeout: 8000 });
    // Agente na lateral: o editor não tem mais a aba "Agente" dentro dele.
    expect(document.querySelector("[data-agente-na-lateral]")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Lado direito do editor/ })).toBeNull();
    expect(corpos("mesa-videos", "versao_registrar")).toHaveLength(0);

    const lateral = document.querySelector("[data-teste-lateral]") as HTMLElement;
    expect(within(lateral).getByText("Agente editor")).toBeTruthy();
    expect(within(lateral).queryByText("Agente de edição")).toBeNull();
    const seletor = within(lateral).getByRole("combobox", { name: "Modelo do agente" }) as HTMLSelectElement;
    const opcoes = Array.prototype.map.call(seletor.options, (o: HTMLOptionElement) => o.textContent) as string[];
    expect(opcoes).toContain("Claude Opus 5.5 · OpenRouter · US$ 4/20 por 1M");
    expect(opcoes.some((o) => o.indexOf("GPT-6 Sol · OpenAI") === 0)).toBe(true);
    expect(opcoes.some((o) => o.indexOf("Astra") >= 0)).toBe(false); // desligado no catálogo
    expect(Array.prototype.map.call(seletor.querySelectorAll("optgroup"), (g: HTMLOptGroupElement) => g.label)).toEqual(["GPT (OpenAI)", "Claude (Anthropic)"]);
    // Padrão: o modelo do papel diretor_arte (GPT-6 Luna); custo por pedido à vista.
    expect(seletor.value).toBe("openrouter:openai/gpt-6-luna");
    expect(within(lateral).getByRole("combobox", { name: "Esforço de raciocínio" })).toBeTruthy();
    expect((lateral.querySelector("[data-custo-do-pedido]") as HTMLElement).textContent).toMatch(/^Pedido ~US\$ .+ \(máx\. US\$ .+\) · gasto aqui US\$ 0,00$/);
    fireEvent.change(seletor, { target: { value: "openrouter:anthropic/claude-opus-5.5" } });
    await waitFor(() => expect(within(lateral).getByText(/Claude Opus 5.5 · edita a linha do tempo/)).toBeTruthy());
    // Os atalhos das skills estão lá.
    expect(lateral.querySelector('[data-atalho-do-editor="brabo"]')).toBeTruthy();
  }, 20000);

  it("?versao= (link da Mesa Motion) abre essa versão e sai do endereço; id que não é editável cai na mais nova", async () => {
    const V2 = "44444444-4444-4444-8444-444444444444";
    mock.tabelas.video_versoes = [versao(), { ...versao(), id: V2, numero: 2, titulo: "Reel motion", criado_em: "2026-09-25T10:00:00Z" }];
    function Onde() {
      return h("span", { "data-onde": useLocation().search });
    }
    const abrir = (versaoPedida: string) => {
      const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
      return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: [`/mesa-edicao?client=${CLIENTE}&etapa=editar&versao=${versaoPedida}`] }, h(TooltipProvider, null, h(MesaProvider, { valor: valor(), children: h("div", null, h(AreaDoEditor, { projeto: projeto(), roteiroId: null, agenteNaLateral: false }), h(Onde)) })))));
    };
    const um = abrir(V2);
    const seletor = (await screen.findByRole("combobox", { name: "Versão em edição" }, { timeout: 8000 })) as HTMLSelectElement;
    expect(seletor.value).toBe(V2);
    await waitFor(() => expect((document.querySelector("[data-onde]") as HTMLElement).getAttribute("data-onde")).not.toContain("versao="));
    expect((document.querySelector("[data-onde]") as HTMLElement).getAttribute("data-onde")).toContain("etapa=editar");
    um.unmount();
    window.localStorage.clear();
    abrir("99999999-9999-4999-8999-999999999999");
    const outro = (await screen.findByRole("combobox", { name: "Versão em edição" }, { timeout: 8000 })) as HTMLSelectElement;
    expect(outro.value).toBe(VERSAO);
  }, 30000);

  it("modelos: só texto ativo, do mais barato ao mais caro, agrupados; preço por 1M; custo por pedido preso ao teto", () => {
    const g = modelosDoAgente(CATALOGO);
    expect(g.map((x) => x.familia)).toEqual(["GPT (OpenAI)", "Claude (Anthropic)"]);
    expect(g[0].modelos.map((m) => m.id)).toEqual(["openrouter:openai/gpt-6-luna", "openai:gpt-6-sol"]);
    expect(familiaDoModelo({ modelo_api: "anthropic/claude-opus-5.5", provedor: "openrouter" })).toBe("Claude (Anthropic)");
    expect(precoDoModelo({ preco_entrada_1m: 0.1, preco_saida_1m: 0.5 })).toBe("US$ 0,1/0,5 por 1M");
    expect(custoDoPedido(0.1, 0.5)).toEqual({ tipico: 0.2, maximo: 0.5 });
    // 02/10: até 10 passos por pedido (a edição inteira com conferência).
    expect(custoDoPedido(0.01, 0.5)).toEqual({ tipico: 0.02, maximo: 0.1 });
  });

  it("pedido deixado pelo agente de edição de outra etapa entra no campo do agente editor (nada roda sozinho)", async () => {
    deixarPedidoParaOEditor(CLIENTE, "pode editar ele");
    montar(h("div", null, h(AreaDoEditor, { projeto: projeto(), roteiroId: null }), h(AgenteDaEdicao, { mesa: "edicao", etapa: "editar", irPara: vi.fn() })));
    await waitFor(() => expect(document.querySelector('[data-editor-de-video="completo"]')).toBeTruthy(), { timeout: 8000 });
    const campo = (await screen.findByRole("textbox", { name: "Pedido para o agente editor" }, { timeout: 8000 })) as HTMLTextAreaElement;
    await waitFor(() => expect(campo.value).toBe("pode editar ele"));
    expect(screen.getByText(/Recebi o seu pedido do agente de edição/)).toBeTruthy();
    expect(corpos("editor-video", "agente_passo")).toHaveLength(0);
  }, 20000);
});

// ------------------------------------------------------------------ 2. edite com o Brabo

describe("agente editor edita de verdade", () => {
  it("o pedido leva a dica da skill e o laço aplica o Brabo numa cópia: operações aplicáveis", async () => {
    // 02/10: "com o Brabo" e "pode editar ele" são a edição inteira (EDIT IA PRO, que já traz o ritmo do Brabo).
    expect(pedidoComDica("edite com a skill do Brabo")).toContain("edicao_completa");
    expect(pedidoComDica("deixa mais bonito")).toBe("deixa mais bonito");
    expect(pedidoComDica("pode editar ele")).toContain("edicao_completa");
    expect(pedidoComDica("só o ritmo do brabo")).toContain('skill "brabo"');
    expect(sistemaDoAgente()).toContain("Só o ritmo do Brabo (batidas e zoom alternado) = aplicar_skill brabo");
    const base = projeto();
    const chamar = vi.fn().mockResolvedValueOnce({ passo: { plano: "Aplicar o Brabo.", chamadas: [{ ferramenta: "aplicar_skill", argumentos: { skill: "brabo" } }], resposta: "Apliquei a edição dinâmica.", terminou: true, recusadas: [] }, gasto_usd: 0.002 });
    const r = await rodarAgente({ chamar, clientId: CLIENTE, sessao: "s1", pedido: pedidoComDica("edite com a skill do Brabo"), projeto: base, modeloId: "openrouter:openai/gpt-6-luna", tetoUsd: 0.5, agora: "2026-09-26T12:00:00Z" });
    expect(chamar).toHaveBeenCalledTimes(1);
    expect(chamar.mock.calls[0][0]).toMatchObject({ acao: "agente_passo", client_id: CLIENTE, modelo_id: "openrouter:openai/gpt-6-luna", passo: 1 });
    expect(r.operacoes.length).toBeGreaterThan(2);
    // Aplicar as operações no projeto de antes dá exatamente o resultado mostrado.
    expect(assinaturaDoProjeto(aplicarOperacoes(base, r.operacoes))).toBe(assinaturaDoProjeto(r.resultado));
    expect(trilhaPrincipal(r.resultado)!.clipes.length).toBeGreaterThan(trilhaPrincipal(base)!.clipes.length);
    expect(r.gasto_usd).toBe(0.002);
  });

  it("na tela: 'edite com a skill do Brabo' sem fala marcada mostra o Timestamp com custo; 'Sem marcar' segue, o cartão aparece e Confirmar muda a linha do tempo", async () => {
    mock.invoke.mockImplementation((f: string, { body }: any) => {
      if (f === "editor-video" && body.acao === "agente_passo") return Promise.resolve({ data: { passo: { plano: "Brabo.", chamadas: [{ ferramenta: "aplicar_skill", argumentos_json: "{}", argumentos: { skill: "brabo" } }], resposta: "Edição dinâmica aplicada.", terminou: true, recusadas: [] }, custo_usd: 0.001, gasto_usd: 0.001 }, error: null });
      return Promise.resolve({ data: body.acao === "projeto_salvar" ? { versao: { projeto: { revisao: body.revisao_lida + 1 } } } : {}, error: null });
    });
    montar(h("div", null, h(AreaDoEditor, { projeto: projeto(), roteiroId: null }), h("aside", { "data-teste-lateral": "" }, h(AgenteDaEdicao, { mesa: "edicao", etapa: "editar", irPara: vi.fn() }))));
    await waitFor(() => expect(document.querySelector('[data-editor-de-video="completo"]')).toBeTruthy(), { timeout: 8000 });
    const antes = document.querySelectorAll("[data-apelido]").length;
    const lateral = document.querySelector("[data-teste-lateral]") as HTMLElement;
    const campo = within(lateral).getByRole("textbox", { name: "Pedido para o agente editor" });
    await waitFor(() => expect(campo.hasAttribute("disabled")).toBe(false));
    fireEvent.change(campo, { target: { value: "edite com a skill do Brabo" } });
    fireEvent.click(within(lateral).getByRole("button", { name: "Mandar para o agente" }));
    // 16 s de vídeo sem fala: Whisper US$ 0,006 por minuto, antes de gastar.
    const preparo = await within(lateral).findByText(/Primeiro marco a fala de 2 vídeos/);
    expect(preparo.textContent).toContain("US$ 0,0016");
    expect(corpos("editor-video", "agente_passo")).toHaveLength(0);
    fireEvent.click(within(lateral).getByRole("button", { name: "Sem marcar" }));
    await waitFor(() => expect(corpos("editor-video", "agente_passo")).toHaveLength(1));
    expect(corpos("editor-video", "agente_passo")[0].pedido).toContain("edicao_completa");
    fireEvent.click(await within(lateral).findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(document.querySelectorAll("[data-apelido]").length).toBeGreaterThan(antes));
  }, 25000);

  it("atalho Edição dinâmica roda a skill de graça (sem modelo) quando a fala já está marcada pela Entrada", async () => {
    const p = projeto();
    const falas = fontesSemFala(p);
    expect(falas.length).toBe(2);
    expect(custoDaFala(p, falas)).toBe(0.0016);
    expect(pedidoPrecisaDeFala("edite com a skill do Brabo")).toBe(true);
    expect(pedidoPrecisaDeFala("reordene c2 antes de c1")).toBe(false);
    // Fala guardada pela Entrada entra de graça (sem chamar a função).
    falas.forEach((k) => {
      const arq = p.fontes[k].arquivo_id as string;
      guardarFalaDaEntrada(CLIENTE, arq, [
        { t: "Olá", i: 0.2, f: 0.5 },
        { t: "gente", i: 0.55, f: 0.9 },
        { t: "hoje", i: 2.4, f: 2.8 },
      ]);
    });
    const r = await marcarFalaDoProjeto(p, falas, { clientId: CLIENTE, urls: {}, agora: "2026-09-26T12:00:00Z" });
    expect(r.custo_usd).toBe(0);
    expect(r.marcadas).toBe(2);
    expect(fontesSemFala(r.projeto)).toEqual([]);
    expect(mock.invoke).not.toHaveBeenCalled();
  });
});

// ------------------------------------------------------------------ 3. motores sem semente

describe("Mesa Vídeos: motores do fal sem semente", () => {
  it("tabela video_motores vazia: o catálogo em código vale e os motores do fal ficam prontos com FAL_KEY", () => {
    const c = catalogoEmUso([]);
    expect(c.motores.length).toBe(MOTORES_DE_VIDEO.length);
    const temChave = (n: string) => n === "FAL_KEY";
    const fal = c.motores.filter((m) => m.provedor === "fal" && !m.situacao && m.preco);
    expect(fal.length).toBeGreaterThan(10);
    fal.forEach((m) => expect(estadoDoMotor(m, { temChave })).toBe("pronto"));
    // Frente V-C: a Runway tem executor próprio; só com FAL_KEY ela pede a chave dela.
    expect(estadoDoMotor(c.motores.find((m) => m.id === "runway-gen4.5")!, { temChave })).toBe("precisa_chave");
    expect(estadoDoMotor(c.motores.find((m) => m.id === "sora-2")!, { temChave })).toBe("encerrado");
    // Sem FAL_KEY: "precisa de chave" (o nome do segredo aparece, nunca o valor).
    expect(estadoDoMotor(c.motores.find((m) => m.id === "seedance-2.5")!, { temChave: () => false })).toBe("precisa_chave");
    expect(motorDoNivel("normal", { modo: "primeiro_quadro", formato: "9:16" }, c.motores)).toBeTruthy();
    expect(motorDoNivel("normal", { modo: "texto", formato: "9:16" }, c.motores)).toBeTruthy();
  });

  it("Gerar > Cena do roteiro gera de verdade: motor pronto, custo antes e cena_gerar com o custo confirmado (nada de 'em breve')", async () => {
    const CANVAS = "44444444-4444-4444-8444-444444444444";
    mock.tabelas.video_pedidos = [];
    mock.tabelas.cliente_imagens = [{ id: "55555555-5555-4555-8555-555555555555", client_id: CLIENTE, storage_bucket: "mesa", storage_path: `${CLIENTE}/fotos/cena1.png`, nome: "cena1", ativa: true }];
    mock.invoke.mockImplementation((_f: string, { body }: any) => {
      if (body.acao === "motores_estado") return Promise.resolve({ data: { motores: MOTORES_DE_VIDEO.map((m) => ({ id: m.id, estado: m.situacao || (m.provedor === "fal" && m.preco ? "pronto" : "sem_preco"), estado_rotulo: m.situacao ? "A integrar" : "Pronto", nivel: "normal", novo: false, chave: null })) }, error: null });
      if (body.acao === "cena_gerar") return Promise.resolve({ data: { ok: true, pedido_id: "66666666-6666-4666-8666-666666666666" }, error: null });
      return Promise.resolve({ data: {}, error: null });
    });
    // Uma cena da História com foto (linha da view foto_cenas_da_historia).
    mock.tabelas.foto_cenas_da_historia = [{ canvas_id: CANVAS, client_id: CLIENTE, canvas_nome: "Reel da loja", historia: {}, no_id: "n1", numero: 1, titulo: "Chegada", acao: "A dona abre a loja", enquadramento: "livre", cenario: "", narrativa: "Bom dia", imagem_id: "55555555-5555-4555-8555-555555555555", resultados: [] }];
    montar(h(EtapaGerar, { irPara: vi.fn() }));
    await waitFor(() => expect(corpos("mesa-videos", "motores_estado")).toHaveLength(1));
    const cena = (await screen.findByRole("combobox", { name: "Cena" }, { timeout: 8000 })) as HTMLSelectElement;
    expect(document.body.textContent).not.toMatch(/em breve|a ligar|Preparar pedido/i);
    fireEvent.change(cena, { target: { value: `cena:${CANVAS}:n1` } });
    const motor = (await screen.findByRole("combobox", { name: "Motor" })) as HTMLSelectElement;
    await waitFor(() => expect(motor.value).toBeTruthy());
    const botaoGerar = await screen.findByRole("button", { name: /^Gerar/ });
    await waitFor(() => expect(botaoGerar.hasAttribute("disabled")).toBe(false));
    expect(botaoGerar.textContent).toMatch(/US\$ \d/);
    fireEvent.click(botaoGerar);
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar" }));
    await waitFor(() => expect(corpos("mesa-videos", "cena_gerar")).toHaveLength(1));
    const corpo = corpos("mesa-videos", "cena_gerar")[0];
    expect(corpo).toMatchObject({ client_id: CLIENTE, tipo: "gerar_plano", modo: "primeiro_quadro", quadro_inicial_path: `${CLIENTE}/fotos/cena1.png`, plano_ref: "c1" });
    expect(corpo.motor).toBe(motor.value);
    expect(typeof corpo.custo_confirmado_usd).toBe("number");
    expect(corpo.custo_confirmado_usd).toBeGreaterThan(0);
    expect(corpo.uid).toBeTruthy();
    expect(corpo.prompt).toContain("A dona abre a loja");
  }, 20000);
});

// ------------------------------------------------------------------ 4. mapa de ações

const raiz = process.cwd();
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");
function arquivos(dir: string): string[] {
  const saida: string[] = [];
  readdirSync(resolve(raiz, dir)).forEach((n) => {
    const p = join(dir, n);
    if (statSync(resolve(raiz, p)).isDirectory()) saida.push(...arquivos(p));
    else if (/\.(ts|tsx)$/.test(n)) saida.push(p);
  });
  return saida;
}
const acoesDoServidor = (p: string) => {
  const s = ler(p);
  const i = s.indexOf("const ACOES");
  const bloco = s.slice(i, s.indexOf("};", i));
  const nomes: string[] = [];
  bloco.replace(/^\s+([a-z_]+):/gm, (_m, n) => {
    nomes.push(n);
    return "";
  });
  return nomes;
};

describe("mapa de ações tela -> servidor", () => {
  it("toda ação que a Mesa Vídeos e a Mesa Edição chamam existe em mesa-videos ou editor-video", () => {
    const servidor = acoesDoServidor("supabase/functions/mesa-videos/index.ts").concat(acoesDoServidor("supabase/functions/editor-video/index.ts"));
    expect(servidor).toContain("cena_gerar");
    expect(servidor).toContain("agente_passo");
    const tela = ["src/components/mesa-videos", "src/components/mesa-edicao", "src/lib/editor", "src/lib/mesa-videos"].reduce((l, d) => l.concat(arquivos(d)), [] as string[]);
    const usadas = new Set<string>();
    tela.forEach((p) => {
      const s = ler(p);
      s.replace(/\bacao:\s*"([a-z_]+)"/g, (_m, n) => {
        usadas.add(n);
        return "";
      });
      s.replace(/"(executar_acao_agente|desfazer_acao_agente)"/g, (_m, n) => {
        usadas.add(n);
        return "";
      });
    });
    // Nomes do contrato V-A usados pelo editor (ACAO_NO_SERVIDOR).
    const geracao = ler("src/lib/editor/geracao.ts");
    const mapa = geracao.slice(geracao.indexOf("ACAO_NO_SERVIDOR"), geracao.indexOf("};", geracao.indexOf("ACAO_NO_SERVIDOR")));
    mapa.replace(/:\s*"([a-z_]+)"/g, (_m, n) => {
      usadas.add(n);
      return "";
    });
    const faltando = Array.from(usadas).filter((n) => servidor.indexOf(n) < 0);
    expect(faltando).toEqual([]);
    expect(usadas.size).toBeGreaterThan(30);
  });

  it("geração no editor manda o motor (o servidor recusa sem ele) e a Cena do roteiro não usa mais o pedido preparado", () => {
    const painel = ler("src/components/mesa-edicao/editor/PainelDeGeracao.tsx");
    expect((painel.match(/motor: motor \? motor\.id : ""/g) || []).length).toBe(3);
    const gerar = ler("src/components/mesa-videos/EtapaGerar.tsx");
    expect(gerar).toContain('acao: "cena_gerar"');
    expect(gerar).not.toContain('acao: "pedido_preparar"');
    expect(ler("src/components/mesa-edicao/EtapaEntrada.tsx")).not.toContain('acao: "pedido_preparar"');
  });

  it("piso Safari 11 e sem travessão nos arquivos desta frente", () => {
    for (const p of [
      "src/components/mesa-edicao/AgenteDaEdicao.tsx",
      "src/components/mesa-edicao/AreaDoEditor.tsx",
      "src/components/mesa-edicao/EtapaEntrada.tsx",
      "src/components/mesa-edicao/editor/AgenteEditor.tsx",
      "src/components/mesa-edicao/editor/EditorDeVideo.tsx",
      "src/components/mesa-edicao/editor/PainelDeGeracao.tsx",
      "src/components/mesa-edicao/editor/PainelTimestamp.tsx",
      "src/components/mesa-edicao/editor/ponteDoAgente.ts",
      "src/components/mesa-edicao/editor/apoio.ts",
      "src/components/mesa-videos/EtapaGerar.tsx",
      "src/lib/editor/fala.ts",
    ]) {
      const f = ler(p);
      expect(f, p).not.toMatch(/\(\?<[=!]/);
      expect(f, p).not.toMatch(/\(\?<[a-z]/i);
      expect(f, p).not.toMatch(/\\p\{/);
      expect(f, p).not.toMatch(/\.at\(/);
      expect(f, p).not.toMatch(/Object\.hasOwn\(/);
      expect(f, p).not.toMatch(/crypto\.randomUUID/);
      expect(f, p).not.toMatch(/[—–]/);
    }
  });
});
