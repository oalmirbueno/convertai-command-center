/**
 * O ciclo de vida do contrato (frente CON2, 30/09/2026): vigência, painel
 * (a vencer, pendentes de assinatura, assinados no mês, valor recorrente),
 * lembrete de assinatura com mensagem pronta, renovação, termo aditivo e
 * quem assina (mais de um signatário do cliente e testemunhas).
 *
 * Datas, números e o texto do aditivo saem do código (nunca do modelo de
 * linguagem). Nada aqui envia mensagem: só monta o texto para a pessoa usar.
 *
 * Puro: sem Deno, sem npm, sem Supabase. Compatível com Safari 11. Sem travessão.
 */
import {
  anotarFalta,
  CHAVE_DA_ALTERADA,
  type ClausulaAlterada,
  type ClausulaMontada,
  contextoDaMontagem,
  type ContratoMontado,
  dataPorExtenso,
  type DadosDaAgencia,
  faltandoNaAgencia,
  lerMoeda,
  linhasDaClausula,
  linhasDosSignatarios,
  modeloAditivo,
  modeloDoServico,
  modeloGeral,
  type ModeloDeContrato,
  preencher,
  ROTULO_DO_SERVICO,
  SERVICOS_RECORRENTES,
  type ServicoDoContrato,
  servicosEmOrdem,
  type SignatarioNoTexto,
  tipoDoDocumento,
  valeACondicao,
  valorInvalido,
  type Valores,
  type VariavelDoModelo,
} from "./contrato-modelo.ts";
import { cpfValido } from "./contrato-ficha.ts";

const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v)).replace(/\s+/g, " ").trim();

export type TipoDoDocumento = "contrato" | "aditivo" | "renovacao";

// ------------------------------------------------------------------ datas (AAAA-MM-DD, sem fuso: é data de calendário)

function partes(iso: string): { a: number; m: number; d: number } | null {
  const x = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ""));
  if (!x) return null;
  const a = Number(x[1]);
  const m = Number(x[2]);
  const d = Number(x[3]);
  const t = new Date(Date.UTC(a, m - 1, d));
  return t.getUTCMonth() === m - 1 ? { a, m, d } : null;
}

const dois = (n: number) => (n < 10 ? `0${n}` : String(n));
const iso = (t: Date) => `${t.getUTCFullYear()}-${dois(t.getUTCMonth() + 1)}-${dois(t.getUTCDate())}`;

export function dataValida(v: unknown): boolean {
  return !!partes(String(v || ""));
}

export function somarDias(data: string, dias: number): string {
  const p = partes(data);
  if (!p) return "";
  return iso(new Date(Date.UTC(p.a, p.m - 1, p.d + dias)));
}

/** Soma meses mantendo o dia (31/01 + 1 mês = 28 ou 29/02). */
export function somarMeses(data: string, meses: number): string {
  const p = partes(data);
  if (!p) return "";
  const alvo = new Date(Date.UTC(p.a, p.m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
  return iso(new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth(), Math.min(p.d, ultimo))));
}

/** Dias de `de` até `ate` (positivo quando `ate` vem depois). */
export function diasEntre(de: string, ate: string): number {
  const a = partes(de);
  const b = partes(ate);
  if (!a || !b) return 0;
  return Math.round((Date.UTC(b.a, b.m - 1, b.d) - Date.UTC(a.a, a.m - 1, a.d)) / 86400000);
}

/** Data (AAAA-MM-DD) de um instante ISO no fuso de São Paulo. */
export function dataEmSaoPaulo(instante: string | null | undefined): string {
  if (!instante) return "";
  const t = new Date(instante);
  if (isNaN(t.getTime())) return String(instante).slice(0, 10);
  return iso(new Date(t.getTime() - 3 * 3600 * 1000));
}

// ------------------------------------------------------------------ vigência

export type Vigencia = { inicio: string | null; fim: string | null; recorrente: boolean };

/**
 * Serviço mensal: do início até o dia anterior ao mesmo dia, N meses depois.
 * Só projeto: termina com a entrega (sem data de fim para avisar).
 */
