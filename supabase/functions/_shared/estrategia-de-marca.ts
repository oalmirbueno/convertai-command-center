/**
 * Estratégia de marca (frente IDV2, 30/09/2026): a plataforma que um diretor
 * de branding monta antes do visual. Pedido do dono: "deixe mais completo,
 * com ferramentas e estrutura".
 *
 * Partes: propósito, missão, visão, valores, arquétipo (os 12, com escolha e
 * justificativa), personalidade (eixos), posicionamento, proposta de valor,
 * público e persona, e tom de voz com exemplos "fala assim / não fala assim".
 *
 * Regra da mesa: nada é inventado. Campo vazio fica vazio e aparece no que
 * falta; a IA só propõe (a equipe vê a prévia e aplica).
 *
 * Puro: sem Deno, sem banco. A tela, a função e os testes usam o mesmo
 * arquivo. Sem lookbehind, sem \p{} (Safari 11).
 */

// ------------------------------------------------------------------ arquétipos

export const ARQUETIPOS = [
  { valor: "inocente", rotulo: "Inocente", desejo: "Ser feliz e fazer o certo", voz: "otimista, simples e honesta", tracos: ["pureza", "otimismo", "confiança"], exemplo: "alimentação natural, cuidado infantil" },
  { valor: "explorador", rotulo: "Explorador", desejo: "Liberdade para descobrir", voz: "aventureira, direta e inquieta", tracos: ["independência", "descoberta", "coragem"], exemplo: "viagem, esporte ao ar livre" },
  { valor: "sabio", rotulo: "Sábio", desejo: "Entender o mundo e ensinar", voz: "clara, fundamentada e serena", tracos: ["conhecimento", "análise", "credibilidade"], exemplo: "educação, consultoria, saúde" },
  { valor: "heroi", rotulo: "Herói", desejo: "Provar valor pela superação", voz: "firme, motivadora e objetiva", tracos: ["coragem", "disciplina", "conquista"], exemplo: "esporte de alto rendimento, segurança" },
  { valor: "fora_da_lei", rotulo: "Fora da lei", desejo: "Quebrar o que não funciona", voz: "provocadora, crua e irreverente", tracos: ["rebeldia", "ruptura", "atitude"], exemplo: "moda de rua, bebidas, tecnologia disruptiva" },
  { valor: "mago", rotulo: "Mago", desejo: "Transformar a realidade", voz: "encantadora, visionária e sensorial", tracos: ["transformação", "imaginação", "encanto"], exemplo: "beleza, entretenimento, tecnologia" },
  { valor: "cara_comum", rotulo: "Pessoa comum", desejo: "Pertencer e ser igual a todos", voz: "próxima, simples e sem pose", tracos: ["pertencimento", "empatia", "realismo"], exemplo: "varejo popular, serviços do bairro" },
  { valor: "amante", rotulo: "Amante", desejo: "Viver o prazer e a intimidade", voz: "sensorial, calorosa e elegante", tracos: ["paixão", "estética", "cuidado com o detalhe"], exemplo: "perfumaria, gastronomia, moda" },
  { valor: "bobo_da_corte", rotulo: "Bobo da corte", desejo: "Viver o momento com alegria", voz: "bem-humorada, leve e espirituosa", tracos: ["humor", "leveza", "espontaneidade"], exemplo: "lanches, bebidas, entretenimento" },
  { valor: "cuidador", rotulo: "Cuidador", desejo: "Proteger e cuidar dos outros", voz: "acolhedora, gentil e paciente", tracos: ["acolhimento", "generosidade", "proteção"], exemplo: "saúde, educação infantil, terceiro setor" },
  { valor: "criador", rotulo: "Criador", desejo: "Criar algo de valor duradouro", voz: "inventiva, expressiva e caprichosa", tracos: ["criatividade", "autenticidade", "ofício"], exemplo: "design, arte, marcas autorais" },
  { valor: "governante", rotulo: "Governante", desejo: "Ter controle e criar ordem", voz: "segura, sóbria e exigente", tracos: ["liderança", "excelência", "estabilidade"], exemplo: "finanças, luxo, serviços premium" },
] as const;

export type ArquetipoId = (typeof ARQUETIPOS)[number]["valor"];

const IDS_DE_ARQUETIPO = ARQUETIPOS.map((a) => a.valor) as string[];

