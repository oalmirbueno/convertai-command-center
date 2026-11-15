/**
 * Leitura da caixa "Precisa de você" da Esteira: poucas consultas em lote
 * para a casa inteira (nunca uma por cliente). Só leitura: nada aqui grava
 * nem decide.
 *
 * Cada fonte é independente. Se uma falhar, as outras continuam e a caixa
 * avisa que a lista pode estar incompleta, em vez de sumir ou derrubar a
 * Esteira.
 */

import { supabase } from "@/integrations/supabase/client";
import { tabelaAusente } from "@/lib/anunciosHoje";
import {
  APROVACAO_EM_ABERTO, LINHAS_DO_DONO_VAZIAS,
  type LinhaDeAprovacao, type LinhaDeArquivoRejeitado, type LinhaDeRejeicao, type LinhaDeTrabalhoRejeitado,
  type LinhaDeVinculoDaExecucao, type LinhasDoDono,
} from "./precisaDeVoce";

/** Tetos de leitura: a caixa é um resumo do que espera o dono, não um relatório. */
const TETO_DE_APROVACOES = 200;
const TETO_DE_VINCULOS = 100;
const TETO_DE_PROPOSTAS = 50;
const TETO_DE_REJEICOES = 500;
const TETO_DE_TRABALHOS = 200;
const LOTE = 100;

/** Proposta de anúncio parada há mais tempo que isto já não é decisão viva. */
const DIAS_DA_PROPOSTA = 14;
/** Janela das rejeições do cliente. */
const DIAS_DA_REJEICAO = 90;

export type FonteDaCaixa = "aprovacoes" | "vinculos" | "anuncios" | "rejeicoes";

export interface LeituraDoDono {
  linhas: LinhasDoDono;
  /** Fontes que não puderam ser lidas agora. */
  fontesComErro: FonteDaCaixa[];
}

type Resposta = { data: unknown[] | null; error: { message?: string; code?: string } | null };

async function linhasDe<T>(consulta: PromiseLike<Resposta>): Promise<T[]> {
  const { data, error } = await consulta;
  if (error) throw error;
  return (data ?? []) as T[];
}

const emLotes = (ids: string[]): string[][] => {
  const unicos = Array.from(new Set(ids.filter(Boolean)));
  const lotes: string[][] = [];
  for (let i = 0; i < unicos.length; i += LOTE) lotes.push(unicos.slice(i, i + LOTE));
  return lotes;
};

const diasAtras = (agora: Date, dias: number) => new Date(agora.getTime() - dias * 86_400_000).toISOString();


/** Teto de versões seguintes a percorrer a partir dos arquivos rejeitados. */
export const TETO_DE_HOPS_DA_CADEIA = 8;

