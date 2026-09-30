/**
 * Mesa Identidade (/mesa-identidade, frente IDV, 30/09/2026): as etapas e a
 * sequência. Pedido do dono: "estúdio sequencial desde o início, envolvente,
 * organizado e limpo".
 *
 * Início -> Briefing -> Pesquisa -> Estratégia -> Naming -> Conceito ->
 * Sistema -> Aplicações (mockups) -> Guideline -> Apresentação -> Entrega.
 * O Naming só entra quando a marca é do zero ou quando a equipe pede
 * (rebranding com troca de nome). Estratégia e Apresentação entraram na
 * frente IDV2 (30/09): projeto antigo que já fechou uma etapa depois delas
 * conta a nova como feita (ETAPAS_NOVAS), para ninguém voltar no meio.
 *
 * Regras da sequência:
 * - a etapa aberta é a primeira que ainda não foi concluída; as concluídas
 *   continuam abertas para revisar (voltar nunca apaga o que veio depois);
 * - concluir exige o mínimo da etapa (`faltaNaEtapa`): o que falta aparece na
 *   tela, nunca é inventado;
 * - pular à frente não existe: a etapa seguinte abre quando a de antes fecha.
 *
 * Puro: sem Deno, sem banco. A tela, a função e os testes usam o mesmo arquivo.
 */

import { faltaNaEstrategia } from "./estrategia-de-marca.ts";

export const ETAPAS_DA_IDENTIDADE = [
  { valor: "inicio", rotulo: "Início" },
  { valor: "briefing", rotulo: "Briefing" },
  { valor: "pesquisa", rotulo: "Pesquisa" },
  { valor: "estrategia", rotulo: "Estratégia" },
  { valor: "naming", rotulo: "Naming" },
  { valor: "conceito", rotulo: "Conceito" },
  { valor: "sistema", rotulo: "Sistema" },
  { valor: "mockups", rotulo: "Aplicações" },
  { valor: "guideline", rotulo: "Guideline" },
  { valor: "apresentacao", rotulo: "Apresentação" },
  { valor: "entrega", rotulo: "Entrega" },
] as const;

export type EtapaDaIdentidade = (typeof ETAPAS_DA_IDENTIDADE)[number]["valor"];

/**
 * Tamanhos das chamadas de IA da mesa (tokens), para a estimativa de custo
 * sair igual na tela (antes) e na função (a cobrança real vem do motor).
 */
export const TAMANHOS_DA_IDENTIDADE = {
  naming: { entrada: 3_500, saida: 3_500 },
  conceito: { entrada: 4_000, saida: 4_500 },
  pesquisa: { entrada: 3_000, saida: 3_000, buscas: 3 },
  conversa: { entrada: 6_000, saida: 1_500 },
  // Frente IDV2: estratégia inteira, 3 paletas, pares de fonte, taglines e o teste de idiomas.
  estrategia: { entrada: 8_000, saida: 5_000 },
  paletas: { entrada: 3_500, saida: 2_500 },
  fontes: { entrada: 3_000, saida: 1_800 },
  slogans: { entrada: 3_500, saida: 2_200 },
  idiomas: { entrada: 2_500, saida: 3_000 },
  // Frente IDV3: a leitura da logo por visão (uma imagem de até 800 px + o pedido).
  leitura: { entrada: 2_600, saida: 1_600 },
} as const;

/** Etapas que entraram depois (IDV2): em projeto antigo, uma etapa posterior já fechada conta a nova como feita. */
export const ETAPAS_NOVAS: EtapaDaIdentidade[] = ["estrategia", "apresentacao"];
/**
 * "completar" (frente IDV3, 30/09): marca existente que só tem logo e nome.
 * A logo não muda; o projeto completa o resto (estratégia, sistema,
 * aplicações, brandbook e apresentação). Sem Pesquisa, Naming e Conceito
 * (o nome e a logo já existem).
 */
export type ModoDoProjeto = "zero" | "rebranding" | "completar";

export const ROTULO_DO_MODO: Record<ModoDoProjeto, string> = {
  zero: "Marca do zero",
  rebranding: "Rebranding",
  completar: "Completar marca existente",
};

export function ehModoDoProjeto(v: unknown): v is ModoDoProjeto {
  return v === "zero" || v === "rebranding" || v === "completar";
}

/** Etapas que a marca existente não tem (nome e logo já existem). */
export const ETAPAS_FORA_DO_COMPLETAR: EtapaDaIdentidade[] = ["pesquisa", "naming", "conceito"];

const VALORES = ETAPAS_DA_IDENTIDADE.map((e) => e.valor) as EtapaDaIdentidade[];

