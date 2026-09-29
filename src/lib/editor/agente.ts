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
  /** Pedido de exportar (vira cartão com Confirmar; nunca roda sozinho). */
  exportar?: boolean;
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

/** O que a tela sabe além do projeto (AG2): seleção e cursor. */
export interface EstadoDaTela {
  /** Ids dos clipes escolhidos na linha do tempo (viram apelidos aqui). */
  selecionados?: string[];
  /** Tempo do cursor na linha do tempo (s). */
  cursor_s?: number | null;
}

/** Linhas do estado da tela para o modelo (apelidos, nunca id). */
export function linhasDaTela(p: ProjetoDeEdicao, tela: EstadoDaTela = {}): string[] {
  const a = apelidosDoProjeto(p);
  const t = trilhaPrincipal(p);
  const linhas: string[] = [];
  const ordem = t ? emOrdem(t).map((c) => a.porId[c.id]).filter(Boolean) : [];
  linhas.push(ordem.length ? `Trilha de vídeo na ordem: ${ordem.join(", ")} (${tempoFino(duracaoDaTrilhaPrincipal(p))}).` : "Trilha de vídeo vazia.");
  const sel = (tela.selecionados || []).map((id) => a.porId[id]).filter(Boolean);
  linhas.push(sel.length ? `Selecionados na tela: ${sel.join(", ")}.` : "Selecionados na tela: nenhum.");
  if (typeof tela.cursor_s === "number" && isFinite(tela.cursor_s)) {
    const sob = a.lista.filter((c) => c.inicio_s <= (tela.cursor_s as number) && c.fim_s > (tela.cursor_s as number)).map((c) => c.apelido);
    linhas.push(`Cursor em ${tempoFino(tela.cursor_s)}${sob.length ? ` (sobre ${sob.join(", ")})` : ""}.`);
  }
  return linhas;
}

/** Itens para "essa", "o segundo", "todos" (Jev): os clipes da trilha de vídeo na ordem da tela. */
export function itensDaReferencia(p: ProjetoDeEdicao): { ref: string; titulo: string; detalhe: string | null }[] {
  const a = apelidosDoProjeto(p);
  const t = trilhaPrincipal(p);
  if (!t) return [];
  return emOrdem(t).map((c) => {
    const x = a.lista.find((l) => l.id === c.id);
    return { ref: a.porId[c.id], titulo: x ? x.rotulo : "Clipe", detalhe: x ? `${tempoFino(x.inicio_s)} a ${tempoFino(x.fim_s)}` : null };
  }).filter((i) => !!i.ref);
}

/** Contexto que vai ao modelo: projeto com apelidos, estado da tela, fala resumida e o que foi visto. */
export function contextoDoAgente(p: ProjetoDeEdicao, limite = 50000, tela: EstadoDaTela = {}): string {
  const partes = [resumoParaOAgente(p), linhasDaTela(p, tela).join("\n")];
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
      case "trilha": {
        const id = String(a.trilha || "");
        if (!p.trilhas.some((t) => t.id === id)) throw new ErroDaOperacao(`Não existe a trilha ${id || "sem nome"}. Trilhas: ${p.trilhas.map((t) => t.id).join(", ") || "nenhuma"}.`);
        const campos: { muda?: boolean; oculta?: boolean } = {};
        if (typeof a.muda === "boolean") campos.muda = a.muda;
        if (typeof a.oculta === "boolean") campos.oculta = a.oculta;
        if (!Object.keys(campos).length) throw new ErroDaOperacao("Diga muda ou oculta.");
        const o: Operacao = { op: "trilha", trilha: id, campos };
        return { projeto: aplicarOperacao(p, o), operacoes: [o], texto: `Trilha ${id}${campos.muda !== undefined ? (campos.muda ? " sem som" : " com som") : ""}${campos.oculta !== undefined ? (campos.oculta ? " escondida" : " à vista") : ""}.`, ok: true };
      }
      case "exportar":
        return { projeto: p, operacoes: [], texto: "Exportação preparada: o dono confirma no cartão.", ok: true, exportar: true };
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
    // AG2: erro inesperado não some mais como "Falhou." sem rastro: vai para o console e o motivo volta ao modelo.
    const conhecido = e instanceof ErroDaOperacao || e instanceof ErroDeApelido;
    if (!conhecido) console.error("[agente editor] ferramenta falhou", ch.ferramenta, e);
    const motivo = conhecido ? (e as Error).message : `Falhou (${e instanceof Error ? e.message.slice(0, 120) : "erro desconhecido"}).`;
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
  aoPasso?: (log: ItemDoLog[], gasto: number, passo: number) => void;
  cancelado?: () => boolean;
  /** AG2: seleção e cursor da tela (o modelo recebe apelidos). */
  tela?: EstadoDaTela;
  /** AG2: as últimas trocas desta conversa (texto curto), para "e agora o outro" fazer sentido. */
  conversa?: string;
}

