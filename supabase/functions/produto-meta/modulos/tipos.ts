/**
 * Tipos compartilhados da função produto-meta (14/11/2026): o index (webhook da Meta e simulador)
 * e o módulo do WhatsApp (modulos/whatsapp.ts) importam daqui.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

/**
 * A conexão de uma empresa, como crm_integracao_por_chave devolve. Carrega os segredos (app_secret,
 * token, wa_token): nunca vai para registro, erro ou resposta.
 */
export interface Integracao {
  conta_id: string;
  /** A chave geral. Desligada, o webhook responde 200 e não faz nada. */
  ativo: boolean;
  /** teste: nada sai para a Graph API, para a API de Conversões nem para o WhatsApp. */
  modo: "teste" | "real";
  verify_token: string;
  /** O CRM da empresa está ativo e a assinatura em dia. */
  liberada: boolean;
  empresa: string;
  nicho: string | null;
  pagina_id: string | null;
  /** Vazio = todos os formulários da Página. */
  formularios: string[];
  app_secret: string | null;
  token: string | null;
  wa_phone_id: string | null;
  wa_waba_id: string | null;
  wa_numero: string | null;
  /** O token do WhatsApp; quando a empresa não salvou um próprio, é o mesmo token da Meta. */
  wa_token: string | null;
  /** Nomes dos templates aprovados: { lead, vendedor, followup, nutricao }. */
  templates: Record<string, string>;
  idioma: string;
  /** As regras da pontuação como a empresa salvou (ler com lerRegras de _shared/pontuacao-do-crm.ts). */
  pontuacao: Record<string, unknown>;
  followup_horas: number[];
}

export interface Contexto {
  /** Cliente com a chave de serviço. */
  servico: SupabaseClient;
  integracao: Integracao;
  agora: Date;
}

/** O que o index entrega a aoCriarLead depois de crm_meta_lead_criar. */
export interface LeadCriado {
  lead_id: string;
  nome: string;
  whatsapp: string | null;
  faixa: "quente" | "morno" | "frio";
  nota: number;
  motivos: string[];
  respostas: Record<string, unknown>;
  /** A pessoa já tinha negócio aberto: nada novo foi criado, só uma nota no que existia. */
  repetido: boolean;
  na_fila: boolean;
  nutricao: boolean;
  vendedor: { user_id: string; nome: string; whatsapp: string | null } | null;
  origem: { campanha?: string; formulario?: string };
}

const textoOuNulo = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

/** Lê o retorno de crm_integracao_por_chave sem confiar no formato. Nulo quando a chave não é de ninguém. */
export function lerIntegracao(bruto: unknown): Integracao | null {
  const o = (bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {}) as Record<string, unknown>;
  if (typeof o.conta_id !== "string" || !o.conta_id) return null;
  const objeto = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const templates: Record<string, string> = {};
  Object.keys(objeto(o.templates)).forEach((k) => {
    const v = objeto(o.templates)[k];
    if (typeof v === "string" && v) templates[k] = v;
  });
  return {
    conta_id: o.conta_id,
    ativo: o.ativo === true,
    modo: o.modo === "real" ? "real" : "teste",
    verify_token: typeof o.verify_token === "string" ? o.verify_token : "",
    liberada: o.liberada === true,
    empresa: typeof o.empresa === "string" ? o.empresa : "",
    nicho: textoOuNulo(o.nicho),
    pagina_id: textoOuNulo(o.pagina_id),
    formularios: Array.isArray(o.formularios) ? (o.formularios as unknown[]).filter((f): f is string => typeof f === "string" && f !== "") : [],
    app_secret: textoOuNulo(o.app_secret),
    token: textoOuNulo(o.token),
    wa_phone_id: textoOuNulo(o.wa_phone_id),
    wa_waba_id: textoOuNulo(o.wa_waba_id),
    wa_numero: textoOuNulo(o.wa_numero),
    wa_token: textoOuNulo(o.wa_token),
    templates,
    idioma: typeof o.idioma === "string" && o.idioma ? o.idioma : "pt_BR",
    pontuacao: objeto(o.pontuacao),
    followup_horas: Array.isArray(o.followup_horas) ? (o.followup_horas as unknown[]).map(Number).filter((n) => isFinite(n) && n > 0) : [],
  };
}
