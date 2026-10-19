/**
 * Os templates oficiais do Laboratório: os 6 da v1 (semente da migration 20261019180000_laboratorio.sql)
 * os 4 da v2 (semente da 20261019233000_laboratorio_v2.sql, organizados em colunas por etapa) e os 3 da v3
 * (semente da 20261020010000_laboratorio_v3.sql).
 * O teste confere que cada um é um canvas válido e que as migrations semeiam exatamente estes.
 */
import { type Canvas, type Gatilho, type Ligacao, type NoDoCanvas, ordemTopologica, organizarPorEtapas, type TipoDeNo } from "./regras.ts";

/** `categoria` (v4): a galeria da Início agrupa por ela (coluna lab_templates.categoria). */
export type TemplateOficial = { id: string; nome: string; descricao: string; icone: string; canvas: Canvas; categoria?: string };

const vp = { x: 0, y: 0, zoom: 1 };

/** Canvas da v2: nós e ligações por apelido; as posições saem das colunas por etapa (organizarPorEtapas). */
function emEtapas(nos: Array<[string, TipoDeNo, Record<string, unknown>]>, ligacoes: Array<[string, string]>): Canvas {
  const base: Canvas = {
    nos: nos.map(([id, tipo, dados]): NoDoCanvas => ({ id, tipo, x: 0, y: 0, dados })),
    ligacoes: ligacoes.map(([de, para], i) => ({ id: `lig_${i + 1}`, de, para })),
    viewport: vp,
  };
  return organizarPorEtapas(base).canvas;
}

export const TEMPLATES_OFICIAIS: TemplateOficial[] = [
  {
    id: "6c0a1b10-0000-4000-8000-000000000001",
    nome: "Carrossel",
    descricao: "Pedido e base comum entram no Construtor de carrossel: o agente planeja as lâminas e gera as artes em ordem.",
    icone: "layers",
    canvas: {
      nos: [
        { id: "contexto_1", tipo: "contexto", x: 80, y: 80, dados: { titulo: "Pedido", texto: "Tema do carrossel, público e o que a pessoa deve sentir ou fazer no fim." } },
        { id: "gravity_1", tipo: "gravity", x: 80, y: 260, dados: { titulo: "Base comum", prompt_base: "Mesma família visual em todas as lâminas: paleta, tipografia e luz iguais." } },
        { id: "config_1", tipo: "config", x: 80, y: 440, dados: { titulo: "Formato", proporcao: "4:5", qualidade: "media" } },
        { id: "carrossel_1", tipo: "carrossel", x: 400, y: 260, dados: { titulo: "Carrossel", laminas: 5 } },
      ],
      ligacoes: [
        { id: "lig_1", de: "contexto_1", para: "carrossel_1" },
        { id: "lig_2", de: "gravity_1", para: "carrossel_1" },
        { id: "lig_3", de: "config_1", para: "carrossel_1" },
      ],
      viewport: vp,
    },
  },
  {
    id: "6c0a1b10-0000-4000-8000-000000000002",
    nome: "Criativos de anúncio",
    descricao: "Copy de anúncio e duas artes com a mesma base comum, fechando num pacote de anúncio que nasce pausado.",
    icone: "megaphone",
    canvas: {
      nos: [
        { id: "contexto_1", tipo: "contexto", x: 80, y: 80, dados: { titulo: "Oferta", texto: "Produto, oferta, público e objetivo da campanha." } },
        { id: "copy_1", tipo: "copy", x: 400, y: 80, dados: { titulo: "Copy do anúncio", formato: "anuncio" } },
        { id: "gravity_1", tipo: "gravity", x: 80, y: 280, dados: { titulo: "Base comum", prompt_base: "Criativo de anúncio limpo, produto em destaque, uma mensagem curta por arte." } },
        { id: "imagem_1", tipo: "imagem", x: 400, y: 280, dados: { titulo: "Criativo A", proporcao: "4:5", quantidade: 1 } },
        { id: "imagem_2", tipo: "imagem", x: 400, y: 460, dados: { titulo: "Criativo B", proporcao: "9:16", quantidade: 1 } },
        { id: "anuncio_1", tipo: "anuncio", x: 720, y: 280, dados: { titulo: "Pacote do anúncio" } },
      ],
      ligacoes: [
        { id: "lig_1", de: "contexto_1", para: "copy_1" },
        { id: "lig_2", de: "contexto_1", para: "imagem_1" },
        { id: "lig_3", de: "contexto_1", para: "imagem_2" },
        { id: "lig_4", de: "gravity_1", para: "imagem_1" },
        { id: "lig_5", de: "gravity_1", para: "imagem_2" },
        { id: "lig_6", de: "copy_1", para: "anuncio_1" },
        { id: "lig_7", de: "imagem_1", para: "anuncio_1" },
        { id: "lig_8", de: "imagem_2", para: "anuncio_1" },
      ],
      viewport: vp,
    },
  },
  {
    id: "6c0a1b10-0000-4000-8000-000000000003",
    nome: "Logo",
    descricao: "Nome, conceito e paleta viram variações de logo (símbolo + logotipo, fundo liso); o Jev aponta a melhor e explica.",
    icone: "pen-tool",
    canvas: {
      nos: [
        { id: "contexto_1", tipo: "contexto", x: 80, y: 80, dados: { titulo: "Briefing da marca", texto: "O que a marca faz, para quem, e as palavras que ela precisa transmitir." } },
        { id: "logo_1", tipo: "logo", x: 400, y: 80, dados: { titulo: "Logo", nome: "", conceito: "", paleta: "", estilo: "minimalista", n: 4 } },
      ],
      ligacoes: [{ id: "lig_1", de: "contexto_1", para: "logo_1" }],
      viewport: vp,
    },
  },
  {
    id: "6c0a1b10-0000-4000-8000-000000000004",
    nome: "Landing page",
    descricao: "Contexto e copy de landing entram no Construtor de página: sai um HTML único (Tailwind) salvo nos arquivos, com prévia.",
    icone: "layout",
    canvas: {
      nos: [
        { id: "contexto_1", tipo: "contexto", x: 80, y: 80, dados: { titulo: "Oferta e público", texto: "Produto, promessa, público, prova e chamada para ação." } },
        { id: "copy_1", tipo: "copy", x: 400, y: 80, dados: { titulo: "Copy da página", formato: "landing" } },
        { id: "landing_1", tipo: "landing", x: 720, y: 80, dados: { titulo: "Landing page", objetivo: "captar contato" } },
      ],
      ligacoes: [
        { id: "lig_1", de: "contexto_1", para: "copy_1" },
        { id: "lig_2", de: "copy_1", para: "landing_1" },
        { id: "lig_3", de: "contexto_1", para: "landing_1" },
      ],
      viewport: vp,
    },
  },
  {
    id: "6c0a1b10-0000-4000-8000-000000000005",
    nome: "Post + legenda",
    descricao: "Uma arte de feed e a legenda escrita a partir do mesmo pedido.",
    icone: "image",
    canvas: {
      nos: [
        { id: "contexto_1", tipo: "contexto", x: 80, y: 80, dados: { titulo: "Pedido do post", texto: "Assunto do post, tom e chamada." } },
        { id: "config_1", tipo: "config", x: 80, y: 260, dados: { titulo: "Formato", proporcao: "4:5", quantidade: 1, qualidade: "media" } },
        { id: "imagem_1", tipo: "imagem", x: 400, y: 80, dados: { titulo: "Arte do post" } },
        { id: "copy_1", tipo: "copy", x: 400, y: 260, dados: { titulo: "Legenda", formato: "legenda" } },
      ],
      ligacoes: [
        { id: "lig_1", de: "contexto_1", para: "imagem_1" },
        { id: "lig_2", de: "config_1", para: "imagem_1" },
        { id: "lig_3", de: "contexto_1", para: "copy_1" },
      ],
      viewport: vp,
    },
  },
  {
    id: "6c0a1b10-0000-4000-8000-000000000006",
    nome: "Variação de criativos",
    descricao: "Uma mídia de referência e uma base comum geram três variações do mesmo criativo de uma vez.",
    icone: "copy",
    canvas: {
      nos: [
        { id: "midia_1", tipo: "midia", x: 80, y: 80, dados: { titulo: "Criativo de referência", imagens: [] } },
        { id: "gravity_1", tipo: "gravity", x: 80, y: 260, dados: { titulo: "Base comum", prompt_base: "Manter produto, marca e mensagem; variar cena, enquadramento e cor de fundo." } },
        { id: "imagem_1", tipo: "imagem", x: 400, y: 80, dados: { titulo: "Variação 1", prompt: "Cena em ambiente claro." } },
        { id: "imagem_2", tipo: "imagem", x: 400, y: 260, dados: { titulo: "Variação 2", prompt: "Close no produto, fundo de cor sólida." } },
        { id: "imagem_3", tipo: "imagem", x: 400, y: 440, dados: { titulo: "Variação 3", prompt: "Produto em uso, luz natural." } },
      ],
      ligacoes: [
        { id: "lig_1", de: "midia_1", para: "imagem_1" },
        { id: "lig_2", de: "midia_1", para: "imagem_2" },
        { id: "lig_3", de: "midia_1", para: "imagem_3" },
        { id: "lig_4", de: "gravity_1", para: "imagem_1" },
        { id: "lig_5", de: "gravity_1", para: "imagem_2" },
        { id: "lig_6", de: "gravity_1", para: "imagem_3" },
      ],
      viewport: vp,
    },
  },
];

