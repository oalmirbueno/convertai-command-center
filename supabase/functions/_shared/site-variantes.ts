/**
 * Variantes das seções da Mesa Site a partir dos padrões de landing da base
 * UI UX Pro Max 2.15.0 (frente UXM, 30/09/2026). O mapa continua com as 25
 * seções da biblioteca; a variante diz a ordem interna e onde fica o CTA. O
 * texto do `padrao` é NOSSO, escrito a partir da ordem, do CTA e da
 * otimização de conversão de cada padrão (a origem fica em `origem`).
 *
 * "Aplicar a ordem do padrão" (mapaDoPadrao) insere na página inicial as
 * seções do padrão pela ordem canônica e liga as variantes; seção que só vale
 * com dado real fica de fora (a equipe acrescenta quando tiver o dado).
 *
 * Puro, sem Deno, sem banco e sem os dados da base (a ordem do padrão entra
 * como parâmetro). Sem travessão.
 */

import { adicionarSecaoNoMapa, type MapaDoSite, secaoDaBiblioteca } from "./site-biblioteca.ts";
import { secoesDaOrdem } from "./uiux/mapeamentos.ts";

export type Variante = { id: string; rotulo: string; padrao: string; cta?: string; origem: string };

const uupm = (id: string) => `uupm:landing:${id}`;

