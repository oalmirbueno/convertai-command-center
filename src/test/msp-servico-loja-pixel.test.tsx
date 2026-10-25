import { createElement as h } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";

/**
 * Site de serviço, loja virtual e pixel da Meta (frente MSP, 25/10/2026):
 * os tipos novos aparecem e mandam o contrato certo, os eventos por tipo, o
 * pixel só dispara depois do Aceitar dos cookies (na casca do site gerado),
 * a Conversions API repete o Lead com o mesmo event_id e a checagem avisa o
 * pixel faltando. Função falsa; nada sai para a rede.
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

// O pacote do site gerado (casca do modelo-site): pixel, formulário, WhatsApp e cookies ligados.
const pacoteDoSite = vi.hoisted(() => ({
  valor: {
    cliente: "Oficina Teste",
    marca: { nome: "Oficina Teste" },
    paleta: [],
    fontes: [],
    copy: null,
    imagens: [],
    fotos_reais: [],
    logo: null,
    secoes: ["hero"],
    integracoes: {
      whatsapp: { numero: "5541999998888", mensagem: "Olá! Vim pelo site.", link: "https://wa.me/5541999998888" },
      formulario: { endpoint: "https://exemplo.supabase.co/functions/v1/site-formulario", chave: "abcdefghijklmnopqrst12", campos: ["nome", "email", "whatsapp"], agradecimento: "Recebido." },
      pixel_meta: "123456789012345",
      ga4: null,
      mapa: null,
      cookies: { politica_url: null },
    },
    medicao: { eventos: ["PageView", "ViewContent", "Lead", "Contact", "Schedule"], eventos_automaticos: false, capi: true, moeda: "BRL" },
    loja: null as unknown,
  } as Record<string, any>,
}));
vi.mock("../../workers/motor-codigo/modelo-site/src/lib/pacote", () => ({
  get pacote() {
    return pacoteDoSite.valor;
  },
  paginas: () => [],
  paginasDoMenu: () => [],
}));

import PassoObjetivo from "@/components/mesa-site/PassoObjetivo";
import { pedidoDaJornada } from "@/components/mesa-site/PassoConstruir";
import PixelEEventos from "@/components/mesa-site/PixelEEventos";
import ProdutosDaLoja from "@/components/mesa-site/ProdutosDaLoja";
import type { LinhaDoSite } from "@/components/mesa-site/siteApi";
import { modelosDoObjetivo, normalizarContratoDaConstrucao, OBJETIVOS_DO_SITE, objetivoDoSite } from "../../supabase/functions/mesa-site/modulos/jornada-do-site";
import { camposDoModelo, mapaDoModelo, modeloDePagina } from "../../supabase/functions/mesa-site/modulos/modelos-de-pagina";
import { MODELOS_PRONTOS } from "../../supabase/functions/mesa-site/modulos/modelos-prontos";
import { instrucoesDaPartida, obraDoPedido } from "../../supabase/functions/mesa-site/modulos/partida-no-motor";
import {
  corpoDaCapi,
  emReais,
  eventoParaCapi,
  eventoPrincipal,
  eventosDoObjetivo,
  gatewayDoLink,
  itensDaMedicao,
  lerMetaDoEnvio,
  lojaDoPacote,
  medicaoDoPacote,
  medicaoPadrao,
  mensagemDoPedido,
  normalizarLoja,
  passosDoTeste,
  pixelSugerido,
  pixelsDaResposta,
  precoDe,
  produtosDoContexto,
  telefoneParaMeta,
} from "../../supabase/functions/mesa-site/modulos/medicao-do-site";
import { leadNaMeta, pedidoDaCapi } from "../../supabase/functions/site-formulario/modulos/lead-na-meta";
import { mapaPadrao } from "../../supabase/functions/_shared/site-biblioteca";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const CLIENTE = "22222222-2222-4222-8222-222222222222";
const SITE = "33333333-3333-4333-8333-333333333333";

const valor = (): MesaValor =>
  ({ clientId: CLIENTE, clientName: "Oficina", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 10, catalogo: [], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(), marcas: [], marca: null }) as unknown as MesaValor;

const site = (extra: Partial<LinhaDoSite> = {}): LinhaDoSite =>
  ({ id: SITE, client_id: CLIENTE, marca_id: null, nome: "Site da oficina", projeto: "site-oficina-33333333", etapa: "briefing", briefing: {}, referencias: [], dna: {}, direcao: {}, conteudo: {}, imagens: [], revisao: {}, publicacao: {}, modelo: null, tipo: "institucional", mapa: mapaPadrao("institucional"), estilo: {}, integracoes: {}, seo: {}, arquivado_em: null, atualizado_em: "2026-10-25T10:00:00Z", ...extra }) as LinhaDoSite;

const rota = (funcao: string, acao: string, f: (corpo: any) => unknown) => (mock.respostas[`${funcao}:${acao}`] = f);
const corpos = (funcao: string, acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === funcao && c[1].body.acao === acao).map((c: any[]) => c[1].body);

function montar(filho: ReturnType<typeof h>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(MesaProvider, { valor: valor(), children: filho }))));
}

const sha256 = async (s: string) => createHash("sha256").update(s).digest("hex");

beforeEach(() => {
  mock.invoke.mockReset();
  mock.respostas = {};
  window.localStorage.clear();
  mock.invoke.mockImplementation(async (funcao: string, { body }: { body: any }) => {
    const f = mock.respostas[`${funcao}:${body.acao}`];
    return { data: f ? f(body) : { custo_usd: 0 }, error: null };
  });
  rota("motor-codigo", "listar", () => ({ trabalhos: [], executor: null, executor_vivo: false }));
});

// ---------------------------------------------------------------------------- tipos novos

describe("tipos novos: site de serviço e loja virtual", () => {
  it("aparecem no objetivo com tipo, mapa que converte e sites prontos compatíveis", () => {
    const servico = objetivoDoSite("servico")!;
    const loja = objetivoDoSite("loja_virtual")!;
    expect(servico).toEqual(expect.objectContaining({ rotulo: "Site de serviço", tipo: "institucional", modelo: "servico" }));
    expect(loja).toEqual(expect.objectContaining({ rotulo: "Loja virtual", tipo: "loja", modelo: "loja_virtual" }));
    expect(OBJETIVOS_DO_SITE.slice(0, 2).map((o) => o.id)).toEqual(["servico", "loja_virtual"]);

    const mapaServico = mapaDoModelo(modeloDePagina("servico")!);
    expect(mapaServico.paginas.map((p) => p.slug)).toEqual(["", "servicos", "contato"]);
    const tipos = mapaServico.paginas[0].secoes.map((s) => s.tipo);
    ["hero", "servicos", "processo", "prova", "faq", "chamada"].forEach((t) => expect(tipos).toContain(t));
    expect(mapaServico.paginas[2].secoes.map((s) => s.tipo)).toContain("contato");

    const mapaLoja = mapaDoModelo(modeloDePagina("loja_virtual")!);
    expect(mapaLoja.tipo).toBe("loja");
    expect(mapaLoja.paginas.map((p) => p.slug)).toEqual(["", "produtos", "obrigado", "contato"]);
    expect(mapaLoja.paginas[1].secoes.map((s) => s.tipo)).toContain("vitrine");
    const campos = camposDoModelo(modeloDePagina("loja_virtual")!, { direcao: {}, briefing: {}, estilo: {} });
    expect(campos.briefing.respostas.acao).toMatch(/carrinho/);

    expect(modelosDoObjetivo(MODELOS_PRONTOS, "loja_virtual", []).lista.map((m) => m.id)).toContain("shop-homepage");
    const prontosDeServico = modelosDoObjetivo(MODELOS_PRONTOS, "servico", ["oficina", "automotivo"]);
    expect(prontosDeServico.lista[0].id).toBe("small-business");
    expect(prontosDeServico.lista.every((m) => m.licenca === "MIT")).toBe(true);
  });

  it("o passo Objetivo mostra as duas opções e escolher grava o objetivo", async () => {
    rota("mesa-site", "jornada_salvar", (b) => ({ site: site({ direcao: { jornada: { objetivo: b.objetivo } } }) }));
    const ir = vi.fn();
    montar(h(PassoObjetivo, { site: site(), onIrPara: ir }));
    expect(document.querySelector('[data-objetivo="servico"]')!.textContent).toContain("Site de serviço");
    expect(document.querySelector('[data-objetivo="loja_virtual"]')!.textContent).toContain("Loja virtual");
    fireEvent.click(document.querySelector('[data-objetivo="loja_virtual"]')!);
    await waitFor(() => expect(ir).toHaveBeenCalledWith("partida"));
    expect(corpos("mesa-site", "jornada_salvar")[0]).toEqual(expect.objectContaining({ site_id: SITE, objetivo: "loja_virtual" }));
  });

  it("o contrato da construção leva o objetivo novo e o motor recebe as instruções do tipo e da medição", () => {
    const pedido = pedidoDaJornada({ clientId: CLIENTE, siteId: SITE, secoes: ["hero"], tetoUsd: 1, objetivo: "servico", partida: { tipo: "modelo_pronto", modelo_id: "small-business" }, contexto: null, motor: "", modeloId: "" });
    const contrato = normalizarContratoDaConstrucao(pedido)!;
    expect(contrato).toEqual(expect.objectContaining({ objetivo: "servico", partida: { tipo: "modelo_pronto", modelo_id: "small-business" } }));
    const instr = instrucoesDaPartida(obraDoPedido(pedido), true);
    expect(instr).toContain("OBJETIVO DO SITE: Site de serviço");
    expect(instr).toContain("SITE DE SERVIÇO");
    expect(instr).toContain("skill site-de-servico");
    expect(instr).toMatch(/MEDIÇÃO: o site mede ViewContent, Lead, Contact, Schedule/);
    expect(instr).toContain('data-evento="Schedule"');
    expect(instr).toContain("nunca escreva fbq");
    const loja = instrucoesDaPartida(obraDoPedido({ objetivo: "loja_virtual", partida: { tipo: "zero" } }), true);
    expect(loja).toContain("LOJA VIRTUAL");
    expect(loja).toContain("skill loja-virtual");
    expect(loja).toContain("src/lib/loja.tsx");
  });

  it("as skills e a casca do motor conhecem o serviço, a loja e os eventos", () => {
    const raiz = resolve(process.cwd(), "workers/motor-codigo");
    const agents = readFileSync(resolve(raiz, "modelo-site/AGENTS.md"), "utf8");
    expect(agents).toContain('data-evento="Schedule"');
    expect(agents).toContain("src/lib/loja.tsx");
    expect(agents).toContain("paginasDoMenu()");
    const casca = JSON.parse(readFileSync(resolve(raiz, "modelo-site/.aceleriq/casca.json"), "utf8"));
    expect(casca.versao).toBeGreaterThanOrEqual(8);
    expect(casca.arquivos).toContain("src/lib/loja.tsx");
    ["site-de-servico", "loja-virtual", "pixel-e-eventos"].forEach((s) => expect(readFileSync(resolve(raiz, `skills-claude/skills/${s}/SKILL.md`), "utf8")).toMatch(new RegExp(`^---\\nname: ${s}\\n`)));
  });
});

// ---------------------------------------------------------------------------- eventos por tipo

describe("eventos padrão da Meta por tipo de site", () => {
  it("serviço mede contato e agendamento; loja mede o funil de compra", () => {
    expect(eventosDoObjetivo("servico")).toEqual(["PageView", "ViewContent", "Lead", "Contact", "Schedule"]);
    expect(eventosDoObjetivo("loja_virtual", { checkout: "link" })).toEqual(["PageView", "ViewContent", "AddToCart", "InitiateCheckout", "Purchase"]);
    // Pedido pelo WhatsApp: o site não confirma pagamento, então não conta compra.
    expect(eventosDoObjetivo("loja_virtual", { checkout: "whatsapp" })).not.toContain("Purchase");
    expect(eventoPrincipal("servico")).toBe("Schedule");
    expect(eventoPrincipal("loja_virtual", { checkout: "link" })).toBe("Purchase");
    expect(eventosDoObjetivo("captar")).toEqual(["PageView", "Lead"]);
    OBJETIVOS_DO_SITE.forEach((o) => expect(eventosDoObjetivo(o.id)[0]).toBe("PageView"));
  });

  it("o pacote do site leva a medição e a loja só no objetivo loja virtual", () => {
    const direcaoLoja = { jornada: { objetivo: "loja_virtual", loja: { checkout: "link", produtos: [{ nome: "Kit troca de óleo", preco: "R$ 189,90", categoria: "Revisão", link_pagamento: "https://pay.kiwify.com.br/abc123" }, { nome: "Sem link", preco: "" }] }, medicao: { capi: true } } };
    const m = medicaoDoPacote(direcaoLoja, "123456789012345");
    expect(m).toEqual({ eventos: ["PageView", "ViewContent", "AddToCart", "InitiateCheckout", "Purchase"], eventos_automaticos: false, capi: true, moeda: "BRL" });
    expect(medicaoDoPacote(direcaoLoja, null).capi).toBe(false);
    const loja = lojaDoPacote(direcaoLoja)!;
    expect(loja.checkout).toBe("link");
    expect(loja.produtos[0]).toEqual(expect.objectContaining({ id: "kit-troca-de-oleo", preco: 189.9, link_pagamento: "https://pay.kiwify.com.br/abc123" }));
    expect(loja.produtos[1].preco).toBeNull();
    expect(loja.categorias).toEqual(["Revisão", "Produtos"]);
    expect(lojaDoPacote({ jornada: { objetivo: "servico", loja: { produtos: [{ nome: "x" }] } } })).toBeNull();
    expect(medicaoDoPacote({ jornada: { objetivo: "servico" } }, "123456789012345").eventos).toContain("Schedule");
  });

  it("preço, link de pagamento e mensagem do pedido sem inventar nada", () => {
    expect(precoDe("R$ 1.234,56")).toBe(1234.56);
    expect(precoDe("49.9")).toBe(49.9);
    expect(precoDe("sob consulta")).toBeNull();
    expect(emReais(1234.5)).toBe("R$ 1.234,50");
    expect(gatewayDoLink("https://pay.kiwify.com.br/x")).toEqual({ id: "kiwify", rotulo: "Kiwify" });
    expect(gatewayDoLink("https://buy.stripe.com/x")!.id).toBe("stripe");
    expect(normalizarLoja({ produtos: [{ nome: "A", link_pagamento: "http://inseguro.com" }] }).produtos[0].link_pagamento).toBeNull();
    expect(mensagemDoPedido([{ nome: "Café 250 g", quantidade: 2, preco: 39.9 }])).toBe("Olá! Quero fazer este pedido:\n- 2x Café 250 g (R$ 39,90)\nTotal: R$ 79,80");
    expect(mensagemDoPedido([{ nome: "Bolo", quantidade: 1, preco: null }])).toContain("Total: a combinar");
    expect(produtosDoContexto(["Café 250 g - R$ 39,90", "Assinatura mensal"]).map((p) => [p.nome, p.preco])).toEqual([["Café 250 g", 39.9], ["Assinatura mensal", null]]);
  });
});

// ---------------------------------------------------------------------------- casca do site gerado: consentimento

describe("pixel no site gerado: só depois do Aceitar (LGPD)", () => {
  type Fbq = { queue: unknown[][] };
  const fbq = () => (window as unknown as { fbq?: Fbq }).fbq;

  beforeEach(() => {
    vi.resetModules();
    delete (window as any).fbq;
    delete (window as any)._fbq;
    document.head.querySelectorAll("script").forEach((s) => s.remove());
    window.localStorage.clear();
    window.sessionStorage.clear();
  });

  it("antes do Aceitar nada carrega nem dispara; depois, init sem eventos automáticos, PageView, Contact e Schedule com eventID", async () => {
    const { CamadaDeIntegracoes } = await import("../../workers/motor-codigo/modelo-site/src/lib/integracoes");
    render(
      h("div", null, h("a", { href: "https://wa.me/5541999998888?text=oi", "data-teste": "whats", onClick: (e: { preventDefault: () => void }) => e.preventDefault() }, "WhatsApp"), h("button", { type: "button", "data-evento": "Schedule", "data-evento-nome": "Revisão" }, "Agendar"), h(CamadaDeIntegracoes)),
    );
    await screen.findByRole("dialog", { name: "Aviso de cookies" });
    fireEvent.click(document.querySelector('[data-teste="whats"]')!);
    expect(fbq()).toBeUndefined();
    expect(document.querySelector('script[src*="connect.facebook.net"]')).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Aceitar" }));
    expect(document.querySelector('script[src*="connect.facebook.net/en_US/fbevents.js"]')).not.toBeNull();
    const fila = () => fbq()!.queue.map((a) => Array.from(a as ArrayLike<unknown>));
    expect(fila().slice(0, 3)).toEqual([["set", "autoConfig", false, "123456789012345"], ["init", "123456789012345"], ["track", "PageView"]]);

    fireEvent.click(document.querySelector('[data-teste="whats"]')!);
    fireEvent.click(screen.getByRole("button", { name: "Agendar" }));
    const contato = fila().find((a) => a[0] === "track" && a[1] === "Contact")!;
    expect(contato[2]).toEqual({ content_name: "whatsapp" });
    expect((contato[3] as { eventID: string }).eventID).toMatch(/^contact-/);
    const agenda = fila().find((a) => a[0] === "track" && a[1] === "Schedule")!;
    expect(agenda[2]).toEqual({ content_name: "Revisão" });
  });

  it("recusar os cookies: nenhum evento e o formulário não manda dado para a Conversions API", async () => {
    window.localStorage.setItem("aceleriq-consentimento", "recusado");
    const enviado: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, i: any) => (enviado.push(JSON.parse(i.body)), { ok: true, json: async () => ({ ok: true }) })));
    const { Formulario, rastrear } = await import("../../workers/motor-codigo/modelo-site/src/lib/integracoes");
    render(h(Formulario));
    expect(rastrear("Contact")).toBeNull();
    fireEvent.change(document.querySelector('input[name="nome"]')!, { target: { value: "Ana Souza" } });
    fireEvent.change(document.querySelector('input[name="email"]')!, { target: { value: "ana@exemplo.com.br" } });
    await act(async () => {
      fireEvent.submit(document.querySelector("form")!);
    });
    await waitFor(() => expect(enviado.length).toBe(1));
    expect(enviado[0].meta).toBeUndefined();
    expect(fbq()).toBeUndefined();
    vi.unstubAllGlobals();
  });

  it("com o Aceitar, o Lead do formulário e o servidor usam o MESMO event_id, com correspondência avançada", async () => {
    window.localStorage.setItem("aceleriq-consentimento", "aceito");
    document.cookie = "_fbp=fb.1.1761400000000.123456789";
    const enviado: any[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_u: string, i: any) => (enviado.push(JSON.parse(i.body)), { ok: true, json: async () => ({ ok: true }) })));
    const { Formulario } = await import("../../workers/motor-codigo/modelo-site/src/lib/integracoes");
    render(h(Formulario));
    fireEvent.change(document.querySelector('input[name="nome"]')!, { target: { value: "Ana Souza" } });
    fireEvent.change(document.querySelector('input[name="email"]')!, { target: { value: " Ana@Exemplo.com.br " } });
    fireEvent.change(document.querySelector('input[name="whatsapp"]')!, { target: { value: "(41) 99999-8888" } });
    await act(async () => {
      fireEvent.submit(document.querySelector("form")!);
    });
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Recebido."));
    const meta = enviado[0].meta;
    expect(meta).toEqual(expect.objectContaining({ consentiu: true, fbp: "fb.1.1761400000000.123456789" }));
    const fila = fbq()!.queue.map((a) => Array.from(a as ArrayLike<unknown>));
    expect(fila).toContainEqual(["init", "123456789012345", { em: "ana@exemplo.com.br", ph: "5541999998888", fn: "ana" }]);
    const lead = fila.find((a) => a[0] === "track" && a[1] === "Lead")!;
    expect((lead[3] as { eventID: string }).eventID).toBe(meta.event_id);
    vi.unstubAllGlobals();
  });
});

// ---------------------------------------------------------------------------- Conversions API

describe("Conversions API pelo servidor", () => {
  it("o evento vai com hash SHA-256 normalizado; IP, navegador e fbp sem hash", async () => {
    const ev = (await eventoParaCapi({ evento: "Lead", event_id: "lead-abc12345", url: "https://oficina.com.br/contato/", ip: "200.1.2.3", user_agent: "UA", fbp: "fb.1.1761400000000.123456789", email: " Ana@Exemplo.com.br ", telefone: "(41) 99999-8888", nome: "Ána Souza" }, sha256))!;
    const ud = ev.user_data as Record<string, unknown>;
    expect(ud.em).toEqual([await sha256("ana@exemplo.com.br")]);
    expect(ud.ph).toEqual([await sha256("5541999998888")]);
    expect(ud.fn).toEqual([await sha256("ana")]);
    expect(ud.ln).toEqual([await sha256("souza")]);
    expect(ud.fbp).toBe("fb.1.1761400000000.123456789");
    expect(ud.client_ip_address).toBe("200.1.2.3");
    expect(ev).toEqual(expect.objectContaining({ event_name: "Lead", event_id: "lead-abc12345", action_source: "website" }));
    expect(corpoDaCapi([ev], "test12345")).toEqual({ data: [ev], test_event_code: "TEST12345" });
    expect(telefoneParaMeta("41 99999-8888")).toBe("5541999998888");
    expect(await eventoParaCapi({ evento: "Lead", event_id: "x", url: "", ip: null, user_agent: null }, sha256)).toBeNull();
  });

  it("só repete o Lead com pixel, servidor ligado e consentimento; o token fica no servidor", async () => {
    const siteDoForm = { client_id: CLIENTE, integracoes: { pixel_meta: { id: "123456789012345" } }, direcao: { jornada: { medicao: { capi: true } } } };
    const corpo = { meta: { consentiu: true, event_id: "lead-abc12345", fbp: "fb.1.1761400000000.123456789", fbc: null, url: "https://oficina.com.br/contato/" } };
    expect(pedidoDaCapi(siteDoForm, corpo)).toEqual(expect.objectContaining({ pixel: "123456789012345" }));
    expect(pedidoDaCapi({ ...siteDoForm, direcao: { jornada: { medicao: { capi: false } } } }, corpo)).toBeNull();
    expect(pedidoDaCapi(siteDoForm, { meta: { ...corpo.meta, consentiu: false } })).toBeNull();
    expect(lerMetaDoEnvio({ consentiu: true, event_id: "curto" })).toBeNull();
    const chamadas: Array<{ url: string; corpo: URLSearchParams }> = [];
    const r = await leadNaMeta(
      { token: async () => "TOKEN_SECRETO", sha256, buscar: async (url, init) => (chamadas.push({ url, corpo: init.body }), { ok: true, status: 200, json: async () => ({ events_received: 1 }) }) },
      siteDoForm,
      corpo,
      { nome: "Ana", email: "ana@exemplo.com.br", whatsapp: "5541999998888" },
      { ip: "200.1.2.3", user_agent: "UA", pagina: "/contato/", origem: "https://oficina.com.br" },
    );
    expect(r).toEqual({ enviado: true, motivo: null });
    expect(chamadas[0].url).toBe("https://graph.facebook.com/v26.0/123456789012345/events");
    const dados = JSON.parse(chamadas[0].corpo.get("data")!);
    expect(dados[0].event_id).toBe("lead-abc12345");
    const erro = await leadNaMeta(
      { token: async () => "TOKEN_SECRETO", sha256, buscar: async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "Invalid OAuth access_token=TOKEN_SECRETO" } }) }) },
      siteDoForm,
      corpo,
      { nome: "Ana", email: "ana@exemplo.com.br", whatsapp: null },
      { ip: null, user_agent: null, pagina: null, origem: null },
    );
    expect(erro.enviado).toBe(false);
    expect(erro.motivo).not.toContain("TOKEN_SECRETO");
  });

  it("pixels da conta: lidos sem confiar e o sugerido pelo nome da marca", () => {
    const pixels = pixelsDaResposta({ data: [{ id: "111111111111111", name: "Pixel antigo", last_fired_time: "2026-01-01T00:00:00+0000" }, { id: "222222222222222", name: "Oficina Teste - Site", last_fired_time: "2025-12-01T00:00:00+0000" }, { id: "abc", name: "lixo" }, { id: "333333333333333", is_unavailable: true }] }, "999");
    expect(pixels.map((p) => p.id)).toEqual(["111111111111111", "222222222222222"]);
    expect(pixelSugerido(pixels, "Oficina Teste")!.id).toBe("222222222222222");
    expect(pixelSugerido(pixels, "Outra")!.id).toBe("111111111111111");
  });
});

// ---------------------------------------------------------------------------- checagem antes de publicar

describe("checagem antes de publicar", () => {
  const base = { objetivo: "servico", pixel: null as string | null, cookiesLigado: true, whatsappLigado: true, formularioLigado: true, medicao: medicaoPadrao(), loja: null, temPaginaDeObrigado: false };

  it("avisa o pixel faltando para o objetivo (sem travar) e confere LGPD e duplicidade", () => {
    const sem = itensDaMedicao(base);
    expect(sem.find((i) => i.id === "pixel")).toEqual(expect.objectContaining({ ok: false, obrigatorio: false }));
    expect(sem.find((i) => i.id === "pixel")!.detalhe).toContain("Schedule");
    expect(itensDaMedicao({ ...base, objetivo: "bio" }).find((i) => i.id === "pixel")).toBeUndefined();
    const com = itensDaMedicao({ ...base, pixel: "123456789012345", medicao: { ...medicaoPadrao(), eventos_automaticos: true } });
    expect(com.find((i) => i.id === "pixel")!.ok).toBe(true);
    expect(com.find((i) => i.id === "eventos_automaticos")!.ok).toBe(false);
    expect(itensDaMedicao({ ...base, pixel: "123456789012345", cookiesLigado: false }).find((i) => i.id === "pixel_lgpd")).toEqual(expect.objectContaining({ ok: false, obrigatorio: true }));
    expect(itensDaMedicao({ ...base, pixel: "123456789012345", formularioLigado: false }).find((i) => i.id === "eventos")!.ok).toBe(false);
  });

  it("loja sem produto ou sem jeito de pagar é obrigatória; sem preço é aviso", () => {
    const vazia = itensDaMedicao({ ...base, objetivo: "loja_virtual", loja: normalizarLoja({}) });
    expect(vazia.find((i) => i.id === "loja_produtos")).toEqual(expect.objectContaining({ ok: false, obrigatorio: true }));
    const semLink = itensDaMedicao({ ...base, objetivo: "loja_virtual", loja: normalizarLoja({ checkout: "link", produtos: [{ nome: "Kit", preco: "10" }] }) });
    expect(semLink.find((i) => i.id === "loja_checkout")).toEqual(expect.objectContaining({ ok: false, obrigatorio: true }));
    const whats = itensDaMedicao({ ...base, objetivo: "loja_virtual", whatsappLigado: false, loja: normalizarLoja({ produtos: [{ nome: "Kit" }] }) });
    expect(whats.find((i) => i.id === "loja_checkout")!.ok).toBe(false);
    expect(whats.find((i) => i.id === "loja_precos")).toEqual(expect.objectContaining({ ok: false, obrigatorio: false }));
  });

  it("Testar eventos explica o Gerenciador de Eventos passo a passo", () => {
    const passos = passosDoTeste({ pixel: "123456789012345", url: "https://oficina.com.br", eventos: ["PageView", "Schedule"], capi: true });
    expect(passos[0]).toContain("Testar eventos");
    expect(passos.join(" ")).toContain("Aceitar");
    expect(passos.join(" ")).toContain("Schedule: toque no botão de agendar");
    expect(passos.join(" ")).toContain("TEST");
    expect(passos.join(" ")).toContain("Meta Ads Data Advisor");
  });
});

// ---------------------------------------------------------------------------- telas

describe("telas: pixel e loja", () => {
  it("Pixel e eventos: sugere o pixel da conta, grava pelo clique e o Testar eventos abre o passo a passo", async () => {
    rota("mesa-site", "medicao_estado", () => ({
      pixel: null,
      pixels: [{ id: "222222222222222", nome: "Oficina Teste - Site", ultimo_disparo: "2026-10-20T10:00:00+0000", conta: "999" }],
      sugerido: "222222222222222",
      tem_conta: true,
      tem_token: true,
      motivo: null,
      capi: { possivel: false, motivo: "Escolha o pixel primeiro." },
      eventos: ["PageView", "ViewContent", "Lead", "Contact", "Schedule"],
      medicao: medicaoPadrao(),
      passos: ["Abra o Gerenciador de Eventos no pixel 222222222222222 e entre em Testar eventos."],
      url: null,
    }));
    rota("mesa-site", "integracoes_salvar", (b) => ({ site: site({ integracoes: { pixel_meta: { id: b.integracoes.pixel_meta.id } } }) }));
    const s = site({ direcao: { jornada: { objetivo: "servico" } } });
    montar(h(PixelEEventos, { site: s }));
    await waitFor(() => expect(document.querySelector("[data-pixel-sugerido]")).toBeTruthy());
    expect(document.querySelectorAll("[data-eventos-do-objetivo] li").length).toBe(5);
    expect((document.querySelector("[data-capi]") as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(document.querySelector("[data-pixel-sugerido]")!);
    await waitFor(() => expect(corpos("mesa-site", "integracoes_salvar").length).toBe(1));
    expect(corpos("mesa-site", "integracoes_salvar")[0]).toEqual({ acao: "integracoes_salvar", site_id: SITE, integracoes: { pixel_meta: { id: "222222222222222" } } });
  });

  it("Loja: traz os produtos do cliente, troca o checkout e salva na jornada", async () => {
    rota("mesa-site", "jornada_salvar", (b) => ({ site: site({ direcao: { jornada: { objetivo: "loja_virtual", loja: b.loja } } }) }));
    montar(h(ProdutosDaLoja, { site: site({ tipo: "loja", direcao: { jornada: { objetivo: "loja_virtual" } } }), produtosDoCliente: ["Café 250 g - R$ 39,90", "Assinatura mensal"] }));
    fireEvent.click(document.querySelector("[data-puxar-produtos]")!);
    expect(document.querySelectorAll("[data-lista-de-produtos] li").length).toBe(2);
    fireEvent.click(document.querySelector('[data-checkout="link"]')!);
    fireEvent.change(screen.getAllByLabelText("Link de pagamento")[0], { target: { value: "https://pay.kiwify.com.br/cafe" } });
    fireEvent.click(document.querySelector("[data-salvar-loja]")!);
    await waitFor(() => expect(corpos("mesa-site", "jornada_salvar").length).toBe(1));
    const loja = corpos("mesa-site", "jornada_salvar")[0].loja;
    expect(loja.checkout).toBe("link");
    expect(loja.produtos[0]).toEqual(expect.objectContaining({ nome: "Café 250 g", preco: 39.9, link_pagamento: "https://pay.kiwify.com.br/cafe" }));
    expect(loja.produtos[1].preco).toBeNull();
  });
});
