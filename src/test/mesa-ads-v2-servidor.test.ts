import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  alertaDePolitica,
  anguloAprovado,
  aplicarConferenciaNoPacote,
  extrairCopyDoRaw,
  idDoYoutube,
  imagensDoBehance,
  imagensDoReadme,
  LIMIARES_APROVACAO,
  LIMIARES_SINAL,
  lerMetaTags,
  markdownDoPacote,
  motivosDoAngulo,
  normalizarPacoteCopy,
  notaDe0a10,
  origemDoLink,
  pontuacaoDoAngulo,
  repoDoGithub,
  separarAngulos,
  serieDiaria,
  sinalDoAnuncio,
  somarMetricas,
  tendenciaDoAnuncio,
  textosDoPacote,
  tipoDoLink,
  urlPublicaSegura,
  type Diaria,
  type NotasAngulo,
} from "../../supabase/functions/mesa-ads/calculos";
import { FILE_FOLDER_DEFINITIONS } from "../lib/fileTaxonomy";

/**
 * Mesa Ads v2, frente A (docs/mesa-ads/v2/CONTRATO-V2.md): as regras em
 * código (calculos.ts) executando de verdade e os contratos das ações novas
 * conferidos pelo código-fonte da função mesa-ads.
 */
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const fonte = ler("supabase/functions/mesa-ads/index.ts");
const calculos = ler("supabase/functions/mesa-ads/calculos.ts");
const conhecimento = ler("supabase/functions/_shared/conhecimento-ads.ts");
const sql = ler("docs/mesa-ads/v2/migrations/01_mesa_ads_v2.sql");
const corpoDe = (texto: string, nome: string) => {
  const i = texto.indexOf(`function ${nome}(`);
  expect(i, `function ${nome} existe`).toBeGreaterThanOrEqual(0);
  const j = texto.indexOf("\nasync function ", i + 10);
  const k = texto.indexOf("\nfunction ", i + 10);
  const l = texto.indexOf("\nconst ACOES", i + 10);
  const fim = [j, k, l].filter((x) => x > 0).sort((a, b) => a - b)[0];
  return texto.slice(i, fim);
};

const notas = (o: Partial<NotasAngulo> = {}): NotasAngulo => ({
  clareza: 8,
  relevancia: 8,
  prova: 5,
  risco_politica: 10,
  parada: 7,
  diferenciacao: 7,
  alerta_politica: false,
  ...o,
});

const dia = (d: string, o: Partial<Diaria> = {}): Diaria => ({
  ad_id: "1",
  day: d,
  spend: 10,
  impressions: 1000,
  clicks: 20,
  link_clicks: 12,
  frequency: 1.2,
  actions: [],
  ...o,
});

describe("notas do Jev (10 = melhor, inclusive risco de política)", () => {
  it("converte o nível bruto em 0 a 10 e o alerta vale nos níveis 0 e 1", () => {
    expect(notaDe0a10(4, 5)).toBe(10);
    expect(notaDe0a10(2, 5)).toBe(5);
    expect(notaDe0a10(null, 5)).toBeNull();
    expect(alertaDePolitica(0)).toBe(true);
    expect(alertaDePolitica(1.9)).toBe(true);
    expect(alertaDePolitica(2)).toBe(false);
    expect(alertaDePolitica(null)).toBe(false);
  });
  it("NIVEIS_RISCO_POLITICA vai do pior (viola) ao melhor (sem risco)", () => {
    const bloco = conhecimento.slice(conhecimento.indexOf("export const NIVEIS_RISCO_POLITICA"));
    expect(bloco.indexOf("Viola")).toBeLessThan(bloco.indexOf("Sem risco aparente"));
  });
});

