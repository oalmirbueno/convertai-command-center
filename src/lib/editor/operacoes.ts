import {
  clipeNovo,
  duracaoDoClipe,
  duracaoDoProjeto,
  MAX_CLIPES_POR_TRILHA,
  MAX_DURACAO_S,
  MAX_MARCADORES,
  MAX_SKILLS_NO_HISTORICO,
  MAX_TRILHAS,
  ROTULO_DA_TRILHA,
  trilhaVazia,
  type ClipeDoProjeto,
  type ContinuidadeDoProjeto,
  type FonteDoProjeto,
  type ProjetoDeEdicao,
  type TipoDeTrilha,
  type TranscricaoDaFonte,
  type TrilhaDoProjeto,
  type VisaoDaFonte,
  type ReferenciaDeEdicao,
  type OndaDaFonte,
  type MixagemDoProjeto,
  type CorDoProjeto,
  type EnquadramentoDoProjeto,
  type IdentidadeDoVideo,
  type RastroDoRosto,
  type TipoDeMarcador,
  comFormato,
  FORMATOS_DO_PROJETO,
  MAX_REFERENCIAS,
} from "../../../supabase/functions/_shared/projeto-de-edicao";
import { arred, noQuadro, umQuadro } from "./tempo";

/**
 * Operações da linha do tempo (frente V-B). FUNÇÕES PURAS: recebem o projeto e
 * devolvem um projeto novo (o antigo não muda, o desfazer guarda o anterior).
 *
 * É a única porta de mudança do projeto: a mão (arrastar, aparar, S para
 * dividir), as skills e o agente geram listas destas operações. Tempos caem
 * sempre num quadro do projeto. Operação impossível (clipe que não existe,
 * corte fora do clipe, sobreposição) lança ErroDaOperacao com o motivo, e nada
 * muda: não existe "quase aplicou".
 *
 * Tempos: `inicio_s`, `em_s` e `tempo_s` são da LINHA DO TEMPO; `de_s`/`ate_s`
 * do recortar e `entrada_s`/`saida_s` são da FONTE.
 */

export type CamposDoClipe = Partial<
  Pick<ClipeDoProjeto, "velocidade" | "volume" | "texto" | "estilo" | "transicao_entrada" | "transicao_saida" | "zoom" | "cena_ref" | "nota" | "comparar" | "origem">
>;

export type Operacao =
  | { op: "dividir"; clipe: string; em_s: number }
  | { op: "aparar"; clipe: string; lado: "inicio" | "fim"; tempo_s: number }
  | { op: "mover"; clipe: string; inicio_s: number; trilha?: string }
  | { op: "remover"; clipe: string; ondular?: boolean }
  | { op: "recortar"; clipe: string; de_s: number; ate_s: number }
  | { op: "inserir"; trilha: string; clipe: Partial<ClipeDoProjeto> & { inicio_s: number; entrada_s: number; saida_s: number }; empurrar?: boolean }
  | { op: "propriedades"; clipe: string; campos: CamposDoClipe }
  | { op: "ondular"; trilha: string }
  | { op: "reordenar"; trilha: string; ordem: string[] }
  | { op: "limpar_trilha"; trilha: string }
  | { op: "trilha_nova"; tipo: TipoDeTrilha }
  | { op: "trilha"; trilha: string; campos: Partial<Pick<TrilhaDoProjeto, "muda" | "oculta" | "nome">> }
  | { op: "fonte"; fonte: FonteDoProjeto }
  | { op: "transcricao"; fonte: string; transcricao: TranscricaoDaFonte }
  | { op: "visao"; fonte: string; visao: VisaoDaFonte }
  | { op: "referencias"; lista: ReferenciaDeEdicao[] }
  | { op: "continuidade"; campos: Partial<ContinuidadeDoProjeto> }
  | { op: "marcador"; tempo_s: number; rotulo: string; tipo?: TipoDeMarcador; fim_s?: number | null; nota?: number | null }
  /** Frente EDT, rodada 2: troca a lista de marcadores de um tipo (capítulos, momentos virais) de uma vez. */
  | { op: "marcadores"; tipo: TipoDeMarcador; lista: { tempo_s: number; rotulo: string; fim_s?: number | null; nota?: number | null }[] }
  | { op: "remover_marcador"; id: string }
  | { op: "formato"; formato: string }
  | { op: "cor"; campos: Partial<CorDoProjeto> }
  | { op: "rosto"; fonte: string; rastro: RastroDoRosto | null }
  | { op: "enquadramento"; campos: Partial<EnquadramentoDoProjeto> }
  | { op: "identidade"; identidade: IdentidadeDoVideo | null }
  | { op: "onda"; fonte: string; onda: OndaDaFonte }
  | { op: "mixagem"; campos: Partial<MixagemDoProjeto> }
  | { op: "registrar_skill"; skill: string; resumo: string; em: string };

