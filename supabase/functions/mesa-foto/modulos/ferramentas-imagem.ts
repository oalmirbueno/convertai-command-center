/**
 * Ferramentas profissionais de imagem (pedido do dono, 26/09): AMPLIAR
 * (upscale) e TIRAR FUNDO por API externa, para o Estúdio e a Mesa Foto.
 * Pesquisa, preços e fontes em docs/ferramentas-imagem/PESQUISA.md.
 *
 * Por que API externa: a função de borda tem 2 s de CPU por chamada e cai
 * com 504 se não responder em 150 s; modelos de upscale e de recorte (Topaz,
 * BiRefNet, BRIA RMBG 2.0) precisam de GPU. Aqui só há rede: enviar para a
 * fila do provedor, consultar o andamento, baixar o resultado e conferir.
 *
 * Provedor-agnóstico: cada motor diz de qual provedor é, o id do modelo lá,
 * como montar a entrada, o preço e os limites. Hoje há um provedor (fal.ai,
 * que tem os dois tipos de modelo numa conta só); outro entra acrescentando
 * um bloco em PROVEDORES e os motores dele.
 *
 * Este arquivo não importa nada de Deno nem de npm (roda também nos testes
 * do Vitest). Banco, carteira e armazenamento entram por injeção: quem usa
 * (mesa-foto/ferramentas-pro.ts) passa o registro de uso do motor de IA
 * (_shared/ia-motor.ts registrarUso), o armazenamento e o acervo.
 *
 * A chave: só do ambiente do servidor (segredo FAL_KEY no Supabase). Nunca
 * vai para log, resposta, ficha ou mensagem de erro.
 */

// ------------------------------------------------------------------ tipos

export type TarefaDaFerramenta = "upscale" | "remover_fundo";
export type ModoDoUpscale = "fiel" | "criativo";
export type ConteudoDaImagem = "foto" | "texto" | "arte";
export type IdDoProvedor = "fal";
export type IdDoMotor = "topaz" | "seedvr" | "clarity" | "bria" | "birefnet";
export type MimeDaSaida = "image/png" | "image/jpeg" | "image/webp";

export type PrecoDoMotor =
  | { tipo: "por_imagem"; usd: number }
  | { tipo: "faixas_mp"; faixas: { ate_mp: number; usd: number }[] }
  | { tipo: "por_mp"; usd: number; minimo_usd: number }
  | { tipo: "por_segundo"; usd: number; segundos_estimados: number };

export type MotorDaFerramenta = {
  id: IdDoMotor;
  tarefa: TarefaDaFerramenta;
  /** Só upscale: fiel (não inventa detalhe) ou criativo (reconstrói com IA). */
  modo: ModoDoUpscale | null;
  provedor: IdDoProvedor;
  modelo_api: string;
  rotulo: string;
  preco: PrecoDoMotor;
  /** Lado maior da imagem de entrada. */
  max_lado_entrada: number;
  /** Megapixels máximos da entrada (tirar fundo) ou da saída (upscale). */
  max_mp: number;
  fonte_preco: string;
};

export type Dimensoes = { largura: number; altura: number };

export type PlanoDaFerramenta = {
  tarefa: TarefaDaFerramenta;
  motor: MotorDaFerramenta;
  entrada: Dimensoes;
  saida: Dimensoes;
  /** Upscale: fator pedido (2 ou 4) e o fator que cabe nos limites. */
  fator: number | null;
  fator_efetivo: number | null;
  modo: ModoDoUpscale | null;
  conteudo: ConteudoDaImagem;
  formato_saida: "png" | "jpeg";
  estimativa_usd: number;
  avisos: string[];
};

// ------------------------------------------------------------------ erro

export class FerramentaImagemErro extends Error {
  codigo: string;
  status: number;
  extra: Record<string, unknown>;
  constructor(status: number, codigo: string, mensagem: string, extra: Record<string, unknown> = {}) {
    super(mensagem);
    this.name = "FerramentaImagemErro";
    this.status = status;
    this.codigo = codigo;
    this.extra = extra;
  }
}

// ------------------------------------------------------------------ catálogo

export const PROVEDORES: Record<IdDoProvedor, { rotulo: string; segredo: string; fila: string; painel: string }> = {
  fal: {
    rotulo: "fal.ai",
    /** Nome do segredo no Supabase (Edge Functions > Secrets). */
    segredo: "FAL_KEY",
    fila: "https://queue.fal.run",
    painel: "https://fal.ai/dashboard/keys",
  },
};

