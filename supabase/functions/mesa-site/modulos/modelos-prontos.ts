/**
 * Sites prontos para partir (frente MCC, 25/10/2026): a coleção curada que a
 * Mesa Site mostra em "Partir de um modelo pronto". Módulo puro: a tela, a
 * função mesa-site, a motor-codigo e o worker leem a mesma lista.
 *
 * Todos são da Start Bootstrap (MIT, Copyright (c) 2013-2023 Start Bootstrap
 * LLC): uso comercial, cópia e modificação liberados, mantendo o aviso. A
 * cópia fixada (HTML, SCSS do tema, JS e a LICENSE, SEM as fotos de
 * demonstração) fica em workers/motor-codigo/modelos-prontos/<id>/, no commit
 * abaixo. O motor põe a cópia em referencias/modelo-pronto/ do projeto e o
 * agente reconstrói as seções da casa seguindo a estrutura e o estilo do
 * modelo, sempre com a copy, as fotos, as cores e a logo do cliente. A
 * atribuição entra no ATRIBUICOES.md do site.
 *
 * `miniatura` e `previa_url` são da própria Start Bootstrap (a tela carrega
 * direto de lá; o painel não guarda as fotos de demonstração).
 */

export type ModeloPronto = {
  id: string;
  nome: string;
  /** Para que serve, em uma frase da equipe. */
  descricao: string;
  /** Objetivos da jornada (ids de OBJETIVOS_DO_SITE em jornada-do-site.ts) que o modelo atende. */
  objetivo: string[];
  /** Nichos em que o modelo cai bem (ids de NICHOS_DA_COPY do motor de copy, mais "geral"). */
  nichos: string[];
  /** Tipo de site da Mesa Site que o modelo sugere (institucional, landing, portfolio, loja). */
  tipo_sugerido: "institucional" | "landing" | "portfolio" | "loja";
  /** Seções do modelo, na ordem, em palavras da equipe. */
  secoes: string[];
  paginas: string[];
  tema: "claro" | "escuro";
  licenca: "MIT";
  autor: string;
  repositorio: string;
  commit: string;
  /** Pasta da cópia fixada, relativa a workers/motor-codigo. */
  pasta: string;
  miniatura: string;
  previa_url: string;
};

const SB = (slug: string, commit: string, miniatura: "themes" | "templates") => ({
  licenca: "MIT" as const,
  autor: "Start Bootstrap LLC",
  repositorio: `https://github.com/StartBootstrap/startbootstrap-${slug}`,
  commit,
  pasta: `modelos-prontos/${slug}`,
  miniatura: `https://assets.startbootstrap.com/img/screenshots/${miniatura}/${slug}.png`,
  previa_url: `https://startbootstrap.com/previews/${slug}`,
});

