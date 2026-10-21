/**
 * Laboratório v4 (ESPEC-LABORATORIO-v4.md): regras puras dos nós novos, do gatilho no fio, dos templates
 * e das peças do funil (sem rede).
 *
 *   deno test --allow-env --allow-read supabase/functions/laboratorio/modulos/v4_test.ts
 */
import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  aplicarOperacoes,
  CAMPOS_DO_TIPO,
  dadosDoTipo,
  ENTRADAS_ACEITAS,
  errosDoCanvas,
  GATILHOS,
  gatilhoValido,
  lerPlano,
  motivoParaNaoLigar,
  NOS_DA_V4,
  NOS_EXECUTAVEIS,
  normalizarCanvas,
  regrasEmTexto,
  TIPOS_DE_NO,
  type Canvas,
  type NoDoCanvas,
} from "./regras.ts";
import {
  caminhoLimpo,
  CHAVE_PENDENTE,
  destinosDoNo,
  embedDoVideo,
  faixaDa,
  faltasParaPorNoAr,
  htmlDoCheckout,
  htmlDoQuiz,
  htmlDoTesteAb,
  lerCopyDoCheckout,
  linhasDaPlanilha,
  parametrosDoCanal,
  pesosDoTeste,
  planoDoDominio,
  problemasDoModelo,
  quizNormalizado,
  rascunhoDoN8n,
  scriptDeConversaoDoTeste,
  redirecionamentosDe,
  segundosDe,
  urlHttps,
  urlPublicaSegura,
  validarDominio,
} from "./funil.ts";
import { CATEGORIA_DOS_OFICIAIS, CATEGORIAS_DOS_TEMPLATES, TEMPLATES_OFICIAIS_V4, TODOS_OS_TEMPLATES_OFICIAIS } from "./templates.ts";
import { estruturaDaPagina, lerPaginaPublica, saidaEstaticaDaV4 } from "../nos-v4.ts";
import { montarPacote } from "../no-ar.ts";

const no = (id: string, tipo: NoDoCanvas["tipo"], dados: Record<string, unknown> = {}): NoDoCanvas => ({ id, tipo, x: 0, y: 0, dados });
const vp = { x: 0, y: 0, zoom: 1 };
const CORES = { principal: "#123456", texto: "#111", fundo: "#fff", suave: "#eee" };

Deno.test("v4: os 22 tipos novos existem em todas as tabelas da função", () => {
  assertEquals(NOS_DA_V4.length + 5, 22);
  for (const t of ["marca", "cliente", "referencias", "video", "arquivo", "produto", "pagina", "checkout", "quiz", "webinar", "dominio", "teste_ab", "automacao", "email", "whatsapp", "area_membros", "ugc", "influenciador", "template_designer", "crm", "recuperacao", "fontes_trafego"]) {
    assert((TIPOS_DE_NO as readonly string[]).indexOf(t) >= 0, t);
    assert(Array.isArray(ENTRADAS_ACEITAS[t as keyof typeof ENTRADAS_ACEITAS]), t);
    assert(CAMPOS_DO_TIPO[t as keyof typeof CAMPOS_DO_TIPO].indexOf("titulo") >= 0, t);
  }
  for (const t of NOS_DA_V4) assert(NOS_EXECUTAVEIS.indexOf(t) >= 0, t);
});

Deno.test("v4: dados dos nós novos são limpos (escolha fora da lista, número no intervalo)", () => {
  const p = dadosDoTipo("pagina", { tipo_pagina: "vsl", objetivo: "voar", caminho: "/vsl" });
  assertEquals(p.dados, { tipo_pagina: "vsl", caminho: "/vsl" });
  assertEquals(p.ignorados, ["objetivo"]);
  // O tipo da Seções da página continua com a lista dela.
  assertEquals(dadosDoTipo("secoes_pagina", { tipo_pagina: "vsl" }).ignorados, ["tipo_pagina"]);
  assertEquals(dadosDoTipo("checkout", { gateway: "paypal" }).ignorados, ["gateway"]);
  assertEquals(dadosDoTipo("quiz", { perguntas: 99 }).dados.perguntas, 12);
  assertEquals(dadosDoTipo("email", { mensagens: 1 }).dados.mensagens, 1);
  assertEquals(dadosDoTipo("sequencia_mensagens", { mensagens: 1 }).dados.mensagens, 2);
  assertEquals(dadosDoTipo("ugc", { variacoes: 0 }).dados.variacoes, 1);
});

