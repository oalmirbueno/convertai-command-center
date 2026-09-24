/**
 * Área "Modelos" da Mesa Foto: regras puras das personas sintéticas
 * (docs/mesa-foto/MODELOS-E-CANVAS.md, seções 4, 5 e 8.2). Sem rede, sem
 * banco e sem Deno: a função (modelos.ts) usa e o teste do painel importa.
 *
 * Regras duras (dono, 2026-09-24):
 * - só adulto, idade aparente mínima 21 (a ficha abaixo disso é recusada);
 * - nunca parecer pessoa real: pedido de sósia ou nome de pessoa conhecida é
 *   recusado; referência do dono entra só como estilo, pose, luz ou roupa,
 *   nunca como identidade;
 * - sem sexualização; toda imagem é marcada como gerada;
 * - sem laço de correção: gera uma vez, confere uma vez, a equipe decide;
 * - a ficha (invariantes da persona) vai em TODO pedido ao gerador.
 */

import { type Resolucao } from "../_shared/capacidades-imagem.ts";
import { ErroDeRegra, IDADE_MINIMA_MODELO, limpo, listaDeTextos, semTravessao, UUID } from "./calculos.ts";

// ------------------------------------------------------------------ vocabulário

export const VISTAS_DA_PERSONA = [
  "frente", "tres_quartos_esq", "tres_quartos_dir", "perfil_esq", "perfil_dir", "meio_corpo", "corpo_inteiro", "maos",
] as const;
export type VistaDaPersona = typeof VISTAS_DA_PERSONA[number];

/** Folha padrão: 6 vistas, uma imagem por chamada (não uma folha única). */
export const FOLHA_PADRAO: VistaDaPersona[] = ["frente", "tres_quartos_esq", "tres_quartos_dir", "perfil_esq", "meio_corpo", "corpo_inteiro"];

/** Aprovadas da folha (além da âncora) para a persona ficar pronta. */
export const VISTAS_PARA_PRONTA = 3;

export const DESCRICAO_DA_VISTA: Record<VistaDaPersona, string> = {
  frente: "retrato de frente, rosto e ombros, olhando para a câmera, cabeça reta",
  tres_quartos_esq: "retrato em três quartos, rosto virado cerca de 45 graus para a esquerda da foto, ombros acompanhando",
  tres_quartos_dir: "retrato em três quartos, rosto virado cerca de 45 graus para a direita da foto, ombros acompanhando",
  perfil_esq: "perfil completo, rosto virado 90 graus para a esquerda da foto, orelha e linha do queixo visíveis",
  perfil_dir: "perfil completo, rosto virado 90 graus para a direita da foto, orelha e linha do queixo visíveis",
  meio_corpo: "meio corpo, da cintura para cima, postura natural e relaxada, braços visíveis",
  corpo_inteiro: "corpo inteiro, da cabeça aos pés, em pé, postura natural, roupa do dia a dia do estilo da ficha",
  maos: "close das mãos em gesto natural, cinco dedos em cada mão, unhas e articulações corretas, rosto fora do quadro",
};

/** Ângulo do rosto (graus) e distância da câmera (0 rosto, 1 meio corpo, 2 corpo inteiro) de cada vista. */
const GEOMETRIA: Record<VistaDaPersona, { angulo: number; distancia: number }> = {
  frente: { angulo: 0, distancia: 0 },
  tres_quartos_esq: { angulo: -45, distancia: 0 },
  tres_quartos_dir: { angulo: 45, distancia: 0 },
  perfil_esq: { angulo: -90, distancia: 0 },
  perfil_dir: { angulo: 90, distancia: 0 },
  meio_corpo: { angulo: 0, distancia: 1 },
  corpo_inteiro: { angulo: 0, distancia: 2 },
  maos: { angulo: 0, distancia: 1 },
};

export const USOS_DE_REFERENCIA = ["estilo", "pose", "luz", "roupa"] as const;
export type UsoDeReferencia = typeof USOS_DE_REFERENCIA[number];

export const STATUS_DA_PERSONA = ["rascunho", "candidatos", "ancora", "folha", "pronta", "arquivada"] as const;
export type StatusDaPersona = typeof STATUS_DA_PERSONA[number];

export const ESCOPOS_DA_PERSONA = ["cliente", "agencia"] as const;
export type EscopoDaPersona = typeof ESCOPOS_DA_PERSONA[number];

