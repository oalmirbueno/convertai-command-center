/**
 * Conhecimento de conteúdo do estrategista (pedido do dono em 25/09): os tipos
 * de conteúdo, os frameworks de copy e a base de técnica que o calendário do
 * mês, o conteúdo rápido e a campanha seguem. Lógica pura, sem rede e sem
 * banco: o agente-calendario monta os prompts com estas peças e a tela usa os
 * mesmos ids (src/components/mesa/MesConhecimento.ts, conferido em teste).
 *
 * Regra de ouro: o tipo diz PARA QUE o conteúdo existe; o framework diz COMO
 * a mensagem anda. Carrossel distribui o framework pelas lâminas; estático
 * comprime tudo em uma mensagem com um CTA único e claro.
 */

export type Formato = "carrossel" | "estatico";

export type TipoDeConteudo = {
  id: string;
  nome: string;
  /** Quando escolher este tipo. */
  quando: string;
  /** Como fazer bem, em uma frase. */
  como: string;
  /** Formato que costuma servir melhor. */
  formato: Formato;
  /** CTA típico (sempre um só). */
  cta: string;
};

export type Framework = {
  id: string;
  nome: string;
  quando: string;
  /** Passos do framework, em ordem. No carrossel viram lâminas. */
  passos: string[];
  /** Como o framework cabe num post estático (uma mensagem só). */
  estatico: string;
};

/** Valor da escolha "o agente escolhe e mescla" (tela e servidor). */
export const AGENTE_ESCOLHE = "auto";

export const TIPOS_DE_CONTEUDO: TipoDeConteudo[] = [
  {
    id: "storytelling",
    nome: "Storytelling contínuo",
    quando: "Para gerar identificação e fazer o público voltar: uma personagem (cliente real, persona ou a equipe) vive uma situação do nicho ao longo de vários posts.",
    como: "Mesma personagem, mesmo cenário e mesma voz em todos os posts da série; cada capítulo abre com a tensão do anterior e fecha com um gancho para o próximo.",
    formato: "carrossel",
    cta: "Salvar para acompanhar a história ou comentar o que a personagem deve fazer.",
  },
  {
    id: "educativo",
    nome: "Educativo (conteúdo de valor)",
    quando: "Para ganhar autoridade e salvamentos: responde uma dúvida real do público com informação aplicável.",
    como: "Uma dúvida por post, resposta concreta com exemplo do nicho; nada que serviria para qualquer empresa.",
    formato: "carrossel",
    cta: "Salvar para consultar depois ou mandar para quem precisa.",
  },
  {
    id: "conscientizacao",
    nome: "Conscientização",
    quando: "Para o público perceber um problema que ainda não enxerga (topo de funil) e ligar esse problema à marca.",
    como: "Mostra o custo de ignorar o problema com um cenário reconhecível, sem assustar nem prometer milagre.",
    formato: "carrossel",
    cta: "Compartilhar com alguém que passa por isso.",
  },
  {
    id: "venda",
    nome: "Venda",
    quando: "Para converter quem já conhece: oferta, produto em foco, condição ou benefício concreto.",
    como: "Benefício antes da característica, prova real, oferta clara e um único caminho de compra.",
    formato: "estatico",
    cta: "Chamar no WhatsApp, pedir pelo link ou visitar a loja (um só).",
  },
  {
    id: "engajamento",
    nome: "Engajamento",
    quando: "Para conversa e alcance: enquete, escolha, opinião, identificação rápida.",
    como: "Pergunta fácil de responder em uma palavra, ligada ao nicho; nada de pergunta genérica.",
    formato: "carrossel",
    cta: "Comentar a resposta (A ou B, número, palavra).",
  },
  {
    id: "serie",
    nome: "Série que se complementa",
    quando: "Para um assunto grande demais para um post: partes numeradas que se citam e fazem o público ver as outras.",
    como: "Cada parte resolve um pedaço sozinha e aponta a próxima; o nome da série se repete igual na capa.",
    formato: "carrossel",
    cta: "Salvar a série e ver a parte seguinte no perfil.",
  },
  {
    id: "aviso",
    nome: "Aviso ou novidade",
    quando: "Para comunicar algo importante: horário, lançamento, chegada de produto, evento, mudança.",
    como: "A informação em primeiro lugar, em letra grande; data, local ou condição sem ambiguidade.",
    formato: "estatico",
    cta: "Uma ação direta ligada ao aviso (agendar, garantir, passar na loja).",
  },
  {
    id: "tutorial",
    nome: "Tutorial",
    quando: "Para ensinar a fazer algo com o produto ou serviço, ou resolver um problema passo a passo.",
    como: "Passos numerados, um por lâmina, com o resultado mostrado no fim; linguagem de quem faz.",
    formato: "carrossel",
    cta: "Salvar o passo a passo.",
  },
  {
    id: "prova_social",
    nome: "Prova social",
    quando: "Para quebrar a desconfiança: depoimento, avaliação, resultado de cliente, bastidor real.",
    como: "Só prova real do contexto (fala transcrita como está, número real); sem prova real, não inventa.",
    formato: "estatico",
    cta: "Conhecer a oferta ou chamar para ter o mesmo resultado.",
  },
];

