import { createElement as h } from "react";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";

/**
 * Jornada da Mesa Site (25/10/2026): objetivo, partida (zero, referência
 * Fiel/Próximo/Criativo, site pronto da galeria), conferir o cliente
 * pré-preenchido, construir com o contrato do motor e ajustar com o diretor
 * de site (Confirmar e Desfazer). Função falsa; nada sai para a rede.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), respostas: {} as Record<string, (corpo: any) => unknown> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    channel: () => ({ on: function () { return this; }, subscribe: function () { return this; } }),
    removeChannel: vi.fn(),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://x/y" }, error: null }), upload: async () => ({ error: null }) }) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import EtapaComBarra from "@/components/mesa-site/BarraDaEtapa";
import PassoObjetivo from "@/components/mesa-site/PassoObjetivo";
import PassoPartida, { partidaDaTela } from "@/components/mesa-site/PassoPartida";
import PassoConferir, { editadoDaTela, valoresDoContexto } from "@/components/mesa-site/PassoConferir";
import PassoConstruir, { pedidoDaJornada } from "@/components/mesa-site/PassoConstruir";
import AgenteDoSite from "@/components/mesa-site/AgenteDoSite";
import type { LinhaDoSite } from "@/components/mesa-site/siteApi";
import {
  contextoDasFontes,
  contextoVazio,
  instrucaoDaConstrucao,
  juntarContexto,
  MODOS_DA_REFERENCIA,
  modelosDoObjetivo,
  normalizarContratoDaConstrucao,
  OBJETIVOS_DO_SITE,
  PASSOS_DA_JORNADA,
  passoInicial,
  urlPublicaDaReferencia,
} from "../../supabase/functions/mesa-site/modulos/jornada-do-site";
import { montarCopyEscolhida, normalizarCopyEmDuasVersoes, perguntasDasVersoes, secoesComPapel } from "../../supabase/functions/mesa-site/modulos/copy-da-pagina";
import { MODELOS_PRONTOS } from "../../supabase/functions/mesa-site/modulos/modelos-prontos";
import { mapaPadrao } from "../../supabase/functions/_shared/site-biblioteca";
import { ICONES_DAS_ETAPAS } from "@/components/mesa-foto/IconesDasEtapas";

const CLIENTE = "22222222-2222-4222-8222-222222222222";
const SITE = "33333333-3333-4333-8333-333333333333";

const valor = (): MesaValor =>
  ({ clientId: CLIENTE, clientName: "Café", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 10, catalogo: [], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(), marcas: [], marca: null }) as unknown as MesaValor;

const site = (extra: Partial<LinhaDoSite> = {}): LinhaDoSite =>
  ({ id: SITE, client_id: CLIENTE, marca_id: null, nome: "Site do café", projeto: "site-do-cafe-33333333", etapa: "briefing", briefing: {}, referencias: [], dna: {}, direcao: {}, conteudo: {}, imagens: [], revisao: {}, publicacao: {}, modelo: null, tipo: "landing", mapa: mapaPadrao("landing"), estilo: {}, integracoes: {}, seo: {}, arquivado_em: null, atualizado_em: "2026-10-25T10:00:00Z", ...extra }) as LinhaDoSite;

const contexto = () => ({
  ...contextoVazio(),
  marca: { nome: "Café da Esquina", logo: true, cores: ["#7A3E1D"], fontes: ["Sora"], tom: "acolhedor" },
  negocio: "Torrefação de café especial em Curitiba",
  publico: "quem trabalha em casa e quer café fresco",
  oferta: "assinatura mensal de café",
  produtos: ["Assinatura mensal", "Café para empresas"],
  contatos: { whatsapp: "5541999998888", telefone: "", email: "oi@cafe.com.br" },
  instagram: "@cafedaesquina",
});

/** Função falsa: responde pela ação (mesa-site) ou pela ação do motor (motor-codigo) e anota. */
function rota(funcao: string, acao: string, f: (corpo: any) => unknown) {
  mock.respostas[`${funcao}:${acao}`] = f;
}
const corpos = (funcao: string, acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === funcao && c[1].body.acao === acao).map((c: any[]) => c[1].body);

