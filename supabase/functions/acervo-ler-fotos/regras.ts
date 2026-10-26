/**
 * Leitura das fotos do acervo (26/10/2026). Regras puras: a função, a tela e
 * os testes (vitest) leem este arquivo, sem Deno nem banco.
 *
 * Dono: "o Estúdio tem que ler as fotos e achar interessante colocar de forma
 * inteligente imagens reais quando tem". A mídia da peça escolhe a foto pelo
 * TEXTO (nome, descrição, etiquetas), e muita foto chega sem descrição (Terra
 * Flor 0 de 29): nunca era escolhida. O robô lê essas fotos por visão, no
 * mesmo leitor do organizador do Workspace (lotes, cópia leve, recusa uma a
 * uma), e grava descrição, etiquetas e categoria. Nunca apaga nada; a foto que
 * não abre ganha uma etiqueta de tentativa e sai da fila depois de 3.
 */
import { CATEGORIAS_DO_ACERVO, TAG_ARTE_OU_PRINT, TAG_FOTO_REAL, type CategoriaDoAcervo } from "../agente-calendario/modulos/midia-da-peca-regras.ts";

export { CATEGORIAS_DO_ACERVO, TAG_ARTE_OU_PRINT, TAG_FOTO_REAL };

/** Fotos lidas por rodada do cron (cada 8 é uma chamada de visão na carteira do cliente). */
export const FOTOS_POR_RODADA = 16;
export const MAX_FOTOS_POR_RODADA = 24;
/** Tentativas por foto (arquivo quebrado, leitor sem resposta). Depois disso a foto sai da fila. */
export const MAX_TENTATIVAS_DA_LEITURA = 3;
/** Etiqueta da tentativa que falhou ("leitura_falhou:2"). Etiqueta com ":" não entra no texto que o Jev lê. */
export const PREFIXO_DA_FALHA = "leitura_falhou:";
/** Abaixo disso a carteira do cliente não paga a leitura automática (o mesmo piso das referências automáticas). */
export const SALDO_MINIMO_DA_LEITURA = 0.3;
const MAX_TAGS = 16;

export type FotoParaLer = {
  id: string;
  client_id: string;
  nome: string;
  storage_bucket: string;
  storage_path: string;
  categoria?: string | null;
  tags?: string[] | null;
  descricao?: string | null;
  ativa?: boolean | null;
  gerada?: boolean | null;
};

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const umaLinha = (v: unknown, max: number) => String(v == null ? "" : v).replace(/\s+/g, " ").replace(/\s*[\u2013\u2014]\s*/g, ", ").trim().slice(0, max);

/** Quantas vezes a leitura desta foto já falhou (pela etiqueta). */
export function tentativasDaLeitura(tags: string[] | null | undefined): number {
  let n = 0;
  for (const t of tags || []) {
    if (String(t).indexOf(PREFIXO_DA_FALHA) !== 0) continue;
    const v = Number(String(t).slice(PREFIXO_DA_FALHA.length));
    if (Number.isFinite(v) && v > n) n = Math.floor(v);
  }
  return n;
}

/** Imagem que o leitor abre (o resto, como HEIC, PDF e vídeo, fica de fora). Sem extensão, tenta. */
const EXTENSAO_LIDA = /\.(jpe?g|png|webp|jfif)$/i;
const TEM_EXTENSAO = /\.[a-z0-9]{2,5}$/i;

/**
 * A foto entra na fila? Ativa, sem descrição, não é logo, não foi gerada por
 * IA, não é referência da internet nem está marcada para não publicar, abaixo
 * do teto de tentativas e com arquivo de imagem que o leitor abre.
 */
export function precisaDeLeitura(f: FotoParaLer): boolean {
  if (f.ativa === false || f.gerada === true) return false;
  if (String(f.descricao || "").trim()) return false;
  if (String(f.categoria || "") === "logo") return false;
  const tags = f.tags || [];
  if (tags.indexOf("referencia_web") >= 0 || tags.indexOf("nao_publicar") >= 0 || tags.indexOf("gerada") >= 0) return false;
  if (tentativasDaLeitura(tags) >= MAX_TENTATIVAS_DA_LEITURA) return false;
  const caminho = String(f.storage_path || "");
  if (!caminho || !f.storage_bucket) return false;
  return EXTENSAO_LIDA.test(caminho) || !TEM_EXTENSAO.test(caminho);
}

