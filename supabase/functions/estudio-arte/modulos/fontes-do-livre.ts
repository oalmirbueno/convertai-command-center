/**
 * Fontes da arte livre (20/10/2026, dono, com o print "Lâmina 1 não foi gerada: defina a tipografia do
 * cliente": "está muito burro, sendo que ele é avulso; tem que ser mais inteligente e não dar esse erro,
 * já tem que entender, pesquisar e gerar").
 *
 * A arte do Estúdio livre não tem cliente nem kit, então não tem fonte gravada. Em vez de recusar, o
 * Estúdio escolhe sozinho um par (título e texto) da biblioteca de fontes da agência (fontes_biblioteca,
 * com amostra em biblioteca/): os pares que a própria biblioteca recomenda, os mais ligados ao pedido
 * primeiro, e o Jev escolhe o que combina com o tema. O par fica gravado no trabalho
 * (estudio_livre_trabalhos.fontes): todas as lâminas da série usam a mesma letra.
 *
 * Puro (sem Deno nem npm): a função e os testes leem o mesmo arquivo.
 */

export type FonteDaBiblioteca = {
  id: string;
  familia: string;
  categoria?: string | null;
  personalidade?: string[] | null;
  usos?: string[] | null;
  nichos?: string[] | null;
  pareamentos?: Array<{ com?: unknown; papel_desta?: unknown; porque?: unknown }> | null;
  amostra_path?: string | null;
};

export type ParDaBiblioteca = { titulo: FonteDaBiblioteca; texto: FonteDaBiblioteca; porque: string };

/** Como a fonte entra no gerador (o mesmo formato de cliente_fontes). */
export type FonteDoLivre = { id: string; nome: string; papel: "titulo" | "texto"; amostra_path: string | null };

/** Quantos pares vão para o Jev escolher. */
export const MAX_PARES_DO_LIVRE = 24;

const limpo = (v: unknown, max = 200): string => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");
const semAcento = (s: string) => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const palavras = (s: string) => semAcento(s).split(/[^a-z0-9]+/).filter((p) => p.length >= 4);

/** Os pares que a biblioteca recomenda (cada pareamento vira título + texto, sem repetir). */
export function paresDaBiblioteca(biblioteca: FonteDaBiblioteca[]): ParDaBiblioteca[] {
  const porNome = new Map<string, FonteDaBiblioteca>();
  for (const f of biblioteca) if (f && limpo(f.familia)) porNome.set(semAcento(limpo(f.familia)), f);
  const vistos = new Set<string>();
  const saida: ParDaBiblioteca[] = [];
  for (const f of biblioteca) {
    for (const p of f.pareamentos ?? []) {
      const outra = porNome.get(semAcento(limpo(p && p.com, 80)));
      if (!outra || outra.id === f.id) continue;
      const desta = semAcento(limpo(p.papel_desta, 30));
      const titulo = desta.indexOf("texto") >= 0 ? outra : f;
      const texto = titulo === f ? outra : f;
      const chave = `${titulo.id}+${texto.id}`;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      saida.push({ titulo, texto, porque: limpo(p.porque, 240) });
    }
  }
  return saida;
}

/**
 * Os pares mais ligados ao pedido primeiro (palavras do pedido nos nichos, usos e personalidade das duas
 * fontes e no porquê do par); o empate fica na ordem da biblioteca. No máximo MAX_PARES_DO_LIVRE.
 */
export function paresParaOPedido(pares: ParDaBiblioteca[], pedido: string, max = MAX_PARES_DO_LIVRE): ParDaBiblioteca[] {
  const doPedido = new Set(palavras(pedido));
  const nota = (par: ParDaBiblioteca) => {
    const campos = [par.titulo, par.texto]
      .map((f) => [...(f.nichos ?? []), ...(f.usos ?? []), ...(f.personalidade ?? []), f.categoria ?? ""].join(" "))
      .join(" ") + " " + par.porque;
    let n = 0;
    for (const p of new Set(palavras(campos))) if (doPedido.has(p)) n += 1;
    return n;
  };
  return pares
    .map((par, i) => ({ par, i, n: nota(par) }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .slice(0, Math.max(1, max))
    .map((x) => x.par);
}

/** Opções da pergunta Choice do Jev (par_0, par_1...). */
export function criteriosDosPares(pares: ParDaBiblioteca[]): Record<string, string> {
  const desc = (f: FonteDaBiblioteca) => `${limpo(f.familia, 60)} (${[limpo(f.categoria, 40), ...(f.personalidade ?? []).slice(0, 4)].filter(Boolean).join(", ")})`;
  const saida: Record<string, string> = {};
  pares.forEach((p, i) => {
    saida[`par_${i}`] = `Título em ${desc(p.titulo)} e texto em ${desc(p.texto)}.${p.porque ? ` ${p.porque}` : ""}`;
  });
  return saida;
}

export const PERGUNTA_DAS_FONTES_DO_LIVRE =
  "Qual par de fontes (título e texto) combina melhor com o tema, o público e o clima desta arte de Instagram descrita em `arte`, para ser lida no celular? Pense no assunto do pedido (por exemplo: convite, evento, promoção, aviso), em quem vai ler e na sensação que a peça precisa passar.";

/** O par escolhido como fontes do gerador (título e texto, com a amostra da biblioteca). */
export function fontesDoPar(par: ParDaBiblioteca): FonteDoLivre[] {
  const amostra = (f: FonteDaBiblioteca) => {
    const c = limpo(f.amostra_path, 400);
    return c.indexOf("biblioteca/") === 0 ? c : null;
  };
  return [
    { id: par.titulo.id, nome: limpo(par.titulo.familia, 80), papel: "titulo", amostra_path: amostra(par.titulo) },
    { id: par.texto.id, nome: limpo(par.texto.familia, 80), papel: "texto", amostra_path: amostra(par.texto) },
  ];
}

/** Fontes já gravadas no trabalho livre (estudio_livre_trabalhos.fontes); vazio quando não há. */
export function fontesGravadasDoLivre(v: unknown): FonteDoLivre[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((f) => (f && typeof f === "object" ? f as Record<string, unknown> : null))
    .filter((f): f is Record<string, unknown> => !!f && !!limpo(f.nome) && (f.papel === "titulo" || f.papel === "texto"))
    .map((f) => ({ id: limpo(f.id, 64), nome: limpo(f.nome, 80), papel: f.papel as "titulo" | "texto", amostra_path: limpo(f.amostra_path, 400) || null }));
}
