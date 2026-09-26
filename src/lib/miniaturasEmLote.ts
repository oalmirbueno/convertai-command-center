import { supabase } from "@/integrations/supabase/client";
import { caminhoDaMedia, caminhoDaMiniatura, podeTerMiniatura, prepararCopias } from "@/lib/miniaturas";

/**
 * Cópias leves (miniatura 640 px e média 2048 px) para as imagens que já
 * existiam antes de 26/09/2026, quando o painel deixou de pedir a
 * transformação de imagem do Storage. Roda no navegador de quem é admin, em
 * lotes, uma imagem por vez: baixa o original, reduz no canvas e grava as
 * cópias ao lado (mesmas regras de acesso da pasta). Não apaga nada e pode
 * ser interrompido e repetido: imagem que já tem miniatura é pulada.
 *
 * Como rodar (logado como admin, no console do navegador em aceleriq.online):
 *
 *   await aceleriqMiniaturas.gerarEmLote({ limite: 200 })
 *   // só uma origem ou um cliente:
 *   await aceleriqMiniaturas.gerarEmLote({ origens: ["cliente_imagens"], clientId: "<uuid>" })
 *   // ver o que falta sem gravar nada:
 *   await aceleriqMiniaturas.gerarEmLote({ limite: 500, soContar: true })
 *
 * O objeto `aceleriqMiniaturas` só é registrado para admin (AuthContext).
 * Cada imagem sem miniatura custa um download do original (banda de saída),
 * uma vez; depois as grades passam a baixar só a miniatura.
 */

export type OrigemDoLote = "files" | "workspace_nodes" | "cliente_imagens" | "cliente_referencias";

export type OpcoesDoLote = {
  origens?: OrigemDoLote[];
  clientId?: string | null;
  /** Máximo de imagens verificadas nesta rodada. */
  limite?: number;
  /** Só conta o que falta, sem baixar nem gravar. */
  soContar?: boolean;
  aoAvancar?: (p: ResumoDoLote) => void;
};

export type ResumoDoLote = { verificadas: number; jaTinham: number; faltando: number; criadas: number; falhas: number };

type Item = { bucket: string; caminho: string };

const PAGINA = 200;
const LOTE_DE_ASSINATURA = 50;

async function itensDaOrigem(origem: OrigemDoLote, clientId: string | null, limite: number): Promise<Item[]> {
  const db = supabase as any;
  const saida: Item[] = [];
  for (let de = 0; saida.length < limite; de += PAGINA) {
    let q;
    if (origem === "files") {
      q = db.from("files").select("storage_bucket, storage_path, file_name, mime_type").not("storage_path", "is", null);
    } else if (origem === "workspace_nodes") {
      q = db.from("workspace_nodes").select("storage_path, name, mime").eq("kind", "file").not("storage_path", "is", null);
    } else if (origem === "cliente_imagens") {
      q = db.from("cliente_imagens").select("storage_bucket, storage_path").eq("ativa", true);
    } else {
      q = db.from("cliente_referencias").select("storage_path").not("storage_path", "is", null);
    }
    if (clientId) q = q.eq("client_id", clientId);
    const { data, error } = await q.range(de, de + PAGINA - 1);
    if (error) throw error;
    const linhas = (data || []) as Record<string, string | null>[];
    for (const l of linhas) {
      const caminho = l.storage_path;
      if (!caminho || caminho.indexOf("://") > 0) continue;
      const bucket = origem === "workspace_nodes" ? "workspace" : origem === "cliente_referencias" ? "mesa" : l.storage_bucket || (origem === "files" ? "files" : "mesa");
      if (!podeTerMiniatura(l.file_name || l.name || caminho, l.mime_type || l.mime || null)) continue;
      if (!podeTerMiniatura(caminho) && caminho.lastIndexOf(".") > caminho.lastIndexOf("/")) continue;
      saida.push({ bucket, caminho });
      if (saida.length >= limite) break;
    }
    if (linhas.length < PAGINA) break;
  }
  return saida;
}