/** Preços conferidos em 25/09/2026 nas páginas dos modelos (docs/ferramentas-imagem/PESQUISA.md). */
export const MOTORES: Record<IdDoMotor, MotorDaFerramenta> = {
  topaz: {
    id: "topaz",
    tarefa: "upscale",
    modo: "fiel",
    provedor: "fal",
    modelo_api: "fal-ai/topaz/upscale/image",
    rotulo: "Topaz (fiel)",
    preco: {
      tipo: "faixas_mp",
      faixas: [
        { ate_mp: 24, usd: 0.08 },
        { ate_mp: 48, usd: 0.16 },
        { ate_mp: 96, usd: 0.32 },
        { ate_mp: 512, usd: 1.36 },
      ],
    },
    max_lado_entrada: 8192,
    max_mp: 40,
    fonte_preco: "https://fal.ai/models/fal-ai/topaz/upscale/image",
  },
  seedvr: {
    id: "seedvr",
    tarefa: "upscale",
    modo: "fiel",
    provedor: "fal",
    modelo_api: "fal-ai/seedvr/upscale/image",
    rotulo: "SeedVR2 (fiel, econômico)",
    // A página não diz se o megapixel é da entrada ou da saída: cobra pela saída (lado seguro).
    preco: { tipo: "por_mp", usd: 0.001, minimo_usd: 0.001 },
    max_lado_entrada: 4096,
    max_mp: 24,
    fonte_preco: "https://fal.ai/models/fal-ai/seedvr/upscale/image",
  },
  clarity: {
    id: "clarity",
    tarefa: "upscale",
    modo: "criativo",
    provedor: "fal",
    modelo_api: "fal-ai/clarity-upscaler",
    rotulo: "Clarity (criativo)",
    preco: { tipo: "por_mp", usd: 0.03, minimo_usd: 0.03 },
    max_lado_entrada: 4096,
    max_mp: 16,
    fonte_preco: "https://fal.ai/models/fal-ai/clarity-upscaler",
  },
  bria: {
    id: "bria",
    tarefa: "remover_fundo",
    modo: null,
    provedor: "fal",
    modelo_api: "fal-ai/bria/background/remove",
    rotulo: "BRIA RMBG 2.0",
    preco: { tipo: "por_imagem", usd: 0.018 },
    max_lado_entrada: 6000,
    max_mp: 25,
    fonte_preco: "https://fal.ai/models/fal-ai/bria/background/remove",
  },
  birefnet: {
    id: "birefnet",
    tarefa: "remover_fundo",
    modo: null,
    provedor: "fal",
    modelo_api: "fal-ai/birefnet/v2",
    rotulo: "BiRefNet v2 (Heavy 2K)",
    // US$ 0,0008 por segundo de GPU; 15 s é folga (costuma levar de 2 a 6 s).
    preco: { tipo: "por_segundo", usd: 0.0008, segundos_estimados: 15 },
    max_lado_entrada: 6000,
    max_mp: 25,
    fonte_preco: "https://fal.ai/models/fal-ai/birefnet/v2",
  },
};

/** Motor padrão de cada tarefa. */
export const MOTOR_PADRAO = {
  upscale_fiel: "topaz",
  upscale_criativo: "clarity",
  remover_fundo: "bria",
} as const satisfies Record<string, IdDoMotor>;

export const FATORES = [2, 4] as const;
/** Lado maior da saída do upscale (acima disso a foto não abre bem no navegador nem cabe no armazenamento). */
export const MAX_LADO_SAIDA = 8192;
/** Saída em PNG pesa muito mais que JPEG: teto menor. */
export const MAX_MP_SAIDA_PNG = 24;
/** Menos que isto de ampliação real não vale a chamada. */
export const FATOR_MINIMO_UTIL = 1.2;
export const MIN_LADO_ENTRADA = 64;
export const MAX_BYTES_ENTRADA = 30 * 1024 * 1024;
export const MAX_BYTES_SAIDA = 45 * 1024 * 1024;
/** Tempo de espera dentro de UMA chamada (a resposta com fôlego segura a conexão; o relógio da função é 400 s). */
export const PRAZO_DE_ESPERA_MS = 200_000;
/** Ficha para retomar um pedido que passou do prazo: vale 24 h (o provedor guarda o resultado por esse tempo). */
export const VALIDADE_DA_FICHA_MS = 24 * 60 * 60 * 1000;
/** O provedor apaga as imagens (entrada e saída) depois de 1 dia. */
export const RETENCAO_NO_PROVEDOR_S = 86_400;

const arred = (v: number) => Math.round(v * 1e6) / 1e6;
const mp = (d: Dimensoes) => (d.largura * d.altura) / 1e6;

// ------------------------------------------------------------------ chave

type Ambiente = { get(nome: string): string | undefined };

function ambientePadrao(): Ambiente {
  const deno = (globalThis as { Deno?: { env?: Ambiente } }).Deno;
  return deno?.env ?? { get: () => undefined };
}

/** Chave está configurada? (sem devolver a chave) */
export function ferramentasConfiguradas(provedor: IdDoProvedor = "fal", env: Ambiente = ambientePadrao()): boolean {
  return !!env.get(PROVEDORES[provedor].segredo)?.trim();
}

/** Lê a chave do ambiente. Sem ela: erro claro com o nome do segredo (nunca o valor). */
export function chaveDoProvedor(provedor: IdDoProvedor, env: Ambiente = ambientePadrao()): string {
  const p = PROVEDORES[provedor];
  const chave = env.get(p.segredo)?.trim();
  if (!chave) {
    throw new FerramentaImagemErro(
      503,
      "ferramenta_sem_chave",
      `Ampliar e Tirar fundo (pro) ainda não estão ligados: configure ${p.segredo} nos segredos das funções do Supabase (conta em ${p.rotulo}).`,
      { segredo: p.segredo, provedor },
    );
  }
  return chave;
}

// ------------------------------------------------------------------ pedido