export class ErroDaOperacao extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = "ErroDaOperacao";
  }
}

// ------------------------------------------------------------------ leitura

export const fimDoClipe = (c: ClipeDoProjeto) => arred(c.inicio_s + duracaoDoClipe(c));

export function acharClipe(p: ProjetoDeEdicao, id: string): { trilha: TrilhaDoProjeto; clipe: ClipeDoProjeto; ti: number; ci: number } | null {
  for (let ti = 0; ti < p.trilhas.length; ti++) {
    const t = p.trilhas[ti];
    for (let ci = 0; ci < t.clipes.length; ci++) if (t.clipes[ci].id === id) return { trilha: t, clipe: t.clipes[ci], ti, ci };
  }
  return null;
}

export const acharTrilha = (p: ProjetoDeEdicao, id: string) => p.trilhas.find((t) => t.id === id) || null;

/** Clipes da trilha na ordem da linha do tempo. */
export const emOrdem = (t: TrilhaDoProjeto) => t.clipes.slice().sort((a, b) => a.inicio_s - b.inicio_s || (a.id < b.id ? -1 : 1));

/** Primeira trilha de vídeo (a principal). */
export const trilhaPrincipal = (p: ProjetoDeEdicao) => p.trilhas.find((t) => t.tipo === "video") || null;

const PREFIXO: Record<TipoDeTrilha, string> = { video: "v", texto: "t", legenda: "l", audio: "a", sobreposicao: "s", ajuste: "e" };

/** Próximo id livre com o prefixo da trilha (v7, l12): determinístico, nunca repete. */
export function novoId(p: ProjetoDeEdicao, tipo: TipoDeTrilha, reservados: string[] = []): string {
  const prefixo = PREFIXO[tipo];
  let maior = 0;
  const olhar = (id: string) => {
    if (id.indexOf(prefixo) !== 0) return;
    const n = Number(id.slice(prefixo.length));
    if (isFinite(n) && n > maior) maior = n;
  };
  p.trilhas.forEach((t) => t.clipes.forEach((c) => olhar(c.id)));
  reservados.forEach(olhar);
  return `${prefixo}${maior + 1}`;
}

/** Algum clipe da trilha (menos `exceto`) ocupa parte de [ini, fim)? Encostar não conta. */
export function colide(t: TrilhaDoProjeto, ini: number, fim: number, exceto?: string): ClipeDoProjeto | null {
  const folga = 0.0005;
  return t.clipes.find((c) => c.id !== exceto && c.inicio_s < fim - folga && fimDoClipe(c) > ini + folga) || null;
}

/** Trilhas que aceitam o clipe: vídeo e sobreposição trocam entre si; o resto só com o mesmo tipo. */
export function trilhasCompativeis(a: TipoDeTrilha, b: TipoDeTrilha): boolean {
  if (a === b) return true;
  if (a === "ajuste" || b === "ajuste") return false;
  const visuais: TipoDeTrilha[] = ["video", "sobreposicao"];
  const textos: TipoDeTrilha[] = ["texto", "legenda"];
  return (visuais.indexOf(a) >= 0 && visuais.indexOf(b) >= 0) || (textos.indexOf(a) >= 0 && textos.indexOf(b) >= 0);
}

// ------------------------------------------------------------------ escrita (cópias)

function comTrilha(p: ProjetoDeEdicao, ti: number, trilha: TrilhaDoProjeto): ProjetoDeEdicao {
  const trilhas = p.trilhas.slice();
  trilhas[ti] = trilha;
  return { ...p, trilhas, duracao_s: duracaoDoProjeto(trilhas) };
}

