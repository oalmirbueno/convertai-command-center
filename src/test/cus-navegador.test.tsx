import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const invocar = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invocar(...a) }, from: vi.fn(), rpc: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin", id: "u-1" }, user: { id: "u-1" } }) }));

import {
  CASOS_DO_NAVEGADOR,
  casoLigado,
  custoDoTurnoTipico,
  custoEstimadoDoCaso,
  DEFINICOES_DOS_CASOS,
  fazComputerUse,
  MODELO_PADRAO_DO_COMPUTADOR,
  modelosDoComputador,
  motivoParaRecusarNoNavegador,
  normalizarPedidoDoNavegador,
  provedorDoComputador,
} from "../../supabase/functions/computador-do-agente/modulos/navegador";
import { acoesDoNavegador, type EntradaDoEstado, type EntradaDoNavegador, montarEstado } from "../../supabase/functions/motores-estado/modulos/estado";
import { concorrenteParaProposta, concorrentesParaIdentidade, notasParaDirecao, observacaoComNotas, printPrincipal, referenciaDeAds } from "@/lib/agentes/insumosDoNavegador";
import { executorTemProvedor, nomeDoModelo, type CartaoDaTarefa, type EstadoDoNavegador } from "@/lib/agentes/navegadorApi";
import { BotaoDoNavegador } from "@/components/agentes/NavegadorDoAgente";
import ResultadoDoNavegador from "@/components/agentes/ResultadoDoNavegador";

/**
 * Frente CUS (01/10/2026): computer use com qualquer modelo que tenha o recurso (Claude ou GPT), em mais ações
 * (conferir o site publicado, capturar referência, perfil público e concorrentes visuais), custo antes do
 * Confirmar, cartão com fonte e print e o insumo de cada mesa com um clique. O worker tem os testes dele em
 * workers/computador/testes (Chromium de verdade, fetch falso da OpenAI e o SQL no PGlite).
 */

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

const CATALOGO = [
  { id: "openrouter:anthropic/claude-sonnet-5.5", provedor: "openrouter", modelo_api: "anthropic/claude-sonnet-5.5", tipo: "texto", preco_entrada_1m: 2, preco_saida_1m: 10, preco_cache_1m: 0.2, recursos: { computer_use: true } },
  { id: "openai:gpt-6-astra", provedor: "openai", modelo_api: "gpt-6-astra", rotulo: "GPT-6 Astra (OpenAI direta)", tipo: "texto", preco_entrada_1m: 10, preco_saida_1m: 50, preco_cache_1m: 1, recursos: { computer_use: true } },
  { id: "anthropic:claude-opus-5-5", provedor: "anthropic", modelo_api: "claude-opus-5-5", rotulo: "Claude Opus 5.5 (Anthropic direta)", tipo: "texto", preco_entrada_1m: 4, preco_saida_1m: 20, preco_cache_1m: 0.2, recursos: { computer_use: true } },
  { id: "openai:gpt-6.1-sol", provedor: "openai", modelo_api: "gpt-6.1-sol", rotulo: "GPT-6.1 Sol (OpenAI direta)", tipo: "texto", preco_entrada_1m: 2, preco_saida_1m: 10, preco_cache_1m: 0.1, recursos: { computer_use: true } },
  { id: "anthropic:claude-sonnet-5-5", provedor: "anthropic", modelo_api: "claude-sonnet-5-5", rotulo: "Claude Sonnet 5.5 (Anthropic direta)", tipo: "texto", preco_entrada_1m: 2, preco_saida_1m: 10, preco_cache_1m: 0.2, recursos: { computer_use: true } },
  { id: "openai:gpt-6-luna", provedor: "openai", modelo_api: "gpt-6-luna", tipo: "texto", preco_entrada_1m: 0.1, preco_saida_1m: 0.5, recursos: { ferramentas: true } },
  { id: "anthropic:claude-fable-5-1", provedor: "anthropic", modelo_api: "claude-fable-5-1", tipo: "texto", preco_entrada_1m: 10, preco_saida_1m: 50, disponivel: false, recursos: { computer_use: true } },
];