export function vigenciaDoContrato(valores: Valores, servicos: unknown): Vigencia {
  const s = servicosEmOrdem(servicos);
  const recorrente = s.some((x) => SERVICOS_RECORRENTES.indexOf(x) >= 0);
  const inicio = dataValida(valores.inicio) ? String(valores.inicio).slice(0, 10) : null;
  const meses = Number(String(valores.vigencia_meses || "").replace(/\D/g, ""));
  const fim = recorrente && inicio && meses > 0 ? somarDias(somarMeses(inicio, meses), -1) : null;
  return { inicio, fim, recorrente };
}

// ------------------------------------------------------------------ painel

export type LinhaDoPainel = {
  id: string;
  client_id: string;
  title: string;
  numero: string | null;
  versao: number;
  status: string;
  origem: string;
  tipo_documento?: string | null;
  contrato_mae_id?: string | null;
  renovacao_de?: string | null;
  servicos: string[];
  variaveis: Valores;
  vigencia_fim?: string | null;
  sent_at?: string | null;
  congelado_em?: string | null;
  client_signed_at?: string | null;
  arquivado_em?: string | null;
  substituido_por?: string | null;
  lembrete_em?: string | null;
};

export type ItemAVencer = { id: string; client_id: string; titulo: string; numero: string | null; fim: string; dias: number; renovacao_id: string | null };
export type ItemPendente = { id: string; client_id: string; titulo: string; numero: string | null; dias: number; lembrete_em: string | null };

export type PainelDosContratos = {
  aVencer: ItemAVencer[];
  pendentes: ItemPendente[];
  assinadosNoMes: number;
  recorrenteMensal: number;
  ativos: number;
};

const valorDe = (v: unknown) => {
  const n = lerMoeda(v);
  return n === null ? 0 : n;
};

/** Contrato em vigor: assinado, não arquivado, não substituído, e não é aditivo. */
export function emVigor(l: LinhaDoPainel, hoje: string, fim: string | null): boolean {
  if (l.status !== "completed" || l.arquivado_em || l.substituido_por) return false;
  if (l.tipo_documento === "aditivo") return false;
  const inicio = dataValida(l.variaveis && l.variaveis.inicio) ? String(l.variaveis.inicio).slice(0, 10) : null;
  if (inicio && diasEntre(hoje, inicio) > 0) return false;
  return !fim || diasEntre(hoje, fim) >= 0;
}

/**
 * O fim e o valor mensal que valem hoje: o do contrato, trocado pelo
 * aditivo assinado mais novo que mudou a vigência ou o valor e já vale.
 */
export function efeitosDosAditivos(l: LinhaDoPainel, aditivos: LinhaDoPainel[], hoje: string): { fim: string | null; mensal: number } {
  let fim = l.vigencia_fim || vigenciaDoContrato(l.variaveis || {}, l.servicos).fim;
  let mensal = valorDe(l.variaveis && l.variaveis.valor_mensal);
  const assinados = aditivos
    .filter((a) => a.contrato_mae_id === l.id && a.status === "completed" && !a.arquivado_em)
    .sort((a, b) => String(a.client_signed_at || "").localeCompare(String(b.client_signed_at || "")));
  for (const a of assinados) {
    const v = a.variaveis || {};
    const vale = !dataValida(v.aditivo_inicio_efeitos) || diasEntre(String(v.aditivo_inicio_efeitos), hoje) >= 0;
    if (dataValida(v.aditivo_vigencia_fim_nova)) fim = String(v.aditivo_vigencia_fim_nova).slice(0, 10);
    if (vale && lerMoeda(v.aditivo_valor_mensal_novo) !== null) mensal = valorDe(v.aditivo_valor_mensal_novo);
  }
  return { fim, mensal };
}

