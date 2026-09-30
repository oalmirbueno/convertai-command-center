import { supabase } from "@/integrations/supabase/client";
import { coresDoBrandbook, imagensDoBrandbook, logosDoBrandbook, SLOTS_DE_LOGO, type DadosDoBrandbook, type ModeloDoBrandbook } from "../../../supabase/functions/mesa-identidade/modulos/brandbook";
import { PERFIS, textoCmyk, textoRgb } from "../../../supabase/functions/_shared/cores-da-marca";
import { normalizarEstrategia, rotuloDoArquetipo, textoDoEixo, EIXOS_DE_PERSONALIDADE } from "../../../supabase/functions/_shared/estrategia-de-marca";
import { urlDoGoogleFonts } from "../../../supabase/functions/_shared/tipografia-da-marca";

/**
 * Exportar no navegador (etapa Guideline): o PDF do brandbook (o mesmo
 * gerador da função, com as prévias reais das logos) e o pacote da marca em
 * .zip (logos, cores e fontes). O gerador de PDF e o zip só baixam quando a
 * equipe clica (import dinâmico): a mesa abre leve.
 */

async function baixarBytes(caminho: string): Promise<Uint8Array | null> {
  const { data, error } = await supabase.storage.from("mesa").download(caminho);
  if (error || !data) return null;
  return new Uint8Array(await data.arrayBuffer());
}

