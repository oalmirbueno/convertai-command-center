import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  decidirVinculos,
  dHashDeCinzas,
  distanciaDasImpressoes,
  pecasDosAnuncios,
  similaridade,
  sinaisDoPar,
  slug,
  textosDoCriativo,
  utmContent,
  type AnuncioParaVinculo,
  type CriativoParaVinculo,
} from "../../supabase/functions/mesa-ads/vinculo";
import { chaveDaPeca } from "../../supabase/functions/mesa-ads/calculos";
import { anunciosDaBiblioteca, estrategiaEmMarkdown, normalizarEstrategia, tarefaDoAgenteSenior } from "../../supabase/functions/mesa-ads/agente-senior";
import { MAX_CRIATIVOS_IMPORTADOS, validarRetorno } from "../../supabase/functions/mesa-ads/pacote-retorno";
import { GRUPOS_DE_OBJETIVO, grupoDoTipo, mixDeObjetivos } from "../../supabase/functions/_shared/evolucao";
import { ESTRATEGIA_SENIOR_DE_CONTA } from "../../supabase/functions/_shared/conhecimento-especialistas-ads";
import { GRUPOS_DE_OBJETIVO as GRUPOS_DA_TELA } from "@/components/mesa-ads/resultadosApi";

/**
 * Mesa Ads v5 (pedido do dono em 26/09/2026), servidor: vínculo automático
 * anúncio x criativo, peça, mix de objetivos, agente sênior, Biblioteca de
 * Anúncios sem token na resposta e o contrato do retorno do agente externo.
 */

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8").replace(/\r\n/g, "\n");
const fonte = ler("supabase/functions/mesa-ads/index.ts");
const TRAVESSAO = new RegExp("[" + String.fromCharCode(0x2013, 0x2014) + "]");

const ad = (o: Partial<AnuncioParaVinculo> & { ad_id: string }): AnuncioParaVinculo => ({
  nome: null, titulo: null, corpo: null, destino: null, campanha: null, primeiro_dia: "2026-09-10", gasto: 100, status: "ACTIVE", peca: null, impressao: null, imagem_url: null, ...o,
});
const cr = (o: Partial<CriativoParaVinculo> & { id: string }): CriativoParaVinculo => ({
  nome: null, textos: [], titulos: [], criado_em: "2026-09-01T10:00:00Z", plano: null, angulo: null, ad_id: null, impressao: null, nome_do_anuncio: null, ...o,
});
const ID1 = "aaaaaaaa-1111-4111-8111-111111111111";
const ID2 = "bbbbbbbb-2222-4222-8222-222222222222";