Deno.test("v4: produto fecha o funil pelo checkout usando tanto landing legada quanto página atual", () => {
  for (const tipo of ["landing", "pagina"] as const) {
    const c: Canvas = {
      nos: [no("produto", "produto"), no("venda", tipo), no("checkout", "checkout"), no("obrigado", "pagina")],
      ligacoes: [{ id: "a", de: "produto", para: "venda" }, { id: "b", de: "venda", para: "checkout" }, { id: "c", de: "checkout", para: "obrigado", gatilho: "compra_aprovada" }],
      viewport: vp,
    };
    assertEquals(errosDoCanvas(c), [], tipo);
    assertEquals(normalizarCanvas(c).ligacoes, c.ligacoes, tipo);
  }
});

Deno.test("v4: gatilho no fio só vale para a origem que tem aquele gatilho", () => {
  assert(gatilhoValido("checkout", "compra_aprovada"));
  assert(!gatilhoValido("pagina", "compra_aprovada"));
  assert(gatilhoValido("quiz", "faixa_alta"));
  assert(!gatilhoValido("copy", "visitou"));
  const c: Canvas = {
    nos: [no("p", "pagina"), no("k", "checkout"), no("u", "pagina")],
    ligacoes: [{ id: "l1", de: "p", para: "k", gatilho: "clicou_botao" }, { id: "l2", de: "k", para: "u", gatilho: "compra_aprovada" }],
    viewport: vp,
  };
  assertEquals(errosDoCanvas(c), []);
  const errado = { ...c, ligacoes: [{ id: "l1", de: "p", para: "k", gatilho: "pix_gerado" }] };
  assertMatch(errosDoCanvas(errado)[0], /gatilho "pix_gerado" não vale/);
  // O gatilho atravessa a leitura do canvas (forma do painel e do React Flow).
  assertEquals(normalizarCanvas({ nos: c.nos, ligacoes: [{ id: "l", source: "p", target: "k", gatilho: "clicou_botao" }] }).ligacoes[0].gatilho, "clicou_botao");
});

Deno.test("v4: o planejar liga com gatilho (e ignora o que a origem não tem, com recibo)", () => {
  const plano = lerPlano({ resposta: "ok", operacoes: [
    { op: "criar", ref: "a", tipo: "pagina", dados_json: '{"tipo_pagina":"vendas","caminho":"/oferta"}' },
    { op: "criar", ref: "b", tipo: "checkout" },
    { op: "criar", ref: "c", tipo: "recuperacao" },
    { op: "ligar", de: "a", para: "b", gatilho: "clicou_botao" },
    { op: "ligar", de: "b", para: "c", gatilho: "enviou_formulario" },
  ] }, "");
  const r = aplicarOperacoes({ nos: [], ligacoes: [], viewport: vp }, plano.operacoes);
  assertEquals(r.canvas.ligacoes.map((l) => l.gatilho ?? null), ["clicou_botao", null]);
  assert(r.recibos[3].recibo.indexOf("Clicou no botão") >= 0);
  assert(r.recibos[4].recibo.indexOf("Ignorei o gatilho") >= 0);
  assert(regrasEmTexto().indexOf("GATILHOS NO FIO") >= 0);
  assertEquals((GATILHOS as readonly string[]).indexOf("faixa_baixa") >= 0, true);
});

