import { chamarFuncao } from "@/lib/mesa/api";
import type { DefinicaoDoModelo, ModeloDeDocumento, RascunhoDoDocumento } from "../../../supabase/functions/_shared/documento-modelos";

/**
 * Gancho do Registro da entrega (Frente DOC, 29/09/2026) para qualquer mesa
 * chamar ao concluir uma entrega grande (um mês de pautas, um projeto, um
 * período). Registrar não custa nada nem manda nada ao cliente: só guarda o
 * pedido do documento, com o resumo e as provas que a mesa já tem. Gerar o
 * PDF usa IA, então passa antes pelo Confirmar com o custo (BotaoDocumentoDaEntrega).
 *
 * Função: supabase/functions/documentos. Modelo: _shared/registro-de-entrega.ts.
 */

export type TipoDeEntrega = "mes_de_pautas" | "projeto" | "periodo";

export type PedidoDoDocumento = {
  clientId: string;
  marcaId?: string | null;
  tipo: TipoDeEntrega;
  /** Mês "2026-09", id do projeto ou período "2026-09-01..2026-09-30". */
  referencia: string;
  titulo?: string | null;
  /** Resumo curto da mesa (a equipe confere; não vai ao cliente sem passar pela conferência). */
  resumo?: string | null;
  /** Frente BRF2: gerar com o rascunho da equipe (texto, provas escolhidas, números com fonte). */
  usarRascunho?: boolean;
  documentoId?: string | null;
  /** Ids de arquivos (files) do cliente que provam a entrega. */
  provas?: string[];
};

export type ArquivoDoDocumento = {
  id: string;
  file_name: string;
  file_url: string;
  storage_bucket: string | null;
  storage_path: string | null;
  mime_type: string | null;
  extension: string | null;
  visibility: string | null;
  approval_status: string | null;
  agency_approval_status: string | null;
  archived_at: string | null;
};

export type DocumentoDaEntrega = {
  id: string;
  client_id: string;
  marca_id: string | null;
  tipo: TipoDeEntrega;
  referencia: string;
  titulo: string | null;
  numero: number | null;
  versao: number;
  status: "pendente" | "gerado" | "em_aprovacao" | "no_portal";
  file_id: string | null;
  avisos: string[];
  custo_usd: number;
  gerado_em?: string | null;
  liberado_em?: string | null;
  criado_em: string;
  resumo?: string | null;
  codigo?: string | null;
  arquivo?: ArquivoDoDocumento | null;
  // Frente BRF2
  modelo?: string | null;
  tem_rascunho?: boolean;
  rascunho_em?: string | null;
  origem_rascunho?: "equipe" | "agenda" | null;
  mensagem_envio?: string | null;
};

export type ResultadoDaGeracao = {
  documento: DocumentoDaEntrega;
  file_id: string;
  avisos: string[];
  eventos: number;
  provas: number;
  provas_com_imagem: number;
  custo_usd: number;
  saldo_usd: number | null;
};

const corpoDoPedido = (p: PedidoDoDocumento) => {
  const corpo: Record<string, unknown> = { client_id: p.clientId, tipo: p.tipo, referencia: p.referencia };
  if (p.marcaId !== undefined) corpo.marca_id = p.marcaId;
  if (p.titulo) corpo.titulo = p.titulo;
  if (p.resumo) corpo.resumo = p.resumo;
  if (p.provas && p.provas.length) corpo.provas = p.provas.slice(0, 24);
  if (p.usarRascunho) corpo.usar_rascunho = true;
  if (p.documentoId) corpo.documento_id = p.documentoId;
  return corpo;
};

/** Mês da Mesa ("2026-09-01") na referência do documento ("2026-09"). */
export const referenciaDoMes = (mes: string) => String(mes || "").slice(0, 7);

/** O gancho: registra a entrega concluída (sem custo, sem enviar nada). */
export async function registrarEntrega(p: PedidoDoDocumento): Promise<DocumentoDaEntrega> {
  const r = await chamarFuncao<{ documento: DocumentoDaEntrega }>("documentos", { acao: "registrar_entrega", ...corpoDoPedido(p) });
  return r.documento;
}

/**
 * Registra sem atrapalhar quem chamou: a entrega da mesa já deu certo, o
 * documento é um passo a mais. Falha vai para o console com o motivo e volta
 * como texto para a tela mostrar (nada é engolido em silêncio).
 */
export async function registrarEntregaSemTravar(p: PedidoDoDocumento): Promise<{ documento: DocumentoDaEntrega | null; erro: string | null }> {
  try {
    return { documento: await registrarEntrega(p), erro: null };
  } catch (e) {
    const erro = e instanceof Error ? e.message : String(e);
    console.error("[documentos] registrar a entrega falhou", { tipo: p.tipo, referencia: p.referencia, erro });
    return { documento: null, erro };
  }
}

export async function estimarDocumento(clientId: string, opcoes: { documentoId?: string | null; usarRascunho?: boolean } = {}): Promise<{ estimativa_usd: number; modelo_id: string; texto_da_equipe?: boolean }> {
  return await chamarFuncao("documentos", { acao: "estimar", client_id: clientId, ...(opcoes.usarRascunho && opcoes.documentoId ? { usar_rascunho: true, documento_id: opcoes.documentoId } : {}) });
}

/** Gera o PDF (custa IA): só depois do Confirmar com o custo na tela. */
export async function gerarDocumento(p: PedidoDoDocumento): Promise<ResultadoDaGeracao> {
  return await chamarFuncao<ResultadoDaGeracao>("documentos", { acao: "gerar_registro", confirmado: true, ...corpoDoPedido(p) });
}

