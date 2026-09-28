/**
 * Ordem direta ao agente sênior (frente AD, 28/09). Teste real do dono na
 * Verzelo: "renomeie a campanha X para Y. Só essa ação" ficou 6 minutos no
 * GPT-6 Luna no raciocínio máximo e terminou em provedor_timeout, sem fazer e
 * sem gravar nada. Ordem simples e única (pausar, ativar, renomear ou mudar a
 * verba com valor, de um item citado pelo nome) não precisa do modelo pesado:
 *
 * - código pré-filtra (a mensagem tem cara de ordem, os itens da conta viram
 *   candidatos com apelido, o nome citado casa sozinho quando é único);
 * - o Jev (Choice) confirma a ordem e, se o nome não casou sozinho, escolhe o
 *   item entre os candidatos, com "nenhum" como saída;
 * - o valor livre (nome novo, verba) é tirado em código (aspas, "para ...",
 *   R$), nunca inventado; faltou, cai no caminho do modelo;
 * - quem executa é o acoes-conta (relê antes, escreve, relê depois).
 *
 * Puro (sem Deno, sem banco): testado no Vitest.
 */
import type { PerguntaJev, RespostaJev } from "../_shared/jev.ts";

export type TipoDaOrdem = "pausar" | "ativar" | "renomear" | "orcamento";
export type NivelDaOrdem = "campanha" | "conjunto" | "anuncio";

export type CandidatoDaOrdem = {
  ref: string;
  nivel: NivelDaOrdem;
  meta_id: string;
  nome: string;
  status: string | null;
  campanha: string | null;
};

export type OrdemResolvida = {
  tipo: TipoDaOrdem;
  alvo: CandidatoDaOrdem;
  nome_novo: string | null;
  orcamento_diario_brl: number | null;
  /** Como o alvo foi achado: pelo nome exato na mensagem, ou pelo Jev (com a probabilidade). */
  alvo_por: "nome" | "jev";
  prob_ordem: number | null;
  prob_alvo: number | null;
};

/** Minúsculas, sem acento, espaços simples (para comparar nomes citados). */
export function normalizar(t: string): string {
  return String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[“”«»"]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

const VERBOS: Record<TipoDaOrdem, RegExp> = {
  pausar: /\b(pausa|pause|pausar|pausem|desliga|desligue|desligar|para de rodar|pare de rodar|parar de rodar)\b/,
  ativar: /\b(ativa|ative|ativar|reativa|reative|reativar|liga|ligue|ligar|religa|religue|despausa|despause|volta a rodar|volte a rodar|coloca no ar|coloque no ar)\b/,
  renomear: /\b(renomeia|renomeie|renomear|renomeiem|(muda|mude|mudar|troca|troque|trocar|altera|altere|alterar) o nome)\b/,
  orcamento: /\b(verba|orcamento|budget)\b/,
};

/** A mensagem tem cara de ordem direta e curta? (só um filtro barato antes do Jev; quem decide é o Jev) */
export function pareceOrdemDireta(mensagem: string): boolean {
  const t = normalizar(mensagem);
  if (!t || t.length > 600) return false;
  const tipos = (Object.keys(VERBOS) as TipoDaOrdem[]).filter((k) => VERBOS[k].test(t));
  if (!tipos.length) return false;
  if (tipos.length === 1 && tipos[0] === "orcamento" && !/\d/.test(t)) return false;
  return true;
}

/** Trechos entre aspas (retas, curvas ou simples), na ordem em que aparecem. */
export function trechosEntreAspas(mensagem: string): string[] {
  const saida: string[] = [];
  const re = /"([^"]{2,260})"|“([^”]{2,260})”|'([^']{2,260})'|‘([^’]{2,260})’/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(mensagem))) {
    const t = (m[1] || m[2] || m[3] || m[4] || "").trim();
    if (t) saida.push(t);
  }
  return saida;
}

const ID = /^[0-9]{3,30}$/;

/**
 * Candidatos da conta com apelido (c1 campanhas, g1 conjuntos, n1 anúncios) e o alvo direto quando o
 * nome citado casa com um item só (aspas iguais ao nome, ou o nome mais longo contido na mensagem).
 * A palavra do nível ("campanha", "conjunto", "anúncio") restringe quando aparece.
 */
