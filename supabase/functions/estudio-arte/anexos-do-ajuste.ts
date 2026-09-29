/**
 * Imagens anexadas no "Ajustar" da lâmina e na conversa com o diretor (frente
 * RO, fase 2, 29/09/2026). Pedido do dono: "o agente do ajustar lâmina no
 * Estúdio poderia receber imagens e evoluir ainda mais, para não ficar só texto".
 *
 * Cada imagem tem um PAPEL, escolhido pela equipe ou deduzido pelo Jev
 * (Choice, confiança mínima) a partir do texto do pedido; dá para trocar:
 * - estilo: referência de estilo ("deixa com essa cara"): vai ao gerador como
 *   referência, sem copiar texto nem marca dela;
 * - elemento: "põe esse produto ou ícone aqui": vai ao gerador para inserir
 *   como é, na área marcada;
 * - exata: "usa esta foto aqui, igual": com área marcada, o código cola a
 *   foto intacta na área depois da edição (foto real intacta); sem área, vira
 *   a foto de fundo nova (o caminho do "Trocar o fundo");
 * - rosto: só a identidade da pessoa (o mesmo tratamento da fase 1:
 *   ROTULO_DA_FOTO_DE_IDENTIDADE e a frase do dono);
 * - logo: aplicada como está, legível;
 * - erro: print do erro ("olha o que está errado"): só o leitor vê; a
 *   instrução de edição corrige o que ele descreveu.
 *
 * Antes de gastar: o arquivo é conferido pelo começo e pelo fim
 * (_shared/defeito-da-imagem.ts); o quebrado é recusado com o motivo. Até
 * MAX_ANEXOS imagens e MAX_BYTES_DOS_ANEXOS no total (o provedor recusa o
 * pedido inteiro acima de 30 MB); cada uma vai na cópia leve (2048 px).
 *
 * Puro (sem Deno): o vitest lê este arquivo.
 */

import { FRASE_DA_IDENTIDADE, ROTULO_DA_FOTO_DE_IDENTIDADE } from "../_shared/uso-da-foto.ts";

export const PAPEIS_DO_ANEXO = ["estilo", "elemento", "exata", "rosto", "logo", "erro"] as const;
export type PapelDoAnexo = (typeof PAPEIS_DO_ANEXO)[number];
export type PapelPedidoDoAnexo = PapelDoAnexo | "auto";

export const ROTULO_DO_PAPEL_DO_ANEXO: Record<PapelDoAnexo, string> = {
  estilo: "Referência de estilo",
  elemento: "Elemento para inserir",
  exata: "Foto exata",
  rosto: "Rosto (identidade)",
  logo: "Logo",
  erro: "Print do erro",
};

export const DICA_DO_PAPEL_DO_ANEXO: Record<PapelDoAnexo, string> = {
  estilo: "Deixa com essa cara: luz, cor, textura e composição; nada do texto nem da marca dela",
  elemento: "Põe esse produto ou ícone na arte, como é",
  exata: "Usa esta foto igual, sem refazer (com área marcada, entra intacta nela)",
  rosto: "Só a identidade da pessoa: cena e pose novas",
  logo: "Aplica esta logo como está, legível",
  erro: "Mostra o que está errado; o ajuste corrige",
};

export const MAX_ANEXOS = 4;
/** Soma dos arquivos originais aceitos (o provedor recusa acima de 30 MB, a cópia leve fica bem abaixo). */
export const MAX_BYTES_DOS_ANEXOS = 40 * 1024 * 1024;
export const CONFIANCA_MINIMA_DO_PAPEL_DO_ANEXO = 0.6;

