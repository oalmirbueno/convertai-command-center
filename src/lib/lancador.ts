import { SERVICE_LABELS } from "@/lib/cycleDefs";

/**
 * Regras do lançador único (o botão pequeno do canto) e do pré-contexto do
 * agente Aceleriq. Sem React aqui: o componente só desenha o que sai daqui,
 * e os testes olham estas funções direto.
 *
 * Antes eram duas bolinhas soltas (ajuda à direita, agente à esquerda), cada
 * uma cobrindo um pedaço da tela. Agora é um botão só, NA BARRA (topo no
 * computador, barra de baixo no celular), com as opções num menu curto. Nada
 * flutua sobre o conteúdo. O cliente vê só o "?".
 */

export type PapelDoLancador = "equipe" | "cliente";

export type ChaveDaOpcao = "agente" | "ajuda" | "tour" | "atalhos";

export interface OpcaoDoLancador {
  chave: ChaveDaOpcao;
  rotulo: string;
  detalhe: string;
  /** Atalho de teclado mostrado ao lado (só texto). */
  atalho?: string;
}

/** Atalho do agente: Alt+A (e.code, para valer no Mac, onde Option+A escreve "å"). */
export const ATALHO_DO_AGENTE = "Alt+A";

/**
 * O que o menu mostra para cada papel. A equipe tem o agente (quando pode
 * usar), a ajuda da tela, o tour e os atalhos. O cliente tem só a ajuda da
 * tela e o tour, atrás do "?".
 */
export function opcoesDoLancador(papel: PapelDoLancador, o: { podeUsarAgente: boolean }): OpcaoDoLancador[] {
  const ajuda: OpcaoDoLancador = { chave: "ajuda", rotulo: "Ajuda: como fazer nesta tela", detalhe: "O passo a passo desta tela" };
  const tour: OpcaoDoLancador = { chave: "tour", rotulo: "Tour completo", detalhe: "Rever a plataforma do começo" };
  if (papel === "cliente") return [ajuda, tour];
  const lista: OpcaoDoLancador[] = [];
  if (o.podeUsarAgente) {
    lista.push({ chave: "agente", rotulo: "Aceleriq (voz e IA)", detalhe: "Fale ou escreva: projetos, contratos, tarefas", atalho: ATALHO_DO_AGENTE });
  }
  lista.push(ajuda, tour, { chave: "atalhos", rotulo: "Atalhos de teclado", detalhe: "Abrir o agente e trocar de mesa" });
  return lista;
}

/** Os atalhos que existem no painel (o menu "Atalhos de teclado" lista estes). */
export const ATALHOS_DO_PAINEL: { teclas: string; o_que: string }[] = [
  { teclas: ATALHO_DO_AGENTE, o_que: "Abrir o Aceleriq (voz e IA)" },
  { teclas: "?", o_que: "Abrir a ajuda desta tela" },
  { teclas: "Alt+M", o_que: "Trocar de mesa (dentro das mesas)" },
  { teclas: "Esc", o_que: "Fechar o agente ou o menu" },
];

/** A tecla veio de um campo de texto? Aí o atalho não vale. */
export function digitandoEm(alvo: EventTarget | null): boolean {
  const el = alvo as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable === true;
}

type Tecla = Pick<KeyboardEvent, "altKey" | "ctrlKey" | "metaKey" | "shiftKey" | "key" | "code" | "target">;

export function ehAtalhoDoAgente(e: Tecla): boolean {
  if (!e.altKey || e.ctrlKey || e.metaKey) return false;
  return e.code === "KeyA" || (e.key || "").toLowerCase() === "a";
}

export function ehAtalhoDaAjuda(e: Tecla): boolean {
  if (e.altKey || e.ctrlKey || e.metaKey) return false;
  return e.key === "?" && !digitandoEm(e.target);
}

/* ───────────────────────── Pré-contexto do agente ───────────────────────── */

/**
 * O cliente da tela atual: `?client=` (padrão do painel), `?cliente=` ou
 * `/clientes/<id>`. Só devolve algo com cara de id (uuid).
 */
