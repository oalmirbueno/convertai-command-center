/**
 * Superpoderes das mesas: montagem, escolha, prova e anexo (frente SPP, 30/09/2026).
 *
 * Adaptado de obra/superpowers v6.4.2,
 * licença MIT, Copyright (c) 2025 Jesse Vincent
 * (docs/licencas/superpowers-MIT.txt). Textos e regras dos blocos em
 * superpoderes-catalogo.ts, que a tela também lê.
 *
 * Como um agente usa (molde: mesa-roteiros, agenteConversar):
 *   const [..., sp] = await Promise.all([..., superpoderesPara(servico(), { agente: "roteiros.agente", pedido: mensagem, ultimaResposta })]);
 *   const saida = await chamarTexto({ ..., metodo: sp });
 *   const fechado = await fecharComMetodo(servico(), { usoId: saida.usoId, metodo: sp, resposta, declarados: j.metodos_usados, acaoFeita });
 *   resposta = fechado.resposta; if (fechado.anexo) anexos.push(fechado.anexo);
 *
 * Quem escolhe os blocos:
 * - o código, quando o momento é conhecido (gerar, ajustar, reprovado,
 *   falhou, revisar, lote): escolhaPorMomento, sem Jev;
 * - o Jev, nas conversas: uma chamada só, com Choice "caminho" e um Noul por
 *   método, em paralelo com a leitura do contexto (quem chama põe no
 *   Promise.all), teto de 3,5 s e cache de 5 minutos por pedido;
 * - palavras, como reserva sem o Jev (escolhaPorPalavras), com a falha no log.
 *
 * A prova é conferida no código (afirmaConclusao sem ação feita). Só na
 * suspeita sai um Noul "afirma_feito" (2,5 s, limiar 0,7). O resultado é só
 * aviso: nada é refeito (regra "sem laço de correção").
 *
 * Nada aqui lança: falha de banco ou de Jev vai para registrarFalha e a
 * resposta segue (sem método, ou com a escolha da reserva). Sem travessão.
 */

import {
  ABERTURA_DOS_SUPERPODERES,
  agenteComSuperpoderes,
  type AgenteComSuperpoderes,
  type Caminho,
  CAMINHOS,
  type FonteDaEscolha,
  type IdDoMetodo,
  IDS_DOS_METODOS,
  type LinhaDaChave,
  MAXIMO_DE_BLOCOS_EXTRAS,
  type MetodoInjetado,
  METODOS_SEMPRE,
  metodosDesligados,
  type Momento,
  ORDEM_DE_CORTE,
  TETO_DOS_SUPERPODERES,
  TEXTOS_DO_ENTENDER,
  TEXTOS_DOS_METODOS,
  VERSAO_DOS_SUPERPODERES,
} from "./superpoderes-catalogo.ts";
import { jevPerguntar, type PerguntaJev, probabilidadeNoul, type RespostaJev, type ResultadoJev } from "./jev.ts";
import { registrarFalha } from "./falha-registrada.ts";

export {
  type Caminho,
  comMetodosUsados,
  type IdDoMetodo,
  INSTRUCAO_METODOS_USADOS,
  type MetodoInjetado,
  type Momento,
  PROPRIEDADE_METODOS_USADOS,
  TETO_DOS_SUPERPODERES,
  VERSAO_DOS_SUPERPODERES,
} from "./superpoderes-catalogo.ts";

export type EscolhaDoMetodo = { caminho: Caminho; ids: IdDoMetodo[]; fonte: FonteDaEscolha; probabilidades?: Record<string, number> };

export type AnexoDoMetodo = {
  tipo: "metodo_usado";
  ids: IdDoMetodo[];
  fonte: "declarado" | "injetado";
  caminho: Caminho;
  prova: "ok" | "faltou" | "nao_se_aplica";
  versao: string;
};

export const TIPO_DO_ANEXO_METODO = "metodo_usado";

/** Limiares da política do Jev (seção 4.4 do desenho). */
export const LIMIAR_DO_METODO = 0.6;
export const LIMIAR_DA_ACAO_CARA = 0.5;
export const LIMIAR_DO_CAMINHO = 0.5;
export const LIMIAR_DO_AFIRMA_FEITO = 0.7;
export const PRAZO_DO_JEV_MS = 3_500;
export const PRAZO_DA_PROVA_MS = 2_500;

const SEPARADOR = "\n\n";

// ------------------------------------------------------------------ montagem (pura)

