/**
 * Contratos da Aceleriq montados por modelo (frente CON, 30/09/2026).
 *
 * Três camadas (plano p1-documentos, seção 3.2):
 * A. quadro-resumo: tudo o que varia (partes, serviços, valores, prazos,
 *    revisões, direitos, portfólio, IA, anexos), montado aqui pelo código;
 * B. condições gerais: texto fixo com versão (contrato_modelos, tipo
 *    condicoes_gerais), que o agente nunca reescreve sozinho;
 * C. blocos por serviço (anexos): social, site, marca, naming, tráfego,
 *    vídeo, design pontual e mensalista, cada um com as suas variáveis.
 *
 * Regras que moram aqui (e que os testes conferem):
 * - variável obrigatória vazia ou inválida bloqueia o congelamento;
 * - sem os dados da agência (agencia_dados) o contrato não é gerado;
 * - valor por extenso, datas e números saem do código, nunca do modelo;
 * - cláusula só muda por "cláusula alterada" (com a diferença mostrada e
 *   confirmada); o texto do cliente nunca leva a marca de revisão jurídica;
 * - o documento congelado é um texto canônico: o hash SHA-256 dele é o
 *   código de integridade mostrado ao cliente e conferido pelo banco.
 *
 * Formato do texto canônico (uma linha por bloco, lido por lerDocumento):
 *   "# "  título do documento        "## "  seção      "### "  cláusula
 *   "@ "  linha de identificação     "| rótulo | valor"  linha do quadro
 *   "- "  item de lista               demais linhas: parágrafo
 *
 * Puro: sem Deno, sem npm, sem Supabase. A tela, a Edge Function e os testes
 * leem o mesmo arquivo. Compatível com Safari 11. Sem travessão.
 */

// ------------------------------------------------------------------ serviços

export const SERVICOS_DO_CONTRATO = ["social", "site", "marca", "naming", "trafego", "video", "design", "mensalista"] as const;
export type ServicoDoContrato = (typeof SERVICOS_DO_CONTRATO)[number];

export const ROTULO_DO_SERVICO: Record<ServicoDoContrato, string> = {
  social: "Social e Instagram",
  site: "Sites e landing pages",
  marca: "Marca e identidade visual",
  naming: "Naming",
  trafego: "Tráfego pago",
  video: "Vídeo e motion",
  design: "Design pontual",
  mensalista: "Mensalista (fee mensal)",
};

/** O que cada serviço é, numa frase (vai para o Jev escolher os blocos e para a tela). */
export const DESCRICAO_DO_SERVICO: Record<ServicoDoContrato, string> = {
  social: "gestão de redes sociais: planejamento, criação e publicação de posts, carrosséis, reels e stories no Instagram ou outras redes, com entrega mensal",
  site: "criação de site, landing page, página de vendas ou loja virtual, com layout e desenvolvimento",
  marca: "criação de marca, logotipo, identidade visual, manual da marca, brandbook ou papelaria",
  naming: "criação do nome de uma empresa, produto ou marca (naming)",
  trafego: "gestão de tráfego pago: anúncios no Meta Ads, Google Ads ou TikTok Ads, com verba paga pelo cliente",
  video: "produção de vídeos, reels roteirizados, motion design, animação ou captação e edição de vídeo",
  design: "design de peças pontuais: cartão, folder, banner, apresentação, cardápio, embalagem ou arte avulsa",
  mensalista: "pacote mensal de design ou horas de criação sob demanda (fee mensal), sem ser gestão de redes",
};

/** Serviços cobrados por mês (valor mensal, vencimento e vigência). Os outros são projeto (valor total). */
export const SERVICOS_RECORRENTES: ServicoDoContrato[] = ["social", "trafego", "mensalista"];

export function ehServico(v: unknown): v is ServicoDoContrato {
  return typeof v === "string" && (SERVICOS_DO_CONTRATO as readonly string[]).indexOf(v) >= 0;
}

/** Na ordem oficial (a ordem dos anexos), sem repetição e sem o que não é serviço. */
export function servicosEmOrdem(lista: unknown): ServicoDoContrato[] {
  const vistos = Array.isArray(lista) ? lista.map(String) : [];
  return SERVICOS_DO_CONTRATO.filter((s) => vistos.indexOf(s) >= 0);
}

// ------------------------------------------------------------------ direitos autorais

export type RegraDeDireitos = "cessao" | "licenca";

/** Padrão sugerido por serviço (decisão do dono: escolhido em cada contrato; o padrão é por serviço). */
export const DIREITOS_PADRAO: Record<ServicoDoContrato, RegraDeDireitos> = {
  social: "cessao",
  site: "licenca",
  marca: "cessao",
  naming: "cessao",
  trafego: "cessao",
  video: "cessao",
  design: "cessao",
  mensalista: "cessao",
};

export const ROTULO_DOS_DIREITOS: Record<RegraDeDireitos, string> = {
  cessao: "cessão dos direitos patrimoniais após o pagamento",
  licenca: "licença de uso",
};

export const variavelDeDireitos = (s: ServicoDoContrato) => `direitos_${s}`;

// ------------------------------------------------------------------ modelo como dados

export type TipoDeVariavel = "texto" | "textoLongo" | "moeda" | "inteiro" | "percentual" | "data" | "escolha";

export type OpcaoDaVariavel = { valor: string; rotulo: string };

export type VariavelDoModelo = {
  nome: string;
  rotulo: string;
  tipo: TipoDeVariavel;
  obrigatoria?: boolean;
  /** Valor sugerido (decisão do dono). Vazio: o agente pergunta. */
  padrao?: string;
  opcoes?: OpcaoDaVariavel[];
  /** O último valor usado pela agência vira o padrão do próximo contrato (o agente aprende). */
  lembrar?: boolean;
  /** Onde aparece na tela: quadro (condições), cliente (partes), serviço, cláusulas extras ou aditivo (frente CON2). */
  grupo?: "quadro" | "cliente" | "servico" | "extras" | "aditivo";
  ajuda?: string;
  /** Número que conta palavra feminina (rodadas, horas, diárias): "2 (duas)". */
  feminino?: boolean;
};

export type CondicaoDaClausula = { variavel: string; igual?: string; diferente?: string; preenchida?: boolean };

