import { createElement as h } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { JSDOM } from "jsdom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";

/**
 * Mesa Site com o que aprendemos do Gravyx (19/10/2026): ler a página do
 * cliente pelo link (robots.txt, fetch falso) e levar ao briefing; editar
 * direto na prévia sem modelo; as checagens antes de publicar num HTML de
 * exemplo; a prévia de uma versão e o voltar. Função falsa; nada sai para o
 * Supabase real nem para a rede.
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

import EtapaComBarra from "@/components/mesa-site/BarraDaEtapa";
import EtapaBriefing from "@/components/mesa-site/EtapaBriefing";
import PreviaEditavel from "@/components/mesa-site/PreviaEditavel";
import Versoes, { dadosDaPreviaNaVersao } from "@/components/mesa-site/Versoes";
import { achadosDaLeitura, aplicarAchados } from "@/components/mesa-site/leituraDoLink";
import { caminhoDe, checarDocumento, irAteOProblema, juntarChecagens, resumoDasChecagens } from "@/components/mesa-site/checagensDoSite";
import { comBase } from "@/components/mesa-site/ChecagensAntesDePublicar";
import type { DadosDaPreviaRapida } from "@/components/mesa-site/previaEstatica";
import type { LinhaDoSite } from "@/components/mesa-site/siteApi";
import { extrairDaPagina, lerLinkDoCliente, linkDoDono, robotsPermite } from "../../supabase/functions/mesa-site/modulos/leitura-do-link";
import { normalizarEdicao, planejarEdicao } from "../../supabase/functions/mesa-site/modulos/site-previa";
import { codigoDaPonte, lerMensagemDaPonte } from "../../supabase/functions/mesa-site/modulos/ponte-da-previa";
import { mapaPadrao } from "../../supabase/functions/_shared/site-biblioteca";

const CLIENTE = "22222222-2222-4222-8222-222222222222";
const SITE = "33333333-3333-4333-8333-333333333333";
const IMG = "aaaaaaaa-1111-4111-8111-111111111111";
const IMG2 = "bbbbbbbb-2222-4222-8222-222222222222";
const VERSAO = "cccccccc-3333-4333-8333-333333333333";

const valor = (): MesaValor =>
  ({ clientId: CLIENTE, clientName: "Café", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 10, catalogo: [], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(), marcas: [], marca: null }) as unknown as MesaValor;

const copy = {
  conceito: "c",
  headline: "Café de verdade em Curitiba",
  subtitulo: "Torra da semana.",
  cta: "Pedir pelo WhatsApp",
  secoes: [{ id: "problema", titulo: "Café velho?", texto: "Ninguém merece.", itens: [] }],
  faq: [{ pergunta: "Entregam?", resposta: "Sim." }],
  seo: { titulo: "t", descricao: "d", palavras: [] },
};

const site = (extra: Partial<LinhaDoSite> = {}): LinhaDoSite =>
  ({ id: SITE, client_id: CLIENTE, marca_id: null, nome: "Site do café", projeto: "site-do-cafe-33333333", etapa: "briefing", briefing: {}, referencias: [], dna: {}, direcao: { observacao: "Fotos reais." }, conteudo: { opcoes: [copy], escolhida: 0 }, imagens: [{ id: IMG, slot: "hero", origem: "gerada", bucket: "mesa", path: "p/hero.png", alt: "hero", escolhida: true, secao: "hero" }], revisao: {}, publicacao: {}, modelo: null, tipo: "landing", mapa: mapaPadrao("landing"), estilo: {}, integracoes: {}, seo: {}, arquivado_em: null, atualizado_em: "2026-10-19T10:00:00Z", ...extra }) as LinhaDoSite;

const dados: DadosDaPreviaRapida & Record<string, unknown> = {
  nome: "Café",
  cores: { destaque: "#00d52b", fundo: "#fafaf7", texto: "#111111", escuro: false },
  cores_da_marca: { destaque: "#00d52b", fundo: "#fafaf7", texto: "#111111", escuro: false },
  paleta_da_marca: ["#00d52b"],
  ajustes: {},
  fontes: { titulo: "Sora", texto: "Inter" },
  fontes_url: "https://fonts.googleapis.com/css2?family=Sora:wght@600&display=swap",
  fontes_disponiveis: [],
  logo_url: null,
  imagens: [
    { id: IMG, slot: "hero", secao: "hero", origem: "gerada", alt: "hero", escolhida: true, url: "https://armazem.exemplo/hero.png?token=1" },
    { id: IMG2, slot: "secao", secao: null, origem: "real", alt: "equipe", escolhida: false, url: "https://armazem.exemplo/equipe.png?token=1" },
  ],
  expira_em: "2026-10-19T19:00:00Z",
};

const corpos = (acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-site" && c[1].body.acao === acao).map((c: any[]) => c[1].body);

function montar(filho: ReturnType<typeof h>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(MesaProvider, { valor: valor(), children: filho }))));
}

beforeEach(() => {
  mock.invoke.mockReset();
  mock.sucesso.mockReset();
  mock.info.mockReset();
  mock.erro.mockReset();
  window.localStorage.clear();
});

// ---------------------------------------------------------------------------- 1. ler a página pelo link

const PAGINA = `<!doctype html><html><head>
<title>Café da Esquina | Torrefação em Curitiba</title>
<meta name="description" content="Café especial torrado toda semana, com entrega no mesmo dia.">
<meta property="og:site_name" content="Café da Esquina">
<meta property="og:image" content="/img/capa.jpg">
<meta name="theme-color" content="#7a3e1d">
<style>.botao{background:#7a3e1d;color:#ffffff}.faixa{background:#f2c14e}</style>
<script>window.rastreio = "nao entra";</script>
</head><body>
<header><img src="/img/logo.png" alt="Logo Café da Esquina"><a href="#">Início</a></header>
<h1>Café especial fresco na sua porta</h1>
<section class="nossos-servicos"><h2>Serviços</h2>
  <div class="cartao"><h3>Assinatura mensal</h3><p>Todo mês um café novo.</p></div>
  <div class="cartao"><h3>Café para empresas</h3></div>
  <ul><li>Moagem na hora</li></ul>
</section>
<section id="depoimentos"><h2>Depoimentos</h2>
  <blockquote>Melhor café que já tomei em Curitiba, chega quentinho de torra.</blockquote>
  <p>Atendimento excelente e entrega no mesmo dia, recomendo demais.</p>
</section>
<img src="https://cdn.exemplo.com/fotos/loja.jpg" alt="A loja por dentro" width="800">
<a href="https://wa.me/5541999998888">Pedir no WhatsApp</a>
<a href="mailto:contato@cafedaesquina.com.br">E-mail</a>
<a href="https://www.instagram.com/cafedaesquina/">Instagram</a>
</body></html>`;

type Rota = { status?: number; corpo?: string; tipo?: string; local?: string };

/** Fetch falso: responde pelas rotas e anota o que foi pedido. */
function fetchFalso(rotas: Record<string, Rota>) {
  const pedidos: string[] = [];
  const f = (async (entrada: string | URL) => {
    const url = String(entrada);
    pedidos.push(url);
    const r = rotas[url];
    if (!r) return new Response("não achou", { status: 404, headers: { "content-type": "text/plain" } });
    const headers: Record<string, string> = { "content-type": r.tipo || "text/html; charset=utf-8" };
    if (r.local) headers.location = r.local;
    return new Response(r.corpo || "", { status: r.status || 200, headers });
  }) as unknown as typeof fetch;
  return { f, pedidos };
}

