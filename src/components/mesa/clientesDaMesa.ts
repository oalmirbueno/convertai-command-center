/**
 * Quem aparece no seletor de cliente de cada mesa (pedido do dono, 25/09:
 * "senão fica com um monte de escolha de cliente que fez trabalho avulso").
 *
 * Padrão, na mesma régua do Ciclo (useEsteira + AdminEsteira): só entra
 * cliente com plano ativo (plan_status "active"), que não é avulso
 * (client_type "one_off") e não foi apagado.
 * - Mesa (orgânica), Mesa Foto, Mesa Vídeos e Mesa Edição: todo cliente do plano mensal recorrente.
 * - Mesa Ads: além disso, o Ads marcado (services_config.trafego, o mesmo
 *   serviço que põe o cliente na frente Tráfego do Ciclo).
 *
 * Por cima do padrão, a escolha da equipe (tabela mesa_cliente_escolhas, uma
 * linha por mesa e cliente): "incluir" põe quem o padrão deixa de fora,
 * "retirar" tira quem o padrão põe. Sem linha, vale o padrão.
 *
 * Mesas de criação por projeto (frente PRO3, adendo do dono de 30/09: "às
 * vezes o cliente ainda não está no painel e só quer algo avulso"): Site,
 * Identidade, Motion, Proposta, Publicidade, Roteiros, Foto e Vídeos. Nelas o
 * cliente avulso (client_type "one_off"), o cliente sem plano e o lead
 * convertido sempre entram, com a marca "Avulso" no seletor. A Mesa (orgânica,
 * mensal), a Mesa Ads e a Mesa Edição seguem a régua de antes.
 *
 * Ordem: alfabética (sem acento), sempre a mesma. A equipe acha o cliente
 * pela posição de sempre ou pela busca; lista que muda de ordem por uso
 * confunde quem abre a mesa todo dia.
 */

export type MesaDeClientes = "organica" | "ads" | "foto" | "videos" | "publicidade" | "roteiros" | "edicao" | "identidade" | "proposta" | "site" | "motion";
export type ModoDaEscolha = "incluir" | "retirar";

/** PRO3: as mesas de criação por projeto (avulso, sem plano e lead convertido entram; "+ Cliente avulso" no seletor). */
export const MESAS_DE_CRIACAO: MesaDeClientes[] = ["site", "identidade", "motion", "proposta", "publicidade", "roteiros", "foto", "videos"];
export const ehMesaDeCriacao = (mesa: MesaDeClientes) => MESAS_DE_CRIACAO.indexOf(mesa) >= 0;

export const NOME_DA_MESA: Record<MesaDeClientes, string> = {
  organica: "Mesa",
  ads: "Mesa Ads",
  foto: "Mesa Foto",
  videos: "Mesa Vídeos",
  publicidade: "Mesa Publicidade",
  roteiros: "Mesa Roteiros",
  edicao: "Mesa Edição",
  identidade: "Mesa Identidade",
  proposta: "Mesa Proposta",
  site: "Mesa Site",
  motion: "Mesa Motion",
};

export const REGRA_DA_MESA: Record<MesaDeClientes, string> = {
  organica: "Padrão: clientes com plano mensal ativo.",
  ads: "Padrão: clientes com Ads marcado e plano ativo.",
  foto: "Padrão: clientes com plano mensal ativo, mais avulso, sem plano e lead convertido.",
  videos: "Padrão: clientes com plano mensal ativo, mais avulso, sem plano e lead convertido.",
  publicidade: "Padrão: clientes com plano mensal ativo, mais avulso, sem plano e lead convertido.",
  roteiros: "Padrão: clientes com plano mensal ativo, mais avulso, sem plano e lead convertido.",
  edicao: "Padrão: clientes com plano mensal ativo.",
  identidade: "Padrão: clientes com plano ativo, mais avulso, sem plano e lead convertido (marca costuma ser projeto).",
  proposta: "Padrão: todos os clientes (proposta vale para quem ainda não fechou).",
  site: "Padrão: todos os clientes (site é projeto, não plano).",
  motion: "Padrão: todo cliente (apresentação e filme da marca são projeto avulso tanto quanto de plano).",
};

