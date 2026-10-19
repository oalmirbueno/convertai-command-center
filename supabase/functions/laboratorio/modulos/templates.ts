/**
 * Os templates oficiais do Laboratório: os 6 da v1 (semente da migration 20261019180000_laboratorio.sql)
 * os 4 da v2 (semente da 20261019233000_laboratorio_v2.sql, organizados em colunas por etapa) e os 3 da v3
 * (semente da 20261020010000_laboratorio_v3.sql).
 * O teste confere que cada um é um canvas válido e que as migrations semeiam exatamente estes.
 */
import { type Canvas, type NoDoCanvas, organizarPorEtapas, type TipoDeNo } from "./regras.ts";

export type TemplateOficial = { id: string; nome: string; descricao: string; icone: string; canvas: Canvas };

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

/** Todos os oficiais (a tela e o teste leem esta lista). */
export const TODOS_OS_TEMPLATES_OFICIAIS: TemplateOficial[] = [...TEMPLATES_OFICIAIS, ...TEMPLATES_OFICIAIS_V2, ...TEMPLATES_OFICIAIS_V3];