function textoDoBloco(id: IdDoMetodo, caminho: Caminho): string {
  if (id === "entender") {
    if (caminho === "pequeno") return TEXTOS_DO_ENTENDER.pequeno;
    if (caminho === "viabilidade") return TEXTOS_DO_ENTENDER.viabilidade;
    return TEXTOS_DO_ENTENDER.grande;
  }
  return TEXTOS_DOS_METODOS[id];
}

const posicaoDeCorte = (id: IdDoMetodo) => ORDEM_DE_CORTE.indexOf(id);

/**
 * Abertura e prova sempre; no máximo 3 blocos a mais; passando do teto, sai
 * inteiro o de menor prioridade (frentes, aceite, revisor, plano, entender,
 * receber, causa). Nunca corta no meio de um bloco e a prova nunca sai. O
 * teto vale para o texto inteiro (abertura incluída). Mesma regra de
 * montarComTeto (conhecimento-dos-agentes.ts), sem importar as bases de
 * conhecimento para as funções que não as usam.
 */
export function montarSuperpoderes(e: EscolhaDoMetodo, o: { teto?: number; desligados?: readonly IdDoMetodo[] } = {}): MetodoInjetado | null {
  const teto = typeof o.teto === "number" && o.teto > 0 ? o.teto : TETO_DOS_SUPERPODERES;
  const fora = o.desligados || [];
  const pedidos: IdDoMetodo[] = [];
  for (const id of e.ids || []) {
    if (IDS_DOS_METODOS.indexOf(id) < 0 || pedidos.indexOf(id) >= 0) continue;
    if (METODOS_SEMPRE.indexOf(id) >= 0) continue;
    if (fora.indexOf(id) >= 0) continue;
    pedidos.push(id);
  }
  // Mais de 3: ficam os de maior prioridade (os últimos da ordem de corte).
  let extras = pedidos.slice().sort((a, b) => posicaoDeCorte(b) - posicaoDeCorte(a)).slice(0, MAXIMO_DE_BLOCOS_EXTRAS);
  const montar = (lista: IdDoMetodo[]) => {
    const ids = IDS_DOS_METODOS.filter((id) => METODOS_SEMPRE.indexOf(id) >= 0 || lista.indexOf(id) >= 0);
    return { ids, texto: [ABERTURA_DOS_SUPERPODERES].concat(ids.map((id) => textoDoBloco(id, e.caminho))).join(SEPARADOR) };
  };
  let m = montar(extras);
  while (m.texto.length > teto && extras.length) {
    const menor = extras.slice().sort((a, b) => posicaoDeCorte(a) - posicaoDeCorte(b))[0];
    extras = extras.filter((x) => x !== menor);
    m = montar(extras);
  }
  if (m.texto.length > teto) return null;
  return { texto: m.texto, ids: m.ids, caminho: e.caminho, fonte: e.fonte, versao: VERSAO_DOS_SUPERPODERES, tamanho: m.texto.length };
}

// ------------------------------------------------------------------ escolha pelo código (pura)

const METODOS_DO_MOMENTO: Record<Exclude<Momento, "conversa">, { caminho: Caminho; ids: IdDoMetodo[] }> = {
  gerar: { caminho: "grande", ids: ["aceite", "revisor"] },
  ajustar: { caminho: "pequeno", ids: ["receber", "aceite"] },
  reprovado: { caminho: "pequeno", ids: ["receber", "causa"] },
  falhou: { caminho: "pequeno", ids: ["causa"] },
  revisar: { caminho: "pequeno", ids: ["revisor"] },
  lote: { caminho: "grande", ids: ["plano", "frentes", "aceite", "revisor"] },
};

const soOsPossiveis = (ids: IdDoMetodo[], padrao: readonly IdDoMetodo[]) => ids.filter((id) => padrao.indexOf(id) >= 0);

/** O código decide quando o momento é conhecido (botão Gerar, Revisar, ajuste, falha, lote). Conversa: null. */
export function escolhaPorMomento(momento: Momento, padrao: readonly IdDoMetodo[]): EscolhaDoMetodo | null {
  if (momento === "conversa") return null;
  const regra = METODOS_DO_MOMENTO[momento];
  if (!regra) return null;
  return { caminho: regra.caminho, ids: soOsPossiveis(regra.ids, padrao).concat(["prova"]), fonte: "codigo" };
}

// ------------------------------------------------------------------ reserva por palavras (pura)

function semAcento(t: string): string {
  return String(t || "")
    .toLowerCase()
    .replace(/[áàâãä]/g, "a")
    .replace(/[éèêë]/g, "e")
    .replace(/[íìîï]/g, "i")
    .replace(/[óòôõö]/g, "o")
    .replace(/[úùûü]/g, "u")
    .replace(/ç/g, "c");
}