export type ClausulaDoModelo = {
  chave: string;
  titulo: string;
  /** Texto com {{variavel}}. Parágrafos separados por linha; "- " no começo vira item de lista. */
  texto: string;
  /** Só entra quando a condição vale (variantes: silêncio, portfólio, IA, direitos...). */
  quando?: CondicaoDaClausula;
};

export type ModeloDeContrato = {
  chave: string;
  /** extras: biblioteca de cláusulas que o dono liga por contrato; aditivo: o termo aditivo (frente CON2). */
  tipo: "condicoes_gerais" | "bloco" | "extras" | "aditivo";
  servico: ServicoDoContrato | null;
  nome: string;
  versao: number;
  /** Só a equipe vê. Nunca entra no documento do cliente. */
  revisao_juridica: string;
  variaveis: VariavelDoModelo[];
  clausulas: ClausulaDoModelo[];
};

export type Valores = Record<string, string>;

// ------------------------------------------------------------------ partes

export type DadosDaAgencia = {
  razao_social: string;
  nome_fantasia: string;
  cnpj: string;
  endereco: string;
  cidade: string;
  uf: string;
  representante: string;
  representante_cpf: string;
  email: string;
  foro: string;
};

export const CAMPOS_OBRIGATORIOS_DA_AGENCIA: Array<{ campo: keyof DadosDaAgencia; rotulo: string }> = [
  { campo: "razao_social", rotulo: "razão social" },
  { campo: "cnpj", rotulo: "CNPJ" },
  { campo: "endereco", rotulo: "endereço da sede" },
  { campo: "cidade", rotulo: "cidade da sede" },
  { campo: "uf", rotulo: "UF da sede" },
  { campo: "representante", rotulo: "representante legal" },
  { campo: "foro", rotulo: "comarca do foro" },
];

const txt = (v: unknown) => (v === null || v === undefined ? "" : String(v)).replace(/\s+/g, " ").trim();
const primeiro = (o: Record<string, unknown>, nomes: string[]) => {
  for (const n of nomes) {
    const v = txt(o[n]);
    if (v) return v;
  }
  return "";
};

/**
 * Lê a linha de agencia_dados (frente BASE) sem depender do nome exato das
 * colunas. Endereço em partes (logradouro, número, bairro, CEP) vira uma linha.
 */
export function agenciaDoRegistro(bruto: unknown): DadosDaAgencia {
  const o = bruto && typeof bruto === "object" ? (bruto as Record<string, unknown>) : {};
  const partes = [primeiro(o, ["logradouro", "rua"]), primeiro(o, ["numero", "endereco_numero"]), primeiro(o, ["complemento"]), primeiro(o, ["bairro"])].filter(Boolean);
  const cep = primeiro(o, ["cep"]);
  // Endereço de várias linhas (a ficha da frente BASE guarda assim) vira uma linha com vírgulas.
  const enderecoInteiro = String(o.endereco || o.endereco_completo || o.sede_endereco || "").split("\n").map((x) => x.trim()).filter(Boolean).join(", ");
  const endereco = txt(enderecoInteiro) || [partes.join(", "), cep ? `CEP ${cep}` : ""].filter(Boolean).join(", ");
  const cidade = primeiro(o, ["cidade", "sede_cidade", "municipio"]);
  return {
    razao_social: primeiro(o, ["razao_social", "nome_empresarial", "razao"]),
    nome_fantasia: primeiro(o, ["nome_fantasia", "nome", "marca"]),
    cnpj: primeiro(o, ["cnpj", "documento"]),
    endereco,
    cidade,
    uf: primeiro(o, ["uf", "estado", "sede_uf"]).toUpperCase().slice(0, 2),
    representante: primeiro(o, ["representante", "representante_legal", "representante_nome", "responsavel"]),
    representante_cpf: primeiro(o, ["representante_cpf", "cpf_representante"]),
    email: primeiro(o, ["email", "email_contato", "email_contratos"]),
    foro: primeiro(o, ["foro", "foro_comarca", "comarca", "comarca_foro"]) || "",
  };
}

/** O que falta na ficha da agência para gerar contrato (rótulos). Vazio: pode gerar. */
export function faltandoNaAgencia(a: DadosDaAgencia | null | undefined): string[] {
  if (!a) return CAMPOS_OBRIGATORIOS_DA_AGENCIA.map((c) => c.rotulo);
  return CAMPOS_OBRIGATORIOS_DA_AGENCIA.filter((c) => !txt(a[c.campo])).map((c) => c.rotulo);
}

export type DadosDoCliente = {
  nome: string;
  documento: string;
  tipo_pessoa: "pf" | "mei" | "pj";
  endereco: string;
  representante: string;
  email: string;
  telefone: string;
};

/** CPF (11 dígitos) ou CNPJ (14). O tipo de pessoa sai do documento quando dá. */
export function tipoDoDocumento(doc: string): "cpf" | "cnpj" | null {
  const d = String(doc || "").replace(/\D/g, "");
  if (d.length === 11) return "cpf";
  if (d.length === 14) return "cnpj";
  return null;
}

/** 11222333000144 vira 11.222.333/0001-44 (CPF: 123.456.789-01). Outro formato fica como veio. */
export function formatarDocumento(doc: string): string {
  const d = String(doc || "").replace(/\D/g, "");
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
  return String(doc || "").trim();
}

/** Valores do contrato que vêm do cadastro do cliente (a equipe pode corrigir no contrato). */
export function valoresDoCliente(c: Partial<DadosDoCliente>): Valores {
  const v: Valores = {};
  const por = (nome: string, valor: unknown) => {
    const t = txt(valor);
    if (t) v[nome] = t;
  };
  por("cliente_nome", c.nome);
  por("cliente_documento", formatarDocumento(String(c.documento || "")));
  por("cliente_endereco", c.endereco);
  por("cliente_representante", c.representante);
  por("cliente_email", c.email);
  const tipo = c.tipo_pessoa || (tipoDoDocumento(String(c.documento || "")) === "cpf" ? "pf" : tipoDoDocumento(String(c.documento || "")) === "cnpj" ? "pj" : "");
  if (tipo) v.cliente_tipo_pessoa = tipo;
  return v;
}

