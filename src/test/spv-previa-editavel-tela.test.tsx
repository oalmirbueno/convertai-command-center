import { createElement as h } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";

/**
 * Frente SPV (30/09): a prévia editável na etapa Construção. A prévia rápida
 * montada no painel (texto escapado, endereço da copy, selos da construção,
 * CSP fechada), a ponte rodando de verdade num documento (clique, escrever,
 * Enter e a mensagem que sai) e a tela: texto da copy vale na hora, texto do
 * código pede Confirmar com o custo, seção esconde, Desfazer volta. Função
 * falsa; nada sai para o Supabase real.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), sucesso: vi.fn(), info: vi.fn(), erro: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    channel: () => ({ on: function () { return this; }, subscribe: function () { return this; } }),
    removeChannel: vi.fn(),
    storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: "https://x/y" }, error: null }) }) },
  },
}));
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => mock.sucesso(...a), error: (...a: unknown[]) => mock.erro(...a), info: (...a: unknown[]) => mock.info(...a), warning: vi.fn() } }));

import PreviaEditavel, { escalaDaPrevia, imagemPeloArquivo } from "@/components/mesa-site/PreviaEditavel";
import { esc, montarPreviaRapida, type DadosDaPreviaRapida } from "@/components/mesa-site/previaEstatica";
import { codigoDaPonte, lerMensagemDaPonte } from "../../supabase/functions/mesa-site/modulos/ponte-da-previa";
import { mapaPadrao } from "../../supabase/functions/_shared/site-biblioteca";
import type { LinhaDoSite } from "@/components/mesa-site/siteApi";

const CLIENTE = "22222222-2222-4222-8222-222222222222";
const SITE = "33333333-3333-4333-8333-333333333333";
const IMG = "aaaaaaaa-1111-4111-8111-111111111111";
const IMG2 = "bbbbbbbb-2222-4222-8222-222222222222";

const copy = {
  conceito: "c",
  headline: "Clareza <script>alert(1)</script> em cada canal",
  subtitulo: "Sites e anúncios.",
  cta: "Pedir orçamento",
  secoes: [
    { id: "problema", titulo: "Seu cliente entende?", texto: "Quem chega precisa entender.", itens: [] },
    { id: "bento", titulo: "O que resolve", texto: "Quatro frentes", itens: ["Site que orienta: páginas claras.", "Anúncios: acompanhados."] },
  ],
  faq: [{ pergunta: "Atendem minha cidade?", resposta: "Sim." }],
  seo: { titulo: "t", descricao: "d", palavras: [] },
};

const site = (extra: Partial<LinhaDoSite> = {}): LinhaDoSite =>
  ({ id: SITE, client_id: CLIENTE, marca_id: null, nome: "Landing", projeto: "landing-33333333", etapa: "construcao", briefing: {}, referencias: [], dna: {}, direcao: {}, conteudo: { opcoes: [copy], escolhida: 0 }, imagens: [{ id: IMG, slot: "hero", origem: "gerada", bucket: "mesa", path: "p/hero.png", alt: "hero", escolhida: true, secao: "hero" }], revisao: {}, publicacao: {}, modelo: null, tipo: "landing", mapa: mapaPadrao("landing"), estilo: {}, integracoes: {}, seo: {}, arquivado_em: null, atualizado_em: "2026-09-30T10:00:00Z", ...extra }) as LinhaDoSite;

const dados: DadosDaPreviaRapida & Record<string, unknown> = {
  nome: "Aceleriq",
  cores: { destaque: "#00d52b", fundo: "#fafaf7", texto: "#111111", escuro: false },
  cores_da_marca: { destaque: "#00d52b", fundo: "#fafaf7", texto: "#111111", escuro: false },
  paleta_da_marca: ["#00d52b", "#111111"],
  ajustes: {},
  fontes: { titulo: "Sora", texto: "Inter" },
  fontes_url: "https://fonts.googleapis.com/css2?family=Sora:wght@600&family=Inter:wght@400&display=swap",
  fontes_disponiveis: [{ familia: "Fraunces", categoria: "serifada" }, { familia: "Inter", categoria: "sem_serifa" }],
  logo_url: null,
  imagens: [
    { id: IMG, slot: "hero", secao: "hero", origem: "gerada", alt: "hero", escolhida: true, url: "https://armazem.exemplo/hero.png?token=1" },
    { id: IMG2, slot: "secao", secao: null, origem: "real", alt: "equipe", escolhida: false, url: "https://armazem.exemplo/equipe.png?token=1" },
  ],
  expira_em: "2026-09-30T19:00:00Z",
};

describe("prévia rápida montada no painel", () => {
  it("escapa o texto, marca o endereço da copy, põe os selos da construção e fecha a rede (CSP)", () => {
    const m = montarPreviaRapida(site(), dados, { estados: { topo: "pronta", hero: "pronta", problema: "construindo", bento: "na_fila" } });
    expect(m.html).not.toContain("<script>alert(1)</script>");
    expect(m.html).toContain(esc("<script>alert(1)</script>"));
    expect(m.html).toContain('data-aq-campo="headline"');
    expect(m.html).toContain('data-aq-campo="secao:bento:item:1"');
    expect(m.html).toContain('data-aq-campo="faq:0:resposta"');
    expect(m.html).toContain(`data-aq-img-id="${IMG}"`);
    expect(m.html).toMatch(/data-secao="problema"[^>]*>.*?aq-selo-construindo/);
    expect(m.html).toContain("Na fila do motor");
    expect(m.html).not.toMatch(/data-secao="hero"[^>]*>\s*<div class="aq-selo/);
    expect(m.documento).toContain("Content-Security-Policy");
    expect(m.documento).toContain("default-src 'none'");
    expect(m.documento).toContain(codigoDaPonte().slice(0, 40));
    expect(m.secoes.map((s) => s.uid)).toEqual(["topo", "hero", "problema", "bento", "processo", "prova", "faq", "chamada", "rodape"]);
    // Sem os selos: o site limpo.
    expect(montarPreviaRapida(site(), dados, { estados: { problema: "construindo" }, marcarEstados: false }).html).not.toContain("aq-selo");
  });

  it("seção escondida sai da página e fica na lista como escondida; sem copy, os lugares vazios não são editáveis", () => {
    const mapa = { ...mapaPadrao("landing"), paginas: [{ id: "inicio", slug: "", titulo: "Início", secoes: [{ uid: "hero", tipo: "hero" }, { uid: "faq", tipo: "faq" }] }], ocultas: [{ uid: "bento", tipo: "bento", pagina: "inicio", posicao: 1 }] };
    const m = montarPreviaRapida(site({ mapa, conteudo: {} }), dados);
    expect(m.html).not.toContain('data-secao="bento"');
    expect(m.secoes.find((s) => s.uid === "bento")).toMatchObject({ oculta: true });
    expect(m.temCopy).toBe(false);
    expect(m.html).toMatch(/<h1 class="aq-vazio" data-aq-chrome>/);
  });

  it("URL que não é https não entra (nem imagem, nem fonte)", () => {
    const m = montarPreviaRapida(site(), { ...dados, fontes_url: "javascript:alert(1)", imagens: [{ ...dados.imagens[0], url: "javascript:alert(1)" }] });
    expect(m.documento).not.toContain("javascript:");
    expect(escalaDaPrevia(640, 1280)).toBe(0.5);
    expect(escalaDaPrevia(0, 1280)).toBe(1);
    expect(imagemPeloArquivo("/imagens/hero-aaaaaaaa.png?v=2", [IMG])).toBe(IMG);
    expect(imagemPeloArquivo("/imagens/hero-1.png", [IMG])).toBeNull();
  });
});

describe("a ponte dentro da prévia", () => {
  it("clicar num texto da copy e apertar Enter manda a edição com o endereço; Esc desiste; o texto do código vai sem endereço", async () => {
    const m = montarPreviaRapida(site(), dados, { estados: {} });
    // Um documento de verdade (JSDOM com script), dentro de um "pai" que recebe as mensagens.
    const saidas: unknown[] = [];
    const dom = new JSDOM(`<!doctype html><html><body><div id="aq-raiz">${m.html}<section data-secao="extra"><p>Texto escrito no código</p></section></div></body></html>`, { runScripts: "outside-only", pretendToBeVisual: true });
    const w = dom.window as unknown as Window & { eval: (c: string) => unknown };
    const pai = { postMessage: (msg: unknown) => saidas.push(msg) };
    Object.defineProperty(w, "parent", { value: pai, configurable: true });
    w.eval(codigoDaPonte());
    // O documento acabou de nascer (carregando): a ponte começa no DOMContentLoaded.
    await new Promise((r) => setTimeout(r, 50));
    const ultima = () => lerMensagemDaPonte(saidas[saidas.length - 1]);
    expect(ultima()).toMatchObject({ aq: "pronta", rapida: true });
    expect((ultima() as { secoes: string[] }).secoes).toContain("bento");
    // Liga a edição (a mensagem só vale vinda do pai).
    w.dispatchEvent(new (w as any).MessageEvent("message", { data: { aq: "modo", editar: true }, source: null }));
    expect(w.document.documentElement.className).not.toContain("aq-editar");
    const evento = new (w as any).MessageEvent("message", { data: { aq: "modo", editar: true } });
    Object.defineProperty(evento, "source", { value: pai });
    w.dispatchEvent(evento);
    expect(w.document.documentElement.className).toContain("aq-editar");

    const titulo = w.document.querySelector('[data-aq-campo="secao:bento:titulo"]') as HTMLElement;
    titulo.dispatchEvent(new (w as any).MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(titulo.getAttribute("contenteditable")).toBe("true");
    titulo.textContent = "O que cada frente resolve";
    titulo.dispatchEvent(new (w as any).KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(titulo.hasAttribute("contenteditable")).toBe(false);
    expect(ultima()).toEqual({ aq: "editar", campo: "secao:bento:titulo", secao: "bento", antes: "O que resolve", valor: "O que cada frente resolve" });

    const n = saidas.length;
    const sub = w.document.querySelector('[data-aq-campo="subtitulo"]') as HTMLElement;
    sub.dispatchEvent(new (w as any).MouseEvent("click", { bubbles: true, cancelable: true }));
    sub.textContent = "Mudei e desisti";
    sub.dispatchEvent(new (w as any).KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    expect(sub.textContent).toBe("Sites e anúncios.");
    expect(saidas.length).toBe(n);

    const livre = w.document.querySelector('[data-secao="extra"] p') as HTMLElement;
    livre.dispatchEvent(new (w as any).MouseEvent("click", { bubbles: true, cancelable: true }));
    livre.textContent = "Texto novo";
    livre.dispatchEvent(new (w as any).KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    expect(ultima()).toEqual({ aq: "editar", campo: null, secao: "extra", antes: "Texto escrito no código", valor: "Texto novo" });

    // A barra da seção: esconder.
    const barra = w.document.getElementById("aq-barra")!;
    livre.dispatchEvent(new (w as any).MouseEvent("mouseover", { bubbles: true }));
    (barra.querySelector('[data-aq-acao="esconder"]') as HTMLElement).dispatchEvent(new (w as any).MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(ultima()).toEqual({ aq: "secao", acao: "esconder", secao: "extra" });
    // Imagem: pede a troca com o id.
    (w.document.querySelector(`[data-aq-img-id="${IMG}"]`) as HTMLElement).dispatchEvent(new (w as any).MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(ultima()).toMatchObject({ aq: "imagem", secao: "hero", id: IMG });
    dom.window.close();
  });

  it("texto longo guarda o parágrafo (Shift+Enter); título fica numa linha; Ctrl+Z só sai com Editar ligado", async () => {
    const comParagrafo = { ...copy, secoes: [{ id: "problema", titulo: "Seu cliente entende?", texto: "Primeiro parágrafo.\nSegundo parágrafo.", itens: [] }] };
    const m = montarPreviaRapida(site({ conteudo: { opcoes: [comParagrafo], escolhida: 0 } } as Partial<LinhaDoSite>), dados, { estados: {} });
    const saidas: unknown[] = [];
    const dom = new JSDOM(`<!doctype html><html><body><div id="aq-raiz">${m.html}</div></body></html>`, { runScripts: "outside-only", pretendToBeVisual: true });
    const w = dom.window as unknown as Window & { eval: (c: string) => unknown };
    const pai = { postMessage: (msg: unknown) => saidas.push(msg) };
    Object.defineProperty(w, "parent", { value: pai, configurable: true });
    w.eval(codigoDaPonte());
    await new Promise((r) => setTimeout(r, 50));
    const doPai = (data: unknown) => {
      const ev = new (w as any).MessageEvent("message", { data });
      Object.defineProperty(ev, "source", { value: pai });
      w.dispatchEvent(ev);
    };
    const tecla = (el: EventTarget, init: Record<string, unknown>) => {
      const ev = new (w as any).KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
      el.dispatchEvent(ev);
      return ev as KeyboardEvent;
    };
    // Editar desligado: o Ctrl+Z de dentro da prévia não pede nada à tela.
    const n0 = saidas.length;
    tecla(w.document.body, { key: "z", ctrlKey: true });
    expect(saidas.length).toBe(n0);
    doPai({ aq: "modo", editar: true });
    doPai({ aq: "campos", campos: [{ campo: "secao:problema:texto", valor: "Primeiro parágrafo.\nSegundo parágrafo.", secao: "problema" }], rotulos: {} });
    tecla(w.document.body, { key: "z", ctrlKey: true });
    expect(lerMensagemDaPonte(saidas[saidas.length - 1])).toEqual({ aq: "desfazer" });

    // A prévia rápida mostra a quebra (pre-line) e a edição volta com ela.
    expect(m.css + m.documento).toContain("[data-aq-campo]{white-space:pre-line}");
    const texto = w.document.querySelector('[data-aq-campo="secao:problema:texto"]') as HTMLElement;
    texto.dispatchEvent(new (w as any).MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(tecla(texto, { key: "Enter", shiftKey: true }).defaultPrevented).toBe(false);
    texto.textContent = "Primeiro parágrafo.\n\n\n   Segundo,   novo.  ";
    tecla(texto, { key: "Enter" });
    expect(lerMensagemDaPonte(saidas[saidas.length - 1])).toMatchObject({ aq: "editar", campo: "secao:problema:texto", antes: "Primeiro parágrafo.\nSegundo parágrafo.", valor: "Primeiro parágrafo.\n\nSegundo, novo." });

    // Título: Shift+Enter não quebra e a quebra colada vira espaço.
    const titulo = w.document.querySelector('[data-aq-campo="secao:problema:titulo"]') as HTMLElement;
    titulo.dispatchEvent(new (w as any).MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(tecla(titulo, { key: "Enter", shiftKey: true }).defaultPrevented).toBe(true);
    titulo.textContent = "Seu cliente\nentende rápido?";
    tecla(titulo, { key: "Enter" });
    expect(lerMensagemDaPonte(saidas[saidas.length - 1])).toMatchObject({ aq: "editar", campo: "secao:problema:titulo", valor: "Seu cliente entende rápido?" });
    dom.window.close();
  });

  it("no site do motor (sem endereço), acha o texto da copy pelo próprio texto", async () => {
    const saidas: unknown[] = [];
    const dom = new JSDOM(`<!doctype html><html><body><div id="root"><section data-secao="hero"><h1>Clareza em cada canal</h1><a href="/x"><span>Pedir orçamento</span></a></section></div></body></html>`, { runScripts: "outside-only", pretendToBeVisual: true });
    const w = dom.window as unknown as Window & { eval: (c: string) => unknown };
    const pai = { postMessage: (msg: unknown) => saidas.push(msg) };
    Object.defineProperty(w, "parent", { value: pai, configurable: true });
    w.eval(codigoDaPonte());
    const enviar = (data: unknown) => {
      const e = new (w as any).MessageEvent("message", { data });
      Object.defineProperty(e, "source", { value: pai });
      w.dispatchEvent(e);
    };
    enviar({ aq: "campos", campos: [{ campo: "headline", valor: "Clareza em cada canal", secao: null }, { campo: "cta", valor: "Pedir orçamento", secao: null }] });
    enviar({ aq: "modo", editar: true });
    await new Promise((r) => setTimeout(r, 300));
    const h1 = w.document.querySelector("h1")!;
    expect(h1.getAttribute("data-aq-achado")).toBe("headline");
    expect(w.document.querySelector("a")!.getAttribute("data-aq-achado")).toBe("cta");
    // O link não navega enquanto edita: vira edição.
    const clique = new (w as any).MouseEvent("click", { bubbles: true, cancelable: true });
    w.document.querySelector("a span")!.dispatchEvent(clique);
    expect(clique.defaultPrevented).toBe(true);
    dom.window.close();
  });

  it("a tela só aceita mensagens no formato da ponte", () => {
    expect(lerMensagemDaPonte({ aq: "secao", acao: "apagar", secao: "hero" })).toBeNull();
    expect(lerMensagemDaPonte({ aq: "editar", campo: "", secao: "../x", antes: 1, valor: "v" })).toEqual({ aq: "editar", campo: null, secao: null, antes: "1", valor: "v" });
    expect(lerMensagemDaPonte("texto")).toBeNull();
  });
});

// ------------------------------------------------------------------ a tela

const valor = (): MesaValor =>
  ({ clientId: CLIENTE, clientName: "Aceleriq", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 10, catalogo: [], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(), marcas: [], marca: null }) as unknown as MesaValor;

const corpos = (acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-site" && c[1].body.acao === acao).map((c: any[]) => c[1].body);

function responder(extra: Record<string, (b: any) => unknown> = {}) {
  mock.invoke.mockImplementation((f: string, { body }: any) => {
    if (extra[body.acao]) return Promise.resolve({ data: extra[body.acao](body), error: null });
    if (f === "motor-codigo" && body.acao === "estimar") return Promise.resolve({ data: { estimativa_usd: 0.21, teto_sugerido_usd: 0.45, livre_usd: 9, custo_usd: 0 }, error: null });
    if (body.acao === "previa_dados") return Promise.resolve({ data: { ...dados, custo_usd: 0 }, error: null });
    if (body.acao === "previa_edicoes") return Promise.resolve({ data: { edicoes: [{ id: "e1111111-1111-4111-8111-111111111111", tipo: "texto", modo: "direto", resumo: "Título principal: \"Antes\"", secao: null, trabalho_id: null, desfeita_em: null, criado_por: "u-1", criado_em: "2026-09-30T17:00:00Z" }], custo_usd: 0 }, error: null });
    return Promise.resolve({ data: { custo_usd: 0 }, error: null });
  });
}

function montar(trabalhos: unknown[] = [], executor: unknown = null) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(MesaProvider, { valor: valor(), children: h(PreviaEditavel, { site: site(), trabalhos: trabalhos as never, executor: executor as never, onIrPara: vi.fn() }) }))));
}

/** Uma mensagem vinda de dentro do iframe da prévia. */
function daPrevia(data: unknown) {
  const iframe = document.querySelector("[data-iframe-da-previa]") as HTMLIFrameElement;
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source: iframe.contentWindow }));
  });
}

