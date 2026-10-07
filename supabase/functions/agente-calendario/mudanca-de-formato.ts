import { normalizarDirecaoDeFoto, entregaDaPecaDeFoto } from "./modulos/peca-de-foto.ts";
import { normalizarVideoDaPauta } from "../_shared/video-da-pauta.ts";
import { gravarSnapshotConfirmado } from "./gravacao-confirmada.ts";

type Registro = Record<string, any>;
export type PassoDoFormato = { tabela: string; id: string; antes: Registro; depois: Registro };
export function camposDoFormato(tarefa: Registro, pedido: Registro, item?: Registro | null) {
  const para = pedido.formato_para;
  const formato = para === "foto" ? "foto" : ["video", "reel", "short"].includes(para) ? "video" : para === "static" ? "estatico" : "carrossel";
  const tema = String(item?.tema || tarefa.title || "").replace(/^Peça de foto: /, "");
  const foto = formato === "foto" ? normalizarDirecaoDeFoto(pedido.foto || item?.foto, { tema }) : null;
  const video = formato === "video" ? normalizarVideoDaPauta(pedido.video || item?.video) : null;
  const novo: Registro = { ...item, formato, mesa: formato === "foto" ? "foto" : formato === "video" ? "video" : "arte", foto, video, carrossel_infinito: false };
  if (formato === "video" || formato === "foto") novo.cards = [];
  else if (formato === "estatico") novo.cards = (item?.cards || []).slice(0, 1);
  const delivery_type = formato === "foto" ? entregaDaPecaDeFoto(foto) : para;
  const title = formato === "foto" ? `Peça de foto: ${tema}` : String(tarefa.title || "").replace(/^Peça de foto: /, "");
  const direcao = formato === "foto" ? { so_fotos: true, conceito: tema, fotos: { imagem_ids: [] }, cards: [], carrossel_infinito: false } : formato === "video" ? { mesa: "video", video, cards: [] } : null;
  return { novo, tarefa: { delivery_type, title }, direcao };
}

/** CAS por campos lidos; compensação em ordem inversa e recibo para Desfazer. */
export async function gravarPassosDoFormato(db: any, passos: PassoDoFormato[], clientId: string) {
  const feitos: PassoDoFormato[] = [];
  try {
    for (const p of passos) {
      await aplicarPasso(db, p, clientId, false);
      feitos.push(p);
    }
    return feitos;
  } catch (e) {
    let incompleta = false;
    for (const p of feitos.slice().reverse()) try { await aplicarPasso(db, p, clientId, true); } catch { incompleta = true; }
    throw new Error(`${e instanceof Error ? e.message : "Falha ao salvar formato."}${incompleta ? " Houve alteração parcial: confira a agenda antes de repetir." : " As alterações deste formato foram revertidas."}`);
  }
}
async function aplicarPasso(db: any, p: PassoDoFormato, clientId: string, desfazer: boolean) {
  const de = desfazer ? p.depois : p.antes, para = desfazer ? p.antes : p.depois;
  return gravarSnapshotConfirmado(db, p.tabela, p.id, clientId, de, para);
}
export async function desfazerPassosDoFormato(db: any, passos: PassoDoFormato[], clientId: string) {
  for (const p of passos.slice().reverse()) await aplicarPasso(db, p, clientId, true);
}
