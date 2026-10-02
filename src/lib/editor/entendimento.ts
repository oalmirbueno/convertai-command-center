import { duracaoDoClipe, type ProjetoDeEdicao } from "../../../supabase/functions/_shared/projeto-de-edicao";
import { emOrdem, trilhaPrincipal } from "./operacoes";
import { tempoFino } from "./tempo";
import { falaNaLinhaDoTempo, type PalavraNaLinha } from "./transcricao";
import { frasesDaFala, notasPorRegra, NOME_DA_TRILHA_DE_BROLL, type FraseNaLinha } from "./skills/pecasDaEdicao";
import { candidatasDaFrase } from "./motion/sugestoes";
import { definicaoDaPeca } from "./motion/catalogo";

/**
 * "Entendimento do vídeo" (02/10, dono: "o agente não entende o vídeo, só
 * edita o básico"). Regra FIXA do código, sem modelo e sem custo: lê a fala
 * da linha do tempo (Timestamp ou Entrada), as pausas, as frases, os números
 * e enumerações ditos, o rosto rastreado, o que o agente já assistiu e o que
 * já está montado. Vai no contexto de TODO passo do agente, para ele decidir
 * onde pôr arte, motion, B-roll e zoom com tempo exato (nunca no chute):
 * - frase forte (número, exclamação, pergunta, palavra de peso) = punch-in;
 * - número, preço, porcentagem e enumeração ditos = peça de dado (contador,
 *   barra, preço, lista, passos);
 * - pausa longa com mudança de assunto = troca de seção (transição, capítulo).
 */

export interface SecaoDoVideo {
  inicio_s: number;
  fim_s: number;
  /** Primeiras palavras da seção (é o que a pessoa disse, não um resumo inventado). */
  abre: string;
}

export interface MomentoDoVideo {
  inicio_s: number;
  fim_s: number;
  texto: string;
  /** Por que é um momento (regra que achou). */
  motivo: string;
  /** Peças que a frase sustenta com o que foi dito (o código tirou da fala). */
  pecas: string[];
}

