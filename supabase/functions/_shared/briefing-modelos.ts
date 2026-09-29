/**
 * Modelos de briefing da Aceleriq (frente BRF, 30/09/2026).
 *
 * Um esquema só para todos os serviços: blocos comuns (identificação,
 * negócio, público, personalidade, visual, materiais e fechamento) mais os
 * blocos de cada serviço (site, landing page, identidade, naming, redes
 * sociais e peças, vídeo e motion). O diagnóstico geral de hoje continua
 * igual, com as mesmas chaves e os mesmos textos (src/components/briefing/
 * questions.ts é gerado daqui).
 *
 * Os modelos são dados versionados: este arquivo é a versão de fábrica e a
 * tabela public.briefing_modelos guarda as versões que o dono editar depois
 * (a mais nova ativa vence, ver modeloVigente). Cada link guarda uma cópia
 * do modelo com que nasceu (briefings.modelo_conteudo): mudar as perguntas
 * nunca quebra um briefing antigo.
 *
 * As respostas continuam num objeto plano por chave (briefings.responses),
 * como sempre foram: quem já lê o briefing (agente de contexto, Mesa Ads,
 * MCP) segue lendo igual.
 *
 * Puro: sem Deno e sem npm. A tela, a Edge Function e os testes leem o mesmo
 * arquivo. Compatível com Safari 11 (sem lookbehind, sem grupo nomeado).
 * Texto nosso, sem travessão.
 */

// ------------------------------------------------------------------ tipos

export type TipoDeCampo =
  | "text"
  | "textarea"
  | "single-chip"
  | "multi-chip"
  | "scale"
  | "reference"
  | "upload"
  | "url"
  | "checklist"
  | "confirm"
  | "date";

export const TIPOS_DE_CAMPO: TipoDeCampo[] = [
  "text", "textarea", "single-chip", "multi-chip", "scale", "reference", "upload", "url", "checklist", "confirm", "date",
];

/** Para onde a decupagem leva o que foi respondido. */
export type CategoriaDaDecupagem = "palavra_chave" | "dor" | "publico" | "restricao" | "referencia" | "tom" | "objetivo";

/** Campo do contexto do cliente que a resposta alimenta direto (regra fixa, sem julgamento). */
export type CampoDoContexto = "negocio" | "publico" | "oferta" | "diferenciais" | "tom_de_voz";

/** De onde vem o dado já sabido de um campo `confirm`. */
export type OrigemDoDadoSabido = "empresa" | "site" | "instagram" | "segmento" | "negocio" | "publico" | "oferta" | "diferenciais";

export type SituacaoDoMaterial = "tenho" | "nao_tenho" | "vou_enviar";
export const SITUACOES_DO_MATERIAL: Array<{ valor: SituacaoDoMaterial; rotulo: string }> = [
  { valor: "tenho", rotulo: "Tenho" },
  { valor: "vou_enviar", rotulo: "Vou enviar" },
  { valor: "nao_tenho", rotulo: "Não tenho" },
];

export interface CampoDoBriefing {
  key: string;
  tipo: TipoDeCampo;
  pergunta: string;
  apoio?: string;
  obrigatorio?: boolean;
  opcoes?: string[];
  maxSelect?: number;
  maxChars?: number;
  placeholder?: string;
  /** Escala: os dois polos (1 e 5). */
  polos?: [string, string];
  /** Referência e url múltipla: quantas pede no mínimo (conta como obrigatório). */
  minimo?: number;
  /** Url: aceita várias (lista). */
  multiplo?: boolean;
  /** Upload: categoria do arquivo (vai para Arquivos do cliente). */
  categoria?: CategoriaDeAnexo;
  /** Checklist: os materiais. */
  itens?: string[];
  /** Confirm: de onde vem o dado já sabido. */
  origem?: OrigemDoDadoSabido;
  /** Só aparece quando outro campo tem este valor (ou um destes). */
  mostrarSe?: { key: string; valor: string | string[] };
  /** Aceita "Outro" com texto livre (single e multi). */
  outro?: boolean;
  /** Categoria fixa da decupagem (regra do modelo, sem julgamento). */
  decupa?: CategoriaDaDecupagem;
  /** Alimenta este campo do contexto do cliente (sugestão com Confirmar). */
  alimenta?: CampoDoContexto;
}

export interface BlocoDoBriefing {
  id: string;
  titulo: string;
  campos: CampoDoBriefing[];
}

export type SlugDoModelo = "diagnostico" | "site" | "landing" | "identidade" | "naming" | "redes" | "video";
export const SLUGS_DE_BRIEFING: SlugDoModelo[] = ["diagnostico", "site", "landing", "identidade", "naming", "redes", "video"];

export interface ModeloDeBriefing {
  slug: SlugDoModelo;
  versao: number;
  titulo: string;
  /** Nome curto para seletor e lista. */
  nome: string;
  /** Uma linha de estado na página pública. */
  descricao: string;
  /** Explicação que vai no "?" da página pública. */
  ajuda: string;
  minutos: number;
  blocos: BlocoDoBriefing[];
  proximosPassos: Array<{ titulo: string; texto: string }>;
}

export type CategoriaDeAnexo = "logo" | "manual" | "fotos" | "textos" | "videos" | "referencias" | "outros";
export const ROTULO_DA_CATEGORIA: Record<CategoriaDeAnexo, string> = {
  logo: "Logo",
  manual: "Manual da marca",
  fotos: "Fotos",
  textos: "Textos",
  videos: "Vídeos",
  referencias: "Referências",
  outros: "Outros",
};

/** Validade padrão de um link novo (dias) e o teto. */
export const VALIDADE_PADRAO_DIAS = 30;
export const VALIDADE_MAXIMA_DIAS = 120;

/** Anexos de um briefing: teto por arquivo, por briefing e por quantidade. */
export const ANEXO_MAX_BYTES = 25 * 1024 * 1024;
export const ANEXOS_MAX_POR_BRIEFING = 40;
export const ANEXOS_MAX_BYTES_POR_BRIEFING = 300 * 1024 * 1024;
/** Extensões aceitas no anexo (lista fechada: o link é público). */
export const EXTENSOES_DE_ANEXO = [
  "png", "jpg", "jpeg", "webp", "gif", "heic",
  "pdf", "doc", "docx", "txt", "ppt", "pptx", "xls", "xlsx", "csv",
  "ai", "eps", "psd", "cdr", "zip",
  "mp4", "mov", "webm", "mp3",
];

// ------------------------------------------------------------------ valores

export type ItemDeReferencia = { link?: string; anexo_id?: string; nota?: string };
export type Respostas = Record<string, unknown>;
export type AnexoDoBriefing = { id: string; campo: string | null; categoria: string | null; nome: string; tamanho?: number | null; mime?: string | null };

// ------------------------------------------------------------------ peças comuns

const ATRIBUTOS = [
  "Sério", "Corporativo", "Elegante", "Moderno", "Tradicional", "Amigável", "Divertido", "Dinâmico",
  "Simples", "Sofisticado", "Tecnológico", "Natural", "Acolhedor", "Ousado", "Minimalista", "Colorido",
];

const EIXOS: Array<[string, string, string]> = [
  ["eixoSerio", "Sério", "Descontraído"],
  ["eixoClassico", "Clássico", "Moderno"],
  ["eixoSimples", "Simples", "Sofisticado"],
  ["eixoAcessivel", "Acessível", "Premium"],
  ["eixoDiscreto", "Discreto", "Expressivo"],
  ["eixoCorporativo", "Corporativo", "Próximo"],
];

