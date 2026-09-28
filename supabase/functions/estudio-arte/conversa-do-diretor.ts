/**
 * Conversa com o diretor de arte dentro do Estúdio (pedido do dono em 24/09:
 * "no estúdio ali onde estou produzindo as artes ter um agente que eu possa
 * conversar se caso eu quiser mudar o estilo ou cenários etc., e ele
 * inteligente para me ajudar com base no conteúdo").
 *
 * Módulo puro (sem banco, sem IA): roda igual no Deno e nos testes.
 * - ESQUEMA_CONVERSA e INSTRUCOES_CONVERSA: o que o diretor devolve na ação
 *   `conversar` (resposta + mudanças estruturadas + memória).
 * - normalizarMudancas: confere o que veio do diretor (ou da tela, em
 *   `aplicar_mudancas`) contra as regras da casa: lâmina existente, cor só da
 *   paleta da marca, foto só do acervo do cliente, texto exato só com pedido
 *   explícito, nunca escurecer foto ou capa para destaque e sem caixa atrás do
 *   texto quando a lâmina usa foto real, fundo contínuo ou a regra da marca
 *   pede. O que viola a regra sai da mudança, com aviso em português.
 * - aplicarNaDirecao: grava as mudanças na direção (layout da lâmina,
 *   conceito, fio visual, estilo pedido) sem tocar no texto exato que não foi
 *   pedido, e diz quais lâminas precisam ser refeitas.
 */

import {
  blocosDoTexto,
  layoutPadrao,
  normalizarLayout,
  resumoDaComposicao,
  type CardDirecao,
  type LayoutLamina,
  type ZonaTexto,
} from "../_shared/direcao-arte.ts";
import { panoramaApagado, type PanoramaGravado } from "../_shared/carrossel-continuo.ts";
import { ESQUEMA_DAS_ACOES_DO_DIRETOR } from "./acoes-do-diretor.ts";
import { textoDoAjusteFiel } from "./fiel-ao-pedido.ts";

export const ZONAS_DA_CONVERSA: ZonaTexto[] = [
  "topo-esquerda", "topo-centro", "centro-esquerda", "centro", "base-esquerda", "base-centro", "base-direita", "coluna-esquerda", "coluna-direita",
];
const ALINHAMENTOS = ["esquerda", "centro", "direita"] as const;

/** No máximo tantas mudanças por resposta: a equipe decide uma a uma. */
export const MAX_MUDANCAS = 6;
/** Valor de foto_acervo que tira a foto real da lâmina (a cena volta a ser desenhada). */
export const SEM_FOTO = "sem_foto";
/**
 * Prefixo de foto_acervo para uma foto enviada no pedido da arte rápida
 * (arquivo no bucket, sem id no acervo): "pedido:<caminho>". O diretor nunca
 * escreve isso: ele usa o apelido (F1, F2...) e o servidor traduz.
 */
export const PREFIXO_FOTO_DO_PEDIDO = "pedido:";

/** Campos que a mudança pode trazer. String vazia = não muda. */
export type CamposDaMudanca = {
  // conjunto
  conceito: string;
  fio_visual: string;
  estilo: string;
  // lâmina
  imagem: string;
  ponto_focal: string;
  fundo: string;
  tratamento: string;
  zona_texto: string;
  alinhamento: string;
  cor_fundo: string;
  cor_texto: string;
  cor_destaque: string;
  evitar: string;
  foto_acervo: string;
  texto_exato: string;
};

export const CAMPOS_DO_CONJUNTO: (keyof CamposDaMudanca)[] = ["conceito", "fio_visual", "estilo"];
export const CAMPOS_DA_LAMINA: (keyof CamposDaMudanca)[] = [
  "imagem", "ponto_focal", "fundo", "tratamento", "zona_texto", "alinhamento", "cor_fundo", "cor_texto", "cor_destaque", "evitar", "foto_acervo", "texto_exato",
];
const TODOS_OS_CAMPOS: (keyof CamposDaMudanca)[] = [...CAMPOS_DO_CONJUNTO, ...CAMPOS_DA_LAMINA];

/** Tamanho máximo de cada campo (o mesmo que a direção aceita). */
const MAXIMO: Record<keyof CamposDaMudanca, number> = {
  conceito: 1200, fio_visual: 800, estilo: 600,
  imagem: 600, ponto_focal: 400, fundo: 400, tratamento: 500, zona_texto: 40, alinhamento: 20,
  cor_fundo: 7, cor_texto: 7, cor_destaque: 7, evitar: 600, foto_acervo: 360, texto_exato: 1200,
};

