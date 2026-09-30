import { createElement as h } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";

/**
 * Frente UXM (30/09/2026): a base UI UX Pro Max na Direção, na Revisão, na
 * paleta, nos pares, no Preencher com IA e no diretor de site. Política do Jev
 * com respostas falsas (limiares, pesos, nenhum, sem Jev), apoio da paleta
 * (marca intacta, AA, descarte com aviso), ordem do padrão e variantes,
 * regras de UX por código (cada uma acende e apaga), citação da base e as
 * telas (aba de estilos e checklist por severidade). Nada sai para o Supabase
 * real nem para o Jev.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), aviso: vi.fn(), sucesso: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }) }),
    channel: () => ({ on: function () { return this; }, subscribe: function () { return this; } }),
    removeChannel: vi.fn(),
  },
}));
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => mock.sucesso(...a), error: vi.fn(), info: vi.fn(), warning: (...a: unknown[]) => mock.aviso(...a) } }));

import { BASE_COMPLETA, itensDaBaseDeDesign, pacoteDaBaseDeDesign, regrasDoMapa } from "../../supabase/functions/_shared/uiux/base-completa";
import {
  aplicarRerank,
  candidatosDoRerank,
  LIMIAR_DO_PRODUTO,
  MAX_OPCOES_DO_CHOICE,
  notasDosEstilos,
  opcoesDasPerguntas,
  perguntasDaBase,
  perguntasDoRerank,
  probabilidadesDasRespostas,
  sugestaoDaBase,
  sugestaoSemJev,
} from "../../supabase/functions/_shared/uiux/jev-da-base";
import { apoioDaPaleta, corDoPapel, variaveisDoApoio } from "../../supabase/functions/_shared/uiux/apoio-da-paleta";
import { contraste } from "../../supabase/functions/_shared/cores-da-marca";
import { itensDoChecklistDeUx, lerTokensDoCss, pendenciasGraves, revisarUx } from "../../supabase/functions/_shared/uiux/revisao-ux";
import { anexoDaBaseCitada, blocoDaBaseDeDesign, numerarItens, regrasParaCampos, rotuloDaCitacao } from "../../supabase/functions/_shared/uiux/citar";
import { graficoParaDados, lerBaseDeDesign, lerSerieReal, paletaDoSetor, validarBaseDeDesign } from "../../supabase/functions/_shared/uiux/consultas";
import { limparVariantes, mapaDoPadrao, origensDaBase, variantesDoMapa, VARIANTES_DAS_SECOES } from "../../supabase/functions/_shared/site-variantes";
import { mapaPadrao, normalizarMapa } from "../../supabase/functions/_shared/site-biblioteca";
import { promptDaSecao, type PacoteDoSite } from "../../supabase/functions/_shared/site-metodo";
import { checklistDeLancamento, normalizarIntegracoes, normalizarSeo } from "../../supabase/functions/_shared/site-lancamento";
import { esquemaDosCampos, fontesPadraoDoPapel, limparResposta, montarPedido } from "../../supabase/functions/_shared/preencher-com-ia";
import { fontesDoSite, urlDasFontesDoSite } from "../../supabase/functions/_shared/uiux/fontes-do-site";
import { FONTES, MOTORES, motoresDaFonte, SKILLS_MARKETINGSKILLS } from "../../supabase/functions/_shared/motores";
import { cssDaMarca } from "../../workers/motor-codigo/lib/projeto";
import { montarPagina, urlDasFontes } from "../../workers/motor-codigo/modelo-site/scripts/seo.mjs";
import { PADROES_DA_BASE } from "../../supabase/functions/_shared/uiux/dados/landing";
import EstilosDaBase from "@/components/mesa-site/EstilosDaBase";
import ChecklistDeUx from "@/components/mesa-site/ChecklistDeUx";
import BaseCitada from "@/components/mesa-site/BaseCitada";
import type { LinhaDoSite } from "@/components/mesa-site/siteApi";
import { REGRAS_DE_UX_DA_BASE } from "../../supabase/functions/_shared/uiux/dados/ux";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const CLIENTE = "22222222-2222-4222-8222-222222222222";
const SITE = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  mock.invoke.mockReset();
  mock.aviso.mockReset();
  mock.sucesso.mockReset();
});

// ------------------------------------------------------------------ Jev

describe("Jev: listas completas e a política em código", () => {
  it("uma requisição com 5 Choices em lista completa, cada uma abaixo das 255 opções", () => {
    const q = perguntasDaBase(BASE_COMPLETA);
    expect(opcoesDasPerguntas(q)).toEqual({ produto: 193, estilo_da_base: 51, padrao: 35, par: 75, preset: 11 });
    for (const n of Object.values(opcoesDasPerguntas(q))) expect(n).toBeLessThanOrEqual(MAX_OPCOES_DO_CHOICE);
    expect(Object.keys(q.produto.type === "choice" ? q.produto.criteria : {})).toContain("nenhum");
    // Kit com fontes: o par não vai (não sugere o que a marca já decidiu).
    expect(Object.keys(perguntasDaBase(BASE_COMPLETA, { par: false }))).toEqual(["produto", "estilo_da_base", "padrao", "preset"]);
    expect(ler("supabase/functions/mesa-site/base-de-design.ts")).toContain("perguntasDaBase(BASE_COMPLETA, { par: !kitTemFontes })");
  });

  const probs = (extra: Record<string, Record<string, number>> = {}) =>
    probabilidadesDasRespostas({
      produto: { choice: "p40", probabilities: { p40: 0.62, p58: 0.2, nenhum: 0.05 } },
      estilo_da_base: { choice: "brutalism", probabilities: { brutalism: 0.4, "accessible-and-ethical": 0.35, "minimalism-and-swiss-style": 0.2 } },
      padrao: { choice: "hero-features-cta", probabilities: { "hero-features-cta": 0.3, "trust-authority-conversion": 0.25 } },
      par: { choice: "t2", probabilities: { t2: 0.3, t29: 0.25 } },
      preset: { choice: "suico", probabilities: { suico: 0.6, saas_limpo: 0.3 } },
      ...Object.keys(extra).reduce((o: Record<string, { probabilities: Record<string, number> }>, k) => ((o[k] = { probabilities: extra[k] }), o), {}),
    });

  it("produto acima do limiar entra sozinho; abaixo, a tela mostra os 3 e a pessoa escolhe; nenhum vence = sem produto", () => {
    expect(sugestaoDaBase(BASE_COMPLETA, probs()).produto).toMatchObject({ escolhido: { id: "40" }, escolher_a_mao: false });
    const baixo = probabilidadesDasRespostas({ produto: { probabilities: { p40: LIMIAR_DO_PRODUTO - 0.05, p58: 0.2, p60: 0.1 } } });
    const s = sugestaoDaBase(BASE_COMPLETA, baixo);
    expect(s.produto.escolhido).toBeNull();
    expect(s.produto.escolher_a_mao).toBe(true);
    expect(s.produto.top.map((t) => t.id)).toEqual(["40", "58", "60"]);
    const nenhum = probabilidadesDasRespostas({ produto: { probabilities: { nenhum: 0.7, p40: 0.31 } } });
    expect(sugestaoDaBase(BASE_COMPLETA, nenhum).produto.escolhido).toBeNull();
  });

  it("estilo: 0,55 da probabilidade + bônus do principal do produto + preset ligado; o principal passa o mais provável", () => {
    const e = notasDosEstilos(BASE_COMPLETA, probs(), "40");
    const acessivel = e.filter((x) => x.id === "accessible-and-ethical")[0];
    const brutal = e.filter((x) => x.id === "brutalism")[0];
    expect(acessivel.principal).toBe(true);
    expect(acessivel.nota).toBeCloseTo(0.55 * 0.35 + 0.25 + 0.1 * 0.3, 4);
    expect(brutal.nota).toBeCloseTo(0.55 * 0.4, 4);
    expect(e[0].id).not.toBe("brutalism");
  });

  it("rerank: pedido quando algum dos 4 primeiros tem 'não usar para'; Score reordena e o Noul de evitar tira", () => {
    const e = notasDosEstilos(BASE_COMPLETA, probs(), "40");
    const ids = candidatosDoRerank(BASE_COMPLETA, e);
    expect(ids.length).toBe(4);
    const q2 = perguntasDoRerank(BASE_COMPLETA, ids);
    expect(Object.keys(q2).length).toBe(8);
    const encaixe = q2[`encaixe_${ids[0]}`];
    expect(encaixe.type === "score" && encaixe.criteria.length).toBe(5);
    const depois = aplicarRerank(e.slice(0, 4), { [`encaixe_${ids[1]}`]: { score: 4 }, [`evitar_${ids[0]}`]: { noul: 0.8 } });
    expect(depois.map((x) => x.id)).not.toContain(ids[0]);
    expect(depois[0].id).toBe(ids[1]);
  });

  it("padrão só entre os permitidos para o tipo de site, com bônus do padrão do produto; par some com o kit que já tem fontes", () => {
    const s = sugestaoDaBase(BASE_COMPLETA, probs(), { tipo: "institucional" });
    expect(s.padroes[0].id).toBe("trust-authority-conversion");
    const bio = sugestaoDaBase(BASE_COMPLETA, probs(), { tipo: "bio" });
    for (const p of bio.padroes) expect(["minimal-single-column", "lead-magnet-form", "newsletter-content-first", "hero-centric-design"]).toContain(p.id);
    expect(sugestaoDaBase(BASE_COMPLETA, probs(), { kitTemFontes: true }).pares).toBeNull();
    expect(s.preset).toEqual({ id: "suico", prob: 0.6 });
    // Mudar o produto à mão não chama o Jev: refaz com as probabilidades guardadas.
    expect(sugestaoDaBase(BASE_COMPLETA, probs(), { produtoDaEquipe: "58" }).produto.escolhido).toEqual({ id: "58", prob: 1 });
  });

  it("sem Jev: o produto escolhido à mão e o resto das buscas exatas", () => {
    const s = sugestaoSemJev(BASE_COMPLETA, "40", { tipo: "institucional" });
    expect(s.estilos.map((x) => x.id)).toEqual(["accessible-and-ethical", "minimalism-and-swiss-style"]);
    expect(s.padroes[0].id).toBe("trust-authority-conversion");
    expect(s.pares && s.pares[0].id).toBe("29");
    expect(sugestaoSemJev(BASE_COMPLETA, null).produto.escolher_a_mao).toBe(true);
  });
});

// ------------------------------------------------------------------ paleta

describe("apoio da paleta: a marca manda, a base completa", () => {
  const marca = [{ hex: "#880516", papel: "primaria" }, { hex: "#C9A227", papel: "destaque" }];

  it("primária e destaque da marca intactos; a base só completa neutros, erro e anel; texto AA", () => {
    const a = apoioDaPaleta({ marca, setor: paletaDoSetor(BASE_COMPLETA, "40") });
    expect(corDoPapel(a, "primaria")).toBe("#880516");
    expect(corDoPapel(a, "destaque")).toBe("#C9A227");
    expect(a.papeis.filter((p) => p.papel === "primaria")[0].origem).toBe("marca");
    const fundo = corDoPapel(a, "fundo")!;
    expect(contraste(corDoPapel(a, "texto")!, fundo)).toBeGreaterThanOrEqual(4.5);
    expect(contraste(corDoPapel(a, "texto_suave")!, fundo)).toBeGreaterThanOrEqual(4.5);
    expect(contraste(corDoPapel(a, "anel")!, fundo)).toBeGreaterThanOrEqual(3);
    // O destaque dourado não passa como texto no fundo claro: nasce o destaque para texto, que passa.
    expect(contraste("#C9A227", fundo)).toBeLessThan(4.5);
    expect(contraste(corDoPapel(a, "destaque_texto")!, fundo)).toBeGreaterThanOrEqual(4.5);
    expect(a.citacao).toBe("uupm:color:40");
    expect(a.papeis.some((p) => p.origem === "uupm:color:40")).toBe(true);
  });

  it("borda que some no fundo sai do tom da base com aviso; site escuro não usa os neutros claros da base", () => {
    const setor = { ...paletaDoSetor(BASE_COMPLETA, "40")!, borda: "#F8FAFC" };
    const a = apoioDaPaleta({ marca, setor, fundo: "#F8FAFC" });
    expect(a.avisos.join(" ")).toMatch(/borda da base some/);
    const escuro = apoioDaPaleta({ marca, setor: paletaDoSetor(BASE_COMPLETA, "40"), fundo: "#0B0B0C", texto: "#F5F5F3" });
    expect(escuro.papeis.filter((p) => p.papel === "cartao")[0].origem).toBe("ajuste");
    expect(contraste(corDoPapel(escuro, "texto")!, "#0B0B0C")).toBeGreaterThanOrEqual(4.5);
    expect(Object.keys(variaveisDoApoio(escuro))).toEqual(expect.arrayContaining(["--cor-borda", "--cor-anel", "--cor-erro", "--cor-sobre-destaque", "--cor-destaque-texto", "--cor-texto-suave"]));
  });

  it("o CSS da marca ganha as variáveis do apoio e continua com o fundo e o texto de sempre", () => {
    const css = cssDaMarca({ paleta: [{ hex: "#880516", papel: "primária" }, { hex: "#FFFFFF", papel: "fundo" }], dna: { atributos: [{ id: "claro_editorial" }] } });
    expect(css).toMatch(/--cor-fundo: #ffffff;/);
    expect(css).toMatch(/--cor-anel: #[0-9a-f]{6};/);
    expect(css).toMatch(/--cor-sobre-destaque: #ffffff;/);
    const tokens = lerTokensDoCss(css);
    expect(contraste(tokens["--cor-texto-suave"], tokens["--cor-fundo"])).toBeGreaterThanOrEqual(4.5);
  });
});

// ------------------------------------------------------------------ padrões e variantes

describe("padrões de landing e variantes das seções", () => {
  it("toda origem das variantes existe na base e o mapa continua com as 25 seções", () => {
    for (const o of origensDaBase()) expect(PADROES_DA_BASE.some((p) => `uupm:landing:${p.id}` === o), o).toBe(true);
    expect(Object.keys(VARIANTES_DAS_SECOES)).toContain("hero");
  });

  it("Aplicar a ordem do padrão: seções que faltam entram pela ordem canônica, só real fica de fora e a variante liga", () => {
    const antes = mapaPadrao("landing");
    const padrao = PADROES_DA_BASE.filter((p) => p.id === "pricing-page-cta")[0];
    const r = mapaDoPadrao(antes, padrao);
    expect(r.entraram).toContain("pricing");
    const inicio = r.mapa.paginas[0].secoes;
    expect(inicio.map((s) => s.tipo).indexOf("pricing")).toBeLessThan(inicio.map((s) => s.tipo).indexOf("faq"));
    expect(inicio.filter((s) => s.tipo === "pricing")[0].variante).toBe("pricing-page-cta");
    const comDepoimento = mapaDoPadrao(antes, PADROES_DA_BASE.filter((p) => p.id === "hero-testimonials-cta")[0]);
    expect(comDepoimento.so_real).toContain("depoimentos");
    // A variante sobrevive ao normalizar (mapa guardado) e some quando não existe para o tipo.
    const guardado = normalizarMapa(JSON.parse(JSON.stringify(r.mapa)), "landing");
    expect(variantesDoMapa(guardado)[inicio.filter((s) => s.tipo === "pricing")[0].uid].id).toBe("pricing-page-cta");
    const errado = { ...guardado, paginas: guardado.paginas.map((p) => ({ ...p, secoes: p.secoes.map((s) => ({ ...s, variante: "nao-existe" })) })) };
    expect(Object.keys(variantesDoMapa(limparVariantes(errado)))).toEqual([]);
  });

  it("o prompt da seção cita a variante, o estilo da base e pede a prova de UX", () => {
    const mapa = mapaDoPadrao(mapaPadrao("landing"), PADROES_DA_BASE.filter((p) => p.id === "pricing-page-cta")[0]).mapa;
    const uid = mapa.paginas[0].secoes.filter((s) => s.tipo === "pricing")[0].uid;
    const base = pacoteDaBaseDeDesign(lerBaseDeDesign({ produto: { id: "40", origem: "jev" }, estilo: { id: "accessible-and-ethical", origem: "jev" } }), { tipos: ["pricing", "hero"], variantes: variantesDoMapa(mapa), kitTemFontes: false });
    const pacote = { cliente: "Advocacia X", marca: { nome: "X" }, paleta: [], fontes: [], dna: null, direcao: {}, copy: null, imagens: [], fotos_reais: [], logo: null, secoes: [uid], mapa, base_de_design: base } as unknown as PacoteDoSite;
    const t = promptDaSecao(pacote, uid);
    expect(t).toMatch(/Variante: Tabela com CTA \(base uupm:landing:pricing-page-cta\)/);
    expect(t).toMatch(/Estilo da base: Acessível e ético/);
    expect(t).toMatch(/\.aceleriq\/ux\//);
    expect(base!.consulta).toBe("Legal Services Accessible & Ethical");
  });

  it("gráfico só com série real e fonte, pela forma do dado", () => {
    expect(graficoParaDados({ pontos: [{ rotulo: "2023", valor: 10 }, { rotulo: "2024", valor: 20 }], eixo: "tempo", fonte: "briefing" })).toMatchObject({ tipo: "linha", no: "1" });
    expect(graficoParaDados({ pontos: [{ rotulo: "A", valor: 10 }, { rotulo: "B", valor: 20 }], fonte: "dossiê" })).toMatchObject({ tipo: "barras" });
    expect(graficoParaDados({ pontos: [{ rotulo: "A", valor: 60 }, { rotulo: "B", valor: 40 }], parte_do_todo: true, fonte: "arquivo" })).toMatchObject({ tipo: "rosca" });
    // Parte do todo sem valor positivo não vira rosca (o Grafico da casca recusaria): cai para barras.
    expect(graficoParaDados({ pontos: [{ rotulo: "A", valor: 0 }, { rotulo: "B", valor: 0 }], parte_do_todo: true, fonte: "arquivo" })).toMatchObject({ tipo: "barras" });
    expect(graficoParaDados({ pontos: [{ rotulo: "A", valor: 60 }, { rotulo: "B", valor: 40 }], fonte: "" })).toBeNull();
    expect(lerSerieReal({ pontos: [{ rotulo: "x", valor: "1.200,5" }, { rotulo: "y", valor: 3 }], fonte: "briefing" })!.pontos[0].valor).toBe(1200.5);
  });
});

// ------------------------------------------------------------------ revisão de UX

const HTML_BOM = `<!doctype html><html lang="pt-BR"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400&display=swap"><script src="https://cdn.x/y.js" defer></script></head><body><a href="#main">Pular para o conteúdo</a><nav>m</nav><main id="main"><h1>Oi</h1><h2>a</h2><h3>b</h3><img src="a.png" alt="a"><img src="b.png" alt="b" loading="lazy"><form><label for="e">E-mail</label><input id="e" name="email" type="email" autocomplete="email"><label>Telefone <input name="telefone" type="tel" autocomplete="tel"></label></form><video src="v.mp4" autoplay muted controls></video><div class="marquee" data-marquee><button aria-label="Pausar a faixa">||</button></div></main><footer>f</footer></body></html>`;
const CSS_BOM = `:focus-visible{outline:2px solid red}@keyframes a{}.x{transition:opacity .2s}@media (prefers-reduced-motion: reduce){*{animation:none}}`;
const TOKENS_BONS = { "--cor-fundo": "#ffffff", "--cor-texto": "#111111", "--cor-destaque": "#880516", "--cor-sobre-destaque": "#ffffff", "--cor-texto-suave": "#5c5c5c", "--fonte-titulo": '"Inter", ui-sans-serif' };

describe("regras de UX por código (cada uma acende e apaga)", () => {
  it("o site bom não acende nenhuma", () => {
    expect(revisarUx(HTML_BOM, CSS_BOM, TOKENS_BONS)).toEqual([]);
  });

  const casos: Array<[string, string, string, Record<string, string>]> = [
    ["9", HTML_BOM, CSS_BOM.replace(/@media \(prefers-reduced-motion: reduce\)\{\*\{animation:none\}\}/, ""), TOKENS_BONS],
    ["28", HTML_BOM, CSS_BOM.replace(":focus-visible{outline:2px solid red}", ""), TOKENS_BONS],
    ["76", HTML_BOM, CSS_BOM, { ...TOKENS_BONS, "--cor-texto": "#dddddd" }],
    ["36", HTML_BOM, CSS_BOM, { ...TOKENS_BONS, "--cor-sobre-destaque": "#990000" }],
    ["38", HTML_BOM.replace('alt="a"', ""), CSS_BOM, TOKENS_BONS],
    ["39", HTML_BOM.replace("<h2>a</h2>", ""), CSS_BOM, TOKENS_BONS],
    ["42", HTML_BOM.replace("<footer>f</footer>", ""), CSS_BOM, TOKENS_BONS],
    ["43", HTML_BOM.replace('<label for="e">E-mail</label>', ""), CSS_BOM, TOKENS_BONS],
    ["45", HTML_BOM.replace('<a href="#main">Pular para o conteúdo</a>', ""), CSS_BOM, TOKENS_BONS],
    ["47", HTML_BOM.replace(' loading="lazy"', ""), CSS_BOM, TOKENS_BONS],
    ["50", HTML_BOM.replace("&display=swap", ""), CSS_BOM, TOKENS_BONS],
    ["75", HTML_BOM.replace(/<link[^>]*fonts\.googleapis[^>]*>/, ""), CSS_BOM, TOKENS_BONS],
    ["51", HTML_BOM.replace(" defer", ""), CSS_BOM, TOKENS_BONS],
    ["57", HTML_BOM.replace('type="email"', 'type="text"'), CSS_BOM, TOKENS_BONS],
    ["58", HTML_BOM.replace(' autocomplete="tel"', ""), CSS_BOM, TOKENS_BONS],
    ["68", HTML_BOM.replace(/<meta name="viewport"[^>]*>/, ""), CSS_BOM, TOKENS_BONS],
    ["96", HTML_BOM.replace(" muted", ""), CSS_BOM, TOKENS_BONS],
    ["108", HTML_BOM.replace('<button aria-label="Pausar a faixa">||</button>', ""), CSS_BOM, TOKENS_BONS],
  ];
  it.each(casos)("regra %s acende quando falta", (no, html, css, tokens) => {
    const avisos = revisarUx(html, css, tokens);
    expect(avisos.map((a) => a.regra)).toContain(`uupm:ux:${no}`);
    const a = avisos.filter((x) => x.regra === `uupm:ux:${no}`)[0];
    expect(a.corrigir.length).toBeGreaterThan(10);
    expect(a.modo).toBe("codigo");
  });

  it("checklist: 109 regras; código ok depois da revisão, prova do agente, marcação da equipe e o não se aplica", () => {
    const itens = itensDoChecklistDeUx(REGRAS_DE_UX_DA_BASE, {
      avisos: revisarUx(HTML_BOM.replace('alt="a"', ""), CSS_BOM, TOKENS_BONS),
      revisado: true,
      agente: [{ secao: "hero", conferidas: ["uupm:ux:69"], pendentes: [{ regra: "uupm:ux:66", motivo: "botão com 32 px" }] }],
      marcas: { "3": "ok" },
    });
    expect(itens.length).toBe(109);
    const por = (no: string) => itens.filter((i) => i.no === no)[0];
    expect(por("38")).toMatchObject({ estado: "falhou", origem: "conferido no código" });
    expect(por("9")).toMatchObject({ estado: "ok" });
    expect(por("69")).toMatchObject({ estado: "ok", origem: "o agente conferiu", secao: "hero" });
    expect(por("66")).toMatchObject({ estado: "falhou", detalhe: "botão com 32 px" });
    expect(por("3")).toMatchObject({ estado: "ok", origem: "a equipe marcou" });
    expect(por("107")).toMatchObject({ estado: "nao_se_aplica" });
    expect(pendenciasGraves(itens)).toBeGreaterThan(0);
  });

  it("checklist de lançamento: item de UX não obrigatório, só quando a tela calculou", () => {
    const base = { briefingSalvo: true, temMapa: true, secoes: ["hero"], construidas: ["hero"], preset: true, copyEscolhida: true, slotsVazios: 0, buildOk: true, avisosDeQa: 0, seo: normalizarSeo({}), temOgImagem: true, temLogo: true, integracoes: normalizarIntegracoes({}), secoesComFormulario: false, secoesComMapa: false, dominio: null, dominioVerificado: false, construidoDepoisDasMudancas: true };
    expect(checklistDeLancamento(base).some((i) => i.id === "ux")).toBe(false);
    const item = checklistDeLancamento({ ...base, pendenciasDeUx: 3 }).filter((i) => i.id === "ux")[0];
    expect(item).toMatchObject({ ok: false, obrigatorio: false, etapa: "revisao", detalhe: "3 pendência(s)" });
    expect(checklistDeLancamento({ ...base, pendenciasDeUx: 0 }).filter((i) => i.id === "ux")[0].ok).toBe(true);
  });

  it("o worker roda a revisão de UX em todas as páginas depois do revisarHtml, ao lado da prova da passada", () => {
    const worker = ler("workers/motor-codigo/lib/executar.ts");
    expect(worker).toContain("const ux = await revisaoDeUx(pasta);");
    expect(worker).toContain("resultado.ux_paginas = ux.paginas;");
    expect(worker).toContain("resultado.ux_agente = ux.agente;");
    // Uma integração só: o executar.ts chama a revisão de UX e a prova da base (a do motor), sem cópia paralela.
    expect(worker).toContain('from "./prova-da-base.ts"');
    expect(worker).toContain('from "./revisao-ux.ts"');
    const leitor = ler("workers/motor-codigo/lib/revisao-ux.ts");
    expect(leitor).toContain("normalizarProvaDeUx");
    // O filtro antigo, que jogava fora a regra citada pelo nome, saiu.
    expect(leitor).not.toContain("uupm:ux:\\d{1,3}$");
  });
});

// ------------------------------------------------------------------ citação da base

describe("Preencher com IA e diretor de site citam a regra da base", () => {
  const itens = itensDaBaseDeDesign(lerBaseDeDesign({ produto: { id: "40", origem: "jev" }, padrao: { id: "trust-authority-conversion", origem: "jev" } }), { regras: ["43", "54"] });

  it("apelidos b1..bN, bloco no teto e a regra humana na citação", () => {
    expect(itens.map((i) => i.apelido)).toEqual(["b1", "b2", "b3", "b4"]);
    expect(itens[1].id).toBe("uupm:landing:trust-authority-conversion");
    const bloco = blocoDaBaseDeDesign({ papel: "site", itens, max: 1200 });
    expect(bloco).toMatch(/^BASE DA DIREÇÃO/);
    expect(bloco.length).toBeLessThanOrEqual(1200);
    expect(rotuloDaCitacao(itens[1])).toBe("Base UI UX Pro Max: padrão Autoridade, confiança e conversão (uupm:landing:trust-authority-conversion)");
    expect(numerarItens(itens.concat(itens)).length).toBe(4);
  });

  it("base_citada: apelido inventado sai; o diretor tem o campo no esquema e o anexo na conversa", () => {
    expect(anexoDaBaseCitada(["b2", "b9", "g1"], itens)).toEqual({ tipo: "base_citada", itens: [{ id: "uupm:landing:trust-authority-conversion", rotulo: "padrão Autoridade, confiança e conversão" }] });
    expect(anexoDaBaseCitada(["b9"], itens)).toBeNull();
    const f = ler("supabase/functions/mesa-site/index.ts");
    expect(f).toContain('"regras_seguidas", "base_citada"]');
    expect(f).toContain("anexoDaBaseCitada(j.base_citada, itensDaBase)");
  });

  it("regras_usadas: enum dos apelidos mostrados; inventado sai; a base nunca é fonte de fato", () => {
    const campos = [{ chave: "numeros.titulo", rotulo: "Título da seção de números", tipo: "texto" as const }];
    const regrasDaBase = itens.map((i) => ({ apelido: i.apelido, id: i.id, rotulo: rotuloDaCitacao(i) }));
    const esquema = esquemaDosCampos(campos, { apelidos: regrasDaBase.map((r) => r.apelido) });
    expect((esquema.schema as { required: string[] }).required).toContain("regras_usadas");
    expect(esquemaDosCampos(campos).schema).not.toHaveProperty("properties.regras_usadas");
    const base = { id: "base" as const, rotulo: "base de design", texto: "Mais de 500 clientes atendidos" };
    const briefing = { id: "briefing" as const, rotulo: "briefing de 12/09", texto: "Advocacia empresarial em Curitiba" };
    const pedido = montarPedido({ papel: "site", campos, fontes: [briefing, base], regrasDaBase });
    expect(pedido.sistema).toMatch(/regras_usadas/);
    expect(pedido.mensagem).toMatch(/### base de design/);
    const r = limparResposta({ valores: { c0: "Mais de 500 clientes" }, fontes_usadas: [], citacoes: [], avisos: [], regras_usadas: ["b2", "b77"] }, { papel: "site", mapa: pedido.esquema.mapa, fontes: [briefing, base], regrasDaBase });
    expect(r.valores["numeros.titulo"]).toBeUndefined();
    expect(r.regras_usadas).toEqual([{ id: "uupm:landing:trust-authority-conversion", rotulo: regrasDaBase[1].rotulo }]);
    expect(r.fontes).toContain(regrasDaBase[1].rotulo);
    expect(r.fontes).not.toContain("base de design");
    expect(fontesPadraoDoPapel("site")).toContain("base");
    expect(fontesPadraoDoPapel("proposta")).not.toContain("base");
    expect(regrasParaCampos([{ chave: "contato.formulario", rotulo: "Formulário" }])).toEqual(expect.arrayContaining(["43", "54"]));
  });

  it("o índice de motores liga a fonte ui_ux_pro_max ao motor mesa_site.direcao; site-architecture e schema ficam cobertos", () => {
    expect(FONTES.ui_ux_pro_max.estado).toBe("integrado");
    expect(motoresDaFonte("ui_ux_pro_max")).toEqual(["mesa_site.direcao"]);
    expect(MOTORES.filter((m) => m.id === "mesa_site.direcao")[0].montar().ids).toEqual(["base_de_design"]);
    expect(SKILLS_MARKETINGSKILLS["site-architecture"].estado).toBe("coberto");
    expect(SKILLS_MARKETINGSKILLS.schema.estado).toBe("coberto");
  });

  it("guardado por marca: escolha que não existe na base sai; o rótulo vai junto", () => {
    const b = validarBaseDeDesign(BASE_COMPLETA, lerBaseDeDesign({ produto: { id: "40", origem: "jev", rotulo: "Serviços jurídicos" }, estilo: { id: "vaporwave", origem: "equipe" }, padrao: { id: "nao-existe", origem: "equipe" }, ux: { "3": "ok", x: "ok" } }));
    expect(b.produto).toMatchObject({ id: "40", rotulo: "Serviços jurídicos" });
    expect(b.estilo).toBeNull();
    expect(b.padrao).toBeNull();
    expect(b.ux).toEqual({ "3": "ok" });
    expect(regrasDoMapa(["contato"])).toEqual(expect.arrayContaining(["69", "43"]));
  });
});

// ------------------------------------------------------------------ fontes no site

describe("a fonte carrega no site e a tipografia da Identidade chega ao pacote", () => {
  it("ordem: kit, Identidade, par da base; endereço só com família conhecida", () => {
    expect(fontesDoSite([{ nome: "Gotham", papel: "titulo" }], { titulo: "Lora" }, null).origem).toBe("kit");
    expect(fontesDoSite([], { titulo: "Lora", texto: "Inter" }, { titulo: "EB Garamond", texto: "Lato" })).toEqual({ fontes: [{ nome: "Lora", papel: "titulo" }, { nome: "Inter", papel: "texto" }], origem: "identidade" });
    expect(fontesDoSite([], null, { titulo: "EB Garamond", texto: "Lato" }).origem).toBe("base");
    const url = urlDasFontesDoSite([{ nome: "Cinzel" }, { nome: "Fonte Inventada" }])!;
    expect(url).toMatch(/family=Cinzel:wght@400;600;700/);
    expect(url).not.toMatch(/Inventada/);
    expect(url).toMatch(/display=swap$/);
  });

  it("o pré-render põe o link css2 com preconnect; outro host é recusado", () => {
    const base = '<html lang="pt-BR"><head><title>Site</title><meta name="description" content="" /><meta property="og:title" content="" /><meta property="og:description" content="" /><meta property="og:image" content="" /><meta name="theme-color" content="#111111" /><link rel="icon" href="/marca/logo.png" /></head><body><div id="root"><!--app--></div></body></html>';
    const pacote = { cliente: "X", paleta: [], fontes_url: "https://fonts.googleapis.com/css2?family=Inter:wght@400;700&display=swap", seo: {} };
    const html = montarPagina(base, "<main></main>", pacote, { id: "inicio", slug: "", titulo: "Início" });
    expect(html).toMatch(/<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin \/>/);
    expect(html).toMatch(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com\/css2\?family=Inter:wght@400;700&amp;display=swap" data-fontes \/>/);
    expect(urlDasFontes({ fontes_url: "https://evil.example/css2?family=Inter&display=swap" })).toBeNull();
    // O endereço que o painel monta passa inteiro pelo pré-render do motor (um seo.mjs só).
    const doPainel = urlDasFontesDoSite([{ nome: "EB Garamond" }, { nome: "Lato" }])!;
    expect(urlDasFontes({ fontes_url: doPainel })).toBe(doPainel);
    expect(revisarUx(html, CSS_BOM, TOKENS_BONS).map((a) => a.regra)).not.toContain("uupm:ux:75");
  });
});

// ------------------------------------------------------------------ telas

const valor = (): MesaValor =>
  ({ clientId: CLIENTE, clientName: "Advocacia", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 10, catalogo: [], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(), marcas: [], marca: null }) as unknown as MesaValor;

function montar(filho: ReturnType<typeof h>) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(MesaProvider, { valor: valor(), children: filho }))));
}

const site = (extra: Partial<LinhaDoSite> = {}): LinhaDoSite =>
  ({ id: SITE, client_id: CLIENTE, marca_id: null, nome: "Site", projeto: "site-33333333", etapa: "revisao", briefing: {}, referencias: [], dna: {}, direcao: {}, conteudo: {}, imagens: [], revisao: {}, publicacao: {}, modelo: null, tipo: "landing", mapa: mapaPadrao("landing"), estilo: {}, integracoes: {}, seo: {}, arquivado_em: null, atualizado_em: "2026-09-30T10:00:00Z", ...extra }) as LinhaDoSite;

describe("telas da base", () => {
  it("aba de estilos: os que combinam com o produto vêm primeiro, com selo, e a miniatura usa o destaque da marca", async () => {
    const escolher = vi.fn();
    montar(h(EstilosDaBase, { destaque: "#880516", nome: "Advocacia X", produtoNo: "40", escolhido: null, ocupado: false, onEscolher: escolher }));
    await waitFor(() => expect(document.querySelector("[data-estilos-da-base]")).not.toBeNull(), { timeout: 20_000 });
    expect(screen.getByText("Combinam com Serviços jurídicos")).toBeTruthy();
    const primeiro = document.querySelector("[data-estilo-da-base]") as HTMLElement;
    expect(primeiro.getAttribute("data-estilo-da-base")).toBe("accessible-and-ethical");
    expect(primeiro.querySelector("[data-recomendado]")!.textContent).toBe("recomendado");
    const destaque = Array.from(primeiro.querySelectorAll("div")).filter((d) => (d as HTMLElement).style.background === "rgb(136, 5, 22)");
    expect(destaque.length).toBe(1);
    expect(document.querySelectorAll("[data-estilo-da-base]").length).toBe(50);
    fireEvent.click(document.querySelector('[data-estilo-da-base="brutalism"]') as HTMLElement);
    expect(escolher).toHaveBeenCalledWith("brutalism");
    // "Não usar para" aparece quando o setor bate: a base diz que massinha 3D não serve a app jurídico.
    expect(document.querySelector('[data-estilo-da-base="claymorphism"] [data-nao-usar-para]')).not.toBeNull();
  }, 30_000);

  it("checklist de UX por severidade: crítica e alta abertas, média e baixa recolhidas; Como corrigir abre; Ok grava", async () => {
    mock.invoke.mockImplementation((_f: string, { body }: any) => Promise.resolve({ data: body.acao === "ux_marcar" ? { site: site(), custo_usd: 0 } : {}, error: null }));
    const mod = await import("../../supabase/functions/_shared/uiux/revisao-ux");
    const itens = mod.itensDoChecklistDeUx(REGRAS_DE_UX_DA_BASE, { avisos: [], revisado: false, agente: [], marcas: {} });
    montar(h(ChecklistDeUx, { site: site(), itens, onIrPara: vi.fn() }));
    expect(document.querySelectorAll("[data-grupo-de-severidade]").length).toBe(4);
    expect(document.querySelector('[data-grupo-de-severidade="alta"] [data-regra-de-ux]')).not.toBeNull();
    expect(document.querySelector('[data-grupo-de-severidade="media"] [data-regra-de-ux]')).toBeNull();
    const linha = document.querySelector('[data-regra-de-ux="37"]') as HTMLElement;
    fireEvent.click(Array.from(linha.querySelectorAll("button")).filter((b) => b.textContent === "Como corrigir")[0]);
    expect(document.querySelector('[data-como-corrigir="37"]')!.textContent).toMatch(/ícone/);
    fireEvent.click(linha.querySelector('[data-marcar-ok="37"]') as HTMLElement);
    await waitFor(() => expect(mock.invoke.mock.calls.some((c: any[]) => c[1].body.acao === "ux_marcar" && c[1].body.regra === "37" && c[1].body.estado === "ok")).toBe(true));
  });

  it("Estilo: Sugerir abre a sugestão no centro; Aplicar grava a base com as probabilidades e oferece o Desfazer", async () => {
    const sugestao = sugestaoDaBase(BASE_COMPLETA, probabilidadesDasRespostas({ produto: { probabilities: { p40: 0.7 } }, estilo_da_base: { probabilities: { "accessible-and-ethical": 0.5 } }, padrao: { probabilities: { "trust-authority-conversion": 0.4 } }, preset: { probabilities: { saas_limpo: 0.5 } } }), { tipo: "landing", kitTemFontes: true });
    mock.invoke.mockImplementation((_f: string, { body }: any) => {
      if (body.acao === "base_sugerir") return Promise.resolve({ data: { sugestao, pares_info: [], probabilidades: { produto: { p40: 0.7 } }, sem_jev: false, kit_tem_fontes: true, aviso: null, custo_usd: 0.0009 }, error: null });
      if (body.acao === "base_salvar") return Promise.resolve({ data: { site: site(), anterior: { base_de_design: null, estilo: {}, dna: {} }, custo_usd: 0 }, error: null });
      return Promise.resolve({ data: {}, error: null });
    });
    const PresetsDeEstilo = (await import("@/components/mesa-site/PresetsDeEstilo")).default;
    montar(h(PresetsDeEstilo, { site: site({ etapa: "direcao" }), preset: null, onPreset: vi.fn() }));
    fireEvent.click(document.querySelector("[data-sugerir-base]") as HTMLElement);
    await waitFor(() => expect(document.querySelector('[data-grupo-da-sugestao="estilo"]')).not.toBeNull(), { timeout: 20_000 });
    expect(screen.getByText("A marca já tem fontes: a base não sugere outras.")).toBeTruthy();
    fireEvent.click(document.querySelector("[data-aplicar-base]") as HTMLElement);
    await waitFor(() => expect(mock.invoke.mock.calls.some((c: any[]) => c[1].body.acao === "base_salvar")).toBe(true));
    const enviado = mock.invoke.mock.calls.filter((c: any[]) => c[1].body.acao === "base_salvar")[0][1].body;
    expect(enviado).toMatchObject({ site_id: SITE, produto: "40", estilo: "accessible-and-ethical", padrao: "trust-authority-conversion", origem: "jev", aplicar_preset: true });
    expect(enviado.sugestao.probabilidades.produto.p40).toBe(0.7);
    await waitFor(() => expect(mock.sucesso).toHaveBeenCalled());
    expect(mock.sucesso.mock.calls[0][1].action.label).toBe("Desfazer");
  }, 30_000);

  it("a conversa do diretor mostra a base citada", () => {
    render(h(BaseCitada, { anexos: [{ tipo: "base_citada", itens: [{ id: "uupm:ux:99", rotulo: "regra de UX 99: sensibilidade a movimento" }] }] }));
    expect(document.querySelector("[data-base-citada]")!.textContent).toMatch(/Base: regra de UX 99/);
  });
});
