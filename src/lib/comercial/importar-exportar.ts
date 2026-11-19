/**
 * Importar e exportar o CRM (19/11/2026, pedido do dono: "trazer de outro CRM e levar para fora, fácil e
 * rápido"). Tudo aqui é puro (sem banco), para o teste conferir:
 *   - lerCsv: lê o CSV que qualquer CRM exporta (HubSpot, Pipedrive, RD Station, Agendor, Excel, Planilhas),
 *     com vírgula ou ponto e vírgula, aspas e acento;
 *   - mapearColunas: acha sozinho qual coluna é nome, empresa, e-mail, telefone, etapa, valor...;
 *   - paraNegocios: transforma as linhas em negócios do funil, sem repetir quem já está no CRM;
 *   - paraCsv: o CRM inteiro num CSV que abre certo no Excel brasileiro.
 */

export type CampoImportavel = "name" | "company" | "email" | "whatsapp" | "stage" | "monthly_value" | "one_off_value" | "origin" | "notes" | "next_action";

export const CAMPOS_IMPORTAVEIS: Array<{ id: CampoImportavel; rotulo: string; obrigatorio?: boolean }> = [
  { id: "name", rotulo: "Nome do contato", obrigatorio: true },
  { id: "company", rotulo: "Empresa" },
  { id: "email", rotulo: "E-mail" },
  { id: "whatsapp", rotulo: "Telefone / WhatsApp" },
  { id: "stage", rotulo: "Etapa" },
  { id: "monthly_value", rotulo: "Valor mensal" },
  { id: "one_off_value", rotulo: "Valor único" },
  { id: "origin", rotulo: "Origem" },
  { id: "next_action", rotulo: "Próximo passo" },
  { id: "notes", rotulo: "Observações" },
];

/** Os nomes que cada CRM costuma dar a cada coluna (sem acento e em minúsculas). */
const SINONIMOS: Record<CampoImportavel, string[]> = {
  name: ["nome", "name", "nome do contato", "contato", "contact", "contact name", "full name", "nome completo", "pessoa", "person", "lead", "nome do lead", "cliente"],
  company: ["empresa", "company", "organizacao", "organization", "organizacao - nome", "account", "conta", "company name", "nome da empresa", "razao social"],
  email: ["email", "e-mail", "e mail", "email address", "endereco de email", "e-mail do contato"],
  whatsapp: ["whatsapp", "telefone", "phone", "celular", "mobile", "fone", "phone number", "mobile phone", "telefone celular", "numero"],
  stage: ["etapa", "estagio", "stage", "fase", "status", "deal stage", "etapa do funil", "pipeline stage", "situacao"],
  monthly_value: ["valor mensal", "mensalidade", "mrr", "monthly value", "valor recorrente", "recorrente"],
  one_off_value: ["valor", "value", "amount", "valor do negocio", "deal value", "valor unico", "valor total", "preco", "price"],
  origin: ["origem", "source", "fonte", "lead source", "canal", "origem do lead"],
  next_action: ["proximo passo", "proxima acao", "next step", "next action", "tarefa"],
  notes: ["observacao", "observacoes", "notas", "notes", "nota", "descricao", "description", "comentario", "comentarios"],
};

const sem = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Lê um CSV: separador detectado (vírgula, ponto e vírgula ou tab), aspas com aspas dobradas, BOM do Excel. */
export function lerCsv(texto: string): string[][] {
  const t = texto.replace(/^﻿/, "");
  const primeira = t.split(/\r?\n/, 1)[0] || "";
  const conta = (c: string) => primeira.split(c).length - 1;
  const sep = [";", ",", "\t"].sort((a, b) => conta(b) - conta(a))[0];
  const linhas: string[][] = [];
  let linha: string[] = [];
  let campo = "";
  let aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"' && t[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') aspas = false;
      else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      linha.push(campo);
      if (linha.some((x) => x.trim())) linhas.push(linha);
      linha = [];
      campo = "";
    } else campo += c;
  }
  linha.push(campo);
  if (linha.some((x) => x.trim())) linhas.push(linha);
  return linhas;
}

/** Para cada campo do CRM, a coluna do arquivo que parece ser ele (-1 = nenhuma). */
export function mapearColunas(cabecalhos: string[]): Record<CampoImportavel, number> {
  const limpos = cabecalhos.map(sem);
  const usadas = new Set<number>();
  const mapa = {} as Record<CampoImportavel, number>;
  // Primeiro os nomes exatos, depois os que contêm o sinônimo: "Telefone comercial" ainda é telefone.
  for (const exato of [true, false]) {
    for (const c of CAMPOS_IMPORTAVEIS) {
      if (mapa[c.id] !== undefined && mapa[c.id] >= 0) continue;
      const i = limpos.findIndex((h, idx) => !usadas.has(idx) && SINONIMOS[c.id].some((s) => (exato ? h === s : h.indexOf(s) >= 0)));
      mapa[c.id] = i;
      if (i >= 0) usadas.add(i);
    }
  }
  return mapa;
}

