import { chamarFuncao, enviarParaAprovacao, textoDoErro } from "./api";
import { repetirEntregaEmPartes } from "./entregaEmPartes";

/**
 * Entregar com três opções (frente EN, 28/09). Pedido do dono: "No Estúdio,
 * na hora de entregar, quero três opções":
 *
 * - pronto: "Disponibilizar ao cliente, pronto para agendar". O cliente já deu
 *   o aval ao admin: a entrega vai para Arquivos, o admin aprova em nome dele
 *   (aprovar_pelo_cliente) e a peça já entra na Agenda aprovada, na data do
 *   conteúdo e no perfil da marca. Sem data que sirva, a tela pergunta
 *   (a mesma janela do "Agendar"). Só admin e gestor.
 * - aprovacao: "Enviar para aprovação", o fluxo normal (design pede a revisão
 *   da agência; admin e gestor liberam ao cliente).
 * - arquivos: "Só Arquivos". Fica em Arquivos, sem pedir aprovação e sem post
 *   na Agenda. Com "mostrar ao cliente", fica disponível para ele ver
 *   (client_shared, só admin e gestor).
 *
 * As três valem para uma peça ou várias marcadas na faixa (entregarVarias).
 */

export type ModoDeEntrega = "pronto" | "aprovacao" | "arquivos";

export interface OpcaoDeEntrega {
  modo: ModoDeEntrega;
  rotulo: string;
  /** Rótulo curto (botão principal e lote). */
  curto: string;
  dica: string;
}

export const OPCOES_DE_ENTREGA: Record<ModoDeEntrega, OpcaoDeEntrega> = {
  pronto: {
    modo: "pronto",
    rotulo: "Disponibilizar pronto para agendar",
    curto: "Pronto para agendar",
    dica: "O cliente já deu o aval: aprova em nome dele e já agenda na data do conteúdo.",
  },
  aprovacao: {
    modo: "aprovacao",
    rotulo: "Entregar e enviar para aprovação",
    curto: "Enviar para aprovação",
    dica: "O fluxo normal: o cliente aprova no portal.",
  },
  arquivos: {
    modo: "arquivos",
    rotulo: "Só entregar em Arquivos",
    curto: "Só Arquivos",
    dica: "Fica em Arquivos, sem aprovação e sem post na Agenda.",
  },
};

/** Opções que quem está na tela pode usar (design não aprova pelo cliente). */
export function opcoesDaEntrega(podeLiberar: boolean): OpcaoDeEntrega[] {
  const ordem: ModoDeEntrega[] = podeLiberar ? ["pronto", "aprovacao", "arquivos"] : ["aprovacao", "arquivos"];
  return ordem.map((m) => OPCOES_DE_ENTREGA[m]);
}

/** Rótulo do "Enviar para aprovação" para quem é design (pede a revisão da agência). */
export function rotuloDaOpcao(o: OpcaoDeEntrega, ehDesign: boolean): string {
  if (o.modo === "aprovacao" && ehDesign) return "Entregar e pedir revisão";
  return o.rotulo;
}

/** Resposta de entrega_concluir (estudio-arte). */
export interface RespostaDaConclusao {
  trabalho_id: string;
  modo: "pronto" | "arquivos";
  aprovacao?: { estado?: string; aprovado_por?: string } | null;
  agendado?: { quando: string | null; status: string } | null;
  precisa_data?: boolean;
  motivo?: string | null;
  publicar_em?: string | null;
  mostrado_ao_cliente?: boolean;
}

export interface ResultadoDaEntrega {
  trabalhoId: string;
  modo: ModoDeEntrega;
  ok: boolean;
  erro?: string;
  /** pronto: agendado nesta data (ISO). */
  agendadoPara?: string | null;
  /** pronto: aprovado, mas falta a data (a tela pergunta). */
  precisaData?: boolean;
  motivo?: string | null;
  publicarEm?: string | null;
  /** arquivos: ficou visível ao cliente. */
  mostradoAoCliente?: boolean;
  /** aprovacao: estado do envio (aguardando_cliente, aguardando_agencia…). */
  estado?: string;
}

/** Corpo da ação entregar: "Só Arquivos" não leva a peça para a Agenda. */
export function corpoDoEntregar(trabalhoId: string, modo: ModoDeEntrega): Record<string, unknown> {
  const corpo: Record<string, unknown> = { acao: "entregar", trabalho_id: trabalhoId };
  if (modo === "arquivos") corpo.sem_agenda = true;
  return corpo;
}

/** Corpo da ação entrega_concluir (pronto e arquivos). */
export function corpoDaConclusao(trabalhoId: string, modo: "pronto" | "arquivos", mostrarAoCliente: boolean): Record<string, unknown> {
  const corpo: Record<string, unknown> = { acao: "entrega_concluir", trabalho_id: trabalhoId, modo };
  if (modo === "arquivos" && mostrarAoCliente) corpo.mostrar_ao_cliente = true;
  return corpo;
}

type Chamar = <T = unknown>(corpo: Record<string, unknown>) => Promise<T>;
type Enviar = (ids: string[]) => Promise<{ trabalho_id: string; ok: boolean; estado?: string; erro?: string }[]>;