// ------------------------------------------------------------------ números por extenso (código, nunca o modelo)

const UNIDADES = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "catorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
const CENTENAS = ["", "cento", "duzentos", "trezentos", "quatrocentos", "quinhentos", "seiscentos", "setecentos", "oitocentos", "novecentos"];

function ate999(n: number, feminino = false): string {
  if (n === 0) return "";
  if (n === 100) return "cem";
  const c = Math.floor(n / 100);
  const resto = n % 100;
  const unidade = (u: number) => (feminino && u === 1 ? "uma" : feminino && u === 2 ? "duas" : UNIDADES[u]);
  const partes: string[] = [];
  if (c) partes.push(feminino && c > 1 ? CENTENAS[c].replace(/os$/, "as") : CENTENAS[c]);
  if (resto) {
    if (resto < 20) partes.push(unidade(resto));
    else {
      const d = Math.floor(resto / 10);
      const u = resto % 10;
      partes.push(u ? `${DEZENAS[d]} e ${unidade(u)}` : DEZENAS[d]);
    }
  }
  return partes.join(" e ");
}

/** Inteiro por extenso ("mil e quinhentos", "dois milhões"; "duas" com palavra feminina). Até 999 bilhões. */
export function extensoInteiro(valor: number, feminino = false): string {
  const n = Math.floor(Math.abs(Number(valor) || 0));
  if (n === 0) return "zero";
  const grupos: number[] = [];
  let r = n;
  while (r > 0) {
    grupos.push(r % 1000);
    r = Math.floor(r / 1000);
  }
  const nomes: Array<[string, string]> = [["", ""], ["mil", "mil"], ["milhão", "milhões"], ["bilhão", "bilhões"]];
  const partes: Array<{ texto: string; valor: number }> = [];
  for (let i = grupos.length - 1; i >= 0; i--) {
    const g = grupos[i];
    if (!g) continue;
    let t: string;
    if (i === 1) t = g === 1 ? "mil" : `${ate999(g, feminino)} mil`;
    else if (i >= 2) t = `${ate999(g)} ${g === 1 ? nomes[i][0] : nomes[i][1]}`;
    else t = ate999(g, feminino);
    partes.push({ texto: t, valor: g });
  }
  // "e" antes do último grupo quando ele é menor que 100 ou centena redonda (mil e quinhentos, mil e cem).
  let saida = "";
  partes.forEach((p, i) => {
    if (i === 0) saida = p.texto;
    else {
      const ultimo = i === partes.length - 1;
      const liga = ultimo && (p.valor < 100 || p.valor % 100 === 0);
      saida += liga ? ` e ${p.texto}` : `, ${p.texto}`;
    }
  });
  return saida;
}

/** Valor em reais por extenso: "oito mil reais", "um real e cinquenta centavos". */
export function extensoEmReais(valor: number): string {
  const v = Math.round(Math.abs(Number(valor) || 0) * 100);
  const reais = Math.floor(v / 100);
  const centavos = v % 100;
  const partes: string[] = [];
  if (reais) {
    const t = extensoInteiro(reais);
    // "de reais" depois de milhão/bilhão redondo.
    const redondo = reais >= 1_000_000 && reais % 1_000_000 === 0;
    partes.push(`${t}${redondo ? " de" : ""} ${reais === 1 ? "real" : "reais"}`);
  }
  if (centavos) partes.push(`${extensoInteiro(centavos)} ${centavos === 1 ? "centavo" : "centavos"}`);
  return partes.length ? partes.join(" e ") : "zero real";
}

/** "8.000,00" com separador de milhar e duas casas (sem Intl, igual em todo lugar). */
export function numeroBr(valor: number, casas = 2): string {
  const neg = valor < 0;
  const fixo = Math.abs(valor).toFixed(casas);
  const partes = fixo.split(".");
  const inteiro = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${neg ? "-" : ""}${inteiro}${casas ? `,${partes[1]}` : ""}`;
}

export function moedaBr(valor: number): string {
  return `R$ ${numeroBr(valor, 2)}`;
}

/** Lê "8000", "8.000,50", "R$ 8.000", "8000.5". Null quando não é um valor. */
export function lerMoeda(bruto: unknown): number | null {
  let s = String(bruto == null ? "" : bruto).replace(/R\$|\s/gi, "").trim();
  if (!s) return null;
  if (s.indexOf(",") >= 0) s = s.replace(/\./g, "").replace(",", ".");
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, "");
  else if (/^\d{1,3}\.\d{3}$/.test(s)) s = s.replace(".", "");
  if (!/^-?\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
}

function lerInteiro(bruto: unknown): number | null {
  const s = String(bruto == null ? "" : bruto).replace(/[%\s]/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return isFinite(n) ? n : null;
}

// ------------------------------------------------------------------ datas (fuso de São Paulo, sem horário de verão desde 2019)

export const MESES_DO_ANO = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

/** Data de hoje em São Paulo, AAAA-MM-DD. */
export function hojeEmSaoPaulo(agora: Date = new Date()): string {
  const d = new Date(agora.getTime() - 3 * 3600 * 1000);
  const dois = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${d.getUTCFullYear()}-${dois(d.getUTCMonth() + 1)}-${dois(d.getUTCDate())}`;
}

function lerData(bruto: unknown): { a: number; m: number; d: number } | null {
  const s = String(bruto == null ? "" : bruto).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return validarData(Number(m[1]), Number(m[2]), Number(m[3]));
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s);
  if (m) return validarData(Number(m[3]), Number(m[2]), Number(m[1]));
  return null;
}

function validarData(a: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1 || d > 31 || a < 2000 || a > 2100) return null;
  const t = new Date(Date.UTC(a, m - 1, d));
  return t.getUTCMonth() === m - 1 ? { a, m, d } : null;
}

/** "1º de outubro de 2026". */
export function dataPorExtenso(bruto: unknown): string {
  const x = lerData(bruto);
  if (!x) return String(bruto || "");
  return `${x.d === 1 ? "1º" : x.d} de ${MESES_DO_ANO[x.m - 1]} de ${x.a}`;
}

// ------------------------------------------------------------------ valores: validação e formatação

