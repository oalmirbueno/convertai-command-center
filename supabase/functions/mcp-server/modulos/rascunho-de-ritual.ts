/**
 * Rascunho de ritual de agente com o escritor da Central (19/10/2026).
 *
 * O dono: "faz o Hermes usar o escritor novo". Na segunda, 19/10, o Hermes gravou 9 rascunhos pelo
 * aceleriq_create_report_draft com texto próprio ("Bom dia, pessoal! Começamos a semana...", "não vamos
 * considerar os números históricos de mídia como prova de retomada atual"), sempre com a mesma abertura e o
 * mesmo fechamento. Em vez de depender de o agente lembrar de chamar o aceleriq_ritual_redigir, o próprio
 * rascunho de ritual passa pelo escritor: título que nomeia o ritual (abertura, meio ou fechamento da
 * semana) vira texto do escritor da Central (curto, com o JÁ DITO, duas versões e o Jev escolhendo), a
 * partir do dossiê atual. O texto do agente fica guardado em metrics.rascunho_do_agente, só para a equipe.
 *
 * Se o escritor não responder, o rascunho fica com o texto do agente e o motivo vai em
 * metrics.escritor_central; a revisão do dono e a trava do portal continuam valendo.
 */

import type { AuthContext } from '../../_shared/mcp-auth.ts';
import { type RitualDaAutomacao, ritualRedigirPorAutomacao } from './ritual-automatico.ts';

const SEM_ACENTO = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** O ritual que o título do rascunho nomeia; null quando não é ritual da semana. */
export function ritualDoTitulo(titulo: string): RitualDaAutomacao | null {
  const t = SEM_ACENTO(String(titulo ?? ''));
  if (/prepara[cç]ao interna|relatorio de midia|insights/.test(t)) return null;
  if (/abertura da semana|rota da semana|comeco da semana|inicio da semana/.test(t)) return 'rota_semana';
  if (/meio da semana|checagem de meio|meio de semana/.test(t)) return 'meio_semana';
  if (/fechamento (da |de )?semana|fechamento semanal|prova de movimento|fechando a semana/.test(t)) return 'prova_movimento';
  return null;
}

type Rascunho = { title: string; summary?: string; next_steps?: string; metrics?: Record<string, unknown> };
type Redigir = typeof ritualRedigirPorAutomacao;

export async function rascunhoComEscritor<T extends Rascunho>(
  input: T,
  clientId: string | null,
  ctx: AuthContext,
  redigir: Redigir = ritualRedigirPorAutomacao,
): Promise<T> {
  const ritual = ritualDoTitulo(input.title);
  if (!ritual || !clientId) return input;
  const metrics = { ...(input.metrics ?? {}) };
  const doAgente = { title: input.title, summary: String(input.summary ?? '').slice(0, 4000), next_steps: String(input.next_steps ?? '').slice(0, 1000) };
  try {
    const r = await redigir({ client_id: clientId, ritual }, ctx) as Record<string, unknown>;
    const body = typeof r?.body === 'string' ? r.body.trim() : '';
    if (!r?.ok || !body) {
      return { ...input, metrics: { ...metrics, escritor_central: { usado: false, motivo: String(r?.motivo ?? 'o escritor não devolveu texto').slice(0, 300) } } };
    }
    return {
      ...input,
      title: typeof r.title === 'string' && r.title.trim() ? r.title.trim().slice(0, 200) : input.title,
      summary: body,
      next_steps: typeof r.next_steps === 'string' && r.next_steps.trim() ? r.next_steps.trim() : input.next_steps,
      metrics: {
        ...metrics,
        ritual_type: ritual,
        gerado_por: 'escritor_central',
        written_by: 'ai',
        model: r.model ?? null,
        alertas: Array.isArray(r.alertas) ? r.alertas : [],
        repeticao: r.repeticao ?? null,
        tarefas_sugeridas: Array.isArray(r.tarefas_sugeridas) ? r.tarefas_sugeridas : [],
        escritor_central: { usado: true },
        rascunho_do_agente: doAgente,
      },
    };
  } catch (e) {
    return { ...input, metrics: { ...metrics, escritor_central: { usado: false, motivo: String(e instanceof Error ? e.message : e).slice(0, 300) } } };
  }
}
