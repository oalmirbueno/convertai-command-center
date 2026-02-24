export type QuestionType = "text" | "textarea" | "single-chip" | "multi-chip";

export interface Question {
  key: string;
  block: string;
  blockLabel: string;
  question: string;
  hint: string;
  type: QuestionType;
  required: boolean;
  options?: string[];
  placeholder?: string;
  maxChars?: number;
  maxSelect?: number;
}

export const QUESTIONS: Question[] = [
  // BLOCO 1: SOBRE SUA EMPRESA
  {
    key: "companyName",
    block: "empresa",
    blockLabel: "Sobre sua Empresa",
    question: "Qual é o nome da sua empresa?",
    hint: "Pode ser o nome fantasia ou razão social.",
    type: "text",
    required: true,
    placeholder: "Ex: Padaria do Zé",
  },
  {
    key: "segment",
    block: "empresa",
    blockLabel: "Sobre sua Empresa",
    question: "Qual o segmento do seu negócio?",
    hint: "Selecione o que mais se aproxima.",
    type: "single-chip",
    required: true,
    options: [
      "Varejo", "Serviços", "Tecnologia", "Saúde", "Educação",
      "Alimentação", "Indústria", "Beleza e Estética", "Imobiliário", "Outro",
    ],
  },
  {
    key: "companyAge",
    block: "empresa",
    blockLabel: "Sobre sua Empresa",
    question: "Há quanto tempo sua empresa existe?",
    hint: "Isso nos ajuda a entender o estágio do negócio.",
    type: "single-chip",
    required: true,
    options: [
      "Estou começando agora", "Menos de 1 ano", "1 a 3 anos",
      "3 a 5 anos", "5 a 10 anos", "Mais de 10 anos",
    ],
  },
  {
    key: "companyDescription",
    block: "empresa",
    blockLabel: "Sobre sua Empresa",
    question: "Em uma frase, o que sua empresa faz?",
    hint: "Como você explicaria para alguém que nunca ouviu falar.",
    type: "textarea",
    required: true,
    placeholder: "Ex: Vendemos bolos artesanais por encomenda para festas e eventos...",
    maxChars: 200,
  },

  // BLOCO 2: PRESENÇA DIGITAL ATUAL
  {
    key: "digitalPresence",
    block: "presenca",
    blockLabel: "Presença Digital Atual",
    question: "Onde sua empresa está presente hoje?",
    hint: "Selecione todos que se aplicam.",
    type: "multi-chip",
    required: true,
    options: [
      "Instagram", "Facebook", "TikTok", "LinkedIn", "YouTube",
      "Site próprio", "Google Meu Negócio", "WhatsApp Business", "Nenhum ainda",
    ],
  },
  {
    key: "paidTraffic",
    block: "presenca",
    blockLabel: "Presença Digital Atual",
    question: "Você já investe em tráfego pago (anúncios)?",
    hint: "Meta Ads, Google Ads ou qualquer plataforma de anúncios.",
    type: "single-chip",
    required: true,
    options: [
      "Nunca investi", "Já investi mas parei", "Invisto até R$1.000/mês",
      "Invisto R$1.000-5.000/mês", "Invisto acima de R$5.000/mês",
    ],
  },
  {
    key: "digitalLevel",
    block: "presenca",
    blockLabel: "Presença Digital Atual",
    question: "Como você avalia sua presença digital hoje?",
    hint: "Seja honesto — isso nos ajuda a calibrar a estratégia.",
    type: "single-chip",
    required: true,
    options: [
      "Inexistente — preciso começar do zero",
      "Fraca — tenho perfis mas não posto",
      "Básica — posto às vezes, sem estratégia",
      "Razoável — tenho frequência mas poucos resultados",
      "Boa — funciona, mas quero escalar",
    ],
  },

  // BLOCO 3: OBJETIVOS E METAS
  {
    key: "objectives",
    block: "objetivos",
    blockLabel: "Objetivos e Metas",
    question: "Quais são seus principais objetivos agora?",
    hint: "Selecione até 3 prioridades.",
    type: "multi-chip",
    required: true,
    maxSelect: 3,
    options: [
      "Aumentar vendas", "Gerar mais leads", "Fortalecer a marca",
      "Aparecer no Google", "Lançar produto/serviço", "Melhorar redes sociais",
      "Automatizar processos", "Criar site profissional", "Outro",
    ],
  },
  {
    key: "expectedResults",
    block: "objetivos",
    blockLabel: "Objetivos e Metas",
    question: "Qual resultado você espera nos primeiros 3 meses?",
    hint: "Expectativas alinhadas = resultados melhores.",
    type: "single-chip",
    required: true,
    options: [
      "Começar a ter presença online",
      "Primeiros leads e contatos",
      "Aumento visível nas vendas",
      "Dobrar meu faturamento",
      "Não tenho expectativa definida ainda",
    ],
  },
  {
    key: "biggestChallenge",
    block: "objetivos",
    blockLabel: "Objetivos e Metas",
    question: "Qual é o maior desafio que sua empresa enfrenta hoje?",
    hint: "Pode ser marketing, vendas, operacional... fale abertamente.",
    type: "textarea",
    required: true,
    placeholder: "Ex: Tenho muita concorrência local e não sei como me diferenciar...",
    maxChars: 300,
  },

  // BLOCO 4: PÚBLICO E MERCADO
  {
    key: "idealClient",
    block: "publico",
    blockLabel: "Público e Mercado",
    question: "Descreva seu cliente ideal em uma frase.",
    hint: "Quem compra (ou compraria) de você? Idade, perfil, comportamento.",
    type: "textarea",
    required: true,
    placeholder: "Ex: Mulheres de 25-45 anos, classe B, que buscam praticidade...",
    maxChars: 200,
  },
  {
    key: "region",
    block: "publico",
    blockLabel: "Público e Mercado",
    question: "Qual a região de atuação do seu negócio?",
    hint: "Onde seus clientes estão.",
    type: "single-chip",
    required: true,
    options: [
      "Bairro / cidade específica", "Regional (algumas cidades)",
      "Estadual", "Nacional", "Internacional",
    ],
  },
  {
    key: "howClientsFind",
    block: "publico",
    blockLabel: "Público e Mercado",
    question: "Como seus clientes te encontram hoje?",
    hint: "Selecione todos.",
    type: "multi-chip",
    required: true,
    options: [
      "Indicação boca a boca", "Instagram / redes sociais",
      "Pesquisa no Google", "WhatsApp", "Ponto físico",
      "Marketplace (iFood, Mercado Livre...)", "Não sei ao certo",
    ],
  },

  // BLOCO 5: INVESTIMENTO E EXPECTATIVAS
  {
    key: "budget",
    block: "investimento",
    blockLabel: "Investimento e Expectativas",
    question: "Qual faixa de investimento mensal você tem em mente para marketing?",
    hint: "Inclui serviços + verba de anúncios. Sem compromisso.",
    type: "single-chip",
    required: true,
    options: [
      "Até R$1.000/mês", "R$1.000 a R$2.500/mês", "R$2.500 a R$5.000/mês",
      "R$5.000 a R$10.000/mês", "Acima de R$10.000/mês", "Ainda não sei",
    ],
  },
  {
    key: "additionalNotes",
    block: "investimento",
    blockLabel: "Investimento e Expectativas",
    question: "Tem algo mais que gostaria de nos contar?",
    hint: "Referências, preocupações, expectativas... tudo é válido. (Opcional)",
    type: "textarea",
    required: false,
    placeholder: "Fique à vontade para complementar...",
    maxChars: 500,
  },
];
