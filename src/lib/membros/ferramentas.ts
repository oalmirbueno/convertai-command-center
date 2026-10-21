import { supabase } from "@/integrations/supabase/client";
import type { SupabaseClient } from "@supabase/supabase-js";
const banco = supabase as unknown as SupabaseClient;
export type FerramentaMembro = {
  produto_id: string;
  titulo: string;
  motor: "crm" | "proxima_resposta";
  capa_url: string | null;
  fim: string | null;
  disponivel?: boolean;
};
export function temLicencaDaFerramenta(ferramenta: FerramentaMembro): boolean {
  const fim = ferramenta.fim ? Date.parse(ferramenta.fim) : NaN;
  return (
    ferramenta.disponivel !== false &&
    Number.isFinite(fim) &&
    fim > Date.now()
  );
}
export type SessaoFerramenta = {
  conflito: boolean;
  mensagem?: string;
  licenca_fim?: string;
  sessao_fim?: string;
};
export type ContatoMembro = {
  id: string;
  nome: string;
  empresa: string;
  email: string;
  telefone: string;
  notas: string;
  arquivado: boolean;
  versao: number;
};
export type NegocioMembro = {
  id: string;
  titulo: string;
  contato_id: string | null;
  estagio: string;
  valor: number;
  proxima_acao: string;
  proxima_data: string | null;
  notas: string;
  arquivado: boolean;
  versao: number;
};
export type DadosCrmMembro = {
  contatos: ContatoMembro[];
  negocios: NegocioMembro[];
};
export type LicencaMembro = {
  id: string;
  produto_id: string;
  user_id: string;
  titular: string;
  email: string;
  origem: string;
  confirmado_em: string;
  fim: string | null;
  revogado_em: string | null;
  suspenso_em?: string | null;
};
export type AdminFerramentas = DadosCrmMembro & {
  ferramentas: {
    produto_id: string;
    motor: FerramentaMembro["motor"];
    ativo: boolean;
    upgrade_mensal?: {
      nome?: string;
      recursos?: string[];
      estado?: "rascunho";
      cobranca_ativa?: false;
    };
  }[];
  licencas: LicencaMembro[];
  exclusoes: {
    user_id: string;
    produto_id: string;
    solicitado_em: string;
    contatos_total: number;
    negocios_total: number;
  }[];
};
export type RespostaDeApoio = {
  acao: string;
  mensagem: string;
  orientacao: string;
  proximo: string;
};
async function rpc<T>(
  nome: string,
  args?: Record<string, unknown>,
): Promise<T> {
  const r = await banco.rpc(nome, args);
  if (r.error) throw r.error;
  return r.data as T;
}
export const listarFerramentas = () =>
  rpc<FerramentaMembro[]>("membros_ferramentas_catalogo");
/** Prova aleatória só para a ferramenta; não é chave da conta. Abas compartilham por titular e produto. */
export function provaDoNavegador(usuario: string, produto: string): string {
  const chave = `membros:ferramenta:${usuario}:${produto}`;
  const existente = localStorage.getItem(chave);
  if (existente && /^[a-f0-9]{64}$/.test(existente)) return existente;
  const prova = Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
    n.toString(16).padStart(2, "0"),
  ).join("");
  localStorage.setItem(chave, prova);
  return prova;
}
export async function obterProvaCompartilhada(
  usuario: string,
  produto: string,
): Promise<string> {
  const gerar = () => provaDoNavegador(usuario, produto);
  // Duas abas novas abertas juntas não disputam a criação da prova.
  return navigator.locks
    ? navigator.locks.request(`membros:prova:${usuario}:${produto}`, gerar)
    : gerar();
}
export const abrirSessaoFerramenta = (
  produto: string,
  prova: string,
  substituir = false,
) =>
  rpc<SessaoFerramenta>("membros_ferramenta_sessao", {
    _produto: produto,
    _prova: prova,
    _substituir: substituir,
  });
export const operarCrm = (
  produto: string,
  prova: string,
  acao = "listar",
  dados: object = {},
) =>
  rpc<DadosCrmMembro>("membros_crm_operar", {
    _produto: produto,
    _prova: prova,
    _acao: acao,
    _dados: dados,
  });
export const carregarAdminFerramentas = (usuario?: string, produto?: string) =>
  rpc<AdminFerramentas>("membros_ferramentas_admin", {
    _usuario: usuario || null,
    _produto: produto || null,
  });
export const configurarFerramenta = (
  produto: string,
  motor: string,
  ativo: boolean,
) =>
  rpc<void>("membros_ferramenta_configurar", {
    _produto: produto,
    _motor: motor,
    _ativo: ativo,
  });
export const prepararUpgradeMensal = (
  produto: string,
  nome: string,
  recursos: string[],
) =>
  rpc<void>("membros_ferramenta_upgrade_preparar", {
    _produto: produto,
    _nome: nome,
    _recursos: recursos,
  });
export const licenciarTeste = (produto: string, usuario: string) =>
  rpc<string>("membros_ferramenta_licenca_teste", {
    _produto: produto,
    _usuario: usuario,
  });
export const revogarLicenca = (licenca: string) =>
  rpc<void>("membros_ferramenta_revogar", { _licenca: licenca });
export const suspenderLicencaCrm = (licenca: string) =>
  rpc<void>("membros_crm_licenca_suspender", { _licenca: licenca });
export const reativarLicencaCrm = (licenca: string) =>
  rpc<void>("membros_crm_licenca_reativar", { _licenca: licenca });
export function estadoDaLicenca(
  licenca: LicencaMembro,
  agora = Date.now(),
): "Revogado" | "Vencida" | "Não iniciada" | "Suspensa" | "Liberado" {
  if (licenca.revogado_em) return "Revogado";
  const fim = licenca.fim ? Date.parse(licenca.fim) : NaN;
  if (!Number.isFinite(fim) || fim <= agora) return "Vencida";
  const inicio = Date.parse(licenca.confirmado_em);
  if (!Number.isFinite(inicio) || inicio > agora) return "Não iniciada";
  return licenca.suspenso_em ? "Suspensa" : "Liberado";
}
export const pedirExclusaoCrm = (produto: string) =>
  rpc<void>("membros_ferramenta_pedir_exclusao", { _produto: produto });
export const proximaResposta = (
  produto: string,
  prova: string,
  situacao: string,
  oferta: string,
  combinado: string,
  tentativas: number,
) =>
  rpc<RespostaDeApoio>("membros_proxima_resposta", {
    _produto: produto,
    _prova: prova,
    _situacao: situacao,
    _oferta: oferta,
    _combinado: combinado || null,
    _tentativas: tentativas,
  });
export const atenderExclusaoCrm = (
  usuario: string,
  produto: string,
  solicitadoEm: string,
) =>
  rpc<{ contatos: number; negocios: number }>("membros_crm_excluir_pedido", {
    _usuario: usuario,
    _produto: produto,
    _solicitado_em: solicitadoEm,
  });
