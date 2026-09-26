/**
 * Regras puras da Mesa Publicidade (frente P, 26/09/2026). A função
 * mesa-publicidade, a tela e os testes (vitest) leem este arquivo: sem Deno,
 * sem banco, sem rede. Código compatível com Safari 11 (a tela importa).
 *
 * O que mora aqui:
 * - briefing versionado: normalização, lacunas e oferta com fonte;
 * - territórios: normalização dos três caminhos do diretor;
 * - tomadas: o plano de seis (uma por função) e o pedido à Mesa Foto;
 * - revisão: produto antes da estética, a regra de reprovação;
 * - encaminhamento: quem pode ir para a Mesa e a Mesa Ads, com linhagem;
 * - a campanha inteira (agregado) que a função devolve e a tela mostra.
 *
 * Divisão do kit: a Publicidade dirige, a Mesa Foto produz (o ensaio mora em
 * foto_ensaios e a foto aprovada em cliente_imagens), a Mesa Ads testa.
 * Aprovar a foto não aprova anúncio nem verba.
 */

import {
  FUNCOES_DAS_TOMADAS,
  type FuncaoDaTomada,
  type ReceitaDePublicidade,
  receitaDaCategoria,
} from "../_shared/receitas-de-publicidade.ts";

export { FUNCOES_DAS_TOMADAS, type FuncaoDaTomada };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ehUuid = (v: unknown) => typeof v === "string" && UUID.test(v);

/** Texto limpo numa linha (ou com quebras, quando `linhas`), cortado no máximo. */
export function limpo(v: unknown, max: number, linhas = false): string {
  if (v === null || v === undefined) return "";
  const s = typeof v === "string" ? v : typeof v === "number" || typeof v === "boolean" ? String(v) : "";
  const t = linhas ? s.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim() : s.replace(/\s+/g, " ").trim();
  return t.slice(0, max);
}

export function listaDeTextos(v: unknown, maxItens: number, maxTexto: number): string[] {
  const bruta = Array.isArray(v) ? v : typeof v === "string" ? v.split(/\n|;/) : [];
  const saida: string[] = [];
  for (const x of bruta) {
    const t = limpo(x, maxTexto);
    if (t && saida.indexOf(t) < 0) saida.push(t);
    if (saida.length >= maxItens) break;
  }
  return saida;
}

export const semAcento = (t: string) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

// ------------------------------------------------------------------ briefing

export type StatusDoFato = "confirmado" | "hipotese" | "pendente";
export const STATUS_DO_FATO: { id: StatusDoFato; rotulo: string }[] = [
  { id: "confirmado", rotulo: "Confirmado" },
  { id: "hipotese", rotulo: "Hipótese" },
  { id: "pendente", rotulo: "Pendente" },
];

export type ObjetivoDaCampanha = "reconhecimento" | "visitas" | "consultas" | "experimentacao" | "venda";
export const OBJETIVOS_DA_CAMPANHA: { id: ObjetivoDaCampanha; rotulo: string }[] = [
  { id: "reconhecimento", rotulo: "Reconhecimento" },
  { id: "visitas", rotulo: "Visitas" },
  { id: "consultas", rotulo: "Consultas e mensagens" },
  { id: "experimentacao", rotulo: "Experimentação" },
  { id: "venda", rotulo: "Venda" },
];

export const FORMATOS_DA_CAMPANHA = ["4:5", "9:16", "1:1", "16:9"];

export interface Oferta {
  texto: string;
  /** De onde veio (site, conversa com o cliente, tabela de preço). Sem fonte, não é confirmada. */
  fonte: string;
  status: StatusDoFato;
}

export interface RestricoesDoProduto {
  /** Logo e texto do rótulo que não podem mudar. */
  logo: string;
  /** Cor da variante (ex.: "tartaruga mel"). */
  cor_da_variante: string;
  /** Detalhes de material que não podem mudar (haste metálica, costura aparente...). */
  detalhes: string[];
  /** Outras restrições do cliente. */
  outras: string[];
}

export interface Briefing {
  objetivo: ObjetivoDaCampanha;
  objetivo_texto: string;
  publico: string;
  ocasiao: string;
  oferta: Oferta;
  tom: string;
  destino: string;
  restricoes: RestricoesDoProduto;
  /** Alegações proibidas (o que não pode ser dito ou mostrado). */
  proibido: string;
  formatos: string[];
}

export const briefingVazio = (): Briefing => ({
  objetivo: "venda",
  objetivo_texto: "",
  publico: "",
  ocasiao: "",
  oferta: { texto: "", fonte: "", status: "pendente" },
  tom: "",
  destino: "",
  restricoes: { logo: "", cor_da_variante: "", detalhes: [], outras: [] },
  proibido: "",
  formatos: ["4:5", "9:16"],
});

const umDe = <T extends string>(v: unknown, lista: { id: T }[], padrao: T): T => {
  const s = String(v || "");
  return lista.some((x) => x.id === s) ? (s as T) : padrao;
};