export function ehArquetipo(v: unknown): v is ArquetipoId {
  return typeof v === "string" && IDS_DE_ARQUETIPO.indexOf(v) >= 0;
}

export function rotuloDoArquetipo(v: string): string {
  const a = ARQUETIPOS.filter((x) => x.valor === v)[0];
  return a ? a.rotulo : "";
}

const semAcento = (t: string) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** "Sábio", "o sabio", "SÁBIO (Sage)" viram "sabio"; o que não é arquétipo vira "". */
export function arquetipoDoTexto(v: unknown): ArquetipoId | "" {
  if (ehArquetipo(v)) return v;
  const t = semAcento(String(v == null ? "" : v)).replace(/[^a-z ]+/g, " ").trim();
  if (!t) return "";
  for (const a of ARQUETIPOS) {
    const r = semAcento(a.rotulo);
    if (t === r || t === a.valor.replace(/_/g, " ") || t.indexOf(r) >= 0) return a.valor;
  }
  const ingles: Record<string, ArquetipoId> = { innocent: "inocente", explorer: "explorador", sage: "sabio", hero: "heroi", outlaw: "fora_da_lei", rebel: "fora_da_lei", magician: "mago", everyman: "cara_comum", "regular guy": "cara_comum", lover: "amante", jester: "bobo_da_corte", caregiver: "cuidador", creator: "criador", ruler: "governante" };
  for (const k of Object.keys(ingles)) if (t.indexOf(k) >= 0) return ingles[k];
  return "";
}

// ------------------------------------------------------------------ personalidade (eixos)

export const EIXOS_DE_PERSONALIDADE = [
  { valor: "formalidade", esquerda: "Formal", direita: "Descontraída" },
  { valor: "tradicao", esquerda: "Clássica", direita: "Moderna" },
  { valor: "humor", esquerda: "Séria", direita: "Divertida" },
  { valor: "energia", esquerda: "Calma", direita: "Enérgica" },
  { valor: "acesso", esquerda: "Acessível", direita: "Exclusiva" },
  { valor: "razao", esquerda: "Racional", direita: "Emocional" },
] as const;

export type EixoId = (typeof EIXOS_DE_PERSONALIDADE)[number]["valor"];

/** Posição no eixo: -2 (bem à esquerda) a 2 (bem à direita); 0 é o meio. */
export function posicaoNoEixo(v: unknown): number {
  const n = Math.round(Number(v));
  return isFinite(n) ? Math.max(-2, Math.min(2, n)) : 0;
}

/** O eixo em palavras: "bem descontraída", "mais formal", "equilibrada". */
export function textoDoEixo(eixo: EixoId, v: number): string {
  const e = EIXOS_DE_PERSONALIDADE.filter((x) => x.valor === eixo)[0];
  if (!e || v === 0) return "equilibrada";
  const lado = v < 0 ? e.esquerda : e.direita;
  return `${Math.abs(v) === 2 ? "bem" : "mais"} ${lado.toLowerCase()}`;
}

// ------------------------------------------------------------------ o dado

export type ValorDaMarca = { nome: string; descricao: string };
export type Persona = { nome: string; idade: string; ocupacao: string; rotina: string; dores: string[]; desejos: string[]; onde_esta: string[]; objecoes: string[]; frase: string };
export type ExemploDeTom = { situacao: string; certo: string; errado: string };

export type Estrategia = {
  proposito: string;
  missao: string;
  visao: string;
  valores: ValorDaMarca[];
  arquetipo: { principal: ArquetipoId | ""; secundario: ArquetipoId | ""; justificativa: string };
  personalidade: { eixos: Record<EixoId, number>; tracos: string[] };
  posicionamento: { publico: string; categoria: string; diferencial: string; prova: string; concorrentes: string; declaracao: string };
  proposta_de_valor: { promessa: string; ganhos: string[]; dores: string[]; alivios: string[] };
  publico: { resumo: string; persona: Persona };
  tom: { atributos: string[]; fala_assim: string[]; nao_fala_assim: string[]; exemplos: ExemploDeTom[] };
  /** De onde veio a última proposta da IA (a equipe vê e confere). */
  fontes: string[];
  atualizado_em: string | null;
};