export const FRAMEWORKS: Framework[] = [
  {
    id: "aida",
    nome: "AIDA",
    quando: "Oferta, lançamento e aviso com ação: leva de chamar a atenção até o pedido.",
    passos: ["Atenção: o gancho que para a rolagem", "Interesse: o dado ou a situação que faz ler", "Desejo: o benefício concreto e a prova", "Ação: o CTA único"],
    estatico: "Título de atenção, uma linha de desejo com o benefício e o CTA em destaque.",
  },
  {
    id: "pas",
    nome: "PAS (Problema, Agitação, Solução)",
    quando: "Dor clara do público: conscientização e venda consultiva.",
    passos: ["Problema: nomeia a dor com as palavras do público", "Agitação: o custo de continuar assim", "Solução: como a marca resolve", "CTA para a solução"],
    estatico: "A dor no título, a solução em uma frase e o CTA.",
  },
  {
    id: "bab",
    nome: "BAB (Antes, Depois, Ponte)",
    quando: "Transformação visível: resultado, rotina, estética, organização.",
    passos: ["Antes: a situação de hoje", "Depois: como fica resolvido", "Ponte: o que leva de um ao outro (produto ou serviço)", "CTA para atravessar a ponte"],
    estatico: "Antes e depois lado a lado ou em duas linhas, a ponte e o CTA.",
  },
  {
    id: "4ps",
    nome: "4Ps (Promessa, Retrato, Prova, Proposta)",
    quando: "Venda com promessa forte que precisa de prova.",
    passos: ["Promessa: o ganho principal", "Retrato: a cena do público já com o ganho", "Prova: depoimento, número ou garantia real", "Proposta: a oferta e o CTA"],
    estatico: "Promessa no título, prova curta e a proposta com o CTA.",
  },
  {
    id: "fab",
    nome: "FAB (Característica, Vantagem, Benefício)",
    quando: "Produto em foco com diferenciais técnicos que o público não traduz sozinho.",
    passos: ["Característica: o que o produto tem", "Vantagem: o que isso faz melhor", "Benefício: o que muda na vida do cliente", "CTA"],
    estatico: "O benefício no título e a característica como apoio, com o CTA.",
  },
  {
    id: "hook_story_offer",
    nome: "Gancho, História, Oferta",
    quando: "Storytelling com venda no fim: case, bastidor, história de cliente.",
    passos: ["Gancho: a frase que abre a tensão", "História: a personagem, o conflito e a virada", "Oferta: o que o público leva disso", "CTA"],
    estatico: "O gancho no título, a virada em uma frase e a oferta com o CTA.",
  },
  {
    id: "lista",
    nome: "Lista",
    quando: "Conteúdo salvável: dicas, erros, motivos, checklist.",
    passos: ["Capa com o número e a promessa", "Um item por lâmina, com o porquê", "Resumo ou item bônus", "CTA de salvar ou compartilhar"],
    estatico: "Título com o número e até 3 itens curtos, com o CTA.",
  },
  {
    id: "antes_depois",
    nome: "Antes e depois",
    quando: "Resultado real que se mostra: reforma, estética, organização, uso do produto.",
    passos: ["Capa com o resultado", "Como estava", "O que foi feito", "Como ficou e o CTA"],
    estatico: "As duas imagens com uma legenda curta e o CTA.",
  },
  {
    id: "mito_verdade",
    nome: "Mito ou verdade",
    quando: "Quebrar objeção ou crença errada do nicho.",
    passos: ["Capa com a crença", "Mito ou verdade, um por lâmina, com a explicação", "O que fazer então", "CTA"],
    estatico: "A crença, o veredito grande (mito ou verdade) e o CTA.",
  },
  {
    id: "passo_a_passo",
    nome: "Passo a passo",
    quando: "Tutorial e processo: como fazer, como funciona, como contratar.",
    passos: ["Capa com o resultado final", "Passo 1, passo 2, passo 3 (um por lâmina)", "O resultado", "CTA"],
    estatico: "Título com o resultado e os passos em 3 linhas curtas, com o CTA.",
  },
];

