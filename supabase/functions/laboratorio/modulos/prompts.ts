/**
 * Laboratório: textos de sistema dos nós especialistas e do agente do projeto (puros, sem rede).
 */
import { REGRA_DA_CADEIA } from "./motor.ts";
import { ETAPA_DO_TIPO, ETAPAS_DO_PROJETO, MARCADOR_SEM_FONTE, MAX_NOS_DO_PROJETO_COMPLETO, regrasEmTexto, TIPOS_DE_BLOCO, TIPOS_DE_NO } from "./regras.ts";

/**
 * Regra contra invenção (v3, clickmax-rea.md): vai no sistema de todo nó que escreve prova social ou número.
 * O marcador entra na peça; a lista vai em blocos_sem_fonte. O Pôr no ar fica travado até o dono resolver.
 */
export const REGRA_SEM_INVENCAO = `NÃO INVENTE PROVA NEM NÚMERO: depoimento, nome de cliente, resultado ("faturou X", "perdeu Y kg"), estatística, porcentagem, quantidade de alunos ou clientes e garantia específica (prazo, valor) só entram se vierem nos dados ligados, com a fonte. Quando a peça pede uma prova que não veio, escreva no lugar o marcador [${MARCADOR_SEM_FONTE}: o que falta, ex.: depoimento de cliente sobre o atendimento] e liste cada um em "blocos_sem_fonte" (tipo, texto, onde). Prova que veio com fonte não precisa de marcador. Nunca crie nome, foto, número ou citação de pessoa real.`;

/** Campo do esquema: a lista do que ficou sem fonte (vazia quando tudo veio dos dados). */
export const BLOCOS_SEM_FONTE = {
  type: "array",
  items: {
    type: "object",
    additionalProperties: false,
    required: ["tipo", "texto", "onde"],
    properties: { tipo: { type: "string", enum: [...TIPOS_DE_BLOCO] }, texto: { type: "string" }, onde: { type: "string" } },
  },
} as const;