const str = (v: unknown, max = 600) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const txt = (v: unknown, max = 1500) => String(v == null ? "" : v).replace(/[ \t]+/g, " ").trim().slice(0, max);
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const listaDeTexto = (v: unknown, max = 8, tam = 200): string[] => {
  const bruto = Array.isArray(v) ? v : typeof v === "string" ? v.split(/\n+|;/) : [];
  const saida: string[] = [];
  for (const x of bruto) {
    const s = str(typeof x === "object" && x ? (x as Record<string, unknown>).texto ?? JSON.stringify(x) : x, tam).replace(/^(?:[-*•]+\s*|\d{1,2}[.)]\s+)/, "").trim();
    if (s && saida.indexOf(s) < 0) saida.push(s);
    if (saida.length >= max) break;
  }
  return saida;
};

export function eixosVazios(): Record<EixoId, number> {
  const e = {} as Record<EixoId, number>;
  for (const x of EIXOS_DE_PERSONALIDADE) e[x.valor] = 0;
  return e;
}

export function personaVazia(): Persona {
  return { nome: "", idade: "", ocupacao: "", rotina: "", dores: [], desejos: [], onde_esta: [], objecoes: [], frase: "" };
}

export function estrategiaVazia(): Estrategia {
  return {
    proposito: "",
    missao: "",
    visao: "",
    valores: [],
    arquetipo: { principal: "", secundario: "", justificativa: "" },
    personalidade: { eixos: eixosVazios(), tracos: [] },
    posicionamento: { publico: "", categoria: "", diferencial: "", prova: "", concorrentes: "", declaracao: "" },
    proposta_de_valor: { promessa: "", ganhos: [], dores: [], alivios: [] },
    publico: { resumo: "", persona: personaVazia() },
    tom: { atributos: [], fala_assim: [], nao_fala_assim: [], exemplos: [] },
    fontes: [],
    atualizado_em: null,
  };
}

/** "Coragem: a gente assume riscos" e { nome, descricao } viram valor; repetido sai. */
export function valoresDoTexto(v: unknown): ValorDaMarca[] {
  const bruto = Array.isArray(v) ? v : typeof v === "string" ? v.split(/\n+/) : [];
  const saida: ValorDaMarca[] = [];
  for (const x of bruto) {
    let nome = "";
    let descricao = "";
    if (x && typeof x === "object") {
      nome = str((x as Record<string, unknown>).nome, 60);
      descricao = str((x as Record<string, unknown>).descricao, 240);
    } else {
      const s = str(x, 300).replace(/^(?:[-*•]+\s*|\d{1,2}[.)]\s+)/, "");
      const i = s.search(/[:–]/);
      nome = (i > 0 ? s.slice(0, i) : s).trim().slice(0, 60);
      descricao = i > 0 ? s.slice(i + 1).trim().slice(0, 240) : "";
    }
    if (!nome || saida.some((s) => semAcento(s.nome) === semAcento(nome))) continue;
    saida.push({ nome, descricao });
    if (saida.length >= 7) break;
  }
  return saida;
}

function exemplosDoTexto(v: unknown): ExemploDeTom[] {
  const saida: ExemploDeTom[] = [];
  for (const x of Array.isArray(v) ? v : []) {
    const o = obj(x);
    const e = { situacao: str(o.situacao, 160), certo: str(o.certo ?? o.fala_assim, 260), errado: str(o.errado ?? o.nao_fala_assim, 260) };
    if (e.certo || e.errado) saida.push(e);
    if (saida.length >= 6) break;
  }
  return saida;
}