const MATERIAIS_PADRAO = [
  "Logo em vetor (AI, PDF ou EPS)",
  "Manual ou guia da marca",
  "Fotos da empresa e da equipe",
  "Fotos de produtos ou serviços",
  "Textos institucionais",
  "Vídeos já gravados",
];

function blocoIdentificacao(opcoes: { comInvestimento?: boolean } = {}): BlocoDoBriefing {
  const campos: CampoDoBriefing[] = [
    { key: "empresa", tipo: "confirm", origem: "empresa", pergunta: "Nome da empresa", apoio: "Confira o nome como deve aparecer nos materiais.", obrigatorio: true },
    { key: "slogan", tipo: "text", pergunta: "Slogan ou frase da marca", apoio: "Se ainda não tem, deixe em branco.", placeholder: "Ex.: Pão quente a qualquer hora" },
    { key: "site", tipo: "confirm", origem: "site", pergunta: "Site atual", apoio: "Se não tiver, deixe em branco." },
    { key: "instagram", tipo: "confirm", origem: "instagram", pergunta: "Instagram", apoio: "O @ ou o link do perfil." },
    { key: "decisor", tipo: "text", pergunta: "Quem aprova o projeto do seu lado", apoio: "Nome e função de quem dá a palavra final.", obrigatorio: true, placeholder: "Ex.: Ana, sócia" },
    { key: "prazo", tipo: "date", pergunta: "Prazo desejado", apoio: "Uma data ou um evento que o projeto precisa atender." },
  ];
  if (opcoes.comInvestimento) {
    campos.push({
      key: "investimento",
      tipo: "single-chip",
      pergunta: "Faixa de investimento prevista",
      apoio: "Opcional. Ajuda a montar uma proposta do tamanho certo.",
      opcoes: ["Até R$ 2.000", "R$ 2.000 a R$ 5.000", "R$ 5.000 a R$ 10.000", "R$ 10.000 a R$ 20.000", "Acima de R$ 20.000", "Prefiro conversar"],
    });
  }
  return { id: "identificacao", titulo: "Identificação", campos };
}

function blocoNegocio(): BlocoDoBriefing {
  return {
    id: "negocio",
    titulo: "Negócio",
    campos: [
      { key: "historia", tipo: "textarea", pergunta: "Conte a história da empresa e o que ela faz", apoio: "Como começou, o que vende e para quem.", obrigatorio: true, maxChars: 1200, alimenta: "negocio" },
      { key: "produtos", tipo: "textarea", pergunta: "Principais produtos ou serviços", apoio: "Os que mais vendem ou que você quer vender mais.", obrigatorio: true, maxChars: 800, alimenta: "oferta" },
      { key: "diferenciais", tipo: "textarea", pergunta: "O que diferencia você dos concorrentes", apoio: "Por que o cliente escolhe você e não o outro.", obrigatorio: true, maxChars: 800, alimenta: "diferenciais", decupa: "palavra_chave" },
      { key: "valores", tipo: "textarea", pergunta: "Missão e valores", apoio: "Opcional. O que a empresa defende.", maxChars: 600 },
      { key: "futuro", tipo: "textarea", pergunta: "Onde a empresa quer estar em 3 anos", apoio: "Objetivos de longo prazo.", maxChars: 600, decupa: "objetivo" },
    ],
  };
}

function blocoPublico(): BlocoDoBriefing {
  return {
    id: "publico",
    titulo: "Público e mercado",
    campos: [
      { key: "tipoDeCliente", tipo: "single-chip", pergunta: "Você vende para", obrigatorio: true, opcoes: ["Pessoas (B2C)", "Empresas (B2B)", "Os dois"], decupa: "publico" },
      { key: "perfilDoCliente", tipo: "textarea", pergunta: "Quem é o seu cliente", apoio: "Idade, região, renda, rotina, o que ele busca.", obrigatorio: true, maxChars: 800, alimenta: "publico", decupa: "publico" },
      { key: "dorDoCliente", tipo: "textarea", pergunta: "Que problema o cliente quer resolver quando procura você", apoio: "Nas palavras dele, se possível.", maxChars: 600, decupa: "dor" },
      { key: "persona", tipo: "upload", categoria: "textos", pergunta: "Estudo de público ou persona", apoio: "Opcional. Se já tiver um documento, anexe aqui." },
      { key: "concorrentes", tipo: "url", multiplo: true, pergunta: "Concorrentes", apoio: "Site ou Instagram de quem disputa o mesmo cliente.", placeholder: "https://" },
      { key: "concorrentesNota", tipo: "textarea", pergunta: "O que eles fazem bem e o que fazem mal", maxChars: 600 },
    ],
  };
}

function blocoPersonalidade(): BlocoDoBriefing {
  const campos: CampoDoBriefing[] = EIXOS.map(([key, a, b]) => ({
    key,
    tipo: "scale" as const,
    pergunta: `${a} ou ${b}`,
    polos: [a, b] as [string, string],
    decupa: "tom" as const,
  }));
  campos.push({
    key: "atributos",
    tipo: "multi-chip",
    pergunta: "Como a marca deve ser percebida",
    apoio: "Escolha até 5.",
    maxSelect: 5,
    opcoes: ATRIBUTOS,
    outro: true,
    decupa: "tom",
  });
  return { id: "personalidade", titulo: "Personalidade", campos };
}

function blocoVisual(minimoReferencias = 3): BlocoDoBriefing {
  return {
    id: "visual",
    titulo: "Visual",
    campos: [
      { key: "cores", tipo: "text", pergunta: "Cores que a marca usa ou deseja", placeholder: "Ex.: verde escuro e areia" },
      { key: "coresProibidas", tipo: "text", pergunta: "Cores que não quer", decupa: "restricao" },
      { key: "naoQuer", tipo: "textarea", pergunta: "O que você não quer ver de jeito nenhum", apoio: "Estilos, imagens, palavras ou exemplos que não combinam com a marca.", maxChars: 600, decupa: "restricao" },
      { key: "referencias", tipo: "reference", minimo: minimoReferencias, pergunta: "Referências que você gosta", apoio: `Pelo menos ${minimoReferencias}. Um link ou uma imagem, e o que chama a sua atenção em cada uma.`, decupa: "referencia" },
    ],
  };
}

function blocoMateriais(itens: string[] = MATERIAIS_PADRAO): BlocoDoBriefing {
  return {
    id: "materiais",
    titulo: "Materiais",
    campos: [
      { key: "materiais", tipo: "checklist", itens, pergunta: "O que você já tem", apoio: "Marque o que tem, o que vai enviar e o que não tem." },
      { key: "anexoLogo", tipo: "upload", categoria: "logo", pergunta: "Logo atual", apoio: "De preferência em vetor (AI, PDF ou EPS)." },
      { key: "anexoMateriais", tipo: "upload", categoria: "fotos", pergunta: "Fotos, textos e outros materiais", apoio: "Até 25 MB por arquivo." },
      { key: "quemEscreve", tipo: "single-chip", pergunta: "Quem produz os textos que faltarem", opcoes: ["Eu envio", "A Aceleriq escreve", "A combinar"] },
    ],
  };
}

function blocoFechamento(): BlocoDoBriefing {
  return {
    id: "fechamento",
    titulo: "Fechamento",
    campos: [
      { key: "algoMais", tipo: "textarea", pergunta: "Algo mais que devemos saber", apoio: "Preocupações, ideias, datas importantes.", maxChars: 1000 },
    ],
  };
}

