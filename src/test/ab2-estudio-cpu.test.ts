import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { TETO_BASE64_DAS_IMAGENS, tamanhoEmBase64 } from "../../supabase/functions/_shared/capacidades-imagem";
import { AGENTES_DO_PAINEL, blocoDoMapaDoPainel, TITULO_DO_MAPA } from "../../supabase/functions/_shared/mapa-do-painel";
import {
  abreAqui,
  anexoCruServe,
  caminhoDoRecorteFinal,
  destinoDaReducao,
  laminaJaNoFormato,
  MAX_BYTES_ANEXO_CRU,
  MAX_BYTES_ANEXO_SEM_COPIA,
  MAX_PIXELS_LEITURA_EM_LOTE,
  MAX_PIXELS_REDUZIR_ANEXO,
  MAX_RECORTES_NA_ENTREGA,
  mensagemDaEntregaEmPartes,
  textoDoTamanho,
} from "../../supabase/functions/estudio-arte/imagens-leves";

/**
 * Anti-bug AB2 (26/09), subfrente Estúdio: CPU e tamanho das imagens no
 * estudio-arte (a cópia leve em vez do original gigante e quantas imagens abrem
 * por chamada) e o mapa do painel na conversa do diretor. O resultado aprovado
 * não muda: só de onde vêm os bytes.
 */
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");
const estudio = ler("supabase/functions/estudio-arte/index.ts");
const leves = ler("supabase/functions/estudio-arte/imagens-leves.ts");

/** Corpo de uma função de topo, do cabeçalho até a próxima função de topo. */
function corpoDe(nome: string): string {
  const ini = estudio.search(new RegExp(`\\n(?:export )?(?:async )?function ${nome}\\(`));
  expect(ini, `${nome} precisa existir`).toBeGreaterThan(-1);
  const resto = estudio.slice(ini + 1);
  const fim = resto.slice(10).search(/\n(?:export )?(?:async )?function |\n\/\/ -{10}|\nconst [A-Z_]+ = /);
  return fim < 0 ? resto : resto.slice(0, fim + 10);
}

const TETO = 6_000_000;