describe("vínculo automático: sinais em código", () => {
  it("texto, similaridade, slug e utm_content", () => {
    expect(similaridade("Agende sua avaliação pelo WhatsApp hoje", "agende sua AVALIACAO pelo whatsapp hoje!")).toBe(1);
    expect(similaridade("clareamento dental", "pizza de calabresa")).toBe(0);
    expect(slug("Ângulo Prova | V1 | feed_4x5")).toBe("angulo-prova-v1-feed-4x5");
    expect(utmContent("https://site.com/?utm_source=meta&utm_content=01-angulo-prova-v1-feed-4x5-4x5&x=1")).toBe("01-angulo-prova-v1-feed-4x5-4x5");
    expect(utmContent("https://wa.me/55")).toBeNull();
  });

  it("impressão digital: dHash de 9x8 cinzas e distância de Hamming", () => {
    const cinzas = Array.from({ length: 72 }, (_, i) => (i % 9) * 10);
    const h = dHashDeCinzas(cinzas);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(h).toBe("0000000000000000");
    const invertido = dHashDeCinzas(Array.from({ length: 72 }, (_, i) => 100 - (i % 9) * 10));
    expect(invertido).toBe("ffffffffffffffff");
    expect(distanciaDasImpressoes(h, invertido)).toBe(64);
    expect(distanciaDasImpressoes(h, h)).toBe(0);
    expect(distanciaDasImpressoes(h, null)).toBeNull();
    expect(dHashDeCinzas([1, 2, 3])).toBeNull();
  });

  it("mesma imagem liga sozinho; imagem diferente desconta; anúncio que rodou antes do criativo não pode ser dele", () => {
    const mesma = sinaisDoPar(ad({ ad_id: "1", impressao: "00ff00ff00ff00ff" }), cr({ id: ID1, impressao: "00ff00ff00ff00fe" }));
    expect(mesma.confianca).toBeGreaterThanOrEqual(0.8);
    expect(mesma.sinais.map((s) => s.tipo)).toContain("imagem");
    const diferente = sinaisDoPar(ad({ ad_id: "1", impressao: "0000000000000000", corpo: "Agende sua avaliação" }), cr({ id: ID1, impressao: "ffffffffffffffff", textos: ["Agende sua avaliação"] }));
    expect(diferente.sinais.map((s) => s.tipo)).toContain("imagem_diferente");
    expect(diferente.confianca).toBeLessThan(0.6);
    const antes = sinaisDoPar(ad({ ad_id: "1", primeiro_dia: "2026-08-01", impressao: "00ff00ff00ff00ff" }), cr({ id: ID1, impressao: "00ff00ff00ff00ff" }));
    expect(antes.impossivel).toBe(true);
    expect(antes.confianca).toBe(0);
    // Só a data não é sinal.
    expect(sinaisDoPar(ad({ ad_id: "1" }), cr({ id: ID1 })).confianca).toBe(0);
  });

  it("nome do anúncio do pacote do gestor e utm_content casam o criativo", () => {
    const c = cr({ id: ID1, nome: "Prova do resultado | V1 | feed_4x5", nome_do_anuncio: slug("Prova do resultado | V1 | feed_4x5") });
    const s = sinaisDoPar(ad({ ad_id: "9", nome: "03-prova-do-resultado-v1-feed-4x5-4x5" }), c);
    expect(s.sinais.map((x) => x.tipo)).toContain("nome");
    const u = sinaisDoPar(ad({ ad_id: "9", destino: "https://x.com/?utm_content=prova-do-resultado-v1-feed-4x5" }), c);
    expect(u.sinais.map((x) => x.tipo)).toContain("utm");
    expect(u.confianca).toBeGreaterThanOrEqual(0.8);
  });

  it("decisão: automático, incerto com rival perto, já ligado, recusado e um criativo por peça", () => {
    const ads = [
      ad({ ad_id: "10", peca: "hash:x", gasto: 50, impressao: "0f0f0f0f0f0f0f0f" }),
      ad({ ad_id: "11", peca: "hash:x", gasto: 150, impressao: "0f0f0f0f0f0f0f0f" }),
      ad({ ad_id: "20", peca: "hash:y", corpo: "Agende sua avaliação pelo WhatsApp com hora marcada", titulo: "Sem espera" }),
      ad({ ad_id: "30", peca: "hash:z" }),
    ];
    const criativos = [
      cr({ id: ID1, impressao: "0f0f0f0f0f0f0f0f" }),
      cr({ id: ID2, textos: ["Agende sua avaliação pelo WhatsApp com hora marcada"], titulos: ["Sem espera"] }),
      cr({ id: "cccccccc-3333-4333-8333-333333333333", textos: ["Agende sua avaliação pelo WhatsApp com hora marcada"], titulos: ["Sem espera"] }),
    ];
    const d = decidirVinculos(ads, criativos);
    const porPeca = (p: string) => d.filter((x) => x.peca === p)[0];
    // A peça junta os dois anúncios; o de maior gasto vai para ads_criativos.ad_id.
    expect(porPeca("hash:x")).toMatchObject({ estado: "automatico", criativo_id: ID1, ad_principal: "11", ad_ids: ["11", "10"] });
    // Dois criativos iguais para o mesmo anúncio: incerto (Jev ou equipe decide).
    expect(porPeca("hash:y").estado).toBe("incerto");
    expect(porPeca("hash:y").candidatos.length).toBe(2);
    expect(porPeca("hash:z").estado).toBe("sem_par");
    // Recusado não volta; ligado fica ligado.
    const d2 = decidirVinculos(ads, [criativos[0], { ...criativos[1], ad_id: "20" }], { recusados: new Set([`${ID1}|11`]) });
    expect(d2.filter((x) => x.peca === "hash:x")[0].estado).toBe("sem_par");
    expect(d2.filter((x) => x.peca === "hash:y")[0]).toMatchObject({ estado: "ligado", criativo_id: ID2 });
    expect(pecasDosAnuncios([ad({ ad_id: "1" }), ad({ ad_id: "2" })]).length).toBe(2);
  });

  it("textos e títulos do criativo vêm da copy e do pacote, sem repetir", () => {
    const t = textosDoCriativo({ texto_principal: "A", titulo: "T", pacote: { textos_principais: [{ texto: "A" }, { texto: "B" }], titulos: ["T", "U"] } });
    expect(t).toEqual({ textos: ["A", "B"], titulos: ["T", "U"] });
  });
});

