/**
 * Fila de geração do Estúdio no servidor (frente G, 26/09).
 *
 * Bug do dono: "estou gerando para um cliente, depois abro outro cliente e
 * continuo gerando; quando eu volto lá, ele parou". A fila vivia no navegador
 * (laço de AbaEstudio.tsx): tela cheia, abrir outro card ou trocar de cliente
 * remontava a tela e o andamento sumia; a recarga do painel (versão nova)
 * matava o laço; e 3 lâminas em paralelo no mesmo worker estouravam a memória
 * (shutdown Memory da estudio-arte em 25/09).
 *
 * Agora cada lâmina pedida é uma linha em public.estudio_fila (SQL em
 * G-01-fila-de-geracao.sql). A função aceita o pedido, responde na hora e
 * processa em segundo plano, UM passo por invocação (fundo, gerar, conferir,
 * corrigir). Ao terminar, ela mesma chama o próximo passo com o login de quem
 * pediu: a conferência de acesso ao cliente roda em todo passo, como hoje. Se
 * a corrente quebrar (queda do worker, login vencido), o painel aberto de
 * quem pediu, em qualquer tela, retoma a fila (vigia global em
 * src/lib/mesa/filaDeGeracao.ts). Este arquivo é só a regra (pura, testada em
 * src/test/estudio-fila-de-geracao.test.ts); o banco e a IA entram por
 * dependências.
 *
 * Tetos (lição do Hermes: nada repete sem teto e sem espera):
 * - tentativas: queda do worker ou falha de leitura do banco; 3 no máximo;
 * - passos: 24 por lâmina (fundo contínuo esperando outro trecho, conferir,
 *   corrigir); passou disso, erro registrado;
 * - espera entre tentativas: 20 s no fundo ocupado, 30 s x tentativa nas
 *   falhas de leitura; a vigia do painel chama no máximo a cada 30 s;
 * - correção automática: 1 rodada, e só com "Corrigir sozinho" ligado.
 */

export type EtapaDaFila = "fundo" | "gerar" | "conferir" | "corrigir";
export type StatusDaFila = "fila" | "rodando" | "feito" | "erro" | "cancelado";

export interface ItemDaFila {
  id: string;
  client_id: string;
  trabalho_id: string;
  ordem: number;
  lote_id: string;
  status: StatusDaFila;
  etapa: EtapaDaFila;
  paralelo: number;
  corrigir_sozinho: boolean;
  rodadas: number;
  tentativas: number;
  max_tentativas: number;
  passos: number;
  versoes_antes: number | null;
  trava_token: string | null;
  custo_usd: number;
  pedido_por: string | null;
  marca_id: string | null;
}

export const LIMITES_DA_FILA = {
  /** Passos rodando ao mesmo tempo em todos os clientes (memória da função). */
  GLOBAL: 3,
  /** Lâminas do mesmo trabalho ao mesmo tempo. */
  PARALELO_NORMAL: 2,
  /** Carrossel contínuo: uma de cada vez (cada lâmina continua a anterior). */
  PARALELO_CONTINUO: 1,
  MAX_TENTATIVAS: 3,
  MAX_PASSOS: 24,
  /** Trava de um passo: acima do relógio de 400 s da função. */
  TRAVA_SEGUNDOS: 420,
  ESPERA_DO_FUNDO_S: 20,
  ESPERA_DA_REPETICAO_S: 30,
  RODADAS_AUTOMATICAS: 1,
  MAX_ORDENS: 20,
} as const;

/** Sem saldo, cota ou chave: nada mais do lote anda (como o "para tudo" da tela). */
export const CODIGOS_QUE_PARAM_O_LOTE = ["saldo_insuficiente", "cota_da_chave_esgotada", "cliente_sem_chave", "provedor_sem_chave", "sem_modelo"];

/**
 * Falhas de leitura do banco antes de qualquer cobrança: podem repetir com
 * espera. Falha depois da IA (erro_interno, gravacao_falhou) NÃO repete
 * sozinha: repetir cobraria de novo.
 */
export const CODIGOS_QUE_REPETEM = ["acesso_indisponivel", "trabalho_indisponivel", "arquivo_indisponivel"];

export type ResultadoDoPasso =
  | { ok: true; corpo: Record<string, unknown> }
  | { ok: false; codigo: string; mensagem: string };

export interface MudancaDoItem {
  status: StatusDaFila;
  etapa: EtapaDaFila;
  tentativas: number;
  passos: number;
  rodadas: number;
  custo_usd: number;
  proxima_em: string;
  trava_token: null;
  trava_ate: null;
  erro_codigo: string | null;
  erro_mensagem: string | null;
  aviso: string | null;
  concluido_em: string | null;
  atualizado_em: string;
}