Deno.test("v4: os 25 templates novos são canvas válidos, com categoria, ids estáveis e gatilhos válidos", () => {
  assertEquals(TEMPLATES_OFICIAIS_V4.length, 25);
  const ids = new Set(TODOS_OS_TEMPLATES_OFICIAIS.map((t) => t.id));
  assertEquals(ids.size, 38);
  assertEquals(Object.keys(CATEGORIA_DOS_OFICIAIS).length, 13);
  for (const t of TEMPLATES_OFICIAIS_V4) {
    assert((CATEGORIAS_DOS_TEMPLATES as readonly string[]).indexOf(t.categoria || "") >= 0, t.nome);
    assertEquals(errosDoCanvas(normalizarCanvas(t.canvas)), [], t.nome);
    // Colunas da esquerda para a direita: toda ligação anda para a direita.
    for (const l of t.canvas.ligacoes) {
      const de = t.canvas.nos.find((n) => n.id === l.de)!;
      const para = t.canvas.nos.find((n) => n.id === l.para)!;
      assert(para.x > de.x, `${t.nome}: ${l.de} → ${l.para}`);
    }
    // Campos só os que a função lê.
    for (const n of t.canvas.nos) for (const k of Object.keys(n.dados)) assert(CAMPOS_DO_TIPO[n.tipo].indexOf(k) >= 0, `${t.nome}: ${n.id}.${k}`);
  }
  for (const c of CATEGORIAS_DOS_TEMPLATES) assert(TEMPLATES_OFICIAIS_V4.some((t) => t.categoria === c) || Object.values(CATEGORIA_DOS_OFICIAIS).indexOf(c) >= 0, c);
  // O funil low ticket tem a esteira de upsell com os gatilhos do ClickMax.
  const low = TEMPLATES_OFICIAIS_V4[1].canvas;
  assert(low.ligacoes.some((l) => l.de === "checkout_1" && l.para === "pagina_2" && l.gatilho === "compra_aprovada"));
  assert(low.ligacoes.some((l) => l.de === "pagina_2" && l.para === "pagina_3" && l.gatilho === "upsell_recusado"));
});

Deno.test("v4: endereços e destinos do funil", () => {
  assertEquals(caminhoLimpo("Oferta Especial!"), "/oferta-especial");
  assertEquals(caminhoLimpo("https://x.com/a/b?c=1"), "/a/b");
  assertEquals(caminhoLimpo("/"), "/");
  assertEquals(caminhoLimpo("", "/checkout"), "/checkout");
  const c: Canvas = {
    nos: [no("v", "pagina", { caminho: "/vendas" }), no("k", "checkout", { caminho: "/pagar", link_pagamento: "https://pay.hotmart.com/X1" }), no("o", "pagina", { caminho: "/obrigado" })],
    ligacoes: [{ id: "l1", de: "v", para: "k", gatilho: "clicou_botao" }, { id: "l2", de: "k", para: "o", gatilho: "compra_aprovada" }],
    viewport: vp,
  };
  const d = destinosDoNo(c, "v");
  assertEquals(d[0].link, "https://pay.hotmart.com/X1");
  assertEquals(d[0].gatilho, "clicou_botao");
  assertEquals(destinosDoNo(c, "k")[0].caminho, "/obrigado");
});

Deno.test("v4: checkout sem link https trava o Pôr no ar; com link, não", () => {
  const base: Canvas = { nos: [no("k", "checkout", { link_pagamento: "http://inseguro.com" }), no("n", "por_no_ar")], ligacoes: [{ id: "l", de: "k", para: "n" }], viewport: vp };
  assertEquals(faltasParaPorNoAr(base, "n").length, 1);
  const ok = { ...base, nos: [no("k", "checkout", { link_pagamento: "https://pay.kiwify.com.br/abc" }), no("n", "por_no_ar")] };
  assertEquals(faltasParaPorNoAr(ok, "n"), []);
  assertEquals(urlHttps("javascript:alert(1)"), null);
});

Deno.test("v4: página do checkout leva ao link do gateway e alterna o bump", () => {
  const copy = lerCopyDoCheckout({ titulo: "Garanta", itens: ["Curso"], texto_bump: "Planilha extra", texto_botao: "Comprar", prova: ["[RASCUNHO SEM FONTE: depoimento]"] });
  const html = htmlDoCheckout({ copy, gateway: "hotmart", link: "https://pay.hotmart.com/A", linkComBump: "https://pay.hotmart.com/A?bump=1", preco: "R$ 47", produto: "Curso", garantia: "7 dias", cores: CORES });
  assert(html.indexOf('href="https://pay.hotmart.com/A"') >= 0);
  assert(html.indexOf('id="bump"') >= 0);
  assert(html.indexOf("class=\"rascunho\"") >= 0);
  const sem = htmlDoCheckout({ copy, gateway: "stripe", link: null, linkComBump: null, preco: "", produto: "", garantia: "", cores: CORES });
  assert(sem.indexOf('aria-disabled="true"') >= 0);
  assert(sem.indexOf("Falta o link de pagamento") >= 0);
});