const PASSOS_DO_PROJETO = [
  { titulo: "Leitura do briefing", texto: "A equipe lê cada resposta e organiza os pontos principais." },
  { titulo: "Resumo do entendimento", texto: "Você recebe o que entendemos para confirmar antes de começar." },
  { titulo: "Início do projeto", texto: "Com tudo confirmado, o trabalho começa no prazo combinado." },
];

// ------------------------------------------------------------------ diagnóstico (o de hoje, intacto)

/**
 * O diagnóstico geral, com as mesmas chaves, textos e opções de antes. É a
 * fonte de src/components/briefing/questions.ts (QUESTIONS).
 */
const DIAGNOSTICO: ModeloDeBriefing = {
  slug: "diagnostico",
  versao: 1,
  titulo: "Diagnóstico da Aceleriq",
  nome: "Diagnóstico geral",
  descricao: "15 perguntas · cerca de 8 minutos · confidencial",
  ajuda: "Conte um pouco sobre o seu negócio. Não existe resposta certa: quanto mais sincero, melhor a estratégia. Como funciona: você responde sobre o seu negócio, a equipe analisa cada resposta e, em até 48h, você recebe um plano sob medida com o orçamento. As respostas ficam salvas enquanto você preenche.",
  minutos: 8,
  proximosPassos: [
    { titulo: "Análise do diagnóstico", texto: "A equipe lê cada resposta. Prazo: até 24h." },
    { titulo: "Proposta personalizada", texto: "Um plano sob medida, com estratégia e orçamento." },
    { titulo: "Conversa de apresentação", texto: "Uma chamada para apresentar tudo e alinhar." },
  ],
  blocos: [
    {
      id: "empresa",
      titulo: "Sobre sua Empresa",
      campos: [
        { key: "companyName", tipo: "text", pergunta: "Qual é o nome da sua empresa?", apoio: "Pode ser o nome fantasia ou razão social.", obrigatorio: true, placeholder: "Ex: Padaria do Zé" },
        { key: "segment", tipo: "single-chip", pergunta: "Qual o segmento do seu negócio?", apoio: "Selecione o que mais se aproxima.", obrigatorio: true, opcoes: ["Varejo", "Serviços", "Tecnologia", "Saúde", "Educação", "Alimentação", "Indústria", "Beleza e Estética", "Imobiliário", "Outro"] },
        { key: "companyAge", tipo: "single-chip", pergunta: "Há quanto tempo sua empresa existe?", apoio: "Isso nos ajuda a entender o estágio do negócio.", obrigatorio: true, opcoes: ["Estou começando agora", "Menos de 1 ano", "1 a 3 anos", "3 a 5 anos", "5 a 10 anos", "Mais de 10 anos"] },
        { key: "companyDescription", tipo: "textarea", pergunta: "Em uma frase, o que sua empresa faz?", apoio: "Como você explicaria para alguém que nunca ouviu falar.", obrigatorio: true, placeholder: "Ex: Vendemos bolos artesanais por encomenda para festas e eventos...", maxChars: 200, alimenta: "negocio" },
      ],
    },
    {
      id: "presenca",
      titulo: "Presença Digital Atual",
      campos: [
        { key: "digitalPresence", tipo: "multi-chip", pergunta: "Onde sua empresa está presente hoje?", apoio: "Selecione todos que se aplicam.", obrigatorio: true, opcoes: ["Instagram", "Facebook", "TikTok", "LinkedIn", "YouTube", "Site próprio", "Google Meu Negócio", "WhatsApp Business", "Nenhum ainda"] },
        { key: "paidTraffic", tipo: "single-chip", pergunta: "Você já investe em tráfego pago (anúncios)?", apoio: "Meta Ads, Google Ads ou qualquer plataforma de anúncios.", obrigatorio: true, opcoes: ["Nunca investi", "Já investi mas parei", "Invisto até R$1.000/mês", "Invisto R$1.000-5.000/mês", "Invisto acima de R$5.000/mês"] },
        { key: "digitalLevel", tipo: "single-chip", pergunta: "Como você avalia sua presença digital hoje?", apoio: "Seja honesto · isso nos ajuda a calibrar a estratégia.", obrigatorio: true, opcoes: ["Inexistente · preciso começar do zero", "Fraca · tenho perfis mas não posto", "Básica · posto às vezes, sem estratégia", "Razoável · tenho frequência mas poucos resultados", "Boa · funciona, mas quero escalar"] },
      ],
    },
    {
      id: "objetivos",
      titulo: "Objetivos e Metas",
      campos: [
        { key: "objectives", tipo: "multi-chip", pergunta: "Quais são seus principais objetivos agora?", apoio: "Selecione até 3 prioridades.", obrigatorio: true, maxSelect: 3, opcoes: ["Aumentar vendas", "Gerar mais leads", "Fortalecer a marca", "Aparecer no Google", "Lançar produto/serviço", "Melhorar redes sociais", "Automatizar processos", "Criar site profissional", "Outro"], decupa: "objetivo" },
        { key: "expectedResults", tipo: "single-chip", pergunta: "Qual resultado você espera nos primeiros 3 meses?", apoio: "Expectativas alinhadas = resultados melhores.", obrigatorio: true, opcoes: ["Começar a ter presença online", "Primeiros leads e contatos", "Aumento visível nas vendas", "Dobrar meu faturamento", "Não tenho expectativa definida ainda"], decupa: "objetivo" },
        { key: "biggestChallenge", tipo: "textarea", pergunta: "Qual é o maior desafio que sua empresa enfrenta hoje?", apoio: "Pode ser marketing, vendas, operacional... fale abertamente.", obrigatorio: true, placeholder: "Ex: Tenho muita concorrência local e não sei como me diferenciar...", maxChars: 300, decupa: "dor" },
      ],
    },
    {
      id: "publico",
      titulo: "Público e Mercado",
      campos: [
        { key: "idealClient", tipo: "textarea", pergunta: "Descreva seu cliente ideal em uma frase.", apoio: "Quem compra (ou compraria) de você? Idade, perfil, comportamento.", obrigatorio: true, placeholder: "Ex: Mulheres de 25-45 anos, classe B, que buscam praticidade...", maxChars: 200, alimenta: "publico", decupa: "publico" },
        { key: "region", tipo: "single-chip", pergunta: "Qual a região de atuação do seu negócio?", apoio: "Onde seus clientes estão.", obrigatorio: true, opcoes: ["Bairro / cidade específica", "Regional (algumas cidades)", "Estadual", "Nacional", "Internacional"], decupa: "publico" },
        { key: "howClientsFind", tipo: "multi-chip", pergunta: "Como seus clientes te encontram hoje?", apoio: "Selecione todos.", obrigatorio: true, opcoes: ["Indicação boca a boca", "Instagram / redes sociais", "Pesquisa no Google", "WhatsApp", "Ponto físico", "Marketplace (iFood, Mercado Livre...)", "Não sei ao certo"] },
      ],
    },
    {
      id: "investimento",
      titulo: "Investimento e Expectativas",
      campos: [
        { key: "budget", tipo: "single-chip", pergunta: "Qual faixa de investimento mensal você tem em mente para marketing?", apoio: "Inclui serviços + verba de anúncios. Sem compromisso.", obrigatorio: true, opcoes: ["Até R$1.000/mês", "R$1.000 a R$2.500/mês", "R$2.500 a R$5.000/mês", "R$5.000 a R$10.000/mês", "Acima de R$10.000/mês", "Ainda não sei"] },
        { key: "additionalNotes", tipo: "textarea", pergunta: "Tem algo mais que gostaria de nos contar?", apoio: "Referências, preocupações, expectativas... tudo é válido. (Opcional)", obrigatorio: false, placeholder: "Fique à vontade para complementar...", maxChars: 500 },
      ],
    },
  ],
};