const PALAVRAS = {
  falhou: /\b(falh\w*|erro|erros|errou|errado|errada|deu errado|nao funciona\w*|parou de funcionar|quebr\w*|bug|bugou|travou|travando|sumiu|sumiram|nao apareceu|nao aparece|nao carrega\w*|nao salvou|nao gerou|saiu errad\w*|saiu diferente|nao deu certo|deu problema)\b/,
  ajuste: /\b(ajust\w*|corrig\w*|corrij\w*|troca|trocar|troque|muda|mudar|mude|refaz\w*|refazer|refa[cz]a|reprov\w*|nao gostei|nao gostou|nao ficou|ficou ruim|ficou feio|melhora|melhorar|melhore|arruma|arrumar|arrume|tira|tirar|tire|diminui\w*|aumenta\w*)\b/,
  revisar: /\b(revis\w*|confer\w*|critiqu\w*|critica|parecer|avali\w*|o que acha|o que voce acha)\b/,
  viabilidade: /\b(da pra|da para|e possivel|consegue|conseguiria|tem como|quanto custa|quanto sai|quanto fica|vale a pena|seria possivel|daria)\b/,
  grande: /\b(campanhas?|identidade|site|proposta|contrato|estrategia|plano do mes|mes inteiro|lote|todos os|todas as|lancamento|rebranding|pacote|calendario)\b/,
  cara: /\b(gera|gerar|gere|gerem|gerando|geracao|cria|criar|crie|criem|criando|produz\w*|publica|publicar|publique|envia|enviar|envie|dispara|disparar|dispare|lote|pacote|videos?|imagens|fotos|ensaio|campanhas?)\b/,
  pergunta: /^(o que|qual|quais|quando|onde|como|quem|por que|porque|quanto|me explica|explica)\b/,
};

function contaPartes(t: string): number {
  // "faz A e depois B", "1) ... 2) ...", listas: duas ou mais partes.
  const itens = (t.match(/(^|\n)\s*(\d+[).]|[-*])\s+/g) || []).length;
  if (itens >= 2) return itens;
  const juntas = (t.match(/\b(e tambem|alem disso|e depois|e ainda|e em seguida)\b/g) || []).length;
  return juntas + 1;
}

/** Reserva sem o Jev: palavras do pedido (em 12 frases reais no teste). */
export function escolhaPorPalavras(pedido: string, padrao: readonly IdDoMetodo[]): EscolhaDoMetodo {
  const comLinhas = semAcento(pedido);
  const t = comLinhas.replace(/\s+/g, " ").trim();
  const ids: IdDoMetodo[] = [];
  const falhou = PALAVRAS.falhou.test(t);
  const ajuste = PALAVRAS.ajuste.test(t);
  const revisar = PALAVRAS.revisar.test(t);
  const viabilidade = PALAVRAS.viabilidade.test(t);
  const cara = PALAVRAS.cara.test(t);
  const grande = PALAVRAS.grande.test(t) && cara;
  const pergunta = PALAVRAS.pergunta.test(t) || (t.indexOf("?") >= 0 && !cara && !ajuste);
  let caminho: Caminho = "pequeno";
  if (viabilidade) caminho = "viabilidade";
  else if (grande) caminho = "grande";
  else if (pergunta && !falhou && !ajuste) caminho = "conversa";
  if (caminho !== "conversa") ids.push("entender");
  if (falhou) ids.push("causa");
  if (ajuste && !falhou) ids.push("receber");
  if (revisar) ids.push("revisor");
  if (caminho === "grande") ids.push("aceite");
  if (cara && caminho !== "conversa" && caminho !== "viabilidade") ids.push("plano");
  if (contaPartes(comLinhas) >= 2 && caminho !== "conversa") ids.push("frentes");
  return { caminho, ids: soOsPossiveis(ids, padrao).concat(["prova"]), fonte: "regra" };
}

// ------------------------------------------------------------------ o Jev (política pura + chamada)