/**
 * As fotos da rodada, por cliente: na ordem que vieram (a mais nova antes),
 * até `limite` no total, só de quem tem saldo para pagar a leitura.
 */
export function fotosDaRodada(fotos: FotoParaLer[], limite: number, temSaldo: (clientId: string) => boolean): Map<string, FotoParaLer[]> {
  const saida = new Map<string, FotoParaLer[]>();
  let n = 0;
  for (const f of fotos) {
    if (n >= limite) break;
    if (!precisaDeLeitura(f) || !temSaldo(f.client_id)) continue;
    saida.set(f.client_id, [...(saida.get(f.client_id) || []), f]);
    n++;
  }
  return saida;
}

// ------------------------------------------------------------------ o leitor

export const ESQUEMA_DA_LEITURA_DO_ACERVO = {
  nome: "fotos_do_acervo",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["leituras"],
    properties: {
      leituras: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["imagem", "real", "categoria", "descricao", "assunto", "ambiente", "objetos", "pessoas", "antes_depois"],
          properties: {
            imagem: { type: "integer" },
            real: { type: "boolean" },
            categoria: { type: "string", enum: [...CATEGORIAS_DO_ACERVO] },
            descricao: { type: "string" },
            assunto: { type: "string" },
            ambiente: { type: "string" },
            objetos: { type: "array", items: { type: "string" } },
            pessoas: { type: "string", enum: ["nenhuma", "uma", "varias"] },
            antes_depois: { type: "string", enum: ["nao", "antes", "depois", "lado_a_lado"] },
          },
        },
      },
    },
  },
};

export const SISTEMA_DA_LEITURA_DO_ACERVO = `Você cataloga o acervo de fotos de um cliente de uma agência de marketing, para a equipe achar a foto certa para cada post. Para cada imagem anexada (na ordem: imagem 1, 2, 3...), diga o que ELA MOSTRA, de forma objetiva. Olhe de verdade.

Campos:
- real: true quando é fotografia real (celular ou câmera), sem arte de design por cima. false para arte pronta, card com texto, print de tela, montagem gráfica, ilustração ou imagem que parece gerada por IA.
- categoria: pessoa (gente é o assunto), produto (o produto ou serviço é o assunto), ambiente (lugar, fachada, sala, jardim, loja), detalhe (close de textura, acabamento ou parte de algo), antes_depois (antes e depois de um serviço, na mesma imagem ou numa foto de antes ou de depois), arte (arte pronta, card, print), logo (logotipo ou marca), outro.
- descricao: uma ou duas frases em português do que aparece, concreta e sem elogio (ex.: "Sala com sofá cinza de 3 lugares e parede verde-oliva, luz natural da janela à esquerda."). Até 200 caracteres.
- assunto: 2 a 4 palavras do assunto principal (ex.: "jardim vertical", "conserto de notebook").
- ambiente: 1 a 3 palavras do lugar (ex.: "varanda", "cozinha", "loja", "ao ar livre"), ou vazio.
- objetos: até 4 objetos visíveis que alguém buscaria, 1 a 3 palavras cada.
- pessoas: nenhuma, uma ou varias.
- antes_depois: antes (estado antes do serviço), depois (resultado), lado_a_lado (os dois na mesma imagem) ou nao.
Escreva sem travessão.`;

export type LeituraDoAcervo = {
  real: boolean;
  categoria: CategoriaDoAcervo;
  descricao: string;
  assunto: string;
  ambiente: string;
  objetos: string[];
  pessoas: "nenhuma" | "uma" | "varias";
  antes_depois: "nao" | "antes" | "depois" | "lado_a_lado";
};