const texto = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export type PedidoDeUpscale = { fator: 2 | 4; modo: ModoDoUpscale; motor: IdDoMotor; conteudo: ConteudoDaImagem; refazer: boolean };
export type PedidoDeFundo = { motor: IdDoMotor; refazer: boolean };

export function lerPedidoDeUpscale(corpo: Record<string, unknown>): PedidoDeUpscale {
  const fator = Number(corpo.fator ?? 2);
  if (fator !== 2 && fator !== 4) throw new FerramentaImagemErro(400, "fator_invalido", "O fator de ampliação é 2 ou 4.");
  const modo = texto(corpo.modo) || "fiel";
  if (modo !== "fiel" && modo !== "criativo") throw new FerramentaImagemErro(400, "modo_invalido", "O modo é 'fiel' ou 'criativo'.");
  const padrao = modo === "fiel" ? MOTOR_PADRAO.upscale_fiel : MOTOR_PADRAO.upscale_criativo;
  const motor = (texto(corpo.motor) || padrao) as IdDoMotor;
  const m = MOTORES[motor];
  if (!m || m.tarefa !== "upscale" || m.modo !== modo) {
    throw new FerramentaImagemErro(400, "motor_invalido", `Motor de ampliação ${modo} inválido.`, {
      aceitos: Object.values(MOTORES).filter((x) => x.tarefa === "upscale" && x.modo === modo).map((x) => x.id),
    });
  }
  const conteudo = (texto(corpo.conteudo) || "foto") as ConteudoDaImagem;
  if (conteudo !== "foto" && conteudo !== "texto" && conteudo !== "arte") {
    throw new FerramentaImagemErro(400, "conteudo_invalido", "O conteúdo é 'foto', 'texto' ou 'arte'.");
  }
  return { fator, modo, motor, conteudo, refazer: corpo.refazer === true };
}

export function lerPedidoDeFundo(corpo: Record<string, unknown>): PedidoDeFundo {
  const motor = (texto(corpo.motor) || MOTOR_PADRAO.remover_fundo) as IdDoMotor;
  const m = MOTORES[motor];
  if (!m || m.tarefa !== "remover_fundo") {
    throw new FerramentaImagemErro(400, "motor_invalido", "Motor de tirar fundo inválido.", {
      aceitos: Object.values(MOTORES).filter((x) => x.tarefa === "remover_fundo").map((x) => x.id),
    });
  }
  return { motor, refazer: corpo.refazer === true };
}

// ------------------------------------------------------------------ custo

/** Custo pela tabela do motor para uma saída (upscale) ou entrada (tirar fundo) deste tamanho. */
export function custoDoMotor(motor: MotorDaFerramenta, d: Dimensoes, segundos?: number | null): number {
  const p = motor.preco;
  if (p.tipo === "por_imagem") return arred(p.usd);
  if (p.tipo === "por_mp") return arred(Math.max(p.minimo_usd, mp(d) * p.usd));
  if (p.tipo === "por_segundo") {
    const s = typeof segundos === "number" && Number.isFinite(segundos) && segundos > 0 ? segundos : p.segundos_estimados;
    return arred(s * p.usd);
  }
  const m = mp(d);
  const faixa = p.faixas.find((f) => m <= f.ate_mp) ?? p.faixas[p.faixas.length - 1];
  return arred(faixa.usd);
}

// ------------------------------------------------------------------ plano

function validarEntrada(motor: MotorDaFerramenta, e: Dimensoes) {
  if (!Number.isFinite(e.largura) || !Number.isFinite(e.altura) || e.largura <= 0 || e.altura <= 0) {
    throw new FerramentaImagemErro(422, "dimensoes_desconhecidas", "Não foi possível ler o tamanho desta imagem.");
  }
  if (Math.min(e.largura, e.altura) < MIN_LADO_ENTRADA) {
    throw new FerramentaImagemErro(422, "imagem_pequena_demais", `A imagem precisa ter pelo menos ${MIN_LADO_ENTRADA} px no lado menor.`);
  }
  if (Math.max(e.largura, e.altura) > motor.max_lado_entrada) {
    throw new FerramentaImagemErro(422, "imagem_grande_demais", `${motor.rotulo} aceita até ${motor.max_lado_entrada} px no lado maior; esta tem ${Math.max(e.largura, e.altura)} px.`);
  }
}

/**
 * Upscale: o fator pedido (2 ou 4) é reduzido para caber no lado máximo e
 * nos megapixels do motor (e do PNG). Abaixo de 1,2x vira erro: a imagem já
 * está grande e ampliar só gastaria.
 */
