/**
 * Velocidade da lâmina (23/10/2026). Dono: "está dando quase 2 minutos cada
 * geração de lâmina; deixe mais veloz sem perder a qualidade".
 *
 * Medição em produção (ia_usos x estudio_fila, 19 a 22/10):
 * - lâmina sem referência: ~80 s (texto enxuto e Jev ~9 s, imagem ~50 s na
 *   qualidade alta, conferência ~17 s). Nada aqui é desperdício;
 * - lâmina que replica referência: 110 a 220 s. O molde da referência (visão,
 *   teto de 6.000 tokens) levava ~95 s e, nas referências em que o modelo não
 *   fecha o JSON (json_invalido) ou estoura 120 s, FALHAVA sempre e não era
 *   guardado: cada geração e cada lâmina da série pagava os ~95 s de novo para
 *   seguir sem o molde do mesmo jeito. Depois dele, o inventário da referência
 *   (~30 a 50 s) esperava o molde terminar, sem depender dele.
 *
 * Aqui só a regra pura (testada em src/test/estudio-velocidade.test.ts):
 * - a falha do molde fica guardada por referência e por modelo de leitura
 *   (7 dias): a lâmina segue sem o molde, com o mesmo aviso, sem esperar;
 * - duas etapas independentes rodam juntas sem mudar o resultado nem a
 *   ordem dos avisos (emParalelo);
 * - o cronômetro das etapas (log "estudio-arte: tempos da lâmina").
 */

/** A falha guardada do molde vale 7 dias (ou até trocar o modelo de leitura). */
export const MOLDE_FALHO_VALE_MS = 7 * 24 * 60 * 60 * 1000;
/** O tempo esgotado pode ser do provedor naquela hora: vale só 6 h (depois lê de novo). */
export const MOLDE_SEM_RESPOSTA_VALE_MS = 6 * 60 * 60 * 1000;

/** Falhas do modelo que se repetem com a mesma imagem (não são saldo, cota, chave nem rede do banco). */
export const FALHAS_DO_MOLDE_QUE_SE_REPETEM = ["json_invalido", "resposta_vazia", "provedor_timeout"];

export interface FalhaDoMoldeGuardada {
  versao: number;
  falhou: true;
  referencia_id: string;
  modelo: string;
  codigo: string;
  lido_em: string;
}

/** O que gravar quando o molde falha de um jeito que se repete; null para a falha que pode passar sozinha. */
export function falhaDoMoldeParaGuardar(e: { versao: number; refId: string; modeloId: string; codigo: string; agora: Date }): FalhaDoMoldeGuardada | null {
  if (!e.modeloId || FALHAS_DO_MOLDE_QUE_SE_REPETEM.indexOf(e.codigo) < 0) return null;
  return { versao: e.versao, falhou: true, referencia_id: e.refId, modelo: e.modeloId, codigo: e.codigo, lido_em: e.agora.toISOString() };
}

/**
 * A falha guardada ainda vale? Só na mesma versão do molde, com o mesmo
 * modelo de leitura e dentro do prazo. Devolve o código da falha (vira o
 * mesmo aviso de antes) ou null para ler de novo.
 */
export function falhaDoMoldeGuardada(guardado: unknown, e: { versao: number; modeloId: string; agora: Date }): string | null {
  if (!guardado || typeof guardado !== "object") return null;
  const g = guardado as Record<string, unknown>;
  if (g.falhou !== true || g.versao !== e.versao || g.modelo !== e.modeloId) return null;
  const quando = Date.parse(String(g.lido_em ?? ""));
  const vale = g.codigo === "provedor_timeout" ? MOLDE_SEM_RESPOSTA_VALE_MS : MOLDE_FALHO_VALE_MS;
  if (!isFinite(quando) || e.agora.getTime() - quando > vale || quando > e.agora.getTime() + 60_000) return null;
  return typeof g.codigo === "string" && g.codigo ? g.codigo : "falha_guardada";
}

/**
 * Roda `lado` junto com `principal` e devolve os dois, como se fossem um
 * depois do outro: a falha de `principal` sobe primeiro (como antes), a de
 * `lado` sobe depois, e nenhuma rejeição fica solta. Os avisos de `lado`
 * vão numa lista própria, anexada pelo chamador depois dos de `principal`.
 */
export async function emParalelo<A, B>(principal: Promise<A>, lado: Promise<B>): Promise<[A, B]> {
  const ladoSeguro = lado.then((v) => ({ ok: true as const, v }), (erro: unknown) => ({ ok: false as const, erro }));
  const a = await principal;
  const r = await ladoSeguro;
  if (!r.ok) throw (r as { ok: false; erro: unknown }).erro;
  return [a, (r as { ok: true; v: B }).v];
}

/** Cronômetro das etapas de uma lâmina (ms desde a última marca), para o log. */
export function cronometro(relogio: () => number = () => Date.now()) {
  const inicio = relogio();
  let ultima = inicio;
  const etapas: { etapa: string; ms: number }[] = [];
  return {
    marcar(etapa: string) {
      const agora = relogio();
      etapas.push({ etapa, ms: Math.max(0, Math.round(agora - ultima)) });
      ultima = agora;
    },
    tempos(): { total_ms: number; etapas: { etapa: string; ms: number }[] } {
      return { total_ms: Math.max(0, Math.round(ultima - inicio)), etapas: etapas.slice() };
    },
  };
}
