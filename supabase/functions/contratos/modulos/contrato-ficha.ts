/**
 * Ficha fiscal do cliente (frente CON2, 30/09/2026): CNPJ ou CPF, razão
 * social, endereço, representante e e-mails de contrato e de cobrança.
 *
 * - Mora em cliente_dados_fiscais (uma linha por cliente) e é reaproveitada
 *   por todo contrato, aditivo e renovação do cliente.
 * - Com o CNPJ, a função contratos consulta a BrasilAPI
 *   (https://brasilapi.com.br/api/cnpj/v1/{cnpj}) no servidor, com cache em
 *   cnpj_consultas. Aqui fica só a leitura da resposta (pura).
 * - Os dígitos verificadores de CNPJ e CPF são conferidos pelo código.
 *
 * Puro: sem Deno, sem npm, sem Supabase. A tela, a função e os testes usam o
 * mesmo arquivo. Compatível com Safari 11. Sem travessão.
 */
import { formatarDocumento, type Valores } from "../../_shared/contrato-modelo.ts";

export type TipoDePessoa = "pf" | "mei" | "pj";

export type FichaFiscal = {
  tipo_pessoa: TipoDePessoa | "";
  /** Só dígitos (11 ou 14). */
  documento: string;
  razao_social: string;
  nome_fantasia: string;
  logradouro: string;
  numero: string;
  complemento: string;
  bairro: string;
  cidade: string;
  uf: string;
  cep: string;
  representante_nome: string;
  representante_cpf: string;
  representante_cargo: string;
  email_contrato: string;
  email_cobranca: string;
  telefone: string;
  /** Situação na Receita (ATIVA, BAIXADA...), só de leitura. */
  situacao_cadastral: string;
};

export type CampoDaFicha = { campo: keyof FichaFiscal; rotulo: string; tipo: "texto" | "escolha" | "email" | "documento"; largo?: boolean };

export const CAMPOS_DA_FICHA: CampoDaFicha[] = [
  { campo: "documento", rotulo: "CNPJ ou CPF", tipo: "documento" },
  { campo: "tipo_pessoa", rotulo: "Tipo de pessoa", tipo: "escolha" },
  { campo: "razao_social", rotulo: "Razão social ou nome completo", tipo: "texto" },
  { campo: "nome_fantasia", rotulo: "Nome fantasia", tipo: "texto" },
  { campo: "logradouro", rotulo: "Logradouro", tipo: "texto" },
  { campo: "numero", rotulo: "Número", tipo: "texto" },
  { campo: "complemento", rotulo: "Complemento", tipo: "texto" },
  { campo: "bairro", rotulo: "Bairro", tipo: "texto" },
  { campo: "cidade", rotulo: "Cidade", tipo: "texto" },
  { campo: "uf", rotulo: "UF", tipo: "texto" },
  { campo: "cep", rotulo: "CEP", tipo: "texto" },
  { campo: "representante_nome", rotulo: "Representante legal", tipo: "texto" },
  { campo: "representante_cpf", rotulo: "CPF do representante", tipo: "documento" },
  { campo: "representante_cargo", rotulo: "Cargo do representante", tipo: "texto" },
  { campo: "email_contrato", rotulo: "E-mail para contrato", tipo: "email" },
  { campo: "email_cobranca", rotulo: "E-mail de cobrança", tipo: "email" },
  { campo: "telefone", rotulo: "Telefone", tipo: "texto" },
];

export const OPCOES_DE_PESSOA: Array<{ valor: TipoDePessoa; rotulo: string }> = [
  { valor: "pj", rotulo: "Pessoa jurídica" },
  { valor: "mei", rotulo: "MEI" },
  { valor: "pf", rotulo: "Pessoa física" },
];

const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v)).replace(/\s+/g, " ").trim();

export const soDigitos = (v: unknown) => String(v == null ? "" : v).replace(/\D/g, "");

export function fichaVazia(): FichaFiscal {
  return {
    tipo_pessoa: "", documento: "", razao_social: "", nome_fantasia: "", logradouro: "", numero: "", complemento: "", bairro: "",
    cidade: "", uf: "", cep: "", representante_nome: "", representante_cpf: "", representante_cargo: "", email_contrato: "",
    email_cobranca: "", telefone: "", situacao_cadastral: "",
  };
}

/** Lê uma linha (banco ou tela) como ficha, sem depender de todos os campos. */
export function lerFicha(bruto: unknown): FichaFiscal {
  const o = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  const f = fichaVazia();
  (Object.keys(f) as Array<keyof FichaFiscal>).forEach((k) => {
    (f as Record<string, string>)[k] = txt(o[k]);
  });
  f.documento = soDigitos(f.documento);
  f.representante_cpf = soDigitos(f.representante_cpf);
  f.uf = f.uf.toUpperCase().slice(0, 2);
  f.cep = soDigitos(f.cep).slice(0, 8);
  f.email_contrato = f.email_contrato.toLowerCase();
  f.email_cobranca = f.email_cobranca.toLowerCase();
  if (f.tipo_pessoa !== "pf" && f.tipo_pessoa !== "mei" && f.tipo_pessoa !== "pj") f.tipo_pessoa = "";
  return f;
}