export function planoDoUpscale(pedido: PedidoDeUpscale, entrada: Dimensoes, mimeEntrada: string | null): PlanoDaFerramenta {
  const motor = MOTORES[pedido.motor];
  validarEntrada(motor, entrada);
  const formato_saida: "png" | "jpeg" = mimeEntrada === "image/png" ? "png" : "jpeg";
  const maxMp = formato_saida === "png" ? Math.min(motor.max_mp, MAX_MP_SAIDA_PNG) : motor.max_mp;
  const ladoMaior = Math.max(entrada.largura, entrada.altura);
  const limitePorLado = MAX_LADO_SAIDA / ladoMaior;
  const limitePorArea = Math.sqrt((maxMp * 1e6) / (entrada.largura * entrada.altura));
  const efetivo = Math.floor(Math.min(pedido.fator, limitePorLado, limitePorArea) * 100) / 100;
  if (efetivo < FATOR_MINIMO_UTIL) {
    throw new FerramentaImagemErro(422, "imagem_ja_grande", `Esta imagem já está grande (${entrada.largura} x ${entrada.altura}); ampliar passaria do limite de ${MAX_LADO_SAIDA} px ou ${maxMp} MP.`, {
      max_lado_saida: MAX_LADO_SAIDA,
      max_mp_saida: maxMp,
    });
  }
  const saida = { largura: Math.round(entrada.largura * efetivo), altura: Math.round(entrada.altura * efetivo) };
  const avisos: string[] = [];
  if (efetivo < pedido.fator) avisos.push(`Ampliação ajustada para ${efetivo.toString().replace(".", ",")}x para caber no limite de ${MAX_LADO_SAIDA} px ou ${maxMp} MP.`);
  if (pedido.modo === "criativo") avisos.push("Modo criativo: a IA reconstrói detalhes e pode mudar textura, rosto ou letras. Confira antes de usar.");
  return {
    tarefa: "upscale",
    motor,
    entrada,
    saida,
    fator: pedido.fator,
    fator_efetivo: efetivo,
    modo: pedido.modo,
    conteudo: pedido.conteudo,
    formato_saida,
    estimativa_usd: custoDoMotor(motor, saida),
    avisos,
  };
}

export function planoDoFundo(pedido: PedidoDeFundo, entrada: Dimensoes): PlanoDaFerramenta {
  const motor = MOTORES[pedido.motor];
  validarEntrada(motor, entrada);
  if (mp(entrada) > motor.max_mp) {
    throw new FerramentaImagemErro(422, "imagem_grande_demais", `Tirar fundo aceita até ${motor.max_mp} MP; esta tem ${mp(entrada).toFixed(1).replace(".", ",")} MP.`);
  }
  return {
    tarefa: "remover_fundo",
    motor,
    entrada,
    saida: { ...entrada },
    fator: null,
    fator_efetivo: null,
    modo: null,
    conteudo: "foto",
    formato_saida: "png",
    estimativa_usd: custoDoMotor(motor, entrada),
    avisos: [],
  };
}

/** Corpo que vai para o provedor (só parâmetros do modelo; a URL da imagem é assinada e expira). */
export function entradaDoProvedor(plano: PlanoDaFerramenta, imagemUrl: string): Record<string, unknown> {
  const m = plano.motor;
  switch (m.id) {
    case "topaz":
      return {
        image_url: imagemUrl,
        // Standard V2: foto e produto; Text Refine: letras e rótulos; CGI: arte e render.
        model: plano.conteudo === "texto" ? "Text Refine" : plano.conteudo === "arte" ? "CGI" : "Standard V2",
        upscale_factor: plano.fator_efetivo,
        output_format: plano.formato_saida,
        face_enhancement: plano.conteudo === "foto",
        // 0 = recupera o rosto sem inventar traços (fidelidade).
        face_enhancement_creativity: 0,
      };
    case "seedvr":
      return {
        image_url: imagemUrl,
        upscale_mode: "factor",
        upscale_factor: plano.fator_efetivo,
        output_format: plano.formato_saida === "png" ? "png" : "jpg",
      };
    case "clarity":
      return {
        image_url: imagemUrl,
        upscale_factor: plano.fator_efetivo,
        creativity: 0.35,
        resemblance: 0.6,
      };
    case "bria":
      return { image_url: imagemUrl };
    case "birefnet":
      return {
        image_url: imagemUrl,
        model: "General Use (Heavy)",
        operating_resolution: "2048x2048",
        output_format: "png",
        refine_foreground: true,
      };
  }
}

// ------------------------------------------------------------------ imagem (cabeçalho, sem decodificar)

export function mimeDaImagem(b: Uint8Array): MimeDaSaida | null {
  if (b.length < 16) return null;
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

/** Largura e altura pelo cabeçalho (PNG, JPEG e WebP). */
export function dimensoesDoCabecalho(b: Uint8Array): Dimensoes | null {
  const mime = mimeDaImagem(b);
  if (!mime) return null;
  const u16be = (i: number) => (b[i] << 8) | b[i + 1];
  const u32be = (i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  if (mime === "image/png") return b.length >= 24 ? { largura: u32be(16), altura: u32be(20) } : null;
  if (mime === "image/jpeg") {
    let i = 2;
    while (i + 9 < b.length) {
      if (b[i] !== 0xff) {
        i++;
        continue;
      }
      const marca = b[i + 1];
      if (marca === 0xd8 || marca === 0x01 || (marca >= 0xd0 && marca <= 0xd7)) {
        i += 2;
        continue;
      }
      const tamanho = u16be(i + 2);
      if (marca >= 0xc0 && marca <= 0xcf && marca !== 0xc4 && marca !== 0xc8 && marca !== 0xcc) {
        return { altura: u16be(i + 5), largura: u16be(i + 7) };
      }
      i += 2 + tamanho;
    }
    return null;
  }
  // WebP: VP8X, VP8L ou VP8.
  const tipo = String.fromCharCode(b[12], b[13], b[14], b[15]);
  if (tipo === "VP8X" && b.length >= 30) {
    return { largura: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), altura: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) };
  }
  if (tipo === "VP8L" && b.length >= 25) {
    const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
    return { largura: (v & 0x3fff) + 1, altura: ((v >> 14) & 0x3fff) + 1 };
  }
  if (tipo === "VP8 " && b.length >= 30) {
    return { largura: (b[26] | (b[27] << 8)) & 0x3fff, altura: (b[28] | (b[29] << 8)) & 0x3fff };
  }
  return null;
}

