/**
 * Marcas que o agente deixa no fim de cada passada (AGENTS.md, "Método
 * (Superpowers)"): `PROVA:` com as últimas linhas de `npm run checar` e de
 * `node scripts/conferir.mjs --secao <id>`, as linhas `DECIDI:` e a
 * `PRECISA DE RESPOSTA:`. Viram eventos do trabalho, que a Mesa Site mostra.
 *
 * Puro (sem SDK nem rede): o vitest do painel lê direto. Passada que diz
 * pronto sem PROVA vira aviso; nada é refeito (sem laço de correção).
 *
 * A PROVA do agente é só a DECLARADA: a prova de verdade é a conferência da
 * seção que o motor roda depois do build dele, com o conferir.mjs do modelo
 * (`conferirSecaoDoProjeto`). Quando as duas divergem, a tela recebe o aviso
 * "prova declarada não confere".
 */
import type { EventoResumido } from "../../../supabase/functions/_shared/motor-codigo.ts";

export type MarcasDaResposta = {
  /** Texto depois de "PROVA:" (até 400 caracteres), ou null. */
  prova: string | null;
  /** Linhas "DECIDI: o quê, porque" (até 5, cada uma até 200 caracteres). */
  decisoes: string[];
  /** Texto depois de "PRECISA DE RESPOSTA:" (até 300 caracteres), ou null. */
  pergunta: string | null;
  /** A resposta afirma que terminou (pronto, feito, concluí...). */
  afirma_pronto: boolean;
};

export const LIMITES_DAS_MARCAS = { prova: 400, decisao: 200, decisoes: 5, pergunta: 300 };

/** A conferência da seção que o motor roda depois do build (lib/projeto.ts, conferirSecaoDoProjeto). */
export type ConferenciaDaSecao = {
  /** false quando não rodou (nada mudou, build falhou); o motivo diz por quê. */
  rodou: boolean;
  ok: boolean;
  problemas: string[];
  onde: { pagina: string; caracteres?: number; imagens?: number } | null;
  motivo?: string;
};

/** O resumo curto da conferência que passou (página, texto e imagens). */
function ondeAchou(c: ConferenciaDaSecao): string {
  if (!c.onde) return "seção no build";
  const partes = [c.onde.pagina];
  if (typeof c.onde.caracteres === "number") partes.push(`${c.onde.caracteres} caracteres`);
  if (typeof c.onde.imagens === "number") partes.push(`${c.onde.imagens} imagem(ns)`);
  return partes.join(", ");
}

