import { duracaoDoClipe, type ClipeDoProjeto, type FonteDoProjeto, type ProjetoDeEdicao } from "../../../supabase/functions/_shared/projeto-de-edicao";
import { emOrdem, type Operacao } from "./operacoes";

/**
 * Takes repetidos na linha do tempo (02/10, dono: "pedi para tirar os takes
 * duplicados e ele não mexeu em nada"). Regra FIXA, sem IA: dois clipes da
 * trilha de vídeo são o mesmo take quando vêm da MESMA mídia e mostram quase o
 * mesmo trecho dela.
 *
 * Mesma mídia: a mesma fonte do projeto, ou fontes diferentes que são o mesmo
 * arquivo (mesmo arquivo_id, mesmo caminho no Storage, mesmo sha256 lido da
 * Entrada, mesmo tamanho em bytes com a mesma duração, ou o mesmo nome sem
 * "(1)"/"cópia" com a mesma duração).
 * Mesmo trecho: os trechos da fonte se sobrepõem em pelo menos metade do
 * menor. Pedaços de um take dividido (encostados, sem sobrepor) não contam.
 *
 * Fica o PRIMEIRO na linha do tempo; os outros saem (com "puxar o resto",
 * a trilha encosta).
 */

export interface AssinaturaDoArquivo {
  sha256?: string | null;
  bytes?: number | null;
}

/** Por arquivo_id (video_arquivos.id): o que a Entrada já leu do arquivo. */
export type AssinaturasDosArquivos = Record<string, AssinaturaDoArquivo>;

export type MotivoDoDuplicado = "mesma_fonte" | "mesmo_arquivo" | "mesmo_conteudo" | "mesmo_nome_e_duracao";

export interface GrupoDeDuplicados {
  trilha: string;
  /** Id do clipe que fica (o primeiro na linha do tempo). */
  manter: string;
  /** Ids dos que repetem o que fica. */
  repetidos: string[];
  motivo: MotivoDoDuplicado;
}

const TOLERANCIA_DA_DURACAO_S = 0.05;
const SOBREPOSICAO_MINIMA = 0.5;

/** Nome sem extensão, acento, "(1)", "cópia" ou "copy" no fim ("IMG_2" e "IMG_3" continuam diferentes). */
export function nomeBaseDoArquivo(nome: string): string {
  let t = String(nome || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\.[a-z0-9]{2,5}$/, "");
  for (let i = 0; i < 3; i++) {
    t = t
      .replace(/\s*\(\d+\)$/, "")
      .replace(/[\s_-]*(copia|copy|duplicad[oa])(\s*\d+)?$/, "")
      .trim();
  }
  return t.replace(/[\s_-]+/g, " ");
}

const mesmaDuracao = (a: number | null, b: number | null) => typeof a === "number" && typeof b === "number" && a > 0 && b > 0 && Math.abs(a - b) <= TOLERANCIA_DA_DURACAO_S;

/** Por que duas fontes são o mesmo arquivo (null = não são). */
export function mesmoArquivo(a: FonteDoProjeto, b: FonteDoProjeto, assinaturas?: AssinaturasDosArquivos | null): MotivoDoDuplicado | null {
  if (a.chave === b.chave) return "mesma_fonte";
  if (a.midia !== b.midia) return null;
  if (a.arquivo_id && a.arquivo_id === b.arquivo_id) return "mesmo_arquivo";
  if (a.storage_path && a.storage_path === b.storage_path) return "mesmo_arquivo";
  const sa = a.arquivo_id && assinaturas ? assinaturas[a.arquivo_id] : null;
  const sb = b.arquivo_id && assinaturas ? assinaturas[b.arquivo_id] : null;
  if (sa && sb && sa.sha256 && sb.sha256) return sa.sha256 === sb.sha256 ? "mesmo_conteudo" : null;
  if (sa && sb && sa.bytes && sb.bytes && sa.bytes === sb.bytes && (a.midia === "imagem" || mesmaDuracao(a.duracao_s, b.duracao_s))) return "mesmo_conteudo";
  if (a.midia === "imagem") return null;
  if (nomeBaseDoArquivo(a.nome) && nomeBaseDoArquivo(a.nome) === nomeBaseDoArquivo(b.nome) && mesmaDuracao(a.duracao_s, b.duracao_s)) return "mesmo_nome_e_duracao";
  return null;
}