export interface ClienteBruto {
  id: string;
  company_name?: string | null;
  full_name?: string | null;
  email?: string | null;
  plan_status?: string | null;
  client_type?: string | null;
  services_config?: Record<string, unknown> | null;
  deleted_at?: string | null;
  /** PRO3: para saber quem está sem plano. */
  plan_name?: string | null;
  plan_value?: number | string | null;
}

export interface EscolhaDaMesa {
  client_id: string;
  modo: ModoDaEscolha;
}

export interface ClienteDaMesa {
  id: string;
  nome: string;
  /** Aparece no seletor desta mesa. */
  naMesa: boolean;
  /** O que o padrão diria, sem a escolha da equipe. */
  padrao: boolean;
  escolha: ModoDaEscolha | null;
  /** Por que está (ou não está) na mesa, em poucas palavras. */
  motivo: string;
  /** PRO3: não é cliente mensal (avulso ou sem plano): o seletor marca "Avulso". */
  avulso: boolean;
}

/** Nunca teve plano: sem nome nem valor de plano e sem status de plano (ativo ou em pausa). */
export function semPlano(c: ClienteBruto): boolean {
  const status = String(c.plan_status || "");
  return status !== "active" && status !== "standby" && !String(c.plan_name || "").trim() && !(Number(c.plan_value) > 0);
}

/** Avulso para a tela: trabalho avulso ou sem plano. */
export const ehAvulso = (c: ClienteBruto) => c.client_type === "one_off" || semPlano(c);

/** Lead convertido: veio do Comercial (bandeira lead_id do cadastro) ou está ligado a um lead ganho. */
export function ehLeadConvertido(c: ClienteBruto, convertidos?: Record<string, true> | null): boolean {
  const sc = (c.services_config || {}) as Record<string, unknown>;
  return (typeof sc.lead_id === "string" && !!sc.lead_id) || !!(convertidos && convertidos[String(c.id)]);
}