export function candidatosDaOrdem(
  mensagem: string,
  conta: {
    campanhas: { id: string; nome: string | null; status: string | null }[];
    conjuntos: { id: string; nome: string | null; campanha: string | null }[];
    anuncios: { id: string; nome: string | null; status: string | null; campanha: string | null }[];
  },
  maximo = 150,
): { candidatos: CandidatoDaOrdem[]; direto: CandidatoDaOrdem | null; iguais: CandidatoDaOrdem[] } {
  const t = normalizar(mensagem);
  const niveis: NivelDaOrdem[] = [];
  if (/\bcampanhas?\b/.test(t)) niveis.push("campanha");
  if (/\bconjuntos?\b/.test(t)) niveis.push("conjunto");
  if (/\banuncios?\b/.test(t)) niveis.push("anuncio");
  const todos: CandidatoDaOrdem[] = [];
  conta.campanhas.filter((c) => ID.test(c.id)).forEach((c, i) => todos.push({ ref: `c${i + 1}`, nivel: "campanha", meta_id: c.id, nome: String(c.nome || `Campanha ${c.id}`), status: c.status, campanha: null }));
  conta.conjuntos.filter((c) => ID.test(c.id)).forEach((c, i) => todos.push({ ref: `g${i + 1}`, nivel: "conjunto", meta_id: c.id, nome: String(c.nome || `Conjunto ${c.id}`), status: null, campanha: c.campanha }));
  conta.anuncios.filter((c) => ID.test(c.id)).forEach((c, i) => todos.push({ ref: `n${i + 1}`, nivel: "anuncio", meta_id: c.id, nome: String(c.nome || `Anúncio ${c.id}`), status: c.status, campanha: c.campanha }));
  const doNivel = niveis.length ? todos.filter((c) => niveis.indexOf(c.nivel) >= 0) : todos;

  // Alvo direto: aspas iguais ao nome (um só), senão o nome mais longo contido na mensagem (único).
  const aspas = trechosEntreAspas(mensagem).map(normalizar);
  const pelasAspas = doNivel.filter((c) => aspas.indexOf(normalizar(c.nome)) >= 0);
  let direto: CandidatoDaOrdem | null = pelasAspas.length === 1 ? pelasAspas[0] : null;
  // Frente AD (teste real 28/09): duas campanhas com o MESMO nome. Não é incerteza do Jev: é escolha do dono.
  let iguais: CandidatoDaOrdem[] = pelasAspas.length > 1 && mesmoNome(pelasAspas) ? pelasAspas : [];
  if (!direto && !pelasAspas.length) {
    const contidos = doNivel.filter((c) => normalizar(c.nome).length >= 5 && t.indexOf(normalizar(c.nome)) >= 0);
    if (contidos.length) {
      const maior = Math.max(...contidos.map((c) => normalizar(c.nome).length));
      const maiores = contidos.filter((c) => normalizar(c.nome).length === maior);
      if (maiores.length === 1) direto = maiores[0];
      else if (mesmoNome(maiores)) iguais = maiores;
    }
  }

  // Para o Jev: os mais parecidos primeiro (palavras do nome que aparecem na mensagem).
  const palavras = new Set(t.split(/[^a-z0-9]+/).filter((p) => p.length >= 3));
  const nota = (c: CandidatoDaOrdem) => {
    const n = normalizar(c.nome);
    const ps = n.split(/[^a-z0-9]+/).filter((p) => p.length >= 3);
    const comuns = ps.filter((p) => palavras.has(p)).length;
    return (t.indexOf(n) >= 0 ? 100 : 0) + comuns * 3 + (ps.length ? comuns / ps.length : 0);
  };
  const candidatos = doNivel.slice().sort((a, b) => nota(b) - nota(a)).slice(0, maximo);
  if (direto && candidatos.indexOf(direto) < 0) candidatos.unshift(direto);
  for (const c of iguais) if (candidatos.indexOf(c) < 0) candidatos.unshift(c);
  return { candidatos, direto, iguais: iguais.slice(0, MAX_OPCOES) };
}

/** No máximo tantas opções na pergunta "qual?" (mais que isso, a equipe cita melhor). */
export const MAX_OPCOES = 5;

const mesmoNome = (lista: CandidatoDaOrdem[]) => lista.length > 1 && lista.every((c) => c.nivel === lista[0].nivel && normalizar(c.nome) === normalizar(lista[0].nome));

/**
 * Itens da conta citados pelo nome na mensagem (todos, inclusive pausados e encerrados): nome inteiro
 * contido na mensagem (5+ letras) ou igual a um trecho entre aspas. Vão primeiro nos alvos do agente
 * (teste real: "a campanha não aparece nos alvos disponíveis" porque estava pausada fora do período).
 */
export function citadosNaMensagem<T extends { nome: string | null }>(mensagem: string, itens: T[]): T[] {
  const t = normalizar(mensagem);
  const aspas = trechosEntreAspas(mensagem).map(normalizar);
  return itens.filter((i) => {
    const n = normalizar(String(i.nome || ""));
    return n.length >= 5 && (t.indexOf(n) >= 0 || aspas.indexOf(n) >= 0);
  });
}