/** Dos itens, os que ainda não têm miniatura (assinatura em lote: objeto ausente não assina). */
async function semMiniatura(bucket: string, caminhos: string[]): Promise<{ caminho: string; url: string }[]> {
  const faltam: { caminho: string; url: string }[] = [];
  for (let i = 0; i < caminhos.length; i += LOTE_DE_ASSINATURA) {
    const parte = caminhos.slice(i, i + LOTE_DE_ASSINATURA);
    const pedidos: string[] = [];
    for (const c of parte) pedidos.push(caminhoDaMiniatura(c), c);
    const { data, error } = await supabase.storage.from(bucket).createSignedUrls(pedidos, 900);
    if (error) throw error;
    const ok: Record<string, string> = {};
    for (const l of (data || []) as { path: string | null; signedUrl?: string | null; error?: string | null }[]) {
      if (l.path && l.signedUrl && !l.error) ok[l.path] = l.signedUrl;
    }
    for (const c of parte) if (!ok[caminhoDaMiniatura(c)] && ok[c]) faltam.push({ caminho: c, url: ok[c] });
  }
  return faltam;
}

export async function gerarMiniaturasEmLote(opcoes: OpcoesDoLote = {}): Promise<ResumoDoLote> {
  const origens = opcoes.origens && opcoes.origens.length ? opcoes.origens : (["cliente_imagens", "files", "workspace_nodes", "cliente_referencias"] as OrigemDoLote[]);
  const limite = Math.max(1, Math.min(5000, opcoes.limite ?? 200));
  const resumo: ResumoDoLote = { verificadas: 0, jaTinham: 0, faltando: 0, criadas: 0, falhas: 0 };
  const vistos = new Set<string>();
  for (const origem of origens) {
    if (resumo.verificadas >= limite) break;
    const itens = (await itensDaOrigem(origem, opcoes.clientId || null, limite - resumo.verificadas)).filter((it) => {
      const k = `${it.bucket}|${it.caminho}`;
      if (vistos.has(k)) return false;
      vistos.add(k);
      return true;
    });
    const porBucket: Record<string, string[]> = {};
    for (const it of itens) (porBucket[it.bucket] = porBucket[it.bucket] || []).push(it.caminho);
    for (const bucket of Object.keys(porBucket)) {
      const caminhos = porBucket[bucket];
      const faltam = await semMiniatura(bucket, caminhos);
      resumo.verificadas += caminhos.length;
      resumo.faltando += faltam.length;
      resumo.jaTinham += caminhos.length - faltam.length;
      opcoes.aoAvancar?.({ ...resumo });
      if (opcoes.soContar) continue;
      for (const f of faltam) {
        try {
          const resposta = await fetch(f.url);
          if (!resposta.ok) throw new Error(`download ${resposta.status}`);
          const copias = await prepararCopias(await resposta.blob());
          if (!copias) throw new Error("imagem não abre no navegador");
          const mini = await supabase.storage.from(bucket).upload(caminhoDaMiniatura(f.caminho), copias.mini, {
            contentType: copias.mini.type || "image/jpeg",
            upsert: true,
            cacheControl: "86400",
          });
          if (mini.error) throw mini.error;
          if (copias.media) {
            await supabase.storage.from(bucket).upload(caminhoDaMedia(f.caminho), copias.media, {
              contentType: copias.media.type || "image/jpeg",
              upsert: true,
              cacheControl: "86400",
            });
          }
          resumo.criadas++;
        } catch (e) {
          resumo.falhas++;
          console.warn("[miniaturas] sem cópia:", bucket, f.caminho, e instanceof Error ? e.message : e);
        }
        opcoes.aoAvancar?.({ ...resumo });
      }
    }
  }
  return resumo;
}

/** Deixa a ação à mão no console do navegador (só admin; ver o topo do arquivo). */
export function registrarNoConsole() {
  if (typeof window === "undefined") return;
  (window as unknown as { aceleriqMiniaturas?: unknown }).aceleriqMiniaturas = {
    gerarEmLote: (opcoes?: OpcoesDoLote) =>
      gerarMiniaturasEmLote({
        ...opcoes,
        aoAvancar: opcoes?.aoAvancar || ((p) => console.info("[miniaturas]", JSON.stringify(p))),
      }),
  };
}