/** As perguntas ao Jev (as chaves não vão ao modelo; cada instrução é completa). */
export const PERGUNTAS_DO_METODO: Record<string, PerguntaJev> = {
  caminho: {
    type: "choice",
    instructions: "Que tipo de trabalho o `pedido` pede a esta mesa?",
    criteria: {
      conversa: "pergunta, consulta ou conversa, sem produzir nem mudar nada",
      pequeno: "ajuste pequeno em algo que já existe (trocar um texto, uma cor, uma data, uma peça)",
      grande: "peça nova ou mudança grande (campanha, identidade, site, proposta, lote de peças, estratégia, plano do mês)",
      viabilidade: "quer saber se dá para fazer, como seria ou quanto custa, antes de decidir",
    },
  },
  falhou: { type: "noul", instructions: "O `pedido` ou o `erro_recente` relata que algo deu errado, falhou, quebrou, saiu diferente do esperado ou não funcionou?" },
  ajuste_recebido: { type: "noul", instructions: "O `pedido` traz uma crítica, reprovação ou pedido de ajuste (da equipe ou do cliente) sobre algo que o agente já entregou?" },
  revisar: { type: "noul", instructions: "O `pedido` pede para revisar, conferir, criticar ou dar parecer sobre uma peça antes de entregar?" },
  varias_frentes: { type: "noul", instructions: "O `pedido` tem duas ou mais partes independentes, que poderiam ser feitas separadamente sem uma depender da outra?" },
  acao_cara: { type: "noul", instructions: "Atender o `pedido` exige ação com custo ou irreversível (gerar imagem ou vídeo, lote de peças, publicar, enviar, usar modelo caro) ou mais de dois passos?" },
};

/** Política do desenho (4.4), com os julgamentos crus guardados em `probabilidades` para calibrar. */
export function lerEscolhaDoJev(r: Record<string, RespostaJev>, padrao: readonly IdDoMetodo[], o: { pecaGrande?: boolean } = {}): EscolhaDoMetodo {
  const p = (k: string) => {
    const v = probabilidadeNoul(r[k]);
    return v === null ? 0 : v;
  };
  const probabilidades: Record<string, number> = {};
  for (const k of ["falhou", "ajuste_recebido", "revisar", "varias_frentes", "acao_cara"]) {
    const v = probabilidadeNoul(r[k]);
    if (v !== null) probabilidades[k] = v;
  }
  const c = r.caminho || {};
  const escolhido = typeof c.choice === "string" && CAMINHOS.indexOf(c.choice as Caminho) >= 0 ? (c.choice as Caminho) : null;
  const confianca = typeof c.confidence === "number" ? c.confidence : escolhido ? 1 : 0;
  if (escolhido) probabilidades[`caminho_${escolhido}`] = confianca;
  const cara = p("acao_cara") >= LIMIAR_DA_ACAO_CARA;
  let caminho: Caminho = escolhido || "pequeno";
  // Confiança baixa vale "pequeno"; só vira "grande" com ação cara (não encher de perguntas o pedido simples).
  if (confianca < LIMIAR_DO_CAMINHO) caminho = cara && escolhido === "grande" ? "grande" : "pequeno";
  const ids: IdDoMetodo[] = [];
  if (caminho === "grande") {
    ids.push("entender", "aceite");
    if (o.pecaGrande) ids.push("revisor");
  } else if (caminho === "pequeno" || caminho === "viabilidade") {
    ids.push("entender");
  }
  if (p("falhou") >= LIMIAR_DO_METODO) ids.push("causa");
  if (p("ajuste_recebido") >= LIMIAR_DO_METODO) ids.push("receber");
  if (p("revisar") >= LIMIAR_DO_METODO) ids.push("revisor");
  if (p("varias_frentes") >= LIMIAR_DO_METODO) ids.push("frentes");
  if (cara && caminho !== "conversa") ids.push("plano");
  const unicos: IdDoMetodo[] = [];
  for (const id of ids) if (unicos.indexOf(id) < 0) unicos.push(id);
  return { caminho, ids: soOsPossiveis(unicos, padrao).concat(["prova"]), fonte: "jev", probabilidades };
}

type Perguntar = (
  a: { state: unknown; questions: Record<string, PerguntaJev> },
  o?: { timeoutMs?: number },
) => Promise<Pick<ResultadoJev, "answers">>;

export type ContextoDoPedido = {
  mesa: string;
  oQueFaz: string;
  padrao: readonly IdDoMetodo[];
  pecaGrande?: boolean;
  ultimaResposta?: string | null;
  erroRecente?: string | null;
};

const CACHE_DA_ESCOLHA = new Map<string, { em: number; escolha: EscolhaDoMetodo }>();
const VIDA_DO_CACHE_MS = 5 * 60_000;
const MAXIMO_NO_CACHE = 200;

/** Só para teste. */
export function limparCacheDosSuperpoderes() {
  CACHE_DA_ESCOLHA.clear();
  CHAVES_DAS_MESAS.linhas = null;
  CHAVES_DAS_MESAS.em = 0;
}

function lerCache(chave: string): EscolhaDoMetodo | null {
  const c = CACHE_DA_ESCOLHA.get(chave);
  if (!c) return null;
  if (Date.now() - c.em > VIDA_DO_CACHE_MS) {
    CACHE_DA_ESCOLHA.delete(chave);
    return null;
  }
  return c.escolha;
}