/** A imagem tem canal alfa? (PNG RGBA, cinza com alfa ou tRNS; WebP com a marca de alfa.) */
export function temCanalAlfa(b: Uint8Array): boolean {
  const mime = mimeDaImagem(b);
  if (mime === "image/png") {
    if (b.length < 26) return false;
    const tipoDeCor = b[25];
    if (tipoDeCor === 4 || tipoDeCor === 6) return true;
    // Paleta ou RGB com transparência: procura o bloco tRNS antes do IDAT.
    let i = 8;
    while (i + 8 <= b.length) {
      const tamanho = ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
      const nome = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
      if (nome === "tRNS") return true;
      if (nome === "IDAT" || nome === "IEND") return false;
      i += 12 + tamanho;
    }
    return false;
  }
  if (mime === "image/webp") {
    const tipo = String.fromCharCode(b[12], b[13], b[14], b[15]);
    if (tipo === "VP8X") return b.length > 20 && (b[20] & 0x10) !== 0;
    if (tipo === "VP8L") return true;
  }
  return false;
}

export type SaidaConferida = { mime: MimeDaSaida; largura: number; altura: number; bytes: number };

/**
 * Confere o que o provedor devolveu antes de gravar e cobrar: tipo pelo
 * conteúdo (não pelo nome), tamanho em bytes, dimensões e o que a tarefa
 * promete (upscale maior que a entrada; recorte com alfa e mesma proporção).
 */
export function conferirSaida(bytes: Uint8Array, plano: Pick<PlanoDaFerramenta, "tarefa" | "entrada">): SaidaConferida {
  if (bytes.byteLength > MAX_BYTES_SAIDA) {
    throw new FerramentaImagemErro(502, "resultado_grande_demais", "O resultado passou do tamanho máximo que a plataforma guarda.");
  }
  const mime = mimeDaImagem(bytes);
  if (!mime) throw new FerramentaImagemErro(502, "resultado_nao_e_imagem", "O provedor devolveu um arquivo que não é PNG, JPEG ou WebP.");
  const d = dimensoesDoCabecalho(bytes);
  if (!d || d.largura <= 0 || d.altura <= 0) throw new FerramentaImagemErro(502, "resultado_ilegivel", "Não foi possível ler o tamanho do resultado.");
  const e = plano.entrada;
  const proporcaoIgual = Math.abs(d.largura / d.altura - e.largura / e.altura) <= 0.02 * (e.largura / e.altura);
  if (plano.tarefa === "upscale") {
    if (Math.max(d.largura, d.altura) < Math.max(e.largura, e.altura) * 1.15) {
      throw new FerramentaImagemErro(502, "ampliacao_nao_aconteceu", "O provedor devolveu a imagem sem ampliar. Nada foi gravado.", { saida: d, entrada: e });
    }
    if (!proporcaoIgual) throw new FerramentaImagemErro(502, "resultado_deformado", "O resultado voltou com outra proporção. Nada foi gravado.", { saida: d, entrada: e });
  } else {
    if (!temCanalAlfa(bytes)) throw new FerramentaImagemErro(502, "recorte_sem_transparencia", "O recorte voltou sem transparência. Nada foi gravado.");
    if (!proporcaoIgual) throw new FerramentaImagemErro(502, "resultado_deformado", "O recorte voltou com outra proporção. Nada foi gravado.", { saida: d, entrada: e });
  }
  return { mime, largura: d.largura, altura: d.altura, bytes: bytes.byteLength };
}

// ------------------------------------------------------------------ fila do provedor

export type Rede = {
  fetch: typeof fetch;
  esperar: (ms: number) => Promise<void>;
  agora: () => number;
};

export const redePadrao = (): Rede => ({
  fetch: (...a: Parameters<typeof fetch>) => fetch(...a),
  esperar: (ms) => new Promise((r) => setTimeout(r, ms)),
  agora: () => Date.now(),
});

export type PedidoNaFila = { request_id: string; status_url: string; response_url: string };

const FILA_FAL = /^https:\/\/queue\.fal\.run\//;

function sinal(ms: number): AbortSignal | undefined {
  const A = (globalThis as { AbortSignal?: { timeout?: (ms: number) => AbortSignal } }).AbortSignal;
  return A && typeof A.timeout === "function" ? A.timeout(ms) : undefined;
}

