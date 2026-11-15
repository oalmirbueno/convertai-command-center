/**
 * Caixa "Precisa de você" no topo da Esteira (fase 2, 14/11/2026): regras
 * puras. Monta a lista a partir de linhas já lidas (a leitura em lote mora em
 * precisaDeVoceFatos.ts); nada aqui toca o banco.
 *
 * Só entra o que a equipe não pode decidir sozinha:
 *   1. dinheiro, verba ou gasto de anúncio;
 *   2. cliente novo ou plano;
 *   3. decisão que um agente marcou como precisando do dono;
 *   4. peça que o cliente rejeitou mais de uma vez.
 *
 * Fica de fora, de propósito: a fila inteira da Execução, saldo baixo,
 * campanha vencendo, mensagens e atrasos do dia. Isso continua nas telas de
 * origem (a aba "Precisa de você" de /execucao não muda).
 *
 * A caixa só aponta onde se resolve. Ela não decide nada.
 */

import { normalizarAcao } from "@/lib/anunciosHoje";
import { precisaDecisao } from "@/lib/precisaDecisao";

export type TipoDoPedido = "dinheiro" | "cliente_ou_plano" | "rejeicao_repetida" | "decisao_de_agente";

export const ROTULO_DO_TIPO: Record<TipoDoPedido, string> = {
  dinheiro: "Dinheiro e verba",
  cliente_ou_plano: "Cliente novo ou plano",
  rejeicao_repetida: "Rejeitada mais de uma vez",
  decisao_de_agente: "Decisão pedida por agente",
};

/** A ordem da caixa: primeiro o que mexe com dinheiro e com cliente. */
const ORDEM_DO_TIPO: Record<TipoDoPedido, number> = { dinheiro: 0, cliente_ou_plano: 1, rejeicao_repetida: 2, decisao_de_agente: 3 };

export interface PedidoDoDono {
  chave: string;
  tipo: TipoDoPedido;
  clientId: string | null;
  /** Nome do cliente, quando o pedido é de um cliente. */
  cliente: string | null;
  oQue: string;
  porQue: string;
  /** Onde se resolve. */
  link: string;
  /** Nome curto do destino, para o botão: "Execução", "Anúncios", "Agenda"... */
  onde: string;
  quando: string | null;
}

// ------------------------------------------------------------------ linhas lidas

/** operator_approvals: o pedido explicado que o agente abre (operator_request_approval). */
export interface LinhaDeAprovacao {
  id: string;
  status: string | null;
  action_kind: string | null;
  o_que: string | null;
  por_que: string | null;
  custo_previsto: number | string | null;
  client_id: string | null;
  task_link_id: string | null;
  created_at: string | null;
  invalidated_at?: string | null;
}

/** operator_task_links: o vínculo da Execução com a marca de aprovação. */
export interface LinhaDeVinculoDaExecucao {
  id: string;
  status: string | null;
  approval_required: boolean | null;
  block_reason: string | null;
  next_step: string | null;
  last_action: string | null;
  updated_at: string | null;
}

/** file_approval_events com event_type = client_rejected. */
export interface LinhaDeRejeicao {
  id: string;
  file_id: string;
  client_id: string;
  created_at: string | null;
  feedback: string | null;
}

export interface LinhaDeArquivoRejeitado {
  id: string;
  client_id: string;
  file_name: string | null;
  revision_of_file_id: string | null;
  approval_status: string | null;
  archived_at: string | null;
  created_at: string | null;
}

/** estudio_trabalhos que já passaram por mais de uma volta de ajuste. */
export interface LinhaDeTrabalhoRejeitado {
  id: string;
  client_id: string;
  task_id: string | null;
  post_id: string | null;
  entrega_status: string | null;
  file_ids: string[] | null;
  /** [{evento_id, decisao: "ajuste" | "aprovado", texto, pedido_em, file_id, ...}] */
  ajustes_do_cliente: unknown;
  titulo?: string | null;
}

export interface LinhasDoDono {
  aprovacoes: LinhaDeAprovacao[];
  vinculos: LinhaDeVinculoDaExecucao[];
  /** Linhas cruas de ads_rotina_acoes (normalizadas por `normalizarAcao`). */
  acoesDeAnuncio: unknown[];
  rejeicoes: LinhaDeRejeicao[];
  arquivos: LinhaDeArquivoRejeitado[];
  trabalhos: LinhaDeTrabalhoRejeitado[];
}