/** Motivo quando o valor não serve para o tipo (null quando serve ou está vazio). */
export function valorInvalido(v: VariavelDoModelo, bruto: unknown): string | null {
  const s = txt(bruto);
  if (!s) return null;
  switch (v.tipo) {
    case "moeda":
      return lerMoeda(s) === null ? "valor em reais inválido" : null;
    case "inteiro":
    case "percentual": {
      const n = lerInteiro(s);
      if (n === null) return "número inválido";
      if (v.tipo === "percentual" && n > 100) return "percentual acima de 100";
      return null;
    }
    case "data":
      return lerData(s) ? null : "data inválida (use AAAA-MM-DD ou DD/MM/AAAA)";
    case "escolha":
      return (v.opcoes || []).some((o) => o.valor === s) ? null : `escolha entre: ${(v.opcoes || []).map((o) => o.rotulo).join(", ")}`;
    default:
      return s.length > 4000 ? "texto longo demais" : null;
  }
}

/** Valor como entra no texto do contrato. */
export function formatarValor(v: VariavelDoModelo, bruto: unknown): string {
  const s = txt(bruto);
  if (!s) return "";
  switch (v.tipo) {
    case "moeda": {
      const n = lerMoeda(s);
      return n === null ? s : `${moedaBr(n)} (${extensoEmReais(n)})`;
    }
    case "inteiro": {
      const n = lerInteiro(s);
      return n === null ? s : `${n} (${extensoInteiro(n, !!v.feminino)})`;
    }
    case "percentual": {
      const n = lerInteiro(s);
      return n === null ? s : `${numeroBr(n, n % 1 ? 1 : 0)}% (${extensoInteiro(n)} por cento)`;
    }
    case "data":
      return dataPorExtenso(s);
    case "escolha": {
      const o = (v.opcoes || []).find((x) => x.valor === s);
      return o ? o.rotulo : s;
    }
    default:
      return String(bruto).trim();
  }
}

// ------------------------------------------------------------------ montagem

export type ClausulaAlterada = {
  /** "<modelo>:<cláusula>", ex.: "condicoes_gerais:revisoes". */
  chave: string;
  texto: string;
  texto_original: string;
  motivo?: string | null;
  confirmada_por?: string | null;
  confirmada_em?: string | null;
};

export type EntradaDaMontagem = {
  modelos: ModeloDeContrato[];
  servicos: ServicoDoContrato[];
  valores: Valores;
  agencia: DadosDaAgencia;
  numero: string;
  versao: number;
  /** AAAA-MM-DD (data do documento; no congelamento, a do dia). */
  data: string;
  titulo?: string | null;
  /**
   * Qualificação da contratada pronta (qualificacaoDaContratada da frente
   * BASE, em _shared/dados-da-agencia.ts). Sem ela, o quadro monta a linha
   * com os campos da agência.
   */
  qualificacao?: string | null;
  alteradas?: ClausulaAlterada[];
  /** Quem assina pelo contratante e as testemunhas (frente CON2). Sem lista, a seção de assinaturas fica como antes. */
  signatarios?: SignatarioNoTexto[];
};

export type SignatarioNoTexto = { papel: "contratante" | "testemunha"; nome: string; email?: string | null; documento?: string | null };

export type FaltaNoContrato = { nome: string; rotulo: string; motivo: "vazia" | "invalida"; detalhe?: string; onde: string };

export type ClausulaMontada = {
  chave: string;
  modelo: string;
  numero: string;
  titulo: string;
  texto: string;
  texto_modelo: string;
  alterada: boolean;
};

export type ContratoMontado = {
  texto: string;
  faltando: FaltaNoContrato[];
  clausulas: ClausulaMontada[];
  variaveis: VariavelDoModelo[];
  valores: Valores;
};

export const TITULO_PADRAO = "Contrato de prestação de serviços";
const LETRAS = "ABCDEFGHIJ";

export function modeloGeral(modelos: ModeloDeContrato[]): ModeloDeContrato | null {
  return modelos.find((m) => m.tipo === "condicoes_gerais") || null;
}

export function modeloDoServico(modelos: ModeloDeContrato[], s: ServicoDoContrato): ModeloDeContrato | null {
  return modelos.find((m) => m.tipo === "bloco" && m.servico === s) || null;
}

/** Biblioteca de cláusulas extras (frente CON2): cada cláusula entra quando o dono liga a chave dela. */
export function modeloExtras(modelos: ModeloDeContrato[]): ModeloDeContrato | null {
  return modelos.find((m) => m.tipo === "extras") || null;
}

/** O termo aditivo (frente CON2). */
export function modeloAditivo(modelos: ModeloDeContrato[]): ModeloDeContrato | null {
  return modelos.find((m) => m.tipo === "aditivo") || null;
}

/** As variáveis que valem para estes serviços (condições gerais primeiro, sem repetir nome). */
export function variaveisDoContrato(modelos: ModeloDeContrato[], servicos: ServicoDoContrato[]): VariavelDoModelo[] {
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
  if (g) juntar(g.variaveis);
  const x = modeloExtras(modelos);
  if (x) juntar(x.variaveis);
  for (const s of servicosEmOrdem(servicos)) {
    const m = modeloDoServico(modelos, s);
    if (m) juntar(m.variaveis);
  }
  return saida;
}

/** Padrões (do modelo e do que a agência usou por último) por baixo do que a equipe preencheu. */
export function valoresComPadrao(variaveis: VariavelDoModelo[], valores: Valores, lembrados: Valores = {}): Valores {
  const saida: Valores = {};
  for (const v of variaveis) {
    const dado = txt(valores[v.nome]);
    if (dado) saida[v.nome] = String(valores[v.nome]).trim();
    else if (v.lembrar && txt(lembrados[v.nome])) saida[v.nome] = txt(lembrados[v.nome]);
    else if (v.padrao !== undefined && v.padrao !== "") saida[v.nome] = v.padrao;
  }
  // Valores de fora das variáveis (ex.: cliente_* sem modelo) ficam.
  Object.keys(valores).forEach((k) => {
    if (saida[k] === undefined && txt(valores[k])) saida[k] = String(valores[k]).trim();
  });
  return saida;
}