/** Os 4 oficiais da v2 (ESPEC-LABORATORIO-v2.md, "Templates novos"). */
export const TEMPLATES_OFICIAIS_V2: TemplateOficial[] = [
  {
    id: "6c0a1b10-0000-4000-8000-000000000007",
    nome: "Produto low ticket do zero",
    descricao: "Pesquisa na internet, oferta, funil, copy, página de vendas, 3 criativos e anúncio; no fim, o pedido para pôr a página e o anúncio (pausado) no ar com a sua aprovação.",
    icone: "shopping-bag",
    canvas: emEtapas(
      [
        ["contexto_1", "contexto", { titulo: "Pedido", texto: "Produto, para quem é, faixa de preço pensada (low ticket, até 97 reais) e o que a pessoa ganha." }],
        ["pesquisa_1", "pesquisa", { titulo: "Pesquisa de mercado", tema: "Concorrentes, preços praticados, público e ângulos para este produto low ticket." }],
        ["oferta_1", "oferta", { titulo: "Oferta", instrucao: "Oferta low ticket: preço de entrada, ancoragem, bônus e garantia." }],
        ["funil_1", "funil", { titulo: "Funil", objetivo: "Venda direta: anúncio, página de vendas e checkout, com upsell." }],
        ["copy_1", "copy", { titulo: "Copy da página", formato: "landing" }],
        ["copy_2", "copy", { titulo: "Copy do anúncio", formato: "anuncio" }],
        ["landing_1", "landing", { titulo: "Página de vendas", objetivo: "vender o produto low ticket" }],
        ["gravity_1", "gravity", { titulo: "Base comum dos criativos", prompt_base: "Criativos de anúncio da mesma família: produto em destaque, uma mensagem curta por arte, cores da marca." }],
        ["imagem_1", "imagem", { titulo: "Criativo 1", proporcao: "4:5", quantidade: 1 }],
        ["imagem_2", "imagem", { titulo: "Criativo 2", proporcao: "9:16", quantidade: 1 }],
        ["imagem_3", "imagem", { titulo: "Criativo 3", proporcao: "1:1", quantidade: 1 }],
        ["anuncio_1", "anuncio", { titulo: "Anúncio", objetivo: "vendas" }],
        ["por_no_ar_1", "por_no_ar", { titulo: "Publicar a página", alvo: "publicar_site" }],
        ["por_no_ar_2", "por_no_ar", { titulo: "Subir o anúncio pausado", alvo: "subir_anuncio_pausado" }],
      ],
      [
        ["contexto_1", "pesquisa_1"], ["contexto_1", "oferta_1"], ["pesquisa_1", "oferta_1"], ["pesquisa_1", "funil_1"], ["oferta_1", "funil_1"],
        ["oferta_1", "copy_1"], ["funil_1", "copy_1"], ["oferta_1", "copy_2"],
        ["copy_1", "landing_1"], ["oferta_1", "landing_1"], ["funil_1", "landing_1"],
        ["oferta_1", "imagem_1"], ["oferta_1", "imagem_2"], ["oferta_1", "imagem_3"],
        ["gravity_1", "imagem_1"], ["gravity_1", "imagem_2"], ["gravity_1", "imagem_3"],
        ["copy_2", "anuncio_1"], ["oferta_1", "anuncio_1"], ["imagem_1", "anuncio_1"], ["imagem_2", "anuncio_1"], ["imagem_3", "anuncio_1"],
        ["landing_1", "por_no_ar_1"],
        ["anuncio_1", "por_no_ar_2"], ["landing_1", "por_no_ar_2"], ["imagem_1", "por_no_ar_2"], ["imagem_2", "por_no_ar_2"], ["imagem_3", "por_no_ar_2"],
      ],
    ),
  },
  {
    id: "6c0a1b10-0000-4000-8000-000000000008",
    nome: "Funil de vendas completo",
    descricao: "Pesquisa, oferta e funil guiam a página de captura, a página de vendas, os e-mails, as mensagens de WhatsApp, os criativos e o anúncio; no fim, o pedido para pôr no ar com a sua aprovação.",
    icone: "filter",
    canvas: emEtapas(
      [
        ["contexto_1", "contexto", { titulo: "Pedido", texto: "Produto ou serviço, público, preço e o objetivo do funil." }],
        ["pesquisa_1", "pesquisa", { titulo: "Pesquisa de mercado", tema: "Concorrentes, preços, público, objeções e ângulos deste mercado." }],
        ["oferta_1", "oferta", { titulo: "Oferta" }],
        ["funil_1", "funil", { titulo: "Funil", objetivo: "Captura de contato, nutrição por e-mail e WhatsApp, página de vendas e upsell." }],
        ["copy_1", "copy", { titulo: "Copy da página de captura", formato: "landing", instrucao: "Página curta de captura: promessa, isca, formulário." }],
        ["copy_2", "copy", { titulo: "Copy da página de vendas", formato: "landing" }],
        ["copy_3", "copy", { titulo: "Sequência de e-mails", formato: "email", instrucao: "Sequência de 5 e-mails de nutrição até a oferta." }],
        ["agente_1", "agente", { titulo: "Mensagens de WhatsApp", instrucao: "Escreva 5 mensagens curtas de WhatsApp para quem se cadastrou, da boas-vindas até a oferta, com saída fácil e sem spam." }],
        ["copy_4", "copy", { titulo: "Copy do anúncio", formato: "anuncio" }],
        ["landing_1", "landing", { titulo: "Página de captura", objetivo: "captar contato" }],
        ["landing_2", "landing", { titulo: "Página de vendas", objetivo: "vender a oferta" }],
        ["gravity_1", "gravity", { titulo: "Base comum dos criativos", prompt_base: "Criativos da mesma família: uma mensagem curta por arte, cores da marca." }],
        ["imagem_1", "imagem", { titulo: "Criativo 1", proporcao: "4:5", quantidade: 1 }],
        ["imagem_2", "imagem", { titulo: "Criativo 2", proporcao: "9:16", quantidade: 1 }],
        ["anuncio_1", "anuncio", { titulo: "Anúncio", objetivo: "cadastros" }],
        ["por_no_ar_1", "por_no_ar", { titulo: "Publicar as páginas", alvo: "publicar_site" }],
        ["por_no_ar_2", "por_no_ar", { titulo: "Subir o anúncio pausado", alvo: "subir_anuncio_pausado" }],
      ],
      [
        ["contexto_1", "pesquisa_1"], ["contexto_1", "oferta_1"], ["pesquisa_1", "oferta_1"], ["pesquisa_1", "funil_1"], ["oferta_1", "funil_1"],
        ["oferta_1", "copy_1"], ["funil_1", "copy_1"], ["oferta_1", "copy_2"], ["funil_1", "copy_2"],
        ["oferta_1", "copy_3"], ["funil_1", "copy_3"], ["oferta_1", "agente_1"], ["funil_1", "agente_1"], ["oferta_1", "copy_4"],
        ["copy_1", "landing_1"], ["funil_1", "landing_1"], ["copy_2", "landing_2"], ["oferta_1", "landing_2"],
        ["oferta_1", "imagem_1"], ["oferta_1", "imagem_2"], ["gravity_1", "imagem_1"], ["gravity_1", "imagem_2"],
        ["copy_4", "anuncio_1"], ["imagem_1", "anuncio_1"], ["imagem_2", "anuncio_1"],
        ["landing_1", "por_no_ar_1"], ["landing_2", "por_no_ar_1"],
        ["anuncio_1", "por_no_ar_2"], ["landing_1", "por_no_ar_2"], ["imagem_1", "por_no_ar_2"], ["imagem_2", "por_no_ar_2"],
      ],
    ),
  },
  {
    id: "6c0a1b10-0000-4000-8000-000000000009",
    nome: "Montar empresa / marca do zero",
    descricao: "Pesquisa na internet, posicionamento, logo (o Jev aponta a melhor), página e o post de lançamento; no fim, o pedido para pôr a página e o post no ar com a sua aprovação.",
    icone: "building",
    canvas: emEtapas(
      [
        ["contexto_1", "contexto", { titulo: "Ideia do negócio", texto: "O que a empresa faz, para quem, onde atende, e o nome (se já tiver)." }],
        ["pesquisa_1", "pesquisa", { titulo: "Pesquisa de mercado", tema: "Concorrentes, posicionamentos, preços e público deste mercado na região." }],
        ["agente_1", "agente", { titulo: "Posicionamento", instrucao: "Defina o posicionamento: para quem, contra quem, a promessa, o tom de voz, 3 sugestões de nome (se faltar) e as palavras que a marca precisa transmitir." }],
        ["logo_1", "logo", { titulo: "Logo", nome: "", conceito: "", paleta: "", estilo: "minimalista", n: 4 }],
        ["copy_1", "copy", { titulo: "Copy da página", formato: "landing" }],
        ["landing_1", "landing", { titulo: "Página da empresa", objetivo: "apresentar a empresa e captar contato" }],
        ["config_1", "config", { titulo: "Formato do post", proporcao: "4:5", quantidade: 1, qualidade: "media" }],
        ["imagem_1", "imagem", { titulo: "Post de lançamento", prompt: "Post anunciando a chegada da marca, com a logo." }],
        ["copy_2", "copy", { titulo: "Legenda do lançamento", formato: "legenda" }],
        ["por_no_ar_1", "por_no_ar", { titulo: "Publicar a página", alvo: "publicar_site" }],
        ["por_no_ar_2", "por_no_ar", { titulo: "Publicar o post de lançamento", alvo: "outro", instrucao: "Publicar o post de lançamento no Instagram da marca, com a legenda ligada." }],
      ],
      [
        ["contexto_1", "pesquisa_1"], ["contexto_1", "agente_1"], ["pesquisa_1", "agente_1"],
        ["agente_1", "logo_1"], ["contexto_1", "logo_1"],
        ["agente_1", "copy_1"], ["copy_1", "landing_1"], ["agente_1", "landing_1"], ["logo_1", "landing_1"],
        ["agente_1", "imagem_1"], ["logo_1", "imagem_1"], ["config_1", "imagem_1"],
        ["agente_1", "copy_2"],
        ["landing_1", "por_no_ar_1"], ["logo_1", "por_no_ar_1"],
        ["imagem_1", "por_no_ar_2"], ["copy_2", "por_no_ar_2"],
      ],
    ),
  },
  {
    id: "6c0a1b10-0000-4000-8000-00000000000a",
    nome: "Filme da marca",
    descricao: "O contexto da marca vira o filme cinematográfico: 3 storyboards, você escolhe um no nó e ele renderiza. Precisa de cliente (usa a marca dele).",
    icone: "clapperboard",
    canvas: emEtapas(
      [
        ["contexto_1", "contexto", { titulo: "Contexto da marca", texto: "O que a marca é, para quem, a promessa e o sentimento que o filme precisa deixar." }],
        ["filme_1", "filme", { titulo: "Filme da marca", ideia: "", formato: "ambos" }],
      ],
      [["contexto_1", "filme_1"]],
    ),
  },
];

/**
 * Os 3 oficiais da v3 (clickmax-rea.md, "Templates por arquétipo"), semente da 20261020010000_laboratorio_v3.sql.
 * Usam os especialistas de criação (avatar, seções da página, sequência de mensagens, order bump, upsell).
 */
