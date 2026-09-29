/**
 * Leitura por visão dos arquivos do Workspace (frente OR, 29/09/2026).
 *
 * Reaproveita as regras da frente LR (agente-contexto/leitura-em-lotes.ts):
 * - arquivo quebrado sai ANTES de gastar (defeitoDaImagem), com o motivo;
 * - lotes pequenos (até 4 imagens e 12 MB em base64, dividirEmLotes);
 * - provedor recusou a imagem num lote de várias: cada uma vai sozinha, e só
 *   a quebrada fica de fora;
 * - saldo, cota ou chave param a leitura inteira (erroQueParou);
 * - tempo com teto: o que não coube volta em `restantes` (a tela chama de novo).
 * Nada termina em silêncio: toda falha tem motivo.
 *
 * O leitor devolve, por imagem, o tipo (organizador.ts), o tema, o texto que
 * aparece, uma frase do que se vê, a identidade visual, a paleta, a numeração
 * visível, capa/fechamento e o objeto (para achar o par de antes e depois).
 *
 * Puro: o provedor entra por `lerLote` (index.ts usa o motor, com a carteira
 * do cliente). O teste (vitest) usa um leitor de mentira.
 */

import { defeitoDaImagem } from "../_shared/defeito-da-imagem.ts";
import { dividirEmLotes, textoDoMotivo } from "../agente-contexto/leitura-em-lotes.ts";
import { type Leitura, normalizarLeitura, SIGNIFICADO_DO_TIPO, TIPOS } from "./organizador.ts";

export { defeitoDaImagem, textoDoMotivo };

/** Caixa da cópia leve para a leitura: a miniatura de 640 px do painel já serve (texto de card legível, poucos tokens). */
export const LADO_DA_LEITURA = 768;
/** Arquivos por chamada da tela (um lote, longe dos 150 s). */
export const MAX_POR_CHAMADA = 8;
/**
 * Imagens por lote do leitor. Aqui vai a cópia leve (miniatura de 640 px, de
 * 50 a 300 KB): 8 cabem com folga nos 12 MB do lote e no teto do provedor.
 * Mais imagens por pedido é o que deixa o leitor ver juntas as lâminas de um
 * carrossel enviadas juntas (a prova real de 29/09 mostrou o card de 7
 * lâminas partido em dois quando a leitura ia de 4 em 4). Quebrada e recusada
 * continuam saindo antes (defeitoDaImagem) e uma a uma (recusa do provedor).
 */
export const MAX_IMAGENS_POR_LOTE = 8;
export const PRAZO_DA_LEITURA_MS = 95_000;

/**
 * Tokens por imagem na estimativa (cópia leve de até 640 px e o JSON da leitura).
 * Medido na prova real de 29/09 (96 imagens, GPT-6 Luna): 678 de entrada e 237
 * de saída por imagem, em média. A estimativa fica um pouco acima.
 */
export const TOKENS_ENTRADA_POR_IMAGEM = 800;
export const TOKENS_SAIDA_POR_IMAGEM = 300;
export const TOKENS_ENTRADA_POR_LOTE = 700;

export const ESQUEMA_DA_LEITURA = {
  nome: "arquivos_do_workspace",
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
          required: ["imagem", "tipo", "confianca", "tema", "serie", "fixos", "texto", "descricao", "identidade", "paleta", "numero", "total", "capa", "fechamento", "objeto"],
          properties: {
            imagem: { type: "integer" },
            tipo: { type: "string", enum: [...TIPOS] },
            confianca: { type: "number" },
            tema: { type: "string" },
            serie: { type: "string" },
            fixos: { type: "string" },
            texto: { type: "string" },
            descricao: { type: "string" },
            identidade: { type: "string" },
            paleta: { type: "array", items: { type: "string" } },
            numero: { type: ["integer", "null"] },
            total: { type: ["integer", "null"] },
            capa: { type: "boolean" },
            fechamento: { type: "boolean" },
            objeto: { type: "string" },
          },
        },
      },
    },
  },
};

