/**
 * Caixa "Precisa de você" para os agentes (MCP 2.28.0, 14/11/2026): regras
 * puras, sem banco e sem import. É a mesma classificação da caixa da Esteira
 * no painel (src/lib/esteiraLinha/precisaDeVoce.ts), repetida aqui porque a
 * função do MCP não importa código do front. O teste
 * src/test/mcp-precisa-de-voce.test.ts roda as duas sobre as mesmas linhas e
 * exige a mesma lista: se a regra do painel mudar, ele fica vermelho.
 *
 * Só entra o que a equipe não pode decidir sozinha:
 *   1. dinheiro, verba ou gasto de anúncio;
 *   2. cliente novo ou plano;
 *   3. decisão que um agente marcou como precisando do dono;
 *   4. peça que o cliente rejeitou mais de uma vez.
 *
 * A caixa só aponta onde se resolve. Ela não decide nada.
 */

export type TipoDoPedido = "dinheiro" | "cliente_ou_plano" | "rejeicao_repetida" | "decisao_de_agente";

export const TIPOS_DO_PEDIDO: readonly TipoDoPedido[] = ["dinheiro", "cliente_ou_plano", "rejeicao_repetida", "decisao_de_agente"];

export const ROTULO_DO_TIPO: Record<TipoDoPedido, string> = {
  dinheiro: "Dinheiro e verba",
  cliente_ou_plano: "Cliente novo ou plano",
  rejeicao_repetida: "Rejeitada mais de uma vez",
  decisao_de_agente: "Decisão pedida por agente",
};

const ORDEM_DO_TIPO: Record<TipoDoPedido, number> = { dinheiro: 0, cliente_ou_plano: 1, rejeicao_repetida: 2, decisao_de_agente: 3 };

/** O que o agente marca com aceleriq_marcar_precisa_de_voce. Fora das duas listas abaixo, de propósito. */
export const ACAO_PEDIR_DECISAO_DO_DONO = "pedir_decisao_do_dono";

/** Ids para o agente seguir o assunto pelas outras ferramentas. Só os que existem no item. */
export interface IdsDoPedido {
  approval_id?: string;
  link_id?: string;
  acao_de_anuncio_id?: string;
  trabalho_id?: string;
  task_id?: string;
  post_id?: string;
  file_id?: string;
}

export interface PedidoDoDono {
  chave: string;
  tipo: TipoDoPedido;
  clientId: string | null;
  cliente: string | null;
  oQue: string;
  porQue: string;
  link: string;
  onde: string;
  quando: string | null;
  ids: IdsDoPedido;
}

// ------------------------------------------------------------------ linhas lidas

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

export interface LinhaDeVinculoDaExecucao {
  id: string;
  status: string | null;
  approval_required: boolean | null;
  block_reason: string | null;
  next_step: string | null;
  last_action: string | null;
  updated_at: string | null;
}

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

export interface LinhaDeTrabalhoRejeitado {
  id: string;
  client_id: string;
  task_id: string | null;
  post_id: string | null;
  entrega_status: string | null;
  file_ids: string[] | null;
  ajustes_do_cliente: unknown;
  titulo?: string | null;
}

export interface LinhasDoDono {
  aprovacoes: LinhaDeAprovacao[];
  vinculos: LinhaDeVinculoDaExecucao[];
  /** Linhas cruas de ads_rotina_acoes. */
  acoesDeAnuncio: unknown[];
  rejeicoes: LinhaDeRejeicao[];
  arquivos: LinhaDeArquivoRejeitado[];
  trabalhos: LinhaDeTrabalhoRejeitado[];
}

export const LINHAS_DO_DONO_VAZIAS: LinhasDoDono = { aprovacoes: [], vinculos: [], acoesDeAnuncio: [], rejeicoes: [], arquivos: [], trabalhos: [] };

// ------------------------------------------------------------------ classificação

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