// ------------------------------------------------------------------ serviços

const PAGINAS_DO_SITE = [
  "Início", "Sobre", "Serviços", "Produtos", "Blog", "Portfólio", "Clientes", "Depoimentos", "Equipe",
  "Galeria de fotos", "Galeria de vídeos", "Trabalhe conosco", "Perguntas frequentes", "Contato", "Loja",
];
const CONVERSOES = ["Contato por formulário", "WhatsApp", "Ligação", "Cadastro", "Venda on-line", "Agendamento", "Newsletter"];
const INTEGRACOES = ["Instagram", "WhatsApp", "Google Maps", "CRM", "Pagamento", "Agenda on-line", "Pixel de anúncios"];

function blocoSite(): BlocoDoBriefing {
  return {
    id: "site",
    titulo: "O site",
    campos: [
      { key: "tipoDeSite", tipo: "single-chip", pergunta: "Tipo de site", obrigatorio: true, opcoes: ["Institucional", "Loja virtual", "Portal de conteúdo", "Página única", "Outro"], outro: true },
      { key: "objetivosDoSite", tipo: "textarea", pergunta: "O que o site precisa resolver", apoio: "Ex.: passar confiança, gerar orçamentos, vender on-line.", obrigatorio: true, maxChars: 800, decupa: "objetivo" },
      { key: "conversoes", tipo: "multi-chip", pergunta: "O que o visitante deve fazer no site", obrigatorio: true, opcoes: CONVERSOES, outro: true, decupa: "objetivo" },
      { key: "paginas", tipo: "multi-chip", pergunta: "Páginas que o site precisa ter", opcoes: PAGINAS_DO_SITE, outro: true },
      { key: "recursos", tipo: "textarea", pergunta: "Recursos especiais", apoio: "Área de cliente, simulador, catálogo, reserva, idiomas.", maxChars: 800 },
      { key: "integracoes", tipo: "multi-chip", pergunta: "Integrações", opcoes: INTEGRACOES, outro: true },
      { key: "palavrasChave", tipo: "text", pergunta: "Como as pessoas buscam você no Google", apoio: "Separe por vírgula.", placeholder: "Ex.: padaria artesanal em Curitiba, bolo de festa", decupa: "palavra_chave" },
      { key: "temSiteAtual", tipo: "single-chip", pergunta: "Já tem um site hoje", obrigatorio: true, opcoes: ["Sim", "Não"] },
      { key: "siteAtualBom", tipo: "textarea", pergunta: "O que funciona no site atual e deve ficar", maxChars: 600, mostrarSe: { key: "temSiteAtual", valor: "Sim" } },
      { key: "siteAtualProblemas", tipo: "textarea", pergunta: "O que não funciona e motivou a mudança", maxChars: 600, mostrarSe: { key: "temSiteAtual", valor: "Sim" }, decupa: "dor" },
      { key: "dominio", tipo: "single-chip", pergunta: "Domínio e hospedagem", opcoes: ["Já tenho os dois", "Tenho só o domínio", "Preciso dos dois", "Não sei"] },
      { key: "quemAtualiza", tipo: "single-chip", pergunta: "Quem vai atualizar o site depois", opcoes: ["Nossa equipe", "A Aceleriq", "Ainda não sei"] },
    ],
  };
}

function blocoLanding(): BlocoDoBriefing {
  return {
    id: "landing",
    titulo: "A página",
    campos: [
      { key: "oferta", tipo: "textarea", pergunta: "O que a página vende ou oferece", apoio: "Produto, serviço, evento ou material gratuito.", obrigatorio: true, maxChars: 800, alimenta: "oferta" },
      { key: "precoCondicoes", tipo: "text", pergunta: "Preço e condições", placeholder: "Ex.: R$ 497 em até 12x" },
      { key: "acaoPrincipal", tipo: "single-chip", pergunta: "A ação principal da página", obrigatorio: true, opcoes: ["Chamar no WhatsApp", "Preencher formulário", "Comprar", "Agendar", "Baixar material", "Inscrever-se"], outro: true, decupa: "objetivo" },
      { key: "origemDoTrafego", tipo: "multi-chip", pergunta: "De onde vêm as visitas", opcoes: ["Anúncios no Meta", "Anúncios no Google", "Instagram orgânico", "WhatsApp", "E-mail", "Indicação"], outro: true },
      { key: "provas", tipo: "textarea", pergunta: "Provas que você pode mostrar", apoio: "Depoimentos, números reais, garantias, certificados. Só o que for verdadeiro.", maxChars: 800 },
      { key: "anexoProvas", tipo: "upload", categoria: "textos", pergunta: "Arquivos das provas", apoio: "Prints de depoimentos, certificados, fotos." },
      { key: "objecoes", tipo: "textarea", pergunta: "O que faz o cliente hesitar antes de comprar", maxChars: 600, decupa: "dor" },
      { key: "palavrasChave", tipo: "text", pergunta: "Palavras que o cliente usa para buscar a oferta", apoio: "Separe por vírgula.", decupa: "palavra_chave" },
      { key: "paginaAtual", tipo: "url", pergunta: "Página atual, se houver", placeholder: "https://" },
    ],
  };
}

const ESTILOS_DE_LOGO = ["Símbolo abstrato", "Símbolo figurativo", "Emblema ou selo", "Só tipografia", "Monograma (iniciais)"];
const TIPOGRAFIAS = ["Com serifa", "Sem serifa", "Manuscrita", "Decorativa", "Sem preferência"];
const EXTRAS_DE_IDENTIDADE = ["Cartão de visita", "Papel timbrado", "Assinatura de e-mail", "Kit para redes sociais", "Fachada", "Uniforme", "Embalagem"];

function camposDaLogo(comNome: boolean): CampoDoBriefing[] {
  const campos: CampoDoBriefing[] = [];
  if (comNome) {
    campos.push({ key: "nomeDaMarca", tipo: "text", pergunta: "Nome da marca como deve aparecer no logo", obrigatorio: true });
  }
  campos.push(
    { key: "sloganNoLogo", tipo: "single-chip", pergunta: "O slogan entra no logo", opcoes: ["Sim", "Não", "Não sei"] },
    { key: "temLogo", tipo: "single-chip", pergunta: "Já tem um logo", obrigatorio: true, opcoes: ["Sim", "Não"] },
    { key: "logoAtual", tipo: "upload", categoria: "logo", pergunta: "Logo atual", mostrarSe: { key: "temLogo", valor: "Sim" } },
    { key: "motivoDaMudanca", tipo: "textarea", pergunta: "Por que mudar o logo", maxChars: 600, mostrarSe: { key: "temLogo", valor: "Sim" }, decupa: "dor" },
    { key: "mensagemDoLogo", tipo: "textarea", pergunta: "O que o logo precisa transmitir", apoio: "Três ou quatro ideias bastam.", obrigatorio: true, maxChars: 600, decupa: "palavra_chave" },
    { key: "imagemEmMente", tipo: "textarea", pergunta: "Tem alguma imagem em mente", apoio: "Não é obrigatório seguir. Serve como ponto de partida.", maxChars: 600 },
    { key: "estiloDoLogo", tipo: "multi-chip", pergunta: "Estilos que agradam", opcoes: ESTILOS_DE_LOGO },
    { key: "tipografia", tipo: "single-chip", pergunta: "Estilo de letra", opcoes: TIPOGRAFIAS },
    { key: "extras", tipo: "multi-chip", pergunta: "Peças além do logo", opcoes: EXTRAS_DE_IDENTIDADE, outro: true },
  );
  return campos;
}

