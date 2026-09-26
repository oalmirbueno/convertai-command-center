/**
 * Mesa Identidade Visual: só a preparação (frente C, 26/09).
 * Contrato completo em docs/mesa-identidade/CONTRATO.md.
 *
 * Fluxo: contexto do cliente -> briefing de identidade (este arquivo, sem IA)
 * -> pacote para o gerador externo (pacote-externo.ts, tipo identidade_visual)
 * -> o brand book volta pelo "Importar brand book" -> uma leitura (modelo de
 * leitura, com as páginas em imagem e o texto do PDF) vira PROPOSTA de kit
 * (cores, tipografia, logos, estilo, regras) que a equipe confirma no cartão
 * de ação (contrato comum de acoes-do-agente.ts), com Desfazer.
 *
 * Puro: sem Deno, sem banco. A tela e os testes (vitest) leem o mesmo arquivo.
 */
import { type AcaoDoAgente, type ItemDaAcaoDoAgente, type RecusaDoItem, resumoPadrao, TIPO_DA_ACAO } from "./acoes-do-agente.ts";

const HEX = /^#[0-9A-F]{6}$/;
const umaLinha = (v: unknown, max = 400) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const texto = (v: unknown, max = 3000) => String(v ?? "").trim().slice(0, max);

/** Pasta do bucket mesa onde o brand book importado fica guardado. */
export function pastaDoBrandBook(clientId: string): string {
  return `${clientId}/marca/brandbook/`;
}

// ------------------------------------------------------------------ briefing de identidade

export type EntradaDaIdentidade = {
  cliente: string;
  contexto?: Record<string, unknown> | null;
  kit?: { paleta?: Array<{ nome?: string; hex?: string; papel?: string }> | null; estilo?: string | null; regras?: string | null; tem_logo?: boolean } | null;
  fontes?: Array<{ nome?: string; papel?: string }> | null;
  /** Leituras de técnica das referências (o que a equipe já juntou). */
  referencias?: string[] | null;
  /** Decisões e preferências do cérebro que falam de visual. */
  memorias?: string[] | null;
};

export type BriefingDeIdentidade = { markdown: string; lacunas: string[] };

/**
 * Briefing de identidade montado do contexto que já existe. O que falta vira
 * lacuna (pergunta para o dono), nunca invenção.
 */
