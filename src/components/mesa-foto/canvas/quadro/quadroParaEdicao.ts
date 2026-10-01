import { chamarMesaVideos } from "@/components/mesa-videos/videosApi";
import { chamarEditorVideo } from "@/lib/editor/api";
import type { QuadroAnimado } from "../../../../../supabase/functions/mesa-foto/modulos/quadro-animado";
import { quadroParaProjeto } from "./projetoDoQuadro";

export { FPS_DO_QUADRO, quadroParaProjeto } from "./projetoDoQuadro";

export interface EnvioAoRender {
  versao_id: string;
  pedido_id: string | null;
  ja_existia: boolean;
  aviso: string | null;
}

/**
 * Manda o quadro para o render: grava uma versão rascunho na Mesa Edição
 * (versao_registrar, função mesa-videos) e pede o render final pela fila
 * (render_pedir, função editor-video). Render não tem custo de IA; quem
 * renderiza é o worker da máquina da agência. Falhou só a fila: a versão
 * fica e o aviso diz como pedir de novo no editor.
 */
export async function mandarQuadroParaORender(clientId: string, q: QuadroAnimado, titulo: string, uid: string, pedirRender = true): Promise<EnvioAoRender> {
  const projeto = quadroParaProjeto(q, titulo);
  const r = await chamarMesaVideos<{ versao?: { id?: string } }>({ acao: "versao_registrar", client_id: clientId, titulo: projeto.titulo, estado: "rascunho", nota: "Quadro animado do Canvas (Mesa Foto).", projeto });
  const versaoId = r && r.versao && r.versao.id ? String(r.versao.id) : "";
  if (!versaoId) throw new Error("A versão não voltou da Mesa Vídeos.");
  if (!pedirRender) return { versao_id: versaoId, pedido_id: null, ja_existia: false, aviso: null };
  try {
    const pedido = await chamarEditorVideo<{ pedido?: { id?: string }; ja_existia?: boolean }>({ acao: "render_pedir", client_id: clientId, versao_id: versaoId, tipo: "render_final", uid });
    return { versao_id: versaoId, pedido_id: pedido && pedido.pedido && pedido.pedido.id ? String(pedido.pedido.id) : null, ja_existia: !!(pedido && pedido.ja_existia), aviso: null };
  } catch (e) {
    return { versao_id: versaoId, pedido_id: null, ja_existia: false, aviso: `A versão foi salva, mas o render não entrou na fila: ${e instanceof Error ? e.message : "tente de novo no editor"}.` };
  }
}

export const enderecoDoEditor = (clientId: string, versaoId: string) => `/mesa-edicao?client=${clientId}&etapa=editar&versao=${versaoId}`;