/** Erro HTTP do provedor em código nosso (sem a chave e sem o corpo inteiro). */
export async function erroDoProvedor(res: Response, etapa: string): Promise<FerramentaImagemErro> {
  let detalhe = "";
  try {
    const t = await res.text();
    try {
      const j = JSON.parse(t);
      const d = j?.detail ?? j?.message ?? j?.error;
      detalhe = typeof d === "string" ? d : JSON.stringify(d ?? "");
    } catch {
      detalhe = t;
    }
  } catch { /* sem corpo */ }
  detalhe = detalhe.replace(/key\s+[A-Za-z0-9:_-]{8,}/gi, "key ***").slice(0, 300);
  const extra = { etapa, status_provedor: res.status, detalhe: detalhe || null };
  if (res.status === 401 || res.status === 403) {
    if (/balance|credit|locked|billing|exhausted/i.test(detalhe)) {
      return new FerramentaImagemErro(402, "provedor_sem_credito", "A conta da fal.ai está sem crédito. Recarregue em fal.ai/dashboard/billing.", extra);
    }
    return new FerramentaImagemErro(503, "ferramenta_chave_recusada", "A fal.ai recusou a chave (FAL_KEY). Confira o segredo no Supabase.", extra);
  }
  if (res.status === 402) return new FerramentaImagemErro(402, "provedor_sem_credito", "A conta da fal.ai está sem crédito. Recarregue em fal.ai/dashboard/billing.", extra);
  if (res.status === 422 || res.status === 400) return new FerramentaImagemErro(422, "provedor_recusou", "O provedor recusou esta imagem.", extra);
  if (res.status === 429) return new FerramentaImagemErro(503, "provedor_ocupado", "O provedor está ocupado. Tente de novo em instantes.", extra);
  return new FerramentaImagemErro(502, "provedor_erro", "O provedor de imagem falhou.", extra);
}

/** Envia para a fila da fal.ai. Não espera o resultado. */
export async function enviarParaFila(plano: PlanoDaFerramenta, imagemUrl: string, chave: string, rede: Rede): Promise<PedidoNaFila> {
  const p = PROVEDORES[plano.motor.provedor];
  let res: Response;
  try {
    res = await rede.fetch(`${p.fila}/${plano.motor.modelo_api}`, {
      method: "POST",
      headers: {
        Authorization: `Key ${chave}`,
        "Content-Type": "application/json",
        // Imagem do cliente não fica guardada no provedor além de 1 dia.
        "X-Fal-Object-Lifecycle-Preference": JSON.stringify({ expiration_duration_seconds: RETENCAO_NO_PROVEDOR_S }),
      },
      body: JSON.stringify(entradaDoProvedor(plano, imagemUrl)),
      signal: sinal(30_000),
    });
  } catch {
    throw new FerramentaImagemErro(502, "provedor_inalcancavel", "Não foi possível falar com o provedor de imagem.");
  }
  if (!res.ok) throw await erroDoProvedor(res, "enviar");
  const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const pedido = {
    request_id: texto(j?.request_id),
    status_url: texto(j?.status_url),
    response_url: texto(j?.response_url),
  };
  if (!pedido.request_id || !FILA_FAL.test(pedido.status_url) || !FILA_FAL.test(pedido.response_url)) {
    throw new FerramentaImagemErro(502, "provedor_resposta_invalida", "O provedor não devolveu o pedido na fila.");
  }
  return pedido;
}

export type Andamento =
  | { situacao: "pronto"; imagem_url: string; segundos: number | null }
  | { situacao: "na_fila" | "processando"; posicao: number | null };

/**
 * Consulta o pedido até ficar pronto ou até o prazo. Intervalo de 1,5 s nos
 * primeiros 20 s e de 3 s depois (cada consulta é rede, não CPU).
 */
export async function acompanharPedido(pedido: PedidoNaFila, chave: string, rede: Rede, prazoMs = PRAZO_DE_ESPERA_MS): Promise<Andamento> {
  if (!FILA_FAL.test(pedido.status_url) || !FILA_FAL.test(pedido.response_url)) {
    throw new FerramentaImagemErro(400, "pedido_invalido", "Pedido de fila inválido.");
  }
  const inicio = rede.agora();
  const cabecalho = { Authorization: `Key ${chave}` };
  let ultimo: Andamento = { situacao: "na_fila", posicao: null };
  for (;;) {
    let res: Response | null = null;
    try {
      res = await rede.fetch(pedido.status_url, { headers: cabecalho, signal: sinal(20_000) });
    } catch {
      res = null; // rede instável: tenta de novo até o prazo
    }
    if (res) {
      if (!res.ok && res.status !== 202) throw await erroDoProvedor(res, "consultar");
      const s = (await res.json().catch(() => null)) as Record<string, unknown> | null;
      const status = texto(s?.status);
      if (status === "COMPLETED") {
        const segundos = Number((s?.metrics as Record<string, unknown> | undefined)?.inference_time);
        const imagem_url = await urlDoResultado(pedido, chave, rede);
        return { situacao: "pronto", imagem_url, segundos: Number.isFinite(segundos) && segundos > 0 ? segundos : null };
      }
      const posicao = Number(s?.queue_position);
      ultimo = status === "IN_PROGRESS" ? { situacao: "processando", posicao: null } : { situacao: "na_fila", posicao: Number.isFinite(posicao) ? posicao : null };
    }
    const passou = rede.agora() - inicio;
    if (passou >= prazoMs) return ultimo;
    await rede.esperar(Math.min(passou < 20_000 ? 1_500 : 3_000, Math.max(0, prazoMs - passou)));
  }
}