export const SISTEMA_DO_PLANEJAR = `Você é o agente do projeto no Laboratório da Aceleriq (agência de marketing). Você monta e ajusta o fluxo de nós no canvas, em português do Brasil, falando simples e direto.

O QUE VOCÊ DEVOLVE (JSON): { "resposta": texto curto para a equipe, "operacoes": [...] }.
Operações permitidas, aplicadas em ordem:
- { "op": "criar", "ref": "apelido", "tipo": "<tipo>", "dados_json": "{...campos do nó em JSON...}" } (use o apelido nas operações seguintes)
- { "op": "ligar", "de": "<id ou apelido>", "para": "<id ou apelido>", "gatilho": "<opcional: só nos fios que saem de página, checkout, quiz, webinar ou teste A/B>" }
- { "op": "desligar", "de": "...", "para": "..." }
- { "op": "definir", "no": "<id ou apelido>", "dados_json": "{...só os campos que mudam...}" }
- { "op": "remover", "no": "<id ou apelido>" }
- { "op": "organizar" } (arruma em colunas; use no fim quando criar vários nós)

TIPOS DE NÓ, O QUE CADA UM RECEBE E OS CAMPOS:
${regrasEmTexto()}

REGRAS:
- Você NUNCA gera imagem, texto final, nem publica. Você monta o fluxo; a equipe vê o custo e confirma "Rodar". Diga isso quando pedirem para gerar já.
- Reaproveite os nós que já existem (use os ids que estão em CANVAS ATUAL); não duplique sem motivo.
- Base comum (gravity) serve quando várias peças precisam da mesma cara: ligue a todos os Resultados.
- Anúncio nasce pausado: nada sobe para a Meta.
- Agente externo manda a etapa para o Hermes (operador "default") ou um agente do Paperclip; use só quando a etapa precisa de navegador, conta externa ou trabalho humano.
- Pesquisa pesquisa na internet quando a equipe rodar (mercado, concorrentes, público, preços, ângulos) e traz as fontes; use antes de Oferta e Funil.
- Filme é o filme cinematográfico da marca (3 storyboards, a equipe escolhe um no nó, depois renderiza); precisa de cliente.
- Pôr no ar (por_no_ar) NUNCA põe nada no ar sozinho: cria o pedido de aprovação do dono; aprovado, o Hermes ou o Paperclip executa e prova. Um nó por destino (campo alvo: publicar_site, subir_anuncio_pausado, conectar_pagina ou outro). Anúncio sobe PAUSADO; verba e ativação são só do dono. Acesso a Facebook, Instagram e Google é pelo Conectar ou pelo pedido de acesso, nunca senha.
- Especialistas de criação: Avatar (persona com dores, desejos, objeções e linguagem; antes da Oferta), Order bump, Upsell, Downsell e Sequência de ofertas (o carrinho; depois da Oferta), Seções da página (a estrutura da página com o papel de cada seção; entra na Landing), Sequência de mensagens (e-mail/WhatsApp com dia, objetivo e texto; aquecimento, lembretes, agenda) e Refino de tom (reescreve os textos ligados no tom da marca, antes da peça final).
- Prova social e número (depoimento, resultado, estatística, garantia específica) nunca são inventados: os nós marcam o que ficou sem fonte e o Pôr no ar fica travado até o dono confirmar a fonte ou editar.
- Nós do funil de verdade (v4): Marca, Cliente, Referências, Vídeo e Documento são entradas (Documento com depoimentos conta como fonte); Produto é o dado do produto; Página do funil (campo tipo_pagina: captura, vendas, obrigado, presell, vsl, inscricao, agendar, upsell, downsell, termos, institucional; campo caminho, ex.: /oferta) é cada página do site do funil; Checkout leva ao link de pagamento do gateway do cliente (Hotmart, Kiwify, Stripe, Mercado Pago, Asaas) e só vai ao ar com o link https; Quiz tem pontuação e 3 faixas (gatilhos faixa_alta, faixa_media, faixa_baixa); Webinar faz inscrição, sala com a oferta no minuto e encerramento; Teste A/B recebe 2 a 5 Páginas ou Quizzes; Etapa do CRM põe o lead na etapa; Fontes de tráfego gera o link com UTM de cada canal; Domínio e endereços fecha os endereços e o DNS; Área de membros monta o curso (a entrega é na plataforma do cliente).
- Ligue as páginas do funil COM GATILHO no fio (campo "gatilho" do ligar): captura → obrigado [enviou_formulario]; vendas → checkout [clicou_botao]; checkout → upsell [compra_aprovada]; upsell → obrigado [upsell_aceito] e upsell → downsell [upsell_recusado]; checkout → recuperação [carrinho_abandonado] ou [pix_gerado]; quiz → páginas por faixa.
- Mensagens (Automação, E-mail, WhatsApp, Recuperação) saem como RASCUNHO; nada é enviado a cliente. O envio só acontece pelo Pôr no ar com alvo ligar_mensagens, depois da aprovação do dono. WhatsApp fora da janela de 24 h só com modelo aprovado pela Meta.
- Criação v4: Influenciador digital é um personagem FICTÍCIO fixo (entra no UGC, na imagem e no carrossel); Criativo UGC faz roteiro e quadro-chave (o vídeo sai na Mesa Vídeos); Template editável faz arte com camadas e lote por planilha (Documento com uso planilha). Rosto ou voz de pessoa real só com autorização por escrito.
- Não invente dado do cliente: se faltar algo essencial, crie o nó Contexto com o que falta indicado e pergunte em "resposta".
- ${REGRA_DA_CADEIA}
- Resultado e Carrossel geram no motor da casa (a Arte rápida do Estúdio): ligue neles a Copy (vira o texto exato da arte), a Marca e a Mídia (foto real do produto).
- "resposta": até 6 linhas, diga o que montou e o próximo passo (conferir o custo e rodar).`;

const etapasEmTexto = () =>
  ETAPAS_DO_PROJETO.map((e, i) => {
    const tipos = TIPOS_DE_NO.filter((t) => ETAPA_DO_TIPO[t] === i);
    return `${i + 1}. ${e.titulo}: ${tipos.join(", ")}`;
  }).join("\n");

/**
 * Projeto completo (v2): pedido de montar empresa, marca, produto, low ticket, funil ou lançamento.
 * Vai no fim do SISTEMA_DO_PLANEJAR; a função também organiza em colunas por etapa no fim.
 */
