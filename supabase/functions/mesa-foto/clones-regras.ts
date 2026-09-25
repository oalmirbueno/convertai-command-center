/**
 * Área "Clones" da Mesa Foto: regras puras (sem rede, sem banco, sem Deno;
 * a função usa em clones.ts e o teste do painel importa). Pedido do dono em
 * 25/09: "pegar uma foto de uma pessoa e criar vários clones idênticos com
 * outras opções; depois vamos ter uma mesa de vídeos e criar clones de vídeos
 * hiper-realistas; essa parte tem que ser muito boa". Pesquisa e formato para
 * vídeo em docs/mesa-foto/CLONES.md.
 *
 * Um clone é uma PESSOA REAL do cliente (1 a 4 fotos reais do acervo), com a
 * autorização de uso de imagem registrada. Mora em foto_modelos com
 * origem 'clone_de_foto_real' (migration 04). Regras duras:
 * - sem autorização registrada (quem, quando, para quê) não existe clone;
 * - pessoa adulta (18 anos ou mais, confirmada pela equipe);
 * - o rosto, a idade, o corpo e as marcas NÃO mudam (retoque não muda
 *   anatomia): muda roupa, cenário, pose, expressão, luz e enquadramento;
 * - nada de sósia de pessoa conhecida, sem sexualização;
 * - toda imagem sai marcada como gerada, com a pessoa real indicada;
 * - sem laço de correção: gera uma vez, confere uma vez (visão + Jev só como
 *   aviso), a equipe decide.
 */

import { ErroDeRegra, limpo, listaDeTextos, semTravessao, UUID } from "./calculos.ts";
import { conteudoProibido, DESCRICAO_DA_VISTA, lerVista, ordenarPorProximidade, type VistaDaPersona } from "./personas.ts";

export const ORIGEM_CLONE = "clone_de_foto_real";
export const IDADE_MINIMA_CLONE = 18;
export const MAX_FOTOS_REAIS = 4;
/** Pessoas que o gerador mantém ao mesmo tempo (Nano Banana Pro: até 5 de pessoa). */
export const MAX_IDENTIDADES_NO_GERADOR = 5;

/** Folha de identidade: imagens separadas (não uma folha única), uma por chamada. */
export const FOLHA_DO_CLONE: VistaDaPersona[] = ["frente", "tres_quartos_esq", "tres_quartos_dir", "perfil_esq", "meio_corpo", "corpo_inteiro"];
/** Aprovadas na folha (com a frente entre elas) para o clone ficar pronto. */
export const APROVADAS_PARA_PRONTO = 3;

/**
 * Geradores do clone (pesquisa de 25/09, CLONES.md): Nano Banana Pro é o
 * padrão (melhor preservação de rosto nos testes independentes e até 5
 * pessoas de referência); GPT Image 2.5 é o segundo (topo em edição, 16
 * referências, mas pode recusar editar rosto de pessoa real); Nano Banana 2
 * serve de rascunho barato. Seedream fica fora: o provedor recusa rosto de
 * pessoa real no fluxo padrão. Um motor por clone (trocar aumenta a deriva).
 */
export type MotorDoClone = { modelo_imagem_id: string; rotulo: string; resolucao: "1K" | "2K" | "4K" | null; qualidade: "baixa" | "media" | "alta"; padrao: boolean; nota: string };
export const MOTORES_DO_CLONE: MotorDoClone[] = [
  { modelo_imagem_id: "openrouter:google/gemini-3-pro-image", rotulo: "Nano Banana Pro 2K", resolucao: "2K", qualidade: "alta", padrao: true, nota: "Melhor fidelidade de rosto; até 5 fotos da pessoa." },
  { modelo_imagem_id: "openrouter:openai/gpt-image-2.5-sunburst", rotulo: "GPT Image 2.5 Sunburst", resolucao: null, qualidade: "alta", padrao: false, nota: "Topo em edição; pode recusar rosto de pessoa real." },
  { modelo_imagem_id: "openrouter:google/gemini-3.1-flash-image", rotulo: "Nano Banana 2 (rascunho)", resolucao: "1K", qualidade: "alta", padrao: false, nota: "Rascunho barato; até 4 fotos da pessoa." },
];
export const MOTOR_PADRAO_DO_CLONE = MOTORES_DO_CLONE[0];
export const motorDoClone = (id: unknown): MotorDoClone | null => MOTORES_DO_CLONE.find((m) => m.modelo_imagem_id === String(id ?? "")) ?? null;

