/**
 * Fila do navegador do agente (frente MOD): o worker fala com
 * agente_computador_tarefas SÓ pelas RPCs (pegar com FOR UPDATE SKIP LOCKED,
 * passo e concluir, sempre com o token da trava) e guarda as provas no
 * Storage (bucket "mesa"). A chave vem da variável de ambiente
 * SUPABASE_SERVICE_ROLE_KEY da máquina, nunca de arquivo.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export interface TarefaDoNavegador {
  id: string;
  client_id: string | null;
  caso: string;
  estado: string;
  url_inicial: string;
  dominios: string[];
  objetivo: string | null;
  origem: string | null;
  teto_passos: number;
  teto_custo_usd: number;
  aprovado_por: string | null;
  aprovado_em: string | null;
  criado_por: string | null;
}

export type RespostaDoPasso = "seguir" | "parar" | "teto";

export interface ProvaDoPasso {
  passo: number;
  storage_path: string;
  legenda: string;
  em: string;
}

export interface Fila {
  pegar(token: string, executor: string, casos: string[], versao: string): Promise<TarefaDoNavegador | null>;
  passo(id: string, token: string, prova: ProvaDoPasso | null, custoUsd: number): Promise<RespostaDoPasso>;
  concluir(id: string, token: string, estado: "feita" | "falhou", resultado: Record<string, unknown>, motivo: string | null): Promise<boolean>;
  /** Uso de modelo na carteira do cliente (ia_registrar_uso). */
  registrarUso(uso: UsoDoModelo): Promise<void>;
}

export interface UsoDoModelo {
  clientId: string;
  tarefaId: string;
  modeloId: string;
  provedor: string;
  tokensEntrada: number;
  tokensSaida: number;
  tokensCache: number;
  custoUsd: number;
  criadoPor: string | null;
}

export interface Armazem {
  /** Sobe o PNG e devolve o caminho no bucket. */
  guardar(caminho: string, png: Uint8Array): Promise<string>;
}

export const BUCKET_DAS_PROVAS = "mesa";

export const caminhoDaProva = (t: Pick<TarefaDoNavegador, "id" | "client_id">, passo: number, sufixo = "") =>
  `${t.client_id || "agencia"}/computador/${t.id}/passo-${String(passo).padStart(2, "0")}${sufixo ? `-${sufixo}` : ""}.png`;

export function filaSupabase(db: SupabaseClient): Fila {
  const rpc = async <T>(nome: string, args: Record<string, unknown>): Promise<T> => {
    const { data, error } = await db.rpc(nome, args);
    if (error) throw new Error(`${nome}: ${error.message}`);
    return data as T;
  };
  return {
    async pegar(token, executor, casos, versao) {
      const linhas = await rpc<TarefaDoNavegador[] | null>("computador_tarefa_pegar", { _token: token, _executor: executor, _casos: casos, _versao: versao });
      return linhas && linhas.length ? linhas[0] : null;
    },
    async passo(id, token, prova, custoUsd) {
      const r = await rpc<string>("computador_tarefa_passo", { _id: id, _token: token, _prova: prova, _custo_usd: Math.max(0, custoUsd) });
      return r === "seguir" || r === "teto" ? r : "parar";
    },
    concluir: (id, token, estado, resultado, motivo) =>
      rpc<boolean>("computador_tarefa_concluir", { _id: id, _token: token, _estado: estado, _resultado: resultado, _motivo: motivo }),
    async registrarUso(u) {
      await rpc("ia_registrar_uso", {
        _client_id: u.clientId,
        _tarefa: "computador",
        _agente: "computador",
        _modelo_id: u.modeloId,
        _provedor: u.provedor,
        _tokens_entrada: Math.round(u.tokensEntrada),
        _tokens_saida: Math.round(u.tokensSaida),
        _tokens_cache: Math.round(u.tokensCache),
        _imagens: 0,
        _qualidade: null,
        _custo_usd: Math.round(u.custoUsd * 1_000_000) / 1_000_000,
        _custo_fonte: "tabela",
        _referencia_tipo: "computador_tarefa",
        _referencia_id: u.tarefaId,
        _criado_por: u.criadoPor,
        _chave_origem: "agencia",
        _chave_id: null,
      });
    },
  };
}

export function armazemSupabase(db: SupabaseClient): Armazem {
  return {
    async guardar(caminho, png) {
      const { error } = await db.storage.from(BUCKET_DAS_PROVAS).upload(caminho, png, { contentType: "image/png", upsert: true });
      if (error) throw new Error(`prova ${caminho}: ${error.message}`);
      return caminho;
    },
  };
}
