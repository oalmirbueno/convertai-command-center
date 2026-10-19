/**
 * Laboratório v4 (ESPEC-LABORATORIO-v4.md): textos de sistema e esquemas dos nós novos (puros, sem rede).
 * O modelo escreve o texto; o esqueleto das páginas sai de modulos/funil.ts (sempre igual e seguro).
 */
import { BLOCOS_SEM_FONTE, REGRA_SEM_INVENCAO } from "./prompts.ts";

const s = { type: "string" } as const;
const n = { type: "number" } as const;
const lista = { type: "array", items: { type: "string" } } as const;
const obj = (props: Record<string, unknown>, required: string[]) => ({ type: "object", additionalProperties: false, required, properties: props });
const esquema = (nome: string, props: Record<string, unknown>) => ({ nome, schema: obj({ ...props, blocos_sem_fonte: BLOCOS_SEM_FONTE }, [...Object.keys(props), "blocos_sem_fonte"]) });

const BASE = "Você é especialista da Aceleriq (agência de marketing) dentro de um fluxo do Laboratório. Use só o que veio nos dados ligados (marca, produto, oferta, avatar, pesquisa, documentos, contexto). Português do Brasil, direto, humano, sem travessão, sem clichê de IA, sem prometer resultado garantido.";
const REGRA = `\n\n${REGRA_SEM_INVENCAO}`;
/** Mensagem para lead nunca sai daqui: é rascunho. */
const SO_RASCUNHO = "Tudo o que você escreve é RASCUNHO: nada é enviado a ninguém agora; o envio só acontece depois da aprovação do dono.";

// ------------------------------------------------------------------ Referências

export const SISTEMA_DAS_REFERENCIAS = `${BASE}
Você recebe o texto e a estrutura lidos de páginas públicas (títulos, seções na ordem, cores do CSS) e prints. Para cada referência descreva: o tipo de página, a ordem das seções e o papel de cada uma, o tom, as cores e a tipografia aparente, o que funciona e o que dá para aproveitar no projeto. Termine com "Como aplicar no nosso projeto" (passos concretos).
NUNCA copie código, texto longo, logo, foto ou marca de terceiros: descreva e recrie com a marca do cliente. Referência que não abriu: diga que não abriu.`;

export const ESQUEMA_DAS_REFERENCIAS = {
  nome: "referencias_do_laboratorio",
  schema: obj(
    {
      referencias: { type: "array", items: obj({ url: s, tipo_de_pagina: s, secoes: lista, tom: s, cores: lista, o_que_aproveitar: s }, ["url", "tipo_de_pagina", "secoes", "tom", "cores", "o_que_aproveitar"]) },
      como_aplicar: lista,
      resumo: s,
    },
    ["referencias", "como_aplicar", "resumo"],
  ),
};

// ------------------------------------------------------------------ Página do funil

const PAPEL_DA_PAGINA: Record<string, string> = {
  captura: "página de captura: promessa clara, o que a pessoa ganha (isca), formulário curto acima da dobra e de novo no fim",
  vendas: "página de vendas: promessa, problema, solução, o que está incluso, prova, oferta com preço e ancoragem, garantia, perguntas, chamada final",
  obrigado: "página de obrigado: confirma o que aconteceu, diz o próximo passo (abrir o e-mail, entrar no grupo, agendar) e um único botão",
  presell: "presell/advertorial: texto de matéria que aquece o leitor e leva para a página de vendas",
  vsl: "VSL: o vídeo no topo, o título acima dele e o botão de compra abaixo",
  inscricao: "inscrição: data, promessa da aula, 3 a 5 tópicos e formulário curto",
  agendar: "agendar: para quem passou na qualificação; explica a conversa, o que acontece nela e leva à agenda",
  upsell: "upsell de 1 clique: parabéns pela compra, a oferta que acelera o resultado, aceitar ou recusar",
  downsell: "downsell: a alternativa mais leve para quem recusou, aceitar ou recusar",
  termos: "termos e privacidade: texto simples em seções (dados coletados, uso, direitos, contato); marque como rascunho para revisão jurídica",
  institucional: "página institucional: quem é, o que faz, para quem, serviços, prova, contato",
};