export function normalizarBriefing(bruto: unknown): Briefing {
  const r = (bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {}) as Record<string, any>;
  const of = (r.oferta && typeof r.oferta === "object" ? r.oferta : {}) as Record<string, unknown>;
  const re = (r.restricoes && typeof r.restricoes === "object" ? r.restricoes : {}) as Record<string, unknown>;
  const ofertaTexto = limpo(of.texto, 400);
  const fonte = limpo(of.fonte, 300);
  let status = umDe<StatusDoFato>(of.status, STATUS_DO_FATO, ofertaTexto ? "hipotese" : "pendente");
  // Oferta sem fonte nunca fica confirmada (preço e condição precisam de fonte).
  if (status === "confirmado" && !fonte) status = "hipotese";
  if (!ofertaTexto) status = "pendente";
  const formatos = listaDeTextos(r.formatos, 4, 6).filter((f) => FORMATOS_DA_CAMPANHA.indexOf(f) >= 0);
  return {
    objetivo: umDe<ObjetivoDaCampanha>(r.objetivo, OBJETIVOS_DA_CAMPANHA, "venda"),
    objetivo_texto: limpo(r.objetivo_texto, 400),
    publico: limpo(r.publico, 600),
    ocasiao: limpo(r.ocasiao, 400),
    oferta: { texto: ofertaTexto, fonte, status },
    tom: limpo(r.tom, 300),
    destino: limpo(r.destino, 300),
    restricoes: {
      logo: limpo(re.logo, 300),
      cor_da_variante: limpo(re.cor_da_variante, 200),
      detalhes: listaDeTextos(re.detalhes, 10, 200),
      outras: listaDeTextos(re.outras, 10, 200),
    },
    proibido: limpo(r.proibido, 600),
    formatos: formatos.length ? formatos : ["4:5", "9:16"],
  };
}

/** O que falta para o briefing ficar pronto (a tela mostra; não impede de propor). */
export function lacunasDoBriefing(b: Briefing): string[] {
  const l: string[] = [];
  if (!b.publico) l.push("Público e situação de compra.");
  if (!b.oferta.texto) l.push("Oferta ou condição (ou marque que não há oferta).");
  else if (b.oferta.status !== "confirmado") l.push(b.oferta.fonte ? "Oferta ainda não confirmada pelo cliente." : "Oferta sem fonte: preço e condição precisam de fonte.");
  if (!b.destino) l.push("Destino (para onde a pessoa vai: WhatsApp, loja, site).");
  if (!b.restricoes.logo && !b.restricoes.cor_da_variante && !b.restricoes.detalhes.length) l.push("O que não pode mudar no produto (logo, cor da variante, detalhe de material).");
  return l;
}

/** Todas as restrições do produto numa lista só (para o pedido à Mesa Foto e a revisão). */
export function restricoesEmLista(r: RestricoesDoProduto): string[] {
  const saida: string[] = [];
  if (r.logo) saida.push(`logo e texto: ${r.logo}`);
  if (r.cor_da_variante) saida.push(`cor da variante: ${r.cor_da_variante}`);
  r.detalhes.forEach((d) => saida.push(`detalhe: ${d}`));
  r.outras.forEach((d) => saida.push(d));
  return saida;
}

/** Duas versões do briefing são iguais? (salvar sem mudança não cria versão nova). */
export function briefingIgual(a: Briefing, b: Briefing): boolean {
  return JSON.stringify(normalizarBriefing(a)) === JSON.stringify(normalizarBriefing(b));
}

/** Briefing inicial tirado do produto (kit da Mesa Foto): invariantes viram restrições. */
export function briefingDoKit(kit: { nome?: unknown; variante?: unknown; invariantes?: unknown }): Briefing {
  const b = briefingVazio();
  b.restricoes.cor_da_variante = limpo(kit.variante, 200);
  b.restricoes.detalhes = listaDeTextos(kit.invariantes, 10, 200);
  return b;
}

// ------------------------------------------------------------------ territórios

export type StatusDoTerritorio = "proposto" | "aprovado" | "descartado";

export interface Territorio {
  id: string;
  ordem: number;
  nome: string;
  conceito: string;
  tensao_humana: string;
  promessa: string;
  razao_para_acreditar: string;
  direcao_de_arte: { paleta: string[]; luz: string; tratamento: string; enquadramentos: string };
  casting: { perfil: string; idade_aprox: number; estilo: string; figurino: string };
  ambiente: string;
  referencias: string[];
  riscos: string[];
  por_que_combina: string;
  status: StatusDoTerritorio;
  briefing_versao: number;
}

export const MAX_TERRITORIOS = 3;
export const IDADE_MINIMA_DO_CASTING = 21;
const HEX = /^#[0-9a-f]{6}$/i;

/** Um território do diretor (ou salvo) em forma segura; null sem nome ou conceito. */
export function normalizarTerritorio(bruto: unknown, i: number, extras: { id?: string; status?: StatusDoTerritorio; briefing_versao?: number } = {}): Territorio | null {
  if (!bruto || typeof bruto !== "object") return null;
  const r = bruto as Record<string, any>;
  const nome = limpo(r.nome, 80);
  const conceito = limpo(r.conceito, 700);
  if (!nome || !conceito) return null;
  const da = (r.direcao_de_arte && typeof r.direcao_de_arte === "object" ? r.direcao_de_arte : {}) as Record<string, unknown>;
  const ca = (r.casting && typeof r.casting === "object" ? r.casting : {}) as Record<string, unknown>;
  let idade = Math.round(Number(ca.idade_aprox));
  if (!isFinite(idade) || idade <= 0) idade = 30;
  // Pessoa sintética é sempre adulta (mesma régua da Mesa Foto).
  if (idade < IDADE_MINIMA_DO_CASTING) idade = IDADE_MINIMA_DO_CASTING;
  const paleta = listaDeTextos(da.paleta, 5, 40).map((c) => (HEX.test(c) ? c.toUpperCase() : c));
  const status = extras.status || (r.status === "aprovado" || r.status === "descartado" ? r.status : "proposto");
  return {
    id: extras.id || (ehUuid(r.id) ? String(r.id) : ""),
    ordem: i + 1,
    nome,
    conceito,
    tensao_humana: limpo(r.tensao_humana, 400),
    promessa: limpo(r.promessa, 300),
    razao_para_acreditar: limpo(r.razao_para_acreditar, 400),
    direcao_de_arte: { paleta, luz: limpo(da.luz, 300), tratamento: limpo(da.tratamento, 300), enquadramentos: limpo(da.enquadramentos, 300) },
    casting: { perfil: limpo(ca.perfil, 300), idade_aprox: Math.min(80, idade), estilo: limpo(ca.estilo, 300), figurino: limpo(ca.figurino, 300) },
    ambiente: limpo(r.ambiente, 400),
    referencias: listaDeTextos(r.referencias, 5, 200),
    riscos: listaDeTextos(r.riscos, 5, 240),
    por_que_combina: limpo(r.por_que_combina, 400),
    status,
    briefing_versao: Number(extras.briefing_versao || r.briefing_versao) || 1,
  };
}

