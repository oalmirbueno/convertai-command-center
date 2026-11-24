/**
 * 24/11/2026: arquivar (só internamente) o trabalho do Estúdio com entrega reprovada.
 *
 * Regras puras, sem Deno e sem banco, usadas pelo estudio-arte
 * (estudio_reprovado_arquivar), pelo MCP (leitura e ação dedicada) e pela tela:
 *
 * - Só a entrega reprovada (`entrega_status === "reprovado"`) pode ser
 *   arquivada; criativo de anúncio e Laboratório ficam fora.
 * - Vale para o social padrão com ou sem `task_id` e para a arte rápida.
 * - Arquivar não mexe em tarefa, post, publicação, arquivos, storage,
 *   aprovação nem geração: grava só um marcador dentro de `direcao`.
 *   - Social padrão: `direcao.arquivo_da_reprovacao` (chave nova; nenhum
 *     leitor ou normalizador antigo a conhece, então nada muda para eles).
 *   - Arte rápida: o marcador que ela já tinha,
 *     `direcao.arte_rapida.arquivada_em` (o mesmo do rapida_arquivar), para o
 *     histórico da arte rápida continuar sendo a única leitura. Nunca se cria
 *     `direcao.arte_rapida` num trabalho que não a tem: isso o transformaria
 *     em arte rápida (ehArteRapida lê só a presença do objeto).
 * - O marcador novo vale só para a rodada em que foi gravado e enquanto a
 *   entrega segue reprovada: reabrir (sobe `entrega_rodada`), reentregar ou
 *   aprovar devolvem o trabalho à lista sem precisar desarquivar.
 * - Idempotente: arquivar o arquivado (ou desarquivar o que não está) não grava.
 * - Reversível: `desfazer` tira o marcador (e o da arte rápida).
 * - Trava otimista: grava só se `atualizado_em` ainda é o lido, o cliente é o
 *   mesmo e a entrega ainda está reprovada; com `esperado_atualizado_em`, a
 *   tela/MCP só arquiva o que viu (qualquer mudança no meio = 409).
 */

export const CHAVE_DO_ARQUIVO_DA_REPROVACAO = "arquivo_da_reprovacao";

export interface ArquivoDaReprovacao {
  arquivado_em: string;
  arquivado_por: string | null;
  /** entrega_rodada do trabalho quando foi arquivado (reabrir sobe a rodada e o marcador deixa de valer). */
  rodada: number;
  motivo: string | null;
}

/** O que a regra precisa do trabalho (as colunas de estudio_trabalhos). */
export interface TrabalhoParaArquivo {
  id: string;
  client_id: string;
  task_id?: string | null;
  tipo?: string | null;
  origem?: string | null;
  entrega_status?: string | null;
  entrega_rodada?: number | null;
  direcao?: unknown;
  atualizado_em: string;
}

export type OrigemDoArquivo = "reprovacao" | "arte_rapida";

export interface EstadoDoArquivo {
  arquivado: boolean;
  arquivado_em: string | null;
  arquivado_por: string | null;
  /** Onde está o marcador: o novo (reprovacao) ou o legado da arte rápida. */
  origem: OrigemDoArquivo | null;
  /** Marcador novo de outra rodada ou de entrega que já não está reprovada (não vale, o trabalho aparece). */
  marcador_antigo: boolean;
}

const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

const rodadaDe = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
};

export function ehArteRapidaNaDirecao(direcao: unknown): boolean {
  return !!obj(obj(direcao)?.arte_rapida);
}

/** O marcador novo gravado, em forma fixa, ou null. */
export function arquivoDaReprovacaoGravado(direcao: unknown): ArquivoDaReprovacao | null {
  const m = obj(obj(direcao)?.[CHAVE_DO_ARQUIVO_DA_REPROVACAO]);
  if (!m || typeof m.arquivado_em !== "string" || !m.arquivado_em) return null;
  return {
    arquivado_em: m.arquivado_em,
    arquivado_por: typeof m.arquivado_por === "string" ? m.arquivado_por : null,
    rodada: rodadaDe(m.rodada),
    motivo: typeof m.motivo === "string" && m.motivo ? m.motivo.slice(0, 500) : null,
  };
}

