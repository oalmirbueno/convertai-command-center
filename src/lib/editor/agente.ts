import { duracaoDoClipe, type ProjetoDeEdicao } from "../../../supabase/functions/_shared/projeto-de-edicao";
import { MAX_FERRAMENTAS, MAX_PASSOS, type ChamadaDeFerramenta, type RespostaDoPasso } from "../../../supabase/functions/editor-video/ferramentas";
import { apelidosDoProjeto, ErroDeApelido, resolverApelidos, resumoParaOAgente } from "./apelidos";
import { aplicarOperacao, emOrdem, ErroDaOperacao, trilhaPrincipal, type Operacao } from "./operacoes";
import { proporSkill, skillPorId, type IdDaSkill } from "./skills";
import { tempoFino } from "./tempo";
import { falaNaLinhaDoTempo } from "./transcricao";

/**
 * Agente editor, lado da tela (frente V-B). O servidor (editor-video,
 * agente_passo) só conversa com o modelo; as ferramentas rodam AQUI, numa
 * cópia do projeto, com as mesmas operações puras da mão e das skills. No fim
 * sai uma proposta (lista de operações + como fica) que o dono Aplica ou
 * Cancela. Travas: MAX_PASSOS passos, MAX_FERRAMENTAS ferramentas, teto de
 * custo (conferido também no servidor), e o laço para sozinho quando o modelo
 * termina ou não pede ferramenta.
 */

export interface ItemDoLog {
  tipo: "plano" | "ferramenta" | "resposta" | "aviso";
  texto: string;
}

export interface ResultadoDaFerramenta {
  projeto: ProjetoDeEdicao;
  operacoes: Operacao[];
  texto: string;
  ok: boolean;
}

const num = (v: unknown) => {
  const n = Number(v);
  return isFinite(n) ? n : NaN;
};

/** O que aparece por trecho da linha do tempo (visão guardada, levada da fonte para a linha pelos clipes). */
export function visaoNaLinhaDoTempo(p: ProjetoDeEdicao, de: number, ate: number): string[] {
  const t = trilhaPrincipal(p);
  if (!t) return [];
  const linhas: string[] = [];
  emOrdem(t).forEach((c) => {
    const v = c.fonte ? p.visoes[c.fonte] : null;
    if (!v) return;
    v.trechos.forEach((x) => {
      if (x.ate_s < c.entrada_s || x.de_s > c.saida_s) return;
      const ini = c.inicio_s + (Math.max(x.de_s, c.entrada_s) - c.entrada_s) / c.velocidade;
      const fim = c.inicio_s + (Math.min(x.ate_s, c.saida_s) - c.entrada_s) / c.velocidade;
      if (fim < de || ini > ate) return;
      linhas.push(`${tempoFino(ini)} a ${tempoFino(fim)}: ${x.descricao}${x.quem ? `; quem: ${x.quem}` : ""}${x.plano ? `; plano ${x.plano}` : ""}${x.qualidade ? `; ${x.qualidade}` : ""}`);
    });
  });
  return linhas;
}

/** Contexto que vai ao modelo: projeto com apelidos, fala resumida e o que foi visto. */
export function contextoDoAgente(p: ProjetoDeEdicao, limite = 50000): string {
  const partes = [resumoParaOAgente(p)];
  const fala = falaNaLinhaDoTempo(p);
  if (fala.length) {
    const linhas: string[] = [];
    let atual: string[] = [];
    let ini = fala[0].i;
    fala.forEach((w, k) => {
      atual.push(w.t);
      const fimDeFrase = /[.!?]$/.test(w.t) || atual.length >= 14 || k === fala.length - 1;
      if (fimDeFrase) {
        linhas.push(`${tempoFino(ini)} ${atual.join(" ")}`);
        atual = [];
        ini = k + 1 < fala.length ? fala[k + 1].i : w.f;
      }
    });
    partes.push(`Fala na linha do tempo:\n${linhas.join("\n")}`);
  } else partes.push("Sem transcrição guardada.");
  const visto = visaoNaLinhaDoTempo(p, 0, Infinity);
  partes.push(visto.length ? `O que foi visto:\n${visto.join("\n")}` : "Ninguém assistiu o vídeo ainda (sem visão guardada).");
  const texto = partes.join("\n\n");
  return texto.length > limite ? `${texto.slice(0, limite)}\n(cortado)` : texto;
}