beforeEach(() => {
  mock.invoke.mockReset();
  mock.sucesso.mockReset();
  mock.info.mockReset();
  mock.erro.mockReset();
  window.localStorage.clear();
});

describe("a prévia na etapa Construção", () => {
  it("abre a prévia rápida com o motor desligado e diz isso na linha do estado", async () => {
    responder();
    montar([{ id: "t1", client_id: CLIENTE, tipo: "construir", estado: "na_fila", custo_usd: 0, teto_usd: 1, instrucao: "", resultado: { secoes_pedidas: ["hero"] } }]);
    await waitFor(() => expect(document.querySelector("[data-iframe-da-previa='rapida']")).not.toBeNull());
    const estado = document.querySelector("[data-estado-do-motor]")!;
    expect(estado.getAttribute("data-estado-do-motor")).toBe("sem_worker");
    expect(estado.textContent).toMatch(/Motor desligado: o worker nunca ligou · 1 pedido espera na fila/);
    const iframe = document.querySelector("[data-iframe-da-previa]") as HTMLIFrameElement;
    expect(iframe.getAttribute("sandbox")).toBe("allow-scripts");
    expect(iframe.getAttribute("srcdoc")).toContain("aq-selo-na_fila");
    // O site do motor fica desligado sem prévia do worker.
    expect(screen.getByRole("tab", { name: /Site do motor/ })).toHaveProperty("disabled", true);
  });

  it("texto da copy editado na prévia vale na hora, com Desfazer no aviso", async () => {
    responder({ previa_editar: (b) => ({ modo: "direto", site: site(), edicao: { id: "e2222222-2222-4222-8222-222222222222", tipo: "texto", modo: "direto", resumo: "Título principal: \"Novo\"", secao: null, trabalho_id: null, desfeita_em: null, criado_por: "u-1", criado_em: "2026-09-30T17:01:00Z" }, resumo: `Título principal: "${b.edicao.valor}"`, custo_usd: 0 }) });
    montar();
    await waitFor(() => expect(document.querySelector("[data-iframe-da-previa]")).not.toBeNull());
    daPrevia({ aq: "pronta", versao: 1, secoes: ["hero"], editaveis: 10, achados: 10, rapida: true });
    daPrevia({ aq: "editar", campo: "headline", secao: "hero", antes: "Antes", valor: "Novo" });
    await waitFor(() => expect(corpos("previa_editar").length).toBe(1));
    expect(corpos("previa_editar")[0]).toMatchObject({ site_id: SITE, edicao: { tipo: "texto", campo: "headline", valor: "Novo" } });
    await waitFor(() => expect(mock.sucesso).toHaveBeenCalled());
    const [titulo, opcoes] = mock.sucesso.mock.calls[0] as [string, { action?: { label: string; onClick: () => void } }];
    expect(titulo).toBe('Título principal: "Novo"');
    expect(opcoes.action!.label).toBe("Desfazer");
    opcoes.action!.onClick();
    await waitFor(() => expect(corpos("previa_desfazer")).toEqual([{ acao: "previa_desfazer", site_id: SITE, edicao_id: "e2222222-2222-4222-8222-222222222222" }]));
  });

  it("texto do código pede Confirmar com o custo antes; só o Confirmar põe o ajuste na fila", async () => {
    responder({
      previa_editar: (b) =>
        b.confirmar
          ? { modo: "ajuste", trabalho: { id: "t9", tipo: "ajustar", estado: "na_fila" }, edicao: null, resumo: "Texto de Grade bento", custo_usd: 0 }
          : { modo: "ajuste", precisa_confirmar: true, secao: "bento", instrucao: 'Na seção Grade bento (bento), troque o texto "Veja" por "Conheça". Não mude mais nada.', resumo: "Texto de Grade bento", estimativa_usd: 0.21, teto_sugerido_usd: 0.45, livre_usd: 9, modelo: null, custo_usd: 0 },
    });
    montar();
    await waitFor(() => expect(document.querySelector("[data-iframe-da-previa]")).not.toBeNull());
    daPrevia({ aq: "editar", campo: null, secao: "bento", antes: "Veja", valor: "Conheça" });
    await waitFor(() => expect(document.querySelector("[data-confirmar-ajuste-da-previa]")).not.toBeNull());
    expect(corpos("previa_editar")[0].confirmar).toBeUndefined();
    await waitFor(() => expect((screen.getByLabelText("Instrução do ajuste") as HTMLTextAreaElement).value).toMatch(/troque o texto "Veja" por "Conheça"/));
    const confirmar = await screen.findByRole("button", { name: /Confirmar · teto US\$ 0,45|Confirmar · teto \$0\.45|Confirmar · teto/ });
    await waitFor(() => expect((confirmar as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(confirmar);
    await waitFor(() => expect(corpos("previa_editar").length).toBe(2));
    expect(corpos("previa_editar")[1]).toMatchObject({ confirmar: true, teto_usd: 0.45, edicao: { tipo: "texto_livre", secao: "bento" } });
  });

  it("a barra da seção esconde; a lateral troca a cor; o Desfazer da barra volta a última edição", async () => {
    responder({ previa_editar: () => ({ modo: "direto", site: site(), edicao: null, resumo: "ok", custo_usd: 0 }), previa_desfazer: () => ({ site: site(), edicao: {}, resumo: "Desfeito", custo_usd: 0 }) });
    montar();
    await waitFor(() => expect(document.querySelector("[data-iframe-da-previa]")).not.toBeNull());
    daPrevia({ aq: "secao", acao: "esconder", secao: "problema" });
    await waitFor(() => expect(corpos("previa_editar")[0]).toMatchObject({ edicao: { tipo: "secao_visivel", secao: "problema", visivel: false } }));
    // Marca deste site (recolhida no começo).
    fireEvent.click(screen.getByRole("button", { name: /Marca deste site/ }));
    await waitFor(() => expect(document.querySelector("[data-cor-da-previa='destaque']")).not.toBeNull());
    fireEvent.click(document.querySelector("[data-cor-da-previa='destaque'] [aria-label='Usar #111111']") as HTMLElement);
    await waitFor(() => expect(corpos("previa_editar")[1]).toMatchObject({ edicao: { tipo: "cor", papel: "destaque", hex: "#111111" } }));
    // Desfazer da barra: a última edição do histórico.
    await waitFor(() => expect((document.querySelector("[data-desfazer-ultima]") as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(document.querySelector("[data-desfazer-ultima]") as HTMLElement);
    await waitFor(() => expect(corpos("previa_desfazer")[0]).toMatchObject({ edicao_id: "e1111111-1111-4111-8111-111111111111" }));
  });

  it("clicar na imagem abre a troca; escolher manda a imagem com a que sai", async () => {
    responder({ previa_editar: () => ({ modo: "direto", site: site(), edicao: null, resumo: "Imagem trocada", custo_usd: 0 }) });
    montar();
    await waitFor(() => expect(document.querySelector("[data-iframe-da-previa]")).not.toBeNull());
    daPrevia({ aq: "imagem", secao: "hero", id: IMG, slot: "hero", src: "https://x" });
    await waitFor(() => expect(document.querySelector("[data-trocar-imagem]")).not.toBeNull());
    // A atual fica marcada e não se escolhe de novo; o acervo é a outra aba.
    expect((document.querySelector(`[data-imagem-do-site="${IMG}"]`) as HTMLButtonElement).disabled).toBe(true);
    // Escolher a outra manda a troca com a que sai, a seção e o lugar.
    fireEvent.click(document.querySelector(`[data-imagem-do-site="${IMG2}"]`) as HTMLElement);
    await waitFor(() => expect(corpos("previa_editar").length).toBe(1));
    expect(corpos("previa_editar")[0]).toMatchObject({ site_id: SITE, edicao: { tipo: "imagem", imagem_id: IMG2, substitui_id: IMG, secao: "hero", slot: "hero" } });
    await waitFor(() => expect(document.querySelector("[data-trocar-imagem]")).toBeNull());
  });

  it("Ctrl+Z só vale com a prévia em foco e Editar ligado; ajuste do motor não sai pelo atalho", async () => {
    const edicoes = [{ id: "e1111111-1111-4111-8111-111111111111", tipo: "texto", modo: "direto", resumo: "Título principal: \"Antes\"", secao: null, trabalho_id: null, desfeita_em: null, criado_por: "u-1", criado_em: "2026-09-30T17:00:00Z" }];
    responder({ previa_edicoes: () => ({ edicoes, custo_usd: 0 }), previa_desfazer: () => ({ site: site(), edicao: {}, resumo: "Desfeito", custo_usd: 0 }) });
    montar();
    await waitFor(() => expect(document.querySelector("[data-iframe-da-previa]")).not.toBeNull());
    await waitFor(() => expect((document.querySelector("[data-desfazer-ultima]") as HTMLButtonElement).disabled).toBe(false));
    const ctrlZ = (alvo: EventTarget) => act(() => void alvo.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true, cancelable: true })));
    // Foco fora da prévia (clicou noutro lugar da página): nada é desfeito.
    const fora = document.createElement("button");
    document.body.appendChild(fora);
    fireEvent.mouseDown(fora);
    ctrlZ(fora);
    await new Promise((r) => setTimeout(r, 20));
    expect(corpos("previa_desfazer")).toEqual([]);
    // Clicou na prévia: o Ctrl+Z desfaz a última edição de conteúdo.
    const area = document.querySelector("[data-previa-editavel]") as HTMLElement;
    fireEvent.mouseDown(area);
    ctrlZ(area);
    await waitFor(() => expect(corpos("previa_desfazer")).toEqual([{ acao: "previa_desfazer", site_id: SITE, edicao_id: "e1111111-1111-4111-8111-111111111111" }]));
    // Editar desligado: nem o Ctrl+Z da tela nem o que vem de dentro da prévia desfazem.
    fireEvent.click(document.querySelector("[data-editar-previa]") as HTMLElement);
    await waitFor(() => expect(document.querySelector("[data-editar-previa='desligado']")).not.toBeNull());
    fireEvent.mouseDown(area);
    ctrlZ(area);
    daPrevia({ aq: "desfazer" });
    await new Promise((r) => setTimeout(r, 20));
    expect(corpos("previa_desfazer").length).toBe(1);
    fora.remove();
  });

  it("a última edição sendo um ajuste do motor, o Ctrl+Z avisa e não cancela o trabalho", async () => {
    responder({ previa_edicoes: () => ({ edicoes: [{ id: "e3333333-3333-4333-8333-333333333333", tipo: "pedido", modo: "ajuste", resumo: "Pedido ao motor", secao: "bento", trabalho_id: "t9", desfeita_em: null, criado_por: "u-1", criado_em: "2026-09-30T17:02:00Z" }], custo_usd: 0 }) });
    montar();
    await waitFor(() => expect(document.querySelector("[data-iframe-da-previa]")).not.toBeNull());
    await waitFor(() => expect((document.querySelector("[data-desfazer-ultima]") as HTMLButtonElement).disabled).toBe(false));
    daPrevia({ aq: "desfazer" });
    await waitFor(() => expect(mock.info).toHaveBeenCalledWith(expect.stringMatching(/ajuste do motor: desfaça pelo botão/), expect.anything()));
    expect(corpos("previa_desfazer")).toEqual([]);
    // O botão continua desfazendo o ajuste, à vista.
    fireEvent.click(document.querySelector("[data-desfazer-ultima]") as HTMLElement);
    await waitFor(() => expect(corpos("previa_desfazer")).toEqual([{ acao: "previa_desfazer", site_id: SITE, edicao_id: "e3333333-3333-4333-8333-333333333333" }]));
  });

  it("motor rodando: a linha diz a seção e o gasto; o site do motor fica disponível", async () => {
    responder();
    const vivo = { nome: "agencia", visto_em: new Date().toISOString(), versao: "v", capacidades: { tunel: true, openrouter: true } };
    montar([{ id: "t1", client_id: CLIENTE, tipo: "construir", estado: "executando", custo_usd: 0.1, teto_usd: 0.9, instrucao: "", preview_url: "https://abc.trycloudflare.com", resultado: { secoes_pedidas: ["hero", "faq"], secoes: ["hero"], secao_atual: "faq" } }], vivo);
    await waitFor(() => expect(document.querySelector("[data-estado-do-motor='rodando']")).not.toBeNull());
    expect(document.querySelector("[data-estado-do-motor]")!.textContent).toMatch(/Construindo Perguntas frequentes · 1 de 2 seções/);
    expect(screen.getByRole("tab", { name: /Site do motor/ })).toHaveProperty("disabled", false);
  });
});