export function briefingDeIdentidade(e: EntradaDaIdentidade): BriefingDeIdentidade {
  const c = (e.contexto ?? {}) as Record<string, unknown>;
  const lacunas: string[] = [];
  const campo = (k: string, rotulo: string, falta: string) => {
    const v = c[k];
    const s = Array.isArray(v) ? v.map((x) => umaLinha(x, 200)).filter(Boolean).join("; ") : umaLinha(v, 1200);
    if (!s) {
      lacunas.push(falta);
      return null;
    }
    return `- ${rotulo}: ${s}`;
  };
  const md: string[] = [`# Briefing de identidade visual: ${umaLinha(e.cliente, 120) || "Cliente"}`, ""];
  md.push("## Essência do negócio");
  const essencia = [
    campo("negocio", "O que faz", "O que o negócio faz, em uma frase"),
    campo("nicho", "Nicho", "O nicho exato em que a marca vai competir"),
    campo("estagio", "Estágio", "O estágio do negócio (começando, crescendo, consolidado)"),
    campo("posicionamento", "Posicionamento", "O posicionamento: por que escolher esta marca e não a vizinha"),
    campo("oferta", "Oferta principal", "A oferta principal"),
    campo("diferenciais", "Diferenciais comprovados", "Os diferenciais comprovados"),
  ].filter(Boolean) as string[];
  md.push(...(essencia.length ? essencia : ["- (sem dados ainda)"]));
  md.push("", "## Para quem");
  md.push(campo("publico", "Público", "Quem é o público prioritário e o que ele busca") || "- (a definir com o dono)");
  md.push("", "## Personalidade e voz");
  md.push(campo("tom_de_voz", "Tom de voz", "Como a marca fala") || "- (a definir com o dono)");

  md.push("", "## O que já existe");
  const paleta = (Array.isArray(e.kit?.paleta) ? e.kit!.paleta! : []).filter((p) => p && /^#[0-9a-f]{6}$/i.test(String(p.hex || "")));
  md.push(paleta.length ? `- Paleta atual: ${paleta.map((p) => `${umaLinha(p.nome, 40) || umaLinha(p.papel, 20) || "cor"} ${String(p.hex).toUpperCase()}`).join(", ")}` : "- Paleta: não definida.");
  const fontes = (e.fontes ?? []).filter((f) => f && f.nome);
  md.push(fontes.length ? `- Fontes em uso: ${fontes.map((f) => `${umaLinha(f.nome, 80)}${f.papel ? ` (${umaLinha(f.papel, 20)})` : ""}`).join(", ")}` : "- Fontes: não definidas.");
  const logo = c.logo && typeof c.logo === "object" ? umaLinha((c.logo as Record<string, unknown>).descricao, 600) : "";
  md.push(e.kit?.tem_logo ? `- Logo atual: existe${logo ? ` (${logo})` : ""}. Diga se é para manter, redesenhar ou evoluir.` : "- Logo: ainda não existe logo oficial.");
  if (!e.kit?.tem_logo) lacunas.push("Se é logo nova do zero ou evolução de uma marca já usada");
  if (e.kit?.estilo) md.push(`- Estilo visual observado: ${umaLinha(e.kit.estilo, 1500)}`);
  if (e.kit?.regras) md.push(`- Regras já combinadas: ${umaLinha(e.kit.regras, 1500)}`);
  const refs = (e.referencias ?? []).map((r) => umaLinha(r, 300)).filter(Boolean).slice(0, 6);
  if (refs.length) md.push("", "## Referências que a equipe juntou (técnica, não cópia)", ...refs.map((r) => `- ${r}`));
  const mem = (e.memorias ?? []).map((r) => umaLinha(r, 240)).filter(Boolean).slice(0, 8);
  if (mem.length) md.push("", "## O que o cliente já disse que gosta ou evita", ...mem.map((r) => `- ${r}`));

  md.push("", "## Entregáveis do brand book");
  md.push(
    "- Logo principal, versão alternativa (horizontal ou vertical) e símbolo, em PNG com fundo transparente e em versão para fundo escuro.",
    "- Paleta com nome, hex e papel de cada cor (primária, secundária, destaque, fundo, texto).",
    "- Tipografia de título e de texto, com nome exato e licença de uso (de preferência Google Fonts).",
    "- Grafismos e texturas, com exemplos.",
    "- Aplicações: post quadrado, story, capa de destaque e uma peça física (fachada, cartão ou embalagem).",
    "- Tom de voz em três a cinco traços, com exemplo de frase.",
  );
  md.push("", "## Como devolver");
  md.push("- Brand book em PDF e logos em PNG. O arquivo entra no painel pelo botão Importar brand book, que lê cores, fontes e logos e propõe o kit para a equipe confirmar.");
  if (lacunas.length) md.push("", "## Perguntas para o dono antes de criar", ...lacunas.map((l) => `- ${l}?`));
  return { markdown: md.join("\n"), lacunas };
}

// ------------------------------------------------------------------ leitura do brand book

export const PAPEIS_DA_LOGO = ["principal", "alternativa", "simbolo", "outro"] as const;

export const ESQUEMA_DO_BRAND_BOOK = {
  nome: "leitura_do_brand_book",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["paleta", "tipografia", "logos", "estilo", "regras", "tom_de_voz", "observacoes"],
    properties: {
      paleta: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["nome", "hex", "papel"],
          properties: { nome: { type: "string" }, hex: { type: "string" }, papel: { type: "string" } },
        },
      },
      tipografia: {
        type: "object",
        additionalProperties: false,
        required: ["titulo", "texto", "observacao"],
        properties: { titulo: { type: ["string", "null"] }, texto: { type: ["string", "null"] }, observacao: { type: ["string", "null"] } },
      },
      logos: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["imagem", "papel"],
          properties: { imagem: { type: "integer" }, papel: { type: "string", enum: [...PAPEIS_DA_LOGO] } },
        },
      },
      estilo: { type: ["string", "null"] },
      regras: { type: ["string", "null"] },
      tom_de_voz: { type: ["string", "null"] },
      observacoes: { type: ["string", "null"] },
    },
  },
};