function comClipe(p: ProjetoDeEdicao, ti: number, ci: number, clipe: ClipeDoProjeto | ClipeDoProjeto[]): ProjetoDeEdicao {
  const t = p.trilhas[ti];
  const clipes = t.clipes.slice();
  clipes.splice(ci, 1, ...(Array.isArray(clipe) ? clipe : [clipe]));
  if (clipes.length > MAX_CLIPES_POR_TRILHA) throw new ErroDaOperacao(`A trilha ${t.nome} chegou ao limite de ${MAX_CLIPES_POR_TRILHA} clipes.`);
  return comTrilha(p, ti, { ...t, clipes });
}

const exigir = (p: ProjetoDeEdicao, id: string) => {
  const a = acharClipe(p, id);
  if (!a) throw new ErroDaOperacao("Esse clipe não existe mais na linha do tempo.");
  return a;
};

const exigirTrilha = (p: ProjetoDeEdicao, id: string) => {
  const ti = p.trilhas.findIndex((t) => t.id === id);
  if (ti < 0) throw new ErroDaOperacao("Essa trilha não existe.");
  return ti;
};

/** Limite da fonte (vídeo e áudio têm fim; imagem e texto não). */
function fimDaFonte(p: ProjetoDeEdicao, c: ClipeDoProjeto): number {
  const f = c.fonte ? p.fontes[c.fonte] : null;
  if (!f || f.midia === "imagem" || !f.duracao_s) return MAX_DURACAO_S;
  return f.duracao_s;
}

// ------------------------------------------------------------------ operações

function dividir(p: ProjetoDeEdicao, o: Extract<Operacao, { op: "dividir" }>): ProjetoDeEdicao {
  const { clipe: c, ti, ci, trilha } = exigir(p, o.clipe);
  const q = umQuadro(p.fps);
  const em = noQuadro(o.em_s, p.fps);
  if (em < c.inicio_s + q - 1e-6 || em > fimDoClipe(c) - q + 1e-6) throw new ErroDaOperacao("Para dividir, o ponto precisa estar dentro do clipe (pelo menos um quadro de cada lado).");
  const corte = arred(c.entrada_s + (em - c.inicio_s) * c.velocidade);
  const a: ClipeDoProjeto = { ...c, saida_s: corte, transicao_saida: null };
  const b: ClipeDoProjeto = { ...c, id: novoId(p, trilha.tipo), inicio_s: em, entrada_s: corte, transicao_entrada: null, origem: c.origem };
  return comClipe(p, ti, ci, [a, b]);
}

function aparar(p: ProjetoDeEdicao, o: Extract<Operacao, { op: "aparar" }>): ProjetoDeEdicao {
  const { clipe: c, ti, ci, trilha } = exigir(p, o.clipe);
  const q = umQuadro(p.fps);
  const t = noQuadro(o.tempo_s, p.fps);
  const semFonte = !c.fonte;
  if (o.lado === "inicio") {
    const fim = fimDoClipe(c);
    if (t > fim - q + 1e-6) throw new ErroDaOperacao("O clipe precisa de pelo menos um quadro.");
    if (t < 0) throw new ErroDaOperacao("O clipe não pode começar antes do zero.");
    let novo: ClipeDoProjeto;
    if (semFonte) {
      novo = { ...c, inicio_s: t, entrada_s: 0, saida_s: arred((fim - t) * c.velocidade) };
    } else {
      const entrada = arred(c.entrada_s + (t - c.inicio_s) * c.velocidade);
      if (entrada < -1e-6) throw new ErroDaOperacao("A fonte não tem material antes deste ponto.");
      novo = { ...c, inicio_s: t, entrada_s: Math.max(0, entrada) };
    }
    const bate = colide(trilha, novo.inicio_s, fimDoClipe(novo), c.id);
    if (bate) throw new ErroDaOperacao("Encostou no clipe anterior.");
    return comClipe(p, ti, ci, novo);
  }
  if (t < c.inicio_s + q - 1e-6) throw new ErroDaOperacao("O clipe precisa de pelo menos um quadro.");
  const saida = arred(c.entrada_s + (t - c.inicio_s) * c.velocidade);
  if (!semFonte && saida > fimDaFonte(p, c) + 1e-6) throw new ErroDaOperacao("A fonte acaba antes deste ponto.");
  const novo = { ...c, saida_s: saida };
  if (colide(trilha, novo.inicio_s, fimDoClipe(novo), c.id)) throw new ErroDaOperacao("Encostou no clipe seguinte.");
  return comClipe(p, ti, ci, novo);
}

