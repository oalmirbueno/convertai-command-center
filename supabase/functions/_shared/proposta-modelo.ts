/**
 * Proposta comercial da Aceleriq (frente PRO, 30/09/2026): o formato dos
 * dados, as regras e os textos que a tela, a função mesa-proposta e a página
 * pública /proposta/:token dividem. Sem import de Deno nem de npm: roda na
 * função (Deno) e no navegador e nos testes (vitest).
 *
 * Estrutura (plano p1 §4 e p3 §2.4): 12 blocos, na ordem da conversa de
 * venda: capa com headline de benefício, número e validade; o desafio nas
 * palavras do cliente; diagnóstico; mercado (cada número com fonte e data);
 * solução; entregáveis em página própria; processo; cronograma;
 * investimento (intangíveis e condições, o valor sai dos itens); provas
 * (depois do preço, só cases reais da agência); quem somos; próximos passos
 * e aceite. Frente PRO3 (30/09): o bloco "O que você já tem" (ja_tem), logo
 * depois da capa, só aparece na proposta de upsell (vazio, a página pública
 * não desenha); os dados dele vêm do painel, nunca do modelo de IA.
 *
 * Regra de ouro: nada de número inventado. Dado de mercado sem fonte (link e
 * data) sai; concorrente sem fonte sai; frase com número que não está no
 * material do cliente nem nos itens sai e vira pendência. O preço sai só dos
 * itens (código), nunca do modelo de IA.
 *
 * Nada aqui usa lookbehind, grupo nomeado nem \p{}: a tela roda no Safari 11.
 */

// ------------------------------------------------------------------ blocos

export const TIPOS_DE_BLOCO = [
  "capa",
  // Frente PRO3 (30/09): na proposta de upsell, o que o cliente já tem vem antes do próximo passo.
  "ja_tem",
  "desafio",
  "diagnostico",
  "mercado",
  "solucao",
  "entregaveis",
  "processo",
  "cronograma",
  "investimento",
  "provas",
  "quem_somos",
  "proximos_passos",
] as const;
export type TipoDeBloco = (typeof TIPOS_DE_BLOCO)[number];

export const ROTULO_DO_BLOCO: Record<TipoDeBloco, string> = {
  capa: "Capa",
  ja_tem: "O que você já tem",
  desafio: "O desafio",
  diagnostico: "Diagnóstico",
  mercado: "Mercado",
  solucao: "Solução",
  entregaveis: "Entregáveis",
  processo: "Processo",
  cronograma: "Cronograma",
  investimento: "Investimento",
  provas: "Provas",
  quem_somos: "Quem somos",
  proximos_passos: "Próximos passos",
};

/** Fundo de cada página: explicação no claro, dinheiro e prova no escuro (p1 §4.2). */
export const FUNDO_DO_BLOCO: Record<TipoDeBloco, "escuro" | "claro"> = {
  capa: "escuro",
  ja_tem: "claro",
  desafio: "claro",
  diagnostico: "claro",
  mercado: "claro",
  solucao: "claro",
  entregaveis: "claro",
  processo: "claro",
  cronograma: "claro",
  investimento: "escuro",
  provas: "escuro",
  quem_somos: "escuro",
  proximos_passos: "escuro",
};

export const ehTipoDeBloco = (v: unknown): v is TipoDeBloco => typeof v === "string" && (TIPOS_DE_BLOCO as readonly string[]).indexOf(v) >= 0;

export type FonteDoDado = { titulo: string; url: string; data: string };
export type DadoDeMercado = { rotulo: string; valor: string; fonte: FonteDoDado; trecho: string };
export type Concorrente = { nome: string; faz_bem: string; oportunidade: string; fonte: FonteDoDado };
export type Achado = { titulo: string; texto: string; fonte: FonteDoDado | null };
export type TituloETexto = { titulo: string; texto: string };

export type DadosDoBloco = {
  capa: { headline: string; subtitulo: string; projeto: string };
  /** Upsell (PRO3): serviços, plano e resultados reais do cliente, lidos do painel (nunca do modelo de IA). */
  ja_tem: { texto: string; servicos: string[]; plano: string; resultados: TituloETexto[] };
  desafio: { texto: string; palavras_do_cliente: string[]; compromisso: string };
  diagnostico: { achados: Achado[] };
  mercado: { resumo: string; concorrentes: Concorrente[]; dados: DadoDeMercado[]; faixa_de_preco: { texto: string; fonte: FonteDoDado } | null; pesquisado_em: string | null };
  solucao: { texto: string; frentes: TituloETexto[] };
  entregaveis: { itens: Array<{ nome: string; detalhe: string }>; nao_inclui: string[] };
  processo: { etapas: TituloETexto[] };
  cronograma: { marcos: Array<{ titulo: string; quando: string }>; observacao: string };
  investimento: { intangiveis: string[]; condicoes: string; observacao: string };
  provas: { cases: Array<{ titulo: string; texto: string; link: string }>; depoimentos: Array<{ nome: string; texto: string }> };
  quem_somos: { texto: string };
  proximos_passos: { passos: string[]; chamada: string };
};

export type Bloco<T extends TipoDeBloco = TipoDeBloco> = { id: string; tipo: T; titulo: string; visivel: boolean; dados: DadosDoBloco[T] };
export type ConteudoDaProposta = { blocos: Bloco[] };

// ------------------------------------------------------------------ texto seguro

const TRAVESSAO = /\s*[—–]\s*/g;

