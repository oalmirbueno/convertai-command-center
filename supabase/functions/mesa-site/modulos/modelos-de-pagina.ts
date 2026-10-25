/**
 * Galeria de modelos de página (Gravyx, 19/10/2026: "usar modelo"). Os
 * modelos moram aqui, no repositório: cada um é o tipo de site, o mapa de
 * páginas e seções (com a nota do que cada seção faz naquele modelo), um
 * estilo de partida e o objetivo que entra no briefing. "Usar modelo" cria um
 * site NOVO com isso e com a marca do cliente (cores, fontes, logo e
 * contexto vêm da marca aberta, nunca de outra); o site abre no Briefing e o
 * motor constrói pelo método da casa (Direção, Conteúdo, Imagens, Construir).
 * Pixel, Analytics e WhatsApp do modelo não existem: vêm das Integrações do
 * cliente.
 *
 * Puro: sem Deno, sem npm e sem banco (a tela lista; a função cria). Sem
 * lookbehind, classe de propriedade Unicode ou grupo nomeado.
 */
import { type MapaDoSite, normalizarMapa, presetDeEstilo, secoesDoMapa, type TipoDeSite } from "../../_shared/site-biblioteca.ts";

export type ModeloDePagina = {
  id: string;
  nome: string;
  /** Uma linha: para que serve. */
  descricao: string;
  tipo: TipoDeSite;
  /** Preset de estilo de partida (a Direção troca). */
  preset: string;
  /** O que entra no briefing (objetivo e próximo passo do visitante). */
  objetivo: string;
  acao: string;
  globais: string[];
  paginas: Array<{ id: string; slug: string; titulo: string; secoes: Array<{ tipo: string; nota: string }> }>;
};

