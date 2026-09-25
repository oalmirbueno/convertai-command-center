/**
 * Cérebro do cliente: a memória que aprende com os ajustes, por cliente.
 *
 * O dono pediu: "ele vai aprendendo com os ajustes que eu peço; para cada
 * cliente uma memória; o segundo cérebro que se alimenta para cada cliente".
 * Não é tabela nova do zero: a memória já existe e os agentes já leem
 * (public.agente_memoria, uma linha por aprendizado, por agente). O que
 * faltava era:
 *
 * 1. Juntar num lugar o que está espalhado: agente_memoria (preferências,
 *    o que evitar, ajustes pedidos no Estúdio, reprovações com o motivo, que
 *    o gatilho da entrega já grava), ads_aprendizados (o que performou com
 *    gasto e resultado), reprovações do cliente com o comentário
 *    (file_approval_events) e a evolução real do Instagram.
 * 2. Um resumo COMPACTO por área para entrar no prompt de cada agente, com
 *    teto de caracteres (o prompt não pode crescer sem limite), sem repetir o
 *    mesmo aprendizado e sem o que já venceu.
 * 3. Um jeito de ESCREVER que não duplica: o mesmo aprendizado dito de novo
 *    vira reforço (conta quantas vezes o dono pediu), e o que contradiz um
 *    antigo aposenta o antigo (o dono mudou de ideia, vale o novo).
 *
 * Este arquivo é puro: não importa Deno, nem cliente do Supabase, nem o Jev.
 * O banco e o julgamento chegam por parâmetro. Assim o Vitest cobre as
 * regras sem backend, e qualquer função (MCP, Estúdio, Mesa Ads, Mesa Foto,
 * calendário) usa as mesmas regras sem copiar código.
 *
 * SQL que dá as colunas novas (área, categoria, chave, validade, reforços):
 * docs/cerebro/01_cerebro_memoria.sql. Sem ele, a leitura funciona igual e a
 * escrita grava no formato antigo (menos a área "geral", que precisa do SQL).
 */

// ─── Vocabulário ─────────────────────────────────────────────

/** Áreas do cérebro. Cada uma é lida por um agente (ver AGENTE_DA_AREA). */
export const AREAS_DO_CEREBRO = ['geral', 'calendario', 'campanha', 'arte', 'foto', 'ads', 'copy', 'conta'] as const;
export type AreaDoCerebro = (typeof AREAS_DO_CEREBRO)[number];

/**
 * Categorias do que se aprende.
 * - preferencia: o jeito que o cliente gosta (estilo, tom, cor, formato).
 * - evitar: o que não se faz mais com este cliente.
 * - ajuste: ajuste pedido (costuma virar preferência quando se repete).
 * - reprovado: o que foi reprovado e por quê.
 * - performou: o que deu resultado medido (número real, período).
 * - aprendizado: fato útil que não cabe nas outras.
 */
export const CATEGORIAS_DO_CEREBRO = ['preferencia', 'evitar', 'ajuste', 'reprovado', 'performou', 'aprendizado'] as const;
export type CategoriaDoCerebro = (typeof CATEGORIAS_DO_CEREBRO)[number];

/** Valores aceitos hoje em agente_memoria.agente (antes do SQL novo, sem 'geral'). */
export const AGENTES_DA_MEMORIA = ['estrategista', 'diretor_arte', 'estrategista_ads', 'geral'] as const;
export type AgenteDaMemoria = (typeof AGENTES_DA_MEMORIA)[number];

/**
 * Qual agente lê cada área. É o valor gravado em agente_memoria.agente, que os
 * agentes JÁ filtram hoje: gravar com o agente certo faz o aprendizado chegar
 * ao prompt sem mudar nada nas mesas. A Mesa Foto lê a memória do diretor de
 * arte (AGENTE_DIRETOR = "diretor_arte" em mesa-foto/index.ts).
 */
export const AGENTE_DA_AREA: Record<AreaDoCerebro, AgenteDaMemoria> = {
  geral: 'geral',
  calendario: 'estrategista',
  campanha: 'estrategista',
  copy: 'estrategista',
  arte: 'diretor_arte',
  foto: 'diretor_arte',
  ads: 'estrategista_ads',
  conta: 'estrategista_ads',
};

/** Áreas que um agente enxerga quando lê o cérebro (a dele e a geral). */
export const AREAS_DO_AGENTE: Record<Exclude<AgenteDaMemoria, 'geral'>, AreaDoCerebro[]> = {
  estrategista: ['calendario', 'campanha', 'copy'],
  diretor_arte: ['arte', 'foto'],
  estrategista_ads: ['ads', 'conta'],
};

/** Mapeia a categoria rica para o tipo antigo de agente_memoria (aprendizado | preferencia | evitar). */
export const TIPO_DA_CATEGORIA: Record<CategoriaDoCerebro, 'aprendizado' | 'preferencia' | 'evitar'> = {
  preferencia: 'preferencia',
  ajuste: 'preferencia',
  evitar: 'evitar',
  reprovado: 'evitar',
  performou: 'aprendizado',
  aprendizado: 'aprendizado',
};

/** E a origem antiga (aprovacao | ajuste | metrica | manual). */
export const ORIGEM_DA_CATEGORIA: Record<CategoriaDoCerebro, 'aprovacao' | 'ajuste' | 'metrica' | 'manual'> = {
  preferencia: 'manual',
  ajuste: 'ajuste',
  evitar: 'manual',
  reprovado: 'aprovacao',
  performou: 'metrica',
  aprendizado: 'manual',
};