/** Texto de uma linha ou parágrafo, sem travessão (regra do dono), cortado no tamanho. */
export function textoLimpo(v: unknown, max: number): string {
  if (typeof v !== "string" && typeof v !== "number") return "";
  return String(v).replace(/\r\n?/g, "\n").replace(TRAVESSAO, ", ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, max);
}

const listaDeTextos = (v: unknown, max: number, n: number) => (Array.isArray(v) ? v : []).map((x) => textoLimpo(x, max)).filter(Boolean).slice(0, n);

const URL_OK = /^https?:\/\/[^\s/$.?#][^\s]*$/i;
const DATA_OK = /^\d{4}-\d{2}(-\d{2})?$/;

/** Fonte completa (título, link http e data AAAA-MM ou AAAA-MM-DD) ou null. */
export function fonteValida(v: unknown): FonteDoDado | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const url = textoLimpo(o.url, 600);
  const data = textoLimpo(o.data, 10);
  if (!URL_OK.test(url) || !DATA_OK.test(data)) return null;
  return { titulo: textoLimpo(o.titulo, 160) || dominio(url), url, data };
}

export function dominio(url: string): string {
  const m = /^https?:\/\/([^/?#]+)/i.exec(url || "");
  return m ? m[1].replace(/^www\./i, "") : "";
}

// ------------------------------------------------------------------ normalizar

function titulosETextos(v: unknown, n: number): TituloETexto[] {
  return (Array.isArray(v) ? v : [])
    .map((x) => (x && typeof x === "object" ? { titulo: textoLimpo((x as Record<string, unknown>).titulo, 120), texto: textoLimpo((x as Record<string, unknown>).texto, 700) } : null))
    .filter((x): x is TituloETexto => !!x && !!(x.titulo || x.texto))
    .slice(0, n);
}

/** Dados de um bloco no formato certo (campo estranho some; faltando, vazio). */
export function normalizarDados<T extends TipoDeBloco>(tipo: T, bruto: unknown): DadosDoBloco[T] {
  const o = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const r = (x: DadosDoBloco[TipoDeBloco]) => x as DadosDoBloco[T];
  switch (tipo) {
    case "capa":
      return r({ headline: textoLimpo(o.headline, 160), subtitulo: textoLimpo(o.subtitulo, 240), projeto: textoLimpo(o.projeto, 120) });
    case "ja_tem":
      return r({ texto: textoLimpo(o.texto, 900), servicos: listaDeTextos(o.servicos, 80, 12), plano: textoLimpo(o.plano, 200), resultados: titulosETextos(o.resultados, 6) });
    case "desafio":
      return r({ texto: textoLimpo(o.texto, 1600),palavras_do_cliente: listaDeTextos(o.palavras_do_cliente, 200, 4), compromisso: textoLimpo(o.compromisso, 400) });
    case "diagnostico":
      return r({
        achados: (Array.isArray(o.achados) ? o.achados : [])
          .map((x) => (x && typeof x === "object" ? { titulo: textoLimpo((x as Record<string, unknown>).titulo, 120), texto: textoLimpo((x as Record<string, unknown>).texto, 600), fonte: fonteValida((x as Record<string, unknown>).fonte) } : null))
          .filter((x): x is Achado => !!x && !!(x.titulo || x.texto))
          .slice(0, 5),
      });
    case "mercado": {
      const faixa = o.faixa_de_preco && typeof o.faixa_de_preco === "object" ? (o.faixa_de_preco as Record<string, unknown>) : null;
      const fonteDaFaixa = faixa ? fonteValida(faixa.fonte) : null;
      return r({
        resumo: textoLimpo(o.resumo, 700),
        concorrentes: (Array.isArray(o.concorrentes) ? o.concorrentes : [])
          .map((x) => {
            const c = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
            const fonte = fonteValida(c.fonte);
            const nome = textoLimpo(c.nome, 80);
            return nome && fonte ? { nome, faz_bem: textoLimpo(c.faz_bem, 300), oportunidade: textoLimpo(c.oportunidade, 300), fonte } : null;
          })
          .filter((x): x is Concorrente => !!x)
          .slice(0, 5),
        dados: (Array.isArray(o.dados) ? o.dados : [])
          .map((x) => {
            const d = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
            const fonte = fonteValida(d.fonte);
            const valor = textoLimpo(d.valor, 60);
            return valor && fonte ? { rotulo: textoLimpo(d.rotulo, 160), valor, fonte, trecho: textoLimpo(d.trecho, 400) } : null;
          })
          .filter((x): x is DadoDeMercado => !!x)
          .slice(0, 4),
        faixa_de_preco: faixa && fonteDaFaixa && textoLimpo(faixa.texto, 240) ? { texto: textoLimpo(faixa.texto, 240), fonte: fonteDaFaixa } : null,
        pesquisado_em: DATA_OK.test(String(o.pesquisado_em || "")) ? String(o.pesquisado_em) : null,
      });
    }
    case "solucao":
      return r({ texto: textoLimpo(o.texto, 1000), frentes: titulosETextos(o.frentes, 4) });
    case "entregaveis":
      return r({
        itens: (Array.isArray(o.itens) ? o.itens : [])
          .map((x) => (x && typeof x === "object" ? { nome: textoLimpo((x as Record<string, unknown>).nome, 120), detalhe: textoLimpo((x as Record<string, unknown>).detalhe, 300) } : null))
          .filter((x): x is { nome: string; detalhe: string } => !!x && !!x.nome)
          .slice(0, 16),
        nao_inclui: listaDeTextos(o.nao_inclui, 200, 8),
      });
    case "processo":
      return r({ etapas: titulosETextos(o.etapas, 8) });
    case "cronograma":
      return r({
        marcos: (Array.isArray(o.marcos) ? o.marcos : [])
          .map((x) => (x && typeof x === "object" ? { titulo: textoLimpo((x as Record<string, unknown>).titulo, 120), quando: textoLimpo((x as Record<string, unknown>).quando, 60) } : null))
          .filter((x): x is { titulo: string; quando: string } => !!x && !!x.titulo)
          .slice(0, 10),
        observacao: textoLimpo(o.observacao, 300),
      });
    case "investimento":
      return r({ intangiveis: listaDeTextos(o.intangiveis, 160, 10), condicoes: textoLimpo(o.condicoes, 500), observacao: textoLimpo(o.observacao, 300) });
    case "provas":
      return r({
        cases: (Array.isArray(o.cases) ? o.cases : [])
          .map((x) => {
            const c = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
            const link = textoLimpo(c.link, 600);
            return { titulo: textoLimpo(c.titulo, 120), texto: textoLimpo(c.texto, 500), link: URL_OK.test(link) ? link : "" };
          })
          .filter((x) => !!x.titulo)
          .slice(0, 4),
        depoimentos: (Array.isArray(o.depoimentos) ? o.depoimentos : [])
          .map((x) => (x && typeof x === "object" ? { nome: textoLimpo((x as Record<string, unknown>).nome, 80), texto: textoLimpo((x as Record<string, unknown>).texto, 500) } : null))
          .filter((x): x is { nome: string; texto: string } => !!x && !!x.nome && !!x.texto)
          .slice(0, 4),
      });
    case "quem_somos":
      return r({ texto: textoLimpo(o.texto, 1200) });
    case "proximos_passos":
      return r({ passos: listaDeTextos(o.passos, 200, 6), chamada: textoLimpo(o.chamada, 200) });
  }
  return r({} as DadosDoBloco[TipoDeBloco]);
}

/** Um bloco em forma segura (tipo desconhecido: null). */
export function normalizarBloco(bruto: unknown): Bloco | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  if (!ehTipoDeBloco(o.tipo)) return null;
  const tipo = o.tipo;
  return {
    id: textoLimpo(o.id, 40) || `b-${tipo}`,
    tipo,
    titulo: textoLimpo(o.titulo, 120) || ROTULO_DO_BLOCO[tipo],
    visivel: o.visivel !== false,
    dados: normalizarDados(tipo, o.dados),
  };
}

/**
 * Conteúdo em forma segura: um bloco de cada tipo, na ordem oficial. O que
 * faltar entra vazio (e oculto quando não tem nada); repetido fica o primeiro.
 */
export function normalizarConteudo(bruto: unknown): ConteudoDaProposta {
  const lista = bruto && typeof bruto === "object" && Array.isArray((bruto as { blocos?: unknown }).blocos) ? ((bruto as { blocos: unknown[] }).blocos) : [];
  const porTipo = new Map<TipoDeBloco, Bloco>();
  for (const b of lista) {
    const n = normalizarBloco(b);
    if (n && !porTipo.has(n.tipo)) porTipo.set(n.tipo, n);
  }
  return {
    blocos: TIPOS_DE_BLOCO.map((tipo) => porTipo.get(tipo) || { id: `b-${tipo}`, tipo, titulo: ROTULO_DO_BLOCO[tipo], visivel: true, dados: normalizarDados(tipo, {}) }),
  };
}

export function blocoDoTipo<T extends TipoDeBloco>(c: ConteudoDaProposta, tipo: T): Bloco<T> {
  return (c.blocos.find((b) => b.tipo === tipo) || { id: `b-${tipo}`, tipo, titulo: ROTULO_DO_BLOCO[tipo], visivel: true, dados: normalizarDados(tipo, {}) }) as Bloco<T>;
}

/** Troca os dados (e o que mais vier) de um bloco, sem mexer nos outros. */
export function comBloco(c: ConteudoDaProposta, tipo: TipoDeBloco, mudanca: Partial<Pick<Bloco, "titulo" | "visivel" | "dados">>): ConteudoDaProposta {
  return normalizarConteudo({ blocos: c.blocos.map((b) => (b.tipo === tipo ? { ...b, ...mudanca } : b)) });
}

/** Bloco sem nada para mostrar (a página pública não desenha). */
export function blocoVazio(b: Bloco): boolean {
  const d = b.dados as Record<string, unknown>;
  switch (b.tipo) {
    case "capa":
      return false;
    case "investimento":
      return false;
    case "proximos_passos":
      return false;
    default:
      return !Object.keys(d).some((k) => {
        const v = d[k];
        return Array.isArray(v) ? v.length > 0 : typeof v === "string" ? !!v.trim() : !!v && typeof v === "object";
      });
  }
}

/** Blocos que a página pública mostra: visíveis e com conteúdo. */
export function blocosParaMostrar(c: ConteudoDaProposta): Bloco[] {
  return c.blocos.filter((b) => b.visivel && !blocoVazio(b));
}

// ------------------------------------------------------------------ modelos de proposta

export type ModeloDeProposta = {
  id: string | null;
  nome: string;
  descricao: string;
  validade_dias: number;
  condicoes: string;
  blocos: Array<{ tipo: TipoDeBloco; titulo: string; visivel: boolean; dados: Record<string, unknown> }>;
};

/**
 * O modelo padrão da Aceleriq (escrito para a Aceleriq, em "nós", sem copiar
 * modelo de terceiro). Os textos-base são o ponto de partida do processo, das
 * condições e dos próximos passos; o agente adapta ao cliente.
 */
export const MODELO_PADRAO_ACELERIQ: ModeloDeProposta = {
  id: null,
  nome: "Padrão Aceleriq",
  descricao: "Proposta vertical em 12 blocos, com mercado e preço pelos itens.",
  validade_dias: 15,
  condicoes: "50% na aprovação e 50% na entrega, por PIX ou boleto. Os detalhes ficam no contrato.",
  blocos: [
    { tipo: "capa", titulo: "Capa", visivel: true, dados: {} },
    { tipo: "desafio", titulo: "O desafio", visivel: true, dados: { compromisso: "Nosso compromisso é resolver isso com método, prazo claro e conversa aberta em cada etapa." } },
    { tipo: "diagnostico", titulo: "Onde vocês estão hoje", visivel: true, dados: {} },
    { tipo: "mercado", titulo: "O mercado", visivel: true, dados: {} },
    { tipo: "solucao", titulo: "O que vamos fazer", visivel: true, dados: {} },
    { tipo: "entregaveis", titulo: "O que você recebe", visivel: true, dados: { nao_inclui: ["Custos de terceiros (impressão, mídia paga, domínio e hospedagem), salvo quando listados nos itens."] } },
    {
      tipo: "processo",
      titulo: "Como trabalhamos",
      visivel: true,
      dados: {
        etapas: [
          { titulo: "Imersão", texto: "Reunião de kickoff, briefing e leitura do que já existe." },
          { titulo: "Estratégia", texto: "Diagnóstico, referências e a direção aprovada com você." },
          { titulo: "Criação", texto: "Produção das entregas com revisões combinadas." },
          { titulo: "Entrega", texto: "Arquivos finais, orientação de uso e próximos passos." },
        ],
      },
    },
    { tipo: "cronograma", titulo: "Cronograma", visivel: true, dados: { observacao: "As datas contam a partir da aprovação e podem mudar com o tempo de resposta de cada etapa." } },
    { tipo: "investimento", titulo: "Investimento", visivel: true, dados: {} },
    { tipo: "provas", titulo: "Quem já trabalhou com a gente", visivel: true, dados: {} },
    { tipo: "quem_somos", titulo: "Quem somos", visivel: true, dados: {} },
    { tipo: "proximos_passos", titulo: "Próximos passos", visivel: true, dados: { passos: ["Aceite esta proposta pelo botão abaixo.", "Enviamos o contrato para assinatura.", "Marcamos o kickoff."], chamada: "Vamos começar?" } },
  ],
};

/** Modelo em forma segura (do banco ou o padrão). */
export function normalizarModelo(bruto: unknown): ModeloDeProposta {
  if (!bruto || typeof bruto !== "object") return MODELO_PADRAO_ACELERIQ;
  const o = bruto as Record<string, unknown>;
  const blocos = (Array.isArray(o.blocos) ? o.blocos : [])
    .map((b) => (b && typeof b === "object" && ehTipoDeBloco((b as Record<string, unknown>).tipo) ? b as Record<string, unknown> : null))
    .filter((b): b is Record<string, unknown> => !!b)
    .map((b) => ({ tipo: b.tipo as TipoDeBloco, titulo: textoLimpo(b.titulo, 120) || ROTULO_DO_BLOCO[b.tipo as TipoDeBloco], visivel: b.visivel !== false, dados: (b.dados && typeof b.dados === "object" ? b.dados : {}) as Record<string, unknown> }));
  const dias = Math.round(Number(o.validade_dias));
  return {
    id: typeof o.id === "string" ? o.id : null,
    nome: textoLimpo(o.nome, 80) || "Modelo",
    descricao: textoLimpo(o.descricao, 240),
    validade_dias: dias >= 1 && dias <= 120 ? dias : MODELO_PADRAO_ACELERIQ.validade_dias,
    condicoes: textoLimpo(o.condicoes, 500) || MODELO_PADRAO_ACELERIQ.condicoes,
    blocos: blocos.length ? blocos : MODELO_PADRAO_ACELERIQ.blocos,
  };
}

/** Conteúdo inicial de uma proposta a partir do modelo. */
export function conteudoDoModelo(modelo: ModeloDeProposta): ConteudoDaProposta {
  const conteudo = normalizarConteudo({ blocos: modelo.blocos.map((b) => ({ id: `b-${b.tipo}`, ...b })) });
  const inv = blocoDoTipo(conteudo, "investimento");
  if (!inv.dados.condicoes) return comBloco(conteudo, "investimento", { dados: { ...inv.dados, condicoes: modelo.condicoes } });
  return conteudo;
}

/** Modelo a partir de uma proposta pronta: só a estrutura e os textos que não são do cliente. */
export function modeloDaProposta(c: ConteudoDaProposta, nome: string, validadeDias: number): ModeloDeProposta {
  const inv = blocoDoTipo(c, "investimento");
  const guardar: Partial<Record<TipoDeBloco, (d: Record<string, unknown>) => Record<string, unknown>>> = {
    processo: (d) => ({ etapas: d.etapas }),
    entregaveis: (d) => ({ nao_inclui: d.nao_inclui }),
    cronograma: (d) => ({ observacao: d.observacao }),
    investimento: (d) => ({ condicoes: d.condicoes }),
    proximos_passos: (d) => ({ passos: d.passos, chamada: d.chamada }),
    desafio: (d) => ({ compromisso: d.compromisso }),
  };
  return normalizarModelo({
    nome,
    validade_dias: validadeDias,
    condicoes: inv.dados.condicoes,
    blocos: c.blocos.map((b) => ({ tipo: b.tipo, titulo: b.titulo, visivel: b.visivel, dados: guardar[b.tipo] ? guardar[b.tipo]!(b.dados as Record<string, unknown>) : {} })),
  });
}

// ------------------------------------------------------------------ itens e preço

export type Recorrencia = "unico" | "mensal";
export type ItemDaProposta = {
  id: string;
  nome: string;
  descricao: string;
  quantidade: number;
  valor_unitario: number;
  recorrencia: Recorrencia;
  origem: "plano" | "servico" | "manual";
  plano_id: string | null;
  servico: string | null;
  /** Horas estimadas por unidade (frente PRO2: calculadora de hora técnica e ajuste por margem). Só existe quando foi dita. */
  horas?: number;
  /** Serviço da biblioteca da agência de onde o item veio (frente PRO2). */
  biblioteca_id?: string;
};

export const MAX_ITENS = 30;
const VALOR_MAXIMO = 10_000_000;

const centavos = (v: number) => Math.round(v * 100) / 100;

/** Número de dinheiro digitado ("1.500,00", "1500.5", "R$ 2 mil") ou null. */
export function lerValor(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v >= 0 && v <= VALOR_MAXIMO ? centavos(v) : null;
  if (typeof v !== "string") return null;
  let s = v.toLowerCase().replace(/r\$/g, "").replace(/\s+/g, "").trim();
  if (!s) return null;
  let mult = 1;
  if (/mil$/.test(s)) {
    mult = 1000;
    s = s.replace(/mil$/, "");
  } else if (/k$/.test(s)) {
    mult = 1000;
    s = s.replace(/k$/, "");
  }
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(",", ".");
  else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) s = s.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s) * mult;
  return Number.isFinite(n) && n >= 0 && n <= VALOR_MAXIMO ? centavos(n) : null;
}