export const PAPEIS_DA_IMAGEM_DA_PERSONA = ["candidata", "vista", "detalhe"] as const;
export type PapelDaImagemDaPersona = typeof PAPEIS_DA_IMAGEM_DA_PERSONA[number];

export const ALVOS_DO_DETALHE = ["pessoa", "produto"] as const;
export type AlvoDoDetalhe = typeof ALVOS_DO_DETALHE[number];

export const lerVista = (v: unknown): VistaDaPersona | null =>
  (VISTAS_DA_PERSONA as readonly string[]).includes(String(v)) ? (v as VistaDaPersona) : null;
export const lerUsoDeReferencia = (v: unknown): UsoDeReferencia =>
  (USOS_DE_REFERENCIA as readonly string[]).includes(String(v)) ? (v as UsoDeReferencia) : "estilo";
export const lerEscopo = (v: unknown): EscopoDaPersona => (v === "agencia" ? "agencia" : "cliente");
export const lerAlvoDoDetalhe = (v: unknown): AlvoDoDetalhe => (v === "produto" ? "produto" : "pessoa");

// ------------------------------------------------------------------ motores

export type MotorDaRodada = { modelo_imagem_id: string; rotulo: string; qualidade: "baixa" | "media" | "alta"; resolucao: Resolucao | null; padrao: boolean };

/**
 * Geradores da rodada lado a lado (decisão do dono, 24/09): os 4 padrão ligados
 * e os opcionais desligados. A tela liga e desliga; o servidor gera UMA
 * candidata por chamada (uma chamada por gerador, em paralelo).
 */
export const RODADA_PADRAO: MotorDaRodada[] = [
  { modelo_imagem_id: "openrouter:openai/gpt-image-2.5-sunburst", rotulo: "GPT Image 2.5 Sunburst", qualidade: "alta", resolucao: null, padrao: true },
  { modelo_imagem_id: "openrouter:google/gemini-3-pro-image", rotulo: "Nano Banana Pro 2K", qualidade: "alta", resolucao: "2K", padrao: true },
  { modelo_imagem_id: "openrouter:bytedance-seed/seedream-5-0-pro", rotulo: "Seedream 5.0 Pro 2K", qualidade: "alta", resolucao: "2K", padrao: true },
  { modelo_imagem_id: "openrouter:microsoft/mai-image-2.6", rotulo: "MAI-Image-2.6", qualidade: "alta", resolucao: null, padrao: true },
  { modelo_imagem_id: "openrouter:black-forest-labs/flux.2-max", rotulo: "FLUX.2 Max", qualidade: "alta", resolucao: null, padrao: false },
  { modelo_imagem_id: "openrouter:x-ai/grok-imagine-image-2.0", rotulo: "Grok Imagine 2.0", qualidade: "alta", resolucao: "2K", padrao: false },
  { modelo_imagem_id: "openrouter:krea/krea-2-large", rotulo: "Krea 2 Large", qualidade: "alta", resolucao: "1K", padrao: false },
  { modelo_imagem_id: "openrouter:google/gemini-3.1-flash-image", rotulo: "Nano Banana 2 (rascunho)", qualidade: "alta", resolucao: "1K", padrao: false },
];

/** Qualidade e resolução padrão de um gerador na rodada (o que a tela não mandar). */
export function padraoDoMotor(modeloImagemId: string): { qualidade: "baixa" | "media" | "alta"; resolucao: Resolucao | null } {
  const m = RODADA_PADRAO.find((x) => x.modelo_imagem_id === modeloImagemId);
  return m ? { qualidade: m.qualidade, resolucao: m.resolucao } : { qualidade: "alta", resolucao: null };
}

/** "Detalhar em 4K" sem chave nova: Nano Banana Pro 4K para pessoa, Seedream 4.5 4K para produto. */
export const MOTOR_DETALHE: Record<AlvoDoDetalhe, string> = {
  pessoa: "openrouter:google/gemini-3-pro-image",
  produto: "openrouter:bytedance-seed/seedream-4.5",
};

// ------------------------------------------------------------------ ficha

export type FichaDaPersona = {
  idade_aparente: number;
  genero_apresentado: string;
  tom_de_pele: string;
  rosto: string;
  olhos: string;
  sobrancelhas: string;
  nariz: string;
  labios: string;
  cabelo: { cor: string; comprimento: string; textura: string };
  marcas: string[];
  corpo: string;
  altura: string;
  estilo: string;
  notas: string;
};