/** As variantes por seção da biblioteca (id da variante = id do padrão de origem, ou "casa-..."). */
export const VARIANTES_DAS_SECOES: Record<string, Variante[]> = {
  hero: [
    { id: "hero-centric-design", rotulo: "Hero dominante", padrao: "O hero ocupa a primeira tela com título, imagem e um só CTA; deixe uma pista da seção seguinte à vista.", cta: "no centro ou embaixo do hero, repetido no menu", origem: uupm("hero-centric-design") },
    { id: "video-first-hero", rotulo: "Vídeo primeiro", padrao: "Vídeo de fundo curto e comprimido, com legenda, botão de pausa e imagem parada no movimento reduzido.", cta: "sobre o vídeo e de novo no fim da seção", origem: uupm("video-first-hero") },
    { id: "product-demo-features", rotulo: "Demo do produto", padrao: "O produto no centro (print, vídeo ou maquete) com controles visíveis; recursos quebrados logo abaixo.", cta: "ao lado ou abaixo da demonstração", origem: uupm("product-demo-features") },
    { id: "waitlist-coming-soon", rotulo: "Lista de espera", padrao: "Chamada de lançamento com prévia e o campo de e-mail acima da dobra; data em texto, sem escassez inventada.", cta: "o formulário do e-mail, no topo", origem: uupm("waitlist-coming-soon") },
    { id: "trust-authority-conversion", rotulo: "Autoridade e prova", padrao: "Título com a missão ou a credencial real, selos e números só com fonte, caminho claro para o contato.", cta: "Fale com a equipe ou Peça orçamento", origem: uupm("trust-authority-conversion") },
  ],
  servicos: [
    { id: "hero-features-cta", rotulo: "Grade de recursos", padrao: "De 3 a 5 serviços com uma frase de resultado cada, e o CTA logo depois da grade.", cta: "depois da grade", origem: uupm("hero-features-cta") },
    { id: "feature-rich-showcase", rotulo: "Recursos em cartões", padrao: "De 4 a 6 cartões, uma mensagem por cartão, hierarquia clara e o CTA repetido.", cta: "depois dos cartões", origem: uupm("feature-rich-showcase") },
  ],
  bento: [
    { id: "bento-grid-showcase", rotulo: "Vitrine bento", padrao: "Grade bento com os benefícios, cartões que funcionam sem passar o mouse e empilham no celular.", cta: "no pé da grade", origem: uupm("bento-grid-showcase") },
    { id: "feature-rich-showcase", rotulo: "Recursos em cartões", padrao: "Cartões do mesmo tamanho, uma mensagem por cartão, sem animação que atrapalhe a leitura.", origem: uupm("feature-rich-showcase") },
  ],
  prova: [
    { id: "trust-authority-conversion", rotulo: "Selos e credenciais", padrao: "Selos, certificações e garantias reais; faixa de logos com pausa e parada no movimento reduzido.", origem: uupm("trust-authority-conversion") },
    { id: "community-forum-landing", rotulo: "Comunidade", padrao: "O valor da comunidade com números só quando atuais e com fonte; sem contador inventado.", origem: uupm("community-forum-landing") },
  ],
  depoimentos: [
    { id: "hero-testimonials-cta", rotulo: "Carrossel de depoimentos", padrao: "Poucos depoimentos reais com nome e contexto; carrossel com anterior, próximo e pausar, e o CTA logo depois.", cta: "depois dos depoimentos", origem: uupm("hero-testimonials-cta") },
    { id: "product-review-ratings-focused", rotulo: "Avaliações", padrao: "Resumo das avaliações reais e a lista abaixo; nota só se for verificada e atual.", cta: "ao lado do resumo", origem: uupm("product-review-ratings-focused") },
  ],
  pricing: [
    { id: "pricing-page-cta", rotulo: "Tabela com CTA", padrao: "Planos lado a lado com o do público destacado, comparação de itens e perguntas embaixo; preço só das fontes.", cta: "um por plano", origem: uupm("pricing-page-cta") },
    { id: "comparison-table-cta", rotulo: "Comparativo", padrao: "Tabela da marca contra as alternativas, com a linha da marca destacada e dados verificáveis.", cta: "abaixo da tabela", origem: uupm("comparison-table-cta") },
    { id: "pricing-focused-landing", rotulo: "Três planos", padrao: "Três planos com totais mensal e anual transparentes e as objeções respondidas.", cta: "em cada plano e no fim", origem: uupm("pricing-focused-landing") },
  ],
  portfolio: [
    { id: "portfolio-grid", rotulo: "Grade de portfólio", padrao: "Trabalhos em grade (alvenaria), filtro por categoria e carregamento rápido; a imagem manda.", cta: "no cartão e no contato do rodapé", origem: uupm("portfolio-grid") },
    { id: "horizontal-scroll-journey", rotulo: "Rolagem horizontal", padrao: "Trilha horizontal com alternativa vertical; nada de prender a rolagem no movimento reduzido.", cta: "no fim da trilha", origem: uupm("horizontal-scroll-journey") },
  ],
  galeria: [
    { id: "portfolio-grid", rotulo: "Grade", padrao: "Grade em alvenaria com legenda curta e visualização em tela cheia acessível.", origem: uupm("portfolio-grid") },
    { id: "horizontal-scroll-journey", rotulo: "Rolagem horizontal", padrao: "Fotos em trilha horizontal com botões e teclado; vertical no movimento reduzido.", origem: uupm("horizontal-scroll-journey") },
  ],
  antes_depois: [
    { id: "before-after-transformation", rotulo: "Antes e depois", padrao: "Comparador com arrastar, botões e teclado; o problema antes, a transformação no meio, o resultado real depois.", cta: "depois da revelação", origem: uupm("before-after-transformation") },
  ],
  chamada: [
    { id: "lead-magnet-form", rotulo: "Isca e formulário", padrao: "Prévia do material gratuito e um formulário curto só com o necessário.", cta: "o botão de enviar", origem: uupm("lead-magnet-form") },
    { id: "funnel-3-step-conversion", rotulo: "Funil de 3 passos", padrao: "Problema, solução e ação em três passos curtos, com um CTA pequeno em cada e o principal no fim.", cta: "um por passo e o principal no fim", origem: uupm("funnel-3-step-conversion") },
  ],
  contato: [
    { id: "lead-magnet-form", rotulo: "Formulário curto", padrao: "Só os campos necessários, com rótulo, tipo certo e mensagem de envio.", cta: "o botão de enviar", origem: uupm("lead-magnet-form") },
  ],
  faq: [
    { id: "faq-documentation-landing", rotulo: "Perguntas e documentação", padrao: "Perguntas por categoria em acordeão e, no fim, o caminho para falar com alguém.", cta: "contato para o que ficou sem resposta", origem: uupm("faq-documentation-landing") },
  ],
  processo: [
    { id: "scroll-triggered-storytelling", rotulo: "História em capítulos", padrao: "Problema, jornada e solução em capítulos, entendidos mesmo sem efeito de rolagem.", cta: "pequeno no fim de cada capítulo", origem: uupm("scroll-triggered-storytelling") },
    { id: "funnel-3-step-conversion", rotulo: "Três passos", padrao: "Três passos numerados com indicador de progresso.", origem: uupm("funnel-3-step-conversion") },
  ],
  diferenciais: [
    { id: "comparison-table-focus", rotulo: "Comparativo com alternativas", padrao: "Matriz da marca contra as alternativas, factual, com a linha da marca destacada.", cta: "depois da tabela", origem: uupm("comparison-table-focus") },
  ],
  numeros: [
    { id: "casa-grafico", rotulo: "Com gráfico", padrao: "Os números grandes e, quando o pacote traz uma série real com fonte, o gráfico de src/lib/Grafico.tsx com a tabela para leitor de tela.", origem: "casa" },
    { id: "real-time-operations-landing", rotulo: "Indicadores", padrao: "Indicadores com a data da atualização; nada de chamar de ao vivo sem fonte ao vivo.", origem: uupm("real-time-operations-landing") },
  ],
};

