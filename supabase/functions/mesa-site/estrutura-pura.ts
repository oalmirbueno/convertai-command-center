/**
 * Peças puras da estrutura do site (frente SIT2): o vitest lê este arquivo
 * (sem Deno e sem banco); estrutura.ts usa as mesmas.
 */
import type { LinhaDoSite } from "../_shared/pacote-do-site.ts";
import { type DnaDoSite, dnaManual } from "../_shared/site-metodo.ts";
import { normalizarEstilo, presetDeEstilo, presetDeMotion, secaoDaBiblioteca } from "../_shared/site-biblioteca.ts";

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const semTravessao = (s: string) => s.replace(/\s*[—–]\s*/g, ", ");
const txt = (v: unknown, max: number) => semTravessao(String(v ?? "").replace(/\s+/g, " ").trim()).slice(0, max);

/**
 * Estilo novo e, quando o preset muda, o DNA dele (nicho, cores e leitura das
 * referências ficam). UXM: `atributos` são os do estilo da base UI UX Pro Max
 * (PRESET_DO_ESTILO[...].dna): vencem os do preset e entram mesmo quando o
 * preset ligado é o mesmo (14 estilos caem no mesmo preset); a pessoa troca o
 * preset depois e o DNA do preset volta.
 */
export function camposDoEstilo(s: LinhaDoSite, pedido: { preset?: unknown; motion?: unknown; aplicarDna?: boolean; atributos?: string[] }): Record<string, unknown> {
  const atual = normalizarEstilo(s.estilo || {});
  // SPV: os ajustes de cor e fonte feitos na prévia ficam quando o preset ou o movimento mudam.
  const estilo = normalizarEstilo({ preset: pedido.preset !== undefined ? pedido.preset : atual.preset, motion: pedido.motion !== undefined ? pedido.motion : atual.motion, ajustes: atual.ajustes });
  const campos: Record<string, unknown> = { estilo, pacote_mudou_em: new Date().toISOString() };
  const p = presetDeEstilo(estilo.preset);
  const doEstiloDaBase = Array.isArray(pedido.atributos) && pedido.atributos.length ? pedido.atributos : null;
  if (p && pedido.aplicarDna !== false && (estilo.preset !== atual.preset || doEstiloDaBase)) {
    const antes = s.dna && Array.isArray((s.dna as { atributos?: unknown }).atributos) ? (s.dna as unknown as DnaDoSite) : null;
    const primeiroMotion = presetDeMotion(estilo.motion[0]);
    campos.dna = dnaManual({ atributos: doEstiloDaBase || p.atributos, movimento: primeiroMotion ? primeiroMotion.base : p.movimento, nivel: p.nivel, nicho: antes ? antes.nicho : obj(s.direcao).nicho }, antes);
  }
  return campos;
}

/** Chave pública nova do formulário (24 letras e números). */
export function novaChaveDoFormulario(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return Array.from(bytes).map((b) => "abcdefghijklmnopqrstuvwxyz0123456789".charAt(b % 36)).join("");
}

export type OpcaoDaSecao = { titulo: string; texto: string; itens: string[]; cta: string };

/** 3 opções no máximo, título no limite de palavras da biblioteca, itens no limite, sem travessão. */
export function normalizarOpcoesDaSecao(bruto: unknown, tipo: string): OpcaoDaSecao[] {
  const lib = secaoDaBiblioteca(tipo);
  const maxPalavras = lib ? lib.max_palavras_titulo : 8;
  const maxItens = lib && lib.itens ? lib.itens.max : 8;
  return (Array.isArray(obj(bruto).opcoes) ? (obj(bruto).opcoes as unknown[]) : []).slice(0, 3).map((b) => {
    const o = obj(b);
    return {
      titulo: txt(o.titulo, 140).split(" ").filter(Boolean).slice(0, maxPalavras).join(" "),
      texto: txt(o.texto, 700),
      itens: (Array.isArray(o.itens) ? o.itens : []).slice(0, maxItens).map((i) => txt(i, 240)).filter(Boolean),
      cta: txt(o.cta, 40).split(" ").slice(0, 5).join(" "),
    };
  }).filter((o) => o.titulo || o.texto);
}

/**
 * Edita a opção escolhida: uma seção (titulo, texto, itens) ou a abertura
 * (headline, subtitulo, cta) e o FAQ. Vale para "usar esta opção da seção" e
 * para o que o Preencher com IA aplicou.
 */
export function editarCopy(conteudo: Record<string, unknown>, pedido: { secao?: string | null; campos: Record<string, unknown> }): Record<string, unknown> | null {
  const opcoes = Array.isArray(conteudo.opcoes) ? (conteudo.opcoes as Array<Record<string, unknown>>).slice() : [];
  const i = Number(conteudo.escolhida);
  if (!Number.isInteger(i) || !opcoes[i]) return null;
  const op = { ...opcoes[i] };
  const f = pedido.campos;
  if (pedido.secao) {
    const secoes = Array.isArray(op.secoes) ? (op.secoes as Array<Record<string, unknown>>).slice() : [];
    const j = secoes.findIndex((x) => x.id === pedido.secao);
    const atual = j >= 0 ? secoes[j] : { id: pedido.secao, titulo: "", texto: "", itens: [] };
    const nova = {
      ...atual,
      ...(f.titulo !== undefined ? { titulo: txt(f.titulo, 140) } : {}),
      ...(f.texto !== undefined ? { texto: txt(f.texto, 900) } : {}),
      ...(f.itens !== undefined ? { itens: (Array.isArray(f.itens) ? f.itens : String(f.itens || "").split("\n")).map((x) => txt(x, 240)).filter(Boolean).slice(0, 12) } : {}),
      ...(f.cta !== undefined ? { cta: txt(f.cta, 40) } : {}),
    };
    if (j >= 0) secoes[j] = nova;
    else secoes.push(nova);
    op.secoes = secoes;
  } else {
    if (f.headline !== undefined) op.headline = txt(f.headline, 120).split(" ").filter(Boolean).slice(0, 8).join(" ");
    if (f.subtitulo !== undefined) op.subtitulo = txt(f.subtitulo, 240);
    if (f.cta !== undefined) op.cta = txt(f.cta, 40);
    if (f.faq !== undefined && Array.isArray(f.faq)) op.faq = (f.faq as unknown[]).map((x) => ({ pergunta: txt(obj(x).pergunta, 200), resposta: txt(obj(x).resposta, 600) })).filter((x) => x.pergunta && x.resposta).slice(0, 8);
  }
  opcoes[i] = op;
  return { ...conteudo, opcoes, editado_em: new Date().toISOString() };
}

/** Sujeito da imagem de um slot, a partir da copy da seção e do negócio (nunca pessoa real, logo ou texto). */
export function sujeitoDoSlot(rotulo: string, tituloDaSecao: string | null, negocio: string | null): string {
  const base = tituloDaSecao || rotulo;
  return txt(`${base}${negocio ? `, no contexto de ${negocio}` : ""}`, 380);
}