/** Roda UMA ferramenta na cópia de trabalho. Nunca lança: erro volta como texto para o modelo conferir. */
export function executarFerramenta(p: ProjetoDeEdicao, ch: ChamadaDeFerramenta, agora: string): ResultadoDaFerramenta {
  const a = ch.argumentos || {};
  const aplicar = (ops: Operacao[], texto: string): ResultadoDaFerramenta => {
    const resolvidas = resolverApelidos(p, ops);
    const novo = resolvidas.reduce((acc, o) => aplicarOperacao(acc, o), p);
    return { projeto: novo, operacoes: resolvidas, texto, ok: true };
  };
  try {
    switch (ch.ferramenta) {
      case "ler_projeto":
        return { projeto: p, operacoes: [], texto: resumoParaOAgente(p), ok: true };
      case "ler_fala": {
        const de = num(a.de_s);
        const ate = num(a.ate_s);
        const fala = falaNaLinhaDoTempo(p).filter((w) => (isNaN(de) || w.f >= de) && (isNaN(ate) || w.i <= ate));
        return { projeto: p, operacoes: [], texto: fala.length ? fala.map((w) => `${tempoFino(w.i)} ${w.t}`).join("\n").slice(0, 12000) : "Sem fala nesse trecho.", ok: true };
      }
      case "ler_visao": {
        const v = visaoNaLinhaDoTempo(p, isNaN(num(a.de_s)) ? 0 : num(a.de_s), isNaN(num(a.ate_s)) ? Infinity : num(a.ate_s));
        return { projeto: p, operacoes: [], texto: v.length ? v.join("\n") : "Nada visto nesse trecho (ninguém assistiu ainda).", ok: true };
      }
      case "dividir":
        return aplicar([{ op: "dividir", clipe: String(a.clipe), em_s: num(a.em_s) }], `Dividido ${a.clipe}.`);
      case "aparar":
        return aplicar([{ op: "aparar", clipe: String(a.clipe), lado: a.lado === "inicio" ? "inicio" : "fim", tempo_s: num(a.tempo_s) }], `Aparado ${a.clipe}.`);
      case "mover":
        return aplicar([{ op: "mover", clipe: String(a.clipe), inicio_s: num(a.inicio_s) }], `Movido ${a.clipe}.`);
      case "remover":
        return aplicar([{ op: "remover", clipe: String(a.clipe), ondular: a.ondular === true }], `Tirado ${a.clipe}.`);
      case "recortar":
        return aplicar([{ op: "recortar", clipe: String(a.clipe), de_s: num(a.de_s), ate_s: num(a.ate_s) }], `Trecho cortado de ${a.clipe}.`);
      case "ajustar": {
        const campos: Record<string, unknown> = {};
        if (a.velocidade !== undefined) campos.velocidade = num(a.velocidade);
        if (a.volume !== undefined) campos.volume = num(a.volume);
        if (a.zoom !== undefined) campos.zoom = a.zoom && typeof a.zoom === "object" ? { de: num((a.zoom as any).de), para: num((a.zoom as any).para) } : null;
        if (a.nota !== undefined) campos.nota = a.nota ? String(a.nota).slice(0, 300) : null;
        return aplicar([{ op: "propriedades", clipe: String(a.clipe), campos }], `Ajustado ${a.clipe}.`);
      }
      case "inserir_texto": {
        let base = p;
        const ops: Operacao[] = [];
        let t = base.trilhas.find((x) => x.tipo === "texto");
        if (!t) {
          const o: Operacao = { op: "trilha_nova", tipo: "texto" };
          base = aplicarOperacao(base, o);
          ops.push(o);
          t = base.trilhas.find((x) => x.tipo === "texto");
        }
        const ins: Operacao = { op: "inserir", trilha: String(t && t.id), clipe: { inicio_s: num(a.inicio_s), entrada_s: 0, saida_s: num(a.duracao_s), texto: String(a.texto || "").slice(0, 500), origem: { tipo: "manual", ref: "agente" } } };
        const novo = aplicarOperacao(base, ins);
        return { projeto: novo, operacoes: ops.concat([ins]), texto: "Texto inserido.", ok: true };
      }
      case "reordenar": {
        const t = trilhaPrincipal(p);
        if (!t) throw new ErroDaOperacao("Sem trilha de vídeo.");
        return aplicar([{ op: "reordenar", trilha: t.id, ordem: Array.isArray(a.ordem) ? (a.ordem as unknown[]).map(String) : [] }], "Reordenado.");
      }
      case "fechar_buracos":
      case "aplicar_skill": {
        const id = (ch.ferramenta === "fechar_buracos" ? "fechar_buracos" : String(a.skill || "")) as IdDaSkill;
        if (!skillPorId(id)) throw new ErroDaOperacao(`Skill desconhecida: ${id}.`);
        const ap = apelidosDoProjeto(p);
        const selecionados = Array.isArray(a.selecionados) ? (a.selecionados as unknown[]).map((x) => ap.porApelido[String(x)]).filter(Boolean) : [];
        const prop = proporSkill(id, p, { agora, selecionados }, (a.parametros && typeof a.parametros === "object" ? a.parametros : {}) as Record<string, string | number | boolean>);
        if (!prop.operacoes.length) return { projeto: p, operacoes: [], texto: `${prop.titulo}: ${prop.resumo}${prop.avisos.length ? ` ${prop.avisos.join(" ")}` : ""}`, ok: false };
        return { projeto: prop.resultado, operacoes: prop.operacoes, texto: `${prop.titulo}: ${prop.resumo}${prop.avisos.length ? ` Avisos: ${prop.avisos.join(" ")}` : ""}`, ok: true };
      }
      default:
        return { projeto: p, operacoes: [], texto: `Ferramenta desconhecida: ${ch.ferramenta}.`, ok: false };
    }
  } catch (e) {
    const motivo = e instanceof ErroDaOperacao || e instanceof ErroDeApelido ? e.message : "Falhou.";
    return { projeto: p, operacoes: [], texto: `Erro em ${ch.ferramenta}: ${motivo}`, ok: false };
  }
}