describe("aprovação do ângulo (regra em código)", () => {
  it("usa os limiares do contrato corrigido pelo coordenador", () => {
    expect(LIMIARES_APROVACAO).toEqual({ clareza_min: 7, relevancia_min: 7, parada_min: 6, diferenciacao_min: 6, risco_politica_min: 7 });
  });
  it("aprova só com todas as notas no limite e sem alerta", () => {
    expect(anguloAprovado(notas())).toBe(true);
    expect(anguloAprovado(notas({ clareza: 7, relevancia: 7, parada: 6, diferenciacao: 6, risco_politica: 7 }))).toBe(true);
    expect(anguloAprovado(notas({ clareza: 6.9 }))).toBe(false);
    expect(anguloAprovado(notas({ parada: 5.9 }))).toBe(false);
    expect(anguloAprovado(notas({ diferenciacao: 5 }))).toBe(false);
    expect(anguloAprovado(notas({ risco_politica: 6.9 }))).toBe(false);
    expect(anguloAprovado(notas({ alerta_politica: true }))).toBe(false);
    expect(anguloAprovado(null)).toBe(false);
  });
  it("nota ausente reprova e os motivos dizem o porquê, sem travessão", () => {
    const m = motivosDoAngulo(notas({ parada: null, risco_politica: 5, relevancia: 6 }));
    expect(m).toContain("Sem nota de poder de parar a rolagem.");
    expect(m.some((x) => x.startsWith("Risco de política: nota 5"))).toBe(true);
    expect(m.some((x) => x.startsWith("Relevância 6"))).toBe(true);
    for (const x of m) expect(x).not.toMatch(/[\u2014\u2013]/);
    expect(motivosDoAngulo(null)).toEqual(["Sem nota do Jev."]);
  });
  it("pontuação: risco entra como qualidade e alerta corta pela metade", () => {
    const seguro = pontuacaoDoAngulo(notas({ risco_politica: 10 }))!;
    const arriscado = pontuacaoDoAngulo(notas({ risco_politica: 2 }))!;
    expect(seguro).toBeGreaterThan(arriscado);
    expect(pontuacaoDoAngulo(notas({ alerta_politica: true }))).toBeCloseTo(seguro / 2, 0);
    expect(pontuacaoDoAngulo(notas({ clareza: 10, relevancia: 10, prova: 10, parada: 10, diferenciacao: 10 }))).toBe(10);
    expect(pontuacaoDoAngulo(null)).toBeNull();
  });
  it("separa: com 3 aprovados, reprovado vai para os descartados", () => {
    const a = (id: string, aprovado: boolean, pontuacao: number) => ({ id, aprovado, pontuacao });
    const r = separarAngulos([a("a1", true, 7), a("a2", false, 9), a("a3", true, 8), a("a4", true, 6)]);
    expect(r.principais.map((x) => x.id)).toEqual(["a3", "a1", "a4"]);
    expect(r.descartados.map((x) => x.id)).toEqual(["a2"]);
    expect(r.principais.some((x) => x.reprovado)).toBe(false);
  });
  it("separa: com menos de 3 aprovados, os melhores reprovados completam marcados", () => {
    const a = (id: string, aprovado: boolean, pontuacao: number | null) => ({ id, aprovado, pontuacao });
    const r = separarAngulos([a("a1", false, 5), a("a2", true, 8), a("a3", false, 6), a("a4", false, null)]);
    expect(r.principais.map((x) => x.id)).toEqual(["a2", "a3", "a1"]);
    expect(r.principais.filter((x) => x.reprovado).map((x) => x.id)).toEqual(["a3", "a1"]);
    expect(r.descartados.map((x) => x.id)).toEqual(["a4"]);
  });
  it("separa com máximo: aprovado além do pedido fica de reserva nos descartados", () => {
    const a = (id: string, aprovado: boolean, pontuacao: number) => ({ id, aprovado, pontuacao });
    const r = separarAngulos([a("a1", true, 7), a("a2", true, 9), a("a3", true, 8), a("a4", true, 6), a("a5", false, 5)], 3, 3);
    expect(r.principais.map((x) => x.id)).toEqual(["a2", "a3", "a1"]);
    expect(r.descartados.map((x) => x.id)).toEqual(["a4", "a5"]);
    expect((r.descartados[0] as { motivos?: string[] }).motivos?.[0]).toContain("reserva");
  });
});