export async function listarDocumentos(clientId: string): Promise<DocumentoDaEntrega[]> {
  const r = await chamarFuncao<{ documentos: DocumentoDaEntrega[] }>("documentos", { acao: "listar", client_id: clientId });
  return r.documentos || [];
}

/** Manda ao cliente pelo fluxo de aprovação que já existe. Só depois do Confirmar. */
export async function liberarDocumento(documentoId: string, modo: "approval" | "client_shared", mensagem?: string | null): Promise<DocumentoDaEntrega> {
  const r = await chamarFuncao<{ documento: DocumentoDaEntrega }>("documentos", { acao: "liberar", documento_id: documentoId, modo, confirmado: true, ...(mensagem ? { mensagem } : {}) });
  return r.documento;
}

export async function arquivarDocumento(documentoId: string, arquivar = true): Promise<DocumentoDaEntrega> {
  const r = await chamarFuncao<{ documento: DocumentoDaEntrega }>("documentos", { acao: "arquivar", documento_id: documentoId, arquivar });
  return r.documento;
}

export const ROTULO_DO_STATUS_DO_DOCUMENTO: Record<DocumentoDaEntrega["status"], string> = {
  pendente: "Aguardando gerar",
  gerado: "Gerado, só a equipe vê",
  em_aprovacao: "Enviado para aprovação",
  no_portal: "No portal do cliente",
};

export const ROTULO_DO_TIPO_DE_ENTREGA: Record<TipoDeEntrega, string> = {
  mes_de_pautas: "Mês de pautas",
  projeto: "Projeto",
  periodo: "Período",
};

/** Pedido de volta a partir de um documento da lista (gerar de novo). */
export const pedidoDoDocumento = (d: DocumentoDaEntrega): PedidoDoDocumento => ({ clientId: d.client_id, marcaId: d.marca_id, tipo: d.tipo, referencia: d.referencia, titulo: d.titulo });

// ------------------------------------------------------------------ portal do cliente

/**
 * O arquivo é um Registro da entrega? Pela etiqueta que a função documentos
 * grava (equipe) ou, no portal (a leitura do cliente não traz as etiquetas),
 * pela pasta Entregas com o nome que a função dá ao PDF.
 */
export function ehRegistroDeEntrega(f: { tags?: string[] | null; folder?: string | null; file_name?: string | null } | null | undefined): boolean {
  if (!f) return false;
  if (Array.isArray(f.tags) && f.tags.indexOf("documento_entrega") >= 0) return true;
  return f.folder === "entregas" && /^registro-da-entrega-.*\.pdf$/.test(String(f.file_name || ""));
}

/** Título do registro para o cliente: vem da descrição gravada ("<título>. Registro da entrega nº N, ..."). */
export function tituloDoRegistro(f: { description?: string | null; file_name?: string | null }): string {
  const m = /^(.+?)\. Registro da entrega nº (\d+)/.exec(String(f.description || ""));
  return m ? `${m[1]} (nº ${m[2].padStart(4, "0")})` : String(f.file_name || "Registro da entrega");
}

// ------------------------------------------------------------------ frente BRF2: rascunho e agenda

export type EventoNaTela = { id: string; grupo: string; quando: string; titulo: string; detalhe: string | null; link: string | null };
export type CandidatoNaTela = { id: string; titulo: string; legenda: string; quando: string; forte: boolean; imagem: { bucket: string; caminho: string } | null };
export type NumeroNaTela = { rotulo: string; valor: number; fonte: string; formato?: "inteiro" | "percentual" };

export type VistaDoRascunho = {
  documento: DocumentoDaEntrega;
  rascunho: RascunhoDoDocumento;
  eventos: EventoNaTela[];
  candidatos: CandidatoNaTela[];
  numeros: NumeroNaTela[];
  avisos: string[];
  modelos: Record<ModeloDeDocumento, DefinicaoDoModelo>;
};

/** O rascunho do documento (sem IA): o salvo, ou o primeiro montado só com o que aconteceu. */
export async function lerRascunho(alvo: { documentoId: string; modelo?: ModeloDeDocumento } | (PedidoDoDocumento & { modelo?: ModeloDeDocumento })): Promise<VistaDoRascunho> {
  const corpo: Record<string, unknown> = "documentoId" in alvo && !("clientId" in alvo) ? { documento_id: alvo.documentoId } : corpoDoPedido(alvo as PedidoDoDocumento);
  if (alvo.modelo) corpo.modelo = alvo.modelo;
  return await chamarFuncao<VistaDoRascunho>("documentos", { acao: "rascunho", ...corpo });
}

export async function salvarRascunho(documentoId: string, rascunho: RascunhoDoDocumento): Promise<{ documento: DocumentoDaEntrega; rascunho: RascunhoDoDocumento }> {
  return await chamarFuncao("documentos", { acao: "salvar_rascunho", documento_id: documentoId, rascunho });
}

export type AgendaDeDocumentos = { id: string; client_id: string; marca_id: string | null; ligada: boolean; dia: number; modelo: ModeloDeDocumento; ultimo_mes: string | null; ultima_execucao_em: string | null; ultimo_erro: string | null };

export async function lerAgendas(clientId: string): Promise<AgendaDeDocumentos[]> {
  const r = await chamarFuncao<{ agendas: AgendaDeDocumentos[] }>("documentos", { acao: "agenda_ler", client_id: clientId });
  return r.agendas || [];
}

export async function salvarAgenda(p: { clientId: string; marcaId?: string | null; ligada: boolean; dia: number; modelo: ModeloDeDocumento }): Promise<AgendaDeDocumentos> {
  const r = await chamarFuncao<{ agenda: AgendaDeDocumentos }>("documentos", { acao: "agenda_salvar", client_id: p.clientId, marca_id: p.marcaId || null, ligada: p.ligada, dia: p.dia, modelo: p.modelo });
  return r.agenda;
}