/**
 * Os três territórios do diretor: no máximo três, nomes e conceitos
 * distintos (sem acento e caixa), cada um com nome e conceito. Menos de três
 * volta com aviso: a tela mostra o que veio, não inventa o que faltou.
 */
export function normalizarTerritorios(bruto: unknown, briefingVersao = 1): { territorios: Territorio[]; avisos: string[] } {
  const lista = Array.isArray(bruto) ? bruto : bruto && typeof bruto === "object" && Array.isArray((bruto as any).territorios) ? (bruto as any).territorios : [];
  const saida: Territorio[] = [];
  const avisos: string[] = [];
  const vistos: string[] = [];
  for (const x of lista) {
    if (saida.length >= MAX_TERRITORIOS) break;
    const t = normalizarTerritorio(x, saida.length, { status: "proposto", briefing_versao: briefingVersao });
    if (!t) continue;
    const chaveNome = semAcento(t.nome);
    const chaveConceito = semAcento(t.conceito).slice(0, 120);
    if (vistos.indexOf(chaveNome) >= 0 || vistos.indexOf(chaveConceito) >= 0) {
      avisos.push(`Território repetido descartado: ${t.nome}.`);
      continue;
    }
    vistos.push(chaveNome, chaveConceito);
    saida.push(t);
  }
  if (saida.length < MAX_TERRITORIOS) avisos.push(`O diretor trouxe ${saida.length} de ${MAX_TERRITORIOS} territórios válidos.`);
  return { territorios: saida, avisos };
}

// ------------------------------------------------------------------ tomadas

export type StatusDaTomadaDePublicidade = "planejada" | "pedida" | "gerada" | "aprovada" | "reprovada";

export interface TomadaDePublicidade {
  id: string;
  ordem: number;
  funcao: FuncaoDaTomada;
  nome: string;
  descricao: string;
  enquadramento: string;
  ambiente: string;
  luz: string;
  gesto: string;
  com_pessoa: boolean;
  formato: string;
  espaco_para_texto: boolean;
  /** Id da tomada no ensaio da Mesa Foto (depois do pedido). */
  foto_tomada_id: string | null;
  status: StatusDaTomadaDePublicidade;
}

export const TOTAL_DE_TOMADAS = 6;

const COM_PESSOA_POR_FUNCAO: Record<FuncaoDaTomada, boolean> = {
  atrair: true,
  apresentar_produto: false,
  contextualizar_uso: true,
  mostrar_detalhe: false,
  expressar_conceito: true,
  apoiar_acao: false,
};

const ENQUADRAMENTO_POR_FUNCAO: Record<FuncaoDaTomada, string> = {
  atrair: "médio, rosto e produto",
  apresentar_produto: "produto inteiro, de frente",
  contextualizar_uso: "aberto, pessoa no ambiente",
  mostrar_detalhe: "close do detalhe",
  expressar_conceito: "médio em três quartos",
  apoiar_acao: "aberto com espaço negativo",
};

/**
 * O plano de seis tomadas: uma por função, na ordem do kit, com a
 * receita da categoria e a direção do território aprovado. Sem IA.
 */
export function planoDeTomadas(t: Territorio, receita: ReceitaDePublicidade | null, briefing: Briefing, ids?: string[]): TomadaDePublicidade[] {
  const formatos = briefing.formatos.length ? briefing.formatos : ["4:5"];
  return FUNCOES_DAS_TOMADAS.map((f, i) => {
    const doReceita = receita ? receita.tomadas[f.id] : "";
    const comPessoa = COM_PESSOA_POR_FUNCAO[f.id] && !!t.casting.perfil;
    return {
      id: (ids && ids[i]) || "",
      ordem: i + 1,
      funcao: f.id,
      nome: f.rotulo,
      descricao: limpo(doReceita || f.dica, 400),
      enquadramento: ENQUADRAMENTO_POR_FUNCAO[f.id],
      ambiente: limpo(t.ambiente, 300),
      luz: limpo(t.direcao_de_arte.luz, 200),
      gesto: comPessoa ? limpo(`${t.casting.perfil}${t.casting.figurino ? `, ${t.casting.figurino}` : ""}`, 240) : "",
      com_pessoa: comPessoa,
      // A sequência alterna os formatos pedidos (feed e stories).
      formato: formatos[i % formatos.length],
      espaco_para_texto: f.id === "apoiar_acao",
      foto_tomada_id: null,
      status: "planejada",
    };
  });
}

/**
 * Tomadas vindas da equipe ou do banco: seis, uma por função, na ordem. O
 * que falta é completado pelo plano base; função repetida sai.
 */