describe("conta ao vivo: tendência e sinal em código", () => {
  it("tendência compara a segunda metade com a primeira", () => {
    const linhas = ["01", "02", "03", "04"].map((d, i) => dia(`2026-09-${d}`, {
      link_clicks: i < 2 ? 20 : 10,
      spend: i < 2 ? 10 : 15,
      frequency: i < 2 ? 1.5 : 3.2,
      actions: [{ action_type: "lead", value: "2" }],
    }));
    const t = tendenciaDoAnuncio(linhas);
    expect(t.ctr_var_pct).toBe(-50);
    expect(t.custo_resultado_var_pct).toBe(50);
    expect(t.frequencia).toBe(3.2);
    expect(tendenciaDoAnuncio(linhas.slice(0, 3)).ctr_var_pct).toBeNull();
  });
  const sem = { ctr_var_pct: null, custo_resultado_var_pct: null, frequencia: null };
  it("sem volume ou sem gasto: sem_dados", () => {
    expect(sinalDoAnuncio(somarMetricas([dia("2026-09-01", { impressions: 500 })]), sem, 10)).toBe("sem_dados");
    expect(sinalDoAnuncio(somarMetricas([dia("2026-09-01", { spend: 0 })]), sem, 10)).toBe("sem_dados");
  });
  it("gastou demais sem resultado: pausar; pouco gasto sem resultado: observar", () => {
    expect(sinalDoAnuncio(somarMetricas([dia("2026-09-01", { spend: 25 })]), sem, 10)).toBe("pausar");
    expect(sinalDoAnuncio(somarMetricas([dia("2026-09-01", { spend: 5 })]), sem, 10)).toBe("observar");
    expect(sinalDoAnuncio(somarMetricas([dia("2026-09-01", { impressions: 6000 })]), sem, null)).toBe("pausar");
  });
  it("custo por resultado acima de 2 vezes a referência: pausar", () => {
    const m = somarMetricas([dia("2026-09-01", { spend: 50, actions: [{ action_type: "lead", value: "2" }] })]);
    expect(sinalDoAnuncio(m, sem, 10)).toBe("pausar");
  });
  it("frequência alta com CTR caindo: renovar", () => {
    const m = somarMetricas([dia("2026-09-01", { frequency: 3.5, actions: [{ action_type: "lead", value: "2" }] })]);
    expect(sinalDoAnuncio(m, { ctr_var_pct: -25, custo_resultado_var_pct: 5, frequencia: 3.5 }, 10)).toBe("renovar");
  });
  it("barato, com volume e frequência baixa: escalar; sem referência nunca escala", () => {
    const m = somarMetricas([dia("2026-09-01", { spend: 20, actions: [{ action_type: "onsite_conversion.messaging_conversation_started_7d", value: "5" }] })]);
    expect(sinalDoAnuncio(m, sem, 10)).toBe("escalar");
    expect(sinalDoAnuncio(m, sem, null)).toBe("manter");
    expect(sinalDoAnuncio(m, { ...sem, custo_resultado_var_pct: 30 }, 10)).toBe("observar");
  });
  it("limiares à vista", () => {
    expect(LIMIARES_SINAL.folga_para_escalar).toBe(0.8);
    expect(LIMIARES_SINAL.custo_para_pausar).toBe(2);
  });
  it("série diária soma por dia com CTR de saída", () => {
    const s = serieDiaria([dia("2026-09-02"), dia("2026-09-01"), dia("2026-09-01", { ad_id: "2" })]);
    expect(s.map((x) => x.dia)).toEqual(["2026-09-01", "2026-09-02"]);
    expect(s[0]).toMatchObject({ gasto: 20, impressoes: 2000, cliques: 24, ctr: 1.2 });
  });
});