export function painelDosContratos(lista: LinhaDoPainel[], hoje: string, janelaDias = 30): PainelDosContratos {
  const aditivos = lista.filter((l) => l.tipo_documento === "aditivo");
  const renovacoes: Record<string, string> = {};
  lista.forEach((l) => {
    if (l.renovacao_de && l.status !== "cancelled" && !l.arquivado_em) renovacoes[l.renovacao_de] = l.id;
  });
  const mes = hoje.slice(0, 7);
  const saida: PainelDosContratos = { aVencer: [], pendentes: [], assinadosNoMes: 0, recorrenteMensal: 0, ativos: 0 };
  for (const l of lista) {
    if (l.client_signed_at && dataEmSaoPaulo(l.client_signed_at).slice(0, 7) === mes) saida.assinadosNoMes++;
    if (l.status === "sent" && !l.client_signed_at && !l.arquivado_em && !l.substituido_por) {
      const desde = dataEmSaoPaulo(l.sent_at || l.congelado_em || null) || hoje;
      saida.pendentes.push({ id: l.id, client_id: l.client_id, titulo: l.title, numero: l.numero, dias: Math.max(0, diasEntre(desde, hoje)), lembrete_em: l.lembrete_em || null });
    }
    if (l.status !== "completed" || l.arquivado_em || l.substituido_por || l.tipo_documento === "aditivo") continue;
    const ef = efeitosDosAditivos(l, aditivos, hoje);
    if (emVigor(l, hoje, ef.fim)) {
      saida.ativos++;
      if (servicosEmOrdem(l.servicos).some((s) => SERVICOS_RECORRENTES.indexOf(s) >= 0)) saida.recorrenteMensal += ef.mensal;
    }
    if (ef.fim) {
      const dias = diasEntre(hoje, ef.fim);
      // A vencer na janela, e vencido há até 30 dias sem renovação assinada.
      if (dias <= janelaDias && dias >= -30) saida.aVencer.push({ id: l.id, client_id: l.client_id, titulo: l.title, numero: l.numero, fim: ef.fim, dias, renovacao_id: renovacoes[l.id] || null });
    }
  }
  saida.aVencer.sort((a, b) => a.dias - b.dias);
  saida.pendentes.sort((a, b) => b.dias - a.dias);
  saida.recorrenteMensal = Math.round(saida.recorrenteMensal * 100) / 100;
  return saida;
}

// ------------------------------------------------------------------ lembrete de assinatura (mensagem pronta)

export function mensagemDeLembrete(p: { nome: string; titulo: string; link: string; dias: number; agencia: string }) {
  const ha = p.dias > 1 ? ` desde ${p.dias} dias atrás` : p.dias === 1 ? " desde ontem" : "";
  const nome = txt(p.nome) || "tudo bem";
  const whatsapp = `Olá, ${nome}! Passando para lembrar do contrato "${p.titulo}", que está esperando a sua assinatura${ha}. O link é este: ${p.link}\nLeva poucos minutos. Qualquer dúvida, é só responder aqui.`;
  const assunto = `Lembrete: contrato para assinatura (${p.titulo})`;
  const email = `Olá, ${nome}.\n\nO contrato "${p.titulo}" está esperando a sua assinatura${ha}. Você pode ler e assinar por este link:\n${p.link}\n\nQualquer dúvida, é só responder este e-mail.\n\n${p.agencia}`;
  return { whatsapp, assunto, email, wa_me: `https://wa.me/?text=${encodeURIComponent(whatsapp)}` };
}

// ------------------------------------------------------------------ renovação

/** Valores do rascunho de renovação: começa no dia seguinte ao fim, com o valor que vale hoje. */
export function valoresDaRenovacao(p: { valores: Valores; numero: string | null; fim: string; valorMensal?: number | null }): Valores {
  const v: Valores = { ...p.valores };
  v.inicio = somarDias(p.fim, 1);
  if (p.valorMensal && p.valorMensal > 0) v.valor_mensal = String(p.valorMensal);
  if (p.numero) v.renova_contrato_numero = String(p.numero);
  v.renova_contrato_fim = p.fim;
  return v;
}

// ------------------------------------------------------------------ termo aditivo

export function numeroDoAditivo(numeroDaMae: string | null, ordem: number): string {
  return `${txt(numeroDaMae) || "CT"}-A${Math.max(1, Math.floor(ordem))}`;
}

const DO_QUADRO = ["valor_total", "condicoes_pagamento", "valor_mensal", "vencimento_dia", "vigencia_meses"];

