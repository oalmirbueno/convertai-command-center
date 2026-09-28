import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { inicioDoMes, rotuloDoMes, somarMeses } from "@/lib/mesa/api";
import { rpcAusente } from "@/lib/mesa/custos";
import { entraPeloPadrao, normalizarEscolhas, type ClienteBruto } from "@/components/mesa/clientesDaMesa";

/**
 * Fila de prioridades da Mesa (pedido do dono em 24/09: "uma ordem do que
 * precisa ser feito, simples e direcional: quem cobrar para aprovar, quem
 * precisa gerar o mês, quem precisa gerar artes").
 *
 * O banco entrega os fatos por cliente (RPC mesa_fila_prioridades, formato
 * no topo de docs/mesa/v6/migrations/20260924180000_mesa_custos_e_fila.sql);
 * a ordem sai daqui, em função pura (acoesDoCliente e montarFila), para ser
 * testada e ajustada sem mexer no banco. Sem a RPC, a leitura direta pelo
 * RLS da equipe monta o mesmo formato (sem o último acesso, que só a RPC lê).
 *
 * Pedido do dono em 28/09 (PR-01):
 * - só entra cliente DENTRO DA MESA, a mesma regra do seletor
 *   (clientesDaMesa.ts, mesa "organica"): plano ativo, não avulso, com a
 *   escolha "incluir"/"retirar" da equipe por cima. Plano inativo, em pausa
 *   ou retirado da Mesa não aparece;
 * - mês com plano (peça de arte ou vídeo no calendário, ou proposta gravada)
 *   conta como feito; o mês que acaba em menos de 7 dias não pede mais nada;
 * - botão "Feito" em cada ação: guarda por cliente, tipo e mês
 *   (mesa_fila_feitos), some da fila até o fato crescer (mais itens, pedido
 *   novo) ou virar o mês; "Desfazer" arquiva a marca.
 */

export const RPC_DA_FILA = "mesa_fila_prioridades";

export interface MesDaFila {
  mes: string;
  /** Itens de arte (carrossel, estático, design) no calendário do mês. */
  itens: number;
  /** Peças do mês (arte ou vídeo, como a aba Mês conta). */
  pecas: number;
  sem_arte: number;
  proximo_sem_arte: string | null;
  proposta_aberta: boolean;
  /** Plano do mês gravado no calendário (calendario_propostas "gravada"). */
  proposta_gravada: boolean;
}

/** Marca de "Feito" dada pela equipe (tabela mesa_fila_feitos). */
export interface FeitoDaFila {
  id: string;
  tipo: TipoDeAcao;
  /** Mês da marca (AAAA-MM-01). */
  periodo: string;
  /** Quantos havia quando marcou: se crescer, a ação volta. */
  quantidade: number;
  /** Último pedido de aprovação quando marcou (só em "cobrar"). */
  referencia: string | null;
  marcado_em: string | null;
  marcado_por_nome: string | null;
}

export interface ClienteDaFila {
  client_id: string;
  nome: string;
  ultimo_acesso: string | null;
  posts_por_mes: number | null;
  aprovacao_pendentes: number;
  aprovacao_desde: string | null;
  /** Pedido de aprovação mais novo (versão 2 da RPC). */
  aprovacao_ultimo: string | null;
  revisao_pendentes: number;
  revisao_desde: string | null;
  reprovados: number;
  prontas_para_enviar: number;
  precisam_atencao: number;
  meses: MesDaFila[];
  feitos: FeitoDaFila[];
}

export interface RespostaDaFila {
  versao: number;
  hoje: string;
  acesso_conhecido: boolean;
  clientes: ClienteDaFila[];
  origem: "banco" | "direto";
}

const inteiro = (v: unknown): number => {
  const n = typeof v === "number" ? v : Number(v);
  return isFinite(n) && n > 0 ? Math.floor(n) : 0;
};
const textoOuNulo = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

const TIPOS: TipoDeAcao[] = ["resolver", "gerar_mes", "gerar_artes", "cobrar", "ajustar", "entregar", "revisar", "completar_mes"];

function normalizarFeitos(v: unknown): FeitoDaFila[] {
  const saida: FeitoDaFila[] = [];
  for (const b of Array.isArray(v) ? v : []) {
    if (!b || typeof b !== "object") continue;
    const f = b as Record<string, unknown>;
    const tipo = String(f.tipo || "") as TipoDeAcao;
    if (typeof f.id !== "string" || !f.id || TIPOS.indexOf(tipo) < 0 || typeof f.periodo !== "string") continue;
    saida.push({
      id: f.id,
      tipo,
      periodo: `${f.periodo.slice(0, 7)}-01`,
      quantidade: inteiro(f.quantidade),
      referencia: textoOuNulo(f.referencia),
      marcado_em: textoOuNulo(f.marcado_em),
      marcado_por_nome: textoOuNulo(f.marcado_por_nome),
    });
  }
  return saida;
}

const dois = (n: number) => (n < 10 ? `0${n}` : String(n));
export const diaLocal = (d: Date) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;