describe("anúncio da Meta: copy, CTA e destino do raw", () => {
  it("link_data", () => {
    const c = extrairCopyDoRaw({
      creative: {
        image_url: "https://scontent.example.com/a.jpg",
        object_story_spec: { link_data: { message: "Texto", name: "Título", description: "Desc", link: "https://site.com", call_to_action: { type: "LEARN_MORE" } } },
      },
    });
    expect(c).toMatchObject({ titulo: "Título", corpo: "Texto", descricao: "Desc", cta: "Saiba mais", destino: "https://site.com", imagem_url: "https://scontent.example.com/a.jpg" });
  });
  it("vídeo, WhatsApp sem link e colunas como reserva", () => {
    const c = extrairCopyDoRaw(
      { creative: { object_story_spec: { video_data: { message: "Fala", title: "Vídeo", call_to_action: { type: "WHATSAPP_MESSAGE", value: { app_destination: "WHATSAPP" } } } } } },
      { thumbnail_url: "https://x.com/t.jpg" },
    );
    expect(c).toMatchObject({ titulo: "Vídeo", corpo: "Fala", cta: "Enviar mensagem pelo WhatsApp", destino: "WhatsApp", miniatura_url: "https://x.com/t.jpg" });
  });
  it("asset_feed_spec (dinâmico) e raw vazio", () => {
    const c = extrairCopyDoRaw({ creative: { asset_feed_spec: { bodies: [{ text: "B1" }], titles: [{ text: "T1" }], call_to_action_types: ["SHOP_NOW"], link_urls: [{ website_url: "https://loja.com" }] } } });
    expect(c).toMatchObject({ titulo: "T1", corpo: "B1", cta: "Comprar agora", destino: "https://loja.com" });
    expect(extrairCopyDoRaw(null, { titulo: "Coluna" }).titulo).toBe("Coluna");
    expect(extrairCopyDoRaw(undefined).cta).toBeNull();
  });
});

describe("links das referências: busca segura e leitura", () => {
  it("só https público", () => {
    expect(urlPublicaSegura("https://www.behance.net/gallery/1/x")).not.toBeNull();
    for (const ruim of [
      "http://site.com",
      "https://localhost/x",
      "https://127.0.0.1/",
      "https://10.0.0.5/",
      "https://169.254.169.254/latest",
      "https://192.168.0.1/",
      "https://172.16.3.1/",
      "https://[::1]/",
      "https://site.com:8443/",
      "https://user:senha@site.com/",
      "https://intranet/",
      "https://servico.internal/",
      "ftp://site.com",
      "javascript:alert(1)",
    ]) {
      expect(urlPublicaSegura(ruim), ruim).toBeNull();
    }
  });
  it("tipo, origem, YouTube e GitHub", () => {
    const u = (x: string) => new URL(x);
    expect(tipoDoLink(u("https://youtu.be/dQw4w9WgXcQ"))).toBe("youtube");
    expect(tipoDoLink(u("https://github.com/a/b"))).toBe("github");
    expect(tipoDoLink(u("https://www.behance.net/gallery/1/x"))).toBe("behance");
    expect(tipoDoLink(u("https://mir-s3-cdn-cf.behance.net/project_modules/fs/a.jpg"))).toBe("imagem");
    expect(tipoDoLink(u("https://br.pinterest.com/pin/1"))).toBe("pinterest");
    expect(tipoDoLink(u("https://open.spotify.com/track/1"))).toBe("spotify");
    expect(tipoDoLink(u("https://site.com/foto.webp"))).toBe("imagem");
    expect(origemDoLink(u("https://www.instagram.com/p/x"))).toBe("instagram");
    expect(origemDoLink(u("https://site.com/"))).toBe("url");
    expect(idDoYoutube(u("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1"))).toBe("dQw4w9WgXcQ");
    expect(idDoYoutube(u("https://youtube.com/shorts/dQw4w9WgXcQ"))).toBe("dQw4w9WgXcQ");
    expect(idDoYoutube(u("https://youtu.be/curto"))).toBeNull();
    expect(repoDoGithub(u("https://github.com/remotion-dev/remotion.git"))).toEqual({ dono: "remotion-dev", repo: "remotion" });
    expect(repoDoGithub(u("https://github.com/topics/ads"))).toBeNull();
  });
  it("og:tags em qualquer ordem, com entidades e caminho relativo", () => {
    const m = lerMetaTags(
      `<html><head><title>Reserva &amp; cia</title><meta content="Desc &quot;boa&quot;" property="og:description"><meta property='og:image' content='/capa.jpg'><meta name="twitter:image" content="https://cdn.x.com/t.png"></head></html>`,
      "https://site.com/pagina",
    );
    expect(m.titulo).toBe("Reserva & cia");
    expect(m.descricao).toBe("Desc \"boa\"");
    expect(m.imagens).toEqual(["https://site.com/capa.jpg", "https://cdn.x.com/t.png"]);
  });
  it("Behance: maior tamanho de cada módulo, sem repetir, inclusive com barra escapada", () => {
    const html = `"https:\\/\\/mir-s3-cdn-cf.behance.net\\/project_modules\\/disp\\/abc.jpg" <img src="https://mir-s3-cdn-cf.behance.net/project_modules/max_1200/abc.jpg"> <img src="https://mir-s3-cdn-cf.behance.net/project_modules/fs/def.png">`;
    expect(imagensDoBehance(html)).toEqual([
      "https://mir-s3-cdn-cf.behance.net/project_modules/max_1200/abc.jpg",
      "https://mir-s3-cdn-cf.behance.net/project_modules/fs/def.png",
    ]);
  });
  it("README: relativo vira raw, selo e SVG ficam de fora", () => {
    const md = "![logo](docs/tela.png) ![build](https://img.shields.io/badge/x.svg) <img src=\"https://site.com/a.jpg\">";
    expect(imagensDoReadme(md, "dono", "repo")).toEqual(["https://raw.githubusercontent.com/dono/repo/HEAD/docs/tela.png", "https://site.com/a.jpg"]);
  });
});