export const semAcento = (t: string) =>
  (t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();

export function nomeDoClienteBruto(c: ClienteBruto): string {
  return String(c.company_name || c.full_name || c.email || "Cliente");
}

/** O padrão da mesa para um cliente, com o motivo. */
export function entraPeloPadrao(mesa: MesaDeClientes, c: ClienteBruto, convertidos?: Record<string, true> | null): { entra: boolean; motivo: string } {
  if (c.deleted_at) return { entra: false, motivo: "Cliente apagado" };
  // PRO3: nas mesas de criação, avulso, lead convertido e sem plano sempre entram.
  if (ehMesaDeCriacao(mesa)) {
    if (c.client_type === "one_off") return { entra: true, motivo: "Trabalho avulso" };
    if (ehLeadConvertido(c, convertidos)) return { entra: true, motivo: "Lead convertido" };
    if (semPlano(c)) return { entra: true, motivo: "Sem plano" };
  }
  // Mesa Identidade (frente IDV): identidade e naming costumam ser projeto avulso, então o avulso entra.
  if (mesa === "identidade" && c.client_type === "one_off") return { entra: true, motivo: "Trabalho avulso" };
  // Frente PRO: proposta é antes do plano; todo cliente vivo entra.
  if (mesa === "proposta") return { entra: true, motivo: "Todo cliente" };
  // Frente SIT: site é projeto avulso tanto quanto de plano; todo cliente vivo entra.
  if (mesa === "site") return { entra: true, motivo: "Todo cliente" };
  // Frente MOT: filme da marca e apresentação são avulsos tanto quanto de plano; todo cliente vivo entra.
  if (mesa === "motion") return { entra: true, motivo: "Todo cliente" };
  const status = String(c.plan_status || "");
  if (status !== "active") return { entra: false, motivo: status === "standby" ? "Plano em pausa" : "Sem plano ativo" };
  if (c.client_type === "one_off") return { entra: false, motivo: "Trabalho avulso" };
  if (mesa === "ads") {
    const sc = (c.services_config || {}) as Record<string, unknown>;
    return sc.trafego === true ? { entra: true, motivo: "Ads marcado" } : { entra: false, motivo: "Sem Ads marcado" };
  }
  return { entra: true, motivo: "Plano mensal ativo" };
}

const MODOS: ModoDaEscolha[] = ["incluir", "retirar"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Linhas do banco em forma segura: só cliente válido e modo conhecido. */
export function normalizarEscolhas(linhas: unknown): EscolhaDaMesa[] {
  if (!Array.isArray(linhas)) return [];
  const saida: EscolhaDaMesa[] = [];
  for (const l of linhas as Record<string, unknown>[]) {
    if (!l || typeof l !== "object") continue;
    const id = String(l.client_id || "");
    const modo = String(l.modo || "") as ModoDaEscolha;
    if (UUID.test(id) && MODOS.indexOf(modo) >= 0) saida.push({ client_id: id, modo });
  }
  return saida;
}

export function ordenarPorNome<T extends { nome: string }>(lista: T[]): T[] {
  return lista.slice().sort((a, b) => {
    const x = semAcento(a.nome);
    const y = semAcento(b.nome);
    return x < y ? -1 : x > y ? 1 : a.nome.localeCompare(b.nome, "pt-BR");
  });
}

export interface ClientesDaMesa {
  /** Todos os clientes, com o estado nesta mesa, em ordem alfabética. */
  todos: ClienteDaMesa[];
  /** O que o seletor mostra. */
  visiveis: ClienteDaMesa[];
  /** Ninguém entra pelo padrão nem pela escolha: o seletor mostra todos para não travar a equipe. */
  mostrandoTodos: boolean;
}

export function montarClientesDaMesa(mesa: MesaDeClientes, brutos: ClienteBruto[] | null | undefined, escolhas: EscolhaDaMesa[], convertidos?: Record<string, true> | null): ClientesDaMesa {
  const porCliente: Record<string, ModoDaEscolha> = {};
  escolhas.forEach((e) => {
    porCliente[e.client_id] = e.modo;
  });
  const vistos: Record<string, true> = {};
  const todos: ClienteDaMesa[] = [];
  (brutos || []).forEach((c) => {
    if (!c || !c.id || vistos[String(c.id)]) return;
    const id = String(c.id);
    vistos[id] = true;
    const p = entraPeloPadrao(mesa, c, convertidos);
    const escolha = porCliente[id] || null;
    const naMesa = escolha === "incluir" ? true : escolha === "retirar" ? false : p.entra;
    const motivo = escolha === "incluir" ? "Incluído pela equipe" : escolha === "retirar" ? "Retirado pela equipe" : p.motivo;
    todos.push({ id, nome: nomeDoClienteBruto(c), naMesa, padrao: p.entra, escolha, motivo, avulso: ehAvulso(c) });
  });
  const ordenados = ordenarPorNome(todos);
  const naMesa = ordenados.filter((c) => c.naMesa);
  const mostrandoTodos = naMesa.length === 0 && ordenados.length > 0;
  return { todos: ordenados, visiveis: mostrandoTodos ? ordenados : naMesa, mostrandoTodos };
}

/** Busca sem acento; quem começa com o termo (ou tem palavra que começa) vem primeiro. */
export function filtrarPorBusca<T extends { nome: string }>(lista: T[], busca: string): T[] {
  const termo = semAcento(busca);
  if (!termo) return lista;
  const comeco: T[] = [];
  const meio: T[] = [];
  for (const c of lista) {
    const nome = semAcento(c.nome);
    const i = nome.indexOf(termo);
    if (i === 0 || nome.indexOf(` ${termo}`) >= 0) comeco.push(c);
    else if (i > 0) meio.push(c);
  }
  return comeco.concat(meio);
}

/**
 * Modo a gravar quando a equipe liga ou desliga o cliente na mesa: igual ao
 * padrão, a escolha some (null) e o cliente volta a seguir a regra.
 */
export function modoParaGravar(padrao: boolean, querNaMesa: boolean): ModoDaEscolha | null {
  if (querNaMesa === padrao) return null;
  return querNaMesa ? "incluir" : "retirar";
}
