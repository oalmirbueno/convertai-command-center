import { supabase } from "@/integrations/supabase/client";
import { autoMiniaturasLigadas, caminhoDaMiniatura } from "@/lib/miniaturas";
import { gravarMiniaturaDoVideo } from "@/lib/mesa-videos/quadros";

/**
 * Capa dos vídeos (29/10/2026, dono: "os vídeos que estão no painel não parecem nada, eles têm que aparecer a
 * capa; estão sem imagem e fica difícil de identificar").
 *
 * Causa: no Workspace o cartão do vídeo era um <video preload="none">: o navegador não baixava nada e o cartão
 * ficava vazio. A miniatura própria do vídeo (<vídeo>.mini.jpg, lib/mesa-videos/quadros.ts) só era gravada na
 * Mesa Vídeos.
 *
 * Agora, numa chamada só por lista: assina a capa (<vídeo>.mini.jpg) e o vídeo. Com capa, a tela mostra a imagem
 * leve. Sem capa, mostra o quadro do próprio vídeo (carregado só quando o cartão aparece) e, para a equipe, a
 * capa é gravada em segundo plano (uma por vez), para a próxima vez abrir leve.
 */

export type CapaEVideo = { capa: string | null; video: string | null };

/** Vários vídeos de uma vez: caminho do vídeo -> URL da capa (se houver) e do vídeo. */
export async function capasDeVideoEmLote(bucket: string, caminhos: string[], expiraEm = 3600): Promise<Record<string, CapaEVideo>> {
  const unicos = caminhos.filter((c, i) => !!c && caminhos.indexOf(c) === i);
  if (!unicos.length) return {};
  const pedidos: string[] = [];
  for (const c of unicos) pedidos.push(caminhoDaMiniatura(c), c);
  const { data, error } = await supabase.storage.from(bucket).createSignedUrls(pedidos, expiraEm);
  if (error) throw error;
  const porCaminho: Record<string, string> = {};
  for (const l of (data || []) as { path: string | null; signedUrl: string | null; error: string | null }[]) {
    if (l.path && l.signedUrl && !l.error) porCaminho[l.path] = l.signedUrl;
  }
  const saida: Record<string, CapaEVideo> = {};
  for (const c of unicos) {
    const capa = porCaminho[caminhoDaMiniatura(c)] || null;
    const video = porCaminho[c] || null;
    saida[c] = { capa, video };
    if (!capa && video) agendarCapaDoVideo(bucket, c);
  }
  return saida;
}

// ------------------------------------------------------------ capas que faltam (só a equipe grava)

const tentados = new Set<string>();
const fila: { bucket: string; caminho: string }[] = [];
let processando = false;
const MAX_POR_SESSAO = 60;
let feitos = 0;

/** Vídeo mostrado sem capa: entra na fila para ganhar a capa. Cliente não grava no Storage. */
export function agendarCapaDoVideo(bucket: string, caminho: string) {
  if (typeof window === "undefined" || !autoMiniaturasLigadas()) return;
  const k = `${bucket}:${caminho}`;
  if (tentados.has(k) || feitos >= MAX_POR_SESSAO) return;
  tentados.add(k);
  fila.push({ bucket, caminho });
  if (!processando) void processarFila();
}

async function processarFila() {
  processando = true;
  try {
    while (fila.length && autoMiniaturasLigadas()) {
      const item = fila.shift()!;
      feitos++;
      await gravarMiniaturaDoVideo(item.bucket, item.caminho);
      await new Promise<void>((r) => setTimeout(r, 300));
    }
  } finally {
    processando = false;
  }
}

/** Só para testes. */
export function __zerarCapasParaTeste() {
  tentados.clear();
  fila.length = 0;
  processando = false;
  feitos = 0;
}