function guardarCache(chave: string, escolha: EscolhaDoMetodo) {
  if (CACHE_DA_ESCOLHA.size >= MAXIMO_NO_CACHE) {
    const primeira = CACHE_DA_ESCOLHA.keys().next();
    if (!primeira.done) CACHE_DA_ESCOLHA.delete(primeira.value);
  }
  CACHE_DA_ESCOLHA.set(chave, { em: Date.now(), escolha });
}

/**
 * Nas conversas: uma chamada ao Jev (Choice "caminho" + um Noul por método),
 * com teto de 3,5 s e cache de 5 minutos. Sem Jev, vale a reserva por palavras
 * e a falha vai para o log. Nunca lança.
 */
export async function escolherMetodos(pedido: string, ctx: ContextoDoPedido, o: { perguntar?: Perguntar; timeoutMs?: number } = {}): Promise<EscolhaDoMetodo> {
  const texto = String(pedido || "").slice(0, 1200);
  const erro = String(ctx.erroRecente || "").slice(0, 300);
  const chave = `${ctx.mesa}|${erro}|${texto}`;
  const guardada = lerCache(chave);
  if (guardada) return guardada;
  const perguntar: Perguntar = o.perguntar || ((a, op) => jevPerguntar(a, op));
  try {
    const r = await perguntar(
      {
        state: {
          pedido: texto,
          mesa: ctx.mesa,
          o_que_a_mesa_faz: String(ctx.oQueFaz || "").slice(0, 300),
          ultima_resposta_do_agente: String(ctx.ultimaResposta || "").slice(0, 300),
          erro_recente: erro,
        },
        questions: PERGUNTAS_DO_METODO,
      },
      { timeoutMs: o.timeoutMs ?? PRAZO_DO_JEV_MS },
    );
    const escolha = lerEscolhaDoJev(r.answers || {}, ctx.padrao, { pecaGrande: ctx.pecaGrande });
    guardarCache(chave, escolha);
    return escolha;
  } catch (e) {
    registrarFalha("superpoderes: jev não escolheu o método (vale a reserva por palavras)", e, { mesa: ctx.mesa });
    return escolhaPorPalavras(`${texto} ${erro}`, ctx.padrao);
  }
}

// ------------------------------------------------------------------ liga e desliga (banco)

// deno-lint-ignore no-explicit-any
type Banco = { from: (tabela: string) => any; rpc: (fn: string, args?: Record<string, unknown>) => any };

const CHAVES_DAS_MESAS: { linhas: LinhaDaChave[] | null; em: number } = { linhas: null, em: 0 };
const VIDA_DAS_CHAVES_MS = 60_000;

/** Liga e desliga das mesas, com cache de 60 s por função (leitura pelo cliente de serviço). Sem tabela: tudo ligado. */
export async function lerChavesDasMesas(db: Banco): Promise<LinhaDaChave[]> {
  if (CHAVES_DAS_MESAS.linhas && Date.now() - CHAVES_DAS_MESAS.em < VIDA_DAS_CHAVES_MS) return CHAVES_DAS_MESAS.linhas;
  let linhas: LinhaDaChave[] = [];
  try {
    const { data, error } = await db.from("superpoderes_das_mesas").select("mesa, metodo, ligado");
    if (error) throw error;
    linhas = ((data as LinhaDaChave[] | null) || []).filter((l) => l && typeof l.mesa === "string" && typeof l.metodo === "string");
  } catch (e) {
    registrarFalha("superpoderes: chaves das mesas não lidas (vale tudo ligado)", e);
  }
  CHAVES_DAS_MESAS.linhas = linhas;
  CHAVES_DAS_MESAS.em = Date.now();
  return linhas;
}

/**
 * O método de um agente para esta chamada. Com momento que não é conversa, o
 * código escolhe; na conversa, o Jev (ou a reserva). Monta com o teto e tira o
 * que a mesa desligou. Nunca lança: sem método, devolve null e a chamada segue.
 */