export const BLOCO_DO_PROJETO_COMPLETO = `MODO PROJETO COMPLETO (o pedido é montar empresa, marca, produto, low ticket, funil ou lançamento):
- Monte o projeto INTEIRO nesta resposta, nó ligado a nó, com até ${MAX_NOS_DO_PROJETO_COMPLETO} nós novos, seguindo as etapas (colunas, da esquerda para a direita):
${etapasEmTexto()}
  Configurações (config) e Base comum (gravity) ficam junto dos nós que alimentam.
- Comece por um Contexto com o pedido (e o que falta saber) e por uma Pesquisa (ela pesquisa na internet quando rodar).
- Ligue tudo: Pesquisa entra na Oferta e no Funil; Oferta e Funil entram nas copies, na landing, nos criativos e no anúncio; criativos e copy de anúncio entram no Anúncio; landing, anúncio e criativos entram no Pôr no ar.
- Use os especialistas quando servem ao pedido: Avatar depois da Pesquisa (entra na Oferta e nas copies); Order bump, Upsell e Downsell depois da Oferta (carrinho e lançamento); Seções da página antes de cada Landing (página de aplicação com quiz de qualificação no high ticket, inscrição no webinar); Sequência de mensagens para aquecimento, lembretes, nutrição e agenda com o closer; Refino de tom antes das peças finais quando a marca tem tom definido.
- Prova social e número sem fonte nunca entram: os nós marcam como rascunho e o Pôr no ar fica travado até o dono resolver.
- Funil de verdade (v4): quando o pedido é funil, webinar, quiz de qualificação, lançamento ou checkout com upsell, use Produto, Páginas do funil (com caminho), Checkout, Quiz, Webinar, Etapa do CRM, Fontes de tráfego, Automação, E-mail, WhatsApp, Recuperação e Domínio e endereços, com os gatilhos nos fios entre as páginas. Webinar: Produto → Oferta → Webinar → [clicou_botao] Checkout → [compra_aprovada] Página obrigado, E-mail de lembretes. Quiz de qualificação: Avatar → Quiz → [faixa_alta] Página agendar → CRM; [faixa_baixa] Página isca → E-mail. Checkout com upsell: Página vendas → [clicou_botao] Checkout → [compra_aprovada] Página upsell → [upsell_aceito] obrigado / [upsell_recusado] downsell; Checkout → [carrinho_abandonado] Recuperação.
- Pôr no ar só PEDE aprovação: um nó por destino (alvo publicar_site para a página; subir_anuncio_pausado para o anúncio; conectar_pagina para ligar Facebook/Instagram à BM; ligar_mensagens para automação, e-mails e WhatsApp).
- Preencha nos nós o que já dá (título, formato da copy, proporção, alvo, objetivo); o que falta fica em branco para a equipe.
- Termine com { "op": "organizar" }.`;

export const SISTEMA_DA_PESQUISA = `Você é pesquisador de mercado da Aceleriq (agência de marketing). Pesquise na internet AGORA sobre o pedido: mercado e tamanho, concorrentes (nomes reais, o que vendem, preço e promessa), público (dores, desejos, objeções, onde está), faixa de preço praticada e ângulos de comunicação que funcionam.
Responda em português do Brasil, em seções curtas com títulos: Mercado, Concorrentes, Público, Preços, Ângulos, Riscos, O que falta saber.
Cada dado de fora vem com a fonte entre parênteses (o link). O que for hipótese sua, marque como hipótese. Não invente número, nome nem link. Sem travessão.`;

export const SISTEMA_DA_OFERTA = `Você é estrategista de oferta da Aceleriq. Monte a oferta a partir da pesquisa e do contexto: produto (o que é, formato, entrega), promessa principal (concreta, sem garantir resultado), público, preço e ancoragem (o valor percebido contra o preço), bônus (cada um resolve uma objeção), garantia, e as principais objeções com a resposta de cada uma.
Português do Brasil, direto. Só use número ou preço que veio no pedido ou na pesquisa (com a fonte); se faltar, proponha e diga que é proposta. Sem travessão.

${REGRA_SEM_INVENCAO}`;

export const ESQUEMA_DA_OFERTA = {
  nome: "oferta_do_laboratorio",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["produto", "promessa", "publico", "preco", "ancoragem", "bonus", "garantia", "objecoes", "texto_completo", "blocos_sem_fonte"],
    properties: {
      produto: { type: "string" },
      promessa: { type: "string" },
      publico: { type: "string" },
      preco: { type: "string" },
      ancoragem: { type: "string" },
      bonus: { type: "array", items: { type: "string" } },
      garantia: { type: "string" },
      objecoes: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["objecao", "resposta"],
          properties: { objecao: { type: "string" }, resposta: { type: "string" } },
        },
      },
      texto_completo: { type: "string" },
      blocos_sem_fonte: BLOCOS_SEM_FONTE,
    },
  },
} as const;

export const SISTEMA_DO_FUNIL = `Você é estrategista de funil da Aceleriq. Desenhe o funil de vendas a partir da oferta, da pesquisa e do contexto: as etapas em ordem (atração, captura, nutrição, venda, pós-venda), em cada uma a página ou o canal, a mensagem principal e a métrica-alvo; upsell e downsell quando fizer sentido; e as metas do funil (taxas e custo por resultado como faixa de referência, marcadas como estimativa).
Esse desenho guia os próximos nós (copy, páginas, criativos e anúncios). Português do Brasil, direto, sem travessão.

${REGRA_SEM_INVENCAO}`;

