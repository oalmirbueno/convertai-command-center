/**
 * Molde dos posts que mais performaram (12/10/2026, skills ig-hook-extractor e yt-viral).
 *
 * Os vencedores saem do múltiplo do perfil (_shared/multiplo-do-post.ts, 1,5x ou mais). O Jev escolhe a
 * fórmula do gancho entre as 10 da casa (Choice; julgamento sobre texto); o código monta o molde:
 * fórmula, gancho real, formato, estrutura e o esqueleto com {lacunas} para o Agente do Mês reaproveitar
 * com outro tema. Nunca copia o texto do post: o molde é a forma, não o conteúdo.
 * Sem o Jev, o molde sai sem fórmula (só gancho, formato e estrutura). Nunca lança.
 */
import { basesDoPerfil, multiploDoPost, type PostParaMultiplo, textoDoMultiplo } from "../../_shared/multiplo-do-post.ts";

export type FormulaDoGancho = { id: string; nome: string; superficie: "legenda" | "carrossel" | "reel"; objetivo: string; quando: string; esqueleto: string };

/** As 10 fórmulas de gancho (a partir das IG1 a IG10 da skill, em português e com palavras da casa). */
export const FORMULAS_DO_GANCHO: FormulaDoGancho[] = [
  { id: "f1", nome: "Número na frente", superficie: "legenda", objetivo: "salvar", quando: "abre com um resultado com número e prazo antes do 'mais'", esqueleto: "{resultado com número real} em {prazo}.\n\n{o que mudou, numa linha}.\n\n{pedido para salvar}" },
  { id: "f2", nome: "Verdade contrária", superficie: "legenda", objetivo: "compartilhar", quando: "contraria uma crença comum do público logo na primeira linha", esqueleto: "{crença comum} não funciona assim.\n\n{o porquê, com um fato do negócio}.\n\n{manda para quem ainda acredita nisso}" },
  { id: "f3", nome: "Cena que o público vive", superficie: "legenda", objetivo: "comentar", quando: "abre com uma situação do dia a dia que o cliente reconhece na hora", esqueleto: "{a cena que o cliente vive, numa linha}.\n\n{o que isso mostra}.\n\n{uma pergunta real para comentar}" },
  { id: "f4", nome: "Mini-história", superficie: "legenda", objetivo: "seguir", quando: "conta um erro, um bastidor ou um momento difícil em primeira pessoa", esqueleto: "{o momento ou o erro}.\n\n{o que aprendemos}.\n\n{convite para acompanhar}" },
  { id: "f5", nome: "Lista que se salva", superficie: "carrossel", objetivo: "salvar", quando: "promete uma lista numerada na capa e entrega um item por lâmina", esqueleto: "Capa: {N} {coisas} que {ganho} (a {k}ª quase ninguém faz)\nLâminas: um item por lâmina, com exemplo\nÚltima: resumo + salve para usar" },
  { id: "f6", nome: "Antes e depois", superficie: "carrossel", objetivo: "salvar", quando: "mostra uma transformação: como era, o que mudou e como ficou", esqueleto: "Capa: de {antes} para {depois}\nMeio: o que mudou, passo a passo\nÚltima: siga para ver o próximo" },
  { id: "f7", nome: "Mito ou verdade", superficie: "carrossel", objetivo: "compartilhar", quando: "derruba um mito do setor com prova", esqueleto: "Capa: {mito comum} (é mito)\nMeio: a verdade, com prova\nÚltima: manda para quem ainda acredita" },
  { id: "f8", nome: "Método pronto", superficie: "carrossel", objetivo: "salvar", quando: "entrega um passo a passo ou checklist para copiar", esqueleto: "Capa: o método que usamos para {resultado}\nMeio: os passos, um por lâmina\nÚltima: salve e aplique" },
  { id: "f9", nome: "Quebra de padrão no Reels", superficie: "reel", objetivo: "compartilhar", quando: "o primeiro segundo traz uma afirmação forte ou imagem inesperada, sem introdução", esqueleto: "Texto do 1º segundo: {afirmação que dá medo de perder}\n1ª fala: {direto ao ponto}\nFim: {manda para alguém}" },
  { id: "f10", nome: "Bastidor 'como fizemos'", superficie: "reel", objetivo: "seguir", quando: "mostra o resultado e depois o processo por trás", esqueleto: "{o resultado}: veja como fizemos\n{o processo mostrado em 3 a 5 cortes}\nFim: siga para o próximo" },
];

const formato = (t: string | null) => (t === "CAROUSEL_ALBUM" ? "carrossel" : t === "VIDEO" || t === "REELS" ? "reels" : "post");