export function salvarArquivo(bytes: Uint8Array | Blob, nome: string, tipo: string) {
  const blob = bytes instanceof Blob ? bytes : new Blob([bytes], { type: tipo });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Monta o PDF do modelo escolhido e devolve os bytes e o nome. */
export async function pdfDoBrandbook(dados: DadosDoBrandbook, modelo: ModeloDoBrandbook, versao: number): Promise<{ bytes: Uint8Array; nome: string; semImagem: number }> {
  const { gerarPdfDoBrandbook, nomeDoArquivoDoBrandbook, prepararImagens } = await import("../../../supabase/functions/mesa-identidade/modulos/pdf-identidade");
  const arquivos: Record<string, Uint8Array> = {};
  let semImagem = 0;
  for (const c of imagensDoBrandbook(dados)) {
    if (/\.svg$/i.test(c)) continue;
    const b = await baixarBytes(c);
    if (b) arquivos[c] = b;
    else semImagem += 1;
  }
  const imagens = await prepararImagens(arquivos);
  semImagem += Object.keys(arquivos).length - Object.keys(imagens).length;
  const bytes = gerarPdfDoBrandbook({ modelo, dados, versao, imagens });
  return { bytes, nome: nomeDoArquivoDoBrandbook(dados.marca.nome || "marca", modelo, versao), semImagem };
}

const limpar = (s: string) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "arquivo";

/** Os textos das cores (JSON, CSS, TXT e a paleta do GIMP), calculados na hora. */
export function arquivosDasCores(dados: DadosDoBrandbook): Record<string, string> {
  const cores = coresDoBrandbook(dados);
  const perfil = PERFIS[dados.perfil_cmyk];
  const json = JSON.stringify(
    { marca: dados.marca.nome, perfil_cmyk: perfil.nome, cores: cores.map((c) => ({ nome: c.nome, papel: c.papel, hex: c.hex, rgb: c.rgb, cmyk: c.cmyk })) },
    null,
    2,
  );
  const css = `:root {\n${cores.map((c) => `  --cor-${limpar(c.nome)}: ${c.hex};`).join("\n")}\n}\n`;
  const txt = [`Paleta da marca ${dados.marca.nome}`, `CMYK calculado por código: ${perfil.nome}, limite de tinta ${perfil.limiteDeTinta}%. Confirme a prova com a gráfica.`, ""]
    .concat(cores.map((c) => `${c.nome} (${c.papel})\n  HEX ${c.hex}\n  ${textoRgb(c.rgb)}\n  ${textoCmyk(c.cmyk)}\n`))
    .join("\n");
  const gpl = ["GIMP Palette", `Name: ${dados.marca.nome || "Marca"}`, "Columns: 4", "#"].concat(cores.map((c) => `${String(c.rgb.r).padStart(3, " ")} ${String(c.rgb.g).padStart(3, " ")} ${String(c.rgb.b).padStart(3, " ")}\t${c.nome}`)).join("\n");
  return { "cores/paleta.json": json, "cores/paleta.css": css, "cores/paleta.txt": txt, "cores/paleta.gpl": `${gpl}\n` };
}

/**
 * O pacote da marca (.zip): logos (originais e prévias PNG), cores, fontes
 * enviadas da marca (quando há), o brandbook.json e o PDF. Devolve o que
 * ficou de fora (arquivo que não baixou).
 */
export async function pacoteDaMarca(e: {
  clientId: string;
  marcaId: string | null;
  dados: DadosDoBrandbook;
  modelo: ModeloDoBrandbook;
  versao: number;
  pdf?: { bytes: Uint8Array; nome: string } | null;
  projeto?: Record<string, unknown> | null;
  paginaWeb?: string | null;
  /** IDV3: arquivos a mais (vídeos da marca, mockups) e o índice do pacote (LEIA-PRIMEIRO.txt). */
  extras?: Array<{ caminho: string; dados: Blob | Uint8Array | string }>;
  manifesto?: string | null;
}): Promise<{ blob: Blob; nome: string; fora: string[] }> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const fora: string[] = [];
  for (const { slot, logo } of logosDoBrandbook(e.dados)) {
    const nomeDoSlot = limpar(SLOTS_DE_LOGO.filter((s) => s.valor === slot)[0].rotulo);
    const rot = logo.rotulo ? `-${limpar(logo.rotulo)}` : "";
    const ext = (/\.([a-z0-9]+)$/i.exec(logo.caminho) || ["", "png"])[1];
    const orig = await baixarBytes(logo.caminho);
    if (orig) zip.file(`logos/${nomeDoSlot}${rot}.${ext}`, orig);
    else fora.push(logo.caminho.split("/").pop() || logo.caminho);
    if (logo.previa_png && logo.previa_png !== logo.caminho) {
      const pv = await baixarBytes(logo.previa_png);
      if (pv) zip.file(`logos/png/${nomeDoSlot}${rot}.png`, pv);
    }
  }
  const cores = arquivosDasCores(e.dados);
  Object.keys(cores).forEach((k) => zip.file(k, cores[k]));
  // Fontes da marca enviadas no painel (Contexto > Fontes), na regra da marca: outra marca, só as dela.
  let q = (supabase as any).from("cliente_fontes").select("nome, papel, storage_path, marca_id").eq("client_id", e.clientId).limit(12);
  q = e.marcaId ? q.eq("marca_id", e.marcaId) : q.is("marca_id", null);
  const { data: fontes } = await q;
  const listaDeFontes: string[] = [];
  for (const f of (fontes as Array<{ nome: string; papel: string; storage_path: string }> | null) || []) {
    const b = await baixarBytes(f.storage_path);
    const ext = (/\.([a-z0-9]+)$/i.exec(f.storage_path) || ["", "ttf"])[1];
    if (b) zip.file(`fontes/${limpar(f.nome)}.${ext}`, b);
    else fora.push(f.nome);
    listaDeFontes.push(`${f.nome} (${f.papel})`);
  }
  const tipos = e.dados.tipografia.map((t) => `${t.familia}: ${t.uso}${t.pesos.length ? `, pesos ${t.pesos.join(", ")}` : ""}. Licença: ${t.licenca || "a confirmar"}.${t.alternativa ? ` Alternativa: ${t.alternativa}.` : ""}`);
  zip.file("fontes/LEIA.txt", ["Tipografia da marca", ""].concat(tipos, listaDeFontes.length ? ["", "Arquivos enviados no painel:"].concat(listaDeFontes) : ["", "Os arquivos das fontes não estão no painel: baixe no site da família (Google Fonts ou a fundição)."]).join("\n"));
  // IDV2: grafismos (PNG e o SVG gerado), peças da marca, estratégia e a página web do brandbook.
  for (let i = 0; i < e.dados.grafismos.length; i++) {
    const g = e.dados.grafismos[i];
    const base = `grafismos/${String(i + 1).padStart(2, "0")}-${limpar(g.tipo)}`;
    if (g.imagem) {
      const b = await baixarBytes(g.imagem);
      if (b) zip.file(`${base}.${(/\.([a-z0-9]+)$/i.exec(g.imagem) || ["", "png"])[1]}`, b);
      else fora.push(g.imagem.split("/").pop() || g.imagem);
    }
    if (g.svg) {
      const v = await baixarBytes(g.svg);
      if (v) zip.file(`${base}.svg`, v);
    }
  }
  for (const a of e.dados.aplicacoes) {
    if (!a.imagem) continue;
    const b = await baixarBytes(a.imagem);
    if (b) zip.file(`aplicacoes/${limpar(a.tipo)}.${(/\.([a-z0-9]+)$/i.exec(a.imagem) || ["", "png"])[1]}`, b);
    else fora.push(a.tipo);
  }
  const estrategia = e.projeto ? textoDaEstrategia(e.projeto, e.dados.marca.nome) : "";
  if (estrategia) zip.file("estrategia-da-marca.txt", estrategia);
  if (e.paginaWeb) zip.file("brandbook.html", e.paginaWeb);
  zip.file("brandbook.json", JSON.stringify({ versao: e.versao, modelo: e.modelo, dados: e.dados }, null, 2));
  if (e.pdf) zip.file(e.pdf.nome, e.pdf.bytes);
  for (const x of e.extras || []) zip.file(x.caminho, x.dados);
  if (e.manifesto) zip.file("LEIA-PRIMEIRO.txt", e.manifesto);
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  return { blob, nome: `pacote-da-marca-${limpar(e.dados.marca.nome || "marca")}-v${e.versao}.zip`, fora };
}

