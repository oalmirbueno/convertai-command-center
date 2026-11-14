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
 * - espera entre tentativas: 20 s no fundo ocupado, 15 s esperando a capa
 *   (frente T2: a lâmina 2+ espera a âncora tipográfica), 30 s x tentativa nas
 *   falhas de leitura; a vigia do painel chama no máximo a cada 30 s;
 * - correção automática: 1 rodada, e só com "Corrigir sozinho" ligado.
 *
 * Vigia (14/11/2026): em 14/11 a função morreu por "CPU Time exceeded" logo
 * depois de gravar a arte (SKC, lâmina 5) e a linha ficou "rodando" até alguém
 * chamar a fila de novo. Agora todo processar_fila começa limpando o que ficou
 * preso, de QUALQUER pessoa (decidirPreso): arte já gravada segue para a
 * conferência (nunca gera de novo), trava vencida volta para a fila com
 * espera e tentativa contada, tentativas esgotadas ou abandono viram erro
 * registrado. A contagem de antes do gerar (versoes_antes) fica na linha
 * enquanto o gerar aberto não foi conferido, inclusive na nova tentativa. O
 * status do trabalho deixa de ficar "gerando" quando o lote acaba
 * (statusDoTrabalhoEmProducao).
 */

// Frente FS (29/09): leitura ou gravação que falha segue opcional, mas fica no log com o motivo.
import { registrarFalha } from "../_shared/falha-registrada.ts";

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
  /** Frente T2: lâmina 2+ esperando a capa (âncora tipográfica da série); o teto de passos limita a espera. */
  ESPERA_DA_CAPA_S: 15,
  ESPERA_DA_REPETICAO_S: 30,
  RODADAS_AUTOMATICAS: 1,
  MAX_ORDENS: 20,
  /** Vigia: arte gravada há mais que isto com a linha ainda em "rodando/gerar" = a função morreu depois de gravar. */
  GRACA_DA_ARTE_S: 60,
  /** Vigia: trava vencida há mais que isto e ninguém retomou (painel de quem pediu fechado) = abandonado. */
  ABANDONO_S: 30 * 60,
  /** Chute com espera (fundo ocupado, nova tentativa): acima disto a retomada fica com a vigia do painel. */
  ESPERA_MAXIMA_DO_CHUTE_S: 90,
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
  /**
   * Contagem de versões de antes do "gerar". Fica enquanto o gerar segue aberto (nova tentativa ou espera que
   * continua no gerar); sai (null) quando a linha fecha ou muda de etapa.
   */
  versoes_antes: number | null;
}

/** Texto que a linha leva enquanto espera (a tela mostra "na fila" com este motivo, sem zerar o tempo). */
export const AVISO_ESPERANDO_A_CAPA = "Esperando a capa";
export const avisoDeNovaTentativa = (tentativa: number, max: number) => `Nova tentativa (${tentativa} de ${max})`;

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
    versoes_antes: null,
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
    // Repetição que continua no gerar (leitura que falhou, espera da capa): o gerar aberto não foi conferido,
    // então a contagem de antes dele fica. Zerar aqui fazia a tentativa seguinte tomar a arte já gravada como
    // ponto de partida e gerar (e cobrar) de novo.
    const versoes_antes = etapa === "gerar" && proxima === "gerar" ? item.versoes_antes : null;
    return { ...base, etapa: proxima, proxima_em: depois(agora, esperaS), versoes_antes, ...extra };
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
  // Frente T2: a capa do mesmo trabalho ainda está gerando; esta lâmina espera por ela (mesma tipografia).
  if (etapa === "gerar" && erro.codigo === "capa_pendente") {
    return { mudanca: seguir("gerar", LIMITES_DA_FILA.ESPERA_DA_CAPA_S, { aviso: AVISO_ESPERANDO_A_CAPA }), pararLote: null };
  }
  if (CODIGOS_QUE_REPETEM.indexOf(erro.codigo) >= 0 && item.tentativas + 1 < item.max_tentativas) {
    const tentativas = item.tentativas + 1;
    return {
      mudanca: seguir(etapa, LIMITES_DA_FILA.ESPERA_DA_REPETICAO_S * tentativas, { tentativas, aviso: avisoDeNovaTentativa(tentativas + 1, item.max_tentativas) }),
      pararLote: null,
    };
  }
  const parar = CODIGOS_QUE_PARAM_O_LOTE.indexOf(erro.codigo) >= 0 ? erro.codigo : null;
  return { mudanca: falhou(erro.codigo, erro.mensagem), pararLote: parar };
}