/** Variáveis do aditivo: as do contratante, as do próprio aditivo e as de serviço dos anexos incluídos. */
export function variaveisDoAditivo(modelos: ModeloDeContrato[], servicos: ServicoDoContrato[]): VariavelDoModelo[] {
  const saida: VariavelDoModelo[] = [];
  const vistos: Record<string, boolean> = {};
  const juntar = (lista: VariavelDoModelo[]) => {
    for (const v of lista) {
      if (vistos[v.nome]) continue;
      vistos[v.nome] = true;
      saida.push(v);
    }
  };
  const g = modeloGeral(modelos);
  if (g) juntar(g.variaveis.filter((v) => v.grupo === "cliente"));
  const a = modeloAditivo(modelos);
  if (a) juntar(a.variaveis);
  for (const s of servicosEmOrdem(servicos)) {
    const m = modeloDoServico(modelos, s);
    if (m) juntar(m.variaveis.filter((v) => DO_QUADRO.indexOf(v.nome) < 0));
  }
  return saida;
}

export type EntradaDoAditivo = {
  modelos: ModeloDeContrato[];
  /** Serviços que o aditivo inclui (viram anexos). */
  servicos: ServicoDoContrato[];
  valores: Valores;
  agencia: DadosDaAgencia;
  numero: string;
  versao: number;
  data: string;
  titulo?: string | null;
  qualificacao?: string | null;
  alteradas?: ClausulaAlterada[];
  signatarios?: SignatarioNoTexto[];
  /** O contrato original (o código escreve; a equipe não digita). */
  mae: { numero: string; versao: number; assinado_em: string | null; hash: string | null };
};

const LETRAS = "ABCDEFGHIJ";