/** Pedido de sósia ou semelhança com alguém ("parecida com", "a cara de", lookalike). */
const SOSIA = /\b(parecid[oa]s? com|semelhante a|igual (?:a|ao|à)|a cara d[aoe]|s[oó]sia|lookalike|look-alike|clone d[aoe]|estilo d[aoe] (?:famos|celebr|ator|atriz|cantor|cantora|influenc))/i;

/**
 * Nomes de pessoas públicas muito conhecidas (lista simples, não exaustiva).
 * A conferência por visão pergunta de novo se a imagem lembra alguém conhecido.
 */
export const PESSOAS_PUBLICAS = [
  "gisele bundchen", "anitta", "neymar", "xuxa", "ivete sangalo", "bruna marquezine", "marina ruy barbosa",
  "paolla oliveira", "tais araujo", "lazaro ramos", "rodrigo santoro", "juliette", "virginia fonseca", "ludmilla",
  "taylor swift", "beyonce", "rihanna", "zendaya", "scarlett johansson", "angelina jolie", "brad pitt",
  "leonardo dicaprio", "cristiano ronaldo", "lionel messi", "kim kardashian", "kylie jenner", "selena gomez",
  "ariana grande", "billie eilish", "dua lipa", "margot robbie", "tom cruise", "keanu reeves", "emma watson",
  "jennifer lopez", "shakira", "lady gaga", "elon musk", "barack obama", "michelle obama", "bolsonaro",
];

/** Menor de idade (a persona é sempre adulta). */
const MENOR = /\b(crian[cç]a|menor de idade|menina|menino|adolescente|teen|teenager|novinh[ao]|colegial|beb[eê]|infantil|garot[ao] de (?:1[0-7]|[0-9]) anos|(?:1[0-7]|[0-9]) anos de idade)\b/i;

/** Sexualização (fora da regra da casa). */
const SEXUALIZACAO = /\b(nu|nua|nus|nuas|nudez|pelad[ao]|topless|seminu[a]?|er[oó]tic[ao]|sensual|sexy|provocante|fetiche|lingerie sensual|pornogr\w*)\b/i;

const semAcento = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Motivo de recusa do texto (sósia, pessoa conhecida, menor, sexualização) ou null. */
export function conteudoProibido(texto: string): { codigo: string; mensagem: string } | null {
  const t = String(texto ?? "");
  if (!t.trim()) return null;
  if (SOSIA.test(t)) {
    return { codigo: "semelhanca_proibida", mensagem: "A persona não pode ser parecida com ninguém real. Descreva traços, não pessoas." };
  }
  const normal = ` ${semAcento(t).replace(/[^a-z0-9]+/g, " ")} `;
  const nome = PESSOAS_PUBLICAS.find((n) => normal.includes(` ${n} `));
  if (nome) {
    return { codigo: "pessoa_publica_proibida", mensagem: "Nome de pessoa conhecida não entra na persona: a pessoa sintética não pode lembrar alguém real." };
  }
  if (MENOR.test(t)) return { codigo: "menor_de_idade", mensagem: `A persona é sempre adulta, com idade aparente de pelo menos ${IDADE_MINIMA_MODELO} anos.` };
  if (SEXUALIZACAO.test(t)) return { codigo: "sexualizacao_proibida", mensagem: "Sem sexualização: a persona não pode ser descrita de forma sexual." };
  return null;
}

/** Recusa o texto quando ele pede algo proibido (erro 422 com o código). */
export function garantirPermitido(...textos: unknown[]): void {
  for (const t of textos) {
    const bruto = typeof t === "string" ? t : t && typeof t === "object" ? JSON.stringify(t) : "";
    const motivo = conteudoProibido(bruto);
    if (motivo) throw new ErroDeRegra(422, motivo.codigo, motivo.mensagem);
  }
}

export function normalizarNomeDaPersona(v: unknown): string {
  const nome = limpo(v, 80);
  if (!nome) throw new ErroDeRegra(400, "nome_obrigatorio", "Dê um nome fictício para a persona.");
  garantirPermitido(nome);
  return nome;
}

/**
 * Ficha da persona. idade_aparente é obrigatória e inteira, de 21 a 80: a
 * ficha abaixo de 21 é recusada (não ajustada). Texto com sósia, pessoa
 * conhecida, menor ou sexualização é recusado.
 */