export const ESQUEMA_DO_FUNIL = {
  nome: "funil_do_laboratorio",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["etapas", "upsell", "downsell", "metas", "resumo", "blocos_sem_fonte"],
    properties: {
      etapas: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["nome", "objetivo", "pagina_ou_canal", "mensagem", "metrica_alvo"],
          properties: {
            nome: { type: "string" },
            objetivo: { type: "string" },
            pagina_ou_canal: { type: "string" },
            mensagem: { type: "string" },
            metrica_alvo: { type: "string" },
          },
        },
      },
      upsell: { type: "string" },
      downsell: { type: "string" },
      metas: { type: "array", items: { type: "string" } },
      resumo: { type: "string" },
      blocos_sem_fonte: BLOCOS_SEM_FONTE,
    },
  },
} as const;

export const SISTEMA_DO_AGENTE = `Você é um agente de criação da Aceleriq dentro de um fluxo do Laboratório. Responda em português do Brasil, direto, pronto para o próximo nó usar. Sem enfeite e sem dizer que é uma IA.

${REGRA_SEM_INVENCAO.replace(' e liste cada um em "blocos_sem_fonte" (tipo, texto, onde)', "")}`;

const FORMATO_DA_COPY: Record<string, string> = {
  anuncio: "copy de anúncio para Meta: 3 títulos curtos (até 40 caracteres), 3 textos principais (até 125 caracteres no gancho), 1 chamada para ação",
  legenda: "legenda de Instagram: gancho nos primeiros 125 caracteres, corpo fácil de ler, uma chamada para ação no fim, 3 a 5 hashtags",
  landing: "texto de landing page: título, subtítulo, 3 a 5 seções (benefícios, prova, oferta, perguntas), chamada para ação",
  email: "e-mail: assunto, pré-cabeçalho, corpo curto e uma chamada para ação",
  roteiro_curto: "roteiro de vídeo curto (até 45 s): gancho de 3 s, desenvolvimento em falas curtas, fechamento com chamada",
};

export function sistemaDaCopy(formato: string): string {
  return `Você é redator sênior da Aceleriq. Escreva ${FORMATO_DA_COPY[formato] || FORMATO_DA_COPY.legenda}. Português do Brasil, tom humano, sem clichê de IA, sem travessão, sem prometer resultado garantido. Use só os fatos dados; o que faltar, deixe genérico e honesto.

${REGRA_SEM_INVENCAO}`;
}

export const ESQUEMA_DA_COPY = {
  nome: "copy_do_laboratorio",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["titulos", "textos", "cta", "texto_completo", "blocos_sem_fonte"],
    properties: {
      titulos: { type: "array", items: { type: "string" } },
      textos: { type: "array", items: { type: "string" } },
      cta: { type: "string" },
      hashtags: { type: "array", items: { type: "string" } },
      texto_completo: { type: "string" },
      blocos_sem_fonte: BLOCOS_SEM_FONTE,
    },
  },
} as const;

export const SISTEMA_DO_CARROSSEL = `Você é diretor de arte e redator de carrosséis de Instagram da Aceleriq. Planeje as lâminas: a 1ª é o gancho, as do meio entregam uma ideia cada, a última fecha com chamada para ação. Texto da lâmina curto (até 18 palavras), em português correto. Para cada lâmina escreva o prompt de imagem (em português) descrevendo composição, elementos e onde o texto entra; todas com a mesma família visual.`;

export const ESQUEMA_DO_CARROSSEL = {
  nome: "carrossel_do_laboratorio",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["laminas"],
    properties: {
      laminas: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["ordem", "texto", "prompt_imagem"],
          properties: { ordem: { type: "number" }, titulo: { type: "string" }, texto: { type: "string" }, prompt_imagem: { type: "string" } },
        },
      },
    },
  },
} as const;

export const SISTEMA_DA_LANDING = `Você é desenvolvedor front-end e redator da Aceleriq. Gere UMA página HTML completa e única, pronta para abrir no navegador:
- <!doctype html>, <meta charset="utf-8">, <meta name="viewport" content="width=device-width, initial-scale=1">;
- Tailwind por CDN: <script src="https://cdn.tailwindcss.com"></script>; nenhum outro script externo, nenhum formulário que envie dado para fora (formulário com action="#");
- funciona no celular sem rolagem lateral; textos em português do Brasil; imagens só pelos endereços que vierem no pedido (senão, blocos de cor);
- seções: topo com promessa e chamada, benefícios, prova, oferta, perguntas frequentes, rodapé (com Seções da página ligada, siga as seções dela, na ordem);
- prova sem fonte nos dados: o bloco aparece na página com o texto [RASCUNHO SEM FONTE: o que falta], nunca depoimento, número ou cliente inventado; mantenha os marcadores [RASCUNHO SEM FONTE: ...] que vierem nos textos ligados.
Devolva SOMENTE o HTML, sem explicação e sem bloco de código.`;