function blocoNome(): BlocoDoBriefing {
  return {
    id: "nome",
    titulo: "O nome",
    campos: [
      { key: "marcasAdmiradas", tipo: "text", pergunta: "Nomes de marcas que você admira", apoio: "De qualquer segmento. Separe por vírgula.", obrigatorio: true },
      { key: "idioma", tipo: "single-chip", pergunta: "O nome pode ser em outro idioma", obrigatorio: true, opcoes: ["Só português", "Talvez", "Sim"] },
      {
        key: "tiposDeNome",
        tipo: "multi-chip",
        pergunta: "Tipos de nome que agradam",
        apoio: "Escolha quantos quiser.",
        opcoes: [
          "Palavra real (ex.: Farol)",
          "Junção de palavras (ex.: Bemviver)",
          "Palavra inventada (ex.: Zunar)",
          "Nome de pessoa ou lugar",
          "Sigla ou iniciais",
          "Frase curta",
        ],
      },
      { key: "raizes", tipo: "text", pergunta: "Palavras ou ideias que gostaria no nome", decupa: "palavra_chave" },
      { key: "naoQuerNoNome", tipo: "textarea", pergunta: "O que o nome não pode ter", apoio: "Sons, palavras, associações.", maxChars: 400, decupa: "restricao" },
      { key: "dominioLivre", tipo: "single-chip", pergunta: "O domínio .com.br e o @ precisam estar livres", opcoes: ["Sim, os dois", "Só o domínio", "Só o @", "Não é essencial"] },
      { key: "segmentoInpi", tipo: "text", pergunta: "Classe de registro no INPI, se já souber", apoio: "Opcional. A Aceleriq pesquisa com você." },
    ],
  };
}

const TIPOS_DE_PECA = ["Post de feed", "Carrossel", "Capa de Reels", "Stories", "E-mail marketing", "Banner para site", "Impresso", "Outro"];
const FORMATOS = ["Quadrado 1:1", "Retrato 4:5", "Vertical 9:16", "Paisagem 16:9", "A4", "Outro"];
const CANAIS = ["Instagram", "Facebook", "TikTok", "LinkedIn", "WhatsApp", "E-mail", "Site", "Material impresso"];

function blocoPecas(): BlocoDoBriefing {
  return {
    id: "pecas",
    titulo: "As peças",
    campos: [
      { key: "tiposDePeca", tipo: "multi-chip", pergunta: "Tipos de peça", obrigatorio: true, opcoes: TIPOS_DE_PECA, outro: true },
      { key: "quantidade", tipo: "text", pergunta: "Quantidade e frequência", apoio: "Ex.: 12 posts por mês, 3 stories por semana.", obrigatorio: true },
      { key: "formatos", tipo: "multi-chip", pergunta: "Formatos", opcoes: FORMATOS, outro: true },
      { key: "canais", tipo: "multi-chip", pergunta: "Onde as peças vão aparecer", obrigatorio: true, opcoes: CANAIS },
      { key: "objetivoDasPecas", tipo: "textarea", pergunta: "O que cada tipo de peça precisa alcançar", apoio: "Ex.: posts para educar, stories para vender.", obrigatorio: true, maxChars: 800, decupa: "objetivo" },
      { key: "temIdentidade", tipo: "single-chip", pergunta: "Já tem identidade visual definida", obrigatorio: true, opcoes: ["Sim", "Não", "Em construção"] },
      { key: "anexoIdentidade", tipo: "upload", categoria: "manual", pergunta: "Manual ou exemplos da identidade", mostrarSe: { key: "temIdentidade", valor: ["Sim", "Em construção"] } },
      { key: "prazoDasPecas", tipo: "date", pergunta: "Quando as primeiras peças precisam estar prontas" },
    ],
  };
}

const TIPOS_DE_VIDEO = ["Reels e vídeos curtos", "Vídeo institucional", "Vídeo de produto", "Depoimento", "Animação (motion)", "Vinheta de logo", "Anúncio em vídeo", "Outro"];

function blocoVideo(): BlocoDoBriefing {
  return {
    id: "video",
    titulo: "O vídeo",
    campos: [
      { key: "tiposDeVideo", tipo: "multi-chip", pergunta: "Tipo de vídeo", obrigatorio: true, opcoes: TIPOS_DE_VIDEO, outro: true },
      { key: "objetivoDoVideo", tipo: "textarea", pergunta: "O que o vídeo precisa fazer o público sentir ou fazer", obrigatorio: true, maxChars: 800, decupa: "objetivo" },
      { key: "mensagemCentral", tipo: "textarea", pergunta: "A mensagem principal em uma frase", obrigatorio: true, maxChars: 300, decupa: "palavra_chave" },
      { key: "duracao", tipo: "single-chip", pergunta: "Duração aproximada", opcoes: ["Até 15 segundos", "15 a 30 segundos", "30 a 60 segundos", "1 a 3 minutos", "Mais de 3 minutos"] },
      { key: "canaisDoVideo", tipo: "multi-chip", pergunta: "Onde o vídeo vai passar", obrigatorio: true, opcoes: ["Instagram", "TikTok", "YouTube", "Site", "Anúncios", "Evento ou tela", "WhatsApp"] },
      { key: "formatoDoVideo", tipo: "multi-chip", pergunta: "Formato", opcoes: ["Vertical 9:16", "Retrato 4:5", "Quadrado 1:1", "Horizontal 16:9"] },
      { key: "quemAparece", tipo: "single-chip", pergunta: "Quem aparece no vídeo", opcoes: ["Eu ou alguém da equipe", "Atores ou modelos", "Só produto e ambiente", "Só animação", "A definir"] },
      { key: "gravacao", tipo: "single-chip", pergunta: "Gravação", opcoes: ["Já tenho as imagens", "Precisa gravar", "Parte de cada", "Não precisa (animação)"] },
      { key: "anexoVideos", tipo: "upload", categoria: "videos", pergunta: "Imagens ou vídeos que já existem", mostrarSe: { key: "gravacao", valor: ["Já tenho as imagens", "Parte de cada"] } },
      { key: "trilha", tipo: "single-chip", pergunta: "Trilha sonora", opcoes: ["Animada", "Calma", "Emocionante", "Corporativa", "Sem música", "A Aceleriq sugere"] },
      { key: "narracao", tipo: "single-chip", pergunta: "Narração", opcoes: ["Voz de quem aparece", "Locutor", "Só texto na tela", "A definir"] },
      { key: "legendas", tipo: "single-chip", pergunta: "Legendas na tela", opcoes: ["Sim", "Não", "A Aceleriq sugere"] },
    ],
  };
}

// ------------------------------------------------------------------ modelos

function montar(m: Omit<ModeloDeBriefing, "proximosPassos"> & { proximosPassos?: ModeloDeBriefing["proximosPassos"] }): ModeloDeBriefing {
  return { ...m, proximosPassos: m.proximosPassos ?? PASSOS_DO_PROJETO };
}

const AJUDA_COMUM = "Responda no seu tempo: tudo fica salvo e você pode voltar pelo mesmo link até enviar. Quanto mais detalhe, mais certeiro o projeto. Nunca coloque senha em nenhum campo: acessos são combinados à parte, por convite.";

