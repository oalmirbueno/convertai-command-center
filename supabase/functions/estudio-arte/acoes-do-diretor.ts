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
 * Frente RO, fase 2 (29/09, dono: "o agente diretor do Estúdio tem que ser
 * agêntico e completo com base no que converso com ele"): mais operações e a
 * regra de quando faz direto.
 * - Sem custo e com Desfazer (`direta`, feitas na hora quando o pedido é uma
 *   ordem clara, pelo contrato de ../_shared/acoes-do-agente.ts):
 *   aplicar_mudanca (as mudanças da conversa: texto, cor, cena, foto, uso do
 *   rosto), trocar_texto, reordenar, mudar_formato, mudar_qualidade,
 *   arquivar_versoes, tirar_lamina, duplicar_lamina, trocar_logo e
 *   tirar_referencias.
 * - Com custo ou que sai para o mundo (nunca direto sem clique, exceto o
 *   ajuste de texto de custo pequeno numa ordem clara): ajustar_texto,
 *   refazer, variacoes, entregar e agendar. Viram o PLANO do diretor
 *   (diretor-agentico.ts): passos com o custo antes, andamento, Parar e a
 *   prova no fim, pelos caminhos de sempre da tela (gerar, conferir, entregar,
 *   Agendar do Estúdio).
 *
 * Sem import de Deno: os testes (vitest) leem este arquivo.
 */
import {
  type AcaoDoAgente,
  type AlvoComApelido,
  blocoDosAlvos,
  anexosComCaminho,
  type CaminhoDoAgente,
  comCaminho,
  esquemaDasAcoes,
  type ItemDaAcaoDoAgente,
  normalizarAcaoDoAgente,
  regraDasAcoes,
  type RegraDaOperacao,
} from "../_shared/acoes-do-agente.ts";
import { blocosDoTexto, FORMATOS_DO_POST, QUADRO_DO_POST, type FormatoDoPost } from "../_shared/direcao-arte.ts";
import { caminhoDaResposta, caminhoNaArea, pedeParaAbrir, pedeParaLevar } from "../_shared/mapa-do-painel.ts";

export const OPERACOES_DO_DIRETOR = [
  "reordenar", "mudar_formato", "trocar_texto", "arquivar_versoes", "refazer",
  // Frente RO, fase 2.
  "mudar_qualidade", "tirar_lamina", "duplicar_lamina", "trocar_logo", "tirar_referencias",
  "ajustar_texto", "variacoes", "entregar", "agendar",
];

/** Operações feitas pela tela, com custo ou para fora do Estúdio: nunca direto (viram passos do plano). */
export const OPERACOES_COM_CUSTO = ["ajustar_texto", "refazer", "variacoes", "entregar", "agendar"];

/** Montada pelo código a partir das mudanças da conversa (o modelo não pede esta). */
export const OPERACAO_DA_MUDANCA = "aplicar_mudanca";

export const QUALIDADES_DO_DIRETOR = ["baixa", "media", "alta"];
export const LOGOS_DO_DIRETOR = ["principal", "alternativa", "auto"];
export const MAX_VARIACOES = 3;

export const ESQUEMA_DAS_ACOES_DO_DIRETOR = esquemaDasAcoes(OPERACOES_DO_DIRETOR);

/** O mínimo do trabalho que as ações leem (o tipo completo mora em index.ts). */
export type LaminaDoTrabalho = { ordem: number; funcao?: string; texto_exato?: string; blocos?: unknown; referencias_ids?: string[]; logo?: unknown; [k: string]: unknown };
export type VersaoDoTrabalho = { ordem: number; versao: number; [k: string]: unknown };
export type TrabalhoParaAcoes = {
  id: string;
  status: string;
  entrega_status?: string | null;
  tipo?: string | null;
  qualidade?: string | null;
  direcao: { cards: LaminaDoTrabalho[]; carrossel_infinito?: boolean; formato?: string; versoes_arquivadas?: VersaoDoTrabalho[]; laminas_arquivadas?: LaminaArquivada[]; [k: string]: unknown };
  cards: VersaoDoTrabalho[];
};

/** Lâmina tirada do carrossel pelo diretor (nada é apagado): volta pelo Desfazer. */
export type LaminaArquivada = { chave: string; ordem_original: number; card: LaminaDoTrabalho; versoes: VersaoDoTrabalho[]; em: string };

type DadosDoAlvo = { tipo: "trabalho" | "lamina"; ordem?: number; texto?: string; versoes?: number; referencias?: number };
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
      dados: { tipo: "lamina", ordem: c.ordem, texto: String(c.texto_exato ?? ""), versoes, referencias: Array.isArray(c.referencias_ids) ? c.referencias_ids.length : 0 },
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
      direta: true,
      para: (bruto) => {
        const nova = ordemPedida(bruto, ordens);
        return nova ? nova.join(",") : null;
      },
      trava: () => travaGeral() || (continuo ? MOTIVO_CONTINUO : null),
    },
    mudar_formato: {
      rotulo: "mudar formato",
      alvos: ["t"],
      direta: true,
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
      direta: true,
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
      direta: true,
      trava: (alvo) => travaGeral() || (Number(alvo.dados.versoes || 0) < 2 ? "Esta lâmina só tem a versão atual." : null),
    },
    refazer: {
      rotulo: "refazer",
      combina: true,
      alvos: ["l"],
      trava: travaGeral,
    },
    // Frente RO, fase 2: sem custo e com Desfazer (vão direto numa ordem clara).
    // A mudança da conversa (texto, cor, cena, foto, uso do rosto): montada pelo código, nunca pelo modelo.
    aplicar_mudanca: {
      rotulo: "aplicar",
      combina: true,
      repete: true,
      alvos: ["t", "l"],
      direta: true,
      para: (bruto) => {
        const id = String(bruto ?? "").trim();
        return /^m\d{1,3}$/.test(id) ? id : null;
      },
      trava: travaGeral,
    },
    mudar_qualidade: {
      rotulo: "mudar qualidade",
      alvos: ["t"],
      combina: true,
      direta: true,
      para: (bruto) => {
        const q = String(bruto ?? "").trim().toLowerCase().replace("é", "e").replace("média", "media");
        return QUALIDADES_DO_DIRETOR.indexOf(q) >= 0 && q !== (t.qualidade || "media") ? q : null;
      },
      trava: travaGeral,
    },
    tirar_lamina: {
      rotulo: "tirar lâmina",
      combina: false,
      alvos: ["l"],
      direta: true,
      trava: () => travaGeral() || (continuo ? MOTIVO_CONTINUO_LAMINAS : null) || (ordens.length < 2 ? "O trabalho precisa de pelo menos uma lâmina." : null),
    },
    duplicar_lamina: {
      rotulo: "duplicar lâmina",
      alvos: ["l"],
      direta: true,
      trava: () => travaGeral() || (continuo ? MOTIVO_CONTINUO_LAMINAS : null) || (ordens.length >= 10 ? "O carrossel já tem 10 lâminas." : null),
    },
    trocar_logo: {
      rotulo: "trocar logo",
      combina: true,
      alvos: ["l", "t"],
      direta: true,
      para: (bruto) => {
        const l = String(bruto ?? "").trim().toLowerCase();
        return LOGOS_DO_DIRETOR.indexOf(l) >= 0 ? l : null;
      },
      trava: travaGeral,
    },
    tirar_referencias: {
      rotulo: "tirar referências",
      combina: true,
      alvos: ["l"],
      direta: true,
      trava: (alvo) => travaGeral() || (Number(alvo.dados.referencias || 0) < 1 ? "Esta lâmina não tem referência própria (as do conjunto saem pela ferramenta Referências)." : null),
    },
    // Com custo ou para fora: viram passos do plano (Confirmar com o custo antes).
    ajustar_texto: {
      rotulo: "ajustar o texto na arte",
      combina: true,
      alvos: ["l"],
      trava: (alvo) => travaGeral() || (Number(alvo.dados.versoes || 0) < 1 ? "Esta lâmina ainda não tem arte: gere antes." : null),
    },
    variacoes: {
      rotulo: "gerar variações",
      combina: true,
      alvos: ["l"],
      para: (bruto) => {
        const n = Math.round(Number(String(bruto ?? "").replace(/[^0-9]/g, "")) || 2);
        return String(Math.max(1, Math.min(MAX_VARIACOES, n)));
      },
      trava: travaGeral,
    },
    entregar: {
      rotulo: "mandar para a entrega",
      alvos: ["t"],
      combina: true,
      trava: () => travaGeral() || (t.cards.length < 1 ? "Gere as lâminas antes de entregar." : null),
    },
    agendar: {
      rotulo: "agendar",
      alvos: ["t"],
      combina: true,
      trava: () => (t.tipo === "ads" ? "O criativo de anúncio sobe pela Mesa Ads." : t.status !== "entregue" ? "Entregue o trabalho antes de agendar (peça \"entrega e agenda\")." : null),
    },
  };
}