export type AnexoPedido = { caminho?: string | null; imagem_id?: string | null; nome?: string | null; papel: PapelPedidoDoAnexo };
export type AnexoDoAjuste = { caminho: string | null; imagem_id: string | null; nome: string; papel: PapelDoAnexo; papel_por: "equipe" | "jev" | "regra" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function lerPapelDoAnexo(v: unknown): PapelDoAnexo | null {
  return (PAPEIS_DO_ANEXO as readonly string[]).indexOf(String(v)) >= 0 ? (v as PapelDoAnexo) : null;
}

/** Os anexos do corpo, limpos: só da pasta do cliente (ou do acervo pelo id), sem repetir, até MAX_ANEXOS. */
export function normalizarAnexos(bruto: unknown, clientId: string): AnexoPedido[] {
  const saida: AnexoPedido[] = [];
  const vistos: Record<string, true> = {};
  for (const x of Array.isArray(bruto) ? bruto : []) {
    const o = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const id = typeof o.imagem_id === "string" && UUID.test(o.imagem_id) ? o.imagem_id.toLowerCase() : null;
    const caminho = !id && typeof o.caminho === "string" ? o.caminho.trim() : "";
    const ok = !!caminho && caminho.indexOf(`${clientId}/`) === 0 && caminho.indexOf("..") < 0 && caminho.length <= 300;
    if (!id && !ok) continue;
    const chave = id || caminho;
    if (vistos[chave]) continue;
    vistos[chave] = true;
    const papel = lerPapelDoAnexo(o.papel) || "auto";
    saida.push({ imagem_id: id, caminho: id ? null : caminho, nome: String(o.nome || "imagem").replace(/\s+/g, " ").trim().slice(0, 80) || "imagem", papel });
    if (saida.length >= MAX_ANEXOS) break;
  }
  return saida;
}

/** Papel pelas palavras do pedido (sem o Jev), ou null. */
export function papelPelaRegra(pedido: string): PapelDoAnexo | null {
  const p = String(pedido || "").toLowerCase();
  if (/(print|erro|errad|olha (o|isso|aqui)|t[aá] vendo|problema)/.test(p)) return "erro";
  if (/(s[oó] o rosto|us[a-z]* o rosto|outra pose|identidade)/.test(p)) return "rosto";
  if (/(logo|logomarca|marca do parceiro|patrocin)/.test(p)) return "logo";
  if (/(essa cara|esse estilo|esse clima|nessa pegada|parecid|refer[eê]ncia|inspira)/.test(p)) return "estilo";
  if (/(igual|exatamente|como est[aá]|essa foto|esta foto)/.test(p)) return "exata";
  if (/(p[oõ]e|coloca|insere|inclui|adiciona|acrescenta).*(produto|[ií]cone|objeto|selo|elemento|isso|esse|este)/.test(p)) return "elemento";
  return null;
}

/** Pergunta ao Jev (Choice) do papel da imagem na posição i (estado com `pedido` e `imagens`). */
export function perguntaDoPapelDoAnexo(i: number, nome: string) {
  return {
    type: "choice" as const,
    instructions: `A pessoa da equipe pediu um ajuste numa arte (texto em \`pedido\`) e anexou imagens (lista em \`imagens\`). Qual é o papel da imagem na posição ${i + 1} ("${nome}")? Use o que o pedido diz dela ("com essa cara", "põe esse produto aqui", "usa esta foto igual", "olha o erro").`,
    criteria: {
      estilo: { what: "Referência de estilo: a arte deve ficar com a cara dela (luz, cor, textura, composição).", examples: ["deixa com essa cara", "quero nesse estilo", "nessa pegada"] },
      elemento: { what: "Elemento para inserir na arte como é: produto, ícone, objeto, selo.", examples: ["põe esse produto aqui", "coloca esse ícone no canto", "insere essa garrafa"] },
      exata: { what: "Foto que entra exatamente como está, sem ser refeita.", examples: ["usa esta foto aqui, igual", "coloca essa foto exatamente assim"] },
      rosto: { what: "Foto de uma pessoa usada só pelo rosto (identidade), numa cena e pose novas.", examples: ["usa o rosto dele", "coloca ela em outra pose"] },
      logo: { what: "Logo ou marca para aplicar como está.", examples: ["põe essa logo embaixo", "a logo do patrocinador"] },
      erro: { what: "Print ou captura mostrando o que está errado, para corrigir.", examples: ["olha o que está errado", "tá vendo esse erro?", "esse print mostra o problema"] },
    },
  };
}

type Resposta = { choice?: string; confidence?: number };

/** Decide o papel de cada anexo: a equipe; o Jev com confiança; a regra; estilo (o mais seguro: não entra na arte). */
export function decidirPapeis(anexos: AnexoPedido[], respostas: Record<string, Resposta> | null, pedido: string): AnexoDoAjuste[] {
  return anexos.map((a, i) => {
    if (a.papel !== "auto") return { caminho: a.caminho || null, imagem_id: a.imagem_id || null, nome: a.nome || "imagem", papel: a.papel, papel_por: "equipe" };
    const r = respostas ? respostas[`papel_${i + 1}`] : undefined;
    const doJev = r ? lerPapelDoAnexo(r.choice) : null;
    const c = r && typeof r.confidence === "number" ? r.confidence : null;
    if (doJev && c !== null && c >= CONFIANCA_MINIMA_DO_PAPEL_DO_ANEXO) return { caminho: a.caminho || null, imagem_id: a.imagem_id || null, nome: a.nome || "imagem", papel: doJev, papel_por: "jev" };
    const regra = papelPelaRegra(pedido);
    return { caminho: a.caminho || null, imagem_id: a.imagem_id || null, nome: a.nome || "imagem", papel: regra || "estilo", papel_por: "regra" };
  });
}

/** Legenda de cada anexo para o LEITOR (que escreve a instrução de edição). */
export function legendaParaOLeitor(a: Pick<AnexoDoAjuste, "papel" | "nome">, indice: number): string {
  const n = `imagem ${indice}`;
  switch (a.papel) {
    case "estilo": return `${n}: REFERÊNCIA DE ESTILO anexada pela equipe (${a.nome}). A lâmina deve ficar com a cara dela (luz, cor, textura, composição); descreva na instrução o que levar dela; nunca o texto nem a marca dela.`;
    case "elemento": return `${n}: ELEMENTO PARA INSERIR (${a.nome}): o produto, ícone ou objeto desta imagem entra na arte como é; diga onde e em que tamanho.`;
    case "exata": return `${n}: FOTO EXATA (${a.nome}): entra como está, sem ser refeita; diga onde fica.`;
    case "rosto": return `${n}: ROSTO (${a.nome}): só a identidade da pessoa; ${FRASE_DA_IDENTIDADE}.`;
    case "logo": return `${n}: LOGO (${a.nome}): aplicar exatamente como está, legível; diga onde.`;
    case "erro": return `${n}: PRINT DO ERRO (${a.nome}): mostra o que está errado nesta lâmina. Leia com atenção, diga em "entendi" qual é o erro e escreva a instrução que corrige só isso.`;
  }
  return `${n}: ${a.nome}`;
}

/** Legenda de cada anexo para o GERADOR (o print do erro nunca vai ao gerador). */
export function legendaParaOGerador(a: Pick<AnexoDoAjuste, "papel" | "nome">): string | null {
  switch (a.papel) {
    case "estilo": return "referência de ESTILO anexada pela equipe: leve para a área editada a luz, a cor, a textura e o tratamento dela; não copie o texto, as pessoas nem a marca dela";
    case "elemento": return "ELEMENTO real para inserir: coloque este produto, ícone ou objeto na área editada exatamente como é (forma, cor, rótulo), integrado à luz da arte, com sombra de contato, sem caixa nem contorno";
    case "exata": return "FOTO REAL exata: use como está, sem redesenhar nem trocar nada nela";
    case "rosto": return ROTULO_DA_FOTO_DE_IDENTIDADE;
    case "logo": return "LOGO anexada pela equipe: aplique exatamente como está, sem redesenhar, legível";
    case "erro": return null;
  }
  return null;
}

/** Motivo em português para o arquivo quebrado (defeitoDaImagem). */
export function motivoDoDefeito(codigo: string, nome: string): string {
  const qual = `"${nome}"`;
  switch (codigo) {
    case "arquivo_vazio": return `A imagem ${qual} está vazia. Tire e envie de novo.`;
    case "grande_demais": return `A imagem ${qual} passa do tamanho aceito. Envie uma versão menor.`;
    case "formato_nao_suportado": return `A imagem ${qual} não está em PNG, JPEG ou WebP. Envie em um desses formatos.`;
    case "png_truncado":
    case "jpeg_truncado":
    case "webp_truncado":
      return `A imagem ${qual} chegou cortada no envio (o arquivo está incompleto). Tire e envie de novo.`;
  }
  return `A imagem ${qual} não abriu (${codigo}). Tire e envie de novo.`;
}

/** Com exata e área marcada: a foto é colada intacta na área (união das áreas) depois da edição. */
export const colaAFotoExata = (anexos: Pick<AnexoDoAjuste, "papel">[], temArea: boolean) => temArea && anexos.some((a) => a.papel === "exata");