export const MODELOS_DE_FABRICA: Record<SlugDoModelo, ModeloDeBriefing> = {
  diagnostico: DIAGNOSTICO,
  site: montar({
    slug: "site",
    versao: 1,
    titulo: "Briefing do site",
    nome: "Site",
    descricao: "Cerca de 20 minutos · salva sozinho",
    ajuda: AJUDA_COMUM,
    minutos: 20,
    blocos: [blocoIdentificacao({ comInvestimento: true }), blocoNegocio(), blocoPublico(), blocoSite(), blocoPersonalidade(), blocoVisual(3), blocoMateriais(), blocoFechamento()],
  }),
  landing: montar({
    slug: "landing",
    versao: 1,
    titulo: "Briefing da landing page",
    nome: "Landing page",
    descricao: "Cerca de 15 minutos · salva sozinho",
    ajuda: AJUDA_COMUM,
    minutos: 15,
    blocos: [blocoIdentificacao({ comInvestimento: true }), blocoNegocio(), blocoPublico(), blocoLanding(), blocoPersonalidade(), blocoVisual(3), blocoMateriais(), blocoFechamento()],
  }),
  identidade: montar({
    slug: "identidade",
    versao: 1,
    titulo: "Briefing de identidade visual",
    nome: "Identidade e logo",
    descricao: "Cerca de 20 minutos · salva sozinho",
    ajuda: `${AJUDA_COMUM} As sugestões visuais são ponto de partida, não regra.`,
    minutos: 20,
    blocos: [blocoIdentificacao({ comInvestimento: true }), blocoNegocio(), blocoPublico(), { id: "logo", titulo: "O logo", campos: camposDaLogo(true) }, blocoPersonalidade(), blocoVisual(3), blocoMateriais(MATERIAIS_PADRAO.slice(1)), blocoFechamento()],
  }),
  naming: montar({
    slug: "naming",
    versao: 1,
    titulo: "Briefing de naming e logo",
    nome: "Naming e logo",
    descricao: "Cerca de 25 minutos · salva sozinho",
    ajuda: `${AJUDA_COMUM} Todo nome proposto passa por pesquisa de disponibilidade antes de ir para você.`,
    minutos: 25,
    blocos: [blocoIdentificacao({ comInvestimento: true }), blocoNegocio(), blocoPublico(), blocoNome(), { id: "logo", titulo: "O logo", campos: camposDaLogo(false) }, blocoPersonalidade(), blocoVisual(3), blocoFechamento()],
  }),
  redes: montar({
    slug: "redes",
    versao: 1,
    titulo: "Briefing de redes sociais e peças",
    nome: "Redes sociais e peças",
    descricao: "Cerca de 15 minutos · salva sozinho",
    ajuda: AJUDA_COMUM,
    minutos: 15,
    blocos: [blocoIdentificacao(), blocoNegocio(), blocoPublico(), blocoPecas(), blocoPersonalidade(), blocoVisual(3), blocoMateriais(), blocoFechamento()],
  }),
  video: montar({
    slug: "video",
    versao: 1,
    titulo: "Briefing de vídeo e motion",
    nome: "Vídeo e motion",
    descricao: "Cerca de 15 minutos · salva sozinho",
    ajuda: AJUDA_COMUM,
    minutos: 15,
    blocos: [blocoIdentificacao({ comInvestimento: true }), blocoNegocio(), blocoPublico(), blocoVideo(), blocoPersonalidade(), blocoVisual(2), blocoFechamento()],
  }),
};

// ------------------------------------------------------------------ leitura e validação

export function ehSlugDeBriefing(v: unknown): v is SlugDoModelo {
  return typeof v === "string" && SLUGS_DE_BRIEFING.indexOf(v as SlugDoModelo) >= 0;
}

export function modeloDeFabrica(slug: unknown): ModeloDeBriefing {
  return ehSlugDeBriefing(slug) ? MODELOS_DE_FABRICA[slug] : MODELOS_DE_FABRICA.diagnostico;
}

const txt = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");
const CHAVE = /^[A-Za-z][A-Za-z0-9_]{0,48}$/;

/**
 * Normaliza um modelo vindo do banco (editado pelo dono) ou da cópia no link.
 * O que não for reconhecido sai; chave repetida sai; modelo sem nenhum campo
 * válido volta null (quem chama cai no de fábrica).
 */
export function normalizarModelo(bruto: unknown, slugEsperado?: SlugDoModelo): ModeloDeBriefing | null {
  if (!bruto || typeof bruto !== "object" || Array.isArray(bruto)) return null;
  const b = bruto as Record<string, unknown>;
  const slug = ehSlugDeBriefing(b.slug) ? b.slug : slugEsperado;
  if (!slug) return null;
  if (slugEsperado && slug !== slugEsperado) return null;
  const base = MODELOS_DE_FABRICA[slug];
  const vistas = new Set<string>();
  const blocos: BlocoDoBriefing[] = [];
  const blocosBrutos = Array.isArray(b.blocos) ? b.blocos : [];
  for (const bb of blocosBrutos.slice(0, 30)) {
    if (!bb || typeof bb !== "object") continue;
    const bl = bb as Record<string, unknown>;
    const campos: CampoDoBriefing[] = [];
    for (const cc of (Array.isArray(bl.campos) ? bl.campos : []).slice(0, 60)) {
      const c = normalizarCampo(cc);
      if (!c || vistas.has(c.key)) continue;
      vistas.add(c.key);
      campos.push(c);
    }
    if (!campos.length) continue;
    blocos.push({ id: txt(bl.id, 40) || `bloco${blocos.length + 1}`, titulo: txt(bl.titulo, 80) || "Perguntas", campos });
  }
  if (!blocos.length) return null;
  const versao = Math.max(1, Math.floor(Number(b.versao) || 1));
  const passos = Array.isArray(b.proximosPassos)
    ? (b.proximosPassos as unknown[]).map((p) => {
        const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
        return { titulo: txt(o.titulo, 80), texto: txt(o.texto, 200) };
      }).filter((p) => p.titulo).slice(0, 5)
    : [];
  return {
    slug,
    versao,
    titulo: txt(b.titulo, 80) || base.titulo,
    nome: txt(b.nome, 40) || base.nome,
    descricao: txt(b.descricao, 90) || base.descricao,
    ajuda: txt(b.ajuda, 800) || base.ajuda,
    minutos: Math.max(1, Math.min(90, Math.floor(Number(b.minutos) || base.minutos))),
    blocos,
    proximosPassos: passos.length ? passos : base.proximosPassos,
  };
}

const CATEGORIAS_DE_ANEXO = Object.keys(ROTULO_DA_CATEGORIA) as CategoriaDeAnexo[];
const CATEGORIAS_DA_DECUPAGEM: CategoriaDaDecupagem[] = ["palavra_chave", "dor", "publico", "restricao", "referencia", "tom", "objetivo"];
const CAMPOS_DO_CONTEXTO: CampoDoContexto[] = ["negocio", "publico", "oferta", "diferenciais", "tom_de_voz"];
const ORIGENS: OrigemDoDadoSabido[] = ["empresa", "site", "instagram", "segmento", "negocio", "publico", "oferta", "diferenciais"];