export function normalizarTomadas(bruto: unknown, base: TomadaDePublicidade[]): TomadaDePublicidade[] {
  const lista = Array.isArray(bruto) ? bruto : [];
  return base.map((padrao) => {
    const achada = lista.find((x) => x && typeof x === "object" && (x as any).funcao === padrao.funcao) as Record<string, unknown> | undefined;
    if (!achada) return padrao;
    const formato = limpo(achada.formato, 6);
    const status = String(achada.status || "");
    return {
      id: ehUuid(achada.id) ? String(achada.id) : padrao.id,
      ordem: padrao.ordem,
      funcao: padrao.funcao,
      nome: limpo(achada.nome, 80) || padrao.nome,
      descricao: limpo(achada.descricao, 400) || padrao.descricao,
      enquadramento: limpo(achada.enquadramento, 200) || padrao.enquadramento,
      ambiente: limpo(achada.ambiente, 300) || padrao.ambiente,
      luz: limpo(achada.luz, 200) || padrao.luz,
      gesto: limpo(achada.gesto, 240),
      com_pessoa: typeof achada.com_pessoa === "boolean" ? achada.com_pessoa : padrao.com_pessoa,
      formato: FORMATOS_DA_CAMPANHA.indexOf(formato) >= 0 ? formato : padrao.formato,
      espaco_para_texto: typeof achada.espaco_para_texto === "boolean" ? achada.espaco_para_texto : padrao.espaco_para_texto,
      foto_tomada_id: limpo(achada.foto_tomada_id, 80) || null,
      status: ["planejada", "pedida", "gerada", "aprovada", "reprovada"].indexOf(status) >= 0 ? (status as StatusDaTomadaDePublicidade) : padrao.status,
    };
  });
}

export const MAX_PEDIDO_MESA_FOTO = 2000;
const QUEBRA = String.fromCharCode(10);

/**
 * O pedido à Mesa Foto (campanha_planejar, campo pedido, até 2000
 * caracteres): território, as seis tomadas e o que não pode mudar. O
 * diretor da Mesa Foto monta as tomadas a partir disto, com as fontes do kit.
 */
export function pedidoParaMesaFoto(b: Briefing, t: Territorio, tomadas: TomadaDePublicidade[], prefixo = ""): string {
  const restricoes = restricoesEmLista(b.restricoes);
  // O fim (o que não pode mudar) nunca é cortado: ele tem teto próprio e entra inteiro.
  const fim = [
    restricoes.length ? `Não pode mudar no produto: ${restricoes.join("; ")}.`.slice(0, 700) : "",
    b.proibido ? `Não mostrar nem sugerir: ${b.proibido.slice(0, 240)}.` : "",
    "Produto sempre das fontes do kit; nada de acessório, variante ou texto que não está nelas. Vista sem evidência volta como lacuna.",
  ].filter(Boolean).join(" ");
  const cabecaInteira = [
    prefixo,
    `Campanha da Mesa Publicidade, território "${t.nome}": ${t.conceito}`,
    t.direcao_de_arte.paleta.length ? `Paleta: ${t.direcao_de_arte.paleta.join(", ")}.` : "",
    t.direcao_de_arte.luz ? `Luz: ${t.direcao_de_arte.luz}.` : "",
    t.ambiente ? `Ambiente: ${t.ambiente}.` : "",
    t.direcao_de_arte.tratamento ? `Tratamento: ${t.direcao_de_arte.tratamento}.` : "",
  ].filter(Boolean).join(" ");
  const n = Math.max(1, tomadas.length);
  const minimoDasTomadas = n * 70;
  const cabeca = cabecaInteira.slice(0, Math.max(120, MAX_PEDIDO_MESA_FOTO - fim.length - minimoDasTomadas - 20));
  const orcamento = MAX_PEDIDO_MESA_FOTO - cabeca.length - fim.length - 12 - n;
  const porTomada = Math.max(40, Math.floor(orcamento / n));
  const linhas = tomadas.map((x) =>
    `${x.ordem}. ${x.nome}: ${[x.descricao, x.enquadramento, x.com_pessoa ? "com a pessoa do casting" : "sem pessoa", x.espaco_para_texto ? "espaço limpo para texto" : "", x.formato].filter(Boolean).join(", ")}`.slice(0, porTomada)
  );
  const meio = ["", "Tomadas:"].concat(linhas).concat([""]).join(QUEBRA);
  return `${cabeca}${meio}${fim}`.slice(0, MAX_PEDIDO_MESA_FOTO);
}

/** Casting do território no formato que a Mesa Foto lê (modelo sintético). */
export function modeloParaMesaFoto(t: Territorio): { perfil: string; idade_aprox: number; estilo: string } {
  return {
    perfil: t.casting.perfil,
    idade_aprox: t.casting.idade_aprox,
    estilo: [t.casting.estilo, t.casting.figurino].filter(Boolean).join(", ").slice(0, 300),
  };
}

// ------------------------------------------------------------------ ensaio da Mesa Foto (leitura)

export interface PontoDaConferencia {
  criterio: string;
  ok: boolean | null;
  nota: string;
}

export interface ConferenciaLida {
  pontos: PontoDaConferencia[];
  alertas: string[];
  resumo: string;
  aviso_jev: boolean;
  conferida_em: string;
}

export interface VersaoDoEnsaio {
  foto_tomada_id: string;
  nome: string;
  status: string;
  versao: number;
  imagem_id: string | null;
  storage_path: string | null;
  conferencia: ConferenciaLida | null;
  decisao: "aprovada" | "rejeitada" | null;
  motivo_rejeicao: string;
}