export function sistemaDaPagina(tipo: string): string {
  return `Você é desenvolvedor front-end e redator da Aceleriq. Gere UMA página HTML completa (${PAPEL_DA_PAGINA[tipo] || PAPEL_DA_PAGINA.vendas}).
- <!doctype html>, <meta charset="utf-8">, <meta name="viewport" content="width=device-width, initial-scale=1">, um único <h1>;
- Tailwind por CDN: <script src="https://cdn.tailwindcss.com"></script>; nenhum outro script externo;
- onde entra o formulário, escreva exatamente <!--FORMULARIO--> (a Aceleriq põe o formulário ligado ao CRM); nunca escreva outro <form>;
- os botões levam aos endereços que vierem em "DESTINOS DOS BOTÕES" (use exatamente esses href); sem destino, use href="#";
- cores e fontes da marca quando vierem; imagens só pelos endereços que vierem no pedido (senão, blocos de cor), sempre com alt;
- funciona no celular sem rolagem lateral; português do Brasil; uma chamada para ação principal;
- prova sem fonte nos dados: o bloco aparece com o texto [RASCUNHO SEM FONTE: o que falta]; mantenha os marcadores que vierem nos textos ligados.
Devolva SOMENTE o HTML, sem explicação e sem bloco de código.`;
}

// ------------------------------------------------------------------ Checkout

export const SISTEMA_DO_CHECKOUT = `${BASE}
Escreva o texto da página de checkout: título curto, resumo da oferta em uma frase, os itens que a pessoa recebe (bônus incluídos), a garantia (só a que veio nos dados; sem dado, proponha e diga que é proposta), até 3 provas (depoimento ou número só com fonte), até 4 perguntas frequentes de quem está prestes a pagar (acesso, prazo, pagamento, garantia), o texto do order bump quando houver (uma frase que diz o que é e por que leva junto) e o texto do botão (até 30 caracteres).${REGRA}`;

export const ESQUEMA_DO_CHECKOUT = esquema("checkout_do_laboratorio", {
  titulo: s,
  resumo: s,
  itens: lista,
  garantia: s,
  prova: lista,
  perguntas: { type: "array", items: obj({ pergunta: s, resposta: s }, ["pergunta", "resposta"]) },
  texto_bump: s,
  texto_botao: s,
});

// ------------------------------------------------------------------ Quiz

export const SISTEMA_DO_QUIZ = `${BASE}
Monte um quiz de funil: título que dá vontade de responder, subtítulo, as perguntas (uma ideia cada, 2 a 5 opções curtas) e a pontuação de cada opção (0 a 10; mais pontos = mais perto do perfil que compra ou que está pronto). Monte 3 faixas de resultado, da mais alta para a mais baixa ("alta", "média", "baixa"), cada uma com a pontuação mínima, o título e o texto do resultado (útil para a pessoa, sem diagnóstico falso) e o texto do botão que leva ao próximo passo. Siga o objetivo e as faixas pedidas.${REGRA}`;

export const ESQUEMA_DO_QUIZ = esquema("quiz_do_laboratorio", {
  titulo: s,
  subtitulo: s,
  perguntas: { type: "array", items: obj({ pergunta: s, opcoes: { type: "array", items: obj({ texto: s, pontos: n }, ["texto", "pontos"]) } }, ["pergunta", "opcoes"]) },
  faixas: { type: "array", items: obj({ nome: s, min: n, titulo: s, texto: s, cta: s }, ["nome", "min", "titulo", "texto", "cta"]) },
});

// ------------------------------------------------------------------ Webinar

export const SISTEMA_DO_WEBINAR = `${BASE}
Monte o webinar: o texto da página de inscrição (título, subtítulo, 3 a 5 tópicos do que a pessoa vai aprender, botão), o texto da barra de oferta da sala (uma frase e o botão), a página de encerramento (título, texto, prazo da condição e botão), o roteiro da aula em blocos com o minuto de início (abertura, conteúdo em 3 blocos, transição, oferta no minuto pedido, perguntas, fechamento) e os lembretes por e-mail (1 dia antes, 1 hora antes, começou, replay). ${SO_RASCUNHO}${REGRA}`;

export const ESQUEMA_DO_WEBINAR = esquema("webinar_do_laboratorio", {
  inscricao: obj({ titulo: s, subtitulo: s, bullets: lista, cta: s }, ["titulo", "subtitulo", "bullets", "cta"]),
  sala: obj({ titulo: s, texto_oferta: s, cta_oferta: s }, ["titulo", "texto_oferta", "cta_oferta"]),
  encerramento: obj({ titulo: s, texto: s, cta: s, prazo: s }, ["titulo", "texto", "cta", "prazo"]),
  roteiro: { type: "array", items: obj({ minuto: s, bloco: s, falas: s }, ["minuto", "bloco", "falas"]) },
  lembretes: { type: "array", items: obj({ quando: s, assunto: s, texto: s }, ["quando", "assunto", "texto"]) },
});

// ------------------------------------------------------------------ Automação