export function ehEtapaDaIdentidade(v: unknown): v is EtapaDaIdentidade {
  return typeof v === "string" && VALORES.indexOf(v as EtapaDaIdentidade) >= 0;
}

export function rotuloDaEtapa(e: EtapaDaIdentidade): string {
  const achada = ETAPAS_DA_IDENTIDADE.filter((x) => x.valor === e)[0];
  return achada ? achada.rotulo : e;
}

/** O projeto, no que a sequência precisa saber. */
export type ProjetoNaSequencia = {
  modo: ModoDoProjeto;
  com_naming: boolean;
  concluidas: string[];
};

/** Naming entra na marca do zero sempre; no rebranding, só quando pedido; na marca existente, nunca. */
export function precisaDeNaming(p: Pick<ProjetoNaSequencia, "modo" | "com_naming">): boolean {
  if (p.modo === "completar") return false;
  return p.modo === "zero" || p.com_naming === true;
}

/** As etapas deste projeto, na ordem. */
export function etapasDoProjeto(p: Pick<ProjetoNaSequencia, "modo" | "com_naming">): EtapaDaIdentidade[] {
  if (p.modo === "completar") return VALORES.filter((e) => ETAPAS_FORA_DO_COMPLETAR.indexOf(e) < 0);
  return VALORES.filter((e) => e !== "naming" || precisaDeNaming(p));
}

function concluidasValidas(p: ProjetoNaSequencia): EtapaDaIdentidade[] {
  const lista = etapasDoProjeto(p);
  const brutas = (Array.isArray(p.concluidas) ? p.concluidas : []).filter((e): e is EtapaDaIdentidade => ehEtapaDaIdentidade(e) && lista.indexOf(e) >= 0);
  // Projeto de antes da IDV2: a etapa nova que ficou para trás de uma etapa já fechada conta como feita.
  const implicitas = ETAPAS_NOVAS.filter((nova) => {
    if (brutas.indexOf(nova) >= 0) return false;
    const i = lista.indexOf(nova);
    return i >= 0 && brutas.some((e) => lista.indexOf(e) > i);
  });
  return lista.filter((e) => brutas.indexOf(e) >= 0 || implicitas.indexOf(e) >= 0);
}

/** A etapa em que o projeto está: a primeira ainda não concluída (todas feitas: a Entrega). */
export function etapaAtual(p: ProjetoNaSequencia): EtapaDaIdentidade {
  const feitas = concluidasValidas(p);
  const lista = etapasDoProjeto(p);
  for (const e of lista) if (feitas.indexOf(e) < 0) return e;
  return lista[lista.length - 1];
}

export function proximaEtapa(p: Pick<ProjetoNaSequencia, "modo" | "com_naming">, de: EtapaDaIdentidade): EtapaDaIdentidade | null {
  const lista = etapasDoProjeto(p);
  const i = lista.indexOf(de);
  return i >= 0 && i < lista.length - 1 ? lista[i + 1] : null;
}

export function etapaAnterior(p: Pick<ProjetoNaSequencia, "modo" | "com_naming">, de: EtapaDaIdentidade): EtapaDaIdentidade | null {
  const lista = etapasDoProjeto(p);
  const i = lista.indexOf(de);
  return i > 0 ? lista[i - 1] : null;
}

/**
 * Pode abrir esta etapa? O Início sempre; as outras, quando todas as de antes
 * estão concluídas (a atual e as já feitas abrem; as de depois, não).
 */
export function podeAbrir(p: ProjetoNaSequencia, etapa: EtapaDaIdentidade): { pode: boolean; motivo: string | null } {
  if (etapa === "inicio") return { pode: true, motivo: null };
  const lista = etapasDoProjeto(p);
  const i = lista.indexOf(etapa);
  if (i < 0) return { pode: false, motivo: modoDe(p) === "completar" ? "A marca existente já tem nome e logo: esta etapa não entra." : "Este projeto não tem naming (rebranding sem troca de nome)." };
  const feitas = concluidasValidas(p);
  for (let j = 0; j < i; j++) {
    if (feitas.indexOf(lista[j]) < 0) return { pode: false, motivo: `Conclua ${rotuloDaEtapa(lista[j])} antes.` };
  }
  return { pode: true, motivo: null };
}

function modoDe(p: { modo?: string }): string {
  return String(p.modo || "");
}

/** Andamento: quantas etapas do projeto já fecharam. */
export function progresso(p: ProjetoNaSequencia): { feitas: number; total: number } {
  return { feitas: concluidasValidas(p).length, total: etapasDoProjeto(p).length };
}