export function valeACondicao(c: CondicaoDaClausula | undefined, valores: Valores): boolean {
  if (!c) return true;
  const v = txt(valores[c.variavel]);
  if (c.preenchida === true && !v) return false;
  if (c.preenchida === false && v) return false;
  if (c.igual !== undefined && v !== c.igual) return false;
  if (c.diferente !== undefined && v === c.diferente) return false;
  return true;
}

const MARCA = /\{\{\s*([a-z0-9_]+)\s*\}\}/g;

/** Nomes citados num texto de modelo. */
export function variaveisDoTexto(texto: string): string[] {
  const nomes: string[] = [];
  const re = new RegExp(MARCA.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(String(texto || "")))) if (nomes.indexOf(m[1]) < 0) nomes.push(m[1]);
  return nomes;
}

export type ContextoDaMontagem = {
  porNome: Record<string, VariavelDoModelo>;
  valores: Valores;
  agencia: DadosDaAgencia;
  faltando: FaltaNoContrato[];
};
type Contexto = ContextoDaMontagem;

/** Contexto da montagem (o aditivo usa o mesmo preenchimento do contrato). */
export function contextoDaMontagem(variaveis: VariavelDoModelo[], valores: Valores, agencia: DadosDaAgencia): ContextoDaMontagem {
  const porNome: Record<string, VariavelDoModelo> = {};
  variaveis.forEach((v) => (porNome[v.nome] = v));
  return { porNome, valores, agencia, faltando: [] };
}

export function anotarFalta(ctx: Contexto, nome: string, onde: string, motivo: "vazia" | "invalida", detalhe?: string) {
  if (ctx.faltando.some((f) => f.nome === nome)) return;
  const v = ctx.porNome[nome];
  ctx.faltando.push({ nome, rotulo: v ? v.rotulo : nome.replace(/_/g, " "), motivo, detalhe, onde });
}

/** Troca as {{variáveis}}. O que falta vira "[falta: rótulo]" (só aparece na prévia; não congela). */
export function preencher(texto: string, ctx: Contexto, onde: string): string {
  return String(texto || "").replace(new RegExp(MARCA.source, "g"), (_m, nome: string) => {
    if (nome.indexOf("agencia_") === 0) {
      const campo = nome.slice("agencia_".length) as keyof DadosDaAgencia;
      const val = txt(ctx.agencia[campo]);
      if (!val) anotarFalta(ctx, nome, "dados da agência", "vazia");
      return val || `[falta: ${nome.replace(/_/g, " ")}]`;
    }
    const v = ctx.porNome[nome];
    const bruto = ctx.valores[nome];
    if (!txt(bruto)) {
      anotarFalta(ctx, nome, onde, "vazia");
      return `[falta: ${v ? v.rotulo : nome}]`;
    }
    if (v) {
      const erro = valorInvalido(v, bruto);
      if (erro) {
        anotarFalta(ctx, nome, onde, "invalida", erro);
        return `[corrigir: ${v.rotulo}]`;
      }
      return formatarValor(v, bruto);
    }
    return txt(bruto);
  });
}

/** Linhas de uma cláusula: parágrafos numerados (n.1, n.2) quando há mais de um; "- " vira item. */
export function linhasDaClausula(numero: string, texto: string): string[] {
  const linhas = texto.split("\n").map((l) => l.replace(/\s+$/g, "")).filter((l) => l.trim());
  const paragrafos = linhas.filter((l) => l.indexOf("- ") !== 0);
  let k = 0;
  return linhas.map((l) => {
    if (l.indexOf("- ") === 0) return l;
    k++;
    return paragrafos.length > 1 ? `${numero}.${k} ${l.trim()}` : l.trim();
  });
}

export const CHAVE_DA_ALTERADA = (modelo: string, clausula: string) => `${modelo}:${clausula}`;

/** Quadro-resumo: tudo que varia, em linhas "| rótulo | valor". */
function quadroResumo(e: EntradaDaMontagem, ctx: Contexto, servicos: ServicoDoContrato[]): string[] {
  const a = e.agencia;
  const v = ctx.valores;
  const l = (rotulo: string, valor: string) => `| ${rotulo} | ${valor.replace(/\|/g, "/")}`;
  const linhas: string[] = [];
  const p = (t: string) => preencher(t, ctx, "quadro-resumo");
  if (txt(e.qualificacao)) linhas.push(l("Contratada", `${txt(e.qualificacao)}.`));
  else linhas.push(l("Contratada", `${txt(a.razao_social)}${a.nome_fantasia && a.nome_fantasia !== a.razao_social ? ` (${a.nome_fantasia})` : ""}, CNPJ ${txt(a.cnpj)}, com sede em ${txt(a.endereco)}, ${txt(a.cidade)}/${txt(a.uf)}, representada por ${txt(a.representante)}${a.representante_cpf ? `, CPF ${a.representante_cpf}` : ""}.`));
  const doc = tipoDoDocumento(v.cliente_documento || "") === "cpf" ? "CPF" : tipoDoDocumento(v.cliente_documento || "") === "cnpj" ? "CNPJ" : "CPF/CNPJ";
  const rep = txt(v.cliente_representante) ? `, representada por ${txt(v.cliente_representante)}` : "";
  linhas.push(l("Contratante", `${p("{{cliente_nome}}")}, ${doc} ${p("{{cliente_documento}}")}, com endereço em ${p("{{cliente_endereco}}")}${rep}. E-mail do canal oficial: ${p("{{cliente_email}}")}.`));
  linhas.push(l("Serviços", servicos.map((s, i) => `${ROTULO_DO_SERVICO[s]} (Anexo ${LETRAS[i]})`).join("; ") + "."));
  const recorrentes = servicos.filter((s) => SERVICOS_RECORRENTES.indexOf(s) >= 0);
  const projetos = servicos.filter((s) => SERVICOS_RECORRENTES.indexOf(s) < 0);
  const valor: string[] = [];
  if (projetos.length) valor.push(p("Projeto: {{valor_total}}, pago assim: {{condicoes_pagamento}}."));
  if (recorrentes.length) valor.push(p("Mensal: {{valor_mensal}} por mês, com vencimento no dia {{vencimento_dia}} de cada mês."));
  linhas.push(l("Valor", valor.join(" ")));
  linhas.push(l("Forma de pagamento", p("{{forma_pagamento}}.")));
  const vigencia = [p("Início em {{inicio}}.")];
  if (recorrentes.length) vigencia.push(p("Serviços mensais por {{vigencia_meses}} meses, com renovação automática por períodos iguais."));
  linhas.push(l("Início e vigência", vigencia.join(" ")));
  linhas.push(l("Revisões", p("{{revisoes_rodadas}} rodadas por entrega; rodada extra por hora técnica de {{valor_hora_extra}}.")));
  const silencio = v.silencio_efeito === "aprovacao_tacita" ? "sem resposta depois do lembrete, a entrega é considerada aprovada" : "sem resposta, o cronograma fica suspenso até a resposta";
  linhas.push(l("Resposta do contratante", `${p("{{prazo_resposta_dias}}")} dias úteis; ${silencio}.`));
  linhas.push(l("Direitos autorais", servicos.map((s) => {
    const regra = v[variavelDeDireitos(s)] === "licenca" ? "licenca" : v[variavelDeDireitos(s)] === "cessao" ? "cessao" : null;
    if (!regra) anotarFalta(ctx, variavelDeDireitos(s), ROTULO_DO_SERVICO[s], "vazia");
    return `${ROTULO_DO_SERVICO[s]}: ${regra ? ROTULO_DOS_DIREITOS[regra] : "[falta: regra de direitos]"}`;
  }).join("; ") + "."));
  linhas.push(l("Portfólio", v.portfolio === "nao" ? "Não, sem autorização escrita do contratante." : "Sim, depois da publicação pelo contratante."));
  linhas.push(l("Uso de IA", v.uso_ia === "nao" ? "Não, a criação é feita sem IA generativa." : "Sim, como apoio, com curadoria e aprovação final feitas por pessoas."));
  const anexos = servicos.map((s, i) => `Anexo ${LETRAS[i]}, ${ROTULO_DO_SERVICO[s]}`);
  if (txt(v.proposta_numero)) anexos.push(`proposta comercial nº ${txt(v.proposta_numero)}`);
  linhas.push(l("Anexos", `${anexos.join("; ")}.`));
  // Renovação (frente CON2): o código escreve de onde o contrato vem.
  if (txt(v.renova_contrato_numero)) linhas.push(l("Renovação", `Renova o contrato nº ${txt(v.renova_contrato_numero)}${txt(v.renova_contrato_fim) ? `, que termina em ${dataPorExtenso(v.renova_contrato_fim)}` : ""}.`));
  return linhas;
}