/** A estratégia da marca em texto corrido (vai no pacote: equipe e cliente leem sem o painel). */
export function textoDaEstrategia(projeto: Record<string, unknown>, marca: string): string {
  const e = normalizarEstrategia(projeto.estrategia);
  const l: string[] = [`Estratégia da marca ${marca || ""}`.trim(), ""];
  const bloco = (titulo: string, linhas: string[]) => {
    const validas = linhas.filter((x) => x && x.trim());
    if (!validas.length) return;
    l.push(titulo, ...validas.map((x) => `  ${x}`), "");
  };
  bloco("Propósito", [e.proposito]);
  bloco("Missão", [e.missao]);
  bloco("Visão", [e.visao]);
  bloco("Valores", e.valores.map((v) => (v.descricao ? `${v.nome}: ${v.descricao}` : v.nome)));
  bloco("Arquétipo", [[rotuloDoArquetipo(e.arquetipo.principal), rotuloDoArquetipo(e.arquetipo.secundario)].filter(Boolean).join(" com "), e.arquetipo.justificativa]);
  bloco("Personalidade", e.personalidade.tracos.concat(EIXOS_DE_PERSONALIDADE.filter((x) => e.personalidade.eixos[x.valor] !== 0).map((x) => `${x.esquerda} ou ${x.direita}: ${textoDoEixo(x.valor, e.personalidade.eixos[x.valor])}`)));
  bloco("Posicionamento", [e.posicionamento.declaracao]);
  bloco("Proposta de valor", [e.proposta_de_valor.promessa].concat(e.proposta_de_valor.ganhos.map((g) => `Ganho: ${g}`), e.proposta_de_valor.alivios.map((a) => `Alivia: ${a}`)));
  bloco("Público", [e.publico.resumo, e.publico.persona.nome ? `Persona: ${[e.publico.persona.nome, e.publico.persona.idade, e.publico.persona.ocupacao].filter(Boolean).join(", ")}` : ""]);
  bloco("Tom de voz", [e.tom.atributos.join(", ")].concat(e.tom.fala_assim.map((x) => `Fala assim: ${x}`), e.tom.nao_fala_assim.map((x) => `Não fala assim: ${x}`)));
  return l.length > 2 ? l.join("\n") : "";
}