export interface ResultadoDoAgente {
  operacoes: Operacao[];
  resultado: ProjetoDeEdicao;
  log: ItemDoLog[];
  resposta: string;
  gasto_usd: number;
  passos: number;
  ferramentas: number;
  /** Ferramentas que não deram, chamadas recusadas ou cortadas no limite. */
  falhas: number;
  recusadas: number;
  /** Parou antes do fim (Parar, teto, limite, erro no meio). */
  parado: boolean;
  /** O modelo pediu para exportar (cartão com Confirmar). */
  exportar: boolean;
  /** Pergunta com opções (dúvida real). */
  opcoes: string[];
  /** Anexos do aprendizado (Aprendi / Segui), como vieram do servidor. */
  aprendido: unknown | null;
  seguidas: unknown | null;
  /** Último uso registrado (liga a mensagem ao gasto). */
  uso_id: string | null;
}

/** O que o servidor devolve num passo (agente_passo). */
interface RespostaDoServidor {
  passo?: RespostaDoPasso;
  gasto_usd?: number;
  parou?: boolean;
  uso_id?: string | null;
  referencia?: unknown;
  aprendido?: unknown;
  regras_seguidas?: unknown;
}

/** Erro no primeiro passo (nada foi feito): quem chamou devolve o pedido ao campo. */
export class ErroDoPrimeiroPasso extends Error {
  causa: unknown;
  constructor(causa: unknown) {
    super(causa instanceof Error ? causa.message : "O agente não respondeu.");
    this.name = "ErroDoPrimeiroPasso";
    this.causa = causa;
  }
}

/** O laço: passo no servidor, ferramentas aqui, resultado de volta; para no limite e diz por quê. */
export async function rodarAgente(e: PedidoAoAgente): Promise<ResultadoDoAgente> {
  let trabalho = e.projeto;
  const operacoes: Operacao[] = [];
  const log: ItemDoLog[] = [];
  const historico: { papel: "usuario" | "agente"; conteudo: string }[] = [];
  const ap = apelidosDoProjeto(e.projeto);
  const selecionados = ((e.tela && e.tela.selecionados) || []).map((id) => ap.porId[id]).filter(Boolean);
  const itens = itensDaReferencia(e.projeto);
  let referencia: unknown = null;
  let usadas = 0;
  let gasto = 0;
  let resposta = "";
  let passo = 0;
  let falhas = 0;
  let recusadas = 0;
  let parado = false;
  let terminouBem = false;
  let exportar = false;
  let opcoes: string[] = [];
  let aprendido: unknown = null;
  let seguidas: unknown = null;
  let usoId: string | null = null;
  while (passo < MAX_PASSOS) {
    if (e.cancelado && e.cancelado()) {
      log.push({ tipo: "aviso", texto: `Parado pelo dono depois de ${passo} ${passo === 1 ? "passo" : "passos"}. O que já saiu fica para você conferir.` });
      parado = true;
      break;
    }
    passo++;
    let r: RespostaDoServidor | null | undefined;
    try {
      r = await e.chamar({
        acao: "agente_passo",
        client_id: e.clientId,
        referencia_id: e.sessao,
        modelo_id: e.modeloId,
        raciocinio: e.raciocinio || undefined,
        passo,
        ferramentas_usadas: usadas,
        teto_usd: e.tetoUsd,
        pedido: e.pedido,
        contexto: contextoDoAgente(trabalho, 50000, { ...(e.tela || {}), selecionados: (e.tela && e.tela.selecionados) || [] }),
        historico,
        conversa: e.conversa || undefined,
        itens_referencia: itens,
        selecionados,
        referencia: referencia || undefined,
      });
    } catch (err) {
      // Nada feito ainda: o pedido volta ao campo. No meio: o que já saiu fica, com o motivo.
      if (passo === 1) throw new ErroDoPrimeiroPasso(err);
      log.push({ tipo: "aviso", texto: `O passo ${passo} falhou (${err instanceof Error ? err.message : "sem resposta"}). O que já saiu fica para você conferir.` });
      parado = true;
      break;
    }
    gasto = Number(r && r.gasto_usd) || gasto;
    if (r && r.uso_id) usoId = String(r.uso_id);
    if (r && r.referencia && !referencia) referencia = r.referencia;
    if (r && r.aprendido) aprendido = r.aprendido;
    if (r && r.regras_seguidas) seguidas = r.regras_seguidas;
    const p = (r && r.passo) as RespostaDoPasso | undefined;
    if (!p) {
      log.push({ tipo: "aviso", texto: `O passo ${passo} voltou vazio. Parei aqui.` });
      parado = true;
      break;
    }
    if (p.plano) log.push({ tipo: "plano", texto: p.plano });
    (p.recusadas || []).forEach((x) => {
      recusadas++;
      log.push({ tipo: "aviso", texto: x });
    });
    const resultados: string[] = [];
    const chamadas = p.chamadas || [];
    const cabem = Math.max(0, MAX_FERRAMENTAS - usadas);
    chamadas.slice(0, cabem).forEach((c) => {
      usadas++;
      const x = executarFerramenta(trabalho, c, e.agora);
      trabalho = x.projeto;
      x.operacoes.forEach((o) => operacoes.push(o));
      if (x.exportar) exportar = true;
      if (!x.ok) falhas++;
      resultados.push(`${c.ferramenta}: ${x.texto}`);
      log.push({ tipo: "ferramenta", texto: `${c.ferramenta}${x.ok ? "" : " (não deu)"}: ${x.texto.split("\n")[0].slice(0, 160)}` });
    });
    if (chamadas.length > cabem) {
      recusadas += chamadas.length - cabem;
      log.push({ tipo: "aviso", texto: `${chamadas.length - cabem} ${chamadas.length - cabem === 1 ? "ferramenta ficou" : "ferramentas ficaram"} de fora: limite de ${MAX_FERRAMENTAS} por pedido.` });
    }
    if (p.resposta) resposta = p.resposta;
    if (Array.isArray(p.opcoes) && p.opcoes.length && !chamadas.length) opcoes = p.opcoes.slice(0, 4);
    if (e.aoPasso) e.aoPasso(log.slice(), gasto, passo);
    if (r && r.parou) {
      // O servidor parou pelo teto ou pelo limite: a resposta dele diz o motivo.
      parado = true;
      if (p.resposta) log.push({ tipo: "aviso", texto: p.resposta });
      resposta = operacoes.length ? "Parei antes do fim. Confira o que já saiu." : "";
      break;
    }
    if (p.terminou || !chamadas.length) {
      terminouBem = true;
      break;
    }
    historico.push({ papel: "agente", conteudo: JSON.stringify({ plano: p.plano, chamadas: p.chamadas }) });
    historico.push({ papel: "usuario", conteudo: `Resultados:\n${resultados.join("\n")}\n\nClipes agora:\n${resumoParaOAgente(trabalho)}` });
  }
  if (!terminouBem && !parado && passo >= MAX_PASSOS) {
    parado = true;
    log.push({ tipo: "aviso", texto: `Parou no limite de ${MAX_PASSOS} passos sem o agente dizer que terminou. Confira o que já saiu.` });
  }
  if (resposta) log.push({ tipo: "resposta", texto: resposta });
  return { operacoes, resultado: trabalho, log, resposta, gasto_usd: gasto, passos: passo, ferramentas: usadas, falhas, recusadas, parado, exportar, opcoes, aprendido, seguidas, uso_id: usoId };
}