describe("regras: qualquer modelo com computer use, em mais ações", () => {
  it("só os diretos marcados e disponíveis fazem computer use; o padrão (Sonnet 5.5) vem primeiro", () => {
    expect(modelosDoComputador(CATALOGO).map((m) => m.id)).toEqual(["anthropic:claude-sonnet-5-5", "openai:gpt-6.1-sol", "anthropic:claude-opus-5-5", "openai:gpt-6-astra"]);
    expect(fazComputerUse(CATALOGO[0])).toBe(false);
    expect(provedorDoComputador("openai:gpt-6.1-sol")).toBe("openai");
    expect(provedorDoComputador("openrouter:openai/gpt-6.1-sol")).toBeNull();
    expect(MODELO_PADRAO_DO_COMPUTADOR).toBe("anthropic:claude-sonnet-5-5");
  });

  it("sete ações: as fixas sempre ligadas; as com modelo pela variável; todas só de leitura com teto", () => {
    expect(CASOS_DO_NAVEGADOR).toEqual(["captura_site", "conferir_post", "coleta_publica", "conferir_site", "capturar_referencia", "perfil_publico", "concorrentes_visuais"]);
    expect(CASOS_DO_NAVEGADOR.filter((c) => casoLigado(c, false))).toEqual(["captura_site", "conferir_post", "conferir_site"]);
    expect(CASOS_DO_NAVEGADOR.every((c) => casoLigado(c, true))).toBe(true);
    for (const c of CASOS_DO_NAVEGADOR) {
      const d = DEFINICOES_DOS_CASOS[c];
      expect(d.tetoPassos).toBeLessThanOrEqual(60);
      expect(d.tetoCustoUsd).toBeLessThanOrEqual(5);
      expect(d.usaModelo ? d.tetoCustoUsd > 0 : d.tetoCustoUsd === 0).toBe(true);
      expect(d.onde).toMatch(/›/);
    }
    expect(DEFINICOES_DOS_CASOS.conferir_site.onde).toBe("Mesa Site › Publicação");
    expect(DEFINICOES_DOS_CASOS.perfil_publico.onde).toBe("Mesa Ads › Referências");
    expect(DEFINICOES_DOS_CASOS.concorrentes_visuais.onde).toBe("Mesa Identidade › Pesquisa");
  });

  it("pedido: modelo padrão quando vazio, id fora dos diretos recusado, sites da pesquisa na lista de domínios", () => {
    const p = normalizarPedidoDoNavegador({ caso: "perfil_publico", url: "https://www.instagram.com/concorrente/", origem: "mesa_ads" });
    expect(p.modelo_id).toBe("anthropic:claude-sonnet-5-5");
    expect(p.objetivo).toMatch(/em público/);
    expect(motivoParaRecusarNoNavegador(p, true)).toBeNull();
    expect(motivoParaRecusarNoNavegador(p, false)).toMatch(/Desligado/);
    const ruim = normalizarPedidoDoNavegador({ caso: "perfil_publico", url: "https://x.com.br/", modelo_id: "openrouter:openai/gpt-6.1-sol" });
    expect(ruim.modelo_id).toBeNull();
    expect(motivoParaRecusarNoNavegador(ruim, true)).toMatch(/modelo com computer use/);
    expect(normalizarPedidoDoNavegador({ caso: "conferir_site", url: "https://cliente.com.br/", modelo_id: "openai:gpt-6.1-sol" }).modelo_id).toBeNull();
    const v = normalizarPedidoDoNavegador({ caso: "concorrentes_visuais", url: "https://a.com.br", urls: "https://b.com.br\nc.com.br, https://www.a.com.br/x", origem: "mesa_identidade", modelo_id: "openai:gpt-6.1-sol" });
    expect(v.urls).toEqual(["https://a.com.br/", "https://b.com.br/", "https://c.com.br/"]);
    expect(v.dominios).toEqual(["a.com.br", "b.com.br", "c.com.br"]);
    expect(v.titulo).toMatch(/a\.com\.br e mais 2/);
    expect(motivoParaRecusarNoNavegador(v, true)).toBeNull();
    const comLogin = normalizarPedidoDoNavegador({ caso: "concorrentes_visuais", url: "https://a.com.br", urls: "https://b.com.br/login", modelo_id: "openai:gpt-6.1-sol" });
    expect(motivoParaRecusarNoNavegador(comLogin, true)).toMatch(/login/);
    const interno = normalizarPedidoDoNavegador({ caso: "concorrentes_visuais", url: "https://a.com.br", urls: "http://192.168.0.5/" });
    expect(motivoParaRecusarNoNavegador(interno, true)).toMatch(/não são sites públicos: http:\/\/192\.168\.0\.5/);
  });

  it("custo antes do Confirmar: turno típico pelo preço do modelo, vezes os turnos da ação (por site), nunca acima do teto", () => {
    const sonnet = CATALOGO[4];
    expect(Math.round(custoDoTurnoTipico(sonnet) * 10000) / 10000).toBe(0.0112);
    expect(custoEstimadoDoCaso("coleta_publica", sonnet).estimado).toBe(0.0672);
    expect(custoEstimadoDoCaso("concorrentes_visuais", sonnet, 3).estimado).toBe(0.1008);
    expect(custoEstimadoDoCaso("concorrentes_visuais", sonnet, 3).teto).toBe(1.5);
    expect(custoEstimadoDoCaso("conferir_site", sonnet)).toEqual({ estimado: 0, teto: 0 });
    // Astra (US$ 10/50) num caso de teto baixo: a estimativa para no teto.
    expect(custoEstimadoDoCaso("perfil_publico", { preco_entrada_1m: 100, preco_saida_1m: 500, preco_cache_1m: 10 }).estimado).toBe(0.6);
  });

  it("os textos para a tela não têm travessão", () => {
    for (const c of CASOS_DO_NAVEGADOR) {
      const d = DEFINICOES_DOS_CASOS[c];
      expect(`${d.rotulo} ${d.descricao} ${d.onde} ${d.insumo || ""} ${d.objetivoPadrao || ""}`).not.toMatch(/[—–]/);
    }
  });
});