/** Qualquer JSON vira uma estratégia segura (o que não serve some, nunca quebra). */
export function normalizarEstrategia(bruto: unknown): Estrategia {
  const o = obj(bruto);
  const arq = obj(o.arquetipo);
  const pers = obj(o.personalidade);
  const eixosBrutos = obj(pers.eixos);
  const eixos = eixosVazios();
  for (const e of EIXOS_DE_PERSONALIDADE) eixos[e.valor] = posicaoNoEixo(eixosBrutos[e.valor]);
  const pos = obj(o.posicionamento);
  const pv = obj(o.proposta_de_valor);
  const pub = obj(o.publico);
  const per = obj(pub.persona);
  const tom = obj(o.tom);
  const principal = arquetipoDoTexto(arq.principal);
  const secundario = arquetipoDoTexto(arq.secundario);
  return {
    proposito: txt(o.proposito, 600),
    missao: txt(o.missao, 600),
    visao: txt(o.visao, 600),
    valores: valoresDoTexto(o.valores),
    arquetipo: { principal, secundario: secundario && secundario !== principal ? secundario : "", justificativa: txt(arq.justificativa, 900) },
    personalidade: { eixos, tracos: listaDeTexto(pers.tracos, 6, 40) },
    posicionamento: {
      publico: txt(pos.publico, 400),
      categoria: str(pos.categoria, 160),
      diferencial: txt(pos.diferencial, 400),
      prova: txt(pos.prova, 400),
      concorrentes: txt(pos.concorrentes, 400),
      declaracao: txt(pos.declaracao, 600),
    },
    proposta_de_valor: { promessa: txt(pv.promessa, 400), ganhos: listaDeTexto(pv.ganhos, 6), dores: listaDeTexto(pv.dores, 6), alivios: listaDeTexto(pv.alivios, 6) },
    publico: {
      resumo: txt(pub.resumo, 900),
      persona: {
        nome: str(per.nome, 60),
        idade: str(per.idade, 30),
        ocupacao: str(per.ocupacao, 120),
        rotina: txt(per.rotina, 600),
        dores: listaDeTexto(per.dores, 6),
        desejos: listaDeTexto(per.desejos, 6),
        onde_esta: listaDeTexto(per.onde_esta, 6, 80),
        objecoes: listaDeTexto(per.objecoes, 6),
        frase: str(per.frase, 200),
      },
    },
    tom: { atributos: listaDeTexto(tom.atributos, 6, 40), fala_assim: listaDeTexto(tom.fala_assim, 8, 240), nao_fala_assim: listaDeTexto(tom.nao_fala_assim, 8, 240), exemplos: exemplosDoTexto(tom.exemplos) },
    fontes: listaDeTexto(o.fontes, 12, 160),
    atualizado_em: typeof o.atualizado_em === "string" ? o.atualizado_em.slice(0, 40) : null,
  };
}

// ------------------------------------------------------------------ posicionamento

/**
 * A frase de posicionamento no molde clássico: "Para [público], [marca] é
 * [categoria] que [diferencial], porque [prova]." Sem as partes, devolve "".
 */
export function declaracaoDePosicionamento(p: Estrategia["posicionamento"], marca: string): string {
  if (!p.publico || !p.categoria || !p.diferencial) return "";
  const nome = str(marca, 80) || "a marca";
  const sem = (s: string) => s.replace(/[.\s]+$/, "");
  const prova = p.prova ? `, porque ${sem(p.prova).replace(/^porque\s+/i, "")}` : "";
  return `Para ${sem(p.publico).replace(/^para\s+/i, "")}, ${nome} é ${sem(p.categoria)} que ${sem(p.diferencial).replace(/^que\s+/i, "")}${prova}.`;
}

// ------------------------------------------------------------------ seções e o que falta

export const SECOES_DA_ESTRATEGIA = [
  { valor: "plataforma", rotulo: "Propósito, missão e visão" },
  { valor: "valores", rotulo: "Valores" },
  { valor: "arquetipo", rotulo: "Arquétipo" },
  { valor: "personalidade", rotulo: "Personalidade" },
  { valor: "posicionamento", rotulo: "Posicionamento" },
  { valor: "proposta", rotulo: "Proposta de valor" },
  { valor: "publico", rotulo: "Público e persona" },
  { valor: "tom", rotulo: "Tom de voz" },
] as const;

export type SecaoDaEstrategia = (typeof SECOES_DA_ESTRATEGIA)[number]["valor"];

const temTexto = (s: string) => !!s && s.trim().length > 0;

/** A seção está feita? (o mínimo de cada uma; a tela mostra "3 de 8"). */
export function secaoFeita(secao: SecaoDaEstrategia, e: Estrategia): boolean {
  switch (secao) {
    case "plataforma":
      return temTexto(e.proposito) && (temTexto(e.missao) || temTexto(e.visao));
    case "valores":
      return e.valores.length >= 3;
    case "arquetipo":
      return !!e.arquetipo.principal && temTexto(e.arquetipo.justificativa);
    case "personalidade":
      return e.personalidade.tracos.length >= 3 || EIXOS_DE_PERSONALIDADE.some((x) => e.personalidade.eixos[x.valor] !== 0);
    case "posicionamento":
      return temTexto(e.posicionamento.declaracao) || (temTexto(e.posicionamento.publico) && temTexto(e.posicionamento.diferencial));
    case "proposta":
      return temTexto(e.proposta_de_valor.promessa);
    case "publico":
      return temTexto(e.publico.resumo) || temTexto(e.publico.persona.nome);
    case "tom":
      return e.tom.fala_assim.length > 0 && e.tom.nao_fala_assim.length > 0;
  }
  return false;
}

