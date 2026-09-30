import { supabase } from "@/integrations/supabase/client";
import { chamarFuncao } from "@/lib/mesa/api";
import { mensagemDaFuncao } from "@/lib/fileUrls";
import type { FichaFiscal } from "../../../supabase/functions/contratos/modulos/contrato-ficha";
import type {
  ClausulaDoModelo,
  ClausulaMontada,
  FaltaNoContrato,
  LinhaDoDiff,
  Valores,
  VariavelDoModelo,
} from "../../../supabase/functions/_shared/contrato-modelo";

/**
 * Chamadas da tela de contratos à função `contratos` (frente CON, 30/09).
 * Tudo passa pela função: o banco não deixa a tela escrever contrato de
 * modelo direto (contracts_modelo_guard).
 */

export type EventoDoContrato = { id: string; tipo: string; resumo: string; detalhe: Record<string, unknown>; ip: string | null; criado_em: string };
export type VersaoDoContrato = { id: string; versao: number; status: string; congelado_em: string | null; documento_hash: string | null; created_at: string };

export type ContratoNaTela = {
  id: string;
  client_id: string;
  title: string;
  status: string;
  origem: string;
  numero: string | null;
  versao: number;
  versao_de: string | null;
  substituido_por: string | null;
  servicos: string[];
  documento_hash: string | null;
  congelado_em: string | null;
  admin_signature_name: string | null;
  admin_signed_at: string | null;
  client_signature_name: string | null;
  client_signed_at: string | null;
  sent_at: string | null;
  sign_token: string;
  sign_url: string | null;
  arquivado_em: string | null;
  updated_at: string;
  clausulas_alteradas: Array<{ chave: string; texto: string; texto_original: string; confirmada_em?: string | null }>;
  /** Frente CON2 (sem a migration, vêm vazios). */
  tipo_documento?: "contrato" | "aditivo" | "renovacao";
  contrato_mae_id?: string | null;
  renovacao_de?: string | null;
  vigencia_fim?: string | null;
  lembrete_em?: string | null;
};

export type SignatarioNaTela = {
  id: string;
  papel: "contratante" | "testemunha";
  principal: boolean;
  ordem: number;
  nome: string;
  email: string;
  documento: string | null;
  obrigatorio: boolean;
  assinado_em: string | null;
  link: string | null;
};

export type DocumentoLigado = { id: string; title: string; numero: string | null; versao: number; status: string; tipo_documento?: string };

export type PayloadDoContrato = {
  contrato: ContratoNaTela;
  texto: string | null;
  montado: { faltando: FaltaNoContrato[]; clausulas: ClausulaMontada[] } | null;
  pode_congelar: { pode: boolean; motivo: string | null };
  variaveis: VariavelDoModelo[];
  valores: Valores;
  agencia: { completa: boolean; faltando: string[]; aviso: string | null };
  revisao_juridica: string;
  eventos: EventoDoContrato[];
  versoes: VersaoDoContrato[];
  sign_url?: string;
  mensagens?: { whatsapp: string; assunto: string; email: string; wa_me: string };
  anterior?: { chave: string; texto: string } | null;
  // Frente CON2
  signatarios?: SignatarioNaTela[];
  ligados?: { aditivos: DocumentoLigado[]; renovacao: DocumentoLigado | null; mae: DocumentoLigado | null; renova: DocumentoLigado | null };
  vigencia?: { inicio: string | null; fim: string | null; recorrente: boolean } | null;
  ficha?: { existe: boolean; valores: Valores; ficha: FichaFiscal } | null;
  extras_fora?: string[];
  mensagens_por_pessoa?: Array<{ id: string; nome: string; papel: string; link: string; mensagens: { whatsapp: string; assunto: string; email: string; wa_me: string } }>;
  origem?: string[];
  avisos?: string[];
  pergunta?: string | null;
  ja_existia?: boolean;
};

export type Mensagens = { whatsapp: string; assunto: string; email: string; wa_me: string };

export type RespostaDoPainel = {
  painel: {
    aVencer: Array<{ id: string; client_id: string; titulo: string; numero: string | null; fim: string; dias: number; renovacao_id: string | null }>;
    pendentes: Array<{ id: string; client_id: string; titulo: string; numero: string | null; dias: number; lembrete_em: string | null }>;
    assinadosNoMes: number;
    recorrenteMensal: number;
    ativos: number;
  };
  janela_dias: number;
  lembrete_dias: number;
};

