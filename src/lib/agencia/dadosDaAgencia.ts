import { supabase } from "@/integrations/supabase/client";
import {
  COLUNAS_DOS_DADOS_DA_AGENCIA,
  normalizarDadosDaAgencia,
  type CampoDaAgencia,
  type DadosDaAgencia,
} from "../../../supabase/functions/_shared/dados-da-agencia";

/**
 * Dados da agência na tela (frente BAS, 29/09). As regras (campos, o que cada
 * peça exige, CNPJ, CPF, faltasNosDados) são as MESMAS do servidor:
 * supabase/functions/_shared/dados-da-agencia.ts, reexportadas aqui.
 *
 * Leitura: equipe (RLS is_staff). Escrita: só admin (RLS has_role admin).
 * A logo vai para o bucket mesa, pasta agencia/, sempre com nome novo (nada
 * é apagado nem sobrescrito).
 */

export {
  CAMPOS_DA_AGENCIA,
  COLUNAS_DOS_DADOS_DA_AGENCIA,
  DadosDaAgenciaIncompletos,
  OBRIGATORIOS_POR_TIPO,
  UFS,
  cnpjValido,
  cpfValido,
  faltasNosDados,
  formatarCnpj,
  formatarCpf,
  nomeDaAgencia,
  normalizarDadosDaAgencia,
  qualificacaoDaContratada,
  situacaoDoCampo,
  somenteDigitos,
  textoDasFaltas,
  tipoDaLogoPeloCaminho,
  type CampoDaAgencia,
  type DadosDaAgencia,
  type DescricaoDoCampo,
  type FaltaNosDados,
  type TipoDeDocumentoDaAgencia,
} from "../../../supabase/functions/_shared/dados-da-agencia";

export const CHAVE_DOS_DADOS_DA_AGENCIA = ["agencia", "dados"] as const;

/** Logo: formatos que o PDF e a tela sabem mostrar, até 5 MB. */
export const TIPOS_DA_LOGO = ["image/png", "image/jpeg", "image/webp", "image/svg+xml"];
export const TETO_DA_LOGO = 5 * 1024 * 1024;

export interface SugestaoDaAgencia {
  campo: CampoDaAgencia;
  valor: string;
  /** De onde o banco tirou (ex.: "Comercial: organização Aceleriq"). */
  fonte: string;
}

export async function lerDadosDaAgenciaNaTela(): Promise<DadosDaAgencia> {
  const { data, error } = await (supabase as any)
    .from("agencia_dados")
    .select(COLUNAS_DOS_DADOS_DA_AGENCIA)
    .eq("id", true)
    .maybeSingle();
  if (error) throw error;
  return normalizarDadosDaAgencia(data || null);
}

/** Só os campos editáveis, já normalizados (vazio vira null). */
export function camposParaGravar(dados: Partial<DadosDaAgencia>): Partial<DadosDaAgencia> {
  const n = normalizarDadosDaAgencia(dados);
  const saida: Partial<DadosDaAgencia> = {};
  const editaveis: CampoDaAgencia[] = [
    "razao_social", "nome_fantasia", "cnpj", "endereco", "cidade", "uf", "comarca",
    "representante_nome", "representante_cpf", "email", "telefone", "site", "instagram",
    "pix_chave", "dados_bancarios", "logo_path",
  ];
  for (const campo of editaveis) {
    if (campo in dados) (saida as Record<string, unknown>)[campo] = n[campo];
  }
  return saida;
}

export async function salvarDadosDaAgencia(dados: Partial<DadosDaAgencia>): Promise<DadosDaAgencia> {
  const { data, error } = await (supabase as any)
    .from("agencia_dados")
    .update(camposParaGravar(dados))
    .eq("id", true)
    .select(COLUNAS_DOS_DADOS_DA_AGENCIA)
    .maybeSingle();
  if (error) throw error;
  // RLS sem permissão devolve 0 linhas, sem erro: não pode parecer salvo.
  if (!data) throw new Error("Só o admin altera os dados da agência.");
  return normalizarDadosDaAgencia(data);
}

export async function lerSugestoesDaAgencia(): Promise<SugestaoDaAgencia[]> {
  const { data, error } = await (supabase as any).rpc("agencia_dados_sugestoes");
  if (error) throw error;
  return Array.isArray(data) ? (data as SugestaoDaAgencia[]) : [];
}

/** Extensão pelo tipo do arquivo (o nome que a pessoa deu não entra no caminho). */
export function extensaoDaLogo(tipo: string): string | null {
  if (tipo === "image/png") return "png";
  if (tipo === "image/jpeg") return "jpg";
  if (tipo === "image/webp") return "webp";
  if (tipo === "image/svg+xml") return "svg";
  return null;
}

/** Confere a logo antes de enviar. null = pode enviar. */
export function problemaDaLogo(arquivo: { type: string; size: number }): string | null {
  if (!extensaoDaLogo(arquivo.type)) return "Use PNG, JPG, WEBP ou SVG.";
  if (arquivo.size > TETO_DA_LOGO) return "A logo passa de 5 MB.";
  if (arquivo.size <= 0) return "O arquivo está vazio.";
  return null;
}

/** Envia a logo com nome novo e grava o caminho na linha. Devolve os dados salvos. */
export async function enviarLogoDaAgencia(arquivo: File, agora: number = Date.now()): Promise<DadosDaAgencia> {
  const problema = problemaDaLogo(arquivo);
  if (problema) throw new Error(problema);
  const caminho = `agencia/logo-${agora}.${extensaoDaLogo(arquivo.type)}`;
  const { error } = await supabase.storage.from("mesa").upload(caminho, arquivo, { contentType: arquivo.type, upsert: false });
  if (error) throw error;
  return salvarDadosDaAgencia({ logo_path: caminho });
}

export async function urlDaLogoDaAgencia(dados: DadosDaAgencia): Promise<string | null> {
  if (!dados.logo_path) return null;
  const { data, error } = await supabase.storage.from(dados.logo_bucket || "mesa").createSignedUrl(dados.logo_path, 600);
  if (error) throw error;
  return data?.signedUrl || null;
}