export function progressoDaEstrategia(e: Estrategia): { feitas: number; total: number } {
  return { feitas: SECOES_DA_ESTRATEGIA.filter((s) => secaoFeita(s.valor, e)).length, total: SECOES_DA_ESTRATEGIA.length };
}

/** O mínimo para concluir a etapa Estratégia (o texto é o que a tela mostra). */
export function faltaNaEstrategia(bruto: unknown): string[] {
  const e = normalizarEstrategia(bruto);
  const falta: string[] = [];
  if (!temTexto(e.proposito) && !temTexto(e.missao)) falta.push("O propósito ou a missão");
  if (!e.arquetipo.principal) falta.push("O arquétipo principal");
  if (!secaoFeita("posicionamento", e)) falta.push("O posicionamento (para quem e o diferencial)");
  if (!e.tom.fala_assim.length) falta.push("O tom de voz (como a marca fala)");
  return falta;
}

// ------------------------------------------------------------------ campos para o "Preencher com IA"

/** O mesmo formato do CampoParaPreencher da tela (src/components/sistema/PreencherComIA.tsx). */
export type CampoDaEstrategia = {
  chave: string;
  rotulo: string;
  tipo: "texto" | "texto_longo" | "lista" | "numero" | "escolha" | "objeto";
  opcoes?: string[];
  valorAtual?: unknown;
  dica?: string;
  maximo?: number;
};

const SEM_INVENTAR = "Só com base nas fontes; sem número, prêmio ou fato que não esteja nelas.";