export const SISTEMA_DA_LEITURA = `Você organiza o workspace de uma agência de marketing de redes sociais. Para cada imagem anexada (na ordem: imagem 1, 2, 3...), diga o que ela É, para arquivar sem confundir uma com a outra. Olhe de verdade: texto, layout, numeração, se é foto real ou arte.

Tipos (campo tipo):
${TIPOS.map((t) => `- ${t}: ${SIGNIFICADO_DO_TIPO[t]}`).join("\n")}

Campos:
- confianca: de 0 a 1, o quanto você tem certeza do tipo.
- tema: o assunto em 2 a 5 palavras, em português, sem artigo no começo (ex.: "limpeza de sofá", "promoção de outubro", "3 erros no tráfego pago").
- serie: só para lâmina de carrossel: o assunto do CARD INTEIRO a que ela pertence, em 2 a 6 palavras (cada lâmina pode tratar de um ponto diferente; aqui vai o assunto geral que une a sequência, pelo título, cabeçalho, rodapé ou elementos fixos). Lâminas do mesmo carrossel no mesmo pedido levam exatamente o mesmo texto. Vazio para o que não é sequência.
- fixos: os textos pequenos que se repetem em toda arte da série, exatos (cabeçalho, rodapé, @ do perfil, nome da série, "salve este post"), separados por " | ". Vazio se não houver.
- texto: o texto principal que aparece na imagem, exato, até 200 caracteres (vazio se não houver).
- descricao: uma frase do que se vê.
- identidade: 6 a 12 palavras sobre a identidade visual (cores de fundo, tipografia, estilo do layout, elementos fixos como logo, @ do perfil, cabeçalho, rodapé, bolinhas de página, seta). Artes da mesma série devem ter a mesma descrição.
- paleta: até 4 cores dominantes em hex (#rrggbb).
- numero: o número da lâmina que aparece na arte (2 de "2/5", "02", "passo 2"), ou null.
- total: o total que aparece ("2/5" dá 5), ou null.
- capa: true se é a primeira lâmina de uma sequência (título grande, promessa, "arrasta").
- fechamento: true se é a última lâmina (chamada para ação: salve, compartilhe, siga, link na bio).
- objeto: para fotos (produto, antes, depois), o objeto ou lugar exato, com cor e detalhes que permitam achar a mesma coisa em outra foto (ex.: "sofá cinza de 3 lugares com almofadas listradas"). Vazio para artes.
Escreva sem travessão.`;

export type ItemParaLer = {
  id: string;
  nome: string;
  /** Quadro de vídeo capturado na tela (não é o arquivo). */
  video: boolean;
  duracao: number | null;
  largura: number | null;
  altura: number | null;
  /** Quando o arquivo foi enviado (ISO): o leitor vê quem veio junto. */
  enviado_em?: string | null;
  imagem: { bytes: Uint8Array; mime: string };
};

/** Frase do pedido de um lote: nome, formato e (vídeo) duração de cada imagem. */
export function pedidoDoLote(lote: ItemParaLer[]): string {
  const linhas = lote.map((c, i) => {
    const antes = i > 0 ? Date.parse(String(lote[i - 1].enviado_em || "")) : NaN;
    const agora = Date.parse(String(c.enviado_em || ""));
    const gap = Number.isFinite(antes) && Number.isFinite(agora) ? Math.round((agora - antes) / 1000) : null;
    const envio = gap === null ? "" : gap < 1 ? ", enviada junto com a anterior (envio em lote)" : gap <= 180 ? `, enviada ${gap} s depois da anterior` : `, enviada ${Math.round(gap / 60)} min depois da anterior`;
    const formato = c.largura && c.altura ? `, ${c.largura}x${c.altura}${c.altura > c.largura * 1.5 ? " (vertical 9:16)" : c.altura > c.largura ? " (vertical)" : c.altura === c.largura ? " (quadrado)" : " (horizontal)"}` : "";
    const video = c.video ? `, quadro de um VÍDEO${c.duracao ? ` de ${Math.round(c.duracao)} s` : ""} (tipo: reel, story, video ou referencia)` : "";
    return `Imagem ${i + 1}: arquivo "${c.nome.slice(0, 80)}"${formato}${video}${envio}.`;
  });
  return `Leia as ${lote.length} imagens anexadas, na ordem. Elas estão na ordem em que foram enviadas; imagens enviadas juntas muitas vezes são lâminas do mesmo carrossel (quando forem, use o mesmo texto em serie). ${linhas.join(" ")}`;
}

export type ResultadoDaLeituraDoWorkspace = {
  leituras: Array<{ id: string; leitura: Leitura }>;
  falhas: Array<{ id: string; motivo: string }>;
  custo: number;
  /** Ficaram sem tentar (tempo ou parada): a tela manda de novo. */
  restantes: string[];
  erroQueParou?: unknown;
};

export type DependenciasDaLeitura = {
  lerLote: (lote: ItemParaLer[]) => Promise<{ leituras: unknown[]; custo: number }>;
  erroQueParaTudo: (e: unknown) => boolean;
  recusouImagem: (e: unknown) => boolean;
  descrever: (e: unknown) => string;
  log?: (mensagem: string, dados: Record<string, unknown>) => void;
  agora?: () => number;
  prazoMs?: number;
  paralelos?: number;
};