function mover(p: ProjetoDeEdicao, o: Extract<Operacao, { op: "mover" }>): ProjetoDeEdicao {
  const { clipe: c, ti, ci, trilha } = exigir(p, o.clipe);
  const inicio = noQuadro(o.inicio_s, p.fps);
  if (inicio < 0) throw new ErroDaOperacao("O clipe não pode começar antes do zero.");
  const movido = { ...c, inicio_s: inicio };
  if (o.trilha && o.trilha !== trilha.id) {
    const tj = exigirTrilha(p, o.trilha);
    const destino = p.trilhas[tj];
    if (!trilhasCompativeis(trilha.tipo, destino.tipo)) throw new ErroDaOperacao(`Clipe de ${ROTULO_DA_TRILHA[trilha.tipo].toLowerCase()} não vai para a trilha ${destino.nome}.`);
    if (colide(destino, inicio, fimDoClipe(movido))) throw new ErroDaOperacao("Ali já tem outro clipe.");
    const semEle = comTrilha(p, ti, { ...trilha, clipes: trilha.clipes.filter((x) => x.id !== c.id) });
    const d = semEle.trilhas[tj];
    return comTrilha(semEle, tj, { ...d, clipes: d.clipes.concat([movido]) });
  }
  if (colide(trilha, inicio, fimDoClipe(movido), c.id)) throw new ErroDaOperacao("Ali já tem outro clipe.");
  return comClipe(p, ti, ci, movido);
}

function remover(p: ProjetoDeEdicao, o: Extract<Operacao, { op: "remover" }>): ProjetoDeEdicao {
  const { clipe: c, ti, trilha } = exigir(p, o.clipe);
  const dur = duracaoDoClipe(c);
  const fim = fimDoClipe(c);
  const clipes = trilha.clipes
    .filter((x) => x.id !== c.id)
    .map((x) => (o.ondular && x.inicio_s >= fim - 1e-6 ? { ...x, inicio_s: noQuadro(Math.max(0, x.inicio_s - dur), p.fps) } : x));
  return comTrilha(p, ti, { ...trilha, clipes });
}

function recortar(p: ProjetoDeEdicao, o: Extract<Operacao, { op: "recortar" }>): ProjetoDeEdicao {
  const { clipe: c, ti, ci, trilha } = exigir(p, o.clipe);
  const de = Math.max(c.entrada_s, arred(o.de_s));
  const ate = Math.min(c.saida_s, arred(o.ate_s));
  const q = umQuadro(p.fps) * c.velocidade;
  if (ate - de < q - 1e-6) throw new ErroDaOperacao("O trecho a tirar é menor que um quadro.");
  const tiraInicio = de <= c.entrada_s + q - 1e-6;
  const tiraFim = ate >= c.saida_s - q + 1e-6;
  if (tiraInicio && tiraFim) return remover(p, { op: "remover", clipe: c.id });
  if (tiraInicio) return comClipe(p, ti, ci, { ...c, entrada_s: ate });
  if (tiraFim) return comClipe(p, ti, ci, { ...c, saida_s: de, transicao_saida: null });
  const a: ClipeDoProjeto = { ...c, saida_s: de, transicao_saida: null };
  const b: ClipeDoProjeto = { ...c, id: novoId(p, trilha.tipo), inicio_s: noQuadro(c.inicio_s + (de - c.entrada_s) / c.velocidade, p.fps), entrada_s: ate, transicao_entrada: null };
  return comClipe(p, ti, ci, [a, b]);
}