export const LINHAS_DO_DONO_VAZIAS: LinhasDoDono = { aprovacoes: [], vinculos: [], acoesDeAnuncio: [], rejeicoes: [], arquivos: [], trabalhos: [] };

// ------------------------------------------------------------------ classificação

/** Status de operator_approvals que ainda esperam decisão (os mesmos da Execução). */
export const APROVACAO_EM_ABERTO = ["pendente", "adiado"] as const;

const ACOES_DE_DINHEIRO = new Set(["gastar", "alterar_orcamento", "alterar_financeiro", "ativar_campanha"]);
const ACOES_DE_CLIENTE_OU_PLANO = new Set(["criar_proposta", "enviar_contrato"]);
const FALA_DE_DINHEIRO = /\b(verba|or[çc]amento|recarga|saldo|pagamento|pagar|boleto|pix|fatura|cobran[çc]a|reembolso|investimento)\b|r\$\s?\d/i;
const FALA_DE_CLIENTE_OU_PLANO = /\b(cliente novo|novo cliente|mudan[çc]a de plano|troca de plano|trocar de plano|upgrade de plano|downgrade|novo plano|renova[çc][ãa]o do plano|cancelar o plano|cancelamento do plano)\b/i;

/**
 * O tipo de um pedido de aprovação de agente. O catálogo fechado de
 * `action_kind` decide primeiro; depois o custo previsto; por último o texto
 * do próprio pedido. Tudo o que sobra é decisão pedida por agente.
 */
export function tipoDaAprovacao(a: Pick<LinhaDeAprovacao, "action_kind" | "o_que" | "por_que" | "custo_previsto">): TipoDoPedido {
  const acao = String(a.action_kind ?? "");
  if (ACOES_DE_DINHEIRO.has(acao)) return "dinheiro";
  if (ACOES_DE_CLIENTE_OU_PLANO.has(acao)) return "cliente_ou_plano";
  if ((Number(a.custo_previsto) || 0) > 0) return "dinheiro";
  const fala = `${a.o_que ?? ""} ${a.por_que ?? ""}`;
  if (FALA_DE_CLIENTE_OU_PLANO.test(fala)) return "cliente_ou_plano";
  if (FALA_DE_DINHEIRO.test(fala)) return "dinheiro";
  return "decisao_de_agente";
}

const curto = (valor: string | null | undefined, limite = 180): string => {
  const limpo = String(valor ?? "").replace(/\s+/g, " ").trim();
  return limpo.length > limite ? `${limpo.slice(0, limite - 1).trimEnd()}…` : limpo;
};

const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ------------------------------------------------------------------ peça rejeitada mais de uma vez

interface AjusteDoCliente {
  evento_id?: string;
  decisao?: string;
  texto?: string;
  pedido_em?: string;
  file_id?: string;
}

const ajustesDe = (valor: unknown): AjusteDoCliente[] =>
  Array.isArray(valor) ? (valor.filter((x) => x && typeof x === "object") as AjusteDoCliente[]) : [];

/** A peça do Estúdio já saiu da mão da agência: aprovada pelo cliente ou agendada. */
const ENTREGA_RESOLVIDA = new Set(["aprovado", "agendado"]);

export interface PecaRejeitada {
  chave: string;
  clientId: string;
  titulo: string;
  rejeicoes: number;
  ultimoMotivo: string | null;
  quando: string | null;
  /** Peça do Estúdio (com tarefa e, às vezes, post) ou arquivo avulso da tela de Arquivos. */
  origem: { tipo: "estudio"; taskId: string | null; postId: string | null } | { tipo: "arquivo" };
}

/**
 * As peças que o cliente rejeitou duas vezes ou mais e que ainda não foram
 * aprovadas nem agendadas.
 *
 * Cada rejeição trava o arquivo e a correção vira um arquivo novo, então
 * contar por arquivo nunca passaria de um. A conta é por peça:
 *   - no Estúdio, a peça é o trabalho, e as rejeições são os pedidos de ajuste
 *     que o gatilho da aprovação guarda nela (ajustes_do_cliente, um por
 *     evento) mais as do arquivo atual;
 *   - fora do Estúdio, a peça é a cadeia de versões do arquivo
 *     (revision_of_file_id).
 */
