import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  caixaDaLogo,
  caixaDaZona,
  FORMATOS_CRIATIVO,
  margensDoQuadro,
  promptDaLamina,
  QUADRO_FINAL,
  type CardDirecao,
  type MarcaParaDirecao,
  type ZonaTexto,
} from "../../supabase/functions/_shared/direcao-arte";
import { TAMANHO_DO_FORMATO, ZONA_SEGURA } from "../../supabase/functions/_shared/conhecimento-ads";

// Estúdio Ads (docs/mesa-ads/SPEC.md, seção "Estúdio Ads"): o estudio-arte
// gera criativos de anúncio quando o trabalho é tipo 'ads', sem mudar nada do
// post (social).
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const estudio = ler("supabase/functions/estudio-arte/index.ts");
const imagemLocal = ler("supabase/functions/_shared/imagem-local.ts");

/** Corpo de uma função de topo, do cabeçalho até a próxima função de topo. */
function corpoDe(nome: string): string {
  const ini = estudio.search(new RegExp(`\\n(?:export )?(?:async )?function ${nome}\\(`));
  expect(ini, `${nome} precisa existir`).toBeGreaterThan(-1);
  const resto = estudio.slice(ini + 1);
  const fim = resto.slice(10).search(/\n(?:export )?(?:async )?function |\n\/\/ -{10}|\nconst [A-Z_]+ = /);
  return fim < 0 ? resto : resto.slice(0, fim + 10);
}

const ZONAS: ZonaTexto[] = ["topo-esquerda", "topo-centro", "centro-esquerda", "centro", "base-esquerda", "base-centro", "base-direita", "coluna-esquerda", "coluna-direita"];

const marca = (): MarcaParaDirecao => ({
  nomeCliente: "Cliente",
  paleta: [
    { nome: "Azul", hex: "#1E5AA8", papel: "primaria" },
    { nome: "Ouro", hex: "#E0B040", papel: "destaque" },
  ],
  estilo: null,
  regras: null,
  fontes: [{ nome: "Inter", papel: "titulo" }],
  temLogo: true,
});

const card = (extra: Partial<CardDirecao> = {}): CardDirecao => ({
  ordem: 1,
  funcao: "capa",
  texto_exato: "Orçamento em 1 dia\nChame no WhatsApp",
  composicao: "",
  ilustracao: "produto em uso",
  prompt_imagem: "",
  layout: {
    zona_texto: "topo-esquerda",
    alinhamento: "esquerda",
    imagem: "produto em uso sobre a bancada",
    ponto_focal: "o produto",
    fundo: "bancada clara",
    tratamento: "editorial",
  },
  ...extra,
});