// ------------------------------------------------------------------ autorização

export const FORMAS_DE_AUTORIZACAO = ["termo_assinado", "contrato", "email", "mensagem", "outro"] as const;
export type FormaDeAutorizacao = typeof FORMAS_DE_AUTORIZACAO[number];

export type AutorizacaoDoClone = {
  confirmada: true;
  /** Quem autorizou: a própria pessoa retratada (ou o representante legal, dito em observacao). */
  quem: string;
  /** Data da autorização (AAAA-MM-DD). */
  data: string;
  forma: FormaDeAutorizacao;
  /** Para que a imagem pode ser usada (ex.: "posts e anúncios da clínica"). */
  finalidade: string;
  /** Onde (canais) e até quando; vazio = até revogar. */
  escopo: string | null;
  validade: string | null;
  observacao: string | null;
  /** A pessoa sabe que as imagens serão geradas por IA (exigido: sem isso, não é consentimento informado). */
  sabe_que_e_ia: true;
  adulta: true;
  registrada_por?: string | null;
  registrada_em?: string | null;
  revogada_em?: string | null;
};

const DATA = /^\d{4}-\d{2}-\d{2}$/;

/** Data AAAA-MM-DD ou DD/MM/AAAA para AAAA-MM-DD; null se não for data válida. */
export function dataIso(v: unknown): string | null {
  const t = String(v ?? "").trim();
  const br = t.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = br ? `${br[3]}-${br[2]}-${br[1]}` : t.slice(0, 10);
  if (!DATA.test(iso)) return null;
  const d = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== iso ? null : iso;
}

/**
 * Autorização de uso de imagem da pessoa retratada. Recusa (422) sem a
 * confirmação, sem quem autorizou, sem data, sem finalidade, sem a pessoa
 * saber que é IA ou sem a confirmação de que é adulta. Validade vencida
 * também recusa.
 */
export function lerAutorizacaoDoClone(bruto: unknown, hoje: string = new Date().toISOString().slice(0, 10)): AutorizacaoDoClone {
  const r = (bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {}) as Record<string, unknown>;
  const falta: string[] = [];
  if (r.confirmada !== true) falta.push("a confirmação da autorização");
  const quem = limpo(r.quem, 160);
  if (!quem) falta.push("quem autorizou");
  const data = dataIso(r.data);
  if (!data) falta.push("a data da autorização");
  const finalidade = limpo(r.finalidade, 400);
  if (!finalidade) falta.push("a finalidade do uso");
  if (r.sabe_que_e_ia !== true) falta.push("a confirmação de que a pessoa sabe que as imagens serão geradas por IA");
  if (r.adulta !== true) falta.push(`a confirmação de que a pessoa tem ${IDADE_MINIMA_CLONE} anos ou mais`);
  if (falta.length) {
    throw new ErroDeRegra(422, "autorizacao_obrigatoria", `Clone só com autorização de uso de imagem da pessoa retratada. Falta: ${falta.join(", ")}.`, { falta });
  }
  const validade = r.validade == null || r.validade === "" ? null : dataIso(r.validade);
  if (r.validade != null && r.validade !== "" && !validade) throw new ErroDeRegra(400, "validade_invalida", "Validade da autorização inválida (use AAAA-MM-DD).");
  if (validade && validade < hoje) throw new ErroDeRegra(422, "autorizacao_vencida", "A autorização desta pessoa já venceu. Registre uma nova autorização.");
  if (data! > hoje) throw new ErroDeRegra(400, "data_no_futuro", "A data da autorização está no futuro.");
  const forma = (FORMAS_DE_AUTORIZACAO as readonly string[]).includes(String(r.forma)) ? (r.forma as FormaDeAutorizacao) : "outro";
  return {
    confirmada: true,
    quem,
    data: data!,
    forma,
    finalidade,
    escopo: limpo(r.escopo, 400) || null,
    validade,
    observacao: limpo(r.observacao, 600) || null,
    sabe_que_e_ia: true,
    adulta: true,
  };
}