export const SISTEMA_DO_BRAND_BOOK = `Você lê o brand book de um cliente de agência (páginas em imagem, na ordem, e o texto extraído do PDF) e devolve só o que ESTÁ nele, para preencher o kit da marca:
- paleta: as cores oficiais com o hex exato quando o documento traz (converta RGB para hex se vier só RGB); papel de cada uma (primaria, secundaria, destaque, fundo, texto). De 2 a 8 cores. Sem cor inventada.
- tipografia: nome exato da fonte de título e da de texto; observacao com pesos e uso. Null quando o documento não diz.
- logos: quais imagens anexadas (número na ordem, começando em 1) são a logo sozinha em fundo limpo, e o papel (principal, alternativa, simbolo). Página com mockup, texto ou várias coisas juntas não é logo: fica fora.
- estilo: a linguagem visual em 4 a 8 frases (fotografia, composição, grafismos, clima). Null se o documento não mostra.
- regras: faça e não faça do uso da marca, em tópicos curtos. Null se não houver.
- tom_de_voz: como a marca fala, se o documento disser.
- observacoes: o que ficou ambíguo.
Português do Brasil, sem travessão.`;

export type LeituraDoBrandBook = {
  paleta?: Array<{ nome?: string; hex?: string; papel?: string }> | null;
  tipografia?: { titulo?: string | null; texto?: string | null; observacao?: string | null } | null;
  logos?: Array<{ imagem?: number; papel?: string }> | null;
  estilo?: string | null;
  regras?: string | null;
  tom_de_voz?: string | null;
  observacoes?: string | null;
};

export type KitAtual = {
  paleta?: Array<{ nome?: string; hex?: string; papel?: string }> | null;
  estilo?: string | null;
  regras?: string | null;
  logo_path?: string | null;
  logo_alt_path?: string | null;
  tipografia?: { titulo?: string | null; texto?: string | null; observacao?: string | null } | null;
};

/** Imagem enviada à leitura, na ordem (a 1 é a primeira). Só PNG, JPG e WEBP viram logo. */
export type ImagemDoBrandBook = { caminho: string; nome: string; mime?: string | null; pagina_de_pdf?: boolean };

export const OPERACOES_DO_BRAND_BOOK = ["kit_paleta", "kit_tipografia", "kit_logo", "kit_estilo", "kit_regras"] as const;

/** Cores válidas, sem repetir hex, de 2 a 8. */
export function paletaDoBrandBook(bruto: LeituraDoBrandBook["paleta"]): Array<{ nome: string; hex: string; papel: string }> {
  const vistos = new Set<string>();
  const saida: Array<{ nome: string; hex: string; papel: string }> = [];
  for (const c of Array.isArray(bruto) ? bruto : []) {
    const hex = umaLinha(c?.hex, 7).toUpperCase();
    if (!HEX.test(hex) || vistos.has(hex)) continue;
    vistos.add(hex);
    saida.push({ nome: umaLinha(c?.nome, 40) || hex, hex, papel: umaLinha(c?.papel, 20).toLowerCase() || "apoio" });
    if (saida.length >= 8) break;
  }
  return saida.length >= 2 ? saida : [];
}

const mesmaPaleta = (a: Array<{ hex?: string }> | null | undefined, b: Array<{ hex: string }>) => {
  const x = (a ?? []).map((c) => String(c?.hex || "").toUpperCase()).sort().join(",");
  return !!x && x === b.map((c) => c.hex).sort().join(",");
};

/**
 * A proposta de kit a partir da leitura do brand book: cada campo vira um
 * item do cartão de ação. O valor novo vai em contexto.dados (o executor lê
 * de lá); o item mostra o antes e o depois em texto curto.
 */