/** A leitura de uma imagem como o leitor devolveu, conferida. Null sem descrição (conta como falha). */
export function normalizarLeituraDoAcervo(bruta: unknown): LeituraDoAcervo | null {
  if (!bruta || typeof bruta !== "object") return null;
  const b = bruta as Record<string, unknown>;
  const descricao = umaLinha(b.descricao, 240);
  if (descricao.length < 8) return null;
  const categoria = (CATEGORIAS_DO_ACERVO as readonly string[]).indexOf(String(b.categoria)) >= 0 ? String(b.categoria) as CategoriaDoAcervo : "outro";
  const pessoas = b.pessoas === "uma" || b.pessoas === "varias" ? b.pessoas : "nenhuma";
  const antesDepois = b.antes_depois === "antes" || b.antes_depois === "depois" || b.antes_depois === "lado_a_lado" ? b.antes_depois : "nao";
  return {
    // Arte, logo e print nunca contam como foto real, diga o leitor o que disser.
    real: b.real === true && categoria !== "arte" && categoria !== "logo",
    categoria,
    descricao,
    assunto: umaLinha(b.assunto, 40).toLowerCase(),
    ambiente: umaLinha(b.ambiente, 40).toLowerCase(),
    objetos: (Array.isArray(b.objetos) ? b.objetos : []).map((o) => umaLinha(o, 40).toLowerCase()).filter(Boolean).slice(0, 4),
    pessoas,
    antes_depois: antesDepois,
  };
}

/** Junta etiquetas sem repetir (sem caixa e sem acento), até o teto. */
function juntarTags(antigas: string[], novas: string[]): string[] {
  const saida: string[] = [];
  const vistas = new Set<string>();
  for (const t of [...antigas, ...novas]) {
    const limpa = String(t || "").trim().slice(0, 40);
    const chave = semAcento(limpa.toLowerCase());
    if (!limpa || vistas.has(chave)) continue;
    vistas.add(chave);
    saida.push(limpa);
  }
  // As antigas ficam todas (inclusive marca:<id>); as novas entram até o teto.
  return saida.slice(0, Math.max(MAX_TAGS, antigas.length));
}

/** Etiquetas que a leitura acrescenta (assunto, ambiente, objetos, pessoa, antes e depois, real ou arte). */
export function etiquetasDaLeitura(l: LeituraDoAcervo): string[] {
  const t: string[] = [];
  if (l.assunto) t.push(l.assunto);
  if (l.ambiente) t.push(l.ambiente);
  t.push(...l.objetos.slice(0, 3));
  t.push(l.pessoas === "nenhuma" ? "sem_pessoa" : "com_pessoa");
  if (l.antes_depois === "antes") t.push("antes");
  else if (l.antes_depois === "depois") t.push("depois");
  else if (l.antes_depois === "lado_a_lado") t.push("antes_e_depois");
  t.push(l.real ? TAG_FOTO_REAL : TAG_ARTE_OU_PRINT);
  return t;
}

/**
 * O que gravar na foto: a descrição, as etiquetas (as antigas ficam; a
 * tentativa que falhou sai) e a categoria só quando estava vazia ou "?".
 */
export function patchDaLeitura(f: Pick<FotoParaLer, "categoria" | "tags">, l: LeituraDoAcervo): { descricao: string; tags: string[]; categoria?: string } {
  const antigas = (f.tags || []).filter((t) => String(t).indexOf(PREFIXO_DA_FALHA) !== 0);
  const patch: { descricao: string; tags: string[]; categoria?: string } = { descricao: l.descricao, tags: juntarTags(antigas, etiquetasDaLeitura(l)) };
  const atual = String(f.categoria ?? "").trim();
  if (!atual || atual === "?") patch.categoria = l.categoria;
  return patch;
}

/** A tentativa que falhou vira etiqueta (a anterior sai): a foto volta à fila até o teto. */
export function patchDaFalha(f: Pick<FotoParaLer, "tags">): { tags: string[] } {
  const n = tentativasDaLeitura(f.tags) + 1;
  return { tags: [...(f.tags || []).filter((t) => String(t).indexOf(PREFIXO_DA_FALHA) !== 0), `${PREFIXO_DA_FALHA}${n}`] };
}