describe("pacote de copy (limites em código)", () => {
  const bruto = {
    textos_principais: [
      { estilo: "curto", texto: "Curto \u2014 com travessão" },
      { estilo: "curto", texto: "Curto \u2014 com travessão" },
      { estilo: "inventado", texto: "Médio" },
    ],
    titulos: ["Título curto", "Um título muito comprido que passa de quarenta caracteres fácil", "título curto"],
    descricoes: ["Descrição que passa de trinta caracteres"],
    ctas: [{ cta: "Saiba mais", porque: "a" }, { cta: "Botão falso", porque: "b" }, { cta: "Saiba mais", porque: "c" }],
    ganchos: ["G1"],
    gestor: { objetivo_meta: "x", evento_otimizacao: "y", publico_sugerido: "p", conjuntos: ["c1"], utm: "utm_source=meta", regras_de_corte: ["r"], regras_de_escala: ["e"], verba: null },
  };
  it("corta, tira repetido e CTA fora da lista, e avisa o que faltou sem inventar", () => {
    const { pacote, avisos } = normalizarPacoteCopy(bruto, ["Saiba mais", "Enviar mensagem"]);
    expect(pacote.textos_principais).toEqual([{ estilo: "curto", texto: "Curto, com travessão" }, { estilo: "medio", texto: "Médio" }]);
    expect(pacote.titulos.length).toBe(2);
    for (const t of pacote.titulos) expect(t.length).toBeLessThanOrEqual(40);
    for (const d of pacote.descricoes) expect(d.length).toBeLessThanOrEqual(30);
    expect(pacote.ctas).toEqual([{ cta: "Saiba mais", porque: "a" }]);
    expect(avisos.some((a) => a.includes("títulos (o pedido era 8)"))).toBe(true);
    expect(avisos.some((a) => a.includes("cortado"))).toBe(true);
  });
  it("conferência: troca o reescrito e tira o que continuou com alerta", () => {
    const { pacote } = normalizarPacoteCopy(bruto, ["Saiba mais"]);
    const lista = textosDoPacote(pacote);
    expect(lista[0]).toEqual({ campo: "texto_principal", indice: 0, texto: "Curto, com travessão" });
    const final = aplicarConferenciaNoPacote(pacote, new Map([["titulo:0", "Novo título seguro"]]), new Set(["texto_principal:1"]));
    expect(final.titulos[0]).toBe("Novo título seguro");
    expect(final.textos_principais.map((t) => t.texto)).toEqual(["Curto, com travessão"]);
  });
  it("Markdown do gestor sem travessão e com as seções", () => {
    const { pacote } = normalizarPacoteCopy(bruto, ["Saiba mais"]);
    const md = markdownDoPacote({
      cliente: "Cliente X",
      plano: "Plano \u2014 1",
      gerado_em: "2026-09-24T12:00:00.000Z",
      objetivo: { nome: "Mensagens", objetivo_meta: "Engajamento", evento_otimizacao: "Conversas", metrica_que_decide: "Custo por conversa" },
      oferta: { nome: "Oferta", promessa: "Promessa" },
      destino: "whatsapp",
      verba_diaria_brl: null,
      criativos: [
        { nome: "A | V1 | feed_4x5", formato: "feed_4x5", angulo: "A", hipotese: "H", arte: "Ainda no Estúdio (dirigido).", copy: {}, pacote },
        { nome: "B", formato: "stories_9x16", angulo: null, hipotese: null, arte: "Sem arte no Estúdio.", copy: { texto_principal: "T", titulo: "Ti", cta_meta: "Saiba mais" }, pacote: null },
      ],
    });
    expect(md).not.toMatch(/[\u2014\u2013]/);
    expect(md).toContain("# Pacote do gestor de tráfego: Cliente X");
    expect(md).toContain("**Títulos (até 40 caracteres)**");
    expect(md).toContain("não informada (definir com o dono)");
    expect(md).toContain("pacote completo ainda não gerado");
  });
});