/**
 * Leitura única do estado arquivado (tela, MCP e servidor). Reconhece o
 * marcador legado da arte rápida (`arte_rapida.arquivada_em`, que vale como
 * sempre valeu, em qualquer situação) e o novo da reprovação (só na mesma
 * rodada e com a entrega ainda reprovada).
 */
export function estadoDoArquivo(t: Pick<TrabalhoParaArquivo, "direcao" | "entrega_status" | "entrega_rodada">): EstadoDoArquivo {
  const legado = obj(obj(t.direcao)?.arte_rapida)?.arquivada_em;
  if (typeof legado === "string" && legado) {
    return { arquivado: true, arquivado_em: legado, arquivado_por: null, origem: "arte_rapida", marcador_antigo: false };
  }
  const m = arquivoDaReprovacaoGravado(t.direcao);
  if (!m) return { arquivado: false, arquivado_em: null, arquivado_por: null, origem: null, marcador_antigo: false };
  const vale = t.entrega_status === "reprovado" && m.rodada === rodadaDe(t.entrega_rodada);
  return vale
    ? { arquivado: true, arquivado_em: m.arquivado_em, arquivado_por: m.arquivado_por, origem: "reprovacao", marcador_antigo: false }
    : { arquivado: false, arquivado_em: null, arquivado_por: null, origem: null, marcador_antigo: true };
}

export const trabalhoArquivado = (t: Pick<TrabalhoParaArquivo, "direcao" | "entrega_status" | "entrega_rodada">): boolean =>
  estadoDoArquivo(t).arquivado;

export type MotivoDaRecusa = "nao_reprovado" | "anuncio" | "laboratorio";

/** Pode arquivar/desarquivar? Só a entrega reprovada do Estúdio (social ou arte rápida). */
export function recusaDoArquivo(t: TrabalhoParaArquivo): { codigo: MotivoDaRecusa; mensagem: string } | null {
  if (t.tipo === "ads") return { codigo: "anuncio", mensagem: "Criativo de anúncio segue pela Mesa Ads; não é arquivado por aqui." };
  if (t.origem === "laboratorio") return { codigo: "laboratorio", mensagem: "Trabalho do Laboratório não passa por aprovação." };
  if (t.entrega_status !== "reprovado") {
    return { codigo: "nao_reprovado", mensagem: "Só a entrega reprovada pode ser arquivada por aqui. Atualize a tela: a situação pode ter mudado." };
  }
  return null;
}

/** O patch (só `direcao`) para arquivar ou desarquivar. Nada fora de `direcao` muda. */
export function patchDoArquivo(
  t: TrabalhoParaArquivo,
  entrada: { desfazer: boolean; agora: string; por: string | null; motivo?: string | null },
): { direcao: Record<string, unknown> } {
  const direcao = { ...(obj(t.direcao) ?? {}) };
  const arte = obj(direcao.arte_rapida);
  if (entrada.desfazer) {
    if (arte && arte.arquivada_em) direcao.arte_rapida = { ...arte, arquivada_em: null };
    if (CHAVE_DO_ARQUIVO_DA_REPROVACAO in direcao) direcao[CHAVE_DO_ARQUIVO_DA_REPROVACAO] = null;
    return { direcao };
  }
  if (arte) {
    direcao.arte_rapida = { ...arte, arquivada_em: entrada.agora };
    return { direcao };
  }
  const marcador: ArquivoDaReprovacao = {
    arquivado_em: entrada.agora,
    arquivado_por: entrada.por,
    rodada: rodadaDe(t.entrega_rodada),
    motivo: entrada.motivo ? String(entrada.motivo).trim().slice(0, 500) || null : null,
  };
  direcao[CHAVE_DO_ARQUIVO_DA_REPROVACAO] = marcador;
  return { direcao };
}

/** Erro com status HTTP e código (o estudio-arte vira ErroEstudio; o MCP lê o código). */
export class ErroDoArquivo extends Error {
  status: number;
  codigo: string;
  constructor(status: number, codigo: string, mensagem: string) {
    super(mensagem);
    this.status = status;
    this.codigo = codigo;
  }
}