/** A autorização ainda vale hoje (confirmada, sem revogação, dentro da validade). */
export function autorizacaoValida(a: Partial<AutorizacaoDoClone> | null | undefined, hoje: string = new Date().toISOString().slice(0, 10)): { ok: boolean; motivo: string | null } {
  if (!a || a.confirmada !== true) return { ok: false, motivo: "Clone sem autorização registrada." };
  if (a.revogada_em) return { ok: false, motivo: "A autorização desta pessoa foi revogada: nada novo pode ser gerado." };
  if (a.validade && a.validade < hoje) return { ok: false, motivo: "A autorização desta pessoa venceu: registre uma nova." };
  return { ok: true, motivo: null };
}

// ------------------------------------------------------------------ textos permitidos

/** Pedido que muda a identidade (rosto, idade, corpo): proibido no clone. */
const MUDA_IDENTIDADE =
  /\b(mais (?:jovem|nova|novo|velh[ao]|magr[ao]|gord[ao]|alt[ao]|baix[ao])|rejuvenesc\w*|envelhec\w*|emagrec\w*|engord\w*|outro rosto|mud(?:ar|e|a) o rosto|trocar o rosto|nariz (?:menor|maior|fino)|afinar o rosto|afinar o nariz|l[aá]bios? maiores|harmoniza[cç][aã]o facial|clarear a pele|escurecer a pele|mudar a cor da pele|mudar o corpo|mais musculos[ao]|seios? maiores)\b/i;

/**
 * Texto que a equipe escreve no clone (nome, pedido de variação): sem sósia
 * de pessoa conhecida, sem menor, sem sexualização e sem mudar a identidade.
 * A palavra "clone" é o nome da área e não conta como pedido de sósia.
 */
export function garantirPermitidoNoClone(...textos: unknown[]): void {
  for (const t of textos) {
    const bruto = typeof t === "string" ? t : t && typeof t === "object" ? JSON.stringify(t) : "";
    // "clone" e "igual à foto" são do vocabulário da área; nome de pessoa conhecida continua recusado.
    const semAPalavra = bruto.replace(/\bclones?\b/gi, " ").replace(/\bigual (?:a|ao|à)(?=\s)/gi, " ");
    const motivo = conteudoProibido(semAPalavra);
    if (motivo) throw new ErroDeRegra(422, motivo.codigo, motivo.codigo === "semelhanca_proibida" ? "O clone é da pessoa real das fotos, nunca de outra pessoa: descreva roupa, cenário e pose, não pessoas." : motivo.mensagem);
    if (MUDA_IDENTIDADE.test(semAPalavra)) {
      throw new ErroDeRegra(422, "identidade_nao_muda", "No clone o rosto, a idade, o corpo e o tom de pele da pessoa não mudam. Mude roupa, cenário, pose, expressão ou luz.");
    }
  }
}

// ------------------------------------------------------------------ variações

export type PedidoDeVariacao = {
  preset: string | null;
  roupa: string;
  cenario: string;
  pose: string;
  expressao: string;
  luz: string;
  enquadramento: "close" | "meio_corpo" | "corpo_inteiro";
  livre: string;
};

export type PresetDeVariacao = { id: string; rotulo: string; pedido: Omit<PedidoDeVariacao, "preset" | "livre"> };

