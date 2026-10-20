/**
 * laboratorio: lê os documentos anexados a um nó (Contexto, Agente) para o contexto do modelo.
 *
 * Acesso: o que foi enviado no próprio projeto (global/laboratorio/<projeto>/entradas/) lê direto;
 * o que veio do Workspace só lê se quem pediu enxerga o nó (consulta com o JWT dele, pela RLS de
 * workspace_nodes). PDF simples (texto embutido) e Word (.docx) são lidos por modulos/leitor.ts (20/10,
 * sem biblioteca); PDF escaneado, imagem e o que não deu para ler entram só com nome e endereço.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { registrarFalha } from "../_shared/falha-registrada.ts";
import { servico, UUID } from "./comum.ts";
import { BUCKET, linkAssinado } from "./workspace.ts";
import { blocoDosDocumentos, type DocumentoDoNo, type DocumentoLido, documentosDe, ehTextoPuro, MAX_BYTES_LIDOS, textoDoHtml } from "./modulos/documentos.ts";
import { ehDocx, ehPdf, MAX_BYTES_DO_LEITOR, textoDoDocx, textoDoPdf } from "./modulos/leitor.ts";

export type Quem = { projeto: { id: string }; token: string };

const SEM_LEITOR = "Não lido como texto aqui (imagem, PDF escaneado ou formato sem leitor no servidor).";

/** Caminho do documento que quem pediu pode ler (null = sem acesso ou não achado). */
async function caminhoPermitido(quem: Quem, d: DocumentoDoNo): Promise<{ path: string; mime: string; tamanho: number | null } | null> {
  const doProjeto = `global/laboratorio/${quem.projeto.id}/entradas/`;
  if (d.path && d.path.indexOf(doProjeto) === 0 && d.path.indexOf("..") < 0) return { path: d.path, mime: d.tipo, tamanho: null };
  if (!d.id || !UUID.test(d.id) || !quem.token) return null;
  const doChamador = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: `Bearer ${quem.token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await doChamador.from("workspace_nodes").select("storage_path, mime, size_bytes").eq("id", d.id).eq("kind", "file").maybeSingle();
  if (error || !data) return null;
  const linha = data as { storage_path: string | null; mime: string | null; size_bytes: number | null };
  return linha.storage_path ? { path: linha.storage_path, mime: linha.mime || d.tipo, tamanho: linha.size_bytes } : null;
}

async function lerUm(quem: Quem, d: DocumentoDoNo): Promise<DocumentoLido> {
  const urlDada = /^https?:\/\//i.test(d.url) ? d.url : null;
  try {
    const onde = await caminhoPermitido(quem, d);
    if (!onde) return { nome: d.nome, tipo: d.tipo, url: urlDada, motivo: "Sem acesso a este arquivo aqui: vale só o nome." };
    // PDF simples e Word: o leitor sem biblioteca (modulos/leitor.ts); sem texto, segue sem leitor.
    if (!ehTextoPuro(onde.mime, d.nome) && (ehPdf(onde.mime, d.nome) || ehDocx(onde.mime, d.nome)) && !(onde.tamanho && onde.tamanho > MAX_BYTES_DO_LEITOR)) {
      const { data: arq } = await servico().storage.from(BUCKET).download(onde.path);
      if (arq && arq.size <= MAX_BYTES_DO_LEITOR) {
        const bytes = new Uint8Array(await arq.arrayBuffer());
        const t = ehPdf(onde.mime, d.nome) ? await textoDoPdf(bytes) : await textoDoDocx(bytes);
        if (t) return { nome: d.nome, tipo: onde.mime || d.tipo, texto: t };
      }
    }
    if (!ehTextoPuro(onde.mime, d.nome)) return { nome: d.nome, tipo: onde.mime || d.tipo, url: await linkAssinado(onde.path, BUCKET), motivo: SEM_LEITOR };
    if (onde.tamanho && onde.tamanho > MAX_BYTES_LIDOS) return { nome: d.nome, tipo: onde.mime, url: await linkAssinado(onde.path, BUCKET), motivo: "Grande demais para ler inteiro aqui." };
    const { data, error } = await servico().storage.from(BUCKET).download(onde.path);
    if (error || !data) return { nome: d.nome, tipo: onde.mime, url: urlDada, motivo: "Arquivo não encontrado no Workspace." };
    if (data.size > MAX_BYTES_LIDOS) return { nome: d.nome, tipo: onde.mime, url: await linkAssinado(onde.path, BUCKET), motivo: "Grande demais para ler inteiro aqui." };
    const bruto = await data.text();
    const html = /html/i.test(onde.mime) || /\.html?$/i.test(d.nome);
    return { nome: d.nome, tipo: onde.mime, texto: (html ? textoDoHtml(bruto) : bruto).trim() };
  } catch (e) {
    registrarFalha("laboratorio: documento do nó não lido", e, { nome: d.nome });
    return { nome: d.nome, tipo: d.tipo, url: urlDada, motivo: "Não deu para ler agora." };
  }
}

/** Um documento lido (texto inteiro, sem o teto do bloco do nó), para a ação ler_documento. */
export async function lerUmDocumento(quem: Quem, bruto: unknown): Promise<DocumentoLido | null> {
  const d = documentosDe([bruto])[0];
  return d ? await lerUm(quem, d) : null;
}

/** O bloco de texto dos documentos de `dados.arquivos` (vazio quando não há documento). */
export async function textoDosDocumentos(quem: Quem, bruto: unknown): Promise<string> {
  const docs = documentosDe(bruto);
  if (!docs.length) return "";
  const lidos: DocumentoLido[] = [];
  for (const d of docs) lidos.push(await lerUm(quem, d));
  return blocoDosDocumentos(lidos);
}