export type MudancaProposta = {
  id: string;
  alvo: "conjunto" | "lamina";
  /** Lâmina da mudança (null no conjunto). */
  ordem: number | null;
  titulo: string;
  motivo: string;
  /** Só os campos que mudam (sem string vazia). */
  campos: Partial<CamposDaMudanca>;
  /** Lâminas que precisam ser refeitas para a arte mostrar a mudança. */
  regerar: number[];
  /** Frente AG: o valor de hoje de cada campo que muda (a tela mostra antes e depois). */
  antes?: Partial<CamposDaMudanca>;
  /** Frente AG: como mostrar o valor novo quando ele não é legível (a foto nova pelo apelido e nome). */
  rotulos?: Partial<Record<keyof CamposDaMudanca, string>>;
};

export const ESQUEMA_CONVERSA = {
  nome: "conversa_do_diretor",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["resposta", "mudancas", "memoria", "acoes"],
    properties: {
      resposta: { type: "string" },
      memoria: { type: "string" },
      // Organizar e executar (reordenar, formato, trocar texto, arquivar versões, refazer): acoes-do-diretor.ts.
      acoes: ESQUEMA_DAS_ACOES_DO_DIRETOR,
      mudancas: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["alvo", "ordem", "titulo", "motivo", "campos"],
          properties: {
            alvo: { type: "string", enum: ["conjunto", "lamina"] },
            ordem: { type: "integer" },
            titulo: { type: "string" },
            motivo: { type: "string" },
            campos: {
              type: "object",
              additionalProperties: false,
              required: TODOS_OS_CAMPOS,
              properties: {
                conceito: { type: "string" },
                fio_visual: { type: "string" },
                estilo: { type: "string" },
                imagem: { type: "string" },
                ponto_focal: { type: "string" },
                fundo: { type: "string" },
                tratamento: { type: "string" },
                zona_texto: { type: "string", enum: ["", ...ZONAS_DA_CONVERSA] },
                alinhamento: { type: "string", enum: ["", ...ALINHAMENTOS] },
                cor_fundo: { type: "string" },
                cor_texto: { type: "string" },
                cor_destaque: { type: "string" },
                evitar: { type: "string" },
                foto_acervo: { type: "string" },
                texto_exato: { type: "string" },
              },
            },
          },
        },
      },
    },
  },
};