export function normalizarItem(bruto: unknown, i = 0): ItemDaProposta | null {
  if (!bruto || typeof bruto !== "object") return null;
  const o = bruto as Record<string, unknown>;
  const nome = textoLimpo(o.nome, 120);
  const valor = lerValor(o.valor_unitario);
  if (!nome || valor === null) return null;
  const q = Math.round(Number(o.quantidade));
  const origem = o.origem === "plano" || o.origem === "servico" ? o.origem : "manual";
  const item: ItemDaProposta = {
    id: textoLimpo(o.id, 40) || `i${i + 1}`,
    nome,
    descricao: textoLimpo(o.descricao, 300),
    quantidade: q >= 1 && q <= 999 ? q : 1,
    valor_unitario: valor,
    recorrencia: o.recorrencia === "mensal" ? "mensal" : "unico",
    origem,
    plano_id: typeof o.plano_id === "string" && o.plano_id ? o.plano_id.slice(0, 40) : null,
    servico: typeof o.servico === "string" && o.servico ? o.servico.slice(0, 40) : null,
  };
  // Campos da frente PRO2: só entram quando existem (o item antigo fica igual).
  const horas = Number(o.horas);
  if (o.horas !== undefined && o.horas !== null && o.horas !== "" && Number.isFinite(horas) && horas > 0 && horas <= 10_000) item.horas = Math.round(horas * 100) / 100;
  if (typeof o.biblioteca_id === "string" && /^[0-9a-f-]{36}$/i.test(o.biblioteca_id)) item.biblioteca_id = o.biblioteca_id;
  return item;
}