/**
 * Validade padrão em dias (null = não vence). Gosto e regra do dono não
 * vencem sozinhos: só saem quando ele muda de ideia (o novo aposenta o
 * antigo). Resultado de métrica envelhece: o que performou há um ano pode
 * não valer mais.
 */
export const VALIDADE_PADRAO_DIAS: Record<CategoriaDoCerebro, number | null> = {
  preferencia: null,
  evitar: null,
  ajuste: null,
  reprovado: 365,
  performou: 180,
  aprendizado: 365,
};

/** Teto padrão do resumo que entra no prompt (caracteres). */
export const LIMITE_PADRAO_DO_RESUMO = 1800;
export const LIMITE_MAXIMO_DO_RESUMO = 6000;
export const TAMANHO_MAXIMO_DO_TEXTO = 600;

/** Corte do Jev para dizer que o novo repete um antigo (reforça em vez de gravar outro). */
export const CORTE_REPETE = 0.75;
/** Corte do Jev para aposentar o antigo porque o novo o contradiz. */
export const CORTE_CONTRADIZ = 0.8;
/** Quantos aprendizados ativos vão ao Jev para comparar (os mais recentes da mesma área). */
export const MAX_CANDIDATOS_JEV = 24;

// ─── Fato do cérebro ─────────────────────────────────────────

export type FatoDoCerebro = {
  /** id da linha de origem (agente_memoria.id, ads_aprendizados.id, evento...). */
  id: string;
  area: AreaDoCerebro;
  categoria: CategoriaDoCerebro;
  texto: string;
  motivo: string | null;
  evidencia: string | null;
  /** De onde veio: memoria, ads_aprendizados, aprovacao_cliente, instagram. */
  fonte: string;
  criado_em: string | null;
  valido_ate: string | null;
  /** Quantas vezes o mesmo aprendizado foi dito (1 = uma vez). */
  reforcos: number;
  chave: string;
};

type Linha = Record<string, unknown>;

const txt = (v: unknown, max = TAMANHO_MAXIMO_DO_TEXTO): string => {
  if (v === null || v === undefined) return '';
  const s = String(v).replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
};
const txtOuNulo = (v: unknown, max = TAMANHO_MAXIMO_DO_TEXTO): string | null => txt(v, max) || null;
const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const ehArea = (v: unknown): v is AreaDoCerebro => typeof v === 'string' && (AREAS_DO_CEREBRO as readonly string[]).includes(v);
const ehCategoria = (v: unknown): v is CategoriaDoCerebro => typeof v === 'string' && (CATEGORIAS_DO_CEREBRO as readonly string[]).includes(v);

/** Acentos soltos depois do NFD (U+0300 a U+036F), montados por código para o arquivo ficar em ASCII. */
const MARCAS_DE_ACENTO = new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, 'g');

/**
 * Chave de deduplicação: o texto sem acento, sem pontuação, sem caixa e sem
 * o rodapé que o Estúdio pendura ("(pedido no card 2: ...)", "(conversa no
 * estúdio, aplicada)"). Dois aprendizados com a mesma chave dizem a mesma
 * coisa com a mesma letra: o segundo vira reforço do primeiro.
 * Sem \p{...}: o arquivo roda também no Vitest e o piso do painel é antigo.
 */
export function chaveDoAprendizado(texto: string): string {
  return String(texto ?? '')
    .replace(/\s*\((pedido no card|conversa no est[uú]dio|ajuste pedido)[^)]*\)\s*$/i, '')
    .normalize('NFD')
    .replace(MARCAS_DE_ACENTO, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 160);
}

/** Vale agora? Sem validade = vale; data inválida = vale (não some por erro de formato). */
export function aindaVale(validoAte: string | null | undefined, agora: Date = new Date()): boolean {
  if (!validoAte) return true;
  const t = new Date(validoAte).getTime();
  return Number.isNaN(t) || t > agora.getTime();
}

export function validadePara(categoria: CategoriaDoCerebro, dias?: number | null, agora: Date = new Date()): string | null {
  const d = dias === undefined ? VALIDADE_PADRAO_DIAS[categoria] : dias;
  if (d === null || d === undefined || !Number.isFinite(d) || d <= 0) return null;
  return new Date(agora.getTime() + Math.round(d) * 86_400_000).toISOString();
}

/** Área de uma linha antiga de agente_memoria, que não tinha a coluna area. */
export function areaDaLinhaDeMemoria(l: Linha): AreaDoCerebro {
  if (ehArea(l.area)) return l.area;
  switch (l.agente) {
    case 'diretor_arte': return 'arte';
    case 'estrategista_ads': return 'ads';
    case 'geral': return 'geral';
    default: return 'calendario';
  }
}

/** Categoria de uma linha antiga: tipo + origem dizem o bastante. */
export function categoriaDaLinhaDeMemoria(l: Linha): CategoriaDoCerebro {
  if (ehCategoria(l.categoria)) return l.categoria;
  if (l.origem === 'aprovacao' && l.tipo === 'evitar') return 'reprovado';
  if (l.origem === 'ajuste') return 'ajuste';
  if (l.origem === 'metrica') return 'performou';
  if (l.tipo === 'evitar') return 'evitar';
  if (l.tipo === 'preferencia') return 'preferencia';
  return 'aprendizado';
}