const cartao = (caso: CartaoDaTarefa["tarefa"]["caso"], resultado: Record<string, unknown>, imagens: CartaoDaTarefa["imagens"] = []): CartaoDaTarefa => ({
  tarefa: { id: "t1", caso, estado: "feita", url_inicial: "https://www.rival.com.br/", dominios: ["rival.com.br"], objetivo: null, origem: "proposta", modelo_id: "openai:gpt-6.1-sol", client_id: "c1" },
  resultado,
  imagens,
});

describe("insumos: a coleta vira material da mesa, sempre com a fonte", () => {
  it("Proposta › Mercado: concorrente com a página lida como fonte e a data de hoje", () => {
    const c = concorrenteParaProposta(cartao("coleta_publica", { titulo: "Rival Doces", resumo: "Doceria com entrega", dados: [{ item: "Preço do bolo", valor: "R$ 90", fonte: "https://www.rival.com.br/" }], fontes: ["https://www.rival.com.br/"] }), Date.parse("2026-10-01T15:00:00Z"));
    expect(c).toEqual({ nome: "Rival Doces", faz_bem: "Doceria com entrega", oportunidade: "Preço do bolo: R$ 90", fonte: { titulo: "Rival Doces", url: "https://www.rival.com.br/", data: "2026-10-01" } });
  });

  it("Mesa Site › Direção: notas, cores e fontes do código num parágrafo; não repete a mesma referência", () => {
    const c = cartao("capturar_referencia", { resumo: "Verde e laranja", notas: [{ aspecto: "paleta", nota: "verde institucional" }], levar: ["botão arredondado"], evitar: ["texto miúdo"], estilo: { cores: [{ hex: "#0a7f5a" }], fontes: [{ familia: "Georgia" }] } }, [
      { rotulo: "Página inteira no computador", url: null, storage_path: "c1/computador/t1/passo-02-inteira.png" },
      { rotulo: "Página inteira no celular", url: null, storage_path: "c1/computador/t1/passo-03-celular.png" },
    ]);
    const nota = notasParaDirecao(c);
    expect(nota).toMatch(/^Referência rival\.com\.br: Verde e laranja/);
    expect(nota).toMatch(/paleta: verde institucional/);
    expect(nota).toMatch(/Lido do código: cores #0a7f5a; fontes Georgia/);
    expect(nota).toMatch(/Levar: botão arredondado. Evitar: texto miúdo/);
    expect(observacaoComNotas("Priorizar o WhatsApp.", nota)).toBe(`Priorizar o WhatsApp.\n\n${nota}`);
    expect(observacaoComNotas(`Priorizar o WhatsApp.\n\n${nota}`, nota)).toBe(`Priorizar o WhatsApp.\n\n${nota}`);
    expect(printPrincipal(c)).toBe("c1/computador/t1/passo-02-inteira.png");
  });

  it("Mesa Identidade › Pesquisa: um concorrente por site lido, com o que comunica, cores e tipografia", () => {
    const refs = concorrentesParaIdentidade(cartao("concorrentes_visuais", { concorrentes: [
      { nome: "Rival Doces", site: "https://rival.com.br/", comunica: "sofisticação", logo: "símbolo", cores: ["#3b0a45", "#ffffff"], tipografia: "sem serifa" },
      { dominio: "outra.com.br", site: "https://outra.com.br/", cores_do_codigo: ["#111111"], fontes_do_codigo: ["Arial"] },
      { nome: "Sem site" },
    ] }));
    expect(refs).toEqual([
      { titulo: "Rival Doces", link: "https://rival.com.br/", nota: "sofisticação · logo: símbolo · cores: #3b0a45, #ffffff · tipografia: sem serifa", tipo: "concorrente" },
      { titulo: "outra.com.br", link: "https://outra.com.br/", nota: "cores: #111111 · tipografia: Arial", tipo: "concorrente" },
    ]);
  });

  it("Mesa Ads › Referências: o perfil público vira referência com o print e a origem certa", () => {
    const c = cartao("perfil_publico", { og: { titulo: "Rival (@rival)" }, fontes: ["https://www.instagram.com/rival/"] }, [{ rotulo: "Perfil como aparece sem login", url: null, storage_path: "c1/computador/t1/passo-01.png" }]);
    expect(referenciaDeAds(c)).toEqual({ titulo: "Perfil de concorrente: Rival (@rival)", url: "https://www.instagram.com/rival/", origem: "instagram", storage_path: "c1/computador/t1/passo-01.png" });
  });
});

describe("Estado dos motores: o navegador e a lista das ações", () => {
  const base = (navegador?: EntradaDoNavegador): EntradaDoEstado => ({
    agora: Date.parse("2026-10-01T15:00:00Z"),
    segredos: { OPENROUTER_API_KEY: true, TYPESAFE_API_KEY: true },
    admin: true,
    openrouter: null,
    site: { executores: [], abertos: [], ultimaFalha: null, ultimoFeito: null },
    render: { workers: [], abertos: [], erros: [], prontos: [] },
    imagem: { abertos: [], erros: [], feitas24h: 0, ultimaFeita: null },
    video: { abertos: [], erros: [], pedidos7d: 0, prontos7d: 0, angulos7d: 0, ultimoPronto: null },
    carteirasBaixas: [],
    navegador,
  });
  const nav = (extra: Partial<EntradaDoNavegador> = {}): EntradaDoNavegador => ({
    comModelo: true,
    executores: [{ nome: "DESKTOP-3A5EAKC-navegador", visto_em: "2026-10-01T14:59:40Z", versao: "cus-1.2", casos: [], provedores: ["anthropic", "openai"], ultimo_erro: null, ultimo_erro_em: null }],
    abertos: [{ estado: "aguardando_dono", criado_em: "2026-10-01T14:00:00Z" }, { estado: "aprovada", criado_em: "2026-10-01T14:30:00Z" }],
    ultimaFalha: null,
    ultimaFeita: "2026-10-01T14:40:00Z",
    feitas: [
      { caso: "coleta_publica", custo_usd: 0.025, modelo_id: "anthropic:claude-sonnet-5-5" },
      { caso: "coleta_publica", custo_usd: 0.035, modelo_id: "openai:gpt-6.1-sol" },
      { caso: "coleta_publica", custo_usd: 0.03, modelo_id: "openai:gpt-6.1-sol" },
    ],
    ...extra,
  });

  it("sem a entrada do navegador o quadro fica com os 6 motores de antes", () => {
    expect(montarEstado(base()).length).toBe(6);
  });

  it("ligado: último sinal, fila, provedores com chave e quem espera o dono", () => {
    const m = montarEstado(base(nav())).find((x) => x.id === "navegador")!;
    expect(m.situacao).toBe("ok");
    expect(m.resumo).toBe("Ligado, esperando tarefa. 1 tarefa aprovada na fila desde 01/10 11:30.");
    expect(m.ultimo_sinal).toBe("2026-10-01T14:59:40Z");
    expect(m.detalhes).toContain("Computer use nesta máquina: Anthropic (Claude) e OpenAI (GPT).");
    expect(m.detalhes).toContain("1 tarefa espera o Confirmar do dono.");
  });

  it("parado, sem a variável e com o último erro (o mais novo entre o worker e a tarefa)", () => {
    const m = montarEstado(base(nav({ comModelo: false, executores: [{ nome: "x", visto_em: "2026-10-01T10:00:00Z", provedores: [], ultimo_erro: "Falha na fila: tempo esgotado", ultimo_erro_em: "2026-10-01T10:00:00Z" }], ultimaFalha: { motivo: "A página pede senha", em: "2026-10-01T12:00:00Z" } }))).find((x) => x.id === "navegador")!;
    expect(m.situacao).toBe("parado");
    expect(m.resumo).toMatch(/desligado desde 01\/10 07:00/);
    expect(m.falta.join(" ")).toMatch(/ligar-navegador\.cmd/);
    expect(m.falta.join(" ")).toMatch(/COMPUTADOR_COM_MODELO_LIGADO=1/);
    expect(m.ultimo_erro).toEqual({ em: "2026-10-01T12:00:00Z", texto: "A página pede senha" });
  });

  it("só uma chave na máquina: avisa qual falta para o outro provedor", () => {
    const m = montarEstado(base(nav({ executores: [{ nome: "x", visto_em: "2026-10-01T14:59:50Z", provedores: ["anthropic"] }] }))).find((x) => x.id === "navegador")!;
    expect(m.detalhes.join(" ")).toMatch(/Tarefa com modelo GPT espera: falta OPENAI_API_KEY/);
  });

  it("a lista das ações: onde pede, o modelo e o custo médio real (ou a estimativa sem histórico)", () => {
    const a = acoesDoNavegador(nav());
    expect(a.map((x) => x.caso)).toEqual([...CASOS_DO_NAVEGADOR]);
    const coleta = a.find((x) => x.caso === "coleta_publica")!;
    expect(coleta.modelo).toBe("Escolhido no pedido (padrão Claude Sonnet 5.5; mais usado: GPT-6.1 Sol)");
    expect(coleta.custo).toBe("US$ 0,03 em média (3 feitas)");
    expect(a.find((x) => x.caso === "conferir_site")!).toMatchObject({ modelo: "Sem modelo (roteiro fixo)", custo: "US$ 0", ligada: true });
    expect(a.find((x) => x.caso === "perfil_publico")!.custo).toMatch(/^cerca de US\$ 0,06 com o padrão \(sem histórico; teto US\$ 0,60\)$/);
  });
});

const ESTADO: EstadoDoNavegador = {
  casos: CASOS_DO_NAVEGADOR.map((c) => ({ valor: c, rotulo: DEFINICOES_DOS_CASOS[c].rotulo, usa_modelo: DEFINICOES_DOS_CASOS[c].usaModelo, ligado: true, motivo: null, teto_passos: DEFINICOES_DOS_CASOS[c].tetoPassos, teto_custo_usd: DEFINICOES_DOS_CASOS[c].tetoCustoUsd })),
  com_modelo: true,
  modelos: modelosDoComputador(CATALOGO) as EstadoDoNavegador["modelos"],
  modelo_padrao: "anthropic:claude-sonnet-5-5",
  executores: [{ nome: "w", visto_em: new Date().toISOString(), versao: "cus-1.2", casos: [], provedores: ["anthropic"] }],
};

const montar = (el: ReturnType<typeof h>) => render(h(QueryClientProvider, { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) }, el));

