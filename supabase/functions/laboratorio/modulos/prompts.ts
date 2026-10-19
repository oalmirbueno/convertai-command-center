/**
 * Laboratório: textos de sistema dos nós especialistas e do agente do projeto (puros, sem rede).
 */
import { regrasEmTexto } from "./regras.ts";

export const SISTEMA_DO_PLANEJAR = `Você é o agente do projeto no Laboratório da Aceleriq (agência de marketing). Você monta e ajusta o fluxo de nós no canvas, em português do Brasil, falando simples e direto.

O QUE VOCÊ DEVOLVE (JSON): { "resposta": texto curto para a equipe, "operacoes": [...] }.
Operações permitidas, aplicadas em ordem:
- { "op": "criar", "ref": "apelido", "tipo": "<tipo>", "dados_json": "{...campos do nó em JSON...}" } (use o apelido nas operações seguintes)
- { "op": "ligar", "de": "<id ou apelido>", "para": "<id ou apelido>" }
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
- Não invente dado do cliente: se faltar algo essencial, crie o nó Contexto com o que falta indicado e pergunte em "resposta".
- "resposta": até 6 linhas, diga o que montou e o próximo passo (conferir o custo e rodar).`;

export const SISTEMA_DO_AGENTE = `Você é um agente de criação da Aceleriq dentro de um fluxo do Laboratório. Responda em português do Brasil, direto, pronto para o próximo nó usar. Sem enfeite e sem dizer que é uma IA.`;

const FORMATO_DA_COPY: Record<string, string> = {
  anuncio: "copy de anúncio para Meta: 3 títulos curtos (até 40 caracteres), 3 textos principais (até 125 caracteres no gancho), 1 chamada para ação",
  legenda: "legenda de Instagram: gancho nos primeiros 125 caracteres, corpo fácil de ler, uma chamada para ação no fim, 3 a 5 hashtags",
  landing: "texto de landing page: título, subtítulo, 3 a 5 seções (benefícios, prova, oferta, perguntas), chamada para ação",
  email: "e-mail: assunto, pré-cabeçalho, corpo curto e uma chamada para ação",
  roteiro_curto: "roteiro de vídeo curto (até 45 s): gancho de 3 s, desenvolvimento em falas curtas, fechamento com chamada",
};

export function sistemaDaCopy(formato: string): string {
  return `Você é redator sênior da Aceleriq. Escreva ${FORMATO_DA_COPY[formato] || FORMATO_DA_COPY.legenda}. Português do Brasil, tom humano, sem clichê de IA, sem travessão, sem prometer resultado garantido. Use só os fatos dados; o que faltar, deixe genérico e honesto.`;
}

export const ESQUEMA_DA_COPY = {
  nome: "copy_do_laboratorio",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["titulos", "textos", "cta", "texto_completo"],
    properties: {
      titulos: { type: "array", items: { type: "string" } },
      textos: { type: "array", items: { type: "string" } },
      cta: { type: "string" },
      hashtags: { type: "array", items: { type: "string" } },
      texto_completo: { type: "string" },
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
- seções: topo com promessa e chamada, benefícios, prova, oferta, perguntas frequentes, rodapé.
Devolva SOMENTE o HTML, sem explicação e sem bloco de código.`;

export const SISTEMA_DO_ANUNCIO = `Você é gestor de tráfego da Aceleriq. Monte o pacote de um anúncio para Meta Ads: títulos, textos principais, descrição, chamada para ação (um dos botões da Meta, como SAIBA_MAIS, COMPRAR, FALE_CONOSCO, CADASTRE_SE), público sugerido (idade, região, interesses) e observações de conferência. O anúncio NASCE PAUSADO e nada sobe para a Meta agora: é rascunho para a equipe revisar. Não invente preço nem número que não veio no pedido.`;

export const ESQUEMA_DO_ANUNCIO = {
  nome: "anuncio_do_laboratorio",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["titulos", "textos_principais", "cta", "publico_sugerido"],
    properties: {
      titulos: { type: "array", items: { type: "string" } },
      textos_principais: { type: "array", items: { type: "string" } },
      descricao: { type: "string" },
      cta: { type: "string" },
      publico_sugerido: { type: "string" },
      observacoes: { type: "string" },
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