/** Variações prontas (estética atual, CLONES.md): a tela oferece como atalhos e a equipe ajusta. */
export const PRESETS_DE_VARIACAO: PresetDeVariacao[] = [
  { id: "retrato_editorial", rotulo: "Retrato editorial", pedido: { roupa: "camisa ou blusa lisa em tom neutro", cenario: "papel de fundo liso em tom areia", pose: "ombros levemente virados, olhar para a câmera", expressao: "serena, meio sorriso", luz: "luz de janela lateral suave, sombras macias", enquadramento: "close" } },
  { id: "lifestyle_rua", rotulo: "Na rua", pedido: { roupa: "roupa casual atual (camiseta, jaqueta leve, calça reta)", cenario: "calçada de rua arborizada com fachadas claras, luz do dia", pose: "caminhando, gesto natural", expressao: "natural, olhando para o lado", luz: "fim de tarde, sol filtrado", enquadramento: "meio_corpo" } },
  { id: "no_trabalho", rotulo: "No trabalho", pedido: { roupa: "roupa de trabalho da profissão, limpa e atual", cenario: "ambiente de trabalho claro e organizado, sem marca de terceiros", pose: "fazendo o gesto típico do trabalho", expressao: "concentrada e confiante", luz: "luz natural do ambiente", enquadramento: "meio_corpo" } },
  { id: "cafe", rotulo: "Café", pedido: { roupa: "malha leve em tom neutro", cenario: "café com janela grande e mesa de madeira clara", pose: "sentada, segurando uma xícara", expressao: "relaxada, sorriso leve", luz: "luz do dia pela janela", enquadramento: "meio_corpo" } },
  { id: "em_casa", rotulo: "Em casa", pedido: { roupa: "roupa confortável de casa, linho ou algodão", cenario: "sala clara com sofá de linho e plantas", pose: "sentada à vontade", expressao: "tranquila", luz: "luz suave da manhã", enquadramento: "meio_corpo" } },
  { id: "sorriso_close", rotulo: "Close sorrindo", pedido: { roupa: "a mesma roupa neutra", cenario: "fundo liso claro fora de foco", pose: "rosto de frente, leve inclinação", expressao: "sorriso aberto e natural", luz: "luz frontal suave e difusa", enquadramento: "close" } },
  { id: "corpo_inteiro_estudio", rotulo: "Corpo inteiro em estúdio", pedido: { roupa: "look completo atual e sóbrio", cenario: "papel de fundo de cor sólida (sálvia suave)", pose: "em pé, postura natural", expressao: "confiante", luz: "flash direto suave de editorial, sombra curta", enquadramento: "corpo_inteiro" } },
  { id: "ugc", rotulo: "Estilo UGC", pedido: { roupa: "roupa do dia a dia", cenario: "ambiente real de casa ou do trabalho, sem arrumação de estúdio", pose: "como numa foto tirada com o celular na altura do peito", expressao: "espontânea, falando com a câmera", luz: "luz do ambiente, pequenas imperfeições reais", enquadramento: "meio_corpo" } },
];
export const presetPorId = (id: unknown) => PRESETS_DE_VARIACAO.find((p) => p.id === String(id ?? "")) ?? null;

const ENQUADRAMENTOS = ["close", "meio_corpo", "corpo_inteiro"] as const;

/** Pedido de variação: preset como base e o que a equipe escreveu por cima. Texto proibido recusa. */
export function lerPedidoDeVariacao(bruto: unknown): PedidoDeVariacao {
  const r = (bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {}) as Record<string, unknown>;
  const p = presetPorId(r.preset);
  const base = p?.pedido ?? { roupa: "", cenario: "", pose: "", expressao: "", luz: "", enquadramento: "meio_corpo" as const };
  const campo = (k: keyof typeof base, max: number) => limpo(r[k], max) || String(base[k] ?? "");
  const pedido: PedidoDeVariacao = {
    preset: p?.id ?? null,
    roupa: campo("roupa", 300),
    cenario: campo("cenario", 400),
    pose: campo("pose", 300),
    expressao: campo("expressao", 200),
    luz: campo("luz", 300),
    enquadramento: (ENQUADRAMENTOS as readonly string[]).includes(String(r.enquadramento)) ? (r.enquadramento as PedidoDeVariacao["enquadramento"]) : base.enquadramento,
    livre: limpo(r.livre ?? r.pedido, 600),
  };
  if (!pedido.preset && !pedido.roupa && !pedido.cenario && !pedido.pose && !pedido.expressao && !pedido.livre) {
    throw new ErroDeRegra(400, "variacao_vazia", "Diga o que muda nesta variação (roupa, cenário, pose, expressão) ou escolha uma variação pronta.");
  }
  garantirPermitidoNoClone(pedido.roupa, pedido.cenario, pedido.pose, pedido.expressao, pedido.luz, pedido.livre);
  return pedido;
}