describe("na tela", () => {
  beforeEach(() => invocar.mockReset());

  it("o pedido com modelo: só modelos com computer use, o porquê no '?', custo antes e o modelo vai no pedido", async () => {
    invocar.mockImplementation(async (_f: string, { body = {} }: { body?: Record<string, unknown> } = {}) => {
      if (body.acao === "estado") return { data: ESTADO, error: null };
      if (body.acao === "pedir") return { data: { tarefa: { id: "t" }, custo_estimado_usd: 0.056, teto_custo_usd: 0.6 }, error: null };
      return { data: {}, error: null };
    });
    montar(h(BotaoDoNavegador, { caso: "perfil_publico", clientId: "11111111-1111-4111-8111-111111111111", origem: "mesa_ads", url: "https://www.instagram.com/rival/" }));
    await waitFor(() => expect(document.querySelector('[data-navegador-do-agente="perfil_publico"]')!.getAttribute("data-ligado")).toBe("sim"));
    fireEvent.click(document.querySelector('[data-navegador-do-agente="perfil_publico"]') as HTMLButtonElement);
    const seletor = (await screen.findByLabelText("Modelo do computer use")) as HTMLSelectElement;
    expect(Array.from(seletor.options).map((o) => o.value)).toEqual(["anthropic:claude-sonnet-5-5", "openai:gpt-6.1-sol", "anthropic:claude-opus-5-5", "openai:gpt-6-astra"]);
    expect(seletor.value).toBe("anthropic:claude-sonnet-5-5");
    expect(seletor.options[0].textContent).toMatch(/Claude Sonnet 5\.5 \(padrão\)/);
    expect(screen.getByRole("button", { name: "Por que só estes modelos" })).toBeInTheDocument();
    expect(document.querySelector("[data-custo-do-navegador]")!.textContent).toMatch(/Custo estimado: US\$ 0,06, teto de US\$ 0,60/);
    fireEvent.change(seletor, { target: { value: "openai:gpt-6.1-sol" } });
    expect(document.querySelector("[data-custo-do-navegador]")!.textContent).toMatch(/não tem a chave deste provedor/);
    fireEvent.click(document.querySelector("[data-pedir-navegador]") as HTMLButtonElement);
    await waitFor(() => expect(invocar.mock.calls.some((c) => ((c[1] || {}) as { body?: Record<string, unknown> }).body?.acao === "pedir")).toBe(true));
    const pedido = invocar.mock.calls.find((c) => ((c[1] || {}) as { body?: Record<string, unknown> }).body?.acao === "pedir")![1].body;
    expect(pedido).toMatchObject({ caso: "perfil_publico", modelo_id: "openai:gpt-6.1-sol", origem: "mesa_ads", url: "https://www.instagram.com/rival/" });
  });

  it("o cartão do resultado mostra fonte, prints e o que achou; o insumo leva para a mesa com um clique", async () => {
    invocar.mockImplementation(async (_f: string, { body = {} }: { body?: Record<string, unknown> } = {}) => {
      if (body.acao === "cartao") {
        return {
          data: cartao("coleta_publica", { resumo: "Doceria com entrega", dados: [{ item: "Preço do bolo", valor: "R$ 90", fonte: "https://www.rival.com.br/precos" }], avisos: ["Não achou o horário."], fontes: ["https://www.rival.com.br/"], custo_usd: 0.031 }, [
            { rotulo: "Página aberta", url: "https://x.supabase.co/s/1.png", storage_path: "c1/computador/t1/passo-01.png" },
          ]),
          error: null,
        };
      }
      return { data: {}, error: null };
    });
    const aoUsar = vi.fn(async () => "Rival entrou no bloco Mercado");
    const tarefa = { id: "t1", titulo: "Coletar dados públicos de concorrentes: rival.com.br", caso: "coleta_publica" } as never;
    montar(h(ResultadoDoNavegador, { tarefa, onFechar: () => undefined, insumo: { aoUsar } }));
    await waitFor(() => expect(document.querySelector('[data-cartao-do-navegador="coleta_publica"]')).not.toBeNull());
    const corpo = document.querySelector("[data-cartao-do-navegador]") as HTMLElement;
    expect(corpo.textContent).toContain("Doceria com entrega");
    expect(corpo.textContent).toContain("Fonte: www.rival.com.br/");
    expect(corpo.textContent).toContain("Preço do bolo: R$ 90");
    expect(corpo.textContent).toContain("Não achou o horário.");
    expect(corpo.querySelector("img")!.getAttribute("src")).toBe("https://x.supabase.co/s/1.png");
    const usar = document.querySelector("[data-usar-insumo]") as HTMLButtonElement;
    expect(usar.textContent).toContain("Pôr no bloco Mercado");
    fireEvent.click(usar);
    await waitFor(() => expect(aoUsar).toHaveBeenCalledTimes(1));
  });

  it("nomes e provedor do executor na tela", () => {
    expect(nomeDoModelo({ id: "openai:gpt-6.1-sol", rotulo: "GPT-6.1 Sol (OpenAI direta)" })).toBe("GPT-6.1 Sol");
    expect(nomeDoModelo(null, "anthropic:claude-opus-5-5")).toBe("claude-opus-5-5");
    expect(executorTemProvedor(ESTADO, "anthropic:claude-opus-5-5")).toBe(true);
    expect(executorTemProvedor(ESTADO, "openai:gpt-6.1-sol")).toBe(false);
    expect(executorTemProvedor({ ...ESTADO, executores: [] }, "openai:gpt-6.1-sol")).toBeNull();
  });

  it("cada mesa no lugar certo, com o insumo; janelas no centro; função atrás do JWT", () => {
    expect(ler("src/components/mesa-site/EtapaPublicacao.tsx")).toContain('caso="conferir_site"');
    const refs = ler("src/components/mesa-site/EtapaReferencias.tsx");
    expect(refs).toContain('caso="capturar_referencia"');
    expect(refs).toContain("insumo={levarParaDirecao}");
    const ads = ler("src/components/mesa-ads/AbaReferencias.tsx");
    expect(ads).toContain('caso="perfil_publico"');
    expect(ads).toContain("insumo={guardarPerfil}");
    const idv = ler("src/components/mesa-identidade/EtapaPesquisa.tsx");
    expect(idv).toContain('caso="concorrentes_visuais"');
    expect(idv).toContain("insumo={guardarConcorrentes}");
    expect(ler("src/components/mesa-proposta/EtapaRascunho.tsx")).toContain("concorrenteParaProposta");
    const cartaoTela = ler("src/components/agentes/ResultadoDoNavegador.tsx");
    expect(cartaoTela).toContain("<JanelaCentral");
    expect(cartaoTela).not.toContain("SheetContent");
    expect(ler("supabase/config.toml")).toContain("[functions.computador-do-agente]\n    verify_jwt = true");
  });

  it("operação: atalho do navegador, ligar-todos com os três workers e o conferir com Chromium, chave e variável", () => {
    expect(ler("workers/ligar/ligar-navegador.cmd")).toContain("-Motor navegador");
    const ps = ler("workers/ligar/ligar-motores.ps1");
    expect(ps).toMatch(/foreach \(\$m in 'render', 'codigo', 'navegador'\)/);
    expect(ps).toContain("function Conferir-Navegador");
    expect(ps).toContain("COMPUTADOR_COM_MODELO_LIGADO");
    expect(ps).toMatch(/chromium_headless_shell/);
    expect(ler("docs/motores/LIGAR-OS-MOTORES.md")).toContain("ligar-navegador.cmd");
  });
});