export interface EntendimentoDoVideo {
  duracao_s: number;
  formato: string;
  tipo: "fala_para_camera" | "varias_falas" | "sem_fala" | "vazio";
  palavras: number;
  fontesNaPrincipal: number;
  secoes: SecaoDoVideo[];
  pausas: { de_s: number; ate_s: number }[];
  pausasLongas: number;
  enfases: MomentoDoVideo[];
  dados: MomentoDoVideo[];
  perguntas: MomentoDoVideo[];
  rosto: boolean;
  visto: number;
  jaTem: string[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const MARCA_DE_ASSUNTO = /^(agora|outro|outra|segundo|terceiro|quarto|por fim|finalmente|entao|então|mas|so que|só que|primeiro|depois|alem disso|além disso|e tem mais|olha)\b/i;
const PECAS_DE_DADO = ["contador", "barra", "preco", "lista", "passos", "selo"];
const ALERTA = /\b(aten[cç][aã]o|cuidado|direitos?|lei|prazo|multa|garantid[oa]|proibid[oa]|obrigat[oó]ri[oa])\b/i;

/** Pausas entre palavras (ou do começo do clipe) acima de `min` s, na linha do tempo. */
export function pausasDaFala(fala: PalavraNaLinha[], min = 0.5): { de_s: number; ate_s: number }[] {
  const saida: { de_s: number; ate_s: number }[] = [];
  for (let k = 1; k < fala.length; k++) {
    const vao = fala[k].i - fala[k - 1].f;
    if (vao >= min) saida.push({ de_s: r2(fala[k - 1].f), ate_s: r2(fala[k].i) });
  }
  return saida;
}

/** Seções: junta frases até ~25 s e abre outra em pausa de 0,9 s ou palavra de troca de assunto (depois de 8 s). */
export function secoesDaFala(frases: FraseNaLinha[], alvo = 25): SecaoDoVideo[] {
  const saida: SecaoDoVideo[] = [];
  let atual: FraseNaLinha[] = [];
  const fechar = () => {
    if (!atual.length) return;
    saida.push({ inicio_s: atual[0].inicio_s, fim_s: atual[atual.length - 1].fim_s, abre: atual[0].texto.split(" ").slice(0, 9).join(" ") });
    atual = [];
  };
  frases.forEach((f, k) => {
    const ant = k > 0 ? frases[k - 1] : null;
    const dur = atual.length ? f.inicio_s - atual[0].inicio_s : 0;
    const vao = ant ? f.inicio_s - ant.fim_s : 0;
    const troca = (vao >= 0.9 && dur >= 6) || (MARCA_DE_ASSUNTO.test(f.texto.trim()) && dur >= 8) || dur >= alvo;
    if (troca) fechar();
    atual.push(f);
  });
  fechar();
  return saida;
}

function jaMontado(p: ProjetoDeEdicao): string[] {
  const n = (f: (t: ProjetoDeEdicao["trilhas"][number], c: ProjetoDeEdicao["trilhas"][number]["clipes"][number]) => boolean) =>
    p.trilhas.reduce((s, t) => s + t.clipes.filter((c) => f(t, c)).length, 0);
  const est = (c: { estilo: Record<string, unknown> | null }) => (c.estilo || {}) as Record<string, unknown>;
  const legendas = n((t) => t.tipo === "legenda");
  const textos = n((t, c) => t.tipo === "texto" && typeof est(c).peca !== "string");
  const pecas = n((_t, c) => typeof est(c).peca === "string");
  const zooms = n((t, c) => (t.tipo === "video" && !!c.zoom) || (t.tipo === "ajuste" && est(c).efeito === "zoom"));
  const musica = n((t, c) => t.tipo === "audio" && est(c).papel === "trilha");
  const sons = n((t, c) => t.tipo === "audio" && est(c).papel === "efeito");
  const broll = p.trilhas.filter((t) => t.nome.indexOf(NOME_DA_TRILHA_DE_BROLL) === 0).reduce((s, t) => s + t.clipes.length, 0);
  const l: string[] = [];
  if (legendas) l.push(`${legendas} legendas`);
  if (textos) l.push(`${textos} textos`);
  if (pecas) l.push(`${pecas} animações`);
  if (zooms) l.push(`${zooms} zooms`);
  if (broll) l.push(`${broll} B-rolls`);
  if (musica) l.push("música");
  if (sons) l.push(`${sons} efeitos sonoros`);
  if (p.cor && p.cor.look !== "natural") l.push(`cor ${p.cor.look}`);
  if (p.cor && p.cor.lut) l.push("LUT");
  const caps = p.marcadores.filter((m) => m.tipo === "capitulo").length;
  if (caps) l.push(`${caps} capítulos`);
  return l;
}

export function entendimentoDoVideo(p: ProjetoDeEdicao): EntendimentoDoVideo {
  const t = trilhaPrincipal(p);
  const clipes = t ? emOrdem(t) : [];
  const fontes = clipes.reduce((l, c) => (c.fonte && l.indexOf(c.fonte) < 0 ? l.concat([c.fonte]) : l), [] as string[]);
  const fala = falaNaLinhaDoTempo(p);
  const frases = frasesDaFala(fala);
  const duracao = clipes.length ? clipes.reduce((s, c) => Math.max(s, c.inicio_s + duracaoDoClipe(c)), 0) : p.duracao_s;
  const tipo: EntendimentoDoVideo["tipo"] = !clipes.length && !p.duracao_s ? "vazio" : !fala.length ? "sem_fala" : fontes.length <= 3 ? "fala_para_camera" : "varias_falas";
  const notas = notasPorRegra(frases);
  const enfases: MomentoDoVideo[] = [];
  const dados: MomentoDoVideo[] = [];
  const perguntas: MomentoDoVideo[] = [];
  frases.forEach((f, k) => {
    const pecas = candidatasDaFrase(f.texto).map((c) => c.peca as string);
    const base = { inicio_s: f.inicio_s, fim_s: f.fim_s, texto: f.texto.slice(0, 140) };
    const deDado = pecas.filter((x) => PECAS_DE_DADO.indexOf(x) >= 0);
    if (deDado.length) dados.push({ ...base, motivo: "dado dito", pecas: deDado });
    if (/\?/.test(f.texto)) perguntas.push({ ...base, motivo: "pergunta", pecas: [] });
    // Regra da casa (notasPorRegra) e, por cima, a exclamação curta e as palavras de alerta ("atenção", "cuidado", "direito").
    const curta = f.texto.split(" ").length <= 8;
    const nota = (notas[k] ? notas[k].nota : 0) + (/!/.test(f.texto) && curta ? 0.15 : 0) + (ALERTA.test(f.texto) ? 0.2 : 0);
    if (nota >= 0.6) enfases.push({ ...base, motivo: /!/.test(f.texto) ? "exclamação" : /\d/.test(f.texto) ? "número" : "palavra de peso", pecas: pecas.filter((x) => x === "lettering" || x === "carimbo" || x === "rotulo") });
  });
  const pausas = pausasDaFala(fala, 0.5);
  return {
    duracao_s: r2(duracao),
    formato: p.formato,
    tipo,
    palavras: fala.length,
    fontesNaPrincipal: fontes.length,
    secoes: secoesDaFala(frases),
    pausas: pausas.slice().sort((a, b) => b.ate_s - b.de_s - (a.ate_s - a.de_s)).slice(0, 12).sort((a, b) => a.de_s - b.de_s),
    pausasLongas: pausas.filter((x) => x.ate_s - x.de_s > 0.25).length,
    enfases: enfases.slice(0, 16),
    dados: dados.slice(0, 12),
    perguntas: perguntas.slice(0, 6),
    rosto: Object.keys(p.rostos || {}).length > 0,
    visto: Object.keys(p.visoes || {}).reduce((s, k) => s + p.visoes[k].trechos.length, 0),
    jaTem: jaMontado(p),
  };
}

const rotuloDaPeca = (id: string) => {
  const d = definicaoDaPeca(id);
  return d ? d.id : id;
};

/** O entendimento em texto curto para o modelo (vai em todo passo). */
export function textoDoEntendimento(e: EntendimentoDoVideo, max = 7000): string {
  const l: string[] = [];
  const tipo = { fala_para_camera: "pessoa falando para a câmera (talking head)", varias_falas: "várias falas e fontes", sem_fala: "sem fala marcada", vazio: "projeto vazio (começar do zero)" }[e.tipo];
  l.push(`Tipo: ${tipo}. Duração ${tempoFino(e.duracao_s)}, formato ${e.formato}, ${e.palavras} palavras, ${e.fontesNaPrincipal} ${e.fontesNaPrincipal === 1 ? "fonte" : "fontes"} na trilha de vídeo.`);
  l.push(`Rosto rastreado: ${e.rosto ? "sim (formato e legenda desviam do rosto)" : "não"}. Trechos já assistidos: ${e.visto}.`);
  l.push(`Já montado: ${e.jaTem.length ? e.jaTem.join(", ") : "nada além do corte bruto"}.`);
  if (e.secoes.length) l.push(`Seções (troca de assunto = transição ou capítulo):\n${e.secoes.map((s, k) => `S${k + 1} ${tempoFino(s.inicio_s)} a ${tempoFino(s.fim_s)}: "${s.abre}"`).join("\n")}`);
  if (e.pausas.length) l.push(`Pausas acima de 0,5 s: ${e.pausasLongas} acima de 0,25 s no total; maiores: ${e.pausas.map((p) => `${tempoFino(p.de_s)} (${r2(p.ate_s - p.de_s)} s)`).join(", ")}.`);
  if (e.enfases.length) l.push(`Ênfases (punch-in ou lettering):\n${e.enfases.map((m) => `${tempoFino(m.inicio_s)} "${m.texto}" (${m.motivo}${m.pecas.length ? `; peças: ${m.pecas.map(rotuloDaPeca).join(", ")}` : ""})`).join("\n")}`);
  if (e.dados.length) l.push(`Dados ditos (peça de dado com palavra_ref):\n${e.dados.map((m) => `${tempoFino(m.inicio_s)} "${m.texto}" (${m.pecas.map(rotuloDaPeca).join(", ")})`).join("\n")}`);
  if (e.perguntas.length) l.push(`Perguntas (gancho ou texto na tela): ${e.perguntas.map((m) => `${tempoFino(m.inicio_s)} "${m.texto}"`).join("; ")}.`);
  const texto = l.join("\n");
  return texto.length > max ? `${texto.slice(0, max)}\n(cortado)` : texto;
}