export const TEMPLATES_OFICIAIS_V3: TemplateOficial[] = [
  {
    id: "6c0a1b10-0000-4000-8000-00000000000b",
    nome: "High ticket com aplicação",
    descricao: "Pesquisa, avatar e oferta high ticket; página de aplicação com quiz de qualificação; mensagens de agenda com o closer; criativos e anúncio; no fim, o pedido para pôr no ar com a sua aprovação.",
    icone: "gem",
    canvas: emEtapas(
      [
        ["contexto_1", "contexto", { titulo: "Pedido", texto: "Serviço ou programa high ticket, para quem é, faixa de preço e como a venda fecha (call com closer)." }],
        ["pesquisa_1", "pesquisa", { titulo: "Pesquisa de mercado", tema: "Concorrentes high ticket, preços, promessas, público decisor e objeções deste mercado." }],
        ["avatar_1", "avatar", { titulo: "Avatar" }],
        ["oferta_1", "oferta", { titulo: "Oferta high ticket", instrucao: "Oferta high ticket vendida por call: entregáveis, prazo, garantia possível e o que qualifica o cliente." }],
        ["secoes_pagina_1", "secoes_pagina", { titulo: "Seções da página de aplicação", tipo_pagina: "aplicacao", objetivo: "qualificar com o quiz e levar quem passa do corte para a agenda" }],
        ["landing_1", "landing", { titulo: "Página de aplicação", objetivo: "aplicação com quiz de qualificação e agenda para quem passa do corte" }],
        ["sequencia_mensagens_1", "sequencia_mensagens", { titulo: "Agenda com o closer", canal: "whatsapp", mensagens: 5, objetivo: "confirmar a call com o closer, lembrar na véspera e no dia, remarcar quem faltou" }],
        ["copy_1", "copy", { titulo: "Copy do anúncio", formato: "anuncio" }],
        ["gravity_1", "gravity", { titulo: "Base comum dos criativos", prompt_base: "Criativos sóbrios de autoridade: uma promessa forte por arte, sem número inventado, cores da marca." }],
        ["imagem_1", "imagem", { titulo: "Criativo 1", proporcao: "4:5", quantidade: 1 }],
        ["imagem_2", "imagem", { titulo: "Criativo 2", proporcao: "9:16", quantidade: 1 }],
        ["anuncio_1", "anuncio", { titulo: "Anúncio", objetivo: "aplicações qualificadas" }],
        ["por_no_ar_1", "por_no_ar", { titulo: "Publicar a página de aplicação", alvo: "publicar_site" }],
        ["por_no_ar_2", "por_no_ar", { titulo: "Subir o anúncio pausado", alvo: "subir_anuncio_pausado" }],
        ["por_no_ar_3", "por_no_ar", { titulo: "Ligar a agenda no WhatsApp", alvo: "outro", instrucao: "Configurar a sequência de agenda com o closer no WhatsApp do cliente (fora da janela de 24 h, só modelo aprovado)." }],
      ],
      [
        ["contexto_1", "pesquisa_1"], ["contexto_1", "avatar_1"], ["pesquisa_1", "avatar_1"],
        ["contexto_1", "oferta_1"], ["pesquisa_1", "oferta_1"], ["avatar_1", "oferta_1"],
        ["oferta_1", "secoes_pagina_1"], ["avatar_1", "secoes_pagina_1"],
        ["secoes_pagina_1", "landing_1"], ["oferta_1", "landing_1"], ["avatar_1", "landing_1"],
        ["oferta_1", "sequencia_mensagens_1"], ["avatar_1", "sequencia_mensagens_1"], ["landing_1", "sequencia_mensagens_1"],
        ["oferta_1", "copy_1"], ["avatar_1", "copy_1"],
        ["oferta_1", "imagem_1"], ["oferta_1", "imagem_2"], ["gravity_1", "imagem_1"], ["gravity_1", "imagem_2"],
        ["copy_1", "anuncio_1"], ["oferta_1", "anuncio_1"], ["imagem_1", "anuncio_1"], ["imagem_2", "anuncio_1"],
        ["landing_1", "por_no_ar_1"],
        ["anuncio_1", "por_no_ar_2"], ["landing_1", "por_no_ar_2"], ["imagem_1", "por_no_ar_2"], ["imagem_2", "por_no_ar_2"],
        ["sequencia_mensagens_1", "por_no_ar_3"],
      ],
    ),
  },
  {
    id: "6c0a1b10-0000-4000-8000-00000000000c",
    nome: "Lançamento",
    descricao: "Aquecimento, página de captura, sequência de mensagens do lançamento, página de vendas e carrinho com order bump e upsell; no fim, o pedido para pôr no ar com a sua aprovação.",
    icone: "rocket",
    canvas: emEtapas(
      [
        ["contexto_1", "contexto", { titulo: "Pedido do lançamento", texto: "Produto, público, preço, datas (aquecimento, abertura e fechamento do carrinho) e a meta de inscritos." }],
        ["pesquisa_1", "pesquisa", { titulo: "Pesquisa de mercado", tema: "Lançamentos parecidos, preços, promessas, objeções e ângulos deste público." }],
        ["avatar_1", "avatar", { titulo: "Avatar" }],
        ["oferta_1", "oferta", { titulo: "Oferta do lançamento" }],
        ["sequencia_mensagens_1", "sequencia_mensagens", { titulo: "Aquecimento", canal: "ambos", mensagens: 6, objetivo: "aquecer a audiência antes da captura: problema, história, quebra de objeção e convite" }],
        ["secoes_pagina_1", "secoes_pagina", { titulo: "Seções da página de captura", tipo_pagina: "captura", objetivo: "inscrição no lançamento" }],
        ["landing_1", "landing", { titulo: "Página de captura", objetivo: "captar inscritos para o lançamento" }],
        ["sequencia_mensagens_2", "sequencia_mensagens", { titulo: "Sequência do lançamento", canal: "ambos", mensagens: 10, objetivo: "conteúdos de aquecimento para inscritos, abertura do carrinho, lembretes e fechamento" }],
        ["order_bump_1", "order_bump", { titulo: "Order bump" }],
        ["upsell_1", "upsell", { titulo: "Upsell" }],
        ["secoes_pagina_2", "secoes_pagina", { titulo: "Seções da página de vendas", tipo_pagina: "vendas", objetivo: "vender no carrinho aberto" }],
        ["landing_2", "landing", { titulo: "Página de vendas", objetivo: "vender a oferta do lançamento com carrinho aberto" }],
        ["por_no_ar_1", "por_no_ar", { titulo: "Publicar as páginas", alvo: "publicar_site" }],
        ["por_no_ar_2", "por_no_ar", { titulo: "Ligar sequências e carrinho", alvo: "outro", instrucao: "Configurar as sequências de e-mail e WhatsApp e o order bump e o upsell no checkout do cliente." }],
      ],
      [
        ["contexto_1", "pesquisa_1"], ["contexto_1", "avatar_1"], ["pesquisa_1", "avatar_1"],
        ["contexto_1", "oferta_1"], ["pesquisa_1", "oferta_1"], ["avatar_1", "oferta_1"],
        ["oferta_1", "sequencia_mensagens_1"], ["avatar_1", "sequencia_mensagens_1"],
        ["oferta_1", "secoes_pagina_1"], ["avatar_1", "secoes_pagina_1"], ["secoes_pagina_1", "landing_1"], ["oferta_1", "landing_1"],
        ["oferta_1", "sequencia_mensagens_2"], ["avatar_1", "sequencia_mensagens_2"], ["landing_1", "sequencia_mensagens_2"],
        ["oferta_1", "order_bump_1"], ["oferta_1", "upsell_1"], ["order_bump_1", "upsell_1"],
        ["oferta_1", "secoes_pagina_2"], ["order_bump_1", "secoes_pagina_2"], ["upsell_1", "secoes_pagina_2"],
        ["secoes_pagina_2", "landing_2"], ["oferta_1", "landing_2"], ["order_bump_1", "landing_2"],
        ["landing_1", "por_no_ar_1"], ["landing_2", "por_no_ar_1"],
        ["sequencia_mensagens_1", "por_no_ar_2"], ["sequencia_mensagens_2", "por_no_ar_2"], ["order_bump_1", "por_no_ar_2"], ["upsell_1", "por_no_ar_2"],
      ],
    ),
  },
  {
    id: "6c0a1b10-0000-4000-8000-00000000000d",
    nome: "Webinar",
    descricao: "Página de inscrição, lembretes, roteiro do webinar, oferta e página de vendas; no fim, o pedido para pôr no ar com a sua aprovação.",
    icone: "presentation",
    canvas: emEtapas(
      [
        ["contexto_1", "contexto", { titulo: "Pedido do webinar", texto: "Tema e data do webinar, para quem é, o produto que será oferecido no fim e o preço." }],
        ["avatar_1", "avatar", { titulo: "Avatar" }],
        ["oferta_1", "oferta", { titulo: "Oferta do webinar", instrucao: "Oferta apresentada no fim do webinar, com condição especial para quem está ao vivo." }],
        ["secoes_pagina_1", "secoes_pagina", { titulo: "Seções da página de inscrição", tipo_pagina: "inscricao", objetivo: "inscrição no webinar" }],
        ["landing_1", "landing", { titulo: "Página de inscrição", objetivo: "inscrever no webinar" }],
        ["sequencia_mensagens_1", "sequencia_mensagens", { titulo: "Lembretes do webinar", canal: "ambos", mensagens: 5, objetivo: "confirmar a inscrição e lembrar 1 dia antes, 1 hora antes, na hora e mandar o replay" }],
        ["agente_1", "agente", { titulo: "Roteiro do webinar", instrucao: "Escreva o roteiro do webinar de 60 minutos: abertura, conteúdo em 3 blocos, transição para a oferta, oferta, perguntas e fechamento." }],
        ["secoes_pagina_2", "secoes_pagina", { titulo: "Seções da página de vendas", tipo_pagina: "vendas", objetivo: "vender a oferta do webinar" }],
        ["landing_2", "landing", { titulo: "Página de vendas", objetivo: "vender a oferta do webinar" }],
        ["por_no_ar_1", "por_no_ar", { titulo: "Publicar as páginas", alvo: "publicar_site" }],
        ["por_no_ar_2", "por_no_ar", { titulo: "Ligar os lembretes", alvo: "outro", instrucao: "Configurar os lembretes de e-mail e WhatsApp do webinar (fora da janela de 24 h, só modelo aprovado)." }],
      ],
      [
        ["contexto_1", "avatar_1"], ["contexto_1", "oferta_1"], ["avatar_1", "oferta_1"],
        ["contexto_1", "secoes_pagina_1"], ["avatar_1", "secoes_pagina_1"], ["oferta_1", "secoes_pagina_1"],
        ["secoes_pagina_1", "landing_1"], ["contexto_1", "landing_1"],
        ["contexto_1", "sequencia_mensagens_1"], ["landing_1", "sequencia_mensagens_1"],
        ["contexto_1", "agente_1"], ["avatar_1", "agente_1"], ["oferta_1", "agente_1"],
        ["oferta_1", "secoes_pagina_2"], ["agente_1", "secoes_pagina_2"], ["avatar_1", "secoes_pagina_2"],
        ["secoes_pagina_2", "landing_2"], ["oferta_1", "landing_2"],
        ["landing_1", "por_no_ar_1"], ["landing_2", "por_no_ar_1"],
        ["sequencia_mensagens_1", "por_no_ar_2"],
      ],
    ),
  },
];

// ------------------------------------------------------------------ v4 (ESPEC-LABORATORIO-v4.md, seção 3)

/** As categorias da galeria (lab_templates.categoria). */
export const CATEGORIAS_DOS_TEMPLATES = ["Funis", "Lançamento", "Criativos", "UGC e influência", "Marca", "Sites", "Mensagens", "Webinar", "Quiz"] as const;
export type CategoriaDoTemplate = typeof CATEGORIAS_DOS_TEMPLATES[number];

/** Categoria dos 13 oficiais de antes (v1 → Criativos, Marca e Sites; v2 → Funis, Marca e Criativos; v3 → Funis, Lançamento e Webinar). */
export const CATEGORIA_DOS_OFICIAIS: Record<string, CategoriaDoTemplate> = {
  "6c0a1b10-0000-4000-8000-000000000001": "Criativos",
  "6c0a1b10-0000-4000-8000-000000000002": "Criativos",
  "6c0a1b10-0000-4000-8000-000000000003": "Marca",
  "6c0a1b10-0000-4000-8000-000000000004": "Sites",
  "6c0a1b10-0000-4000-8000-000000000005": "Criativos",
  "6c0a1b10-0000-4000-8000-000000000006": "Criativos",
  "6c0a1b10-0000-4000-8000-000000000007": "Funis",
  "6c0a1b10-0000-4000-8000-000000000008": "Funis",
  "6c0a1b10-0000-4000-8000-000000000009": "Marca",
  "6c0a1b10-0000-4000-8000-00000000000a": "Criativos",
  "6c0a1b10-0000-4000-8000-00000000000b": "Funis",
  "6c0a1b10-0000-4000-8000-00000000000c": "Lançamento",
  "6c0a1b10-0000-4000-8000-00000000000d": "Webinar",
};

type Fio = [string, string] | [string, string, Gatilho];
export const COLUNA_DO_TEMPLATE = 360;
export const LINHA_DO_TEMPLATE = 210;

/**
 * Canvas da v4: nós e fios por apelido (ids estáveis), o gatilho no fio quando há; posições em colunas
 * pela profundidade (o maior caminho até o nó), da esquerda para a direita, e linhas na ordem da lista.
 */
function emColunas(nos: Array<[string, TipoDeNo, Record<string, unknown>]>, fios: Fio[]): Canvas {
  const base: Canvas = {
    nos: nos.map(([id, tipo, dados]): NoDoCanvas => ({ id, tipo, x: 0, y: 0, dados })),
    ligacoes: fios.map(([de, para, gatilho], i): Ligacao => (gatilho ? { id: `lig_${i + 1}`, de, para, gatilho } : { id: `lig_${i + 1}`, de, para })),
    viewport: vp,
  };
  const coluna = new Map<string, number>();
  for (const id of ordemTopologica(base)) {
    const antes = base.ligacoes.filter((l) => l.para === id).map((l) => (coluna.get(l.de) ?? 0) + 1);
    coluna.set(id, antes.length ? Math.max(...antes) : 0);
  }
  const linhas = new Map<number, number>();
  return {
    ...base,
    nos: base.nos.map((n) => {
      const c = coluna.get(n.id) ?? 0;
      const l = linhas.get(c) ?? 0;
      linhas.set(c, l + 1);
      return { ...n, x: 80 + c * COLUNA_DO_TEMPLATE, y: 100 + l * LINHA_DO_TEMPLATE };
    }),
  };
}