/** Monta o termo aditivo no mesmo texto canônico do contrato (lerDocumento, hash, PDF). */
export function montarAditivo(e: EntradaDoAditivo): ContratoMontado {
  const servicos = servicosEmOrdem(e.servicos);
  const variaveis = variaveisDoAditivo(e.modelos, servicos);
  const valores: Valores = {
    ...e.valores,
    contrato_mae_numero: txt(e.mae.numero),
    contrato_mae_versao: String(Number(e.mae.versao) || 1),
    contrato_mae_data: e.mae.assinado_em ? dataPorExtenso(dataEmSaoPaulo(e.mae.assinado_em)) : "",
    contrato_mae_codigo: txt(e.mae.hash).slice(0, 16),
    aditivo_servicos_incluidos: servicos.map((s, i) => `${ROTULO_DO_SERVICO[s]} (Anexo ${LETRAS[i]})`).join(", "),
  };
  if (!valores.aditivo_servicos_incluidos) delete valores.aditivo_servicos_incluidos;
  const ctx = contextoDaMontagem(variaveis, valores, e.agencia);
  const alteradas: Record<string, ClausulaAlterada> = {};
  (e.alteradas || []).forEach((a) => (alteradas[a.chave] = a));

  for (const v of variaveis) {
    const bruto = valores[v.nome];
    if (!txt(bruto)) {
      if (v.obrigatoria) anotarFalta(ctx, v.nome, v.grupo === "servico" ? "serviço" : "aditivo", "vazia");
    } else {
      const erro = valorInvalido(v, bruto);
      if (erro) anotarFalta(ctx, v.nome, "valor", "invalida", erro);
    }
  }
  if (!e.mae.assinado_em || !txt(e.mae.hash)) ctx.faltando.push({ nome: "contrato_mae", rotulo: "contrato original assinado", motivo: "vazia", onde: "aditivo" });
  const temMudanca = ["aditivo_valor_mensal_novo", "aditivo_valor_adicional", "aditivo_vigencia_fim_nova", "aditivo_servicos_retirados"].some((k) => txt(valores[k])) || servicos.length > 0;
  if (!temMudanca && !txt(valores.aditivo_descricao)) ctx.faltando.push({ nome: "aditivo_mudanca", rotulo: "o que o aditivo muda", motivo: "vazia", onde: "aditivo" });

  const a = e.agencia;
  const l = (rotulo: string, valor: string) => `| ${rotulo} | ${valor.replace(/\|/g, "/")}`;
  const p = (t: string) => preencher(t, ctx, "quadro do aditivo");
  const linhas: string[] = [];
  linhas.push(`# ${txt(e.titulo) || "Termo aditivo ao contrato de prestação de serviços"}`);
  linhas.push(`@ Termo aditivo nº ${txt(e.numero) || "a definir"}, versão ${Number(e.versao) || 1}. ${txt(a.cidade) || "[falta: cidade]"}/${txt(a.uf)}, ${dataPorExtenso(e.data)}.`);
  linhas.push("## Quadro do aditivo");
  linhas.push(l("Contratada", txt(e.qualificacao) ? `${txt(e.qualificacao)}.` : `${txt(a.razao_social)}, CNPJ ${txt(a.cnpj)}, com sede em ${txt(a.endereco)}, ${txt(a.cidade)}/${txt(a.uf)}, representada por ${txt(a.representante)}.`));
  const doc = tipoDoDocumento(valores.cliente_documento || "") === "cpf" ? "CPF" : tipoDoDocumento(valores.cliente_documento || "") === "cnpj" ? "CNPJ" : "CPF/CNPJ";
  const rep = txt(valores.cliente_representante) ? `, representada por ${txt(valores.cliente_representante)}` : "";
  linhas.push(l("Contratante", `${p("{{cliente_nome}}")}, ${doc} ${p("{{cliente_documento}}")}, com endereço em ${p("{{cliente_endereco}}")}${rep}. E-mail do canal oficial: ${p("{{cliente_email}}")}.`));
  linhas.push(l("Contrato original", `nº ${txt(e.mae.numero)}, versão ${Number(e.mae.versao) || 1}${valores.contrato_mae_data ? `, assinado em ${valores.contrato_mae_data}` : ""}${valores.contrato_mae_codigo ? `, código ${valores.contrato_mae_codigo}` : ""}.`));
  linhas.push(l("Vale a partir de", `${p("{{aditivo_inicio_efeitos}}")}.`));
  if (servicos.length) linhas.push(l("Anexos", `${servicos.map((s, i) => `Anexo ${LETRAS[i]}, ${ROTULO_DO_SERVICO[s]}`).join("; ")}.`));

  const clausulas: ClausulaMontada[] = [];
  const secao = (modelo: ModeloDeContrato, prefixo: string, separador: string) => {
    let n = 0;
    for (const c of modelo.clausulas) {
      if (!valeACondicao(c.quando, valores)) continue;
      n++;
      const numero = `${prefixo}${n}`;
      const alterada = alteradas[CHAVE_DA_ALTERADA(modelo.chave, c.chave)];
      const texto = preencher(alterada ? alterada.texto : c.texto, ctx, modelo.nome);
      linhas.push(`### ${numero}${separador}${c.titulo}`);
      linhas.push(...linhasDaClausula(numero, texto));
      clausulas.push({ chave: CHAVE_DA_ALTERADA(modelo.chave, c.chave), modelo: modelo.chave, numero, titulo: c.titulo, texto, texto_modelo: c.texto, alterada: !!alterada });
    }
  };
  const ad = modeloAditivo(e.modelos);
  linhas.push("## Cláusulas do aditivo");
  if (ad) secao(ad, "", ". ");
  else ctx.faltando.push({ nome: "termo_aditivo", rotulo: "modelo do termo aditivo", motivo: "vazia", onde: "modelo" });
  servicos.forEach((s, i) => {
    const m = modeloDoServico(e.modelos, s);
    linhas.push(`## Anexo ${LETRAS[i]}. ${ROTULO_DO_SERVICO[s]}`);
    if (m) secao(m, `${LETRAS[i]}.`, " ");
    else ctx.faltando.push({ nome: `bloco_${s}`, rotulo: `bloco do serviço ${ROTULO_DO_SERVICO[s]}`, motivo: "vazia", onde: "modelo" });
  });
  linhas.push("## Assinaturas");
  linhas.push("E, por estarem de acordo, as partes assinam eletronicamente este termo aditivo. A página de carimbo ao final registra o código de integridade do documento, as assinaturas e a trilha de eventos.");
  linhas.push(...linhasDosSignatarios(e.signatarios));
  for (const f of faltandoNaAgencia(e.agencia)) {
    if (!ctx.faltando.some((x) => x.rotulo === f && x.onde === "dados da agência")) ctx.faltando.push({ nome: `agencia:${f}`, rotulo: f, motivo: "vazia", onde: "dados da agência" });
  }
  return { texto: linhas.join("\n"), faltando: ctx.faltando, clausulas, variaveis, valores };
}

// ------------------------------------------------------------------ serviços ativos da ficha do cliente viram blocos (regra fixa)