export const MODELOS_PRONTOS: readonly ModeloPronto[] = [
  {
    id: "small-business",
    nome: "Negócio local",
    descricao: "Página única e direta para serviço local: chamada com foto, um destaque e três serviços com botão.",
    objetivo: ["servico", "agendar", "marca", "captar"],
    nichos: ["servicos_locais", "informatica", "automotivo", "saude_estetica", "geral"],
    tipo_sugerido: "landing",
    secoes: ["topo", "hero com foto", "faixa de destaque", "3 serviços em cartões", "rodapé"],
    paginas: ["index.html"],
    tema: "claro",
    ...SB("small-business", "9c5ef57a25c2c8e1223b274ef7312375925e281c", "templates"),
  },
  {
    id: "business-casual",
    nome: "Café e restaurante",
    descricao: "Casa de comida com clima: história, cardápio em destaque, horário e endereço em várias páginas.",
    objetivo: ["cardapio", "marca", "loja_virtual"],
    nichos: ["cafe", "alimentacao"],
    tipo_sugerido: "institucional",
    secoes: ["topo com nome grande", "chamada sobre foto", "promessa da casa", "horário de funcionamento", "sobre", "produtos", "loja e endereço"],
    paginas: ["index.html", "about.html", "products.html", "store.html"],
    tema: "claro",
    ...SB("business-casual", "b6f928934386a54e08c2e7f40ebd9e4d7510bba4", "themes"),
  },
  {
    id: "modern-business",
    nome: "Escritório profissional",
    descricao: "Empresa de serviço com várias páginas: serviços, sobre, preços, perguntas, portfólio e contato.",
    objetivo: ["servico", "marca", "captar"],
    nichos: ["advocacia", "odontologia", "imobiliario", "educacao", "marketing", "geral"],
    tipo_sugerido: "institucional",
    secoes: ["hero", "recursos", "depoimento", "blog", "chamada final"],
    paginas: ["index.html", "about.html", "contact.html", "pricing.html", "faq.html", "blog-home.html", "blog-post.html", "portfolio-overview.html", "portfolio-item.html"],
    tema: "claro",
    ...SB("modern-business", "7d297106cbda2f04db4696752fcdb5b4dc9cd936", "templates"),
  },
  {
    id: "business-frontpage",
    nome: "Empresa B2B",
    descricao: "Primeira página de empresa que vende para empresa: proposta clara, recursos, depoimento e contato.",
    objetivo: ["servico", "marca", "captar"],
    nichos: ["informatica", "marketing", "varejo", "geral"],
    tipo_sugerido: "institucional",
    secoes: ["hero", "recursos em grade", "depoimento", "novidades", "contato"],
    paginas: ["index.html"],
    tema: "claro",
    ...SB("business-frontpage", "b330ff68d31fca0950dcce5687796d71432fbd5f", "templates"),
  },
  {
    id: "shop-homepage",
    nome: "Vitrine de loja",
    descricao: "Vitrine de produtos em grade com preço e botão de comprar: a base da loja virtual; serve também para catálogo de imóveis ou carros.",
    objetivo: ["loja_virtual", "cardapio", "vender"],
    nichos: ["varejo", "moda", "imobiliario", "automotivo", "moveis_decoracao"],
    tipo_sugerido: "loja",
    secoes: ["topo com carrinho", "chamada", "grade de produtos", "rodapé"],
    paginas: ["index.html"],
    tema: "claro",
    ...SB("shop-homepage", "fb3a49020b840cdbcb0a588fdbda8fc019710a6f", "templates"),
  },
  {
    id: "landing-page",
    nome: "Página de captura",
    descricao: "Landing de lançamento ou captura: chamada com campo de e-mail, benefícios, vitrines, depoimentos e CTA final.",
    objetivo: ["captar", "vender"],
    nichos: ["educacao", "marketing", "saude_estetica", "geral"],
    tipo_sugerido: "landing",
    secoes: ["hero com captura", "3 benefícios", "vitrines alternadas", "depoimentos", "chamada final com captura"],
    paginas: ["index.html"],
    tema: "claro",
    ...SB("landing-page", "247a46a2503c91d1157179eab297953438ec498b", "themes"),
  },
  {
    id: "new-age",
    nome: "App e SaaS",
    descricao: "Produto digital: chamada com o aparelho, recursos, prova e chamada para baixar ou assinar.",
    objetivo: ["vender", "captar"],
    nichos: ["informatica", "marketing", "educacao"],
    tipo_sugerido: "landing",
    secoes: ["hero com aparelho", "citação de destaque", "recursos", "chamada para baixar", "contato"],
    paginas: ["index.html"],
    tema: "claro",
    ...SB("new-age", "5f619773a873e44545b9e1e049d6565d3a9e81d7", "themes"),
  },
  {
    id: "grayscale",
    nome: "Evento noturno",
    descricao: "Página única escura e de impacto para evento, show ou festa: chamada grande, sobre, atrações e inscrição.",
    objetivo: ["evento", "marca"],
    nichos: ["eventos", "esporte"],
    tipo_sugerido: "landing",
    secoes: ["hero escuro de tela cheia", "sobre", "projetos em destaque", "inscrição", "contatos"],
    paginas: ["index.html"],
    tema: "escuro",
    ...SB("grayscale", "d974402542d05abcbaa8d21d4dd78e53680f2edd", "themes"),
  },
  {
    id: "coming-soon",
    nome: "Em breve",
    descricao: "Pré-lançamento ou inauguração: uma tela com a promessa, contagem e lista de espera.",
    objetivo: ["evento", "captar", "bio"],
    nichos: ["eventos", "geral"],
    tipo_sugerido: "landing",
    secoes: ["tela única com vídeo ou foto de fundo", "lista de espera", "redes sociais"],
    paginas: ["index.html"],
    tema: "escuro",
    ...SB("coming-soon", "5c428101c48f34b85bf45e4faf26476b2f43215d", "themes"),
  },
  {
    id: "agency",
    nome: "Agência e estúdio",
    descricao: "Estúdio criativo ou arquitetura: serviços, portfólio em grade, linha do tempo, equipe e contato.",
    objetivo: ["portfolio", "marca"],
    nichos: ["marketing", "moveis_decoracao", "jardinagem", "eventos"],
    tipo_sugerido: "portfolio",
    secoes: ["hero", "serviços", "portfólio em grade", "linha do tempo", "equipe", "clientes", "contato"],
    paginas: ["index.html"],
    tema: "escuro",
    ...SB("agency", "b2d5d5c6b1396bc5b0e8dd92c693b106cfb7cee1", "themes"),
  },
  {
    id: "freelancer",
    nome: "Portfólio de profissional",
    descricao: "Portfólio de quem trabalha sozinho: trabalhos em grade com detalhe, sobre e contato.",
    objetivo: ["portfolio"],
    nichos: ["marketing", "moveis_decoracao", "eventos", "geral"],
    tipo_sugerido: "portfolio",
    secoes: ["hero com avatar", "portfólio em grade", "sobre", "contato"],
    paginas: ["index.html"],
    tema: "claro",
    ...SB("freelancer", "5bc65b4bd01e4ab63186395d5f95c7fdaa26216d", "themes"),
  },
  {
    id: "resume",
    nome: "Profissional liberal",
    descricao: "Página pessoal de autoridade com menu lateral: sobre, experiência, formação, especialidades e reconhecimentos.",
    objetivo: ["marca", "servico", "agendar", "bio", "portfolio"],
    nichos: ["saude_estetica", "advocacia", "odontologia", "educacao", "esporte"],
    tipo_sugerido: "portfolio",
    secoes: ["menu lateral com foto", "sobre", "experiência", "formação", "especialidades", "interesses", "reconhecimentos"],
    paginas: ["index.html"],
    tema: "claro",
    ...SB("resume", "c6fbe5ef431642984d0f17960194632f20cf67bc", "themes"),
  },
];

export const IDS_DOS_MODELOS_PRONTOS: readonly string[] = MODELOS_PRONTOS.map((m) => m.id);

export function modeloPronto(id: unknown): ModeloPronto | null {
  return typeof id === "string" ? MODELOS_PRONTOS.find((m) => m.id === id) || null : null;
}

/** Os modelos que combinam com um nicho (o do cliente primeiro; sem nicho, a coleção inteira). */
export function modelosDoNicho(nicho: string | null | undefined): ModeloPronto[] {
  const n = String(nicho || "").toLowerCase().trim();
  if (!n) return MODELOS_PRONTOS.slice();
  const casam = MODELOS_PRONTOS.filter((m) => m.nichos.some((x) => n.indexOf(x) >= 0 || x.indexOf(n) >= 0));
  return casam.concat(MODELOS_PRONTOS.filter((m) => casam.indexOf(m) < 0));
}