export type RespostaDoLembrete = {
  dias: number;
  ultimo_lembrete: string | null;
  lembretes: Array<{ id: string | null; nome: string; papel: string; email: string; link: string; mensagens: Mensagens }>;
};

export type RespostaDaFicha = { ficha: FichaFiscal; existe?: boolean; faltas?: string[]; valores?: Valores; sugestao?: FichaFiscal | null; anterior?: FichaFiscal | null; avisos?: string[]; cache?: boolean; consultado_em?: string; salva?: FichaFiscal; mudaram?: string[] };

export type ModeloNaTela = {
  chave: string;
  tipo: string;
  servico: string | null;
  nome: string;
  ativo: { versao: number; revisao_juridica: string; variaveis: VariavelDoModelo[]; clausulas: ClausulaDoModelo[] };
  versoes: Array<{ versao: number; ativo: boolean; revisao_juridica: string; clausulas: number }>;
};

export type Preferencias = {
  extras: Record<string, "padrao_sim" | "padrao_nao" | "desligada">;
  avisos: { aviso_vencimento_dias: number; lembrete_assinatura_dias: number };
};

export type ContextoDosContratos = {
  agencia: { completa: boolean; faltando: string[]; aviso: string | null; nome: string | null };
  modelos: Array<{ chave: string; tipo: string; servico: string | null; nome: string; versao: number; revisao_juridica: string }>;
  servicos: Record<string, string>;
  autentique: { ligada: boolean; pronta: boolean; motivo: string };
};

export const chamarContratos = <T = PayloadDoContrato>(acao: string, corpo: Record<string, unknown> = {}) => chamarFuncao<T>("contratos", { acao, ...corpo });

export const CHAVES_DOS_CONTRATOS = {
  lista: ["contracts"] as const,
  contexto: ["contratos", "contexto"] as const,
  um: (id: string) => ["contratos", "um", id] as const,
  diff: (id: string) => ["contratos", "diff", id] as const,
  // Frente CON2
  painel: (clientId: string | null) => ["contratos", "painel", clientId || "todos"] as const,
  ficha: (clientId: string) => ["contratos", "ficha", clientId] as const,
  modelos: ["contratos", "modelos"] as const,
  propostas: (clientId: string) => ["contratos", "propostas", clientId] as const,
};

export type RespostaDoDiff = { antes: { id: string; versao: number }; depois: { id: string; versao: number }; linhas: LinhaDoDiff[]; resumo: { mudaram: number; entraram: number; sairam: number } };

// ------------------------------------------------------------------ envio por e-mail e cópia (UXS, 30/09)

/** O que a função send-contract-email responde em inglês, dito em português. */
const ERROS_DO_EMAIL: Record<string, string> = {
  "client without email": "O cliente não tem e-mail cadastrado.",
  "admin must sign first": "A agência precisa assinar antes do envio.",
  "contract must be frozen before sending": "A agência precisa assinar antes do envio.",
  "contract is no longer available for sending": "Este contrato não pode mais ser enviado.",
  "email service not configured": "O envio de e-mail não está configurado.",
  "email sent but contract status was not recorded": "O e-mail saiu, mas o envio não ficou registrado. Atualize a tela.",
  "contract not found": "Contrato não encontrado.",
  forbidden: "Você não tem permissão para enviar este contrato.",
  unauthorized: "Entre de novo para enviar.",
};

export function motivoDoEmail(bruto: string): string {
  return ERROS_DO_EMAIL[bruto] || bruto;
}

/**
 * Manda o link de assinatura por e-mail ao cliente (a função
 * send-contract-email). Um lugar só para o contrato de modelo e o de PDF.
 * Devolve o link que foi no e-mail; erro vira frase em português.
 */
export async function enviarContratoPorEmail(contractId: string): Promise<{ signUrl: string | null }> {
  const { data, error } = await supabase.functions.invoke("send-contract-email", { body: { contract_id: contractId } });
  if (error) throw new Error(motivoDoEmail(await mensagemDaFuncao(error, "O e-mail não foi enviado.")));
  const corpo = (data || {}) as { error?: unknown; signUrl?: unknown };
  if (typeof corpo.error === "string" && corpo.error) throw new Error(motivoDoEmail(corpo.error));
  return { signUrl: typeof corpo.signUrl === "string" && corpo.signUrl ? corpo.signUrl : null };
}

/** Copia e só diz que deu certo depois que a cópia aconteceu (o aviso "copiado" não mente). */
export async function copiarTexto(t: string): Promise<boolean> {
  try {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") return false;
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    return false;
  }
}