/** Linhas de quem assina (frente CON2): pelo contratante e as testemunhas. */
export function linhasDosSignatarios(lista: SignatarioNoTexto[] | undefined): string[] {
  const s = (lista || []).filter((x) => x && txt(x.nome));
  if (!s.length) return [];
  const linhas: string[] = [];
  s.filter((x) => x.papel === "contratante").forEach((x) => linhas.push(`- Pelo CONTRATANTE: ${txt(x.nome)}${txt(x.email) ? `, ${txt(x.email)}` : ""}.`));
  s.filter((x) => x.papel === "testemunha").forEach((x) => linhas.push(`- Testemunha: ${txt(x.nome)}${txt(x.documento) ? `, CPF ${formatarDocumento(String(x.documento))}` : ""}${txt(x.email) ? `, ${txt(x.email)}` : ""}.`));
  return linhas;
}

/**
 * Monta o contrato inteiro (texto canônico) e diz o que falta. Não inventa
 * nada: variável sem valor aparece como "[falta: ...]" e entra em `faltando`.
 */
export function montarContrato(e: EntradaDaMontagem): ContratoMontado {
  const servicos = servicosEmOrdem(e.servicos);
  const variaveis = variaveisDoContrato(e.modelos, servicos);
  const porNome: Record<string, VariavelDoModelo> = {};
  variaveis.forEach((v) => (porNome[v.nome] = v));
  const valores = e.valores;
  const ctx: Contexto = { porNome, valores, agencia: e.agencia, faltando: [] };
  const alteradas: Record<string, ClausulaAlterada> = {};
  (e.alteradas || []).forEach((a) => (alteradas[a.chave] = a));

  // Obrigatórias vazias, mesmo quando o texto não as cita, e valores inválidos.
  for (const v of variaveis) {
    const bruto = valores[v.nome];
    if (!txt(bruto)) {
      if (v.obrigatoria) anotarFalta(ctx, v.nome, v.grupo === "servico" ? "serviço" : "quadro-resumo", "vazia");
    } else {
      const erro = valorInvalido(v, bruto);
      if (erro) anotarFalta(ctx, v.nome, "valor", "invalida", erro);
    }
  }
  if (!servicos.length) ctx.faltando.push({ nome: "servicos", rotulo: "serviços do contrato", motivo: "vazia", onde: "quadro-resumo" });

  const linhas: string[] = [];
  linhas.push(`# ${txt(e.titulo) || TITULO_PADRAO}`);
  linhas.push(`@ Contrato nº ${txt(e.numero) || "a definir"}, versão ${Number(e.versao) || 1}. ${txt(e.agencia.cidade) || "[falta: cidade]"}/${txt(e.agencia.uf)}, ${dataPorExtenso(e.data)}.`);
  linhas.push("## Quadro-resumo");
  linhas.push(...quadroResumo(e, ctx, servicos));

  const clausulas: ClausulaMontada[] = [];
  const secao = (modelo: ModeloDeContrato, prefixo: string, separador: string, inicio = 0): number => {
    let n = inicio;
    for (const c of modelo.clausulas) {
      if (!valeACondicao(c.quando, valores)) continue;
      n++;
      const numero = `${prefixo}${n}`;
      const alterada = alteradas[CHAVE_DA_ALTERADA(modelo.chave, c.chave)];
      const base = alterada ? alterada.texto : c.texto;
      const texto = preencher(base, ctx, modelo.nome);
      linhas.push(`### ${numero}${separador}${c.titulo}`);
      linhas.push(...linhasDaClausula(numero, texto));
      clausulas.push({ chave: CHAVE_DA_ALTERADA(modelo.chave, c.chave), modelo: modelo.chave, numero, titulo: c.titulo, texto, texto_modelo: c.texto, alterada: !!alterada });
    }
    return n;
  };

  const geral = modeloGeral(e.modelos);
  linhas.push("## Condições gerais");
  let feitas = 0;
  if (geral) feitas = secao(geral, "", ". ");
  else ctx.faltando.push({ nome: "condicoes_gerais", rotulo: "condições gerais do modelo", motivo: "vazia", onde: "modelo" });
  // Cláusulas extras ligadas (frente CON2): continuam a numeração das condições gerais.
  const extras = modeloExtras(e.modelos);
  if (extras && extras.clausulas.some((c) => valeACondicao(c.quando, valores))) {
    linhas.push("## Cláusulas adicionais");
    secao(extras, "", ". ", feitas);
  }

  servicos.forEach((s, i) => {
    const m = modeloDoServico(e.modelos, s);
    linhas.push(`## Anexo ${LETRAS[i]}. ${ROTULO_DO_SERVICO[s]}`);
    if (m) secao(m, `${LETRAS[i]}.`, " ");
    else ctx.faltando.push({ nome: `bloco_${s}`, rotulo: `bloco do serviço ${ROTULO_DO_SERVICO[s]}`, motivo: "vazia", onde: "modelo" });
  });

  linhas.push("## Assinaturas");
  linhas.push("E, por estarem de acordo, as partes assinam eletronicamente este contrato. A página de carimbo ao final registra o código de integridade do documento, as assinaturas e a trilha de eventos.");
  linhas.push(...linhasDosSignatarios(e.signatarios));

  for (const f of faltandoNaAgencia(e.agencia)) {
    if (!ctx.faltando.some((x) => x.rotulo === f && x.onde === "dados da agência")) ctx.faltando.push({ nome: `agencia:${f}`, rotulo: f, motivo: "vazia", onde: "dados da agência" });
  }
  return { texto: linhas.join("\n"), faltando: ctx.faltando, clausulas, variaveis, valores };
}