export function normalizarFila(data: unknown, origem: "banco" | "direto" = "banco", agora = new Date()): RespostaDaFila {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const clientes: ClienteDaFila[] = [];
  for (const b of Array.isArray(d.clientes) ? d.clientes : []) {
    if (!b || typeof b !== "object") continue;
    const c = b as Record<string, unknown>;
    if (typeof c.client_id !== "string" || !c.client_id) continue;
    const meses: MesDaFila[] = [];
    for (const m of Array.isArray(c.meses) ? c.meses : []) {
      if (!m || typeof m !== "object") continue;
      const mm = m as Record<string, unknown>;
      if (typeof mm.mes !== "string") continue;
      const itens = inteiro(mm.itens);
      meses.push({
        mes: mm.mes.slice(0, 10),
        itens,
        // Versão 1 da RPC não manda "pecas": vale o número de itens de arte.
        pecas: Math.max(inteiro(mm.pecas), itens),
        sem_arte: inteiro(mm.sem_arte),
        proximo_sem_arte: textoOuNulo(mm.proximo_sem_arte) ? String(mm.proximo_sem_arte).slice(0, 10) : null,
        proposta_aberta: mm.proposta_aberta === true,
        proposta_gravada: mm.proposta_gravada === true,
      });
    }
    const plano = inteiro(c.posts_por_mes);
    clientes.push({
      client_id: c.client_id,
      nome: typeof c.nome === "string" && c.nome ? c.nome : "Cliente",
      ultimo_acesso: textoOuNulo(c.ultimo_acesso),
      posts_por_mes: plano > 0 ? plano : null,
      aprovacao_pendentes: inteiro(c.aprovacao_pendentes),
      aprovacao_desde: textoOuNulo(c.aprovacao_desde),
      aprovacao_ultimo: textoOuNulo(c.aprovacao_ultimo),
      revisao_pendentes: inteiro(c.revisao_pendentes),
      revisao_desde: textoOuNulo(c.revisao_desde),
      reprovados: inteiro(c.reprovados),
      prontas_para_enviar: inteiro(c.prontas_para_enviar),
      precisam_atencao: inteiro(c.precisam_atencao),
      meses,
      feitos: normalizarFeitos(c.feitos),
    });
  }
  return {
    versao: inteiro(d.versao) || 1,
    hoje: typeof d.hoje === "string" && d.hoje ? d.hoje.slice(0, 10) : diaLocal(agora),
    acesso_conhecido: d.acesso_conhecido === true,
    clientes,
    origem,
  };
}

// ------------------------------------------------------------------ datas

const paraDia = (s: string) => {
  const [a, m, d] = s.slice(0, 10).split("-").map(Number);
  return Date.UTC(a, (m || 1) - 1, d || 1);
};

/** Dias inteiros de `de` até `ate` (AAAA-MM-DD ou ISO; só a data conta). */
export function diasEntre(de: string, ate: string): number {
  return Math.round((paraDia(ate) - paraDia(de)) / 86400_000);
}

/** Dia (AAAA-MM-DD) de São Paulo de um instante ISO; data pura volta igual. */
function diaDoInstante(iso: string): string {
  if (iso.length <= 10) return iso;
  const ms = Date.parse(iso);
  if (!isFinite(ms)) return iso.slice(0, 10);
  const d = new Date(ms - 3 * 3600_000);
  return `${d.getUTCFullYear()}-${dois(d.getUTCMonth() + 1)}-${dois(d.getUTCDate())}`;
}

/** Há quantos dias o instante aconteceu (0 = hoje). */
export const diasDesde = (iso: string, hoje: string) => Math.max(diasEntre(diaDoInstante(iso), hoje), 0);

const nomeDoMes = (mes: string) => rotuloDoMes(mes).split(" de ")[0];

const maiuscula = (t: string) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t);

const dataCurtinha = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function textoDosDias(d: number): string {
  if (d <= 0) return "hoje";
  if (d === 1) return "há 1 dia";
  return `há ${d} dias`;
}

function textoDoPrazo(d: number): string {
  if (d <= 0) return "sai hoje";
  if (d === 1) return "sai amanhã";
  return `sai em ${d} dias`;
}

function textoDoComeco(d: number): string {
  if (d <= 0) return "começa hoje";
  if (d === 1) return "começa amanhã";
  return `começa em ${d} dias`;
}

/** "outubro", "outubro e novembro", "outubro, novembro e dezembro". */
function listaDeNomes(nomes: string[]): string {
  if (nomes.length <= 1) return nomes.join("");
  return `${nomes.slice(0, -1).join(", ")} e ${nomes[nomes.length - 1]}`;
}

// ------------------------------------------------------------------ ações

export type TipoDeAcao =
  | "resolver"
  | "gerar_mes"
  | "gerar_artes"
  | "cobrar"
  | "ajustar"
  | "entregar"
  | "revisar"
  | "completar_mes";

export type Nivel = "agora" | "semana" | "depois";

export type AbaDaMesa = "contexto" | "mes" | "campanhas" | "estudio" | "entrega";

export interface AcaoDaFila {
  tipo: TipoDeAcao;
  /** Rótulo curto do botão: "Cobrar aprovação", "Gerar o mês"... */
  titulo: string;
  /** Uma frase com o porquê. */
  motivo: string;
  pontos: number;
  nivel: Nivel;
  aba: AbaDaMesa;
  /** Mês que a aba deve abrir (AAAA-MM-01), quando importa. */
  mes: string | null;
  quantidade: number;
  /** Só em "cobrar": dias de espera do pedido mais antigo. */
  diasEsperando?: number;
  /** Mês a que o "Feito" se prende (AAAA-MM-01): o mês da ação ou o mês corrente. */
  periodo: string;
  /** Só em "cobrar": o pedido de aprovação mais novo (pedido novo faz a ação voltar). */
  referencia: string | null;
}

export const ROTULO_DA_ACAO: Record<TipoDeAcao, string> = {
  resolver: "Resolver agendamento",
  gerar_mes: "Gerar o mês",
  gerar_artes: "Gerar artes",
  cobrar: "Cobrar aprovação",
  ajustar: "Fazer ajustes",
  entregar: "Entregar",
  revisar: "Revisar e liberar",
  completar_mes: "Completar o mês",
};

/** Dias sem movimento para um cliente contar como parado (pendência antiga não puxa o topo). */
export const DIAS_CLIENTE_PARADO = 30;

export function nivelDosPontos(p: number): Nivel {
  if (p >= 80) return "agora";
  if (p >= 55) return "semana";
  return "depois";
}

/** Dias finais do mês em que ele já não pede para gerar nem completar (caso Softy Móveis, 28/09). */
export const DIAS_FIM_DO_MES = 7;