async function urlDoResultado(pedido: PedidoNaFila, chave: string, rede: Rede): Promise<string> {
  let res: Response;
  try {
    res = await rede.fetch(pedido.response_url, { headers: { Authorization: `Key ${chave}` }, signal: sinal(30_000) });
  } catch {
    throw new FerramentaImagemErro(502, "provedor_inalcancavel", "Não foi possível ler o resultado no provedor.");
  }
  if (!res.ok) throw await erroDoProvedor(res, "resultado");
  const j = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  const img = (j?.image ?? (Array.isArray(j?.images) ? (j?.images as unknown[])[0] : null)) as Record<string, unknown> | null;
  const url = texto(img?.url);
  if (!url) throw new FerramentaImagemErro(502, "resultado_vazio", "O provedor terminou sem devolver imagem.");
  return url;
}

/** Só https (ou data: do modo síncrono) e nunca endereço interno. */
export function urlDeResultadoSegura(url: string): boolean {
  if (url.startsWith("data:image/")) return true;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".local") || h.endsWith(".internal")) return false;
  if (/^[0-9.]+$/.test(h) || h.indexOf(":") >= 0 || h.startsWith("[")) return false;
  return true;
}

/** Baixa o resultado com teto de bytes (lê em pedaços; não confia no Content-Length). */
export async function baixarResultado(url: string, rede: Rede, maxBytes = MAX_BYTES_SAIDA): Promise<Uint8Array> {
  if (!urlDeResultadoSegura(url)) throw new FerramentaImagemErro(502, "resultado_de_origem_invalida", "O provedor devolveu um endereço de resultado inválido.");
  if (url.startsWith("data:")) {
    const virgula = url.indexOf(",");
    const b64 = url.slice(virgula + 1);
    const bin = atob(b64);
    if (bin.length > maxBytes) throw new FerramentaImagemErro(502, "resultado_grande_demais", "O resultado passou do tamanho máximo.");
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  let res: Response;
  try {
    res = await rede.fetch(url, { signal: sinal(120_000) });
  } catch {
    throw new FerramentaImagemErro(502, "resultado_indisponivel", "Não foi possível baixar o resultado do provedor.");
  }
  if (!res.ok) throw new FerramentaImagemErro(502, "resultado_indisponivel", "Não foi possível baixar o resultado do provedor.", { status_provedor: res.status });
  const declarado = Number(res.headers.get("content-length"));
  if (Number.isFinite(declarado) && declarado > maxBytes) throw new FerramentaImagemErro(502, "resultado_grande_demais", "O resultado passou do tamanho máximo.");
  if (!res.body) {
    const b = new Uint8Array(await res.arrayBuffer());
    if (b.byteLength > maxBytes) throw new FerramentaImagemErro(502, "resultado_grande_demais", "O resultado passou do tamanho máximo.");
    return b;
  }
  const leitor = res.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await leitor.cancel().catch(() => {});
      throw new FerramentaImagemErro(502, "resultado_grande_demais", "O resultado passou do tamanho máximo.");
    }
    partes.push(value);
  }
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of partes) {
    out.set(p, pos);
    pos += p.byteLength;
  }
  return out;
}

// ------------------------------------------------------------------ ficha para retomar

/**
 * Pedido que passou do prazo de uma chamada volta como ficha assinada
 * (HMAC-SHA256 com um segredo do servidor). A tela chama ferramenta_retomar
 * com ela; o servidor confere a assinatura, o cliente e a validade, e só
 * então consulta o provedor. A ficha não carrega chave nenhuma.
 */
export type DadosDaFicha = {
  v: 1;
  tarefa: TarefaDaFerramenta;
  motor: IdDoMotor;
  client_id: string;
  imagem_id: string;
  fator: number | null;
  fator_efetivo: number | null;
  modo: ModoDoUpscale | null;
  conteudo: ConteudoDaImagem;
  formato_saida: "png" | "jpeg";
  entrada: Dimensoes;
  saida: Dimensoes;
  estimativa_usd: number;
  pedido: PedidoNaFila;
  criado_em: number;
};

