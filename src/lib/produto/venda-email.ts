import type { ConfigDoProduto } from "./api";

/**
 * Venda do E-mail profissional (página pública /email e pedido em /email/pedir).
 * Só contas puras e o rascunho guardado no aparelho: quem fala com o servidor
 * são as mesmas chamadas do produto (produto_precos, produto_criar_conta e a
 * ação pedir_email da função `produto`). Nada aqui cria cobrança.
 */

export type PrecosDoEmail = Pick<ConfigDoProduto, "email_mensal" | "email_caixas_no_mensal" | "email_caixa_extra" | "email_migracao">;

export const CAIXAS_MINIMO = 1;
export const CAIXAS_MAXIMO = 200;

/** Um número de caixas dentro do que a tela aceita; fora disso, o padrão. */
export function caixasValidas(valor: unknown, padrao = CAIXAS_MINIMO): number {
  const n = Math.floor(Number(valor));
  if (!isFinite(n) || n < CAIXAS_MINIMO) return Math.max(CAIXAS_MINIMO, Math.min(CAIXAS_MAXIMO, Math.floor(padrao) || CAIXAS_MINIMO));
  return Math.min(CAIXAS_MAXIMO, n);
}

export interface ContaDoEmail {
  caixas: number;
  inclusas: number;
  extras: number;
  mensal: number;
  migracao: number;
  primeiroMes: number;
}

const dinheiro = (v: number) => Math.round(v * 100) / 100;

/**
 * Quanto custa o e-mail para um número de caixas, com a regra do banco
 * (produto_itens_da_conta): a mensalidade cobre as caixas incluídas e cada
 * caixa além delas soma o valor da caixa adicional. A migração é uma vez só.
 */
export function contaDoEmail(precos: PrecosDoEmail, caixas: number): ContaDoEmail {
  const total = caixasValidas(caixas);
  const inclusas = Math.max(0, Math.floor(precos.email_caixas_no_mensal) || 0);
  const extras = Math.max(0, total - inclusas);
  const mensal = dinheiro(Math.max(0, precos.email_mensal) + extras * Math.max(0, precos.email_caixa_extra));
  const migracao = dinheiro(Math.max(0, precos.email_migracao));
  return { caixas: total, inclusas, extras, mensal, migracao, primeiroMes: dinheiro(mensal + migracao) };
}

/** Preços que dá para mostrar: sem mensalidade no banco, a página não inventa valor. */
export const precosProntos = (p: PrecosDoEmail | null | undefined): p is PrecosDoEmail => !!p && p.email_mensal > 0;

/** "https://www.SuaEmpresa.com.br/contato" ou "eu@suaempresa.com.br" viram "suaempresa.com.br". */
export function dominioLimpo(texto: string): string {
  let d = String(texto || "").trim().toLowerCase();
  d = d.replace(/^[a-z]+:\/\//, "");
  const arroba = d.lastIndexOf("@");
  if (arroba >= 0) d = d.slice(arroba + 1);
  d = d.replace(/^www\./, "");
  d = d.split("/")[0].split("?")[0].split("#")[0];
  return d.replace(/\.+$/, "").slice(0, 120);
}

export function dominioValido(dominio: string): boolean {
  return /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/.test(dominio);
}

/** Provedores de e-mail pessoal: o endereço é da pessoa, não dá para migrar como domínio da empresa. */
const DOMINIOS_PESSOAIS = ["gmail.com", "hotmail.com", "outlook.com", "outlook.com.br", "yahoo.com", "yahoo.com.br", "icloud.com", "live.com", "bol.com.br", "uol.com.br", "terra.com.br"];
export const dominioPessoal = (dominio: string) => DOMINIOS_PESSOAIS.indexOf(dominio) >= 0;

export interface RascunhoDoPedido {
  dominio: string;
  semDominio: boolean;
  caixas: number;
  observacao: string;
  empresa: string;
}

export const RASCUNHO_VAZIO: RascunhoDoPedido = { dominio: "", semDominio: false, caixas: 5, observacao: "", empresa: "" };
const CHAVE = "aceleriq:email:pedido";

export function lerRascunho(): RascunhoDoPedido | null {
  try {
    const bruto = JSON.parse(localStorage.getItem(CHAVE) || "null");
    if (!bruto || typeof bruto !== "object") return null;
    return {
      dominio: typeof bruto.dominio === "string" ? bruto.dominio.slice(0, 120) : "",
      semDominio: !!bruto.semDominio,
      caixas: caixasValidas(bruto.caixas, RASCUNHO_VAZIO.caixas),
      observacao: typeof bruto.observacao === "string" ? bruto.observacao.slice(0, 600) : "",
      empresa: typeof bruto.empresa === "string" ? bruto.empresa.slice(0, 120) : "",
    };
  } catch {
    return null;
  }
}

export function guardarRascunho(r: RascunhoDoPedido | null): void {
  try {
    if (r) localStorage.setItem(CHAVE, JSON.stringify(r));
    else localStorage.removeItem(CHAVE);
  } catch {
    /* sem armazenamento: o rascunho vale só nesta visita */
  }
}

/** O que vai para a ação `pedir_email`: domínio limpo, caixas e o que a pessoa contou. */
export function corpoDoPedido(r: RascunhoDoPedido): { dominio: string; caixas: number; observacao: string } {
  const dominio = r.semDominio ? "" : dominioLimpo(r.dominio);
  const notas = [r.semDominio ? "Ainda não tem domínio." : "", r.observacao.trim(), "Pedido feito pela página /email."].filter(Boolean);
  return { dominio, caixas: caixasValidas(r.caixas), observacao: notas.join(" ").slice(0, 600) };
}