const chamarEstudio: Chamar = (corpo) => chamarFuncao("estudio-arte", corpo);

/**
 * Entrega uma peça no modo escolhido. A entrega em Arquivos é idempotente
 * (entregar de novo o que já está lá só confere a Agenda) e continua em partes
 * sozinha. Não lança: devolve ok=false com o motivo, para o lote seguir.
 */
export async function entregarComModo(
  trabalhoId: string,
  modo: ModoDeEntrega,
  opcoes: { mostrarAoCliente?: boolean } = {},
  deps: { chamar?: Chamar; enviar?: Enviar } = {},
): Promise<ResultadoDaEntrega> {
  const chamar = deps.chamar || chamarEstudio;
  const enviar = deps.enviar || enviarParaAprovacao;
  try {
    await repetirEntregaEmPartes(() => chamar(corpoDoEntregar(trabalhoId, modo)));
  } catch (e) {
    return { trabalhoId, modo, ok: false, erro: textoDoErro(e, "Não foi possível entregar.") };
  }
  try {
    if (modo === "aprovacao") {
      const r = (await enviar([trabalhoId]))[0];
      if (!r || !r.ok) return { trabalhoId, modo, ok: false, erro: `Entregue em Arquivos, mas o envio para aprovação falhou: ${(r && r.erro) || "sem resposta"}` };
      return { trabalhoId, modo, ok: true, estado: r.estado };
    }
    const r = await chamar<RespostaDaConclusao>(corpoDaConclusao(trabalhoId, modo, !!opcoes.mostrarAoCliente));
    return {
      trabalhoId,
      modo,
      ok: true,
      agendadoPara: r && r.agendado ? r.agendado.quando : null,
      precisaData: !!(r && r.precisa_data),
      motivo: (r && r.motivo) || null,
      publicarEm: (r && r.publicar_em) || null,
      mostradoAoCliente: !!(r && r.mostrado_ao_cliente),
    };
  } catch (e) {
    const oQue = modo === "pronto" ? "a aprovação pelo cliente falhou" : "mostrar ao cliente falhou";
    return { trabalhoId, modo, ok: false, erro: `Entregue em Arquivos, mas ${oQue}: ${textoDoErro(e)}` };
  }
}

/** Várias peças, uma de cada vez (a entrega abre lâminas e tem limite de CPU por chamada). */
export async function entregarVarias(
  trabalhoIds: string[],
  modo: ModoDeEntrega,
  opcoes: { mostrarAoCliente?: boolean } = {},
  deps: { chamar?: Chamar; enviar?: Enviar } = {},
  aoAvancar?: (feitas: number, total: number) => void,
): Promise<ResultadoDaEntrega[]> {
  const saida: ResultadoDaEntrega[] = [];
  for (let i = 0; i < trabalhoIds.length; i++) {
    saida.push(await entregarComModo(trabalhoIds[i], modo, opcoes, deps));
    if (aoAvancar) aoAvancar(i + 1, trabalhoIds.length);
  }
  return saida;
}

/** Uma frase para o resumo do lote. */
export function resumoDoLote(r: ResultadoDaEntrega[]): { titulo: string; detalhe: string | null; tudoCerto: boolean } {
  const ok = r.filter((x) => x.ok);
  const falhas = r.filter((x) => !x.ok);
  const agendadas = ok.filter((x) => !!x.agendadoPara).length;
  const semData = ok.filter((x) => x.precisaData).length;
  const partes: string[] = [];
  if (agendadas) partes.push(`${agendadas} agendada${agendadas === 1 ? "" : "s"}`);
  if (semData) partes.push(`${semData} aprovada${semData === 1 ? "" : "s"} sem data (ficam em "sem data")`);
  if (falhas.length) partes.push(`${falhas.length} não ${falhas.length === 1 ? "foi" : "foram"}: ${falhas.map((f) => f.erro).filter((m, i, l) => !!m && l.indexOf(m) === i).join(" ").slice(0, 300)}`);
  return {
    titulo: ok.length === r.length ? `${ok.length} ${ok.length === 1 ? "peça entregue" : "peças entregues"}` : `${ok.length} de ${r.length} entregues`,
    detalhe: partes.length ? partes.join(" · ") : null,
    tudoCerto: falhas.length === 0,
  };
}

/** A peça do trabalho está pronta para entregar (todas as lâminas com arte, não é anúncio). */
export function prontaParaEntregar(t: {
  tipo?: string | null;
  status?: string | null;
  direcao?: { cards?: { ordem: number }[] } | null;
  cards?: { ordem: number }[] | null;
  file_ids?: string[] | null;
} | null | undefined): boolean {
  if (!t || t.tipo === "ads") return false;
  if (t.status === "entregue" && (t.file_ids || []).length) return true;
  const ordens = ((t.direcao && t.direcao.cards) || []).map((c) => c.ordem);
  if (!ordens.length) return false;
  const comArte = new Set(((t.cards || []) as { ordem: number }[]).map((c) => c.ordem));
  return ordens.every((o) => comArte.has(o));
}