export function lerConferencia(v: unknown): ConferenciaLida | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, any>;
  if (r.pendente === true || !Array.isArray(r.pontos)) return null;
  const pontos: PontoDaConferencia[] = [];
  for (const p of r.pontos) {
    if (!p || typeof p !== "object") continue;
    const criterio = limpo(p.criterio, 200);
    if (criterio) pontos.push({ criterio, ok: typeof p.ok === "boolean" ? p.ok : null, nota: limpo(p.nota, 500) });
  }
  const jev = r.jev && typeof r.jev === "object" ? r.jev : null;
  return {
    pontos,
    alertas: listaDeTextos(r.alertas, 8, 400),
    resumo: limpo(r.resumo, 1200),
    aviso_jev: !!(jev && jev.aviso === true) || r.aviso_jev === true,
    conferida_em: limpo(r.conferida_em, 40),
  };
}

/** A última versão de cada tomada do ensaio (a que espera ou teve decisão). Tomada sem versão sai sem número. */
export function versoesDoEnsaio(ensaio: unknown): VersaoDoEnsaio[] {
  const e = (ensaio && typeof ensaio === "object" ? ensaio : {}) as Record<string, any>;
  const tomadas = Array.isArray(e.tomadas) ? e.tomadas : [];
  const saida: VersaoDoEnsaio[] = [];
  for (const t of tomadas) {
    if (!t || typeof t !== "object" || !t.id) continue;
    const versoes = (Array.isArray(t.versoes) ? t.versoes : []).filter((v: any) => v && typeof v === "object" && isFinite(Number(v.versao)));
    const ultima = versoes.slice().sort((a: any, b: any) => Number(b.versao) - Number(a.versao))[0] as Record<string, any> | undefined;
    // Banco: aprovada true | false | null (e decisao em palavras). Tela (fotoApi): aprovada e rejeitada booleanos.
    const decisao: "aprovada" | "rejeitada" | null = !ultima
      ? null
      : ultima.decisao === "aprovada" || ultima.aprovada === true
      ? "aprovada"
      : ultima.decisao === "rejeitada" || ultima.rejeitada === true || (!("rejeitada" in ultima) && ultima.aprovada === false)
      ? "rejeitada"
      : null;
    saida.push({
      foto_tomada_id: String(t.id),
      nome: limpo(t.nome, 120),
      status: limpo(t.status, 20),
      versao: ultima ? Number(ultima.versao) : 0,
      imagem_id: ultima && ehUuid(ultima.imagem_id) ? String(ultima.imagem_id) : null,
      storage_path: ultima ? limpo(ultima.storage_path, 400) || null : null,
      conferencia: ultima ? lerConferencia(ultima.conferencia) : null,
      decisao,
      motivo_rejeicao: ultima ? limpo(ultima.motivo_rejeicao, 800) : "",
    });
  }
  return saida;
}

// ------------------------------------------------------------------ revisão: produto antes da estética

export type MudancaDoProduto = "logo" | "formato" | "cor" | "detalhe" | "variante";
export type ClasseDoCriterio = MudancaDoProduto | "estetica" | "pessoa";

export const ROTULO_DA_MUDANCA: Record<MudancaDoProduto, string> = {
  logo: "logo ou texto",
  formato: "formato",
  cor: "cor",
  detalhe: "detalhe do material",
  variante: "produto ou variante",
};

/**
 * Classe do critério da conferência da Mesa Foto (receitas.ts,
 * CRITERIOS_CONFERENCIA): o que é do produto reprova; luz, sombra, ângulo e
 * cenário são estética; pessoa sintética é conferida à parte.
 */
export function classeDoCriterio(criterio: string): ClasseDoCriterio {
  const c = semAcento(criterio);
  // Luz, reflexo, sombra, ângulo e cenário vêm primeiro: "Reflexos coerentes com o material" é estética, não cor.
  if (/reflexo|brilho|sombra|\bluz\b|angulo|enquadramento|cenario/.test(c)) return "estetica";
  if (/rotulo|texto|logo|marca|embalagem igual/.test(c)) return "logo";
  if (/produto e variante|variante|mesmo produto|assunto/.test(c)) return "variante";
  if (/\bmaos?\b|pessoa|rosto|\bidade\b|corpo|cabelo|anatomia|\bpele\b/.test(c)) return "pessoa";
  if (/proporcao|formato|porcao|volume|caixa/.test(c)) return "formato";
  if (/\bcor(es)?\b|material|acabamento/.test(c)) return "cor";
  if (/quantidade|elementos|botoes|portas|pecas|ingredientes|recheio|recipiente|ferrage|costura|pedra|haste|ponto de preparo|montagem/.test(c)) return "detalhe";
  return "estetica";
}

export type VereditoDaRevisao = "reprovada" | "produto_ok" | "nao_determinavel" | "sem_conferencia";

export interface AvaliacaoDaRevisao {
  veredito: VereditoDaRevisao;
  mudancas: MudancaDoProduto[];
  /** Por que reprovou (critério e nota da conferência). */
  motivos: string[];
  /** Critérios do produto que a conferência não conseguiu avaliar. */
  sem_evidencia: string[];
  /** O que falhou na estética ou na pessoa (vem depois do produto; não reprova sozinho). */
  estetica: string[];
  /** Restrição do briefing citada num ponto que falhou. */
  restricoes_citadas: string[];
}

/**
 * A regra da revisão (kit, decisão 5): o produto vem antes da estética.
 * - Sem conferência com as fontes: não dá para aprovar ("sem_conferencia").
 * - Algum critério do produto (logo, formato, cor, detalhe, variante) com
 *   ok = false: REPROVADA, mesmo que a foto esteja bonita.
 * - Critério do produto sem avaliação (ok = null): "nao_determinavel", uma
 *   pessoa olha antes de aprovar.
 * - Luz, sombra, ângulo, cenário e pessoa entram só como estética.
 * O Jev (aviso_jev) nunca decide: fica como aviso ao lado.
 */