/** Linha de agente_memoria (com ou sem as colunas novas) vira fato. */
export function fatoDaMemoria(l: Linha): FatoDoCerebro | null {
  const texto = txt(l.texto);
  if (!texto) return null;
  return {
    id: String(l.id ?? ''),
    area: areaDaLinhaDeMemoria(l),
    categoria: categoriaDaLinhaDeMemoria(l),
    texto,
    motivo: txtOuNulo(l.motivo, 300),
    evidencia: txtOuNulo(l.evidencia, 300),
    fonte: 'memoria',
    criado_em: typeof l.criado_em === 'string' ? l.criado_em : null,
    valido_ate: typeof l.valido_ate === 'string' ? l.valido_ate : null,
    reforcos: Math.max(1, num(l.reforcos) ?? 1),
    chave: typeof l.chave === 'string' && l.chave ? l.chave : chaveDoAprendizado(texto),
  };
}

/** Aprendizado de anúncio (E3/E4, com gasto e resultado) vira fato "performou" da área ads. */
export function fatoDoAprendizadoDeAds(l: Linha): FatoDoCerebro | null {
  const texto = txt(l.texto);
  if (!texto) return null;
  const periodo = l.periodo_inicio && l.periodo_fim ? `${l.periodo_inicio} a ${l.periodo_fim}` : null;
  const criado = typeof l.criado_em === 'string' ? l.criado_em : null;
  return {
    id: String(l.id ?? ''),
    area: 'ads',
    categoria: 'performou',
    texto,
    motivo: null,
    evidencia: [l.evidencia ? `Evidência ${l.evidencia}` : null, periodo ? `período ${periodo}` : null].filter(Boolean).join(', ') || null,
    fonte: 'ads_aprendizados',
    criado_em: criado,
    valido_ate: criado ? validadePara('performou', undefined, new Date(criado)) : null,
    reforcos: 1,
    chave: chaveDoAprendizado(texto),
  };
}

/** Reprovação com comentário (cliente ou agência) vira fato "reprovado" da arte. */
export function fatoDaReprovacao(l: Linha): FatoDoCerebro | null {
  const motivo = txt(l.feedback, 400);
  if (!motivo) return null;
  const quem = l.event_type === 'client_rejected' ? 'O cliente' : 'A agência';
  const nome = txt(l.nome_do_material, 120);
  const texto = txt(`${quem} reprovou${nome ? ` "${nome}"` : ''}: ${motivo}`);
  const criado = typeof l.created_at === 'string' ? l.created_at : null;
  return {
    id: String(l.id ?? ''),
    area: 'arte',
    categoria: 'reprovado',
    texto,
    motivo,
    evidencia: null,
    fonte: 'aprovacao_cliente',
    criado_em: criado,
    valido_ate: criado ? validadePara('reprovado', undefined, new Date(criado)) : null,
    reforcos: 1,
    chave: chaveDoAprendizado(motivo),
  };
}

/**
 * Evolução do Instagram (semanas fechadas, da mais nova para a mais antiga)
 * vira no máximo dois fatos "performou" da área conta: alcance e seguidores
 * da última semana contra a média das anteriores. Só com 3 semanas ou mais,
 * para não chamar oscilação de tendência.
 */