const ID_TIPO = new Set(TIPOS_DE_CONTEUDO.map((t) => t.id));
const ID_FRAMEWORK = new Set(FRAMEWORKS.map((f) => f.id));

export const IDS_DOS_TIPOS = TIPOS_DE_CONTEUDO.map((t) => t.id);
export const IDS_DOS_FRAMEWORKS = FRAMEWORKS.map((f) => f.id);

/** Id de tipo conhecido ou "" (o modelo às vezes escreve o nome). */
export function normalizarTipo(v: unknown): string {
  const s = String(v ?? "").trim().toLowerCase();
  if (ID_TIPO.has(s)) return s;
  const achado = TIPOS_DE_CONTEUDO.find((t) => t.nome.toLowerCase() === s);
  return achado ? achado.id : "";
}

/** Id de framework conhecido ou "". */
export function normalizarFramework(v: unknown): string {
  const s = String(v ?? "").trim().toLowerCase();
  if (ID_FRAMEWORK.has(s)) return s;
  const achado = FRAMEWORKS.find((f) => f.nome.toLowerCase() === s || f.nome.toLowerCase().indexOf(`${s} `) === 0);
  return achado ? achado.id : "";
}

export const tipoPorId = (id: string) => TIPOS_DE_CONTEUDO.find((t) => t.id === id) ?? null;
export const frameworkPorId = (id: string) => FRAMEWORKS.find((f) => f.id === id) ?? null;

/** O que a equipe escolheu na tela: listas de ids (vazias = o agente escolhe e mescla). */
export type EscolhaEditorial = { tipos: string[]; frameworks: string[] };

export function lerEscolhaEditorial(corpo: { tipos?: unknown; frameworks?: unknown } | null | undefined): EscolhaEditorial {
  const lista = (v: unknown, ok: (s: string) => string) =>
    (Array.isArray(v) ? v : typeof v === "string" && v ? [v] : [])
      .map((x) => ok(x))
      .filter((x, i, l) => x && l.indexOf(x) === i)
      .slice(0, 9);
  return { tipos: lista(corpo?.tipos, normalizarTipo), frameworks: lista(corpo?.frameworks, normalizarFramework) };
}

export const escolhaVazia = (e: EscolhaEditorial) => e.tipos.length === 0 && e.frameworks.length === 0;

// ------------------------------------------------------------ regras de formato

export const REGRA_DO_CARROSSEL =
  "Carrossel: uma ideia principal; a capa é o gancho (promessa específica, número, pergunta ou tensão, em até 8 palavras); cada lâmina cumpre um passo do framework e prepara a próxima com texto corrido e conectivos; no máximo 30 palavras por lâmina interna; a última lâmina fecha com UM CTA ligado ao objetivo. Pode mesclar dois frameworks quando um serve à abertura e outro ao fechamento (ex.: PAS na abertura e AIDA no fechamento), sem perder a linha única.";

export const REGRA_DO_ESTATICO =
  "Post estático: mais direto e intuitivo; UMA mensagem só (aviso importante, oferta, prova ou novidade), título de até 8 palavras que se entende em 2 segundos, no máximo uma linha de apoio e UM CTA claro que não confunde (um verbo, um canal). Nada de lista longa, dois CTAs ou texto pequeno.";