/**
 * Completa a cadeia de versões para a frente: filhos, netos, etc. Sem isso,
 * uma peça já aprovada ou arquivada uns hops à frente continuaria na caixa.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function completarCadeiaDeArquivos(db: any, iniciais: LinhaDeArquivoRejeitado[], colunas: string): Promise<LinhaDeArquivoRejeitado[]> {
  const porId = new Map(iniciais.map((a) => [a.id, a]));
  let fronteira = iniciais.map((a) => a.id);
  for (let hop = 0; hop < TETO_DE_HOPS_DA_CADEIA && fronteira.length; hop += 1) {
    const filhos = (await Promise.all(emLotes(fronteira).map((lote) =>
      linhasDe<LinhaDeArquivoRejeitado>(db.from("staff_files_secure").select(colunas).in("revision_of_file_id", lote))
    ))).flat();
    const novos: string[] = [];
    for (const a of filhos) {
      if (porId.has(a.id)) continue;
      porId.set(a.id, a);
      novos.push(a.id);
    }
    fronteira = novos;
  }
  return Array.from(porId.values());
}

/** Rejeições do cliente, as versões dos arquivos envolvidos e as peças do Estúdio com mais de uma volta. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function lerRejeicoes(db: any, agora: Date): Promise<Pick<LinhasDoDono, "rejeicoes" | "arquivos" | "trabalhos">> {
  const [rejeicoes, trabalhosBrutos] = await Promise.all([
    linhasDe<LinhaDeRejeicao>(
      db.from("file_approval_events").select("id, file_id, client_id, created_at, feedback")
        .eq("event_type", "client_rejected").gte("created_at", diasAtras(agora, DIAS_DA_REJEICAO))
        .order("created_at", { ascending: false }).limit(TETO_DE_REJEICOES)),
    // Cada rejeição (da agência ou do cliente) soma uma rodada; duas do cliente dão rodada 3 ou mais.
    linhasDe<LinhaDeTrabalhoRejeitado>(
      db.from("estudio_trabalhos").select("id, client_id, task_id, post_id, entrega_status, file_ids, ajustes_do_cliente")
        .gte("entrega_rodada", 3).or("entrega_status.is.null,entrega_status.not.in.(aprovado,agendado)")
        .order("atualizado_em", { ascending: false }).limit(TETO_DE_TRABALHOS)),
  ]);

  const COLUNAS_DO_ARQUIVO = "id, client_id, file_name, revision_of_file_id, approval_status, archived_at, created_at";
  const idsRejeitados = rejeicoes.map((r) => r.file_id);
  const [rejeitados, tarefas] = await Promise.all([
    Promise.all(emLotes(idsRejeitados).map((lote) => linhasDe<LinhaDeArquivoRejeitado>(db.from("staff_files_secure").select(COLUNAS_DO_ARQUIVO).in("id", lote)))),
    Promise.all(emLotes(trabalhosBrutos.map((t) => t.task_id || "")).map((lote) => linhasDe<{ id: string; title: string | null }>(db.from("tasks").select("id, title").in("id", lote)))),
  ]);
  // Anda a cadeia para a frente (f1 → f2 → f3 → f4): um hop só perderia a
  // versão que já resolveu a peça, e a caixa ficaria pedindo o dono à toa.
  const arquivos = await completarCadeiaDeArquivos(db, rejeitados.flat(), COLUNAS_DO_ARQUIVO);
  const tituloDaTarefa = new Map(tarefas.flat().map((t) => [t.id, t.title]));
  const trabalhos = trabalhosBrutos.map((t) => ({ ...t, titulo: t.task_id ? tituloDaTarefa.get(t.task_id) ?? null : null }));
  return { rejeicoes, arquivos, trabalhos };
}

/** Lê tudo o que a caixa precisa. Nunca lança: fonte com erro entra em `fontesComErro`. */
export async function lerLinhasDoDono(agora: Date = new Date()): Promise<LeituraDoDono> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const [aprovacoes, vinculos, anuncios, rejeicoes] = await Promise.allSettled([
    linhasDe<LinhaDeAprovacao>(
      db.from("operator_approvals").select("id, status, action_kind, o_que, por_que, custo_previsto, client_id, task_link_id, created_at, invalidated_at")
        .in("status", [...APROVACAO_EM_ABERTO]).order("created_at", { ascending: false }).limit(TETO_DE_APROVACOES)),
    linhasDe<LinhaDeVinculoDaExecucao>(
      db.from("operator_task_links").select("id, status, approval_required, block_reason, next_step, last_action, updated_at")
        .eq("approval_required", true).neq("status", "done").order("updated_at", { ascending: false }).limit(TETO_DE_VINCULOS)),
    (async () => {
      const { data, error } = await db.from("ads_rotina_acoes").select("*").eq("estado", "proposta")
        .gte("criado_em", diasAtras(agora, DIAS_DA_PROPOSTA)).order("criado_em", { ascending: false }).limit(TETO_DE_PROPOSTAS);
      if (error && !tabelaAusente(error)) throw error;
      return (data ?? []) as unknown[];
    })(),
    lerRejeicoes(db, agora),
  ]);

  const fontesComErro: FonteDaCaixa[] = [];
  const valor = <T,>(r: PromiseSettledResult<T>, fonte: FonteDaCaixa, vazio: T): T => {
    if (r.status === "fulfilled") return r.value;
    fontesComErro.push(fonte);
    return vazio;
  };
  const partes = valor(rejeicoes, "rejeicoes", { rejeicoes: [], arquivos: [], trabalhos: [] });
  return {
    linhas: {
      ...LINHAS_DO_DONO_VAZIAS,
      aprovacoes: valor(aprovacoes, "aprovacoes", []),
      vinculos: valor(vinculos, "vinculos", []),
      acoesDeAnuncio: valor(anuncios, "anuncios", []),
      ...partes,
    },
    fontesComErro,
  };
}