describe("contratos das ações novas (fonte da função)", () => {
  it("conta_ao_vivo é grátis, sem IA, e o sinal vem do código", () => {
    const c = corpoDe(fonte, "lerContaAoVivo");
    expect(c).not.toContain("chamarTexto");
    expect(c).not.toContain("jevPerguntar");
    expect(c).toContain("sinal: sinalDoAnuncio(metricas, tendencia, custoReferencia)");
    expect(c).toContain("tendencia,");
    expect(c).toContain("referencia_id: ref?.id ?? null");
    expect(corpoDe(fonte, "contaAoVivo")).toContain("custo_usd: 0");
  });
  it("conta_sincronizar chama collect_ads_now com o JWT de quem chamou", () => {
    const c = corpoDe(fonte, "contaSincronizar");
    expect(c).toContain('clienteDoChamador(chamador.token).rpc("collect_ads_now")');
    expect(c).not.toContain('servico.rpc("collect_ads_now")');
  });
  it("conta_analisar: números do código, escalar só com resultado e grava em ads_analises", () => {
    const c = corpoDe(fonte, "contaAnalisar");
    expect(c).toContain("use SÓ estes números");
    expect(c).toContain("metricas.resultados ?? 0) > 0");
    expect(c).toContain('.from("ads_analises")');
    expect(c).toContain("analise_id:");
  });
  it("plano_gerar: escreve a mais, uma conferência só, entrega os melhores (sem laço de correção)", () => {
    const p = corpoDe(fonte, "planoGerar");
    expect(p).toContain("rodadas < MAX_RODADAS_QUALIDADE");
    expect(p).toContain("restanteMs(chamador) < TEMPO_DE_UMA_RODADA_MS");
    expect(p).toContain("esquemaJson: ESQUEMA_ANGULOS_REESCRITOS");
    expect(p).toContain("separarAngulos(angulos, 3, qtd)");
    expect(p).toContain("const qtdGerar = Math.min(8, qtd + ANGULOS_EXTRAS);");
    expect(p).toContain('.from("ads_planos").insert({');
    expect(p).toContain(".upsert({");
    expect(p).toContain("descartados,");
    expect(p).toContain("qualidade,");
    expect(p).toContain('corpo.modo === "variar_vencedor"');
    expect(p).toContain("carregarOferta(servico, clientId, corpo.oferta_id)");
    const j = corpoDe(fonte, "pontuarAngulosComJev");
    expect(j).toContain("criteria: NIVEIS_PARADA");
    expect(j).toContain("criteria: NIVEIS_DIFERENCIACAO");
    expect(j).toContain("risco_politica: notaDe0a10(risco, NIVEIS_RISCO_POLITICA.length)");
    expect(fonte).toContain("const MAX_RODADAS_QUALIDADE = 0;");
    expect(fonte).toContain("const TIMEOUT_TEXTO_ADS_MS = 300_000;");
    expect(fonte).toContain("const LIMITE_FUNCAO_MS = 400_000;");
  });
  it("só o nicho do cliente vai para o prompt, escolhido pelo Jev (Choice)", () => {
    const n = corpoDe(fonte, "nichoDoCliente");
    expect(n).toContain('type: "choice"');
    expect(n).toContain("CONFIANCA_MINIMA_NICHO");
    expect(fonte).not.toContain("JSON.stringify(NICHOS)");
    expect(corpoDe(fonte, "planoGerar")).toContain("textoDoNicho(achado.nicho)");
  });
  it("oferta_conversar: Jev antes de responder, reescrita única do alerta e ads_ofertas", () => {
    const o = corpoDe(fonte, "ofertaConversar");
    expect(o).toContain("await conferirOfertasComJev(novas, briefing, cobranca)");
    expect(o).toContain("esquemaJson: ESQUEMA_OFERTAS_REESCRITAS");
    expect(o).toContain('.from("ads_ofertas")');
    expect(o).toContain("referencia_tipo: REF_OFERTA");
    expect(corpoDe(fonte, "conferirOfertasComJev")).toContain("criteria: NIVEIS_FORCA_OFERTA");
    const s = corpoDe(fonte, "ofertaSalvar");
    expect(s).not.toContain("chamarTexto");
    expect(s).toContain("update.jev = null;");
  });
  it("referencia_abrir e importar_url não chamam IA; busca é segura a cada salto", () => {
    for (const nome of ["referenciaAbrir", "referenciaImportarUrl", "abrirLink", "abrirAnuncioProprio", "enriquecerLink"]) {
      expect(corpoDe(fonte, nome), nome).not.toContain("chamarTexto");
    }
    const b = corpoDe(fonte, "buscarSeguro");
    expect(b).toContain('redirect: "manual"');
    expect(b).toContain("urlPublicaSegura(new URL(destino, url).toString())");
    expect(b).toContain("hostResolvePublico(url.hostname)");
    expect(fonte).toContain("https://i.ytimg.com/vi/${id}/hqdefault.jpg");
    expect(fonte).toContain("application/vnd.github.raw");
    expect(fonte).toContain("`${clientId}/ads-proprios/${idSeguro(adId)}`");
    expect(fonte).toContain("`biblioteca/${ref.id}`");
    expect(fonte).toContain("const URL_ASSINADA_S = 3600;");
    expect(fonte).toContain("const MAX_IMAGENS_REFERENCIA = 12;");
  });
  it("referencia_ler aceita a biblioteca da agência e não mexe na evidência", () => {
    const r = corpoDe(fonte, "referenciaLer");
    expect(r).not.toContain("biblioteca_somente_leitura");
    expect(r).not.toMatch(/evidencia:/);
    expect(corpoDe(fonte, "gravarReferencia")).toContain('q.is("client_id", null)');
  });
  it("copy_pacote: Jev de política numa conferência, campos da Meta do código e pendentes", () => {
    const g = corpoDe(fonte, "gerarPacoteDoCriativo");
    expect(g).toContain("normalizarPacoteCopy(s.json, CTAS_META)");
    expect(g).toContain("objetivo_meta: ctx.objetivo.objetivo_meta");
    expect(g).toContain("if (verba == null) pacote.gestor = { ...pacote.gestor, verba: null };");
    expect(g).toContain("await conferirPoliticaComJev(lista.map(");
    expect(g).toContain("aplicarConferenciaNoPacote(pacote, trocas, remover)");
    const c = corpoDe(fonte, "copyPacote");
    expect(c).toContain("copy: { ...c.copy, pacote: registro }");
    expect(c).toContain("pendentes.push(");
    expect(c).toContain("restanteMs(chamador) < TEMPO_DE_UMA_RODADA_MS");
  });
  it("pacote_enviar grava em Arquivos (criativos) como quem chamou e a tarefa vai para o tráfego", () => {
    const p = corpoDe(fonte, "pacoteEnviar");
    expect(p).toContain('doChamador.rpc("create_file_record"');
    expect(p).toContain('folder: "criativos"');
    expect(p).toContain('file_type: "outro"');
    expect(p).toContain('storage.from("files")');
    const criativos = FILE_FOLDER_DEFINITIONS.find((f) => f.id === "criativos")!;
    expect(criativos.kinds).toContain("outro");
    expect(criativos.kinds).not.toContain("documento");
    const t = corpoDe(fonte, "criarTarefaDoGestor");
    expect(t).toContain('.from("team_client_assignments")');
    expect(t).toContain('.eq("role", "traffic")');
    expect(t).toContain('delivery_type: "traffic"');
    expect(t).toContain("tarefa_id: null");
  });
  it("criativos saem com estilo visual, objetivo e o conhecimento agressivo, sem escurecer a foto", () => {
    const d = corpoDe(fonte, "direcaoDoAnuncio");
    expect(d).toContain("CONHECIMENTO_AGRESSIVO");
    expect(d).toContain("Nunca escurecer a foto");
    expect(d).toContain("estilo_visual: info.estilo");
    expect(corpoDe(fonte, "criativosProduzir")).toContain("estilo: estiloDaVariacao ?");
  });
  it("chave do Jev só no helper do servidor e nenhum travessão no código novo", () => {
    expect(fonte).not.toContain("TYPESAFE_API_KEY");
    expect(fonte).not.toMatch(/[\u2014\u2013]/);
    expect(calculos).not.toMatch(/[\u2014\u2013]/);
    expect(sql).not.toMatch(/[\u2014\u2013]/);
    expect(calculos).not.toMatch(/import .*ia-motor|import .*jev/);
  });
  it("o relógio de 400 s começa quando a requisição chega", () => {
    expect(fonte).toContain("const chamador = await identificar(req, servico, inicioMs);");
    expect(corpoDe(fonte, "identificar")).toContain("return { userId, token, inicioMs };");
  });
});

