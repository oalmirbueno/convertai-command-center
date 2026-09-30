import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  adicionarSecaoNoMapa,
  BIBLIOTECA_DE_SECOES,
  custoPorSecao,
  dentroDoKit,
  KIT_LIVRE,
  LIMIAR_DA_SECAO,
  mapaDoJev,
  mapaDoLegado,
  mapaDoSite,
  mapaPadrao,
  normalizarEstilo,
  normalizarMapa,
  OPCIONAIS_POR_TIPO,
  perguntaDoPreset,
  perguntasDoMapa,
  PRESETS_DE_ESTILO,
  PRESETS_DE_MOTION,
  presetsDoMotor,
  removerSecaoDoMapa,
  SECOES_LEGADAS,
  secoesDoMapa,
  slotsDoMapa,
  slotsQueOGeradorFaz,
  slotsVazios,
  TIPOS_DE_SITE,
  tipoPedido,
  trocarSecaoNoMapa,
} from "../../supabase/functions/_shared/site-biblioteca";
import {
  checklistDeLancamento,
  integracoesDoPacote,
  lerEnvio,
  normalizarGa4,
  normalizarIntegracoes,
  normalizarPixel,
  normalizarSeo,
  normalizarWhatsapp,
  origemPermitida,
  pendentesObrigatorios,
  robotsTxt,
  schemaDoNegocio,
  sitemapXml,
  TEMPO_MINIMO_MS,
  urlDoMapa,
} from "../../supabase/functions/_shared/site-lancamento";
import { assinaturaDaVersao, camposParaRestaurar, dadosDaVersao, diferencasEntreVersoes } from "../../supabase/functions/_shared/site-versoes";
import { ATRIBUTOS_DO_DNA, ETAPAS_DO_SITE, estiloDoPacote, promptDaSecao, revisarHtml, rotuloDaSecao, tipoDaSecaoPeloId, type PacoteDoSite } from "../../supabase/functions/_shared/site-metodo";
import { camposDoEstilo, editarCopy, normalizarOpcoesDaSecao, sujeitoDoSlot } from "../../supabase/functions/mesa-site/estrutura-pura";
import { alvosDoSite, caminhoDoSite, normalizarAcoesDoSite, OPERACOES_DO_SITE, regrasDoSite } from "../../supabase/functions/mesa-site/acoes-do-site";
import { podeExecutarDireto } from "../../supabase/functions/_shared/acoes-do-agente";
import { normalizarPedido, podeVoltarPara } from "../../supabase/functions/_shared/motor-codigo";
import { arquivoDaCascaValido, cssDaMarca } from "../../workers/motor-codigo/lib/projeto";
// @ts-expect-error módulo .mjs do modelo de site (sem tipos)
import { montarPagina, paginasDoPacote, sitemapDoPacote } from "../../workers/motor-codigo/modelo-site/scripts/seo.mjs";

/**
 * Frente SIT2 (30/09): Mesa Site mais completa. Biblioteca de seções com os
 * nomes do mercado, tipo de site e mapa (Jev falso), presets de estilo e de
 * movimento (kit livre), preset do motor, integrações e SEO, anti-spam do
 * formulário público, checklist de lançamento, versões, copy por seção, as
 * ações novas do diretor de site, voltar para uma versão do código e a casca
 * multipágina do modelo de site.
 */

const raiz = resolve(__dirname, "../..");
const ler = (p: string) => readFileSync(resolve(raiz, p), "utf8");

describe("biblioteca de seções e tipos de site", () => {
  it("tem as seções que o mercado usa, com id único, fórmula e padrão", () => {
    const ids = BIBLIOTECA_DE_SECOES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const obrigatoria of ["hero", "bento", "prova", "pricing", "faq", "chamada", "depoimentos", "antes_depois", "contato", "galeria", "vitrine", "links"]) expect(ids).toContain(obrigatoria);
    BIBLIOTECA_DE_SECOES.forEach((s) => {
      expect(s.formula.length).toBeGreaterThan(20);
      expect(s.padrao.length).toBeGreaterThan(20);
      expect(s.formula + s.padrao + s.descricao).not.toMatch(/[\u2014\u2013]/);
    });
    // Os ids antigos continuam valendo (sites da primeira Mesa Site).
    SECOES_LEGADAS.forEach((id) => expect(ids).toContain(id));
    expect(BIBLIOTECA_DE_SECOES.find((s) => s.id === "antes_depois")!.so_real).toBe(true);
    expect(BIBLIOTECA_DE_SECOES.find((s) => s.id === "contato")!.integra).toEqual(["formulario", "mapa", "whatsapp"]);
  });

  it("os 5 tipos nascem com um mapa válido; institucional tem 3 páginas, bio só links", () => {
    expect(TIPOS_DE_SITE.map((t) => t.id)).toEqual(["institucional", "landing", "portfolio", "loja", "bio"]);
    TIPOS_DE_SITE.forEach((t) => {
      const m = mapaPadrao(t.id);
      expect(normalizarMapa(m, t.id)).toEqual({ ...m, fonte: "padrao" });
      expect(secoesDoMapa(m).length).toBeGreaterThan(0);
    });
    const inst = mapaPadrao("institucional");
    expect(inst.paginas.map((p) => p.slug)).toEqual(["", "sobre", "contato"]);
    expect(inst.paginas[1].secoes.map((s) => s.uid)).toEqual(["sobre-sobre", "sobre-diferenciais", "sobre-chamada"]);
    expect(secoesDoMapa(inst)[0]).toBe("topo");
    expect(secoesDoMapa(inst).slice(-1)[0]).toBe("rodape");
    expect(secoesDoMapa(mapaPadrao("bio"))).toEqual(["links", "rodape"]);
  });

  it("o AGENTS.md do modelo de projeto traz a biblioteca inteira e os presets", () => {
    const agents = ler("workers/motor-codigo/modelo-site/AGENTS.md");
    BIBLIOTECA_DE_SECOES.forEach((s) => expect(agents).toContain(`| \`${s.id}\` | ${s.rotulo} |`));
    PRESETS_DE_MOTION.forEach((m) => expect(agents).toContain(`\`${m.id}\``));
    PRESETS_DE_ESTILO.forEach((p) => expect(agents).toContain(`\`${p.id}\``));
    expect(agents).toMatch(/<Formulario \/>/);
    expect(agents).toMatch(/<Mapa \/>/);
    expect(agents).not.toMatch(/[\u2014\u2013]/);
  });
});

