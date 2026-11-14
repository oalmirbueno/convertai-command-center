import { useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao, corpoOuErro, ErroDaMesa, mensagemDoCodigo, type FuncaoDaMesa } from "@/lib/mesa/api";
import type { AndamentoDaLamina, EtapaDaLamina } from "@/components/mesa/PranchetaDoEstudio";

/**
 * Ações longas da lâmina em segundo plano (14/11/2026).
 *
 * Relato da Orion: o ajuste "parava no meio" ("A função parou no meio (limite
 * do servidor)"). A tela esperava o corpo da resposta com fôlego; quando a
 * função morria por limite de CPU, o corpo era cortado, mesmo com a arte já
 * gravada.
 *
 * Agora a tela pede com `segundo_plano: true`: a estudio-arte responde 202 na
 * hora com o pedido (registrado em estudio_trabalhos.direcao.em_segundo_plano,
 * sem mudar o schema), roda a ação depois da resposta e grava no pedido o
 * corpo que a chamada direta devolveria. Aqui a tela acompanha pelo banco,
 * como a fila de geração: fechar a tela não perde nada, e o indicador da
 * lâmina volta com o mesmo início ao reabrir.
 *
 * Função morta no meio: o pedido para de dar pulso. Sem pulso há 75 s, a tela
 * olha se a versão nova já existe (a arte saiu antes da queda: segue sem pedir
 * de novo) e só então mostra a falha (funcao_interrompida, como antes).
 *
 * Com a função antiga no ar (sem o segundo plano), a resposta já é o corpo
 * final e nada muda. Regra do servidor: supabase/functions/estudio-arte/segundo-plano.ts.
 */

export type AcaoEmSegundoPlano = "ajustar_card" | "ajustar_texto" | "conferir_card" | "corrigir_card";

/** Os mesmos números do servidor (segundo-plano.ts), fixados juntos no teste. */
export const SEM_PULSO_MS = 75_000;
export const INTERVALO_DO_PEDIDO_MS = 2_500;
/** Depois do prazo do pedido, a tela ainda espera isto pela gravação final. */
export const FOLGA_DO_PRAZO_MS = 15_000;
export const INTERVALO_DA_LEITURA_MS = 4_000;
/** Entre um pedido e o seguinte da mesma lâmina (ajustar, depois conferir), a leitura segue por este tempo. */
export const CAUDA_DA_LEITURA_MS = 20_000;

export interface PedidoNaTela {
  id: string;
  acao: AcaoEmSegundoPlano;
  ordem: number;
  status: "rodando" | "feito" | "erro";
  desde: string;
  prazo: string | null;
  pulso: string | null;
  versoes_antes: number;
  resultado: Record<string, unknown> | null;
}

export type PedidosNaTela = Record<string, PedidoNaTela>;

const ACOES: AcaoEmSegundoPlano[] = ["ajustar_card", "ajustar_texto", "conferir_card", "corrigir_card"];
const chaveDaLamina = (ordem: number) => `l${ordem}`;
const ms = (iso: unknown): number => {
  const t = typeof iso === "string" ? Date.parse(iso) : NaN;
  return isFinite(t) ? t : NaN;
};

function pedidoDaLinha(b: unknown): PedidoNaTela | null {
  if (!b || typeof b !== "object") return null;
  const p = b as Record<string, unknown>;
  if (typeof p.id !== "string" || ACOES.indexOf(p.acao as AcaoEmSegundoPlano) < 0) return null;
  const ordem = Number(p.ordem);
  if (!isFinite(ordem) || !isFinite(ms(p.desde))) return null;
  const status = p.status === "feito" || p.status === "erro" ? p.status : "rodando";
  return {
    id: p.id,
    acao: p.acao as AcaoEmSegundoPlano,
    ordem,
    status,
    desde: String(p.desde),
    prazo: typeof p.prazo === "string" ? p.prazo : null,
    pulso: typeof p.pulso === "string" ? p.pulso : null,
    versoes_antes: isFinite(Number(p.versoes_antes)) ? Number(p.versoes_antes) : 0,
    resultado: p.resultado && typeof p.resultado === "object" ? (p.resultado as Record<string, unknown>) : null,
  };
}