/** Pode congelar e enviar? Só sem nada faltando (inclusive os dados da agência). */
export function podeCongelar(m: Pick<ContratoMontado, "faltando" | "texto">): { pode: boolean; motivo: string | null } {
  if (m.faltando.length) {
    const nomes = m.faltando.slice(0, 6).map((f) => (f.motivo === "invalida" ? `${f.rotulo} (${f.detalhe || "inválido"})` : f.rotulo));
    return { pode: false, motivo: `Falta preencher: ${nomes.join(", ")}${m.faltando.length > 6 ? ` e mais ${m.faltando.length - 6}` : ""}.` };
  }
  if (/\[(falta|corrigir):/.test(m.texto)) return { pode: false, motivo: "O texto ainda tem campo sem valor." };
  return { pode: true, motivo: null };
}

// ------------------------------------------------------------------ hash (código de integridade)

/** SHA-256 em hexadecimal do texto em UTF-8 (o mesmo que o banco confere com sha256(convert_to(texto, 'UTF8'))). */
export async function hashDoTexto(texto: string): Promise<string> {
  const bytes = new TextEncoder().encode(String(texto));
  return await hashDosBytes(bytes);
}

export async function hashDosBytes(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  const h = new Uint8Array(d);
  let s = "";
  for (let i = 0; i < h.length; i++) s += (h[i] < 16 ? "0" : "") + h[i].toString(16);
  return s;
}

/** "3f2a 91c0 ... " em grupos de 4, para ler e comparar. */
export function hashLegivel(hash: string): string {
  return String(hash || "").replace(/(.{4})/g, "$1 ").trim();
}

// ------------------------------------------------------------------ leitura do texto canônico

export type BlocoDoDocumento =
  | { tipo: "titulo"; texto: string }
  | { tipo: "meta"; texto: string }
  | { tipo: "secao"; texto: string }
  | { tipo: "clausula"; texto: string }
  | { tipo: "quadro"; rotulo: string; texto: string }
  | { tipo: "item"; texto: string }
  | { tipo: "paragrafo"; texto: string };

export function lerDocumento(texto: string): BlocoDoDocumento[] {
  const saida: BlocoDoDocumento[] = [];
  for (const bruta of String(texto || "").split("\n")) {
    const l = bruta.replace(/\s+$/g, "");
    if (!l.trim()) continue;
    if (l.indexOf("### ") === 0) saida.push({ tipo: "clausula", texto: l.slice(4) });
    else if (l.indexOf("## ") === 0) saida.push({ tipo: "secao", texto: l.slice(3) });
    else if (l.indexOf("# ") === 0) saida.push({ tipo: "titulo", texto: l.slice(2) });
    else if (l.indexOf("@ ") === 0) saida.push({ tipo: "meta", texto: l.slice(2) });
    else if (l.indexOf("| ") === 0) {
      const resto = l.slice(2);
      const i = resto.indexOf(" | ");
      saida.push(i > 0 ? { tipo: "quadro", rotulo: resto.slice(0, i), texto: resto.slice(i + 3) } : { tipo: "paragrafo", texto: resto });
    } else if (l.indexOf("- ") === 0) saida.push({ tipo: "item", texto: l.slice(2) });
    else saida.push({ tipo: "paragrafo", texto: l });
  }
  return saida;
}

// ------------------------------------------------------------------ diferença (diff) entre textos

export type ParteDoDiff = { tipo: "igual" | "saiu" | "entrou"; texto: string };

function lcs<T>(a: T[], b: T[], igual: (x: T, y: T) => boolean): Array<{ tipo: "igual" | "saiu" | "entrou"; valor: T }> {
  const n = a.length;
  const m = b.length;
  // Tira começo e fim iguais (o normal numa cláusula alterada) antes da tabela.
  let ini = 0;
  while (ini < n && ini < m && igual(a[ini], b[ini])) ini++;
  let fimA = n;
  let fimB = m;
  while (fimA > ini && fimB > ini && igual(a[fimA - 1], b[fimB - 1])) {
    fimA--;
    fimB--;
  }
  const A = a.slice(ini, fimA);
  const B = b.slice(ini, fimB);
  const meio: Array<{ tipo: "igual" | "saiu" | "entrou"; valor: T }> = [];
  if (A.length * B.length > 4_000_000) {
    A.forEach((x) => meio.push({ tipo: "saiu", valor: x }));
    B.forEach((x) => meio.push({ tipo: "entrou", valor: x }));
  } else {
    const t: number[][] = [];
    for (let i = 0; i <= A.length; i++) {
      t.push(new Array(B.length + 1).fill(0));
    }
    for (let i = A.length - 1; i >= 0; i--) {
      for (let j = B.length - 1; j >= 0; j--) {
        t[i][j] = igual(A[i], B[j]) ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
      }
    }
    let i = 0;
    let j = 0;
    while (i < A.length && j < B.length) {
      if (igual(A[i], B[j])) {
        meio.push({ tipo: "igual", valor: A[i] });
        i++;
        j++;
      } else if (t[i + 1][j] >= t[i][j + 1]) meio.push({ tipo: "saiu", valor: A[i++] });
      else meio.push({ tipo: "entrou", valor: B[j++] });
    }
    while (i < A.length) meio.push({ tipo: "saiu", valor: A[i++] });
    while (j < B.length) meio.push({ tipo: "entrou", valor: B[j++] });
  }
  type Op = { tipo: "igual" | "saiu" | "entrou"; valor: T };
  const antes: Op[] = a.slice(0, ini).map((valor) => ({ tipo: "igual", valor }));
  const depois: Op[] = a.slice(fimA).map((valor) => ({ tipo: "igual", valor }));
  return antes.concat(meio, depois);
}

/** Diferença palavra a palavra (espaços preservados). Partes vizinhas do mesmo tipo se juntam. */
export function diffDeTexto(antes: string, depois: string): ParteDoDiff[] {
  const pedacos = (s: string) => String(s || "").split(/(\s+)/).filter((x) => x !== "");
  const ops = lcs(pedacos(antes), pedacos(depois), (x, y) => x === y);
  const saida: ParteDoDiff[] = [];
  for (const o of ops) {
    const ultimo = saida[saida.length - 1];
    // Espaço solto entre duas mudanças fica com a mudança (lê melhor).
    if (ultimo && ultimo.tipo === o.tipo) ultimo.texto += o.valor;
    else saida.push({ tipo: o.tipo, texto: o.valor });
  }
  return saida;
}

export type LinhaDoDiff = { tipo: "igual" | "saiu" | "entrou" | "mudou"; texto: string; partes?: ParteDoDiff[] };

/** Diferença entre dois documentos, linha a linha; linha trocada por outra parecida mostra as palavras. */
export function diffDeDocumentos(antes: string, depois: string): LinhaDoDiff[] {
  const ops = lcs(String(antes || "").split("\n"), String(depois || "").split("\n"), (x, y) => x === y);
  const saida: LinhaDoDiff[] = [];
  for (let k = 0; k < ops.length; k++) {
    const o = ops[k];
    const prox = ops[k + 1];
    if (o.tipo === "saiu" && prox && prox.tipo === "entrou") {
      saida.push({ tipo: "mudou", texto: prox.valor, partes: diffDeTexto(o.valor, prox.valor) });
      k++;
      continue;
    }
    saida.push({ tipo: o.tipo, texto: o.valor });
  }
  return saida;
}

/** Contagem para a tela: quantas linhas mudaram. */
export function resumoDoDiff(linhas: LinhaDoDiff[]): { mudaram: number; entraram: number; sairam: number } {
  let mudaram = 0;
  let entraram = 0;
  let sairam = 0;
  linhas.forEach((l) => {
    if (l.tipo === "mudou") mudaram++;
    else if (l.tipo === "entrou") entraram++;
    else if (l.tipo === "saiu") sairam++;
  });
  return { mudaram, entraram, sairam };
}

// ------------------------------------------------------------------ mensagens prontas (nada é enviado sozinho)

export function mensagensProntas(p: { cliente: string; titulo: string; link: string; hash: string; agencia: string }) {
  const codigo = String(p.hash || "").trim().slice(0, 12);
  // Contrato de PDF enviado não tem código: a frase do código sai (nada de "O código do documento é .").
  const whatsapp = `Olá, ${p.cliente}! Segue o contrato "${p.titulo}" para leitura e assinatura eletrônica: ${p.link}\n${codigo ? `O código do documento é ${codigo}. ` : ""}Qualquer dúvida, é só responder aqui.`;
  const assunto = `Contrato para assinatura: ${p.titulo}`;
  const email = `Olá, ${p.cliente}.\n\nSegue o link do contrato "${p.titulo}" para leitura e assinatura eletrônica:\n${p.link}\n\n${codigo ? `O documento tem o código de integridade ${codigo} (SHA-256). Se ele mudar, o link muda junto.\n\n` : ""}${p.agencia}`;
  return { whatsapp, assunto, email, wa_me: `https://wa.me/?text=${encodeURIComponent(whatsapp)}` };
}

// ------------------------------------------------------------------ nome do arquivo

export function nomeDoArquivoDoContrato(numero: string, cliente: string, versao: number, assinado = false): string {
  const limpar = (t: string) =>
    String(t || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40);
  const base = `contrato-${limpar(numero) || "sem-numero"}-${limpar(cliente) || "cliente"}-v${Number(versao) || 1}${assinado ? "-assinado" : ""}`;
  return `${base.replace(/-+/g, "-")}.pdf`;
}

// ------------------------------------------------------------------ memória (o agente aprende os valores)

/** Os valores "lembrar" dos últimos contratos da agência (o mais novo vence). */
export function valoresLembrados(modelos: ModeloDeContrato[], anteriores: Array<Valores | null | undefined>): Valores {
  const lembrar: string[] = [];
  modelos.forEach((m) => m.variaveis.forEach((v) => v.lembrar && lembrar.indexOf(v.nome) < 0 && lembrar.push(v.nome)));
  const saida: Valores = {};
  for (const valores of anteriores) {
    if (!valores) continue;
    for (const nome of lembrar) if (saida[nome] === undefined && txt(valores[nome])) saida[nome] = txt(valores[nome]);
  }
  return saida;
}

// ------------------------------------------------------------------ status

export const STATUS_DO_CONTRATO: Record<string, string> = {
  draft: "Rascunho",
  sent: "Aguardando cliente",
  signed: "Em revisão",
  completed: "Assinado",
  cancelled: "Cancelado",
  substituido: "Substituído",
};