export const MOTIVO_CONTINUO_LAMINAS = "No carrossel contínuo a cena atravessa as lâminas: tirar ou duplicar lâmina fica travado.";

/**
 * Separa a proposta em duas: o que o diretor faz sem custo (vai direto numa
 * ordem clara, com Desfazer) e os passos com custo ou que saem para o mundo
 * (o plano, com Confirmar e o custo antes).
 */
export function separarDoPlano(acao: AcaoDoAgente | null): { livre: AcaoDoAgente | null; comCusto: ItemDaAcaoDoAgente[] } {
  if (!acao) return { livre: null, comCusto: [] };
  const comCusto = acao.itens.filter((i) => OPERACOES_COM_CUSTO.indexOf(i.operacao) >= 0);
  const itens = acao.itens.filter((i) => OPERACOES_COM_CUSTO.indexOf(i.operacao) < 0);
  if (!itens.length && !acao.recusados.length) return { livre: null, comCusto };
  const livre: AcaoDoAgente = { ...acao, itens };
  delete livre.sem_desfazer;
  return { livre, comCusto };
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
  const soDoTrabalho = ["reordenar", "mudar_formato", "mudar_qualidade", "entregar", "agendar"];
  const temLamina = acao.itens.some((i) => soDoTrabalho.indexOf(i.operacao) < 0);
  if (temLamina && acao.itens.some((i) => i.operacao === "reordenar")) {
    acao.ignorados.push(...acao.itens.filter((i) => i.operacao === "reordenar").map((i) => i.ref));
    acao.itens = acao.itens.filter((i) => i.operacao !== "reordenar");
  }
  // Frente RO: tirar e duplicar lâmina mudam a numeração; com outra operação de lâmina no mesmo pedido, as
  // referências l1..lN mudariam no meio. Vale uma coisa só: essas duas ficam de fora (a equipe pede de novo).
  const mexeNaNumeracao = acao.itens.filter((i) => i.operacao === "tirar_lamina" || i.operacao === "duplicar_lamina");
  const outrasDeLamina = acao.itens.filter((i) => soDoTrabalho.indexOf(i.operacao) < 0 && i.operacao !== "tirar_lamina" && i.operacao !== "duplicar_lamina");
  if (mexeNaNumeracao.length && (outrasDeLamina.length || mexeNaNumeracao.length > 1)) {
    acao.ignorados.push(...mexeNaNumeracao.map((i) => i.ref));
    acao.itens = acao.itens.filter((i) => mexeNaNumeracao.indexOf(i) < 0);
  }
  // Troca de texto antes de refazer: a lâmina nova já sai com o texto novo. Tirar e duplicar lâmina mudam a
  // numeração: vão por último entre as sem custo (a ordem das outras já foi aplicada).
  const peso: Record<string, number> = { aplicar_mudanca: 0, trocar_texto: 0, trocar_logo: 1, tirar_referencias: 1, arquivar_versoes: 1, mudar_qualidade: 2, mudar_formato: 2, reordenar: 3, duplicar_lamina: 4, tirar_lamina: 5, ajustar_texto: 6, refazer: 7, variacoes: 8, entregar: 9, agendar: 10 };
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
    mudar_qualidade: 'ref t1; para "baixa", "media" ou "alta" (qualidade da imagem nas próximas gerações).',
    tirar_lamina: "ref da lâmina a tirar do carrossel (fica guardada; Desfazer devolve). para vazio. Sozinha no pedido.",
    duplicar_lamina: "ref da lâmina a copiar; a cópia entra logo depois dela, sem arte, para a equipe mudar o texto. para vazio. Sozinha no pedido.",
    trocar_logo: 'ref da lâmina (ou t1 para todas); para "principal", "alternativa" ou "auto" (a que contrasta com o fundo).',
    tirar_referencias: "ref da lâmina; tira as referências escolhidas só para ela (volta a seguir o conjunto). para vazio.",
    ajustar_texto: "ref da lâmina com arte; muda só a área do texto na arte depois de uma mudança de texto ou cor (custo pequeno). para vazio.",
    variacoes: 'ref da lâmina; para com quantas versões novas (1 a 3). Tem custo, mostrado antes.',
    entregar: "ref t1; manda o trabalho para a entrega (aprovação do cliente, como o botão Entregar). Pede confirmação.",
    agendar: "ref t1; abre o Agendar do Estúdio com a data sugerida (só com o trabalho entregue). Pede confirmação.",
  })}