export interface DependenciasDoArquivo<T extends TrabalhoParaArquivo> {
  /** Lê o trabalho (404 se não existe) e confere o acesso de quem chama ao cliente dele. */
  lerComAcesso: (id: string) => Promise<T>;
  /** Relê o trabalho, sem conferir acesso de novo (o cliente não muda). */
  reler: (id: string) => Promise<T>;
  /**
   * UPDATE ... WHERE id = $id AND client_id = $client AND atualizado_em = $lido
   * AND entrega_status = 'reprovado' RETURNING *. Devolve null se nenhuma linha casou.
   */
  gravarSeIgual: (t: T, patch: { direcao: Record<string, unknown> }) => Promise<T | null>;
  agora: () => string;
  /** Trilha da ação (falha na trilha não derruba a ação). */
  auditar?: (registro: { trabalho: T; desfazer: boolean; mudou: boolean; ok: boolean; codigo?: string }) => Promise<void>;
}

export interface EntradaDoArquivo {
  trabalho_id: string;
  desfazer?: boolean;
  motivo?: string | null;
  /** O atualizado_em que a tela/MCP viu: se o trabalho mudou desde então, 409 (não arquiva no escuro). */
  esperado_atualizado_em?: string | null;
  /** Quem arquivou (auth.uid() de quem chamou). */
  por: string | null;
}

export interface ResultadoDoArquivo<T> {
  trabalho: T;
  arquivado: boolean;
  /** Já estava assim: nada foi gravado. */
  ja_estava: boolean;
  estado: EstadoDoArquivo;
}

const TENTATIVAS = 3;

/** A ação inteira, com a trava otimista e a releitura em caso de corrida. */
export async function arquivarTrabalhoReprovado<T extends TrabalhoParaArquivo>(
  deps: DependenciasDoArquivo<T>,
  entrada: EntradaDoArquivo,
): Promise<ResultadoDoArquivo<T>> {
  const desfazer = entrada.desfazer === true;
  const esperado = typeof entrada.esperado_atualizado_em === "string" && entrada.esperado_atualizado_em ? entrada.esperado_atualizado_em : null;
  let t = await deps.lerComAcesso(entrada.trabalho_id);
  const falhar = async (e: ErroDoArquivo): Promise<never> => {
    await deps.auditar?.({ trabalho: t, desfazer, mudou: false, ok: false, codigo: e.codigo }).catch(() => undefined);
    throw e;
  };
  for (let tentativa = 0; tentativa < TENTATIVAS; tentativa++) {
    const recusa = recusaDoArquivo(t);
    if (recusa) return await falhar(new ErroDoArquivo(409, recusa.codigo, recusa.mensagem));
    const estado = estadoDoArquivo(t);
    if (estado.arquivado === !desfazer) {
      return { trabalho: t, arquivado: estado.arquivado, ja_estava: true, estado };
    }
    if (esperado && t.atualizado_em !== esperado) {
      return await falhar(new ErroDoArquivo(409, "trabalho_mudou", "O trabalho mudou desde que a tela leu. Atualize e confira antes de arquivar."));
    }
    const patch = patchDoArquivo(t, { desfazer, agora: deps.agora(), por: entrada.por, motivo: entrada.motivo ?? null });
    const gravado = await deps.gravarSeIgual(t, patch);
    if (gravado) {
      const novo = estadoDoArquivo(gravado);
      await deps.auditar?.({ trabalho: gravado, desfazer, mudou: true, ok: true }).catch(() => undefined);
      return { trabalho: gravado, arquivado: novo.arquivado, ja_estava: false, estado: novo };
    }
    // Perdeu a corrida (aprovação, reentrega, outra aba): relê e decide de novo.
    t = await deps.reler(t.id);
    if (esperado && t.atualizado_em !== esperado) {
      const recusaAgora = recusaDoArquivo(t);
      if (recusaAgora) return await falhar(new ErroDoArquivo(409, recusaAgora.codigo, recusaAgora.mensagem));
      const agora = estadoDoArquivo(t);
      if (agora.arquivado === !desfazer) return { trabalho: t, arquivado: agora.arquivado, ja_estava: true, estado: agora };
      return await falhar(new ErroDoArquivo(409, "trabalho_mudou", "O trabalho mudou desde que a tela leu. Atualize e confira antes de arquivar."));
    }
  }
  return await falhar(new ErroDoArquivo(409, "conflito_de_gravacao", "O trabalho mudou várias vezes ao mesmo tempo. Tente de novo."));
}