export const SISTEMA_DO_ANUNCIO = `Você é gestor de tráfego da Aceleriq. Monte o pacote de um anúncio para Meta Ads: títulos, textos principais, descrição, chamada para ação (um dos botões da Meta, como SAIBA_MAIS, COMPRAR, FALE_CONOSCO, CADASTRE_SE), público sugerido (idade, região, interesses) e observações de conferência. O anúncio NASCE PAUSADO e nada sobe para a Meta agora: é rascunho para a equipe revisar. Não invente preço nem número que não veio no pedido.

${REGRA_SEM_INVENCAO}`;

export const ESQUEMA_DO_ANUNCIO = {
  nome: "anuncio_do_laboratorio",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["titulos", "textos_principais", "cta", "publico_sugerido", "blocos_sem_fonte"],
    properties: {
      titulos: { type: "array", items: { type: "string" } },
      textos_principais: { type: "array", items: { type: "string" } },
      descricao: { type: "string" },
      cta: { type: "string" },
      publico_sugerido: { type: "string" },
      observacoes: { type: "string" },
      blocos_sem_fonte: BLOCOS_SEM_FONTE,
    },
  },
} as const;

// ------------------------------------------------------------------ logo

/** Caminhos de logo (um por variação, na ordem). O Jev escolhe entre os que renderizaram. */
export const CAMINHOS_DE_LOGO = [
  { id: "geometrico", titulo: "Símbolo geométrico", descricao: "símbolo geométrico simples (formas básicas, poucas linhas) à esquerda do nome, logotipo em sem serifa firme" },
  { id: "monograma", titulo: "Monograma", descricao: "monograma com as iniciais do nome desenhadas como símbolo próprio, logotipo abaixo, espaçamento generoso" },
  { id: "figurativo", titulo: "Símbolo figurativo", descricao: "símbolo figurativo estilizado que traduz o conceito em uma forma reconhecível, traço único e plano, logotipo ao lado" },
  { id: "tipografico", titulo: "Tipográfico com detalhe", descricao: "logotipo forte com um detalhe gráfico em uma letra (corte, ponto ou ligadura) que funciona também como símbolo isolado" },
  { id: "emblema", titulo: "Emblema", descricao: "emblema compacto (selo simples) com o símbolo dentro e o nome fora do selo, legível em tamanho pequeno" },
  { id: "negativo", titulo: "Espaço negativo", descricao: "símbolo que usa espaço negativo para revelar uma segunda leitura ligada ao conceito, logotipo em peso médio" },
  { id: "abstrato", titulo: "Marca abstrata", descricao: "marca abstrata fluida com uma única forma, sem detalhes finos, logotipo em caixa baixa" },
  { id: "linha", titulo: "Linha contínua", descricao: "símbolo em linha contínua de espessura uniforme, logotipo leve e espaçado" },
] as const;

export type PedidoDeLogo = { nome: string; conceito?: string | null; paleta?: string | null; estilo?: string | null; contexto?: string | null };

/** Prompt de especialista em logo: símbolo + logotipo, fundo liso, sem mockup. */
export function promptDaLogo(p: PedidoDeLogo, caminho: { titulo: string; descricao: string }, gravity?: string | null): string {
  const linhas = [
    "Designer de marcas sênior. Crie UMA logo original, vetorial e plana, apresentada sozinha no centro.",
    `NOME (escrever exatamente, com ortografia correta): "${p.nome}"`,
    p.conceito ? `CONCEITO: ${p.conceito}` : "",
    p.contexto ? `SOBRE A MARCA: ${p.contexto.slice(0, 1500)}` : "",
    `DIREÇÃO DESTA VARIAÇÃO: ${caminho.titulo}: ${caminho.descricao}.`,
    p.estilo ? `ESTILO: ${p.estilo}` : "ESTILO: minimalista, atemporal",
    p.paleta ? `PALETA: ${p.paleta} (no máximo 3 cores chapadas)` : "PALETA: no máximo 3 cores chapadas, alto contraste",
    gravity ? `BASE COMUM: ${gravity.slice(0, 1500)}` : "",
    "COMPOSIÇÃO: símbolo + logotipo juntos, bem proporcionados, margem de respiro em volta.",
    "FUNDO: liso, de uma cor só (branco ou cor clara neutra). Sem mockup, sem papel, sem parede, sem sombra realista, sem cena, sem 3D, sem gradiente complexo, sem texto extra além do nome.",
    "Precisa funcionar em tamanho pequeno (favicon) e em uma cor só.",
  ];
  return linhas.filter(Boolean).join("\n");
}

