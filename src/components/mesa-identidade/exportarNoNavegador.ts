import { supabase } from "@/integrations/supabase/client";
import { coresDoBrandbook, imagensDoBrandbook, logosDoBrandbook, SLOTS_DE_LOGO, type DadosDoBrandbook, type ModeloDoBrandbook } from "../../../supabase/functions/_shared/brandbook";
import { PERFIS, textoCmyk, textoRgb } from "../../../supabase/functions/_shared/cores-da-marca";

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
  const { gerarPdfDoBrandbook, nomeDoArquivoDoBrandbook, prepararImagens } = await import("../../../supabase/functions/_shared/pdf-identidade");
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
export async function pacoteDaMarca(e: { clientId: string; marcaId: string | null; dados: DadosDoBrandbook; modelo: ModeloDoBrandbook; versao: number; pdf?: { bytes: Uint8Array; nome: string } | null }): Promise<{ blob: Blob; nome: string; fora: string[] }> {
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
  zip.file("brandbook.json", JSON.stringify({ versao: e.versao, modelo: e.modelo, dados: e.dados }, null, 2));
  if (e.pdf) zip.file(e.pdf.nome, e.pdf.bytes);
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  return { blob, nome: `pacote-da-marca-${limpar(e.dados.marca.nome || "marca")}-v${e.versao}.zip`, fora };
}