export async function superpoderesPara(
  db: Banco,
  p: { agente: string; pedido?: string | null; momento?: Momento; ultimaResposta?: string | null; erroRecente?: string | null; teto?: number },
  o: { perguntar?: Perguntar } = {},
): Promise<MetodoInjetado | null> {
  try {
    const agente: AgenteComSuperpoderes | null = agenteComSuperpoderes(p.agente);
    if (!agente) {
      registrarFalha("superpoderes: agente fora do catálogo", new Error(p.agente));
      return null;
    }
    const momento: Momento = p.momento || (agente.escolha === "codigo" ? "gerar" : "conversa");
    const [linhas, escolha] = await Promise.all([
      lerChavesDasMesas(db),
      momento === "conversa"
        ? escolherMetodos(String(p.pedido || ""), {
          mesa: agente.rotulo,
          oQueFaz: agente.oQueFaz,
          padrao: agente.metodos,
          pecaGrande: agente.pecaGrande,
          ultimaResposta: p.ultimaResposta,
          erroRecente: p.erroRecente,
        }, o)
        : Promise.resolve(escolhaPorMomento(momento, agente.metodos)),
    ]);
    if (!escolha) return null;
    const m = montarSuperpoderes(escolha, { teto: p.teto ?? agente.teto, desligados: metodosDesligados(linhas, agente.mesa) });
    return m ? { ...m, agente: agente.id } : null;
  } catch (e) {
    registrarFalha("superpoderes: método não montado (a chamada segue sem)", e, { agente: p.agente });
    return null;
  }
}

// ------------------------------------------------------------------ prova (pura)

/** Ação do próprio agente, no passado e em primeira pessoa. */
const VERBOS_DE_ACAO = /\b(gerei|salvei|enviei|publiquei|criei|corrigi|apliquei|atualizei|ajustei|troquei|mudei|arquivei|apaguei|removi|agendei|refiz|reescrevi|conclui|terminei|finalizei|cadastrei|registrei|subi|anexei|editei|renomeei|movi|marquei|aprovei|disparei)\b/;
/** "Pronto." ou "Já está salvo." no começo da frase, sem sujeito: fala do que acabou de ser pedido. */
const PRONTO_NO_COMECO = /^(pronto|feito|prontinho|tudo certo)\s*(,|$)/;
const JA_FEITO_NO_COMECO = /^ja\s+(esta|estao|foi|foram|ficou|ficaram)\s+(gerad|salv|enviad|publicad|criad|corrigid|aplicad|atualizad|ajustad|agendad|arquivad|feit|pront|conclu|registrad|cadastrad)\w*/;
/** A entrega é o próprio texto desta resposta (roteiro, versões, estrutura), não uma ação no painel. */
const ENTREGA_NO_TEXTO = /\b(abaixo|a seguir|segue|seguem|veja|confira|estas sao|estes sao|ficou assim|ficaram assim|aqui (esta|estao|vai|vao|vem))\b|\baqui\s*:?\s*$|:\s*$/;
/** Relato do que aconteceu antes desta resposta (status da semana, histórico). */
const RELATO_DO_PASSADO = /\b(semana passada|mes passado|ano passado|ontem|anteontem|ha \d+ (dias?|semanas?|meses)|em (janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro))\b/;
/** O que o verbo produziu é texto entregue aqui (opções, versões, ideias), não peça gravada. */
const OBJETO_DE_TEXTO = /^\s*(\S+\s+){0,3}(opcao|opcoes|versao|versoes|sugestao|sugestoes|ideia|ideias|alternativas|rascunho|esboco|estrutura)\b/;

/**
 * A resposta afirma que o PRÓPRIO agente JÁ fez algo NESTA resposta? Frase a
 * frase: verbo de ação em primeira pessoa ("gerei", "salvei"), ou "Pronto." e
 * "Já está salvo." no começo da frase. Não conta (revisão de 30/09):
 * - proposta e cartão ("vou gerar", "posso gerar", "a lista está pronta para
 *   confirmar", "montei o cartão");
 * - voz passiva com sujeito, que é relato de status ("foram publicados 3
 *   posts", "o post de terça já está agendado", "a campanha ficou pronta");
 * - relato do passado ("na semana passada", "em agosto", "ontem");
 * - texto entregue na própria resposta ("criei abaixo a estrutura", "reescrevi
 *   o gancho; veja as 3 versões", "gerei 3 opções de título").
 */