/**
 * Base de técnica do estrategista, somada ao prompt geral do cliente (que
 * continua valendo inteiro). Curta de propósito: o prompt pesa no tempo.
 */
export const BASE_DO_ESTRATEGISTA = `BASE DE TÉCNICA DO ESTRATEGISTA (soma ao prompt acima; nenhuma regra acima sai):
- Tipos de conteúdo: storytelling contínuo (personagem que volta), educativo, conscientização, venda, engajamento, série que se complementa, aviso ou novidade, tutorial e prova social. Todo conteúdo tem UM tipo e UM framework declarados.
- Frameworks: AIDA, PAS, BAB (antes, depois, ponte), 4Ps, FAB, gancho-história-oferta, lista, antes e depois, mito ou verdade e passo a passo. O roteiro segue a estrutura do framework escolhido.
- Ganchos variados no mês (nunca o mesmo tipo em dois posts seguidos): número concreto, pergunta que o público faz, erro comum, contraste antes e depois, segredo de bastidor, mito, cena do dia a dia, dado real das métricas, prazo ou data.
- Ângulos: dor, desejo, objeção, comparação, bastidor, prova, uso do produto, região, sazonalidade. Um ângulo por post, sem repetir o mesmo ângulo na semana.
- Provas: só o que existe no contexto (depoimento, número, garantia, tempo de mercado, foto real). Sem prova real, o post não promete resultado.
- CTA: um por post, ligado ao objetivo (salvar, compartilhar, comentar, chamar no WhatsApp, visitar, comprar), escrito como ação concreta.
- ${REGRA_DO_CARROSSEL}
- ${REGRA_DO_ESTATICO}
- Mistura do mês: alterne tipos (educativo e conscientização abrem, prova e venda fecham); estático fica para aviso, oferta e prova; carrossel para ensinar, contar história e comparar.`;

// ------------------------------------------------------------ blocos de prompt

const linhaDoTipo = (t: TipoDeConteudo) => `${t.id}: ${t.nome}. ${t.quando} Como: ${t.como} Formato comum: ${t.formato}. CTA típico: ${t.cta}`;
const linhaDoFramework = (f: Framework) => `${f.id}: ${f.nome}. ${f.quando} Passos: ${f.passos.join(" > ")}. No estático: ${f.estatico}`;

/**
 * Bloco da escolha editorial para propor temas, detalhar ou criar: com a
 * escolha da equipe, só os tipos e frameworks escolhidos; sem escolha, o
 * catálogo curto e o agente escolhe e mescla.
 */
export function blocoDaEscolhaEditorial(e: EscolhaEditorial): string {
  const tipos = e.tipos.length ? TIPOS_DE_CONTEUDO.filter((t) => e.tipos.indexOf(t.id) >= 0) : TIPOS_DE_CONTEUDO;
  const frameworks = e.frameworks.length ? FRAMEWORKS.filter((f) => e.frameworks.indexOf(f.id) >= 0) : FRAMEWORKS;
  const cabeca = escolhaVazia(e)
    ? "TIPOS E FRAMEWORKS: o agente escolhe e mescla. Escolha para cada conteúdo o tipo e o framework que mais servem ao objetivo, variando no período."
    : `TIPOS E FRAMEWORKS ESCOLHIDOS PELA EQUIPE: use só ${e.tipos.length ? "estes tipos" : "qualquer tipo"} e ${e.frameworks.length ? "estes frameworks" : "qualquer framework"}, distribuindo entre eles.`;
  return [
    cabeca,
    "Tipos (tipo_editorial):",
    ...tipos.map((t) => `- ${linhaDoTipo(t)}`),
    "Frameworks (framework):",
    ...frameworks.map((f) => `- ${linhaDoFramework(f)}`),
  ].join("\n");
}