// ------------------------------------------------------------------ dígitos verificadores

export function cnpjValido(bruto: unknown): boolean {
  const d = soDigitos(bruto);
  if (d.length !== 14 || /^(\d)\1{13}$/.test(d)) return false;
  const calc = (base: string, pesos: number[]) => {
    let soma = 0;
    for (let i = 0; i < pesos.length; i++) soma += Number(base[i]) * pesos[i];
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const p2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = calc(d, p1);
  const d2 = calc(d.slice(0, 12) + d1, p2);
  return d1 === Number(d[12]) && d2 === Number(d[13]);
}

export function cpfValido(bruto: unknown): boolean {
  const d = soDigitos(bruto);
  if (d.length !== 11 || /^(\d)\1{10}$/.test(d)) return false;
  const calc = (n: number) => {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(d[i]) * (n + 1 - i);
    const r = (soma * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
}

/** Motivo quando o documento não serve (null quando serve ou está vazio). */
export function documentoInvalido(bruto: unknown): string | null {
  const d = soDigitos(bruto);
  if (!d) return null;
  if (d.length === 14) return cnpjValido(d) ? null : "CNPJ com dígito verificador errado";
  if (d.length === 11) return cpfValido(d) ? null : "CPF com dígito verificador errado";
  return "use 14 dígitos (CNPJ) ou 11 (CPF)";
}

// ------------------------------------------------------------------ BrasilAPI

const SIGLAS: Record<string, string> = { ltda: "Ltda", me: "ME", epp: "EPP", eireli: "EIRELI", "s/a": "S/A", sa: "SA", "s.a.": "S.A.", mei: "MEI" };
const PEQUENAS = ["de", "da", "do", "das", "dos", "e"];

/** "PADARIA PAO BOM LTDA" vira "Padaria Pao Bom Ltda"; siglas e preposições ficam. Texto já misto fica como veio. */
export function nomeLegivel(bruto: unknown): string {
  const t = txt(bruto);
  if (!t || t !== t.toUpperCase()) return t;
  return t.toLowerCase().split(" ").map((p, i) => {
    if (SIGLAS[p]) return SIGLAS[p];
    if (i > 0 && PEQUENAS.indexOf(p) >= 0) return p;
    return p.charAt(0).toUpperCase() + p.slice(1);
  }).join(" ");
}

function telefoneLegivel(bruto: unknown): string {
  const d = soDigitos(bruto);
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  return txt(bruto);
}

export type RespostaDaConsulta = { ficha: FichaFiscal; avisos: string[] };

/**
 * Lê a resposta da BrasilAPI (CNPJ v1). O representante é o primeiro sócio
 * administrador do quadro societário (QSA); sem ele, fica vazio e vira aviso
 * (nunca inventado). CPF do sócio não vem completo na Receita: fica vazio.
 */
export function fichaDaBrasilApi(bruto: unknown): RespostaDaConsulta {
  const o = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  const f = fichaVazia();
  const avisos: string[] = [];
  f.documento = soDigitos(o.cnpj);
  f.razao_social = nomeLegivel(o.razao_social);
  f.nome_fantasia = nomeLegivel(o.nome_fantasia);
  const tipoLogradouro = txt(o.descricao_tipo_de_logradouro);
  const logradouro = txt(o.logradouro);
  f.logradouro = nomeLegivel(tipoLogradouro && logradouro.toUpperCase().indexOf(tipoLogradouro.toUpperCase()) !== 0 ? `${tipoLogradouro} ${logradouro}` : logradouro);
  f.numero = txt(o.numero);
  f.complemento = nomeLegivel(o.complemento);
  f.bairro = nomeLegivel(o.bairro);
  f.cidade = nomeLegivel(o.municipio);
  f.uf = txt(o.uf).toUpperCase().slice(0, 2);
  f.cep = soDigitos(o.cep).slice(0, 8);
  f.telefone = telefoneLegivel(o.ddd_telefone_1);
  const email = txt(o.email).toLowerCase();
  if (/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    f.email_contrato = email;
    f.email_cobranca = email;
  }
  f.situacao_cadastral = txt(o.descricao_situacao_cadastral).toUpperCase();
  f.tipo_pessoa = o.opcao_pelo_mei === true ? "mei" : "pj";
  const qsa = Array.isArray(o.qsa) ? (o.qsa as Array<Record<string, unknown>>) : [];
  const adm = qsa.find((s) => /administrador/i.test(txt(s.qualificacao_socio))) || qsa[0];
  if (adm && txt(adm.nome_socio)) {
    f.representante_nome = nomeLegivel(adm.nome_socio);
    f.representante_cargo = nomeLegivel(txt(adm.qualificacao_socio).replace(/^\d+\s*-\s*/, ""));
  } else avisos.push("A Receita não trouxe o sócio administrador: preencha o representante.");
  if (f.situacao_cadastral && f.situacao_cadastral !== "ATIVA") avisos.push(`Situação na Receita: ${f.situacao_cadastral}. Confira antes de contratar.`);
  if (!f.email_contrato) avisos.push("A Receita não trouxe e-mail: preencha o e-mail para contrato.");
  return { ficha: f, avisos };
}

/** Junta a ficha nova na atual: por padrão só completa o que está vazio. */
export function mesclarFicha(atual: FichaFiscal, nova: Partial<FichaFiscal>, substituir = false): { ficha: FichaFiscal; mudaram: Array<keyof FichaFiscal> } {
  const saida = { ...atual };
  const mudaram: Array<keyof FichaFiscal> = [];
  (Object.keys(atual) as Array<keyof FichaFiscal>).forEach((k) => {
    const v = txt(nova[k]);
    if (!v) return;
    if (txt(atual[k]) && !substituir) return;
    if (txt(atual[k]) === v) return;
    (saida as Record<string, string>)[k] = v;
    mudaram.push(k);
  });
  return { ficha: lerFicha(saida), mudaram };
}

// ------------------------------------------------------------------ ficha para o contrato

export function enderecoDaFicha(f: FichaFiscal): string {
  const cep = f.cep.length === 8 ? `CEP ${f.cep.slice(0, 5)}-${f.cep.slice(5)}` : "";
  const cidade = f.cidade ? `${f.cidade}${f.uf ? `/${f.uf}` : ""}` : "";
  return [f.logradouro, f.numero, f.complemento, f.bairro, cidade, cep].map(txt).filter(Boolean).join(", ");
}

/** Os valores do contrato que saem da ficha (cliente_*). Campo vazio não entra. */
export function valoresDaFicha(f: FichaFiscal): Valores {
  const v: Valores = {};
  const por = (k: string, x: string) => {
    if (txt(x)) v[k] = txt(x);
  };
  por("cliente_nome", f.razao_social || f.nome_fantasia);
  por("cliente_documento", f.documento ? formatarDocumento(f.documento) : "");
  por("cliente_endereco", enderecoDaFicha(f));
  const rep = f.representante_nome ? `${f.representante_nome}${f.representante_cpf ? `, CPF ${formatarDocumento(f.representante_cpf)}` : ""}${f.representante_cargo ? `, ${f.representante_cargo.toLowerCase()}` : ""}` : "";
  if (f.tipo_pessoa !== "pf") por("cliente_representante", rep);
  por("cliente_email", f.email_contrato || f.email_cobranca);
  if (f.tipo_pessoa) v.cliente_tipo_pessoa = f.tipo_pessoa;
  else if (f.documento.length === 11) v.cliente_tipo_pessoa = "pf";
  else if (f.documento.length === 14) v.cliente_tipo_pessoa = "pj";
  return v;
}

/** O que falta na ficha para um contrato (rótulos). */
export function faltasNaFicha(f: FichaFiscal): string[] {
  const faltas: string[] = [];
  if (!f.documento) faltas.push("CNPJ ou CPF");
  else {
    const erro = documentoInvalido(f.documento);
    if (erro) faltas.push(`CNPJ ou CPF (${erro})`);
  }
  if (!f.razao_social) faltas.push("razão social ou nome completo");
  if (!f.logradouro || !f.cidade || !f.uf) faltas.push("endereço");
  if (f.tipo_pessoa !== "pf" && !f.representante_nome) faltas.push("representante legal");
  if (f.representante_cpf && !cpfValido(f.representante_cpf)) faltas.push("CPF do representante (inválido)");
  if (!f.email_contrato) faltas.push("e-mail para contrato");
  return faltas;
}

/** Validade do cache da consulta pública (a Receita muda pouco). */
export const DIAS_DO_CACHE_DO_CNPJ = 30;

export function cacheValido(consultadoEm: string | null | undefined, agora: Date = new Date()): boolean {
  if (!consultadoEm) return false;
  const t = new Date(consultadoEm).getTime();
  if (!isFinite(t)) return false;
  return agora.getTime() - t < DIAS_DO_CACHE_DO_CNPJ * 24 * 3600 * 1000;
}

/** Mensagem clara para cada falha da consulta (a função escolhe pelo status HTTP). */
export function erroDaConsulta(status: number): { codigo: string; mensagem: string; http: number } {
  if (status === 404) return { codigo: "cnpj_nao_encontrado", mensagem: "A Receita não tem este CNPJ. Confira os números.", http: 404 };
  if (status === 400) return { codigo: "cnpj_invalido", mensagem: "CNPJ inválido para a consulta pública.", http: 400 };
  if (status === 429) return { codigo: "consulta_limitada", mensagem: "A consulta pública está limitando os pedidos agora. Tente em alguns minutos ou preencha à mão.", http: 429 };
  return { codigo: "consulta_indisponivel", mensagem: "A consulta pública de CNPJ não respondeu agora. Tente de novo ou preencha à mão.", http: 503 };
}