/**
 * Retomada depois de queda do worker: se a lâmina ganhou versão nova desde
 * que o passo "gerar" começou, a geração terminou (e foi cobrada) antes da
 * queda; segue para a conferência em vez de gerar e cobrar de novo.
 *
 * 14/11/2026: não depende mais de `tentativas > 0`. A contagem `versoes_antes`
 * só existe enquanto um "gerar" está aberto (a linha que fecha ou muda de etapa
 * a zera; a repetição que continua no gerar a mantém), então versão a mais com
 * ela preenchida já é a prova de que a arte saiu, mesmo quando a função morreu
 * na primeira tentativa (SKC, lâmina 5: tentativas 0, arte gravada).
 */
export function etapaNaRetomada(item: ItemDaFila, versoesAgora: number): EtapaDaFila {
  if (item.etapa === "gerar" && item.versoes_antes !== null && versoesAgora > item.versoes_antes) return "conferir";
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
  let semLeitura = false;
  // O item como o passo o deixa: com a contagem que este gerar acabou de guardar (a repetição no gerar a mantém).
  let aberto = item;
  if (etapa === "gerar") {
    const versoes = await deps.versoes(item).catch((e) => (registrarFalha("estudio-arte: versoes falhou", e), null));
    if (versoes !== null) {
      etapa = etapaNaRetomada(item, versoes);
      // Guarda quantas versões havia antes de gerar. Preenchida = um gerar anterior não fechou: fica a contagem dele.
      if (etapa === "gerar" && item.versoes_antes === null) {
        await deps.gravar(item, token, { versoes_antes: versoes });
        aberto = { ...item, versoes_antes: versoes };
      }
    } else if (item.versoes_antes !== null) {
      // Retomada de um gerar que não fechou e o trabalho não pôde ser lido: sem saber se a arte já saiu, não gera (não cobra) às cegas.
      semLeitura = true;
    }
  }
  let r: ResultadoDoPasso;
  if (semLeitura) {
    r = { ok: false, codigo: "trabalho_indisponivel", mensagem: "Não foi possível conferir se a arte desta lâmina já tinha saído. Gere de novo em instantes." };
  } else {
    try {
      r = await deps.executar(etapa, item);
    } catch (e) {
      r = { ok: false, codigo: "erro_interno", mensagem: e instanceof Error && e.message ? e.message.slice(0, 300) : "Erro inesperado no estúdio." };
    }
  }
  const { mudanca, pararLote } = proximoPasso(aberto, etapa, r, deps.agora());
  const gravou = await deps.gravar(item, token, mudanca as unknown as Record<string, unknown>);
  if (pararLote) await deps.pararLote(item, pararLote).catch((e) => (registrarFalha("estudio-arte: pararLote falhou", e), undefined));
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

// ------------------------------------------------------------------ vigia
//
// 14/11/2026. O que ficou preso em "rodando" (a função morreu por limite de
// CPU, o painel de quem pediu fechou) é resolvido aqui, sem gerar nada: a
// vigia só muda a linha da fila. Roda no começo de todo processar_fila, com a
// chave de serviço, para as linhas de QUALQUER pessoa (a RPC estudio_fila_pegar
// só olha as de quem chamou).

/** Linha "rodando" como a vigia lê (com a validade da trava e a hora da última pegada). */
export interface ItemPreso extends ItemDaFila {
  trava_ate: string | null;
  /** A RPC renova na pegada: é a hora em que o passo atual começou. */
  atualizado_em: string | null;
}

/** Versões da lâmina no trabalho agora e a hora da mais nova (para saber se a arte saiu neste passo). */
export interface ArteDaLamina {
  versoes: number;
  ultima_em: string | null;
}

export type AcaoDaVigia = "conferir" | "feito" | "repetir" | "erro";

export interface DecisaoDaVigia {
  acao: AcaoDaVigia;
  campos: Record<string, unknown>;
}

const segundosDesde = (iso: string | null | undefined, agora: Date): number | null => {
  const t = iso ? Date.parse(iso) : NaN;
  return isFinite(t) ? (agora.getTime() - t) / 1000 : null;
};

/** A trava deste passo venceu? "rodando" sem trava também conta (linha órfã). */
export function travaVencida(item: Pick<ItemPreso, "trava_ate">, agora: Date): boolean {
  const s = segundosDesde(item.trava_ate, agora);
  return s === null || s > 0;
}

/**
 * Vale ler o trabalho para saber se a arte já saiu? Só no "gerar" aberto
 * (versoes_antes preenchida) e quando a trava venceu ou o passo já roda há
 * mais que a folga: passo novo não paga a leitura.
 */
export function precisaLerAArte(item: ItemPreso, agora: Date): boolean {
  if (item.status !== "rodando" || item.etapa !== "gerar" || item.versoes_antes === null) return false;
  if (travaVencida(item, agora)) return true;
  const rodando = segundosDesde(item.atualizado_em, agora);
  return rodando !== null && rodando >= LIMITES_DA_FILA.GRACA_DA_ARTE_S;
}

/**
 * O que fazer com uma linha "rodando". Null: está viva (ou ainda na folga), não mexe.
 *
 * - arte nova já gravada neste "gerar" (a função morreu depois de gravar): segue
 *   para a conferência; se ninguém vai conferir (abandonada, passos no teto),
 *   fecha como feita com aviso. NUNCA volta para gerar.
 * - trava vencida na conferência ou na correção: a arte existe; repete com
 *   espera e, no teto ou no abandono, fecha como feita com aviso (não vira erro).
 * - trava vencida no gerar ou no fundo, sem arte nova: volta para a fila com a
 *   tentativa contada e espera de 30 s x tentativa; no teto de tentativas ou no
 *   abandono, erro registrado.
 * - sem conseguir ler o trabalho (arte null num gerar aberto): não decide.
 */
export function decidirPreso(item: ItemPreso, arte: ArteDaLamina | null, agora: Date): DecisaoDaVigia | null {
  if (item.status !== "rodando") return null;
  const iso = agora.toISOString();
  const vencida = travaVencida(item, agora);
  const vencidaHa = segundosDesde(item.trava_ate, agora);
  const abandonada = vencida && (vencidaHa === null || vencidaHa >= LIMITES_DA_FILA.ABANDONO_S);
  const solta = { trava_token: null, trava_ate: null, atualizado_em: iso };
  const feito = (aviso: string): DecisaoDaVigia => ({
    acao: "feito",
    campos: { ...solta, status: "feito", aviso, erro_codigo: null, erro_mensagem: null, versoes_antes: null, concluido_em: iso },
  });
  const erro = (codigo: string, mensagem: string): DecisaoDaVigia => ({
    acao: "erro",
    campos: { ...solta, status: "erro", erro_codigo: codigo, erro_mensagem: mensagem, concluido_em: iso },
  });
  const repetir = (): DecisaoDaVigia => {
    const tentativas = item.tentativas + 1;
    return {
      acao: "repetir",
      campos: {
        ...solta,
        status: "fila",
        tentativas,
        proxima_em: depois(agora, LIMITES_DA_FILA.ESPERA_DA_REPETICAO_S * tentativas),
        aviso: avisoDeNovaTentativa(tentativas + 1, item.max_tentativas),
      },
    };
  };

  const gerarAberto = item.etapa === "gerar" && item.versoes_antes !== null;
  if (gerarAberto && arte && arte.versoes > (item.versoes_antes as number)) {
    const idade = segundosDesde(arte.ultima_em, agora);
    // A função viva grava a linha logo depois da arte: dentro da folga, espera por ela.
    if (!vencida && !(idade !== null && idade >= LIMITES_DA_FILA.GRACA_DA_ARTE_S)) return null;
    if (abandonada || item.passos + 1 >= LIMITES_DA_FILA.MAX_PASSOS) {
      return feito("A arte ficou pronta, mas a função parou antes da conferência (limite do servidor). Confira a lâmina.");
    }
    return {
      acao: "conferir",
      campos: { ...solta, status: "fila", etapa: "conferir", tentativas: 0, passos: item.passos + 1, proxima_em: iso, aviso: null, versoes_antes: null },
    };
  }
  if (!vencida) return null;

  if (item.etapa === "conferir" || item.etapa === "corrigir") {
    if (abandonada || item.tentativas + 1 >= item.max_tentativas) {
      return feito(item.etapa === "conferir" ? "Lâmina pronta, mas a conferência parou no servidor. Confira a lâmina." : "A correção automática parou no servidor. Confira a lâmina.");
    }
    return repetir();
  }

  // Gerar aberto sem leitura do trabalho: sem saber se a arte saiu, não manda gerar de novo (espera a próxima
  // volta). Abandonada, fecha como erro mais abaixo: erro não gera nada, e a arte, se saiu, está no trabalho.
  if (gerarAberto && !arte && !abandonada) return null;
  if (!abandonada && item.tentativas + 1 >= item.max_tentativas) {
    return erro("tentativas_esgotadas", `A geração desta lâmina parou ${item.max_tentativas} vezes no servidor (limite de processamento) e nenhuma arte nova foi gravada. Gere de novo.`);
  }
  if (abandonada) {
    return erro("abandonado", "A geração desta lâmina parou no servidor e ninguém retomou (o painel de quem pediu ficou fechado). Nenhuma arte nova foi gravada. Gere de novo.");
  }
  return repetir();
}

export interface DependenciasDaVigia {
  /** Linhas em "rodando" de todas as pessoas (chave de serviço). */
  presos: () => Promise<ItemPreso[]>;
  /** Versões da lâmina no trabalho; null quando não deu para ler. */
  arte: (item: ItemPreso) => Promise<ArteDaLamina | null>;
  /** Grava só se a linha ainda é a mesma (rodando, mesma trava). Devolve se gravou. */
  aplicar: (item: ItemPreso, campos: Record<string, unknown>) => Promise<boolean>;
  agora: () => Date;
}

export interface LinhaVigiada {
  item: ItemPreso;
  acao: AcaoDaVigia;
}

/** Uma volta da vigia: resolve o que ficou preso. Falha numa linha não para as outras. */
export async function vigiarFila(deps: DependenciasDaVigia): Promise<LinhaVigiada[]> {
  const agora = deps.agora();
  const feitas: LinhaVigiada[] = [];
  for (const item of await deps.presos()) {
    try {
      const arte = precisaLerAArte(item, agora)
        ? await deps.arte(item).catch((e) => (registrarFalha("estudio-arte: vigia não leu a arte", e, { item: item.id }), null))
        : null;
      const d = decidirPreso(item, arte, agora);
      if (!d) continue;
      if (await deps.aplicar(item, d.campos)) feitas.push({ item, acao: d.acao });
    } catch (e) {
      registrarFalha("estudio-arte: vigia falhou numa linha", e, { item: item.id });
    }
  }
  return feitas;
}

// ------------------------------------------------------------ fim do lote

/**
 * Status do trabalho que tem direção e ainda não foi entregue. "gerando" só
 * enquanto há outra lâmina do trabalho gerando na fila; lote acabado com
 * lâmina faltando volta para "dirigido" (a tela mostra "5 de 7 com arte"),
 * em vez de ficar "gerando" para sempre (33 trabalhos assim em 14/11).
 */
export function statusDoTrabalhoEmProducao(o: { ordensDaDirecao: number[]; ordensComArte: number[]; geracaoAtiva: boolean }): "pronto" | "gerando" | "dirigido" {
  const completo = o.ordensDaDirecao.every((ordem) => o.ordensComArte.indexOf(ordem) >= 0);
  if (completo) return "pronto";
  return o.geracaoAtiva ? "gerando" : "dirigido";
}

/** O passo fechou a linha (não vai mais andar sozinha)? */
export const linhaFechada = (status: StatusDaFila): boolean => status === "feito" || status === "erro" || status === "cancelado";

/**
 * A capa saiu do gerar (ganhou versão, falhou ou foi cancelada)? As lâminas
 * que esperavam por ela (capa_pendente) podem andar na hora, sem esperar os
 * 15 s nem a vigia do painel.
 */
export function capaLiberouAsOutras(item: Pick<ItemDaFila, "ordem">, etapa: EtapaDaFila, mudanca: Pick<MudancaDoItem, "status" | "etapa">): boolean {
  if (item.ordem !== 1 || (etapa !== "gerar" && etapa !== "fundo")) return false;
  if (linhaFechada(mudanca.status)) return true;
  return mudanca.etapa === "conferir" || mudanca.etapa === "corrigir";
}

/**
 * Espera, em ms, antes do chute que retoma ESTA linha (fundo ocupado, nova
 * tentativa). Null: sem chute com espera (linha fechada, anda já, espera a
 * capa, que a própria capa libera, ou espera longa demais, que fica com a vigia).
 */
export function esperaDoChute(mudanca: Pick<MudancaDoItem, "status" | "proxima_em" | "aviso">, agora: Date): number | null {
  if (mudanca.status !== "fila" || mudanca.aviso === AVISO_ESPERANDO_A_CAPA) return null;
  const ms = Date.parse(mudanca.proxima_em) - agora.getTime();
  if (!isFinite(ms) || ms <= 0 || ms > LIMITES_DA_FILA.ESPERA_MAXIMA_DO_CHUTE_S * 1000) return null;
  return ms;
}