Deno.test("v4: quiz acerta pontos e faixas e manda { quiz: { pontuacao, faixa, respostas } } pelo site-formulario", () => {
  const q = quizNormalizado({
    titulo: "Teste",
    perguntas: [
      { pergunta: "A?", opcoes: [{ texto: "x", pontos: 0 }, { texto: "y", pontos: 50 }] },
      { pergunta: "B?", opcoes: [{ texto: "x", pontos: 2 }, { texto: "y", pontos: 5 }] },
      { pergunta: "C?", opcoes: [{ texto: "x", pontos: 1 }, { texto: "y", pontos: 3 }] },
      { pergunta: "", opcoes: [{ texto: "só uma", pontos: 1 }] },
    ],
    faixas: [{ nome: "Alta", min: 12, titulo: "Pronto", texto: "Agende", cta: "Agendar" }, { nome: "Média", min: 12 }, { nome: "Baixa", min: 3 }],
  }, 6);
  assertEquals(q.perguntas.length, 3);
  assertEquals(q.perguntas[0].opcoes[1].pontos, 10);
  assertEquals(q.pontuacao_maxima, 18);
  assertEquals(q.faixas.map((f) => f.id), ["faixa_alta", "faixa_media", "faixa_baixa"]);
  assertEquals(q.faixas[2].min, 0);
  assert(q.faixas[1].min < q.faixas[0].min);
  assertEquals(faixaDa(q, 18).id, "faixa_alta");
  assertEquals(faixaDa(q, 0).id, "faixa_baixa");
  const html = htmlDoQuiz({ quiz: q, endpoint: "https://x.supabase.co/functions/v1/site-formulario", pagina: "/quiz", captura: "antes_resultado", destinos: { faixa_alta: "/agendar" }, cores: CORES });
  assert(html.indexOf("quiz:{pontuacao:pontos,faixa:f.id,respostas:respostas}") >= 0);
  assert(html.indexOf(CHAVE_PENDENTE) >= 0);
  assert(html.indexOf("/agendar") >= 0);
  // ES5 no navegador: sem arrow nem let/const no script da página.
  const scripts = (html.match(/<script>[\s\S]*?<\/script>/g) || []).join("\n");
  assert(!/=>|\blet\b|\bconst\b|`/.test(scripts));
});

Deno.test("v4: teste A/B exige 2 a 5 versões e divisão que soma 100", () => {
  assertEquals(pesosDoTeste("50/50", 2), { pesos: [50, 50], erro: null });
  assertEquals(pesosDoTeste("", 3).pesos, [34, 33, 33]);
  assertMatch(pesosDoTeste("60/30", 2).erro || "", /soma 90%/);
  assertMatch(pesosDoTeste("50/50", 1).erro || "", /2 a 5/);
  assertMatch(pesosDoTeste("50/50", 3).erro || "", /2 parte/);
  const cfg = { teste_id: "teste-ab-abc123", caminho: "/teste-ab-abc123", variantes: [{ letra: "A", no_id: "a", rotulo: "A", caminho: "/a", peso: 50 }, { letra: "B", no_id: "b", rotulo: "B", caminho: "/b", peso: 50 }], metrica: "lead", limite: "sem_limite", variavel: "titulo" };
  // Sem o endereço do site: caminho relativo, mesmo contrato do ab-contar ({ teste_id, variante, tipo }).
  const relativo = htmlDoTesteAb(cfg, "https://x.supabase.co/functions/v1/ab-contar");
  assert(relativo.indexOf('tipo:"visita"') >= 0);
  assert(relativo.indexOf('"c":"/a"') >= 0);
  assert(relativo.indexOf('"K="ab:"+T') < 0 && relativo.indexOf('K="ab:"+T') >= 0);
  // Com o endereço do site: o script compartilhado (_shared/ab-divisao.ts), com o endereço completo.
  const completo = htmlDoTesteAb(cfg, "https://x.supabase.co/functions/v1/ab-contar", "https://cliente.com.br");
  assert(completo.indexOf("https://cliente.com.br/a") >= 0);
  assert(completo.indexOf("tipo:tipo") >= 0);
  assert(scriptDeConversaoDoTeste("teste-ab-abc123", "https://x.supabase.co/functions/v1/ab-contar")!.indexOf("conversao") >= 0);
  assertEquals(scriptDeConversaoDoTeste("teste-ab-abc123", "/functions/v1/ab-contar"), null);
});

Deno.test("v4: domínio com mensagem para cada erro, cartão de DNS e links curtos", () => {
  assertMatch(validarDominio("https://cliente.com.br").erro || "", /Tire o https/);
  assertMatch(validarDominio("cliente.com.br/oferta").erro || "", /Tire a barra/);
  assertMatch(validarDominio("cliente.com.br?x=1").erro || "", /\?/);
  assertMatch(validarDominio("cliente").erro || "", /terminação/);
  assertEquals(validarDominio("Cliente.com.br").dominio, "cliente.com.br");
  const r = redirecionamentosDe("/promo -> https://cliente.com.br/oferta\n/zap => /grupo\nlixo");
  assertEquals(r.map((x) => x.erro === null), [true, true, false]);
  const plano = planoDoDominio({ dominio: "cliente.com.br", subdominio: "oferta", estrutura: "subdominio", registrador: "registro_br", redirecionamentos: "/promo -> /oferta" }, [{ rotulo: "Vendas", caminho: "/oferta" }]);
  assertEquals(plano.host, "oferta.cliente.com.br");
  assertEquals(plano.enderecos[0].url, "https://oferta.cliente.com.br/oferta");
  assert(plano.cartao && plano.cartao.registros.length > 0);
  assertEquals((plano.vercel_json.redirects as unknown[]).length, 1);
});

Deno.test("v4: modelo de WhatsApp conferido pelas regras da Meta", () => {
  const bom = { nome: "lembrete_pix", categoria: "utilidade", idioma: "pt_BR", cabecalho: "", corpo: "Oi {{1}}, seu Pix de {{2}} vence hoje. Pague pelo link.", rodape: "", botoes: [{ tipo: "url", texto: "Pagar agora", url: "https://pay.x/1" }], exemplos: ["Ana", "R$ 47"] };
  assertEquals(problemasDoModelo(bom), []);
  const ruim = { ...bom, corpo: "{{1}} seu Pix {{3}}", exemplos: ["Ana"], botoes: [{ tipo: "url", texto: "Um botão com texto longo demais aqui", url: "http://x" }] };
  const p = problemasDoModelo(ruim).join(" ");
  assertMatch(p, /sequência/);
  assertMatch(p, /começar com variável/);
  assertMatch(p, /terminar com variável/);
  assertMatch(p, /exemplo/);
  assertMatch(p, /25 caracteres/);
  assertMatch(p, /https/);
});

Deno.test("v4: automação vira rascunho do n8n sempre INATIVO", () => {
  const w = rascunhoDoN8n({ nome: "Nutrição", gatilho: "formulário", passos: [{ ordem: 1, tipo: "esperar", detalhe: "1 dia", espera: "1 dia" }, { ordem: 2, tipo: "enviar e-mail", detalhe: "boas-vindas", espera: "" }], saiQuando: "comprou", horarioComercial: true });
  assertEquals(w.active, false);
  assertEquals((w.nodes as unknown[]).length, 3);
  assert(JSON.stringify(w).indexOf("RASCUNHO (não envia)") >= 0);
});

Deno.test("v4: fontes de tráfego, vídeo, planilha e minuto da oferta", () => {
  const meta = parametrosDoCanal("anuncio meta", "");
  assertEquals(meta.utm_content, "{{ad.id}}");
  assertEquals(meta.ad_id, "{{ad.id}}");
  assertEquals(parametrosDoCanal("Instagram", "lanc").utm_source, "instagram");
  assertEquals(embedDoVideo("https://youtu.be/dQw4w9WgXcQ"), "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&modestbranding=1");
  assertEquals(embedDoVideo("https://vimeo.com/123456789"), "https://player.vimeo.com/video/123456789");
  assertEquals(segundosDe("45:00"), 2700);
  assertEquals(segundosDe("1:05:30"), 3930);
  assertEquals(segundosDe("45:99"), null);
  assertEquals(linhasDaPlanilha("Título;Preço\nCafé;R$ 10\nBolo;R$ 20"), [{ titulo: "Café", preco: "R$ 10" }, { titulo: "Bolo", preco: "R$ 20" }]);
});

Deno.test("v4: referências só leem endereço público e conferem cada redirecionamento", async () => {
  assertEquals(urlPublicaSegura("http://localhost:3000"), null);
  assertEquals(urlPublicaSegura("http://192.168.0.1/"), null);
  assertEquals(urlPublicaSegura("http://169.254.169.254/latest"), null);
  assertEquals(urlPublicaSegura("https://exemplo.com.br/x"), "https://exemplo.com.br/x");
  const falso = ((url: string) => {
    if (url.indexOf("exemplo.com.br") >= 0) return Promise.resolve(new Response("", { status: 302, headers: { location: "http://127.0.0.1/admin" } }));
    return Promise.resolve(new Response("<html></html>"));
  }) as unknown as typeof fetch;
  const r = await lerPaginaPublica("https://exemplo.com.br/", falso);
  assert("erro" in r && /não permitido/.test(r.erro));
  const s = estruturaDaPagina('<title>Loja</title><section><h1>Café <b>bom</b></h1></section><h2>Preço</h2><style>.a{color:#ff0000;font-family:"Inter",sans-serif}.b{color:#ff0000}</style>');
  assertEquals(s.titulo, "Loja");
  assertEquals(s.titulos, ["H1: Café bom", "H2: Preço"]);
  assertEquals(s.cores[0], "#ff0000");
  assertEquals(s.fontes, ["Inter"]);
});

Deno.test("v4: nós estáticos (marca, produto, documento) viram texto; depoimento do documento conta como fonte", () => {
  const ctx = { marca: "Cliente: Café X\nPaleta: #00aa00", nomeDoCliente: "Café X", projeto: { client_id: "c1" } } as never;
  const m = saidaEstaticaDaV4(ctx, no("m", "marca", { paleta: "#112233 e #ffffff", tom: "próximo" }), "")!;
  assert((m.texto || "").indexOf("#112233") >= 0);
  assert((m.texto || "").indexOf("Do cliente do projeto") >= 0);
  const p = saidaEstaticaDaV4(ctx, no("p", "produto", { nome: "Curso", preco: "R$ 97" }), "")!;
  assertEquals((p.json as Record<string, unknown>).preco, "R$ 97");
  const d = saidaEstaticaDaV4(ctx, no("d", "arquivo", { uso: "depoimentos" }), "Ana: adorei")!;
  assertMatch(d.texto || "", /COM FONTE/);
});

Deno.test("v4: o Pôr no ar leva as páginas novas, as mensagens (rascunho) e as configurações", () => {
  const p = montarPacote([
    { no: no("w", "webinar"), saida: { paginas: [{ nome: "Inscrição", html_path: "a.html", html_url: "u" }, { nome: "Sala", html_path: "b.html" }] } },
    { no: no("e", "email"), saida: { texto: "3 e-mails", json: { emails: [] } } },
    { no: no("d", "dominio"), saida: { texto: "Domínio", json: { host: "x.com.br" } } },
  ]);
  assertEquals(p.paginas.length, 2);
  assertEquals(p.mensagens?.[0].pacote.enviado, false);
  assertEquals(p.configuracoes?.[0].tipo, "dominio");
  // Pacote antigo continua igual (sem as listas novas).
  assertEquals(Object.keys(montarPacote([{ no: no("l", "landing"), saida: { html_path: "x.html" } }])).sort(), ["anuncios", "copies", "criativos", "filmes", "ofertas", "paginas"]);
  // Nenhuma ligação nova recusa o que a ESPEC pede.
  assertEquals(motivoParaNaoLigar({ nos: [no("k", "checkout"), no("r", "recuperacao")], ligacoes: [] }, "k", "r"), null);
});