export function afirmaConclusao(resposta: string): boolean {
  const t = semAcento(resposta).replace(/[ \t\r]+/g, " ");
  if (!t.trim()) return false;
  // Proposta e cartão não são conclusão.
  const limpo = t
    .replace(/\b(lista|cartao|proposta|plano|opcoes|sugestao|sugestoes)\b[^.!?\n]{0,40}\bpront\w*/g, " ")
    .replace(/\bpront\w*\s+para\s+(confirmar|voce|aprovar|revisar|usar|gerar)/g, " ")
    .replace(/\b(montei|preparei|separei|deixei)\s+(a|o|as|os)\s+(lista|cartao|cartoes|proposta|opcoes|plano)\b/g, " ")
    .replace(/\b(ainda nao|nao)\s+\w+/g, " ");
  for (const pedaco of limpo.split(/[.!?\n]+/)) {
    const frase = pedaco.trim();
    if (!frase) continue;
    if (ENTREGA_NO_TEXTO.test(frase) || RELATO_DO_PASSADO.test(frase)) continue;
    if (PRONTO_NO_COMECO.test(frase) || JA_FEITO_NO_COMECO.test(frase)) return true;
    const v = VERBOS_DE_ACAO.exec(frase);
    if (v && !OBJETO_DE_TEXTO.test(frase.slice(v.index + v[0].length))) return true;
  }
  return false;
}

export const AVISO_SEM_PROVA = "Ainda não fiz: esta resposta não executou nenhuma ação. Se quiser que eu faça, peça e eu monto o cartão para confirmar.";

/** Conferência no código: afirma conclusão sem ação feita (ou com todas as ações falhando) é suspeita. */
export function conferirProva(resposta: string, p: { acaoFeita: boolean; resultados?: unknown[] | null }): { ok: boolean; aviso: string | null } {
  if (!afirmaConclusao(resposta)) return { ok: true, aviso: null };
  const resultados = Array.isArray(p.resultados) ? p.resultados : [];
  const algumaDeuCerto = resultados.length === 0 || resultados.some((r) => !(r && typeof r === "object" && (r as { ok?: unknown }).ok === false));
  if (p.acaoFeita && algumaDeuCerto) return { ok: true, aviso: null };
  return { ok: false, aviso: AVISO_SEM_PROVA };
}

// ------------------------------------------------------------------ anexo (puro)

/**
 * O anexo "Método: ..." da resposta. ids = os que o agente declarou em
 * metodos_usados cruzados com os injetados (como o "Segui:" cruza com as
 * regras); sem declaração (agente sem JSON), vale a lista injetada.
 */
export function anexoDoMetodo(m: MetodoInjetado | null, declarados: unknown, prova: { ok: boolean; seAplica?: boolean } | null): AnexoDoMetodo | null {
  if (!m) return null;
  const estadoDaProva: AnexoDoMetodo["prova"] = !prova || prova.seAplica === false ? "nao_se_aplica" : prova.ok ? "ok" : "faltou";
  let ids: IdDoMetodo[];
  let fonte: AnexoDoMetodo["fonte"];
  if (Array.isArray(declarados)) {
    const lista = declarados.map((x) => String(x || "").trim().toLowerCase());
    ids = m.ids.filter((id) => lista.indexOf(id) >= 0);
    fonte = "declarado";
  } else {
    ids = m.ids.slice();
    fonte = "injetado";
  }
  if (!ids.length && estadoDaProva !== "faltou") return null;
  return { tipo: "metodo_usado", ids, fonte, caminho: m.caminho, prova: estadoDaProva, versao: m.versao };
}

// ------------------------------------------------------------------ fechar a resposta (banco e Jev)

/** Grava no uso de IA o que o método fez (RPC só do servidor). Não espera; erro vai para o log. */
export function marcarMetodoNoUso(
  db: Banco,
  usoId: string | null | undefined,
  d: { metodos?: IdDoMetodo[] | null; fonte?: FonteDaEscolha | null; prova?: AnexoDoMetodo["prova"] | null; agente?: string | null; versao?: string | null },
): Promise<void> {
  if (!usoId) return Promise.resolve();
  const p = Promise.resolve()
    .then(() => db.rpc("ia_uso_marcar_metodo", {
      _uso_id: usoId,
      _metodos: d.metodos ?? null,
      _fonte: d.fonte ?? null,
      _prova: d.prova ?? null,
      _agente: d.agente ?? null,
      _versao: d.versao ?? null,
    }))
    .then((r: { error?: unknown } | null) => {
      if (r && r.error) registrarFalha("superpoderes: método não gravado no uso", r.error, { uso_id: usoId });
    })
    .catch((e: unknown) => {
      registrarFalha("superpoderes: método não gravado no uso", e, { uso_id: usoId });
    });
  const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (er && typeof er.waitUntil === "function") er.waitUntil(p);
  return p;
}

/**
 * Registro do método quando a chamada não gerou linha em ia_usos (revisão de
 * 30/09): a cadeia antiga (ai-provider: Workspace, Assistente geral, coach,
 * radar) e a reserva da Central e dos rituais. Vai para
 * superpoderes_usos_sem_ia pela RPC (servidor ou equipe), e a seção "Uso em 30
 * dias" soma com o ia_usos. Não espera; erro vai para o log. Sem método, nada.
 */