/** direcao.em_segundo_plano do banco (JSON livre) como mapa limpo. */
export function pedidosDaDirecao(bruto: unknown): PedidosNaTela {
  const saida: PedidosNaTela = {};
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return saida;
  for (const chave of Object.keys(bruto as Record<string, unknown>)) {
    const p = pedidoDaLinha((bruto as Record<string, unknown>)[chave]);
    if (p) saida[chave] = p;
  }
  return saida;
}

/** O pedido ainda está rodando de verdade (dentro do prazo e com pulso recente)? */
export function pedidoVivo(p: PedidoNaTela | null | undefined, agora = Date.now()): boolean {
  if (!p || p.status !== "rodando") return false;
  const prazo = ms(p.prazo);
  if (isFinite(prazo) && agora > prazo) return false;
  const pulso = ms(p.pulso);
  const ultimo = isFinite(pulso) ? pulso : ms(p.desde);
  return agora - ultimo <= SEM_PULSO_MS;
}

export const ETAPA_DO_PEDIDO: Record<AcaoEmSegundoPlano, EtapaDaLamina> = {
  ajustar_card: "ajustando",
  ajustar_texto: "ajustando",
  conferir_card: "conferindo",
  corrigir_card: "corrigindo",
};

/**
 * Andamento por lâmina dos pedidos vivos, no formato do indicador da
 * prancheta. O início é o do pedido (gravado no servidor): reabrir a tela ou
 * reler o banco não recomeça o cronômetro.
 */
export function andamentoDosPedidos(pedidos: PedidosNaTela, agora = Date.now()): Record<number, AndamentoDaLamina> {
  const saida: Record<number, AndamentoDaLamina> = {};
  for (const chave of Object.keys(pedidos)) {
    const p = pedidos[chave];
    if (!pedidoVivo(p, agora)) continue;
    saida[p.ordem] = { etapa: ETAPA_DO_PEDIDO[p.acao], desde: ms(p.desde) };
  }
  return saida;
}

export type SituacaoDoPedido =
  | { tipo: "esperar" }
  | { tipo: "pronto"; corpo: Record<string, unknown> }
  | { tipo: "sem_sinal" };

/**
 * Onde o pedido está, pela leitura do banco: ainda rodando (esperar), fechado
 * com o corpo da ação (pronto) ou sem sinal (a função morreu sem fechar, ou o
 * pedido saiu do trabalho).
 */
export function situacaoDoPedido(pedidos: PedidosNaTela, pedido: { id: string; ordem: number }, agora = Date.now()): SituacaoDoPedido {
  const p = pedidos[chaveDaLamina(pedido.ordem)];
  if (!p || p.id !== pedido.id) return { tipo: "sem_sinal" };
  if (p.status !== "rodando") return { tipo: "pronto", corpo: p.resultado || {} };
  return pedidoVivo(p, agora) ? { tipo: "esperar" } : { tipo: "sem_sinal" };
}

// ------------------------------------------------------------------ banco

/** Uma linha do trabalho pelo id (só as colunas pedidas). */
type LinhaDoTrabalho = { data: Record<string, unknown> | null; error: unknown };
const lerDoTrabalho = (trabalhoId: string, colunas: string): Promise<LinhaDoTrabalho> =>
  (supabase as unknown as {
    from: (tabela: string) => { select: (c: string) => { eq: (coluna: string, valor: string) => { maybeSingle: () => Promise<LinhaDoTrabalho> } } };
  }).from("estudio_trabalhos").select(colunas).eq("id", trabalhoId).maybeSingle();