export type PostDoMolde = PostParaMultiplo & { media_type: string | null; caption: string | null; permalink: string | null };

export type Molde = {
  multiplo: string;
  formato: string;
  gancho: string;
  formula: string | null;
  objetivo_da_formula: string | null;
  estrutura: string;
  esqueleto: string | null;
  link: string | null;
};

/** O que dá para ver da estrutura pelo texto (código): tamanho, lista, pergunta e o tipo do pedido no fim. */
export function estruturaDaLegenda(caption: string): string {
  const linhas = caption.split("\n").map((l) => l.trim()).filter(Boolean);
  const partes = [`${linhas.length} ${linhas.length === 1 ? "linha" : "linhas"}`, `${caption.length} caracteres`];
  if (linhas.filter((l) => /^(\d+[.)º]|[-•✅▪])\s/.test(l)).length >= 2) partes.push("tem lista");
  if (/\?\s*$/.test(linhas[linhas.length - 1] || "")) partes.push("fecha com pergunta");
  const fim = (linhas[linhas.length - 1] || "").toLowerCase();
  if (/salv/.test(fim)) partes.push("pede para salvar");
  else if (/(manda|envia|compartilh|marca)/.test(fim)) partes.push("pede para mandar a alguém");
  else if (/(chama|whats|direct|agend|link)/.test(fim)) partes.push("pede contato");
  return partes.join(", ");
}

type Jev = (e: { state: Record<string, unknown>; questions: Record<string, unknown> }) => Promise<{ answers: Record<string, unknown> }>;

/** Até 3 moldes dos vencedores (1,5x ou mais do normal do perfil). */
export async function moldesDosVencedores(posts: PostDoMolde[], jev: Jev | null, agora: Date = new Date()): Promise<Molde[]> {
  try {
    const bases = basesDoPerfil(posts, 90, agora);
    const vencedores = posts
      .map((p) => ({ p, m: multiploDoPost(p, bases) }))
      .filter((x) => x.m.destaque && (x.p.caption || "").trim().length >= 20)
      .sort((a, b) => (b.m.multiplo ?? 0) - (a.m.multiplo ?? 0))
      .slice(0, 3);
    if (!vencedores.length) return [];
    let escolhas: (FormulaDoGancho | null)[] = vencedores.map(() => null);
    if (jev) {
      const criteria = Object.fromEntries([...FORMULAS_DO_GANCHO.map((f) => [f.id, `${f.nome} (${f.superficie}): ${f.quando}`]), ["nenhuma", "nenhuma destas fórmulas descreve o gancho"]]);
      const questions: Record<string, unknown> = {};
      vencedores.forEach((_, i) => {
        questions[`f${i}`] = { type: "choice", instructions: `Qual fórmula de gancho o post \`posts.p${i}\` usa? Olhe a primeira linha da legenda (até 125 caracteres) e o formato.`, criteria };
      });
      const r = await jev({ state: { posts: Object.fromEntries(vencedores.map((v, i) => [`p${i}`, { formato: formato(v.p.media_type), legenda: (v.p.caption || "").slice(0, 600) }])) }, questions });
      escolhas = vencedores.map((_, i) => {
        const c = (r.answers[`f${i}`] as { choice?: string } | undefined)?.choice;
        return FORMULAS_DO_GANCHO.find((f) => f.id === c) ?? null;
      });
    }
    return vencedores.map((v, i) => {
      const caption = (v.p.caption || "").trim();
      const f = escolhas[i];
      return {
        multiplo: textoDoMultiplo(v.m),
        formato: formato(v.p.media_type),
        gancho: (caption.split("\n")[0] || "").slice(0, 125),
        formula: f ? f.nome : null,
        objetivo_da_formula: f ? f.objetivo : null,
        estrutura: estruturaDaLegenda(caption),
        esqueleto: f ? f.esqueleto : null,
        link: v.p.permalink,
      };
    });
  } catch {
    return [];
  }
}

/** O bloco para o pedido do Agente do Mês. */
export function blocoDosMoldes(moldes: Molde[]): string {
  if (!moldes.length) return "";
  return [
    "MOLDES DOS POSTS QUE MAIS PERFORMARAM (reaproveite a FORMA com outros temas do mês; nunca copie o texto):",
    ...moldes.map((m, i) => `${i + 1}. ${m.formato}, ${m.multiplo}. Gancho real: "${m.gancho}". ${m.formula ? `Fórmula: ${m.formula} (objetivo: ${m.objetivo_da_formula}). ` : ""}Estrutura: ${m.estrutura}.${m.esqueleto ? `\n   Esqueleto: ${m.esqueleto.replace(/\n/g, " / ")}` : ""}`),
  ].join("\n");
}