export function avaliarRevisao(conferencia: ConferenciaLida | null, restricoes: RestricoesDoProduto | null = null): AvaliacaoDaRevisao {
  const vazia: AvaliacaoDaRevisao = { veredito: "sem_conferencia", mudancas: [], motivos: [], sem_evidencia: [], estetica: [], restricoes_citadas: [] };
  if (!conferencia || !conferencia.pontos.length) return vazia;
  const mudancas: MudancaDoProduto[] = [];
  const motivos: string[] = [];
  const semEvidencia: string[] = [];
  const estetica: string[] = [];
  const termos = restricoes ? restricoesEmLista(restricoes).map((t) => semAcento(t.replace(/^[^:]+:\s*/, ""))).filter((t) => t.length >= 3) : [];
  const citadas: string[] = [];
  for (const p of conferencia.pontos) {
    const classe = classeDoCriterio(p.criterio);
    const produto = classe !== "estetica" && classe !== "pessoa";
    if (p.ok === false) {
      if (produto) {
        if (mudancas.indexOf(classe as MudancaDoProduto) < 0) mudancas.push(classe as MudancaDoProduto);
        motivos.push(`${p.criterio}${p.nota ? `: ${p.nota}` : ""}`);
        const nota = semAcento(p.nota);
        termos.forEach((t) => {
          if (nota && nota.indexOf(t) >= 0 && citadas.indexOf(t) < 0) citadas.push(t);
        });
      } else {
        estetica.push(`${p.criterio}${p.nota ? `: ${p.nota}` : ""}`);
      }
    } else if (p.ok === null && produto) {
      semEvidencia.push(p.criterio);
    }
  }
  const veredito: VereditoDaRevisao = mudancas.length ? "reprovada" : semEvidencia.length ? "nao_determinavel" : "produto_ok";
  return { veredito, mudancas, motivos, sem_evidencia: semEvidencia, estetica, restricoes_citadas: citadas };
}

/** Frase do motivo da reprovação (vai para a Mesa Foto como motivo_rejeicao). */
export function motivoDaReprovacao(a: AvaliacaoDaRevisao): string {
  if (!a.mudancas.length) return "";
  const oque = a.mudancas.map((m) => ROTULO_DA_MUDANCA[m]).join(", ");
  return limpo(`Mesa Publicidade: o produto mudou (${oque}). ${a.motivos.slice(0, 3).join(" | ")}`, 800);
}

/**
 * Pode aprovar? Só com o produto conferido. "nao_determinavel" só com a
 * confirmação explícita de quem olhou a foto ao lado das fontes.
 */
export function podeAprovar(a: AvaliacaoDaRevisao, confirmoOProduto = false): { pode: boolean; motivo: string } {
  if (a.veredito === "produto_ok") return { pode: true, motivo: "" };
  if (a.veredito === "reprovada") return { pode: false, motivo: `O produto mudou (${a.mudancas.map((m) => ROTULO_DA_MUDANCA[m]).join(", ")}). Gere uma versão nova na Mesa Foto.` };
  if (a.veredito === "sem_conferencia") return { pode: false, motivo: "Confira a foto com as fontes do produto antes de aprovar." };
  return confirmoOProduto
    ? { pode: true, motivo: "" }
    : { pode: false, motivo: `A conferência não conseguiu avaliar: ${a.sem_evidencia.join(", ")}. Olhe ao lado das fontes e confirme o produto.` };
}

// ------------------------------------------------------------------ revisões e encaminhamento

export type DecisaoDaRevisao = "aprovada" | "reprovada" | null;

export interface RevisaoDePublicidade {
  id: string;
  tomada_id: string | null;
  foto_tomada_id: string;
  versao: number;
  imagem_id: string | null;
  storage_path: string | null;
  avaliacao: AvaliacaoDaRevisao;
  /** Aviso do Jev sobre as restrições do briefing (probabilidade; nunca decide). */
  aviso_jev: { probabilidade: number | null; aviso: boolean } | null;
  decisao: DecisaoDaRevisao;
  motivo: string;
  decidido_em: string | null;
}

export type DestinoDoAtivo = "mesa" | "ads";
export const DESTINOS: { id: DestinoDoAtivo; rotulo: string; dica: string }[] = [
  { id: "mesa", rotulo: "Mesa (orgânico)", dica: "Vai para o Estúdio da Mesa, para posts e carrosséis." },
  { id: "ads", rotulo: "Mesa Ads", dica: "Vai para o Estúdio da Mesa Ads, como base de criativo. Anúncio e verba têm aprovação própria." },
];

export interface Linhagem {
  campanha_id: string | null;
  briefing_versao: number;
  territorio_id: string | null;
  territorio_nome: string;
  tomada_id: string | null;
  funcao: FuncaoDaTomada | null;
  ensaio_id: string | null;
  foto_tomada_id: string;
  versao: number;
  imagem_id: string;
  kit_id: string | null;
  fontes_do_produto: string[];
  revisao_id: string | null;
  veredito: VereditoDaRevisao;
}

export interface Encaminhamento {
  id: string;
  destino: DestinoDoAtivo;
  imagem_id: string;
  linhagem: Linhagem;
  /** Sempre false aqui: aprovar a foto não aprova anúncio nem verba. */
  anuncio_aprovado: false;
  verba_aprovada: false;
  criado_em: string | null;
}