export function normalizarFicha(bruto: unknown, descricao?: unknown): FichaDaPersona {
  const r = (bruto && typeof bruto === "object" && !Array.isArray(bruto) ? bruto : {}) as Record<string, unknown>;
  const idadeBruta = r.idade_aparente ?? r.idade;
  const idade = Math.round(Number(idadeBruta));
  if (idadeBruta == null || idadeBruta === "" || !Number.isFinite(idade)) {
    throw new ErroDeRegra(400, "idade_obrigatoria", `Informe a idade aparente da persona (a partir de ${IDADE_MINIMA_MODELO} anos).`);
  }
  if (idade < IDADE_MINIMA_MODELO) {
    throw new ErroDeRegra(422, "idade_minima", `A persona precisa ter idade aparente de pelo menos ${IDADE_MINIMA_MODELO} anos.`, { idade_minima: IDADE_MINIMA_MODELO });
  }
  if (idade > 80) throw new ErroDeRegra(400, "idade_invalida", "Idade aparente acima de 80 anos não é aceita.");
  const c = (r.cabelo && typeof r.cabelo === "object" && !Array.isArray(r.cabelo) ? r.cabelo : {}) as Record<string, unknown>;
  const ficha: FichaDaPersona = {
    idade_aparente: idade,
    genero_apresentado: limpo(r.genero_apresentado ?? r.genero, 60),
    tom_de_pele: limpo(r.tom_de_pele, 120),
    rosto: limpo(r.rosto, 200),
    olhos: limpo(r.olhos, 160),
    sobrancelhas: limpo(r.sobrancelhas, 120),
    nariz: limpo(r.nariz, 120),
    labios: limpo(r.labios, 120),
    cabelo: {
      cor: limpo(c.cor ?? (typeof r.cabelo === "string" ? r.cabelo : ""), 80),
      comprimento: limpo(c.comprimento, 80),
      textura: limpo(c.textura, 80),
    },
    marcas: listaDeTextos(r.marcas, 8, 120),
    corpo: limpo(r.corpo, 200),
    altura: limpo(r.altura, 40),
    estilo: limpo(r.estilo, 300),
    notas: limpo(r.notas ?? descricao, 800),
  };
  garantirPermitido(ficha);
  return ficha;
}

/** Invariantes da persona: os traços da ficha em frases curtas mais as que a equipe escreveu. */
export function invariantesDaFicha(f: FichaDaPersona, extras: unknown = []): string[] {
  const lista = [
    `adulta, idade aparente de ${f.idade_aparente} anos`,
    f.genero_apresentado ? `gênero aparente: ${f.genero_apresentado}` : "",
    f.tom_de_pele ? `tom de pele: ${f.tom_de_pele}` : "",
    f.rosto ? `formato do rosto: ${f.rosto}` : "",
    f.olhos ? `olhos: ${f.olhos}` : "",
    f.sobrancelhas ? `sobrancelhas: ${f.sobrancelhas}` : "",
    f.nariz ? `nariz: ${f.nariz}` : "",
    f.labios ? `lábios: ${f.labios}` : "",
    [f.cabelo.cor, f.cabelo.comprimento, f.cabelo.textura].some(Boolean) ? `cabelo: ${[f.cabelo.cor, f.cabelo.comprimento, f.cabelo.textura].filter(Boolean).join(", ")}` : "",
    f.marcas.length ? `marcas: ${f.marcas.join(", ")}` : "",
    f.corpo ? `corpo: ${f.corpo}` : "",
  ].filter(Boolean);
  const daEquipe = listaDeTextos(extras, 12, 200);
  garantirPermitido(...daEquipe);
  return Array.from(new Set([...lista, ...daEquipe])).slice(0, 24);
}