describe("Estúdio Ads: tamanho por formato", () => {
  it("gera 1088 x 1360 no feed, 1088 x 1088 no quadrado e 1088 x 1920 no stories; final 1080 de largura", () => {
    expect(TAMANHO_DO_FORMATO.feed_4x5).toMatchObject({ largura: 1088, altura: 1360 });
    expect(TAMANHO_DO_FORMATO.quadrado_1x1).toMatchObject({ largura: 1088, altura: 1088 });
    expect(TAMANHO_DO_FORMATO.stories_9x16).toMatchObject({ largura: 1088, altura: 1920 });
    expect(QUADRO_FINAL).toEqual({
      feed_4x5: { largura: 1080, altura: 1350 },
      quadrado_1x1: { largura: 1080, altura: 1080 },
      stories_9x16: { largura: 1080, altura: 1920 },
    });
    expect(FORMATOS_CRIATIVO).toEqual(["feed_4x5", "quadrado_1x1", "stories_9x16"]);
  });

  it("o quadro do card segue o formato só no trabalho de anúncio (sem formato: feed 4:5)", () => {
    const q = corpoDe("quadroDoCard");
    expect(estudio).toContain('const ehAds = (t: Pick<Trabalho, "tipo">) => t.tipo === "ads";');
    expect(q).toContain('FORMATOS_CRIATIVO.includes(card.formato as FormatoCriativo) ? card.formato as FormatoCriativo : "feed_4x5"');
    expect(q).toContain("const g = TAMANHO_DO_FORMATO[formato];");
    expect(q).toContain("final: QUADRO_FINAL[formato],");
    // 1:1 e 9:16 não caem na reserva 2:3 do motor (o recorte cortaria o texto).
    expect(q).toContain("fixo: tamanho !== TAMANHO_GERADOR,");
  });

  it("todos os modos de geração usam o tamanho do card", () => {
    const g = corpoDe("gerarCard");
    expect(g).toContain("const quadro = quadroDoCard(t, card);");
    // foto real do acervo e foto trazida pela equipe no tamanho do formato
    expect(g).toContain("await fotoRealNaLamina(foto, quadro.largura, quadro.altura)");
    // Reduzida pelo Storage antes do recorte (foto da Mesa Foto pode ser 4K), no tamanho do card.
    expect(g).toContain('await fotoDoBucketNaLamina("mesa", fundoLivre.caminho, quadro.largura, quadro.altura)');
    // foto composta
    expect(g).toContain("editar: { bytes: baseFoto }, tamanho: quadro.tamanho, tamanhoFixo: quadro.fixo");
    // foto real com máscara e devolução do original
    expect(g).toContain("mascara: await mascara(quadro.largura, quadro.altura, areas)");
    expect(g).toContain("} else if (img.tamanho === quadro.tamanho) {");
    expect(g).toContain("const volta = await devolverOriginalAlinhado(baseFoto, img.png, areas");
    expect(g).not.toContain("mascara(1088, 1360");
    // normal
    expect(g).toContain("tamanho: card.layout ? quadro.tamanho : TAMANHO_2X3,");
    expect(g).toContain("tamanhoFixo: !!card.layout && quadro.fixo,");
    // ajuste por área e de fundo
    const a = corpoDe("ajustarCard");
    expect(a).toContain("const quadro = quadroDoCard(base, card);");
    expect(a).toContain("await fotoRealNaLamina(fotoFundo, quadro.largura, quadro.altura)");
    expect(a).toContain("(card.layout ? quadro.tamanho : TAMANHO_2X3)");
    // leitura da conferência e entrega no quadro final do formato
    expect(corpoDe("verificar")).toContain("await laminaFinal(caminho, quadro.final)");
    expect(corpoDe("laminaFinal")).toContain("Math.abs(d.largura / d.altura - alvo.largura / alvo.altura) < 0.01");
    // O Storage só reduz a foto inteira; o recorte com foco no tamanho do card é feito na função.
    expect(corpoDe("fotoRealNaLamina")).toContain("return await fotoDoBucketNaLamina(a.storage_bucket, a.storage_path, largura, altura);");
    expect(corpoDe("fotoDoBucketNaLamina")).toContain("return await fotoNaLamina(reduzida ?? await baixar(bucket, caminho), largura, altura);");
    expect(imagemLocal).toContain("export async function fotoNaLamina(bytes: Uint8Array, largura = LARGURA_LAMINA, altura = ALTURA_LAMINA)");
    expect(imagemLocal).toContain("return await cobrirComFoco(await decodificar(bytes), largura, altura).encode(1);");
  });
});