/** Um vínculo de execução ainda espera decisão: marcado e não concluído. */
export function precisaDecisao(v: { approval_required?: boolean | null; status?: string | null }): boolean {
  return Boolean(v.approval_required) && v.status !== "done";
}

// ------------------------------------------------------------------ proposta de anúncio

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
const objeto = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

export interface PropostaDeAnuncio {
  id: string;
  clientId: string | null;
  quando: string;
  alvoNome: string;
  motivo: string | null;
  estado: string | null;
}

/** Os campos de ads_rotina_acoes que a caixa usa (as mesmas quedas de nome da tela de Anúncios). */
export function lerPropostaDeAnuncio(linha: unknown): PropostaDeAnuncio {
  const r = objeto(linha);
  const alvo = objeto(r.alvo);
  return {
    id: texto(r.id),
    clientId: texto(r.client_id) || null,
    quando: texto(r.criado_em) || texto(r.created_at),
    alvoNome: texto(r.alvo_nome) || texto(alvo.nome) || texto(alvo.name) || texto(r.alvo_id) || texto(alvo.meta_id) || texto(alvo.id) || "Alvo não informado",
    motivo: texto(r.motivo) || texto(r.porque) || texto(r.resumo) || null,
    estado: texto(r.estado) || null,
  };
}

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
  origem: { tipo: "estudio"; trabalhoId: string; taskId: string | null; postId: string | null } | { tipo: "arquivo"; raizId: string };
}

/**
 * As peças que o cliente rejeitou duas vezes ou mais e que ainda não foram
 * aprovadas nem agendadas. No Estúdio a peça é o trabalho; fora dele, a
 * cadeia de versões do arquivo (revision_of_file_id).
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
      origem: { tipo: "estudio", trabalhoId: t.id, taskId: t.task_id, postId: t.post_id },
    });
  }

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
      origem: { tipo: "arquivo", raizId: raiz },
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
  /** Quem lê pode abrir /mesa (admin, gestor, design)? */
  podeAbrirEstudio?: boolean;
}

const semVazios = (ids: Record<string, string | null | undefined>): IdsDoPedido =>
  Object.fromEntries(Object.entries(ids).filter(([, v]) => Boolean(v))) as IdsDoPedido;

/** A lista da caixa: só os quatro tipos, cada item com cliente, o que se pede, o porquê e onde se resolve. */
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
      ids: semVazios({ approval_id: a.id, link_id: a.task_link_id }),
    });
  }

  // 1) Ação de anúncio que o agente propôs e ainda espera o sim.
  for (const linha of entrada.acoesDeAnuncio) {
    const acao = lerPropostaDeAnuncio(linha);
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
      ids: semVazios({ acao_de_anuncio_id: acao.id }),
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
      ids: semVazios({ link_id: v.id }),
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
      ids: p.origem.tipo === "estudio"
        ? semVazios({ trabalho_id: p.origem.trabalhoId, task_id: p.origem.taskId, post_id: p.origem.postId })
        : semVazios({ file_id: p.origem.raizId }),
    });
  }

  return pedidos.sort(
    (a, b) => ORDEM_DO_TIPO[a.tipo] - ORDEM_DO_TIPO[b.tipo] || String(b.quando || "").localeCompare(String(a.quando || "")) || a.chave.localeCompare(b.chave),
  );
}

/**
 * O que a credencial enxerga. Credencial sem restrição vê tudo; credencial
 * presa a clientes vê só os pedidos desses clientes, e o que não tem cliente
 * (operação interna, vínculo sem cliente) some junto.
 */
export function pedidosNoEscopo(
  pedidos: PedidoDoDono[],
  escopo: { unrestricted: boolean; clientIds: readonly string[] },
): PedidoDoDono[] {
  if (escopo.unrestricted) return pedidos;
  const permitidos = new Set(escopo.clientIds);
  return pedidos.filter((p) => p.clientId !== null && permitidos.has(p.clientId));
}
