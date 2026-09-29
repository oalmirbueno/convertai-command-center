import { conferirCorte, cortesDaOnda, tomadasQueSaem, CORTE_PELA_ONDA, type ConferenciaDoCorte, type PalavraDaFonte } from "../../../../supabase/functions/_shared/onda-do-audio";
import type { ProjetoDeEdicao } from "../../../../supabase/functions/_shared/projeto-de-edicao";
import { emOrdem, trilhaPrincipal } from "../operacoes";
import { tempoFino } from "../tempo";
import { palavrasDaTranscricao } from "../transcricao";
import { Montador, parametrosComPadrao, type Skill } from "./tipos";

/**
 * Corte de verdade (frente EDT, F2, 30/09/2026). Duas skills determinísticas
 * (a IA só escolhe; quem calcula é o código) e a conferência, que é só aviso:
 *
 * - cortar_pela_onda: a onda medida pelo worker (projeto.ondas, janelas de
 *   10 ms, limiar pelo chão de ruído da fonte) tira toda pausa acima de 0,25 s
 *   e deixa 0,12 s na emenda. Não depende do tempo do transcritor.
 * - ficar_com_melhor_tomada: falso começo, frase repetida e gagueira saem;
 *   fica a última tomada inteira. A lista do que saiu vai no cartão.
 * - conferirCorteDoProjeto: respiros acima de 0,25 s, palavra mordida,
 *   repetição e clipe curto. Não corrige nada (sem laço).
 */

export function cortarPelaOndaEm(m: Montador, pausaMax: number, emenda: number): { cortes: number; tirado_s: number; sem_onda: number } {
  const t = trilhaPrincipal(m.projeto);
  if (!t) return { cortes: 0, tirado_s: 0, sem_onda: 0 };
  const depois = Math.round(emenda * (CORTE_PELA_ONDA.depois_s / CORTE_PELA_ONDA.emenda_s) * 1000) / 1000;
  const antes = Math.round((emenda - depois) * 1000) / 1000;
  let cortes = 0;
  let tirado = 0;
  let semOnda = 0;
  // Do último clipe para o primeiro, e dentro do clipe do fim para o começo: o id do pedaço de antes não muda.
  emOrdem(t)
    .slice()
    .reverse()
    .forEach((c) => {
      const onda = c.fonte ? (m.projeto.ondas || {})[c.fonte] : null;
      if (!onda) {
        if (c.fonte) semOnda++;
        return;
      }
      cortesDaOnda(c, onda.pausas, { pausa_max_s: pausaMax, depois_s: depois, antes_s: antes })
        .slice()
        .reverse()
        .forEach((s) => {
          m.aplicar({ op: "recortar", clipe: c.id, de_s: s.de_s, ate_s: s.ate_s });
          cortes++;
          tirado += (s.ate_s - s.de_s) / c.velocidade;
        });
    });
  if (cortes) m.aplicar({ op: "ondular", trilha: t.id });
  if (semOnda) m.avisar(`${semOnda} ${semOnda === 1 ? "clipe ficou" : "clipes ficaram"} de fora: falta medir a onda (o worker mede, sem custo).`);
  if (cortes) m.avisar("Legendas e peças não andam junto com o corte: refaça as legendas depois.");
  return { cortes, tirado_s: Math.round(tirado * 100) / 100, sem_onda: semOnda };
}

export const SKILL_CORTAR_PELA_ONDA: Skill = {
  id: "cortar_pela_onda",
  rotulo: "Cortar pela onda",
  descricao: "Tira toda pausa acima de 0,25 s pela onda medida do áudio e deixa 0,12 s na emenda. Nenhuma palavra sai.",
  referencia: "EDIT IA PRO (regras medidas), reescrito",
  precisaDeFala: false,
  parametros: [
    { chave: "pausa_max_s", rotulo: "Pausa máxima (s)", tipo: "numero", padrao: CORTE_PELA_ONDA.pausa_max_s, min: 0.15, max: 1.5, passo: 0.05 },
    { chave: "emenda_s", rotulo: "Emenda (s)", tipo: "numero", padrao: CORTE_PELA_ONDA.emenda_s, min: 0.04, max: 0.4, passo: 0.02 },
  ],
  propor(p, ctx, dados) {
    const params = parametrosComPadrao(SKILL_CORTAR_PELA_ONDA, dados);
    const m = new Montador(p);
    const r = cortarPelaOndaEm(m, Number(params.pausa_max_s), Number(params.emenda_s));
    if (r.cortes) m.aplicar({ op: "registrar_skill", skill: "cortar_pela_onda", resumo: `${r.cortes} pausas, ${tempoFino(r.tirado_s)} a menos`, em: ctx.agora });
    const resumo = r.cortes ? `${r.cortes} ${r.cortes === 1 ? "pausa sai" : "pausas saem"} pela onda: ${tempoFino(r.tirado_s)} a menos.` : r.sem_onda ? "Falta medir a onda do áudio." : "Nenhuma pausa acima do máximo.";
    return m.proposta("cortar_pela_onda", "Cortar pela onda", resumo);
  },
};