export function normalizarItens(bruto: unknown): ItemDaProposta[] {
  const vistos = new Set<string>();
  const saida: ItemDaProposta[] = [];
  (Array.isArray(bruto) ? bruto : []).forEach((b, i) => {
    const it = normalizarItem(b, i);
    if (!it || saida.length >= MAX_ITENS) return;
    let id = it.id;
    let n = 2;
    while (vistos.has(id)) id = `${it.id}-${n++}`;
    vistos.add(id);
    saida.push({ ...it, id });
  });
  return saida;
}

export type Totais = { unico: number; mensal: number; itens: number };

/** O preço da proposta sai só daqui: soma dos itens, separado em único e mensal. */
export function totaisDosItens(itens: ItemDaProposta[]): Totais {
  let unico = 0;
  let mensal = 0;
  for (const it of itens) {
    const sub = centavos(it.quantidade * it.valor_unitario);
    if (it.recorrencia === "mensal") mensal += sub;
    else unico += sub;
  }
  return { unico: centavos(unico), mensal: centavos(mensal), itens: itens.length };
}

export function reais(v: number): string {
  const n = Number.isFinite(v) ? v : 0;
  const inteiro = Math.floor(Math.abs(n));
  const cent = Math.round((Math.abs(n) - inteiro) * 100);
  const milhar = String(inteiro).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${n < 0 ? "-" : ""}R$ ${milhar},${String(cent).padStart(2, "0")}`;
}

/** Frase do total: "R$ 3.000,00 + R$ 1.500,00 por mês". */
export function textoDoTotal(t: Totais): string {
  if (!t.itens) return "Sem itens";
  const partes: string[] = [];
  if (t.unico > 0) partes.push(reais(t.unico));
  if (t.mensal > 0) partes.push(`${reais(t.mensal)} por mês`);
  return partes.join(" + ") || reais(0);
}

// ------------------------------------------------------------------ status e validade

export const STATUS_DA_PROPOSTA = ["rascunho", "enviada", "vista", "aceita", "recusada", "expirada"] as const;
export type StatusDaProposta = (typeof STATUS_DA_PROPOSTA)[number];
export const ROTULO_DO_STATUS: Record<StatusDaProposta, string> = {
  rascunho: "Rascunho",
  enviada: "Enviada",
  vista: "Vista",
  aceita: "Aceita",
  recusada: "Recusada",
  expirada: "Expirada",
};
export const ehStatus = (v: unknown): v is StatusDaProposta => typeof v === "string" && (STATUS_DA_PROPOSTA as readonly string[]).indexOf(v) >= 0;

/** Hoje em São Paulo (UTC-3, sem horário de verão desde 2019), AAAA-MM-DD. */
export function hojeEmSaoPaulo(agora: Date = new Date()): string {
  return new Date(agora.getTime() - 3 * 3600_000).toISOString().slice(0, 10);
}

export function somarDias(dia: string, dias: number): string {
  const [a, m, d] = dia.split("-").map(Number);
  const t = Date.UTC(a, (m || 1) - 1, d || 1) + Math.round(dias) * 86400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export function diaValido(v: unknown): string | null {
  const s = typeof v === "string" ? v.slice(0, 10) : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const t = Date.parse(`${s}T00:00:00Z`);
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s ? s : null;
}

/** A validade vale o dia inteiro: vence no dia seguinte. */
export function validadeVencida(validade: string | null | undefined, hoje: string): boolean {
  return !!validade && validade < hoje;
}

/** Status que a tela e o link mostram: enviada ou vista depois da validade é expirada. */
export function statusEfetivo(status: unknown, validade: string | null | undefined, hoje: string): StatusDaProposta {
  const s = ehStatus(status) ? status : "rascunho";
  if ((s === "enviada" || s === "vista") && validadeVencida(validade, hoje)) return "expirada";
  return s;
}

/** Motivo para não aceitar (null: pode aceitar). */
export function motivoParaNaoAceitar(p: { status: unknown; validade_ate: string | null }, hoje: string): string | null {
  const s = statusEfetivo(p.status, p.validade_ate, hoje);
  if (s === "aceita") return "Esta proposta já foi aceita.";
  if (s === "expirada") return "A validade desta proposta terminou. Fale com a Aceleriq para receber uma nova.";
  if (s === "recusada") return "Esta proposta foi encerrada.";
  if (s !== "enviada" && s !== "vista") return "Esta proposta ainda não foi enviada.";
  return null;
}

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Confere o aceite: nome, e-mail e a caixa marcada. Devolve o erro ou null. */
export function validarAceite(a: { nome?: unknown; email?: unknown; aceito?: unknown }): string | null {
  const nome = textoLimpo(a.nome, 200);
  const email = textoLimpo(a.email, 200).toLowerCase();
  if (nome.length < 3) return "Escreva o seu nome completo.";
  if (!EMAIL_OK.test(email)) return "Escreva um e-mail válido.";
  if (a.aceito !== true) return "Marque a caixa de aceite.";
  return null;
}

/** Número da proposta: ano e sequência de 3 dígitos ("2026-007"). */
export function numeroDaProposta(ano: number, sequencia: number): string {
  return `${ano}-${String(Math.max(1, Math.round(sequencia))).padStart(3, "0")}`;
}

export function dataCurta(dia: string | null | undefined): string {
  const d = diaValido(dia || "");
  if (!d) return "";
  const [a, m, dd] = d.split("-");
  return `${dd}/${m}/${a}`;
}

// ------------------------------------------------------------------ número sem fonte

/**
 * Números de um texto: dinheiro, porcentagem, "3 mil", "1,5 milhão", 12.000.
 * Ano (1900 a 2099) sozinho e contagem pequena (até 10) não contam: não são
 * afirmação de mercado.
 */
export function numerosDoTexto(texto: string): string[] {
  const achados = String(texto || "").match(/(r\$\s*)?\d+([.,]\d+)*(\s*%|\s*(mil|mi|milh[õo]es|milh[ãa]o|bi|bilh[õo]es|bilh[ãa]o)\b)?/gi) || [];
  return achados
    .map((a) => a.trim())
    .filter((a) => {
      const soDigitos = a.replace(/[^\d]/g, "");
      const temUnidade = /%|r\$|mil|mi|bi/i.test(a);
      if (!temUnidade && /^(19|20)\d{2}$/.test(soDigitos)) return false;
      if (!temUnidade && !/[.,]/.test(a) && Number(soDigitos) <= 10) return false;
      return soDigitos.length > 0;
    });
}

const digitos = (s: string) => s.replace(/[^\d]/g, "").replace(/^0+/, "");

/** O número aparece no material de origem (notas, transcrição, arquivos, itens)? */
export function numeroTemOrigem(numero: string, origem: string): boolean {
  const alvo = digitos(numero);
  if (!alvo) return true;
  const daOrigem = (String(origem || "").match(/\d+([.,]\d+)*/g) || []).map(digitos);
  return daOrigem.indexOf(alvo) >= 0;
}

/** Frases de um texto (sem lookbehind: separa no ponto seguido de espaço). */
export function frasesDe(texto: string): string[] {
  const partes = String(texto || "").split(/([.!?]+\s+)/);
  const saida: string[] = [];
  for (let i = 0; i < partes.length; i += 2) {
    const f = `${partes[i] || ""}${partes[i + 1] || ""}`;
    if (f.trim()) saida.push(f);
  }
  return saida;
}

/**
 * Tira do texto as frases com número que não tem origem no material do
 * cliente. Devolve o texto limpo e as frases tiradas (viram pendência).
 */
export function semNumeroInventado(texto: string, origem: string): { texto: string; tiradas: string[] } {
  const tiradas: string[] = [];
  const ficam = frasesDe(texto).filter((f) => {
    const sem = numerosDoTexto(f).filter((n) => !numeroTemOrigem(n, origem));
    if (sem.length) tiradas.push(f.trim());
    return !sem.length;
  });
  return { texto: ficam.join("").trim(), tiradas };
}

/**
 * Passa a régua do "sem número inventado" no conteúdo inteiro:
 * - mercado: só fica dado, concorrente e faixa de preço com fonte (link e data);
 * - diagnóstico: achado com número sem fonte e sem origem sai;
 * - textos livres (capa, desafio, solução, entregáveis, cronograma, investimento): frase com número sem origem sai.
 * O que sai volta em `tiradas` para virar pendência ("confirme este número").
 */
export function conteudoSemNumeroInventado(c: ConteudoDaProposta, origem: string): { conteudo: ConteudoDaProposta; tiradas: string[] } {
  const tiradas: string[] = [];
  const limpar = (t: string) => {
    const r = semNumeroInventado(t, origem);
    tiradas.push(...r.tiradas);
    return r.texto;
  };
  const blocos = c.blocos.map((b): Bloco => {
    const d = b.dados as Record<string, unknown>;
    switch (b.tipo) {
      case "capa": {
        const x = b.dados as DadosDoBloco["capa"];
        return { ...b, dados: { ...x, headline: limpar(x.headline), subtitulo: limpar(x.subtitulo) } };
      }
      case "desafio": {
        const x = b.dados as DadosDoBloco["desafio"];
        // As palavras do cliente são dele: número nelas precisa estar no material.
        const palavras = x.palavras_do_cliente.filter((p) => {
          const sem = numerosDoTexto(p).filter((n) => !numeroTemOrigem(n, origem));
          if (sem.length) tiradas.push(p);
          return !sem.length;
        });
        return { ...b, dados: { ...x, texto: limpar(x.texto), compromisso: limpar(x.compromisso), palavras_do_cliente: palavras } };
      }
      case "diagnostico": {
        const x = b.dados as DadosDoBloco["diagnostico"];
        const achados = x.achados.filter((a) => {
          if (a.fonte) return true;
          const sem = numerosDoTexto(`${a.titulo} ${a.texto}`).filter((n) => !numeroTemOrigem(n, origem));
          if (sem.length) tiradas.push(`${a.titulo}: ${a.texto}`.trim());
          return !sem.length;
        });
        return { ...b, dados: { achados } };
      }
      case "mercado": {
        const x = normalizarDados("mercado", d);
        return { ...b, dados: { ...x, resumo: limpar(x.resumo) } };
      }
      case "solucao": {
        const x = b.dados as DadosDoBloco["solucao"];
        return { ...b, dados: { texto: limpar(x.texto), frentes: x.frentes.map((f) => ({ titulo: f.titulo, texto: limpar(f.texto) })) } };
      }
      case "entregaveis": {
        const x = b.dados as DadosDoBloco["entregaveis"];
        return { ...b, dados: { ...x, itens: x.itens.map((i) => ({ nome: i.nome, detalhe: limpar(i.detalhe) })) } };
      }
      case "investimento": {
        const x = b.dados as DadosDoBloco["investimento"];
        return { ...b, dados: { ...x, observacao: limpar(x.observacao) } };
      }
      default:
        return b;
    }
  });
  return { conteudo: normalizarConteudo({ blocos }), tiradas: tiradas.filter(Boolean) };
}

/**
 * Dado de mercado que o modelo mandou e a régua tirou (sem link ou sem data):
 * para contar e avisar ("2 números saíram por falta de fonte").
 */
export function dadosSemFonte(brutoDoMercado: unknown): string[] {
  const o = (brutoDoMercado && typeof brutoDoMercado === "object" ? brutoDoMercado : {}) as Record<string, unknown>;
  const saida: string[] = [];
  for (const x of Array.isArray(o.dados) ? o.dados : []) {
    const d = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    if (textoLimpo(d.valor, 60) && !fonteValida(d.fonte)) saida.push(`${textoLimpo(d.rotulo, 120)} ${textoLimpo(d.valor, 60)}`.trim());
  }
  for (const x of Array.isArray(o.concorrentes) ? o.concorrentes : []) {
    const c = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    if (textoLimpo(c.nome, 80) && !fonteValida(c.fonte)) saida.push(`Concorrente sem fonte: ${textoLimpo(c.nome, 80)}`);
  }
  const f = o.faixa_de_preco && typeof o.faixa_de_preco === "object" ? (o.faixa_de_preco as Record<string, unknown>) : null;
  if (f && textoLimpo(f.texto, 200) && !fonteValida(f.fonte)) saida.push(`Faixa de preço sem fonte: ${textoLimpo(f.texto, 200)}`);
  return saida;
}

// ------------------------------------------------------------------ pendências

export type PropostaParaConferir = {
  conteudo: ConteudoDaProposta;
  itens: ItemDaProposta[];
  validade_ate: string | null;
  contexto: { notas?: string; transcricao?: string; materiais?: Array<{ nome: string }> } | null;
};

export type Pendencia = { chave: string; texto: string; bloqueia: boolean };

/** O que falta antes de enviar. `bloqueia`: o Envio não libera sem isso. */
export function pendenciasDaProposta(p: PropostaParaConferir, hoje: string): Pendencia[] {
  const saida: Pendencia[] = [];
  const ctx = p.contexto || {};
  const capa = blocoDoTipo(p.conteudo, "capa");
  const desafio = blocoDoTipo(p.conteudo, "desafio");
  const mercado = blocoDoTipo(p.conteudo, "mercado");
  const provas = blocoDoTipo(p.conteudo, "provas");
  if (!p.itens.length) saida.push({ chave: "itens", texto: "Faltam os itens e os valores do investimento.", bloqueia: true });
  if (!p.validade_ate) saida.push({ chave: "validade", texto: "Falta a validade da proposta.", bloqueia: true });
  else if (validadeVencida(p.validade_ate, hoje)) saida.push({ chave: "validade", texto: "A validade já passou. Escolha uma data nova.", bloqueia: true });
  if (!capa.dados.headline) saida.push({ chave: "headline", texto: "A capa está sem headline.", bloqueia: true });
  if (!(ctx.notas || "").trim() && !(ctx.transcricao || "").trim() && !(ctx.materiais || []).length) {
    saida.push({ chave: "reuniao", texto: "Sem notas nem transcrição da reunião: o desafio fica genérico.", bloqueia: false });
  }
  if (desafio.visivel && !desafio.dados.texto) saida.push({ chave: "desafio", texto: "O desafio está vazio.", bloqueia: false });
  if (mercado.visivel && !mercado.dados.dados.length && !mercado.dados.concorrentes.length) {
    saida.push({ chave: "mercado", texto: "O mercado está sem dado com fonte. Peça a pesquisa ou oculte o bloco.", bloqueia: false });
  }
  if (provas.visivel && !provas.dados.cases.length && !provas.dados.depoimentos.length) {
    saida.push({ chave: "provas", texto: "Sem case real cadastrado: o bloco de provas fica de fora.", bloqueia: false });
  }
  return saida;
}

// ------------------------------------------------------------------ envio

export function mensagemDoWhatsApp(p: { contato: string; titulo: string; link: string; validade: string | null }): string {
  const primeiro = textoLimpo(p.contato, 80).split(" ")[0] || "";
  const oi = primeiro ? `Oi, ${primeiro}. Tudo bem?` : "Oi. Tudo bem?";
  const validade = p.validade ? ` Ela vale até ${dataCurta(p.validade)}.` : "";
  return `${oi} Segue a proposta da Aceleriq para ${textoLimpo(p.titulo, 120)}: ${p.link}${validade} Qualquer dúvida, me chama por aqui.`;
}

export function assuntoDoEmail(p: { titulo: string; numero: string }): string {
  return `Proposta Aceleriq ${textoLimpo(p.numero, 20)}: ${textoLimpo(p.titulo, 120)}`.replace(/[\r\n]+/g, " ");
}

export function textoDoEmail(p: { contato: string; titulo: string; link: string; validade: string | null }): string {
  const primeiro = textoLimpo(p.contato, 80).split(" ")[0] || "";
  return [
    primeiro ? `Olá, ${primeiro}.` : "Olá.",
    "",
    `Preparamos a proposta para ${textoLimpo(p.titulo, 120)}. Ela abre no celular e no computador:`,
    p.link,
    "",
    p.validade ? `A proposta vale até ${dataCurta(p.validade)}. Para seguir, é só clicar em Aceitar no fim da página.` : "Para seguir, é só clicar em Aceitar no fim da página.",
    "",
    "Equipe Aceleriq",
  ].join("\n");
}

/** Resumo de uma linha para o evento de envio (gancho do documento de entrega). */
export function resumoDaProposta(p: { numero: string; titulo: string; itens: ItemDaProposta[]; validade_ate: string | null }): string {
  return `Proposta ${p.numero} (${textoLimpo(p.titulo, 120)}): ${textoDoTotal(totaisDosItens(p.itens))}, válida até ${dataCurta(p.validade_ate) || "sem data"}.`;
}

/** JSON estável (chaves em ordem) para o hash do que foi enviado. */
export function jsonEstavel(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return `[${v.map(jsonEstavel).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().filter((k) => o[k] !== undefined).map((k) => `${JSON.stringify(k)}:${jsonEstavel(o[k])}`).join(",")}}`;
}

/**
 * SHA-256 do conteúdo, dos itens e da validade (o aceite vale para este texto).
 * Frente PRO2: pacotes, pagamento e anexos entram só quando existem, e a
 * proposta antiga continua com o mesmo hash.
 */
export async function hashDaProposta(p: { conteudo: ConteudoDaProposta; itens: ItemDaProposta[]; validade_ate: string | null; pacotes?: unknown; pagamento?: unknown; anexos?: unknown }): Promise<string> {
  const cheio = (v: unknown) => (Array.isArray(v) ? v.length > 0 : !!v && typeof v === "object" && Object.keys(v as Record<string, unknown>).length > 0);
  const base: Record<string, unknown> = { conteudo: p.conteudo, itens: p.itens, validade_ate: p.validade_ate };
  if (cheio(p.pacotes)) base.pacotes = p.pacotes;
  if (cheio(p.pagamento)) base.pagamento = p.pagamento;
  if (cheio(p.anexos)) base.anexos = p.anexos;
  const bytes = new TextEncoder().encode(jsonEstavel(base));
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ------------------------------------------------------------------ geração pelo agente

const FONTE_ESQ = { type: "object", additionalProperties: false, required: ["titulo", "url", "data"], properties: { titulo: { type: "string" }, url: { type: "string" }, data: { type: "string" } } };
const TT_ESQ = { type: "array", items: { type: "object", additionalProperties: false, required: ["titulo", "texto"], properties: { titulo: { type: "string" }, texto: { type: "string" } } } };
const LISTA = { type: "array", items: { type: "string" } };

/**
 * Esquema da geração (json_schema estrito). Provas e quem somos não entram:
 * vêm dos dados da agência, nunca do modelo. O preço também não: sai dos itens.
 */
export const ESQUEMA_DA_GERACAO = {
  nome: "proposta_comercial_aceleriq",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["capa", "desafio", "diagnostico", "mercado", "solucao", "entregaveis", "processo", "cronograma", "investimento", "proximos_passos", "perguntas", "resumo"],
    properties: {
      capa: { type: "object", additionalProperties: false, required: ["headline", "subtitulo", "projeto"], properties: { headline: { type: "string" }, subtitulo: { type: "string" }, projeto: { type: "string" } } },
      desafio: { type: "object", additionalProperties: false, required: ["texto", "palavras_do_cliente", "compromisso"], properties: { texto: { type: "string" }, palavras_do_cliente: LISTA, compromisso: { type: "string" } } },
      diagnostico: {
        type: "object",
        additionalProperties: false,
        required: ["achados"],
        properties: { achados: { type: "array", items: { type: "object", additionalProperties: false, required: ["titulo", "texto", "fonte"], properties: { titulo: { type: "string" }, texto: { type: "string" }, fonte: { anyOf: [FONTE_ESQ, { type: "null" }] } } } } },
      },
      mercado: {
        type: "object",
        additionalProperties: false,
        required: ["resumo", "concorrentes", "dados", "faixa_de_preco"],
        properties: {
          resumo: { type: "string" },
          concorrentes: { type: "array", items: { type: "object", additionalProperties: false, required: ["nome", "faz_bem", "oportunidade", "fonte"], properties: { nome: { type: "string" }, faz_bem: { type: "string" }, oportunidade: { type: "string" }, fonte: FONTE_ESQ } } },
          dados: { type: "array", items: { type: "object", additionalProperties: false, required: ["rotulo", "valor", "fonte", "trecho"], properties: { rotulo: { type: "string" }, valor: { type: "string" }, fonte: FONTE_ESQ, trecho: { type: "string" } } } },
          faixa_de_preco: { anyOf: [{ type: "object", additionalProperties: false, required: ["texto", "fonte"], properties: { texto: { type: "string" }, fonte: FONTE_ESQ } }, { type: "null" }] },
        },
      },
      solucao: { type: "object", additionalProperties: false, required: ["texto", "frentes"], properties: { texto: { type: "string" }, frentes: TT_ESQ } },
      entregaveis: { type: "object", additionalProperties: false, required: ["itens", "nao_inclui"], properties: { itens: { type: "array", items: { type: "object", additionalProperties: false, required: ["nome", "detalhe"], properties: { nome: { type: "string" }, detalhe: { type: "string" } } } }, nao_inclui: LISTA } },
      processo: { type: "object", additionalProperties: false, required: ["etapas"], properties: { etapas: TT_ESQ } },
      cronograma: { type: "object", additionalProperties: false, required: ["marcos", "observacao"], properties: { marcos: { type: "array", items: { type: "object", additionalProperties: false, required: ["titulo", "quando"], properties: { titulo: { type: "string" }, quando: { type: "string" } } } }, observacao: { type: "string" } } },
      investimento: { type: "object", additionalProperties: false, required: ["intangiveis", "condicoes", "observacao"], properties: { intangiveis: LISTA, condicoes: { type: "string" }, observacao: { type: "string" } } },
      proximos_passos: { type: "object", additionalProperties: false, required: ["passos", "chamada"], properties: { passos: LISTA, chamada: { type: "string" } } },
      perguntas: LISTA,
      resumo: { type: "string" },
    },
  },
} as const;

/** Blocos que a geração escreve (provas e quem somos ficam com os dados da agência). */
export const BLOCOS_DA_GERACAO: TipoDeBloco[] = ["capa", "desafio", "diagnostico", "mercado", "solucao", "entregaveis", "processo", "cronograma", "investimento", "proximos_passos"];

export type ResultadoDaGeracao = {
  conteudo: ConteudoDaProposta;
  /** Frases e dados que saíram por número sem fonte (viram pendência). */
  tiradas: string[];
  /** O que o agente precisa saber (perguntas dele + as frases tiradas). */
  perguntas: string[];
  resumo: string;
};

/**
 * Junta o que o modelo escreveu ao conteúdo atual: só os blocos da geração
 * (`somente` restringe, ex.: ["mercado"] na pesquisa), mantendo título e
 * visível de cada bloco, e passa a régua do número sem fonte.
 */
export function aplicarGeracao(atual: ConteudoDaProposta, bruto: unknown, origem: string, opcoes: { somente?: TipoDeBloco[]; hoje?: string } = {}): ResultadoDaGeracao {
  const o = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const alvo = (opcoes.somente && opcoes.somente.length ? opcoes.somente : BLOCOS_DA_GERACAO).filter((t) => BLOCOS_DA_GERACAO.indexOf(t) >= 0);
  const semFonte = alvo.indexOf("mercado") >= 0 ? dadosSemFonte(o.mercado) : [];
  let conteudo = atual;
  for (const tipo of alvo) {
    if (!o[tipo] || typeof o[tipo] !== "object") continue;
    const antes = blocoDoTipo(conteudo, tipo);
    let dados = normalizarDados(tipo, o[tipo]);
    if (tipo === "mercado") dados = { ...(dados as DadosDoBloco["mercado"]), pesquisado_em: opcoes.hoje || null } as typeof dados;
    // Condição de pagamento vazia: fica a do modelo (a do dono), não um branco.
    if (tipo === "investimento" && !(dados as DadosDoBloco["investimento"]).condicoes) {
      dados = { ...(dados as DadosDoBloco["investimento"]), condicoes: (antes.dados as DadosDoBloco["investimento"]).condicoes } as typeof dados;
    }
    conteudo = comBloco(conteudo, tipo, { dados });
  }
  const regua = conteudoSemNumeroInventado(conteudo, origem);
  const tiradas = semFonte.concat(regua.tiradas);
  const perguntas = listaDeTextos(o.perguntas, 300, 8).concat(tiradas.slice(0, 6).map((t) => `Confirme ou mande a fonte deste número: "${t.slice(0, 160)}"`));
  return { conteudo: regua.conteudo, tiradas, perguntas, resumo: textoLimpo(o.resumo, 600) };
}