export function registrarMetodoSemUso(
  db: Banco,
  p: { metodo: MetodoInjetado | null | undefined; clientId?: string | null; prova?: AnexoDoMetodo["prova"] | null },
): Promise<void> {
  const m = p.metodo;
  if (!m || !m.agente || !m.ids.length) return Promise.resolve();
  const clientId = p.clientId && /^[0-9a-f-]{36}$/i.test(p.clientId) ? p.clientId : null;
  const tarefa = Promise.resolve()
    .then(() => db.rpc("superpoderes_registrar_sem_uso", {
      _agente: m.agente,
      _metodos: m.ids,
      _fonte: m.fonte,
      _prova: p.prova ?? null,
      _versao: m.versao,
      _client_id: clientId,
    }))
    .then((r: { error?: unknown } | null) => {
      if (r && r.error) registrarFalha("superpoderes: método sem uso de IA não registrado", r.error, { agente: m.agente });
    })
    .catch((e: unknown) => {
      registrarFalha("superpoderes: método sem uso de IA não registrado", e, { agente: m.agente });
    });
  const er = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
  if (er && typeof er.waitUntil === "function") er.waitUntil(tarefa);
  return tarefa;
}

/**
 * Depois da resposta do modelo: confere a prova (código; Jev só na suspeita),
 * acrescenta o aviso "Ainda não fiz" quando a resposta diz pronto sem ação
 * feita (só aviso, sem refazer), monta o anexo e grava no uso. Sem usoId (a
 * cadeia antiga e a reserva), o método e a prova vão para o registro sem uso
 * (registrarMetodoSemUso), com o cliente quando houver. Nunca lança.
 */
export async function fecharComMetodo(
  db: Banco,
  p: {
    usoId: string | null | undefined;
    metodo: MetodoInjetado | null;
    resposta: string;
    declarados: unknown;
    acaoFeita: boolean;
    resultados?: unknown[] | null;
    /** Cliente da conversa, para o registro sem uso (a auditoria filtra por acesso). */
    clientId?: string | null;
  },
  o: { perguntar?: Perguntar } = {},
): Promise<{ resposta: string; anexo: AnexoDoMetodo | null }> {
  let resposta = String(p.resposta || "");
  if (!p.metodo) return { resposta, anexo: null };
  try {
    const conferida = conferirProva(resposta, { acaoFeita: p.acaoFeita, resultados: p.resultados });
    let prova: { ok: boolean; seAplica: boolean } = { ok: true, seAplica: false };
    if (!conferida.ok) {
      let suspeita = true;
      try {
        const perguntar: Perguntar = o.perguntar || ((a, op) => jevPerguntar(a, op));
        const r = await perguntar({
          state: { resposta: resposta.slice(0, 1500), acao_executada: false },
          questions: {
            afirma_feito: {
              type: "noul",
              instructions: "A `resposta` do agente afirma que algo JÁ foi feito, gerado, salvo, enviado ou corrigido, e não apenas proposto ou planejado?",
            },
          },
        }, { timeoutMs: PRAZO_DA_PROVA_MS });
        const v = probabilidadeNoul(r.answers ? r.answers.afirma_feito : undefined);
        if (v !== null) suspeita = v >= LIMIAR_DO_AFIRMA_FEITO;
      } catch (e) {
        // Sem Jev, vale a conferência do código.
        registrarFalha("superpoderes: jev não conferiu a prova (vale a conferência do código)", e);
      }
      if (suspeita) {
        prova = { ok: false, seAplica: true };
        if (conferida.aviso && resposta.indexOf(conferida.aviso) < 0) resposta = `${resposta.trim()} ${conferida.aviso}`.trim();
      }
    } else if (afirmaConclusao(resposta)) {
      prova = { ok: true, seAplica: true };
    }
    const anexo = anexoDoMetodo(p.metodo, p.declarados, prova);
    const estadoDaProva: AnexoDoMetodo["prova"] = prova.seAplica ? (prova.ok ? "ok" : "faltou") : "nao_se_aplica";
    // Com uso: os métodos, a fonte e o agente já foram gravados pelo chamarTexto; aqui só a prova.
    if (p.usoId) void marcarMetodoNoUso(db, p.usoId, { prova: estadoDaProva });
    else void registrarMetodoSemUso(db, { metodo: p.metodo, clientId: p.clientId ?? null, prova: estadoDaProva });
    return { resposta, anexo };
  } catch (e) {
    registrarFalha("superpoderes: resposta não fechada com o método", e);
    return { resposta, anexo: null };
  }
}