/** Palavras de uma fonte no tempo da fonte (por palavra ou estimadas pela frase). */
function palavrasDaFonte(p: ProjetoDeEdicao, fonte: string | null): PalavraDaFonte[] {
  const tr = fonte ? p.transcricoes[fonte] : null;
  return tr ? palavrasDaTranscricao(tr) : [];
}

export const SKILL_MELHOR_TOMADA: Skill = {
  id: "ficar_com_melhor_tomada",
  rotulo: "Ficar com a melhor tomada",
  descricao: "Tira falso começo, frase repetida e gagueira; fica a última tomada inteira. A lista do que saiu vai no cartão.",
  referencia: "EDIT IA PRO (regra da última tomada inteira), reescrito",
  precisaDeFala: true,
  parametros: [{ chave: "pausa_s", rotulo: "Pausa que separa frases (s)", tipo: "numero", padrao: 0.45, min: 0.2, max: 1.5, passo: 0.05 }],
  propor(p, ctx, dados) {
    const params = parametrosComPadrao(SKILL_MELHOR_TOMADA, dados);
    const m = new Montador(p);
    const t = trilhaPrincipal(m.projeto);
    let saiu = 0;
    let tirado = 0;
    const lista: string[] = [];
    if (t) {
      emOrdem(t)
        .slice()
        .reverse()
        .forEach((c) => {
          const palavras = palavrasDaFonte(m.projeto, c.fonte).filter((w) => w.i >= c.entrada_s - 1e-6 && w.f <= c.saida_s + 1e-6);
          tomadasQueSaem(palavras, { pausa_s: Number(params.pausa_s) })
            .slice()
            .reverse()
            .forEach((x) => {
              const de = Math.max(x.de_s, c.entrada_s);
              const ate = Math.min(x.ate_s, c.saida_s);
              if (ate - de < 0.04) return;
              m.aplicar({ op: "recortar", clipe: c.id, de_s: de, ate_s: ate });
              saiu++;
              tirado += (ate - de) / c.velocidade;
              lista.unshift(`${x.motivo === "falso_comeco" ? "Falso começo" : x.motivo === "repeticao" ? "Repetição" : "Gagueira"}: "${x.texto.slice(0, 50)}" (ficou "${x.ficou.slice(0, 50)}")`);
            });
        });
      if (saiu) m.aplicar({ op: "ondular", trilha: t.id });
    }
    lista.slice(0, 12).forEach((l) => m.avisar(l));
    if (lista.length > 12) m.avisar(`E mais ${lista.length - 12}.`);
    if (saiu) m.aplicar({ op: "registrar_skill", skill: "ficar_com_melhor_tomada", resumo: `${saiu} tomadas, ${tempoFino(tirado)} a menos`, em: ctx.agora });
    return m.proposta("ficar_com_melhor_tomada", "Melhor tomada", saiu ? `${saiu} ${saiu === 1 ? "tomada sai" : "tomadas saem"}: ${tempoFino(Math.round(tirado * 100) / 100)} a menos. Fica a última inteira.` : "Nenhum falso começo nem repetição na fala.");
  },
};

/** Conferência do corte da trilha principal (aviso; não muda nada). */
export function conferirCorteDoProjeto(p: ProjetoDeEdicao): ConferenciaDoCorte {
  const t = trilhaPrincipal(p);
  const clipes = t ? emOrdem(t).map((c) => ({ id: c.id, fonte: c.fonte, inicio_s: c.inicio_s, entrada_s: c.entrada_s, saida_s: c.saida_s, velocidade: c.velocidade })) : [];
  const falas: Record<string, PalavraDaFonte[]> = {};
  clipes.forEach((c) => {
    if (c.fonte && !falas[c.fonte] && p.transcricoes[c.fonte] && p.transcricoes[c.fonte].por_palavra) falas[c.fonte] = palavrasDaFonte(p, c.fonte);
  });
  return conferirCorte(clipes, p.ondas || {}, falas);
}

/** Texto curto da conferência (vai ao agente e ao cartão). */
export function textoDaConferencia(c: ConferenciaDoCorte): string {
  const extra: string[] = [];
  c.respiros.slice(0, 4).forEach((r) => extra.push(`respiro de ${String(r.duracao_s).replace(".", ",")} s em ${tempoFino(r.em_s)}`));
  c.mordidas.slice(0, 3).forEach((r) => extra.push(`"${r.palavra}" mordida em ${tempoFino(r.em_s)}`));
  c.repeticoes.slice(0, 3).forEach((r) => extra.push(`"${r.palavra}" repetida em ${tempoFino(r.em_s)}`));
  return `${c.resumo}${extra.length ? ` ${extra.join("; ")}.` : ""}${c.ok ? " Tudo certo." : " É só aviso: nada foi mudado."}`;
}