/** Ficha em uma frase para o prompt (sempre com "adulta de N anos"). */
export function fichaEmTexto(f: FichaDaPersona): string {
  const partes = [
    `Pessoa adulta de ${f.idade_aparente} anos de idade aparente`,
    f.genero_apresentado ? `gênero aparente ${f.genero_apresentado}` : "",
    f.tom_de_pele ? `pele ${f.tom_de_pele}` : "",
    f.rosto ? `rosto ${f.rosto}` : "",
    f.olhos ? `olhos ${f.olhos}` : "",
    f.sobrancelhas ? `sobrancelhas ${f.sobrancelhas}` : "",
    f.nariz ? `nariz ${f.nariz}` : "",
    f.labios ? `lábios ${f.labios}` : "",
    [f.cabelo.cor, f.cabelo.comprimento, f.cabelo.textura].some(Boolean) ? `cabelo ${[f.cabelo.cor, f.cabelo.comprimento, f.cabelo.textura].filter(Boolean).join(", ")}` : "",
    f.marcas.length ? `marcas naturais: ${f.marcas.join(", ")}` : "",
    f.corpo ? `corpo ${f.corpo}` : "",
    f.altura ? `altura ${f.altura}` : "",
    f.estilo ? `estilo ${f.estilo}` : "",
  ].filter(Boolean);
  return `${partes.join("; ")}.`;
}

// ------------------------------------------------------------------ hiper-realismo

/** Palavras que puxam o visual de estúdio polido: nunca entram no prompt. */
export const PALAVRAS_QUE_PLASTIFICAM = ["perfeito", "perfeita", "impecável", "flawless", "8k", "ultra detalhado", "obra-prima", "masterpiece"];

/** Pele, luz, lente e grão (seção 5.2): fotografia real, sem retoque de beleza. */
export const BLOCO_HIPER_REALISMO = [
  "PELE E MICRODETALHE: poros visíveis nas bochechas, no nariz e na testa; penugem fina contra a luz; leve variação de tom (um pouco de vermelhidão no nariz e nas bochechas, olheira suave); pequenas assimetrias naturais do rosto; linhas naturais nos lábios e nos cantos dos olhos; fios soltos no cabelo; textura real do tecido da roupa.",
  "LUZ: fonte real com direção (luz de janela lateral, sombra suave sob o queixo e ao lado do nariz), reflexo pequeno e natural nos olhos, balanço de branco coerente com a fonte.",
  "LENTE: retrato com 85 mm em f/2, fundo desfocado natural, foco no olho mais próximo, câmera na altura dos olhos; cor natural e grão fino de filme.",
  "PROIBIDO: filtro de beleza, pele de porcelana ou de plástico, pele lisa sem poros, HDR, nitidez exagerada, simetria de manequim, maquiagem pesada (salvo pedido da ficha), olhar vidrado, dentes brancos demais, texto, marca d'água, logotipo.",
];

export const PROIBICOES_DA_PERSONA = [
  "a pessoa é sintética e não existe: nunca parecida com pessoa real conhecida (celebridade, influenciador, político, atleta)",
  `pessoa adulta, com idade aparente de pelo menos ${IDADE_MINIMA_MODELO} anos, sem traço infantil`,
  "sem sexualização, sem nudez e sem roupa reveladora",
  "mãos com cinco dedos, unhas e articulações corretas",
  "não copiar rosto, corpo, tatuagem nem identidade de pessoas das imagens de referência",
];

const LEGENDA_DO_USO: Record<UsoDeReferencia, string> = {
  estilo: "SÓ ESTILO (paleta, clima, figurino de referência)",
  pose: "SÓ POSE (postura e gesto)",
  luz: "SÓ LUZ (direção, dureza e cor da luz)",
  roupa: "SÓ ROUPA (peças e tecidos)",
};

/** Linhas das referências do dono: sempre só uso declarado, nunca identidade. */
export function legendasDasReferencias(usos: UsoDeReferencia[], inicio = 1): string[] {
  return usos.map((u, i) => `Imagem ${inicio + i}: ${LEGENDA_DO_USO[u]}. Não é a identidade da persona: não copie rosto, corpo, cabelo, tatuagem nem a pessoa desta imagem.`);
}

const FORMATO_DA_PERSONA = "retrato vertical 4:5";

/**
 * Prompt da candidata (persona do zero): foto real, a ficha inteira, as
 * invariantes, o bloco de hiper-realismo e as referências só como estilo.
 */
