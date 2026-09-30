/**
 * Naming (frente IDV, 30/09/2026): criador de nomes da Mesa Identidade,
 * chamável também da Mesa → Campanhas (nome de campanha).
 *
 * Método (plano p3, 2.3):
 * 1. gerar muitos candidatos por técnica (descritivo, evocativo, neologismo,
 *    composto, acrônimo, metáfora...). Gerar é texto criativo: vai ao modelo
 *    de texto, com o custo antes;
 * 2. filtrar: domínio .com.br e .com pelo RDAP público (registro.br e
 *    Verisign; sem resposta clara, "não conferido"), @ do Instagram sempre "a
 *    conferir" com o link (o Instagram não responde sem login) e o INPI com o
 *    link de busca pronto (sem raspagem);
 * 3. ranquear pelos critérios do briefing: julgamento, então é o Jev (Score,
 *    uma pergunta por nome), nunca prompt-e-parse. O domínio livre dá um
 *    bônus pequeno; o registrado, um desconto;
 * 4. de 3 a 5 finalistas, cada um com a justificativa.
 *
 * Puro: sem Deno, sem banco. O fetch e o Jev chegam por parâmetro (o teste
 * usa os falsos). Sem lookbehind, sem \p{} (Safari 11).
 */

/** Formas do Jev que o naming usa (as mesmas de jev.ts, repetidas aqui para a tela não puxar o arquivo do Deno). */
export type PerguntaJev = { type: "score"; instructions: unknown; criteria: string[] } | { type: "choice"; instructions: unknown; criteria: Record<string, unknown> } | { type: "noul"; instructions: unknown };
export type RespostaJev = { choice?: string; confidence?: number; probabilities?: Record<string, number>; score?: number; noul?: number };

// ------------------------------------------------------------------ técnicas

export const TECNICAS_DE_NAMING = [
  { valor: "descritivo", rotulo: "Descritivo", explica: "Diz o que a empresa faz, sem rodeio." },
  { valor: "evocativo", rotulo: "Evocativo", explica: "Sugere uma sensação ou um benefício, sem descrever." },
  { valor: "neologismo", rotulo: "Neologismo", explica: "Palavra inventada, curta e fácil de falar." },
  { valor: "composto", rotulo: "Composto", explica: "Duas palavras inteiras juntas." },
  { valor: "aglutinacao", rotulo: "Aglutinação", explica: "Pedaços de duas palavras fundidos numa só." },
  { valor: "acronimo", rotulo: "Acrônimo", explica: "Iniciais que formam uma palavra que se fala." },
  { valor: "metafora", rotulo: "Metáfora", explica: "Imagem de outro mundo que carrega a ideia da marca." },
  { valor: "estrangeiro", rotulo: "Outra língua", explica: "Palavra de outra língua com o sentido certo e fácil no Brasil." },
  { valor: "lugar", rotulo: "Lugar ou origem", explica: "Um lugar, uma rua, uma origem que conta a história." },
  { valor: "fundador", rotulo: "Nome próprio", explica: "Nome ou sobrenome de quem fundou, com assinatura." },
  // Frente IDV2 (30/09): mais técnicas do repertório de naming.
  { valor: "arbitrario", rotulo: "Palavra arbitrária", explica: "Palavra comum sem ligação com o setor, que vira dona do sentido." },
  { valor: "aliteracao", rotulo: "Aliteração e rima", explica: "Sons que se repetem e grudam na memória." },
  { valor: "onomatopeia", rotulo: "Onomatopeia", explica: "O som da coisa ou da sensação virando nome." },
  { valor: "truncamento", rotulo: "Corte de palavra", explica: "Uma palavra encurtada que ganha força." },
  { valor: "afixacao", rotulo: "Prefixo ou sufixo", explica: "Uma raiz com prefixo ou sufixo que dá o tom." },
  { valor: "mitologia", rotulo: "Mito e história", explica: "Figura, lugar ou ideia da mitologia e da história que carrega o valor da marca." },
] as const;

export type TecnicaDeNaming = (typeof TECNICAS_DE_NAMING)[number]["valor"];

export const TECNICAS_VALIDAS = TECNICAS_DE_NAMING.map((t) => t.valor) as TecnicaDeNaming[];