export const variantesDaSecao = (tipo: string): Variante[] => VARIANTES_DAS_SECOES[tipo] || [];
export const varianteDaSecao = (tipo: string, id: unknown): Variante | null => variantesDaSecao(tipo).filter((v) => v.id === id)[0] || null;

/** Todas as origens da base usadas pelas variantes (o teste confere que existem em PADROES_DA_BASE). */
export function origensDaBase(): string[] {
  const s: string[] = [];
  Object.keys(VARIANTES_DAS_SECOES).forEach((k) => VARIANTES_DAS_SECOES[k].forEach((v) => v.origem.indexOf("uupm:landing:") === 0 && s.indexOf(v.origem) < 0 && s.push(v.origem)));
  return s;
}

/** Tira do mapa as variantes que não existem para o tipo da seção. */
export function limparVariantes(m: MapaDoSite): MapaDoSite {
  return {
    ...m,
    paginas: m.paginas.map((p) => ({
      ...p,
      secoes: p.secoes.map((s) => {
        if (!s.variante || varianteDaSecao(s.tipo, s.variante)) return s;
        const { variante: _fora, ...resto } = s;
        return resto;
      }),
    })),
  };
}

/**
 * Aplica a ordem de um padrão ao mapa: na página inicial, as seções do padrão
 * que faltam entram pela ordem canônica; as seções do padrão ganham a
 * variante dele quando ela existe. Seção "só real" não entra (fica listada).
 */
export function mapaDoPadrao(m: MapaDoSite, padrao: { id: string; ordem: string }): { mapa: MapaDoSite; entraram: string[]; so_real: string[]; sem_equivalente: string[] } {
  const { secoes, sem_equivalente } = secoesDaOrdem(padrao.ordem);
  const inicio = m.paginas[0];
  if (!inicio) return { mapa: m, entraram: [], so_real: [], sem_equivalente };
  let mapa = m;
  const entraram: string[] = [];
  const soReal: string[] = [];
  for (const tipo of secoes) {
    const lib = secaoDaBiblioteca(tipo);
    if (!lib || lib.global) continue;
    if (lib.so_real) {
      if (!mapa.paginas[0].secoes.some((s) => s.tipo === tipo)) soReal.push(tipo);
      continue;
    }
    if (mapa.paginas[0].secoes.some((s) => s.tipo === tipo)) continue;
    const antes = mapa.paginas[0].secoes.length;
    mapa = adicionarSecaoNoMapa(mapa, inicio.id, tipo);
    if (mapa.paginas[0].secoes.length > antes) entraram.push(tipo);
  }
  mapa = {
    ...mapa,
    fonte: "manual",
    paginas: mapa.paginas.map((p, i) =>
      i !== 0
        ? p
        : {
            ...p,
            secoes: p.secoes.map((s) => (secoes.indexOf(s.tipo) >= 0 && varianteDaSecao(s.tipo, padrao.id) ? { ...s, variante: padrao.id } : s)),
          },
    ),
  };
  return { mapa, entraram, so_real: soReal, sem_equivalente };
}

/** As variantes do mapa, por uid, com o texto (vai ao pacote e ao promptDaSecao). */
export function variantesDoMapa(m: MapaDoSite): Record<string, Variante> {
  const saida: Record<string, Variante> = {};
  m.paginas.forEach((p) =>
    p.secoes.forEach((s) => {
      const v = s.variante ? varianteDaSecao(s.tipo, s.variante) : null;
      if (v) saida[s.uid] = v;
    }),
  );
  return saida;
}