// ------------------------------------------------------------------ identidade no gerador

export type FonteDeIdentidade = { id: string; tipo: "real" | "folha"; vista: string | null; principal?: boolean };

/**
 * O que vai ao gerador como identidade, em ordem: as fotos REAIS primeiro (a
 * principal na frente; são a verdade sobre a pessoa), depois as vistas
 * APROVADAS da folha mais perto da pedida. Até o limite do gerador e até 5
 * (mais referência ajuda menos do que parece e o rosto "vira a média").
 */
export function identidadesDoClone(reais: FonteDeIdentidade[], folhaAprovada: FonteDeIdentidade[], vista: VistaDaPersona | null, limite: number): FonteDeIdentidade[] {
  const max = Math.max(1, Math.min(MAX_IDENTIDADES_NO_GERADOR, Math.floor(limite)));
  const ordenadasReais = [...reais].sort((a, b) => (b.principal ? 1 : 0) - (a.principal ? 1 : 0));
  // Reais ocupam no máximo 3 lugares quando há folha aprovada: a folha traz os ângulos que as fotos não têm.
  const vagasReais = folhaAprovada.length ? Math.min(ordenadasReais.length, Math.max(1, max - Math.min(2, folhaAprovada.length))) : max;
  const folha = ordenarPorProximidade(vista ?? "frente", folhaAprovada);
  return [...ordenadasReais.slice(0, vagasReais), ...folha].slice(0, max);
}

/** Legenda de cada identidade no prompt, por índice (Imagem 1, Imagem 2...). */
export function legendasDasIdentidades(fontes: FonteDeIdentidade[]): string[] {
  return fontes.map((f, i) =>
    f.tipo === "real"
      ? `Imagem ${i + 1}: FOTO REAL da pessoa${f.principal ? " (a principal)" : ""}. É a verdade sobre o rosto: mesmo formato do rosto, olhos, sobrancelhas, nariz, lábios, tom e textura da pele, pintas, sardas, cicatrizes, linha do cabelo e idade.`
      : `Imagem ${i + 1}: vista aprovada da folha de identidade (${DESCRICAO_DA_VISTA[lerVista(f.vista) ?? "frente"]}), a mesma pessoa; use para o ângulo.`
  );
}

const REGRAS_DO_CLONE = [
  "é a MESMA pessoa real das fotos, com autorização de uso de imagem: não invente outra pessoa, não misture com ninguém e não pareça celebridade",
  "rosto, idade aparente, tom de pele, corpo, altura, pintas, sardas, cicatrizes e tatuagens exatamente como nas fotos reais (retoque não muda anatomia)",
  "tatuagem e pinta do lado certo: nunca espelhe a pessoa",
  "mãos com cinco dedos, unhas e articulações corretas; dentes naturais, sem clarear",
  "sem sexualização, sem nudez, sem roupa reveladora",
  "sem texto, sem marca d'água, sem logotipo de terceiros",
];

const PELE_REAL =
  "PELE E MICRODETALHE: a textura real da pessoa (poros, penugem, pequenas manchas e linhas de expressão que ela tem), sem filtro de beleza, sem pele de porcelana, sem HDR, sem nitidez exagerada; cor natural e grão fino.";