/** Pedidos em segundo plano do trabalho (uma leitura leve: só o campo da direção). */
export async function lerPedidosDoTrabalho(trabalhoId: string): Promise<PedidosNaTela> {
  const { data, error } = await lerDoTrabalho(trabalhoId, "pedidos:direcao->em_segundo_plano");
  if (error) throw error;
  return pedidosDaDirecao(data && data.pedidos);
}

/** Quantas versões a lâmina tem agora no trabalho. Null quando não deu para ler. */
export async function versoesDaLamina(trabalhoId: string, ordem: number): Promise<number | null> {
  try {
    const { data, error } = await lerDoTrabalho(trabalhoId, "cards");
    if (error || !data || !Array.isArray(data.cards)) return null;
    return (data.cards as Array<{ ordem?: unknown } | null>).filter((c) => !!c && Number(c.ordem) === ordem).length;
  } catch {
    return null;
  }
}

export interface DependenciasDoAcompanhamento {
  ler: (trabalhoId: string) => Promise<PedidosNaTela>;
  versoes: (trabalhoId: string, ordem: number) => Promise<number | null>;
  esperar: (msDeEspera: number) => Promise<void>;
  agora: () => number;
}

const DEPENDENCIAS: DependenciasDoAcompanhamento = {
  ler: lerPedidosDoTrabalho,
  versoes: versoesDaLamina,
  esperar: (m) => new Promise((ok) => window.setTimeout(ok, m)),
  agora: () => Date.now(),
};

/** Corpo devolvido quando a função morreu depois de gravar a arte: a versão nova já está na lâmina. */
export const AVISO_DA_ARTE_RECUPERADA = "A função parou logo depois de gravar a arte (limite do servidor). A versão nova já está na lâmina; nada foi pedido de novo.";

/**
 * Espera o pedido fechar lendo o banco e devolve o corpo da ação, como a
 * chamada direta devolveria (erro vira o mesmo ErroDaMesa). Leitura que falha
 * só atrasa: a espera segue até o prazo do pedido.
 */
export async function acompanharPedido<T = Record<string, unknown>>(
  funcao: FuncaoDaMesa,
  trabalhoId: string,
  pedido: Pick<PedidoNaTela, "id" | "acao" | "ordem" | "prazo" | "versoes_antes">,
  deps: DependenciasDoAcompanhamento = DEPENDENCIAS,
): Promise<T> {
  const prazo = ms(pedido.prazo);
  const limite = (isFinite(prazo) ? prazo : deps.agora() + 420_000) + FOLGA_DO_PRAZO_MS;
  for (;;) {
    await deps.esperar(INTERVALO_DO_PEDIDO_MS);
    let s: SituacaoDoPedido;
    try {
      s = situacaoDoPedido(await deps.ler(trabalhoId), pedido, deps.agora());
    } catch {
      // Banco fora do ar por um instante: tenta na próxima volta, até o prazo do pedido.
      if (deps.agora() <= limite) continue;
      s = { tipo: "sem_sinal" };
    }
    if (s.tipo === "esperar") continue;
    if (s.tipo === "pronto") return corpoOuErro<T>(funcao, s.corpo);
    // Sem sinal: a função morreu sem fechar o pedido. Se a versão nova já existe, a arte saiu (e foi cobrada):
    // segue como feito, sem pedir de novo. A conferência não gera versão: só resta a falha.
    if (pedido.acao !== "conferir_card") {
      const versoes = await deps.versoes(trabalhoId, pedido.ordem);
      if (versoes !== null && versoes > pedido.versoes_antes) {
        return { trabalho_id: trabalhoId, ordem: pedido.ordem, recuperado_do_banco: true, corrigido: pedido.acao === "corrigir_card", aviso_da_acao: AVISO_DA_ARTE_RECUPERADA } as T;
      }
    }
    const detalhes = { funcao, causa: "sem_pulso", pedido: pedido.id, acao: pedido.acao };
    console.warn("[mesa] funcao_interrompida", detalhes);
    throw new ErroDaMesa("funcao_interrompida", mensagemDoCodigo("funcao_interrompida", {}, funcao), detalhes);
  }
}

