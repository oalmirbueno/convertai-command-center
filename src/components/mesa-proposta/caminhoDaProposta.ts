import { blocoDoTipo } from "../../../supabase/functions/_shared/proposta-modelo";
import type { Proposta } from "./propostaApi";

/**
 * O caminho da Mesa Proposta (frente PRS, 30/09), pedido do dono: "a parte de
 * proposta está bem completa e confusa". Um caminho curto e óbvio, nas
 * palavras dele: cliente, conversa ou briefing, rascunho gerado com IA,
 * revisar, enviar e acompanhar.
 *
 * - Conversa: o que o cliente disse (notas, transcrição, arquivos) e o que
 *   vai oferecer (itens e validade). Termina em "Gerar o rascunho com IA".
 * - Rascunho: os blocos ao lado da prévia do cliente. Gerar de novo mostra a
 *   prévia antes de gravar.
 * - Revisar: o que falta (com Resolver) e a conferência (números sem origem,
 *   fontes do mercado, revisão da IA). Histórico recolhido.
 * - Enviar: gerar o link e mandar pelo WhatsApp ou por e-mail.
 * - Acompanhar: aberturas, follow-up, aceite e o contrato.
 *
 * Os valores do endereço continuam os de antes (contexto, rascunho, revisao,
 * envio): link salvo, "onde parou" e a pré-carga seguem valendo. A quinta
 * etapa é nova (acompanhar).
 */
export const ETAPAS_DA_PROPOSTA = [
  { valor: "contexto", rotulo: "Conversa" },
  { valor: "rascunho", rotulo: "Rascunho" },
  { valor: "revisao", rotulo: "Revisar" },
  { valor: "envio", rotulo: "Enviar" },
  { valor: "acompanhar", rotulo: "Acompanhar" },
] as const;

export type EtapaDaProposta = (typeof ETAPAS_DA_PROPOSTA)[number]["valor"];

export const ehEtapaDaProposta = (v: unknown): v is EtapaDaProposta => typeof v === "string" && ETAPAS_DA_PROPOSTA.some((e) => e.valor === v);

/** A etapa seguinte do caminho (null na última). */
export function proximaEtapa(etapa: EtapaDaProposta): EtapaDaProposta | null {
  const i = ETAPAS_DA_PROPOSTA.findIndex((e) => e.valor === etapa);
  return i >= 0 && i < ETAPAS_DA_PROPOSTA.length - 1 ? ETAPAS_DA_PROPOSTA[i + 1].valor : null;
}

export const rotuloDaEtapa = (etapa: EtapaDaProposta): string => (ETAPAS_DA_PROPOSTA.find((e) => e.valor === etapa) || ETAPAS_DA_PROPOSTA[0]).rotulo;

type ParaOCaminho = Pick<Proposta, "status" | "contexto" | "conteudo" | "pendencias" | "itens">;

/** A conversa tem material (notas, transcrição ou arquivo). */
export const temConversa = (p: ParaOCaminho): boolean => {
  const c = p.contexto || {};
  return !!((c.notas || "").trim() || (c.transcricao || "").trim() || (c.materiais || []).length);
};

/** O rascunho já foi escrito (a capa tem headline). */
export const temRascunho = (p: ParaOCaminho): boolean => !!blocoDoTipo(p.conteudo, "capa").dados.headline;

/**
 * O que já está feito em cada etapa (o check pequeno nas Etapas da casca).
 * Nada aqui trava a navegação: a pessoa anda para qualquer etapa.
 */
export function etapasFeitas(p: ParaOCaminho | null): Record<EtapaDaProposta, boolean> {
  const enviada = !!p && p.status !== "rascunho";
  return {
    contexto: !!p && temConversa(p) && p.itens.length > 0,
    rascunho: !!p && temRascunho(p),
    revisao: enviada || (!!p && temRascunho(p) && !p.pendencias.some((x) => x.bloqueia)),
    envio: enviada,
    acompanhar: !!p && p.status === "aceita",
  };
}

/**
 * Onde a proposta abre pelo status. Sem etapa atual (link da carteira):
 * rascunho na Conversa; enviada, vista, aceita, recusada ou vencida no
 * Acompanhar. Com a etapa atual (trocar de proposta dentro da Mesa):
 * - a enviada sai da Conversa, do Rascunho e do Revisar (formulário de
 *   rascunho editável) e vai ao Acompanhar; no Enviar e no Acompanhar fica;
 * - o rascunho fica onde a pessoa está, menos no Acompanhar (nada a
 *   acompanhar ainda), que volta à Conversa.
 */
export function etapaPeloStatus(status: string, atual?: EtapaDaProposta | null): EtapaDaProposta {
  if (status !== "rascunho") return atual === "envio" || atual === "acompanhar" ? atual : "acompanhar";
  return !atual || atual === "acompanhar" ? "contexto" : atual;
}