function montar(filho: ReturnType<typeof h>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(MesaProvider, { valor: valor(), children: filho }))));
}

beforeEach(() => {
  mock.invoke.mockReset();
  mock.respostas = {};
  window.localStorage.clear();
  mock.invoke.mockImplementation(async (funcao: string, { body }: { body: any }) => {
    const f = mock.respostas[`${funcao}:${body.acao}`];
    if (!f) return { data: { custo_usd: 0 }, error: null };
    return { data: f(body), error: null };
  });
  rota("motor-codigo", "listar", () => ({ trabalhos: [], executor: null, executor_vivo: false }));
  rota("motor-codigo", "estimar", () => ({ estimativa_usd: 0.8, teto_sugerido_usd: 1.2, livre_usd: 9, passos: 1 }));
});

// ---------------------------------------------------------------------------- regras puras

describe("jornada: regras puras", () => {
  it("os passos têm ícone próprio na mesa e o site novo abre no primeiro que falta", () => {
    const icones = PASSOS_DA_JORNADA.map((p) => (ICONES_DAS_ETAPAS.site as Record<string, unknown>)[p.valor]);
    expect(icones.every(Boolean)).toBe(true);
    expect(new Set(icones).size).toBe(icones.length);
    expect(passoInicial({ direcao: {} })).toBe("objetivo");
    expect(passoInicial({ direcao: { jornada: { objetivo: "captar" } } })).toBe("partida");
    expect(passoInicial({ direcao: { jornada: { objetivo: "captar", partida: { tipo: "zero" } } } })).toBe("construir");
  });

  it("o contrato da construção sai normalizado e o modo Fiel nunca promete copiar conteúdo de terceiros", () => {
    const fiel = MODOS_DA_REFERENCIA.find((m) => m.id === "fiel")!;
    expect(fiel.descricao).toBe("Copia a estrutura e o layout, com textos, imagens e marca do cliente.");
    expect(urlPublicaDaReferencia("localhost:3000")).toBeNull();
    expect(urlPublicaDaReferencia("http://192.168.0.2/")).toBeNull();
    expect(urlPublicaDaReferencia("cafe.com.br")).toBe("https://cafe.com.br/");
    const c = normalizarContratoDaConstrucao({ objetivo: "vender", partida: { tipo: "referencia", url: "https://exemplo.com.br", modo: "fiel" }, motor: "claude_code", modelo_id: "openrouter:x", contexto_do_cliente: { negocio: "Café — torra" } });
    expect(c).toEqual({ objetivo: "vender", partida: { tipo: "referencia", url: "https://exemplo.com.br/", modo: "fiel" }, motor: "claude_code", modelo_id: "openrouter:x", contexto_do_cliente: expect.objectContaining({ negocio: "Café, torra" }) });
    expect(instrucaoDaConstrucao(c!)).toContain("modo Fiel");
    expect(normalizarContratoDaConstrucao({ objetivo: "inventado", partida: { tipo: "zero" } })).toBeNull();
    expect(normalizarContratoDaConstrucao({ objetivo: "captar", partida: { tipo: "referencia", url: "nada" } })).toBeNull();
    expect(normalizarContratoDaConstrucao({ objetivo: "captar", partida: { tipo: "zero" }, motor: "outro" })).not.toHaveProperty("motor");
  });

  it("a galeria filtra pelo objetivo, põe o nicho do cliente primeiro e todo modelo tem licença", () => {
    const vender = modelosDoObjetivo(MODELOS_PRONTOS, "vender", ["cafe"]);
    expect(vender.lista.length).toBeGreaterThan(0);
    expect(vender.lista.every((m) => (m.objetivo as string[]).indexOf("vender") >= 0)).toBe(true);
    expect(vender.lista.every((m) => !!m.licenca)).toBe(true);
    if (vender.doNicho) expect(vender.lista[0].nichos.some((n) => n.indexOf("cafe") >= 0 || "cafe".indexOf(n) >= 0)).toBe(true);
    expect(modelosDoObjetivo(MODELOS_PRONTOS, "bio", []).lista.every((m) => (m.objetivo as string[]).indexOf("bio") >= 0)).toBe(true);
    // Item inválido (sem licença ou repositório) nunca chega à tela.
    expect(modelosDoObjetivo([{ id: "x", nome: "X", objetivo: ["captar"], nichos: [], repositorio: "https://a", licenca: "" }], "captar", []).lista).toEqual([]);
  });

  it("outra marca não herda as ofertas do cliente inteiro; o editado vale campo a campo", () => {
    const base = { nomeCliente: "Acerbi", kit: { cores: ["#112233"], fontes: [], temLogo: false, tom: null }, contexto: { negocio: "Moda" }, estrategia: { tagline: "Vista-se bem", estrategia: {} }, dossie: null, instagram: ["acerbi"], cadastro: { telefone: "41999990000", email: "a@b.com", endereco: "Rua A, 1" }, site: { seo: {}, integracoes: {} }, ofertas: ["Oferta da Acerbi"], copyDoSite: [] };
    const principal = contextoDasFontes({ ...base, marca: { nome: "Acerbi", principal: true } });
    expect(principal.contexto.produtos).toEqual(["Oferta da Acerbi"]);
    expect(principal.origem.produtos).toBe("ads");
    const outra = contextoDasFontes({ ...base, marca: { nome: "CME", principal: false } });
    expect(outra.contexto.produtos).toEqual([]);
    expect(outra.contexto.marca.nome).toBe("CME");
    expect(outra.contexto.contatos.whatsapp).toBe("41999990000");
    expect(outra.origem["contatos.whatsapp"]).toBe("cadastro");
    const junto = juntarContexto(principal.contexto, { contatos: { whatsapp: "" }, oferta: "Nova oferta", marca: { nome: "Hack" } });
    expect(junto.contatos.whatsapp).toBe("");
    expect(junto.contatos.email).toBe("a@b.com");
    expect(junto.oferta).toBe("Nova oferta");
    expect(junto.marca.nome).toBe("Acerbi");
  });

  it("a copy da página: 2 versões por seção, o Jev escolhe, a escolhida passa pela limpeza e a outra fica guardada", () => {
    const objetivo = OBJETIVOS_DO_SITE.find((o) => o.id === "captar")!;
    const papeis = secoesComPapel([
      { id: "topo", tipo: "topo", nome: "Topo", formula: "", so_dado_real: false },
      { id: "hero", tipo: "hero", nome: "Hero", formula: "f", so_dado_real: false },
      { id: "faq", tipo: "faq", nome: "FAQ", formula: "f", so_dado_real: false },
    ], objetivo);
    expect(papeis.map((p) => [p.id, p.PAPEL])).toEqual([["hero", "Gancho"], ["faq", "Objeções"]]);
    const copy = normalizarCopyEmDuasVersoes({
      abertura: [{ headline: "Café fresco toda semana na sua porta hoje mesmo", subtitulo: "s1", cta: "Quero" }, { headline: "Seu café velho acabou", subtitulo: "s2", cta: "Assinar" }],
      secoes: [{ id: "hero", versoes: [{ titulo: "A", texto: "ta", itens: [] }, { titulo: "B", texto: "tb", itens: [] }] }, { id: "invasora", versoes: [{ titulo: "X", texto: "x", itens: [] }] }],
      faq: [{ pergunta: "Entrega?", resposta: "Sim." }],
      seo: { titulo: "t", descricao: "d", palavras: ["café"] },
    }, ["hero", "faq"]);
    expect(copy.secoes.map((s) => s.id)).toEqual(["hero"]);
    const q = perguntasDasVersoes(copy, { hero: { PAPEL: "Gancho", MISSAO: "m" } });
    expect(Object.keys(q).sort()).toEqual(["abertura", "s0"]);
    expect(q.s0.type).toBe("choice");
    const e = montarCopyEscolhida(copy, { abertura: { choice: "b" }, s0: { choice: "b", probabilities: { a: 0.2, b: 0.8 } } }, objetivo, (t) => t.replace("tb", "tb limpo"));
    expect(e!.opcao.headline).toBe("Seu café velho acabou");
    expect(e!.opcao.secoes[0]).toEqual({ id: "hero", titulo: "B", texto: "tb limpo", itens: [] });
    expect(e!.por_secao.hero.opcoes.map((o) => o.titulo)).toEqual(["B", "A"]);
    expect(e!.por_secao.hero.prob).toBe(0.8);
  });
});