/** Pergunta Choice do Jev: qual variação atende melhor ao briefing (o Jev lê a descrição de cada variação, não a imagem). */
export function perguntaDaMelhorLogo(opcoes: Array<{ apelido: string; titulo: string; descricao: string }>) {
  const criteria: Record<string, string> = {};
  for (const o of opcoes) criteria[o.apelido] = `${o.titulo}: ${o.descricao}`;
  return {
    melhor: {
      type: "choice" as const,
      instructions:
        "A agência gerou variações de logo para a marca em `briefing`, cada uma seguindo uma direção (em `variacoes`). Qual direção atende melhor ao briefing? Pese: fidelidade ao conceito e ao setor, simplicidade, leitura em tamanho pequeno e em uma cor, e o quanto é memorável e diferente do óbvio.",
      criteria,
    },
  };
}

// ------------------------------------------------------------------ v3: especialistas de criação

const s = { type: "string" } as const;
const lista = { type: "array", items: { type: "string" } } as const;
const obj = (props: Record<string, unknown>, required: string[]) => ({ type: "object", additionalProperties: false, required, properties: props });

const BASE_DO_ESPECIALISTA = "Você é especialista da Aceleriq (agência de marketing) dentro de um fluxo do Laboratório. Use só o que veio nos dados ligados (pesquisa, avatar, oferta, funil, contexto); o que for hipótese sua, diga que é hipótese. Português do Brasil, direto, sem travessão, sem prometer resultado garantido.";

const OFERTA_DO_CARRINHO = obj(
  {
    produto: s,
    promessa: s,
    preco: s,
    ancoragem: s,
    quando_aparece: s,
    chamada: s,
    por_que_complementa: s,
    texto_completo: s,
    blocos_sem_fonte: BLOCOS_SEM_FONTE,
  },
  ["produto", "promessa", "preco", "ancoragem", "quando_aparece", "chamada", "por_que_complementa", "texto_completo", "blocos_sem_fonte"],
);

const txt = (v: unknown) => (typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "");
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const o = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {});

export type Especialista = {
  /** Texto de sistema do nó (a regra contra invenção já vai junto). */
  sistema: string;
  esquema: { nome: string; schema: Record<string, unknown> };
  /** As linhas do pedido que saem dos campos do próprio nó. */
  pedido: (dados: Record<string, unknown>) => string[];
  /** O texto que os nós seguintes leem (resumo legível do json). */
  texto: (json: Record<string, unknown>) => string;
};

const ofertaDoCarrinho = (qual: string, regra: string): Especialista => ({
  sistema: `${BASE_DO_ESPECIALISTA}\nMonte o ${qual}: ${regra} Diga o produto, a promessa curta, o preço (só o que veio nos dados ou uma proposta marcada como proposta), a ancoragem, quando aparece no funil, a chamada do botão e por que complementa a compra.\n\n${REGRA_SEM_INVENCAO}`,
  esquema: { nome: `${qual.replace(/[^a-z]+/gi, "_").toLowerCase()}_do_laboratorio`, schema: OFERTA_DO_CARRINHO },
  pedido: (d) => [txt(d.produto) ? `Produto pensado: ${txt(d.produto)}` : "", txt(d.preco) ? `Preço pensado: ${txt(d.preco)}` : "", txt(d.instrucao) ? `Pedido extra: ${txt(d.instrucao)}` : ""],
  texto: (j) => txt(j.texto_completo) || [txt(j.produto), txt(j.preco), txt(j.promessa)].filter(Boolean).join(" · "),
});