function inserir(p: ProjetoDeEdicao, o: Extract<Operacao, { op: "inserir" }>): ProjetoDeEdicao {
  const ti = exigirTrilha(p, o.trilha);
  const trilha = p.trilhas[ti];
  const base = o.clipe;
  if (base.fonte && !p.fontes[base.fonte]) throw new ErroDaOperacao("A mídia desse clipe não está no projeto.");
  const entrada = arred(Math.max(0, base.entrada_s));
  const saida = arred(base.saida_s);
  if (saida - entrada < umQuadro(p.fps) - 1e-6) throw new ErroDaOperacao("O clipe precisa de pelo menos um quadro.");
  const id = base.id && !acharClipe(p, base.id) ? base.id : novoId(p, trilha.tipo);
  const clipe = clipeNovo({ ...base, id, inicio_s: noQuadro(Math.max(0, base.inicio_s), p.fps), entrada_s: entrada, saida_s: saida });
  const dur = duracaoDoClipe(clipe);
  let clipes = trilha.clipes;
  if (o.empurrar) {
    clipes = clipes.map((x) => (x.inicio_s >= clipe.inicio_s - 1e-6 ? { ...x, inicio_s: noQuadro(x.inicio_s + dur, p.fps) } : x));
  }
  const provisoria = { ...trilha, clipes };
  if (colide(provisoria, clipe.inicio_s, fimDoClipe(clipe))) throw new ErroDaOperacao("Ali já tem outro clipe.");
  if (clipes.length + 1 > MAX_CLIPES_POR_TRILHA) throw new ErroDaOperacao(`A trilha ${trilha.nome} chegou ao limite de ${MAX_CLIPES_POR_TRILHA} clipes.`);
  return comTrilha(p, ti, { ...trilha, clipes: clipes.concat([clipe]) });
}

function propriedades(p: ProjetoDeEdicao, o: Extract<Operacao, { op: "propriedades" }>): ProjetoDeEdicao {
  const { clipe: c, ti, ci } = exigir(p, o.clipe);
  const x = o.campos || {};
  const novo: ClipeDoProjeto = { ...c };
  if (x.velocidade !== undefined) {
    const v = Number(x.velocidade);
    if (!(v >= 0.25 && v <= 4)) throw new ErroDaOperacao("Velocidade vai de 0,25x a 4x.");
    novo.velocidade = Math.round(v * 100) / 100;
  }
  if (x.volume !== undefined) {
    const v = Number(x.volume);
    if (!(v >= 0 && v <= 2)) throw new ErroDaOperacao("Volume vai de 0 a 200%.");
    novo.volume = Math.round(v * 100) / 100;
  }
  if (x.texto !== undefined) novo.texto = x.texto ? String(x.texto).slice(0, 500) : null;
  if (x.estilo !== undefined) novo.estilo = x.estilo;
  if (x.transicao_entrada !== undefined) novo.transicao_entrada = x.transicao_entrada;
  if (x.transicao_saida !== undefined) novo.transicao_saida = x.transicao_saida;
  if (x.zoom !== undefined) {
    if (x.zoom && !(x.zoom.de >= 0.5 && x.zoom.de <= 4 && x.zoom.para >= 0.5 && x.zoom.para <= 4)) throw new ErroDaOperacao("Zoom vai de 0,5x a 4x.");
    novo.zoom = x.zoom ? { de: Math.round(x.zoom.de * 1000) / 1000, para: Math.round(x.zoom.para * 1000) / 1000 } : null;
  }
  if (x.cena_ref !== undefined) novo.cena_ref = x.cena_ref;
  if (x.nota !== undefined) novo.nota = x.nota;
  if (x.origem !== undefined) novo.origem = x.origem;
  if (x.comparar !== undefined) {
    if (x.comparar && !p.fontes[x.comparar.fonte_b]) throw new ErroDaOperacao("A mídia do depois não está no projeto.");
    novo.comparar = x.comparar;
  }
  // Velocidade muda a duração: não pode invadir o vizinho.
  const t = p.trilhas[ti];
  if (novo.velocidade !== c.velocidade && colide(t, novo.inicio_s, fimDoClipe(novo), c.id)) throw new ErroDaOperacao("Com essa velocidade o clipe invade o seguinte.");
  return comClipe(p, ti, ci, novo);
}