// ---------------------------------------------------------------------------- tela

describe("jornada: tela", () => {
  it("objetivo: um clique grava e segue para a partida", async () => {
    rota("mesa-site", "jornada_salvar", (c) => ({ site: site({ direcao: { jornada: { objetivo: c.objetivo } } }) }));
    const ir = vi.fn();
    montar(h(EtapaComBarra, { etapa: "objetivo", onIrPara: ir, etapas: PASSOS_DA_JORNADA, children: h(PassoObjetivo, { site: site(), onIrPara: ir }) }));
    expect(screen.getAllByRole("button", { pressed: false }).length).toBeGreaterThanOrEqual(8);
    fireEvent.click(document.querySelector('[data-objetivo="captar"]')!);
    await waitFor(() => expect(ir).toHaveBeenCalledWith("partida"));
    expect(corpos("mesa-site", "jornada_salvar")[0]).toEqual(expect.objectContaining({ site_id: SITE, objetivo: "captar" }));
  });

  it("partida por referência: modos Fiel, Próximo e Criativo com a regra e o Seguir grava a partida", async () => {
    rota("mesa-site", "jornada_salvar", (c) => ({ site: site({ direcao: { jornada: { objetivo: "vender", partida: c.partida } } }) }));
    const ir = vi.fn();
    montar(h(EtapaComBarra, { etapa: "partida", onIrPara: ir, etapas: PASSOS_DA_JORNADA, children: h(PassoPartida, { site: site({ direcao: { jornada: { objetivo: "vender" } } }) }) }));
    const seguir = () => document.querySelector('[data-seguir-etapa="conferir"]') as HTMLButtonElement;
    expect(seguir().disabled).toBe(true);
    fireEvent.click(document.querySelector('[data-partida="referencia"]')!);
    fireEvent.change(screen.getByLabelText("Endereço da referência"), { target: { value: "siteadmirado.com.br" } });
    fireEvent.click(document.querySelector('[data-modo="fiel"]')!);
    expect(document.querySelector('[data-regra-do-modo="fiel"]')!.textContent).toBe("Copia a estrutura e o layout, com textos, imagens e marca do cliente.");
    fireEvent.click(document.querySelector('[data-modo="criativo"]')!);
    expect(document.querySelector('[data-regra-do-modo="criativo"]')).toBeTruthy();
    fireEvent.click(document.querySelector('[data-modo="fiel"]')!);
    await waitFor(() => expect(seguir().disabled).toBe(false));
    fireEvent.click(seguir());
    await waitFor(() => expect(ir).toHaveBeenCalledWith("conferir"));
    expect(corpos("mesa-site", "jornada_salvar")[0].partida).toEqual({ tipo: "referencia", url: "https://siteadmirado.com.br/", modo: "fiel" });
    expect(partidaDaTela("modelo_pronto", "", "proximo", null).motivo).toBe("Escolha um site pronto da galeria");
  });

  it("partida por site pronto: galeria filtrada pelo nicho, licença à vista e a recomendação do Jev", async () => {
    const lista = modelosDoObjetivo(MODELOS_PRONTOS, "cardapio", ["cafe", "restaurante"]);
    rota("mesa-site", "modelos_prontos_listar", () => ({ modelos: lista.lista, do_nicho: lista.doNicho, nichos: ["restaurante"], objetivo: "cardapio", recomendado: lista.lista[0].id, confianca: 0.7, custo_usd: 0.0004 }));
    rota("mesa-site", "jornada_salvar", (c) => ({ site: site({ direcao: { jornada: { objetivo: "cardapio", partida: c.partida } } }) }));
    const ir = vi.fn();
    montar(h(EtapaComBarra, { etapa: "partida", onIrPara: ir, etapas: PASSOS_DA_JORNADA, children: h(PassoPartida, { site: site({ direcao: { jornada: { objetivo: "cardapio" } } }) }) }));
    fireEvent.click(document.querySelector('[data-partida="modelo_pronto"]')!);
    await waitFor(() => expect(document.querySelector("[data-galeria-de-prontos]")).toBeTruthy());
    expect(corpos("mesa-site", "modelos_prontos_listar")[0]).toEqual(expect.objectContaining({ site_id: SITE, objetivo: "cardapio" }));
    const cartoes = document.querySelectorAll("[data-modelo-pronto]");
    expect(cartoes.length).toBe(lista.doNicho || lista.lista.length);
    cartoes.forEach((c) => expect(c.querySelector("[data-licenca]")!.textContent).toMatch(/^Licença MIT/));
    expect(document.querySelector(`[data-modelo-pronto="${lista.lista[0].id}"] [data-recomendado]`)).toBeTruthy();
    fireEvent.click(document.querySelector(`[data-modelo-pronto="${lista.lista[0].id}"] button`)!);
    fireEvent.click(document.querySelector('[data-seguir-etapa="conferir"]')!);
    await waitFor(() => expect(ir).toHaveBeenCalledWith("conferir"));
    expect(corpos("mesa-site", "jornada_salvar")[0].partida).toEqual({ tipo: "modelo_pronto", modelo_id: lista.lista[0].id });
  });

  it("conferir: o cliente vem preenchido, a edição grava só o que mudou", async () => {
    rota("mesa-site", "jornada_contexto", () => ({ contexto: contexto(), do_cliente: contexto(), origem: { negocio: "marca", "contatos.whatsapp": "site" }, editado: {}, nichos: ["cafe"] }));
    rota("mesa-site", "jornada_salvar", () => ({ site: site() }));
    montar(h(EtapaComBarra, { etapa: "conferir", onIrPara: vi.fn(), etapas: PASSOS_DA_JORNADA, children: h(PassoConferir, { site: site() }) }));
    await waitFor(() => expect(screen.getByLabelText("WhatsApp")).toBeTruthy());
    expect((screen.getByLabelText("Negócio") as HTMLTextAreaElement).value).toBe("Torrefação de café especial em Curitiba");
    expect((screen.getByLabelText("Produtos e serviços") as HTMLTextAreaElement).value).toBe("Assinatura mensal\nCafé para empresas");
    expect(document.querySelector('[data-campo="negocio"]')!.getAttribute("title")).toBe("Veio de: contexto da marca");
    fireEvent.change(screen.getByLabelText("WhatsApp"), { target: { value: "5541988887777" } });
    fireEvent.click(document.querySelector("[data-salvar-etapa]")!);
    await waitFor(() => expect(corpos("mesa-site", "jornada_salvar").length).toBe(1));
    expect(corpos("mesa-site", "jornada_salvar")[0].contexto).toEqual({ contatos: { whatsapp: "5541988887777" } });
    const v = valoresDoContexto(contexto());
    expect(editadoDaTela({ ...v, produtos: "Um\n\nDois " }, v)).toEqual({ produtos: ["Um", "Dois"] });
  });

  it("construir manda o contrato certo ao motor e a copy da página troca de versão", async () => {
    rota("mesa-site", "jornada_contexto", () => ({ contexto: contexto(), do_cliente: contexto(), origem: {}, editado: {}, nichos: [] }));
    rota("motor-codigo", "pedir", () => ({ trabalho: { id: "t1", estado: "na_fila", tipo: "construir" }, estimativa_usd: 0.8 }));
    rota("mesa-site", "copy_da_pagina_gerar", () => ({ site: site(), custo_usd: 0.05 }));
    rota("mesa-site", "conteudo_editar", () => ({ site: site() }));
    const ir = vi.fn();
    const comCopy = site({
      direcao: { jornada: { objetivo: "captar", partida: { tipo: "referencia", url: "https://siteadmirado.com.br/", modo: "proximo" } } },
      conteudo: {
        motor: "copy_da_pagina",
        escolhida: 0,
        opcoes: [{ conceito: "c", headline: "Café fresco na porta", subtitulo: "s", cta: "Quero", secoes: [{ id: "hero", titulo: "A", texto: "ta", itens: [] }], faq: [], seo: { titulo: "", descricao: "", palavras: [] } }],
        por_secao: { hero: { opcoes: [{ titulo: "A", texto: "ta", itens: [] }, { titulo: "B", texto: "tb", itens: [] }] } },
      },
    });
    montar(h(EtapaComBarra, { etapa: "construir", onIrPara: ir, etapas: PASSOS_DA_JORNADA, children: h(PassoConstruir, { site: comCopy, onIrPara: ir }) }));
    await waitFor(() => expect((document.querySelector("[data-construir-jornada]") as HTMLButtonElement).disabled).toBe(false));
    // Copy: escrever de novo e trocar a versão de uma seção.
    fireEvent.click(document.querySelector("[data-escrever-copy]")!);
    await waitFor(() => expect(corpos("mesa-site", "copy_da_pagina_gerar").length).toBe(1));
    fireEvent.click(document.querySelector('[data-trocar-versao="hero"]')!);
    await waitFor(() => expect(corpos("mesa-site", "conteudo_editar").length).toBe(1));
    expect(corpos("mesa-site", "conteudo_editar")[0]).toEqual(expect.objectContaining({ secao: "hero", campos: { titulo: "B", texto: "tb", itens: [] } }));
    // Construir: o contrato.
    fireEvent.click(document.querySelector("[data-construir-jornada]")!);
    await waitFor(() => expect(ir).toHaveBeenCalledWith("ajustar"));
    const pedido = corpos("motor-codigo", "pedir")[0];
    expect(pedido).toEqual(expect.objectContaining({ client_id: CLIENTE, site_id: SITE, tipo: "construir", teto_usd: 1.2, objetivo: "captar", partida: { tipo: "referencia", url: "https://siteadmirado.com.br/", modo: "proximo" } }));
    expect(pedido.secoes.length).toBeGreaterThan(0);
    expect(pedido.contexto_do_cliente.negocio).toBe("Torrefação de café especial em Curitiba");
    expect(pedido).not.toHaveProperty("motor");
    expect(normalizarContratoDaConstrucao(pedido)).not.toBeNull();
    // Motor escondido no avançado: escolhido, vai no pedido.
    expect(pedidoDaJornada({ clientId: CLIENTE, siteId: SITE, secoes: ["hero"], tetoUsd: 1, objetivo: "captar", partida: { tipo: "zero" }, contexto: null, motor: "opencode", modeloId: "m1" })).toEqual(expect.objectContaining({ motor: "opencode", modelo_id: "m1", contexto_do_cliente: {} }));
    expect(document.querySelector("[data-seletor-de-motor]")).toBeNull();
    fireEvent.click(within(document.querySelector("[data-avancado-da-construcao]") as HTMLElement).getByRole("button", { name: /Avançado/ }));
    expect(document.querySelector("[data-seletor-de-motor]")).toBeTruthy();
  });

  it("ajustar: o pedido ao diretor vira cartão; Confirmar executa e Desfazer volta", async () => {
    const acao = {
      tipo: "acao_agente",
      agente: "site",
      id: "acao-1",
      resumo: "Trocar o preset para Editorial claro",
      itens: [{ ref: "a1", alvo_id: SITE, titulo: "Preset", detalhe: null, operacao: "escolher_preset", rotulo: "Escolher preset", para: "editorial_claro" }],
      ignorados: [],
      recusados: [],
      contexto: { site_id: SITE },
    };
    rota("mesa-site", "agente_historico", () => ({ conversa_id: "c1", mensagens: [{ id: "m1", papel: "agente", conteudo: "Monto o cartão.", anexos: [acao] }] }));
    rota("mesa-site", "executar_acao_agente", () => ({ anexo: { ...acao, executada_em: "2026-10-25T10:00:00Z", resultados: [{ ref: "a1", alvo_id: SITE, titulo: "Preset", operacao: "escolher_preset", ok: true, desfazer: { tipo: "estilo" } }] }, feitos: 1, falhas: 0, custo_usd: 0 }));
    rota("mesa-site", "desfazer_acao_agente", () => ({ anexo: { ...acao, executada_em: "2026-10-25T10:00:00Z", desfeita_em: "2026-10-25T10:01:00Z" }, voltaram: 1, falharam: 0 }));
    montar(h(AgenteDoSite, { site: site(), rascunho: "", onRascunho: vi.fn(), onIrPara: vi.fn() }));
    const confirmar = await screen.findByRole("button", { name: /Confirmar/ });
    await act(async () => {
      fireEvent.click(confirmar);
    });
    await waitFor(() => expect(corpos("mesa-site", "executar_acao_agente")[0]).toEqual(expect.objectContaining({ mensagem_id: "m1", acao_id: "acao-1" })));
    const desfazer = await screen.findByRole("button", { name: /Desfazer/ });
    await act(async () => {
      fireEvent.click(desfazer);
    });
    await waitFor(() => expect(corpos("mesa-site", "desfazer_acao_agente").length).toBe(1));
  });
});