/** Imagens do brandbook como data URL (a página web abre sem login e sem o painel). */
async function imagensComoDataUrl(dados: DadosDoBrandbook): Promise<Record<string, string>> {
  const mapa: Record<string, string> = {};
  for (const c of imagensDoBrandbook(dados)) {
    const b = await baixarBytes(c);
    if (!b || b.byteLength > 2_500_000) continue;
    const tipo = /\.svg$/i.test(c) ? "image/svg+xml" : /\.jpe?g$/i.test(c) ? "image/jpeg" : /\.webp$/i.test(c) ? "image/webp" : "image/png";
    let binario = "";
    for (let i = 0; i < b.length; i += 0x8000) binario += String.fromCharCode.apply(null, Array.from(b.subarray(i, i + 0x8000)));
    mapa[c] = `data:${tipo};base64,${btoa(binario)}`;
  }
  return mapa;
}

/**
 * A página web do brandbook (IDV2): um arquivo HTML que abre em qualquer
 * navegador, com as imagens dentro e as fontes do Google Fonts. É o mesmo
 * desenho da prévia (VisaoDoBrandbook), escrito pelo React em texto.
 */
export async function paginaWebDoBrandbook(dados: DadosDoBrandbook, modelo: ModeloDoBrandbook, versao: number, videos: Array<{ titulo: string; arquivo: string }> = []): Promise<{ html: string; nome: string }> {
  const [{ renderToStaticMarkup }, { createElement }, visao] = await Promise.all([import("react-dom/server"), import("react"), import("./VisaoDoBrandbook")]);
  const mapa = await imagensComoDataUrl(dados);
  const corpo = renderToStaticMarkup(createElement(visao.default, { dados, modelo, urlDe: (c: string | null | undefined) => (c ? mapa[c] || null : null) }));
  const fontes = urlDoGoogleFonts(dados.tipografia.map((t) => ({ familia: t.familia, pesos: [400, 700] })));
  const esc = (x: string) => x.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const titulo = `Manual da marca ${dados.marca.nome || ""}`.trim();
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(titulo)}</title>${fontes ? `<link rel="stylesheet" href="${fontes}">` : ""}<style>body{margin:0;background:#EEF1EE;font-family:Helvetica,Arial,sans-serif}main{max-width:1240px;margin:0 auto;padding:24px 16px}</style></head><body><main>${corpo}${secaoDeVideos(videos, esc)}<p style="font-size:12px;color:#626D66;text-align:center;margin-top:24px">Versão ${versao}. Feito pela Aceleriq.</p></main></body></html>`;
  return { html, nome: `brandbook-${limpar(dados.marca.nome || "marca")}-v${versao}.html` };
}

/**
 * IDV3: os vídeos da marca na página web do pacote. O arquivo vai na pasta
 * videos/ do mesmo .zip, então o endereço é relativo (abre sem o painel e sem
 * link que expira).
 */
function secaoDeVideos(videos: Array<{ titulo: string; arquivo: string }>, esc: (x: string) => string): string {
  const validos = videos.filter((v) => /^videos\/[A-Za-z0-9._-]+\.mp4$/.test(v.arquivo));
  if (!validos.length) return "";
  const itens = validos.map((v) => `<figure style="margin:0 0 24px"><video controls playsinline preload="metadata" src="${esc(v.arquivo)}" style="width:100%;max-height:70vh;background:#000;border-radius:8px"></video><figcaption style="font-size:13px;color:#626D66;margin-top:8px">${esc(v.titulo)}</figcaption></figure>`).join("");
  return `<section style="margin-top:32px"><h2 style="font-size:20px;margin:0 0 16px">Vídeos da marca</h2>${itens}</section>`;
}