/**
 * A etapa já fechou? Mesma regra do andamento e do podeAbrir (UXS 30/09): em
 * projeto de antes da IDV2, a etapa nova atrás de uma já fechada conta como feita.
 */
export function etapaFeita(p: ProjetoNaSequencia, etapa: EtapaDaIdentidade): boolean {
  return concluidasValidas(p).indexOf(etapa) >= 0;
}

// ------------------------------------------------------------------ o mínimo de cada etapa

const tem = (v: unknown): boolean => {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.some(tem);
  if (typeof v === "object") return Object.keys(v as Record<string, unknown>).some((k) => tem((v as Record<string, unknown>)[k]));
  return true;
};

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Dados do projeto (idv_projetos.dados), no que as etapas guardam. */
export type DadosDoProjeto = {
  briefing?: Record<string, unknown>;
  pesquisa?: { referencias?: unknown[]; resumo?: string | null; moodboard?: unknown[] };
  estrategia?: Record<string, unknown>;
  naming?: { rodada_id?: string | null; nome?: string | null };
  conceito?: { caminhos?: unknown[]; escolhido?: string | null };
  sistema?: {
    logos?: Record<string, unknown>;
    cores?: unknown[];
    tipografia?: unknown[];
    grafismos?: unknown[];
    regras?: Record<string, unknown>;
  };
  guideline?: { brandbook_id?: string | null; modelo?: string | null };
  aplicacoes?: { itens?: unknown[]; assinatura?: Record<string, unknown> };
  apresentacao?: { falas?: Record<string, string>; tirados?: string[] };
  entrega?: Record<string, unknown>;
  [k: string]: unknown;
};

/**
 * O que falta para concluir a etapa (lista vazia: pode concluir). O texto é
 * o que a tela mostra ao lado do botão.
 */
export function faltaNaEtapa(etapa: EtapaDaIdentidade, dadosBrutos: unknown): string[] {
  const d = obj(dadosBrutos) as DadosDoProjeto;
  const falta: string[] = [];
  switch (etapa) {
    case "inicio":
      return falta;
    case "briefing": {
      const b = obj(d.briefing);
      if (!tem(b.negocio)) falta.push("O que o negócio faz");
      if (!tem(b.publico)) falta.push("Para quem é a marca");
      if (!tem(b.personalidade)) falta.push("A personalidade da marca (3 a 5 palavras)");
      return falta;
    }
    case "pesquisa": {
      const p = obj(d.pesquisa);
      if (!lista(p.referencias).length && !tem(p.resumo)) falta.push("Ao menos uma referência ou o resumo da pesquisa");
      return falta;
    }
    case "estrategia":
      return faltaNaEstrategia(d.estrategia);
    case "naming": {
      const n = obj(d.naming);
      if (!tem(n.nome)) falta.push("O nome escolhido (entre os finalistas)");
      return falta;
    }
    case "conceito": {
      const c = obj(d.conceito);
      if (!lista(c.caminhos).length) falta.push("Os caminhos criativos (2 ou 3)");
      else if (!tem(c.escolhido)) falta.push("O caminho escolhido");
      return falta;
    }
    case "sistema": {
      const s = obj(d.sistema);
      const logos = obj(s.logos);
      if (!tem(obj(logos.principal).caminho)) falta.push("A logo principal (arquivo SVG ou PNG)");
      const cores = lista(s.cores).filter((c) => tem(obj(c).hex));
      if (cores.length < 2) falta.push("Ao menos 2 cores na paleta");
      const tipos = lista(s.tipografia).filter((t) => tem(obj(t).familia));
      if (!tipos.length) falta.push("A família tipográfica dos títulos");
      return falta;
    }
    case "mockups":
      // A Mesa de mockups (frente MCK) decide o que exige; aqui não trava.
      return falta;
    case "apresentacao":
      // A apresentação é o roteiro do encontro com o cliente: ajuda, não trava a entrega.
      return falta;
    case "guideline": {
      const g = obj(d.guideline);
      if (!tem(g.brandbook_id)) falta.push("Montar o brandbook (escolha o modelo)");
      return falta;
    }
    case "entrega": {
      const e = obj(d.entrega);
      if (!tem(e.enviado_em) && !tem(e.aprovado_em)) falta.push("Enviar o brandbook para aprovação");
      return falta;
    }
  }
  return falta;
}

/**
 * Para onde leva cada coisa que falta (UXS 30/09): a etapa, o bloco (a seção
 * com `data-bloco-da-etapa`) e, quando ajuda, o campo (`data-campo`). O texto
 * de `faltaNaEtapa` não muda: a tela junta o destino por aqui.
 * `reserva` é o bloco usado quando o primeiro não está na tela.
 */
