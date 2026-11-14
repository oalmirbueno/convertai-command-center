/**
 * Ações longas da lâmina em segundo plano (14/11/2026).
 *
 * Relato da Orion: o ajuste "parava no meio". O ajuste (ajustar_card) não
 * passava pela fila: a tela ficava esperando o corpo da resposta com fôlego
 * (HTTP 200 na hora, corpo no fim). Quando a função morria por "CPU Time
 * exceeded", o corpo era cortado e a tela mostrava "A função parou no meio
 * (limite do servidor)", mesmo quando a arte já tinha sido gravada.
 *
 * Agora a tela manda `segundo_plano: true`. A função confere o acesso, registra
 * o pedido no próprio trabalho (direcao.em_segundo_plano, sem mudar o schema),
 * responde 202 na hora e roda a MESMA ação com EdgeRuntime.waitUntil. No fim,
 * grava no pedido o corpo que a chamada direta devolveria (sem o trabalho
 * inteiro) e a tela acompanha pelo banco, como a fila de geração.
 *
 * Função morta no meio: o pedido para de dar pulso (um a cada 25 s). Sem pulso
 * há 75 s, a tela olha se a versão nova já existe (a arte saiu antes da queda:
 * segue, sem gerar de novo) e só então avisa a falha. Lâmina com pedido vivo
 * não aceita outro: dois cliques não cobram duas vezes.
 *
 * Quem chama sem `segundo_plano` (Mesa Ads antiga, MCP, a própria fila) segue
 * como antes. Este arquivo é só a regra (pura, testada em
 * src/test/estudio-fila-de-geracao.test.tsx); o banco entra por quem chama.
 */

export const ACOES_EM_SEGUNDO_PLANO = ["ajustar_card", "ajustar_texto", "conferir_card", "corrigir_card"] as const;
export type AcaoEmSegundoPlano = (typeof ACOES_EM_SEGUNDO_PLANO)[number];

export const LIMITES_DO_SEGUNDO_PLANO = {
  /** Teto do pedido: acima do relógio de 400 s da função. */
  PRAZO_S: 420,
  /** Um pulso a cada. */
  PULSO_S: 25,
  /** Sem pulso há mais que isto (3 pulsos perdidos): a função morreu. */
  SEM_PULSO_S: 75,
  /** Pedido terminado sai do trabalho depois disto (a tela lê o resultado em segundos; o resto é folga). */
  GUARDA_S: 10 * 60,
  /** Teto do corpo guardado no pedido (o trabalho inteiro nunca vai junto). */
  MAX_RESULTADO: 60_000,
} as const;

export type StatusDoPedido = "rodando" | "feito" | "erro";

export interface PedidoEmSegundoPlano {
  id: string;
  acao: AcaoEmSegundoPlano;
  ordem: number;
  status: StatusDoPedido;
  /** Quando a tela pediu: o cronômetro da lâmina conta daqui, sem recomeçar. */
  desde: string;
  prazo: string;
  pulso: string;
  por: string | null;
  /** Versões da lâmina quando o pedido entrou: versão a mais = a arte saiu. */
  versoes_antes: number;
  terminou_em?: string | null;
  /** O corpo que a chamada direta devolveria (com `error` quando falhou), sem o trabalho inteiro. */
  resultado?: Record<string, unknown> | null;
}

export type PedidosDoTrabalho = Record<string, PedidoEmSegundoPlano>;

/** Chave do pedido da lâmina (uma lâmina tem no máximo um pedido por vez). */
export const chaveDaLamina = (ordem: number) => `l${ordem}`;

export function pedeSegundoPlano(acao: string, corpo: Record<string, unknown>): acao is AcaoEmSegundoPlano {
  return corpo.segundo_plano === true && (ACOES_EM_SEGUNDO_PLANO as readonly string[]).indexOf(acao) >= 0;
}

const ms = (iso: unknown): number => {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  return isFinite(t) ? t : NaN;
};

/** O que veio do banco vira um mapa limpo (o campo é JSON livre dentro da direção). */
export function pedidosDoTrabalho(bruto: unknown): PedidosDoTrabalho {
  const saida: PedidosDoTrabalho = {};
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return saida;
  for (const chave of Object.keys(bruto as Record<string, unknown>)) {
    const p = (bruto as Record<string, unknown>)[chave] as Partial<PedidoEmSegundoPlano> | null;
    if (!p || typeof p !== "object" || typeof p.id !== "string" || typeof p.ordem !== "number") continue;
    if ((ACOES_EM_SEGUNDO_PLANO as readonly string[]).indexOf(String(p.acao)) < 0) continue;
    if (p.status !== "rodando" && p.status !== "feito" && p.status !== "erro") continue;
    if (!isFinite(ms(p.desde))) continue;
    saida[chave] = p as PedidoEmSegundoPlano;
  }
  return saida;
}

/** O pedido ainda está rodando de verdade (dentro do prazo e com pulso recente)? */
export function pedidoVivo(p: PedidoEmSegundoPlano | null | undefined, agora: Date): boolean {
  if (!p || p.status !== "rodando") return false;
  const t = agora.getTime();
  const prazo = ms(p.prazo);
  if (isFinite(prazo) && t > prazo) return false;
  const pulso = ms(p.pulso);
  const ultimo = isFinite(pulso) ? pulso : ms(p.desde);
  return t - ultimo <= LIMITES_DO_SEGUNDO_PLANO.SEM_PULSO_S * 1000;
}