- Mudança de estilo, cenário, luz, cores ou composição continua em mudancas; acoes é para organizar e executar.
- Quem pede com ordem clara ("faz", "muda", "tira", "troca", "aplica") vê as mudanças e as ações sem custo feitas na hora, com Desfazer; o que tem custo (refazer, variações, ajustar o texto na arte) e o que sai para o mundo (entregar, agendar) vai para a confirmação com o custo. Na resposta, diga o que fica feito e o que espera o clique.
- "A segunda", "a capa", "a do café", "a última": resolva pela ordem e pelo conteúdo de cada lâmina. "Todas": a mesma mudança em cada lâmina. "Essa aqui": a lâmina em foco. Se não der para saber qual, pergunte e não mude nada.`;
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

// ------------------------------------------------------------------ frente RO: tirar e duplicar lâmina (puro)

const funcaoNaPosicao = (ordem: number, total: number) => (ordem === 1 ? "capa" : ordem === total && total > 1 ? "cta" : "conteudo");

/** Tira a lâmina: vai para direcao.laminas_arquivadas com as versões; as de depois sobem uma posição. */
export function tirarLaminaDoTrabalho(t: TrabalhoParaAcoes, ordem: number, agora = new Date().toISOString()) {
  const card = t.direcao.cards.find((c) => c.ordem === ordem);
  if (!card) throw new Error(`A lâmina ${ordem} não existe mais.`);
  if (t.direcao.cards.length < 2) throw new Error("O trabalho precisa de pelo menos uma lâmina.");
  const total = t.direcao.cards.length - 1;
  const chave = `l${ordem}-${agora}`;
  const arquivada: LaminaArquivada = { chave, ordem_original: ordem, card, versoes: t.cards.filter((v) => v.ordem === ordem), em: agora };
  const cards = t.direcao.cards
    .filter((c) => c.ordem !== ordem)
    .map((c) => {
      const nova = c.ordem > ordem ? c.ordem - 1 : c.ordem;
      return { ...c, ordem: nova, funcao: funcaoNaPosicao(nova, total) };
    })
    .sort((a, b) => a.ordem - b.ordem);
  const versoes = t.cards.filter((v) => v.ordem !== ordem).map((v) => (v.ordem > ordem ? { ...v, ordem: v.ordem - 1 } : v));
  const guardadas = Array.isArray(t.direcao.laminas_arquivadas) ? t.direcao.laminas_arquivadas : [];
  return { patch: { direcao: { ...t.direcao, cards, laminas_arquivadas: guardadas.concat([arquivada]) }, cards: versoes }, desfazer: { chave, ordem, total_depois: total } };
}

/** Desfaz o tirar: a lâmina volta para a posição de antes, com as versões. */
export function devolverLaminaAoTrabalho(t: TrabalhoParaAcoes, chave: string, totalDepois?: number) {
  const guardadas = Array.isArray(t.direcao.laminas_arquivadas) ? t.direcao.laminas_arquivadas : [];
  const a = guardadas.find((x) => x.chave === chave);
  if (!a) throw new Error("A lâmina guardada não foi encontrada.");
  if (typeof totalDepois === "number" && t.direcao.cards.length !== totalDepois) throw new Error("As lâminas mudaram depois. Devolva pela tela.");
  const k = Math.min(a.ordem_original, t.direcao.cards.length + 1);
  const total = t.direcao.cards.length + 1;
  const cards = t.direcao.cards
    .map((c) => (c.ordem >= k ? { ...c, ordem: c.ordem + 1 } : c))
    .concat([{ ...a.card, ordem: k }])
    .map((c) => ({ ...c, funcao: funcaoNaPosicao(c.ordem, total) }))
    .sort((x, y) => x.ordem - y.ordem);
  const versoes = t.cards.map((v) => (v.ordem >= k ? { ...v, ordem: v.ordem + 1 } : v)).concat(a.versoes.map((v) => ({ ...v, ordem: k })));
  return { direcao: { ...t.direcao, cards, laminas_arquivadas: guardadas.filter((x) => x.chave !== chave) }, cards: versoes };
}

/** Duplica a lâmina: a cópia (sem arte) entra logo depois; as de depois descem uma posição. */
export function duplicarLaminaDoTrabalho(t: TrabalhoParaAcoes, ordem: number) {
  const card = t.direcao.cards.find((c) => c.ordem === ordem);
  if (!card) throw new Error(`A lâmina ${ordem} não existe mais.`);
  const total = t.direcao.cards.length + 1;
  const copia = { ...card, ordem: ordem + 1 };
  const cards = t.direcao.cards
    .map((c) => (c.ordem > ordem ? { ...c, ordem: c.ordem + 1 } : c))
    .concat([copia])
    .map((c) => ({ ...c, funcao: funcaoNaPosicao(c.ordem, total) }))
    .sort((a, b) => a.ordem - b.ordem);
  const versoes = t.cards.map((v) => (v.ordem > ordem ? { ...v, ordem: v.ordem + 1 } : v));
  return { patch: { direcao: { ...t.direcao, cards }, cards: versoes }, desfazer: { ordem: ordem + 1, total_depois: total } };
}

/** Desfaz o duplicar: tira a cópia (só enquanto ela não tem arte). */
export function tirarCopiaDoTrabalho(t: TrabalhoParaAcoes, ordemDaCopia: number, totalDepois?: number) {
  if (typeof totalDepois === "number" && t.direcao.cards.length !== totalDepois) throw new Error("As lâminas mudaram depois. Tire a cópia pela tela.");
  if (t.cards.some((v) => v.ordem === ordemDaCopia)) throw new Error("A cópia já tem arte: tire pela tela, se quiser.");
  const total = t.direcao.cards.length - 1;
  const cards = t.direcao.cards
    .filter((c) => c.ordem !== ordemDaCopia)
    .map((c) => (c.ordem > ordemDaCopia ? { ...c, ordem: c.ordem - 1 } : c))
    .map((c) => ({ ...c, funcao: funcaoNaPosicao(c.ordem, total) }))
    .sort((a, b) => a.ordem - b.ordem);
  const versoes = t.cards.map((v) => (v.ordem > ordemDaCopia ? { ...v, ordem: v.ordem - 1 } : v));
  return { direcao: { ...t.direcao, cards }, cards: versoes };
}

/** Ordens das lâminas que a tela deve gerar de novo depois de confirmar (o que deu certo). */
export function ordensParaGerarDeNovo(acao: Pick<AcaoDoAgente, "itens" | "resultados">): number[] {
  const ok = new Set((acao.resultados || []).filter((r) => r.ok && r.operacao === "refazer").map((r) => r.ref));
  return acao.itens.filter((i: ItemDaAcaoDoAgente) => i.operacao === "refazer" && ok.has(i.ref)).map((i) => Number(i.alvo_id)).filter((n) => Number.isInteger(n));
}

// ------------------------------------------------------------------ o caminho (frente AG, 27/09)

/**
 * O "Ir para" do diretor (dono, 27/09: "quando termina ele dá o caminho pra
 * mim apertar e ir"): o item no Estúdio da Mesa (aba estudio, task = o item
 * da agenda), que é onde a arte mudou. Criativo de anúncio (sem item da
 * agenda) fica sem caminho: o diretor já está ao lado dele na Mesa Ads. A
 * tela esconde o botão quando a pessoa já está nesse endereço.
 */
export function caminhoDoTrabalho(t: { client_id: string; task_id?: string | null; tipo?: string | null }, opcoes: { abrirSozinho?: boolean } = {}): CaminhoDoAgente | null {
  if (t.tipo === "ads" || !t.task_id) return null;
  return caminhoNaArea("mesa", { clientId: t.client_id, etapa: "estudio", estado: { task: t.task_id }, rotulo: "Ver no Estúdio", abrirSozinho: opcoes.abrirSozinho });
}

/**
 * Os anexos da resposta do diretor com o caminho de outra área que ele citou
 * ("Isso é na Mesa Ads (/mesa-ads)"): o botão "Abrir" fica na mensagem. Quando
 * a proposta já leva o caminho, não repete.
 */
export function anexosDaRespostaDoDiretor(anexos: unknown[], resposta: string, clientId: string, pedido: string): unknown[] {
  return anexosComCaminho(anexos, caminhoDaResposta(resposta, clientId, { abrirSozinho: pedeParaAbrir(pedido) || pedeParaLevar(pedido) }));
}

/** A proposta com o caminho do trabalho; "faz e me leva" no pedido abre sozinho depois de confirmar. */
export function comCaminhoDoDiretor(acao: AcaoDoAgente | null, t: { client_id: string; task_id?: string | null; tipo?: string | null }, pedido: string): AcaoDoAgente | null {
  return acao ? comCaminho(acao, caminhoDoTrabalho(t, { abrirSozinho: pedeParaLevar(pedido) })) : null;
}