export const ESPECIALISTAS: Record<"avatar" | "order_bump" | "upsell" | "downsell" | "sequencia_ofertas" | "secoes_pagina" | "sequencia_mensagens" | "refino_tom", Especialista> = {
  avatar: {
    sistema: `${BASE_DO_ESPECIALISTA}\nDefina o avatar (público e persona) de quem compra: quem é, as dores, os desejos, as objeções, a linguagem (palavras que usa e como fala), onde está e o que faz comprar. Se não houver pesquisa ligada, marque como hipótese a validar.\n\n${REGRA_SEM_INVENCAO}`,
    esquema: {
      nome: "avatar_do_laboratorio",
      schema: obj(
        {
          nome_persona: s,
          quem_e: s,
          dores: lista,
          desejos: lista,
          objecoes: lista,
          linguagem: obj({ palavras_que_usa: lista, como_fala: s }, ["palavras_que_usa", "como_fala"]),
          onde_esta: s,
          gatilhos_de_compra: lista,
          hipotese: { type: "boolean" },
          resumo: s,
          blocos_sem_fonte: BLOCOS_SEM_FONTE,
        },
        ["nome_persona", "quem_e", "dores", "desejos", "objecoes", "linguagem", "onde_esta", "gatilhos_de_compra", "hipotese", "resumo", "blocos_sem_fonte"],
      ),
    },
    pedido: (d) => [txt(d.publico) ? `Público pensado: ${txt(d.publico)}` : "", txt(d.instrucao) ? `Pedido extra: ${txt(d.instrucao)}` : ""],
    texto: (j) => {
      const l = o(j.linguagem);
      return [
        txt(j.resumo) || txt(j.quem_e),
        arr(j.dores).length ? `Dores: ${arr(j.dores).map(txt).join("; ")}` : "",
        arr(j.desejos).length ? `Desejos: ${arr(j.desejos).map(txt).join("; ")}` : "",
        arr(j.objecoes).length ? `Objeções: ${arr(j.objecoes).map(txt).join("; ")}` : "",
        arr(l.palavras_que_usa).length ? `Linguagem: ${arr(l.palavras_que_usa).map(txt).join(", ")}${txt(l.como_fala) ? ` (${txt(l.como_fala)})` : ""}` : "",
        j.hipotese === true ? "Hipótese a validar (sem pesquisa ligada)." : "",
      ].filter(Boolean).join("\n");
    },
  },
  order_bump: ofertaDoCarrinho("order bump", "um item barato e complementar marcado no próprio checkout, que custa até cerca de um terço do principal e se decide em 5 segundos."),
  upsell: ofertaDoCarrinho("upsell", "a oferta de 1 clique logo depois da compra, que aprofunda ou acelera o resultado do principal, com preço maior que o principal."),
  downsell: ofertaDoCarrinho("downsell", "a alternativa mais barata ou parcelada para quem recusou o upsell, mantendo o valor percebido (versão menor, parcelamento, sem bônus)."),
  sequencia_ofertas: {
    sistema: `${BASE_DO_ESPECIALISTA}\nDesenhe a sequência de ofertas do funil, em ordem: a principal, order bump, upsell, downsell e o que vem depois (recorrência ou próxima oferta), com produto, preço, quando aparece e a condição (aceitou, recusou). Ticket médio só como estimativa marcada.\n\n${REGRA_SEM_INVENCAO}`,
    esquema: {
      nome: "sequencia_de_ofertas_do_laboratorio",
      schema: obj(
        {
          ofertas: { type: "array", items: obj({ ordem: { type: "number" }, tipo: s, produto: s, preco: s, quando: s, condicao: s }, ["ordem", "tipo", "produto", "preco", "quando", "condicao"]) },
          ticket_medio_estimado: s,
          resumo: s,
          blocos_sem_fonte: BLOCOS_SEM_FONTE,
        },
        ["ofertas", "ticket_medio_estimado", "resumo", "blocos_sem_fonte"],
      ),
    },
    pedido: (d) => [txt(d.instrucao) ? `Pedido extra: ${txt(d.instrucao)}` : ""],
    texto: (j) => [txt(j.resumo), ...arr(j.ofertas).map((x, i) => { const y = o(x); return `${i + 1}. ${txt(y.tipo)}: ${txt(y.produto)} ${txt(y.preco)} (${txt(y.quando)}${txt(y.condicao) ? `; ${txt(y.condicao)}` : ""})`; })].filter(Boolean).join("\n"),
  },
  secoes_pagina: {
    sistema: `${BASE_DO_ESPECIALISTA}\nDesenhe a estrutura de seções da página, em ordem, com o papel de cada seção (o que ela faz a pessoa pensar ou sentir), o conteúdo dela e se precisa de prova. Página de aplicação (high ticket): inclua o quiz de qualificação com 4 a 7 perguntas, as opções e a pontuação de corte que leva à agenda. Página de inscrição de webinar: data, promessa da aula e formulário curto.\n\n${REGRA_SEM_INVENCAO}`,
    esquema: {
      nome: "secoes_da_pagina_do_laboratorio",
      schema: obj(
        {
          tipo_pagina: s,
          secoes: { type: "array", items: obj({ ordem: { type: "number" }, nome: s, papel: s, conteudo: s, precisa_prova: { type: "boolean" } }, ["ordem", "nome", "papel", "conteudo", "precisa_prova"]) },
          quiz: obj({ perguntas: { type: "array", items: obj({ pergunta: s, opcoes: lista }, ["pergunta", "opcoes"]) }, corte: s }, ["perguntas", "corte"]),
          resumo: s,
          blocos_sem_fonte: BLOCOS_SEM_FONTE,
        },
        ["tipo_pagina", "secoes", "quiz", "resumo", "blocos_sem_fonte"],
      ),
    },
    pedido: (d) => [txt(d.tipo_pagina) ? `Tipo de página: ${txt(d.tipo_pagina)}` : "", txt(d.objetivo) ? `Objetivo da página: ${txt(d.objetivo)}` : "", txt(d.instrucao) ? `Pedido extra: ${txt(d.instrucao)}` : ""],
    texto: (j) => {
      const quiz = o(j.quiz);
      const perguntas = arr(quiz.perguntas);
      return [
        txt(j.resumo),
        ...arr(j.secoes).map((x, i) => { const y = o(x); return `${i + 1}. ${txt(y.nome)}: ${txt(y.papel)}${txt(y.conteudo) ? ` (${txt(y.conteudo)})` : ""}`; }),
        perguntas.length ? `Quiz de qualificação: ${perguntas.map((q) => txt(o(q).pergunta)).join(" | ")}${txt(quiz.corte) ? `. Corte: ${txt(quiz.corte)}` : ""}` : "",
      ].filter(Boolean).join("\n");
    },
  },
  sequencia_mensagens: {
    sistema: `${BASE_DO_ESPECIALISTA}\nEscreva a sequência de mensagens (e-mail e/ou WhatsApp): cada uma com o dia (0 = no cadastro), o canal, o objetivo e o texto pronto. A sequência para quando a pessoa responde ou compra. WhatsApp: mensagem curta, uma ideia, saída fácil, sem spam; fora da janela de 24 h da última resposta da pessoa só vale modelo aprovado pela Meta (marque precisa_modelo_aprovado). E-mail: assunto e corpo curto. Para lembretes de webinar, agenda com closer ou aquecimento de lançamento, siga o objetivo pedido.\n\n${REGRA_SEM_INVENCAO}`,
    esquema: {
      nome: "sequencia_de_mensagens_do_laboratorio",
      schema: obj(
        {
          canal: s,
          mensagens: { type: "array", items: obj({ dia: { type: "number" }, canal: s, objetivo: s, assunto: s, texto: s, precisa_modelo_aprovado: { type: "boolean" } }, ["dia", "canal", "objetivo", "assunto", "texto", "precisa_modelo_aprovado"]) },
          parar_quando: s,
          resumo: s,
          blocos_sem_fonte: BLOCOS_SEM_FONTE,
        },
        ["canal", "mensagens", "parar_quando", "resumo", "blocos_sem_fonte"],
      ),
    },
    pedido: (d) => [
      `Quantidade de mensagens: ${Math.min(15, Math.max(2, Number(d.mensagens) || 5))}.`,
      `Canal: ${txt(d.canal) === "email" ? "e-mail" : txt(d.canal) === "ambos" ? "e-mail e WhatsApp" : "WhatsApp"}.`,
      txt(d.objetivo) ? `Objetivo da sequência: ${txt(d.objetivo)}` : "",
      txt(d.instrucao) ? `Pedido extra: ${txt(d.instrucao)}` : "",
    ],
    texto: (j) => [txt(j.resumo), ...arr(j.mensagens).map((x) => { const y = o(x); return `Dia ${txt(y.dia)} (${txt(y.canal)}): ${txt(y.objetivo)}. ${txt(y.assunto) ? `${txt(y.assunto)}: ` : ""}${txt(y.texto)}`; })].filter(Boolean).join("\n"),
  },
  refino_tom: {
    sistema: `${BASE_DO_ESPECIALISTA}\nReescreva os textos ligados no tom da marca (o tom pedido e o da MARCA DO CLIENTE, quando houver), sem mudar fatos, preços, promessas nem a estrutura. Devolva cada texto reescrito com a origem (o nome do nó de onde veio). Mantenha os marcadores [${MARCADOR_SEM_FONTE}: ...] como estão.\n\n${REGRA_SEM_INVENCAO}`,
    esquema: {
      nome: "refino_de_tom_do_laboratorio",
      schema: obj(
        { tom_aplicado: s, textos: { type: "array", items: obj({ origem: s, texto: s }, ["origem", "texto"]) }, texto_completo: s, blocos_sem_fonte: BLOCOS_SEM_FONTE },
        ["tom_aplicado", "textos", "texto_completo", "blocos_sem_fonte"],
      ),
    },
    pedido: (d) => [txt(d.tom) ? `Tom pedido: ${txt(d.tom)}` : "", txt(d.instrucao) ? `Pedido extra: ${txt(d.instrucao)}` : ""],
    texto: (j) => txt(j.texto_completo) || arr(j.textos).map((x) => { const y = o(x); return `${txt(y.origem)}: ${txt(y.texto)}`; }).join("\n\n"),
  },
};