export function pecasRejeitadasMaisDeUmaVez(entrada: Pick<LinhasDoDono, "rejeicoes" | "arquivos" | "trabalhos">): PecaRejeitada[] {
  const saida: PecaRejeitada[] = [];
  const arquivosDoEstudio = new Set<string>();
  const eventosDoEstudio = new Set<string>();

  for (const t of entrada.trabalhos) {
    const atual = Array.isArray(t.file_ids) && t.file_ids.length > 0 ? t.file_ids[0] : null;
    const ajustes = ajustesDe(t.ajustes_do_cliente).filter((a) => a.decisao === "ajuste");
    const eventos = new Map<string, { quando: string | null; motivo: string | null }>();
    for (const a of ajustes) {
      if (a.file_id) arquivosDoEstudio.add(a.file_id);
      eventos.set(String(a.evento_id || `${a.file_id}:${a.pedido_em}`), { quando: a.pedido_em ?? null, motivo: a.texto ?? null });
    }
    if (atual) {
      arquivosDoEstudio.add(atual);
      for (const r of entrada.rejeicoes) {
        if (r.file_id === atual && !eventos.has(r.id)) eventos.set(r.id, { quando: r.created_at, motivo: r.feedback });
      }
    }
    for (const id of eventos.keys()) eventosDoEstudio.add(id);
    if (eventos.size < 2 || ENTREGA_RESOLVIDA.has(String(t.entrega_status ?? ""))) continue;
    const ultimo = [...eventos.values()].sort((a, b) => String(b.quando || "").localeCompare(String(a.quando || "")))[0];
    saida.push({
      chave: `trabalho:${t.id}`,
      clientId: t.client_id,
      titulo: curto(t.titulo, 90) || "Peça do Estúdio",
      rejeicoes: eventos.size,
      ultimoMotivo: ultimo?.motivo ?? null,
      quando: ultimo?.quando ?? null,
      origem: { tipo: "estudio", taskId: t.task_id, postId: t.post_id },
    });
  }

  // Cadeias de versão: cada arquivo aponta para a raiz da sua cadeia.
  const arquivoPorId = new Map(entrada.arquivos.map((a) => [a.id, a]));
  const raizDe = (id: string): string => {
    let atual = id;
    for (let passo = 0; passo < 50; passo += 1) {
      const anterior = arquivoPorId.get(atual)?.revision_of_file_id;
      if (!anterior || anterior === atual) break;
      atual = anterior;
    }
    return atual;
  };
  const cadeias = new Map<string, { arquivos: LinhaDeArquivoRejeitado[]; rejeicoes: LinhaDeRejeicao[] }>();
  const cadeia = (raiz: string) => {
    const c = cadeias.get(raiz) ?? { arquivos: [], rejeicoes: [] };
    cadeias.set(raiz, c);
    return c;
  };
  for (const a of entrada.arquivos) cadeia(raizDe(a.id)).arquivos.push(a);
  for (const r of entrada.rejeicoes) {
    if (eventosDoEstudio.has(r.id) || arquivosDoEstudio.has(r.file_id)) continue;
    cadeia(raizDe(r.file_id)).rejeicoes.push(r);
  }
  for (const [raiz, c] of cadeias) {
    if (c.rejeicoes.length < 2) continue;
    if (c.arquivos.some((a) => arquivosDoEstudio.has(a.id))) continue;
    if (c.arquivos.some((a) => a.approval_status === "approved")) continue;
    const versoes = [...c.arquivos].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
    const maisNova = versoes[0];
    if (maisNova?.archived_at) continue;
    const ultima = [...c.rejeicoes].sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
    saida.push({
      chave: `arquivo:${raiz}`,
      clientId: ultima.client_id,
      titulo: curto(maisNova?.file_name, 90) || "Arquivo em aprovação",
      rejeicoes: c.rejeicoes.length,
      ultimoMotivo: ultima.feedback,
      quando: ultima.created_at,
      origem: { tipo: "arquivo" },
    });
  }
  return saida;
}

// ------------------------------------------------------------------ montagem

export interface EntradaDaCaixa extends LinhasDoDono {
  /** Nome do cliente pelo id; null quando não é cliente conhecido. */
  nomeDe: (clientId: string | null) => string | null;
  /** Clientes ativos: a peça rejeitada de cliente parado não sobe para o dono. */
  clientesAtivos?: ReadonlySet<string>;
  /** O usuário pode abrir /mesa (admin, gestor, design)? */
  podeAbrirEstudio?: boolean;
}

/**
 * A lista da caixa, pronta para a tela: só os quatro tipos, cada item com
 * cliente (quando há), o que se pede, o porquê e o link de onde se resolve.
 */