/** "R$ 1.234,56", "1,234.56", "1234" viram número; o resto vira 0. */
export function valorDe(bruto: string): number {
  let s = String(bruto || "").replace(/[^\d,.-]/g, "");
  if (!s) return 0;
  const virgula = s.lastIndexOf(",");
  const ponto = s.lastIndexOf(".");
  if (virgula > ponto) s = s.replace(/\./g, "").replace(",", ".");
  else s = s.replace(/,/g, "");
  const n = Number(s);
  return isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
}

/** A etapa do outro CRM no funil daqui, pelo sentido da palavra. */
export function etapaDe(bruto: string): string {
  const s = sem(bruto || "");
  if (!s) return "novo";
  if (/ganh|won|fechad|vend|closed won|cliente/.test(s)) return "ganho";
  if (/perd|lost|descart|closed lost|cancel/.test(s)) return "perdido";
  if (/negoci|contrat|document|fechamento/.test(s)) return "negociacao";
  if (/propost|orcament|proposal|quote/.test(s)) return "proposta";
  if (/diagnos|qualif|visita|reuni|meeting|demo|apresent/.test(s)) return "diagnostico";
  if (/contat|atendim|conversa|contacted|follow|retorno/.test(s)) return "contato";
  return "novo";
}

const telefoneLimpo = (t: string) => {
  const d = String(t || "").replace(/\D/g, "");
  return d.length >= 8 ? d : "";
};

export interface NegocioImportado {
  name: string;
  company: string | null;
  email: string | null;
  whatsapp: string | null;
  stage: string;
  monthly_value: number;
  one_off_value: number;
  origin: string;
  next_action: string | null;
  notes: string | null;
}

/**
 * As linhas do arquivo como negócios. Pula a linha sem nome nem empresa nem e-mail, e quem já está no CRM
 * (mesmo e-mail ou mesmo telefone) ou repetido dentro do próprio arquivo.
 */
export function paraNegocios(
  linhas: string[][],
  mapa: Record<CampoImportavel, number>,
  jaExistem: Array<{ email?: string | null; whatsapp?: string | null }> = [],
): { negocios: NegocioImportado[]; repetidos: number; vazios: number } {
  const emails = new Set(jaExistem.map((x) => sem(x.email || "")).filter(Boolean));
  const fones = new Set(jaExistem.map((x) => telefoneLimpo(x.whatsapp || "")).filter(Boolean));
  const pega = (l: string[], c: CampoImportavel) => (mapa[c] >= 0 ? String(l[mapa[c]] || "").trim() : "");
  const negocios: NegocioImportado[] = [];
  let repetidos = 0;
  let vazios = 0;
  for (const l of linhas) {
    const email = pega(l, "email").toLowerCase();
    const fone = telefoneLimpo(pega(l, "whatsapp"));
    const empresa = pega(l, "company");
    const nome = pega(l, "name") || empresa || email;
    if (!nome) { vazios++; continue; }
    const chaveEmail = sem(email);
    if ((chaveEmail && emails.has(chaveEmail)) || (fone && fones.has(fone))) { repetidos++; continue; }
    if (chaveEmail) emails.add(chaveEmail);
    if (fone) fones.add(fone);
    const origem = sem(pega(l, "origin"));
    negocios.push({
      name: nome.slice(0, 160),
      company: empresa ? empresa.slice(0, 160) : null,
      email: email && /\S+@\S+\.\S+/.test(email) ? email.slice(0, 200) : null,
      whatsapp: fone || null,
      stage: etapaDe(pega(l, "stage")),
      monthly_value: valorDe(pega(l, "monthly_value")),
      one_off_value: valorDe(pega(l, "one_off_value")),
      origin: /insta/.test(origem) ? "instagram" : /indic/.test(origem) ? "indicacao" : /site|google|organic/.test(origem) ? "site" : /evento/.test(origem) ? "evento" : "manual",
      next_action: pega(l, "next_action").slice(0, 300) || null,
      notes: pega(l, "notes").slice(0, 2000) || null,
    });
  }
  return { negocios, repetidos, vazios };
}

const CABECALHO_DA_EXPORTACAO = ["Nome", "Empresa", "E-mail", "WhatsApp", "Etapa", "Valor mensal", "Valor único", "Origem", "Próximo passo", "Data do próximo passo", "Observações", "Criado em"];

/** O CRM num CSV para o Excel brasileiro: ponto e vírgula, vírgula decimal e o BOM que faz o acento abrir certo. */
export function paraCsv(
  negocios: Array<{ name: string; company?: string | null; email?: string | null; whatsapp?: string | null; stage: string; monthly_value?: number | null; one_off_value?: number | null; origin?: string | null; next_action?: string | null; next_action_at?: string | null; notes?: string | null; created_at?: string | null }>,
  rotuloDaEtapa: (id: string) => string = (id) => id,
): string {
  const celula = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const numero = (n: number | null | undefined) => (n ? n.toFixed(2).replace(".", ",") : "");
  const dia = (iso: string | null | undefined) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "");
  const linhas = negocios.map((n) => [n.name, n.company, n.email, n.whatsapp, rotuloDaEtapa(n.stage), numero(n.monthly_value), numero(n.one_off_value), n.origin, n.next_action, dia(n.next_action_at), n.notes, dia(n.created_at)].map(celula).join(";"));
  return "﻿" + [CABECALHO_DA_EXPORTACAO.join(";"), ...linhas].join("\r\n");
}