export const MODELOS_DE_PAGINA: ModeloDePagina[] = [
  {
    id: "captura",
    nome: "Página de captura",
    descricao: "troca um material, aula ou diagnóstico pelo contato da pessoa",
    tipo: "landing",
    preset: "saas_limpo",
    objetivo: "Captar contatos (lead) em troca de um material, aula ou diagnóstico gratuito.",
    acao: "Preencher o formulário curto (nome, e-mail e WhatsApp).",
    globais: ["rodape"],
    paginas: [
      {
        id: "inicio",
        slug: "",
        titulo: "Início",
        secoes: [
          { tipo: "hero_dividido", nota: "promessa do material gratuito; o formulário logo ao lado ou abaixo, sem menu que tire a pessoa da página" },
          { tipo: "bento", nota: "o que a pessoa recebe, em 4 blocos curtos" },
          { tipo: "prova", nota: "por que confiar (método, garantia, quem faz); só dado real" },
          { tipo: "contato", nota: "formulário curto que cai no CRM; diga o que acontece depois do envio" },
          { tipo: "faq", nota: "objeções de quem hesita em deixar o contato" },
        ],
      },
    ],
  },
  {
    id: "vendas",
    nome: "Página de vendas",
    descricao: "vende uma oferta do começo ao fim: dor, solução, prova e preço",
    tipo: "landing",
    preset: "cinema_noturno",
    objetivo: "Vender uma oferta específica (produto, serviço ou curso).",
    acao: "Comprar ou chamar no WhatsApp para fechar.",
    globais: ["topo", "rodape"],
    paginas: [
      {
        id: "inicio",
        slug: "",
        titulo: "Início",
        secoes: [
          { tipo: "hero", nota: "o resultado da oferta em até 8 palavras e o botão de comprar" },
          { tipo: "problema", nota: "a dor do público nas palavras dele" },
          { tipo: "bento", nota: "o que vem na oferta" },
          { tipo: "processo", nota: "como funciona depois da compra" },
          { tipo: "prova", nota: "garantia e prova; depoimento só se for real" },
          { tipo: "pricing", nota: "o preço só se estiver nas fontes; senão, sob consulta" },
          { tipo: "faq", nota: "objeções de compra" },
          { tipo: "chamada", nota: "último empurrão com o botão de comprar e o WhatsApp" },
        ],
      },
    ],
  },
  {
    id: "obrigado",
    nome: "Página de obrigado",
    descricao: "depois do cadastro ou da compra: agradece e mostra o próximo passo",
    tipo: "landing",
    preset: "editorial_claro",
    objetivo: "Confirmar o cadastro ou a compra e levar ao próximo passo.",
    acao: "Entrar no grupo, chamar no WhatsApp ou seguir no Instagram.",
    globais: ["rodape"],
    paginas: [
      {
        id: "inicio",
        slug: "",
        titulo: "Obrigado",
        secoes: [
          { tipo: "hero_dividido", nota: "agradece e confirma o que a pessoa fez, em uma frase" },
          { tipo: "processo", nota: "os próximos passos (o que chega, quando e onde)" },
          { tipo: "links", nota: "os canais para seguir: WhatsApp, grupo, Instagram" },
        ],
      },
    ],
  },
  {
    id: "bio",
    nome: "Link na bio",
    descricao: "página curta de links para a bio do Instagram e do TikTok",
    tipo: "bio",
    preset: "organico",
    objetivo: "Levar quem vem do Instagram e do TikTok para os canais e ofertas certos.",
    acao: "Tocar no link da oferta da semana ou no WhatsApp.",
    globais: ["rodape"],
    paginas: [
      {
        id: "inicio",
        slug: "",
        titulo: "Início",
        secoes: [
          { tipo: "links", nota: "foto ou logo, uma frase do perfil e de 3 a 8 botões de ação" },
          { tipo: "vitrine", nota: "destaques da semana com o botão de pedir pelo WhatsApp" },
        ],
      },
    ],
  },
  {
    id: "institucional_curto",
    nome: "Institucional curto",
    descricao: "uma página só com o que a empresa faz, quem é e como falar",
    tipo: "institucional",
    preset: "suico",
    objetivo: "Apresentar a empresa com clareza e gerar contato.",
    acao: "Chamar no WhatsApp ou mandar o formulário.",
    globais: ["topo", "rodape"],
    paginas: [
      {
        id: "inicio",
        slug: "",
        titulo: "Início",
        secoes: [
          { tipo: "hero", nota: "o que a empresa resolve, para quem" },
          { tipo: "servicos", nota: "de 3 a 6 serviços com uma frase de resultado" },
          { tipo: "sobre", nota: "a história real, com foto real do acervo" },
          { tipo: "diferenciais", nota: "por que escolher, sem superlativo vazio" },
          { tipo: "contato", nota: "formulário, WhatsApp e mapa" },
        ],
      },
    ],
  },
  {
    id: "servico",
    nome: "Site de serviço",
    descricao: "serviços com prova, processo, área de atendimento e orçamento pelo WhatsApp",
    tipo: "institucional",
    preset: "saas_limpo",
    objetivo: "Vender um serviço: mostrar o que faz, provar que entrega e levar ao orçamento ou ao agendamento.",
    acao: "Pedir um orçamento ou agendar pelo WhatsApp.",
    globais: ["topo", "rodape"],
    paginas: [
      {
        id: "inicio",
        slug: "",
        titulo: "Início",
        secoes: [
          { tipo: "hero", nota: "o serviço e o resultado para quem, com a cidade quando é local; botão de orçamento (WhatsApp) e o de agendar" },
          { tipo: "servicos", nota: "de 3 a 6 serviços, cada um com o resultado e o botão de pedir orçamento daquele serviço" },
          { tipo: "processo", nota: "do primeiro contato à entrega, em 3 a 5 passos com prazo só se estiver nas fontes" },
          { tipo: "prova", nota: "garantia, certificações, anos de casa e fotos reais do trabalho; só dado real" },
          { tipo: "diferenciais", nota: "por que este e não o concorrente, sem superlativo vazio" },
          { tipo: "faq", nota: "preço, prazo, garantia, área atendida e forma de pagamento" },
          { tipo: "chamada", nota: "orçamento sem compromisso pelo WhatsApp e o botão de agendar" },
        ],
      },
      {
        id: "servicos",
        slug: "servicos",
        titulo: "Serviços",
        secoes: [
          { tipo: "servicos", nota: "cada serviço com o que inclui, para quem é e o botão de orçamento; abrir um serviço conta como ViewContent" },
          { tipo: "processo", nota: "como o atendimento funciona" },
          { tipo: "pricing", nota: "faixas de preço só se estiverem nas fontes; senão, sob consulta com o botão de orçamento" },
          { tipo: "chamada", nota: "pedir orçamento" },
        ],
      },
      {
        id: "contato",
        slug: "contato",
        titulo: "Orçamento",
        secoes: [
          { tipo: "contato", nota: "formulário de orçamento, WhatsApp, área de atendimento (bairros ou cidades das fontes), horários e o mapa" },
          { tipo: "faq", nota: "o que acontece depois do pedido de orçamento" },
        ],
      },
    ],
  },
  {
    id: "loja_virtual",
    nome: "Loja virtual",
    descricao: "vitrine por categoria, página do produto, carrinho e pagamento pelo link ou pedido no WhatsApp",
    tipo: "loja",
    preset: "editorial_claro",
    objetivo: "Vender produtos pelo site: vitrine, página do produto, carrinho e checkout (link de pagamento do cliente ou pedido no WhatsApp).",
    acao: "Pôr no carrinho e finalizar a compra.",
    globais: ["topo", "rodape"],
    paginas: [
      {
        id: "inicio",
        slug: "",
        titulo: "Início",
        secoes: [
          { tipo: "hero_dividido", nota: "a promessa da loja e o produto em destaque com foto real; botão para a vitrine" },
          { tipo: "vitrine", nota: "os destaques da loja pelos componentes de src/lib/loja.tsx (foto, preço do pacote, comprar)" },
          { tipo: "diferenciais", nota: "entrega, troca, pagamento e atendimento, só o que estiver nas fontes" },
          { tipo: "prova", nota: "garantia, política de troca e selos reais" },
          { tipo: "faq", nota: "frete, prazo, troca, pagamento e segurança" },
          { tipo: "chamada", nota: "voltar para a vitrine ou pedir ajuda no WhatsApp" },
        ],
      },
      {
        id: "produtos",
        slug: "produtos",
        titulo: "Produtos",
        secoes: [
          { tipo: "vitrine", nota: "catálogo completo com filtro por categoria; o produto abre na página do produto (DetalheDoProduto) e conta ViewContent" },
          { tipo: "faq", nota: "dúvidas de compra" },
        ],
      },
      {
        id: "obrigado",
        slug: "obrigado",
        titulo: "Obrigado",
        secoes: [
          { tipo: "hero_dividido", nota: "confirma o pedido em uma frase (o gateway volta para cá depois do pagamento; a casca conta a compra); fora do menu" },
          { tipo: "processo", nota: "próximos passos: confirmação, envio ou retirada" },
          { tipo: "links", nota: "WhatsApp para dúvidas e o Instagram da loja" },
        ],
      },
      {
        id: "contato",
        slug: "contato",
        titulo: "Contato",
        secoes: [{ tipo: "contato", nota: "WhatsApp, formulário e endereço de retirada, se houver" }],
      },
    ],
  },
];