function ondular(p: ProjetoDeEdicao, o: Extract<Operacao, { op: "ondular" }>): ProjetoDeEdicao {
  const ti = exigirTrilha(p, o.trilha);
  const t = p.trilhas[ti];
  const ordem = emOrdem(t);
  if (!ordem.length) return p;
  let cursor = noQuadro(ordem[0].inicio_s, p.fps);
  const novos = ordem.map((c) => {
    const n = { ...c, inicio_s: cursor };
    cursor = noQuadro(cursor + duracaoDoClipe(c), p.fps);
    return n;
  });
  return comTrilha(p, ti, { ...t, clipes: novos });
}

function reordenar(p: ProjetoDeEdicao, o: Extract<Operacao, { op: "reordenar" }>): ProjetoDeEdicao {
  const ti = exigirTrilha(p, o.trilha);
  const t = p.trilhas[ti];
  const ids = t.clipes.map((c) => c.id);
  const ordem = o.ordem.filter((id, i) => ids.indexOf(id) >= 0 && o.ordem.indexOf(id) === i);
  if (ordem.length !== ids.length) throw new ErroDaOperacao("A nova ordem precisa ter todos os clipes da trilha, uma vez cada.");
  const inicio = t.clipes.length ? Math.min(...t.clipes.map((c) => c.inicio_s)) : 0;
  let cursor = noQuadro(inicio, p.fps);
  const clipes = ordem.map((id) => {
    const c = t.clipes.find((x) => x.id === id) as ClipeDoProjeto;
    const n = { ...c, inicio_s: cursor };
    cursor = noQuadro(cursor + duracaoDoClipe(c), p.fps);
    return n;
  });
  return comTrilha(p, ti, { ...t, clipes });
}