export function novoPedido(o: { id: string; acao: AcaoEmSegundoPlano; ordem: number; por: string | null; versoes_antes: number }, agora: Date): PedidoEmSegundoPlano {
  const iso = agora.toISOString();
  return {
    id: o.id,
    acao: o.acao,
    ordem: o.ordem,
    status: "rodando",
    desde: iso,
    prazo: new Date(agora.getTime() + LIMITES_DO_SEGUNDO_PLANO.PRAZO_S * 1000).toISOString(),
    pulso: iso,
    por: o.por,
    versoes_antes: o.versoes_antes,
  };
}

/** Tira do mapa o que terminou há tempo e o que morreu há tempo (a tela já leu ou já desistiu). */
function semOsVelhos(pedidos: PedidosDoTrabalho, agora: Date): PedidosDoTrabalho {
  const saida: PedidosDoTrabalho = {};
  const corte = agora.getTime() - LIMITES_DO_SEGUNDO_PLANO.GUARDA_S * 1000;
  for (const chave of Object.keys(pedidos)) {
    const p = pedidos[chave];
    const fim = p.status === "rodando" ? Math.max(ms(p.pulso) || 0, ms(p.desde) || 0) : ms(p.terminou_em ?? p.desde);
    if (isFinite(fim) && fim < corte) continue;
    saida[chave] = p;
  }
  return saida;
}

export type RegistroDoPedido =
  | { ok: true; pedidos: PedidosDoTrabalho }
  | { ok: false; ocupada: PedidoEmSegundoPlano };

/** Registra o pedido da lâmina. Lâmina com pedido vivo não aceita outro (nada roda, nada cobra duas vezes). */
export function registrarPedido(pedidos: PedidosDoTrabalho, novo: PedidoEmSegundoPlano, agora: Date): RegistroDoPedido {
  const chave = chaveDaLamina(novo.ordem);
  const atual = pedidos[chave];
  if (pedidoVivo(atual, agora)) return { ok: false, ocupada: atual };
  return { ok: true, pedidos: { ...semOsVelhos(pedidos, agora), [chave]: novo } };
}

/** Pulso do pedido que ainda é o da lâmina. Null: o pedido saiu (outro entrou) ou já terminou; nada a gravar. */
export function pulsarPedido(pedidos: PedidosDoTrabalho, ordem: number, id: string, agora: Date): PedidosDoTrabalho | null {
  const chave = chaveDaLamina(ordem);
  const p = pedidos[chave];
  if (!p || p.id !== id || p.status !== "rodando") return null;
  return { ...pedidos, [chave]: { ...p, pulso: agora.toISOString() } };
}

/**
 * Corpo da resposta sem o trabalho inteiro (a tela relê o trabalho do banco) e
 * com teto de tamanho: acima dele ficam só os campos simples.
 */
export function resultadoEnxuto(corpo: Record<string, unknown>): Record<string, unknown> {
  const saida: Record<string, unknown> = {};
  for (const k of Object.keys(corpo)) if (k !== "trabalho") saida[k] = corpo[k];
  if (JSON.stringify(saida).length <= LIMITES_DO_SEGUNDO_PLANO.MAX_RESULTADO) return saida;
  const simples: Record<string, unknown> = { resumido: true };
  for (const k of Object.keys(saida)) {
    const v = saida[k];
    if (v === null || typeof v === "number" || typeof v === "boolean" || (typeof v === "string" && v.length <= 2_000)) simples[k] = v;
  }
  return simples;
}

/** Corpo de uma resposta de erro sempre com `error` (o que a tela lê) e o status HTTP que a chamada direta teria. */
export function corpoComStatus(corpo: Record<string, unknown>, ok: boolean, status: number): Record<string, unknown> {
  if (ok && typeof corpo.error !== "string") return corpo;
  return { ...corpo, error: typeof corpo.error === "string" ? corpo.error : "falha_interna", status_http: status };
}

/** Fecha o pedido com o corpo da ação. Null: o pedido não é mais o da lâmina (nada a gravar). */
export function concluirPedido(pedidos: PedidosDoTrabalho, ordem: number, id: string, corpo: Record<string, unknown>, agora: Date): PedidosDoTrabalho | null {
  const chave = chaveDaLamina(ordem);
  const p = pedidos[chave];
  if (!p || p.id !== id) return null;
  const iso = agora.toISOString();
  const resultado = resultadoEnxuto(corpo);
  return {
    ...pedidos,
    [chave]: { ...p, status: typeof resultado.error === "string" ? "erro" : "feito", pulso: iso, terminou_em: iso, resultado },
  };
}

/** O que volta no 202: só o que a tela precisa para acompanhar. */
export function pedidoParaATela(p: PedidoEmSegundoPlano): Record<string, unknown> {
  return { id: p.id, acao: p.acao, ordem: p.ordem, desde: p.desde, prazo: p.prazo, versoes_antes: p.versoes_antes };
}
