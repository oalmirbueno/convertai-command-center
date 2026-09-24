import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { inicioDoMes, rotuloDoMes, somarMeses } from "@/lib/mesa/api";
import { rpcAusente } from "@/lib/mesa/custos";

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
 */

export const RPC_DA_FILA = "mesa_fila_prioridades";

export interface MesDaFila {
  mes: string;
  itens: number;
  sem_arte: number;
  proximo_sem_arte: string | null;
  proposta_aberta: boolean;
}

export interface ClienteDaFila {
  client_id: string;
  nome: string;
  ultimo_acesso: string | null;
  posts_por_mes: number | null;
  aprovacao_pendentes: number;
  aprovacao_desde: string | null;
  revisao_pendentes: number;
  revisao_desde: string | null;
  reprovados: number;
  prontas_para_enviar: number;
  precisam_atencao: number;
  meses: MesDaFila[];
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
      meses.push({
        mes: mm.mes.slice(0, 10),
        itens: inteiro(mm.itens),
        sem_arte: inteiro(mm.sem_arte),
        proximo_sem_arte: textoOuNulo(mm.proximo_sem_arte) ? String(mm.proximo_sem_arte).slice(0, 10) : null,
        proposta_aberta: mm.proposta_aberta === true,
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
      revisao_pendentes: inteiro(c.revisao_pendentes),
      revisao_desde: textoOuNulo(c.revisao_desde),
      reprovados: inteiro(c.reprovados),
      prontas_para_enviar: inteiro(c.prontas_para_enviar),
      precisam_atencao: inteiro(c.precisam_atencao),
      meses,
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

const acao = (a: Omit<AcaoDaFila, "nivel" | "titulo"> & { titulo?: string }): AcaoDaFila => ({
  ...a,
  titulo: a.titulo || ROTULO_DA_ACAO[a.tipo],
  pontos: Math.round(a.pontos),
  nivel: nivelDosPontos(a.pontos),
});

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
 * - gerar o mês: mês corrente vazio (88); mês seguinte vazio, pelo tempo que
 *   falta para começar (80, 65 ou 45);
 * - gerar artes: itens sem arte de hoje em diante, pelo prazo do próximo
 *   (85 até 2 dias, 72 até 7, 55 até 14, senão 38);
 * - cobrar aprovação: 50 mais 2 por dia de espera (até 90); mais 5 se o
 *   cliente não entrou no painel depois do pedido;
 * - fazer ajustes pedidos (70); entregar artes prontas (62);
 * - revisar e liberar (60 mais 1 por dia, até 70);
 * - completar o mês: menos itens que o plano (40, ou 50 na última semana).
 * 80 ou mais = agora; 55 ou mais = nesta semana; o resto = depois.
 */
export function acoesDoCliente(c: ClienteDaFila, hoje: string, acessoConhecido: boolean): AcaoDaFila[] {
  const acoes: AcaoDaFila[] = [];
  const mesAtual = `${hoje.slice(0, 7)}-01`;
  const mesSeguinte = somarMeses(mesAtual, 1);
  const doMes = (mes: string) => c.meses.find((m) => m.mes === mes) || null;
  const atual = doMes(mesAtual);
  const seguinte = doMes(mesSeguinte);
  const diasParaSeguinte = diasEntre(hoje, mesSeguinte);

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

  const mesVazio = (m: MesDaFila | null, mes: string, pontos: number) => {
    const nome = nomeDoMes(mes);
    const aberta = !!(m && m.proposta_aberta);
    acoes.push(
      acao({
        tipo: "gerar_mes",
        titulo: aberta ? "Terminar o mês" : undefined,
        motivo: aberta ? `${maiuscula(nome)} tem proposta começada, falta gravar no calendário` : `O calendário de ${nome} está vazio`,
        pontos,
        aba: "mes",
        mes,
        quantidade: 0,
      }),
    );
  };

  if (atual && atual.itens === 0) mesVazio(atual, mesAtual, 88);
  if (seguinte && seguinte.itens === 0) mesVazio(seguinte, mesSeguinte, pontosDoMesVazio(diasParaSeguinte));

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
    for (const m of [atual, seguinte]) {
      if (!m || m.itens === 0 || m.itens >= c.posts_por_mes) continue;
      const ehSeguinte = m.mes === mesSeguinte;
      acoes.push(
        acao({
          tipo: "completar_mes",
          motivo: `${maiuscula(nomeDoMes(m.mes))} tem ${m.itens} de ${c.posts_por_mes} posts do plano`,
          pontos: ehSeguinte && diasParaSeguinte <= 7 ? 50 : 40,
          aba: "mes",
          mes: m.mes,
          quantidade: c.posts_por_mes - m.itens,
        }),
      );
    }
  }

  // Cliente parado: nada no calendário deste mês e do próximo, pedido de
  // aprovação com mais de 30 dias e sem acesso ao painel há mais de 30 dias
  // (caso Vivideo, 24/09: 107 dias). Vai para "depois" em vez de puxar o topo.
  const diasAprovacao = c.aprovacao_desde ? diasDesde(c.aprovacao_desde, hoje) : 0;
  const diasAcesso = c.ultimo_acesso ? diasDesde(c.ultimo_acesso, hoje) : Infinity;
  const semCalendario = (!atual || atual.itens === 0) && (!seguinte || seguinte.itens === 0);
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

export interface GrupoDaFila {
  client_id: string;
  nome: string;
  pontos: number;
  nivel: Nivel;
  acoes: AcaoDaFila[];
  ultimo_acesso: string | null;
  aprovacao_pendentes: number;
  aprovacao_dias: number;
}

export interface Fila {
  hoje: string;
  grupos: GrupoDaFila[];
  emDia: { client_id: string; nome: string }[];
  resumo: Record<Nivel, number>;
  acessoConhecido: boolean;
}

/** Clientes com algo a fazer, o mais urgente primeiro; os em dia ficam à parte. */
export function montarFila(r: RespostaDaFila): Fila {
  const grupos: GrupoDaFila[] = [];
  const emDia: { client_id: string; nome: string }[] = [];
  const resumo: Record<Nivel, number> = { agora: 0, semana: 0, depois: 0 };
  for (const c of r.clientes) {
    const acoes = acoesDoCliente(c, r.hoje, r.acesso_conhecido);
    if (!acoes.length) {
      emDia.push({ client_id: c.client_id, nome: c.nome });
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
    });
  }
  grupos.sort((a, b) => {
    if (b.pontos !== a.pontos) return b.pontos - a.pontos;
    const soma = (g: GrupoDaFila) => g.acoes.reduce((s, x) => s + x.pontos, 0);
    if (soma(b) !== soma(a)) return soma(b) - soma(a);
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
  emDia.sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  return { hoje: r.hoje, grupos, emDia, resumo, acessoConhecido: r.acesso_conhecido };
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

/** Leitura direta (RLS da equipe) no formato da RPC; o último acesso fica de fora. */
export async function lerFilaDireta(clientes: { id: string; nome: string }[], agora = new Date()): Promise<RespostaDaFila> {
  const sb = supabase as any;
  const hoje = diaLocal(agora);
  const mesAtual = inicioDoMes(agora);
  const mesSeguinte = somarMeses(mesAtual, 1);
  const fim = somarMeses(mesAtual, 2);
  const ids = clientes.map((c) => c.id);
  if (!ids.length) return { versao: 1, hoje, acesso_conhecido: false, clientes: [], origem: "direto" };

  const projetos = await lerEmLotes<{ id: string; client_id: string }>(ids, (lote) =>
    sb.from("projects").select("id, client_id").in("client_id", lote).is("deleted_at", null),
  );
  const clienteDoProjeto: Record<string, string> = {};
  for (const p of projetos) clienteDoProjeto[p.id] = p.client_id;

  const noventa = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - 90);
  const [tarefas, recentes, trabalhos, arquivos, revisao, configs, propostas] = await Promise.all([
    lerEmLotes<{ id: string; project_id: string; due_date: string; status: string | null }>(Object.keys(clienteDoProjeto), (lote) =>
      sb
        .from("tasks")
        .select("id, project_id, due_date, status")
        .in("project_id", lote)
        .in("delivery_type", FORMATOS_DE_ARTE)
        .is("deleted_at", null)
        .gte("due_date", mesAtual)
        .lt("due_date", fim),
    ),
    lerEmLotes<{ project_id: string }>(Object.keys(clienteDoProjeto), (lote) =>
      sb
        .from("tasks")
        .select("project_id")
        .in("project_id", lote)
        .in("delivery_type", FORMATOS_DE_ARTE)
        .is("deleted_at", null)
        .gte("due_date", diaLocal(noventa))
        .limit(1000),
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
    lerEmLotes<{ client_id: string; periodo_inicio: string; periodo_fim: string }>(ids, (lote) =>
      sb
        .from("calendario_propostas")
        .select("client_id, periodo_inicio, periodo_fim")
        .in("client_id", lote)
        .in("status", ["temas", "detalhando", "pronta"]),
    ).catch(() => [] as { client_id: string; periodo_inicio: string; periodo_fim: string }[]),
  ]);

  // Arte já feita: trabalho com imagem, post com arquivo ou anexo.
  const comArte: Record<string, boolean> = {};
  for (const t of trabalhos) if (t.task_id && Array.isArray(t.cards) && (t.cards as unknown[]).length > 0) comArte[t.task_id] = true;
  const pendentes = tarefas.filter((t) => !comArte[t.id] && t.status !== "done" && t.status !== "review" && t.due_date >= hoje).map((t) => t.id);
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
  const ativo: Record<string, boolean> = {};
  for (const c of clientes) {
    porCliente[c.id] = {
      client_id: c.id,
      nome: c.nome,
      ultimo_acesso: null,
      posts_por_mes: null,
      aprovacao_pendentes: 0,
      aprovacao_desde: null,
      revisao_pendentes: 0,
      revisao_desde: null,
      reprovados: 0,
      prontas_para_enviar: 0,
      precisam_atencao: 0,
      meses: [mesAtual, mesSeguinte].map((mes) => ({ mes, itens: 0, sem_arte: 0, proximo_sem_arte: null, proposta_aberta: false })),
    };
  }
  for (const r of recentes) if (clienteDoProjeto[r.project_id]) ativo[clienteDoProjeto[r.project_id]] = true;
  for (const t of tarefas) {
    const c = porCliente[clienteDoProjeto[t.project_id]];
    if (!c) continue;
    const m = c.meses.find((x) => x.mes === `${t.due_date.slice(0, 7)}-01`);
    if (!m) continue;
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
    ativo[t.client_id] = true;
    if (!t.entrega_status && (t.status === "pronto" || t.status === "entregue")) c.prontas_para_enviar += 1;
    if (t.entrega_status === "reprovado") c.reprovados += 1;
    if (t.entrega_status === "precisa_de_atencao") c.precisam_atencao += 1;
  }
  for (const f of arquivos) {
    const c = porCliente[f.client_id];
    if (!c) continue;
    ativo[f.client_id] = true;
    c.aprovacao_pendentes += 1;
    const quando = f.approval_requested_at || f.created_at;
    if (!c.aprovacao_desde || quando < c.aprovacao_desde) c.aprovacao_desde = quando;
  }
  for (const f of revisao) {
    const c = porCliente[f.client_id];
    if (!c) continue;
    c.revisao_pendentes += 1;
    if (!c.revisao_desde || f.created_at < c.revisao_desde) c.revisao_desde = f.created_at;
  }
  for (const cfg of configs) {
    const c = porCliente[cfg.client_id];
    if (c && cfg.posts_por_mes) {
      c.posts_por_mes = cfg.posts_por_mes;
      ativo[cfg.client_id] = true;
    }
  }
  for (const p of propostas) {
    const c = porCliente[p.client_id];
    if (!c) continue;
    for (const m of c.meses) {
      if (p.periodo_inicio < somarMeses(m.mes, 1) && p.periodo_fim >= m.mes) m.proposta_aberta = true;
    }
  }

  return {
    versao: 1,
    hoje,
    acesso_conhecido: false,
    clientes: clientes.filter((c) => ativo[c.id]).map((c) => porCliente[c.id]),
    origem: "direto",
  };
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