/** Mês com plano: peça de arte ou vídeo no calendário, ou proposta gravada. */
export const mesPlanejado = (m: MesDaFila | null) => !!m && (m.pecas > 0 || m.itens > 0 || m.proposta_gravada);

type NovaAcao = Omit<AcaoDaFila, "nivel" | "titulo" | "periodo" | "referencia"> & { titulo?: string; periodo?: string; referencia?: string | null };

/** Pontos de "gerar artes" pelo prazo do próximo item sem arte. */
export function pontosDoPrazo(dias: number): number {
  if (dias <= 2) return 85;
  if (dias <= 7) return 72;
  if (dias <= 14) return 55;
  return 38;
}

/** Pontos de "gerar o mês seguinte" pelos dias que faltam para ele começar. */
export function pontosDoMesVazio(diasParaComecar: number): number {
  if (diasParaComecar <= 7) return 80;
  if (diasParaComecar <= 14) return 65;
  return 45;
}

/**
 * O que fazer com um cliente, da mais urgente para a menos. Regras (pontos):
 * - resolver: aprovadas que não entraram sozinhas na Agenda (90);
 * - gerar o mês: mês corrente sem plano (88), só se faltam 7 dias ou mais
 *   para ele acabar; mês seguinte sem plano, pelo tempo que falta para
 *   começar (80, 65 ou 45). Mês com peça no calendário ou proposta gravada
 *   tem plano;
 * - gerar artes: itens sem arte de hoje em diante, pelo prazo do próximo
 *   (85 até 2 dias, 72 até 7, 55 até 14, senão 38);
 * - cobrar aprovação: 50 mais 2 por dia de espera (até 90); mais 5 se o
 *   cliente não entrou no painel depois do pedido;
 * - fazer ajustes pedidos (70); entregar artes prontas (62);
 * - revisar e liberar (60 mais 1 por dia, até 70);
 * - completar o mês: menos peças que o plano (40, ou 50 na última semana
 *   antes do mês seguinte); o mês corrente não pede nos últimos dias.
 * 80 ou mais = agora; 55 ou mais = nesta semana; o resto = depois.
 * Não olha as marcas de "Feito": quem esconde é aplicarFeitos.
 */