const numero = (v: unknown): number => {
  const n = typeof v === "string" ? Number(v) : (v as number);
  return typeof n === "number" && isFinite(n) ? n : 0;
};

/** Custo que a ação devolveu (mesmas formas que a tela lê em custoDaResposta). */
export function custoDoCorpo(corpo: Record<string, unknown>): number {
  const direto = numero(corpo.custo_usd);
  if (direto > 0) return direto;
  const uso = corpo.uso as Record<string, unknown> | undefined;
  if (uso && numero(uso.custo_usd) > 0) return numero(uso.custo_usd);
  return 0;
}

const depois = (agora: Date, segundos: number) => new Date(agora.getTime() + segundos * 1000).toISOString();

/**
 * O que acontece com o item depois de um passo. Sempre solta a trava. O
 * custo do passo soma no item (a carteira já cobrou dentro da ação).
 */
export function proximoPasso(item: ItemDaFila, etapa: EtapaDaFila, r: ResultadoDoPasso, agora: Date): { mudanca: MudancaDoItem; pararLote: string | null } {
  const iso = agora.toISOString();
  const passos = item.passos + 1;
  const custo = Math.round((numero(item.custo_usd) + (r.ok ? custoDoCorpo(r.corpo) : 0)) * 1_000_000) / 1_000_000;
  const base: MudancaDoItem = {
    status: "fila",
    etapa,
    tentativas: item.tentativas,
    passos,
    rodadas: item.rodadas,
    custo_usd: custo,
    proxima_em: iso,
    trava_token: null,
    trava_ate: null,
    erro_codigo: null,
    erro_mensagem: null,
    aviso: null,
    concluido_em: null,
    atualizado_em: iso,
  };
  const feito = (aviso: string | null = null): MudancaDoItem => ({ ...base, status: "feito", aviso, concluido_em: iso });
  const falhou = (codigo: string, mensagem: string): MudancaDoItem => ({ ...base, status: "erro", erro_codigo: codigo, erro_mensagem: mensagem, concluido_em: iso });
  const seguir = (proxima: EtapaDaFila, esperaS = 0, extra: Partial<MudancaDoItem> = {}): MudancaDoItem => {
    if (passos >= LIMITES_DA_FILA.MAX_PASSOS) {
      // A arte pode já estar pronta (conferência pendente): fecha sem erro.
      return proxima === "conferir" || proxima === "corrigir"
        ? feito("A conferência ficou para depois: a lâmina passou do limite de passos.")
        : falhou("passos_esgotados", "A lâmina passou do limite de passos na fila. Gere de novo.");
    }
    return { ...base, etapa: proxima, proxima_em: depois(agora, esperaS), ...extra };
  };

  if (r.ok) {
    const c = r.corpo;
    switch (etapa) {
      case "fundo":
        return { mudanca: c.pendente === true ? seguir("fundo") : seguir("gerar"), pararLote: null };
      case "gerar":
        return { mudanca: seguir("conferir", 0, { tentativas: 0 }), pararLote: null };
      case "conferir": {
        const a = c.autocorrecao as { precisa?: unknown } | null | undefined;
        const precisa = !!a && a.precisa === true;
        if (precisa && item.corrigir_sozinho && item.rodadas < LIMITES_DA_FILA.RODADAS_AUTOMATICAS) {
          return { mudanca: seguir("corrigir", 0, { tentativas: 0 }), pararLote: null };
        }
        return { mudanca: feito(precisa ? "A conferência achou erro na lâmina." : null), pararLote: null };
      }
      case "corrigir":
        if (c.corrigido === true) return { mudanca: seguir("conferir", 0, { tentativas: 0, rodadas: item.rodadas + 1 }), pararLote: null };
        return { mudanca: feito(), pararLote: null };
    }
  }

  const erro = r as { ok: false; codigo: string; mensagem: string };
  // A arte já foi gerada e cobrada: conferência ou correção que falha não derruba a lâmina.
  if (etapa === "conferir" || etapa === "corrigir") {
    return { mudanca: feito(etapa === "conferir" ? "Lâmina pronta, mas a conferência falhou." : "A correção automática não terminou."), pararLote: null };
  }
  if (etapa === "gerar" && erro.codigo === "fundo_pendente") {
    return { mudanca: seguir("fundo"), pararLote: null };
  }
  if (etapa === "fundo" && erro.codigo === "fundo_em_andamento") {
    return { mudanca: seguir("fundo", LIMITES_DA_FILA.ESPERA_DO_FUNDO_S), pararLote: null };
  }
  if (CODIGOS_QUE_REPETEM.indexOf(erro.codigo) >= 0 && item.tentativas + 1 < item.max_tentativas) {
    const tentativas = item.tentativas + 1;
    return { mudanca: seguir(etapa, LIMITES_DA_FILA.ESPERA_DA_REPETICAO_S * tentativas, { tentativas }), pararLote: null };
  }
  const parar = CODIGOS_QUE_PARAM_O_LOTE.indexOf(erro.codigo) >= 0 ? erro.codigo : null;
  return { mudanca: falhou(erro.codigo, erro.mensagem), pararLote: parar };
}