/** O primeiro trecho entre aspas que não casou com nenhum item conhecido (para buscar na Meta pelo nome). */
export function trechoParaBuscarNaMeta(mensagem: string, nomesConhecidos: string[]): string | null {
  const conhecidos = nomesConhecidos.map(normalizar);
  const t = trechosEntreAspas(mensagem).filter((x) => x.replace(/^(\.\.\.|…)/, "").trim().length >= 4 && !/^(\.\.\.|…)/.test(x.trim()))[0];
  if (!t) return null;
  return conhecidos.indexOf(normalizar(t)) >= 0 ? null : t.slice(0, 200);
}

/**
 * Nome novo pedido: o trecho entre aspas que não é o nome atual (o último); sem aspas, o que vem
 * depois do último " para ". "..." no começo quer dizer o nome atual ("... (teste painel)").
 */
export function nomeNovoDaMensagem(mensagem: string, nomeAtual: string): string | null {
  const atual = normalizar(nomeAtual);
  const expandir = (s: string) => {
    const x = s.trim().replace(/[.;!]+$/, "").trim();
    const m = /^(\.\.\.|…)\s*(.*)$/.exec(x);
    return m ? `${nomeAtual.trim()} ${m[2]}`.trim() : x;
  };
  const aspas = trechosEntreAspas(mensagem).filter((s) => normalizar(s) !== atual);
  let novo = aspas.length ? expandir(aspas[aspas.length - 1]) : "";
  if (!novo) {
    const i = mensagem.toLowerCase().lastIndexOf(" para ");
    if (i >= 0) novo = expandir(mensagem.slice(i + 6).replace(/^["'“‘]|["'”’]$/g, ""));
  }
  novo = novo.replace(/\s+/g, " ").replace(/[–—]/g, "-").trim();
  if (!novo || novo.length < 2 || novo.length > 250 || normalizar(novo) === atual) return null;
  return novo;
}

/** Valor em reais pedido para a verba ("para R$ 40", "40 reais", "R$ 1.234,50"); o último número depois de "para" vale. */
export function valorDaMensagem(mensagem: string): number | null {
  const t = mensagem.replace(/\s+/g, " ");
  const i = t.toLowerCase().lastIndexOf(" para ");
  const trecho = i >= 0 ? t.slice(i) : t;
  const m = /(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?:\s*(?:reais|brl))?/i.exec(trecho);
  if (!m) return null;
  const bruto = m[1];
  const n = /\.\d{3}/.test(bruto) ? Number(bruto.replace(/\./g, "").replace(",", ".")) : Number(bruto.replace(",", "."));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

const STATUS_LEGIVEL: Record<string, string> = { ACTIVE: "ativa", PAUSED: "pausada", ARCHIVED: "arquivada", DELETED: "excluída" };
const NIVEL_LEGIVEL: Record<NivelDaOrdem, string> = { campanha: "campanha", conjunto: "conjunto", anuncio: "anúncio" };

/** As perguntas ao Jev: a ordem (sempre) e o item (só quando o nome não casou sozinho). */
export function perguntasDaOrdem(candidatos: CandidatoDaOrdem[], comAlvo: boolean): Record<string, PerguntaJev> {
  const q: Record<string, PerguntaJev> = {
    ordem: {
      type: "choice",
      instructions: "A `mensagem_da_equipe` foi escrita para o gestor de tráfego. Ela é UMA ordem direta sobre UM item da conta de anúncios? Qual?",
      criteria: {
        pausar: "Manda pausar, desligar ou parar de rodar um item.",
        ativar: "Manda ativar, ligar, reativar ou colocar no ar um item.",
        renomear: "Manda trocar o nome de um item.",
        mudar_verba: "Manda mudar a verba ou o orçamento diário de um item para um valor.",
        outra: "Qualquer outra coisa: pergunta, pedido de análise ou de opinião, mais de uma ação, condição (\"se estiver caro, pausa\"), ação sem item claro, ou algo diferente dessas quatro.",
      },
    },
  };
  if (comAlvo) {
    const criteria: Record<string, string> = {};
    for (const c of candidatos) criteria[c.ref] = `${NIVEL_LEGIVEL[c.nivel]} "${c.nome}"${c.status && STATUS_LEGIVEL[c.status] ? ` (${STATUS_LEGIVEL[c.status]})` : ""}${c.campanha ? `, da campanha "${c.campanha}"` : ""}`;
    criteria.nenhum = "Nenhum item da lista, a mensagem cita mais de um item, ou não dá para saber qual.";
    q.alvo = {
      type: "choice",
      instructions: "Qual item da conta de anúncios (lista em `itens`) a `mensagem_da_equipe` manda mudar? Escolha pelo nome e pelo nível (campanha, conjunto ou anúncio) citados na mensagem.",
      criteria,
    };
  }
  return q;
}

const TIPO_DA_ESCOLHA: Record<string, TipoDaOrdem> = { pausar: "pausar", ativar: "ativar", renomear: "renomear", mudar_verba: "orcamento" };

/** Probabilidade da opção escolhida (ou null). */
const probDa = (r: RespostaJev | undefined) => (r && r.choice && r.probabilities && typeof r.probabilities[r.choice] === "number" ? r.probabilities[r.choice] : null);

/**
 * Decide com as respostas do Jev e o que o código tirou da mensagem. Devolve a ordem pronta, ou o
 * motivo de seguir pelo caminho do modelo (análise completa). Limiares: 0,8 na ordem e 0,75 no item.
 */
export type EscolhaDeAlvo = { tipo: TipoDaOrdem; opcoes: CandidatoDaOrdem[]; nome_novo: string | null; orcamento_diario_brl: number | null };

export function decidirOrdem(
  mensagem: string,
  respostas: Record<string, RespostaJev>,
  candidatos: CandidatoDaOrdem[],
  direto: CandidatoDaOrdem | null,
  limiares = { ordem: 0.8, alvo: 0.75 },
  iguais: CandidatoDaOrdem[] = [],
): { ordem: OrdemResolvida } | { escolher: EscolhaDeAlvo } | { motivo: string; eh_acao: boolean } {
  const o = respostas.ordem;
  const tipo = o && o.choice ? TIPO_DA_ESCOLHA[o.choice] : undefined;
  const pOrdem = probDa(o);
  if (!tipo) return { motivo: "não é uma ordem direta única", eh_acao: false };
  if (pOrdem === null || pOrdem < limiares.ordem) return { motivo: `ordem incerta (${pOrdem === null ? "sem probabilidade" : Math.round(pOrdem * 100) + "%"})`, eh_acao: false };
  // Daqui para baixo é uma ação clara: se ainda cair no modelo, ele pode pensar mais leve.
  let alvo = direto;
  let pAlvo: number | null = null;
  let opcoes: CandidatoDaOrdem[] = iguais.length > 1 ? iguais : [];
  if (!alvo && !opcoes.length) {
    const a = respostas.alvo;
    pAlvo = probDa(a);
    const escolhido = a && a.choice && a.choice !== "nenhum" ? candidatos.filter((c) => c.ref === a.choice)[0] : undefined;
    if (!escolhido) return { motivo: "item não identificado", eh_acao: true };
    // Nomes iguais dividem a probabilidade entre si: soma o grupo; a escolha fica com a equipe.
    const doMesmoNome = candidatos.filter((c) => c.nivel === escolhido.nivel && normalizar(c.nome) === normalizar(escolhido.nome));
    const pGrupo = doMesmoNome.reduce((soma, c) => soma + ((a && a.probabilities && typeof a.probabilities[c.ref] === "number") ? a.probabilities[c.ref] : 0), 0);
    if (doMesmoNome.length > 1 && pGrupo >= limiares.alvo) opcoes = doMesmoNome.slice(0, MAX_OPCOES);
    else if (pAlvo === null || pAlvo < limiares.alvo) return { motivo: `item incerto (${pAlvo === null ? "sem probabilidade" : Math.round(pAlvo * 100) + "%"})`, eh_acao: true };
    else alvo = escolhido;
  }
  if (!alvo) {
    const base = opcoes[0];
    const nomeNovo = tipo === "renomear" ? nomeNovoDaMensagem(mensagem, base.nome) : null;
    if (tipo === "renomear" && !nomeNovo) return { motivo: "nome novo não encontrado na mensagem", eh_acao: true };
    const valorPedido = tipo === "orcamento" ? valorDaMensagem(mensagem) : null;
    if (tipo === "orcamento" && (base.nivel === "anuncio" || valorPedido === null)) return { motivo: "valor da verba não encontrado na mensagem", eh_acao: true };
    return { escolher: { tipo, opcoes, nome_novo: nomeNovo, orcamento_diario_brl: valorPedido } };
  }
  let nomeNovo: string | null = null;
  let valor: number | null = null;
  if (tipo === "renomear") {
    nomeNovo = nomeNovoDaMensagem(mensagem, alvo.nome);
    if (!nomeNovo) return { motivo: "nome novo não encontrado na mensagem", eh_acao: true };
  }
  if (tipo === "orcamento") {
    if (alvo.nivel === "anuncio") return { motivo: "verba de anúncio não existe (fica no conjunto ou na campanha)", eh_acao: true };
    valor = valorDaMensagem(mensagem);
    if (valor === null) return { motivo: "valor da verba não encontrado na mensagem", eh_acao: true };
  }
  return { ordem: { tipo, alvo, nome_novo: nomeNovo, orcamento_diario_brl: valor, alvo_por: direto ? "nome" : "jev", prob_ordem: pOrdem, prob_alvo: pAlvo } };
}
