/**
 * Apresentação da marca ao cliente (frente IDV2, 30/09/2026): a sequência que
 * um diretor de branding usa para revelar a identidade. Primeiro o problema e
 * a estratégia (o cliente se reconhece), depois o nome, o conceito, a logo e
 * o sistema, e por fim as aplicações e os próximos passos.
 *
 * Cada slide diz o que falta (nada inventado) e tem a fala do apresentador,
 * escrita pela equipe ou pelo "Preencher com IA". A tela desenha os slides
 * (16:9) e exporta uma página HTML que abre sem login.
 *
 * Puro: sem Deno, sem banco. Sem lookbehind, sem \p{} (Safari 11).
 */

import { normalizarEstrategia } from "./estrategia-de-marca.ts";

export const SLIDES_DA_APRESENTACAO = [
  { id: "abertura", titulo: "Abertura", sempre: true },
  { id: "desafio", titulo: "O desafio", sempre: true },
  { id: "ouvimos", titulo: "O que ouvimos", sempre: true },
  { id: "mercado", titulo: "O mercado", sempre: false },
  { id: "moodboard", titulo: "Referências", sempre: false },
  { id: "plataforma", titulo: "Plataforma da marca", sempre: true },
  { id: "arquetipo", titulo: "Arquétipo e personalidade", sempre: true },
  { id: "posicionamento", titulo: "Posicionamento", sempre: true },
  { id: "persona", titulo: "Para quem falamos", sempre: false },
  { id: "tom", titulo: "Tom de voz", sempre: true },
  { id: "nome", titulo: "O nome", sempre: false },
  { id: "conceito", titulo: "O conceito", sempre: true },
  { id: "revelacao", titulo: "A marca", sempre: true },
  { id: "variacoes", titulo: "Variações", sempre: false },
  { id: "paleta", titulo: "Paleta", sempre: true },
  { id: "tipografia", titulo: "Tipografia", sempre: true },
  { id: "grafismos", titulo: "Elementos gráficos", sempre: false },
  { id: "aplicacoes", titulo: "A marca no mundo", sempre: false },
  { id: "proximos", titulo: "Próximos passos", sempre: true },
] as const;

export type SlideId = (typeof SLIDES_DA_APRESENTACAO)[number]["id"];