/** Estrutura de um conteúdo pelo tipo, o framework e o formato (vai no pedido de cada item). */
export function estruturaDoConteudo(tipoId: string, frameworkId: string, formato: Formato | string): string {
  const t = tipoPorId(tipoId);
  const f = frameworkPorId(frameworkId);
  const partes: string[] = [];
  if (t) partes.push(`tipo ${t.nome} (${t.como} CTA: ${t.cta})`);
  if (f) {
    partes.push(
      formato === "estatico"
        ? `framework ${f.nome} comprimido no estático: ${f.estatico}`
        : `framework ${f.nome}, lâmina a lâmina: ${f.passos.map((p, i) => `${i + 1}. ${p}`).join("; ")} (passos longos podem ocupar duas lâminas)`,
    );
  }
  if (!partes.length) return "tipo e framework: o agente escolhe o que mais serve ao tema e declara nos campos";
  return partes.join("; ");
}

/** Rótulo curto para a descrição da tarefa ("Educativo · AIDA"). */
export function rotuloEditorial(tipoId: string, frameworkId: string): string {
  const t = tipoPorId(tipoId);
  const f = frameworkPorId(frameworkId);
  return [t ? t.nome : "", f ? f.nome : ""].filter(Boolean).join(" · ");
}

// ------------------------------------------------------------ arco da campanha

export type EtapaDaCampanha = { etapa: string; objetivo: string; tipo: string; framework: string; formato: Formato };

/**
 * Etapas da campanha pela ordem de entrada: com poucos conteúdos ficam as
 * etapas que carregam a venda; com mais, entram prova, objeção e relação.
 * O resultado sai na ordem da história (aquecimento primeiro, último chamado
 * no fim), para as datas seguirem essa ordem.
 */
const ETAPAS: Array<EtapaDaCampanha & { prioridade: number; posicao: number }> = [
  { etapa: "lançamento", objetivo: "apresentar a oferta e o produto em foco", tipo: "venda", framework: "aida", formato: "estatico", prioridade: 1, posicao: 2 },
  { etapa: "último chamado", objetivo: "fechar com prazo ou condição real e um CTA direto", tipo: "aviso", framework: "aida", formato: "estatico", prioridade: 2, posicao: 8 },
  { etapa: "aquecimento", objetivo: "despertar o problema ou o desejo antes da oferta", tipo: "conscientizacao", framework: "pas", formato: "carrossel", prioridade: 3, posicao: 1 },
  { etapa: "prova", objetivo: "mostrar resultado, depoimento ou bastidor real", tipo: "prova_social", framework: "antes_depois", formato: "carrossel", prioridade: 4, posicao: 4 },
  { etapa: "objeção", objetivo: "quebrar a principal dúvida que trava a compra", tipo: "educativo", framework: "mito_verdade", formato: "carrossel", prioridade: 5, posicao: 5 },
  { etapa: "benefício", objetivo: "traduzir o produto em ganho concreto", tipo: "venda", framework: "fab", formato: "carrossel", prioridade: 6, posicao: 3 },
  { etapa: "urgência", objetivo: "lembrar a condição e o prazo", tipo: "venda", framework: "4ps", formato: "estatico", prioridade: 7, posicao: 7 },
  { etapa: "relação", objetivo: "conversa e identificação com o público da campanha", tipo: "engajamento", framework: "lista", formato: "carrossel", prioridade: 8, posicao: 6 },
];

export function arcoDaCampanha(quantidade: number): EtapaDaCampanha[] {
  const n = Math.max(1, Math.min(12, Math.round(quantidade) || 1));
  const base = ETAPAS.slice().sort((a, b) => a.prioridade - b.prioridade);
  const escolhidas: Array<EtapaDaCampanha & { posicao: number }> = [];
  for (let i = 0; i < n; i++) {
    const e = base[i % base.length];
    // Acima de 8, as etapas do meio repetem com outro framework para não copiar estrutura.
    const repeticao = Math.floor(i / base.length);
    escolhidas.push({
      etapa: repeticao ? `${e.etapa} (${repeticao + 1})` : e.etapa,
      objetivo: e.objetivo,
      tipo: e.tipo,
      framework: repeticao ? (e.framework === "aida" ? "pas" : "aida") : e.framework,
      formato: e.formato,
      posicao: e.posicao + repeticao * 0.5,
    });
  }
  return escolhidas.sort((a, b) => a.posicao - b.posicao).map(({ posicao: _p, ...e }) => e);
}