/** Os campos de uma seção (ou de todas), com o valor atual, para o "Preencher com IA". */
export function camposDaEstrategia(e: Estrategia, secao?: SecaoDaEstrategia): CampoDaEstrategia[] {
  const todos: Array<{ secao: SecaoDaEstrategia; campo: CampoDaEstrategia }> = [
    { secao: "plataforma", campo: { chave: "proposito", rotulo: "Propósito", tipo: "texto_longo", valorAtual: e.proposito, dica: "Por que a marca existe, além de vender. Uma ou duas frases.", maximo: 600 } },
    { secao: "plataforma", campo: { chave: "missao", rotulo: "Missão", tipo: "texto_longo", valorAtual: e.missao, dica: "O que a marca faz, para quem e como, hoje.", maximo: 600 } },
    { secao: "plataforma", campo: { chave: "visao", rotulo: "Visão", tipo: "texto_longo", valorAtual: e.visao, dica: "Onde a marca quer chegar. Sem número inventado.", maximo: 600 } },
    { secao: "valores", campo: { chave: "valores", rotulo: "Valores", tipo: "lista", valorAtual: e.valores.map((v) => (v.descricao ? `${v.nome}: ${v.descricao}` : v.nome)), dica: "De 3 a 5, no formato 'Nome: como aparece no dia a dia'.", maximo: 5 } },
    { secao: "arquetipo", campo: { chave: "arquetipo.principal", rotulo: "Arquétipo principal", tipo: "escolha", opcoes: ARQUETIPOS.map((a) => a.rotulo), valorAtual: rotuloDoArquetipo(e.arquetipo.principal), dica: "Um dos 12 arquétipos de marca." } },
    { secao: "arquetipo", campo: { chave: "arquetipo.secundario", rotulo: "Arquétipo de apoio", tipo: "escolha", opcoes: ARQUETIPOS.map((a) => a.rotulo), valorAtual: rotuloDoArquetipo(e.arquetipo.secundario), dica: "Opcional; diferente do principal." } },
    { secao: "arquetipo", campo: { chave: "arquetipo.justificativa", rotulo: "Por que este arquétipo", tipo: "texto_longo", valorAtual: e.arquetipo.justificativa, dica: `Ligue ao briefing e ao público. ${SEM_INVENTAR}`, maximo: 900 } },
    { secao: "personalidade", campo: { chave: "personalidade.tracos", rotulo: "Traços de personalidade", tipo: "lista", valorAtual: e.personalidade.tracos, dica: "De 3 a 5 adjetivos.", maximo: 5 } },
    ...EIXOS_DE_PERSONALIDADE.map((x) => ({ secao: "personalidade" as SecaoDaEstrategia, campo: { chave: `personalidade.eixos.${x.valor}`, rotulo: `${x.esquerda} ou ${x.direita}`, tipo: "numero" as const, valorAtual: e.personalidade.eixos[x.valor], dica: `Inteiro de -2 (${x.esquerda.toLowerCase()}) a 2 (${x.direita.toLowerCase()}); 0 é o meio.` } })),
    { secao: "posicionamento", campo: { chave: "posicionamento.publico", rotulo: "Para quem", tipo: "texto", valorAtual: e.posicionamento.publico, maximo: 400 } },
    { secao: "posicionamento", campo: { chave: "posicionamento.categoria", rotulo: "Categoria", tipo: "texto", valorAtual: e.posicionamento.categoria, dica: "Em que prateleira a marca compete (ex.: a padaria de fermentação natural do bairro).", maximo: 160 } },
    { secao: "posicionamento", campo: { chave: "posicionamento.diferencial", rotulo: "Diferencial", tipo: "texto", valorAtual: e.posicionamento.diferencial, maximo: 400 } },
    { secao: "posicionamento", campo: { chave: "posicionamento.prova", rotulo: "Prova (por que acreditar)", tipo: "texto", valorAtual: e.posicionamento.prova, dica: SEM_INVENTAR, maximo: 400 } },
    { secao: "posicionamento", campo: { chave: "posicionamento.concorrentes", rotulo: "Contra quem", tipo: "texto", valorAtual: e.posicionamento.concorrentes, maximo: 400 } },
    { secao: "proposta", campo: { chave: "proposta_de_valor.promessa", rotulo: "Promessa", tipo: "texto", valorAtual: e.proposta_de_valor.promessa, dica: "O que o cliente ganha, numa frase.", maximo: 400 } },
    { secao: "proposta", campo: { chave: "proposta_de_valor.ganhos", rotulo: "Ganhos", tipo: "lista", valorAtual: e.proposta_de_valor.ganhos, maximo: 5 } },
    { secao: "proposta", campo: { chave: "proposta_de_valor.dores", rotulo: "Dores do cliente", tipo: "lista", valorAtual: e.proposta_de_valor.dores, maximo: 5 } },
    { secao: "proposta", campo: { chave: "proposta_de_valor.alivios", rotulo: "Como a marca alivia", tipo: "lista", valorAtual: e.proposta_de_valor.alivios, maximo: 5 } },
    { secao: "publico", campo: { chave: "publico.resumo", rotulo: "Público", tipo: "texto_longo", valorAtual: e.publico.resumo, maximo: 900 } },
    { secao: "publico", campo: { chave: "publico.persona", rotulo: "Persona", tipo: "objeto", valorAtual: e.publico.persona, dica: "Objeto { nome, idade, ocupacao, rotina, dores[], desejos[], onde_esta[], objecoes[], frase }. Persona é modelo, não pessoa real; idade em faixa." } },
    { secao: "tom", campo: { chave: "tom.atributos", rotulo: "Atributos da voz", tipo: "lista", valorAtual: e.tom.atributos, dica: "De 3 a 5 (ex.: próxima, direta, bem-humorada).", maximo: 5 } },
    { secao: "tom", campo: { chave: "tom.fala_assim", rotulo: "Fala assim", tipo: "lista", valorAtual: e.tom.fala_assim, dica: "Frases de exemplo no tom certo.", maximo: 6 } },
    { secao: "tom", campo: { chave: "tom.nao_fala_assim", rotulo: "Não fala assim", tipo: "lista", valorAtual: e.tom.nao_fala_assim, dica: "Frases que a marca nunca diria.", maximo: 6 } },
    { secao: "tom", campo: { chave: "tom.exemplos", rotulo: "Exemplos por situação", tipo: "objeto", valorAtual: e.tom.exemplos, dica: "Lista de { situacao, certo, errado } (ex.: responder reclamação, anunciar promoção).", maximo: 4 } },
  ];
  return todos.filter((t) => !secao || t.secao === secao).map((t) => t.campo);
}

/** Escreve um caminho ("tom.fala_assim") num objeto, sem mexer no resto. */
function comCaminho(base: Record<string, unknown>, chave: string, valor: unknown): Record<string, unknown> {
  const partes = chave.split(".");
  const raiz: Record<string, unknown> = { ...base };
  let atual = raiz;
  for (let i = 0; i < partes.length - 1; i++) {
    const p = partes[i];
    const prox = obj(atual[p]);
    atual[p] = { ...prox };
    atual = atual[p] as Record<string, unknown>;
  }
  atual[partes[partes.length - 1]] = valor;
  return raiz;
}