const ID_V4 = (n: number) => `6c0a1b10-0000-4000-8000-0000000000${(0x0e + n).toString(16).padStart(2, "0")}`;
const NO_AR_SITE = { titulo: "Publicar as páginas", alvo: "publicar_site" };
const NO_AR_MENSAGENS = { titulo: "Ligar automação e mensagens", alvo: "ligar_mensagens" };
const NO_AR_ANUNCIO = { titulo: "Subir o anúncio pausado", alvo: "subir_anuncio_pausado" };

/** Os 25 oficiais da v4 (ESPEC-LABORATORIO-v4.md, seção 3), semente da 20261020060000_laboratorio_v4.sql. */
export const TEMPLATES_OFICIAIS_V4: TemplateOficial[] = [
  {
    id: ID_V4(0),
    nome: "Funil de captura com isca digital",
    categoria: "Funis",
    descricao: "Isca grátis, página de captura, obrigado com WhatsApp, lead no CRM e e-mails de nutrição; no fim, o pedido para pôr no ar com a sua aprovação.",
    icone: "filter",
    canvas: emColunas(
      [
        ["cliente_1", "cliente", { titulo: "Cliente" }],
        ["marca_1", "marca", { titulo: "Marca" }],
        ["produto_1", "produto", { titulo: "Isca digital", nome: "", formato_produto: "ebook", preco: "Grátis" }],
        ["fontes_trafego_1", "fontes_trafego", { titulo: "Fontes de tráfego", canais: "instagram\nanuncio meta" }],
        ["copy_1", "copy", { titulo: "Copy da captura", formato: "landing" }],
        ["pagina_1", "pagina", { titulo: "Página de captura", tipo_pagina: "captura", caminho: "/isca", objetivo: "capturar" }],
        ["pagina_2", "pagina", { titulo: "Obrigado", tipo_pagina: "obrigado", caminho: "/obrigado", objetivo: "whatsapp", instrucao: "Confirma o envio da isca, pede para abrir o e-mail e chama para o WhatsApp." }],
        ["crm_1", "crm", { titulo: "Lead novo", pipeline: "Funil", etapa: "Lead novo", temperatura: "10" }],
        ["automacao_1", "automacao", { titulo: "Nutrição", quando: "formulario", objetivo_saida: "comprou", horario: "sim" }],
        ["email_1", "email", { titulo: "E-mails de nutrição", tipo_email: "sequencia", mensagens: 5, objetivo: "Entregar a isca, ensinar, quebrar a objeção principal e convidar para a oferta." }],
        ["por_no_ar_1", "por_no_ar", NO_AR_SITE],
        ["por_no_ar_2", "por_no_ar", NO_AR_MENSAGENS],
      ],
      [
        ["cliente_1", "copy_1"], ["marca_1", "copy_1"], ["produto_1", "copy_1"],
        ["copy_1", "pagina_1"], ["marca_1", "pagina_1"], ["fontes_trafego_1", "pagina_1"],
        ["pagina_1", "pagina_2", "enviou_formulario"], ["pagina_1", "crm_1", "enviou_formulario"], ["pagina_1", "automacao_1", "enviou_formulario"],
        ["automacao_1", "email_1"], ["produto_1", "email_1"],
        ["pagina_1", "por_no_ar_1"], ["pagina_2", "por_no_ar_1"],
        ["automacao_1", "por_no_ar_2"], ["email_1", "por_no_ar_2"], ["crm_1", "por_no_ar_2"],
      ],
    ),
  },
  {
    id: ID_V4(1),
    nome: "Funil low ticket com bump e upsell",
    categoria: "Funis",
    descricao: "Página de vendas, checkout com order bump, upsell de 1 clique, downsell, obrigado e recuperação do carrinho; no fim, o pedido para pôr no ar com a sua aprovação.",
    icone: "shopping-bag",
    canvas: emColunas(
      [
        ["pesquisa_1", "pesquisa", { titulo: "Pesquisa de mercado", tema: "Concorrentes, preços e promessas deste produto low ticket." }],
        ["produto_1", "produto", { titulo: "Produto", nome: "", formato_produto: "curso", preco: "" }],
        ["avatar_1", "avatar", { titulo: "Avatar" }],
        ["oferta_1", "oferta", { titulo: "Oferta principal" }],
        ["order_bump_1", "order_bump", { titulo: "Order bump" }],
        ["upsell_1", "upsell", { titulo: "Upsell" }],
        ["downsell_1", "downsell", { titulo: "Downsell" }],
        ["sequencia_ofertas_1", "sequencia_ofertas", { titulo: "Sequência de ofertas" }],
        ["pagina_1", "pagina", { titulo: "Página de vendas", tipo_pagina: "vendas", caminho: "/oferta", objetivo: "vender" }],
        ["checkout_1", "checkout", { titulo: "Checkout", gateway: "hotmart", link_pagamento: "", caminho: "/checkout" }],
        ["pagina_2", "pagina", { titulo: "Upsell", tipo_pagina: "upsell", caminho: "/upsell", objetivo: "vender" }],
        ["pagina_3", "pagina", { titulo: "Downsell", tipo_pagina: "downsell", caminho: "/downsell", objetivo: "vender" }],
        ["pagina_4", "pagina", { titulo: "Obrigado", tipo_pagina: "obrigado", caminho: "/obrigado", objetivo: "vender" }],
        ["recuperacao_1", "recuperacao", { titulo: "Carrinho abandonado", situacao: "carrinho_abandonado", via: "email", toques: 3 }],
        ["email_1", "email", { titulo: "E-mails de recuperação", tipo_email: "recuperacao", mensagens: 3, objetivo: "Trazer de volta quem abandonou o carrinho." }],
        ["dominio_1", "dominio", { titulo: "Domínio", dominio: "", estrutura: "caminho", registrador: "registro_br" }],
        ["por_no_ar_1", "por_no_ar", NO_AR_SITE],
        ["por_no_ar_2", "por_no_ar", NO_AR_MENSAGENS],
      ],
      [
        ["pesquisa_1", "avatar_1"], ["pesquisa_1", "oferta_1"], ["avatar_1", "oferta_1"], ["produto_1", "oferta_1"],
        ["oferta_1", "order_bump_1"], ["oferta_1", "upsell_1"], ["order_bump_1", "upsell_1"], ["oferta_1", "downsell_1"], ["upsell_1", "downsell_1"],
        ["oferta_1", "sequencia_ofertas_1"], ["order_bump_1", "sequencia_ofertas_1"], ["upsell_1", "sequencia_ofertas_1"], ["downsell_1", "sequencia_ofertas_1"],
        ["oferta_1", "pagina_1"], ["avatar_1", "pagina_1"], ["sequencia_ofertas_1", "pagina_1"],
        ["pagina_1", "checkout_1", "clicou_botao"], ["oferta_1", "checkout_1"], ["order_bump_1", "checkout_1"], ["produto_1", "checkout_1"],
        ["checkout_1", "pagina_2", "compra_aprovada"], ["upsell_1", "pagina_2"],
        ["pagina_2", "pagina_4", "upsell_aceito"], ["pagina_2", "pagina_3", "upsell_recusado"], ["downsell_1", "pagina_3"],
        ["pagina_3", "pagina_4", "upsell_aceito"],
        ["checkout_1", "recuperacao_1", "carrinho_abandonado"], ["recuperacao_1", "email_1"],
        ["pagina_1", "dominio_1"], ["checkout_1", "dominio_1"], ["pagina_2", "dominio_1"], ["pagina_3", "dominio_1"], ["pagina_4", "dominio_1"],
        ["pagina_1", "por_no_ar_1"], ["checkout_1", "por_no_ar_1"], ["pagina_2", "por_no_ar_1"], ["pagina_3", "por_no_ar_1"], ["pagina_4", "por_no_ar_1"], ["dominio_1", "por_no_ar_1"],
        ["recuperacao_1", "por_no_ar_2"], ["email_1", "por_no_ar_2"],
      ],
    ),
  },
  {
    id: ID_V4(2),
    nome: "VSL com checkout",
    categoria: "Funis",
    descricao: "Roteiro da VSL a partir dos documentos, página com o vídeo e o botão, checkout, obrigado e recuperação do Pix por WhatsApp.",
    icone: "clapperboard",
    canvas: emColunas(
      [
        ["arquivo_1", "arquivo", { titulo: "Roteiro e depoimentos", uso: "depoimentos" }],
        ["produto_1", "produto", { titulo: "Produto" }],
        ["video_1", "video", { titulo: "Vídeo da VSL", link: "" }],
        ["oferta_1", "oferta", { titulo: "Oferta" }],
        ["copy_1", "copy", { titulo: "Roteiro da VSL", formato: "roteiro_curto" }],
        ["pagina_1", "pagina", { titulo: "VSL", tipo_pagina: "vsl", caminho: "/vsl", objetivo: "vender", instrucao: "O botão de compra aparece abaixo do vídeo." }],
        ["checkout_1", "checkout", { titulo: "Checkout", gateway: "kiwify", link_pagamento: "", caminho: "/checkout" }],
        ["pagina_2", "pagina", { titulo: "Obrigado", tipo_pagina: "obrigado", caminho: "/obrigado", objetivo: "vender" }],
        ["recuperacao_1", "recuperacao", { titulo: "Pix não pago", situacao: "pix_pendente", via: "whatsapp", toques: 2 }],
        ["whatsapp_1", "whatsapp", { titulo: "Lembrete do Pix", via: "cloud_api", tipo_mensagem: "modelo", mensagens: 2, categoria: "utilidade", objetivo: "Lembrar o Pix gerado com o link para pagar." }],
        ["por_no_ar_1", "por_no_ar", NO_AR_SITE],
        ["por_no_ar_2", "por_no_ar", NO_AR_MENSAGENS],
      ],
      [
        ["produto_1", "oferta_1"], ["arquivo_1", "oferta_1"],
        ["oferta_1", "copy_1"], ["arquivo_1", "copy_1"],
        ["copy_1", "pagina_1"], ["video_1", "pagina_1"], ["arquivo_1", "pagina_1"], ["oferta_1", "pagina_1"],
        ["pagina_1", "checkout_1", "clicou_botao"], ["oferta_1", "checkout_1"],
        ["checkout_1", "pagina_2", "compra_aprovada"],
        ["checkout_1", "recuperacao_1", "pix_gerado"], ["recuperacao_1", "whatsapp_1"],
        ["pagina_1", "por_no_ar_1"], ["checkout_1", "por_no_ar_1"], ["pagina_2", "por_no_ar_1"],
        ["recuperacao_1", "por_no_ar_2"], ["whatsapp_1", "por_no_ar_2"],
      ],
    ),
  },
  {
    id: ID_V4(3),
    nome: "Teste A/B de página de vendas",
    categoria: "Funis",
    descricao: "Duas versões da mesma página com uma variável só (o título), divisão 50/50 e a compra como métrica; a vencedora fica congelada no fim.",
    icone: "copy",
    canvas: emColunas(
      [
        ["contexto_1", "contexto", { titulo: "Pedido", texto: "Produto, público e o que mudar entre as versões (uma variável por vez)." }],
        ["fontes_trafego_1", "fontes_trafego", { titulo: "Fontes de tráfego", canais: "anuncio meta" }],
        ["oferta_1", "oferta", { titulo: "Oferta" }],
        ["copy_1", "copy", { titulo: "Copy da página", formato: "landing" }],
        ["pagina_1", "pagina", { titulo: "Versão A", tipo_pagina: "vendas", caminho: "/vendas-a", objetivo: "vender" }],
        ["pagina_2", "pagina", { titulo: "Versão B", tipo_pagina: "vendas", caminho: "/vendas-b", objetivo: "vender", instrucao: "Mesma página da versão A; só o título muda (outro ângulo)." }],
        ["teste_ab_1", "teste_ab", { titulo: "Teste A/B", pesos: "50/50", variavel: "titulo", metrica: "compra", limite: "sem_limite" }],
        ["checkout_1", "checkout", { titulo: "Checkout", gateway: "hotmart", link_pagamento: "", caminho: "/checkout" }],
        ["por_no_ar_1", "por_no_ar", NO_AR_SITE],
      ],
      [
        ["contexto_1", "oferta_1"], ["oferta_1", "copy_1"],
        ["copy_1", "pagina_1"], ["oferta_1", "pagina_1"], ["copy_1", "pagina_2"], ["oferta_1", "pagina_2"],
        ["pagina_1", "teste_ab_1"], ["pagina_2", "teste_ab_1"], ["fontes_trafego_1", "teste_ab_1"],
        ["pagina_1", "checkout_1", "clicou_botao"], ["pagina_2", "checkout_1", "clicou_botao"], ["oferta_1", "checkout_1"],
        ["teste_ab_1", "por_no_ar_1"], ["pagina_1", "por_no_ar_1"], ["pagina_2", "por_no_ar_1"], ["checkout_1", "por_no_ar_1"],
      ],
    ),
  },
  {
    id: ID_V4(4),
    nome: "Perpétuo com prazo por lead",
    categoria: "Funis",
    descricao: "Captura, 3 e-mails até o prazo vencer, página de vendas com o contador de cada pessoa e saída do fluxo na compra.",
    icone: "workflow",
    canvas: emColunas(
      [
        ["contexto_1", "contexto", { titulo: "Pedido", texto: "Produto, preço e o prazo da condição por pessoa (ex.: 72 h depois da captura)." }],
        ["oferta_1", "oferta", { titulo: "Oferta com prazo" }],
        ["pagina_1", "pagina", { titulo: "Captura", tipo_pagina: "captura", caminho: "/aula", objetivo: "capturar" }],
        ["automacao_1", "automacao", { titulo: "Prazo de 72 h por lead", quando: "formulario", espera: "72 h contadas da captura de cada pessoa", objetivo_saida: "comprou", horario: "nao" }],
        ["email_1", "email", { titulo: "3 toques até o prazo", tipo_email: "sequencia", mensagens: 3, objetivo: "Levar à oferta antes do prazo de cada pessoa vencer." }],
        ["pagina_2", "pagina", { titulo: "Vendas com contador", tipo_pagina: "vendas", caminho: "/oferta", objetivo: "vender", instrucao: "Contador com o prazo da pessoa (72 h desde a captura)." }],
        ["checkout_1", "checkout", { titulo: "Checkout", gateway: "hotmart", link_pagamento: "", caminho: "/checkout" }],
        ["automacao_2", "automacao", { titulo: "Sai do fluxo na compra", quando: "compra_aprovada", objetivo_saida: "comprou", horario: "nao" }],
        ["por_no_ar_1", "por_no_ar", NO_AR_SITE],
        ["por_no_ar_2", "por_no_ar", NO_AR_MENSAGENS],
      ],
      [
        ["contexto_1", "oferta_1"], ["oferta_1", "pagina_1"],
        ["pagina_1", "automacao_1", "enviou_formulario"], ["automacao_1", "email_1"], ["oferta_1", "email_1"],
        ["pagina_1", "pagina_2", "enviou_formulario"], ["oferta_1", "pagina_2"],
        ["pagina_2", "checkout_1", "clicou_botao"], ["oferta_1", "checkout_1"],
        ["checkout_1", "automacao_2", "compra_aprovada"],
        ["pagina_1", "por_no_ar_1"], ["pagina_2", "por_no_ar_1"], ["checkout_1", "por_no_ar_1"],
        ["automacao_1", "por_no_ar_2"], ["email_1", "por_no_ar_2"], ["automacao_2", "por_no_ar_2"],
      ],
    ),
  },
  {
    id: ID_V4(5),
    nome: "Lançamento com abertura e fechamento de carrinho",
    categoria: "Lançamento",
    descricao: "Aquecimento e anúncio pausado, captura para a lista, CPLs por e-mail e WhatsApp, página de vendas no carrinho aberto e recuperação.",
    icone: "rocket",
    canvas: emColunas(
      [
        ["pesquisa_1", "pesquisa", { titulo: "Pesquisa", tema: "Lançamentos parecidos, promessas, objeções e ângulos deste público." }],
        ["avatar_1", "avatar", { titulo: "Avatar" }],
        ["oferta_1", "oferta", { titulo: "Oferta do lançamento" }],
        ["carrossel_1", "carrossel", { titulo: "Aquecimento", tema: "Aquecimento do lançamento: o problema, a virada e o convite.", laminas: 6 }],
        ["copy_1", "copy", { titulo: "Copy do anúncio", formato: "anuncio" }],
        ["pagina_1", "pagina", { titulo: "Captura do lançamento", tipo_pagina: "captura", caminho: "/inscricao", objetivo: "capturar" }],
        ["anuncio_1", "anuncio", { titulo: "Anúncio de captação", objetivo: "inscritos" }],
        ["crm_1", "crm", { titulo: "Lista do lançamento", pipeline: "Lançamento", etapa: "Lista do lançamento", temperatura: "20" }],
        ["automacao_1", "automacao", { titulo: "Sequência do lançamento", quando: "formulario", objetivo_saida: "comprou", horario: "sim" }],
        ["email_1", "email", { titulo: "CPLs por e-mail", tipo_email: "sequencia", mensagens: 6, objetivo: "CPL 1 a 3, abertura do carrinho, lembrete e fechamento." }],
        ["whatsapp_1", "whatsapp", { titulo: "Modelos do lançamento", via: "cloud_api", tipo_mensagem: "modelo", mensagens: 5, categoria: "marketing", objetivo: "Avisar de cada CPL, da abertura e do fechamento do carrinho." }],
        ["pagina_2", "pagina", { titulo: "Vendas (carrinho aberto)", tipo_pagina: "vendas", caminho: "/carrinho", objetivo: "vender", instrucao: "Abre na data do carrinho; mostra o prazo de fechamento." }],
        ["checkout_1", "checkout", { titulo: "Checkout", gateway: "hotmart", link_pagamento: "", caminho: "/checkout" }],
        ["recuperacao_1", "recuperacao", { titulo: "Carrinho abandonado", situacao: "carrinho_abandonado", via: "ambos", toques: 3 }],
        ["por_no_ar_1", "por_no_ar", NO_AR_SITE],
        ["por_no_ar_2", "por_no_ar", NO_AR_ANUNCIO],
        ["por_no_ar_3", "por_no_ar", NO_AR_MENSAGENS],
      ],
      [
        ["pesquisa_1", "avatar_1"], ["pesquisa_1", "oferta_1"], ["avatar_1", "oferta_1"],
        ["oferta_1", "carrossel_1"], ["avatar_1", "carrossel_1"], ["oferta_1", "copy_1"], ["avatar_1", "copy_1"],
        ["oferta_1", "pagina_1"], ["avatar_1", "pagina_1"],
        ["copy_1", "anuncio_1"], ["carrossel_1", "anuncio_1"], ["pagina_1", "anuncio_1"],
        ["pagina_1", "crm_1", "enviou_formulario"], ["pagina_1", "automacao_1", "enviou_formulario"],
        ["automacao_1", "email_1"], ["oferta_1", "email_1"], ["automacao_1", "whatsapp_1"], ["oferta_1", "whatsapp_1"],
        ["oferta_1", "pagina_2"], ["pagina_2", "checkout_1", "clicou_botao"], ["oferta_1", "checkout_1"],
        ["checkout_1", "recuperacao_1", "carrinho_abandonado"],
        ["pagina_1", "por_no_ar_1"], ["pagina_2", "por_no_ar_1"], ["checkout_1", "por_no_ar_1"],
        ["anuncio_1", "por_no_ar_2"], ["carrossel_1", "por_no_ar_2"],
        ["automacao_1", "por_no_ar_3"], ["email_1", "por_no_ar_3"], ["whatsapp_1", "por_no_ar_3"], ["recuperacao_1", "por_no_ar_3"], ["crm_1", "por_no_ar_3"],
      ],
    ),
  },
  {
    id: ID_V4(6),
    nome: "Lançamento relâmpago (meteórico)",
    categoria: "Lançamento",
    descricao: "Captura para o grupo de WhatsApp, 3 dias de conteúdo em modelos, stories editáveis e a oferta de 24 h com checkout.",
    icone: "rocket",
    canvas: emColunas(
      [
        ["contexto_1", "contexto", { titulo: "Pedido", texto: "Produto, preço da oferta de 24 h, datas dos 3 dias e o link do grupo." }],
        ["oferta_1", "oferta", { titulo: "Oferta de 24 h" }],
        ["pagina_1", "pagina", { titulo: "Captura para o grupo", tipo_pagina: "captura", caminho: "/grupo", objetivo: "whatsapp" }],
        ["whatsapp_1", "whatsapp", { titulo: "Roteiro de 3 dias", via: "cloud_api", tipo_mensagem: "modelo", mensagens: 6, categoria: "marketing", objetivo: "3 dias de conteúdo no grupo e a abertura da oferta de 24 h." }],
        ["copy_1", "copy", { titulo: "Stories D1 a D3", formato: "roteiro_curto" }],
        ["template_designer_1", "template_designer", { titulo: "Stories editáveis", formato_arte: "story_9_16", campos_variaveis: "titulo, contagem", lote: "nao" }],
        ["pagina_2", "pagina", { titulo: "Vendas 24 h", tipo_pagina: "vendas", caminho: "/24h", objetivo: "vender" }],
        ["checkout_1", "checkout", { titulo: "Checkout", gateway: "kiwify", link_pagamento: "", caminho: "/checkout" }],
        ["por_no_ar_1", "por_no_ar", NO_AR_SITE],
        ["por_no_ar_2", "por_no_ar", NO_AR_MENSAGENS],
      ],
      [
        ["contexto_1", "oferta_1"], ["oferta_1", "pagina_1"],
        ["pagina_1", "whatsapp_1", "enviou_formulario"], ["oferta_1", "whatsapp_1"],
        ["oferta_1", "copy_1"], ["copy_1", "template_designer_1"],
        ["oferta_1", "pagina_2"], ["pagina_2", "checkout_1", "clicou_botao"], ["oferta_1", "checkout_1"],
        ["pagina_1", "por_no_ar_1"], ["pagina_2", "por_no_ar_1"], ["checkout_1", "por_no_ar_1"],
        ["whatsapp_1", "por_no_ar_2"],
      ],
    ),
  },
  {
    id: ID_V4(7),
    nome: "Webinar gravado com oferta no minuto",
    categoria: "Webinar",
    descricao: "Inscrição, sala com a oferta no minuto marcado, lembretes, checkout e replay com prazo; no fim, o pedido para pôr no ar com a sua aprovação.",
    icone: "presentation",
    canvas: emColunas(
      [
        ["produto_1", "produto", { titulo: "Produto" }],
        ["fontes_trafego_1", "fontes_trafego", { titulo: "Fontes de tráfego", canais: "anuncio meta\ninstagram\nemail" }],
        ["oferta_1", "oferta", { titulo: "Oferta do webinar" }],
        ["webinar_1", "webinar", { titulo: "Webinar", modo: "gravado", minuto_oferta: "45:00", encerramento: "ultima_chamada", caminho: "/aula" }],
        ["email_1", "email", { titulo: "Lembretes", tipo_email: "lembrete_webinar", mensagens: 4, objetivo: "1 dia antes, 1 hora antes, começou e replay." }],
        ["checkout_1", "checkout", { titulo: "Checkout", gateway: "hotmart", link_pagamento: "", caminho: "/checkout" }],
        ["pagina_1", "pagina", { titulo: "Obrigado", tipo_pagina: "obrigado", caminho: "/obrigado", objetivo: "vender" }],
        ["por_no_ar_1", "por_no_ar", NO_AR_SITE],
        ["por_no_ar_2", "por_no_ar", NO_AR_MENSAGENS],
      ],
      [
        ["produto_1", "oferta_1"], ["oferta_1", "webinar_1"], ["produto_1", "webinar_1"], ["fontes_trafego_1", "webinar_1"],
        ["webinar_1", "email_1"], ["webinar_1", "checkout_1", "clicou_botao"], ["oferta_1", "checkout_1"],
        ["checkout_1", "pagina_1", "compra_aprovada"],
        ["webinar_1", "por_no_ar_1"], ["checkout_1", "por_no_ar_1"], ["pagina_1", "por_no_ar_1"],
        ["email_1", "por_no_ar_2"],
      ],
    ),
  },
  {
    id: ID_V4(8),
    nome: "Webinar just in time",
    categoria: "Webinar",
    descricao: "A sessão começa logo depois da inscrição (bom para tráfego frio), inscritos no CRM, replay para quem não assistiu e checkout.",
    icone: "presentation",
    canvas: emColunas(
      [
        ["contexto_1", "contexto", { titulo: "Pedido", texto: "Tema da aula, produto e preço da oferta." }],
        ["video_1", "video", { titulo: "Aula gravada", link: "" }],
        ["oferta_1", "oferta", { titulo: "Oferta" }],
        ["webinar_1", "webinar", { titulo: "Webinar just in time", modo: "just_in_time", minuto_oferta: "30:00", encerramento: "replay", caminho: "/aula" }],
        ["crm_1", "crm", { titulo: "Inscritos", pipeline: "Webinar", etapa: "Inscritos", temperatura: "15" }],
        ["email_1", "email", { titulo: "Replay para quem não assistiu", tipo_email: "lembrete_webinar", mensagens: 2, objetivo: "Mandar o replay com prazo para quem não assistiu até o fim." }],
        ["checkout_1", "checkout", { titulo: "Checkout", gateway: "hotmart", link_pagamento: "", caminho: "/checkout" }],
        ["por_no_ar_1", "por_no_ar", NO_AR_SITE],
        ["por_no_ar_2", "por_no_ar", NO_AR_MENSAGENS],
      ],
      [
        ["contexto_1", "oferta_1"], ["video_1", "webinar_1"], ["oferta_1", "webinar_1"],
        ["webinar_1", "crm_1", "enviou_formulario"], ["webinar_1", "email_1"], ["webinar_1", "checkout_1", "clicou_botao"], ["oferta_1", "checkout_1"],
        ["webinar_1", "por_no_ar_1"], ["checkout_1", "por_no_ar_1"],
        ["email_1", "por_no_ar_2"], ["crm_1", "por_no_ar_2"],
      ],
    ),
  },
  {
    id: ID_V4(9),
    nome: "Quiz de qualificação para high ticket",
    categoria: "Quiz",
    descricao: "Quiz com pontuação: quem passa vai para a agenda com o closer (e sobe a temperatura no CRM); quem não passa vai para a isca e os e-mails.",
    icone: "gem",
    canvas: emColunas(
      [
        ["contexto_1", "contexto", { titulo: "Pedido", texto: "Serviço high ticket, para quem é, faixa de preço e o que qualifica um cliente." }],
        ["avatar_1", "avatar", { titulo: "Avatar" }],
        ["oferta_1", "oferta", { titulo: "Oferta high ticket" }],
        ["quiz_1", "quiz", { titulo: "Quiz de qualificação", perguntas: 8, faixas: "alta = agenda com o closer; média = conteúdo e convite; baixa = isca", captura: "antes_resultado", caminho: "/diagnostico" }],
        ["pagina_1", "pagina", { titulo: "Agendar", tipo_pagina: "agendar", caminho: "/agendar", objetivo: "agendar" }],
        ["crm_1", "crm", { titulo: "Agendou", pipeline: "High ticket", etapa: "Agendou", temperatura: "40" }],
        ["pagina_2", "pagina", { titulo: "Isca", tipo_pagina: "captura", caminho: "/isca", objetivo: "capturar" }],
        ["email_1", "email", { titulo: "Nutrição", tipo_email: "sequencia", mensagens: 5, objetivo: "Nutrir quem ainda não está pronto até o próximo diagnóstico." }],
        ["por_no_ar_1", "por_no_ar", NO_AR_SITE],
        ["por_no_ar_2", "por_no_ar", NO_AR_MENSAGENS],
      ],
      [
        ["contexto_1", "avatar_1"], ["contexto_1", "oferta_1"], ["avatar_1", "oferta_1"],
        ["avatar_1", "quiz_1"], ["oferta_1", "quiz_1"],
        ["quiz_1", "pagina_1", "faixa_alta"], ["pagina_1", "crm_1", "enviou_formulario"],
        ["quiz_1", "pagina_2", "faixa_baixa"], ["pagina_2", "email_1", "enviou_formulario"],
        ["quiz_1", "por_no_ar_1"], ["pagina_1", "por_no_ar_1"], ["pagina_2", "por_no_ar_1"],
        ["email_1", "por_no_ar_2"], ["crm_1", "por_no_ar_2"],
      ],
    ),
  },
  {
    id: ID_V4(10),
    nome: "Quiz que recomenda o produto certo",
    categoria: "Quiz",
    descricao: "Cada faixa do resultado leva à oferta que combina com ela, com o próprio checkout; quem conclui o quiz sobe a temperatura no CRM.",
    icone: "filter",
    canvas: emColunas(
      [
        ["produto_1", "produto", { titulo: "Produtos (3 ofertas)", entregavel: "Descreva as 3 ofertas e para quem é cada uma." }],
        ["quiz_1", "quiz", { titulo: "Qual é o seu caso?", perguntas: 6, faixas: "cada faixa = o perfil de uma das 3 ofertas", captura: "antes_resultado", caminho: "/quiz" }],
        ["pagina_1", "pagina", { titulo: "Oferta A", tipo_pagina: "vendas", caminho: "/oferta-a", objetivo: "vender" }],
        ["pagina_2", "pagina", { titulo: "Oferta B", tipo_pagina: "vendas", caminho: "/oferta-b", objetivo: "vender" }],
        ["pagina_3", "pagina", { titulo: "Oferta C", tipo_pagina: "vendas", caminho: "/oferta-c", objetivo: "vender" }],
        ["checkout_1", "checkout", { titulo: "Checkout A", gateway: "hotmart", link_pagamento: "", caminho: "/checkout-a" }],
        ["checkout_2", "checkout", { titulo: "Checkout B", gateway: "hotmart", link_pagamento: "", caminho: "/checkout-b" }],
        ["checkout_3", "checkout", { titulo: "Checkout C", gateway: "hotmart", link_pagamento: "", caminho: "/checkout-c" }],
        ["crm_1", "crm", { titulo: "Concluiu o quiz", pipeline: "Funil", etapa: "Quiz concluído", temperatura: "20" }],
        ["por_no_ar_1", "por_no_ar", NO_AR_SITE],
      ],
      [
        ["produto_1", "quiz_1"],
        ["quiz_1", "pagina_1", "faixa_alta"], ["quiz_1", "pagina_2", "faixa_media"], ["quiz_1", "pagina_3", "faixa_baixa"],
        ["produto_1", "pagina_1"], ["produto_1", "pagina_2"], ["produto_1", "pagina_3"],
        ["pagina_1", "checkout_1", "clicou_botao"], ["pagina_2", "checkout_2", "clicou_botao"], ["pagina_3", "checkout_3", "clicou_botao"],
        ["quiz_1", "crm_1", "quiz_concluido"],
        ["quiz_1", "por_no_ar_1"], ["pagina_1", "por_no_ar_1"], ["pagina_2", "por_no_ar_1"], ["pagina_3", "por_no_ar_1"],
        ["checkout_1", "por_no_ar_1"], ["checkout_2", "por_no_ar_1"], ["checkout_3", "por_no_ar_1"], ["crm_1", "por_no_ar_1"],
      ],
    ),
  },
  {
    id: ID_V4(11),
    nome: "Quiz para anúncio de serviço local",
    categoria: "Quiz",
    descricao: "Quiz curto (serviço, prazo, bairro e orçamento) que vira pedido de orçamento no CRM e aviso para a equipe, com o anúncio pausado.",
    icone: "megaphone",
    canvas: emColunas(
      [
        ["cliente_1", "cliente", { titulo: "Cliente" }],
        ["quiz_1", "quiz", { titulo: "Orçamento rápido", perguntas: 5, objetivo: "Serviço, prazo, bairro e orçamento de quem pede.", captura: "fim", caminho: "/orcamento" }],
        ["copy_1", "copy", { titulo: "Copy do anúncio", formato: "anuncio" }],
        ["crm_1", "crm", { titulo: "Orçamento pedido", pipeline: "Serviços", etapa: "Orçamento pedido", temperatura: "30" }],
        ["automacao_1", "automacao", { titulo: "Aviso para a equipe", quando: "quiz", condicoes: "Avisar a equipe com o resumo do pedido; responder em até 1 hora no horário comercial.", objetivo_saida: "atendente", horario: "sim" }],
        ["anuncio_1", "anuncio", { titulo: "Anúncio local", objetivo: "pedidos de orçamento" }],
        ["por_no_ar_1", "por_no_ar", NO_AR_SITE],
        ["por_no_ar_2", "por_no_ar", NO_AR_ANUNCIO],
        ["por_no_ar_3", "por_no_ar", NO_AR_MENSAGENS],
      ],
      [
        ["cliente_1", "quiz_1"], ["cliente_1", "copy_1"],
        ["quiz_1", "crm_1", "quiz_concluido"], ["quiz_1", "automacao_1", "quiz_concluido"],
        ["copy_1", "anuncio_1"], ["quiz_1", "anuncio_1"],
        ["quiz_1", "por_no_ar_1"], ["anuncio_1", "por_no_ar_2"], ["automacao_1", "por_no_ar_3"], ["crm_1", "por_no_ar_3"],
      ],
    ),
  },
  {
    id: ID_V4(12),
    nome: "Criativos UGC em lote",
    categoria: "UGC e influência",
    descricao: "Um personagem fixo protagoniza 3 UGCs com ganchos diferentes (depoimento, problema e solução, unboxing) que viram o anúncio pausado.",
    icone: "image",
    canvas: emColunas(
      [
        ["produto_1", "produto", { titulo: "Produto" }],
        ["influenciador_1", "influenciador", { titulo: "Personagem", poses: 4 }],
        ["ugc_1", "ugc", { titulo: "UGC depoimento", estilo_ugc: "depoimento", duracao: 20, variacoes: 1 }],
        ["ugc_2", "ugc", { titulo: "UGC problema e solução", estilo_ugc: "problema_solucao", duracao: 20, variacoes: 1 }],
        ["ugc_3", "ugc", { titulo: "UGC unboxing", estilo_ugc: "unboxing", duracao: 20, variacoes: 1 }],
        ["anuncio_1", "anuncio", { titulo: "Anúncio" }],
        ["por_no_ar_1", "por_no_ar", NO_AR_ANUNCIO],
      ],
      [
        ["produto_1", "influenciador_1"],
        ["produto_1", "ugc_1"], ["produto_1", "ugc_2"], ["produto_1", "ugc_3"],
        ["influenciador_1", "ugc_1"], ["influenciador_1", "ugc_2"], ["influenciador_1", "ugc_3"],
        ["ugc_1", "anuncio_1"], ["ugc_2", "anuncio_1"], ["ugc_3", "anuncio_1"],
        ["anuncio_1", "por_no_ar_1"], ["ugc_1", "por_no_ar_1"], ["ugc_2", "por_no_ar_1"], ["ugc_3", "por_no_ar_1"],
      ],
    ),
  },
  {
    id: ID_V4(13),
    nome: "Influenciador digital do zero",
    categoria: "UGC e influência",
    descricao: "Cria o personagem fictício, a ficha e 8 fotos consistentes; o post de apresentação e o carrossel \"quem sou eu\" vão para a Agenda com aprovação.",
    icone: "image",
    canvas: emColunas(
      [
        ["contexto_1", "contexto", { titulo: "Pedido", texto: "Para que serve o personagem, o nicho e o jeito dele." }],
        ["marca_1", "marca", { titulo: "Marca" }],
        ["influenciador_1", "influenciador", { titulo: "Personagem", poses: 8 }],
        ["imagem_1", "imagem", { titulo: "Post de apresentação", prompt: "Post de apresentação do personagem, com a cara da marca.", proporcao: "4:5" }],
        ["carrossel_1", "carrossel", { titulo: "Quem sou eu", tema: "Quem sou eu: o personagem se apresenta.", laminas: 5 }],
        ["copy_1", "copy", { titulo: "Legenda", formato: "legenda" }],
        ["por_no_ar_1", "por_no_ar", { titulo: "Agendar no Instagram", alvo: "outro", instrucao: "Agendar o post e o carrossel no Instagram da marca pela Agenda, com a legenda ligada." }],
      ],
      [
        ["contexto_1", "influenciador_1"], ["marca_1", "influenciador_1"],
        ["influenciador_1", "imagem_1"], ["marca_1", "imagem_1"], ["influenciador_1", "carrossel_1"], ["marca_1", "carrossel_1"],
        ["contexto_1", "copy_1"], ["influenciador_1", "copy_1"],
        ["imagem_1", "por_no_ar_1"], ["carrossel_1", "por_no_ar_1"], ["copy_1", "por_no_ar_1"],
      ],
    ),
  },
  {
    id: ID_V4(14),
    nome: "Reel com avatar falante",
    categoria: "UGC e influência",
    descricao: "Pesquisa de tendência, roteiro curto e o UGC de 30 s com o personagem fixo; o vídeo sai na Mesa Vídeos e o Reel vai para a Agenda com aprovação.",
    icone: "clapperboard",
    canvas: emColunas(
      [
        ["pesquisa_1", "pesquisa", { titulo: "Tendência", tema: "O que está em alta no nicho esta semana (formatos e ganchos de Reels)." }],
        ["copy_1", "copy", { titulo: "Roteiro", formato: "roteiro_curto" }],
        ["influenciador_1", "influenciador", { titulo: "Personagem", poses: 4 }],
        ["ugc_1", "ugc", { titulo: "Reel de 30 s", estilo_ugc: "reacao", duracao: 30, variacoes: 1 }],
        ["por_no_ar_1", "por_no_ar", { titulo: "Reel na Agenda", alvo: "outro", instrucao: "Montar o Reel na Mesa Vídeos com o roteiro e o personagem, e agendar no Instagram pela Agenda." }],
      ],
      [
        ["pesquisa_1", "copy_1"], ["pesquisa_1", "influenciador_1"], ["copy_1", "ugc_1"], ["influenciador_1", "ugc_1"], ["ugc_1", "por_no_ar_1"],
      ],
    ),
  },
  {
    id: ID_V4(15),
    nome: "Variação de criativos estáticos",
    categoria: "Criativos",
    descricao: "Um anúncio vencedor de referência vira 6 variações na mesma base comum, prontas para o anúncio pausado.",
    icone: "copy",
    canvas: emColunas(
      [
        ["referencias_1", "referencias", { titulo: "Anúncio vencedor", links: "", o_que_aproveitar: "A estrutura e o gancho do anúncio que mais vendeu." }],
        ["config_1", "config", { titulo: "Formato", proporcao: "4:5", quantidade: 3, qualidade: "media" }],
        ["gravity_1", "gravity", { titulo: "Base comum", prompt_base: "Mesma estrutura do anúncio vencedor, com a marca do cliente; uma mensagem por arte." }],
        ["imagem_1", "imagem", { titulo: "Variações 1 a 3", quantidade: 3 }],
        ["imagem_2", "imagem", { titulo: "Variações 4 a 6", quantidade: 3, prompt: "Outro ângulo de copy, mesma estrutura." }],
        ["anuncio_1", "anuncio", { titulo: "Anúncio" }],
        ["por_no_ar_1", "por_no_ar", NO_AR_ANUNCIO],
      ],
      [
        ["referencias_1", "gravity_1"], ["referencias_1", "imagem_1"], ["referencias_1", "imagem_2"],
        ["config_1", "imagem_1"], ["config_1", "imagem_2"], ["gravity_1", "imagem_1"], ["gravity_1", "imagem_2"],
        ["imagem_1", "anuncio_1"], ["imagem_2", "anuncio_1"], ["referencias_1", "anuncio_1"],
        ["anuncio_1", "por_no_ar_1"], ["imagem_1", "por_no_ar_1"], ["imagem_2", "por_no_ar_1"],
      ],
    ),
  },
  {
    id: ID_V4(16),
    nome: "Kit de anúncio completo",
    categoria: "Criativos",
    descricao: "Copy, 3 estáticos, 1 carrossel e 1 UGC para o mesmo ângulo, fechando no anúncio que sobe pausado.",
    icone: "megaphone",
    canvas: emColunas(
      [
        ["pesquisa_1", "pesquisa", { titulo: "Pesquisa", tema: "Ângulos que funcionam para este público e concorrentes anunciando." }],
        ["avatar_1", "avatar", { titulo: "Avatar" }],
        ["oferta_1", "oferta", { titulo: "Oferta" }],
        ["copy_1", "copy", { titulo: "Copy do anúncio", formato: "anuncio" }],
        ["gravity_1", "gravity", { titulo: "Base comum", prompt_base: "Mesmo ângulo e mesma família visual em todas as peças." }],
        ["imagem_1", "imagem", { titulo: "3 estáticos", quantidade: 3, proporcao: "4:5" }],
        ["carrossel_1", "carrossel", { titulo: "Carrossel", laminas: 5 }],
        ["ugc_1", "ugc", { titulo: "UGC", estilo_ugc: "problema_solucao", duracao: 20, variacoes: 1 }],
        ["anuncio_1", "anuncio", { titulo: "Anúncio" }],
        ["por_no_ar_1", "por_no_ar", NO_AR_ANUNCIO],
      ],
      [
        ["pesquisa_1", "avatar_1"], ["pesquisa_1", "oferta_1"], ["avatar_1", "oferta_1"],
        ["oferta_1", "copy_1"], ["avatar_1", "copy_1"], ["copy_1", "gravity_1"],
        ["gravity_1", "imagem_1"], ["gravity_1", "carrossel_1"], ["gravity_1", "ugc_1"],
        ["oferta_1", "imagem_1"], ["oferta_1", "carrossel_1"], ["oferta_1", "ugc_1"],
        ["copy_1", "anuncio_1"], ["imagem_1", "anuncio_1"], ["carrossel_1", "anuncio_1"], ["ugc_1", "anuncio_1"],
        ["anuncio_1", "por_no_ar_1"], ["imagem_1", "por_no_ar_1"], ["carrossel_1", "por_no_ar_1"], ["ugc_1", "por_no_ar_1"],
      ],
    ),
  },
  {
    id: ID_V4(17),
    nome: "Template editável da marca",
    categoria: "Criativos",
    descricao: "Modelo de post com camadas editáveis (título, preço, foto) e o lote gerado a partir de uma planilha, uma arte por linha.",
    icone: "layers",
    canvas: emColunas(
      [
        ["marca_1", "marca", { titulo: "Marca" }],
        ["referencias_1", "referencias", { titulo: "Referências", links: "", o_que_aproveitar: "Estilo dos posts que a marca quer seguir." }],
        ["arquivo_1", "arquivo", { titulo: "Planilha do lote", uso: "planilha" }],
        ["template_designer_1", "template_designer", { titulo: "Modelo", formato_arte: "feed_4_5", campos_variaveis: "titulo, preco, foto", lote: "nao" }],
        ["template_designer_2", "template_designer", { titulo: "Lote da planilha", formato_arte: "feed_4_5", campos_variaveis: "titulo, preco, foto", lote: "planilha" }],
      ],
      [
        ["marca_1", "template_designer_1"], ["referencias_1", "template_designer_1"],
        ["marca_1", "template_designer_2"], ["referencias_1", "template_designer_2"], ["arquivo_1", "template_designer_2"],
      ],
    ),
  },
  {
    id: ID_V4(18),
    nome: "Fotos de produto em cena",
    categoria: "Criativos",
    descricao: "A foto simples do produto vira cenas de catálogo e anúncio na mesma base comum, mais a embalagem aplicada.",
    icone: "image",
    canvas: emColunas(
      [
        ["midia_1", "midia", { titulo: "Foto do produto" }],
        ["config_1", "config", { titulo: "Formato", proporcao: "4:5", quantidade: 3, qualidade: "alta" }],
        ["gravity_1", "gravity", { titulo: "Produto + cenário", prompt_base: "O produto da foto, igual, em cenários de catálogo com luz de estúdio." }],
        ["imagem_1", "imagem", { titulo: "Cenas 1 a 3", quantidade: 3 }],
        ["imagem_2", "imagem", { titulo: "Cenas 4 a 6", quantidade: 3, prompt: "Cenários de uso no dia a dia." }],
        ["imagem_3", "imagem", { titulo: "Embalagem (mockup)", quantidade: 1, prompt: "O produto e a embalagem numa cena de mockup limpa." }],
      ],
      [
        ["midia_1", "gravity_1"], ["midia_1", "imagem_1"], ["midia_1", "imagem_2"], ["midia_1", "imagem_3"],
        ["gravity_1", "imagem_1"], ["gravity_1", "imagem_2"], ["gravity_1", "imagem_3"],
        ["config_1", "imagem_1"], ["config_1", "imagem_2"], ["config_1", "imagem_3"],
      ],
    ),
  },
  {
    id: ID_V4(19),
    nome: "Identidade visual completa",
    categoria: "Marca",
    descricao: "Pesquisa, posicionamento, logo (o Jev aponta a melhor), mockups, template da marca e o filme.",
    icone: "pen-tool",
    canvas: emColunas(
      [
        ["pesquisa_1", "pesquisa", { titulo: "Pesquisa", tema: "Concorrentes, posicionamentos e linguagem visual deste mercado." }],
        ["marca_1", "marca", { titulo: "Marca (paleta, tom e fontes)" }],
        ["agente_1", "agente", { titulo: "Posicionamento", instrucao: "Defina o posicionamento: para quem, contra quem, a promessa, o tom de voz e as palavras que a marca precisa transmitir." }],
        ["logo_1", "logo", { titulo: "Logo", nome: "", conceito: "", paleta: "", estilo: "minimalista", n: 4 }],
        ["imagem_1", "imagem", { titulo: "Mockups", prompt: "Mockups da marca: cartão, fachada e embalagem, com a logo." }],
        ["template_designer_1", "template_designer", { titulo: "Template da marca", formato_arte: "feed_4_5", campos_variaveis: "titulo", lote: "nao" }],
        ["filme_1", "filme", { titulo: "Filme da marca", formato: "ambos" }],
      ],
      [
        ["pesquisa_1", "agente_1"], ["agente_1", "logo_1"], ["marca_1", "logo_1"],
        ["logo_1", "imagem_1"], ["marca_1", "imagem_1"], ["agente_1", "imagem_1"],
        ["logo_1", "template_designer_1"], ["marca_1", "template_designer_1"],
        ["agente_1", "filme_1"], ["logo_1", "filme_1"], ["marca_1", "filme_1"],
      ],
    ),
  },
  {
    id: ID_V4(20),
    nome: "Site institucional com captura",
    categoria: "Sites",
    descricao: "Site de 4 páginas (início, serviços, sobre, contato) com formulário que cai no CRM e o domínio do cliente.",
    icone: "layout",
    canvas: emColunas(
      [
        ["cliente_1", "cliente", { titulo: "Cliente" }],
        ["referencias_1", "referencias", { titulo: "Referências", links: "", o_que_aproveitar: "Sites que o cliente admira: estrutura e tom." }],
        ["marca_1", "marca", { titulo: "Marca" }],
        ["secoes_pagina_1", "secoes_pagina", { titulo: "Estrutura do site", tipo_pagina: "vendas", objetivo: "site institucional de 4 páginas: início, serviços, sobre e contato" }],
        ["pagina_1", "pagina", { titulo: "Início", tipo_pagina: "institucional", caminho: "/", objetivo: "capturar" }],
        ["pagina_2", "pagina", { titulo: "Serviços", tipo_pagina: "institucional", caminho: "/servicos", objetivo: "capturar" }],
        ["pagina_3", "pagina", { titulo: "Sobre", tipo_pagina: "institucional", caminho: "/sobre", objetivo: "capturar" }],
        ["pagina_4", "pagina", { titulo: "Contato", tipo_pagina: "institucional", caminho: "/contato", objetivo: "capturar" }],
        ["crm_1", "crm", { titulo: "Contato do site", pipeline: "Site", etapa: "Contato do site", temperatura: "10" }],
        ["dominio_1", "dominio", { titulo: "Domínio", dominio: "", estrutura: "caminho", registrador: "registro_br" }],
        ["por_no_ar_1", "por_no_ar", NO_AR_SITE],
      ],
      [
        ["cliente_1", "secoes_pagina_1"], ["referencias_1", "secoes_pagina_1"], ["marca_1", "secoes_pagina_1"],
        ["secoes_pagina_1", "pagina_1"], ["secoes_pagina_1", "pagina_2"], ["secoes_pagina_1", "pagina_3"], ["secoes_pagina_1", "pagina_4"],
        ["marca_1", "pagina_1"], ["marca_1", "pagina_2"], ["marca_1", "pagina_3"], ["marca_1", "pagina_4"],
        ["pagina_1", "crm_1", "enviou_formulario"], ["pagina_2", "crm_1", "enviou_formulario"], ["pagina_3", "crm_1", "enviou_formulario"], ["pagina_4", "crm_1", "enviou_formulario"],
        ["pagina_1", "dominio_1"], ["pagina_2", "dominio_1"], ["pagina_3", "dominio_1"], ["pagina_4", "dominio_1"],
        ["dominio_1", "por_no_ar_1"], ["pagina_1", "por_no_ar_1"], ["pagina_2", "por_no_ar_1"], ["pagina_3", "por_no_ar_1"], ["pagina_4", "por_no_ar_1"], ["crm_1", "por_no_ar_1"],
      ],
    ),
  },
  {
    id: ID_V4(21),
    nome: "Recriar site de referência com a nossa marca",
    categoria: "Sites",
    descricao: "Lê um site público, recria a estrutura e aplica a marca do cliente, sem copiar código; mockup da página e domínio.",
    icone: "layout",
    canvas: emColunas(
      [
        ["referencias_1", "referencias", { titulo: "Site de referência", links: "", o_que_aproveitar: "A ordem das seções e o jeito de vender, nunca o texto nem o código." }],
        ["marca_1", "marca", { titulo: "Marca" }],
        ["secoes_pagina_1", "secoes_pagina", { titulo: "Estrutura recriada", tipo_pagina: "vendas", objetivo: "recriar a estrutura da referência com a nossa marca" }],
        ["pagina_1", "pagina", { titulo: "Página", tipo_pagina: "vendas", caminho: "/", objetivo: "vender" }],
        ["imagem_1", "imagem", { titulo: "Mockup da página", prompt: "Mockup da página no notebook e no celular, com a cara da marca." }],
        ["dominio_1", "dominio", { titulo: "Domínio", dominio: "", estrutura: "caminho", registrador: "registro_br" }],
        ["por_no_ar_1", "por_no_ar", NO_AR_SITE],
      ],
      [
        ["referencias_1", "secoes_pagina_1"], ["marca_1", "secoes_pagina_1"],
        ["secoes_pagina_1", "pagina_1"], ["referencias_1", "pagina_1"], ["marca_1", "pagina_1"],
        ["marca_1", "imagem_1"], ["referencias_1", "imagem_1"],
        ["pagina_1", "dominio_1"], ["dominio_1", "por_no_ar_1"], ["pagina_1", "por_no_ar_1"],
      ],
    ),
  },
  {
    id: ID_V4(22),
    nome: "Recuperação de vendas",
    categoria: "Mensagens",
    descricao: "Carrinho abandonado e Pix não pago com mensagens diferentes, e saída do fluxo na compra aprovada; tudo em rascunho até a sua aprovação.",
    icone: "workflow",
    canvas: emColunas(
      [
        ["produto_1", "produto", { titulo: "Produto" }],
        ["checkout_1", "checkout", { titulo: "Checkout", gateway: "hotmart", link_pagamento: "", caminho: "/checkout" }],
        ["recuperacao_1", "recuperacao", { titulo: "Carrinho abandonado", situacao: "carrinho_abandonado", via: "email", toques: 3 }],
        ["email_1", "email", { titulo: "E-mails do carrinho", tipo_email: "recuperacao", mensagens: 3, objetivo: "Lembrete, objeção e prazo." }],
        ["recuperacao_2", "recuperacao", { titulo: "Pix não pago", situacao: "pix_pendente", via: "whatsapp", toques: 2 }],
        ["whatsapp_1", "whatsapp", { titulo: "Lembrete do Pix", via: "cloud_api", tipo_mensagem: "modelo", mensagens: 2, categoria: "utilidade", objetivo: "Lembrar o Pix gerado com o link para pagar." }],
        ["automacao_1", "automacao", { titulo: "Sai na compra", quando: "compra_aprovada", objetivo_saida: "comprou", horario: "nao" }],
        ["por_no_ar_1", "por_no_ar", NO_AR_MENSAGENS],
      ],
      [
        ["produto_1", "checkout_1"],
        ["checkout_1", "recuperacao_1", "carrinho_abandonado"], ["recuperacao_1", "email_1"],
        ["checkout_1", "recuperacao_2", "pix_gerado"], ["recuperacao_2", "whatsapp_1"],
        ["checkout_1", "automacao_1", "compra_aprovada"], ["recuperacao_1", "automacao_1"], ["recuperacao_2", "automacao_1"],
        ["recuperacao_1", "por_no_ar_1"], ["email_1", "por_no_ar_1"], ["recuperacao_2", "por_no_ar_1"], ["whatsapp_1", "por_no_ar_1"], ["automacao_1", "por_no_ar_1"],
      ],
    ),
  },
  {
    id: ID_V4(23),
    nome: "Comentário vira venda no Instagram",
    categoria: "Mensagens",
    descricao: "Post em carrossel; quem comenta a palavra-chave recebe resposta variada e Direct com o link da captura, e o lead entra no CRM.",
    icone: "megaphone",
    canvas: emColunas(
      [
        ["contexto_1", "contexto", { titulo: "Pedido", texto: "O que o post oferece e a palavra-chave do comentário (ex.: QUERO)." }],
        ["copy_1", "copy", { titulo: "Legenda com a palavra-chave", formato: "legenda" }],
        ["carrossel_1", "carrossel", { titulo: "Carrossel", laminas: 5 }],
        ["pagina_1", "pagina", { titulo: "Captura", tipo_pagina: "captura", caminho: "/quero", objetivo: "capturar" }],
        ["automacao_1", "automacao", { titulo: "Comentário vira Direct", quando: "formulario", condicoes: "Comentário com QUERO no post: responder em público com 3 variações sorteadas e mandar Direct com o link da captura (janela de 24 h).", objetivo_saida: "respondeu", horario: "nao" }],
        ["crm_1", "crm", { titulo: "Veio do Instagram", pipeline: "Funil", etapa: "Veio do Instagram", temperatura: "15" }],
        ["por_no_ar_1", "por_no_ar", NO_AR_SITE],
        ["por_no_ar_2", "por_no_ar", { titulo: "Publicar o carrossel", alvo: "outro", instrucao: "Agendar o carrossel com a legenda no Instagram pela Agenda." }],
        ["por_no_ar_3", "por_no_ar", NO_AR_MENSAGENS],
      ],
      [
        ["contexto_1", "copy_1"], ["copy_1", "carrossel_1"], ["contexto_1", "pagina_1"], ["copy_1", "pagina_1"],
        ["copy_1", "automacao_1"], ["pagina_1", "crm_1", "enviou_formulario"],
        ["pagina_1", "por_no_ar_1"], ["carrossel_1", "por_no_ar_2"], ["copy_1", "por_no_ar_2"],
        ["automacao_1", "por_no_ar_3"], ["crm_1", "por_no_ar_3"],
      ],
    ),
  },
  {
    id: ID_V4(24),
    nome: "Boas-vindas ao aluno",
    categoria: "Mensagens",
    descricao: "A compra aprovada vira e-mail de acesso, sequência de engajamento, pedido de depoimento e o aluno no CRM; a estrutura do curso vem junto.",
    icone: "gem",
    canvas: emColunas(
      [
        ["produto_1", "produto", { titulo: "Produto" }],
        ["checkout_1", "checkout", { titulo: "Checkout", gateway: "hotmart", link_pagamento: "", caminho: "/checkout" }],
        ["area_membros_1", "area_membros", { titulo: "Área de membros", plataforma: "hotmart_club", modulos: 4, aulas_por_modulo: 4, liberacao: "tudo" }],
        ["automacao_1", "automacao", { titulo: "Boas-vindas", quando: "compra_aprovada", objetivo_saida: "respondeu", horario: "sim" }],
        ["email_1", "email", { titulo: "Acesso", tipo_email: "unico", mensagens: 1, objetivo: "Entregar o acesso e o primeiro passo." }],
        ["email_2", "email", { titulo: "D3 e D7", tipo_email: "sequencia", mensagens: 2, objetivo: "Engajar na primeira semana e pedir um depoimento com autorização." }],
        ["whatsapp_1", "whatsapp", { titulo: "Boas-vindas no WhatsApp", via: "cloud_api", tipo_mensagem: "modelo", mensagens: 1, categoria: "utilidade", objetivo: "Confirmar a compra e onde está o acesso." }],
        ["crm_1", "crm", { titulo: "Cliente", pipeline: "Funil", etapa: "Cliente", temperatura: "50" }],
        ["por_no_ar_1", "por_no_ar", NO_AR_SITE],
        ["por_no_ar_2", "por_no_ar", NO_AR_MENSAGENS],
      ],
      [
        ["produto_1", "checkout_1"], ["produto_1", "area_membros_1"], ["checkout_1", "area_membros_1", "compra_aprovada"],
        ["checkout_1", "automacao_1", "compra_aprovada"], ["area_membros_1", "automacao_1"],
        ["automacao_1", "email_1"], ["area_membros_1", "email_1"], ["automacao_1", "email_2"], ["automacao_1", "whatsapp_1"], ["automacao_1", "crm_1"],
        ["checkout_1", "por_no_ar_1"], ["area_membros_1", "por_no_ar_1"],
        ["email_1", "por_no_ar_2"], ["email_2", "por_no_ar_2"], ["whatsapp_1", "por_no_ar_2"], ["automacao_1", "por_no_ar_2"], ["crm_1", "por_no_ar_2"],
      ],
    ),
  },
];

/** Todos os oficiais (a tela e o teste leem esta lista). */
export const TODOS_OS_TEMPLATES_OFICIAIS: TemplateOficial[] = [...TEMPLATES_OFICIAIS, ...TEMPLATES_OFICIAIS_V2, ...TEMPLATES_OFICIAIS_V3, ...TEMPLATES_OFICIAIS_V4];