export const INSTRUCOES_CONVERSA = `CONVERSA COM A EQUIPE NO ESTÚDIO

Você é o diretor de arte deste trabalho e está conversando com a pessoa da equipe que produz as artes. Ela quer mudar o estilo, o cenário, a luz, as cores ou a composição, ou quer a sua opinião. Você recebe em JSON o conteúdo inteiro do trabalho: conceito, fio visual, cada lâmina (texto exato, blocos, layout, foto real usada, referências, última conferência), a marca (paleta, fontes, estilo, regras, tom), as referências, o acervo de fotos reais do cliente, a sua memória com este cliente e a lâmina em foco (quando a imagem da versão atual vier anexada, olhe para ela).

Responda como um diretor de arte sênior: direto, concreto, com base no conteúdo (o que o texto de cada lâmina diz e para quem), sem elogio vazio. Devolva:
- resposta: a conversa, em até 8 frases curtas, em português do Brasil, sem travessão. Explique o que você sugere e por quê, ligado ao conteúdo e à marca. Se o pedido for vago, sugira de 2 a 3 caminhos concretos (cenário, luz, estilo) e pergunte qual seguir. Se o pedido ferir uma regra da casa, diga com clareza e ofereça o caminho certo.
- mudancas: de 0 a ${MAX_MUDANCAS} mudanças concretas que a equipe aplica com um clique. Só proponha quando houver o que mudar de fato; pergunta ou opinião pode vir sem mudança. Cada mudança:
  - alvo "conjunto" (vale para todas as lâminas; ordem 0) ou "lamina" (ordem da lâmina).
  - titulo: até 8 palavras, o que muda (ex.: "Cenário da capa na cozinha ao entardecer").
  - motivo: uma frase, por que isso serve ao conteúdo.
  - campos: preencha SÓ o que muda e deixe os outros como string vazia.
    - conjunto: conceito (a ideia visual nova do conjunto), fio_visual (protagonista, cenário, luz e tratamento que se repetem em todas as lâminas, em 2 a 4 frases), estilo (o estilo pedido para o trabalho inteiro: linguagem visual, textura, luz, clima; entra no prompt de todas as lâminas).
    - lâmina: imagem (a cena ou o cenário concreto, com enquadramento e luz), ponto_focal, fundo, tratamento (técnica, estilo e luz desta lâmina), zona_texto, alinhamento, cor_fundo, cor_texto, cor_destaque (só hex da paleta da marca), evitar, foto_acervo (id de uma foto em \`acervo\` para virar a base da lâmina, ou "${SEM_FOTO}" para tirar a foto real e desenhar a cena), texto_exato.
- memoria: uma frase curta com o que esta conversa ensina sobre o gosto da marca, reutilizável em outros trabalhos (ou string vazia).

REGRAS DA CASA (obrigatórias)
- Nunca escureça a foto nem a capa para criar destaque (sem véu escuro, sem filtro escuro, sem degradê escuro por cima da foto). O contraste vem da cor e do peso das letras, da escala e de uma área calma na própria cena.
- Identidade da marca sempre: cores só da paleta (hex), fontes da marca, estilo e regras da marca. Cor fora da paleta só se a equipe pedir, e então explique o risco na resposta e não coloque a cor nos campos de cor.
- Sem caixa, faixa, painel, tarja ou retângulo atrás do texto quando a lâmina usa foto real ou o carrossel contínuo, ou quando as regras da marca pedem (\`lamina.sem_caixa_atras_do_texto\` verdadeiro). O texto vai direto na cena.
- Texto exato: NÃO mude o texto das lâminas a menos que \`texto_pode_mudar\` seja verdadeiro (a equipe pediu mudança de texto). Quando mudar, escreva o texto completo da lâmina, com acentos, sem travessão.
- Nunca escreva o nome da marca no texto das lâminas; a marca aparece pela logo.
- Lâmina com foto real (\`foto_real\` preenchida): a foto é usada como está. Para trocar o cenário dessa lâmina, proponha foto_acervo com outra foto do acervo ou "${SEM_FOTO}" junto com a imagem nova.
- Carrossel contínuo: a cena atravessa as lâminas; mudança de cenário, luz ou estilo vale para o conjunto (fio_visual ou estilo), nunca para uma lâmina solta.
- Série: a mesma protagonista, cenário, luz e paleta do começo ao fim; varia só pose, gesto e enquadramento.
- Seja honesto: se a arte atual já resolve, diga; se algo não dá para fazer no estúdio, diga.

AJUSTE FINO (frente AG, 28/09: o dono pediu um agente que entende o ajuste e faz só o que foi pedido)
- O que a pessoa pede é a fonte da verdade. Você recebe o estado atual de cada lâmina (\`laminas[].texto_exato\`, \`blocos\`, \`layout\` com as cores, \`foto_real\`, \`leva_logo\`, \`texto_lido_na_arte\`) e o pedido original do trabalho (\`trabalho.pedido_original\`). Mude SÓ o que foi pedido: um pedido pequeno vira UMA mudança na lâmina em foco (ou na citada), com só o campo que muda; nunca mexa em cena, foto, conceito, texto ou outras cores que o pedido não citou.
- "Muda a cor do título" ou "troca a cor do título para o verde da marca": cor_texto com o hex da paleta; a palavra de destaque, o preço e o CTA ficam em cor_destaque. "Verde da marca" é o hex verde da paleta; com dois verdes ou nenhum, pergunte qual (sem mudança).
- "Tira o preço" (ou a data, o selo, uma frase): texto_exato é o texto atual da lâmina sem aquele trecho, o resto palavra por palavra igual, com as mesmas quebras de linha.
- "Troca a foto pela segunda" e parecidos: foto_acervo com o apelido da foto (F1, F2... são as fotos do pedido, na ordem em que a equipe mandou; A1, A2... são as do acervo, na ordem de \`acervo\`). Nunca escreva id.
- "Deixa o selo menor", "logo maior", "sobe o texto": tratamento ou zona_texto da lâmina, com a instrução concreta (ex.: "selo da campanha pequeno, cerca de 12% da largura, no canto de baixo"). "Mais minimalista", "mais elegante": estilo (conjunto) ou tratamento (lâmina) com menos elementos e mais respiro, sem mudar texto nem foto.
- Na dúvida, pergunte UMA coisa só, curta, e não proponha mudança: palavra que não faz sentido aqui (provável erro do ditado por voz, como "select" no lugar de "selo"), ou nome de loja, site, marketplace, marca ou produto que não aparece no trabalho, na marca nem na campanha.
- Nunca invente preço, desconto, prazo, produto, loja, site ou promessa que não estejam no pedido, no texto atual, na campanha ou na marca. Letras da logo e letras impressas no produto da foto nunca entram no texto_exato.
- Na resposta, diga em uma frase o que vai mudar e o que fica igual.`;

// ------------------------------------------------------------------ utilidades

/** Texto limpo: sem travessão (regra da casa), sem espaços sobrando, no tamanho máximo. */
export function limparTexto(v: unknown, max = 4000): string {
  if (v == null) return "";
  return String(v)
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/[ \t]+\n/g, "\n")
    .trim()
    .slice(0, max)
    .trim();
}