describe("SQL da v2", () => {
  it("cria ads_ofertas e ads_analises com RLS da equipe, idempotente", () => {
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.ads_ofertas");
    expect(sql).toContain("CHECK (status IN ('rascunho', 'escolhida', 'arquivada'))");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.ads_analises");
    expect(sql).toContain("ALTER TABLE public.ads_ofertas ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain("ALTER TABLE public.ads_analises ENABLE ROW LEVEL SECURITY;");
    expect(sql).toContain("USING (public.is_staff((select auth.uid())) AND public.can_access_client(client_id));");
    expect(sql).toMatch(/DROP POLICY IF EXISTS ads_ofertas_equipe_le/);
  });
  it("referências aceitam origem 'padrao' e 'url'", () => {
    expect(sql).toContain("DROP CONSTRAINT IF EXISTS ads_referencias_origem_check");
    expect(sql).toContain("'padrao', 'url'");
  });
});

describe("referência do Behance (página bloqueia servidor)", () => {
  it("usa o oEmbed oficial e aceita links de imagem colados pela equipe", () => {
    expect(fonte).toContain("https://www.behance.net/services/oembed?url=");
    expect(fonte).toContain("const AVISO_BEHANCE =");
    expect(fonte).toContain("imagensColadas(corpo.imagens_urls)");
    expect(fonte).toContain("/project_modules/max_1200/");
  });
  it("a janela da referência oferece Adicionar imagens", () => {
    const janela = ler("src/components/mesa-ads/JanelaDaReferencia.tsx");
    expect(janela).toContain("imagens_urls: links");
    expect(janela).toContain("Adicionar imagens");
  });
});
