/**
 * Ações que o diretor do Estúdio propõe sobre o trabalho aberto (dono, 25/09
 * à noite: "organize o fluxo das cards, os carrosséis... se eu pedir para o
 * agente, ele confirma comigo, vai lá e faz tudo certinho"). Contrato comum em
 * ../_shared/acoes-do-agente.ts: apelidos (t1 = o trabalho, l1..lN = as
 * lâminas pela ordem), a lista exata no anexo "acao_agente", e só a
 * confirmação executa (executar_acao_agente em index.ts).
 *
 * Operações:
 * - reordenar (t1, para "3,1,2"): nova ordem das lâminas; a primeira vira capa
 *   e a última o fechamento; as artes acompanham a lâmina. Travada no
 *   carrossel contínuo (a cena atravessa as lâminas).
 * - mudar_formato (t1, para "4:5" | "3:4" | "1:1" | "9:16"): o formato do post;
 *   as versões já geradas ficam, e a entrega pede refazer as que não estão nele.
 * - trocar_texto (lN, para "antigo => novo"): troca um trecho do texto exato da
 *   lâmina (o mesmo ajuste em várias lâminas). Nada de texto inventado: o
 *   trecho antigo precisa existir na lâmina.
 * - arquivar_versoes (lN): as versões antigas da lâmina saem da lista e ficam
 *   guardadas em direcao.versoes_arquivadas (nenhum arquivo é apagado).
 * - refazer (lN): gera a lâmina de novo pelo caminho de sempre (a tela chama
 *   gerar_card, com o custo mostrado antes). O prompt da lâmina não muda.
 *
 * Travas: trabalho entregue ou agendado não muda por aqui (reabra antes);
 * anúncio não muda de formato (é escolhido na Mesa Ads).
 *
 * Sem import de Deno: os testes (vitest) leem este arquivo.
 */
import {
  type AcaoDoAgente,
  type AlvoComApelido,
  blocoDosAlvos,
  esquemaDasAcoes,
  type ItemDaAcaoDoAgente,
  normalizarAcaoDoAgente,
  regraDasAcoes,
  type RegraDaOperacao,
} from "../_shared/acoes-do-agente.ts";
import { blocosDoTexto, FORMATOS_DO_POST, QUADRO_DO_POST, type FormatoDoPost } from "../_shared/direcao-arte.ts";

export const OPERACOES_DO_DIRETOR = ["reordenar", "mudar_formato", "trocar_texto", "arquivar_versoes", "refazer"];

export const ESQUEMA_DAS_ACOES_DO_DIRETOR = esquemaDasAcoes(OPERACOES_DO_DIRETOR);

/** O mínimo do trabalho que as ações leem (o tipo completo mora em index.ts). */
export type LaminaDoTrabalho = { ordem: number; funcao?: string; texto_exato?: string; blocos?: unknown };
export type VersaoDoTrabalho = { ordem: number; versao: number; [k: string]: unknown };
export type TrabalhoParaAcoes = {
  id: string;
  status: string;
  entrega_status?: string | null;
  tipo?: string | null;
  direcao: { cards: LaminaDoTrabalho[]; carrossel_infinito?: boolean; formato?: string; versoes_arquivadas?: VersaoDoTrabalho[]; [k: string]: unknown };
  cards: VersaoDoTrabalho[];
};

type DadosDoAlvo = { tipo: "trabalho" | "lamina"; ordem?: number; texto?: string; versoes?: number };
export type AlvoDoDiretor = { id: string; titulo: string; detalhe?: string | null; dados: DadosDoAlvo };

const entregue = (t: Pick<TrabalhoParaAcoes, "status" | "entrega_status">) => t.status === "entregue" || t.entrega_status === "agendado";
export const MOTIVO_ENTREGUE = "O trabalho já foi entregue ou agendado. Reabra o trabalho antes de mudar.";
export const MOTIVO_CONTINUO = "No carrossel contínuo a cena atravessa as lâminas: a ordem fica travada.";