describe("mapa do site: gerado, editável e seguro", () => {
  it("normaliza sem confiar: seção fora da biblioteca, global no corpo, uid repetido e página demais saem", () => {
    const m = normalizarMapa({
      tipo: "portfolio",
      paginas: [
        { titulo: "Início", slug: "qualquer", secoes: [{ tipo: "hero", uid: "hero" }, { tipo: "hack" }, { tipo: "topo" }, { tipo: "faq", uid: "hero" }] },
        { titulo: "Sobre Nós", secoes: ["sobre", "equipe"] },
        { titulo: "Sobre Nós", secoes: ["galeria"] },
        ...[1, 2, 3, 4, 5].map((i) => ({ titulo: `P${i}`, secoes: [] })),
      ],
    });
    expect(m.paginas.length).toBe(6);
    expect(m.paginas[0].slug).toBe("");
    expect(m.paginas[0].secoes.map((s) => [s.uid, s.tipo])).toEqual([["hero", "hero"], ["faq", "faq"]]);
    expect(m.paginas[1].slug).toBe("sobre-nos");
    expect(m.paginas[2].slug).not.toBe("sobre-nos");
    expect(m.paginas[1].secoes.map((s) => s.uid)).toEqual(["sobre-nos-sobre", "sobre-nos-equipe"]);
    expect(m.fonte).toBe("manual");
  });

  it("trocar, acrescentar (na ordem canônica) e tirar mudam só o que foi pedido", () => {
    const m = mapaPadrao("landing");
    const trocado = trocarSecaoNoMapa(m, "problema", "depoimentos");
    expect(secoesDoMapa(trocado)).toContain("depoimentos");
    expect(secoesDoMapa(trocado)).not.toContain("problema");
    expect(trocarSecaoNoMapa(m, "hero", "topo")).toBe(m);
    const mais = adicionarSecaoNoMapa(m, "inicio", "pricing");
    const ordem = mais.paginas[0].secoes.map((s) => s.tipo);
    expect(ordem.indexOf("pricing")).toBeLessThan(ordem.indexOf("faq"));
    expect(ordem.indexOf("pricing")).toBeGreaterThan(ordem.indexOf("prova"));
    expect(secoesDoMapa(removerSecaoDoMapa(m, "bento"))).not.toContain("bento");
  });

  it("site antigo (só direcao.secoes) vira mapa de uma página com topo e rodapé no layout", () => {
    const m = mapaDoLegado(["topo", "hero", "servicos", "faq", "rodape"]);
    expect(m.globais).toEqual(["topo", "rodape"]);
    expect(m.paginas[0].secoes.map((s) => s.uid)).toEqual(["hero", "servicos", "faq"]);
    expect(mapaDoSite({ mapa: {}, tipo: null, direcao: { secoes: ["hero", "faq"] } }).paginas[0].secoes.length).toBe(2);
  });

  it("rótulo e tipo pelo id, nas outras páginas e nas repetidas", () => {
    expect(tipoDaSecaoPeloId("sobre-antes-depois")).toBe("antes_depois");
    expect(rotuloDaSecao("sobre-equipe")).toBe("Equipe (sobre)");
    expect(rotuloDaSecao("hero-2")).toBe("Hero cinematográfico 2");
    expect(rotuloDaSecao("prova")).toBe("Prova (só real)");
    expect(rotuloDaSecao("inventada")).toBe("inventada");
  });

  it("Jev falso: Noul por seção opcional, só as acima do limiar entram; sem tipo, um Choice escolhe", () => {
    const q = perguntasDoMapa("institucional");
    expect(Object.keys(q).filter((k) => k.indexOf("secao_") === 0).length).toBe(OPCIONAIS_POR_TIPO.institucional.length);
    expect(q.secao_depoimentos.type).toBe("noul");
    expect(String(q.secao_depoimentos.instructions)).toMatch(/ONLY if/);
    expect(q.tipo).toBeUndefined();
    expect(perguntasDoMapa(null).tipo.type).toBe("choice");
    const { mapa, incluidas } = mapaDoJev({ secao_depoimentos: { noul: 0.9 }, secao_pricing: { noul: LIMIAR_DA_SECAO - 0.01 }, secao_galeria: { noul: 0.7 } }, "institucional");
    expect(incluidas.map((x) => x.id)).toEqual(["depoimentos", "galeria"]);
    expect(mapa.fonte).toBe("jev");
    const comTipo = mapaDoJev({ tipo: { choice: "loja" } }, null);
    expect(comTipo.mapa.tipo).toBe("loja");
    expect(mapaDoJev({ tipo: { choice: "inventado" } }, null).mapa.tipo).toBe("landing");
  });

  it("tipo pedido em texto: id, nome do mercado ou parte única dele", () => {
    expect(tipoPedido("FAQ")).toBe("faq");
    expect(tipoPedido("antes e depois")).toBe("antes_depois");
    expect(tipoPedido("Planos e preços")).toBe("pricing");
    expect(tipoPedido("depoimentos")).toBe("depoimentos");
    expect(tipoPedido("xyz")).toBeNull();
  });

  it("slots por seção: imagem da seção conta para ela, antiga para a primeira do slot; foto real não é do gerador", () => {
    const m = mapaPadrao("institucional");
    const slots = slotsDoMapa(m, [{ slot: "hero", secao: null }, { slot: "secao", secao: "servicos" }]);
    const hero = slots.find((s) => s.uid === "hero")!;
    expect(hero).toMatchObject({ precisa: 1, tem: 1 });
    expect(slots.find((s) => s.uid === "servicos")!.tem).toBe(1);
    const sobre = slots.find((s) => s.uid === "sobre-sobre")!;
    expect(sobre.so_real).toBe(true);
    expect(slotsVazios(slots)).toBeGreaterThan(slotsQueOGeradorFaz(slots));
  });
});