export type SlideDoRoteiro = { id: SlideId; n: number; titulo: string; falta: string[]; fala: string; incluido: boolean };

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const tem = (v: unknown): boolean => {
  if (v == null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.some(tem);
  if (typeof v === "object") return Object.keys(v as Record<string, unknown>).some((k) => tem((v as Record<string, unknown>)[k]));
  return true;
};

/** O que cada slide precisa ter nos dados do projeto (lista vazia: pronto). */
export function faltaNoSlide(id: SlideId, dadosBrutos: unknown, comNaming: boolean, semCaminhos = false): string[] {
  const d = obj(dadosBrutos);
  const b = obj(d.briefing);
  const e = normalizarEstrategia(d.estrategia);
  const p = obj(d.pesquisa);
  const s = obj(d.sistema);
  const c = obj(d.conceito);
  const escolhido = arr(c.caminhos).map(obj).filter((x) => x.id === c.escolhido)[0];
  const precisa = (cond: boolean, texto: string) => (cond ? [] : [texto]);
  switch (id) {
    case "abertura":
      return [];
    case "desafio":
      return precisa(tem(b.negocio) || tem(b.objetivo), "o negócio e o objetivo (Briefing)");
    case "ouvimos":
      return precisa(tem(b.personalidade) || tem(b.publico), "personalidade ou público (Briefing)");
    case "mercado":
      return precisa(tem(p.resumo) || tem(obj(p.ia).resumo), "o resumo da pesquisa");
    case "moodboard":
      return precisa(arr(p.moodboard).length > 0, "o moodboard (Pesquisa)");
    case "plataforma":
      return precisa(tem(e.proposito) || tem(e.missao), "propósito ou missão (Estratégia)");
    case "arquetipo":
      return precisa(!!e.arquetipo.principal, "o arquétipo (Estratégia)");
    case "posicionamento":
      return precisa(tem(e.posicionamento.declaracao) || tem(e.posicionamento.diferencial), "o posicionamento (Estratégia)");
    case "persona":
      return precisa(tem(e.publico.persona.nome) || tem(e.publico.resumo), "o público e a persona (Estratégia)");
    case "tom":
      return precisa(e.tom.fala_assim.length > 0, "o tom de voz (Estratégia)");
    case "nome":
      return comNaming ? precisa(tem(obj(d.naming).nome), "o nome escolhido (Naming)") : [];
    case "conceito":
      // Marca existente (IDV3, "Completar marca"): não há caminhos criativos; o conceito é o significado da logo.
      if (semCaminhos) return precisa(!!escolhido || tem(s.significado_do_logo), "o significado da logo (Sistema)");
      return precisa(!!escolhido, "o caminho escolhido (Conceito)");
    case "revelacao":
      return precisa(tem(obj(obj(s.logos).principal).caminho), "a logo principal (Sistema)");
    case "variacoes":
      return precisa(tem(obj(s.logos).secundario) || arr(obj(s.logos).alternativas).length > 0 || arr(obj(s.logos).icone).length > 0, "versões da logo (Sistema)");
    case "paleta":
      return precisa(arr(s.cores).length >= 2, "a paleta (Sistema)");
    case "tipografia":
      return precisa(arr(s.tipografia).length > 0, "a tipografia (Sistema)");
    case "grafismos":
      return precisa(arr(s.grafismos).length > 0, "grafismos (Sistema)");
    case "aplicacoes":
      return precisa(arr(d.aplicacoes && obj(d.aplicacoes).itens).length > 0 || arr(d.mockups).length > 0, "aplicações ou mockups");
    case "proximos":
      return [];
  }
  return [];
}

/**
 * O roteiro: os slides na ordem, com o que falta e a fala. Slide opcional sem
 * conteúdo sai (ex.: sem moodboard, sem o slide de referências); o Naming só
 * entra quando o projeto tem nome novo. A equipe pode tirar qualquer um.
 */
export function roteiroDaApresentacao(dadosBrutos: unknown, opcoes: { comNaming: boolean; semCaminhos?: boolean }): SlideDoRoteiro[] {
  const d = obj(dadosBrutos);
  const ap = obj(d.apresentacao);
  const falas = obj(ap.falas);
  const tirados = arr(ap.tirados).map(String);
  const saida: SlideDoRoteiro[] = [];
  for (const s of SLIDES_DA_APRESENTACAO) {
    if (s.id === "nome" && !opcoes.comNaming) continue;
    const falta = faltaNoSlide(s.id, d, opcoes.comNaming, opcoes.semCaminhos === true);
    const incluido = tirados.indexOf(s.id) < 0 && (s.sempre || falta.length === 0);
    saida.push({ id: s.id, n: 0, titulo: s.titulo, falta, fala: String(falas[s.id] == null ? "" : falas[s.id]).slice(0, 1500), incluido });
  }
  let n = 0;
  for (const s of saida) if (s.incluido) s.n = ++n;
  return saida;
}

/** Os campos das falas (um por slide incluído) para o "Preencher com IA". */
export function camposDasFalas(roteiro: SlideDoRoteiro[]): Array<{ chave: string; rotulo: string; tipo: "texto_longo"; valorAtual: string; dica: string; maximo: number }> {
  return roteiro
    .filter((s) => s.incluido)
    .map((s) => ({ chave: `falas.${s.id}`, rotulo: `Fala: ${s.titulo}`, tipo: "texto_longo" as const, valorAtual: s.fala, dica: "O que o apresentador diz neste slide, em 2 a 4 frases, no tom da marca. Só com o que está no projeto.", maximo: 700 }));
}

/** Pronto para apresentar? Os slides sempre presentes sem falta. */
export function prontoParaApresentar(roteiro: SlideDoRoteiro[]): { pronto: boolean; faltas: string[] } {
  const faltas: string[] = [];
  for (const s of roteiro) if (s.incluido) for (const f of s.falta) if (faltas.indexOf(f) < 0) faltas.push(f);
  return { pronto: faltas.length === 0, faltas };
}

/** Script da página exportada: setas e toque passam os slides (sem biblioteca). */
export const SCRIPT_DA_APRESENTACAO =
  "(function(){var s=document.querySelectorAll('[data-slide]');var i=0;function ir(n){i=Math.max(0,Math.min(s.length-1,n));for(var k=0;k<s.length;k++){s[k].style.display=k===i?'flex':'none';}var c=document.getElementById('contador');if(c){c.textContent=(i+1)+' / '+s.length;}}" +
  "document.addEventListener('keydown',function(e){if(e.key==='ArrowRight'||e.key===' '||e.key==='PageDown'){ir(i+1);}if(e.key==='ArrowLeft'||e.key==='PageUp'){ir(i-1);}});" +
  "var x0=null;document.addEventListener('touchstart',function(e){x0=e.touches[0].clientX;});document.addEventListener('touchend',function(e){if(x0===null){return;}var dx=e.changedTouches[0].clientX-x0;if(dx<-40){ir(i+1);}if(dx>40){ir(i-1);}x0=null;});" +
  "var b=document.querySelectorAll('[data-ir]');for(var k=0;k<b.length;k++){b[k].addEventListener('click',function(){ir(i+Number(this.getAttribute('data-ir')));});}ir(0);})();";