export const modeloDePagina = (id: unknown): ModeloDePagina | null => MODELOS_DE_PAGINA.find((m) => m.id === id) || null;

/** O mapa do modelo, já no formato do site (uids, notas e globais conferidos pela biblioteca). */
export function mapaDoModelo(m: ModeloDePagina): MapaDoSite {
  return normalizarMapa({ tipo: m.tipo, globais: m.globais, fonte: "manual", paginas: m.paginas }, m.tipo);
}

/** Nome do site novo: "<modelo> <marca>", com " 2", " 3" quando já existe. */
export function nomeDoSiteDoModelo(m: ModeloDePagina, dono: string, usados: string[]): string {
  const base = `${m.nome}${dono.trim() ? ` ${dono.trim()}` : ""}`.slice(0, 110);
  const tem = (n: string) => usados.some((u) => u.trim().toLowerCase() === n.toLowerCase());
  if (!tem(base)) return base;
  for (let i = 2; i < 100; i += 1) if (!tem(`${base} ${i}`)) return `${base} ${i}`;
  return base;
}

/**
 * Os campos do site novo que saem do modelo (a função grava por cima do site
 * recém-criado com a marca): tipo, mapa, seções do motor, estilo e o
 * objetivo no briefing. A marca não vem daqui.
 */
export function camposDoModelo(m: ModeloDePagina, site: { direcao?: Record<string, unknown> | null; briefing?: Record<string, unknown> | null; estilo?: Record<string, unknown> | null }) {
  const mapa = mapaDoModelo(m);
  const preset = presetDeEstilo(m.preset) ? m.preset : null;
  const direcao = { ...(site.direcao || {}), secoes: secoesDoMapa(mapa), modelo_de_pagina: { id: m.id, nome: m.nome } };
  const briefingAtual = site.briefing && typeof site.briefing === "object" ? site.briefing : {};
  const respostas = { ...((briefingAtual.respostas as Record<string, unknown>) || {}) };
  if (!respostas.objetivo) respostas.objetivo = m.objetivo;
  if (!respostas.acao) respostas.acao = m.acao;
  return {
    tipo: m.tipo,
    mapa,
    direcao,
    estilo: { ...(site.estilo || {}), preset, motion: Array.isArray(site.estilo && site.estilo.motion) ? site.estilo!.motion : [] },
    briefing: { ...briefingAtual, respostas, modelo_de_pagina: m.id },
  };
}

/** As faixas do desenho do modelo na galeria (a tela desenha um esqueleto por seção). */
export function esqueletoDoModelo(m: ModeloDePagina): Array<{ tipo: string; nota: string }> {
  const corpo = m.paginas[0] ? m.paginas[0].secoes : [];
  return [...(m.globais.indexOf("topo") >= 0 ? [{ tipo: "topo", nota: "topo" }] : []), ...corpo, ...(m.globais.indexOf("rodape") >= 0 ? [{ tipo: "rodape", nota: "rodapé" }] : [])];
}