/**
 * Retomada depois de queda do worker: se a lâmina ganhou versão nova desde
 * que o passo "gerar" começou, a geração terminou (e foi cobrada) antes da
 * queda; segue para a conferência em vez de gerar e cobrar de novo.
 */
export function etapaNaRetomada(item: ItemDaFila, versoesAgora: number): EtapaDaFila {
  if (item.etapa === "gerar" && item.tentativas > 0 && item.versoes_antes !== null && versoesAgora > item.versoes_antes) return "conferir";
  return item.etapa;
}

export interface DependenciasDaFila {
  /** Pega o próximo passo de quem pediu (RPC estudio_fila_pegar): trava com o token. */
  pegar: (token: string) => Promise<ItemDaFila | null>;
  /** Versões atuais da lâmina no trabalho. */
  versoes: (item: ItemDaFila) => Promise<number>;
  /** Grava no item só se a trava ainda for deste token. Devolve se gravou. */
  gravar: (item: ItemDaFila, token: string, campos: Record<string, unknown>) => Promise<boolean>;
  /** Roda a ação do Estúdio (gerar_card, conferir_card...). */
  executar: (etapa: EtapaDaFila, item: ItemDaFila) => Promise<ResultadoDoPasso>;
  /** Sem saldo/cota/chave: cancela o que ainda não começou no mesmo lote. */
  pararLote: (item: ItemDaFila, codigo: string) => Promise<void>;
  agora: () => Date;
}

export interface PassoProcessado {
  item: ItemDaFila;
  etapa: EtapaDaFila;
  mudanca: MudancaDoItem;
  gravou: boolean;
}

/** Roda e grava o passo de um item já pego (com a trava deste token). */
export async function processarItem(deps: DependenciasDaFila, item: ItemDaFila, token: string): Promise<PassoProcessado> {
  let etapa = item.etapa;
  if (etapa === "gerar") {
    const versoes = await deps.versoes(item).catch(() => null);
    if (versoes !== null) {
      etapa = etapaNaRetomada(item, versoes);
      // Guarda quantas versões havia antes de gerar (só na primeira tentativa).
      if (etapa === "gerar" && (item.tentativas === 0 || item.versoes_antes === null)) {
        await deps.gravar(item, token, { versoes_antes: versoes });
      }
    }
  }
  let r: ResultadoDoPasso;
  try {
    r = await deps.executar(etapa, item);
  } catch (e) {
    r = { ok: false, codigo: "erro_interno", mensagem: e instanceof Error && e.message ? e.message.slice(0, 300) : "Erro inesperado no estúdio." };
  }
  const { mudanca, pararLote } = proximoPasso(item, etapa, r, deps.agora());
  const gravou = await deps.gravar(item, token, mudanca as unknown as Record<string, unknown>);
  if (pararLote) await deps.pararLote(item, pararLote).catch(() => undefined);
  return { item, etapa, mudanca, gravou };
}

/** Um passo: pega, roda e grava. Null quando não havia nada para pegar. */
export async function processarUmPasso(deps: DependenciasDaFila, token: string): Promise<PassoProcessado | null> {
  const item = await deps.pegar(token);
  if (!item) return null;
  return processarItem(deps, item, token);
}

/** Ordens válidas do pedido: inteiras, da direção, sem repetir, na ordem pedida, até o teto. */
export function ordensDoPedido(pedidas: unknown, daDirecao: number[]): number[] {
  const lista = Array.isArray(pedidas) ? pedidas : [];
  const saida: number[] = [];
  for (const v of lista) {
    const n = typeof v === "string" ? Number(v) : v;
    if (typeof n !== "number" || !isFinite(n) || Math.floor(n) !== n) continue;
    if (daDirecao.indexOf(n) < 0 || saida.indexOf(n) >= 0) continue;
    saida.push(n);
    if (saida.length >= LIMITES_DA_FILA.MAX_ORDENS) break;
  }
  return saida;
}
