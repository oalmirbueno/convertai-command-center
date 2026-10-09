import { duracaoDoClipe, type ProjetoDeEdicao } from "../../../supabase/functions/_shared/projeto-de-edicao";
import { FERRAMENTAS_DE_SAIDA, FERRAMENTAS_DO_SERVIDOR, MAX_FERRAMENTAS, MAX_PASSOS, type ChamadaDeFerramenta, type RespostaDoPasso } from "../../../supabase/functions/editor-video/ferramentas";
import { apelidosDoProjeto, apelidosEstaveis, ErroDeApelido, resolverApelidos, resumoParaOAgente, type Apelidos } from "./apelidos";
import { acharDuplicados, idsRepetidos, opsDeRemoverDuplicados, textoDosDuplicados, type AssinaturasDosArquivos } from "./duplicados";
import { clipesQueBatem, filtrarMidia, lerFiltro, origemDoArquivo, textoDoFiltro, type FiltroDaBusca } from "./busca";
import { opsParaInserir, type ItemDaBiblioteca } from "./biblioteca";
import { aplicarOperacao, emOrdem, ErroDaOperacao, trilhaPrincipal, type Operacao } from "./operacoes";
import { proporSkill, skillPorId, type IdDaSkill } from "./skills";
import { tempoFino } from "./tempo";
import { falaNaLinhaDoTempo } from "./transcricao";
import { Montador } from "./skills/tipos";
import { conferirCorteDoProjeto, textoDaConferencia } from "./skills/corteDeVerdade";
import { CHAVE_DA_LOGO, pecasDoProjeto, porLogo, porPeca, porTrilha } from "./motion/aplicar";
import { PECAS_DE_MOTION, type IdDaPeca } from "./motion/catalogo";
import { presetDaLegendaValido, presetDoTextoValido } from "./estilosDeTexto";
import { EFEITOS_DE_AJUSTE, clipeDeZoom, type ModoDeZoom } from "./efeitos";
import { LOOKS } from "./cor";
import { corEm, NOME_DA_TRILHA_DE_AJUSTE, reenquadrarEm } from "./skills/pecasDaEdicao";
import { trilhaLivre } from "./motion/aplicar";
import { FORMATOS_DO_PROJETO, midiaDaFonte, TIPOS_DE_TRANSICAO, type CorDoProjeto, type TipoDeTransicao } from "../../../supabase/functions/_shared/projeto-de-edicao";
import { FERRAMENTAS_DO_AGENTE, PAINEIS_DO_EDITOR, respostaAfirma, respostaPromete } from "../../../supabase/functions/editor-video/ferramentas";
import { FIDELIDADES_DA_RECEITA, normalizarReceita, type Fidelidade } from "../../../supabase/functions/editor-video/receita";
import { entendimentoDoVideo, textoDoEntendimento } from "./entendimento";
import { itensDoQueMudou, mensagemDoQueMudou } from "./relatorio";
import { proporReceita } from "./skills/receita";
import { definicaoDaPeca, parametrosDaPeca } from "./motion/catalogo";
import { chaveNoProjeto, fonteDoItem } from "./biblioteca";
import { textoEm } from "./skills/pecasDaEdicao";
import { acharClipe } from "./operacoes";
import { ferramentaBarrada, lerPedidoDoDono } from "../../../supabase/functions/editor-video/modulos/pedido-do-dono";

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
  /** Frente EDT: saída que vira cartão (geração paga com o custo antes). */
  saida?: SaidaDoAgente | null;
  /** Frente EDT: pedido que já foi para a fila do worker (amostra, onda). */
  naFila?: { tipo: "amostra" | "onda"; pedido_id: string; inicio_s?: number; fim_s?: number } | null;
  /** 02/10: filtro que o agente pôs na tela (buscar). */
  filtro?: FiltroDaBusca | null;
  /** 02/10: painel que o agente abre na tela do dono (trocar cenário, timestamp...). Não muda a linha do tempo. */
  painel?: PedidoDePainel | null;
}

/** Painel do editor que o agente pede para abrir, com o que já vai preenchido. */
export interface PedidoDePainel {
  aba: string;
  /** Id do clipe para escolher na linha do tempo (o painel usa o escolhido). */
  clipe?: string | null;
  /** Trocar cenário: o cenário escrito pelo agente. */
  cenario?: string | null;
}

/**
 * O que a ferramenta precisa além do projeto (02/10): os apelidos ESTÁVEIS do
 * pedido (c3 é o mesmo c3 do começo ao fim), a Mídia do cliente (m1, m2...),
 * o sha256 dos arquivos (takes repetidos) e o cursor.
 */
export interface OpcoesDaFerramenta {
  apelidos?: Apelidos | null;
  midias?: ItemDaBiblioteca[] | null;
  assinaturas?: AssinaturasDosArquivos | null;
  cursor_s?: number | null;
}

export const MAX_MIDIAS_PARA_O_AGENTE = 80;

/** Linha de uma mídia para o modelo ("m3: praia.mp4 (video, bruto, 0:06, fora da linha)"). */
function linhaDaMidia(i: ItemDaBiblioteca, k: number, usados: Set<string>): string {
  const midia = midiaDaFonte(i.tipo, i.nome, i.storage_path);
  const usado = (i.arquivo_id && usados.has(i.arquivo_id)) || usados.has(i.storage_path);
  return `m${k + 1}: ${i.nome} (${midia}, ${origemDoArquivo(i.tipo, i.storage_path, i.origem)}${i.duracao_s ? `, ${tempoFino(i.duracao_s)}` : ""}, ${usado ? "na linha do tempo" : "fora da linha"})`;
}

function usadosDoProjeto(p: ProjetoDeEdicao): Set<string> {
  const s = new Set<string>();
  p.trilhas.forEach((t) =>
    t.clipes.forEach((c) => {
      const f = c.fonte ? p.fontes[c.fonte] : null;
      if (f && f.arquivo_id) s.add(f.arquivo_id);
      if (f && f.storage_path) s.add(f.storage_path);
    }),
  );
  return s;
}

/** Saída paga que o agente preparou (a tela mostra o cartão com custo e Confirmar). */
export interface SaidaDoAgente {
  tipo: "gerar_broll" | "gerar_elemento";
  argumentos: Record<string, unknown>;
  custo_usd: number | null;
  detalhe: string | null;
}

