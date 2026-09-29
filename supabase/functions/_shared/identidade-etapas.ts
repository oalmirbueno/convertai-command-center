/**
 * Mesa Identidade (/mesa-identidade, frente IDV, 30/09/2026): as etapas e a
 * sequência. Pedido do dono: "estúdio sequencial desde o início, envolvente,
 * organizado e limpo".
 *
 * Início -> Briefing -> Pesquisa -> Naming -> Conceito -> Sistema -> Mockups
 * -> Guideline -> Entrega. O Naming só entra quando a marca é do zero ou
 * quando a equipe pede (rebranding com troca de nome).
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

export const ETAPAS_DA_IDENTIDADE = [
  { valor: "inicio", rotulo: "Início" },
  { valor: "briefing", rotulo: "Briefing" },
  { valor: "pesquisa", rotulo: "Pesquisa" },
  { valor: "naming", rotulo: "Naming" },
  { valor: "conceito", rotulo: "Conceito" },
  { valor: "sistema", rotulo: "Sistema" },
  { valor: "mockups", rotulo: "Mockups" },
  { valor: "guideline", rotulo: "Guideline" },
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
} as const;
export type ModoDoProjeto = "zero" | "rebranding";

export const ROTULO_DO_MODO: Record<ModoDoProjeto, string> = {
  zero: "Marca do zero",
  rebranding: "Rebranding",
};

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

/** Naming entra na marca do zero sempre; no rebranding, só quando pedido. */
export function precisaDeNaming(p: Pick<ProjetoNaSequencia, "modo" | "com_naming">): boolean {
  return p.modo === "zero" || p.com_naming === true;
}

/** As etapas deste projeto, na ordem. */
export function etapasDoProjeto(p: Pick<ProjetoNaSequencia, "modo" | "com_naming">): EtapaDaIdentidade[] {
  return VALORES.filter((e) => e !== "naming" || precisaDeNaming(p));
}

function concluidasValidas(p: ProjetoNaSequencia): EtapaDaIdentidade[] {
  const lista = etapasDoProjeto(p);
  return (Array.isArray(p.concluidas) ? p.concluidas : []).filter((e): e is EtapaDaIdentidade => ehEtapaDaIdentidade(e) && lista.indexOf(e) >= 0);
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
  if (i < 0) return { pode: false, motivo: "Este projeto não tem naming (rebranding sem troca de nome)." };
  const feitas = concluidasValidas(p);
  for (let j = 0; j < i; j++) {
    if (feitas.indexOf(lista[j]) < 0) return { pode: false, motivo: `Conclua ${rotuloDaEtapa(lista[j])} antes.` };
  }
  return { pode: true, motivo: null };
}

/** Andamento: quantas etapas do projeto já fecharam. */
export function progresso(p: ProjetoNaSequencia): { feitas: number; total: number } {
  return { feitas: concluidasValidas(p).length, total: etapasDoProjeto(p).length };
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
  pesquisa?: { referencias?: unknown[]; resumo?: string | null };
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
