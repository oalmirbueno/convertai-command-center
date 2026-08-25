import { supabase } from "@/integrations/supabase/client";

/**
 * O que denuncia uma entrega avulsa travada.
 *
 * A resposta do dono, literal: "dias parado na mesma etapa, projeto
 * vencido, confusão do que fazer e por onde começar e seguir". Os três
 * viram leitura aqui:
 *
 *  • PARADO: a última marcação de etapa tem data. Dias sem marcar nada
 *    numa entrega que não terminou é a entrega esfriando — e entrega
 *    avulsa esfria em silêncio, porque não tem semana que a puxe de volta.
 *  • VENCIDO: o prazo do projeto passou e a entrega segue aberta.
 *  • POR ONDE COMEÇAR: a pendência já diz qual é a próxima etapa pelo
 *    NOME, para o operador não precisar decifrar números.
 */

export interface SituacaoDoAvulso {
  clientId: string;
  /** Última vez que alguma etapa foi marcada (qualquer serviço). */
  ultimaMarcacao: string | null;
  /** Prazo mais apertado entre os projetos vivos do cliente. */
  prazo: string | null;
}

/** Uma consulta para a lista inteira, como o resto do ciclo. */
export async function lerSituacaoDosAvulsos(
  clientIds: string[],
): Promise<Map<string, SituacaoDoAvulso>> {
  const mapa = new Map<string, SituacaoDoAvulso>();
  for (const id of clientIds) mapa.set(id, { clientId: id, ultimaMarcacao: null, prazo: null });
  if (clientIds.length === 0) return mapa;

  const [marcas, projetos] = await Promise.all([
    (supabase as any)
      .from("project_memory")
      .select("client_id, metadata, created_at")
      .eq("kind", "entrega_etapa")
      .in("client_id", clientIds)
      .order("created_at", { ascending: false }),
    (supabase as any)
      .from("projects")
      .select("client_id, deadline")
      .in("client_id", clientIds)
      .is("deleted_at", null),
  ]);

  for (const linha of (marcas.data ?? []) as Array<Record<string, unknown>>) {
    const s = mapa.get(String(linha.client_id));
    if (!s || s.ultimaMarcacao) continue; // a lista vem do mais novo
    const meta = linha.metadata as { done?: boolean; done_at?: string } | null;
    if (meta?.done !== true) continue;
    s.ultimaMarcacao = String(meta.done_at || linha.created_at);
  }

  for (const linha of (projetos.data ?? []) as Array<Record<string, unknown>>) {
    const s = mapa.get(String(linha.client_id));
    const prazo = linha.deadline;
    if (!s || typeof prazo !== "string") continue;
    if (!s.prazo || prazo < s.prazo) s.prazo = prazo;
  }

  return mapa;
}

export interface PendenciaDoAvulso {
  chave: string;
  texto: string;
  gravidade: "urgente" | "atencao";
}

/** Dias parado que viram alerta. Entrega avulsa esfria rápido. */
const DIAS_PARADO_ATENCAO = 4;
const DIAS_PARADO_URGENTE = 7;

export function pendenciasDoAvulso(input: {
  situacao: SituacaoDoAvulso;
  feitas: number;
  total: number;
  proximaEtapa: string | null;
  agoraIso?: string;
}): PendenciaDoAvulso[] {
  const lista: PendenciaDoAvulso[] = [];
  const agora = input.agoraIso ? new Date(input.agoraIso).getTime() : Date.now();
  const completa = input.total > 0 && input.feitas >= input.total;
  if (completa) return lista;

  const prazo = input.situacao.prazo;
  if (prazo) {
    const diasParaOPrazo = Math.floor(
      (new Date(`${prazo}T23:59:59`).getTime() - agora) / 86_400_000,
    );
    if (diasParaOPrazo < 0) {
      lista.push({
        chave: "prazo-vencido",
        texto: `O prazo venceu há ${-diasParaOPrazo} ${-diasParaOPrazo === 1 ? "dia" : "dias"} e a entrega segue aberta`,
        gravidade: "urgente",
      });
    } else if (diasParaOPrazo <= 5 && input.total - input.feitas >= 2) {
      lista.push({
        chave: "prazo-apertando",
        texto: `${diasParaOPrazo === 0 ? "O prazo é hoje" : `Faltam ${diasParaOPrazo} dias para o prazo`} e ainda há ${input.total - input.feitas} etapas`,
        gravidade: "atencao",
      });
    }
  }

  if (input.feitas > 0 && input.situacao.ultimaMarcacao) {
    const diasParado = Math.floor(
      (agora - new Date(input.situacao.ultimaMarcacao).getTime()) / 86_400_000,
    );
    if (diasParado >= DIAS_PARADO_URGENTE) {
      lista.push({
        chave: "parado",
        texto: `Parado há ${diasParado} dias na mesma etapa`,
        gravidade: "urgente",
      });
    } else if (diasParado >= DIAS_PARADO_ATENCAO) {
      lista.push({
        chave: "esfriando",
        texto: `Sem avanço há ${diasParado} dias`,
        gravidade: "atencao",
      });
    }
  } else if (input.feitas === 0) {
    // Nada marcado ainda: a confusão de "por onde começar" se resolve
    // dizendo a primeira etapa pelo nome.
    lista.push({
      chave: "nao-comecou",
      texto: input.proximaEtapa
        ? `Ainda não começou. Primeiro passo: ${input.proximaEtapa.toLowerCase()}`
        : "Ainda não começou",
      gravidade: "atencao",
    });
  }

  // O "por onde seguir": sempre que houver pendência, a próxima etapa
  // vem junto, pelo nome.
  if (lista.length > 0 && input.feitas > 0 && input.proximaEtapa) {
    lista.push({
      chave: "proximo-passo",
      texto: `Próximo passo: ${input.proximaEtapa.toLowerCase()}`,
      gravidade: "atencao",
    });
  }

  return lista;
}