export function acoesDoCliente(c: ClienteDaFila, hoje: string, acessoConhecido: boolean): AcaoDaFila[] {
  const acoes: AcaoDaFila[] = [];
  const mesAtual = `${hoje.slice(0, 7)}-01`;
  const mesSeguinte = somarMeses(mesAtual, 1);
  const doMes = (mes: string) => c.meses.find((m) => m.mes === mes) || null;
  const atual = doMes(mesAtual);
  const seguinte = doMes(mesSeguinte);
  const diasParaSeguinte = diasEntre(hoje, mesSeguinte);
  // Nos últimos dias do mês, o mês corrente não pede mais plano nem peça.
  const atualConta = diasParaSeguinte >= DIAS_FIM_DO_MES;

  const acao = (a: NovaAcao): AcaoDaFila => ({
    ...a,
    titulo: a.titulo || ROTULO_DA_ACAO[a.tipo],
    pontos: Math.round(a.pontos),
    nivel: nivelDosPontos(a.pontos),
    periodo: a.periodo || a.mes || mesAtual,
    referencia: a.referencia || null,
  });

  if (c.precisam_atencao > 0) {
    acoes.push(
      acao({
        tipo: "resolver",
        motivo: `${plural(c.precisam_atencao, "arte aprovada não entrou", "artes aprovadas não entraram")} sozinha${c.precisam_atencao === 1 ? "" : "s"} na Agenda`,
        pontos: 90,
        aba: "entrega",
        mes: null,
        quantidade: c.precisam_atencao,
      }),
    );
  }

  // `comeco`: "começa em 3 dias" para o mês seguinte (o prazo real); vazio no corrente.
  const mesVazio = (m: MesDaFila | null, mes: string, pontos: number, comeco: string) => {
    const nome = nomeDoMes(mes);
    const aberta = !!(m && m.proposta_aberta);
    acoes.push(
      acao({
        tipo: "gerar_mes",
        titulo: aberta ? "Terminar o mês" : undefined,
        motivo: aberta
          ? `${maiuscula(nome)} tem proposta começada, falta gravar no calendário${comeco ? `; ${comeco}` : ""}`
          : `O calendário de ${nome} está vazio${comeco ? ` e ${comeco}` : ""}`,
        pontos,
        aba: "mes",
        mes,
        quantidade: 0,
      }),
    );
  };

  if (atual && atualConta && !mesPlanejado(atual)) mesVazio(atual, mesAtual, 88, "");
  if (seguinte && !mesPlanejado(seguinte)) mesVazio(seguinte, mesSeguinte, pontosDoMesVazio(diasParaSeguinte), textoDoComeco(diasParaSeguinte));

  // Artes: um aviso só, pelo item sem arte mais próximo; o motivo diz quantos em cada mês.
  const comFalta = [atual, seguinte].filter((m): m is MesDaFila => !!m && m.sem_arte > 0 && !!m.proximo_sem_arte);
  if (comFalta.length) {
    const primeiro = comFalta.slice().sort((a, b) => ((a.proximo_sem_arte as string) < (b.proximo_sem_arte as string) ? -1 : 1))[0];
    const prazo = diasEntre(hoje, primeiro.proximo_sem_arte as string);
    const total = comFalta.reduce((s, m) => s + m.sem_arte, 0);
    const porMes = comFalta.map((m) => `${m.sem_arte} em ${nomeDoMes(m.mes)}`).join(", ");
    acoes.push(
      acao({
        tipo: "gerar_artes",
        motivo: `${plural(total, "item sem arte", "itens sem arte")} (${porMes}); o próximo ${textoDoPrazo(prazo)}, ${dataCurtinha(primeiro.proximo_sem_arte as string)}`,
        pontos: pontosDoPrazo(prazo),
        aba: "estudio",
        mes: primeiro.mes,
        quantidade: total,
      }),
    );
  }

  if (c.aprovacao_pendentes > 0) {
    const dias = c.aprovacao_desde ? diasDesde(c.aprovacao_desde, hoje) : 0;
    let pontos = Math.min(50 + dias * 2, 90);
    let acesso = "";
    if (acessoConhecido) {
      if (!c.ultimo_acesso) {
        acesso = "; nunca entrou no painel";
        pontos = Math.min(pontos + 5, 90);
      } else {
        const diasAcesso = diasDesde(c.ultimo_acesso, hoje);
        acesso = diasAcesso <= 0 ? "; entrou hoje" : `; último acesso ${textoDosDias(diasAcesso)}`;
        if (c.aprovacao_desde && Date.parse(c.ultimo_acesso) < Date.parse(c.aprovacao_desde)) pontos = Math.min(pontos + 5, 90);
      }
    }
    acoes.push(
      acao({
        tipo: "cobrar",
        motivo: `${plural(c.aprovacao_pendentes, "post esperando", "posts esperando")} aprovação ${dias > 0 ? textoDosDias(dias) : "desde hoje"}${acesso}`,
        pontos,
        aba: "entrega",
        mes: null,
        quantidade: c.aprovacao_pendentes,
        diasEsperando: dias,
        referencia: c.aprovacao_ultimo || c.aprovacao_desde,
      }),
    );
  }

  if (c.reprovados > 0) {
    acoes.push(
      acao({
        tipo: "ajustar",
        motivo: `${plural(c.reprovados, "arte com ajuste pedido", "artes com ajuste pedido")}`,
        pontos: 70,
        aba: "estudio",
        mes: null,
        quantidade: c.reprovados,
      }),
    );
  }

  if (c.prontas_para_enviar > 0) {
    acoes.push(
      acao({
        tipo: "entregar",
        motivo: `${plural(c.prontas_para_enviar, "arte pronta", "artes prontas")} sem enviar para aprovação`,
        pontos: 62,
        aba: "entrega",
        mes: null,
        quantidade: c.prontas_para_enviar,
      }),
    );
  }

  if (c.revisao_pendentes > 0) {
    const dias = c.revisao_desde ? diasDesde(c.revisao_desde, hoje) : 0;
    acoes.push(
      acao({
        tipo: "revisar",
        motivo: `${plural(c.revisao_pendentes, "arquivo esperando", "arquivos esperando")} a revisão da agência${dias > 0 ? ` ${textoDosDias(dias)}` : ""}`,
        pontos: Math.min(60 + dias, 70),
        aba: "entrega",
        mes: null,
        quantidade: c.revisao_pendentes,
      }),
    );
  }

  if (c.posts_por_mes) {
    for (const m of [atualConta ? atual : null, seguinte]) {
      if (!m || m.pecas === 0 || m.pecas >= c.posts_por_mes) continue;
      const ehSeguinte = m.mes === mesSeguinte;
      acoes.push(
        acao({
          tipo: "completar_mes",
          motivo: `${maiuscula(nomeDoMes(m.mes))} tem ${m.pecas} de ${c.posts_por_mes} posts do plano`,
          pontos: ehSeguinte && diasParaSeguinte <= 7 ? 50 : 40,
          aba: "mes",
          mes: m.mes,
          quantidade: c.posts_por_mes - m.pecas,
        }),
      );
    }
  }

  // Cliente parado: nada no calendário deste mês e do próximo, pedido de
  // aprovação com mais de 30 dias e sem acesso ao painel há mais de 30 dias
  // (caso Vivideo, 24/09: 107 dias). Vai para "depois" em vez de puxar o topo.
  const diasAprovacao = c.aprovacao_desde ? diasDesde(c.aprovacao_desde, hoje) : 0;
  const diasAcesso = c.ultimo_acesso ? diasDesde(c.ultimo_acesso, hoje) : Infinity;
  const semCalendario = !mesPlanejado(atual) && !mesPlanejado(seguinte);
  if (semCalendario && c.aprovacao_pendentes > 0 && diasAprovacao > DIAS_CLIENTE_PARADO && (!acessoConhecido || diasAcesso > DIAS_CLIENTE_PARADO)) {
    return acoes
      .map((x) => {
        const pontos = Math.min(x.pontos, 30);
        return { ...x, pontos, nivel: nivelDosPontos(pontos), motivo: x.tipo === "cobrar" ? `Cliente parado: ${x.motivo}` : x.motivo };
      })
      .sort((a, b) => b.pontos - a.pontos);
  }
  return acoes.sort((a, b) => b.pontos - a.pontos);
}

// ------------------------------------------------------------------ feito

/**
 * A marca de "Feito" que cobre a ação, ou null. Cobre quando é do mesmo
 * tipo e mês, a quantidade não cresceu e (em "cobrar") não chegou pedido de
 * aprovação mais novo que o da marca. Mês novo = outro período = volta.
 */
export function feitoQueCobre(a: AcaoDaFila, feitos: FeitoDaFila[]): FeitoDaFila | null {
  for (const f of feitos || []) {
    if (f.tipo !== a.tipo || f.periodo !== a.periodo) continue;
    if (a.quantidade > f.quantidade) continue;
    if (a.referencia && f.referencia && Date.parse(a.referencia) > Date.parse(f.referencia)) continue;
    return f;
  }
  return null;
}

export interface AcaoFeita {
  acao: AcaoDaFila;
  feito: FeitoDaFila;
}