describe("Estúdio Ads: zona segura", () => {
  it("stories: nenhuma zona de texto nem a logo nos 14% de cima nem nos 20% de baixo", () => {
    expect(ZONA_SEGURA.stories_9x16).toMatchObject({ topo: 0.14, base: 0.2 });
    for (const z of ZONAS) {
      for (const capa of [true, false]) {
        const c = caixaDaZona(z, capa, false, "stories_9x16");
        expect(c.y0, `${z} topo`).toBeGreaterThanOrEqual(14);
        expect(c.y1, `${z} base`).toBeLessThanOrEqual(80);
        expect(c.x0).toBeGreaterThanOrEqual(6);
        expect(c.x1).toBeLessThanOrEqual(94);
        const l = caixaDaLogo(z, capa, "stories_9x16");
        expect(l.y0).toBeGreaterThanOrEqual(14);
        expect(l.y1).toBeLessThanOrEqual(80);
      }
    }
  });

  it("1:1 e feed: margens do grid convertidas pela altura do formato, sem recorte da grade do perfil", () => {
    expect(margensDoQuadro("quadrado_1x1")).toEqual({ x: 8.3, topo: 9.3, base: 9.8, capaExtra: 0 });
    expect(margensDoQuadro("feed_4x5")).toEqual({ x: 8.3, topo: 7.4, base: 7.9, capaExtra: 0 });
    expect(margensDoQuadro("stories_9x16")).toEqual({ x: 8.3, topo: 14, base: 20, capaExtra: 0 });
    // 26/09: a área da logo sai do tamanho da logo (tamanhoDaLogo), igual em px em qualquer formato:
    // logo horizontal comum (3:1) com 324 x 108 px, com folga de 25% na altura.
    expect(caixaDaLogo("centro", false, "stories_9x16").y1 - caixaDaLogo("centro", false, "stories_9x16").y0).toBeCloseTo(7, 1);
    expect(caixaDaLogo("centro", false, "quadrado_1x1").y1 - caixaDaLogo("centro", false, "quadrado_1x1").y0).toBeCloseTo(12.5, 1);
  });

  it("o prompt da peça única troca carrossel por criativo, leva regrasDoCriativo e as margens da zona segura", () => {
    const p = promptDaLamina(card({ formato: "stories_9x16" }), marca(), {
      total: 1,
      carrosselInfinito: true,
      levaLogo: true,
      fioVisual: "mesma modelo",
      anuncio: { formato: "stories_9x16" },
    });
    expect(p).toContain("ARTE FINAL de criativo de anúncio");
    expect(p).toContain("Stories e Reels 9:16 (1080 x 1920)");
    expect(p).toContain("Uma peça só, com uma mensagem só");
    expect(p).toContain("CRIATIVO QUE PARA A ROLAGEM");
    expect(p).toContain("CRIATIVO DE ANÚNCIO");
    expect(p).toContain("nos 14% de cima, nos 20% de baixo");
    expect(p).toContain("269 px no topo e 384 px na base");
    expect(p).toContain("numa arte de 1080 x 1920");
    expect(p).toContain("dentro das margens e da zona segura");
    expect(p).toContain("cada linha dela ocupa cerca de 6% da altura do quadro");
    for (const proibido of ["carrossel, lâmina", "post único", "contador do carrossel", "Carrossel contínuo", "CONTINUIDADE DA SÉRIE", "grade do perfil", "Arte vertical 4:5", "CAPA QUE PARA A ROLAGEM"]) {
      expect(p, proibido).not.toContain(proibido);
    }
    const q = promptDaLamina(card({ formato: "quadrado_1x1" }), marca(), { total: 1, carrosselInfinito: false, levaLogo: true, anuncio: { formato: "quadrado_1x1" } });
    expect(q).toContain("Arte quadrada 1:1 (1080 x 1080)");
    expect(q).toContain("100 px no topo e 106 px na base");
  });

  it("carrossel de anúncio (cards feed 4:5 da mesa-ads) segue como série, mas nunca contínuo", () => {
    const miolo = card({ ordem: 2, funcao: "conteudo", formato: "feed_4x5" });
    const p = promptDaLamina(miolo, marca(), {
      total: 4,
      carrosselInfinito: true,
      levaLogo: false,
      fioVisual: "mesma modelo",
      anteriores: ["capa com a modelo"],
      anuncio: { formato: "feed_4x5" },
    });
    expect(p).toContain("carrossel de anúncio, card 2 de 4");
    expect(p).toContain("CONTINUIDADE DA SÉRIE");
    expect(p).toContain("contador do carrossel");
    expect(p).toContain("CRIATIVO DE ANÚNCIO");
    expect(p).not.toContain("Carrossel contínuo");
    expect(p).not.toContain("CRIATIVO QUE PARA A ROLAGEM");
  });

  it("as áreas da máscara da foto real seguem o formato e o prompt do gerador recebe o anúncio", () => {
    const areas = corpoDe("areasDeDesenho");
    expect(areas).toContain("caixaDaZona(zona, capa, total > 1, formato, post)");
    expect(areas).toContain("caixaDaLogo(zona, capa, formato, post, aspecto)");
    expect(corpoDe("gerarCard")).toContain("anuncio: quadro.formato ? { formato: quadro.formato } : null,");
  });
});

