import { duracaoDoClipe, midiaDaFonte, type ProjetoDeEdicao } from "../../../supabase/functions/_shared/projeto-de-edicao";
import { rotuloDoClipe, type Apelidos } from "./apelidos";
import type { ItemDaBiblioteca } from "./biblioteca";
import { acharDuplicados, idsRepetidos, type AssinaturasDosArquivos } from "./duplicados";
import { emOrdem } from "./operacoes";

/**
 * Busca com filtros do editor (02/10, dono: "coloque filtros de pesquisa
 * quando eu quiser pesquisar alguma coisa"). Um filtro só serve a Mídia e a
 * linha do tempo, e o agente usa o mesmo ("mostre só os gerados", "ache os
 * takes duplicados"). Funções puras: a tela só desenha o que sai daqui.
 */

export type TipoDaBusca = "todos" | "video" | "imagem" | "audio";
export type OrigemDaBusca = "todas" | "bruto" | "gerado" | "acervo";
export type UsoDaBusca = "todos" | "usado" | "sem_uso";
export type DuracaoDaBusca = "todas" | "curta" | "media" | "longa";

export interface FiltroDaBusca {
  texto: string;
  tipo: TipoDaBusca;
  origem: OrigemDaBusca;
  uso: UsoDaBusca;
  duracao: DuracaoDaBusca;
  /** Só os takes repetidos (os que sairiam no "Tirar takes repetidos"). */
  duplicados: boolean;
}

export const FILTRO_VAZIO: FiltroDaBusca = { texto: "", tipo: "todos", origem: "todas", uso: "todos", duracao: "todas", duplicados: false };

export const OPCOES_DO_TIPO: { valor: TipoDaBusca; rotulo: string }[] = [
  { valor: "todos", rotulo: "Todo tipo" },
  { valor: "video", rotulo: "Vídeo" },
  { valor: "imagem", rotulo: "Imagem" },
  { valor: "audio", rotulo: "Áudio" },
];
export const OPCOES_DA_ORIGEM: { valor: OrigemDaBusca; rotulo: string }[] = [
  { valor: "todas", rotulo: "Toda origem" },
  { valor: "bruto", rotulo: "Bruto" },
  { valor: "gerado", rotulo: "Gerado" },
  { valor: "acervo", rotulo: "Acervo" },
];
export const OPCOES_DO_USO: { valor: UsoDaBusca; rotulo: string }[] = [
  { valor: "todos", rotulo: "Usado ou não" },
  { valor: "usado", rotulo: "Na linha do tempo" },
  { valor: "sem_uso", rotulo: "Fora da linha" },
];
export const OPCOES_DA_DURACAO: { valor: DuracaoDaBusca; rotulo: string }[] = [
  { valor: "todas", rotulo: "Toda duração" },
  { valor: "curta", rotulo: "Até 5 s" },
  { valor: "media", rotulo: "5 a 30 s" },
  { valor: "longa", rotulo: "Mais de 30 s" },
];

const sem = (t: string) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** Filtro conferido (vem da tela, do armazenamento ou do agente). */
export function lerFiltro(v: unknown): FiltroDaBusca {
  const o = v && typeof v === "object" ? (v as Record<string, unknown>) : {};
  const de = <T extends string>(x: unknown, opcoes: { valor: T }[], padrao: T): T => (opcoes.some((p) => p.valor === x) ? (x as T) : padrao);
  return {
    texto: String(o.texto == null ? "" : o.texto).slice(0, 80),
    tipo: de(o.tipo, OPCOES_DO_TIPO, "todos"),
    origem: de(o.origem, OPCOES_DA_ORIGEM, "todas"),
    uso: de(o.uso, OPCOES_DO_USO, "todos"),
    duracao: de(o.duracao, OPCOES_DA_DURACAO, "todas"),
    duplicados: o.duplicados === true,
  };
}

export const filtroAtivo = (f: FiltroDaBusca) => !!f.texto.trim() || f.tipo !== "todos" || f.origem !== "todas" || f.uso !== "todos" || f.duracao !== "todas" || f.duplicados;

/** Quantos filtros (fora o texto) estão ligados: vai no botão "Filtros". */
export const filtrosLigados = (f: FiltroDaBusca) => [f.tipo !== "todos", f.origem !== "todas", f.uso !== "todos", f.duracao !== "todas", f.duplicados].filter(Boolean).length;

