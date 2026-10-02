import { duracaoDoClipe, type ClipeDoProjeto, type ProjetoDeEdicao, type TrilhaDoProjeto } from "../../../supabase/functions/_shared/projeto-de-edicao";
import { trilhaPrincipal } from "./operacoes";
import { tempoFino } from "./tempo";
import { definicaoDaPeca } from "./motion/catalogo";
import { NOME_DA_TRILHA_DE_BROLL } from "./skills/pecasDaEdicao";

/**
 * O que REALMENTE mudou no projeto (02/10, dono: "o agente alucina, diz que
 * editou e não editou"). Retrato do projeto antes e depois, contado pelo
 * código: a mensagem final do agente sai daqui, nunca do texto livre do
 * modelo. Se o retrato não mudou, a mensagem diz que nada mudou.
 */

export interface RetratoDaEdicao {
  duracao_s: number;
  clipesNaPrincipal: number;
  legendas: number;
  textos: number;
  pecas: Record<string, number>;
  zooms: number;
  efeitos: number;
  musica: string | null;
  sons: number;
  transicoes: number;
  broll: number;
  cenas: number;
  capitulos: number;
  virais: number;
  formato: string;
  cor: string;
  lut: boolean;
  identidade: string;
  mixagem: string;
  midiasNaLinha: number;
  trilhas: string;
}

const est = (c: ClipeDoProjeto) => (c.estilo || {}) as Record<string, unknown>;

function contar(p: ProjetoDeEdicao, f: (t: TrilhaDoProjeto, c: ClipeDoProjeto) => boolean): number {
  return p.trilhas.reduce((s, t) => s + t.clipes.filter((c) => f(t, c)).length, 0);
}

export function retratoDoProjeto(p: ProjetoDeEdicao): RetratoDaEdicao {
  const t = trilhaPrincipal(p);
  const pecas: Record<string, number> = {};
  p.trilhas.forEach((tr) =>
    tr.clipes.forEach((c) => {
      const id = est(c).peca;
      if (typeof id === "string") pecas[id] = (pecas[id] || 0) + 1;
    }),
  );
  const trilhaDeMusica = p.trilhas.find((tr) => tr.tipo === "audio" && tr.clipes.some((c) => est(c).papel === "trilha"));
  const clipeDeMusica = trilhaDeMusica ? trilhaDeMusica.clipes.find((c) => est(c).papel === "trilha") : null;
  const cor = p.cor;
  return {
    duracao_s: Math.round((t ? t.clipes.reduce((s, c) => s + duracaoDoClipe(c), 0) : 0) * 100) / 100,
    clipesNaPrincipal: t ? t.clipes.length : 0,
    legendas: contar(p, (tr) => tr.tipo === "legenda"),
    textos: contar(p, (tr, c) => tr.tipo === "texto" && typeof est(c).peca !== "string"),
    pecas,
    zooms: contar(p, (tr, c) => (tr.tipo === "video" && !!c.zoom) || (tr.tipo === "ajuste" && est(c).efeito === "zoom")),
    efeitos: contar(p, (tr, c) => tr.tipo === "ajuste" && est(c).efeito !== "zoom"),
    musica: clipeDeMusica && clipeDeMusica.fonte ? (p.fontes[clipeDeMusica.fonte] ? p.fontes[clipeDeMusica.fonte].nome : clipeDeMusica.fonte) : null,
    sons: contar(p, (tr, c) => tr.tipo === "audio" && est(c).papel === "efeito"),
    transicoes: contar(p, (tr, c) => tr.tipo === "video" && tr.nome.indexOf(NOME_DA_TRILHA_DE_BROLL) !== 0 && !!(c.transicao_entrada || c.transicao_saida)),
    broll: p.trilhas.filter((tr) => tr.nome.indexOf(NOME_DA_TRILHA_DE_BROLL) === 0).reduce((s, tr) => s + tr.clipes.length, 0),
    cenas: contar(p, (tr, c) => tr.tipo === "video" && !c.fonte && typeof est(c).fundo === "string"),
    capitulos: p.marcadores.filter((m) => m.tipo === "capitulo").length,
    virais: p.marcadores.filter((m) => m.tipo === "viral").length,
    formato: p.formato,
    cor: cor ? `${cor.look}:${cor.intensidade}:${cor.exposicao}:${cor.contraste}:${cor.saturacao}:${cor.temperatura}:${cor.tinta}:${cor.vinheta}` : "",
    lut: !!(cor && cor.lut),
    identidade: JSON.stringify(p.identidade || null),
    mixagem: JSON.stringify(p.mixagem || null),
    midiasNaLinha: contar(p, (tr, c) => (tr.tipo === "video" || tr.tipo === "sobreposicao") && !!c.fonte && tr.nome.indexOf(NOME_DA_TRILHA_DE_BROLL) !== 0 && typeof est(c).peca !== "string"),
    trilhas: p.trilhas.map((tr) => `${tr.id}:${tr.muda ? 1 : 0}${tr.oculta ? 1 : 0}`).join(","),
  };
}

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

function frasePorContagem(antes: number, depois: number, um: string, varios: string): string | null {
  if (antes === depois) return null;
  if (!depois) return `Sem ${varios} agora (antes ${antes}).`;
  return `${plural(depois, um, varios)}${antes ? ` (antes ${antes})` : ""}.`;
}