describe("Estúdio Ads: conferência de política", () => {
  const v = corpoDe("verificar");
  it("o Jev julga o risco de política (NIVEIS_RISCO_POLITICA) com a descrição lida e o texto exato", () => {
    expect(estudio).toContain('import { NIVEIS_CLAREZA, NIVEIS_RISCO_POLITICA, POLITICAS_META, TAMANHO_DO_FORMATO } from "../_shared/conhecimento-ads.ts";');
    expect(v).toContain("if (ads) {\n      questions.politica = {");
    expect(v).toContain("criteria: NIVEIS_RISCO_POLITICA,");
    expect(v).toContain("descricao_visual: v.descricao_visual,\n              texto_exato: card.texto_exato,");
    expect(v).toContain("politicas_meta: POLITICAS_META,");
    expect(v).toContain("v.politica = notaDoJev(res.answers.politica, NIVEIS_RISCO_POLITICA);");
    expect(v).toContain("v.clareza = notaDoJev(res.answers.clareza, NIVEIS_CLAREZA);");
    // Texto, identidade e logo continuam.
    expect(v).toContain("const cmp = compararTexto(card.texto_exato, v.texto_lido);");
    expect(v).toContain("v.identidade = notaDoJev(res.answers.identidade, NIVEIS_IDENTIDADE);");
    expect(v).toContain("v.logo_ok =");
    expect(estudio).toMatch(/politica\?: NotaJev \| null;/);
    expect(corpoDe("notaDoJev")).toContain("escala_max: niveis.length - 1,");
  });
  it("no post a conferência pergunta só a identidade", () => {
    expect(v).toContain("const ads = ehAds(t);");
    expect(v.indexOf("questions.politica")).toBeGreaterThan(v.indexOf("if (ads) {"));
  });
});

describe("Estúdio Ads: sem panorama nem série", () => {
  it("usaPanorama é falso no anúncio e o contínuo não vale", () => {
    expect(corpoDe("usaPanorama")).toContain("if (ehAds(t)) return false;");
    const g = corpoDe("gerarCard");
    expect(g).toContain("const infinito = !ads && !!t.direcao.carrossel_infinito;");
    // A tela dupla saiu em 25/09; a capa guia a série (fora do replicar), no post e no carrossel de anúncio.
    expect(g).not.toContain("const continuar =");
    expect(g).toContain("const capa = ordem > 1 && total > 1 ? versaoAtual(t, 1) : null;");
    expect(g).toContain("carrosselInfinito: infinito && !panorama,");
    expect(corpoDe("regrasDeRender")).toContain("t.direcao.carrossel_infinito && !ehAds(t)");
    expect(corpoDe("configurar")).toContain("carrossel_infinito: infinito && cards.length > 1 && !ehAds(x)");
  });
});