describe("peça e objetivo em código", () => {
  it("chave da peça: hash da imagem, vídeo, id do criativo e URL sem assinatura", () => {
    expect(chaveDaPeca({ creative: { id: "c1", object_story_spec: { link_data: { image_hash: "abc" } } } })).toBe("hash:abc");
    expect(chaveDaPeca({ creative: { id: "c1", object_story_spec: { video_data: { video_id: "v9" } } } })).toBe("video:v9");
    expect(chaveDaPeca({ creative: { id: "c1" } })).toBe("criativo:c1");
    expect(chaveDaPeca(null, { image_url: "https://scontent.x/img.jpg?oh=1&oe=2" })).toBe("url:https://scontent.x/img.jpg");
    expect(chaveDaPeca(null, { ad_id: "77" })).toBe("ad:77");
  });

  it("grupo do objetivo pelo resultado e alerta de tudo em engajamento", () => {
    expect(grupoDoTipo("mensagens")).toBe("mensagem");
    expect(grupoDoTipo("cliques_link")).toBe("trafego");
    expect(grupoDoTipo("video")).toBe("engajamento");
    expect(grupoDoTipo(null)).toBeNull();
    const mix = mixDeObjetivos([
      { tipo: "engajamento", gasto: 800, resultados: 9000 },
      { tipo: "mensagens", gasto: 200, resultados: 40 },
    ]);
    expect(mix.total).toBe(1000);
    expect(mix.por_grupo[0]).toMatchObject({ grupo: "engajamento", pct: 80 });
    expect(mix.por_grupo[1]).toMatchObject({ grupo: "mensagem", pct: 20, custo_por_resultado: 5, resultado_rotulo: "Conversas iniciadas" });
    expect(mix.perto_da_venda_pct).toBe(20);
    expect(mix.alertas[0]).toMatch(/80% do investimento está em engajamento/);
    expect(mixDeObjetivos([{ tipo: "compras", gasto: 100, resultados: 2 }]).alertas).toEqual([]);
    expect(mixDeObjetivos([{ tipo: "engajamento", gasto: 100, resultados: 2 }]).alertas.length).toBe(2);
  });

  it("a tela e o servidor usam os mesmos grupos de objetivo", () => {
    expect(GRUPOS_DA_TELA.map((g) => [g.valor, g.tipos.join(",")])).toEqual(GRUPOS_DE_OBJETIVO.map((g) => [g.grupo, g.tipos.join(",")]));
  });
});