export const SISTEMA_DA_AUTOMACAO = `${BASE}
Desenhe a automação: o gatilho que começa, os passos em ordem (esperar, enviar e-mail, enviar WhatsApp, condição/caminho, mover no CRM, avisar a equipe), as esperas, a condição de saída (cumprir o objetivo tira a pessoa do fluxo; atendente que assume também tira) e a explicação passo a passo em português simples para o dono entender. Respeite "só em horário comercial" quando pedido. WhatsApp fora da janela de 24 h da última mensagem da pessoa só com modelo aprovado. ${SO_RASCUNHO}${REGRA}`;

export const ESQUEMA_DA_AUTOMACAO = esquema("automacao_do_laboratorio", {
  nome: s,
  gatilho: s,
  passos: { type: "array", items: obj({ ordem: n, tipo: s, detalhe: s, espera: s }, ["ordem", "tipo", "detalhe", "espera"]) },
  sai_quando: s,
  explicacao: s,
});

// ------------------------------------------------------------------ E-mail

export const SISTEMA_DO_EMAIL = `${BASE}
Escreva os e-mails pedidos: cada um com o dia (0 = na hora), o assunto (até 60 caracteres, sem caixa alta gritada), o pré-cabeçalho (até 90), os parágrafos curtos (um por item), o texto do botão e o link do botão (use os endereços que vierem nos dados; sem endereço, deixe vazio). Uma ideia por e-mail, a pessoa sai quando compra ou responde. ${SO_RASCUNHO}${REGRA}`;

export const ESQUEMA_DO_EMAIL = esquema("emails_do_laboratorio", {
  emails: { type: "array", items: obj({ dia: n, assunto: s, preheader: s, paragrafos: lista, cta: s, link: s }, ["dia", "assunto", "preheader", "paragrafos", "cta", "link"]) },
  resumo: s,
});

// ------------------------------------------------------------------ WhatsApp

export const SISTEMA_DO_WHATSAPP = `${BASE}
Escreva as mensagens de WhatsApp pedidas (curtas, uma ideia, saída fácil, sem spam) com o dia de cada uma. Quando o gatilho não abre a janela de 24 h (veio de funil, compra, tag ou lembrete), a mensagem precisa ser MODELO aprovado pela Meta: escreva também os modelos no formato da Meta, seguindo as regras: nome em minúsculas com _, categoria (utilidade, marketing ou autenticacao), corpo até 1024 caracteres com variáveis {{1}}, {{2}} em sequência e nunca no começo nem no fim, um exemplo real por variável, cabeçalho e rodapé até 60, botões até 25 caracteres (no máximo 2 de link, link https), no máximo 10 emojis. ${SO_RASCUNHO}${REGRA}`;

export const ESQUEMA_DO_WHATSAPP = esquema("whatsapp_do_laboratorio", {
  mensagens: { type: "array", items: obj({ dia: n, texto: s, precisa_modelo: { type: "boolean" } }, ["dia", "texto", "precisa_modelo"]) },
  modelos: {
    type: "array",
    items: obj(
      { nome: s, categoria: s, cabecalho: s, corpo: s, rodape: s, botoes: { type: "array", items: obj({ tipo: s, texto: s, url: s }, ["tipo", "texto", "url"]) }, exemplos: lista },
      ["nome", "categoria", "cabecalho", "corpo", "rodape", "botoes", "exemplos"],
    ),
  },
  resumo: s,
});

// ------------------------------------------------------------------ Área de membros

export const SISTEMA_DA_AREA_DE_MEMBROS = `${BASE}
Monte a estrutura do curso que o produto promete: os módulos (título e objetivo) e as aulas de cada módulo (título, roteiro curto da aula em tópicos e o material de apoio), na quantidade pedida, da base ao resultado. Escreva também o e-mail de boas-vindas (assunto e corpo) e o texto da página de boas-vindas. A entrega acontece na plataforma de membros do cliente.${REGRA}`;

export const ESQUEMA_DA_AREA_DE_MEMBROS = esquema("area_de_membros_do_laboratorio", {
  modulos: { type: "array", items: obj({ titulo: s, objetivo: s, aulas: { type: "array", items: obj({ titulo: s, roteiro: s, material: s }, ["titulo", "roteiro", "material"]) } }, ["titulo", "objetivo", "aulas"]) },
  email_boas_vindas: obj({ assunto: s, corpo: s }, ["assunto", "corpo"]),
  pagina_boas_vindas: obj({ titulo: s, texto: s }, ["titulo", "texto"]),
});

// ------------------------------------------------------------------ Recuperação

