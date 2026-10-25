/**
 * A partida da construção dentro do motor de código (frente MCC, 25/10/2026).
 * O contrato com a tela mora em jornada-do-site.ts (objetivo, partida, motor,
 * modelo_id, contexto_do_cliente, gravados em motor_trabalhos.pedido); aqui
 * fica o que o worker faz com ele: a instrução de cada passada (zero,
 * referência nos modos fiel, próximo e criativo, ou site pronto), a regra de
 * autoria e a conferência final de que o site não levou o texto da
 * referência. Também os modelos sugeridos para o Claude Code pela OpenRouter.
 *
 * Puro (a tela, a função e o worker importam). Sem lookbehind, sem classe de
 * propriedade Unicode, sem grupo nomeado. Sem travessão.
 */
import { MODOS_DA_REFERENCIA, type MotorDeCodigo, MOTORES_DE_CODIGO, normalizarPartida, objetivoDoSite, type PartidaDoSite } from "./jornada-do-site.ts";
import { modeloPronto } from "./modelos-prontos.ts";
import { eventosDoObjetivo } from "./medicao-do-site.ts";

// ------------------------------------------------------------------ o que o worker lê do pedido

export type ObraDoTrabalho = {
  objetivo: string | null;
  partida: PartidaDoSite;
  /** Escolhido na tela; null = o padrão do worker. */
  motor: MotorDeCodigo | null;
  contexto_do_cliente: Record<string, unknown> | null;
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * O contrato lido de motor_trabalhos.pedido, sem confiar em nada. Pedido
 * antigo (sem jornada) vira partida "zero" sem objetivo: o trabalho segue
 * como sempre foi.
 */
export function obraDoPedido(pedido: unknown): ObraDoTrabalho {
  const o = obj(pedido);
  const objetivo = objetivoDoSite(o.objetivo);
  const partida = normalizarPartida(o.partida) || { tipo: "zero" as const };
  const motor = MOTORES_DE_CODIGO.some((m) => m === o.motor) ? (o.motor as MotorDeCodigo) : null;
  const ctx = obj(o.contexto_do_cliente);
  return { objetivo: objetivo ? objetivo.id : null, partida, motor, contexto_do_cliente: Object.keys(ctx).length ? ctx : null };
}

// ------------------------------------------------------------------ autoria (direito autoral e marca)

/** A regra que vai em toda passada com referência ou site pronto (e nas skills do Claude Code). */
export const REGRA_DE_AUTORIA = [
  "AUTORIA (regra dura da casa, vale em todos os modos):",
  "- Da referência você pode seguir a ESTRUTURA: ordem e tipo das seções, grade, proporções, ritmo de espaçamento, hierarquia tipográfica, comportamento (menu, rolagem, animação, estados).",
  "- NUNCA copie da referência: textos (nem frases parecidas), logo, nome, fotos, ilustrações, ícones próprios, vídeos, código-fonte, CSS ou fontes pagas. Nada de link para os arquivos dela.",
  "- Todo texto vem do pacote do cliente (copy aprovada, marca, contexto). Toda imagem vem de public/ (logo real, fotos reais, imagens geradas do cliente). Cores e fontes só pelas variáveis de src/marca.css.",
  "- Faltou texto ou imagem para um bloco: use a copy do pacote ou deixe o bloco de fora e diga em DECIDI. Nunca preencha com o conteúdo da referência nem com lorem ipsum.",
  "- O motor confere no fim se o site final tem trechos longos da referência; se tiver, a entrega volta com aviso.",
].join("\n");

const MODOS: Record<string, string> = {
  fiel: "FIEL: reproduza a estrutura da referência com a maior precisão possível: mesma ordem e quantidade de seções, mesma grade e proporção das colunas, mesmo ritmo de espaçamento, mesma hierarquia de títulos, mesmo comportamento do menu, da rolagem e das animações. Só o conteúdo, a marca, as cores e as imagens são do cliente.",
  proximo: "PRÓXIMO: mantenha a linguagem visual e a organização da referência (ordem das seções, tipo de grade, densidade, clima), com liberdade para ajustar proporções, componentes e movimento ao que o conteúdo e a marca do cliente pedem.",
  criativo: "CRIATIVO: use a referência como ponto de partida (o clima, uma ou duas ideias de layout ou de movimento) e crie uma página nova e própria para a marca do cliente. A página não pode parecer cópia da referência.",
};

/** Sites prontos: o que o agente lê em referencias/modelo-pronto/. */
const PASTA_DO_MODELO_PRONTO = "referencias/modelo-pronto";
/** Referência capturada pelo motor: prints e estrutura medida em referencias/referencia/. */
export const PASTA_DA_REFERENCIA = "referencias/referencia";

/**
 * O bloco da partida que entra no pedido de cada passada do construir (e do
 * ajustar, para o ajuste não fugir da referência). Zero sem objetivo: vazio.
 */
export function instrucoesDaPartida(o: ObraDoTrabalho, comSkills = false): string {
  const linhas: string[] = [];
  const objetivo = objetivoDoSite(o.objetivo);
  if (objetivo) linhas.push(`OBJETIVO DO SITE: ${objetivo.rotulo} (${objetivo.descricao}). Próximo passo do visitante: ${objetivo.acao} Toda seção trabalha para isso.`);
  if (objetivo && objetivo.id === "servico") linhas.push(`SITE DE SERVIÇO: serviços com o resultado, prova real, processo, área de atendimento e o botão de orçamento ou agendamento em toda dobra.${comSkills ? " Use a skill site-de-servico." : ""}`);
  if (objetivo && objetivo.id === "loja_virtual") linhas.push(`LOJA VIRTUAL: produtos, preços, categorias e checkout vêm de pacote.loja; use os componentes de src/lib/loja.tsx (Vitrine, CartaoDoProduto, BotaoComprar, DetalheDoProduto); o carrinho e a compra já estão na casca.${comSkills ? " Use a skill loja-virtual." : ""}`);
  if (objetivo) {
    const eventos = eventosDoObjetivo(objetivo.id, null).filter((e) => e !== "PageView");
    linhas.push(`MEDIÇÃO: o site mede ${eventos.join(", ")} (pacote.medicao). Quem dispara é a casca, só depois do Aceitar dos cookies: nunca escreva fbq, gtag nem script de rastreio. Na seção: WhatsApp por linkDoWhatsapp (conta Contact sozinho), botão de agendar ou orçamento com data-evento="Schedule", abrir serviço ou produto com data-evento="ViewContent", formulário só pelo <Formulario /> (conta Lead).${comSkills ? " Use a skill pixel-e-eventos." : ""}`);
  }
  const p = o.partida;
  if (p.tipo === "referencia") {
    const modo = MODOS_DA_REFERENCIA.filter((m) => m.id === p.modo)[0];
    linhas.push(
      `PARTIDA: referência ${p.url}, modo ${modo ? modo.rotulo : "Próximo"}.`,
      MODOS[p.modo || "proximo"] || MODOS.proximo,
      `O motor já capturou a referência (você não acessa a internet): ${PASTA_DA_REFERENCIA}/estrutura.json (seções na ordem, com altura, colunas, alinhamento, cor de fundo e tamanho dos títulos; tokens de tipografia, cores, cantos e espaçamento; o menu) e os prints da página de cima a baixo em fatias, ${PASTA_DA_REFERENCIA}/computador-1.jpg, computador-2.jpg... e celular-1.jpg... (a lista está em estrutura.json, campo prints). Leia o estrutura.json e olhe as fatias que mostram o bloco desta seção antes de escrever. Ache na referência o bloco que corresponde à seção desta passada e siga a estrutura dele no modo pedido.`,
      comSkills ? "Use a skill clonar-referencia (método: mapear, observar, construir, comparar)." : "",
      REGRA_DE_AUTORIA,
    );
  } else if (p.tipo === "modelo_pronto") {
    const m = modeloPronto(p.modelo_id);
    linhas.push(
      `PARTIDA: site pronto "${m ? m.nome : p.modelo_id}"${m ? ` (${m.descricao})` : ""}, de código aberto (${m ? `${m.licenca}, ${m.autor}` : "licença no LICENSE da pasta"}).`,
      `A cópia do modelo está em ${PASTA_DO_MODELO_PRONTO}/ (HTML das páginas, o SCSS do tema em scss/ e a LICENSE; sem as fotos de demonstração). Leia o index.html e o SCSS do tema antes de escrever a seção: siga a estrutura, a ordem, a grade, o ritmo e os componentes do modelo para a seção desta passada, reescrevendo em React no método da casa (src/secoes, variáveis de src/marca.css).`,
      "A licença do modelo permite reaproveitar o código; o conteúdo dele não: textos, nomes e fotos de demonstração ficam de fora. Todo texto e imagem são do cliente.",
      comSkills ? "Use a skill partir-de-modelo-pronto." : "",
      REGRA_DE_AUTORIA,
    );
  }
  const ctx = o.contexto_do_cliente;
  if (ctx && Object.keys(ctx).length) linhas.push("CONTEXTO DO CLIENTE conferido pela equipe nesta construção: .aceleriq/pacote.json, campo contexto_do_cliente. Ele vence o resto do pacote quando discordar.");
  return linhas.filter(Boolean).join("\n");
}

// ------------------------------------------------------------------ conferência de autoria

const normalizar = (s: string) =>
  String(s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** Trechos da referência que contam: frases com 8 palavras ou mais (título curto e menu ficam de fora). */
export function trechosLongos(textos: string[], minPalavras = 8): string[] {
  const vistos: Record<string, true> = {};
  const saida: string[] = [];
  for (const t of Array.isArray(textos) ? textos : []) {
    const n = normalizar(t);
    if (n.split(" ").length < minPalavras || vistos[n]) continue;
    vistos[n] = true;
    saida.push(n);
  }
  return saida.slice(0, 400);
}

export type ConferenciaDeAutoria = { ok: boolean; copiados: string[]; conferidos: number };

/**
 * O site final não pode ter trecho longo da referência: para cada frase da
 * referência com 8 palavras ou mais, procura no texto do site qualquer
 * sequência de 8 palavras seguidas dela. Achou = copiado (vai como aviso).
 */
export function conferirAutoria(textoDoSite: string, textosDaReferencia: string[], janela = 8): ConferenciaDeAutoria {
  const site = ` ${normalizar(textoDoSite)} `;
  const trechos = trechosLongos(textosDaReferencia, janela);
  const copiados: string[] = [];
  for (const t of trechos) {
    const p = t.split(" ");
    for (let i = 0; i + janela <= p.length; i++) {
      const pedaco = p.slice(i, i + janela).join(" ");
      if (site.indexOf(` ${pedaco} `) >= 0) {
        copiados.push(pedaco);
        break;
      }
    }
    if (copiados.length >= 10) break;
  }
  return { ok: copiados.length === 0, copiados, conferidos: trechos.length };
}

// ------------------------------------------------------------------ motor menor: modelos sugeridos para o Claude Code

export type ModeloSugerido = {
  /** id no catálogo ia_modelos. */
  id: string;
  /** id na OpenRouter (o que vai em --model). */
  openrouter: string;
  rotulo: string;
  papel: string;
  /** US$ por 1 milhão de tokens, tabela da OpenRouter em 25/10/2026. */
  entrada_1m: number;
  saida_1m: number;
  cache_1m: number;
};

/**
 * Do mais leve ao mais forte. O padrão do Claude Code é o primeiro (o Claude
 * Code só é garantido com modelo da Anthropic pela OpenRouter). O terceiro é
 * o mais barato de todos, sem garantia de compatibilidade das ferramentas.
 */
export const MODELOS_SUGERIDOS_DO_CLAUDE_CODE: readonly ModeloSugerido[] = [
  { id: "openrouter:anthropic/claude-haiku-5.5", openrouter: "anthropic/claude-haiku-5.5", rotulo: "Claude Haiku 5.5", papel: "padrão: leve e barato, bom para seção a seção", entrada_1m: 0.1, saida_1m: 0.5, cache_1m: 0.01 },
  { id: "openrouter:anthropic/claude-sonnet-5.5", openrouter: "anthropic/claude-sonnet-5.5", rotulo: "Claude Sonnet 5.5", papel: "mais caprichado: referência fiel e sites com muitas páginas", entrada_1m: 2, saida_1m: 10, cache_1m: 0.1 },
  { id: "openrouter:deepseek/deepseek-v4-flash", openrouter: "deepseek/deepseek-v4-flash", rotulo: "DeepSeek V4 Flash", papel: "o mais barato; fora da Anthropic, as ferramentas podem falhar", entrada_1m: 0.091, saida_1m: 0.182, cache_1m: 0.0182 },
];

export const MODELO_PADRAO_DO_CLAUDE_CODE = MODELOS_SUGERIDOS_DO_CLAUDE_CODE[0].id;