/**
 * O que mudou de um retrato para o outro, em frases curtas (o código conta).
 * Vazio = nada mudou de verdade.
 */
export function itensDoQueMudou(antes: ProjetoDeEdicao, depois: ProjetoDeEdicao): string[] {
  const a = retratoDoProjeto(antes);
  const d = retratoDoProjeto(depois);
  const l: string[] = [];
  if (a.clipesNaPrincipal !== d.clipesNaPrincipal || Math.abs(a.duracao_s - d.duracao_s) >= 0.01) {
    const partes: string[] = [];
    if (Math.abs(a.duracao_s - d.duracao_s) >= 0.01) partes.push(`duração ${tempoFino(a.duracao_s)} para ${tempoFino(d.duracao_s)}`);
    if (a.clipesNaPrincipal !== d.clipesNaPrincipal) partes.push(`${a.clipesNaPrincipal} para ${plural(d.clipesNaPrincipal, "clipe", "clipes")} na trilha de vídeo`);
    l.push(`Corte: ${partes.join(", ")}.`);
  }
  const leg = frasePorContagem(a.legendas, d.legendas, "legenda", "legendas");
  if (leg) l.push(leg);
  const tx = frasePorContagem(a.textos, d.textos, "texto na tela", "textos na tela");
  if (tx) l.push(tx);
  const ids = Object.keys(a.pecas).concat(Object.keys(d.pecas)).filter((x, i, v) => v.indexOf(x) === i);
  const novas: string[] = [];
  const saiu: string[] = [];
  ids.forEach((id) => {
    const nome = (definicaoDaPeca(id) || { rotulo: id }).rotulo.toLowerCase();
    const delta = (d.pecas[id] || 0) - (a.pecas[id] || 0);
    if (delta > 0) novas.push(delta > 1 ? `${delta} ${nome}` : nome);
    if (delta < 0) saiu.push(nome);
  });
  const totalA = Object.keys(a.pecas).reduce((s, k) => s + a.pecas[k], 0);
  const totalD = Object.keys(d.pecas).reduce((s, k) => s + d.pecas[k], 0);
  if (novas.length) l.push(`${totalD > totalA ? plural(totalD - totalA, "animação nova", "animações novas") : "Animações trocadas"}: ${novas.join(", ")}.`);
  if (saiu.length) l.push(`Tirei animação: ${saiu.join(", ")}.`);
  const zo = frasePorContagem(a.zooms, d.zooms, "zoom ou punch-in", "zooms e punch-ins");
  if (zo) l.push(zo);
  const ef = frasePorContagem(a.efeitos, d.efeitos, "efeito de câmera", "efeitos de câmera");
  if (ef) l.push(ef);
  if (a.musica !== d.musica) l.push(d.musica ? `Música: ${d.musica}, abaixo da voz e subindo nas pausas.` : "Tirei a música.");
  const so = frasePorContagem(a.sons, d.sons, "efeito sonoro", "efeitos sonoros");
  if (so) l.push(so);
  const tr = frasePorContagem(a.transicoes, d.transicoes, "clipe com transição", "clipes com transição");
  if (tr) l.push(tr);
  const br = frasePorContagem(a.broll, d.broll, "B-roll", "B-rolls");
  if (br) l.push(br);
  const ce = frasePorContagem(a.cenas, d.cenas, "cena de fundo", "cenas de fundo");
  if (ce) l.push(ce);
  const ca = frasePorContagem(a.capitulos, d.capitulos, "capítulo", "capítulos");
  if (ca) l.push(ca);
  const vi = frasePorContagem(a.virais, d.virais, "momento viral marcado", "momentos virais marcados");
  if (vi) l.push(vi);
  const mi = frasePorContagem(a.midiasNaLinha, d.midiasNaLinha, "mídia na linha", "mídias na linha");
  if (mi && a.clipesNaPrincipal === d.clipesNaPrincipal) l.push(mi);
  if (a.formato !== d.formato) l.push(`Formato ${d.formato}.`);
  if (a.cor !== d.cor || a.lut !== d.lut) {
    const c = depois.cor;
    l.push(c ? `Cor: look ${c.look} (${Math.round(c.intensidade * 100)}%)${c.lut ? " com LUT" : ""}.` : "Cor mudou.");
  }
  if (a.identidade !== d.identidade) l.push(depois.identidade ? `Cores${depois.identidade.fonte ? " e letra" : ""} da marca nas legendas e textos.` : "Tirei a identidade da marca.");
  if (a.mixagem !== d.mixagem) l.push(`Mixagem: música ${depois.mixagem.trilha_abaixo_da_voz_db} dB abaixo da voz, ${depois.mixagem.lufs_alvo} LUFS.`);
  if (a.trilhas !== d.trilhas && a.trilhas.split(",").length === d.trilhas.split(",").length) l.push("Mudei som ou visibilidade de trilha.");
  return l;
}

/**
 * A mensagem final do agente: o que mudou, dito pelo código. `extra` (o
 * "Tirei c3. Movi c2." das operações à mão) entra na frente quando há.
 */
export function mensagemDoQueMudou(antes: ProjetoDeEdicao, depois: ProjetoDeEdicao, extra = ""): string {
  const itens = itensDoQueMudou(antes, depois);
  const partes = [String(extra || "").trim()].concat(itens).filter(Boolean);
  return partes.join(" ");
}
