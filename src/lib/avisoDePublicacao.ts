/*
 * Aviso de post no ar na Revisão do Ciclo (14/10/2026): o tipo da linha de aviso_publicacao, a fase de cada
 * aviso na tela e a tradução dos erros do banco. A tela fica em components/central/AvisosDePublicacao.tsx.
 */

export interface AvisoDePublicacao {
  id: string; client_id: string; publication_id: string; mensagem: string;
  destino: { channel: "portal" | "whatsapp"; recipient: string };
  payload: { publication?: { title?: string; platform?: string | null; permalink?: string | null; published_at?: string | null } };
  payload_hash: string; status: "pendente" | "aprovado" | "rejeitado" | "expirado";
  preparado_via: string; valid_until: string; decided_at: string | null; decision_note: string | null;
  executed_at: string | null; execution_evidence: string | null; created_at: string;
  client?: { company_name: string | null; full_name: string | null } | null;
  /** Arquivo do post (para a imagem na mesa de decisão). */
  publicacao?: { arquivo?: { file_url: string | null; storage_bucket: string | null; storage_path: string | null; mime_type: string | null } | null } | null;
}

export const quando = (iso?: string | null) => { const d = iso ? new Date(iso) : null; return d && Number.isFinite(d.getTime()) ? d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "sem data"; };
export const vencido = (a: AvisoDePublicacao, agora = Date.now()) => a.status === "pendente" && Date.parse(a.valid_until) <= agora;
const SETE_DIAS = 7 * 86_400_000;

/** Fase do aviso na tela: decidir, enviar ou histórico. */
export function faseDoAviso(a: AvisoDePublicacao, agora = Date.now()): "decidir" | "enviar" | "historico" | "oculto" {
  if (a.status === "pendente" && !vencido(a, agora)) return "decidir";
  if (a.status === "aprovado" && !a.executed_at) return "enviar";
  const ultimo = Date.parse(a.executed_at || a.decided_at || a.valid_until || a.created_at);
  return agora - ultimo <= SETE_DIAS ? "historico" : "oculto";
}

export function erroDoAviso(error: unknown): string {
  const m = error instanceof Error ? error.message : "Não foi possível confirmar a operação.";
  if (/AVISO_(VERSAO_MUDOU|JA_DECIDIDO|VENCIDO)/.test(m)) return "Este aviso mudou, já foi decidido ou venceu. Atualize a revisão.";
  if (m.includes("AVISO_COMENTARIO_OBRIGATORIO")) return "Escreva o motivo para rejeitar.";
  if (m.includes("AVISO_EVIDENCIA_OBRIGATORIA")) return "Diga onde e quando enviou para registrar o envio.";
  if (m.includes("AVISO_JA_ENVIADO")) return "O envio deste aviso já foi registrado.";
  if (m.includes("AVISO_NAO_APROVADO")) return "Só aviso aprovado pode ser marcado como enviado.";
  if (m.includes("CENTRAL_ADMIN_REQUIRED")) return "Só administrador decide avisos.";
  return m;
}