/** Quanto dos dois trechos da fonte se sobrepõe, em fração do menor (0 a 1). */
export function sobreposicaoDaFonte(a: ClipeDoProjeto, b: ClipeDoProjeto): number {
  const ini = Math.max(a.entrada_s, b.entrada_s);
  const fim = Math.min(a.saida_s, b.saida_s);
  const menor = Math.min(a.saida_s - a.entrada_s, b.saida_s - b.entrada_s);
  if (menor <= 0) return 0;
  return Math.max(0, fim - ini) / menor;
}

/** Grupos de takes repetidos nas trilhas de vídeo (a ordem é a da linha do tempo). */
export function acharDuplicados(p: ProjetoDeEdicao, assinaturas?: AssinaturasDosArquivos | null): GrupoDeDuplicados[] {
  const grupos: GrupoDeDuplicados[] = [];
  p.trilhas.forEach((t) => {
    if (t.tipo !== "video") return;
    const mantidos: { c: ClipeDoProjeto; g: GrupoDeDuplicados | null }[] = [];
    emOrdem(t).forEach((c) => {
      const f = c.fonte ? p.fontes[c.fonte] : null;
      if (!f || duracaoDoClipe(c) <= 0) return;
      for (const m of mantidos) {
        const fm = m.c.fonte ? p.fontes[m.c.fonte] : null;
        if (!fm) continue;
        const motivo = mesmoArquivo(fm, f, assinaturas);
        if (!motivo) continue;
        const parte = f.midia === "imagem" ? 1 : sobreposicaoDaFonte(m.c, c);
        if (parte < SOBREPOSICAO_MINIMA) continue;
        if (!m.g) {
          m.g = { trilha: t.id, manter: m.c.id, repetidos: [], motivo };
          grupos.push(m.g);
        }
        m.g.repetidos.push(c.id);
        return;
      }
      mantidos.push({ c, g: null });
    });
  });
  return grupos;
}

/** Ids de todos os repetidos (os que sairiam). */
export const idsRepetidos = (grupos: GrupoDeDuplicados[]) => grupos.reduce((l, g) => l.concat(g.repetidos), [] as string[]);

/** Operações para tirar os repetidos (do último para o primeiro); com `ondular`, a trilha encosta. */
export function opsDeRemoverDuplicados(grupos: GrupoDeDuplicados[], ondular = true): Operacao[] {
  return idsRepetidos(grupos)
    .slice()
    .reverse()
    .map((id): Operacao => ({ op: "remover", clipe: id, ondular }));
}

export const ROTULO_DO_MOTIVO: Record<MotivoDoDuplicado, string> = {
  mesma_fonte: "mesmo take",
  mesmo_arquivo: "mesmo arquivo",
  mesmo_conteudo: "mesmo conteúdo",
  mesmo_nome_e_duracao: "mesmo nome e duração",
};

/** "c3 repete c2 (mesmo take)" com os apelidos dados. */
export function textoDosDuplicados(grupos: GrupoDeDuplicados[], porId: Record<string, string>): string {
  if (!grupos.length) return "Nenhum take repetido na trilha de vídeo.";
  return grupos.map((g) => `${g.repetidos.map((id) => porId[id] || "clipe").join(", ")} ${g.repetidos.length === 1 ? "repete" : "repetem"} ${porId[g.manter] || "clipe"} (${ROTULO_DO_MOTIVO[g.motivo]})`).join("; ") + ".";
}