/** Lê um caminho ("posicionamento.diferencial") da estratégia. */
export function valorDoCaminho(e: Estrategia, chave: string): unknown {
  let atual: unknown = e;
  for (const p of chave.split(".")) atual = obj(atual)[p];
  return atual;
}

/**
 * Aplica os valores que vieram do "Preencher com IA" (ou da proposta inteira)
 * por chave. Arquétipo aceita o rótulo; valores aceitam "Nome: descrição".
 */
export function aplicarNaEstrategia(e: Estrategia, valores: Record<string, unknown>): Estrategia {
  let bruto: Record<string, unknown> = JSON.parse(JSON.stringify(e));
  for (const chave of Object.keys(valores)) {
    const v = valores[chave];
    if (v === undefined) continue;
    if (chave === "valores") bruto.valores = valoresDoTexto(v);
    else if (chave === "arquetipo.principal" || chave === "arquetipo.secundario") bruto = comCaminho(bruto, chave, arquetipoDoTexto(v));
    else bruto = comCaminho(bruto, chave, v);
  }
  return normalizarEstrategia(bruto);
}

/** Só as chaves que mudam (a prévia mostra antes x depois). */
export function diferencasDaEstrategia(antes: Estrategia, depois: Estrategia): Array<{ chave: string; rotulo: string; antes: unknown; depois: unknown }> {
  const saida: Array<{ chave: string; rotulo: string; antes: unknown; depois: unknown }> = [];
  for (const c of camposDaEstrategia(depois)) {
    const a = valorDoCaminho(antes, c.chave);
    const d = valorDoCaminho(depois, c.chave);
    if (JSON.stringify(a) !== JSON.stringify(d)) saida.push({ chave: c.chave, rotulo: c.rotulo, antes: a, depois: d });
  }
  return saida;
}

/** Vazio? (string vazia, lista vazia, objeto sem nada, eixo 0). */
export function vazio(v: unknown): boolean {
  if (v == null || v === 0) return true;
  if (typeof v === "string") return !v.trim();
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v as Record<string, unknown>).every((k) => vazio((v as Record<string, unknown>)[k]));
  return false;
}

/**
 * Junta a proposta na estratégia atual: por padrão só preenche o que está
 * vazio; com `substituir`, troca tudo o que veio. Devolve também as chaves
 * que mudaram (para o Desfazer campo a campo).
 */
export function juntarProposta(atual: Estrategia, proposta: Estrategia, opcoes: { substituir?: boolean; chaves?: string[] } = {}): { estrategia: Estrategia; mudaram: string[] } {
  const valores: Record<string, unknown> = {};
  for (const c of camposDaEstrategia(proposta)) {
    if (opcoes.chaves && opcoes.chaves.indexOf(c.chave) < 0) continue;
    const novo = valorDoCaminho(proposta, c.chave);
    if (vazio(novo)) continue;
    if (!opcoes.substituir && !vazio(valorDoCaminho(atual, c.chave))) continue;
    valores[c.chave] = novo;
  }
  const estrategia = aplicarNaEstrategia(atual, valores);
  if (!estrategia.posicionamento.declaracao && (valores["posicionamento.publico"] || valores["posicionamento.diferencial"])) {
    estrategia.posicionamento.declaracao = proposta.posicionamento.declaracao;
  }
  return { estrategia, mudaram: Object.keys(valores) };
}

// ------------------------------------------------------------------ esquema para a função (proposta inteira)

const TEXTO = { type: "string" };
const LISTA = { type: "array", items: { type: "string" } };

