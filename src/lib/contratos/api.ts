import { chamarFuncao } from "@/lib/mesa/api";
import type {
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
};

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
};

export type RespostaDoDiff = { antes: { id: string; versao: number }; depois: { id: string; versao: number }; linhas: LinhaDoDiff[]; resumo: { mudaram: number; entraram: number; sairam: number } };