/** Revisões que podem ir para um destino: aprovadas, com foto no acervo, ainda não enviadas para ele. */
export function paraEncaminhar(
  revisoes: RevisaoDePublicidade[],
  destino: DestinoDoAtivo,
  jaEnviados: Array<Pick<Encaminhamento, "destino" | "imagem_id">>,
  escolhidas?: string[] | null,
): { vao: RevisaoDePublicidade[]; ficam: { revisao: RevisaoDePublicidade; motivo: string }[] } {
  const vao: RevisaoDePublicidade[] = [];
  const ficam: { revisao: RevisaoDePublicidade; motivo: string }[] = [];
  for (const r of revisoes) {
    if (escolhidas && escolhidas.length && escolhidas.indexOf(r.id) < 0) continue;
    if (r.decisao !== "aprovada") ficam.push({ revisao: r, motivo: r.decisao === "reprovada" ? "Foto reprovada." : "Foto ainda não aprovada na revisão." });
    else if (r.avaliacao.veredito === "reprovada") ficam.push({ revisao: r, motivo: "A conferência mostra mudança no produto: não vai para as mesas." });
    else if (!r.imagem_id) ficam.push({ revisao: r, motivo: "A foto aprovada ainda não está no acervo." });
    else if (jaEnviados.some((e) => e.destino === destino && e.imagem_id === r.imagem_id)) ficam.push({ revisao: r, motivo: "Já foi para este destino." });
    else vao.push(r);
  }
  return { vao, ficam };
}

/** A linhagem de uma foto encaminhada: de onde ela veio, do produto à versão. */
export function montarLinhagem(c: CampanhaDePublicidade, r: RevisaoDePublicidade): Linhagem {
  const tomada = c.tomadas.find((t) => (r.tomada_id && t.id === r.tomada_id) || (t.foto_tomada_id && t.foto_tomada_id === r.foto_tomada_id)) || null;
  const territorio = c.territorios.find((t) => t.id === c.territorio_id) || null;
  return {
    campanha_id: c.id,
    briefing_versao: c.briefing_versao,
    territorio_id: territorio ? territorio.id || null : null,
    territorio_nome: territorio ? territorio.nome : "",
    tomada_id: tomada ? tomada.id || null : null,
    funcao: tomada ? tomada.funcao : null,
    ensaio_id: c.ensaio_id,
    foto_tomada_id: r.foto_tomada_id,
    versao: r.versao,
    imagem_id: String(r.imagem_id || ""),
    kit_id: c.kit_id,
    fontes_do_produto: c.produto_fontes.slice(0, 12),
    revisao_id: r.id || null,
    veredito: r.avaliacao.veredito,
  };
}

/** Endereço do Estúdio da mesa de destino com as fotos (o mesmo caminho do "Usar" da Mesa Foto). */
export function enderecoDoDestino(destino: DestinoDoAtivo, clientId: string, imagemIds: string[]): string {
  const fotos = imagemIds.slice(0, 20).join(",");
  return destino === "mesa" ? `/mesa?client=${clientId}&aba=estudio&fotos=${fotos}` : `/mesa-ads?client=${clientId}&etapa=estudio&fotos=${fotos}`;
}

// ------------------------------------------------------------------ a campanha (agregado)

export type StatusDaCampanha = "rascunho" | "briefing_pronto" | "direcao_aprovada" | "em_producao" | "em_revisao" | "pronta" | "em_distribuicao";

export const ROTULO_DO_STATUS: Record<StatusDaCampanha, string> = {
  rascunho: "Rascunho",
  briefing_pronto: "Briefing pronto",
  direcao_aprovada: "Direção aprovada",
  em_producao: "Em produção",
  em_revisao: "Em revisão",
  pronta: "Pronta",
  em_distribuicao: "Em distribuição",
};

export interface CampanhaDePublicidade {
  /** null no rascunho sem banco (modo degradado). */
  id: string | null;
  client_id: string;
  marca_id: string | null;
  nome: string;
  categoria: string | null;
  kit_id: string | null;
  kit_nome: string;
  kit_tipo: string;
  produto_fontes: string[];
  briefing: Briefing;
  briefing_versao: number;
  briefings: { versao: number; criado_em: string | null }[];
  territorios: Territorio[];
  territorio_id: string | null;
  tomadas: TomadaDePublicidade[];
  ensaio_id: string | null;
  revisoes: RevisaoDePublicidade[];
  encaminhamentos: Encaminhamento[];
  /** Salva no banco (false: rascunho só na tela, o SQL da Mesa Publicidade ainda não foi aplicado). */
  persistida: boolean;
  criado_em: string | null;
  atualizado_em: string | null;
}

/** O status sai dos dados (não é escolhido à mão). */
export function statusDaCampanha(c: Pick<CampanhaDePublicidade, "briefing" | "territorio_id" | "ensaio_id" | "tomadas" | "revisoes" | "encaminhamentos">): StatusDaCampanha {
  if (c.encaminhamentos.length) return "em_distribuicao";
  if (c.ensaio_id) {
    const aprovadas = c.revisoes.filter((r) => r.decisao === "aprovada").length;
    if (aprovadas && aprovadas >= Math.min(TOTAL_DE_TOMADAS, c.tomadas.length || TOTAL_DE_TOMADAS)) return "pronta";
    if (c.revisoes.length) return "em_revisao";
    return "em_producao";
  }
  if (c.territorio_id) return "direcao_aprovada";
  return lacunasDoBriefing(c.briefing).length ? "rascunho" : "briefing_pronto";
}

export function campanhaVazia(clientId: string): CampanhaDePublicidade {
  return {
    id: null,
    client_id: clientId,
    marca_id: null,
    nome: "",
    categoria: null,
    kit_id: null,
    kit_nome: "",
    kit_tipo: "",
    produto_fontes: [],
    briefing: briefingVazio(),
    briefing_versao: 1,
    briefings: [],
    territorios: [],
    territorio_id: null,
    tomadas: [],
    ensaio_id: null,
    revisoes: [],
    encaminhamentos: [],
    persistida: false,
    criado_em: null,
    atualizado_em: null,
  };
}