/** Prompt de uma vista da folha de identidade (fundo neutro, luz plana, expressão neutra). */
export function promptDaFolhaDoClone(e: { nome: string; vista: VistaDaPersona; fontes: FonteDeIdentidade[]; invariantes: string[] }): string {
  const linhas: string[] = [];
  linhas.push(`FOLHA DE IDENTIDADE da pessoa real "${e.nome}" (fotografia, não ilustração): uma vista limpa para servir de referência de rosto em fotos e vídeos.`);
  linhas.push("IMAGENS ANEXADAS, NA ORDEM:", ...legendasDasIdentidades(e.fontes));
  if (e.invariantes.length) linhas.push(`TRAÇOS QUE NÃO MUDAM: ${e.invariantes.join("; ")}.`);
  linhas.push(`VISTA PEDIDA: ${DESCRICAO_DA_VISTA[e.vista]}.`);
  linhas.push(
    "PADRÃO DA FOLHA: fundo cinza claro liso e contínuo, luz frontal difusa e uniforme (sem sombra dura no rosto), expressão neutra com a boca fechada, cabelo como nas fotos reais, camiseta lisa cinza média sem estampa, sem óculos escuros, sem chapéu, sem acessório que não esteja nas fotos; nitidez no rosto; mesma altura de câmera dos olhos.",
  );
  linhas.push(PELE_REAL);
  linhas.push(`REGRAS: ${REGRAS_DO_CLONE.join("; ")}.`);
  return semTravessao(linhas.join("\n"));
}

const ENQUADRAMENTO_EM_PALAVRAS: Record<PedidoDeVariacao["enquadramento"], string> = {
  close: "retrato de perto, do peito para cima, lente de 85 mm, rosto grande e nítido no quadro",
  meio_corpo: "plano médio, da cintura para cima, lente de 50 mm, rosto ainda bem visível",
  corpo_inteiro: "corpo inteiro no ambiente, lente de 35 mm, rosto nítido e reconhecível",
};

/** Prompt de uma variação: o que muda (roupa, cenário, pose, expressão, luz) e tudo o que fica. */
export function promptDaVariacaoDoClone(e: { nome: string; fontes: FonteDeIdentidade[]; invariantes: string[]; pedido: PedidoDeVariacao; formato: string }): string {
  const p = e.pedido;
  const linhas: string[] = [];
  linhas.push(`FOTOGRAFIA REAL da pessoa "${e.nome}" (pessoa real com autorização de uso de imagem), nova foto com o MESMO rosto das imagens anexadas.`);
  linhas.push("IMAGENS ANEXADAS, NA ORDEM:", ...legendasDasIdentidades(e.fontes));
  if (e.invariantes.length) linhas.push(`TRAÇOS QUE NÃO MUDAM: ${e.invariantes.join("; ")}.`);
  linhas.push(
    `O QUE MUDA NESTA FOTO: ${[
      p.roupa ? `roupa: ${p.roupa}` : "",
      p.cenario ? `cenário: ${p.cenario}` : "",
      p.pose ? `pose: ${p.pose}` : "",
      p.expressao ? `expressão: ${p.expressao}` : "",
      p.luz ? `luz: ${p.luz}` : "",
    ].filter(Boolean).join("; ") || "roupa, cenário e pose novos, coerentes entre si"}.`,
  );
  if (p.livre) linhas.push(`PEDIDO DA EQUIPE: ${p.livre}`);
  linhas.push(`CÂMERA: ${ENQUADRAMENTO_EM_PALAVRAS[p.enquadramento]}; foco nos olhos. FORMATO ${e.formato}.`);
  linhas.push(
    "ESTÉTICA ATUAL: fotografia de marca contemporânea, editorial limpo ou UGC autêntico conforme o pedido, luz natural com direção e sombras macias reais, paleta atual; sem fundo degradê, sem vinheta, sem HDR, sem bokeh exagerado, sem cara de banco de imagem. Nunca escureça a foto para dar destaque.",
  );
  linhas.push(PELE_REAL);
  linhas.push(`REGRAS: ${REGRAS_DO_CLONE.join("; ")}.`);
  return semTravessao(linhas.join("\n"));
}