/** O que a tela passa ao agente além do projeto (frente EDT): a marca aberta para a logo e a cor. */
export interface MarcaParaOAgente {
  logo_path: string | null;
  cor: string | null;
  nome: string | null;
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
export function linhasDaTela(p: ProjetoDeEdicao, tela: EstadoDaTela = {}, apelidos?: Apelidos | null): string[] {
  const a = apelidos || apelidosDoProjeto(p);
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
export function contextoDoAgente(p: ProjetoDeEdicao, limite = 50000, tela: EstadoDaTela = {}, extra: OpcoesDaFerramenta = {}): string {
  const a = extra.apelidos || apelidosDoProjeto(p);
  // 02/10: o entendimento do vídeo vem PRIMEIRO (o projeto pode ser cortado no limite; o entendimento não).
  const partes = [`Entendimento do vídeo (código):\n${textoDoEntendimento(entendimentoDoVideo(p))}`, resumoParaOAgente(p, a, { maxPorTrilha: 40 }), linhasDaTela(p, tela, a).join("\n")];
  if (p.referencias && p.referencias.length) {
    partes.push(`Referências (aplicar_referencia): ${p.referencias.map((r, k) => `r${k + 1}: ${r.nome}${normalizarReceita(r.receita) ? " (medida)" : " (sem medida: medir no painel Referências)"}, fidelidade ${r.fidelidade}`).join("; ")}.`);
  }
  // 02/10: os takes repetidos já vão contados (o dono pede "tira os duplicados" e o modelo não precisa adivinhar).
  const repetidos = acharDuplicados(p, extra.assinaturas || null);
  partes.push(repetidos.length ? `Takes repetidos (regra fixa): ${textoDosDuplicados(repetidos, a.porId)} remover_duplicados tira.` : "Takes repetidos: nenhum.");
  const midias = (extra.midias || []).slice(0, MAX_MIDIAS_PARA_O_AGENTE);
  if (midias.length) {
    const usados = usadosDoProjeto(p);
    partes.push(`Mídia do cliente (inserir_midia; buscar filtra):\n${midias.map((i, k) => linhaDaMidia(i, k, usados)).join("\n")}`);
  }
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
  const pecas = pecasDoProjeto(p);
  partes.push(pecas.length ? `Animações: ${pecas.map((x) => `${x.peca} em ${tempoFino(x.inicio_s)}`).join(", ")}.` : "Sem animação.");
  const semOnda = Object.keys(p.fontes).filter((k) => p.fontes[k].midia !== "imagem" && !(p.ondas || {})[k]);
  partes.push(`Onda medida: ${Object.keys(p.ondas || {}).length ? Object.keys(p.ondas || {}).join(", ") : "nenhuma"}${semOnda.length ? `; sem onda: ${semOnda.join(", ")}` : ""}. Músicas na Mídia do projeto: ${Object.keys(p.fontes).filter((k) => p.fontes[k].midia === "audio" && p.fontes[k].storage_bucket !== "publico").join(", ") || "nenhuma"}.`);
  const visto = visaoNaLinhaDoTempo(p, 0, Infinity);
  partes.push(visto.length ? `O que foi visto:\n${visto.join("\n")}` : "Ninguém assistiu o vídeo ainda (sem visão guardada).");
  const texto = partes.join("\n\n");
  return texto.length > limite ? `${texto.slice(0, limite)}\n(cortado)` : texto;
}

/** Roda UMA ferramenta na cópia de trabalho. Nunca lança: erro volta como texto para o modelo conferir. */
export function executarFerramenta(p: ProjetoDeEdicao, ch: ChamadaDeFerramenta, agora: string, marca: MarcaParaOAgente | null = null, opcoes: OpcoesDaFerramenta = {}): ResultadoDaFerramenta {
  const a = ch.argumentos || {};
  const ap = opcoes.apelidos || apelidosDoProjeto(p);
  const aplicar = (ops: Operacao[], texto: string): ResultadoDaFerramenta => {
    const resolvidas = resolverApelidos(p, ops, ap);
    const novo = resolvidas.reduce((acc, o) => aplicarOperacao(acc, o), p);
    return { projeto: novo, operacoes: resolvidas, texto, ok: true };
  };
  try {
    switch (ch.ferramenta) {
      case "ler_projeto":
        return { projeto: p, operacoes: [], texto: resumoParaOAgente(p, ap), ok: true };
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
        return aplicar([{ op: "mover", clipe: String(a.clipe), inicio_s: num(a.inicio_s), trilha: a.trilha ? String(a.trilha) : undefined }], `Movido ${a.clipe}.`);
      case "remover": {
        // Um ou vários (clipes): todos com os apelidos do começo do pedido.
        const lista = (Array.isArray(a.clipes) ? (a.clipes as unknown[]) : []).concat(a.clipe !== undefined && a.clipe !== null && a.clipe !== "" ? [a.clipe] : []).map(String);
        const unicos = lista.filter((x, i) => lista.indexOf(x) === i);
        if (!unicos.length) throw new ErroDaOperacao("Diga qual clipe tirar (clipe ou clipes).");
        return aplicar(unicos.map((c): Operacao => ({ op: "remover", clipe: c, ondular: a.ondular === true })), `Tirado ${unicos.join(", ")}.`);
      }
      case "remover_duplicados": {
        const grupos = acharDuplicados(p, opcoes.assinaturas || null);
        if (!grupos.length) return { projeto: p, operacoes: [], texto: "Nenhum take repetido na trilha de vídeo (mesma mídia e mesmo trecho). Nada saiu.", ok: true };
        const ops = opsDeRemoverDuplicados(grupos, a.ondular !== false);
        const novo = ops.reduce((acc, o) => aplicarOperacao(acc, o), p);
        const ids = idsRepetidos(grupos);
        return { projeto: novo, operacoes: ops, texto: `Tirei ${ids.length} ${ids.length === 1 ? "take repetido" : "takes repetidos"}: ${textoDosDuplicados(grupos, ap.porId)}${a.ondular !== false ? " O resto encostou." : ""}`, ok: true };
      }
      case "buscar": {
        const filtro = lerFiltro(a);
        const clipes = clipesQueBatem(p, filtro, ap, opcoes.assinaturas || null).map((id) => ap.porId[id]).filter(Boolean);
        const todas = (opcoes.midias || []).slice(0, MAX_MIDIAS_PARA_O_AGENTE);
        const achadas = filtrarMidia(todas, p, filtro, opcoes.assinaturas || null);
        const usados = usadosDoProjeto(p);
        const linhas = achadas.slice(0, 30).map((i) => linhaDaMidia(i, todas.indexOf(i), usados));
        return {
          projeto: p,
          operacoes: [],
          texto: `Filtro na tela: ${textoDoFiltro(filtro)}. Clipes: ${clipes.length ? clipes.join(", ") : "nenhum"}. Mídias: ${achadas.length}${linhas.length ? `\n${linhas.join("\n")}` : ""}${achadas.length > linhas.length ? `\n(mais ${achadas.length - linhas.length})` : ""}`,
          ok: true,
          filtro,
        };
      }
      case "inserir_midia": {
        const ref = String(a.midia || "");
        const todas = opcoes.midias || [];
        let item: ItemDaBiblioteca | null = null;
        if (/^m\d+$/.test(ref)) item = todas[Number(ref.slice(1)) - 1] || null;
        else if (p.fontes[ref]) {
          const f = p.fontes[ref];
          item = { id: f.chave, arquivo_id: f.arquivo_id, nome: f.nome, tipo: f.tipo, storage_bucket: f.storage_bucket || "mesa", storage_path: f.storage_path || "", duracao_s: f.duracao_s, largura: f.largura, altura: f.altura, origem: "enviado" };
        }
        if (!item) throw new ErroDaOperacao(`Não achei a mídia ${ref || "sem nome"}. Use o m1, m2 de buscar.`);
        const depois = a.onde === "depois" && a.depois_de ? ap.porApelido[String(a.depois_de)] : null;
        if (a.onde === "depois" && !depois) throw new ErroDaOperacao(`Não existe ${String(a.depois_de || "o clipe de referência")}.`);
        let ops: Operacao[];
        try {
          ops = opsParaInserir(p, item, depois ? { depoisDe: depois } : a.onde === "cursor" ? "cursor" : "fim", typeof opcoes.cursor_s === "number" ? opcoes.cursor_s : 0, { tipo: "manual", ref: "agente" });
        } catch (e) {
          throw new ErroDaOperacao(e instanceof Error ? e.message : "Não deu para pôr na linha do tempo.");
        }
        const novo = ops.reduce((acc, o) => aplicarOperacao(acc, o), p);
        return { projeto: novo, operacoes: ops, texto: `Pus ${item.nome} ${depois ? `depois do ${String(a.depois_de)}` : a.onde === "cursor" ? "no cursor" : "no fim"}.`, ok: true };
      }
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
        const estilo = a.estilo && presetDoTextoValido(a.estilo) ? { preset: String(a.estilo) } : null;
        const ins: Operacao = { op: "inserir", trilha: String(t && t.id), clipe: { inicio_s: num(a.inicio_s), entrada_s: 0, saida_s: num(a.duracao_s), texto: String(a.texto || "").slice(0, 500), estilo, origem: { tipo: "manual", ref: "agente" } } };
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
      case "renderizar":
        return { projeto: p, operacoes: [], texto: "Render preparado: o dono confirma no cartão (vai para a fila da máquina da agência).", ok: true, exportar: true };
      // ---------------------------------------------------------------- frente EDT
      case "ler_onda": {
        const chaves = a.fonte ? [String(a.fonte)] : Object.keys(p.ondas || {});
        const linhas = chaves
          .filter((k) => (p.ondas || {})[k])
          .map((k) => {
            const o = (p.ondas || {})[k];
            const longas = o.pausas.filter((x) => x.ate_s - x.de_s > 0.25).length;
            return `${k}: limiar ${o.limiar_db} dB, chão ${o.chao_db} dB, ${o.pausas.length} pausas medidas (${longas} acima de 0,25 s)${o.lufs !== null ? `, voz ${o.lufs} LUFS` : ""}.`;
          });
        return { projeto: p, operacoes: [], texto: linhas.length ? linhas.join("\n") : "Nenhuma onda medida ainda. Chame medir_onda.", ok: true };
      }
      case "conferir_corte":
        return { projeto: p, operacoes: [], texto: textoDaConferencia(conferirCorteDoProjeto(p)), ok: true };
      case "cortar_pela_onda":
      case "ficar_com_melhor_tomada":
      case "sons":
      case "legendar": {
        const id = (ch.ferramenta === "sons" ? "efeitos_sonoros" : ch.ferramenta === "legendar" ? "legendas" : ch.ferramenta) as IdDaSkill;
        const params: Record<string, string | number | boolean> = {};
        if (ch.ferramenta === "legendar") {
          const n = Number(a.palavras_por_vez);
          if (isFinite(n) && n >= 1) params.palavras_por_bloco = Math.min(8, Math.round(n));
          if (a.estilo && presetDaLegendaValido(a.estilo)) params.estilo = String(a.estilo);
          if (a.posicao) params.posicao = String(a.posicao);
        } else {
          Object.keys(a).forEach((k) => {
            const v = a[k];
            if (typeof v === "number" || typeof v === "string" || typeof v === "boolean") params[k] = v;
          });
        }
        const prop = proporSkill(id, p, { agora }, params);
        // Nada a mudar (sem buraco, sem repetido) não é falha; sem conseguir rodar (aviso) é.
        if (!prop.operacoes.length) return { projeto: p, operacoes: [], texto: `${prop.titulo}: ${prop.resumo}${prop.avisos.length ? ` ${prop.avisos.join(" ")}` : ""}`, ok: !prop.avisos.length };
        return { projeto: prop.resultado, operacoes: prop.operacoes, texto: `${prop.titulo}: ${prop.resumo}${prop.avisos.length ? ` ${prop.avisos.join(" ")}` : ""}`, ok: true };
      }
      case "formato": {
        const f = String(a.formato || "");
        if (!FORMATOS_DO_PROJETO[f]) throw new ErroDaOperacao("Formato precisa ser 9:16, 1:1, 4:5 ou 16:9.");
        const m = new Montador(p);
        const mudou = reenquadrarEm(m, f, a.seguir_rosto !== false);
        const semRosto = !Object.keys(p.rostos || {}).length;
        return { projeto: m.projeto, operacoes: m.operacoes, texto: mudou ? `Vídeo em ${f}.${semRosto ? " Sem rosto rastreado: o recorte fica no centro (o dono rastreia no painel Formato)." : " O recorte segue o rosto."}` : "Já estava assim.", ok: true };
      }
      case "cor": {
        const campos: Partial<CorDoProjeto> = {};
        if (a.look !== undefined) {
          if (!LOOKS.some((l) => l.id === String(a.look))) throw new ErroDaOperacao(`Look desconhecido: ${String(a.look)}. Looks: ${LOOKS.map((l) => l.id).join(", ")}.`);
          campos.look = String(a.look);
        }
        (["intensidade", "exposicao", "contraste", "saturacao", "temperatura", "tinta", "vinheta"] as const).forEach((k) => {
          if (a[k] === undefined) return;
          const v = num(a[k]);
          if (isNaN(v)) return;
          (campos as Record<string, number>)[k] = Math.max(k === "intensidade" || k === "vinheta" ? 0 : -1, Math.min(1, v));
        });
        const m = new Montador(p);
        const mudou = corEm(m, campos);
        return { projeto: m.projeto, operacoes: m.operacoes, texto: mudou ? `Cor: ${Object.keys(campos).join(", ")}.` : "A cor já estava assim.", ok: true };
      }
      case "efeito": {
        const efeito = String(a.efeito || "");
        if ((EFEITOS_DE_AJUSTE as readonly string[]).indexOf(efeito) < 0) throw new ErroDaOperacao(`Efeito desconhecido: ${efeito || "sem nome"}.`);
        const ini = Math.max(0, num(a.inicio_s));
        const d = Math.max(0.2, Math.min(10, isNaN(num(a.duracao_s)) ? 1.5 : num(a.duracao_s)));
        if (isNaN(ini)) throw new ErroDaOperacao("Diga o tempo (inicio_s) do efeito.");
        const m = new Montador(p);
        const trilha = trilhaLivre(m, "ajuste", NOME_DA_TRILHA_DE_AJUSTE, ini, ini + d);
        if (efeito === "zoom") {
          const modo = (["punch", "empurrao", "recuo"].indexOf(String(a.modo)) >= 0 ? String(a.modo) : "punch") as ModoDeZoom;
          m.aplicar({ op: "inserir", trilha, clipe: clipeDeZoom(ini, d, isNaN(num(a.escala)) ? 1.15 : num(a.escala), modo, "agente") });
        } else m.aplicar({ op: "inserir", trilha, clipe: { inicio_s: ini, entrada_s: 0, saida_s: d, estilo: { efeito, params: efeito === "cor" ? { look: LOOKS.some((l) => l.id === String(a.look)) ? String(a.look) : "pb" } : {} }, origem: { tipo: "skill", ref: "agente" } } });
        return { projeto: m.projeto, operacoes: m.operacoes, texto: `Efeito ${efeito} em ${tempoFino(ini)} por ${tempoFino(d)}.`, ok: true };
      }
      case "animar": {
        const peca = String(a.peca || "") as IdDaPeca;
        if ((PECAS_DE_MOTION as readonly string[]).indexOf(peca) < 0 || peca === "logo") throw new ErroDaOperacao(`Peça desconhecida: ${peca || "sem nome"}.`);
        const m = new Montador(p);
        const r = porPeca(m, { peca, palavra_ref: a.palavra_ref ? String(a.palavra_ref) : null, inicio_s: isNaN(num(a.inicio_s)) ? null : num(a.inicio_s), duracao_s: isNaN(num(a.duracao_s)) ? null : num(a.duracao_s), params: (a.params && typeof a.params === "object" ? a.params : {}) as Record<string, unknown> });
        return { projeto: m.projeto, operacoes: m.operacoes, texto: `Peça ${peca} em ${tempoFino(r.inicio_s)} por ${tempoFino(r.duracao_s)}.`, ok: true };
      }
      case "musica": {
        const m = new Montador(p);
        let fonte = String(a.fonte || "");
        // 02/10: música do acervo do cliente (m3 de buscar) entra como fonte e vira a trilha.
        if (/^m\d+$/.test(fonte)) {
          const item = (opcoes.midias || [])[Number(fonte.slice(1)) - 1];
          if (!item) throw new ErroDaOperacao(`Não achei a mídia ${fonte}. Use o m1, m2 de buscar.`);
          if (midiaDaFonte(item.tipo, item.nome, item.storage_path) !== "audio") throw new ErroDaOperacao(`${item.nome} não é um áudio.`);
          const c = chaveNoProjeto(m.projeto, item);
          if (c.nova) m.aplicar({ op: "fonte", fonte: fonteDoItem(c.chave, item) });
          fonte = c.chave;
        }
        const r = porTrilha(m, fonte, isNaN(num(a.abaixo_da_voz_db)) ? null : num(a.abaixo_da_voz_db));
        return { projeto: m.projeto, operacoes: m.operacoes, texto: `Trilha de ${tempoFino(r.duracao_s)}, ${m.projeto.mixagem.trilha_abaixo_da_voz_db} dB abaixo da voz; sobe nas pausas; o render sai em ${m.projeto.mixagem.lufs_alvo} LUFS.`, ok: true };
      }
      case "logo":
      case "cartao_final": {
        const m = new Montador(p);
        if (ch.ferramenta === "logo") {
          if (!marca || !marca.logo_path) throw new ErroDaOperacao("A marca aberta não tem logo no kit. Suba a logo em Marca e peça de novo.");
          const onde = a.onde === "cartao_final" || a.onde === "sting" ? a.onde : "canto";
          const r = porLogo(m, { storage_path: marca.logo_path, nome: marca.nome ? `Logo ${marca.nome}` : null }, onde);
          return { projeto: m.projeto, operacoes: m.operacoes, texto: `Logo (${onde}) em ${tempoFino(r.inicio_s)} por ${tempoFino(r.duracao_s)}.`, ok: true };
        }
        const total = p.duracao_s;
        if (marca && marca.logo_path && (!p.fontes[CHAVE_DA_LOGO] || p.fontes[CHAVE_DA_LOGO].storage_path !== marca.logo_path)) {
          m.aplicar({ op: "fonte", fonte: { chave: CHAVE_DA_LOGO, arquivo_id: null, nome: marca.nome ? `Logo ${marca.nome}` : "Logo do cliente", tipo: "quadro", storage_bucket: "mesa", storage_path: marca.logo_path, duracao_s: null, largura: null, altura: null, midia: "imagem" } });
        }
        const params: Record<string, unknown> = { titulo: a.titulo, botao: a.botao };
        if (marca && marca.cor) params.cor = marca.cor;
        const r = porPeca(m, { peca: "cartao_final", inicio_s: Math.max(0, total - 3.5), duracao_s: Math.min(3.5, Math.max(1, total)), params, fonte: m.projeto.fontes[CHAVE_DA_LOGO] ? CHAVE_DA_LOGO : null });
        return { projeto: m.projeto, operacoes: m.operacoes, texto: `Cartão final em ${tempoFino(r.inicio_s)}${m.projeto.fontes[CHAVE_DA_LOGO] ? " com a logo" : " (sem logo no kit)"}.`, ok: true };
      }
      // ---------------------------------------------------------------- 02/10: o resto do que a tela faz
      case "entender_video":
        return { projeto: p, operacoes: [], texto: textoDoEntendimento(entendimentoDoVideo(p), 12000), ok: true };
      case "aplicar_referencia": {
        const lista = p.referencias || [];
        if (!lista.length) throw new ErroDaOperacao("Nenhuma referência no projeto. Ponha o vídeo de referência em Referências (link ou arquivo) e meça (sem custo).");
        const ref = String(a.referencia || "").trim();
        const r = /^r\d+$/.test(ref) ? lista[Number(ref.slice(1)) - 1] : ref ? lista.find((x) => x.nome.toLowerCase().indexOf(ref.toLowerCase()) >= 0) : lista[lista.length - 1];
        if (!r) throw new ErroDaOperacao(`Não achei a referência ${ref}. Referências: ${lista.map((x, k) => `r${k + 1} ${x.nome}`).join(", ")}.`);
        const receita = normalizarReceita(r.receita);
        if (!receita) throw new ErroDaOperacao(`A referência ${r.nome} ainda não foi medida. Em Referências, clique em Medir (sem custo) e peça de novo.`);
        const fid = (FIDELIDADES_DA_RECEITA as string[]).indexOf(String(a.fidelidade)) >= 0 ? (String(a.fidelidade) as Fidelidade) : r.fidelidade;
        const prop = proporReceita(p, receita, fid, { agora }, r.nome);
        const avisos = prop.avisos.length ? ` ${prop.avisos.join(" ")}` : "";
        if (!prop.operacoes.length) return { projeto: p, operacoes: [], texto: `${prop.titulo}: ${prop.resumo}${avisos}`, ok: !prop.avisos.length };
        return { projeto: prop.resultado, operacoes: prop.operacoes, texto: `${prop.titulo} (${fid}): ${prop.resumo}${avisos}`, ok: true };
      }
      case "editar_clipe": {
        const ref = String(a.clipe || "");
        const id = ap.porApelido[ref];
        if (!id) throw new ErroDeApelido(`Não existe ${ref || "o clipe"}. Clipes: ${ap.lista.map((x) => x.apelido).slice(0, 40).join(", ")}.`);
        const achado = acharClipe(p, id);
        if (!achado) throw new ErroDeApelido(`O ${ref} já saiu do projeto neste pedido.`);
        const { clipe: c, trilha: t } = achado;
        const estilo: Record<string, unknown> = { ...((c.estilo || {}) as Record<string, unknown>) };
        const campos: Record<string, unknown> = {};
        const mudou: string[] = [];
        if (a.texto !== undefined) {
          if (t.tipo !== "texto" && t.tipo !== "legenda") throw new ErroDaOperacao(`${ref} não é texto nem legenda.`);
          campos.texto = String(a.texto || "").replace(/\s+/g, " ").trim().slice(0, 500) || null;
          mudou.push("texto");
        }
        if (a.estilo !== undefined) {
          const v = String(a.estilo);
          const valido = t.tipo === "legenda" ? presetDaLegendaValido(v) : presetDoTextoValido(v);
          if (!valido) throw new ErroDaOperacao(`Estilo ${v} não existe para ${t.tipo === "legenda" ? "legenda" : "texto"}.`);
          estilo.preset = v;
          mudou.push("estilo");
        }
        if (a.params && typeof a.params === "object") {
          const peca = estilo.peca;
          if (typeof peca !== "string") throw new ErroDaOperacao(`${ref} não é uma peça de motion.`);
          const novos = { ...((estilo.params || {}) as Record<string, unknown>), ...(a.params as Record<string, unknown>) };
          try {
            parametrosDaPeca(peca as IdDaPeca, novos);
          } catch (e) {
            throw new ErroDaOperacao(e instanceof Error ? e.message : "Parâmetro inválido.");
          }
          estilo.params = novos;
          mudou.push(`params (${Object.keys(a.params as object).join(", ")})`);
        }
        if (a.fundo !== undefined) {
          if (!/^#[0-9a-fA-F]{6}$/.test(String(a.fundo))) throw new ErroDaOperacao("Fundo é uma cor #RRGGBB.");
          estilo.fundo = String(a.fundo);
          mudou.push("fundo");
        }
        if (mudou.some((x) => x !== "texto")) campos.estilo = estilo;
        const ops: Operacao[] = [];
        if (Object.keys(campos).length) ops.push({ op: "propriedades", clipe: ref, campos });
        if (a.duracao_s !== undefined) {
          const d = num(a.duracao_s);
          if (!(d >= 0.3 && d <= 120)) throw new ErroDaOperacao("Duração de 0,3 s a 120 s.");
          ops.push({ op: "aparar", clipe: ref, lado: "fim", tempo_s: c.inicio_s + d });
          mudou.push("duração");
        }
        if (!ops.length) throw new ErroDaOperacao("Diga o que mudar: texto, estilo, params, fundo ou duracao_s.");
        return aplicar(ops, `Editei ${ref}: ${mudou.join(", ")}.`);
      }
      case "transicao": {
        const tipo = String(a.tipo || "");
        if ((TIPOS_DE_TRANSICAO as readonly string[]).indexOf(tipo) < 0) throw new ErroDaOperacao(`Transição desconhecida: ${tipo || "sem nome"}. Tipos: ${TIPOS_DE_TRANSICAO.join(", ")}.`);
        const d = isNaN(num(a.duracao_s)) ? 0.3 : Math.max(0.1, Math.min(1.5, num(a.duracao_s)));
        const valor = tipo === "corte" ? null : { tipo: tipo as TipoDeTransicao, duracao_s: d };
        const todos = String(a.clipe || "") === "todos";
        const principal = trilhaPrincipal(p);
        const alvos = todos ? (principal ? emOrdem(principal).slice(1).map((c) => ap.porId[c.id]).filter(Boolean) : []) : [String(a.clipe || "")];
        if (!alvos.length) throw new ErroDaOperacao("Sem clipe para a transição.");
        const lado = a.lado === "saida" || a.lado === "ambos" ? a.lado : "entrada";
        const campos = lado === "entrada" ? { transicao_entrada: valor } : lado === "saida" ? { transicao_saida: valor } : { transicao_entrada: valor, transicao_saida: valor };
        return aplicar(alvos.map((c): Operacao => ({ op: "propriedades", clipe: c, campos })), `Transição ${tipo} (${lado}) em ${alvos.length === 1 ? alvos[0] : `${alvos.length} clipes`}.`);
      }
      case "mixagem": {
        const campos: Record<string, number | boolean> = {};
        const faixa = (k: string, v: unknown, min: number, max: number) => {
          if (v === undefined) return;
          const n = num(v);
          if (isNaN(n)) throw new ErroDaOperacao(`${k} precisa ser número.`);
          campos[k] = Math.max(min, Math.min(max, n));
        };
        faixa("trilha_abaixo_da_voz_db", a.abaixo_da_voz_db, 12, 36);
        faixa("subida_nas_pausas_db", a.subida_nas_pausas_db, 0, 12);
        faixa("lufs_alvo", a.lufs_alvo, -23, -9);
        if (typeof a.duck === "boolean") campos.duck = a.duck;
        if (!Object.keys(campos).length) throw new ErroDaOperacao("Diga o que mudar na mixagem.");
        const o: Operacao = { op: "mixagem", campos };
        return { projeto: aplicarOperacao(p, o), operacoes: [o], texto: `Mixagem: ${Object.keys(campos).map((k) => `${k} ${campos[k]}`).join(", ")}.`, ok: true };
      }
      case "cena": {
        const d = isNaN(num(a.duracao_s)) ? 3 : Math.max(0.5, Math.min(30, num(a.duracao_s)));
        const hex = (v: unknown) => (/^#[0-9a-fA-F]{6}$/.test(String(v || "")) ? String(v) : null);
        const fundo = hex(a.fundo) || (marca && hex(marca.cor)) || "#111111";
        const fundo2 = hex(a.fundo2);
        const m = new Montador(p);
        if (!trilhaPrincipal(m.projeto)) m.aplicar({ op: "trilha_nova", tipo: "video" });
        const t = trilhaPrincipal(m.projeto);
        if (!t) throw new ErroDaOperacao("Sem trilha de vídeo.");
        const fimDaPrincipal = t.clipes.reduce((s, c) => Math.max(s, c.inicio_s + duracaoDoClipe(c)), 0);
        let ini = isNaN(num(a.inicio_s)) ? fimDaPrincipal : Math.max(0, num(a.inicio_s));
        // Dentro de um clipe: a cena entra no começo dele (e empurra o resto, com as outras trilhas juntas).
        const sob = t.clipes.find((c) => c.inicio_s < ini - 1e-6 && c.inicio_s + duracaoDoClipe(c) > ini + 1e-6);
        if (sob) ini = sob.inicio_s;
        const empurra = ini < fimDaPrincipal - 1e-6;
        if (empurra) {
          const passo = Math.ceil(d * m.projeto.fps - 1e-6) / m.projeto.fps;
          m.projeto.trilhas
            .filter((x) => x.id !== t.id)
            .forEach((x) =>
              x.clipes
                .filter((c) => c.inicio_s >= ini - 1e-6)
                .sort((c1, c2) => c2.inicio_s - c1.inicio_s)
                .forEach((c) => m.aplicar({ op: "mover", clipe: c.id, inicio_s: c.inicio_s + passo })),
            );
        }
        m.aplicar({ op: "inserir", trilha: t.id, empurrar: empurra, clipe: { inicio_s: ini, entrada_s: 0, saida_s: d, estilo: { fundo, ...(fundo2 ? { fundo2 } : {}) }, origem: { tipo: "manual", ref: "agente:cena" } } });
        const feitos = [`cena de ${tempoFino(d)} em ${tempoFino(ini)}`];
        if (a.titulo) {
          textoEm(m, String(a.titulo), ini + 0.15, Math.max(0.6, d - 0.3), presetDoTextoValido(a.estilo) ? String(a.estilo) : "titulo");
          feitos.push("título");
        }
        if (a.peca) {
          const peca = String(a.peca) as IdDaPeca;
          const def = definicaoDaPeca(peca);
          if (!def || peca === "logo") throw new ErroDaOperacao(`Peça desconhecida: ${peca}.`);
          porPeca(m, { peca, inicio_s: ini + 0.2, duracao_s: Math.max(0.6, Math.min(def.duracao_s, d - 0.2)), params: (a.params && typeof a.params === "object" ? a.params : {}) as Record<string, unknown> });
          feitos.push(`peça ${peca}`);
        }
        return { projeto: m.projeto, operacoes: m.operacoes, texto: `Pus ${feitos.join(", ")}${empurra ? "; o resto andou junto" : ""}.`, ok: true };
      }
      case "trocar_cenario": {
        const ref = String(a.clipe || "");
        const id = ap.porApelido[ref];
        if (!id) throw new ErroDeApelido(`Não existe ${ref || "o clipe"}. Clipes: ${ap.lista.filter((x) => x.tipo === "video").map((x) => x.apelido).join(", ")}.`);
        const cenario = String(a.cenario || "").replace(/\s+/g, " ").trim().slice(0, 400);
        if (cenario.length < 3) throw new ErroDaOperacao("Descreva o cenário novo.");
        return { projeto: p, operacoes: [], texto: `Abri Trocar cenário com ${ref} e o cenário "${cenario.slice(0, 80)}". O custo aparece no painel antes de gerar; nada foi gasto.`, ok: true, painel: { aba: "cenario", clipe: id, cenario } };
      }
      case "abrir_painel": {
        const aba = String(a.painel || "");
        if (PAINEIS_DO_EDITOR.indexOf(aba) < 0) throw new ErroDaOperacao(`Painel desconhecido: ${aba || "sem nome"}. Painéis: ${PAINEIS_DO_EDITOR.join(", ")}.`);
        return { projeto: p, operacoes: [], texto: `Abri o painel ${aba} na tela do dono.`, ok: true, painel: { aba } };
      }
      case "fechar_buracos":
      case "aplicar_skill": {
        const id = (ch.ferramenta === "fechar_buracos" ? "fechar_buracos" : String(a.skill || "")) as IdDaSkill;
        if (!skillPorId(id)) throw new ErroDaOperacao(`Skill desconhecida: ${id}.`);
        const selecionados = Array.isArray(a.selecionados) ? (a.selecionados as unknown[]).map((x) => ap.porApelido[String(x)]).filter(Boolean) : [];
        const prop = proporSkill(id, p, { agora, selecionados, assinaturas: opcoes.assinaturas || null }, (a.parametros && typeof a.parametros === "object" ? a.parametros : {}) as Record<string, string | number | boolean>);
        // Nada a mudar (sem buraco, sem repetido) não é falha; sem conseguir rodar (aviso) é.
        if (!prop.operacoes.length) return { projeto: p, operacoes: [], texto: `${prop.titulo}: ${prop.resumo}${prop.avisos.length ? ` ${prop.avisos.join(" ")}` : ""}`, ok: !prop.avisos.length };
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
  /** Frente EDT: marca aberta (logo e cor do kit). */
  marca?: MarcaParaOAgente | null;
  /** 02/10: a Mídia do cliente (m1, m2...) e o sha256 dos arquivos (takes repetidos). */
  midias?: ItemDaBiblioteca[] | null;
  assinaturas?: AssinaturasDosArquivos | null;
  /**
   * Frente EDT: ferramentas que chamam o servidor (sugerir_animacoes, medir_onda,
   * amostra) e as saídas pagas (gerar_broll, gerar_elemento: só estimam o custo).
   */
  servidor?: (ch: ChamadaDeFerramenta, projeto: ProjetoDeEdicao) => Promise<ResultadoDaFerramenta>;
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
  /** Frente SPP: "Método: ..." (anexo metodo_usado do servidor). */
  metodo: unknown | null;
  /** Último uso registrado (liga a mensagem ao gasto). */
  uso_id: string | null;
  /** Frente EDT: cartões pagos preparados (custo antes) e pedidos já na fila do worker. */
  saidas: SaidaDoAgente[];
  naFila: NonNullable<ResultadoDaFerramenta["naFila"]>[];
  /** 02/10: filtro que o agente pôs na tela (o último buscar). */
  filtro: FiltroDaBusca | null;
  /** 02/10: o que mudou, em apelidos ("Tirei c3, c5. Movi c2."), feito pelo código e não pelo modelo. */
  mudancas: string;
  /** Clipes que o pedido mexeu e ainda estão na linha do tempo (destaque na tela). */
  tocados: string[];
  /**
   * 02/10 (dono: "o agente alucina"): o que mudou de verdade, contado pelo
   * código comparando o projeto antes e depois (relatorio.ts). A mensagem
   * final sai daqui, nunca do texto livre do modelo.
   */
  itensMudados: string[];
  /** Ferramentas que não entraram, com o motivo (vai na mensagem final). */
  naoEntrou: string[];
  /** Pergunta do agente (dúvida real), quando houver. */
  pergunta: string | null;
  /** Painéis que o agente pediu para abrir na tela do dono. */
  paineis: PedidoDePainel[];
  /** A regra da casa rodou a edição completa porque o modelo não editou um pedido de edição completa. */
  regraDaCasa: boolean;
  /** 02/10: o que NÃO foi feito porque o dono pediu (sem legenda, só cortes...). */
  porPedido?: string[];
  /** 02/10: o checklist de engajamento da edição completa (gancho, ritmo, interrupções, chamada). */
  engajamento?: string[];
  /**
   * Núcleo das Mesas (09/10): a resposta final quando o servidor a conferiu (quadro conferido contra as
   * leituras do OS) ou encaminhou ao Hermes. Só isso do texto do modelo pode ir ao dono além da pergunta.
   */
  apresentacao?: string | null;
}

const semAcentoDoPedido = (t: string) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Pedido que manda mexer no vídeo (editar, cortar, legendar, pôr música...). */
export function pedidoDeEdicao(texto: string): boolean {
  const t = semAcentoDoPedido(texto);
  if (/\?\s*$/.test(t.trim()) && !/\b(pode|consegue|da pra|faz)\b/.test(t)) return false;
  return /\b(edit|edicao|edita|corta|corte|cortar|legend|dinamic|brabo|completo|completa|musica|trilha|punch|zoom|anima|motion|arte|b-?roll|cor\b|look|lut|formato|reenquadr|transic|efeito|texto|titulo|gancho|capitul|tira|remov|apaga|monta|deixa|faz|faca|coloca|poe|ponha)/.test(t);
}

/**
 * Pedido da edição inteira ("edita completo e dinâmico", "edita esse vídeo",
 * "faz a edição com o Brabo"): o motor da casa (EDIT IA PRO) resolve sozinho
 * se o modelo não editar.
 */
export function pedidoDeEdicaoCompleta(texto: string): boolean {
  const t = semAcentoDoPedido(texto);
  if (/\b(so|apenas|somente) (o|a|as|os)? ?(ritmo|batidas|legenda|corte|cor|musica)\b/.test(t)) return false;
  return /\b(edicao|edita|editar|edite|editado)\b.{0,40}\b(complet|dinamic|inteir|tudo|toda|brabo|pro\b|profission)/.test(t) || /\b(complet|dinamic|inteir)[a-z]*\b.{0,30}\b(edicao|edita|editar|edite)\b/.test(t) || /\bedit ia pro\b/.test(t) || /^(edita|edite|editar|pode editar)( (ele|ela|esse|este|o|isso) ?(video)?)?( (pra|para) mim| por favor| ai)?[.!]*$/.test(t.trim()) || /\b(skill|metodo|jeito) do brabo\b/.test(t);
}

/**
 * A mensagem final do agente, feita pelo CÓDIGO (02/10): o que mudou de verdade
 * (comparando o projeto antes e depois), o que não entrou e, quando houver, a
 * pergunta. O texto livre do modelo que afirma ou promete mudança nunca entra.
 */
export function mensagemFinalDoAgente(r: Pick<ResultadoDoAgente, "operacoes" | "itensMudados" | "mudancas" | "naoEntrou" | "pergunta" | "parado" | "regraDaCasa" | "porPedido" | "engajamento">, aplicado: boolean): string {
  const partes: string[] = [];
  const mudou = r.operacoes.length > 0 && (r.itensMudados.length > 0 || !!r.mudancas);
  if (mudou) {
    const lista = [r.mudancas].concat(r.itensMudados).filter(Boolean).join(" ");
    partes.push(`${aplicado ? "Mudei" : "Vou mudar (confirme no cartão)"}: ${lista}${aplicado ? " O Desfazer volta tudo." : ""}`);
    if (r.regraDaCasa) partes.push("O modelo não editou: rodei a edição completa da casa (EDIT IA PRO).");
  } else partes.push(r.parado ? "Parei antes de mudar a linha do tempo." : "Nada mudou na linha do tempo.");
  if (r.porPedido && r.porPedido.length) partes.push(`Não fiz porque você pediu: ${r.porPedido.slice(0, 8).join("; ")}.`);
  if (r.engajamento && r.engajamento.length && mudou) partes.push(`Engajamento: ${r.engajamento.join("; ")}.`);
  if (r.naoEntrou.length) partes.push(`Não entrou: ${r.naoEntrou.slice(0, 6).join("; ")}.`);
  if (r.pergunta) partes.push(r.pergunta);
  else if (!mudou && !r.naoEntrou.length && !r.parado) partes.push("O agente não chamou nenhuma ferramenta que muda o vídeo. Diga o que mudar (ex.: edita completo e dinâmico).");
  return partes.join(" ");
}

/** Ferramenta que muda (ou pode mudar) a linha do tempo. */
const muda = (nome: string) => FERRAMENTAS_DO_AGENTE.some((f) => f.nome === nome && !f.leitura);

/**
 * Conferência pelo código depois de cada ferramenta que muda o projeto (02/10):
 * o que entrou de verdade, comparando o projeto antes e depois dela.
 */
export function conferencia(antes: ProjetoDeEdicao, depois: ProjetoDeEdicao, x: Pick<ResultadoDaFerramenta, "ok" | "operacoes">): { texto: string; falhou: boolean } {
  if (!x.ok) return { texto: "Conferido: não entrou nada (veja o erro e corrija, ou diga ao dono).", falhou: true };
  if (!x.operacoes.length) return { texto: "Conferido: nada a mudar.", falhou: false };
  const itens = itensDoQueMudou(antes, depois);
  return { texto: `Conferido: ${itens.length ? itens.join(" ") : `${x.operacoes.length} ajustes finos (tempo, volume, estilo).`}`, falhou: false };
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
  metodo_usado?: unknown;
  /** Núcleo das Mesas: leituras do passo 1 (nomes), se já encaminhou ao Hermes e se a resposta veio conferida. */
  nucleo?: { leituras?: unknown; encaminhado?: boolean; conferido?: boolean };
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

/**
 * O laço (02/10, dono: "o agente alucina, não faz o que eu peço, para no
 * meio"): planejar, executar, CONFERIR e seguir.
 * - cada ferramenta que muda o projeto volta com a linha "Conferido" feita
 *   pelo código (o que entrou de verdade, antes e depois);
 * - o modelo que diz "terminei" com ferramenta que falhou ganha mais um passo
 *   para corrigir (até 2 vezes), e o pedido de edição que terminou sem mudar
 *   nada ganha um lembrete (uma vez);
 * - pedido da edição completa que o modelo não editou: a regra da casa roda o
 *   EDIT IA PRO (edicao_completa) sozinha, sem custo de modelo;
 * - a mensagem final sai do código (mensagemFinalDoAgente), nunca do texto
 *   livre do modelo.
 */
export async function rodarAgente(e: PedidoAoAgente): Promise<ResultadoDoAgente> {
  let trabalho = e.projeto;
  const operacoes: Operacao[] = [];
  const log: ItemDoLog[] = [];
  const historico: { papel: "usuario" | "agente"; conteudo: string }[] = [];
  const ap = apelidosDoProjeto(e.projeto);
  // Apelidos estáveis no pedido inteiro (o c3 do passo 1 é o c3 do passo 4).
  let mapa: Apelidos = ap;
  let filtro: FiltroDaBusca | null = null;
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
  let paradoPeloDono = false;
  let terminouBem = false;
  let exportar = false;
  let opcoes: string[] = [];
  let aprendido: unknown = null;
  let seguidas: unknown = null;
  let metodo: unknown = null;
  let usoId: string | null = null;
  let reforcos = 0;
  let lembrouDeEditar = false;
  let regraDaCasa = false;
  const naoEntrou: string[] = [];
  const saidas: SaidaDoAgente[] = [];
  const paineis: PedidoDePainel[] = [];
  const naFila: NonNullable<ResultadoDaFerramenta["naFila"]>[] = [];
  // O que o dono escreveu (sem a dica que a tela junta no fim).
  const doDono = String(e.pedido || "").split("\n\n(Dica da tela:")[0];
  const ehEdicao = pedidoDeEdicao(doDono);
  // 02/10 (auditoria: "pedi sem legenda e veio legenda"): o pedido do dono é lei em TODA ferramenta.
  const pedidoDoDono = lerPedidoDoDono(doDono);
  const porPedido: string[] = [];
  let engajamento: string[] = [];
  // Núcleo das Mesas: as leituras que o passo 1 escolheu (o servidor relê nos passos seguintes) e o Hermes (uma vez).
  let nucleoLeituras: string[] = [];
  let nucleoEncaminhado = false;
  let apresentacao: string | null = null;

  /** Roda uma chamada (aqui ou no servidor), confere e guarda; devolve a linha de resultado para o modelo. */
  const rodar = async (c0: ChamadaDeFerramenta): Promise<{ linha: string; falhou: boolean }> => {
    usadas++;
    const barrada = ferramentaBarrada(pedidoDoDono, c0.ferramenta, c0.argumentos || {});
    if (barrada) {
      const motivo = /\(([^)]+)\)/.exec(barrada);
      if (motivo && porPedido.indexOf(motivo[1]) < 0) porPedido.push(motivo[1]);
      log.push({ tipo: "aviso", texto: `${c0.ferramenta}: ${barrada}` });
      return { linha: `${c0.ferramenta}: ${barrada}`, falhou: false };
    }
    // A edição completa recebe o texto do dono (as negações valem lá dentro também).
    const c: ChamadaDeFerramenta = c0.ferramenta === "edicao_completa" ? { ...c0, argumentos: { ...(c0.argumentos || {}), pedido_do_dono: doDono } } : c0;
    const noServidor = FERRAMENTAS_DO_SERVIDOR.indexOf(c.ferramenta) >= 0 || (FERRAMENTAS_DE_SAIDA.indexOf(c.ferramenta) >= 0 && c.ferramenta.indexOf("gerar_") === 0);
    const antes = trabalho;
    let x: ResultadoDaFerramenta;
    if (noServidor) {
      try {
        x = e.servidor ? await e.servidor(c, trabalho) : { projeto: trabalho, operacoes: [], texto: "Indisponível aqui.", ok: false };
      } catch (err) {
        console.error("[agente editor] ferramenta do servidor falhou", c.ferramenta, err);
        x = { projeto: trabalho, operacoes: [], texto: `Erro em ${c.ferramenta}: ${err instanceof Error ? err.message.slice(0, 160) : "falhou"}`, ok: false };
      }
    } else x = executarFerramenta(trabalho, c, e.agora, e.marca || null, { apelidos: mapa, midias: e.midias || null, assinaturas: e.assinaturas || null, cursor_s: e.tela && typeof e.tela.cursor_s === "number" ? e.tela.cursor_s : null });
    trabalho = x.projeto;
    mapa = apelidosEstaveis(trabalho, mapa);
    if (c.ferramenta === "edicao_completa") {
      x.texto.split("\n").forEach((l) => {
        const pp = /^não feito por pedido ([^:]+): Não feito: (.+)$/.exec(l);
        if (pp && porPedido.indexOf(pp[2].replace(/\.$/, "")) < 0) porPedido.push(pp[2].replace(/\.$/, ""));
        if (l.indexOf("engajamento: ") === 0) engajamento = l.slice(13).split("; ");
      });
    }
    if (x.filtro) filtro = x.filtro;
    x.operacoes.forEach((o) => operacoes.push(o));
    if (x.exportar) exportar = true;
    if (x.saida) saidas.push(x.saida);
    if (x.naFila) naFila.push(x.naFila);
    if (x.painel) paineis.push(x.painel);
    if (!x.ok) {
      falhas++;
      naoEntrou.push(`${c.ferramenta}: ${x.texto.replace(/^Erro em [a-z_]+: /, "").split("\n")[0].slice(0, 140)}`);
    } else {
      // Corrigida no passo seguinte (a mesma ferramenta entrou): a falha antiga sai da lista.
      for (let k = naoEntrou.length - 1; k >= 0; k--) if (naoEntrou[k].indexOf(`${c.ferramenta}:`) === 0) naoEntrou.splice(k, 1);
    }
    const conf = muda(c.ferramenta) ? conferencia(antes, trabalho, x) : null;
    log.push({ tipo: "ferramenta", texto: `${c.ferramenta}${x.ok ? "" : " (não deu)"}: ${x.texto.split("\n")[0].slice(0, 160)}` });
    return { linha: `${c.ferramenta}: ${x.texto}${conf ? `\n${conf.texto}` : ""}`, falhou: !x.ok };
  };

  while (passo < MAX_PASSOS) {
    if (e.cancelado && e.cancelado()) {
      log.push({ tipo: "aviso", texto: `Parado pelo dono depois de ${passo} ${passo === 1 ? "passo" : "passos"}. O que já saiu fica para você conferir.` });
      parado = true;
      paradoPeloDono = true;
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
        contexto: contextoDoAgente(trabalho, 50000, { ...(e.tela || {}), selecionados: (e.tela && e.tela.selecionados) || [] }, { apelidos: mapa, midias: e.midias || null, assinaturas: e.assinaturas || null }),
        historico,
        conversa: e.conversa || undefined,
        itens_referencia: itens,
        selecionados,
        referencia: referencia || undefined,
        nucleo_leituras: passo > 1 && nucleoLeituras.length ? nucleoLeituras : undefined,
        nucleo_encaminhado: nucleoEncaminhado || undefined,
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
    if (r && r.metodo_usado) metodo = r.metodo_usado;
    const nucleo = r && r.nucleo;
    if (nucleo && passo === 1 && Array.isArray(nucleo.leituras)) nucleoLeituras = nucleo.leituras.map(String).slice(0, 3);
    if (nucleo && nucleo.encaminhado) nucleoEncaminhado = true;
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
    let falhouNoPasso = false;
    for (const c of chamadas.slice(0, cabem)) {
      if (e.cancelado && e.cancelado()) break;
      const x = await rodar(c);
      resultados.push(x.linha);
      if (x.falhou) falhouNoPasso = true;
    }
    if (chamadas.length > cabem) {
      recusadas += chamadas.length - cabem;
      log.push({ tipo: "aviso", texto: `${chamadas.length - cabem} ${chamadas.length - cabem === 1 ? "ferramenta ficou" : "ferramentas ficaram"} de fora: limite de ${MAX_FERRAMENTAS} por pedido.` });
    }
    if (p.resposta) resposta = p.resposta;
    // Núcleo: a resposta que o servidor conferiu (quadro do OS) ou que levou o pedido ao Hermes fica para o dono.
    if (p.resposta && nucleo && (nucleo.conferido || nucleo.encaminhado)) apresentacao = p.resposta;
    if (Array.isArray(p.opcoes) && p.opcoes.length && !chamadas.length) opcoes = p.opcoes.slice(0, 4);
    if (e.aoPasso) e.aoPasso(log.slice(), gasto, passo);
    if (r && r.parou) {
      // O servidor parou pelo teto ou pelo limite: a resposta dele diz o motivo.
      parado = true;
      if (p.resposta) log.push({ tipo: "aviso", texto: p.resposta });
      resposta = "";
      break;
    }
    const pediuParar = p.terminou || !chamadas.length;
    let lembrete = "";
    if (pediuParar && passo < MAX_PASSOS && usadas < MAX_FERRAMENTAS && !opcoes.length) {
      // Conferir antes de parar: ferramenta que falhou ganha a chance de corrigir; edição sem mudança, o lembrete.
      if (falhouNoPasso && reforcos < 2) {
        reforcos++;
        lembrete = "Conferência do código: alguma ferramenta não entrou (veja acima). Corrija os argumentos ou use outra ferramenta e termine; se não der, termine dizendo o que faltou.";
      } else if (ehEdicao && !operacoes.length && !saidas.length && !exportar && !paineis.length && !lembrouDeEditar && !respostaEhPergunta(p.resposta)) {
        lembrouDeEditar = true;
        lembrete = "Conferência do código: o pedido é de edição e nada mudou na linha do tempo. Edite agora com as ferramentas (edição inteira = edicao_completa) ou faça UMA pergunta curta se houver dúvida real.";
      }
    }
    if (pediuParar && !lembrete) {
      terminouBem = true;
      break;
    }
    historico.push({ papel: "agente", conteudo: JSON.stringify({ plano: p.plano, chamadas: p.chamadas }) });
    historico.push({ papel: "usuario", conteudo: `Resultados:\n${resultados.join("\n") || "(nenhuma ferramenta)"}${lembrete ? `\n\n${lembrete}` : ""}\n\nClipes agora (apelidos fixos neste pedido):\n${resumoParaOAgente(trabalho, mapa, { maxPorTrilha: 40 })}` });
  }
  if (!terminouBem && !parado && passo >= MAX_PASSOS) {
    parado = true;
    log.push({ tipo: "aviso", texto: `Parou no limite de ${MAX_PASSOS} passos sem o agente dizer que terminou. Confira o que já saiu.` });
  }
  // Regra da casa: "edita completo" que o modelo não editou vira o EDIT IA PRO (sem modelo, sem custo).
  if (!operacoes.length && !paradoPeloDono && !opcoes.length && pedidoDeEdicaoCompleta(doDono) && e.servidor) {
    const x = await rodar({ ferramenta: "edicao_completa", argumentos: { receita: "dinamico" } });
    if (operacoes.length) {
      regraDaCasa = true;
      log.push({ tipo: "aviso", texto: "O modelo não editou: a regra da casa rodou a edição completa (EDIT IA PRO)." });
    } else if (!x.falhou) naoEntrou.push("edicao_completa: nada a montar com este vídeo");
  }
  const mudancas = operacoes.length && operacoes.length <= 12 ? resumoDoQueMudou(e.projeto, operacoes, mapa, { soClipes: true }) : "";
  const itensMudados = operacoes.length ? itensDoQueMudou(e.projeto, trabalho) : [];
  const tocados = clipesTocados(operacoes, trabalho, e.projeto);
  // O texto livre do modelo só fica quando é pergunta (dúvida real); afirmação ou promessa de mudança nunca.
  const pergunta = (opcoes.length || respostaEhPergunta(resposta)) && !respostaAfirma(resposta) && !respostaPromete(resposta) ? resposta : null;
  const parcial = { operacoes, itensMudados, mudancas, naoEntrou, pergunta, parado, regraDaCasa, porPedido, engajamento };
  log.push({ tipo: "resposta", texto: mensagemFinalDoAgente(parcial, true) });
  return { operacoes, resultado: trabalho, log, resposta, gasto_usd: gasto, passos: passo, ferramentas: usadas, falhas, recusadas, parado, exportar, opcoes, aprendido, seguidas, metodo, uso_id: usoId, saidas, naFila, filtro, mudancas, tocados, itensMudados, naoEntrou, pergunta, paineis, regraDaCasa, porPedido, engajamento, apresentacao };
}

/**
 * Núcleo das Mesas (09/10): a mensagem final com a resposta conferida. Sem mudança na linha do tempo, a
 * resposta conferida (quadro do OS ou Hermes) é a mensagem; com mudança, vem depois do relatório do código.
 * Texto que afirma ou promete mudança nunca entra (o relatório do código continua sendo a verdade).
 */
export function mensagemComApresentacao(final: string, r: Pick<ResultadoDoAgente, "operacoes" | "naoEntrou" | "apresentacao">): string {
  const a = String(r.apresentacao || "").trim();
  if (!a) return final;
  const prosa = a.replace(/```[\s\S]*?```/g, " ");
  if (respostaAfirma(prosa) || respostaPromete(prosa)) return final;
  if (!r.operacoes.length && !r.naoEntrou.length) return a;
  return `${final}\n\n${a}`;
}

/** Resposta que é uma pergunta ao dono. */
export const respostaEhPergunta = (t: string | null | undefined) => /\?\s*$/.test(String(t || "").trim());

const VERBO_DO_RESUMO: Partial<Record<Operacao["op"], string>> = {
  remover: "Tirei",
  mover: "Movi",
  dividir: "Dividi",
  aparar: "Aparei",
  recortar: "Cortei um trecho de",
  propriedades: "Ajustei",
  inserir: "Pus",
  reordenar: "Reordenei",
  ondular: "Encostei",
};

/**
 * O que mudou, dito pelo CÓDIGO (02/10): o dono quer ver o que o agente fez com
 * os apelidos que ele vê na linha do tempo. "Tirei c3, c5. Movi c2. Pus 2 clipes."
 */
export function resumoDoQueMudou(antes: ProjetoDeEdicao, ops: Operacao[], apelidos?: Apelidos | null, opcoes: { soClipes?: boolean } = {}): string {
  // Os apelidos do fim do pedido (clipe novo) e os do começo (o que saiu).
  const a = { porId: { ...apelidosDoProjeto(antes).porId, ...(apelidos ? apelidos.porId : {}) } };
  const porVerbo: Record<string, string[]> = {};
  let inseridos = 0;
  let outras = 0;
  const trilhas: string[] = [];
  ops.forEach((o) => {
    if (o.op === "inserir") {
      inseridos++;
      return;
    }
    if (o.op === "ondular" || o.op === "reordenar") {
      const t = antes.trilhas.find((x) => x.id === o.trilha);
      const nome = t ? (t.nome || t.id).toLowerCase() : o.trilha;
      if (trilhas.indexOf(`${o.op}:${nome}`) < 0) trilhas.push(`${o.op}:${nome}`);
      return;
    }
    const verbo = VERBO_DO_RESUMO[o.op];
    const clipe = "clipe" in o ? String((o as { clipe: string }).clipe) : "";
    if (!verbo || !clipe) {
      if (o.op !== "registrar_skill" && o.op !== "fonte" && o.op !== "trilha_nova") outras++;
      return;
    }
    const ap = a.porId[clipe] || "clipe novo";
    porVerbo[verbo] = porVerbo[verbo] || [];
    if (porVerbo[verbo].indexOf(ap) < 0) porVerbo[verbo].push(ap);
  });
  const frases = Object.keys(porVerbo).map((v) => `${v} ${porVerbo[v].join(", ")}.`);
  trilhas.forEach((x) => {
    const [op, nome] = x.split(":");
    frases.push(op === "ondular" ? `Encostei a ${nome}.` : `Reordenei a ${nome}.`);
  });
  // soClipes (02/10): o resto (legendas, peças, cor) quem conta é o relatório do antes e depois.
  if (inseridos && (!opcoes.soClipes || inseridos <= 2)) frases.push(`Pus ${inseridos} ${inseridos === 1 ? "clipe novo" : "clipes novos"}.`);
  if (outras && !opcoes.soClipes) frases.push(`Mais ${outras} ${outras === 1 ? "ajuste" : "ajustes"} (cor, formato, trilhas ou marcadores).`);
  return frases.join(" ");
}

/** Clipes mexidos que continuam no projeto (para destacar na linha do tempo). */
export function clipesTocados(ops: Operacao[], depois: ProjetoDeEdicao, antes?: ProjetoDeEdicao | null): string[] {
  const existe = new Set<string>();
  depois.trilhas.forEach((t) => t.clipes.forEach((c) => existe.add(c.id)));
  const ids: string[] = [];
  if (antes) {
    const velhos = new Set<string>();
    antes.trilhas.forEach((t) => t.clipes.forEach((c) => velhos.add(c.id)));
    existe.forEach((id) => !velhos.has(id) && ids.push(id));
  }
  ops.forEach((o) => {
    const id = "clipe" in o && typeof (o as { clipe: unknown }).clipe === "string" ? (o as { clipe: string }).clipe : o.op === "inserir" && o.clipe.id ? String(o.clipe.id) : null;
    if (id && existe.has(id) && ids.indexOf(id) < 0) ids.push(id);
  });
  return ids;
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