export interface PedidoAoAgente {
  chamar: (corpo: Record<string, unknown>) => Promise<any>;
  clientId: string;
  sessao: string;
  pedido: string;
  projeto: ProjetoDeEdicao;
  modeloId: string;
  raciocinio?: string | null;
  tetoUsd: number;
  agora: string;
  aoPasso?: (log: ItemDoLog[], gasto: number) => void;
  cancelado?: () => boolean;
}

export interface ResultadoDoAgente {
  operacoes: Operacao[];
  resultado: ProjetoDeEdicao;
  log: ItemDoLog[];
  resposta: string;
  gasto_usd: number;
  passos: number;
  ferramentas: number;
}

/** O laço: passo no servidor, ferramentas aqui, resultado de volta; para no limite. */
export async function rodarAgente(e: PedidoAoAgente): Promise<ResultadoDoAgente> {
  let trabalho = e.projeto;
  const operacoes: Operacao[] = [];
  const log: ItemDoLog[] = [];
  const historico: { papel: "usuario" | "agente"; conteudo: string }[] = [];
  let usadas = 0;
  let gasto = 0;
  let resposta = "";
  let passo = 0;
  while (passo < MAX_PASSOS) {
    if (e.cancelado && e.cancelado()) {
      log.push({ tipo: "aviso", texto: "Parado pelo dono." });
      break;
    }
    passo++;
    const r = await e.chamar({
      acao: "agente_passo",
      client_id: e.clientId,
      referencia_id: e.sessao,
      modelo_id: e.modeloId,
      raciocinio: e.raciocinio || undefined,
      passo,
      ferramentas_usadas: usadas,
      teto_usd: e.tetoUsd,
      pedido: e.pedido,
      contexto: contextoDoAgente(trabalho),
      historico,
    });
    gasto = Number(r && r.gasto_usd) || gasto;
    const p = (r && r.passo) as RespostaDoPasso | undefined;
    if (!p) break;
    if (p.plano) log.push({ tipo: "plano", texto: p.plano });
    (p.recusadas || []).forEach((x) => log.push({ tipo: "aviso", texto: x }));
    const resultados: string[] = [];
    (p.chamadas || []).forEach((c) => {
      if (usadas >= MAX_FERRAMENTAS) return;
      usadas++;
      const x = executarFerramenta(trabalho, c, e.agora);
      trabalho = x.projeto;
      x.operacoes.forEach((o) => operacoes.push(o));
      resultados.push(`${c.ferramenta}: ${x.texto}`);
      log.push({ tipo: "ferramenta", texto: `${c.ferramenta}${x.ok ? "" : " (não deu)"}: ${x.texto.split("\n")[0].slice(0, 160)}` });
    });
    if (p.resposta) resposta = p.resposta;
    if (e.aoPasso) e.aoPasso(log.slice(), gasto);
    if (p.terminou || !(p.chamadas || []).length || (r && r.parou)) break;
    historico.push({ papel: "agente", conteudo: JSON.stringify({ plano: p.plano, chamadas: p.chamadas }) });
    historico.push({ papel: "usuario", conteudo: `Resultados:\n${resultados.join("\n")}\n\nClipes agora:\n${resumoParaOAgente(trabalho)}` });
  }
  if (passo >= MAX_PASSOS) log.push({ tipo: "aviso", texto: `Parou no limite de ${MAX_PASSOS} passos.` });
  if (resposta) log.push({ tipo: "resposta", texto: resposta });
  return { operacoes, resultado: trabalho, log, resposta, gasto_usd: gasto, passos: passo, ferramentas: usadas };
}

/** Duração total que muda (para a prévia: "de 1:20 para 1:05"). */
export const duracaoDaTrilhaPrincipal = (p: ProjetoDeEdicao) => {
  const t = trilhaPrincipal(p);
  return t ? t.clipes.reduce((s, c) => s + duracaoDoClipe(c), 0) : 0;
};