// ------------------------------------------------------------------ status e pacote

export type ImagemDaFolha = { id: string; papel: string; vista: string | null; aprovada: boolean | null };

/** Status do clone pelo que existe: rascunho (só fotos reais), folha (vistas geradas), pronta (frente + 2 aprovadas). */
export function statusDoClone(atual: string, imagens: ImagemDaFolha[]): "rascunho" | "folha" | "pronta" | "arquivada" {
  if (atual === "arquivada") return "arquivada";
  const vistas = imagens.filter((i) => i.papel === "vista");
  const aprovadas = vistas.filter((i) => i.aprovada === true);
  if (aprovadas.some((i) => i.vista === "frente") && aprovadas.length >= APROVADAS_PARA_PRONTO) return "pronta";
  return vistas.length ? "folha" : "rascunho";
}

export function resumoDaFolhaDoClone(imagens: ImagemDaFolha[]) {
  const vistas = FOLHA_DO_CLONE.map((v) => {
    const dela = imagens.filter((i) => i.papel === "vista" && i.vista === v);
    const aprovada = dela.find((i) => i.aprovada === true) ?? null;
    return { vista: v, descricao: DESCRICAO_DA_VISTA[v], geradas: dela.length, aprovada_id: aprovada?.id ?? null };
  });
  const aprovadas = vistas.filter((v) => v.aprovada_id).length;
  const frente = vistas[0].aprovada_id != null;
  return { vistas, aprovadas, total: FOLHA_DO_CLONE.length, minimo_para_pronto: APROVADAS_PARA_PRONTO, frente_aprovada: frente, pronto: frente && aprovadas >= APROVADAS_PARA_PRONTO };
}

/** Tamanho da imagem da folha: rosto em 4:5; corpo inteiro em 9:16 (pronto para vídeo vertical). */
export const tamanhoDaVista = (v: VistaDaPersona) => (v === "corpo_inteiro" ? "1088x1920" : "1088x1360");

export const FORMATOS_DA_VARIACAO: Record<string, string> = { "4:5": "1088x1360", "1:1": "1024x1024", "9:16": "1088x1920", "16:9": "1920x1088" };
export const lerFormatoDaVariacao = (v: unknown): string => (FORMATOS_DA_VARIACAO[String(v)] ? String(v) : "4:5");

/** Fotos reais do pedido: 1 a 4 ids únicos. */
export function lerFotosReais(v: unknown): string[] {
  const ids = Array.isArray(v) ? Array.from(new Set(v.map((x) => String(x ?? "").trim()).filter((x) => UUID.test(x)))) : [];
  if (!ids.length) throw new ErroDeRegra(400, "fotos_obrigatorias", `Escolha de 1 a ${MAX_FOTOS_REAIS} fotos reais da mesma pessoa.`);
  if (ids.length > MAX_FOTOS_REAIS) throw new ErroDeRegra(400, "fotos_demais", `No máximo ${MAX_FOTOS_REAIS} fotos reais por clone (mais referência ajuda menos e o rosto vira a média).`);
  return ids;
}

// ------------------------------------------------------------------ conferência

export const TRACOS_DO_ROSTO = ["formato_do_rosto", "olhos", "sobrancelhas", "nariz", "labios", "pele_e_marcas", "cabelo", "idade_aparente", "corpo"] as const;
export type TracoDoRosto = typeof TRACOS_DO_ROSTO[number];
export const ROTULO_DO_TRACO: Record<TracoDoRosto, string> = {
  formato_do_rosto: "formato do rosto",
  olhos: "olhos",
  sobrancelhas: "sobrancelhas",
  nariz: "nariz",
  labios: "lábios",
  pele_e_marcas: "pele, pintas e marcas",
  cabelo: "cabelo",
  idade_aparente: "idade aparente",
  corpo: "corpo e proporções",
};

export type LeituraDoClone = {
  tracos: { traco: TracoDoRosto; nas_reais: string; na_gerada: string }[];
  impressao_geral: string;
  espelhada: string;
  artefatos: string[];
  resumo: string;
};