const HEX = /^#[0-9a-f]{6}$/i;
const hexDe = (v: unknown): string | null => {
  const s = typeof v === "string" ? v.trim().toUpperCase() : "";
  return HEX.test(s) ? s : null;
};

/** Negação logo antes do trecho ("não", "nunca", "sem", "evite"): o pedido é o contrário. */
function negadoAntes(textoInteiro: string, indice: number): boolean {
  const antes = textoInteiro.slice(Math.max(0, indice - 40), indice);
  return /(^|[^a-zà-ú])(n[aã]o|nunca|sem|evit[a-z]*|jamais|proib[a-z]*)([^a-zà-ú]|$)/i.test(antes);
}

function mencionaSemNegar(textoInteiro: string, padrao: RegExp): boolean {
  const re = new RegExp(padrao.source, padrao.flags.indexOf("g") >= 0 ? padrao.flags : `${padrao.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = re.exec(textoInteiro)) !== null) {
    if (!negadoAntes(textoInteiro, m.index)) return true;
    if (m.index === re.lastIndex) re.lastIndex++;
  }
  return false;
}

const ESCURECER = /escure[cç][a-zà-ú]*|(v[eé]u|overlay|filtro|camada|pel[ií]cula|degrad[eê]|gradiente|vinheta)\s+(bem\s+|mais\s+)?(escur|pret)[a-zà-ú]*/i;

/** O campo pede para escurecer a foto ou a capa (regra da casa: nunca). */
export function pedeEscurecer(t: string): boolean {
  return mencionaSemNegar(t, ESCURECER);
}

const CAIXA_ATRAS =
  /(caixa|faixa|painel|tarja|ret[aâ]ngulo|cart[aã]o|box|bloco de cor|[aá]rea de cor|fundo s[oó]lido)[^.]{0,40}(atr[aá]s|sob|embaixo|debaixo|por tr[aá]s)[^.]{0,20}(texto|letra|t[ií]tulo|headline|frase)/i;
const TEXTO_NA_CAIXA =
  /(texto|letras?|t[ií]tulo|headline|frase)[^.]{0,30}[^a-zà-ú](sobre|dentro de|em)\s+(uma?\s+)?(caixa|faixa|painel|tarja|ret[aâ]ngulo|cart[aã]o|box)/i;

/** O campo pede caixa, faixa ou painel atrás do texto. */
export function pedeCaixaAtrasDoTexto(t: string): boolean {
  return mencionaSemNegar(t, CAIXA_ATRAS) || mencionaSemNegar(t, TEXTO_NA_CAIXA);
}

/** As regras da marca proíbem caixa atrás do texto ("sem caixa", "sem faixa", "sem box"...). */
export function regraProibeCaixa(regras: string | null | undefined): boolean {
  return /sem\s+(caixa|faixa|painel|tarja|box|ret[aâ]ngulo)/i.test(String(regras || ""));
}

/**
 * A mensagem da equipe pede, de forma explícita, mudança no texto da arte.
 * Sem isso, o texto exato não muda (regra: nunca mexer no texto sem pedido).
 */
export function pedidoMexeNoTexto(mensagem: string): boolean {
  const m = String(mensagem || "");
  const verbo = /(^|[^a-zà-ú])(mud|troc|troq|reescrev|escrev|corrig|corrij|encurt|diminu|aument|tir|remov|acrescent|coloc|ponh|p[oô]r|ajust|alter|substitu|edit|refa)[a-zà-ú]*/i;
  // Frente AG: "tira o preço", "muda a data", "troca o selo" também mexem no texto escrito na arte.
  const alvo = /(^|[^a-zà-ú])(textos?|frases?|t[ií]tulos?|headline|palavras?|chamada|cta|subt[ií]tulos?|escrita|copy|ortografia|acentos?|acentua[cç][aã]o|pre[cç]os?|valor(es)?|ofertas?|descontos?|promo[cç][aã]o|datas?|hor[aá]rios?|telefone|whatsapp|endere[cç]o|site|selos?)([^a-zà-ú]|$)/i;
  return (verbo.test(m) && alvo.test(m)) || /"[^"]{2,}"|“[^”]{2,}”/.test(m);
}

// ------------------------------------------------------------------ normalizar

export type ContextoDasMudancas = {
  /** Ordens das lâminas da direção. */
  ordens: number[];
  /** Hex da paleta da marca (vazio: sem paleta, qualquer hex válido passa). */
  paleta: string[];
  /** Ids de fotos do acervo do cliente aceitos em foto_acervo. */
  acervo: Set<string>;
  /** O texto exato pode mudar (pedido explícito da equipe ou clique em Aplicar numa mudança que mostra o texto). */
  permitirTexto: boolean;
  /** Lâminas em que não pode haver caixa atrás do texto (foto real, contínuo, regra da marca). */
  semCaixa: Set<number>;
  /** Carrossel contínuo: mudança de cena, luz ou estilo vale para o conjunto e refaz todas. */
  continuo: boolean;
  /** Frente AG: fotos do pedido da arte rápida aceitas em foto_acervo ("pedido:<caminho>"). */
  fotosDoPedido?: Set<string>;
  /**
   * Frente AG: fontes do texto (texto atual por lâmina, mensagem da equipe,
   * contexto confirmado e palavras do nome da marca). Com elas, o texto novo
   * não ganha fato inventado, letras da logo nem letras lidas do produto.
   */
  fontesDoTexto?: { atual: Record<number, string>; pedido: string; confirmados: string[]; marca: string[] };
};

const TEXTOS_LIVRES: (keyof CamposDaMudanca)[] = ["conceito", "fio_visual", "estilo", "imagem", "ponto_focal", "fundo", "tratamento", "evitar"];
/** Campos que mudam a cena desenhada (no contínuo, o panorama precisa nascer de novo). */
// zona_texto entra desde 25/09: o panorama deixa calma a zona do texto de cada
// lâmina; mudar a zona no contínuo sem refazer o fundo punha o texto na parte cheia da cena.
export const CAMPOS_DE_CENA: (keyof CamposDaMudanca)[] = ["conceito", "fio_visual", "estilo", "imagem", "ponto_focal", "fundo", "tratamento", "cor_fundo", "foto_acervo", "zona_texto"];

/**
 * Confere as mudanças contra as regras da casa. Devolve só as que sobram com
 * algum campo, com id estável (m1, m2...) e as lâminas a refazer, mais os
 * avisos do que saiu e por quê.
 */
export function normalizarMudancas(bruto: unknown, ctx: ContextoDasMudancas): { mudancas: MudancaProposta[]; avisos: string[] } {
  const lista = (Array.isArray(bruto) ? bruto : []) as Record<string, unknown>[];
  const avisos: string[] = [];
  const avisar = (a: string) => {
    if (avisos.indexOf(a) < 0) avisos.push(a);
  };
  const saida: MudancaProposta[] = [];
  const ordens = ctx.ordens.slice().sort((a, b) => a - b);
  const paleta = ctx.paleta.map((h) => String(h).toUpperCase());

  for (const item of lista.slice(0, MAX_MUDANCAS * 2)) {
    if (!item || typeof item !== "object") continue;
    const alvo: "conjunto" | "lamina" = item.alvo === "lamina" ? "lamina" : "conjunto";
    const ordemBruta = Number(item.ordem);
    let ordem: number | null = null;
    if (alvo === "lamina") {
      if (!Number.isInteger(ordemBruta) || ordens.indexOf(ordemBruta) < 0) {
        avisar(`Uma sugestão apontava para uma lâmina que não existe (${isFinite(ordemBruta) ? ordemBruta : "sem número"}) e ficou de fora.`);
        continue;
      }
      ordem = ordemBruta;
    }
    const camposBrutos = (item.campos && typeof item.campos === "object" ? item.campos : {}) as Record<string, unknown>;
    const permitidos = alvo === "conjunto" ? CAMPOS_DO_CONJUNTO : CAMPOS_DA_LAMINA;
    const campos: Partial<CamposDaMudanca> = {};
    const semCaixaAqui = ordem !== null ? ctx.semCaixa.has(ordem) : ctx.semCaixa.size > 0;

    for (const chave of permitidos) {
      const valor = limparTexto(camposBrutos[chave], MAXIMO[chave]);
      if (!valor) continue;
      if (TEXTOS_LIVRES.indexOf(chave) >= 0) {
        if (pedeEscurecer(valor)) {
          avisar("Tirei o pedido de escurecer a foto: a regra da casa não escurece foto nem capa para criar destaque. O contraste vem da cor e do peso das letras.");
          continue;
        }
        if (semCaixaAqui && pedeCaixaAtrasDoTexto(valor)) {
          avisar("Tirei a caixa atrás do texto: nesta arte o texto vai direto na cena, sem caixa, faixa ou painel.");
          continue;
        }
        campos[chave] = valor;
        continue;
      }
      if (chave === "zona_texto") {
        if (ZONAS_DA_CONVERSA.indexOf(valor as ZonaTexto) >= 0) campos.zona_texto = valor;
        continue;
      }
      if (chave === "alinhamento") {
        if ((ALINHAMENTOS as readonly string[]).indexOf(valor) >= 0) campos.alinhamento = valor;
        continue;
      }
      if (chave === "cor_fundo" || chave === "cor_texto" || chave === "cor_destaque") {
        const hex = hexDe(valor);
        if (!hex) continue;
        if (paleta.length && paleta.indexOf(hex) < 0) {
          avisar(`A cor ${hex} não está na paleta da marca e ficou de fora. Para usar, cadastre a cor no kit da marca.`);
          continue;
        }
        campos[chave] = hex;
        continue;
      }
      if (chave === "foto_acervo") {
        if (valor === SEM_FOTO || ctx.acervo.has(valor) || (!!ctx.fotosDoPedido && ctx.fotosDoPedido.has(valor))) campos.foto_acervo = valor;
        else avisar("Uma foto sugerida não está no acervo do cliente e ficou de fora.");
        continue;
      }
      if (chave === "texto_exato") {
        if (!ctx.permitirTexto) {
          avisar("O texto das lâminas não mudou: só muda quando você pede mudança de texto.");
          continue;
        }
        const f = ctx.fontesDoTexto;
        if (f && ordem !== null) {
          // Frente AG: sem fato inventado, letras da logo ou do produto no texto novo.
          const atual = (f.atual[ordem] || "").trim();
          const fiel = textoDoAjusteFiel(atual, valor, f.pedido, f.marca, f.confirmados);
          if (fiel.removidas.length) {
            avisar(`Tirei do texto novo o que não veio do pedido nem do texto atual: ${fiel.removidas.map((r) => `"${r}"`).join(", ")}.`);
          }
          if (fiel.texto && fiel.texto !== atual) campos.texto_exato = fiel.texto;
          continue;
        }
        campos.texto_exato = valor;
      }
    }

    // Contínuo: a cena é uma só. Mudança de cena numa lâmina vira mudança do conjunto pelo fio visual.
    if (ctx.continuo && alvo === "lamina" && ordens.length > 1) {
      const cena = ["imagem", "tratamento", "fundo"].some((c) => !!campos[c as keyof CamposDaMudanca]);
      if (cena) avisar("Carrossel contínuo: a cena atravessa as lâminas, então a mudança de cenário vale para todas e o fundo contínuo nasce de novo.");
      if (campos.zona_texto) avisar("Carrossel contínuo: o fundo deixa calma a área do texto de cada lâmina, então mudar onde fica o texto faz o fundo contínuo nascer de novo.");
    }

    const chaves = Object.keys(campos) as (keyof CamposDaMudanca)[];
    if (!chaves.length) continue;
    const mexeNaCena = chaves.some((c) => CAMPOS_DE_CENA.indexOf(c) >= 0);
    const regerar = alvo === "conjunto" || (ctx.continuo && mexeNaCena && ordens.length > 1) ? ordens.slice() : [ordem as number];
    // Id estável: o que já veio da conversa (m1, m2...) fica, para a tela marcar a mudança como aplicada.
    const idBruto = typeof item.id === "string" ? item.id : "";
    let id = /^m[0-9]{1,2}$/.test(idBruto) && !saida.some((x) => x.id === idBruto) ? idBruto : "";
    for (let n = saida.length + 1; !id; n++) if (!saida.some((x) => x.id === `m${n}`)) id = `m${n}`;
    saida.push({
      id,
      alvo,
      ordem: alvo === "lamina" ? ordem : null,
      titulo: limparTexto(item.titulo, 120) || (alvo === "conjunto" ? "Mudança no conjunto" : `Mudança na lâmina ${ordem}`),
      motivo: limparTexto(item.motivo, 400),
      campos,
      regerar,
    });
    if (saida.length >= MAX_MUDANCAS) break;
  }
  return { mudancas: saida, avisos };
}

// ------------------------------------------------------------------ aplicar

export type DirecaoParaMudar = {
  conceito: string;
  fio_visual?: string | null;
  estilo_pedido?: string | null;
  carrossel_infinito: boolean;
  cards: CardDirecao[];
  panorama?: PanoramaGravado | null;
  [k: string]: unknown;
};

/** Lâmina com layout (a direção antiga ganha o layout padrão da função, igual a comLayout). */
function comLayoutPadrao(card: CardDirecao, total: number): CardDirecao {
  if (card.layout) return card;
  const padrao = layoutPadrao(card.funcao, card.ordem, total);
  const cena = limparTexto(card.ilustracao || card.composicao, 500);
  return {
    ...card,
    layout: { ...padrao, imagem: cena || padrao.imagem },
    blocos: card.blocos && card.blocos.length ? card.blocos : blocosDoTexto(card.texto_exato, card.funcao),
  };
}

/**
 * Grava as mudanças na direção. O texto exato só muda quando a mudança traz
 * texto_exato (e ela só traz com pedido explícito). Devolve a direção nova, as
 * lâminas afetadas (a refazer) e se o fundo contínuo foi apagado.
 */
export function aplicarNaDirecao<D extends DirecaoParaMudar>(
  direcao: D,
  mudancas: MudancaProposta[],
): { direcao: D; afetadas: number[]; fundoApagado: boolean; textoMudou: number[] } {
  const total = direcao.cards.length;
  const afetadas = new Set<number>();
  const textoMudou: number[] = [];
  let conceito = direcao.conceito;
  let fio = direcao.fio_visual ?? null;
  let estilo = direcao.estilo_pedido ?? null;
  let mexeuNaCena = false;
  let cards = direcao.cards.slice();

  for (const m of mudancas) {
    const c = m.campos;
    if (m.alvo === "conjunto") {
      if (c.conceito) conceito = c.conceito;
      if (c.fio_visual) fio = c.fio_visual;
      if (c.estilo) estilo = c.estilo;
      if (c.conceito || c.fio_visual || c.estilo) {
        mexeuNaCena = true;
        cards.forEach((x) => afetadas.add(x.ordem));
      }
      continue;
    }
    cards = cards.map((card) => {
      if (card.ordem !== m.ordem) return card;
      const base = comLayoutPadrao(card, total);
      const layoutAtual = base.layout as LayoutLamina;
      const layout = normalizarLayout(
        {
          ...layoutAtual,
          ...(c.imagem ? { imagem: c.imagem } : {}),
          ...(c.ponto_focal ? { ponto_focal: c.ponto_focal } : {}),
          ...(c.fundo ? { fundo: c.fundo } : {}),
          ...(c.tratamento ? { tratamento: c.tratamento } : {}),
          ...(c.zona_texto ? { zona_texto: c.zona_texto as ZonaTexto } : {}),
          ...(c.alinhamento ? { alinhamento: c.alinhamento as LayoutLamina["alinhamento"] } : {}),
          ...(c.cor_fundo ? { cor_fundo: c.cor_fundo } : {}),
          ...(c.cor_texto ? { cor_texto: c.cor_texto } : {}),
          ...(c.cor_destaque ? { cor_destaque: c.cor_destaque } : {}),
        },
        base.funcao,
        base.ordem,
        total,
      );
      const nova: CardDirecao = { ...base, layout, composicao: resumoDaComposicao(layout) };
      if (c.imagem) nova.ilustracao = layout.imagem;
      if (c.evitar) nova.evitar = c.evitar;
      const doPedido = !!c.foto_acervo && c.foto_acervo.indexOf(PREFIXO_FOTO_DO_PEDIDO) === 0;
      if (c.foto_acervo) nova.imagens_ids = c.foto_acervo === SEM_FOTO || doPedido ? [] : [c.foto_acervo];
      if ((c.foto_acervo === SEM_FOTO || doPedido) && nova.fotos_livres && nova.fotos_livres.length) {
        // Sem foto real ou foto do pedido nova: a foto de fundo anterior sai (os elementos, como logos do pedido, ficam).
        nova.fotos_livres = nova.fotos_livres.filter((f) => f.papel !== "fundo");
      }
      if (doPedido) {
        // Frente AG: "troca a foto pela segunda" na arte rápida: a foto do pedido vira a base, como está.
        const caminho = (c.foto_acervo as string).slice(PREFIXO_FOTO_DO_PEDIDO.length);
        const base: NonNullable<CardDirecao["fotos_livres"]> = [{ caminho, papel: "fundo", nota: "Foto real do pedido: entra como está, sem ser refeita nem escurecida." }];
        nova.fotos_livres = base.concat(nova.fotos_livres || []);
      }
      if (c.texto_exato && c.texto_exato !== base.texto_exato) {
        nova.texto_exato = c.texto_exato;
        nova.blocos = blocosDoTexto(c.texto_exato, base.funcao);
        textoMudou.push(base.ordem);
      }
      return nova;
    });
    afetadas.add(m.ordem as number);
    if ((Object.keys(c) as (keyof CamposDaMudanca)[]).some((k) => CAMPOS_DE_CENA.indexOf(k) >= 0)) mexeuNaCena = true;
  }

  // Carrossel contínuo: a cena é uma só; mudou a cena, o panorama nasce de novo e todas são refeitas.
  const continuo = !!direcao.carrossel_infinito && total > 1;
  const fundoApagado = continuo && mexeuNaCena && !!(direcao.panorama && Object.keys(direcao.panorama.fundos || {}).length);
  if (continuo && mexeuNaCena) cards.forEach((x) => afetadas.add(x.ordem));

  const nova = {
    ...direcao,
    conceito,
    fio_visual: fio,
    estilo_pedido: estilo,
    cards,
    // Apagado com a geração seguinte: um trecho que ainda estava sendo gerado é descartado.
    ...(continuo && mexeuNaCena ? { panorama: panoramaApagado(direcao.panorama) } : {}),
  } as D;
  return { direcao: nova, afetadas: Array.from(afetadas).sort((a, b) => a - b), fundoApagado, textoMudou };
}

/** Bloco do prompt com o estilo pedido pela equipe na conversa (vale para todas as lâminas). */
export function blocoDoEstiloPedido(estilo: string | null | undefined): string {
  const e = limparTexto(estilo, 600);
  return e
    ? `ESTILO PEDIDO PELA EQUIPE PARA ESTE TRABALHO (vale em todas as lâminas, sempre dentro da marca): ${e}\nMesmo com este estilo: não escureça a foto nem a capa para criar destaque, e use só as cores da paleta.`
    : "";
}

// ------------------------------------------------------------------ antes e depois (frente AG)

/** Campos de texto e cor: o ajuste mexe só na área do texto (edição com máscara), sem refazer a cena. */
export const CAMPOS_SO_DE_TEXTO: (keyof CamposDaMudanca)[] = ["texto_exato", "cor_texto", "cor_destaque"];

/** A mudança é só de texto e cor numa lâmina: dá para ajustar só a área do texto, a foto e a cena ficam. */
export function mudancaSoDeTexto(m: Pick<MudancaProposta, "alvo" | "campos">): boolean {
  if (m.alvo !== "lamina") return false;
  const chaves = Object.keys(m.campos) as (keyof CamposDaMudanca)[];
  return chaves.length > 0 && chaves.every((c) => CAMPOS_SO_DE_TEXTO.indexOf(c) >= 0);
}

/**
 * O valor de hoje de cada campo que a mudança traz, para a tela mostrar antes
 * e depois. `rotuloDaFoto` diz como mostrar a foto de hoje (apelido e nome).
 */
export function antesDaMudanca(
  direcao: Pick<DirecaoParaMudar, "conceito" | "fio_visual" | "estilo_pedido" | "cards">,
  m: Pick<MudancaProposta, "alvo" | "ordem" | "campos">,
  rotuloDaFoto: (card: CardDirecao) => string = () => "",
): Partial<CamposDaMudanca> {
  const antes: Partial<CamposDaMudanca> = {};
  const chaves = Object.keys(m.campos) as (keyof CamposDaMudanca)[];
  if (m.alvo === "conjunto") {
    for (const k of chaves) {
      if (k === "conceito") antes.conceito = limparTexto(direcao.conceito, 1200);
      if (k === "fio_visual") antes.fio_visual = limparTexto(direcao.fio_visual, 800);
      if (k === "estilo") antes.estilo = limparTexto(direcao.estilo_pedido, 600);
    }
    return antes;
  }
  const card = direcao.cards.filter((c) => c.ordem === m.ordem)[0];
  if (!card) return antes;
  const l = (card.layout || {}) as Record<string, unknown>;
  for (const k of chaves) {
    let v = "";
    if (k === "texto_exato") v = card.texto_exato || "";
    else if (k === "evitar") v = card.evitar || "";
    else if (k === "foto_acervo") v = rotuloDaFoto(card);
    else if (k === "imagem") v = String(l.imagem || card.ilustracao || "");
    else if (l[k] != null) v = String(l[k]);
    antes[k] = limparTexto(v, Math.max(MAXIMO[k], 400));
  }
  return antes;
}

/**
 * Traduz o apelido de foto que o diretor escreveu (F1, A3) para o valor real
 * (id do acervo ou "pedido:<caminho>"). Apelido desconhecido fica como veio e
 * cai na conferência (aviso). O modelo nunca recebe nem devolve id.
 */
export function traduzirApelidosDeFoto(bruto: unknown, apelidos: Record<string, string>): unknown {
  if (!Array.isArray(bruto)) return bruto;
  return bruto.map((item) => {
    if (!item || typeof item !== "object") return item;
    const o = item as Record<string, unknown>;
    const campos = o.campos && typeof o.campos === "object" ? (o.campos as Record<string, unknown>) : null;
    if (!campos || typeof campos.foto_acervo !== "string") return item;
    const real = apelidos[campos.foto_acervo.trim().toUpperCase()];
    return real ? { ...o, campos: { ...campos, foto_acervo: real } } : item;
  });
}