export function ehTecnica(v: unknown): v is TecnicaDeNaming {
  return typeof v === "string" && TECNICAS_VALIDAS.indexOf(v as TecnicaDeNaming) >= 0;
}

export function rotuloDaTecnica(v: string): string {
  const t = TECNICAS_DE_NAMING.filter((x) => x.valor === v)[0];
  return t ? t.rotulo : v;
}

export type AlvoDoNaming = "marca" | "campanha" | "produto";

export const ROTULO_DO_ALVO: Record<AlvoDoNaming, string> = {
  marca: "nome da marca",
  campanha: "nome da campanha",
  produto: "nome do produto",
};

/** Critérios padrão quando o briefing não traz os seus. */
export const CRITERIOS_PADRAO = [
  "Fácil de falar, escrever e lembrar",
  "Combina com a personalidade e o público da marca",
  "Diferente dos concorrentes",
  "Funciona no Brasil (som, sentido e escrita)",
];

export const LIMITES_DO_NAMING = { minimo: 6, maximo: 40, padrao: 18, finalistasMin: 3, finalistasMax: 5, noJev: 24, porChamadaDoJev: 12 } as const;

// ------------------------------------------------------------------ texto do nome

const semAcento = (t: string) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/** Nome limpo para mostrar: uma linha, sem aspas nem ponto final, até 40 letras. */
export function limparNome(v: unknown): string {
  return String(v == null ? "" : v)
    .replace(/[\r\n\t]+/g, " ")
    .replace(/["“”'`´]/g, "")
    .replace(/\s+/g, " ")
    .replace(/[.;:!?]+$/g, "")
    .trim()
    .slice(0, 40);
}

/** O nome como domínio: sem acento, sem espaço, só letras, números e hífen (2 a 63). */
export function slugDoNome(nome: string): string | null {
  const s = semAcento(nome)
    .toLowerCase()
    .replace(/&/g, "e")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
  return s.length >= 2 && s.length <= 63 ? s : null;
}

/** O @ provável no Instagram: letras, números, ponto e sublinhado, até 30. */
export function arrobaDoNome(nome: string): string | null {
  const s = semAcento(nome).toLowerCase().replace(/[^a-z0-9._]+/g, "").replace(/^\.+|\.+$/g, "").slice(0, 30);
  return s.length >= 1 ? s : null;
}

export function linkDoInpi(nome: string): string {
  return `https://busca.inpi.gov.br/pePI/servlet/MarcasServletController?Action=searchMarca&tipoPesquisa=BY_MARCA_CLASSIF_BASICA&marca=${encodeURIComponent(limparNome(nome))}&buscaExata=nao&registerPerPage=100`;
}

export function linkDoInstagram(arroba: string): string {
  return `https://www.instagram.com/${encodeURIComponent(arroba)}/`;
}

export function linkDoRegistroBr(slug: string): string {
  return `https://registro.br/busca-dominio/?fqdn=${encodeURIComponent(`${slug}.com.br`)}`;
}

// ------------------------------------------------------------------ candidatos

export type SituacaoDoDominio = "livre" | "registrado" | "nao_conferido";

export type FiltrosDoNome = {
  com_br: SituacaoDoDominio;
  com: SituacaoDoDominio;
  /** O Instagram não responde sem login: sempre a conferir, com o link. */
  instagram: "a_conferir";
  arroba: string | null;
  link_instagram: string | null;
  link_inpi: string;
  link_registro_br: string | null;
  conferido_em: string | null;
};

export type CandidatoDeNome = {
  id: string;
  nome: string;
  tecnica: TecnicaDeNaming;
  /** Por que o nome serve (vem da geração). */
  justificativa: string;
  /** Como se fala, quando não é óbvio. */
  pronuncia: string | null;
  slug: string | null;
  filtros: FiltrosDoNome;
  /** Nota do Jev (0 a 1) contra os critérios; null quando o Jev não respondeu. */
  nota_jev: number | null;
  /** Nota final (Jev + domínio), 0 a 1. */
  nota: number | null;
  finalista: boolean;
  /** Teste de pronúncia e de significado em outros idiomas (IDV2): aviso, nunca trava. */
  idiomas?: LeituraEmIdioma[];
  risco_idioma?: RiscoDoIdioma;
};

export function filtrosIniciais(nome: string): FiltrosDoNome {
  const slug = slugDoNome(nome);
  const arroba = arrobaDoNome(nome);
  return {
    com_br: "nao_conferido",
    com: "nao_conferido",
    instagram: "a_conferir",
    arroba,
    link_instagram: arroba ? linkDoInstagram(arroba) : null,
    link_inpi: linkDoInpi(nome),
    link_registro_br: slug ? linkDoRegistroBr(slug) : null,
    conferido_em: null,
  };
}

/**
 * O que o modelo devolveu vira candidato: técnica conhecida (senão
 * "evocativo"), nome limpo, sem repetir (mesmo nome sem acento e sem espaço),
 * no máximo `limite`. Nome igual a um termo proibido (o nome atual da marca,
 * no rebranding) fica de fora.
 */
export function normalizarCandidatos(bruto: unknown, opcoes: { limite?: number; proibidos?: string[] } = {}): CandidatoDeNome[] {
  const itens = Array.isArray(bruto) ? bruto : bruto && typeof bruto === "object" && Array.isArray((bruto as Record<string, unknown>).candidatos) ? ((bruto as Record<string, unknown>).candidatos as unknown[]) : [];
  const limite = Math.max(1, Math.min(LIMITES_DO_NAMING.maximo, opcoes.limite || LIMITES_DO_NAMING.maximo));
  const proibidos = (opcoes.proibidos || []).map((p) => slugDoNome(p)).filter(Boolean);
  const vistos = new Set<string>();
  const saida: CandidatoDeNome[] = [];
  for (const b of itens) {
    if (saida.length >= limite) break;
    const o = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
    const nome = limparNome(o.nome);
    if (nome.length < 2) continue;
    const chave = slugDoNome(nome) || semAcento(nome).toLowerCase();
    if (vistos.has(chave) || proibidos.indexOf(chave) >= 0) continue;
    vistos.add(chave);
    const tecnica = ehTecnica(o.tecnica) ? o.tecnica : "evocativo";
    saida.push({
      id: `n${saida.length + 1}`,
      nome,
      tecnica,
      justificativa: String(o.justificativa == null ? "" : o.justificativa).replace(/\s+/g, " ").trim().slice(0, 400),
      pronuncia: o.pronuncia ? String(o.pronuncia).replace(/\s+/g, " ").trim().slice(0, 60) || null : null,
      slug: slugDoNome(nome),
      filtros: filtrosIniciais(nome),
      nota_jev: null,
      nota: null,
      finalista: false,
    });
  }
  return saida;
}

// ------------------------------------------------------------------ domínio (RDAP público)

export function urlDoRdap(slug: string, tld: "com.br" | "com"): string {
  return tld === "com" ? `https://rdap.verisign.com/com/v1/domain/${slug}.com` : `https://rdap.registro.br/domain/${slug}.com.br`;
}

/** 200 = registrado; 404 = livre; o resto (limite, erro, tempo) = não conferido. */
export function situacaoPeloStatus(status: number): SituacaoDoDominio {
  if (status === 200) return "registrado";
  if (status === 404) return "livre";
  return "nao_conferido";
}

type BuscarFn = (url: string, init?: RequestInit) => Promise<{ status: number; body?: { cancel?: () => Promise<void> } | null }>;

/**
 * Confere .com.br e .com dos candidatos (até `max`, os primeiros da lista),
 * com poucas chamadas ao mesmo tempo e tempo limite por chamada. Nunca lança:
 * o que não respondeu fica "não conferido".
 */
export async function conferirDominios(
  candidatos: CandidatoDeNome[],
  buscar: BuscarFn,
  opcoes: { max?: number; timeoutMs?: number; aoMesmoTempo?: number; agora?: () => string } = {},
): Promise<CandidatoDeNome[]> {
  const max = opcoes.max ?? 12;
  const timeout = opcoes.timeoutMs ?? 4000;
  const juntos = Math.max(1, opcoes.aoMesmoTempo ?? 4);
  const agora = opcoes.agora ? opcoes.agora() : new Date().toISOString();
  const tarefas: Array<{ i: number; tld: "com.br" | "com" }> = [];
  candidatos.slice(0, max).forEach((c, i) => {
    if (!c.slug) return;
    tarefas.push({ i, tld: "com.br" });
    tarefas.push({ i, tld: "com" });
  });
  const resultados: Record<string, SituacaoDoDominio> = {};
  let proxima = 0;
  const trabalhador = async () => {
    while (proxima < tarefas.length) {
      const t = tarefas[proxima++];
      const c = candidatos[t.i];
      let situacao: SituacaoDoDominio = "nao_conferido";
      try {
        const controle = typeof AbortController !== "undefined" ? new AbortController() : null;
        const relogio = controle ? setTimeout(() => controle.abort(), timeout) : null;
        try {
          const r = await buscar(urlDoRdap(c.slug as string, t.tld), { method: "GET", headers: { Accept: "application/rdap+json" }, signal: controle ? controle.signal : undefined });
          situacao = situacaoPeloStatus(r.status);
          if (r.body && typeof r.body.cancel === "function") await r.body.cancel().catch(() => undefined);
        } finally {
          if (relogio) clearTimeout(relogio);
        }
      } catch {
        situacao = "nao_conferido";
      }
      resultados[`${t.i}:${t.tld}`] = situacao;
    }
  };
  const trabalhadores: Promise<void>[] = [];
  for (let k = 0; k < Math.min(juntos, tarefas.length); k++) trabalhadores.push(trabalhador());
  await Promise.all(trabalhadores);
  return candidatos.map((c, i) => {
    if (i >= max || !c.slug) return c;
    const comBr = resultados[`${i}:com.br`] || "nao_conferido";
    const com = resultados[`${i}:com`] || "nao_conferido";
    return { ...c, filtros: { ...c.filtros, com_br: comBr, com, conferido_em: agora } };
  });
}

// ------------------------------------------------------------------ ranking (Jev Score)

/** Níveis do Score, do pior para o melhor (o Jev pede lista ordenada). */
export const NIVEIS_DO_NOME = [
  "Não atende aos critérios: confuso, genérico ou fora do que a marca é",
  "Atende pouco: um critério só, com problema claro de som, sentido ou escrita",
  "Atende em parte: serve, mas é comum ou tem um ponto fraco evidente",
  "Atende bem: memorável e coerente com o briefing, com um detalhe a ajustar",
  "Atende muito bem: forte, próprio, fácil de falar e escrever e fiel ao briefing",
];

export type PerguntarAoJev = (e: { state: unknown; questions: Record<string, PerguntaJev> }) => Promise<{ answers: Record<string, RespostaJev>; usage?: unknown; modelo?: string }>;

/** As perguntas de uma leva (uma por nome, id = id do candidato). */
export function perguntasDoRanking(candidatos: CandidatoDeNome[]): Record<string, PerguntaJev> {
  const q: Record<string, PerguntaJev> = {};
  for (const c of candidatos) {
    q[c.id] = {
      type: "score",
      instructions: `Avalie o nome "${c.nome}" (técnica: ${rotuloDaTecnica(c.tecnica)}) contra os \`criterios\` do \`briefing\`, para o \`alvo\` indicado. Considere som, sentido em português, escrita, memória e diferença dos concorrentes citados. Não avalie se o domínio está livre.`,
      criteria: NIVEIS_DO_NOME,
    };
  }
  return q;
}

/** Nota do Score (1 a 5, pode ser fracionada) vira 0 a 1. */
export function notaDoScore(r: RespostaJev | undefined): number | null {
  const s = r && typeof r.score === "number" && isFinite(r.score) ? r.score : null;
  if (s === null) return null;
  const min = 1;
  const max = NIVEIS_DO_NOME.length;
  return Math.max(0, Math.min(1, (s - min) / (max - min)));
}

/** Bônus e desconto do domínio (pequenos: o Jev decide; o domínio desempata). */
export function ajusteDoDominio(f: Pick<FiltrosDoNome, "com_br" | "com">): number {
  let a = 0;
  if (f.com_br === "livre") a += 0.08;
  else if (f.com_br === "registrado") a -= 0.08;
  if (f.com === "livre") a += 0.04;
  else if (f.com === "registrado") a -= 0.02;
  return a;
}

/**
 * Ranqueia com o Jev: as perguntas vão em levas (porChamada), só dos
 * primeiros `noJev` candidatos. O que o Jev não respondeu fica sem nota e vai
 * para o fim (nunca some). Devolve a lista ordenada e o uso de cada chamada.
 */
export async function ranquearComJev(
  candidatos: CandidatoDeNome[],
  contexto: { alvo: AlvoDoNaming; criterios: string[]; briefing: Record<string, unknown> },
  perguntar: PerguntarAoJev,
  opcoes: { noJev?: number; porChamada?: number } = {},
): Promise<{ ranqueados: CandidatoDeNome[]; usos: Array<{ usage?: unknown; modelo?: string }>; falhas: number }> {
  const noJev = opcoes.noJev ?? LIMITES_DO_NAMING.noJev;
  const porChamada = Math.max(1, opcoes.porChamada ?? LIMITES_DO_NAMING.porChamadaDoJev);
  const avaliar = candidatos.slice(0, noJev);
  const notas: Record<string, number | null> = {};
  const usos: Array<{ usage?: unknown; modelo?: string }> = [];
  let falhas = 0;
  const state = {
    alvo: ROTULO_DO_ALVO[contexto.alvo],
    criterios: contexto.criterios.length ? contexto.criterios : CRITERIOS_PADRAO,
    briefing: contexto.briefing,
  };
  for (let i = 0; i < avaliar.length; i += porChamada) {
    const leva = avaliar.slice(i, i + porChamada);
    try {
      const r = await perguntar({ state, questions: perguntasDoRanking(leva) });
      usos.push({ usage: r.usage, modelo: r.modelo });
      for (const c of leva) notas[c.id] = notaDoScore(r.answers ? r.answers[c.id] : undefined);
    } catch {
      falhas += 1;
      for (const c of leva) notas[c.id] = null;
    }
  }
  const comNota = candidatos.map((c) => {
    const nj = Object.prototype.hasOwnProperty.call(notas, c.id) ? notas[c.id] : null;
    const nota = nj === null ? null : Math.max(0, Math.min(1, Math.round((nj + ajusteDoDominio(c.filtros)) * 1000) / 1000));
    return { ...c, nota_jev: nj === null ? null : Math.round(nj * 1000) / 1000, nota };
  });
  return { ranqueados: ordenarCandidatos(comNota), usos, falhas };
}

/** Maior nota primeiro; sem nota vai para o fim, na ordem em que veio. */
export function ordenarCandidatos(lista: CandidatoDeNome[]): CandidatoDeNome[] {
  return lista
    .map((c, i) => ({ c, i }))
    .sort((a, b) => {
      const na = a.c.nota;
      const nb = b.c.nota;
      if (na === null && nb === null) return a.i - b.i;
      if (na === null) return 1;
      if (nb === null) return -1;
      return nb - na || a.i - b.i;
    })
    .map((x) => x.c);
}

/**
 * De 3 a 5 finalistas: os mais bem ranqueados com nota; o .com.br registrado
 * só entra se faltar nome para chegar a 3. Sem nota do Jev (fora do ar), os
 * primeiros da lista, marcados na tela como "sem ranking".
 */
export function escolherFinalistas(ordenados: CandidatoDeNome[], quantos = 4): CandidatoDeNome[] {
  const n = Math.max(LIMITES_DO_NAMING.finalistasMin, Math.min(LIMITES_DO_NAMING.finalistasMax, quantos));
  const escolhidos: string[] = [];
  const bons = ordenados.filter((c) => c.filtros.com_br !== "registrado");
  for (const c of bons) {
    if (escolhidos.length >= n) break;
    escolhidos.push(c.id);
  }
  for (const c of ordenados) {
    if (escolhidos.length >= LIMITES_DO_NAMING.finalistasMin) break;
    if (escolhidos.indexOf(c.id) < 0) escolhidos.push(c.id);
  }
  return ordenados.map((c) => ({ ...c, finalista: escolhidos.indexOf(c.id) >= 0 }));
}

/** A equipe marca ou desmarca à mão (máximo de 5 finalistas). */
export function marcarFinalistas(lista: CandidatoDeNome[], ids: string[]): CandidatoDeNome[] {
  const validos = ids.filter((id) => lista.some((c) => c.id === id)).slice(0, LIMITES_DO_NAMING.finalistasMax);
  return lista.map((c) => ({ ...c, finalista: validos.indexOf(c.id) >= 0 }));
}

// ------------------------------------------------------------------ textos de saída

const ROTULO_DO_DOMINIO: Record<SituacaoDoDominio, string> = { livre: "livre", registrado: "registrado", nao_conferido: "não conferido" };

export function textoDoDominio(s: SituacaoDoDominio): string {
  return ROTULO_DO_DOMINIO[s] || "não conferido";
}

/**
 * A mensagem pronta para o grupo do WhatsApp (o Hermes envia; o painel
 * registra). Sem travessão e sem número inventado.
 */
export function mensagemDoGrupo(e: { cliente: string; alvo: AlvoDoNaming; finalistas: Array<Pick<CandidatoDeNome, "nome" | "justificativa" | "filtros">>; linkDoPdf?: string | null }): string {
  const linhas: string[] = [];
  linhas.push(`Olá, pessoal da ${e.cliente}! Separamos os finalistas para o ${ROTULO_DO_ALVO[e.alvo]}:`);
  linhas.push("");
  e.finalistas.forEach((f, i) => {
    const dominio = f.filtros.com_br === "livre" ? " (.com.br livre)" : "";
    linhas.push(`${i + 1}. ${f.nome}${dominio}`);
    if (f.justificativa) linhas.push(`   ${f.justificativa}`);
  });
  linhas.push("");
  linhas.push("Qual deles tem mais a cara de vocês? Podem responder com o número.");
  linhas.push("A busca no INPI e a disponibilidade do @ ainda são conferidas antes do registro.");
  if (e.linkDoPdf) linhas.push(`O PDF com os detalhes: ${e.linkDoPdf}`);
  return linhas.join("\n");
}

/** Link do WhatsApp sem número (a equipe escolhe o grupo). */
export function linkDoWhatsapp(texto: string): string {
  return `https://wa.me/?text=${encodeURIComponent(texto)}`;
}

// ------------------------------------------------------------------ idiomas (IDV2)

export const IDIOMAS_DO_TESTE = [
  { valor: "en", rotulo: "Inglês" },
  { valor: "es", rotulo: "Espanhol" },
  { valor: "fr", rotulo: "Francês" },
  { valor: "it", rotulo: "Italiano" },
  { valor: "de", rotulo: "Alemão" },
] as const;

export type IdiomaDoTeste = (typeof IDIOMAS_DO_TESTE)[number]["valor"];
export type RiscoDoIdioma = "ok" | "atencao" | "alto" | "nao_avaliado";
export type LeituraEmIdioma = { idioma: IdiomaDoTeste; pronuncia: string; significado: string };

const IDIOMAS_VALIDOS = IDIOMAS_DO_TESTE.map((i) => i.valor) as string[];
const linha = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);

/** O que o modelo disse de cada nome em cada idioma, em forma segura (idioma conhecido, texto curto). */
export function normalizarLeituras(bruto: unknown): Record<string, LeituraEmIdioma[]> {
  const itens = bruto && typeof bruto === "object" && Array.isArray((bruto as Record<string, unknown>).nomes) ? ((bruto as Record<string, unknown>).nomes as unknown[]) : Array.isArray(bruto) ? bruto : [];
  const saida: Record<string, LeituraEmIdioma[]> = {};
  for (const b of itens) {
    const o = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
    const id = String(o.id || "").slice(0, 8);
    if (!/^n\d{1,2}$/.test(id)) continue;
    const leituras: LeituraEmIdioma[] = [];
    for (const l of Array.isArray(o.leituras) ? o.leituras : []) {
      const x = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
      const idioma = String(x.idioma || "");
      if (IDIOMAS_VALIDOS.indexOf(idioma) < 0 || leituras.some((y) => y.idioma === idioma)) continue;
      leituras.push({ idioma: idioma as IdiomaDoTeste, pronuncia: linha(x.pronuncia, 80), significado: linha(x.significado, 240) });
    }
    if (leituras.length) saida[id] = leituras;
  }
  return saida;
}

/** A pergunta do Jev (Noul) para o risco do nome: o julgamento é do Jev, não do modelo que escreveu as leituras. */
export function perguntasDoRiscoDeIdioma(candidatos: Array<Pick<CandidatoDeNome, "id" | "nome" | "idiomas">>): Record<string, PerguntaJev> {
  const q: Record<string, PerguntaJev> = {};
  for (const c of candidatos) {
    if (!c.idiomas || !c.idiomas.length) continue;
    const leituras = c.idiomas.map((l) => `${l.idioma}: ${l.significado || "sem sentido"}${l.pronuncia ? ` (fala-se ${l.pronuncia})` : ""}`).join("; ");
    q[c.id] = {
      type: "noul",
      instructions: `O nome de marca "${c.nome}" tem estas leituras em outros idiomas: ${leituras}. Alguma delas é ofensiva, vulgar, negativa ou constrangedora a ponto de prejudicar a marca nesse idioma?`,
    };
  }
  return q;
}

/** Probabilidade do Noul vira o aviso: acima de 0,66 alto; acima de 0,33 atenção. */
export function riscoPelaProbabilidade(p: number | null | undefined): RiscoDoIdioma {
  if (typeof p !== "number" || !isFinite(p)) return "nao_avaliado";
  if (p > 0.66) return "alto";
  if (p > 0.33) return "atencao";
  return "ok";
}

export const ROTULO_DO_RISCO: Record<RiscoDoIdioma, string> = { ok: "sem risco visto", atencao: "atenção", alto: "risco alto", nao_avaliado: "não avaliado" };

// ------------------------------------------------------------------ slogan e tagline (IDV2)

export const TIPOS_DE_SLOGAN = [
  { valor: "tagline", rotulo: "Tagline", explica: "Assinatura curta que acompanha a logo (até 5 palavras)." },
  { valor: "slogan", rotulo: "Slogan", explica: "Frase de posicionamento para campanhas e site (até 10 palavras)." },
  { valor: "manifesto", rotulo: "Frase de manifesto", explica: "Frase de abertura do manifesto da marca." },
] as const;

export type TipoDeSlogan = (typeof TIPOS_DE_SLOGAN)[number]["valor"];
export type SloganDaMarca = { id: string; texto: string; tipo: TipoDeSlogan; por_que: string; nota: number | null };

/** Slogans do modelo em forma segura: sem aspas, sem repetir, tipo conhecido, id s1..sN. */
export function normalizarSlogans(bruto: unknown, limite = 12): SloganDaMarca[] {
  const itens = bruto && typeof bruto === "object" && Array.isArray((bruto as Record<string, unknown>).slogans) ? ((bruto as Record<string, unknown>).slogans as unknown[]) : Array.isArray(bruto) ? bruto : [];
  const tipos = TIPOS_DE_SLOGAN.map((t) => t.valor) as string[];
  const saida: SloganDaMarca[] = [];
  const vistos: string[] = [];
  for (const b of itens) {
    const o = (b && typeof b === "object" ? b : {}) as Record<string, unknown>;
    const texto = linha(o.texto, 140).replace(/["“”]/g, "").trim();
    const chave = semAcento(texto).toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (texto.length < 3 || vistos.indexOf(chave) >= 0) continue;
    vistos.push(chave);
    saida.push({ id: `s${saida.length + 1}`, texto, tipo: (tipos.indexOf(String(o.tipo)) >= 0 ? o.tipo : "tagline") as TipoDeSlogan, por_que: linha(o.por_que, 300), nota: null });
    if (saida.length >= limite) break;
  }
  return saida;
}

/** Pergunta do Jev (Score) para ranquear os slogans pela estratégia. */
export function perguntasDosSlogans(slogans: SloganDaMarca[]): Record<string, PerguntaJev> {
  const q: Record<string, PerguntaJev> = {};
  for (const s of slogans) {
    const papel = s.tipo === "tagline" ? "tagline (assinatura curta da logo)" : s.tipo === "slogan" ? "slogan" : "frase de manifesto";
    q[s.id] = {
      type: "score",
      instructions: `Avalie a frase "${s.texto}" como ${papel} da marca descrita em marca: fidelidade ao posicionamento e ao tom, memória, clareza em português e diferença do que os concorrentes dizem.`,
      criteria: NIVEIS_DO_NOME,
    };
  }
  return q;
}

/** Ordena os slogans pela nota do Jev (sem nota no fim, na ordem em que vieram). */
export function ordenarSlogans(lista: SloganDaMarca[]): SloganDaMarca[] {
  return lista
    .map((s, i) => ({ s, i }))
    .sort((a, b) => (a.s.nota === null && b.s.nota === null ? a.i - b.i : a.s.nota === null ? 1 : b.s.nota === null ? -1 : b.s.nota - a.s.nota || a.i - b.i))
    .map((x) => x.s);
}

// ------------------------------------------------------------------ votação (IDV2)

export type VotoDoNome = { candidato_id: string; origem: "equipe" | "cliente"; nota: number };
export type ResumoDoVoto = { equipe: number | null; n_equipe: number; cliente: number | null; n_cliente: number };

/**
 * As notas da equipe de quem chamou (a mais nova por candidato; a lista vem
 * da mais nova para a mais velha) e a lista sem a chave de quem votou, que
 * nunca sai do servidor (UXS 30/09, IDV-10).
 */
export function separarMinhas<T extends VotoDoNome & { chave: string }>(votos: T[], userId: string): { votos: Array<Omit<T, "chave">>; minhas: Record<string, number> } {
  const minhas: Record<string, number> = {};
  for (const x of votos) {
    const nota = Math.round(Number(x.nota));
    if (x.origem === "equipe" && userId && x.chave === userId && minhas[x.candidato_id] === undefined && nota >= 1 && nota <= 5) minhas[x.candidato_id] = nota;
  }
  return {
    votos: votos.map((v) => {
      const copia = { ...v } as Record<string, unknown>;
      delete copia.chave;
      return copia as Omit<T, "chave">;
    }),
    minhas,
  };
}

/** Resumo por nome: média e quantidade de votos da equipe e do cliente (nota de 1 a 5). */
export function resumoDosVotos(votos: VotoDoNome[]): Record<string, ResumoDoVoto> {
  const somas: Record<string, { se: number; ne: number; sc: number; nc: number }> = {};
  for (const v of votos) {
    const nota = Math.round(Number(v.nota));
    if (!(nota >= 1 && nota <= 5) || !v.candidato_id) continue;
    const s = somas[v.candidato_id] || (somas[v.candidato_id] = { se: 0, ne: 0, sc: 0, nc: 0 });
    if (v.origem === "cliente") {
      s.sc += nota;
      s.nc += 1;
    } else {
      s.se += nota;
      s.ne += 1;
    }
  }
  const r: Record<string, ResumoDoVoto> = {};
  for (const k of Object.keys(somas)) {
    const s = somas[k];
    r[k] = { equipe: s.ne ? Math.round((s.se / s.ne) * 10) / 10 : null, n_equipe: s.ne, cliente: s.nc ? Math.round((s.sc / s.nc) * 10) / 10 : null, n_cliente: s.nc };
  }
  return r;
}

/** O retrato da votação pública: só nome, justificativa e pronúncia dos finalistas (sem nota, sem domínio). */
export function retratoDaVotacao(e: { marca: string; alvo: AlvoDoNaming; candidatos: CandidatoDeNome[] }): { marca: string; alvo: string; finalistas: Array<{ id: string; nome: string; justificativa: string; pronuncia: string | null }> } {
  return {
    marca: linha(e.marca, 80),
    alvo: ROTULO_DO_ALVO[e.alvo],
    finalistas: e.candidatos
      .filter((c) => c.finalista)
      .slice(0, LIMITES_DO_NAMING.finalistasMax)
      .map((c) => ({ id: c.id, nome: c.nome, justificativa: c.justificativa, pronuncia: c.pronuncia })),
  };
}

/** Outras redes para conferir o @ (links prontos; o painel não entra em conta de terceiro). */
export function linksDoArroba(arroba: string | null): Array<{ rede: string; link: string }> {
  if (!arroba) return [];
  const a = encodeURIComponent(arroba);
  return [
    { rede: "Instagram", link: `https://www.instagram.com/${a}/` },
    { rede: "TikTok", link: `https://www.tiktok.com/@${a}` },
    { rede: "YouTube", link: `https://www.youtube.com/@${a}` },
    { rede: "Facebook", link: `https://www.facebook.com/${a}` },
  ];
}