const umaLinha = (v: unknown, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** t1 é o trabalho; l{ordem} é cada lâmina (l3 = lâmina 3). */
export function alvosDoTrabalho(t: TrabalhoParaAcoes): Array<AlvoComApelido<AlvoDoDiretor>> {
  const laminas = t.direcao.cards.slice().sort((a, b) => a.ordem - b.ordem);
  const formato = FORMATOS_DO_POST.indexOf(t.direcao.formato as FormatoDoPost) >= 0 ? QUADRO_DO_POST[t.direcao.formato as FormatoDoPost].proporcao : "4:5";
  const alvos: Array<AlvoComApelido<AlvoDoDiretor>> = [
    {
      ref: "t1",
      id: t.id,
      titulo: "Este trabalho",
      detalhe: `${laminas.length} ${laminas.length === 1 ? "lâmina" : "lâminas"} · formato ${formato}${t.direcao.carrossel_infinito ? " · carrossel contínuo" : ""}`,
      dados: { tipo: "trabalho" },
    },
  ];
  for (const c of laminas) {
    const versoes = t.cards.filter((v) => v.ordem === c.ordem).length;
    alvos.push({
      ref: `l${c.ordem}`,
      id: String(c.ordem),
      titulo: `Lâmina ${c.ordem}${c.funcao ? ` (${c.funcao})` : ""}`,
      detalhe: `${versoes} ${versoes === 1 ? "versão" : "versões"} · texto: ${umaLinha(c.texto_exato, 120) || "sem texto"}`,
      dados: { tipo: "lamina", ordem: c.ordem, texto: String(c.texto_exato ?? ""), versoes },
    });
  }
  return alvos;
}

/** Proporção pedida ("4:5", "9:16", "stories"...) para o formato do post. Null quando não existe. */
export function formatoPedido(v: unknown): FormatoDoPost | null {
  const s = String(v ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (FORMATOS_DO_POST.indexOf(s as FormatoDoPost) >= 0) return s as FormatoDoPost;
  const mapa: Record<string, FormatoDoPost> = {
    "4:5": "feed_4x5", "4x5": "feed_4x5", feed: "feed_4x5",
    "3:4": "retrato_3x4", "3x4": "retrato_3x4", retrato: "retrato_3x4",
    "1:1": "quadrado_1x1", "1x1": "quadrado_1x1", quadrado: "quadrado_1x1",
    "9:16": "stories_9x16", "9x16": "stories_9x16", stories: "stories_9x16", story: "stories_9x16", reels: "stories_9x16",
  };
  return mapa[s] || null;
}

/**
 * Nova ordem pedida ("3,1,2" ou "l3, l1, l2"): as lâminas citadas vêm primeiro,
 * nessa ordem, e as outras seguem na ordem de hoje. Null quando repete, cita
 * lâmina que não existe ou não muda nada.
 */
export function ordemPedida(v: unknown, ordens: number[]): number[] | null {
  const partes = String(v ?? "").split(/[,;\s]+/).map((p) => p.replace(/^l/i, "")).filter(Boolean);
  if (!partes.length) return null;
  const citadas: number[] = [];
  for (const p of partes) {
    const n = Number(p);
    if (!Number.isInteger(n) || ordens.indexOf(n) < 0 || citadas.indexOf(n) >= 0) return null;
    citadas.push(n);
  }
  const atual = ordens.slice().sort((a, b) => a - b);
  const nova = citadas.concat(atual.filter((o) => citadas.indexOf(o) < 0));
  return nova.join(",") === atual.join(",") ? null : nova;
}

/** "antigo => novo" em partes. Null quando não tem as duas. */
export function trocaPedida(v: unknown): { de: string; para: string } | null {
  const s = String(v ?? "");
  const i = s.indexOf("=>");
  if (i < 0) return null;
  const de = s.slice(0, i).trim();
  const para = s.slice(i + 2).trim();
  if (!de || de === para || de.length > 400 || para.length > 400) return null;
  return { de, para };
}

/** Regras das operações para este trabalho (as travas leem o trabalho). */
export function regrasDoDiretor(t: TrabalhoParaAcoes): Record<string, RegraDaOperacao<AlvoDoDiretor>> {
  const ordens = t.direcao.cards.map((c) => c.ordem);
  const continuo = !!t.direcao.carrossel_infinito && ordens.length > 1 && t.tipo !== "ads";
  const travaGeral = () => (entregue(t) ? MOTIVO_ENTREGUE : null);
  return {
    reordenar: {
      rotulo: "reordenar",
      alvos: ["t"],
      para: (bruto) => {
        const nova = ordemPedida(bruto, ordens);
        return nova ? nova.join(",") : null;
      },
      trava: () => travaGeral() || (continuo ? MOTIVO_CONTINUO : null),
    },
    mudar_formato: {
      rotulo: "mudar formato",
      alvos: ["t"],
      para: (bruto) => {
        const f = formatoPedido(bruto);
        const atual = FORMATOS_DO_POST.indexOf(t.direcao.formato as FormatoDoPost) >= 0 ? t.direcao.formato : "feed_4x5";
        return f && f !== atual ? f : null;
      },
      trava: () => travaGeral() || (t.tipo === "ads" ? "O formato do criativo de anúncio é escolhido na Mesa Ads." : null),
    },
    trocar_texto: {
      rotulo: "trocar texto",
      combina: true,
      alvos: ["l"],
      para: (bruto, alvo) => {
        const troca = trocaPedida(bruto);
        if (!troca || String(alvo.dados.texto ?? "").indexOf(troca.de) < 0) return null;
        return `${troca.de} => ${troca.para}`;
      },
      trava: travaGeral,
    },
    arquivar_versoes: {
      rotulo: "arquivar versões antigas",
      combina: true,
      alvos: ["l"],
      trava: (alvo) => travaGeral() || (Number(alvo.dados.versoes || 0) < 2 ? "Esta lâmina só tem a versão atual." : null),
    },
    refazer: {
      rotulo: "refazer",
      combina: true,
      alvos: ["l"],
      trava: travaGeral,
    },
  };
}

/**
 * Proposta do diretor a partir do campo `acoes` da resposta. Reordenar junto
 * com ações nas lâminas não entra (a ordem mudaria no meio): fica em ignorados.
 */
export function normalizarAcoesDoDiretor(bruto: unknown, t: TrabalhoParaAcoes, id?: string): AcaoDoAgente | null {
  const alvos = alvosDoTrabalho(t);
  const regras = regrasDoDiretor(t);
  const acao = normalizarAcaoDoAgente(bruto, alvos, regras, {
    agente: "estudio",
    id: id || `estudio-${Date.now().toString(36)}`,
    contexto: { trabalho_id: t.id },
    semDesfazer: (lista) => lista.length > 0 && lista.every((i) => i.operacao === "refazer"),
    rotuloDoPara: (op, para) => (op === "mudar_formato" && para ? QUADRO_DO_POST[para as FormatoDoPost]?.proporcao ?? null : op === "reordenar" && para ? `nova ordem ${para}` : null),
  });
  if (!acao) return null;
  const temLamina = acao.itens.some((i) => i.operacao !== "reordenar" && i.operacao !== "mudar_formato");
  if (temLamina && acao.itens.some((i) => i.operacao === "reordenar")) {
    acao.ignorados.push(...acao.itens.filter((i) => i.operacao === "reordenar").map((i) => i.ref));
    acao.itens = acao.itens.filter((i) => i.operacao !== "reordenar");
  }
  // Troca de texto antes de refazer: a lâmina nova já sai com o texto novo.
  const peso: Record<string, number> = { trocar_texto: 0, arquivar_versoes: 1, mudar_formato: 2, reordenar: 3, refazer: 4 };
  acao.itens.sort((a, b) => (peso[a.operacao] ?? 9) - (peso[b.operacao] ?? 9));
  if (!acao.itens.length && !acao.recusados.length) return null;
  // Só refazer (gerar de novo): não tem volta; a tela avisa antes.
  if (acao.itens.length && acao.itens.every((i) => i.operacao === "refazer")) acao.sem_desfazer = true;
  else delete acao.sem_desfazer;
  return acao;
}

/** Bloco do prompt com os alvos e a regra das ações do diretor. */
export function blocoDasAcoesDoDiretor(t: TrabalhoParaAcoes): string {
  return `${blocoDosAlvos("ITENS QUE VOCÊ PODE MEXER NESTE TRABALHO", alvosDoTrabalho(t))}
${regraDasAcoes({
    reordenar: 'ref t1; para com a nova ordem das lâminas pelos números de hoje, separados por vírgula ("3,1,2"). A primeira vira capa e a última o fechamento.',
    mudar_formato: 'ref t1; para "4:5", "3:4", "1:1" ou "9:16".',
    trocar_texto: 'ref de cada lâmina; para "trecho antigo => trecho novo" (o trecho antigo exatamente como está no texto da lâmina). Serve para o mesmo ajuste em várias lâminas.',
    arquivar_versoes: "ref da lâmina; tira as versões antigas da lista (ficam guardadas). para vazio.",
    refazer: "ref de cada lâmina a gerar de novo pelo caminho de sempre (tem custo, mostrado antes). para vazio.",
  })}
- Mudança de estilo, cenário, luz, cores ou composição continua em mudancas; acoes é para organizar e executar.`;
}

// ------------------------------------------------------------------ execução (puro: devolve o patch)

/** Nova direção e versões depois de reordenar (mesma regra da tela: capa, conteúdo, fechamento). */
export function reordenarTrabalho(t: TrabalhoParaAcoes, nova: number[]) {
  const mapa: Record<number, number> = {};
  nova.forEach((antiga, i) => { mapa[antiga] = i + 1; });
  const total = nova.length;
  const cards = t.direcao.cards
    .map((c) => {
      const ordem = mapa[c.ordem] || c.ordem;
      const funcao = ordem === 1 ? "capa" : ordem === total && total > 1 ? "cta" : "conteudo";
      return { ...c, ordem, funcao };
    })
    .sort((a, b) => a.ordem - b.ordem);
  const versoes = t.cards.map((v) => ({ ...v, ordem: mapa[v.ordem] || v.ordem }));
  return { direcao: { ...t.direcao, cards }, cards: versoes };
}

/** A ordem de antes, para desfazer: inverte o mapa. */
export function ordemInversa(nova: number[]): number[] {
  // nova[i] = ordem antiga que foi para a posição i+1. Para voltar, a lâmina que está em k+1 volta para nova[k].
  const inversa: number[] = [];
  nova.forEach((antiga, i) => { inversa[antiga - 1] = i + 1; });
  return inversa;
}

/** Troca o trecho no texto e refaz os blocos. Lança quando o trecho não está mais lá. */
export function trocarTextoDaLamina(t: TrabalhoParaAcoes, ordem: number, troca: string) {
  const p = trocaPedida(troca);
  if (!p) throw new Error("Troca de texto inválida.");
  const card = t.direcao.cards.find((c) => c.ordem === ordem);
  if (!card) throw new Error(`A lâmina ${ordem} não existe mais.`);
  const antes = String(card.texto_exato ?? "");
  if (antes.indexOf(p.de) < 0) throw new Error("O trecho não está mais no texto desta lâmina.");
  const novo = antes.split(p.de).join(p.para);
  const cards = t.direcao.cards.map((c) => (c.ordem === ordem ? { ...c, texto_exato: novo, blocos: blocosDoTexto(novo, String(c.funcao || "conteudo")) } : c));
  return { patch: { direcao: { ...t.direcao, cards } }, antes: { texto_exato: antes, blocos: card.blocos ?? null } };
}

/** Tira as versões antigas da lâmina (fica a atual) e guarda em direcao.versoes_arquivadas. */
export function arquivarVersoesDaLamina(t: TrabalhoParaAcoes, ordem: number) {
  const daLamina = t.cards.filter((v) => v.ordem === ordem);
  if (daLamina.length < 2) throw new Error("Esta lâmina só tem a versão atual.");
  const atual = daLamina.reduce((a, b) => (b.versao > a.versao ? b : a));
  const saem = daLamina.filter((v) => v !== atual);
  const guardadas = Array.isArray(t.direcao.versoes_arquivadas) ? t.direcao.versoes_arquivadas : [];
  return {
    patch: { cards: t.cards.filter((v) => v.ordem !== ordem || v === atual), direcao: { ...t.direcao, versoes_arquivadas: guardadas.concat(saem) } },
    versoes: saem.map((v) => v.versao),
  };
}

/** Devolve as versões arquivadas de uma lâmina (desfazer). */
export function devolverVersoesDaLamina(t: TrabalhoParaAcoes, ordem: number, versoes: number[]) {
  const guardadas = Array.isArray(t.direcao.versoes_arquivadas) ? t.direcao.versoes_arquivadas : [];
  const voltam = guardadas.filter((v) => v.ordem === ordem && versoes.indexOf(v.versao) >= 0);
  const ficam = guardadas.filter((v) => !(v.ordem === ordem && versoes.indexOf(v.versao) >= 0));
  const existentes = new Set(t.cards.filter((v) => v.ordem === ordem).map((v) => v.versao));
  return { cards: t.cards.concat(voltam.filter((v) => !existentes.has(v.versao))), direcao: { ...t.direcao, versoes_arquivadas: ficam } };
}

/** Ordens das lâminas que a tela deve gerar de novo depois de confirmar (o que deu certo). */
export function ordensParaGerarDeNovo(acao: Pick<AcaoDoAgente, "itens" | "resultados">): number[] {
  const ok = new Set((acao.resultados || []).filter((r) => r.ok && r.operacao === "refazer").map((r) => r.ref));
  return acao.itens.filter((i: ItemDaAcaoDoAgente) => i.operacao === "refazer" && ok.has(i.ref)).map((i) => Number(i.alvo_id)).filter((n) => Number.isInteger(n));
}