export function promptDaCandidata(e: { nome: string; ficha: FichaDaPersona; invariantes: string[]; usos: UsoDeReferencia[]; pedido?: string | null }): string {
  const linhas: string[] = [];
  linhas.push("FOTOGRAFIA REAL de uma pessoa sintética (gerada, não existe), retrato editorial para Instagram, sem retoque de beleza.");
  linhas.push(`PERSONA "${e.nome}": ${fichaEmTexto(e.ficha)}`);
  linhas.push(`INVARIANTES DA PERSONA (repetir exatamente): ${e.invariantes.join("; ")}.`);
  if (e.ficha.notas) linhas.push(`NOTAS DA FICHA: ${e.ficha.notas}`);
  linhas.push(`ENQUADRAMENTO: ${FORMATO_DA_PERSONA}, meio corpo, olhando para a câmera, expressão serena e natural, fundo neutro liso claro, luz natural suave.`);
  if (e.usos.length) linhas.push("IMAGENS ANEXADAS, NA ORDEM:", ...legendasDasReferencias(e.usos));
  if (e.pedido) linhas.push(`PEDIDO DA EQUIPE: ${e.pedido}`);
  linhas.push(...BLOCO_HIPER_REALISMO);
  linhas.push(`REGRAS: ${PROIBICOES_DA_PERSONA.join("; ")}.`);
  return semTravessao(linhas.join("\n"));
}

/**
 * Prompt de uma vista da folha: a âncora (e as vistas já aprovadas) como
 * identidade da mesma pessoa, a ficha repetida e a vista pedida.
 */
export function promptDaVista(e: { nome: string; ficha: FichaDaPersona; invariantes: string[]; vista: VistaDaPersona; identidades: string[] }): string {
  const linhas: string[] = [];
  linhas.push(`FOTOGRAFIA REAL da MESMA pessoa sintética "${e.nome}" das imagens anexadas (gerada, não existe), sem retoque de beleza.`);
  linhas.push("IMAGENS ANEXADAS, NA ORDEM:");
  e.identidades.forEach((legenda, i) => linhas.push(`Imagem ${i + 1}: ${legenda}. IDENTIDADE da persona: mesmo rosto, formato do rosto, olhos, nariz, lábios, tom de pele, marcas e cabelo; não mude a pessoa.`));
  linhas.push(`FICHA: ${fichaEmTexto(e.ficha)}`);
  linhas.push(`INVARIANTES DA PERSONA (repetir exatamente): ${e.invariantes.join("; ")}.`);
  linhas.push(`VISTA PEDIDA: ${DESCRICAO_DA_VISTA[e.vista]}. Mesmo fundo neutro liso claro e mesma luz natural suave da âncora, para a folha ficar coerente.`);
  linhas.push(...BLOCO_HIPER_REALISMO);
  linhas.push(`REGRAS: ${PROIBICOES_DA_PERSONA.join("; ")}.`);
  return semTravessao(linhas.join("\n"));
}

/**
 * "Detalhar em 4K": geração nova (não é ampliação fiel), a partir da imagem
 * aprovada como primeira referência. Mesma foto, mesma composição, mais
 * microdetalhe natural; nada muda de lugar.
 */
export function promptDoDetalhe(e: { alvo: AlvoDoDetalhe; nome?: string | null; ficha?: FichaDaPersona | null; invariantes?: string[]; comIdentidade: number }): string {
  const linhas: string[] = [];
  linhas.push("RE-RENDERIZAÇÃO EM ALTA RESOLUÇÃO da Imagem 1: a MESMA fotografia, mesma composição, mesmo enquadramento, mesma pose, mesma luz, mesmas cores e mesmo fundo. Não acrescente nem remova nada.");
  if (e.comIdentidade > 0) {
    linhas.push(`Imagens 2 a ${e.comIdentidade + 1}: a mesma pessoa sintética${e.nome ? ` "${e.nome}"` : ""} (identidade): mantenha rosto, formato do rosto, olhos, nariz, lábios, tom de pele, marcas e cabelo exatamente iguais.`);
  }
  if (e.alvo === "pessoa") {
    if (e.ficha) linhas.push(`FICHA: ${fichaEmTexto(e.ficha)}`);
    if (e.invariantes?.length) linhas.push(`INVARIANTES DA PERSONA: ${e.invariantes.join("; ")}.`);
    linhas.push(BLOCO_HIPER_REALISMO[0]);
    linhas.push("Nitidez natural de fotografia (sem contorno artificial), grão fino de filme, cor natural.");
    linhas.push(`REGRAS: ${PROIBICOES_DA_PERSONA.join("; ")}.`);
  } else {
    linhas.push("PRODUTO: mais definição de material, textura, costura, acabamento e bordas; texto e logotipo do produto exatamente como estão, letra por letra; mesmas proporções e cor.");
    linhas.push("Nitidez natural de fotografia de produto (sem contorno artificial), sem HDR, sem mudar a luz.");
  }
  return semTravessao(linhas.join("\n"));
}