describe("presets de estilo, de movimento e do motor", () => {
  it("de 8 a 12 estéticas nomeadas, cada uma com 3 a 5 atributos válidos e prévia", () => {
    expect(PRESETS_DE_ESTILO.length).toBeGreaterThanOrEqual(8);
    expect(PRESETS_DE_ESTILO.length).toBeLessThanOrEqual(12);
    PRESETS_DE_ESTILO.forEach((p) => {
      expect(p.atributos.length).toBeGreaterThanOrEqual(3);
      expect(p.atributos.length).toBeLessThanOrEqual(5);
      p.atributos.forEach((a) => expect(ATRIBUTOS_DO_DNA.some((x) => x.id === a)).toBe(true));
      expect(p.previa.fundo).toMatch(/^#[0-9A-F]{6}$/);
    });
    expect(Object.keys((perguntaDoPreset().preset as { criteria: Record<string, unknown> }).criteria)).toEqual(PRESETS_DE_ESTILO.map((p) => p.id));
  });

  it("movimento só com peças do kit livre (sem Motion+, Theatre, React Bits)", () => {
    expect(KIT_LIVRE).toEqual(["motion", "gsap", "scrolltrigger", "splittext", "lenis", "css"]);
    PRESETS_DE_MOTION.forEach((m) => expect(dentroDoKit(m)).toBe(true));
    expect(normalizarEstilo({ preset: "suico", motion: ["sutil", "inventado", "sutil", "parallax", "marquee", "cascata"] })).toEqual({ preset: "suico", motion: ["sutil", "parallax", "marquee"] });
    expect(normalizarEstilo({ preset: "x" }).preset).toBeNull();
  });

  it("escolher o preset troca o DNA (nicho e leitura ficam) e leva o modo para a marca", () => {
    const site = { estilo: {}, dna: { atributos: [{ id: "bento", prob: 0.9 }], movimento: "sutil", nivel: "saas", nicho: "agencia", cores_das_referencias: ["#111111"], observacoes: "obs", fonte: "jev" }, direcao: {} } as never;
    const c = camposDoEstilo(site, { preset: "cinema_noturno", motion: ["tipo_cinetico"] });
    expect((c.dna as { atributos: Array<{ id: string }> }).atributos.map((a) => a.id)).toEqual(["quase_preto", "luz_dramatica", "serifada_gigante", "textura"]);
    expect(c.dna).toMatchObject({ nicho: "agencia", movimento: "tipo_cinetico", nivel: "awwwards", observacoes: "obs", fonte: "manual" });
    expect(camposDoEstilo(site, { preset: "cinema_noturno", aplicarDna: false }).dna).toBeUndefined();
    const e = estiloDoPacote({ preset: "vidro_aurora", motion: ["parallax"] })!;
    expect(e.modo).toBe("escuro");
    expect(e.motion_instrucoes![0]).toMatch(/ScrollTrigger scrub/);
    const css = cssDaMarca({ paleta: [{ hex: "#00D52B", papel: "primária" }, { hex: "#FAFAFA", papel: "fundo" }], estilo: { modo: "escuro" } });
    expect(css).toMatch(/--cor-fundo: #0b0b0c/);
    expect(cssDaMarca({ paleta: [{ hex: "#00D52B", papel: "primária" }], dna: { atributos: [{ id: "quase_preto" }] }, estilo: { modo: "claro" } })).toMatch(/--cor-texto: #111111/);
  });

  it("motor: rápido e barato é o de menor custo por seção; premium é o padrão do papel site ou o mais caro abaixo do teto", () => {
    const m = (id: string, e: number, s: number, padrao: string[] = []) => ({ id, provedor: "openrouter", modelo_api: id, tipo: "texto", ativo: true, preco_entrada_1m: e, preco_saida_1m: s, preco_cache_1m: null, padrao_para: padrao });
    const catalogo = [m("caro-demais", 60, 240), m("barato", 0.2, 0.8), m("medio", 2, 10), m("site", 4, 20, ["site"]), m("sem-preco", 0, 0)];
    const p = presetsDoMotor(catalogo);
    expect(p.rapido!.id).toBe("barato");
    expect(p.premium!.id).toBe("site");
    expect(presetsDoMotor(catalogo.filter((x) => x.id !== "site")).premium!.id).toBe("medio");
    expect(custoPorSecao(m("x", 2, 10))).toBeCloseTo((52_000 * 2 + 208_000 * 2 + 14_000 * 10) / 1e6, 4);
    expect(presetsDoMotor([])).toEqual({ rapido: null, premium: null });
  });
});

describe("integrações, SEO e LGPD", () => {
  it("WhatsApp, pixel e GA4 só no formato certo", () => {
    expect(normalizarWhatsapp("(41) 99999-8888")).toBe("5541999998888");
    expect(normalizarWhatsapp("+55 41 3333-4444")).toBe("554133334444");
    expect(normalizarWhatsapp("+1 415 555 0100")).toBe("14155550100");
    expect(normalizarWhatsapp("123")).toBeNull();
    expect(normalizarPixel("1234567890123456")).toBe("1234567890123456");
    expect(normalizarPixel("abc")).toBeNull();
    expect(normalizarGa4("g-abc123xyz")).toBe("G-ABC123XYZ");
    expect(normalizarGa4("UA-123-1")).toBeNull();
  });

  it("pixel ou GA4 ligam o aviso de cookies; a chave do formulário não troca; nome é sempre campo", () => {
    const antes = normalizarIntegracoes({ formulario: { ligado: true, chave: "abcdefghijklmnopqrstuvwx" } });
    const i = normalizarIntegracoes({ pixel_meta: { id: "123456789012345" }, formulario: { ligado: true, chave: "zzzzzzzzzzzzzzzzzzzzzzzz", campos: ["email", "hack"] }, cookies: { ligado: false, politica_url: "http://inseguro.com" } }, antes);
    expect(i.cookies.ligado).toBe(true);
    expect(i.cookies.politica_url).toBeNull();
    expect(i.formulario.chave).toBe("abcdefghijklmnopqrstuvwx");
    expect(i.formulario.campos).toEqual(["nome", "email"]);
    const pacote = integracoesDoPacote({ ...i, whatsapp: { ligado: true, numero: "5541999998888", mensagem: "Oi" }, mapa: { ligado: true, endereco: "Rua A, 10, Curitiba" } }, "https://x.supabase.co/functions/v1/site-formulario");
    expect(pacote.whatsapp!.link).toBe("https://wa.me/5541999998888?text=Oi");
    expect(pacote.formulario).toMatchObject({ endpoint: "https://x.supabase.co/functions/v1/site-formulario", chave: "abcdefghijklmnopqrstuvwx" });
    expect(pacote.mapa!.embed).toBe(urlDoMapa("Rua A, 10, Curitiba"));
    expect(integracoesDoPacote(i, null).formulario).toBeNull();
  });

  it("SEO no tamanho e schema só com o que existe (sem endereço vira Organization)", () => {
    const seo = normalizarSeo({ titulo: "t".repeat(80), descricao: "Sites — rápidos", negocio: { nome: "Café X", telefone: "(41) 3333-4444", horario: ["Mo-Fr 09:00-18:00", "toda hora"], tipo: "Inventado", redes: ["https://instagram.com/cafex", "javascript:alert(1)"] } });
    expect(seo.titulo.length).toBe(60);
    expect(seo.descricao).toBe("Sites, rápidos");
    expect(seo.negocio.horario).toEqual(["Mo-Fr 09:00-18:00"]);
    expect(seo.negocio.tipo).toBe("LocalBusiness");
    const s = schemaDoNegocio(seo, { url: "https://cafex.com.br", logo: "/marca/logo.png", imagem: null, nomePadrao: "Café" });
    expect(s["@type"]).toBe("Organization");
    expect(s.logo).toBe("https://cafex.com.br/marca/logo.png");
    expect(s.telephone).toBe("+554133334444");
    expect(s.sameAs).toEqual(["https://instagram.com/cafex"]);
    const comEndereco = schemaDoNegocio(normalizarSeo({ negocio: { tipo: "Restaurant", rua: "Rua XV, 10", cidade: "Curitiba", estado: "pr", cep: "80020-310" } }), { url: null, logo: null, imagem: null, nomePadrao: "Café" });
    expect(comEndereco).toMatchObject({ "@type": "Restaurant", name: "Café", address: { streetAddress: "Rua XV, 10", addressRegion: "PR", postalCode: "80020-310", addressCountry: "BR" } });
    expect(robotsTxt(false, null)).toBe("User-agent: *\nDisallow: /\n");
    expect(robotsTxt(true, "https://a.com")).toMatch(/Sitemap: https:\/\/a\.com\/sitemap\.xml/);
    expect(sitemapXml("https://a.com/", ["", "sobre"], "2026-09-30")).toMatch(/<loc>https:\/\/a\.com\/sobre\/<\/loc>/);
  });

  it("revisão avisa schema quebrado e rastreio antes do consentimento", () => {
    const html = '<html lang="pt-BR"><head><script type="application/ld+json">{quebrado</script><script src="https://connect.facebook.net/en_US/fbevents.js"></script></head><body></body></html>';
    const t = revisarHtml(html).map((a) => a.texto).join(" ");
    expect(t).toMatch(/schema\) não abrem/);
    expect(t).toMatch(/LGPD/);
  });
});

describe("formulário público: anti-spam antes de gravar", () => {
  const agora = Date.parse("2026-09-30T12:00:00Z");
  const base = { chave: "abcdefghijklmnopqrstuvwx", nome: "Ana", whatsapp: "(41) 99999-8888", mensagem: "Quero um orçamento", iniciado_em: agora - 20_000, site_url: "" };

  it("envio de gente passa; armadilha, pressa, sem contato, links e HTML não", () => {
    expect(lerEnvio(base, agora)).toMatchObject({ motivo: null, envio: { whatsapp: "5541999998888" } });
    expect(lerEnvio({ ...base, site_url: "http://spam" }, agora).motivo).toBe("armadilha");
    expect(lerEnvio({ ...base, iniciado_em: agora - TEMPO_MINIMO_MS + 500 }, agora).motivo).toBe("rapido_demais");
    expect(lerEnvio({ ...base, iniciado_em: agora + 120_000 }, agora).motivo).toBe("rapido_demais");
    expect(lerEnvio({ ...base, whatsapp: "", email: "" }, agora).motivo).toBe("sem_contato");
    expect(lerEnvio({ ...base, mensagem: "https://a.com http://b.com www.c.com" }, agora).motivo).toBe("links_demais");
    expect(lerEnvio({ ...base, mensagem: "<script>x</script>" }, agora).motivo).toBe("marcacao");
    expect(lerEnvio({ ...base, chave: "curta" }, agora)).toEqual({ envio: null, motivo: "chave_invalida" });
  });

  it("origem: o domínio do site (com e sem www), a publicação e a prévia do motor", () => {
    expect(origemPermitida("https://www.cafex.com.br", ["cafex.com.br"])).toBe(true);
    expect(origemPermitida("https://cafex.com.br", ["www.cafex.com.br"])).toBe(true);
    expect(origemPermitida("https://abc.trycloudflare.com", ["cafex.com.br"])).toBe(true);
    expect(origemPermitida("https://outro.com", ["cafex.com.br"])).toBe(false);
    expect(origemPermitida(null, ["cafex.com.br"])).toBe(true);
  });

  it("a função pública é sem login, só chama a RPC do backend e nunca grava o IP", () => {
    const f = ler("supabase/functions/site-formulario/index.ts");
    expect(f).toMatch(/rpc\("site_registrar_lead"/);
    expect(f).toMatch(/SHA-256/);
    expect(f).not.toMatch(/from\("commercial_leads"\)/);
    expect(ler("supabase/config.toml")).toMatch(/\[functions\.site-formulario\]\s+verify_jwt = false/);
  });
});

describe("checklist de lançamento", () => {
  const seo = normalizarSeo({});
  const integracoes = normalizarIntegracoes({});
  const base = { briefingSalvo: true, temMapa: true, secoes: ["hero", "faq"], construidas: ["hero", "faq"], preset: true, copyEscolhida: true, slotsVazios: 0, buildOk: true, avisosDeQa: 0, seo: normalizarSeo({ titulo: "Café X", descricao: "d".repeat(60), negocio: { nome: "Café X", telefone: "4133334444" } }), temOgImagem: true, temLogo: true, integracoes: normalizarIntegracoes({ whatsapp: { ligado: true, numero: "41999998888" } }), secoesComFormulario: false, secoesComMapa: false, dominio: "cafex.com.br", dominioVerificado: true, construidoDepoisDasMudancas: true };

  it("site pronto não tem pendência; o que falta aparece com a etapa", () => {
    expect(checklistDeLancamento(base).filter((i) => !i.ok)).toEqual([]);
    const faltando = checklistDeLancamento({ ...base, construidas: ["hero"], seo, integracoes, buildOk: null });
    const ids = pendentesObrigatorios(faltando).map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["construido", "build", "seo_titulo", "contato"]));
    expect(faltando.find((i) => i.id === "construido")!.etapa).toBe("construcao");
  });

  it("LGPD: pixel ou GA4 sem aviso de cookies é obrigatório (o normalizador já liga)", () => {
    const comPixel = { ...base.integracoes, pixel_meta: { id: "123456789012345" }, cookies: { ligado: false, politica_url: null } };
    const item = checklistDeLancamento({ ...base, integracoes: comPixel }).find((i) => i.id === "lgpd")!;
    expect(item).toMatchObject({ ok: false, obrigatorio: true });
    expect(normalizarIntegracoes(comPixel).cookies.ligado).toBe(true);
  });
});

describe("versões do plano do site", () => {
  it("assinatura igual para a mesma decisão (ordem das chaves e salvo_em não contam)", () => {
    const a = dadosDaVersao({ id: "x", briefing: { respostas: { a: 1 }, salvo_em: "1" }, seo: { titulo: "T", descricao: "D" } });
    const b = dadosDaVersao({ seo: { descricao: "D", titulo: "T" }, briefing: { salvo_em: "2", respostas: { a: 1 } } });
    expect(a.id).toBeUndefined();
    expect(assinaturaDaVersao(a)).toBe(assinaturaDaVersao(b));
    expect(assinaturaDaVersao(a)).not.toBe(assinaturaDaVersao({ ...a, seo: { titulo: "Outro" } }));
  });

  it("compara por campo e volta sem perder a chave do formulário", () => {
    const antes = { mapa: mapaPadrao("landing"), estilo: { preset: "suico", motion: [] }, integracoes: { formulario: { ligado: true, chave: "velhavelhavelhavelhavelh" } } };
    const depois = { mapa: mapaPadrao("institucional"), estilo: { preset: "suico", motion: [] }, integracoes: { formulario: { ligado: true, chave: "novanovanovanovanovanova" } } };
    const d = diferencasEntreVersoes(antes, depois);
    expect(d.map((x) => x.campo)).toEqual(["mapa", "integracoes"]);
    expect(d[0].depois).toMatch(/3 página/);
    const c = camposParaRestaurar(antes, depois);
    expect((c.integracoes as { formulario: { chave: string } }).formulario.chave).toBe("novanovanovanovanovanova");
  });
});

describe("copy por seção", () => {
  it("3 opções no máximo, título no limite da biblioteca, itens no limite, sem travessão", () => {
    const o = normalizarOpcoesDaSecao({ opcoes: [1, 2, 3, 4].map(() => ({ titulo: "um dois três quatro cinco seis sete oito nove", texto: "Texto — com travessão", itens: ["a", "b", "c", "d", "e", "f", "g"], cta: "Fale com a gente agora mesmo" })) }, "faq");
    expect(o.length).toBe(3);
    expect(o[0].titulo.split(" ").length).toBe(5);
    expect(o[0].itens.length).toBe(6);
    expect(o[0].texto).toBe("Texto, com travessão");
    expect(o[0].cta.split(" ").length).toBe(5);
  });

  it("editar a escolhida: seção nova entra, abertura muda; sem escolhida, nada", () => {
    const conteudo = { opcoes: [{ headline: "A", subtitulo: "s", cta: "c", secoes: [{ id: "hero", titulo: "t", texto: "x", itens: [] }], faq: [], seo: {} }], escolhida: 0 };
    const e1 = editarCopy(conteudo, { secao: "faq", campos: { titulo: "Dúvidas", itens: "Prazo?\nPreço?" } })!;
    expect((e1.opcoes as Array<{ secoes: Array<{ id: string; itens: string[] }> }>)[0].secoes[1]).toMatchObject({ id: "faq", itens: ["Prazo?", "Preço?"] });
    const e2 = editarCopy(conteudo, { campos: { headline: "um dois três quatro cinco seis sete oito nove" } })!;
    expect((e2.opcoes as Array<{ headline: string }>)[0].headline.split(" ").length).toBe(8);
    expect(editarCopy({ opcoes: [] }, { campos: {} })).toBeNull();
    expect(sujeitoDoSlot("Galeria", "Nosso espaço", "café artesanal")).toBe("Nosso espaço, no contexto de café artesanal");
  });
});

describe("diretor de site: as ações novas", () => {
  const listas = {
    siteId: "11111111-1111-4111-8111-111111111111",
    secoes: [{ id: "topo", construida: true }, { id: "hero", construida: true }, { id: "problema", construida: false }, { id: "rodape", construida: false }],
    trabalhos: [],
    opcoesDeCopy: [],
    paginas: [{ id: "inicio", titulo: "Início", secoes: 2 }],
    presetAtual: "suico",
    slotsParaGerar: 3,
  };
  const custos = { ajustar: 0.1, construir: 0.2, conteudo: 0.01, imagem: 0.05, mapa: 0.0002 };

  it("as operações estão no esquema e os alvos novos têm apelido (páginas p, presets e)", () => {
    expect(OPERACOES_DO_SITE).toEqual(expect.arrayContaining(["montar_mapa", "escolher_preset", "trocar_secao", "adicionar_secao", "remover_secao", "gerar_imagens_dos_slots"]));
    const refs = alvosDoSite(listas).map((a) => a.ref);
    expect(refs).toEqual(expect.arrayContaining(["p1", "e1", "e11", "x1"]));
  });

  it("preset é ordem sem custo com Desfazer; o atual é recusado com motivo", () => {
    const a = normalizarAcoesDoSite({ resumo: "", itens: [{ operacao: "escolher_preset", ref: "e1", para: "" }] }, listas, "c", custos)!;
    expect(a.itens[0]).toMatchObject({ operacao: "escolher_preset", alvo_id: "cinema_noturno" });
    expect(podeExecutarDireto(a, regrasDoSite(), { pedidoClaro: true }).direto).toBe(true);
    const suico = alvosDoSite(listas).find((x) => x.id === "suico")!.ref;
    expect(normalizarAcoesDoSite({ resumo: "", itens: [{ operacao: "escolher_preset", ref: suico, para: "" }] }, listas, "c", custos)!.recusados[0].motivo).toMatch(/já é o preset/);
    expect(caminhoDoSite("c", listas.siteId, a).destino).toMatch(/etapa=direcao/);
  });

  it("trocar seção construída custa uma construção; a não construída não custa; topo não troca nem sai", () => {
    const t = normalizarAcoesDoSite({ resumo: "", itens: [{ operacao: "trocar_secao", ref: "s2", para: "grade bento" }, { operacao: "trocar_secao", ref: "s3", para: "FAQ" }] }, listas, "c", custos)!;
    expect(t.itens.map((i) => [i.alvo_id, i.para])).toEqual([["hero", "bento"], ["problema", "faq"]]);
    expect(t.custo_estimado_usd).toBe(0.2);
    expect(podeExecutarDireto(t, regrasDoSite(), { pedidoClaro: true }).direto).toBe(false);
    const topo = normalizarAcoesDoSite({ resumo: "", itens: [{ operacao: "remover_secao", ref: "s1", para: "" }, { operacao: "trocar_secao", ref: "s4", para: "faq" }] }, listas, "c", custos)!;
    expect(topo.recusados.length).toBe(2);
    expect(normalizarAcoesDoSite({ resumo: "", itens: [{ operacao: "adicionar_secao", ref: "p1", para: "coisa nenhuma" }] }, listas, "c", custos)).toBeNull();
  });

  it("mapa e imagens dos slots: custo antes (Jev e imagem vezes os slots, até 4)", () => {
    const a = normalizarAcoesDoSite({ resumo: "", itens: [{ operacao: "montar_mapa", ref: "x1", para: "Landing de campanha" }, { operacao: "gerar_imagens_dos_slots", ref: "x1", para: "" }] }, listas, "c", custos)!;
    expect(a.itens.map((i) => [i.operacao, i.para])).toEqual([["montar_mapa", "landing"], ["gerar_imagens_dos_slots", "media"]]);
    expect(a.custo_estimado_usd).toBeCloseTo(0.0002 + 3 * 0.05, 6);
    expect(caminhoDoSite("c", listas.siteId, { itens: [{ operacao: "gerar_imagens_dos_slots" }] } as never).destino).toMatch(/etapa=imagens/);
  });
});

describe("fórmula de 6 blocos com o mapa, o preset e as integrações", () => {
  it("a seção de outra página diz a página, o padrão da biblioteca e usa o formulário da casa", () => {
    const mapa = mapaPadrao("institucional");
    const p = { cliente: "Café X", marca: { nome: "Café X" }, paleta: [], fontes: [], dna: null, direcao: {}, copy: null, imagens: [], fotos_reais: [], logo: null, secoes: secoesDoMapa(mapa), mapa, paginas: mapa.paginas.map((x) => ({ id: x.id, slug: x.slug, titulo: x.titulo, secoes: x.secoes.map((s) => s.uid) })), estilo: estiloDoPacote({ preset: "editorial_claro", motion: ["cascata"] }), integracoes: { formulario: { endpoint: "e", chave: "k" }, mapa: { endereco: "Rua" } } } as unknown as PacoteDoSite;
    const t = promptDaSecao(p, "contato-contato");
    expect(t).toMatch(/Contato com mapa/);
    expect(t).toMatch(/página "Contato" \(\/contato\/\)/);
    expect(t).toMatch(/site de 3 páginas/);
    expect(t).toMatch(/<Formulario \/>/);
    expect(t).toMatch(/<Mapa \/>/);
    expect(t).toMatch(/Preset de estilo: Editorial claro/);
    expect(t).toMatch(/Revelação em cascata/);
    expect(t).toMatch(/src\/secoes\/ContatoContato\.tsx/);
    const semForm = promptDaSecao({ ...p, integracoes: {} } as PacoteDoSite, "contato-contato");
    expect(semForm).toMatch(/sem formulário falso/);
    expect(promptDaSecao(p, "topo")).toMatch(/do layout \(aparece em todas as 3 página/);
  });
});

describe("motor: voltar para uma versão do código", () => {
  it("voltar_para só vale no desfazer; qualquer trabalho terminado com commit é versão", () => {
    expect(normalizarPedido({ tipo: "desfazer", voltar_para: true, alvo_trabalho_id: "11111111-1111-4111-8111-111111111111" }).voltar_para).toBe(true);
    expect(normalizarPedido({ tipo: "construir", voltar_para: true }).voltar_para).toBe(false);
    expect(podeVoltarPara({ estado: "feito", commit: "abc1234" })).toBe(true);
    expect(podeVoltarPara({ estado: "executando", commit: "abc1234" })).toBe(false);
    expect(podeVoltarPara({ estado: "feito", commit: null })).toBe(false);
    const fila = ler("supabase/functions/_shared/motor-fila.ts");
    expect(fila).toMatch(/voltar_para: true/);
    const worker = ler("workers/motor-codigo/lib/executar.ts");
    expect(worker).toMatch(/alvo\.voltar_para/);
    expect(worker).toMatch(/resultado\.arquivos = await arquivosMudados/);
  });
});

describe("modelo de site: casca multipágina, integrações e SEO", () => {
  it("a casca lista só arquivos da casa que existem (nunca as seções do agente)", () => {
    const casca = JSON.parse(ler("workers/motor-codigo/modelo-site/.aceleriq/casca.json")) as { versao: number; arquivos: string[] };
    expect(casca.versao).toBeGreaterThanOrEqual(2);
    casca.arquivos.forEach((a) => {
      expect(arquivoDaCascaValido(a)).toBe(true);
      expect(existsSync(resolve(raiz, "workers/motor-codigo/modelo-site", a))).toBe(true);
    });
    expect(arquivoDaCascaValido("src/secoes/Hero.tsx")).toBe(false);
    expect(arquivoDaCascaValido("../fora.ts")).toBe(false);
    expect(arquivoDaCascaValido("C:/x.ts")).toBe(false);
  });

  it("uma página HTML por página do mapa, com canonical, og, twitter e o schema só na inicial", () => {
    const pacote = { cliente: "Café X", paleta: [{ hex: "#00D52B" }], logo: "/marca/logo.png", imagens: [{ slot: "hero", arquivo: "/imagens/hero-1.png" }], copy: null, paginas: [{ id: "inicio", slug: "", titulo: "Início" }, { id: "sobre", slug: "sobre", titulo: "Sobre" }], seo: { titulo: "Café X", descricao: "Café artesanal", url: "https://cafex.com.br", indexar: true, schema: { "@type": "Restaurant", name: "Café </script> X" } } };
    const base = '<html lang="pt-BR"><head><title>Site</title><meta name="description" content="" /><meta property="og:title" content="" /><meta property="og:description" content="" /><meta property="og:image" content="" /><meta name="theme-color" content="#111111" /><link rel="icon" href="/marca/logo.png" /></head><body><div id="root"><!--app--></div></body></html>';
    expect(paginasDoPacote(pacote).map((p: { slug: string }) => p.slug)).toEqual(["", "sobre"]);
    const inicio = montarPagina(base, "<main><h1>Oi</h1></main>", pacote, paginasDoPacote(pacote)[0]);
    const sobre = montarPagina(base, "<main></main>", pacote, paginasDoPacote(pacote)[1]);
    expect(inicio).toMatch(/<link rel="canonical" href="https:\/\/cafex\.com\.br\/" \/>/);
    expect(inicio).toMatch(/application\/ld\+json/);
    expect(inicio).not.toMatch(/<\/script> X/);
    expect(inicio).toMatch(/og:image" content="https:\/\/cafex\.com\.br\/imagens\/hero-1\.png"/);
    expect(sobre).toMatch(/<title>Sobre \| Café X<\/title>/);
    expect(sobre).not.toMatch(/ld\+json/);
    expect(sitemapDoPacote(pacote, "2026-09-30")).toMatch(/cafex\.com\.br\/sobre\//);
    expect(sitemapDoPacote({ ...pacote, seo: { ...pacote.seo, indexar: false } }, "2026-09-30")).toBeNull();
    const fechado = montarPagina(base, "", { ...pacote, seo: { ...pacote.seo, indexar: false } }, paginasDoPacote(pacote)[0]);
    expect(fechado).toMatch(/noindex/);
    expect(revisarHtml(inicio.replace("<!--app-->", "")).some((a) => /schema/.test(a.texto))).toBe(false);
  });

  it("o App monta topo e rodapé em volta da página; rastreio só depois do consentimento; formulário com armadilha", () => {
    const app = ler("workers/motor-codigo/modelo-site/src/App.tsx");
    expect(app).toMatch(/paginaPeloCaminho\(caminho\)/);
    expect(app).toMatch(/<CamadaDeIntegracoes \/>/);
    const int = ler("workers/motor-codigo/modelo-site/src/lib/integracoes.tsx");
    expect(int).toMatch(/if \(v === "aceito"\) carregarRastreio\(\)/);
    expect(int).toMatch(/name="site_url"/);
    expect(int).toMatch(/iniciado_em: inicio\.current/);
    expect(int).toMatch(/push\(arguments\)/);
    expect(ler("workers/motor-codigo/modelo-site/src/main.tsx")).toMatch(/caminho=\{window\.location\.pathname\}/);
  });
});

describe("registro e banco da SIT2", () => {
  it("a etapa Integrações e SEO entra na lista, na pré-carga e na CHECK", () => {
    expect(ETAPAS_DO_SITE.map((e) => e.valor)).toEqual(["briefing", "referencias", "direcao", "conteudo", "imagens", "integracoes", "construcao", "revisao", "publicacao"]);
    expect(ler("src/lib/mesa/preCarga.ts")).toMatch(/integracoes: \(\) => import\("@\/components\/mesa-site\/EtapaIntegracoes"\)/);
    const sql = ler("supabase/migrations/20260930160000_mesa_site_evolucao.sql");
    expect(sql).toMatch(/'imagens', 'integracoes', 'construcao'/);
  });

  it("migration só amplia, lê por cliente, escreve só pelo backend e a RPC do lead confere a service_role", () => {
    const sql = ler("supabase/migrations/20260930160000_mesa_site_evolucao.sql");
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS mapa jsonb/);
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.site_versoes FROM anon, authenticated/);
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.site_formulario_envios FROM anon, authenticated/);
    expect((sql.match(/can_access_client\(client_id\)/g) || []).length).toBe(2);
    expect(sql).toMatch(/app_private\.rpc_trusted_backend\(\)/);
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.site_registrar_lead\([^)]*\) TO service_role/);
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.site_registrar_lead\([^)]*\) FROM PUBLIC, anon, authenticated/);
    expect(sql).toMatch(/interval '10 minutes'/);
    expect(sql).not.toMatch(/DELETE FROM/i);
    expect(sql).not.toMatch(/DROP TABLE/i);
  });
});