export function propostaDoKitPeloBrandBook(
  leitura: LeituraDoBrandBook | null | undefined,
  kit: KitAtual | null | undefined,
  imagens: ImagemDoBrandBook[],
  clientId: string,
  id?: string,
): AcaoDoAgente | null {
  if (!leitura || typeof leitura !== "object") return null;
  const k = kit ?? {};
  const itens: ItemDaAcaoDoAgente[] = [];
  const recusados: RecusaDoItem[] = [];
  const ignorados: string[] = [];
  const dados: Record<string, Record<string, unknown>> = {};
  const pasta = pastaDoBrandBook(clientId);
  const add = (ref: string, operacao: string, rotulo: string, titulo: string, detalhe: string | null, paraRotulo: string, carga: Record<string, unknown>) => {
    itens.push({ ref, alvo_id: operacao === "kit_logo" ? String(carga.alternativa ? "alternativa" : "principal") : "kit", titulo, detalhe, operacao, rotulo, para: null, para_rotulo: paraRotulo });
    dados[`${operacao}:${ref}`] = carga;
  };

  const paleta = paletaDoBrandBook(leitura.paleta);
  if (paleta.length && !mesmaPaleta(k.paleta, paleta)) {
    const antes = Array.isArray(k.paleta) ? k.paleta.length : 0;
    add("b1", "kit_paleta", "trocar a paleta por", "Paleta do kit", antes ? `substitui ${antes} ${antes === 1 ? "cor" : "cores"}` : "estava vazia", paleta.map((c) => `${c.nome} ${c.hex}`).join(", "), { paleta });
  }

  const t = leitura.tipografia || {};
  const titulo = umaLinha(t.titulo, 80);
  const corpo = umaLinha(t.texto, 80);
  if (titulo || corpo) {
    const atual = k.tipografia || {};
    if (umaLinha(atual.titulo, 80) !== titulo || umaLinha(atual.texto, 80) !== corpo) {
      add("b2", "kit_tipografia", "definir a tipografia", "Tipografia do kit", atual.titulo || atual.texto ? `antes: ${umaLinha(atual.titulo, 40) || "?"} + ${umaLinha(atual.texto, 40) || "?"}` : "estava vazia", `título ${titulo || "sem nome"}, texto ${corpo || "sem nome"}`, {
        tipografia: { titulo: titulo || null, texto: corpo || null, observacao: umaLinha(t.observacao, 400) || null },
      });
    }
  }

  const usadas = new Set<string>();
  for (const l of Array.isArray(leitura.logos) ? leitura.logos : []) {
    const papel = String(l?.papel || "");
    if (papel !== "principal" && papel !== "alternativa") continue;
    const alternativa = papel === "alternativa";
    const ref = alternativa ? "b4" : "b3";
    if (usadas.has(ref)) continue;
    const img = imagens[Math.round(Number(l?.imagem)) - 1];
    if (!img) {
      ignorados.push(ref);
      continue;
    }
    usadas.add(ref);
    const titulo = alternativa ? "Logo alternativa do kit" : "Logo principal do kit";
    if (img.caminho.indexOf(pasta) !== 0 || /\.\./.test(img.caminho)) {
      recusados.push({ ref, titulo, operacao: "kit_logo", motivo: "A imagem não está na pasta do brand book deste cliente." });
      continue;
    }
    if (img.pagina_de_pdf) {
      recusados.push({ ref, titulo, operacao: "kit_logo", motivo: "É uma página inteira do PDF. Envie a logo em PNG para ela virar logo do kit." });
      continue;
    }
    if (img.mime && !/^image\/(png|jpe?g|webp)$/i.test(img.mime)) {
      recusados.push({ ref, titulo, operacao: "kit_logo", motivo: "A logo precisa ser PNG, JPG ou WEBP." });
      continue;
    }
    const atual = alternativa ? k.logo_alt_path : k.logo_path;
    if (atual === img.caminho) continue;
    add(ref, "kit_logo", "trocar a logo por", titulo, atual ? "substitui a atual (fica guardada)" : "estava sem logo", `a imagem ${umaLinha(img.nome, 80)}`, { alternativa, caminho: img.caminho });
  }

  const estilo = texto(leitura.estilo, 3000);
  if (estilo.length >= 20 && umaLinha(estilo, 3000) !== umaLinha(k.estilo, 3000)) {
    add("b5", "kit_estilo", "trocar o estilo por", "Estilo visual do kit", k.estilo ? "substitui o atual" : "estava vazio", umaLinha(estilo, 140), { estilo });
  }
  const regras = texto(leitura.regras, 3000);
  if (regras.length >= 20 && umaLinha(regras, 3000) !== umaLinha(k.regras, 3000)) {
    add("b6", "kit_regras", "trocar as regras por", "Regras da marca", k.regras ? "substitui as atuais" : "estavam vazias", umaLinha(regras, 140), { regras });
  }

  if (!itens.length && !recusados.length) return null;
  return {
    tipo: TIPO_DA_ACAO,
    agente: "contexto",
    id: id || `brandbook-${Date.now().toString(36)}`,
    resumo: itens.length ? `Li o brand book. ${resumoPadrao(itens)}` : "Li o brand book, mas nada pode entrar no kit como está.",
    itens,
    ignorados,
    recusados,
    contexto: { client_id: clientId, tipo: "brand_book", dados },
  };
}