// ------------------------------------------------------------------ folha e status

export type ImagemDaPersonaResumo = { id: string; papel: string; vista: string | null; aprovada: boolean | null; motor_id?: string | null; criado_em?: string };

/** Vistas mais parecidas com a pedida primeiro (ângulo do rosto, depois distância da câmera). */
export function ordenarPorProximidade<T extends { vista: string | null }>(pedida: VistaDaPersona, imagens: T[]): T[] {
  const g = GEOMETRIA[pedida];
  const dist = (v: string | null) => {
    const x = lerVista(v);
    if (!x) return 999;
    const h = GEOMETRIA[x];
    return Math.abs(h.angulo - g.angulo) / 45 + Math.abs(h.distancia - g.distancia) * 1.5;
  };
  return [...imagens].sort((a, b) => dist(a.vista) - dist(b.vista));
}

/**
 * Identidades que vão ao gerador numa vista: a âncora primeiro, depois as
 * vistas APROVADAS mais perto da pedida, até o limite (e até 4 no total).
 */
export function identidadesDaVista<T extends ImagemDaPersonaResumo>(ancora: T, imagens: T[], vista: VistaDaPersona, limite: number): T[] {
  const aprovadas = imagens.filter((i) => i.id !== ancora.id && i.papel === "vista" && i.aprovada === true);
  const max = Math.max(1, Math.min(4, Math.floor(limite)));
  return [ancora, ...ordenarPorProximidade(vista, aprovadas)].slice(0, max);
}

export function resumoDaFolha(imagens: ImagemDaPersonaResumo[]) {
  const vistas = FOLHA_PADRAO.map((v) => {
    const dela = imagens.filter((i) => i.papel === "vista" && i.vista === v);
    const aprovada = dela.find((i) => i.aprovada === true) ?? null;
    return { vista: v, descricao: DESCRICAO_DA_VISTA[v], geradas: dela.length, aprovada_id: aprovada?.id ?? null };
  });
  const aprovadas = imagens.filter((i) => i.papel === "vista" && i.aprovada === true).length;
  return { vistas, aprovadas, total: FOLHA_PADRAO.length, minimo_para_pronta: VISTAS_PARA_PRONTA, pronta: aprovadas >= VISTAS_PARA_PRONTA };
}

/** Status pelo que existe (a arquivada fica arquivada). */
export function statusDaPersona(p: { status: string; ancora_imagem_id: string | null }, imagens: ImagemDaPersonaResumo[]): StatusDaPersona {
  if (p.status === "arquivada") return "arquivada";
  if (!p.ancora_imagem_id) return imagens.some((i) => i.papel === "candidata") ? "candidatos" : "rascunho";
  const vistas = imagens.filter((i) => i.papel === "vista");
  if (vistas.filter((i) => i.aprovada === true).length >= VISTAS_PARA_PRONTA) return "pronta";
  return vistas.length ? "folha" : "ancora";
}

/** Persona que pode entrar no Canvas (pessoa com âncora); folha incompleta vira aviso. */
export function personaUsavel(status: string): { ok: boolean; aviso: string | null } {
  if (status === "pronta") return { ok: true, aviso: null };
  if (status === "ancora" || status === "folha") return { ok: true, aviso: "Folha da persona incompleta: a identidade vem só da âncora e pode variar mais." };
  return { ok: false, aviso: null };
}

// ------------------------------------------------------------------ conferência

export type LeituraDaPersona = {
  pele: string;
  olhos: string;
  maos: string;
  cabelo: string;
  dentes: string;
  luz: string;
  fundo: string;
  artefatos: string[];
  idade_aparente_estimada: number | null;
  lembra_alguem: string;
  consistencia_com_ancora: string | null;
  resumo: string;
};

export function normalizarLeituraDaPersona(bruto: unknown): LeituraDaPersona {
  const r = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
  const idade = Number(r.idade_aparente_estimada);
  return {
    pele: limpo(r.pele, 400),
    olhos: limpo(r.olhos, 300),
    maos: limpo(r.maos, 300),
    cabelo: limpo(r.cabelo, 300),
    dentes: limpo(r.dentes, 200),
    luz: limpo(r.luz, 300),
    fundo: limpo(r.fundo, 200),
    artefatos: listaDeTextos(r.artefatos, 10, 200),
    idade_aparente_estimada: Number.isFinite(idade) && idade > 0 ? Math.round(idade) : null,
    lembra_alguem: limpo(r.lembra_alguem, 300),
    consistencia_com_ancora: typeof r.consistencia_com_ancora === "string" ? limpo(r.consistencia_com_ancora, 400) || null : null,
    resumo: limpo(r.resumo, 600),
  };
}