export type DestinoDoQueFalta = { etapa: EtapaDaIdentidade; bloco?: string; reserva?: string; campo?: string };

const DESTINOS_DO_QUE_FALTA: Record<string, { etapa?: EtapaDaIdentidade; bloco: string; reserva?: string; campo?: string }> = {
  "O que o negócio faz": { bloco: "marca", campo: "negocio" },
  "Para quem é a marca": { bloco: "marca", campo: "publico" },
  "A personalidade da marca (3 a 5 palavras)": { bloco: "marca", campo: "personalidade" },
  "Ao menos uma referência ou o resumo da pesquisa": { bloco: "resumo" },
  "O propósito ou a missão": { bloco: "plataforma" },
  "O arquétipo principal": { bloco: "arquetipo" },
  "O posicionamento (para quem e o diferencial)": { bloco: "posicionamento" },
  "O tom de voz (como a marca fala)": { bloco: "tom" },
  "O nome escolhido (entre os finalistas)": { bloco: "nomes", reserva: "gerar-nomes" },
  "Os caminhos criativos (2 ou 3)": { bloco: "gerar" },
  "O caminho escolhido": { bloco: "caminhos" },
  "A logo principal (arquivo SVG ou PNG)": { bloco: "logos", campo: "logo-principal" },
  "Ao menos 2 cores na paleta": { bloco: "paleta" },
  "A família tipográfica dos títulos": { bloco: "tipografia" },
  "Montar o brandbook (escolha o modelo)": { bloco: "montar", reserva: "versao", campo: "montar" },
  "Enviar o brandbook para aprovação": { etapa: "guideline", bloco: "versao", reserva: "montar", campo: "enviar" },
};

/** O destino de um texto do que falta (null: o texto não tem lugar conhecido). */
export function destinoDoQueFalta(etapa: EtapaDaIdentidade, texto: string): DestinoDoQueFalta | null {
  const d = DESTINOS_DO_QUE_FALTA[texto];
  if (!d) return null;
  return { etapa: d.etapa || etapa, bloco: d.bloco, reserva: d.reserva, campo: d.campo };
}

/**
 * O que falta com o destino de cada item. Destino em etapa que o projeto não
 * tem (Naming na marca existente, por exemplo) sai: a tela nunca oferece pulo
 * para onde não abre.
 */
export function faltaComDestino(etapa: EtapaDaIdentidade, dados: unknown, etapasPossiveis?: EtapaDaIdentidade[]): Array<{ texto: string; destino: DestinoDoQueFalta | null }> {
  return faltaNaEtapa(etapa, dados).map((texto) => {
    const destino = destinoDoQueFalta(etapa, texto);
    const pode = !destino || !etapasPossiveis || etapasPossiveis.indexOf(destino.etapa) >= 0;
    return { texto, destino: pode ? destino : null };
  });
}

/**
 * Concluir a etapa: só a etapa atual (ou uma já concluída, que continua
 * concluída) e só sem falta. Devolve as concluídas novas e a etapa seguinte.
 */
export function concluirEtapa(
  p: ProjetoNaSequencia,
  etapa: EtapaDaIdentidade,
  dados: unknown,
): { ok: true; concluidas: EtapaDaIdentidade[]; proxima: EtapaDaIdentidade | null } | { ok: false; motivo: string; falta: string[] } {
  const abre = podeAbrir(p, etapa);
  if (!abre.pode) return { ok: false, motivo: abre.motivo || "Etapa fora da sequência.", falta: [] };
  const falta = faltaNaEtapa(etapa, dados);
  if (falta.length) return { ok: false, motivo: `Falta: ${falta.join("; ")}.`, falta };
  const feitas = concluidasValidas(p);
  const lista = etapasDoProjeto(p);
  const novas = feitas.indexOf(etapa) >= 0 ? feitas : feitas.concat([etapa]);
  const ordenadas = lista.filter((e) => novas.indexOf(e) >= 0);
  return { ok: true, concluidas: ordenadas, proxima: proximaEtapa(p, etapa) };
}

/** Reabrir uma etapa concluída (desfazer o concluir): ela e as seguintes voltam a ficar abertas. */
export function reabrirEtapa(p: ProjetoNaSequencia, etapa: EtapaDaIdentidade): EtapaDaIdentidade[] {
  const lista = etapasDoProjeto(p);
  const i = lista.indexOf(etapa);
  if (i < 0) return concluidasValidas(p);
  return concluidasValidas(p).filter((e) => lista.indexOf(e) < i);
}