// ---------------------------------------------------------------------------- 25/10: tela inicial e publicar

import BibliotecaDeSitesProntos, { jornadaDoPronto } from "@/components/mesa-site/BibliotecaDeSitesProntos";
import EtapaPublicacao from "@/components/mesa-site/EtapaPublicacao";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("tela inicial e publicar (25/10, prints do dono)", () => {
  const ler = (r: string) => readFileSync(resolve(__dirname, "../..", r), "utf8");

  it("a tela inicial rola com a página e fica na largura das mesas; os passos não têm coluna estreita", () => {
    const pagina = ler("src/pages/MesaSite.tsx");
    const inicio = pagina.slice(pagina.indexOf("{!site && ("), pagina.indexOf("{site && ("));
    // A RegiaoRolavel sem altura fixa (overflow-y-auto + overscroll-contain) engolia a roda do mouse.
    expect(inicio).not.toMatch(/<RegiaoRolavel/);
    expect(inicio).toContain("<BibliotecaDeSitesProntos");
    // A região da etapa não pode ganhar rolagem lateral (a lista -mx-2 da prévia passava 4 px).
    expect(pagina).toMatch(/data-regiao-da-etapa=\{etapa\}/);
    expect(pagina).toMatch(/className="pb-6 lg:overflow-x-hidden lg:pr-2" data-regiao-da-etapa/);
    for (const f of ["ListaDeSites", "GaleriaDeModelos", "PassoObjetivo", "PassoPartida", "PassoConferir", "PassoConstruir", "PassoAjustar"]) {
      expect(ler(`src/components/mesa-site/${f}.tsx`)).not.toMatch(/max-w-\[(8|9)\d\dpx\]/);
    }
  });

  it("a biblioteca mostra os 12 sites prontos com miniatura real e 'Usar este site' cria o site já com a partida", async () => {
    rota("mesa-site", "sites_listar", () => ({ sites: [] }));
    rota("mesa-site", "site_criar", (b) => ({ site: site({ id: "44444444-4444-4444-8444-444444444444", nome: b.nome, tipo: b.tipo }) }));
    rota("mesa-site", "jornada_salvar", () => ({ site: site() }));
    const onAbrir = vi.fn();
    montar(h(BibliotecaDeSitesProntos, { marcaId: null, onAbrir }));
    const cartoes = document.querySelectorAll("[data-modelo-pronto]");
    expect(cartoes.length).toBe(MODELOS_PRONTOS.length);
    expect(MODELOS_PRONTOS.length).toBe(12);
    expect(document.querySelectorAll('[data-miniatura="real"] img').length).toBe(12);
    // Imagem que não abre vira o ícone com o nome (nada de buraco).
    fireEvent.error(document.querySelector('[data-modelo-pronto="agency"] img')!);
    expect(document.querySelector('[data-modelo-pronto="agency"] [data-miniatura]')!.getAttribute("data-miniatura")).toBe("sem-imagem");
    fireEvent.click(document.querySelector('[data-usar-pronto="agency"]')!);
    await waitFor(() => expect(onAbrir).toHaveBeenCalledWith("44444444-4444-4444-8444-444444444444", "conferir"));
    expect(corpos("mesa-site", "site_criar")[0]).toMatchObject({ tipo: "portfolio", client_id: CLIENTE });
    expect(corpos("mesa-site", "jornada_salvar")[0]).toEqual({ acao: "jornada_salvar", ...jornadaDoPronto(MODELOS_PRONTOS.find((m) => m.id === "agency")!, "44444444-4444-4444-8444-444444444444") });
    expect(corpos("mesa-site", "jornada_salvar")[0].partida).toEqual({ tipo: "modelo_pronto", modelo_id: "agency" });
  });

  it("publicar é um bloco só: estado em cima, endereço padrão ou domínio próprio, e 'Sem domínio' não se repete", async () => {
    rota("mesa-site", "publicacao_estado", () => ({ vercel_ligada: true, faltas: [], dominio: null, registrador: "registro_br", cartao: null, estado: "sem_dominio", deploy_url: null, zip: null }));
    rota("mesa-site", "versoes_listar", () => ({ versoes: [], aviso: null }));
    rota("mesa-site", "previa_dados", () => {
      throw new Error("fora do ar");
    });
    const estados: string[] = [];
    const { container } = montar(h(EtapaComBarra, { etapa: "ajustar", onIrPara: vi.fn(), etapas: PASSOS_DA_JORNADA, children: h(EtapaPublicacao, { site: site() }) }));
    await waitFor(() => expect(container.querySelector("[data-estado-da-publicacao]")).not.toBeNull());
    estados.push(container.textContent || "");
    expect(container.querySelector("[data-estado-da-publicacao]")!.textContent).toMatch(/Pronto para publicar/);
    expect(container.querySelector('[data-endereco-do-site="padrao"]')).not.toBeNull();
    expect((container.textContent || "").match(/Sem domínio/g)).toBeNull();
    // Domínio próprio: o campo e o registrador aparecem no mesmo bloco.
    fireEvent.click(within(container.querySelector("[data-endereco-do-site]") as HTMLElement).getByText("Domínio próprio"));
    expect(container.querySelector("[data-dominio-proprio]")).not.toBeNull();
    expect(screen.getByLabelText("Domínio do cliente")).toBeTruthy();
    // Checagens, endereço e no ar moram no mesmo Secao "Publicar" (sem as três seções soltas de antes).
    expect(container.querySelectorAll("h2").length).toBeGreaterThan(0);
    expect(Array.from(container.querySelectorAll("h2")).map((x) => x.textContent)).not.toContain("Domínio");
  });
});