function normalizarCampo(bruto: unknown): CampoDoBriefing | null {
  if (!bruto || typeof bruto !== "object") return null;
  const c = bruto as Record<string, unknown>;
  const key = txt(c.key, 49);
  const tipo = c.tipo as TipoDeCampo;
  const pergunta = txt(c.pergunta, 240);
  if (!CHAVE.test(key) || TIPOS_DE_CAMPO.indexOf(tipo) < 0 || !pergunta) return null;
  const lista = (v: unknown, max: number) => (Array.isArray(v) ? v.map((x) => txt(x, 120)).filter(Boolean).slice(0, max) : []);
  const campo: CampoDoBriefing = { key, tipo, pergunta };
  const apoio = txt(c.apoio, 240);
  if (apoio) campo.apoio = apoio;
  if (c.obrigatorio === true) campo.obrigatorio = true;
  const placeholder = txt(c.placeholder, 120);
  if (placeholder) campo.placeholder = placeholder;
  if (tipo === "single-chip" || tipo === "multi-chip") {
    const opcoes = lista(c.opcoes, 40);
    if (opcoes.length < 2) return null;
    campo.opcoes = opcoes;
    if (c.outro === true) campo.outro = true;
    const max = Math.floor(Number(c.maxSelect) || 0);
    if (tipo === "multi-chip" && max > 0) campo.maxSelect = max;
  }
  if (tipo === "textarea" || tipo === "text") {
    const max = Math.floor(Number(c.maxChars) || 0);
    if (max > 0) campo.maxChars = Math.min(max, 4000);
  }
  if (tipo === "scale") {
    const p = lista(c.polos, 2);
    if (p.length !== 2) return null;
    campo.polos = [p[0], p[1]];
  }
  if (tipo === "reference" || tipo === "url") {
    const min = Math.floor(Number(c.minimo) || 0);
    if (min > 0) campo.minimo = Math.min(min, 10);
    if (tipo === "url" && c.multiplo === true) campo.multiplo = true;
  }
  if (tipo === "upload") {
    campo.categoria = CATEGORIAS_DE_ANEXO.indexOf(c.categoria as CategoriaDeAnexo) >= 0 ? (c.categoria as CategoriaDeAnexo) : "outros";
  }
  if (tipo === "checklist") {
    const itens = lista(c.itens, 20);
    if (!itens.length) return null;
    campo.itens = itens;
  }
  if (tipo === "confirm") {
    if (ORIGENS.indexOf(c.origem as OrigemDoDadoSabido) >= 0) campo.origem = c.origem as OrigemDoDadoSabido;
  }
  if (c.mostrarSe && typeof c.mostrarSe === "object") {
    const m = c.mostrarSe as Record<string, unknown>;
    const k = txt(m.key, 49);
    const v = Array.isArray(m.valor) ? lista(m.valor, 10) : txt(m.valor, 120);
    if (CHAVE.test(k) && (Array.isArray(v) ? v.length : v)) campo.mostrarSe = { key: k, valor: v };
  }
  if (CATEGORIAS_DA_DECUPAGEM.indexOf(c.decupa as CategoriaDaDecupagem) >= 0) campo.decupa = c.decupa as CategoriaDaDecupagem;
  if (CAMPOS_DO_CONTEXTO.indexOf(c.alimenta as CampoDoContexto) >= 0) campo.alimenta = c.alimenta as CampoDoContexto;
  return campo;
}

/** Linha de public.briefing_modelos (versão editada pelo dono). */
export type LinhaDeModelo = { slug: string; versao: number; conteudo: unknown; ativo?: boolean | null };

/**
 * O modelo que vale hoje para um serviço: a versão ativa mais nova do banco,
 * se for mais nova que a de fábrica e estiver íntegra; senão, a de fábrica.
 */
export function modeloVigente(slug: SlugDoModelo, linhas: LinhaDeModelo[] | null | undefined): ModeloDeBriefing {
  const fabrica = MODELOS_DE_FABRICA[slug];
  const candidatas = (linhas || [])
    .filter((l) => l && l.slug === slug && l.ativo !== false && Number(l.versao) > fabrica.versao)
    .sort((a, b) => Number(b.versao) - Number(a.versao));
  for (const l of candidatas) {
    const m = normalizarModelo({ ...(l.conteudo as Record<string, unknown>), slug, versao: l.versao }, slug);
    if (m) return m;
  }
  return fabrica;
}

/** O modelo gravado no link (cópia), ou o de fábrica do slug (links antigos). */
export function modeloDoLink(slug: unknown, conteudo: unknown): ModeloDeBriefing {
  const s = ehSlugDeBriefing(slug) ? slug : "diagnostico";
  return normalizarModelo(conteudo, s) ?? MODELOS_DE_FABRICA[s];
}

export function camposDoModelo(m: ModeloDeBriefing): CampoDoBriefing[] {
  const out: CampoDoBriefing[] = [];
  m.blocos.forEach((b) => b.campos.forEach((c) => out.push(c)));
  return out;
}

// ------------------------------------------------------------------ respostas

export const chaveDoOutro = (key: string) => `${key}__outro`;
export const chaveDaConfirmacao = (key: string) => `${key}__ok`;

/** O campo aparece com as respostas de agora (condicional)? */
export function campoVisivel(campo: CampoDoBriefing, respostas: Respostas): boolean {
  if (!campo.mostrarSe) return true;
  const atual = respostas[campo.mostrarSe.key];
  const alvo = campo.mostrarSe.valor;
  const aceitos = Array.isArray(alvo) ? alvo : [alvo];
  if (Array.isArray(atual)) return atual.some((v) => aceitos.indexOf(String(v)) >= 0);
  return typeof atual === "string" && aceitos.indexOf(atual) >= 0;
}

/** Url aceita: http(s) com host com ponto, ou @perfil, ou domínio sem protocolo. */
export function urlValida(v: string): boolean {
  const s = String(v || "").trim();
  if (!s) return false;
  if (/^@[A-Za-z0-9_.]{1,40}$/.test(s)) return true;
  const comProtocolo = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(comProtocolo);
    return (u.protocol === "https:" || u.protocol === "http:") && u.hostname.indexOf(".") > 0 && !/\s/.test(s);
  } catch {
    return false;
  }
}

/** Lista de itens de referência válidos (com link válido ou imagem anexada). */
export function referenciasValidas(v: unknown): ItemDeReferencia[] {
  if (!Array.isArray(v)) return [];
  return (v as unknown[])
    .map((x) => (x && typeof x === "object" ? (x as ItemDeReferencia) : null))
    .filter((x): x is ItemDeReferencia => !!x && ((!!x.link && urlValida(x.link)) || !!x.anexo_id));
}

export function anexosDoCampo(anexos: AnexoDoBriefing[] | null | undefined, key: string): AnexoDoBriefing[] {
  return (anexos || []).filter((a) => a.campo === key);
}

/** O campo tem resposta que conta? */
export function campoRespondido(campo: CampoDoBriefing, respostas: Respostas, anexos: AnexoDoBriefing[] = []): boolean {
  const v = respostas[campo.key];
  switch (campo.tipo) {
    case "multi-chip":
      return (Array.isArray(v) && v.length > 0) || !!txt(respostas[chaveDoOutro(campo.key)], 200);
    case "single-chip":
      return typeof v === "string" && v.trim().length > 0;
    case "scale":
      return typeof v === "number" && v >= 1 && v <= 5;
    case "reference":
      return referenciasValidas(v).length >= Math.max(1, campo.minimo || 1);
    case "upload":
      return anexosDoCampo(anexos, campo.key).length > 0;
    case "url":
      if (campo.multiplo) return Array.isArray(v) && v.some((x) => urlValida(String(x)));
      return typeof v === "string" && urlValida(v);
    case "checklist":
      return !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length > 0;
    case "confirm":
      return (typeof v === "string" && v.trim().length > 0) || respostas[chaveDaConfirmacao(campo.key)] === true;
    default:
      return typeof v === "string" && v.trim().length > 0;
  }
}