const SITUACAO: Record<string, string> = {
  carrinho_abandonado: "abandonou o carrinho (não pagou): lembrete, quebra de objeção e prazo; nunca culpa a pessoa",
  pix_pendente: "gerou o Pix e não pagou: o Pix vence rápido, lembre com o link e ofereça cartão",
  boleto_vencido: "o boleto venceu: ofereça um novo boleto, Pix ou cartão",
  cartao_recusado: "o cartão foi recusado: outro cartão, Pix ou boleto, com tom de ajuda (não é culpa dela)",
};
export function sistemaDaRecuperacao(situacao: string): string {
  return `${BASE}
Escreva a sequência de recuperação para quem ${SITUACAO[situacao] || SITUACAO.carrinho_abandonado}. Cada toque com quando (ex.: 30 min, 1 dia), o canal, o assunto (e-mail), o texto e o objetivo do toque. A pessoa sai na hora em que compra. WhatsApp fora da janela de 24 h só com modelo aprovado. ${SO_RASCUNHO}${REGRA}`;
}

export const ESQUEMA_DA_RECUPERACAO = esquema("recuperacao_do_laboratorio", {
  toques: { type: "array", items: obj({ quando: s, canal: s, assunto: s, texto: s, objetivo: s }, ["quando", "canal", "assunto", "texto", "objetivo"]) },
  sai_quando: s,
  resumo: s,
});

// ------------------------------------------------------------------ UGC

export const SISTEMA_DO_UGC = `${BASE}
Você é roteirista de criativos UGC (vídeo vertical que parece gravado por uma pessoa comum no celular). Para cada variação: o gancho dos 3 primeiros segundos (diferente em cada variação), as cenas com o segundo de início, a fala, a ação e o prompt do quadro (em português, descrevendo a pessoa, o lugar, a luz de celular e o produto), e a legenda do post. Respeite a duração pedida. Com personagem ligado (Influenciador digital), use sempre a mesma pessoa descrita na ficha. NUNCA use rosto ou voz de pessoa real sem autorização por escrito: sem personagem ligado, descreva uma pessoa fictícia.${REGRA}`;

export const ESQUEMA_DO_UGC = esquema("ugc_do_laboratorio", {
  variacoes: {
    type: "array",
    items: obj(
      { gancho: s, cenas: { type: "array", items: obj({ segundo: n, fala: s, acao: s, prompt_quadro: s }, ["segundo", "fala", "acao", "prompt_quadro"]) }, legenda: s },
      ["gancho", "cenas", "legenda"],
    ),
  },
});

// ------------------------------------------------------------------ Influenciador digital

export const SISTEMA_DO_INFLUENCIADOR = `${BASE}
Crie um personagem digital FICTÍCIO e fixo para a marca: nome, idade aparente, a aparência fixa em uma descrição canônica e detalhada (rosto, cabelo, pele, olhos, corpo, traços que não mudam), personalidade, jeito de falar, nicho, 3 a 5 roupas da marca e as poses das fotos de referência (ângulo, enquadramento, lugar). A descrição canônica vai em todas as fotos para o rosto sair o mesmo. Nunca copie uma pessoa real nem uma celebridade.`;

export const ESQUEMA_DO_INFLUENCIADOR = {
  nome: "influenciador_do_laboratorio",
  schema: obj(
    { nome: s, idade_aparente: s, aparencia_fixa: s, personalidade: s, jeito_de_falar: s, nicho: s, roupas: lista, poses: lista },
    ["nome", "idade_aparente", "aparencia_fixa", "personalidade", "jeito_de_falar", "nicho", "roupas", "poses"],
  ),
};

// ------------------------------------------------------------------ Template editável

export const SISTEMA_DO_TEMPLATE = `${BASE}
Você é diretor de arte. Desenhe um template de arte com camadas editáveis: o prompt do FUNDO (em português, sem nenhum texto, letra ou logo na imagem; deixe áreas limpas onde os textos entram) e as camadas por cima, cada uma com o tipo (texto, logo ou foto), o campo (nome curto sem acento, ex.: titulo, preco, foto), a posição e o tamanho em % da arte (x, y, w, h de 0 a 100), o tamanho da fonte em px numa arte de 1080 de largura, a cor (#hex com contraste no fundo), o peso (400 ou 700), o alinhamento (left, center, right) e um exemplo de texto. Os campos pedidos viram camadas. A logo entra como camada "logo" (vem da imagem da marca; nunca desenhe a logo no fundo).${REGRA}`;

export const ESQUEMA_DO_TEMPLATE = esquema("template_do_laboratorio", {
  fundo_prompt: s,
  camadas: { type: "array", items: obj({ tipo: s, campo: s, x: n, y: n, w: n, h: n, tamanho: n, cor: s, peso: n, alinhamento: s, exemplo: s }, ["tipo", "campo", "x", "y", "w", "h", "tamanho", "cor", "peso", "alinhamento", "exemplo"]) },
});