export const ESQUEMA_DA_ESTRATEGIA = {
  nome: "estrategia_de_marca",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["proposito", "missao", "visao", "valores", "arquetipo", "personalidade", "posicionamento", "proposta_de_valor", "publico", "tom", "fontes", "avisos"],
    properties: {
      proposito: TEXTO,
      missao: TEXTO,
      visao: TEXTO,
      valores: { type: "array", items: { type: "object", additionalProperties: false, required: ["nome", "descricao"], properties: { nome: TEXTO, descricao: TEXTO } } },
      arquetipo: {
        type: "object",
        additionalProperties: false,
        required: ["principal", "secundario", "justificativa"],
        properties: { principal: { type: "string", enum: IDS_DE_ARQUETIPO }, secundario: { type: "string", enum: IDS_DE_ARQUETIPO.concat([""]) }, justificativa: TEXTO },
      },
      personalidade: {
        type: "object",
        additionalProperties: false,
        required: ["eixos", "tracos"],
        properties: {
          eixos: { type: "object", additionalProperties: false, required: EIXOS_DE_PERSONALIDADE.map((e) => e.valor), properties: EIXOS_DE_PERSONALIDADE.reduce((a, e) => ({ ...a, [e.valor]: { type: "integer", minimum: -2, maximum: 2 } }), {} as Record<string, unknown>) },
          tracos: LISTA,
        },
      },
      posicionamento: { type: "object", additionalProperties: false, required: ["publico", "categoria", "diferencial", "prova", "concorrentes", "declaracao"], properties: { publico: TEXTO, categoria: TEXTO, diferencial: TEXTO, prova: TEXTO, concorrentes: TEXTO, declaracao: TEXTO } },
      proposta_de_valor: { type: "object", additionalProperties: false, required: ["promessa", "ganhos", "dores", "alivios"], properties: { promessa: TEXTO, ganhos: LISTA, dores: LISTA, alivios: LISTA } },
      publico: {
        type: "object",
        additionalProperties: false,
        required: ["resumo", "persona"],
        properties: {
          resumo: TEXTO,
          persona: { type: "object", additionalProperties: false, required: ["nome", "idade", "ocupacao", "rotina", "dores", "desejos", "onde_esta", "objecoes", "frase"], properties: { nome: TEXTO, idade: TEXTO, ocupacao: TEXTO, rotina: TEXTO, dores: LISTA, desejos: LISTA, onde_esta: LISTA, objecoes: LISTA, frase: TEXTO } },
        },
      },
      tom: {
        type: "object",
        additionalProperties: false,
        required: ["atributos", "fala_assim", "nao_fala_assim", "exemplos"],
        properties: { atributos: LISTA, fala_assim: LISTA, nao_fala_assim: LISTA, exemplos: { type: "array", items: { type: "object", additionalProperties: false, required: ["situacao", "certo", "errado"], properties: { situacao: TEXTO, certo: TEXTO, errado: TEXTO } } } },
      },
      fontes: LISTA,
      avisos: LISTA,
    },
  },
};

/** O que a estratégia leva ao brandbook (plataforma e tom). */
export function estrategiaParaBrandbook(bruto: unknown, marca: string): {
  proposito: string;
  missao: string;
  visao: string;
  valores: string[];
  personalidade: string[];
  arquetipo: string;
  arquetipo_justificativa: string;
  publico: string;
  posicionamento: string;
  promessa: string;
  como_fala: string[];
  como_nao_fala: string[];
  exemplos: Array<{ certo: string; errado: string }>;
} | null {
  const e = normalizarEstrategia(bruto);
  if (!progressoDaEstrategia(e).feitas && !e.proposito && !e.missao) return null;
  const tracos = e.personalidade.tracos.length
    ? e.personalidade.tracos
    : EIXOS_DE_PERSONALIDADE.filter((x) => e.personalidade.eixos[x.valor] !== 0).map((x) => textoDoEixo(x.valor, e.personalidade.eixos[x.valor]));
  return {
    proposito: e.proposito,
    missao: e.missao,
    visao: e.visao,
    valores: e.valores.map((v) => (v.descricao ? `${v.nome}: ${v.descricao}` : v.nome)),
    personalidade: tracos,
    arquetipo: [rotuloDoArquetipo(e.arquetipo.principal), rotuloDoArquetipo(e.arquetipo.secundario)].filter(Boolean).join(" com "),
    arquetipo_justificativa: e.arquetipo.justificativa,
    publico: e.publico.resumo || e.posicionamento.publico,
    posicionamento: e.posicionamento.declaracao || declaracaoDePosicionamento(e.posicionamento, marca),
    promessa: e.proposta_de_valor.promessa,
    como_fala: e.tom.fala_assim.length ? e.tom.fala_assim : e.tom.atributos,
    como_nao_fala: e.tom.nao_fala_assim,
    exemplos: e.tom.exemplos.map((x) => ({ certo: x.certo, errado: x.errado })),
  };
}