/** Erro do campo para mostrar (obrigatório vazio, url inválida, referências de menos) ou null. */
export function erroDoCampo(campo: CampoDoBriefing, respostas: Respostas, anexos: AnexoDoBriefing[] = []): string | null {
  const v = respostas[campo.key];
  if (campo.tipo === "url" && !campo.multiplo && typeof v === "string" && v.trim() && !urlValida(v)) return "Confira o endereço.";
  if (campo.tipo === "reference" && campo.minimo && Array.isArray(v) && v.length) {
    const n = referenciasValidas(v).length;
    if (n < campo.minimo) return `Faltam ${campo.minimo - n} de ${campo.minimo}.`;
  }
  const exigido = campo.obrigatorio || (campo.tipo === "reference" && !!campo.minimo);
  if (!exigido || campoRespondido(campo, respostas, anexos)) return null;
  if (campo.tipo === "multi-chip") return "Escolha pelo menos uma opção.";
  if (campo.tipo === "reference") return `Envie pelo menos ${campo.minimo || 1}.`;
  if (campo.tipo === "upload") return "Anexe um arquivo.";
  if (campo.tipo === "confirm") return "Confirme ou corrija.";
  return "Responda esta pergunta.";
}

/** Campos visíveis e obrigatórios (ou com mínimo) ainda sem resposta. */
export function faltandoNoBriefing(m: ModeloDeBriefing, respostas: Respostas, anexos: AnexoDoBriefing[] = []): CampoDoBriefing[] {
  return camposDoModelo(m).filter((c) => campoVisivel(c, respostas) && erroDoCampo(c, respostas, anexos) !== null);
}

/** Progresso: respondidos de visíveis. */
export function progressoDoBriefing(m: ModeloDeBriefing, respostas: Respostas, anexos: AnexoDoBriefing[] = []): { respondidos: number; total: number; pct: number } {
  const visiveis = camposDoModelo(m).filter((c) => campoVisivel(c, respostas));
  const respondidos = visiveis.filter((c) => campoRespondido(c, respostas, anexos)).length;
  const total = visiveis.length || 1;
  return { respondidos, total: visiveis.length, pct: Math.round((respondidos / total) * 100) };
}

/** Dados já sabidos do cliente, para os campos `confirm`. */
export type DadosSabidos = Partial<Record<OrigemDoDadoSabido, string>>;

/** O pré-preenchimento do link: só as chaves `confirm` do modelo que têm dado. */
export function prefillDoModelo(m: ModeloDeBriefing, dados: DadosSabidos): Record<string, string> {
  const out: Record<string, string> = {};
  camposDoModelo(m).forEach((c) => {
    if (c.tipo !== "confirm" || !c.origem) return;
    const v = txt(dados[c.origem], 400);
    if (v) out[c.key] = v;
  });
  return out;
}

/** A resposta em texto, para leitura, PDF e decupagem. Vazio: "". */
export function textoDaResposta(campo: CampoDoBriefing, respostas: Respostas, anexos: AnexoDoBriefing[] = []): string {
  const v = respostas[campo.key];
  const outro = txt(respostas[chaveDoOutro(campo.key)], 300);
  switch (campo.tipo) {
    case "multi-chip": {
      const lista = Array.isArray(v) ? (v as unknown[]).map(String).filter(Boolean) : [];
      if (outro) lista.push(`Outro: ${outro}`);
      return lista.join(", ");
    }
    case "single-chip":
      return typeof v === "string" ? (v === "Outro" && outro ? `Outro: ${outro}` : v) : "";
    case "scale": {
      if (typeof v !== "number" || !campo.polos) return "";
      const [a, b] = campo.polos;
      if (v === 3) return `Equilíbrio entre ${a.toLowerCase()} e ${b.toLowerCase()}`;
      const lado = v < 3 ? a : b;
      return `${v <= 1 || v >= 5 ? "Bem" : "Mais"} ${lado.toLowerCase()} (${v} de 5)`;
    }
    case "reference":
      return referenciasValidas(v).map((r) => {
        const alvo = r.link || (anexos.find((a) => a.id === r.anexo_id)?.nome ?? "imagem anexada");
        return r.nota ? `${alvo} (${txt(r.nota, 300)})` : alvo;
      }).join("; ");
    case "upload":
      return anexosDoCampo(anexos, campo.key).map((a) => a.nome).join(", ");
    case "url":
      if (campo.multiplo) return (Array.isArray(v) ? (v as unknown[]).map(String) : []).filter((x) => x.trim()).join(", ");
      return typeof v === "string" ? v.trim() : "";
    case "checklist": {
      if (!v || typeof v !== "object" || Array.isArray(v)) return "";
      const rot: Record<string, string> = { tenho: "tenho", vou_enviar: "vou enviar", nao_tenho: "não tenho" };
      return Object.keys(v as object).map((k) => `${k}: ${rot[String((v as Record<string, unknown>)[k])] || String((v as Record<string, unknown>)[k])}`).join("; ");
    }
    default:
      return typeof v === "string" ? v.trim() : "";
  }
}

// ------------------------------------------------------------------ link

export type EstadoDoLink = "aberto" | "enviado" | "expirado";

/** O estado do link agora: enviado vence expirado (quem enviou pode ver o que enviou). */
export function estadoDoLink(l: { submitted?: boolean | null; expira_em?: string | null }, agora: Date = new Date()): EstadoDoLink {
  if (l.submitted) return "enviado";
  if (l.expira_em) {
    const t = new Date(l.expira_em).getTime();
    if (!isNaN(t) && t <= agora.getTime()) return "expirado";
  }
  return "aberto";
}

export { modeloDaMesa } from "./briefing-da-mesa.ts";

const DATA_CURTA = (iso: string | null | undefined): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const dois = (n: number) => (n < 10 ? `0${n}` : String(n));
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)}`;
};

/** Mensagem pronta para mandar o link (WhatsApp direto ou grupo). Sem travessão, sem exclamação. */
export function mensagemDoLink(p: { cliente?: string | null; modelo: ModeloDeBriefing; url: string; expiraEm?: string | null; grupo?: boolean }): string {
  const nome = txt(p.cliente, 80);
  const saudacao = p.grupo ? "Olá, pessoal." : nome ? `Olá, ${nome}.` : "Olá.";
  const linhas = [
    saudacao,
    `Segue o link do ${p.modelo.titulo.charAt(0).toLowerCase()}${p.modelo.titulo.slice(1)}. Leva cerca de ${p.modelo.minutos} minutos e fica salvo enquanto você preenche, então dá para parar e voltar pelo mesmo link.`,
    p.url,
  ];
  const ate = DATA_CURTA(p.expiraEm);
  if (ate) linhas.push(`O link vale até ${ate}. Qualquer dúvida, é só chamar.`);
  else linhas.push("Qualquer dúvida, é só chamar.");
  return linhas.join("\n\n");
}

/** Link do WhatsApp com o texto (com ou sem número). Número só com dígitos, com DDI 55 quando faltar. */
export function linkDoWhatsApp(texto: string, telefone?: string | null): string {
  let n = String(telefone || "").replace(/[^0-9]/g, "");
  if (n.length === 10 || n.length === 11) n = `55${n}`;
  const base = n.length >= 12 ? `https://wa.me/${n}` : "https://wa.me/";
  return `${base}?text=${encodeURIComponent(texto)}`;
}