describe("Estúdio Ads: preparar e entregar", () => {
  it("preparar usa a direção existente do trabalho de anúncio, sem diretor nem agenda", () => {
    const p = corpoDe("preparar");
    expect(p.indexOf("if (ehAds(alvo)) return await prepararAnuncio(ch, alvo, corpo);")).toBeLessThan(p.indexOf("lerItemDaAgenda("));
    const pa = corpoDe("prepararAnuncio");
    expect(pa).toContain("await garantirAcesso(ch, t.client_id);");
    expect(pa).toContain('modo: "existente"');
    expect(pa).not.toContain("chamarTexto(");
    expect(pa).not.toContain("lerItemDaAgenda(");
  });

  it("entregar grava cada criativo em Arquivos (pasta criativos), fora de file_ids, da agenda e da aprovação", () => {
    expect(corpoDe("entregar")).toContain("if (ehAds(t)) return await entregarAnuncio(ch, t, corpo);");
    const e = corpoDe("entregarAnuncio");
    expect(e).toContain('folder: "criativos"');
    expect(e).toContain('file_type: ehCarrossel ? "carrossel" : formato === "stories_9x16" ? "story" : "post"');
    expect(e).toContain("parent_file_id: ehCarrossel && i > 0 ? paiId : null,");
    expect(e).toContain('ch.doChamador.rpc("create_file_record"');
    expect(e).toContain("await laminaFinal(versao!.storage_path, quadro.final)");
    expect(e).toContain("idempotency_key: chave,");
    expect(e).toContain('status: "entregue", direcao: { ...x.direcao, entrega_ads: entrega }');
    for (const proibido of ["file_ids: fileIds, status", "caption", "mesa_enviar_para_aprovacao(", "mesa_agendamento", "legendaComHashtags"]) {
      expect(e, proibido).not.toContain(proibido);
    }
    // Sem item da agenda, sem projeto; com item, só o projeto.
    expect(e).toContain("let projetoId: string | null = null;");
    expect(corpoDe("legenda")).toContain('"anuncio_sem_legenda"');
  });
});

describe("Estúdio Ads: post (social) inalterado", () => {
  it("sem formato, caixas e prompt seguem o 4:5 de sempre (1088 x 1360, final 1080 x 1350)", () => {
    expect(margensDoQuadro(null)).toEqual({ x: 8.3, topo: 7.4, base: 7.9, capaExtra: 3.1 });
    for (const z of ZONAS) {
      for (const capa of [true, false]) {
        for (const carrossel of [true, false]) {
          expect(caixaDaZona(z, capa, carrossel, null)).toEqual(caixaDaZona(z, capa, carrossel));
        }
      }
    }
    // Capa de carrossel continua com o recorte 3:4 da grade do perfil.
    expect(caixaDaZona("base-esquerda", true).x0).toBeCloseTo(11.4, 1);
    const p = promptDaLamina(card(), marca(), { total: 5, carrosselInfinito: false, levaLogo: true });
    expect(p).toContain("ARTE FINAL de carrossel, lâmina 1 de 5 para o Instagram da marca.");
    expect(p).toContain("- Arte vertical 4:5 (1080 x 1350), usando o quadro inteiro, sem bordas vazias.");
    expect(p).toContain("numa arte de 1080 x 1350");
    expect(p).toContain("cada linha dela ocupa cerca de 9% da altura do quadro");
    expect(p).toContain("contador do carrossel");
    expect(p).not.toContain("CRIATIVO DE ANÚNCIO");
    // Um card social com formato por engano não vira anúncio (o formato só vale com a opção anuncio).
    expect(promptDaLamina(card({ formato: "stories_9x16" }), marca(), { total: 5, carrosselInfinito: false, levaLogo: true })).toBe(p);
  });

  it("o trabalho social tem quadro 1088 x 1360 e tamanho TAMANHO_GERADOR", () => {
    expect(estudio).toContain("const TAMANHO_GERADOR = TAMANHO_4X5;");
    expect(corpoDe("quadroDoCard")).toMatch(
      /return \{\s*formato: null,\s*post,\s*largura: LARGURA_LAMINA,\s*altura: ALTURA_LAMINA,\s*tamanho: TAMANHO_GERADOR,\s*final: \{ largura: LARGURA_FINAL, altura: ALTURA_FINAL \},\s*proporcao: "4:5",\s*fixo: false,/,
    );
    expect(imagemLocal).toContain("export const LARGURA_LAMINA = 1088;");
    expect(imagemLocal).toContain("export const ALTURA_LAMINA = 1360;");
    expect(estudio).toContain("const LARGURA_FINAL = 1080;");
    expect(estudio).toContain("const ALTURA_FINAL = 1350;");
  });

  it("sem travessão no código novo", () => {
    expect(estudio).not.toContain("—");
    expect(ler("supabase/functions/_shared/direcao-arte.ts")).not.toContain("—");
  });
});