const MARCA = /^[\s>*_`#-]*(PROVA|DECIDI|PRECISA DE RESPOSTA)[*_`\s]*:[*_`]*\s*(.*)$/i;
// Sem \b no fim: em JS, "í" não é letra para o \b ("concluí" não casaria).
const PRONTO = /\b(pronto|pronta|feito|feita|conclu[ií]d[oa]|conclu[ií]|terminei|terminad[oa]|finalizei|finalizad[oa]|implementei|constru[ií]|entreguei|est[aá] no ar|done|completed?)(?![A-Za-zÀ-ÿ])/i;

const umaLinha = (t: string, max: number) => t.replace(/\s+/g, " ").trim().slice(0, max);

/** Lê as marcas da resposta inteira (as marcas ficam no fim; leia antes de cortar a resposta). */
export function lerMarcasDaResposta(resposta: string | null | undefined): MarcasDaResposta {
  const texto = String(resposta || "").replace(/\r\n?/g, "\n");
  const linhas = texto.split("\n");
  let prova: string[] | null = null;
  let pergunta: string[] | null = null;
  const decisoes: string[] = [];
  // Continuação de linha: a PROVA traz as últimas linhas das saídas (às vezes num bloco de código).
  let aberta: "prova" | "pergunta" | null = null;
  for (const bruta of linhas) {
    const m = MARCA.exec(bruta);
    if (m) {
      const tipo = m[1].toUpperCase();
      const resto = m[2].replace(/[*_`]+$/g, "").trim();
      if (tipo === "PROVA") {
        prova = resto ? [resto] : [];
        aberta = "prova";
      } else if (tipo === "DECIDI") {
        if (resto && decisoes.length < LIMITES_DAS_MARCAS.decisoes) decisoes.push(umaLinha(resto, LIMITES_DAS_MARCAS.decisao));
        aberta = null;
      } else {
        pergunta = resto ? [resto] : [];
        aberta = "pergunta";
      }
      continue;
    }
    const linha = bruta.trim();
    if (!aberta) continue;
    if (/^```/.test(linha)) continue;
    if (aberta === "prova" && prova) {
      if (linha) prova.push(linha);
    } else if (aberta === "pergunta" && pergunta) {
      if (!linha) aberta = null;
      else pergunta.push(linha);
    }
  }
  const juntar = (l: string[] | null, max: number) => {
    if (!l) return null;
    const t = l.join(" | ").replace(/\s+/g, " ").trim();
    return t ? t.slice(0, max) : null;
  };
  return {
    prova: juntar(prova, LIMITES_DAS_MARCAS.prova),
    decisoes,
    pergunta: juntar(pergunta, LIMITES_DAS_MARCAS.pergunta),
    afirma_pronto: PRONTO.test(texto),
  };
}

/**
 * A skill que o agente carregou (ferramenta `skill` do opencode) vira um passo
 * na tela: "Carregou a skill brainstorming". Recusada pela permissão, vira aviso.
 */
export function eventoDaSkill(e: unknown): EventoResumido | null {
  if (!e || typeof e !== "object") return null;
  const ev = e as { type?: string; properties?: { part?: { type?: string; tool?: string; state?: { status?: string; input?: { name?: unknown }; error?: unknown } } } };
  if (ev.type !== "message.part.updated") return null;
  const part = ev.properties && ev.properties.part;
  if (!part || part.type !== "tool" || part.tool !== "skill" || !part.state) return null;
  const nome = umaLinha(String((part.state.input && part.state.input.name) || "sem nome"), 60);
  if (part.state.status === "completed") return { tipo: "passo", resumo: `Carregou a skill ${nome} (Superpowers)`, dados: { skill: nome } };
  if (part.state.status === "error") return { tipo: "aviso", resumo: umaLinha(`A skill ${nome} não foi carregada: ${String(part.state.error || "")}`, 280), dados: { skill: nome, recusada: true } };
  return null;
}

/**
 * Pronto sem prova: a passada terminou (motivo "feito") sem PROVA e sem uma
 * pergunta pendente, ou afirmou que terminou sem PROVA. Só aviso.
 */
export function prontoSemProva(m: MarcasDaResposta, motivo: string): boolean {
  if (m.prova) return false;
  if (motivo !== "feito") return false;
  return m.afirma_pronto || !m.pergunta;
}

/**
 * Eventos do trabalho a partir das marcas de uma passada e da conferência do
 * motor: a prova declarada (ou o aviso "sem prova"), o resultado da
 * conferência (passo quando passou; aviso quando falhou, e "prova declarada
 * não confere" quando o agente tinha dito que passou), um por decisão e um
 * para a pergunta. Os dados vão em `dados` e o resumo cabe em uma linha.
 */
export function eventosDasMarcas(m: MarcasDaResposta, p: { secao: string; rotulo: string; motivo: string; conferencia?: ConferenciaDaSecao | null }): EventoResumido[] {
  const eventos: EventoResumido[] = [];
  const semProva = prontoSemProva(m, p.motivo);
  const conf = p.conferencia || null;
  const conferiu = !!(conf && conf.rodou);
  const confere = conferiu ? conf!.ok : null;
  const dados = {
    secao: p.secao,
    prova: m.prova,
    prova_declarada: m.prova,
    conferencia: conf,
    confere,
    decisoes: m.decisoes,
    pergunta: m.pergunta,
    sem_prova: semProva,
    metodo: "superpowers",
  };
  if (m.prova) {
    const naoConferida = conf && !conf.rodou ? ` (o motor não conferiu: ${conf.motivo || "sem build"})` : "";
    eventos.push({ tipo: "passo", resumo: umaLinha(`Prova declarada de ${p.rotulo}${naoConferida}: ${m.prova}`, 300), dados });
  } else if (semProva) {
    eventos.push({ tipo: "aviso", resumo: umaLinha(`${p.rotulo}: dada como pronta sem PROVA (aviso; nada foi refeito)`, 300), dados });
  }
  if (conferiu && conf!.ok) {
    eventos.push({ tipo: "passo", resumo: umaLinha(`Conferido pelo motor (${p.rotulo}): conferir --secao ${p.secao} ok (${ondeAchou(conf!)})`, 300), dados: { secao: p.secao, conferencia: conf, confere: true } });
  } else if (conferiu) {
    const problema = conf!.problemas[0] || "a conferência falhou";
    const resumo = m.prova ? `Prova declarada não confere (${p.rotulo}): o motor rodou conferir --secao ${p.secao} e falhou: ${problema}` : `Conferência do motor falhou (${p.rotulo}): ${problema}`;
    eventos.push({ tipo: "aviso", resumo: umaLinha(resumo, 300), dados: { secao: p.secao, conferencia: conf, confere: false, prova_declarada: m.prova } });
  }
  for (const d of m.decisoes) eventos.push({ tipo: "passo", resumo: umaLinha(`Decidi (${p.rotulo}): ${d}`, 300), dados: { secao: p.secao, decisao: d } });
  if (m.pergunta) eventos.push({ tipo: "aviso", resumo: umaLinha(`Precisa de resposta (${p.rotulo}): ${m.pergunta}`, 300), dados: { secao: p.secao, pergunta: m.pergunta } });
  if (!eventos.length) return [];
  // Sem prova declarada e sem aviso (passada parada, teto ou prazo): o primeiro evento leva os dados completos.
  if (!m.prova && !semProva) eventos[0] = { ...eventos[0], dados: { ...dados, ...(eventos[0].dados || {}) } };
  return eventos;
}