export function clienteDaRota(pathname: string, search: string): string | null {
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  try {
    const p = new URLSearchParams(search || "");
    const v = p.get("client") || p.get("cliente") || p.get("clientId") || "";
    if (uuid.test(v)) return v;
  } catch {
    /* busca malformada: segue para o caminho */
  }
  const m = /^\/clientes\/([^/?#]+)/.exec(pathname || "");
  if (m && uuid.test(m[1])) return m[1];
  return null;
}

export interface ServicoDoAgente {
  chave: string;
  rotulo: string;
  /** Tipo de projeto do agente quando o serviço vira projeto (create_project). */
  tipoDeProjeto?: string;
}

/**
 * Os serviços que o agente entende. Vêm de SERVICE_LABELS (o mesmo nome
 * que o cadastro usa em profiles.services_config), mais "Geral" e
 * "Contrato". Financeiro fica de fora de propósito: é jurisdição proibida
 * do agente (ele não mexe em cobrança, mensalidade nem pagamento).
 */
const TIPO_DO_SERVICO: Record<string, string> = {
  social: "social_media",
  trafego: "trafego",
  videos_ia: "video_ai",
  edicao_video: "video",
  site: "site",
  automacao: "automation",
};

export const SERVICOS_DO_AGENTE: ServicoDoAgente[] = [
  { chave: "geral", rotulo: "Geral" },
  ...Object.keys(SERVICE_LABELS).map((chave) => ({ chave, rotulo: SERVICE_LABELS[chave], tipoDeProjeto: TIPO_DO_SERVICO[chave] })),
  { chave: "contrato", rotulo: "Contrato" },
];

export function servicoPelaChave(chave: string | null | undefined): ServicoDoAgente {
  return SERVICOS_DO_AGENTE.find((s) => s.chave === chave) || SERVICOS_DO_AGENTE[0];
}

/**
 * Lista para escolher, com os serviços contratados pelo cliente primeiro
 * (marcados). "Geral" sempre no topo.
 */
export function servicosParaEscolha(servicesConfig: unknown): Array<ServicoDoAgente & { contratado: boolean }> {
  const cfg = servicesConfig && typeof servicesConfig === "object" ? (servicesConfig as Record<string, unknown>) : {};
  const todos = SERVICOS_DO_AGENTE.map((s) => ({ ...s, contratado: cfg[s.chave] === true }));
  const geral = todos.filter((s) => s.chave === "geral");
  const contratados = todos.filter((s) => s.chave !== "geral" && s.contratado);
  const resto = todos.filter((s) => s.chave !== "geral" && !s.contratado);
  return [...geral, ...contratados, ...resto];
}

/** O pré-contexto que vai para o servidor junto de cada pedido ao agente. */
export function preContextoDoAgente(o: {
  clienteId: string | null | undefined;
  clienteNome?: string | null;
  servico: string | null | undefined;
  tela: string;
}): { clientId: string | null; servico: string; servicoRotulo: string; clienteNome: string | null; tela: string } {
  const s = servicoPelaChave(o.servico);
  return {
    clientId: o.clienteId || null,
    servico: s.chave,
    servicoRotulo: s.rotulo,
    clienteNome: o.clienteNome || null,
    tela: (o.tela || "/").slice(0, 120),
  };
}

/** Atalhos de ação do agente (chips pequenos no topo). */
export type AtalhoDoAgente = "novo_contrato" | "projeto_do_contrato" | "resumo" | "proximos_passos";

export const ATALHOS_DO_AGENTE: { chave: AtalhoDoAgente; rotulo: string; precisaCliente: boolean }[] = [
  { chave: "novo_contrato", rotulo: "Novo contrato", precisaCliente: false },
  { chave: "projeto_do_contrato", rotulo: "Projeto do contrato", precisaCliente: true },
  { chave: "resumo", rotulo: "Resumo do cliente", precisaCliente: true },
  { chave: "proximos_passos", rotulo: "Próximos passos", precisaCliente: true },
];

/** Comando escrito que o atalho "Projeto do contrato" coloca no campo. */
export function comandoDoProjetoDoContrato(clienteNome: string, servico: ServicoDoAgente): string {
  const tipo = servico.chave === "geral" || servico.chave === "contrato" ? "" : ` de ${servico.rotulo.toLowerCase()}`;
  return `Criar projeto${tipo} para ${clienteNome} a partir do contrato`;
}

/** Endereço do atalho "Novo contrato" (abre o envio de contrato já com o cliente). */
export function enderecoDoNovoContrato(clienteId: string | null | undefined): string {
  return clienteId ? `/contratos?novo=1&client=${encodeURIComponent(clienteId)}` : "/contratos?novo=1";
}

/** Evento que qualquer tela pode disparar para abrir o agente já com contexto. */
export const EVENTO_ABRIR_AGENTE = "aceleriq:abrir-agente";

export interface PedidoParaAbrirAgente {
  clientId?: string | null;
  servico?: string | null;
  texto?: string | null;
}
