/**
 * Fila de render (frente EDT): o worker fala com render_pedidos SÓ pelas RPCs
 * (render_pedidos_pegar com FOR UPDATE SKIP LOCKED, progresso, concluir,
 * falhar), com o token da trava. A chave vem da variável de ambiente
 * SUPABASE_SERVICE_ROLE_KEY da máquina (nunca de arquivo).
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface PedidoDoWorker {
  id: string;
  client_id: string;
  /** Frente MOT: cena HyperFrames e batidas pertencem a um filme (motion_id) e não a uma versão. */
  versao_id: string | null;
  motion_id?: string | null;
  /** Frente TCN: a troca de cenário (preparar o trecho e compor a final). */
  cenario_id?: string | null;
  /** Mesa Edição (02/10): tratar vídeo (tirar a legenda gravada, melhorar a qualidade). */
  tratamento_id?: string | null;
  tipo: "render_final" | "amostra" | "onda" | "cena_hf" | "batidas" | "cenario" | "tratamento";
  projeto: Record<string, unknown> | null;
  revisao: number | null;
  entrada: Record<string, unknown>;
  tentativas: number;
}

export interface LinhaDoArquivo {
  client_id: string;
  nome: string;
  nome_original: string;
  storage_bucket: string;
  storage_path: string;
  tipo: string;
  mime: string;
  bytes: number;
  duracao_s: number | null;
  largura: number | null;
  altura: number | null;
  sha256: string | null;
  origem: Record<string, unknown>;
}

export interface Fila {
  pegar(token: string, worker: string, versao: string): Promise<PedidoDoWorker | null>;
  /** false = o pedido não é mais deste token (cancelado ou vencido): parar. */
  progresso(id: string, token: string, etapa: string, progresso: number): Promise<boolean>;
  concluir(id: string, token: string, saida: string | null, arquivoId: string | null, resultado: Record<string, unknown>): Promise<boolean>;
  falhar(id: string, token: string, codigo: string, mensagem: string): Promise<boolean>;
  registrarArquivo(linha: LinhaDoArquivo): Promise<string>;
  /** Título da versão (nome do arquivo na Mídia). */
  tituloDaVersao(versaoId: string): Promise<string | null>;
}

export const TRAVA_S = 600;

export function filaSupabase(db: SupabaseClient): Fila {
  const rpc = async <T>(nome: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await db.rpc(nome, args);
    if (error) throw new Error(`${nome}: ${error.message}`);
    return data as T;
  };
  return {
    async pegar(token, worker, versao) {
      const linhas = await rpc<PedidoDoWorker[] | null>("render_pedidos_pegar", { _token: token, _worker: worker, _trava_segundos: TRAVA_S, _versao: versao });
      return linhas && linhas.length ? linhas[0] : null;
    },
    progresso: (id, token, etapa, p) => rpc<boolean>("render_pedidos_progresso", { _id: id, _token: token, _etapa: etapa, _progresso: Math.max(0, Math.min(1, p)), _trava_segundos: TRAVA_S }),
    concluir: (id, token, saida, arquivoId, resultado) => rpc<boolean>("render_pedidos_concluir", { _id: id, _token: token, _saida_path: saida, _arquivo_id: arquivoId, _resultado: resultado }),
    falhar: (id, token, codigo, mensagem) => rpc<boolean>("render_pedidos_falhar", { _id: id, _token: token, _codigo: codigo, _mensagem: mensagem.slice(0, 600) }),
    async registrarArquivo(linha) {
      let r = await db.from("video_arquivos").insert(linha).select("id").single();
      // Sem o SQL da frente EDT o tipo "render"/"amostra" não existe ainda: guarda como entrega.
      if (r.error && /video_arquivos_tipo_check/.test(r.error.message || "")) r = await db.from("video_arquivos").insert({ ...linha, tipo: "entrega" }).select("id").single();
      if (r.error || !r.data) throw new Error(`video_arquivos: ${r.error ? r.error.message : "sem id"}`);
      return String((r.data as { id: string }).id);
    },
    async tituloDaVersao(versaoId) {
      const { data } = await db.from("video_versoes").select("titulo, numero").eq("id", versaoId).maybeSingle();
      return data ? `${(data as { titulo: string }).titulo} v${(data as { numero: number }).numero}` : null;
    },
  };
}