export function fatosDaEvolucao(semanas: Linha[]): FatoDoCerebro[] {
  const s = semanas.filter((x) => typeof x.week_start === 'string');
  if (s.length < 3) return [];
  const [ultima, ...antes] = s;
  const media = (campo: string) => {
    const v = antes.map((x) => num(x[campo])).filter((n): n is number => n !== null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const saida: FatoDoCerebro[] = [];
  const alcance = num(ultima.reach);
  const mediaAlcance = media('reach');
  if (alcance !== null && mediaAlcance && mediaAlcance > 0) {
    const pct = Math.round(((alcance - mediaAlcance) / mediaAlcance) * 100);
    const texto = `Alcance da semana de ${ultima.week_start}: ${alcance.toLocaleString('pt-BR')} (${pct >= 0 ? '+' : ''}${pct}% contra a média das ${antes.length} semanas anteriores).`;
    saida.push({
      id: `instagram:alcance:${ultima.week_start}`, area: 'conta', categoria: 'performou', texto,
      motivo: null, evidencia: 'social_metrics_weekly', fonte: 'instagram', criado_em: String(ultima.week_end ?? ultima.week_start),
      valido_ate: null, reforcos: 1, chave: `instagram alcance ${ultima.week_start}`,
    });
  }
  const seg = num(ultima.followers);
  const segAntes = num(antes[antes.length - 1]?.followers);
  if (seg !== null && segAntes !== null) {
    const dif = seg - segAntes;
    const texto = `Seguidores: ${seg.toLocaleString('pt-BR')} na semana de ${ultima.week_start} (${dif >= 0 ? '+' : ''}${dif} em ${antes.length} semanas).`;
    saida.push({
      id: `instagram:seguidores:${ultima.week_start}`, area: 'conta', categoria: 'performou', texto,
      motivo: null, evidencia: 'social_metrics_weekly', fonte: 'instagram', criado_em: String(ultima.week_end ?? ultima.week_start),
      valido_ate: null, reforcos: 1, chave: `instagram seguidores ${ultima.week_start}`,
    });
  }
  return saida;
}

/**
 * As publicações que mais geraram interação (curtidas + comentários) viram
 * fatos "performou" da área calendário, com o começo da legenda: é o que o
 * estrategista precisa para repetir o que funciona.
 */
export function fatosDasPublicacoes(posts: Linha[], quantas = 3): FatoDoCerebro[] {
  return posts
    .map((p) => ({ p, total: (num(p.like_count) ?? 0) + (num(p.comments_count) ?? 0) }))
    .filter((x) => x.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, quantas)
    .map(({ p, total }) => {
      const legenda = txt(p.caption, 120);
      const quando = typeof p.posted_at === 'string' ? p.posted_at.slice(0, 10) : null;
      const texto = txt(`Publicação que performou${quando ? ` (${quando})` : ''}${p.media_type ? `, ${String(p.media_type).toLowerCase()}` : ''}: ${total} interações. ${legenda ? `Começo da legenda: "${legenda}"` : ''}`);
      return {
        id: `instagram:post:${String(p.media_id ?? p.id ?? '')}`,
        area: 'calendario' as AreaDoCerebro,
        categoria: 'performou' as CategoriaDoCerebro,
        texto,
        motivo: null,
        evidencia: typeof p.permalink === 'string' ? p.permalink : null,
        fonte: 'instagram',
        criado_em: typeof p.posted_at === 'string' ? p.posted_at : null,
        valido_ate: typeof p.posted_at === 'string' ? validadePara('performou', undefined, new Date(p.posted_at)) : null,
        reforcos: 1,
        chave: chaveDoAprendizado(`post ${String(p.media_id ?? p.id ?? '')}`),
      };
    });
}

/**
 * Tira o que venceu e junta o que se repete. Na repetição fica o mais
 * recente e os reforços se somam: "o dono pediu isso 3 vezes" pesa mais que
 * "pediu uma vez".
 */
export function consolidarFatos(fatos: FatoDoCerebro[], agora: Date = new Date()): FatoDoCerebro[] {
  const porChave = new Map<string, FatoDoCerebro>();
  for (const f of fatos) {
    if (!f || !f.texto || !aindaVale(f.valido_ate, agora)) continue;
    const chave = `${f.area}|${f.chave || chaveDoAprendizado(f.texto)}`;
    const ja = porChave.get(chave);
    if (!ja) {
      porChave.set(chave, { ...f });
      continue;
    }
    const maisNovo = (f.criado_em ?? '') > (ja.criado_em ?? '') ? f : ja;
    porChave.set(chave, { ...maisNovo, reforcos: ja.reforcos + f.reforcos });
  }
  return [...porChave.values()].sort((a, b) => (b.criado_em ?? '').localeCompare(a.criado_em ?? ''));
}

/** Ordem das seções no prompt: o que é regra do dono vem primeiro. */
const SECOES: Array<{ titulo: string; categorias: CategoriaDoCerebro[] }> = [
  { titulo: 'EVITAR (o dono ou o cliente já disse que não)', categorias: ['evitar', 'reprovado'] },
  { titulo: 'PREFERÊNCIAS E AJUSTES PEDIDOS', categorias: ['preferencia', 'ajuste'] },
  { titulo: 'O QUE PERFORMOU (número real)', categorias: ['performou'] },
  { titulo: 'OUTROS APRENDIZADOS', categorias: ['aprendizado'] },
];

const dataCurta = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : null);

/** Uma linha do resumo: o texto, o motivo quando há, quantas vezes e quando. */
export function linhaDoFato(f: FatoDoCerebro): string {
  const extras = [
    f.reforcos > 1 ? `pedido ${f.reforcos} vezes` : null,
    dataCurta(f.criado_em),
  ].filter(Boolean).join(', ');
  const motivo = f.motivo && !f.texto.includes(f.motivo) ? ` Motivo: ${f.motivo}` : '';
  return `- ${f.texto}${motivo}${extras ? ` (${extras})` : ''}`;
}

/**
 * O resumo compacto que entra no prompt de um agente.
 *
 * - Filtra pelas áreas pedidas mais a "geral".
 * - Dentro de cada seção, primeiro o mais reforçado, depois o mais recente.
 * - Para no teto de caracteres, sempre em linha inteira, e diz quantos
 *   ficaram de fora (para o agente saber que existe mais e pedir o completo).
 * - Sem nada, devolve string vazia: o chamador decide se põe o bloco.
 */
export function resumoParaPrompt(
  fatos: FatoDoCerebro[],
  opcoes: { areas?: AreaDoCerebro[]; limite?: number; titulo?: string } = {},
): { texto: string; usados: number; fora: number } {
  const limite = Math.min(Math.max(opcoes.limite ?? LIMITE_PADRAO_DO_RESUMO, 200), LIMITE_MAXIMO_DO_RESUMO);
  const areas = opcoes.areas?.length ? new Set<AreaDoCerebro>([...opcoes.areas, 'geral']) : null;
  const escolhidos = fatos.filter((f) => !areas || areas.has(f.area));
  if (!escolhidos.length) return { texto: '', usados: 0, fora: 0 };

  const titulo = opcoes.titulo ?? 'CÉREBRO DO CLIENTE (aprendizados que valem para este trabalho; regra do dono vale sobre sugestão sua)';
  const linhas: string[] = [titulo];
  let tamanho = titulo.length;
  let usados = 0;
  // Espaço guardado para o aviso de "ficou de fora": o texto final nunca passa do teto.
  const RESERVA = 60;
  const cabe = (s: string) => tamanho + 1 + s.length <= limite - RESERVA;

  for (const secao of SECOES) {
    const daSecao = escolhidos
      .filter((f) => secao.categorias.includes(f.categoria))
      .sort((a, b) => b.reforcos - a.reforcos || (b.criado_em ?? '').localeCompare(a.criado_em ?? ''));
    if (!daSecao.length) continue;
    const cabecalho = `${secao.titulo}:`;
    const primeira = linhaDoFato(daSecao[0]);
    if (!cabe(`${cabecalho}\n${primeira}`)) continue;
    linhas.push(cabecalho);
    tamanho += 1 + cabecalho.length;
    for (const f of daSecao) {
      const l = linhaDoFato(f);
      if (!cabe(l)) break;
      linhas.push(l);
      tamanho += 1 + l.length;
      usados += 1;
    }
  }
  const fora = escolhidos.length - usados;
  if (fora > 0 && usados > 0) linhas.push(`(+${fora} aprendizado(s) fora deste resumo por espaço.)`);
  return { texto: usados ? linhas.join('\n') : '', usados, fora };
}

/** Resumo por área, pronto para o MCP devolver e para o painel mostrar. */
export function resumoPorArea(fatos: FatoDoCerebro[], limite = LIMITE_PADRAO_DO_RESUMO): Record<AreaDoCerebro, string> {
  const saida = {} as Record<AreaDoCerebro, string>;
  for (const area of AREAS_DO_CEREBRO) {
    saida[area] = resumoParaPrompt(fatos, { areas: area === 'geral' ? ['geral'] : [area], limite }).texto;
  }
  return saida;
}

// ─── Banco (por parâmetro) ───────────────────────────────────

/**
 * O mínimo do cliente do Supabase que este arquivo usa. Estrutural de
 * propósito: nada de import do supabase-js aqui, então o Vitest carrega.
 */
// deno-lint-ignore no-explicit-any
export type BancoDoCerebro = { from: (tabela: string) => any };

type Resposta = { data: unknown; error: { code?: string; message: string } | null };

const linhasDe = (r: Resposta | null | undefined): Linha[] => (r && Array.isArray(r.data) ? (r.data as Linha[]) : []);

/** Tabela ou coluna que ainda não existe neste ambiente. */
export function faltaNoBancoDoCerebro(erro: { code?: string; message?: string } | null | undefined): boolean {
  if (!erro) return false;
  const m = String(erro.message ?? '');
  return erro.code === '42P01' || erro.code === '42703' || erro.code === 'PGRST204' || erro.code === 'PGRST205'
    || /does not exist|could not find the .* (column|table)/i.test(m);
}

export type LeituraDoCerebro = {
  fatos: FatoDoCerebro[];
  fontes: Record<string, number>;
  avisos: string[];
};

/**
 * Lê tudo o que o cliente já ensinou, de todas as fontes, e consolida.
 * Falha de uma fonte vira aviso, não derruba as outras: o cérebro com três
 * fontes é melhor que nenhum.
 */
export async function lerCerebro(
  db: BancoDoCerebro,
  clientId: string,
  opcoes: { agora?: Date; diasDeReprovacao?: number } = {},
): Promise<LeituraDoCerebro> {
  const agora = opcoes.agora ?? new Date();
  const desde = new Date(agora.getTime() - (opcoes.diasDeReprovacao ?? 120) * 86_400_000).toISOString();
  const avisos: string[] = [];
  const seguro = async (nome: string, consulta: () => PromiseLike<unknown>): Promise<Linha[]> => {
    try {
      const r = (await consulta()) as Resposta;
      if (r?.error) {
        avisos.push(faltaNoBancoDoCerebro(r.error) ? `${nome}: ainda não existe neste banco.` : `${nome}: ${r.error.message}`);
        return [];
      }
      return linhasDe(r);
    } catch (e) {
      avisos.push(`${nome}: ${e instanceof Error ? e.message : 'falha ao ler'}`);
      return [];
    }
  };

  const [memoria, ads, reprovacoes, semanas, posts] = await Promise.all([
    seguro('agente_memoria', () => db.from('agente_memoria').select('*').eq('client_id', clientId).eq('ativa', true).order('criado_em', { ascending: false }).limit(300)),
    seguro('ads_aprendizados', () => db.from('ads_aprendizados').select('id, texto, evidencia, periodo_inicio, periodo_fim, criado_em').eq('client_id', clientId).order('criado_em', { ascending: false }).limit(30)),
    seguro('file_approval_events', () => db.from('file_approval_events').select('id, event_type, feedback, created_at, file_id').eq('client_id', clientId)
      .in('event_type', ['client_rejected', 'agency_rejected']).gte('created_at', desde).order('created_at', { ascending: false }).limit(30)),
    seguro('social_metrics_weekly', () => db.from('social_metrics_weekly').select('week_start, week_end, followers, reach').eq('client_id', clientId).order('week_start', { ascending: false }).limit(8)),
    seguro('social_post_metrics', () => db.from('social_post_metrics').select('id, media_id, media_type, caption, permalink, posted_at, like_count, comments_count').eq('client_id', clientId)
      .order('posted_at', { ascending: false }).limit(40)),
  ]);

  // A reprovação que o gatilho da entrega já copiou para a memória (mesmo
  // motivo) não entra duas vezes: a consolidação junta pela chave do motivo.
  const fatos = consolidarFatos([
    ...memoria.map(fatoDaMemoria).filter((f): f is FatoDoCerebro => !!f),
    ...ads.map(fatoDoAprendizadoDeAds).filter((f): f is FatoDoCerebro => !!f),
    ...reprovacoes.map(fatoDaReprovacao).filter((f): f is FatoDoCerebro => !!f),
    ...fatosDaEvolucao(semanas),
    ...fatosDasPublicacoes(posts),
  ], agora);

  return {
    fatos,
    fontes: {
      memoria: memoria.length,
      ads_aprendizados: ads.length,
      reprovacoes: reprovacoes.length,
      semanas_instagram: semanas.length,
      publicacoes: posts.length,
    },
    avisos,
  };
}

/**
 * O bloco que um agente das mesas põe no prompt: o cérebro da área dele e o
 * dossiê atual do cliente (o retrato geral, com os avanços automáticos),
 * cada um com teto. É a função de LEITURA do sentido inverso (painel para as
 * mesas): quem ainda não lê o dossiê (Estúdio, agente de contexto) chama
 * esta e acrescenta o texto ao sistema. Ver docs/cerebro/AGENTES.md.
 */
export async function contextoParaAgente(
  db: BancoDoCerebro,
  clientId: string,
  area: AreaDoCerebro,
  opcoes: { limiteCerebro?: number; limiteDossie?: number; agora?: Date } = {},
): Promise<{ texto: string; cerebro: string; dossie: string | null; avisos: string[] }> {
  const [leitura, dossieR] = await Promise.all([
    lerCerebro(db, clientId, { agora: opcoes.agora }),
    // Dentro do then: erro síncrono ao montar a consulta também vira dossiê vazio, não queda.
    Promise.resolve()
      .then(() => db.from('client_dossiers').select('content, summary, version, effective_at')
        .eq('client_id', clientId).eq('dossier_type', 'contexto').is('project_id', null).eq('is_current', true)
        .order('effective_at', { ascending: false }).limit(1))
      .then((r: Resposta) => r, (): Resposta => ({ data: [], error: null })),
  ]);
  const cerebro = resumoParaPrompt(leitura.fatos, { areas: [area], limite: opcoes.limiteCerebro }).texto;
  const d = linhasDe(dossieR)[0];
  const limiteDossie = Math.min(Math.max(opcoes.limiteDossie ?? 4000, 500), 12_000);
  const corpo = d ? String(d.content ?? d.summary ?? '').trim() : '';
  const dossie = corpo ? (corpo.length > limiteDossie ? `${corpo.slice(0, limiteDossie).trimEnd()}\n[dossiê cortado para caber]` : corpo) : null;
  const texto = [cerebro, dossie ? `DOSSIÊ ATUAL DO CLIENTE (fatos do painel; vazio não quer dizer que não existe)\n${dossie}` : '']
    .filter(Boolean).join('\n\n');
  return { texto, cerebro, dossie, avisos: leitura.avisos };
}

// ─── Escrita ─────────────────────────────────────────────────

export type NovoAprendizado = {
  client_id: string;
  area: AreaDoCerebro;
  categoria: CategoriaDoCerebro;
  texto: string;
  motivo?: string | null;
  evidencia?: string | null;
  /** Quem escreveu: mcp, painel, estudio, mesa_ads... */
  fonte: string;
  criado_por?: string | null;
  referencia_id?: string | null;
  /** Dias até vencer; null = não vence; ausente = padrão da categoria. */
  valido_dias?: number | null;
};

export type ResultadoDaEscrita = {
  situacao: 'criado' | 'reforcado' | 'substituiu';
  id: string;
  agente: AgenteDaMemoria;
  area: AreaDoCerebro;
  categoria: CategoriaDoCerebro;
  reforcos: number;
  substituidos: string[];
  julgamento: { usado: boolean; repete?: { id: string; probabilidade: number } | null; contradiz?: { id: string; probabilidade: number } | null; erro?: string } ;
  avisos: string[];
};

/** Resposta de um julgamento Choice: opção escolhida e a distribuição. */
export type RespostaChoice = { choice?: string; probabilities?: Record<string, number>; confidence?: number };

/**
 * Julgamento por parâmetro (o Jev em produção, um dublê no teste).
 * Recebe o estado e as perguntas no formato do _shared/jev.ts.
 */
export type JulgarAprendizado = (
  state: unknown,
  questions: Record<string, { type: 'choice'; instructions: unknown; criteria: Record<string, unknown> }>,
) => Promise<Record<string, RespostaChoice>>;

/**
 * As duas perguntas ao Jev, feitas juntas sobre o mesmo estado:
 * - repete: qual aprendizado já registrado diz a MESMA coisa que o novo?
 * - contradiz: qual aprendizado já registrado o novo DESMENTE (o dono mudou
 *   de ideia)?
 * As duas têm a saída "nenhum". Os ids de opção são curtos (m1, m2...) e o
 * código traduz de volta: o texto inteiro vai na descrição da opção.
 */
export function perguntasDeDuplicidade(novo: { texto: string; motivo?: string | null }, candidatos: FatoDoCerebro[]) {
  const criteria: Record<string, string> = {};
  const mapa = new Map<string, string>();
  candidatos.slice(0, MAX_CANDIDATOS_JEV).forEach((c, i) => {
    const op = `m${i + 1}`;
    criteria[op] = `${c.categoria}: ${c.texto}`;
    mapa.set(op, c.id);
  });
  const state = {
    aprendizado_novo: { texto: novo.texto, motivo: novo.motivo ?? null },
    aprendizados_ja_registrados: candidatos.slice(0, MAX_CANDIDATOS_JEV).map((c, i) => ({ opcao: `m${i + 1}`, categoria: c.categoria, texto: c.texto })),
  };
  const questions = {
    repete: {
      type: 'choice' as const,
      instructions: 'Um cliente de agência de marketing ensina preferências à equipe. Qual aprendizado já registrado em `aprendizados_ja_registrados` diz a MESMA instrução prática que `aprendizado_novo.texto`, mesmo com outras palavras? Só conta se seguir um deles já cumpre o novo. Se nenhum diz a mesma coisa, escolha nenhum.',
      criteria: { ...criteria, nenhum: 'Nenhum diz a mesma coisa: o novo traz instrução nova (ou mais específica, ou contrária).' },
    },
    contradiz: {
      type: 'choice' as const,
      instructions: 'Qual aprendizado já registrado em `aprendizados_ja_registrados` o `aprendizado_novo.texto` CONTRADIZ, isto é, seguir o novo obriga a desobedecer o antigo (o cliente mudou de ideia sobre o mesmo ponto)? Complementar ou detalhar não é contradizer. Se nenhum é contrariado, escolha nenhum.',
      criteria: { ...criteria, nenhum: 'Nenhum é contrariado: o novo convive com todos os registrados.' },
    },
  };
  return { state, questions, mapa };
}

/** Lê a escolha acima do corte, traduzindo a opção para o id da linha. */
export function escolhaAcimaDoCorte(r: RespostaChoice | undefined, mapa: Map<string, string>, corte: number): { id: string; probabilidade: number } | null {
  if (!r || !r.choice || r.choice === 'nenhum') return null;
  const id = mapa.get(r.choice);
  const p = typeof r.probabilities?.[r.choice] === 'number' ? r.probabilities[r.choice] : (typeof r.confidence === 'number' ? r.confidence : 0);
  return id && p >= corte ? { id, probabilidade: Math.round(p * 1000) / 1000 } : null;
}

export class CerebroErro extends Error {
  constructor(public codigo: 'validacao' | 'precisa_sql' | 'banco', mensagem: string) {
    super(mensagem);
    this.name = 'CerebroErro';
  }
}

/**
 * Grava um aprendizado sem duplicar.
 *
 * 1. Mesma chave (mesmo texto normalizado) no mesmo agente: reforça.
 * 2. Com julgamento: o que REPETE um ativo reforça o ativo; o que CONTRADIZ
 *    um ativo grava o novo e aposenta o antigo (ativa=false, com o id do
 *    substituto quando a coluna existe). Falha do julgamento vira aviso e a
 *    gravação segue só com a regra 1: o Jev ajuda, não trava.
 * 3. Senão, grava novo.
 */
export async function registrarAprendizado(
  db: BancoDoCerebro,
  novo: NovoAprendizado,
  opcoes: { julgar?: JulgarAprendizado; agora?: Date } = {},
): Promise<ResultadoDaEscrita> {
  const agora = opcoes.agora ?? new Date();
  if (!ehArea(novo.area)) throw new CerebroErro('validacao', `área inválida: use ${AREAS_DO_CEREBRO.join(', ')}`);
  if (!ehCategoria(novo.categoria)) throw new CerebroErro('validacao', `categoria inválida: use ${CATEGORIAS_DO_CEREBRO.join(', ')}`);
  const texto = txt(novo.texto);
  if (texto.length < 3) throw new CerebroErro('validacao', 'texto do aprendizado vazio ou curto demais');
  const agente = AGENTE_DA_AREA[novo.area];
  const chave = chaveDoAprendizado(texto);
  const avisos: string[] = [];
  const julgamento: ResultadoDaEscrita['julgamento'] = { usado: false };

  // Ativos do mesmo agente: é contra eles que se deduplica.
  const ativosR = (await db.from('agente_memoria').select('*').eq('client_id', novo.client_id).eq('agente', agente).eq('ativa', true)
    .order('criado_em', { ascending: false }).limit(120)) as Resposta;
  if (ativosR.error && !faltaNoBancoDoCerebro(ativosR.error)) throw new CerebroErro('banco', `agente_memoria: ${ativosR.error.message}`);
  const ativos = linhasDe(ativosR).map((l) => ({ linha: l, fato: fatoDaMemoria(l) })).filter((x): x is { linha: Linha; fato: FatoDoCerebro } => !!x.fato);

  const reforcar = async (linha: Linha, motivo: string): Promise<ResultadoDaEscrita> => {
    const reforcos = Math.max(1, num(linha.reforcos) ?? 1) + 1;
    const r = (await db.from('agente_memoria').update({ reforcos, reforcado_em: agora.toISOString() })
      .eq('id', linha.id).eq('client_id', novo.client_id)) as Resposta;
    if (r?.error) avisos.push(faltaNoBancoDoCerebro(r.error)
      ? 'O reforço não foi contado: faltam as colunas novas de agente_memoria (docs/cerebro/01_cerebro_memoria.sql).'
      : `O reforço não foi gravado: ${r.error.message}`);
    avisos.push(motivo);
    return {
      situacao: 'reforcado', id: String(linha.id), agente, area: novo.area, categoria: novo.categoria,
      reforcos, substituidos: [], julgamento, avisos,
    };
  };

  const igual = ativos.find((a) => a.fato.chave === chave);
  if (igual) return await reforcar(igual.linha, 'Já existia um aprendizado com o mesmo texto: contado como reforço, sem duplicar.');

  let aposentar: string | null = null;
  const candidatos = ativos.filter((a) => a.fato.area === novo.area || agente !== 'geral').map((a) => a.fato);
  if (opcoes.julgar && candidatos.length) {
    const { state, questions, mapa } = perguntasDeDuplicidade({ texto, motivo: novo.motivo }, candidatos);
    try {
      const respostas = await opcoes.julgar(state, questions);
      julgamento.usado = true;
      julgamento.repete = escolhaAcimaDoCorte(respostas.repete, mapa, CORTE_REPETE);
      julgamento.contradiz = escolhaAcimaDoCorte(respostas.contradiz, mapa, CORTE_CONTRADIZ);
    } catch (e) {
      julgamento.erro = e instanceof Error ? e.message : 'falha no julgamento';
      avisos.push('O Jev não respondeu: gravado sem a checagem de repetição por sentido (só a de texto igual).');
    }
    if (julgamento.repete && julgamento.repete.id !== julgamento.contradiz?.id) {
      const alvo = ativos.find((a) => String(a.linha.id) === julgamento.repete!.id);
      if (alvo) return await reforcar(alvo.linha, 'O Jev leu que este aprendizado diz o mesmo que um já registrado: contado como reforço.');
    }
    if (julgamento.contradiz) aposentar = julgamento.contradiz.id;
  }

  const base = {
    client_id: novo.client_id,
    agente,
    tipo: TIPO_DA_CATEGORIA[novo.categoria],
    texto,
    origem: ORIGEM_DA_CATEGORIA[novo.categoria],
    referencia_id: novo.referencia_id ?? null,
  };
  const completa = {
    ...base,
    area: novo.area,
    categoria: novo.categoria,
    chave,
    motivo: txtOuNulo(novo.motivo, 400),
    evidencia: txtOuNulo(novo.evidencia, 400),
    fonte: txt(novo.fonte, 40) || 'desconhecida',
    criado_por: novo.criado_por ?? null,
    valido_ate: validadePara(novo.categoria, novo.valido_dias, agora),
    reforcos: 1,
  };

  let r = (await db.from('agente_memoria').insert(completa).select('id').single()) as Resposta;
  if (r.error && faltaNoBancoDoCerebro(r.error)) {
    if (agente === 'geral') {
      throw new CerebroErro('precisa_sql', 'A área "geral" precisa das colunas novas de agente_memoria. Aplique docs/cerebro/01_cerebro_memoria.sql ou grave numa área específica (calendario, arte, ads...).');
    }
    avisos.push('Gravado no formato antigo de agente_memoria (sem área, validade e reforço): falta aplicar docs/cerebro/01_cerebro_memoria.sql.');
    r = (await db.from('agente_memoria').insert(base).select('id').single()) as Resposta;
  }
  if (r.error) {
    if (r.error.code === '23514' && agente === 'geral') {
      throw new CerebroErro('precisa_sql', 'O banco ainda não aceita o agente "geral" em agente_memoria. Aplique docs/cerebro/01_cerebro_memoria.sql.');
    }
    if (r.error.code === '23505') {
      // Corrida: outra gravação com a mesma chave entrou agora. Reforça a que ficou.
      const deNovo = (await db.from('agente_memoria').select('*').eq('client_id', novo.client_id).eq('agente', agente).eq('ativa', true).eq('chave', chave).limit(1)) as Resposta;
      const linha = linhasDe(deNovo)[0];
      if (linha) return await reforcar(linha, 'Outra gravação igual entrou ao mesmo tempo: contado como reforço.');
    }
    throw new CerebroErro('banco', `agente_memoria: ${r.error.message}`);
  }
  const id = String((r.data as Linha | null)?.id ?? '');

  const substituidos: string[] = [];
  if (aposentar && aposentar !== id) {
    let a = (await db.from('agente_memoria').update({ ativa: false, substituida_por: id }).eq('id', aposentar).eq('client_id', novo.client_id)) as Resposta;
    if (a?.error && faltaNoBancoDoCerebro(a.error)) {
      a = (await db.from('agente_memoria').update({ ativa: false }).eq('id', aposentar).eq('client_id', novo.client_id)) as Resposta;
    }
    if (a?.error) avisos.push(`O aprendizado antigo contrariado não foi aposentado: ${a.error.message}`);
    else {
      substituidos.push(aposentar);
      avisos.push('O novo contradiz um aprendizado antigo: o antigo foi aposentado (continua no histórico, inativo).');
    }
  }

  return {
    situacao: substituidos.length ? 'substituiu' : 'criado',
    id, agente, area: novo.area, categoria: novo.categoria, reforcos: 1, substituidos, julgamento, avisos,
  };
}