/**
 * Chama uma ação da lâmina em segundo plano e devolve o mesmo corpo da chamada
 * direta. A função responde na hora (202) e a tela acompanha pelo banco; com a
 * função antiga no ar, a resposta já é o corpo final (nada muda).
 */
export async function chamarEmSegundoPlano<T = Record<string, unknown>>(
  funcao: FuncaoDaMesa,
  corpo: Record<string, unknown> & { trabalho_id: string },
  deps: DependenciasDoAcompanhamento = DEPENDENCIAS,
): Promise<T> {
  const r = await chamarFuncao<Record<string, unknown> | null>(funcao, { ...corpo, segundo_plano: true });
  const aceito = r && typeof r === "object" && r.em_segundo_plano === true && r.pedido && typeof r.pedido === "object"
    ? pedidoDaLinha({ status: "rodando", ...(r.pedido as Record<string, unknown>) })
    : null;
  if (!aceito) return r as T;
  return acompanharPedido<T>(funcao, corpo.trabalho_id, aceito, deps);
}

// ------------------------------------------------------------------ hook

export const chaveDosPedidos = (trabalhoId: string) => ["mesa", "segundo-plano", trabalhoId] as const;

/**
 * Pedidos em segundo plano de um trabalho, lidos do banco: o andamento da
 * lâmina (ajustando, conferindo, corrigindo) sobrevive a fechar e reabrir a
 * tela, com o mesmo início. `aoMudar` roda quando um pedido termina (para
 * reler o trabalho: a versão nova aparece).
 */
export function usePedidosEmSegundoPlano(trabalhoId: string | null | undefined, aoMudar?: () => void): { andamento: Record<number, AndamentoDaLamina> } {
  const id = trabalhoId || "";
  const ultimoVivo = useRef(0);
  const q = useQuery({
    queryKey: chaveDosPedidos(id),
    enabled: !!id,
    retry: false,
    staleTime: 2_000,
    // Leitura que falha (coluna antiga, rede): sem pedidos; a tela segue como antes.
    queryFn: () => lerPedidosDoTrabalho(id).catch(() => ({} as PedidosNaTela)),
    refetchInterval: (query) => {
      const d = (query.state.data || {}) as PedidosNaTela;
      const agora = Date.now();
      if (Object.keys(d).some((k) => pedidoVivo(d[k], agora))) {
        ultimoVivo.current = agora;
        return INTERVALO_DA_LEITURA_MS;
      }
      return agora - ultimoVivo.current < CAUDA_DA_LEITURA_MS ? INTERVALO_DA_LEITURA_MS : false;
    },
  });
  // Recalcula a cada leitura, na hora dela (o pedido morto, com o pulso velho, sai na leitura seguinte mesmo
  // quando o conteúdo lido é igual ao de antes).
  const lidoEm = q.dataUpdatedAt;
  const andamento = useMemo(() => andamentoDosPedidos((q.data || {}) as PedidosNaTela, lidoEm || Date.now()), [q.data, lidoEm]);

  const cb = useRef(aoMudar);
  cb.current = aoMudar;
  const vivos = useRef<{ id: string; ordens: string }>({ id: "", ordens: "" });
  useEffect(() => {
    const ordens = Object.keys(andamento).sort().join(",");
    const antes = vivos.current.id === id ? vivos.current.ordens : "";
    vivos.current = { id, ordens };
    // Uma lâmina saiu do andamento: o pedido terminou (ou morreu); a tela relê o trabalho.
    if (antes && antes !== ordens && antes.split(",").some((o) => ordens.split(",").indexOf(o) < 0)) cb.current?.();
  }, [andamento, id]);

  return { andamento };
}