const b64url = (b: Uint8Array) => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function deB64url(s: string): Uint8Array {
  const n = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(n + "===".slice((n.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(segredo: string, dados: string): Promise<string> {
  const cod = new TextEncoder();
  const k = await crypto.subtle.importKey("raw", cod.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", k, cod.encode(dados))));
}

export async function assinarFicha(d: DadosDaFicha, segredo: string): Promise<string> {
  if (!segredo) throw new FerramentaImagemErro(500, "ficha_sem_segredo", "O servidor não tem segredo para assinar a ficha.");
  const corpo = b64url(new TextEncoder().encode(JSON.stringify(d)));
  return `${corpo}.${await hmac(segredo, corpo)}`;
}

export async function lerFicha(ficha: unknown, segredo: string, agora = Date.now()): Promise<DadosDaFicha> {
  const s = typeof ficha === "string" ? ficha.trim() : "";
  const partes = s.split(".");
  if (partes.length !== 2 || !partes[0] || !partes[1] || !segredo) throw new FerramentaImagemErro(400, "ficha_invalida", "Ficha do pedido inválida.");
  const esperada = await hmac(segredo, partes[0]);
  // Comparação em tempo constante (não para no primeiro caractere diferente).
  let diferenca = esperada.length ^ partes[1].length;
  for (let i = 0; i < esperada.length; i++) diferenca |= esperada.charCodeAt(i) ^ (partes[1].charCodeAt(i) || 0);
  if (diferenca !== 0) throw new FerramentaImagemErro(400, "ficha_invalida", "Ficha do pedido inválida.");
  let d: DadosDaFicha;
  try {
    d = JSON.parse(new TextDecoder().decode(deB64url(partes[0])));
  } catch {
    throw new FerramentaImagemErro(400, "ficha_invalida", "Ficha do pedido inválida.");
  }
  if (d?.v !== 1 || !MOTORES[d.motor]) throw new FerramentaImagemErro(400, "ficha_invalida", "Ficha do pedido inválida.");
  if (agora - Number(d.criado_em) > VALIDADE_DA_FICHA_MS) throw new FerramentaImagemErro(410, "ficha_vencida", "Este pedido passou de 24 h e o provedor já apagou o resultado. Peça de novo.");
  return d;
}

export function fichaDoPlano(plano: PlanoDaFerramenta, clientId: string, imagemId: string, pedido: PedidoNaFila, agora = Date.now()): DadosDaFicha {
  return {
    v: 1,
    tarefa: plano.tarefa,
    motor: plano.motor.id,
    client_id: clientId,
    imagem_id: imagemId,
    fator: plano.fator,
    fator_efetivo: plano.fator_efetivo,
    modo: plano.modo,
    conteudo: plano.conteudo,
    formato_saida: plano.formato_saida,
    entrada: plano.entrada,
    saida: plano.saida,
    estimativa_usd: plano.estimativa_usd,
    pedido,
    criado_em: agora,
  };
}

export function planoDaFicha(d: DadosDaFicha): PlanoDaFerramenta {
  return {
    tarefa: d.tarefa,
    motor: MOTORES[d.motor],
    entrada: d.entrada,
    saida: d.saida,
    fator: d.fator,
    fator_efetivo: d.fator_efetivo,
    modo: d.modo,
    conteudo: d.conteudo,
    formato_saida: d.formato_saida,
    estimativa_usd: d.estimativa_usd,
    avisos: [],
  };
}

// ------------------------------------------------------------------ fluxo completo (com injeção)

/** Etiqueta que identifica a derivada (evita pagar duas vezes pela mesma ampliação). */
export function etiquetaDoResultado(plano: Pick<PlanoDaFerramenta, "tarefa" | "fator" | "modo" | "motor">): string {
  return plano.tarefa === "upscale" ? `upscale:${plano.fator}x:${plano.modo}:${plano.motor.id}` : `sem_fundo:${plano.motor.id}`;
}

export type RegistroDoCusto = {
  custoUsd: number;
  motor: MotorDaFerramenta;
  tarefa: TarefaDaFerramenta;
  qualidade: string;
  /** Id do pedido no provedor (vira a referência do uso e o id da derivada). */
  referenciaId: string;
};

export type DependenciasDoFluxo = {
  rede: Rede;
  /** Já existe uso registrado para este pedido? (retomar não cobra duas vezes) */
  jaCobrado: (referenciaId: string) => Promise<{ usoId: string; custoUsd: number } | null>;
  /** Registra o uso e debita a carteira (ia-motor registrarUso). */
  registrar: (r: RegistroDoCusto) => Promise<{ usoId: string; saldoUsd: number | null }>;
};

export type ResultadoDoProvedor = {
  bytes: Uint8Array;
  conferida: SaidaConferida;
  custoUsd: number;
  usoId: string;
  saldoUsd: number | null;
  referenciaId: string;
  cobradoAgora: boolean;
};

export const UUID_DO_PEDIDO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Do pedido pronto até o custo registrado: baixa, confere e cobra (uma vez
 * por pedido). Gravar no acervo fica com quem chamou.
 */
export async function concluirPedido(plano: PlanoDaFerramenta, pronto: Extract<Andamento, { situacao: "pronto" }>, pedido: PedidoNaFila, deps: DependenciasDoFluxo): Promise<ResultadoDoProvedor> {
  const bytes = await baixarResultado(pronto.imagem_url, deps.rede);
  const conferida = conferirSaida(bytes, plano);
  const referenciaId = UUID_DO_PEDIDO.test(pedido.request_id) ? pedido.request_id.toLowerCase() : "";
  const custoUsd = custoDoMotor(plano.motor, plano.tarefa === "upscale" ? conferida : plano.entrada, pronto.segundos);
  const ja = referenciaId ? await deps.jaCobrado(referenciaId) : null;
  if (ja) return { bytes, conferida, custoUsd: ja.custoUsd, usoId: ja.usoId, saldoUsd: null, referenciaId, cobradoAgora: false };
  const qualidade = plano.tarefa === "upscale" ? `upscale_${plano.fator}x_${plano.modo}` : "sem_fundo";
  const r = await deps.registrar({ custoUsd, motor: plano.motor, tarefa: plano.tarefa, qualidade, referenciaId });
  return { bytes, conferida, custoUsd, usoId: r.usoId, saldoUsd: r.saldoUsd, referenciaId, cobradoAgora: true };
}