/** Níveis do Score de pele (do pior para o melhor), descrições que se sustentam sozinhas. */
export const NIVEIS_PELE = [
  "Pele claramente artificial: lisa como plástico ou porcelana, sem poros, brilho uniforme, aspecto de boneco ou de 3D",
  "Pele retocada demais: quase sem poros, textura muito suavizada, aparência de filtro de beleza",
  "Pele natural com alguma suavização: poros e variação de tom aparecem, mas pouco",
  "Pele fotográfica: poros, penugem, variação de tom e pequenas imperfeições visíveis, como numa foto real sem retoque",
];

export const NIVEIS_ANATOMIA = [
  "Erro grave de anatomia: dedos a mais ou a menos, olhos desalinhados, membro deformado ou rosto distorcido",
  "Erro pequeno perceptível: mão estranha, dentes irregulares demais, orelha ou pescoço esquisitos",
  "Anatomia correta: mãos, olhos, dentes e proporções de uma pessoa real",
];

export const NIVEIS_LUZ = [
  "Luz incoerente: sombras em direções diferentes, pessoa recortada do fundo, reflexo impossível",
  "Luz aceitável com alguma incoerência pequena entre pessoa e fundo",
  "Luz coerente: uma direção clara, sombras e reflexos que batem com a fonte",
];

export type NotasDoJev = {
  realismo_pele: number | null;
  anatomia: number | null;
  luz: number | null;
  lembra_pessoa_publica: number | null;
  identidade_diferente: number | null;
};

/**
 * Aviso composto (padrão composite scoring): cada nota do Jev vira um sinal e
 * o código decide os alertas. Só aviso: ninguém escolhe nem refaz sozinho.
 */
export function alertasDoRealismo(n: NotasDoJev, leitura?: Pick<LeituraDaPersona, "idade_aparente_estimada"> | null): { alertas: string[]; nota_realismo: number | null } {
  const alertas: string[] = [];
  if (n.realismo_pele != null && n.realismo_pele < 1.5) alertas.push("Pele com cara de plástico ou retoque pesado.");
  if (n.anatomia != null && n.anatomia < 1.2) alertas.push("Possível erro de anatomia (mãos, olhos ou dentes).");
  if (n.luz != null && n.luz < 1) alertas.push("Luz incoerente entre a pessoa e o fundo.");
  if (n.lembra_pessoa_publica != null && n.lembra_pessoa_publica >= 0.5) alertas.push("Pode lembrar uma pessoa pública conhecida: confira antes de usar.");
  if (n.identidade_diferente != null && n.identidade_diferente >= 0.5) alertas.push("O rosto parece de outra pessoa em relação à âncora.");
  if (leitura?.idade_aparente_estimada != null && leitura.idade_aparente_estimada < IDADE_MINIMA_MODELO) {
    alertas.push(`A leitura estimou idade aparente abaixo de ${IDADE_MINIMA_MODELO} anos: não use esta imagem.`);
  }
  // Nota de 0 a 1: pele pesa 0,5, anatomia 0,3 e luz 0,2 (cada uma na escala do seu Score).
  const partes: [number | null, number, number][] = [[n.realismo_pele, 3, 0.5], [n.anatomia, 2, 0.3], [n.luz, 2, 0.2]];
  const validas = partes.filter(([v]) => v != null) as [number, number, number][];
  const peso = validas.reduce((s, [, , p]) => s + p, 0);
  const nota = peso ? Math.round((validas.reduce((s, [v, max, p]) => s + (v / max) * p, 0) / peso) * 1000) / 1000 : null;
  return { alertas, nota_realismo: nota };
}

// ------------------------------------------------------------------ entrada

/** Ids de UUID únicos e válidos de uma lista. */
export const idsValidos = (v: unknown, max = 12): string[] =>
  Array.isArray(v) ? Array.from(new Set(v.map((x) => String(x ?? "").trim()).filter((x) => UUID.test(x)))).slice(0, max) : [];

/** Semente vinda da tela: inteiro não negativo ou null. */
export function lerSemente(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 && n <= 2_147_483_647 ? n : null;
}