describe("AB2 Estúdio: foto na lâmina", () => {
  it("baixarReduzida pede a cópia leve e fotoDoBucketNaLamina nunca abre o original acima do teto", () => {
    // A mesma redução de sempre (o resultado aprovado não muda) e a cópia pedida quando falta.
    const b = corpoDe("baixarReduzida");
    expect(b).toContain("return await comCopiaLeve(bucket, caminho, async () => await reduzidaSemTransformacao(servico(), bucket, caminho, 2000, 2500, { folga: 1.05, maxBytes: MAX_BYTES_IMAGEM }));");
    const f = corpoDe("fotoDoBucketNaLamina");
    const guarda = f.indexOf('destinoDaReducao(reduzida, MAX_PIXELS_REDUCAO_NA_FUNCAO) === "grande_demais"');
    expect(guarda).toBeGreaterThan(0);
    expect(guarda).toBeLessThan(f.indexOf("await fotoNaLamina("));
    expect(f).toContain('new ErroEstudio(413, "foto_grande_demais"');
    // A foto grande tem o seu aviso; não vira "foto sumida".
    const g = corpoDe("gerarCard");
    const fundo = g.slice(g.indexOf('await fotoDoBucketNaLamina("mesa", fundoLivre.caminho'), g.indexOf('"foto_sumiu"'));
    expect(fundo).toContain("if (e instanceof ErroEstudio && e.status === 413) throw e;");
    // Pura: cópia ou reduzida usa; original leve abre como antes; 25 MP nunca abre.
    expect(destinoDaReducao({ cabe: true, largura: 2048, altura: 1536 }, TETO)).toBe("usar");
    expect(destinoDaReducao({ cabe: false, largura: 2000, altura: 2000 }, TETO)).toBe("abrir_aqui");
    expect(destinoDaReducao({ cabe: false, largura: 5000, altura: 5000 }, TETO)).toBe("grande_demais");
    expect(destinoDaReducao({ cabe: false, largura: null, altura: null }, TETO)).toBe("grande_demais");
    expect(textoDoTamanho({ largura: 8000, altura: 6000 })).toBe("8000 x 6000 px");
  });

  it("comCopiaLeve: primeiro a redução de sempre; só com cabe:false pede a cópia e reduz de novo", () => {
    const c = corpoDe("comCopiaLeve");
    const primeira = c.indexOf("const r = await reduzir();");
    const cedo = c.indexOf("if (r && r.cabe) return r;");
    const pede = c.indexOf("await pedirCopiaLeve(bucket, caminho)");
    const deNovo = c.indexOf("await comACopia()");
    expect(primeira).toBeGreaterThan(0);
    expect(cedo).toBeGreaterThan(primeira);
    expect(pede).toBeGreaterThan(cedo);
    expect(deNovo).toBeGreaterThan(pede);
    // Sem laço: uma cópia pedida, uma redução de novo.
    expect(c).not.toMatch(/\bwhile\b|\bfor\s*\(/);
    expect(c).toContain("return deNovo && deNovo.cabe ? deNovo : r;");
  });
});

describe("AB2 Estúdio: logo", () => {
  it("a logo pede a cópia (PNG com transparência, como o painel) e não abre a logo acima do teto", () => {
    const l = corpoDe("baixarLogoReduzida");
    expect(l).toContain("comCopiaLeve(");
    // Primeiro a regra de sempre (só cópia em PNG); com a cópia pedida, a que a copias-leves gravou.
    expect(l).toContain("reduzidaSemTransformacao(servico(), bucket, caminho, 1024, 1024, { copiaSoEmPng: true, maxBytes: MAX_BYTES_IMAGEM })");
    expect(l).toContain("async () => await reduzidaSemTransformacao(servico(), bucket, caminho, 1024, 1024, { maxBytes: MAX_BYTES_IMAGEM }),");
    expect(l.indexOf("copiaSoEmPng: true")).toBeLessThan(l.indexOf("1024, 1024, { maxBytes: MAX_BYTES_IMAGEM })"));
    // Limpar e medir abrem a logo: só até o teto.
    const b = corpoDe("baixarLogo");
    expect(b.indexOf("if (!abreAqui(dimensoesDoCabecalho(bruta.bytes), MAX_PIXELS_REDUCAO_NA_FUNCAO)) return bruta;")).toBeLessThan(b.indexOf("await logoLimpa("));
    // Frente FS (29/09): a medida que falha agora fica no log (nuloComLog); o teto continua antes de abrir.
    expect(corpoDe("logosDoKit")).toContain("abreAqui(dimensoesDoCabecalho(imagem.bytes), MAX_PIXELS_REDUCAO_NA_FUNCAO) ? await analisarLogo(imagem.bytes).catch(nuloComLog(");
    // A cópia leve da copias-leves grava PNG quando há transparência.
    expect(ler("supabase/functions/copias-leves/index.ts")).toContain('const tipo = alfa ? "image/png" : "image/jpeg";');
  });
});

describe("AB2 Estúdio: leituras por visão", () => {
  it("rostos_marcar (12 fotos): pede a cópia com teto de pixels baixo e pula a foto que não coube", () => {
    const m = corpoDe("marcarPessoasNasFotos");
    expect(m).toContain("reduzidaSemTransformacao(servico(), l.bucket, l.caminho, 768, 768, { folga: 1.1, maxBytes: MAX_BYTES_IMAGEM, pedirCopia: true, maxPixels: MAX_PIXELS_LEITURA_EM_LOTE })");
    expect(m).toContain("return red && red.cabe ? {");
    expect(m).not.toContain("return red ? {");
    expect(MAX_PIXELS_LEITURA_EM_LOTE).toBe(700_000);
  });

  it("conferir_rosto: cópia pedida para as fotos e nunca o original grande (cabe:false fica de fora)", () => {
    const c = corpoDe("conferirRosto");
    expect(c).toContain("comCopiaLeve(f.bucket, f.caminho, async () => await reduzidaSemTransformacao(servico(), f.bucket, f.caminho, 1024, 1024, { folga: 1.1, maxBytes: MAX_BYTES_IMAGEM }))");
    expect(c).toContain("const reais = fotos.filter((f): f is ResultadoDaReducao => !!f && f.cabe);");
    expect(c).toContain("const arte = arteReduzida && arteReduzida.cabe ? arteReduzida : null;");
    // Continua só aviso, guardada, sem laço.
    expect(c).toContain('if (ja && typeof ja === "object") return json({ trabalho_id: t.id, ordem, versao: alvo.versao, conferencia: ja, custo_usd: 0 });');
  });
});

describe("AB2 Estúdio: recorte, prancha e molde abrem a cópia", () => {
  it("recorteNaCaixa abre a cópia leve do recorte (PNG), nunca o arquivo cru gigante", () => {
    expect(estudio).not.toContain("recorteNaCaixa(await baixar(");
    expect((estudio.match(/recorteNaCaixa\(await bytesDoRecorte\(/g) || []).length).toBe(2);
    const r = corpoDe("bytesDoRecorte");
    expect(r).toContain('copiaMediaGravada("mesa", caminho, true)');
    expect(r).toContain('await pedirCopiaLeve("mesa", caminho)');
    expect(r).toContain("Math.max(d.largura, d.altura) <= LADO_MEDIA");
    expect(r).toContain("if (cru && abreAqui(d, MAX_PIXELS_REDUCAO_NA_FUNCAO)) return cru;");
    expect(r).toContain('new ErroEstudio(413, "recorte_grande_demais"');
    // A cópia do recorte só serve em PNG (a de JPEG perderia a transparência).
    expect(corpoDe("copiaMediaGravada")).toContain('(soPng && mime !== "image/png")');
    // Grande demais tem o seu aviso no gerar; no ajuste fica o que o gerador manteve.
    const g = corpoDe("gerarCard");
    const trecho = g.slice(g.indexOf("await bytesDoRecorte(recortado.caminho)"), g.indexOf('"recorte_sumiu"'));
    expect(trecho).toContain("if (e instanceof ErroEstudio && e.status === 413) throw e;");
  });

  it("quadro da prancha e molde: a referência vem leve (anexoLeve) e o recorte do quadro não abre acima do teto", () => {
    // Frente FS (29/09): imagemDaReferencia confere o arquivo (defeitoDaImagem) e os bytes vêm da Crua.
    expect(corpoDe("imagemDaReferencia")).toContain("await imagemDaReferenciaCrua(ref)");
    const i = corpoDe("imagemDaReferenciaCrua");
    expect(i).not.toContain("baixarImagem(");
    expect((i.match(/await anexoLeve\(/g) || []).length).toBe(3);
    const q = corpoDe("recortarQuadro");
    expect(q.indexOf("if (!abreAqui(dimensoesDoCabecalho(imagem.bytes), MAX_PIXELS_REDUCAO_NA_FUNCAO)) return null;")).toBeLessThan(q.indexOf("await decodificar(imagem.bytes)"));
    // O molde e a leitura da prancha recebem a mesma imagem da referência.
    // Frente FS: a referência que não abre agora deixa log e aviso (antes: .catch(() => null) em silêncio).
    const g = corpoDe("gerarCard");
    expect(g).toContain("const imagensDasRefs = replicar\n    ? await Promise.all(refsDaEquipe.map((r, i) =>\n      imagemDaReferencia(r).catch((e) => {");
    // Pura: 6 MP abre; 12 MP e tamanho desconhecido não.
    expect(abreAqui({ largura: 3000, altura: 2000 }, TETO)).toBe(true);
    expect(abreAqui({ largura: 4000, altura: 3000 }, TETO)).toBe(false);
    expect(abreAqui(null, TETO)).toBe(false);
  });
});

describe("AB2 Estúdio: entrega não abre 10 lâminas numa chamada", () => {
  it("recorte final guardado (feito uma vez) e no máximo MAX_RECORTES_NA_ENTREGA aberturas por chamada", () => {
    const l = corpoDe("laminaFinal");
    // O caminho de sempre continua: na proporção, vai sem abrir.
    expect(l).toContain("Math.abs(d.largura / d.altura - alvo.largura / alvo.altura) < 0.01 && d.largura <= alvo.largura * 1.5");
    expect(l).toContain("const guardado = caminhoDoRecorteFinal(caminho, alvo);");
    expect(l.indexOf('await baixar("mesa", guardado)')).toBeLessThan(l.indexOf("await recortarNaProporcao(original"));
    expect(l).toContain("abriu: recorte.reduziu");
    for (const nome of ["entregar", "entregarAnuncio"]) {
      const e = corpoDe(nome);
      const limite = e.indexOf("if (aberturas >= MAX_RECORTES_NA_ENTREGA && !laminaJaNoFormato(");
      expect(limite, nome).toBeGreaterThan(0);
      expect(limite, nome).toBeLessThan(e.indexOf("await laminaFinal(versao!.storage_path"));
      expect(e, nome).toContain('"entrega_em_partes"');
      expect(e, nome).toContain("if (lamina.abriu) aberturas++;");
    }
    // As linhas que os outros testes conferem continuam iguais.
    expect(corpoDe("entregar")).toContain("const lamina = await laminaFinal(versao!.storage_path, quadroFinal);");
    expect(MAX_RECORTES_NA_ENTREGA).toBe(3);
    // Pura: o tamanho gravado na versão diz se a entrega abre a lâmina.
    const alvo = { largura: 1080, altura: 1350 };
    expect(laminaJaNoFormato("1088x1360", alvo)).toBe(true);
    expect(laminaJaNoFormato("1024x1536", alvo)).toBe(false);
    expect(laminaJaNoFormato(undefined, alvo)).toBe(false);
    expect(laminaJaNoFormato("1088x1088", { largura: 1080, altura: 1080 })).toBe(true);
    expect(caminhoDoRecorteFinal("c/estudio/t/card-1-v2.png", alvo)).toBe("c/estudio/t/card-1-v2.png.final-1080x1350.png");
    const msg = mensagemDaEntregaEmPartes(3, 10);
    expect(msg).toContain("3 de 10 lâminas já estão em Arquivos");
    expect(msg).toContain("Entregar de novo");
    expect(msg).toContain("as 7 que faltam");
    expect(mensagemDaEntregaEmPartes(9, 10)).toContain("a que falta");
  });
});

describe("AB2 Estúdio: anexos no teto de 24 MB", () => {
  it("anexo cru leve segue igual; o pesado vira a cópia de 2048 px; sem cópia, até 12 MB", () => {
    const a = corpoDe("anexoLeve");
    const cru = a.indexOf("anexoCruServe(cru.byteLength, d, MAX_PIXELS_REDUCAO_NA_FUNCAO)) return comNome(cru, mime);");
    const copia = a.indexOf("await copiaMedia(bucket, caminho, soPng)");
    const queda = a.indexOf("cru.byteLength <= MAX_BYTES_ANEXO_SEM_COPIA");
    expect(cru).toBeGreaterThan(0);
    expect(copia).toBeGreaterThan(cru);
    expect(queda).toBeGreaterThan(copia);
    expect(a).toContain('new ErroEstudio(413, "imagem_grande_demais"');
    // copiaMedia: a gravada ou pedida à copias-leves, uma vez.
    expect(corpoDe("copiaMedia")).toContain("(await pedirCopiaLeve(bucket, caminho)) ? await copiaMediaGravada(bucket, caminho, soPng) : null");
    // Onde ia cru: elemento fora do replicar (PNG no recorte), selo, estilo e template.
    const g = corpoDe("gerarCard");
    expect(g).toContain('imagemReduzida("mesa", el.caminho, "elemento-real") : anexoLeve("mesa", el.caminho, "elemento-real", !!el.recortada)');
    expect(g).toContain('anexoLeve("mesa", selo, "selo-da-campanha", true)');
    expect(g).not.toContain('baixarImagem("mesa", el.caminho');
    expect((g.match(/baixar: anexoLeve,/g) || []).length).toBe(2);
    expect(g).not.toContain("baixar: baixarImagem,");
    // Foto anexada reduzida (rosto, elemento no replicar): só reduz aqui o barato; sem cópia, até 12 MB.
    const r = corpoDe("imagemReduzida");
    expect(r).toContain("maxPixels: MAX_PIXELS_REDUZIR_ANEXO");
    expect(r).toContain("comCopiaLeve(");
    expect(r).toContain("reduzida.bytes.byteLength > MAX_BYTES_ANEXO_SEM_COPIA");
    expect(MAX_PIXELS_REDUZIR_ANEXO).toBe(1_500_000);
    // Pura: pin, print e capa gerada seguem crus; foto 4K de 18 MB ou 12 MP não.
    expect(anexoCruServe(2 * 1024 * 1024, { largura: 1170, altura: 2532 }, TETO)).toBe(true);
    expect(anexoCruServe(18 * 1024 * 1024, { largura: 3840, altura: 2160 }, TETO)).toBe(false);
    expect(anexoCruServe(3 * 1024 * 1024, { largura: 4000, altura: 3000 }, TETO)).toBe(false);
    expect(anexoCruServe(1024, null, TETO)).toBe(false);
    // Um anexo cru no limite ocupa só um terço do teto do provedor; o que ia antes (20 MB) passava dele sozinho.
    expect(tamanhoEmBase64(MAX_BYTES_ANEXO_CRU) * 3).toBeLessThanOrEqual(TETO_BASE64_DAS_IMAGENS);
    expect(tamanhoEmBase64(20 * 1024 * 1024)).toBeGreaterThan(TETO_BASE64_DAS_IMAGENS);
    expect(tamanhoEmBase64(MAX_BYTES_ANEXO_SEM_COPIA)).toBeLessThan(TETO_BASE64_DAS_IMAGENS);
  });
});

describe("F: mapa do painel na conversa do Estúdio", () => {
  it("o diretor de arte recebe o mapa na conversa e nunca no prompt de imagem", () => {
    const eu = AGENTES_DO_PAINEL.find((a) => a.chave === "estudio");
    expect(eu && eu.funcao).toBe("estudio-arte");
    const bloco = blocoDoMapaDoPainel("estudio");
    expect(bloco.indexOf(TITULO_DO_MAPA)).toBe(0);
    expect(bloco).toContain("Você é o diretor de arte do Estúdio");
    expect(bloco).not.toMatch(/[—–]/);
    const c = corpoDe("conversar");
    const sistema = c.slice(c.indexOf("const sistema = ["), c.indexOf('].filter(Boolean).join("\\n\\n");', c.indexOf("const sistema = [")));
    const mapa = sistema.indexOf('blocoDoMapaDoPainel("estudio"),');
    expect(mapa).toBeGreaterThan(sistema.indexOf("INSTRUCOES_CONVERSA,"));
    // Cérebro e dossiê continuam no fim.
    expect(mapa).toBeLessThan(sistema.indexOf("doDiretor.texto,"));
    // Só uma vez no arquivo: nada de mapa na geração, no ajuste, na legenda ou na direção.
    expect((estudio.match(/blocoDoMapaDoPainel\(/g) || []).length).toBe(1);
    for (const nome of ["gerarCard", "ajustarCard", "legenda", "preparar", "refinarTexto"]) expect(corpoDe(nome), nome).not.toContain("blocoDoMapaDoPainel");
  });
});

describe("AB2 Estúdio: textos", () => {
  it("mensagens novas sem travessão e o módulo puro sem Deno, npm ou abrir imagem", () => {
    expect(leves).not.toMatch(/[—–]/);
    expect(leves).not.toMatch(/from "(npm:|https:)/);
    expect(leves).not.toMatch(/^import (?!type )/m);
    for (const codigo of ["foto_grande_demais", "recorte_grande_demais", "entrega_em_partes"]) {
      const i = estudio.indexOf(`"${codigo}"`);
      expect(i, codigo).toBeGreaterThan(0);
      expect(estudio.slice(i, estudio.indexOf("\n", i)), codigo).not.toMatch(/[—–]/);
    }
  });
});