function normalizarRevisao(v: unknown): RevisaoDePublicidade | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, any>;
  const fotoTomada = limpo(r.foto_tomada_id, 80);
  if (!fotoTomada) return null;
  const a = (r.avaliacao && typeof r.avaliacao === "object" ? r.avaliacao : {}) as Record<string, any>;
  const veredito = ["reprovada", "produto_ok", "nao_determinavel", "sem_conferencia"].indexOf(String(a.veredito)) >= 0 ? (a.veredito as VereditoDaRevisao) : "sem_conferencia";
  const mudancas = listaDeTextos(a.mudancas, 5, 20).filter((m) => ["logo", "formato", "cor", "detalhe", "variante"].indexOf(m) >= 0) as MudancaDoProduto[];
  const jev = r.aviso_jev && typeof r.aviso_jev === "object" ? r.aviso_jev : null;
  return {
    id: ehUuid(r.id) ? String(r.id) : limpo(r.id, 80),
    tomada_id: ehUuid(r.tomada_id) ? String(r.tomada_id) : null,
    foto_tomada_id: fotoTomada,
    versao: Number(r.versao) || 0,
    imagem_id: ehUuid(r.imagem_id) ? String(r.imagem_id) : null,
    storage_path: limpo(r.storage_path, 400) || null,
    avaliacao: {
      veredito,
      mudancas,
      motivos: listaDeTextos(a.motivos, 8, 600),
      sem_evidencia: listaDeTextos(a.sem_evidencia, 8, 200),
      estetica: listaDeTextos(a.estetica, 8, 600),
      restricoes_citadas: listaDeTextos(a.restricoes_citadas, 8, 200),
    },
    aviso_jev: jev ? { probabilidade: isFinite(Number(jev.probabilidade)) && jev.probabilidade !== null ? Number(jev.probabilidade) : null, aviso: jev.aviso === true } : null,
    decisao: r.decisao === "aprovada" || r.decisao === "reprovada" ? r.decisao : null,
    motivo: limpo(r.motivo, 800),
    decidido_em: limpo(r.decidido_em, 40) || null,
  };
}

function normalizarEncaminhamento(v: unknown): Encaminhamento | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, any>;
  const destino = r.destino === "mesa" || r.destino === "ads" ? (r.destino as DestinoDoAtivo) : null;
  if (!destino || !ehUuid(r.imagem_id)) return null;
  const l = (r.linhagem && typeof r.linhagem === "object" ? r.linhagem : {}) as Linhagem;
  return { id: limpo(r.id, 80), destino, imagem_id: String(r.imagem_id), linhagem: l, anuncio_aprovado: false, verba_aprovada: false, criado_em: limpo(r.criado_em, 40) || null };
}

/** A campanha como veio da função (ou do rascunho guardado na tela), em forma segura. */
export function normalizarCampanha(v: unknown, clientIdPadrao = ""): CampanhaDePublicidade {
  const r = (v && typeof v === "object" ? v : {}) as Record<string, any>;
  const base = campanhaVazia(ehUuid(r.client_id) ? String(r.client_id) : clientIdPadrao);
  const briefingVersao = Math.max(1, Number(r.briefing_versao) || 1);
  const territorios: Territorio[] = [];
  (Array.isArray(r.territorios) ? r.territorios : []).forEach((t: unknown, i: number) => {
    const n = normalizarTerritorio(t, i, { id: t && typeof t === "object" ? limpo((t as any).id, 80) : "" });
    if (n) territorios.push(n);
  });
  const territorioId = limpo(r.territorio_id, 80) || null;
  const aprovado = territorios.find((t) => t.id === territorioId) || null;
  const receita = receitaDaCategoria(r.categoria);
  const briefing = normalizarBriefing(r.briefing);
  const tomadas = aprovado ? normalizarTomadas(r.tomadas, planoDeTomadas(aprovado, receita, briefing)) : [];
  const revisoes: RevisaoDePublicidade[] = [];
  (Array.isArray(r.revisoes) ? r.revisoes : []).forEach((x: unknown) => {
    const n = normalizarRevisao(x);
    if (n) revisoes.push(n);
  });
  const encaminhamentos: Encaminhamento[] = [];
  (Array.isArray(r.encaminhamentos) ? r.encaminhamentos : []).forEach((x: unknown) => {
    const n = normalizarEncaminhamento(x);
    if (n) encaminhamentos.push(n);
  });
  return {
    ...base,
    id: ehUuid(r.id) ? String(r.id) : null,
    marca_id: ehUuid(r.marca_id) ? String(r.marca_id) : null,
    nome: limpo(r.nome, 120),
    categoria: receita ? receita.id : null,
    kit_id: ehUuid(r.kit_id) ? String(r.kit_id) : null,
    kit_nome: limpo(r.kit_nome, 160),
    kit_tipo: limpo(r.kit_tipo, 30),
    produto_fontes: listaDeTextos(r.produto_fontes, 16, 80).filter((x) => ehUuid(x)),
    briefing,
    briefing_versao: briefingVersao,
    briefings: (Array.isArray(r.briefings) ? r.briefings : [])
      .map((x: any) => ({ versao: Number(x && x.versao) || 0, criado_em: limpo(x && x.criado_em, 40) || null }))
      .filter((x: { versao: number }) => x.versao > 0),
    territorios,
    territorio_id: aprovado ? territorioId : null,
    tomadas,
    ensaio_id: ehUuid(r.ensaio_id) ? String(r.ensaio_id) : null,
    revisoes,
    encaminhamentos,
    persistida: r.persistida === true,
    criado_em: limpo(r.criado_em, 40) || null,
    atualizado_em: limpo(r.atualizado_em, 40) || null,
  };
}