/** Separa as ações que ficam na fila das que a equipe já deu como feitas. */
export function aplicarFeitos(acoes: AcaoDaFila[], feitos: FeitoDaFila[]): { abertas: AcaoDaFila[]; feitas: AcaoFeita[] } {
  const abertas: AcaoDaFila[] = [];
  const feitas: AcaoFeita[] = [];
  for (const a of acoes) {
    const f = feitoQueCobre(a, feitos);
    if (f) feitas.push({ acao: a, feito: f });
    else abertas.push(a);
  }
  return { abertas, feitas };
}

/**
 * O que já está pronto, em uma linha curta: os meses com plano, do corrente
 * (se ainda conta) até 3 à frente, e "artes em dia" quando nada falta.
 */
export function prontoDoCliente(c: ClienteDaFila, hoje: string): string | null {
  const mesAtual = `${hoje.slice(0, 7)}-01`;
  const mesSeguinte = somarMeses(mesAtual, 1);
  const atualConta = diasEntre(hoje, mesSeguinte) >= DIAS_FIM_DO_MES;
  const meses = c.meses
    .filter((m) => m.mes >= mesAtual && (atualConta || m.mes !== mesAtual) && mesPlanejado(m))
    .map((m) => m.mes)
    .sort();
  const partes: string[] = [];
  if (meses.length) partes.push(`calendário de ${listaDeNomes(meses.map(nomeDoMes))}`);
  const proximos = c.meses.filter((m) => m.mes === mesSeguinte || (atualConta && m.mes === mesAtual));
  const comArte = proximos.reduce((s, m) => s + m.itens, 0);
  if (comArte > 0 && proximos.every((m) => m.sem_arte === 0)) partes.push("artes em dia");
  return partes.length ? `Pronto: ${partes.join("; ")}` : null;
}

export interface GrupoDaFila {
  client_id: string;
  nome: string;
  pontos: number;
  nivel: Nivel;
  acoes: AcaoDaFila[];
  ultimo_acesso: string | null;
  aprovacao_pendentes: number;
  aprovacao_dias: number;
  /** "Pronto: calendário de outubro, novembro e dezembro", ou null. */
  pronto: string | null;
}

export interface MarcadoDaFila extends AcaoFeita {
  client_id: string;
  nome: string;
}

export interface Fila {
  hoje: string;
  grupos: GrupoDaFila[];
  emDia: { client_id: string; nome: string; pronto: string | null }[];
  /** Ações escondidas pelo "Feito" da equipe (para o Desfazer). */
  marcados: MarcadoDaFila[];
  resumo: Record<Nivel, number>;
  acessoConhecido: boolean;
}

/** Clientes com algo a fazer, o mais urgente primeiro; os em dia e os marcados como feito ficam à parte. */
export function montarFila(r: RespostaDaFila): Fila {
  const grupos: GrupoDaFila[] = [];
  const emDia: { client_id: string; nome: string; pronto: string | null }[] = [];
  const marcados: MarcadoDaFila[] = [];
  const resumo: Record<Nivel, number> = { agora: 0, semana: 0, depois: 0 };
  for (const c of r.clientes) {
    const { abertas: acoes, feitas } = aplicarFeitos(acoesDoCliente(c, r.hoje, r.acesso_conhecido), c.feitos || []);
    for (const f of feitas) marcados.push({ ...f, client_id: c.client_id, nome: c.nome });
    const pronto = prontoDoCliente(c, r.hoje);
    if (!acoes.length) {
      emDia.push({ client_id: c.client_id, nome: c.nome, pronto });
      continue;
    }
    for (const a of acoes) resumo[a.nivel] += 1;
    const cobrar = acoes.find((a) => a.tipo === "cobrar");
    grupos.push({
      client_id: c.client_id,
      nome: c.nome,
      pontos: acoes[0].pontos,
      nivel: acoes[0].nivel,
      acoes,
      ultimo_acesso: c.ultimo_acesso,
      aprovacao_pendentes: c.aprovacao_pendentes,
      aprovacao_dias: cobrar && cobrar.diasEsperando ? cobrar.diasEsperando : 0,
      pronto,
    });
  }
  grupos.sort((a, b) => {
    if (b.pontos !== a.pontos) return b.pontos - a.pontos;
    const soma = (g: GrupoDaFila) => g.acoes.reduce((s, x) => s + x.pontos, 0);
    if (soma(b) !== soma(a)) return soma(b) - soma(a);
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
  emDia.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  marcados.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR") || b.acao.pontos - a.acao.pontos);
  return { hoje: r.hoje, grupos, emDia, marcados, resumo, acessoConhecido: r.acesso_conhecido };
}

/** Primeiro nome útil da empresa ou pessoa, para a saudação. */
function saudacao(nome: string): string {
  const limpo = String(nome || "").trim();
  return limpo || "tudo bem";
}

/**
 * Mensagem curta de WhatsApp para cobrar a aprovação (sem travessão, sem
 * emoji que quebre em aparelho antigo).
 */
export function mensagemDeCobranca(nome: string, quantidade: number, dias: number, link: string): string {
  const posts = quantidade === 1 ? "1 post esperando" : `${quantidade} posts esperando`;
  const tempo = dias >= 2 ? `, o primeiro enviado há ${dias} dias` : dias === 1 ? ", o primeiro enviado ontem" : "";
  return (
    `Oi, ${saudacao(nome)}! Tudo bem? ` +
    `Você tem ${posts} aprovação no painel da Aceleriq${tempo}. ` +
    `Consegue dar uma olhada hoje? É só entrar em ${link} e aprovar ou pedir ajuste em cada um. ` +
    `Assim a gente já deixa tudo agendado. Obrigado!`
  );
}

// ------------------------------------------------------------------ leitura direta (sem a RPC)

const FORMATOS_DE_ARTE = ["carousel", "static", "design"];
/** Arte ou vídeo: a mesma lista da aba Mês (FORMATOS_DE_PECA em useAgendaDoMes.ts). */
const FORMATOS_DE_PECA = ["carousel", "static", "design", "reel", "story", "video", "short", "google_post"];
const LOTE = 100;

function emLotes<T>(lista: T[]): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < lista.length; i += LOTE) lotes.push(lista.slice(i, i + LOTE));
  return lotes;
}

