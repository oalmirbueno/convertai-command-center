import { ENDERECO_DO_APP, soDigitos } from "./venda";
import type { CaixaDeEmail, ContaNaCasa, DominioDeEmail } from "./api";

/**
 * Acessos dos clientes (19/11/2026, pedido do dono): a casa manda para cada empresa o link de entrada
 * do produto dela e confere quem já entrou. Regras puras, sem rede, para o teste provar.
 *
 * O link de entrada é fixo por empresa e não carrega senha nem token: abre o login do produto
 * (CRM em /app, correio em /correio) com o identificador da empresa. Quem ainda não criou a senha
 * recebe o link de primeiro acesso (vale uma vez), gerado pela função produto.
 */

export type DestinoDoAcesso = "crm" | "correio";

const CAMINHO: Record<DestinoDoAcesso, string> = { crm: "/app", correio: "/correio" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** O link de entrada de uma empresa: o login certo do produto, com o identificador da empresa. */
export function linkDeEntrada(contaId: string, destino: DestinoDoAcesso, base: string = ENDERECO_DO_APP): string {
  const raiz = String(base || "").replace(/\/+$/, "");
  const empresa = UUID.test(contaId) ? `&empresa=${contaId.toLowerCase()}` : "";
  return `${raiz}/login?next=${encodeURIComponent(CAMINHO[destino])}${empresa}`;
}

/** O texto que vai junto no WhatsApp. Nunca leva senha. */
export function mensagemDeEntrada(p: { empresa: string; destino: DestinoDoAcesso; link: string; primeiroAcesso?: boolean }): string {
  const oQue = p.destino === "crm" ? "o CRM" : "o seu e-mail";
  if (p.primeiroAcesso) return `Olá! Este é o seu link de primeiro acesso a ${oQue} da ${p.empresa} na Aceleriq. Ele vale uma vez e pede para você criar a sua senha: ${p.link}`;
  return `Olá! Para entrar ${p.destino === "crm" ? "no CRM" : "no seu e-mail"} da ${p.empresa} na Aceleriq, use este link com o seu e-mail e a sua senha: ${p.link}`;
}

/** O endereço do WhatsApp com a mensagem pronta. Sem telefone, abre para escolher o contato. */
export function linkDoWhatsApp(telefone: string | null | undefined, mensagem: string): string {
  let d = soDigitos(telefone || "");
  if (d.length === 10 || d.length === 11) d = `55${d}`;
  const para = d.length >= 12 && d.length <= 15 ? d : "";
  return `https://wa.me/${para}?text=${encodeURIComponent(mensagem)}`;
}

/** As empresas que entram nesta tela: as que têm CRM ou e-mail (contratado ou com domínio). */
export const temAcesso = (c: Pick<ContaNaCasa, "crm_ativo" | "email_ativo" | "dominios">) => !!(c.crm_ativo || c.email_ativo || c.dominios > 0);

export type SituacaoDoAcesso = "todos" | "parte" | "ninguem" | "sem_pessoas";

/** Quem já entrou numa empresa (pessoa ativa) e quem ainda não (convite esperando). */
export function situacaoDoAcesso(equipe: ContaNaCasa["equipe"]): { total: number; entraram: number; esperando: number; situacao: SituacaoDoAcesso } {
  const pessoas = (equipe || []).filter((m) => m.estado !== "removido");
  const entraram = pessoas.filter((m) => m.estado === "ativo").length;
  const esperando = pessoas.filter((m) => m.estado === "convidado").length;
  const total = pessoas.length;
  const situacao: SituacaoDoAcesso = !total ? "sem_pessoas" : entraram === total ? "todos" : entraram === 0 ? "ninguem" : "parte";
  return { total, entraram, esperando, situacao };
}

/** A caixa que a casa pode abrir com a senha: caixa de verdade, já criada, num domínio com correio de leitura. */
export interface CaixaParaEntrar {
  id: string;
  endereco: string;
  empresa: string;
  conta_id: string;
  pronta: boolean;
}

const ESTADOS_ABERTOS = ["criada", "copiando", "ativa"];

/** O provedor que lê a caixa: o do correio, ou o Migadu quando o domínio é do Migadu e o correio ainda não foi marcado. */
export function provedorDeLeitura(d: { provedor?: string | null; correio_provedor?: string | null } | null | undefined): string {
  if (!d) return "nenhum";
  const doCorreio = String(d.correio_provedor || "nenhum");
  if (doCorreio !== "nenhum") return doCorreio;
  return d.provedor === "migadu" ? "migadu" : "nenhum";
}

export function caixasParaEntrar(caixas: CaixaDeEmail[], dominios: DominioDeEmail[], nomes: Record<string, string>): CaixaParaEntrar[] {
  const porId: Record<string, DominioDeEmail> = {};
  dominios.forEach((d) => {
    porId[d.id] = d;
  });
  return caixas
    .filter((c) => c.tipo === "caixa" && ESTADOS_ABERTOS.indexOf(c.estado) >= 0)
    .map((c) => ({
      id: c.id,
      endereco: c.endereco,
      conta_id: c.conta_id,
      empresa: nomes[c.conta_id] || "Sem empresa",
      pronta: provedorDeLeitura(porId[c.dominio_id] as { provedor?: string; correio_provedor?: string }) !== "nenhum",
    }))
    .sort((a, b) => a.empresa.localeCompare(b.empresa, "pt-BR") || a.endereco.localeCompare(b.endereco));
}