describe("agente sênior de tráfego", () => {
  it("normaliza a estratégia: só ad_id da conta, escalar só com resultado, um anúncio em um grupo, sem travessão", () => {
    const ads = new Map([["1", { resultados: 5 }], ["2", { resultados: 0 }]]);
    const e = normalizarEstrategia({
      resposta: "Tudo em engajamento " + String.fromCharCode(0x2014) + " sem venda.",
      diagnostico: [{ titulo: "Tudo em engajamento", detalhe: "70% do investimento", gravidade: "alta" }, { titulo: "", detalhe: "x" }],
      escalar: [{ ad_id: "1", porque: "custo baixo", como: "20% a cada 3 dias" }, { ad_id: "2", porque: "sem resultado" }, { ad_id: "999", porque: "inventado" }],
      cortar: [{ ad_id: "2", porque: "gasta sem resultado" }],
      manter: [{ ad_id: "2", porque: "repetido" }],
      reestruturacao: { objetivo: "mensagens", porque: "vende no WhatsApp", evento_otimizacao: "conversa", campanhas: [{ nome: "Mensagens", objetivo: "mensagens", orcamento_diario_brl: -5, conjuntos: [{ nome: "Aberto", publico: "raio 5 km", orcamento_diario_brl: 40, anuncios: ["1"] }] }], verba_total_diaria_brl: 40, passos: ["Criar a campanha"] },
      proximos_criativos: [{ titulo: "Relógio", angulo: "espera", gancho_verbal: "Cansou de esperar?", gancho_visual: "relógio", formato: "feed_4x5", estilo_visual: "inexistente", objetivo: "mensagens", cta_meta: "Enviar mensagem", base_ad_id: "999", porque: "venceu" }],
      pesquisa: [{ achado: "Concorrente usa hora marcada", fonte: "https://www.facebook.com/ads/library/?id=1" }],
      perguntas: ["Qual o ticket médio?"],
    }, ads);
    expect(e.resposta).not.toMatch(TRAVESSAO);
    expect(e.diagnostico).toHaveLength(1);
    expect(e.escalar.map((x) => x.ad_id)).toEqual(["1"]);
    expect(e.cortar.map((x) => x.ad_id)).toEqual(["2"]);
    expect(e.manter).toEqual([]);
    expect(e.reestruturacao.campanhas[0].orcamento_diario_brl).toBeNull();
    expect(e.proximos_criativos[0]).toMatchObject({ estilo_visual: null, base_ad_id: null, cta_meta: "Enviar mensagem" });
    const md = estrategiaEmMarkdown(e, (id) => `Anúncio ${id}`);
    expect(md).toContain("## Reestruturação recomendada");
    expect(md).toContain("Anúncio 1 (ad_id 1)");
    expect(md).not.toMatch(TRAVESSAO);
  });

  it("a tarefa pede foco em mensagem e venda, pesquisa com fonte e nada inventado", () => {
    const t = tarefaDoAgenteSenior({ pesquisaWeb: true, bibliotecaConsultada: true, temPlano: true });
    expect(t).toContain("MIX_DE_OBJETIVOS");
    expect(t).toContain("Biblioteca de Anúncios");
    expect(t).toContain("PLANO_ABERTO");
    expect(t).toMatch(/nunca invente número/);
    expect(tarefaDoAgenteSenior({ pesquisaWeb: false, bibliotecaConsultada: false, temPlano: false })).toContain("Sem pesquisa web nesta mensagem");
    expect(ESTRATEGIA_SENIOR_DE_CONTA).toContain("síntese da agência");
    expect(ESTRATEGIA_SENIOR_DE_CONTA).not.toMatch(TRAVESSAO);
  });

  it("Biblioteca de Anúncios: resposta curta, com link público e sem campo que carregue token", () => {
    const l = anunciosDaBiblioteca({
      data: [
        { id: "123456", page_name: "Clínica X", ad_creative_bodies: ["Avaliação grátis"], ad_creative_link_titles: ["Agende"], ad_delivery_start_time: "2026-08-01T00:00:00+0000", ad_snapshot_url: "https://www.facebook.com/ads/archive/render_ad/?id=123456&access_token=SEGREDO" },
        { id: "9", page_name: "Sem texto" },
      ],
    });
    expect(l).toHaveLength(1);
    expect(l[0]).toEqual({ id: "123456", pagina: "Clínica X", texto: "Avaliação grátis", titulo: "Agende", inicio: "2026-08-01", link: "https://www.facebook.com/ads/library/?id=123456" });
    expect(JSON.stringify(l)).not.toContain("SEGREDO");
  });

  it("fonte: conta_conversar com pesquisa web, 300 s, fôlego, custo e sem pedir ad_snapshot_url; token só dentro da busca", () => {
    const i = fonte.indexOf("async function contaConversar(");
    const corpo = fonte.slice(i, fonte.indexOf("\nasync function contaConversaLer(", i));
    expect(corpo).toContain("pesquisaWeb: pesquisar,");
    expect(corpo).toContain("timeoutMs: TIMEOUT_TEXTO_ADS_MS,");
    expect(corpo).toContain("esquemaJson: ESQUEMA_AGENTE_SENIOR,");
    expect(corpo).toMatch(/custo_usd: custo,/);
    expect(corpo.match(/chamarTexto\(/g) || []).toHaveLength(1);
    expect(fonte).not.toContain("ad_snapshot_url");
    // O token do cofre só aparece dentro de pesquisarBibliotecaMeta e nunca vai para a resposta.
    const busca = fonte.slice(fonte.indexOf("async function pesquisarBibliotecaMeta("), fonte.indexOf("/** Métricas curtas para o prompt"));
    expect(busca).toContain('servico.rpc("ads_token_para_biblioteca"');
    expect(fonte.split("access_token").length - 1).toBe(busca.split("access_token").length - 1);
    for (const acao of ["vinculos_automaticos: vinculosAutomaticos", "vinculo_confirmar: vinculoConfirmar", "vinculo_desfazer: vinculoDesfazer", "conta_conversar: contaConversar", "conta_conversa_ler: contaConversaLer", "pacote_otimizacao_dados: pacoteOtimizacaoDados", "pacote_importar: pacoteImportar"]) {
      expect(fonte).toContain(acao);
    }
    const longas = fonte.slice(fonte.indexOf("const ACOES_LONGAS"), fonte.indexOf("]);", fonte.indexOf("const ACOES_LONGAS")));
    for (const a of ["vinculos_automaticos", "conta_conversar", "pacote_otimizacao_dados", "pacote_importar"]) expect(longas).toContain(`"${a}"`);
  });

  it("fonte: vínculo automático usa o Jev só nos incertos (Choice com nenhum), numa chamada, e liga só onde ad_id está vazio", () => {
    const i = fonte.indexOf("async function vinculosAutomaticos(");
    const corpo = fonte.slice(i, fonte.indexOf("\nasync function conferirParDoVinculo(", i));
    expect(corpo.match(/jevPerguntar\(/g) || []).toHaveLength(1);
    expect(corpo).toContain('type: "choice"');
    expect(corpo).toContain("criteria.nenhum =");
    expect(corpo).toContain('.is("ad_id", null)');
    expect(corpo).not.toMatch(/chamarTexto/);
    expect(corpo).toContain("cobrarJev(");
  });
});

describe("retorno do agente externo (contrato)", () => {
  const valido = {
    titulo: "Relógio da recepção",
    angulo: "A espera na recepção",
    formato: "4:5",
    gancho_visual: "Relógio grande na recepção vazia",
    headline_arte: "Hora marcada de verdade",
    texto_principal: "Chega de esperar: agende pelo WhatsApp.",
    titulo_anuncio: "Avaliação com hora marcada e sem fila na recepção",
    objetivo: "whatsapp",
    cta_meta: "enviar mensagem",
  };

  it("aceita o válido (com apelidos), recusa o incompleto com o motivo e corta o título em 40", () => {
    const r = validarRetorno({ formato: "mesa-ads-retorno", versao: 1, plano: { nome: "Plano externo", objetivo: "mensagens" }, criativos: [valido, { titulo: "Sem nada", formato: "cinema" }, "texto solto"] }, new Set(["123"]));
    expect(r.aceitos).toHaveLength(1);
    expect(r.aceitos[0]).toMatchObject({ formato: "feed_4x5", objetivo: "mensagens", cta_meta: "Enviar mensagem" });
    expect(r.aceitos[0].titulo_anuncio.length).toBeLessThanOrEqual(40);
    expect(r.aceitos[0].avisos.join(" ")).toMatch(/cortado em 40/);
    expect(r.recusados).toHaveLength(2);
    expect(r.recusados[0].motivos.join(" ")).toMatch(/formato "cinema" desconhecido/);
    expect(r.recusados[0].motivos.join(" ")).toMatch(/sem ângulo/);
    expect(r.recusados[1].motivos[0]).toMatch(/não é um objeto/);
    expect(r.plano).toEqual({ nome: "Plano externo", objetivo: "mensagens", resumo: "" });
  });

  it("lista direta, base_ad_id só se o anúncio existe, carrossel e limite por importação", () => {
    const r = validarRetorno([{ ...valido, base_ad_id: "999" }, { ...valido, formato: "carrossel", carrossel: [{ texto: "1" }, { texto: "2" }, { texto: "3" }], base_ad_id: "123" }], new Set(["123"]));
    expect(r.aceitos[0].base_ad_id).toBeNull();
    expect(r.aceitos[1].base_ad_id).toBe("123");
    expect(r.aceitos[1].carrossel).toHaveLength(3);
    const muitos = validarRetorno({ criativos: Array.from({ length: MAX_CRIATIVOS_IMPORTADOS + 2 }, () => valido) });
    expect(muitos.aceitos).toHaveLength(MAX_CRIATIVOS_IMPORTADOS);
    expect(muitos.recusados).toHaveLength(2);
    expect(validarRetorno({ nada: true }).avisos[0]).toMatch(/Nenhum criativo/);
    expect(validarRetorno({ formato: "outro", criativos: [valido] }).avisos[0]).toMatch(/esperado/);
  });

  it("fonte: pacote_importar só valida sem confirmar e cria plano, trabalhos e criativos com a direção em código", () => {
    const i = fonte.indexOf("async function pacoteImportar(");
    const corpo = fonte.slice(i, fonte.indexOf("\nconst ACOES", i));
    expect(corpo).toMatch(/if \(corpo\.confirmar !== true\) return json\(\{ entendido, custo_usd: 0 \}\);/);
    expect(corpo).toContain("conferirCopiesComJev(");
    expect(corpo).toContain("direcaoDoAnuncio(");
    expect(corpo).toContain('origem: "agente_externo"');
    expect(corpo).not.toMatch(/chamarTexto/);
  });
});

describe("SQL v5 (sem aplicar)", () => {
  it("tabelas com RLS da equipe e o token só para a chave de serviço", () => {
    const sql = ler("docs/mesa-ads/v5/01_vinculos_e_biblioteca.sql");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.ads_vinculos");
    expect(sql).toContain("CREATE TABLE IF NOT EXISTS public.ads_impressoes");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON FUNCTION public.ads_token_para_biblioteca(uuid) FROM PUBLIC, anon, authenticated;");
    expect(sql).toContain("GRANT EXECUTE ON FUNCTION public.ads_token_para_biblioteca(uuid) TO service_role;");
    expect(sql).not.toMatch(TRAVESSAO);
  });
});