export function montarPedidosDoDono(entrada: EntradaDaCaixa): PedidoDoDono[] {
  const pedidos: PedidoDoDono[] = [];
  const nome = (id: string | null) => (id ? entrada.nomeDe(id) : null);

  // 1 a 3) Pedidos explicados dos agentes: dinheiro, cliente ou plano, ou decisão.
  const vinculosComPedido = new Set<string>();
  for (const a of entrada.aprovacoes) {
    if (!(APROVACAO_EM_ABERTO as readonly string[]).includes(String(a.status)) || a.invalidated_at) continue;
    if (a.task_link_id) vinculosComPedido.add(a.task_link_id);
    const custo = Number(a.custo_previsto) || 0;
    pedidos.push({
      chave: `aprovacao:${a.id}`,
      tipo: tipoDaAprovacao(a),
      clientId: a.client_id,
      cliente: nome(a.client_id),
      oQue: curto(a.o_que) || "Pedido de aprovação de agente",
      porQue: [curto(a.por_que), custo > 0 ? `Custo previsto: ${brl(custo)}.` : "", a.status === "adiado" ? "Você adiou este pedido." : ""].filter(Boolean).join(" "),
      link: `/execucao?aprovacao=${encodeURIComponent(a.id)}`,
      onde: "Execução",
      quando: a.created_at,
    });
  }

  // 1) Ação de anúncio que o agente propôs e ainda espera o sim.
  for (const linha of entrada.acoesDeAnuncio) {
    const acao = normalizarAcao(linha);
    if (acao.estado !== "proposta" || !acao.id) continue;
    pedidos.push({
      chave: `anuncio:${acao.id}`,
      tipo: "dinheiro",
      clientId: acao.clientId,
      cliente: nome(acao.clientId),
      oQue: curto(`Proposta do agente de tráfego em ${acao.alvoNome}`),
      porQue: curto(acao.motivo) || "O agente propôs uma mudança na conta de anúncios e espera a sua resposta.",
      link: "/anuncios/hoje",
      onde: "Anúncios",
      quando: acao.quando || null,
    });
  }

  // 3) Vínculo da Execução com a marca de aprovação e sem pedido explicado.
  for (const v of entrada.vinculos) {
    if (!precisaDecisao(v) || vinculosComPedido.has(v.id)) continue;
    pedidos.push({
      chave: `vinculo:${v.id}`,
      tipo: "decisao_de_agente",
      clientId: null,
      cliente: null,
      oQue: curto(v.next_step) || curto(v.last_action) || "Tarefa de agente esperando a sua decisão",
      porQue: curto(v.block_reason) || "O agente marcou que só continua com a sua decisão.",
      link: `/execucao?vinculo=${encodeURIComponent(v.id)}`,
      onde: "Execução",
      quando: v.updated_at,
    });
  }

  // 4) Peça que o cliente rejeitou mais de uma vez.
  for (const p of pecasRejeitadasMaisDeUmaVez(entrada)) {
    if (entrada.clientesAtivos && !entrada.clientesAtivos.has(p.clientId)) continue;
    const cliente = encodeURIComponent(p.clientId);
    let link = `/aprovacoes?client=${cliente}`;
    let onde = "Aprovações";
    if (p.origem.tipo === "estudio") {
      if (p.origem.postId) {
        link = `/calendario?client=${cliente}&content=${encodeURIComponent(p.origem.postId)}`;
        onde = "Agenda";
      } else if (p.origem.taskId && entrada.podeAbrirEstudio !== false) {
        link = `/mesa?client=${cliente}&aba=estudio&task=${encodeURIComponent(p.origem.taskId)}`;
        onde = "Estúdio";
      } else {
        link = `/calendario?client=${cliente}`;
        onde = "Agenda";
      }
    }
    pedidos.push({
      chave: `rejeicao:${p.chave}`,
      tipo: "rejeicao_repetida",
      clientId: p.clientId,
      cliente: nome(p.clientId),
      oQue: `"${p.titulo}" foi rejeitada ${p.rejeicoes} vezes pelo cliente`,
      porQue: p.ultimoMotivo ? `Último pedido do cliente: ${curto(p.ultimoMotivo, 140)}` : "O cliente pediu ajuste mais de uma vez e a peça ainda não foi aprovada.",
      link,
      onde,
      quando: p.quando,
    });
  }

  return pedidos.sort(
    (a, b) => ORDEM_DO_TIPO[a.tipo] - ORDEM_DO_TIPO[b.tipo] || String(b.quando || "").localeCompare(String(a.quando || "")) || a.chave.localeCompare(b.chave),
  );
}