describe("ler a página do cliente pelo link", () => {
  it("extrai nome, oferta, serviços, depoimentos, cores, contatos e imagens (sem script nem log)", async () => {
    const { f, pedidos } = fetchFalso({
      "https://cafedaesquina.com.br/robots.txt": { corpo: "User-agent: *\nDisallow: /admin\n", tipo: "text/plain" },
      "https://cafedaesquina.com.br/": { corpo: PAGINA },
    });
    const log = vi.spyOn(console, "log");
    const r = await lerLinkDoCliente("cafedaesquina.com.br", f);
    expect(r.motivo).toBeNull();
    const l = r.leitura!;
    expect(l.nome).toBe("Café da Esquina");
    expect(l.titulo).toBe("Café especial fresco na sua porta");
    expect(l.descricao).toMatch(/torrado toda semana/);
    expect(l.servicos).toEqual(expect.arrayContaining(["Assinatura mensal", "Café para empresas", "Moagem na hora"]));
    expect(l.depoimentos[0]).toMatch(/Melhor café que já tomei/);
    expect(l.depoimentos.join(" ")).toMatch(/Atendimento excelente/);
    expect(l.cores[0]).toBe("#7a3e1d");
    expect(l.cores).toContain("#f2c14e");
    expect(l.contatos).toEqual({ whatsapp: "5541999998888", telefone: null, email: "contato@cafedaesquina.com.br", instagram: "@cafedaesquina" });
    expect(l.logo).toBe("https://cafedaesquina.com.br/img/logo.png");
    expect(l.imagens.map((i) => i.url)).toEqual(["https://cafedaesquina.com.br/img/capa.jpg", "https://cdn.exemplo.com/fotos/loja.jpg"]);
    expect(JSON.stringify(l)).not.toContain("rastreio");
    // O robots.txt vem antes da página; nada foi escrito no log.
    expect(pedidos).toEqual(["https://cafedaesquina.com.br/robots.txt", "https://cafedaesquina.com.br/"]);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  it("respeita o robots.txt e não segue redirecionamento para endereço interno", async () => {
    const bloqueado = fetchFalso({ "https://loja.exemplo.com/robots.txt": { corpo: "User-agent: *\nDisallow: /\n", tipo: "text/plain" }, "https://loja.exemplo.com/vendas": { corpo: PAGINA } });
    const r1 = await lerLinkDoCliente("https://loja.exemplo.com/vendas", bloqueado.f);
    expect(r1.leitura).toBeNull();
    expect(r1.motivo).toMatch(/robots\.txt/);
    expect(bloqueado.pedidos).toEqual(["https://loja.exemplo.com/robots.txt"]);

    const insta = fetchFalso({ "https://www.instagram.com/robots.txt": { corpo: "User-agent: *\nDisallow: /\n", tipo: "text/plain" } });
    expect((await lerLinkDoCliente("@cafedaesquina", insta.f)).motivo).toMatch(/Instagram não permite/);

    const desvio = fetchFalso({ "https://curto.exemplo.com/robots.txt": { status: 404 }, "https://curto.exemplo.com/x": { status: 302, local: "http://127.0.0.1/admin" } });
    const r3 = await lerLinkDoCliente("https://curto.exemplo.com/x", desvio.f);
    expect(r3.leitura).toBeNull();
    expect(r3.motivo).toMatch(/não é público/);
    expect(desvio.pedidos).not.toContain("http://127.0.0.1/admin");

    expect(linkDoDono("http://localhost:3000")).toBeNull();
    expect(robotsPermite("User-agent: *\nDisallow: /\n\nUser-agent: AceleriqPainel\nAllow: /\n", "/qualquer")).toBe(true);
    expect(robotsPermite("User-agent: *\nDisallow: /privado\nAllow: /privado/aberto\n", "/privado/aberto/x")).toBe(true);
    expect(robotsPermite("User-agent: *\nDisallow: /*.pdf$\n", "/arquivo.pdf")).toBe(false);
    expect(robotsPermite("User-agent: *\nDisallow:\n", "/tudo")).toBe(true);
  });

  it("o que foi lido vai para o briefing só depois de confirmado, acrescentando (e as cores para a direção)", async () => {
    const leitura = extrairDaPagina(PAGINA, "https://cafedaesquina.com.br/");
    mock.invoke.mockImplementation((_f: string, { body }: any) => {
      if (body.acao === "briefing_ler") return Promise.resolve({ data: { encontrado: false, perguntas: [], respostas: {}, decupagem: null }, error: null });
      if (body.acao === "link_ler") return Promise.resolve({ data: { leitura, motivo: null, custo_usd: 0 }, error: null });
      if (body.acao === "site_salvar") return Promise.resolve({ data: { site: site({ briefing: body.briefing || {} }), custo_usd: 0 }, error: null });
      return Promise.resolve({ data: { custo_usd: 0 }, error: null });
    });
    montar(h(EtapaComBarra, { etapa: "briefing", onIrPara: vi.fn(), children: h(EtapaBriefing, { site: site({ briefing: { respostas: { oferta: "Café em grão." } } }) }) }));
    fireEvent.change(screen.getByLabelText("Link da página do cliente"), { target: { value: "cafedaesquina.com.br" } });
    fireEvent.click(screen.getByRole("button", { name: "Ler a página" }));
    await waitFor(() => expect(document.querySelector("[data-leitura-do-link]")).not.toBeNull());
    expect(corpos("link_ler")[0]).toMatchObject({ site_id: SITE, url: "cafedaesquina.com.br" });
    // Nada gravado antes de confirmar; o dono desmarca o domínio.
    expect(corpos("site_salvar").length).toBe(0);
    expect(Array.from(document.querySelectorAll("[data-achado]")).map((x) => x.getAttribute("data-achado"))).toEqual(["nome", "oferta", "servicos", "depoimentos", "contato", "cores", "dominio"]);
    fireEvent.click(screen.getByLabelText("Usar Domínio"));
    fireEvent.click(screen.getByRole("button", { name: /Usar no briefing/ }));
    await waitFor(() => expect(corpos("site_salvar").length).toBe(2));
    const [briefing, direcao] = corpos("site_salvar");
    expect(briefing.briefing.respostas.oferta).toMatch(/^Café em grão\.\nNome do negócio: Café da Esquina\nOferta no site: Café especial fresco/);
    expect(briefing.briefing.respostas.oferta).toMatch(/Serviços no site: .*Assinatura mensal/);
    expect(briefing.briefing.respostas.diferenciais).toMatch(/^Depoimentos no site: "Melhor café/);
    expect(briefing.briefing.respostas.acao).toMatch(/WhatsApp 5541999998888/);
    expect(briefing.briefing.respostas.dominio).toBeUndefined();
    expect(briefing.briefing.pagina_lida).toMatchObject({ url: "https://cafedaesquina.com.br/", nome: "Café da Esquina", cores: expect.arrayContaining(["#7a3e1d"]) });
    expect(direcao.direcao.observacao).toBe("Fotos reais.\nCores aparentes no site atual: " + leitura.cores.join(", "));
  });

  it("aplicar duas vezes não repete; o domínio só entra com a pergunta vazia", () => {
    const l = extrairDaPagina(PAGINA, "https://cafedaesquina.com.br/");
    const achados = achadosDaLeitura(l);
    const r1 = aplicarAchados({}, "", achados);
    expect(r1.respostas.dominio).toBe("cafedaesquina.com.br");
    const r2 = aplicarAchados(r1.respostas, r1.observacao || "", achados);
    expect(r2.respostas).toEqual({});
    expect(r2.observacao).toBeNull();
    expect(aplicarAchados({ dominio: "outro.com" }, "", achados).respostas.dominio).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------- 2. edição direta na prévia

function responderPrevia(extra: Record<string, (b: any) => unknown> = {}) {
  mock.invoke.mockImplementation((f: string, { body }: any) => {
    if (extra[body.acao]) return Promise.resolve({ data: extra[body.acao](body), error: null });
    if (body.acao === "previa_dados") return Promise.resolve({ data: { ...dados, custo_usd: 0 }, error: null });
    if (body.acao === "previa_edicoes") return Promise.resolve({ data: { edicoes: [], custo_usd: 0 }, error: null });
    return Promise.resolve({ data: { custo_usd: 0 }, error: null });
  });
}

function daPrevia(data: unknown) {
  const iframe = document.querySelector("[data-iframe-da-previa]") as HTMLIFrameElement;
  act(() => {
    window.dispatchEvent(new MessageEvent("message", { data, source: iframe.contentWindow }));
  });
}

describe("edição direta na prévia sem gastar IA", () => {
  it("clicar no texto e escrever chama previa_editar sem modelo, sem Confirmar e sem o motor", async () => {
    responderPrevia({ previa_editar: (b) => ({ modo: "direto", site: site(), edicao: null, resumo: `Título principal: "${b.edicao.valor}"`, custo_usd: 0 }) });
    montar(h(PreviaEditavel, { site: site(), trabalhos: [], executor: null as never, onIrPara: vi.fn() }));
    await waitFor(() => expect(document.querySelector("[data-iframe-da-previa]")).not.toBeNull());
    daPrevia({ aq: "pronta", versao: 2, secoes: ["hero"], editaveis: 5, achados: 5, rapida: true });
    daPrevia({ aq: "editar", campo: "headline", secao: "hero", antes: "Café de verdade em Curitiba", valor: "Café fresco em Curitiba" });
    await waitFor(() => expect(corpos("previa_editar").length).toBe(1));
    const corpo = corpos("previa_editar")[0];
    expect(corpo).toMatchObject({ acao: "previa_editar", site_id: SITE, edicao: { tipo: "texto", campo: "headline", valor: "Café fresco em Curitiba" } });
    expect(corpo.confirmar).toBeUndefined();
    expect(corpo.modelo_id).toBeUndefined();
    expect(mock.invoke.mock.calls.some((c: any[]) => c[0] === "motor-codigo")).toBe(false);
    // Trocar imagem clicando: abre a janela de troca (sem chamar modelo).
    daPrevia({ aq: "imagem", secao: "hero", id: IMG, slot: "hero", src: "https://armazem.exemplo/hero.png" });
    await waitFor(() => expect(document.querySelector("[data-trocar-imagem]")).not.toBeNull());
  });

  it("no servidor, texto da copy e imagem trocada são diretos (nenhum modelo entra)", () => {
    const s = site({ imagens: [{ id: IMG, slot: "hero", origem: "gerada", bucket: "mesa", path: "p/hero.png", alt: "hero", escolhida: true, secao: "hero" }, { id: IMG2, slot: "secao", origem: "real", bucket: "mesa", path: "p/equipe.png", alt: "equipe", escolhida: false, secao: null }] }) as never;
    expect(planejarEdicao(s, normalizarEdicao({ tipo: "texto", campo: "headline", valor: "Novo" })).modo).toBe("direto");
    expect(planejarEdicao(s, normalizarEdicao({ tipo: "imagem", secao: "hero", slot: "hero", imagem_id: IMG2, substitui_id: IMG }), { fotoReal: null }).modo).toBe("direto");
  });
});

// ---------------------------------------------------------------------------- 3. checagens antes de publicar

const EXEMPLO = `<!doctype html><html><head><title>x</title></head><body style="background-color:#ffffff">
<section data-secao="hero">
  <h1>Café fresco</h1>
  <h1>Outro título principal</h1>
  <a href="">Vazio</a>
  <a href="#">Sem destino</a>
  <a href="javascript:void(0)">Script</a>
  <a href="#contato">Fale com a gente</a>
  <a href="https://wa.me/">WhatsApp</a>
  <a href="tel:">Ligar</a>
  <a href="https://cafe.exemplo.com.br/cardapio">Cardápio</a>
  <img src="https://cdn.exemplo.com/sem-alt.jpg">
  <img src="https://cdn.exemplo.com/com-alt.jpg" alt="A loja">
  <p style="color:#bbbbbb">Texto clarinho demais para ler</p>
  <p style="color:#111111">Texto escuro e legível</p>
  <p>Superpromoçãoimperdívelsóhojeparatodos no balcão</p>
</section>
<section data-secao="servicos"><h2>Nossos cafés</h2><h2>Nossos cafés</h2><div data-aq-chrome><a href="">da casca</a></div></section>
</body></html>`;

describe("checagens antes de publicar", () => {
  it("acham link vazio e quebrado, imagem sem alt, contraste baixo, títulos repetidos, palavra que passa da borda e peso", () => {
    const doc = new JSDOM(EXEMPLO).window.document;
    const l = checarDocumento(doc, { bytesDoHtml: 700 * 1024 });
    const textos = l.map((p) => `${p.tipo}|${p.grave ? "grave" : "leve"}|${p.texto}`);
    const tem = (re: RegExp) => expect(textos.some((t) => re.test(t)), String(re)).toBe(true);
    tem(/^link\|grave\|Link vazio: "Vazio"/);
    tem(/^link\|grave\|Link sem destino \(#\): "Sem destino"/);
    tem(/^link\|grave\|Link que não abre nada/);
    tem(/^link\|grave\|Âncora quebrada: #contato/);
    tem(/^link\|grave\|WhatsApp sem número/);
    tem(/^link\|grave\|Contato vazio/);
    tem(/^alt\|grave\|Imagem sem alt: sem-alt\.jpg/);
    tem(/^contraste\|grave\|Contraste baixo \(1,9:1, mínimo 4,5\): #bbbbbb sobre #ffffff/);
    tem(/^titulo\|leve\|Mais de um título principal \(h1\): 2/);
    tem(/^titulo\|leve\|Título repetido 2 vezes: "Nossos cafés"/);
    tem(/^borda\|leve\|Palavra comprida pode passar da borda no celular/);
    tem(/^peso\|leve\|HTML pesado: 700 KB/);
    // O que está certo não aparece; a casca da prévia fica de fora.
    expect(textos.some((t) => /Cardápio|A loja|escuro e legível|da casca/.test(t))).toBe(false);
    // Graves primeiro; cada um aponta o elemento.
    expect(l[0].grave).toBe(true);
    const sem = l.find((p) => p.tipo === "alt")!;
    expect(sem.secao).toBe("hero");
    expect(doc.querySelector(sem.caminho!)).toBe(doc.querySelector('img[src$="sem-alt.jpg"]'));
    const r = resumoDasChecagens(l);
    expect(r.graves).toBeGreaterThanOrEqual(8);
    expect(r.porTipo.titulo).toBe(2);
  });

  it("na prévia rápida o # dos botões não conta; ir até o problema marca o elemento; dois aparelhos não repetem", () => {
    const doc = new JSDOM(EXEMPLO).window.document;
    const rapida = checarDocumento(doc, { ignorarAncoraVazia: true });
    expect(rapida.some((p) => /Link sem destino/.test(p.texto))).toBe(false);
    const alvo = rapida.find((p) => p.tipo === "contraste")!;
    expect(irAteOProblema(doc, alvo.caminho)).toBe(true);
    expect((doc.querySelector(alvo.caminho!) as HTMLElement).style.outline).toMatch(/solid/);
    expect(irAteOProblema(doc, "body>script")).toBe(false);
    expect(irAteOProblema(doc, "img[onerror=alert(1)]")).toBe(false);
    expect(caminhoDe(doc.body)).toBe("body");
    expect(juntarChecagens([rapida, rapida]).length).toBe(rapida.length);
  });

  it("o site do motor manda o HTML pela ponte; a cópia abre com a base do túnel e sem script", () => {
    expect(codigoDaPonte()).toContain('d.aq === "documento"');
    expect(lerMensagemDaPonte({ aq: "documento", html: "<html></html>", url: "https://x.trycloudflare.com/" })).toEqual({ aq: "documento", html: "<html></html>", url: "https://x.trycloudflare.com/" });
    expect(lerMensagemDaPonte({ aq: "documento", html: 1 })).toBeNull();
    const copia = comBase('<html><head><script src="/@vite/client"></script></head><body><img src="/a.png"></body></html>', "https://x.trycloudflare.com");
    expect(copia).toContain('<head><base href="https://x.trycloudflare.com/">');
    expect(copia).not.toContain("<script");
  });
});

// ---------------------------------------------------------------------------- 4. versões

describe("versões com prévia e voltar", () => {
  it("o olho mostra a prévia da versão do plano e Voltar para esta restaura com Confirmar", async () => {
    const antigo = { ...copy, headline: "Título da versão antiga" };
    mock.invoke.mockImplementation((_f: string, { body }: any) => {
      if (body.acao === "versoes_listar") return Promise.resolve({ data: { versoes: [{ id: VERSAO, motivo: "briefing", criado_em: "2026-10-18T10:00:00Z" }], aviso: null, custo_usd: 0 }, error: null });
      if (body.acao === "versao_ler") return Promise.resolve({ data: { versao: { dados: { tipo: "landing", mapa: mapaPadrao("landing"), conteudo: { opcoes: [antigo], escolhida: 0 }, imagens: [{ id: IMG2, slot: "hero", secao: "hero", escolhida: true }], estilo: { ajustes: { destaque: "#ff0000" } } } }, custo_usd: 0 }, error: null });
      if (body.acao === "previa_dados") return Promise.resolve({ data: { ...dados, custo_usd: 0 }, error: null });
      if (body.acao === "versao_restaurar") return Promise.resolve({ data: { site: site(), custo_usd: 0 }, error: null });
      return Promise.resolve({ data: { custo_usd: 0 }, error: null });
    });
    montar(h(Versoes, { site: site(), trabalhos: [] }));
    fireEvent.click(await screen.findByRole("button", { name: "Ver a prévia desta versão" }));
    await waitFor(() => expect(document.querySelector("[data-iframe-da-versao]")).not.toBeNull());
    const doc = document.querySelector("[data-iframe-da-versao]")!.getAttribute("srcdoc")!;
    expect(doc).toContain("Título da versão antiga");
    expect(doc).toContain("equipe.png");
    expect(doc).toContain("--aq-destaque:#ff0000");
    expect(document.querySelector("[data-iframe-da-versao]")!.getAttribute("sandbox")).toBe("");
    expect(corpos("versao_restaurar").length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: /Voltar para esta$/ }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirmar e voltar" }));
    await waitFor(() => expect(corpos("versao_restaurar").length).toBe(1));
    expect(corpos("versao_restaurar")[0]).toMatchObject({ site_id: SITE, versao_id: VERSAO });
  });

  it("os dados da versão: imagens e cores daquele momento", () => {
    const d = dadosDaPreviaNaVersao(dados as never, { imagens: [{ id: IMG2, secao: "sobre", escolhida: true }] });
    expect(d.imagens.find((i) => i.id === IMG)!.escolhida).toBe(false);
    expect(d.imagens.find((i) => i.id === IMG2)).toMatchObject({ escolhida: true, secao: "sobre" });
    expect(d.cores).toEqual(dados.cores);
  });
});