export function aplicarOperacao(p: ProjetoDeEdicao, o: Operacao): ProjetoDeEdicao {
  switch (o.op) {
    case "dividir":
      return dividir(p, o);
    case "aparar":
      return aparar(p, o);
    case "mover":
      return mover(p, o);
    case "remover":
      return remover(p, o);
    case "recortar":
      return recortar(p, o);
    case "inserir":
      return inserir(p, o);
    case "propriedades":
      return propriedades(p, o);
    case "ondular":
      return ondular(p, o);
    case "reordenar":
      return reordenar(p, o);
    case "limpar_trilha": {
      const ti = exigirTrilha(p, o.trilha);
      return comTrilha(p, ti, { ...p.trilhas[ti], clipes: [] });
    }
    case "trilha_nova": {
      if (p.trilhas.length >= MAX_TRILHAS) throw new ErroDaOperacao(`O projeto já tem ${MAX_TRILHAS} trilhas.`);
      let n = 1;
      while (p.trilhas.some((t) => t.id === `${o.tipo}-${n}`)) n++;
      const trilhas = p.trilhas.concat([trilhaVazia(o.tipo, n)]);
      return { ...p, trilhas };
    }
    case "trilha": {
      const ti = exigirTrilha(p, o.trilha);
      const t = p.trilhas[ti];
      const c = o.campos || {};
      return comTrilha(p, ti, {
        ...t,
        muda: c.muda !== undefined ? !!c.muda : t.muda,
        oculta: c.oculta !== undefined ? !!c.oculta : t.oculta,
        nome: c.nome ? String(c.nome).slice(0, 60) : t.nome,
      });
    }
    case "fonte": {
      if (!o.fonte || !o.fonte.chave) throw new ErroDaOperacao("Mídia sem chave.");
      return { ...p, fontes: { ...p.fontes, [o.fonte.chave]: o.fonte } };
    }
    case "transcricao": {
      if (!p.fontes[o.fonte]) throw new ErroDaOperacao("A transcrição é de uma mídia que não está no projeto.");
      return { ...p, transcricoes: { ...p.transcricoes, [o.fonte]: o.transcricao } };
    }
    case "visao": {
      if (!p.fontes[o.fonte]) throw new ErroDaOperacao("A visão é de uma mídia que não está no projeto.");
      return { ...p, visoes: { ...p.visoes, [o.fonte]: o.visao } };
    }
    case "referencias":
      return { ...p, referencias: (o.lista || []).slice(0, MAX_REFERENCIAS) };
    case "continuidade":
      return { ...p, continuidade: { ...p.continuidade, ...o.campos } };
    case "marcador": {
      if (p.marcadores.length >= MAX_MARCADORES) throw new ErroDaOperacao("Marcadores demais.");
      let n = p.marcadores.length + 1;
      while (p.marcadores.some((m) => m.id === `m${n}`)) n++;
      const tempo = noQuadro(o.tempo_s, p.fps);
      const fim = typeof o.fim_s === "number" && o.fim_s > tempo ? noQuadro(o.fim_s, p.fps) : null;
      return { ...p, marcadores: p.marcadores.concat([{ id: `m${n}`, tempo_s: tempo, rotulo: String(o.rotulo || "Marcador").slice(0, 80), tipo: o.tipo || "marcador", fim_s: fim, nota: typeof o.nota === "number" ? o.nota : null }]) };
    }
    case "marcadores": {
      const outros = p.marcadores.filter((m) => m.tipo !== o.tipo);
      const lista = (o.lista || []).slice(0, Math.max(0, MAX_MARCADORES - outros.length));
      let n = 0;
      const livre = () => {
        do n++;
        while (outros.some((m) => m.id === `m${n}`));
        return `m${n}`;
      };
      const novos = lista.map((x) => {
        const tempo = noQuadro(Math.max(0, Number(x.tempo_s) || 0), p.fps);
        const fim = typeof x.fim_s === "number" && x.fim_s > tempo ? noQuadro(x.fim_s, p.fps) : null;
        return { id: livre(), tempo_s: tempo, rotulo: String(x.rotulo || "Marcador").slice(0, 80), tipo: o.tipo, fim_s: fim, nota: typeof x.nota === "number" ? Math.max(0, Math.min(1, x.nota)) : null };
      });
      return { ...p, marcadores: outros.concat(novos).sort((a, b) => a.tempo_s - b.tempo_s) };
    }
    case "remover_marcador":
      return { ...p, marcadores: p.marcadores.filter((m) => m.id !== o.id) };
    case "formato": {
      if (!FORMATOS_DO_PROJETO[o.formato]) throw new ErroDaOperacao(`Formato desconhecido: ${o.formato}.`);
      return comFormato(p, o.formato);
    }
    case "cor":
      return { ...p, cor: { ...p.cor, ...o.campos } };
    case "rosto": {
      if (!p.fontes[o.fonte]) throw new ErroDaOperacao("O rosto é de uma mídia que não está no projeto.");
      const rostos = { ...(p.rostos || {}) };
      if (o.rastro && o.rastro.pontos.length) rostos[o.fonte] = o.rastro;
      else delete rostos[o.fonte];
      return { ...p, rostos };
    }
    case "enquadramento":
      return { ...p, enquadramento: { ...p.enquadramento, ...o.campos } };
    case "identidade":
      return { ...p, identidade: o.identidade };
    case "onda": {
      if (!p.fontes[o.fonte]) throw new ErroDaOperacao("A onda é de uma mídia que não está no projeto.");
      return { ...p, ondas: { ...(p.ondas || {}), [o.fonte]: o.onda } };
    }
    case "mixagem":
      return { ...p, mixagem: { ...p.mixagem, ...o.campos } };
    case "registrar_skill":
      return { ...p, skills_aplicadas: p.skills_aplicadas.concat([{ skill: o.skill, em: o.em, resumo: String(o.resumo || "").slice(0, 200) }]).slice(-MAX_SKILLS_NO_HISTORICO) };
    default:
      throw new ErroDaOperacao("Operação desconhecida.");
  }
}

/** Aplica em sequência; qualquer falha cancela tudo (o projeto de entrada fica intacto). */
export function aplicarOperacoes(p: ProjetoDeEdicao, ops: Operacao[]): ProjetoDeEdicao {
  return ops.reduce((acc, o) => aplicarOperacao(acc, o), p);
}

/** JSON com as chaves em ordem (o mesmo conteúdo dá o mesmo texto, venha do servidor ou da tela). */
export function jsonEstavel(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v === undefined ? null : v);
  if (Array.isArray(v)) return `[${v.map(jsonEstavel).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${jsonEstavel(o[k])}`)
    .join(",")}}`;
}

/** Assinatura do conteúdo (sem revisão e data): o que decide se há algo novo para salvar. */
export function assinaturaDoProjeto(p: ProjetoDeEdicao): string {
  return jsonEstavel({ ...p, revisao: 0, atualizado_em: null });
}