export function normalizarLeituraDoClone(bruto: unknown): LeituraDoClone {
  const r = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const lista = Array.isArray(r.tracos) ? r.tracos : [];
  const tracos = lista
    .map((x) => (x && typeof x === "object" ? x as Record<string, unknown> : {}))
    .filter((x) => (TRACOS_DO_ROSTO as readonly string[]).includes(String(x.traco)))
    .map((x) => ({ traco: x.traco as TracoDoRosto, nas_reais: limpo(x.nas_reais, 300), na_gerada: limpo(x.na_gerada, 300) }));
  return {
    tracos: tracos.filter((t, i) => tracos.findIndex((u) => u.traco === t.traco) === i),
    impressao_geral: limpo(r.impressao_geral, 400),
    espelhada: limpo(r.espelhada, 200),
    artefatos: listaDeTextos(r.artefatos, 8, 200),
    resumo: limpo(r.resumo, 500),
  };
}

/**
 * Critérios da comparação por traço (Choice do Jev, padrão "verificar
 * contra a evidência": a foto real é a fonte, a gerada é a afirmação).
 */
export const OPCOES_DO_TRACO = {
  igual: "O traço descrito na foto gerada é o mesmo das fotos reais (mesma forma, cor e tamanho).",
  pequena_diferenca: "Diferença pequena, explicada por luz, ângulo, expressão, maquiagem ou penteado; continua sendo o traço da mesma pessoa.",
  diferente: "O traço descrito é outro: forma, cor, tamanho ou posição claramente diferentes das fotos reais.",
  nao_da_para_ver: "A descrição diz que o traço não aparece numa das imagens, então não dá para comparar.",
};

export type NotaDoTraco = { traco: TracoDoRosto; escolha: string | null; confianca: number | null; probabilidades: Record<string, number> | null };

/**
 * Aviso composto (sem biometria): cada traço vira um sinal; o código decide
 * os alertas e a nota de semelhança (0 a 1). Só aviso: ninguém refaz nem
 * aprova sozinho.
 */
export function alertasDoClone(notas: NotaDoTraco[], outraPessoa: number | null, espelhada: number | null): { alertas: string[]; conferir: string[]; semelhanca: number | null } {
  const alertas: string[] = [];
  const conferir: string[] = [];
  let soma = 0, peso = 0;
  const PESO: Partial<Record<TracoDoRosto, number>> = { formato_do_rosto: 1.5, olhos: 1.5, nariz: 1.5, labios: 1, sobrancelhas: 1, pele_e_marcas: 1, idade_aparente: 1, cabelo: 0.5, corpo: 0.5 };
  for (const n of notas) {
    const p = n.probabilidades ?? {};
    const visto = 1 - (p.nao_da_para_ver ?? 0);
    const w = (PESO[n.traco] ?? 1) * visto;
    if (w > 0.05) {
      const valor = ((p.igual ?? 0) + 0.6 * (p.pequena_diferenca ?? 0)) / Math.max(0.0001, visto);
      soma += valor * w;
      peso += w;
    }
    if ((p.diferente ?? 0) >= 0.5) alertas.push(`${ROTULO_DO_TRACO[n.traco][0].toUpperCase()}${ROTULO_DO_TRACO[n.traco].slice(1)} parece diferente das fotos reais.`);
    else if (n.confianca != null && n.confianca < 0.5 && n.escolha !== "nao_da_para_ver") conferir.push(ROTULO_DO_TRACO[n.traco]);
  }
  if (outraPessoa != null && outraPessoa >= 0.5) alertas.unshift("Pode não parecer a mesma pessoa: compare com as fotos reais antes de usar.");
  if (espelhada != null && espelhada >= 0.5) alertas.push("A pessoa pode ter saído espelhada (pinta, tatuagem ou repartição do cabelo do lado trocado).");
  return { alertas, conferir, semelhanca: peso ? Math.round((soma / peso) * 1000) / 1000 : null };
}