/**
 * Lê os arquivos já abertos (cópia leve conferida). Nunca lança: toda falha
 * vira motivo. Imagem com defeito é recusada aqui, antes de gastar.
 */
export async function lerArquivos(itens: ItemParaLer[], d: DependenciasDaLeitura): Promise<ResultadoDaLeituraDoWorkspace> {
  const agora = d.agora ?? (() => Date.now());
  const inicio = agora();
  const prazo = d.prazoMs ?? PRAZO_DA_LEITURA_MS;
  const log = d.log ?? ((m: string, dados: Record<string, unknown>) => console.error(m, dados));
  const r: ResultadoDaLeituraDoWorkspace = { leituras: [], falhas: [], custo: 0, restantes: [] };
  const tentados = new Set<string>();
  let parou = false;

  const bons: ItemParaLer[] = [];
  for (const it of itens) {
    const defeito = defeitoDaImagem(it.imagem.bytes, 30 * 1024 * 1024);
    if (defeito) {
      tentados.add(it.id);
      r.falhas.push({ id: it.id, motivo: textoDoMotivo(defeito) });
    } else bons.push(it);
  }

  const processar = async (lote: ItemParaLer[]): Promise<void> => {
    if (parou) return;
    if (agora() - inicio > prazo) return;
    for (const it of lote) tentados.add(it.id);
    let resposta: { leituras: unknown[]; custo: number };
    try {
      resposta = await d.lerLote(lote);
    } catch (e) {
      if (d.erroQueParaTudo(e)) {
        parou = true;
        r.erroQueParou = e;
        for (const it of lote) tentados.delete(it.id);
        log("workspace-organizar: leitura parada (saldo, cota ou chave)", { motivo: d.descrever(e) });
        return;
      }
      if (d.recusouImagem(e) && lote.length > 1) {
        log("workspace-organizar: provedor recusou o lote; lendo uma por uma", { motivo: d.descrever(e), lote: lote.map((i) => i.id) });
        for (const it of lote) tentados.delete(it.id);
        for (const it of lote) await processar([it]);
        return;
      }
      const motivo = d.recusouImagem(e) ? textoDoMotivo("imagem_recusada") : d.descrever(e);
      log("workspace-organizar: lote de leitura falhou", { motivo, lote: lote.map((i) => i.id) });
      for (const it of lote) r.falhas.push({ id: it.id, motivo });
      return;
    }
    r.custo += Number(resposta.custo) || 0;
    const porIndice = new Map<number, unknown>();
    for (const l of Array.isArray(resposta.leituras) ? resposta.leituras : []) {
      const i = Math.round(Number((l as { imagem?: unknown })?.imagem));
      if (Number.isFinite(i) && !porIndice.has(i)) porIndice.set(i, l);
    }
    lote.forEach((it, i) => {
      const leitura = normalizarLeitura(porIndice.get(i + 1));
      if (!leitura) {
        r.falhas.push({ id: it.id, motivo: "o leitor não devolveu a leitura desta imagem" });
        return;
      }
      // Quadro de vídeo nunca vira lâmina, foto de antes/depois ou documento: é vídeo.
      if (it.video && ["reel", "story", "video", "referencia"].indexOf(leitura.tipo) < 0) {
        const vertical = !!it.largura && !!it.altura && it.altura > it.largura;
        leitura.tipo = vertical && (!it.duracao || it.duracao <= 90) ? "reel" : "video";
      }
      r.leituras.push({ id: it.id, leitura });
    });
  };

  const fila = dividirEmLotes(bons, MAX_IMAGENS_POR_LOTE);
  let proximo = 0;
  const trabalhador = async () => {
    while (proximo < fila.length && !parou) await processar(fila[proximo++]);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(d.paralelos ?? 2, fila.length)) }, trabalhador));
  r.restantes = itens.filter((i) => !tentados.has(i.id)).map((i) => i.id);
  return r;
}

/** Estimativa de tokens da leitura de `n` imagens (para o motor calcular o custo pela tabela). */
export function tokensDaLeitura(n: number): { entrada: number; saida: number } {
  const lotes = Math.ceil(Math.max(0, n) / MAX_IMAGENS_POR_LOTE);
  return { entrada: lotes * TOKENS_ENTRADA_POR_LOTE + n * TOKENS_ENTRADA_POR_IMAGEM, saida: n * TOKENS_SAIDA_POR_IMAGEM };
}
