/**
 * Versões do que o site decidiu (frente SIT2, 30/09/2026): a fotografia de
 * briefing, mapa, estilo, conteúdo, imagens, integrações e SEO antes de cada
 * mudança, para comparar e voltar. O código tem as versões dele no git do
 * worker (um commit por passo; voltar = trabalho "desfazer" do motor).
 *
 * Puro: a tela compara com a mesma função que o servidor usa.
 */

export const CAMPOS_VERSIONADOS = ["tipo", "briefing", "referencias", "dna", "direcao", "conteudo", "imagens", "mapa", "estilo", "integracoes", "seo"] as const;
export type CampoVersionado = (typeof CAMPOS_VERSIONADOS)[number];

export function dadosDaVersao(site: Record<string, unknown>): Record<string, unknown> {
  const d: Record<string, unknown> = {};
  for (const c of CAMPOS_VERSIONADOS) if (site[c] !== undefined) d[c] = site[c];
  return d;
}

/** JSON com as chaves em ordem (a mesma decisão dá a mesma assinatura). */
function estavel(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(estavel).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o).filter((k) => k !== "salvo_em").sort().map((k) => `${JSON.stringify(k)}:${estavel(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(v === undefined ? null : v);
}

/** Assinatura curta (FNV-1a de 32 bits, duas voltas): versão igual à última não é gravada de novo. */
export function assinaturaDaVersao(dados: Record<string, unknown>): string {
  const texto = estavel(dados);
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ texto.length;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ ((c * 31) & 0xffff), 0x01000193) >>> 0;
  }
  return (a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0")).slice(0, 16);
}

const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Resumo de uma linha por campo, para a comparação caber na tela. */
export function resumoDoCampo(campo: CampoVersionado, v: unknown): string {
  const o = obj(v);
  switch (campo) {
    case "tipo":
      return v ? String(v) : "sem tipo";
    case "briefing": {
      const r = obj(o.respostas);
      const preenchidas = Object.keys(r).filter((k) => String(r[k] ?? "").trim()).length;
      return `${preenchidas} resposta(s)${o.fonte === "brf" ? " do briefing do cliente" : ""}`;
    }
    case "referencias":
      return `${lista(v).filter((x) => !obj(x).arquivada).length} referência(s)`;
    case "dna": {
      const at = lista(o.atributos).map((a) => String(obj(a).id || a)).join(", ");
      return at ? `${at}${o.movimento ? ` · ${o.movimento}` : ""}` : "sem DNA";
    }
    case "direcao":
      return `${lista(o.secoes).length} seção(ões)${o.nicho ? ` · ${o.nicho}` : ""}`;
    case "conteudo": {
      const ops = lista(o.opcoes);
      const i = Number(o.escolhida);
      const escolhida = Number.isInteger(i) && ops[i] ? String(obj(ops[i]).headline || "") : "";
      return ops.length ? `${ops.length} opção(ões)${escolhida ? ` · escolhida: ${escolhida}` : " · nenhuma escolhida"}` : "sem conteúdo";
    }
    case "imagens":
      return `${lista(v).filter((x) => obj(x).escolhida !== false).length} imagem(ns) no site`;
    case "mapa": {
      const paginas = lista(o.paginas).map((p) => obj(p));
      if (!paginas.length) return "sem mapa";
      const secoes = paginas.reduce((n, p) => n + lista(p.secoes).length, 0);
      return `${o.tipo ? `${o.tipo} · ` : ""}${paginas.length} página(s) · ${secoes} seção(ões): ${paginas.map((p) => String(p.titulo || "")).join(", ")}`;
    }
    case "estilo":
      return `${o.preset ? String(o.preset) : "sem preset"}${lista(o.motion).length ? ` · movimento: ${lista(o.motion).join(", ")}` : ""}`;
    case "integracoes": {
      const ligadas: string[] = [];
      if (obj(o.whatsapp).ligado) ligadas.push("WhatsApp");
      if (obj(o.formulario).ligado) ligadas.push("formulário");
      if (obj(o.pixel_meta).id) ligadas.push("pixel");
      if (obj(o.ga4).id) ligadas.push("GA4");
      if (obj(o.mapa).ligado) ligadas.push("mapa");
      if (obj(o.cookies).ligado) ligadas.push("cookies");
      return ligadas.length ? ligadas.join(", ") : "nenhuma";
    }
    case "seo":
      return o.titulo ? `${String(o.titulo)}${o.indexar === false ? " · sem indexar" : ""}` : "sem título de SEO";
  }
  return "";
}

export const ROTULO_DO_CAMPO: Record<CampoVersionado, string> = {
  tipo: "Tipo de site",
  briefing: "Briefing",
  referencias: "Referências",
  dna: "DNA",
  direcao: "Direção",
  conteudo: "Conteúdo",
  imagens: "Imagens",
  mapa: "Mapa do site",
  estilo: "Estilo",
  integracoes: "Integrações",
  seo: "SEO",
};

/** O que muda de uma versão para a outra (só os campos diferentes). */
export function diferencasEntreVersoes(antes: Record<string, unknown>, depois: Record<string, unknown>): Array<{ campo: CampoVersionado; rotulo: string; antes: string; depois: string }> {
  const saida: Array<{ campo: CampoVersionado; rotulo: string; antes: string; depois: string }> = [];
  for (const c of CAMPOS_VERSIONADOS) {
    if (!(c in antes) && !(c in depois)) continue;
    if (estavel(antes[c]) === estavel(depois[c])) continue;
    const a = resumoDoCampo(c, antes[c]);
    const d = resumoDoCampo(c, depois[c]);
    saida.push({ campo: c, rotulo: ROTULO_DO_CAMPO[c], antes: a, depois: a === d ? `${d} (detalhes mudaram)` : d });
  }
  return saida;
}

/**
 * Campos para voltar a uma versão. A chave pública do formulário do site
 * atual fica (um site publicado continua recebendo contatos).
 */
export function camposParaRestaurar(versao: Record<string, unknown>, atual: Record<string, unknown>): Record<string, unknown> {
  const campos: Record<string, unknown> = {};
  for (const c of CAMPOS_VERSIONADOS) if (versao[c] !== undefined) campos[c] = versao[c];
  const chaveAtual = obj(obj(atual.integracoes).formulario).chave;
  if (typeof chaveAtual === "string" && campos.integracoes !== undefined) {
    const i = obj(campos.integracoes);
    campos.integracoes = { ...i, formulario: { ...obj(i.formulario), chave: chaveAtual } };
  }
  return campos;
}