/** Origem pelo tipo do arquivo (video_arquivos.tipo) e pelo caminho. */
export function origemDoArquivo(tipo: string | null | undefined, caminho?: string | null, origemDoItem?: string | null): Exclude<OrigemDaBusca, "todas"> {
  const t = String(tipo || "").toLowerCase();
  const c = String(caminho || "").toLowerCase();
  if (t === "acervo" || t === "marca" || t === "logo" || /\/(acervo|marca|kit)\//.test(c)) return "acervo";
  if (origemDoItem === "gerado" || origemDoItem === "pedido" || ["gerado", "angulo", "quadro", "continuar", "transicao", "cena", "elemento", "broll", "cenario"].indexOf(t) >= 0) return "gerado";
  return "bruto";
}

export function faixaDaDuracao(d: number | null | undefined): Exclude<DuracaoDaBusca, "todas"> | null {
  if (typeof d !== "number" || !(d > 0)) return null;
  return d <= 5 ? "curta" : d <= 30 ? "media" : "longa";
}

/** Todas as palavras do texto aparecem em algum dos campos. */
export function bateTexto(texto: string, campos: (string | null | undefined)[]): boolean {
  const palavras = sem(texto).split(/\s+/).filter(Boolean);
  if (!palavras.length) return true;
  const alvo = sem(campos.filter(Boolean).join(" "));
  return palavras.every((p) => alvo.indexOf(p) >= 0);
}

/** Arquivos e caminhos que estão na linha do tempo (algum clipe usa). */
export function usadosNaLinha(p: ProjetoDeEdicao): { arquivos: Set<string>; caminhos: Set<string> } {
  const arquivos = new Set<string>();
  const caminhos = new Set<string>();
  p.trilhas.forEach((t) =>
    t.clipes.forEach((c) => {
      const f = c.fonte ? p.fontes[c.fonte] : null;
      if (!f) return;
      if (f.arquivo_id) arquivos.add(f.arquivo_id);
      if (f.storage_path) caminhos.add(f.storage_path);
    }),
  );
  return { arquivos, caminhos };
}

/** A Mídia filtrada (a ordem de entrada é mantida). */
export function filtrarMidia<T extends ItemDaBiblioteca>(itens: T[], p: ProjetoDeEdicao, f: FiltroDaBusca, assinaturas?: AssinaturasDosArquivos | null): T[] {
  if (!filtroAtivo(f)) return itens;
  const usados = usadosNaLinha(p);
  const repetidos = f.duplicados ? midiaRepetida(itens, assinaturas) : null;
  return itens.filter((i) => {
    const midia = midiaDaFonte(i.tipo, i.nome, i.storage_path);
    if (f.tipo !== "todos" && midia !== f.tipo) return false;
    if (f.origem !== "todas" && origemDoArquivo(i.tipo, i.storage_path, i.origem) !== f.origem) return false;
    const usado = (!!i.arquivo_id && usados.arquivos.has(i.arquivo_id)) || usados.caminhos.has(i.storage_path);
    if (f.uso === "usado" && !usado) return false;
    if (f.uso === "sem_uso" && usado) return false;
    if (f.duracao !== "todas" && faixaDaDuracao(i.duracao_s) !== f.duracao) return false;
    if (repetidos && !repetidos.has(i.id)) return false;
    return bateTexto(f.texto, [i.nome, i.tipo, midia]);
  });
}

/** Itens da Mídia que repetem outro (mesmo sha256, ou mesmo tamanho e duração): fica de fora o primeiro de cada grupo. */
export function midiaRepetida<T extends ItemDaBiblioteca>(itens: T[], assinaturas?: AssinaturasDosArquivos | null): Set<string> {
  const vistos: Record<string, true> = {};
  const repetidos = new Set<string>();
  itens.forEach((i) => {
    const s = i.arquivo_id && assinaturas ? assinaturas[i.arquivo_id] : null;
    const chave = s && s.sha256 ? `sha:${s.sha256}` : s && s.bytes ? `b:${s.bytes}:${Math.round((i.duracao_s || 0) * 10)}` : null;
    if (!chave) return;
    if (vistos[chave]) repetidos.add(i.id);
    else vistos[chave] = true;
  });
  return repetidos;
}

/** Clipes da linha do tempo que batem com o filtro (ids). O filtro de uso não vale aqui (tudo está na linha). */
export function clipesQueBatem(p: ProjetoDeEdicao, f: FiltroDaBusca, apelidos: Apelidos, assinaturas?: AssinaturasDosArquivos | null): string[] {
  const repetidos = f.duplicados ? new Set(idsRepetidos(acharDuplicados(p, assinaturas))) : null;
  const ids: string[] = [];
  p.trilhas.forEach((t) =>
    emOrdem(t).forEach((c) => {
      const fonte = c.fonte ? p.fontes[c.fonte] : null;
      if (f.tipo !== "todos" && (!fonte || fonte.midia !== f.tipo)) return;
      if (f.origem !== "todas") {
        const geradoPeloClipe = c.origem && ["angulo", "continuar", "transicao", "cena"].indexOf(c.origem.tipo) >= 0;
        const origem = geradoPeloClipe ? "gerado" : fonte ? origemDoArquivo(fonte.tipo, fonte.storage_path) : null;
        if (origem !== f.origem) return;
      }
      if (f.duracao !== "todas" && faixaDaDuracao(duracaoDoClipe(c)) !== f.duracao) return;
      if (repetidos && !repetidos.has(c.id)) return;
      if (!bateTexto(f.texto, [apelidos.porId[c.id], rotuloDoClipe(p, c), fonte ? fonte.nome : null, c.texto, t.nome])) return;
      ids.push(c.id);
    }),
  );
  return ids;
}

/** Frase curta do filtro ("vídeo, gerado, 'praia'") para o agente e a tela. */
export function textoDoFiltro(f: FiltroDaBusca): string {
  const partes: string[] = [];
  if (f.tipo !== "todos") partes.push((OPCOES_DO_TIPO.find((o) => o.valor === f.tipo) || { rotulo: f.tipo }).rotulo.toLowerCase());
  if (f.origem !== "todas") partes.push((OPCOES_DA_ORIGEM.find((o) => o.valor === f.origem) || { rotulo: f.origem }).rotulo.toLowerCase());
  if (f.uso !== "todos") partes.push((OPCOES_DO_USO.find((o) => o.valor === f.uso) || { rotulo: f.uso }).rotulo.toLowerCase());
  if (f.duracao !== "todas") partes.push((OPCOES_DA_DURACAO.find((o) => o.valor === f.duracao) || { rotulo: f.duracao }).rotulo.toLowerCase());
  if (f.duplicados) partes.push("só repetidos");
  if (f.texto.trim()) partes.push(`"${f.texto.trim()}"`);
  return partes.length ? partes.join(", ") : "tudo";
}