/** Chaves de services_config (ficha do cliente) para os blocos do contrato. Sem bloco: fica no aviso. */
export const BLOCO_DO_SERVICO_ATIVO: Record<string, ServicoDoContrato | null> = {
  social: "social",
  trafego: "trafego",
  site: "site",
  design: "design",
  videos_ia: "video",
  edicao_video: "video",
  copywriting: null,
  seo: null,
  email_marketing: null,
  automacao: null,
  relatorios: null,
  cobranca: null,
};

export function servicosDaFicha(config: unknown): { servicos: ServicoDoContrato[]; semBloco: string[] } {
  const o = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
  const servicos: ServicoDoContrato[] = [];
  const semBloco: string[] = [];
  Object.keys(o).forEach((k) => {
    if (o[k] !== true || k === "internal_company") return;
    const b = BLOCO_DO_SERVICO_ATIVO[k];
    if (b) servicos.push(b);
    else if (b === null) semBloco.push(k);
  });
  return { servicos: servicosEmOrdem(servicos), semBloco };
}

// ------------------------------------------------------------------ quem assina

export type Signatario = {
  id?: string;
  papel: "contratante" | "testemunha";
  nome: string;
  email: string;
  documento: string;
  obrigatorio: boolean;
  ordem: number;
  principal?: boolean;
  assinado_em?: string | null;
  token?: string | null;
};

export const MAX_CONTRATANTES = 5;
export const MAX_TESTEMUNHAS = 2;
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/** Limpa e confere a lista que a tela mandou. Erro vira mensagem; nada é inventado. */
export function validarSignatarios(bruto: unknown): { lista: Signatario[]; erros: string[] } {
  const entrada = Array.isArray(bruto) ? bruto : [];
  const erros: string[] = [];
  const lista: Signatario[] = [];
  const emails: Record<string, boolean> = {};
  entrada.forEach((x, i) => {
    const o = x && typeof x === "object" ? (x as Record<string, unknown>) : {};
    const papel = o.papel === "testemunha" ? "testemunha" : "contratante";
    const nome = txt(o.nome).slice(0, 200);
    const email = txt(o.email).toLowerCase().slice(0, 254);
    const documento = String(o.documento == null ? "" : o.documento).replace(/\D/g, "");
    const quem = `${papel === "testemunha" ? "Testemunha" : "Signatário"} ${i + 1}`;
    if (nome.length < 3) erros.push(`${quem}: escreva o nome completo.`);
    if (!EMAIL.test(email)) erros.push(`${quem}: e-mail inválido (a assinatura chega por link).`);
    else if (emails[email]) erros.push(`${quem}: e-mail repetido.`);
    emails[email] = true;
    if (documento && !cpfValido(documento)) erros.push(`${quem}: CPF inválido.`);
    if (papel === "testemunha" && !documento) erros.push(`${quem}: testemunha precisa do CPF.`);
    lista.push({ papel, nome, email, documento, obrigatorio: o.obrigatorio !== false, ordem: i + 1 });
  });
  // Com lista, o primeiro do contratante é o principal (usa o link de sempre); sem ninguém do contratante, não fecha.
  if (lista.length && !lista.some((s) => s.papel === "contratante")) erros.push("Inclua pelo menos uma pessoa que assina pelo contratante.");
  const primeiro = lista.filter((s) => s.papel === "contratante")[0];
  if (primeiro) {
    primeiro.principal = true;
    primeiro.obrigatorio = true;
  }
  if (lista.filter((s) => s.papel === "contratante").length > MAX_CONTRATANTES) erros.push(`No máximo ${MAX_CONTRATANTES} signatários do contratante.`);
  if (lista.filter((s) => s.papel === "testemunha").length > MAX_TESTEMUNHAS) erros.push(`No máximo ${MAX_TESTEMUNHAS} testemunhas.`);
  return { lista, erros };
}

/** Quem ainda precisa assinar para o contrato fechar. */
export function faltamAssinar(lista: Signatario[]): Signatario[] {
  return lista.filter((s) => s.obrigatorio && !s.assinado_em);
}

export function paraOTexto(lista: Signatario[]): SignatarioNoTexto[] {
  return lista.slice().sort((a, b) => a.ordem - b.ordem).map((s) => ({ papel: s.papel, nome: s.nome, email: s.email, documento: s.documento }));
}