/** Pedido que é só exportar/renderizar (regra fixa, sem modelo e sem custo): vira o cartão direto. */
export function pedidoDeExportar(texto: string): boolean {
  const t = String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
  if (!/\b(export|renderiz|render\b|baixa(r)? o (video|projeto|pacote)|gera(r)? o (mp4|arquivo final))/.test(t)) return false;
  // Pedido que também edita ("corta os silêncios e exporta") vai ao modelo.
  return !/\b(cort|legend|silenci|reorden|ordem|apar|divid|tira|remov|brabo|dinamic|zoom|punch|musica|volume|texto)/.test(t);
}

/** Prova curta do que mudou (vai no cartão): duração e número de clipes, antes e depois. */
export function provaDaMudanca(antes: ProjetoDeEdicao, depois: ProjetoDeEdicao): string {
  const ta = trilhaPrincipal(antes);
  const td = trilhaPrincipal(depois);
  const na = ta ? ta.clipes.length : 0;
  const nd = td ? td.clipes.length : 0;
  const da = duracaoDaTrilhaPrincipal(antes);
  const dd = duracaoDaTrilhaPrincipal(depois);
  const partes: string[] = [];
  if (Math.abs(da - dd) >= 0.01) partes.push(`duração ${tempoFino(da)} para ${tempoFino(dd)}`);
  if (na !== nd) partes.push(`${na} para ${nd} ${nd === 1 ? "clipe" : "clipes"}`);
  const legendasA = antes.trilhas.filter((t) => t.tipo === "legenda" || t.tipo === "texto").reduce((s, t) => s + t.clipes.length, 0);
  const legendasD = depois.trilhas.filter((t) => t.tipo === "legenda" || t.tipo === "texto").reduce((s, t) => s + t.clipes.length, 0);
  if (legendasA !== legendasD) partes.push(`${legendasD} ${legendasD === 1 ? "legenda ou texto" : "legendas e textos"} (antes ${legendasA})`);
  return partes.length ? `Muda: ${partes.join("; ")}.` : "";
}

/** As últimas trocas da conversa, curtas, para o modelo (o pedido de agora não entra). */
export function conversaParaOModelo(trocas: { quem: "dono" | "agente"; texto: string }[], maxTrocas = 8, maxChars = 3000): string {
  const linhas = trocas
    .filter((t) => t.texto && t.texto.trim())
    .slice(-maxTrocas)
    .map((t) => `${t.quem === "dono" ? "Dono" : "Agente"}: ${t.texto.replace(/\s+/g, " ").trim().slice(0, 400)}`);
  const texto = linhas.join("\n");
  return texto.length > maxChars ? texto.slice(texto.length - maxChars) : texto;
}

/** Duração total que muda (para a prévia: "de 1:20 para 1:05"). */
export const duracaoDaTrilhaPrincipal = (p: ProjetoDeEdicao) => {
  const t = trilhaPrincipal(p);
  return t ? t.clipes.reduce((s, c) => s + duracaoDoClipe(c), 0) : 0;
};