async function lerEmLotes<T>(ids: string[], ler: (lote: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>): Promise<T[]> {
  const saida: T[] = [];
  for (const lote of emLotes(ids)) {
    if (!lote.length) continue;
    const { data, error } = await ler(lote);
    if (error) throw error;
    for (const x of data || []) saida.push(x);
  }
  return saida;
}

/**
 * Quem está DENTRO DA MESA (mesa "organica"), a mesma regra do seletor:
 * escolha da equipe por cima do padrão (plano ativo, não avulso, não apagado).
 * Sem a tabela de escolhas, vale só o padrão. Diferente do seletor, a fila
 * nunca mostra todos quando ninguém entra.
 */
export function clientesNaMesa(brutos: ClienteBruto[], escolhas: { client_id: string; modo: string }[]): string[] {
  const modo: Record<string, string> = {};
  for (const e of escolhas) modo[e.client_id] = e.modo;
  const ids: string[] = [];
  for (const c of brutos) {
    if (!c || !c.id) continue;
    const id = String(c.id);
    const escolha = modo[id];
    const entra = escolha === "incluir" ? !c.deleted_at : escolha === "retirar" ? false : entraPeloPadrao("organica", c).entra;
    if (entra) ids.push(id);
  }
  return ids;
}

/** Leitura direta (RLS da equipe) no formato da RPC; o último acesso fica de fora. */
export async function lerFilaDireta(clientes: { id: string; nome: string }[], agora = new Date()): Promise<RespostaDaFila> {
  const sb = supabase as any;
  const hoje = diaLocal(agora);
  const mesAtual = inicioDoMes(agora);
  const mesesDaFila = [0, 1, 2, 3].map((n) => somarMeses(mesAtual, n));
  const fim = somarMeses(mesAtual, 4);
  const vazio: RespostaDaFila = { versao: 2, hoje, acesso_conhecido: false, clientes: [], origem: "direto" };
  if (!clientes.length) return vazio;

  // Só quem está dentro da Mesa.
  const [brutos, escolhas] = await Promise.all([
    lerEmLotes<ClienteBruto>(
      clientes.map((c) => c.id),
      (lote) => sb.from("profiles").select("id, plan_status, client_type, deleted_at").in("id", lote),
    ),
    (async () => {
      const { data, error } = await sb.from("mesa_cliente_escolhas").select("client_id, modo").eq("mesa", "organica");
      return error ? [] : normalizarEscolhas(data);
    })().catch(() => []),
  ]);
  const naMesa: Record<string, boolean> = {};
  for (const id of clientesNaMesa(brutos, escolhas)) naMesa[id] = true;
  const daMesa = clientes.filter((c) => naMesa[c.id]);
  const ids = daMesa.map((c) => c.id);
  if (!ids.length) return vazio;

  const projetos = await lerEmLotes<{ id: string; client_id: string }>(ids, (lote) =>
    sb.from("projects").select("id, client_id").in("client_id", lote).is("deleted_at", null),
  );
  const clienteDoProjeto: Record<string, string> = {};
  for (const p of projetos) clienteDoProjeto[p.id] = p.client_id;

  const [tarefas, trabalhos, arquivos, revisao, configs, propostas, feitos] = await Promise.all([
    lerEmLotes<{ id: string; project_id: string; due_date: string; status: string | null; delivery_type: string | null }>(Object.keys(clienteDoProjeto), (lote) =>
      sb
        .from("tasks")
        .select("id, project_id, due_date, status, delivery_type")
        .in("project_id", lote)
        .in("delivery_type", FORMATOS_DE_PECA)
        .is("deleted_at", null)
        .gte("due_date", mesAtual)
        .lt("due_date", fim),
    ),
    lerEmLotes<{ id: string; client_id: string; task_id: string | null; status: string; entrega_status: string | null; tipo: string | null; cards: unknown; criado_em: string; atualizado_em: string }>(
      ids,
      (lote) =>
        sb
          .from("estudio_trabalhos")
          .select("id, client_id, task_id, status, entrega_status, tipo, cards, criado_em, atualizado_em")
          .in("client_id", lote)
          .order("criado_em", { ascending: false }),
    ),
    lerEmLotes<{ id: string; client_id: string; approval_requested_at: string | null; created_at: string }>(ids, (lote) =>
      sb
        .from("files")
        .select("id, client_id, approval_requested_at, created_at")
        .in("client_id", lote)
        .is("parent_file_id", null)
        .is("archived_at", null)
        .eq("visibility", "approval")
        .eq("approval_status", "pending")
        .in("folder", ["materiais", "criativos"]),
    ),
    lerEmLotes<{ client_id: string; created_at: string }>(ids, (lote) =>
      sb
        .from("files")
        .select("client_id, created_at")
        .in("client_id", lote)
        .is("parent_file_id", null)
        .is("archived_at", null)
        .eq("agency_approval_status", "pending"),
    ),
    lerEmLotes<{ client_id: string; posts_por_mes: number | null }>(ids, (lote) =>
      sb.from("mesa_cliente_config").select("client_id, posts_por_mes").in("client_id", lote),
    ).catch(() => [] as { client_id: string; posts_por_mes: number | null }[]),
    lerEmLotes<{ client_id: string; periodo_inicio: string; periodo_fim: string; status: string }>(ids, (lote) =>
      sb
        .from("calendario_propostas")
        .select("client_id, periodo_inicio, periodo_fim, status")
        .in("client_id", lote)
        .in("status", ["temas", "detalhando", "pronta", "gravada"]),
    ).catch(() => [] as { client_id: string; periodo_inicio: string; periodo_fim: string; status: string }[]),
    lerEmLotes<Record<string, unknown>>(ids, (lote) =>
      sb
        .from("mesa_fila_feitos")
        .select("id, client_id, tipo, periodo, quantidade, referencia, marcado_em")
        .in("client_id", lote)
        .is("arquivado_em", null)
        .gte("periodo", somarMeses(mesAtual, -1)),
    ).catch(() => [] as Record<string, unknown>[]),
  ]);

  // Arte já feita: trabalho com imagem, post com arquivo ou anexo.
  const comArte: Record<string, boolean> = {};
  for (const t of trabalhos) if (t.task_id && Array.isArray(t.cards) && (t.cards as unknown[]).length > 0) comArte[t.task_id] = true;
  const deArte = (t: { delivery_type: string | null }) => FORMATOS_DE_ARTE.indexOf(String(t.delivery_type || "")) >= 0;
  const pendentes = tarefas.filter((t) => deArte(t) && !comArte[t.id] && t.status !== "done" && t.status !== "review" && t.due_date >= hoje).map((t) => t.id);
  if (pendentes.length) {
    const vinculos = await lerEmLotes<{ post_id: string; task_id: string }>(pendentes, (lote) =>
      sb.from("editorial_post_internal").select("post_id, task_id").in("task_id", lote),
    ).catch(() => [] as { post_id: string; task_id: string }[]);
    if (vinculos.length) {
      const posts = await lerEmLotes<{ id: string; primary_file_id: string | null; production_status: string | null }>(
        vinculos.map((v) => v.post_id),
        (lote) => sb.from("editorial_posts").select("id, primary_file_id, production_status").in("id", lote).is("archived_at", null),
      ).catch(() => [] as { id: string; primary_file_id: string | null; production_status: string | null }[]);
      const semPrincipal = posts.filter((p) => !p.primary_file_id && p.production_status !== "archived").map((p) => p.id);
      const pubs = semPrincipal.length
        ? await lerEmLotes<{ post_id: string; file_id: string | null }>(semPrincipal, (lote) =>
            sb.from("editorial_publications").select("post_id, file_id").in("post_id", lote).neq("status", "cancelled"),
          ).catch(() => [] as { post_id: string; file_id: string | null }[])
        : [];
      const postComArte: Record<string, boolean> = {};
      for (const p of posts) if (p.primary_file_id && p.production_status !== "archived") postComArte[p.id] = true;
      for (const pb of pubs) if (pb.file_id) postComArte[pb.post_id] = true;
      for (const v of vinculos) if (postComArte[v.post_id]) comArte[v.task_id] = true;
    }
    const anexos = await lerEmLotes<{ task_id: string }>(pendentes, (lote) => sb.from("task_attachments").select("task_id").in("task_id", lote)).catch(
      () => [] as { task_id: string }[],
    );
    for (const a of anexos) comArte[a.task_id] = true;
  }

  const limite60 = agora.getTime() - 60 * 86400_000;
  const vistos: Record<string, boolean> = {};
  const porCliente: Record<string, ClienteDaFila> = {};
  for (const c of daMesa) {
    porCliente[c.id] = {
      client_id: c.id,
      nome: c.nome,
      ultimo_acesso: null,
      posts_por_mes: null,
      aprovacao_pendentes: 0,
      aprovacao_desde: null,
      aprovacao_ultimo: null,
      revisao_pendentes: 0,
      revisao_desde: null,
      reprovados: 0,
      prontas_para_enviar: 0,
      precisam_atencao: 0,
      meses: mesesDaFila.map((mes) => ({ mes, itens: 0, pecas: 0, sem_arte: 0, proximo_sem_arte: null, proposta_aberta: false, proposta_gravada: false })),
      feitos: [],
    };
  }
  for (const t of tarefas) {
    const c = porCliente[clienteDoProjeto[t.project_id]];
    if (!c) continue;
    const m = c.meses.find((x) => x.mes === `${t.due_date.slice(0, 7)}-01`);
    if (!m) continue;
    m.pecas += 1;
    if (!deArte(t)) continue;
    m.itens += 1;
    const temArte = comArte[t.id] || t.status === "done" || t.status === "review";
    if (!temArte && t.due_date >= hoje) {
      m.sem_arte += 1;
      if (!m.proximo_sem_arte || t.due_date < m.proximo_sem_arte) m.proximo_sem_arte = t.due_date.slice(0, 10);
    }
  }
  for (const t of trabalhos) {
    const c = porCliente[t.client_id];
    if (!c || (t.tipo || "social") !== "social" || Date.parse(t.atualizado_em) < limite60) continue;
    const chave = t.task_id || t.id;
    if (vistos[chave]) continue; // só o mais recente de cada item (lista vem do mais novo)
    vistos[chave] = true;
    if (!t.entrega_status && (t.status === "pronto" || t.status === "entregue")) c.prontas_para_enviar += 1;
    if (t.entrega_status === "reprovado") c.reprovados += 1;
    if (t.entrega_status === "precisa_de_atencao") c.precisam_atencao += 1;
  }
  for (const f of arquivos) {
    const c = porCliente[f.client_id];
    if (!c) continue;
    c.aprovacao_pendentes += 1;
    const quando = f.approval_requested_at || f.created_at;
    if (!c.aprovacao_desde || quando < c.aprovacao_desde) c.aprovacao_desde = quando;
    if (!c.aprovacao_ultimo || quando > c.aprovacao_ultimo) c.aprovacao_ultimo = quando;
  }
  for (const f of revisao) {
    const c = porCliente[f.client_id];
    if (!c) continue;
    c.revisao_pendentes += 1;
    if (!c.revisao_desde || f.created_at < c.revisao_desde) c.revisao_desde = f.created_at;
  }
  for (const cfg of configs) {
    const c = porCliente[cfg.client_id];
    if (c && cfg.posts_por_mes) c.posts_por_mes = cfg.posts_por_mes;
  }
  for (const p of propostas) {
    const c = porCliente[p.client_id];
    if (!c) continue;
    for (const m of c.meses) {
      if (!(p.periodo_inicio < somarMeses(m.mes, 1) && p.periodo_fim >= m.mes)) continue;
      if (p.status === "gravada") m.proposta_gravada = true;
      else m.proposta_aberta = true;
    }
  }
  const feitosPorCliente: Record<string, unknown[]> = {};
  for (const f of feitos) {
    const id = String(f.client_id || "");
    if (!porCliente[id]) continue;
    (feitosPorCliente[id] = feitosPorCliente[id] || []).push(f);
  }
  for (const id of Object.keys(feitosPorCliente)) porCliente[id].feitos = normalizarFeitos(feitosPorCliente[id]);

  return { ...vazio, clientes: daMesa.map((c) => porCliente[c.id]) };
}

/** RPC primeiro; sem ela no banco, a leitura direta com a lista de clientes da tela. */
export async function lerFila(clientes: { id: string; nome: string }[]): Promise<RespostaDaFila> {
  const { data, error } = await (supabase as any).rpc(RPC_DA_FILA);
  if (!error) return normalizarFila(data, "banco");
  if (rpcAusente(error)) return lerFilaDireta(clientes);
  throw error;
}

export const CHAVE_DA_FILA = ["mesa", "fila-de-prioridades"] as const;

/**
 * Fila da equipe (JSON puro no cache). `clientes` só é usado na leitura
 * direta; a RPC já sabe quem a pessoa acessa.
 */
export function useFilaDePrioridades(clientes: { id: string; nome: string }[], ativo = true) {
  return useQuery({
    queryKey: CHAVE_DA_FILA,
    enabled: ativo,
    queryFn: () => lerFila(clientes),
  });
}

// ------------------------------------------------------------------ marcar feito e desfazer

export const RPC_MARCAR_FEITO = "mesa_fila_marcar_feito";
export const RPC_DESFAZER_FEITO = "mesa_fila_desfazer_feito";

const FEITO_SEM_BANCO = "O botão Feito ainda não foi ativado no banco.";

/** Grava a marca de "Feito" da ação (cliente, tipo e mês). */
export async function marcarFeito(clientId: string, a: AcaoDaFila): Promise<FeitoDaFila> {
  const { data, error } = await (supabase as any).rpc(RPC_MARCAR_FEITO, {
    _client_id: clientId,
    _tipo: a.tipo,
    _periodo: a.periodo,
    _quantidade: a.quantidade,
    _referencia: a.referencia,
  });
  if (error) throw rpcAusente(error) ? new Error(FEITO_SEM_BANCO) : error;
  const [feito] = normalizarFeitos([data]);
  if (!feito) throw new Error("O banco não devolveu a marca.");
  return feito;
}

/** Desfaz a marca (o banco arquiva, não apaga). */
export async function desfazerFeito(id: string): Promise<void> {
  const { error } = await (supabase as any).rpc(RPC_DESFAZER_FEITO, { _id: id });
  if (error) throw rpcAusente(error) ? new Error(FEITO_SEM_BANCO) : error;
}

function trocarFeitos(r: RespostaDaFila | undefined, clientId: string, mudar: (lista: FeitoDaFila[]) => FeitoDaFila[]): RespostaDaFila | undefined {
  if (!r) return r;
  return { ...r, clientes: r.clientes.map((c) => (c.client_id === clientId ? { ...c, feitos: mudar(c.feitos || []) } : c)) };
}

/**
 * "Feito" e "Desfazer" com a fila atualizada na hora (o item some ou volta
 * antes da resposta do banco); se o banco recusar, a fila volta como estava.
 */
export function useFeitoDaFila() {
  const queryClient = useQueryClient();

  const marcar = useCallback(
    async (clientId: string, a: AcaoDaFila): Promise<FeitoDaFila> => {
      const antes = queryClient.getQueryData<RespostaDaFila>(CHAVE_DA_FILA);
      const provisorio: FeitoDaFila = {
        id: `local-${a.tipo}-${a.periodo}`,
        tipo: a.tipo,
        periodo: a.periodo,
        quantidade: a.quantidade,
        referencia: a.referencia,
        marcado_em: new Date().toISOString(),
        marcado_por_nome: null,
      };
      const semEste = (lista: FeitoDaFila[]) => lista.filter((f) => !(f.tipo === a.tipo && f.periodo === a.periodo));
      queryClient.setQueryData<RespostaDaFila | undefined>(CHAVE_DA_FILA, (r) => trocarFeitos(r, clientId, (lista) => semEste(lista).concat([provisorio])));
      try {
        const feito = await marcarFeito(clientId, a);
        queryClient.setQueryData<RespostaDaFila | undefined>(CHAVE_DA_FILA, (r) => trocarFeitos(r, clientId, (lista) => semEste(lista).concat([feito])));
        return feito;
      } catch (e) {
        queryClient.setQueryData<RespostaDaFila | undefined>(CHAVE_DA_FILA, antes);
        throw e;
      }
    },
    [queryClient],
  );

  const desfazer = useCallback(
    async (clientId: string, feito: FeitoDaFila): Promise<void> => {
      const antes = queryClient.getQueryData<RespostaDaFila>(CHAVE_DA_FILA);
      queryClient.setQueryData<RespostaDaFila | undefined>(CHAVE_DA_FILA, (r) => trocarFeitos(r, clientId, (lista) => lista.filter((f) => f.id !== feito.id)));
      try {
        await desfazerFeito(feito.id);
      } catch (e) {
        queryClient.setQueryData<RespostaDaFila | undefined>(CHAVE_DA_FILA, antes);
        throw e;
      }
    },
    [queryClient],
  );

  return { marcar, desfazer };
}
