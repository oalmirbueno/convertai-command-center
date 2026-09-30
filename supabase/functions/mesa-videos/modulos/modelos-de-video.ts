/**
 * Modelos de vídeo da Mesa Vídeos (frente E2, 26/09/2026).
 *
 * Hoje o catálogo ia_modelos só tem texto e imagem: nenhum motor de vídeo está
 * ligado. Esta lista é o que a pesquisa da casa já documentou
 * (docs/mesa-foto/cenas/PESQUISA.md e docs/mesa-foto/CLONES.md), para a equipe
 * escolher o modelo e o pedido ficar preparado com os limites certos
 * (duração, referências, pessoa real). Nada aqui chama provedor nem gasta.
 *
 * Quando um motor de vídeo entrar no ia_modelos (tipo "video", ativo), ele
 * aparece como "ligado" e o pedido passa a "falta confirmar". O modelo que a
 * equipe escolheu nunca é trocado: o executor só usa o motor ligado que
 * corresponde a ele (ou o que ela escolheu no catálogo).
 *
 * Frente V-A (26/09/2026, fim do arquivo): o CATÁLOGO DE MOTORES executáveis
 * (MOTORES_DE_VIDEO), com provedor, endpoint, preço, fonte e data, as
 * capacidades de cada um (primeiro e último quadro, referências, extensão,
 * áudio), os níveis (Normal, Top, Rápido) e a sincronização com a lista de
 * modelos do provedor. A lista documentada acima continua como estava (o
 * pedido preparado da frente E2 usa ela).
 *
 * Frente V-C (26/09/2026): Runway (Gen-4.5 e Gen-4 Turbo), Higgsfield
 * (Cinema Studio 4.0, com os movimentos de câmera prontos) e HeyGen (avatar
 * falando: avatar de estoque ou a foto de um clone com autorização) saem de
 * "a integrar" e ganham executor próprio (`video-provedor-*.ts`). Ficam como
 * `escolha_manual`: aparecem na lista para a equipe escolher, mas nunca viram
 * o motor sugerido sozinhos (o que já estava pronto continua igual).
 *
 * Puro: sem Deno, sem banco. A tela, a função mesa-videos e os testes usam o mesmo.
 */

import type { PapelDoMotor } from "./video-kits.ts";

export interface ModeloDeVideo {
  id: string;
  rotulo: string;
  provedor: string;
  /** Durações aceitas em segundos (lista fechada) ou faixa. */
  duracoes: number[] | { min: number; max: number };
  formatos: string[];
  /** Máximo de imagens de referência (identidade) por clipe. */
  referencias_max: number | null;
  /** Aceita rosto de pessoa real (sempre com autorização registrada). */
  pessoa_real: boolean;
  /** Gera áudio junto (fala e som). */
  audio_nativo: boolean | null;
  nota: string;
  fonte: string;
  /** true: há motor ativo no ia_modelos para este modelo. */
  ligado?: boolean;
  /** Id do motor no ia_modelos quando ligado. */
  motor_id?: string | null;
}

export const MODELOS_DE_VIDEO_DOCUMENTADOS: ModeloDeVideo[] = [
  {
    id: "veo-3.1",
    rotulo: "Veo 3.1",
    provedor: "Google (Gemini API ou Vertex AI)",
    duracoes: [4, 6, 8],
    formatos: ["9:16", "16:9"],
    referencias_max: 3,
    pessoa_real: true,
    audio_nativo: true,
    nota: "Até 3 imagens de referência. Pessoa real só adulta e com autorização.",
    fonte: "docs/mesa-foto/CLONES.md",
  },
  {
    id: "kling-3",
    rotulo: "Kling 3.0",
    provedor: "Kling AI (Elements)",
    duracoes: { min: 2, max: 15 },
    formatos: ["9:16", "16:9", "1:1"],
    referencias_max: 4,
    pessoa_real: true,
    audio_nativo: null,
    nota: "Até 15 s. Elements com 2 a 4 imagens, uma de frente como principal.",
    fonte: "docs/mesa-foto/CLONES.md",
  },
  {
    id: "seedance-2",
    rotulo: "Seedance 2.0",
    provedor: "ByteDance",
    duracoes: { min: 4, max: 15 },
    formatos: ["9:16", "16:9", "1:1"],
    referencias_max: null,
    pessoa_real: false,
    audio_nativo: null,
    nota: "De 4 a 15 s. Não aceita rosto de pessoa real no fluxo padrão.",
    fonte: "docs/mesa-foto/cenas/PESQUISA.md",
  },
  {
    id: "runway-gen4",
    rotulo: "Runway Gen-4",
    provedor: "Runway",
    duracoes: { min: 2, max: 15 },
    formatos: ["9:16", "16:9", "1:1"],
    referencias_max: 3,
    pessoa_real: true,
    audio_nativo: null,
    nota: "1 a 3 referências. Duração a conferir no provedor.",
    fonte: "docs/mesa-foto/CLONES.md",
  },
];

export const FORMATOS_DE_VIDEO = ["9:16", "4:5", "1:1", "16:9"] as const;

export interface MotorDoCatalogo {
  id: string;
  tipo: string;
  ativo: boolean;
  rotulo?: string | null;
  modelo_api?: string | null;
}

const semAcento = (t: string) =>
  String(t || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

/** O motor do catálogo corresponde a este modelo documentado? (por id, rótulo ou modelo_api) */
function motorDoModelo(m: ModeloDeVideo, motores: MotorDoCatalogo[]): MotorDoCatalogo | null {
  const alvo = semAcento(m.id);
  const alvoRotulo = semAcento(m.rotulo);
  return (
    motores.find((x) => {
      const nomes = [x.id, x.rotulo || "", x.modelo_api || ""].map(semAcento);
      return nomes.some((n) => n && (n.indexOf(alvo) >= 0 || n.indexOf(alvoRotulo) >= 0));
    }) || null
  );
}

/**
 * A lista que a tela mostra: os modelos documentados (ligado quando há motor
 * ativo correspondente) e, depois, os motores de vídeo ativos do catálogo que
 * não estão na lista documentada.
 */
export function modelosDeVideo(catalogo: MotorDoCatalogo[] | null | undefined): ModeloDeVideo[] {
  const motores = (catalogo || []).filter((x) => x && x.ativo && x.tipo === "video");
  const usados: string[] = [];
  const saida = MODELOS_DE_VIDEO_DOCUMENTADOS.map((m) => {
    const motor = motorDoModelo(m, motores);
    if (motor) usados.push(motor.id);
    return { ...m, ligado: !!motor, motor_id: motor ? motor.id : null };
  });
  motores
    .filter((x) => usados.indexOf(x.id) < 0)
    .forEach((x) =>
      saida.push({
        id: x.id,
        rotulo: x.rotulo || x.id,
        provedor: "Catálogo",
        duracoes: { min: 2, max: 15 },
        formatos: FORMATOS_DE_VIDEO.slice(),
        referencias_max: null,
        pessoa_real: false,
        audio_nativo: null,
        nota: "Motor ligado no catálogo de modelos.",
        fonte: "ia_modelos",
        ligado: true,
        motor_id: x.id,
      }),
    );
  return saida;
}

export function modeloDeVideo(id: string | null | undefined, lista: ModeloDeVideo[] = MODELOS_DE_VIDEO_DOCUMENTADOS): ModeloDeVideo | null {
  if (!id) return null;
  return lista.find((m) => m.id === id) || null;
}

/** Durações que o modelo aceita, em lista (a faixa vira os segundos inteiros). */
export function duracoesDoModelo(m: ModeloDeVideo | null, padrao: { min: number; max: number } = { min: 2, max: 15 }): number[] {
  const d = m ? m.duracoes : padrao;
  if (Array.isArray(d)) return d.slice();
  const saida: number[] = [];
  for (let i = d.min; i <= d.max; i++) saida.push(i);
  return saida;
}

/** A duração pedida no que o modelo aceita (o valor aceito mais próximo). */
export function duracaoNoModelo(m: ModeloDeVideo | null, segundos: number, padrao: { min: number; max: number } = { min: 2, max: 15 }): number {
  const lista = duracoesDoModelo(m, padrao);
  const s = isFinite(segundos) ? segundos : lista[0];
  let melhor = lista[0];
  lista.forEach((x) => {
    if (Math.abs(x - s) < Math.abs(melhor - s)) melhor = x;
  });
  return melhor;
}

/** Texto curto da duração aceita ("4, 6 ou 8 s", "4 a 15 s"). */
export function textoDasDuracoes(m: ModeloDeVideo): string {
  const d = m.duracoes;
  if (Array.isArray(d)) {
    if (d.length === 1) return `${d[0]} s`;
    return `${d.slice(0, -1).join(", ")} ou ${d[d.length - 1]} s`;
  }
  return `${d.min} a ${d.max} s`;
}

/** Motivo para não usar o modelo com pessoa real; null quando pode. */
export function travaDePessoaReal(m: ModeloDeVideo | null, temPessoaReal: boolean): string | null {
  if (!m || !temPessoaReal) return null;
  return m.pessoa_real ? null : `${m.rotulo} não aceita rosto de pessoa real. Escolha outro modelo.`;
}

// ====================================================================================
// Frente V-A (26/09/2026): catálogo de MOTORES executáveis, níveis e sincronização.
// Preços e parâmetros conferidos nas páginas do provedor em 26/09/2026
// (docs/video/PESQUISA-GERADOR.md). "incerto": veio de fonte de terceiro ou a
// página diverge; a tela mostra "~". Motor sem preço não gera (a carteira
// precisa do valor antes).
// ====================================================================================

export type FamiliaDoMotor = "video" | "angulo" | "imagem" | "avatar";
export type ProvedorDoMotor = "fal" | "runway" | "higgsfield" | "heygen" | "painel";
export type NivelDoMotor = "normal" | "top" | "rapido";

/** Jeito de montar o corpo do pedido (cada modelo chama os campos de um jeito). */
export type DialetoDoMotor =
  | "seedance"
  | "kling"
  | "veo"
  | "gemini_omni"
  | "wan3"
  | "minimax_h3"
  | "hailuo"
  | "happyhorse"
  | "flux3"
  | "grok"
  | "pixverse"
  | "ltx"
  | "hunyuan"
  | "qwen_angulo"
  | "flux2_angulo"
  | "runway"
  | "higgsfield"
  | "heygen_avatar"
  | "heygen_foto"
  | "painel"
  | "nenhum";

export interface CapacidadesDoMotor {
  texto: boolean;
  primeiro_quadro: boolean;
  ultimo_quadro: boolean;
  /** Imagens de referência (personagem, produto, elementos) por pedido. */
  referencias: number;
  /** Continua um vídeo que já existe (extensão nativa). */
  estender: boolean;
  audio: boolean;
  pessoa_real: boolean;
  /** Movimentos de câmera prontos por parâmetro (Higgsfield). */
  camera?: boolean;
  /** Pessoa falando um roteiro (avatar ou foto que fala, HeyGen). */
  avatar?: boolean;
}

export interface PrecoDoMotor {
  /** US$ por segundo, por resolução ("720p") ou "padrao". */
  por_segundo?: Record<string, number>;
  /** US$ por segundo com áudio ligado (quando muda o preço). */
  por_segundo_audio?: Record<string, number>;
  /** US$ por vídeo (preço fechado por clipe). */
  por_video?: number;
  /** US$ por imagem (ângulo). */
  por_imagem?: number;
  /** Extra por imagem de referência. */
  por_referencia?: number;
  fonte: string;
  conferido_em: string;
  incerto?: boolean;
}

export interface MotorDeVideo {
  id: string;
  rotulo: string;
  familia: FamiliaDoMotor;
  /** Linha (família comercial) e versão ordenável: a mais nova com preço vira o Top da linha. */
  linha: string;
  versao: string;
  /** Variante principal da versão (Pro, cheia); fast, lite, mini e turbo não. */
  principal: boolean;
  /** Rascunho rápido (nível Rápido). */
  rapido?: boolean;
  provedor: ProvedorDoMotor;
  /** Segredo da função com a chave (só o nome; o valor nunca sai do servidor). */
  chave_env: string;
  /** Segundo segredo quando o provedor pede par (Higgsfield: id e segredo da chave). */
  segredo_env?: string;
  /** Nome do modelo na API do provedor, quando vai no corpo (Runway: "gen4.5"). */
  modelo?: string;
  /** Só quando a equipe escolhe: nunca vira o motor sugerido de um nível ou papel. */
  escolha_manual?: boolean;
  endpoints: { texto?: string; imagem?: string; ultimo?: string; referencia?: string; estender?: string; angulo?: string; avatar?: string };
  dialeto: DialetoDoMotor;
  duracoes: number[] | { min: number; max: number };
  resolucoes: string[];
  resolucao_padrao: string;
  formatos: string[];
  cap: CapacidadesDoMotor;
  preco: PrecoDoMotor | null;
  papeis: PapelDoMotor[];
  /** Minutos até o pedido parar de ser consultado. */
  prazo_min: number;
  nota: string;
  /** Situação fixa que tira o motor da geração. */
  situacao?: "a_integrar" | "encerrado";
  /** Id da lista documentada (E2) que este motor atende. */
  documentado?: string;
  /** Entrou pela sincronização e o dono não revisou. */
  novo?: boolean;
}

const HOJE = "2026-09-26";
const F = (endpoint: string) => `https://fal.ai/models/${endpoint}`;
const TODOS = ["9:16", "16:9", "1:1", "4:5"];
const faixa = (min: number, max: number) => ({ min, max });
const cap = (c: Partial<CapacidadesDoMotor>): CapacidadesDoMotor => ({ texto: false, primeiro_quadro: false, ultimo_quadro: false, referencias: 0, estender: false, audio: false, pessoa_real: false, ...c });

export const MOTORES_DE_VIDEO: MotorDeVideo[] = [
  // ------------------------------------------------------------------ Seedance (ByteDance)
  {
    id: "seedance-2.5", rotulo: "Seedance 2.5", familia: "video", linha: "seedance", versao: "2.5", principal: true, provedor: "fal", chave_env: "FAL_KEY",
    endpoints: { texto: "bytedance/seedance-2.5/text-to-video", imagem: "bytedance/seedance-2.5/image-to-video", ultimo: "bytedance/seedance-2.5/image-to-video", referencia: "bytedance/seedance-2.5/reference-to-video", estender: "bytedance/seedance-2.5/reference-to-video" },
    dialeto: "seedance", duracoes: faixa(4, 15), resolucoes: ["480p", "720p"], resolucao_padrao: "720p", formatos: TODOS,
    cap: cap({ texto: true, primeiro_quadro: true, ultimo_quadro: true, referencias: 9, estender: true, audio: true }),
    preco: { por_segundo: { "480p": 0.2205, "720p": 0.473 }, fonte: F("bytedance/seedance-2.5/image-to-video"), conferido_em: HOJE },
    papeis: ["hero", "consistencia", "fala"], prazo_min: 40, nota: "Até 30 s no provedor (a mesa usa até 15). Áudio incluso. Referência @Image1 no prompt. Não aceita rosto de pessoa real no fluxo padrão.", documentado: "seedance-2",
  },
  {
    id: "seedance-2.0-fast", rotulo: "Seedance 2.0 Fast", familia: "video", linha: "seedance", versao: "2.0", principal: false, provedor: "fal", chave_env: "FAL_KEY",
    endpoints: { imagem: "bytedance/seedance-2.0/fast/image-to-video", ultimo: "bytedance/seedance-2.0/fast/image-to-video", referencia: "bytedance/seedance-2.0/fast/reference-to-video" },
    dialeto: "seedance", duracoes: faixa(4, 15), resolucoes: ["480p", "720p"], resolucao_padrao: "720p", formatos: TODOS,
    cap: cap({ primeiro_quadro: true, ultimo_quadro: true, referencias: 9, audio: true }),
    preco: { por_segundo: { "720p": 0.2419, "480p": 0.2419 }, fonte: F("bytedance/seedance-2.0/fast/image-to-video"), conferido_em: HOJE, incerto: true },
    papeis: ["consistencia", "barato"], prazo_min: 30, nota: "Mais barato que o 2.5, com as mesmas referências.",
  },
  // ------------------------------------------------------------------ Kling
  {
    id: "kling-3-pro", rotulo: "Kling 3.0 Pro", familia: "video", linha: "kling", versao: "3.0", principal: true, provedor: "fal", chave_env: "FAL_KEY",
    endpoints: { texto: "fal-ai/kling-video/v3/pro/text-to-video", imagem: "fal-ai/kling-video/v3/pro/image-to-video", ultimo: "fal-ai/kling-video/v3/pro/image-to-video" },
    dialeto: "kling", duracoes: faixa(3, 15), resolucoes: ["1080p"], resolucao_padrao: "1080p", formatos: ["9:16", "16:9", "1:1"],
    cap: cap({ texto: true, primeiro_quadro: true, ultimo_quadro: true, referencias: 4, audio: true, pessoa_real: true }),
    preco: { por_segundo: { padrao: 0.112 }, por_segundo_audio: { padrao: 0.168 }, fonte: F("fal-ai/kling-video/v3/pro/text-to-video"), conferido_em: HOJE, incerto: true },
    papeis: ["movimento", "hero", "consistencia"], prazo_min: 30, nota: "Física e câmera fortes. Elements com até 4 imagens (uma de frente). Preço diverge entre páginas do provedor.", documentado: "kling-3",
  },
  {
    id: "kling-o3-standard", rotulo: "Kling O3 Standard", familia: "video", linha: "kling", versao: "3.0", principal: false, provedor: "fal", chave_env: "FAL_KEY",
    endpoints: { texto: "fal-ai/kling-video/o3/standard/text-to-video", imagem: "fal-ai/kling-video/o3/standard/image-to-video", ultimo: "fal-ai/kling-video/o3/standard/image-to-video", referencia: "fal-ai/kling-video/o3/standard/reference-to-video", estender: "fal-ai/kling-video/o3/standard/video-to-video/reference" },
    dialeto: "kling", duracoes: faixa(3, 15), resolucoes: ["720p"], resolucao_padrao: "720p", formatos: ["9:16", "16:9", "1:1"],
    cap: cap({ texto: true, primeiro_quadro: true, ultimo_quadro: true, referencias: 4, estender: true, audio: true, pessoa_real: true }),
    preco: { por_segundo: { padrao: 0.084 }, por_segundo_audio: { padrao: 0.112 }, fonte: F("fal-ai/kling-video/o3/standard/reference-to-video"), conferido_em: HOJE },
    papeis: ["consistencia", "barato"], prazo_min: 30, nota: "Omni: referência por elemento e próximo plano com continuidade (não é extensão literal).",
  },
  {
    id: "kling-2.6-pro", rotulo: "Kling 2.6 Pro", familia: "video", linha: "kling", versao: "2.6", principal: true, provedor: "fal", chave_env: "FAL_KEY",
    endpoints: { imagem: "fal-ai/kling-video/v2.6/pro/image-to-video", ultimo: "fal-ai/kling-video/v2.6/pro/image-to-video" },
    dialeto: "kling", duracoes: [5, 10], resolucoes: ["1080p"], resolucao_padrao: "1080p", formatos: ["9:16", "16:9", "1:1"],
    cap: cap({ primeiro_quadro: true, ultimo_quadro: true, audio: true, pessoa_real: true }),
    preco: { por_segundo: { padrao: 0.07 }, por_segundo_audio: { padrao: 0.14 }, fonte: F("fal-ai/kling-video/v2.6/pro/image-to-video"), conferido_em: HOJE },
    papeis: ["transicao", "barato"], prazo_min: 30, nota: "Primeiro e último quadro com bom preço.",
  },
  // ------------------------------------------------------------------ Veo (Google)
  {
    id: "veo-3.1", rotulo: "Veo 3.1", familia: "video", linha: "veo", versao: "3.1", principal: true, provedor: "fal", chave_env: "FAL_KEY",
    endpoints: { texto: "fal-ai/veo3.1", imagem: "fal-ai/veo3.1/image-to-video", ultimo: "fal-ai/veo3.1/first-last-frame-to-video", referencia: "fal-ai/veo3.1/reference-to-video", estender: "fal-ai/veo3.1/extend-video" },
    dialeto: "veo", duracoes: [4, 6, 8], resolucoes: ["720p", "1080p"], resolucao_padrao: "1080p", formatos: ["9:16", "16:9"],
    cap: cap({ texto: true, primeiro_quadro: true, ultimo_quadro: true, referencias: 3, estender: true, audio: true, pessoa_real: true }),
    preco: { por_segundo: { "720p": 0.2, "1080p": 0.2 }, por_segundo_audio: { "720p": 0.4, "1080p": 0.4 }, fonte: F("fal-ai/veo3.1/image-to-video"), conferido_em: HOJE },
    papeis: ["hero", "fala"], prazo_min: 30, nota: "Fala em português com áudio nativo. Pessoa real só adulta e com autorização. Extensão de vídeo de até 8 s.", documentado: "veo-3.1",
  },
  {
    id: "veo-3.1-fast", rotulo: "Veo 3.1 Fast", familia: "video", linha: "veo", versao: "3.1", principal: false, provedor: "fal", chave_env: "FAL_KEY",
    endpoints: { texto: "fal-ai/veo3.1/fast", imagem: "fal-ai/veo3.1/fast/image-to-video", ultimo: "fal-ai/veo3.1/fast/first-last-frame-to-video" },
    dialeto: "veo", duracoes: [4, 6, 8], resolucoes: ["720p", "1080p"], resolucao_padrao: "1080p", formatos: ["9:16", "16:9"],
    cap: cap({ texto: true, primeiro_quadro: true, ultimo_quadro: true, audio: true, pessoa_real: true }),
    preco: { por_segundo: { "720p": 0.1, "1080p": 0.1 }, por_segundo_audio: { "720p": 0.15, "1080p": 0.15 }, fonte: F("fal-ai/veo3.1/fast/first-last-frame-to-video"), conferido_em: HOJE },
    papeis: ["fala", "transicao", "barato"], prazo_min: 30, nota: "Metade do preço do Veo 3.1, com fala.",
  },
  {
    id: "veo-3.1-lite", rotulo: "Veo 3.1 Lite", familia: "video", linha: "veo", versao: "3.1", principal: false, rapido: true, provedor: "fal", chave_env: "FAL_KEY",
    endpoints: { texto: "fal-ai/veo3.1/lite", imagem: "fal-ai/veo3.1/lite/image-to-video", ultimo: "fal-ai/veo3.1/lite/first-last-frame-to-video" },
    dialeto: "veo", duracoes: [4, 6, 8], resolucoes: ["720p", "1080p"], resolucao_padrao: "720p", formatos: ["9:16", "16:9"],
    cap: cap({ texto: true, primeiro_quadro: true, ultimo_quadro: true, audio: true, pessoa_real: true }),
    preco: { por_segundo: { "720p": 0.03, "1080p": 0.05 }, por_segundo_audio: { "720p": 0.05, "1080p": 0.08 }, fonte: F("fal-ai/veo3.1/lite/image-to-video"), conferido_em: HOJE },
    papeis: ["rascunho", "barato"], prazo_min: 20, nota: "Rascunho barato do Veo, com áudio opcional.",
  },
  {
    id: "gemini-omni-flash-1.1", rotulo: "Gemini Omni Flash 1.1", familia: "video", linha: "gemini-omni", versao: "1.1", principal: true, provedor: "fal", chave_env: "FAL_KEY",
    endpoints: { texto: "google/gemini-omni-flash/v1.1/text-to-video", imagem: "google/gemini-omni-flash/v1.1/image-to-video", ultimo: "google/gemini-omni-flash/v1.1/image-to-video", referencia: "google/gemini-omni-flash/v1.1/reference-to-video" },
    dialeto: "gemini_omni", duracoes: [8], resolucoes: ["360p", "720p", "1080p"], resolucao_padrao: "720p", formatos: ["9:16", "16:9"],
    cap: cap({ texto: true, primeiro_quadro: true, ultimo_quadro: true, referencias: 3, audio: true }),
    preco: { por_segundo: { "360p": 0.03, "720p": 0.1, "1080p": 0.15 }, fonte: F("google/gemini-omni-flash/v1.1/image-to-video"), conferido_em: HOJE },
    papeis: ["barato", "consistencia"], prazo_min: 30, nota: "Áudio sincronizado sempre ligado. Clipe de 8 s.",
  },
  // ------------------------------------------------------------------ Wan (Alibaba)
  {
    id: "wan-3.0", rotulo: "Wan 3.0", familia: "video", linha: "wan", versao: "3.0", principal: true, provedor: "fal", chave_env: "FAL_KEY",
    endpoints: { texto: "alibaba/wan-3.0/text-to-video", imagem: "alibaba/wan-3.0/image-to-video", ultimo: "alibaba/wan-3.0/image-to-video", referencia: "alibaba/wan-3.0/reference-to-video" },
    dialeto: "wan3", duracoes: faixa(2, 15), resolucoes: ["480p", "720p", "1080p"], resolucao_padrao: "720p", formatos: TODOS,
    cap: cap({ texto: true, primeiro_quadro: true, ultimo_quadro: true, referencias: 10, audio: true }),
    preco: { por_segundo: { "480p": 0.05, "720p": 0.1, "1080p": 0.2 }, fonte: F("alibaba/wan-3.0/image-to-video"), conferido_em: HOJE },
    papeis: ["barato", "consistencia", "transicao"], prazo_min: 30, nota: "Até 30 s no provedor (a mesa usa até 15). Até 10 imagens de referência. Ótimo custo por segundo.",
  },
  // ------------------------------------------------------------------ MiniMax / Hailuo
  {
    id: "minimax-h3-max", rotulo: "MiniMax H3 Max", familia: "video", linha: "minimax-h3", versao: "3", principal: true, provedor: "fal", chave_env: "FAL_KEY",
    endpoints: { texto: "minimax/h3-max/text-to-video", imagem: "minimax/h3-max/image-to-video", ultimo: "minimax/h3-max/image-to-video", estender: "minimax/h3-max/extend-video" },
    dialeto: "minimax_h3", duracoes: faixa(2, 15), resolucoes: ["768p", "1080p"], resolucao_padrao: "768p", formatos: TODOS,
    cap: cap({ texto: true, primeiro_quadro: true, ultimo_quadro: true, estender: true, audio: true }),
    preco: { por_segundo: { "480p": 0.05, "768p": 0.08, "1080p": 0.16 }, fonte: F("minimax/h3-max/reference-to-video"), conferido_em: HOJE },
    papeis: ["hero", "movimento"], prazo_min: 20, nota: "Rápido e com áudio estéreo. Extensão nativa (preço da extensão estimado pelo mesmo valor).",
  },
  {
    id: "minimax-h3-max-turbo", rotulo: "H3 Max Turbo (rascunho)", familia: "video", linha: "minimax-h3", versao: "3", principal: false, rapido: true, provedor: "fal", chave_env: "FAL_KEY",
    endpoints: { texto: "minimax/h3-max-turbo/text-to-video", imagem: "minimax/h3-max-turbo/image-to-video", ultimo: "minimax/h3-max-turbo/image-to-video" },
    dialeto: "minimax_h3", duracoes: faixa(2, 15), resolucoes: ["480p", "768p", "1080p"], resolucao_padrao: "768p", formatos: TODOS,
    cap: cap({ texto: true, primeiro_quadro: true, ultimo_quadro: true, audio: true }),
    preco: { por_segundo: { "480p": 0.025, "768p": 0.04, "1080p": 0.08 }, fonte: F("minimax/h3-max-turbo/image-to-video"), conferido_em: HOJE },
    papeis: ["rascunho"], prazo_min: 10, nota: "Prévia em segundos (5 s em cerca de 2 s no teste do provedor). Use antes de gastar no motor caro.",
  },
  {
    id: "hailuo-2.3-pro", rotulo: "Hailuo 2.3 Pro", familia: "video", linha: "hailuo", versao: "2.3", principal: true, provedor: "fal", chave_env: "FAL_KEY",
    endpoints: { imagem: "fal-ai/minimax/hailuo-2.3/pro/image-to-video" },
    dialeto: "hailuo", duracoes: [6, 10], resolucoes: ["1080p"], resolucao_padrao: "1080p", formatos: ["9:16", "16:9", "1:1"],
    cap: cap({ primeiro_quadro: true }),
    preco: { por_video: 0.49, fonte: F("fal-ai/minimax/hailuo-2.3/pro/image-to-video"), conferido_em: HOJE, incerto: true },
    papeis: ["movimento"], prazo_min: 30, nota: "Geração anterior da MiniMax. Sem áudio e sem último quadro.",
  },
  // ------------------------------------------------------------------ outros de 2026
  {
    id: "happyhorse-1.0", rotulo: "HappyHorse 1.0", familia: "video", linha: "happyhorse", versao: "1.0", principal: true, provedor: "fal", chave_env: "FAL_KEY",
    endpoints: { imagem: "alibaba/happy-horse/image-to-video", texto: "alibaba/happy-horse/v1.1/text-to-video" },
    dialeto: "happyhorse", duracoes: faixa(3, 15), resolucoes: ["720p", "1080p"], resolucao_padrao: "720p", formatos: TODOS,
    cap: cap({ texto: true, primeiro_quadro: true, audio: true }),
    preco: { por_segundo: { "720p": 0.14, "1080p": 0.28 }, fonte: F("alibaba/happy-horse/image-to-video"), conferido_em: HOJE },
    papeis: ["hero"], prazo_min: 30, nota: "Sincronia labial sem português na lista do provedor: fala em PT vai por outro motor.",
  },
  {
    id: "flux-3-video", rotulo: "FLUX 3 Vídeo", familia: "video", linha: "flux3", versao: "3", principal: true, provedor: "fal", chave_env: "FAL_KEY",
    endpoints: { imagem: "blackforestlabs/flux-3/image-to-video", ultimo: "blackforestlabs/flux-3/keyframes-to-video", estender: "blackforestlabs/flux-3/extend-video" },
    dialeto: "flux3", duracoes: faixa(5, 15), resolucoes: ["720p", "1080p"], resolucao_padrao: "1080p", formatos: TODOS,
    cap: cap({ primeiro_quadro: true, ultimo_quadro: true, estender: true, audio: true }),
    preco: { por_segundo: { "720p": 0.17, "1080p": 0.29 }, fonte: F("blackforestlabs/flux-3/image-to-video"), conferido_em: HOJE },
    papeis: ["hero", "transicao"], prazo_min: 30, nota: "Quadros-chave (primeiro e último) e extensão. Preço da extensão estimado pelo mesmo valor.",
  },
  {
    id: "grok-imagine-1.5", rotulo: "Grok Imagine Vídeo 1.5", familia: "video", linha: "grok", versao: "1.5", principal: true, provedor: "fal", chave_env: "FAL_KEY",
    endpoints: { imagem: "xai/grok-imagine-video/v1.5/image-to-video", estender: "xai/grok-imagine-video/extend-video" },
    dialeto: "grok", duracoes: faixa(2, 15), resolucoes: ["480p", "720p", "1080p"], resolucao_padrao: "720p", formatos: TODOS,
    cap: cap({ primeiro_quadro: true, estender: true, audio: true }),
    preco: { por_segundo: { "480p": 0.08, "720p": 0.14, "1080p": 0.25 }, por_referencia: 0.01, fonte: F("xai/grok-imagine-video/v1.5/image-to-video"), conferido_em: HOJE },
    papeis: ["barato"], prazo_min: 30, nota: "Extensão a partir do último quadro (endpoint da versão 1).",
  },
  {
    id: "pixverse-c1", rotulo: "PixVerse C1", familia: "video", linha: "pixverse", versao: "c1", principal: true, provedor: "fal", chave_env: "FAL_KEY",
    endpoints: { texto: "fal-ai/pixverse/c1/text-to-video", imagem: "fal-ai/pixverse/c1/image-to-video" },
    dialeto: "pixverse", duracoes: faixa(2, 15), resolucoes: ["360p", "540p", "720p", "1080p"], resolucao_padrao: "720p", formatos: TODOS,
    cap: cap({ texto: true, primeiro_quadro: true, audio: true }),
    preco: { por_segundo: { "360p": 0.03, "540p": 0.04, "720p": 0.05, "1080p": 0.095 }, por_segundo_audio: { "360p": 0.04, "540p": 0.05, "720p": 0.065, "1080p": 0.12 }, fonte: F("fal-ai/pixverse/c1/image-to-video"), conferido_em: HOJE },
    papeis: ["barato"], prazo_min: 20, nota: "Volume barato com áudio opcional.",
  },
  {
    id: "ltx-2.3", rotulo: "LTX-2.3 Pro", familia: "video", linha: "ltx", versao: "2.3", principal: true, provedor: "fal", chave_env: "FAL_KEY",
    endpoints: { texto: "fal-ai/ltx-2.3/text-to-video", imagem: "fal-ai/ltx-2.3/image-to-video", ultimo: "fal-ai/ltx-2.3/image-to-video", estender: "fal-ai/ltx-2.3/extend-video" },
    dialeto: "ltx", duracoes: [6, 8, 10, 12, 14], resolucoes: ["1080p", "1440p"], resolucao_padrao: "1080p", formatos: ["9:16", "16:9"],
    cap: cap({ texto: true, primeiro_quadro: true, ultimo_quadro: true, estender: true, audio: true }),
    preco: { por_segundo: { "1080p": 0.06, "1440p": 0.12 }, fonte: F("fal-ai/ltx-2.3/image-to-video"), conferido_em: HOJE },
    papeis: ["barato", "transicao"], prazo_min: 20, nota: "Pesos abertos. Durações pares. Extensão a US$ 0,10/s.",
  },
  {
    id: "ltx-2.3-fast", rotulo: "LTX-2.3 Fast (rascunho)", familia: "video", linha: "ltx", versao: "2.3", principal: false, rapido: true, provedor: "fal", chave_env: "FAL_KEY",
    endpoints: { texto: "fal-ai/ltx-2.3/text-to-video/fast", imagem: "fal-ai/ltx-2.3/image-to-video/fast", ultimo: "fal-ai/ltx-2.3/image-to-video/fast" },
    dialeto: "ltx", duracoes: [6, 8, 10, 12, 14], resolucoes: ["1080p"], resolucao_padrao: "1080p", formatos: ["9:16", "16:9"],
    cap: cap({ texto: true, primeiro_quadro: true, ultimo_quadro: true, audio: true }),
    preco: { por_segundo: { "1080p": 0.04 }, fonte: F("fal-ai/ltx-2.3/image-to-video/fast"), conferido_em: HOJE },
    papeis: ["rascunho", "barato"], prazo_min: 10, nota: "Prévia rápida em 1080p.",
  },
  {
    id: "hunyuan-1.5", rotulo: "Hunyuan Video 1.5", familia: "video", linha: "hunyuan", versao: "1.5", principal: true, provedor: "fal", chave_env: "FAL_KEY",
    endpoints: { texto: "fal-ai/hunyuan-video-v1.5/text-to-video", imagem: "fal-ai/hunyuan-video-v1.5/image-to-video" },
    dialeto: "hunyuan", duracoes: [5], resolucoes: ["480p"], resolucao_padrao: "480p", formatos: ["9:16", "16:9"],
    cap: cap({ texto: true, primeiro_quadro: true }),
    preco: { por_segundo: { "480p": 0.075 }, fonte: F("fal-ai/hunyuan-video-v1.5/image-to-video"), conferido_em: HOJE, incerto: true },
    papeis: ["barato"], prazo_min: 20, nota: "Pesos abertos, 480p.",
  },
  // ------------------------------------------------------------------ fora do fal (frente V-C: executor próprio, escolha manual)
  // Runway: api.dev.runwayml.com, versão 2024-11-06; 1 crédito = US$ 0,01 (docs/video/PESQUISA-GERADOR.md, seção 9).
  {
    id: "runway-gen4.5", rotulo: "Runway Gen-4.5", familia: "video", linha: "runway", versao: "4.5", principal: true, provedor: "runway", chave_env: "RUNWAYML_API_SECRET", modelo: "gen4.5", escolha_manual: true,
    endpoints: { texto: "text_to_video", imagem: "image_to_video" }, dialeto: "runway", duracoes: faixa(2, 10), resolucoes: ["720p"], resolucao_padrao: "720p", formatos: TODOS,
    cap: cap({ texto: true, primeiro_quadro: true, pessoa_real: true }),
    preco: { por_segundo: { padrao: 0.12 }, fonte: "https://docs.dev.runwayml.com/guides/pricing/", conferido_em: HOJE },
    papeis: ["hero", "movimento"], prazo_min: 30, nota: "API da Runway: 12 créditos por segundo (US$ 0,01 cada). Só o primeiro quadro; pelo texto só 9:16 ou 16:9. Sem áudio. Se a moderação recusar, a Runway cobra a tentativa da conta da agência (o cliente não paga).", documentado: "runway-gen4",
  },
  {
    id: "runway-gen4-turbo", rotulo: "Runway Gen-4 Turbo (rascunho)", familia: "video", linha: "runway", versao: "4", principal: false, rapido: true, provedor: "runway", chave_env: "RUNWAYML_API_SECRET", modelo: "gen4_turbo", escolha_manual: true,
    endpoints: { imagem: "image_to_video" }, dialeto: "runway", duracoes: faixa(2, 10), resolucoes: ["720p"], resolucao_padrao: "720p", formatos: TODOS,
    cap: cap({ primeiro_quadro: true, pessoa_real: true }),
    preco: { por_segundo: { padrao: 0.05 }, fonte: "https://docs.dev.runwayml.com/guides/pricing/", conferido_em: HOJE },
    papeis: ["rascunho", "barato"], prazo_min: 20, nota: "O mais rápido e barato da Runway (5 créditos por segundo). Só a partir de uma imagem, sem áudio.",
  },
  // Higgsfield: api.higgsfield.ai, chave em par (id e segredo); movimentos de câmera do Cinema Studio 4.0.
  {
    id: "higgsfield-cinema-4", rotulo: "Higgsfield Cinema Studio 4.0", familia: "video", linha: "higgsfield", versao: "4.0", principal: true, provedor: "higgsfield", chave_env: "HIGGSFIELD_API_KEY", segredo_env: "HIGGSFIELD_API_SECRET", escolha_manual: true,
    endpoints: { texto: "higgsfield/cinema-studio/4.0", imagem: "higgsfield/cinema-studio/4.0", referencia: "higgsfield/cinema-studio/4.0" }, dialeto: "higgsfield", duracoes: faixa(4, 15), resolucoes: ["480p", "720p"], resolucao_padrao: "720p", formatos: TODOS,
    cap: cap({ texto: true, primeiro_quadro: true, referencias: 4, audio: true, camera: true }),
    preco: { por_segundo: { padrao: 0.2057 }, fonte: "https://console.higgsfield.ai/explore", conferido_em: HOJE, incerto: true },
    papeis: ["movimento", "hero"], prazo_min: 30, nota: "33 movimentos de câmera prontos (dolly, grua, órbita de drone, bullet time). A imagem entra como referência, não como quadro exato. Preço promocional do console: conferir no primeiro uso.",
  },
  // HeyGen: api.heygen.com/v3 (v1 e v2 saem do ar em 31/10/2026). Avatar IV cobra por segundo do vídeo pronto.
  {
    id: "heygen-avatar-iv", rotulo: "HeyGen avatar de estoque", familia: "avatar", linha: "heygen", versao: "iv", principal: true, provedor: "heygen", chave_env: "HEYGEN_API_KEY", escolha_manual: true,
    endpoints: { avatar: "v3/videos" }, dialeto: "heygen_avatar", duracoes: faixa(3, 300), resolucoes: ["720p", "1080p"], resolucao_padrao: "1080p", formatos: TODOS,
    cap: cap({ texto: true, audio: true, avatar: true }),
    preco: { por_segundo: { "720p": 0.0667, "1080p": 0.0667 }, fonte: "https://developers.heygen.com/docs/enterprise-pricing", conferido_em: HOJE, incerto: true },
    papeis: ["fala"], prazo_min: 30, nota: "Roteiro vira um avatar de estoque falando, motor Avatar IV. Cobra pela duração real (até o valor confirmado). Preço do plano sem contrato conferido só em fonte de terceiro.",
  },
  {
    id: "heygen-foto", rotulo: "HeyGen foto falando (clone)", familia: "avatar", linha: "heygen", versao: "iv", principal: false, provedor: "heygen", chave_env: "HEYGEN_API_KEY", escolha_manual: true,
    endpoints: { avatar: "v3/videos" }, dialeto: "heygen_foto", duracoes: faixa(3, 300), resolucoes: ["720p", "1080p"], resolucao_padrao: "1080p", formatos: TODOS,
    cap: cap({ texto: true, primeiro_quadro: true, audio: true, avatar: true, pessoa_real: true }),
    preco: { por_segundo: { "720p": 0.05, "1080p": 0.05 }, fonte: "https://developers.heygen.com/docs/enterprise-pricing", conferido_em: HOJE, incerto: true },
    papeis: ["fala"], prazo_min: 30, nota: "A foto principal de um clone vira a pessoa falando o roteiro (Avatar IV). Só com a autorização de imagem válida do clone, a mesma da Mesa Foto.",
  },
  // ------------------------------------------------------------------ encerrados
  {
    id: "sora-2", rotulo: "Sora 2", familia: "video", linha: "sora", versao: "2", principal: true, provedor: "fal", chave_env: "FAL_KEY",
    endpoints: {}, dialeto: "nenhum", duracoes: [4, 8, 12], resolucoes: ["720p"], resolucao_padrao: "720p", formatos: ["9:16", "16:9"],
    cap: cap({ texto: true, primeiro_quadro: true, audio: true }),
    preco: null, papeis: [], prazo_min: 30, nota: "API encerrada pela OpenAI em 24/09/2026.", situacao: "encerrado",
  },
  // ------------------------------------------------------------------ ângulo de câmera (imagem)
  {
    id: "qwen-angulos-2511", rotulo: "Qwen Edit 2511 Ângulos", familia: "angulo", linha: "qwen-angulos", versao: "2511", principal: true, provedor: "fal", chave_env: "FAL_KEY",
    endpoints: { angulo: "fal-ai/qwen-image-edit-2511-multiple-angles" }, dialeto: "qwen_angulo", duracoes: [0], resolucoes: ["1mp"], resolucao_padrao: "1mp", formatos: TODOS,
    cap: cap({ primeiro_quadro: true, pessoa_real: true }),
    preco: { por_imagem: 0.037, fonte: F("fal-ai/qwen-image-edit-2511-multiple-angles"), conferido_em: HOJE },
    papeis: ["angulo"], prazo_min: 10, nota: "US$ 0,035 por megapixel (cerca de 1 MP por imagem). 96 poses treinadas: 8 azimutes, 4 elevações, 3 distâncias.",
  },
  {
    id: "flux-2-angulos", rotulo: "FLUX 2 Ângulos", familia: "angulo", linha: "flux2-angulos", versao: "2", principal: true, provedor: "fal", chave_env: "FAL_KEY",
    endpoints: { angulo: "fal-ai/flux-2-lora-gallery/multiple-angles" }, dialeto: "flux2_angulo", duracoes: [0], resolucoes: ["1mp"], resolucao_padrao: "1mp", formatos: TODOS,
    cap: cap({ primeiro_quadro: true, pessoa_real: true }),
    preco: { por_imagem: 0.022, fonte: F("fal-ai/flux-2-lora-gallery/multiple-angles"), conferido_em: HOJE, incerto: true },
    papeis: ["angulo"], prazo_min: 10, nota: "Mais barato. Elevação de 0 a 60 (sem câmera de baixo). Nomes dos campos a conferir no primeiro uso.",
  },
  // ------------------------------------------------------------------ imagem (still, packshot, antes e depois de uma foto)
  {
    id: "imagem-do-painel", rotulo: "Modelo de imagem do painel", familia: "imagem", linha: "painel", versao: "1", principal: true, provedor: "painel", chave_env: "",
    endpoints: {}, dialeto: "painel", duracoes: [0], resolucoes: ["padrao"], resolucao_padrao: "padrao", formatos: TODOS,
    cap: cap({ primeiro_quadro: true, referencias: 4, pessoa_real: true }),
    preco: null, papeis: ["imagem"], prazo_min: 5, nota: "O mesmo modelo de imagem escolhido no painel (ia_modelos, padrão imagem), pelo motor de IA e a carteira do cliente.",
  },
];

// ------------------------------------------------------------------ consultas ao catálogo

export const motorPorId = (id: string | null | undefined, motores: MotorDeVideo[] = MOTORES_DE_VIDEO): MotorDeVideo | null => (id ? motores.find((m) => m.id === id) || null : null);

export function duracoesDoMotor(m: MotorDeVideo): number[] {
  const d = m.duracoes;
  if (Array.isArray(d)) return d.slice();
  const s: number[] = [];
  for (let i = d.min; i <= d.max; i++) s.push(i);
  return s;
}

/** A duração pedida no que o motor aceita (a mais próxima). */
export function duracaoNoMotor(m: MotorDeVideo, segundos: number): number {
  const l = duracoesDoMotor(m);
  const s = isFinite(segundos) ? segundos : l[0];
  let melhor = l[0];
  l.forEach((x) => {
    if (Math.abs(x - s) < Math.abs(melhor - s)) melhor = x;
  });
  return melhor;
}

export const resolucaoNoMotor = (m: MotorDeVideo, r: string | null | undefined) => (r && m.resolucoes.indexOf(r) >= 0 ? r : m.resolucao_padrao);

export interface CustoDoMotor {
  usd: number | null;
  detalhe: string;
  incerto: boolean;
}

const arred4 = (n: number) => Math.round(n * 10000) / 10000;
const valorDaTabela = (t: Record<string, number> | undefined, r: string): number | null => {
  if (!t) return null;
  if (typeof t[r] === "number") return t[r];
  if (typeof t.padrao === "number") return t.padrao;
  return null;
};

/** Custo pela tabela do motor (antes de gerar). null = sem cotação: não gera. */
export function custoDoMotor(m: MotorDeVideo, e: { duracao_s?: number; resolucao?: string | null; audio?: boolean; variacoes?: number; referencias?: number }): CustoDoMotor {
  const p = m.preco;
  const n = Math.max(1, Math.min(4, Math.round(e.variacoes || 1)));
  if (!p) return { usd: null, detalhe: m.familia === "imagem" ? "custo do modelo de imagem do painel" : "sem preço conferido", incerto: true };
  const extraRef = p.por_referencia ? p.por_referencia * Math.max(0, e.referencias || 0) : 0;
  if (typeof p.por_imagem === "number") return { usd: arred4((p.por_imagem + extraRef) * n), detalhe: `US$ ${p.por_imagem} por imagem x ${n}`, incerto: !!p.incerto };
  if (typeof p.por_video === "number") return { usd: arred4((p.por_video + extraRef) * n), detalhe: `US$ ${p.por_video} por vídeo x ${n}`, incerto: !!p.incerto };
  const r = resolucaoNoMotor(m, e.resolucao);
  const d = duracaoNoMotor(m, e.duracao_s || 5);
  const comAudio = !!e.audio && m.cap.audio;
  const comAudioTaxa = comAudio ? valorDaTabela(p.por_segundo_audio, r) : null;
  const taxa = comAudioTaxa !== null ? comAudioTaxa : valorDaTabela(p.por_segundo, r);
  if (taxa === null) return { usd: null, detalhe: `sem preço para ${r}`, incerto: true };
  return { usd: arred4((taxa * d + extraRef) * n), detalhe: `US$ ${taxa}/s x ${d} s${n > 1 ? ` x ${n}` : ""} (${r}${comAudio ? ", com áudio" : ""})`, incerto: !!p.incerto };
}

/** "US$ 0,47" ("~" quando o preço é estimado; "Sem cotação" sem preço). */
export function textoDoCusto(c: Pick<CustoDoMotor, "usd" | "incerto">): string {
  if (c.usd === null) return "Sem cotação";
  return `${c.incerto ? "~" : ""}US$ ${c.usd.toFixed(c.usd < 0.1 ? 3 : 2).replace(".", ",")}`;
}

// ------------------------------------------------------------------ estado (servidor)

export type EstadoDoMotor = "pronto" | "precisa_chave" | "a_integrar" | "encerrado" | "desligado" | "sem_preco";

export const ROTULO_DO_ESTADO_DO_MOTOR: Record<EstadoDoMotor, string> = {
  pronto: "Pronto",
  precisa_chave: "Precisa de chave",
  a_integrar: "A integrar",
  encerrado: "Encerrado",
  desligado: "Desligado",
  sem_preco: "Sem preço conferido",
};

/** Nomes dos segredos que o motor pede e que não existem (nunca o valor). */
export function chavesQueFaltam(m: MotorDeVideo, temChave: (nome: string) => boolean): string[] {
  if (m.provedor === "painel") return [];
  return [m.chave_env, m.segredo_env || ""].filter((n) => !!n && !temChave(n));
}

/** Estado do motor: a função só sabe se a chave EXISTE (nunca o valor). */
export function estadoDoMotor(m: MotorDeVideo, e: { temChave: (nome: string) => boolean; desligados?: string[] }): EstadoDoMotor {
  if (m.situacao === "encerrado") return "encerrado";
  if (m.situacao === "a_integrar") return "a_integrar";
  if ((e.desligados || []).indexOf(m.id) >= 0) return "desligado";
  if (m.provedor !== "painel" && (!m.chave_env || chavesQueFaltam(m, e.temChave).length)) return "precisa_chave";
  if (m.provedor !== "painel" && !m.preco) return "sem_preco";
  return "pronto";
}

/**
 * Valor cobrado de UMA variação pronta. Regra geral: o valor por variação
 * confirmado. Avatar (HeyGen) cobra pela duração real do vídeo: a tabela
 * vezes os segundos reais, nunca mais que o confirmado.
 */
export function custoDaVariacaoPronta(m: MotorDeVideo | null, porVariacao: number, duracaoReal: number | null | undefined, resolucao?: string | null): number {
  const teto = Math.max(0, Number(porVariacao) || 0);
  if (!m || m.familia !== "avatar" || typeof duracaoReal !== "number" || !isFinite(duracaoReal) || duracaoReal <= 0) return teto;
  const c = custoDoMotor(m, { duracao_s: Math.ceil(duracaoReal), resolucao: resolucao || null });
  return c.usd === null ? teto : Math.min(teto, c.usd);
}

// ------------------------------------------------------------------ níveis

/** Versão ordenável ("2.5" > "2.0"; "2511" > "2509"; letras contam como 0). */
export function compararVersao(a: string, b: string): number {
  const pa = String(a || "").split(/[^0-9]+/).filter(Boolean).map(Number);
  const pb = String(b || "").split(/[^0-9]+/).filter(Boolean).map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0;
    const y = pb[i] || 0;
    if (x !== y) return x - y;
  }
  return 0;
}

const usavel = (m: MotorDeVideo) => !m.situacao && (m.provedor === "painel" || !!m.preco);

/**
 * Nível de cada motor: Top = a versão mais nova (variante principal) de cada
 * linha, entre os que têm preço; Rápido = marcados como rascunho; o resto é
 * Normal. Motor novo sem preço conferido nunca vira Top.
 */
export function nivelDoMotor(m: MotorDeVideo, motores: MotorDeVideo[] = MOTORES_DE_VIDEO): NivelDoMotor {
  if (m.rapido) return "rapido";
  if (!m.principal || !usavel(m)) return "normal";
  const irmaos = motores.filter((x) => x.linha === m.linha && x.principal && !x.rapido && usavel(x));
  const topo = irmaos.reduce<MotorDeVideo | null>((t, x) => (!t || compararVersao(x.versao, t.versao) > 0 ? x : t), null);
  return topo && topo.id === m.id ? "top" : "normal";
}

export const ROTULO_DO_NIVEL: Record<NivelDoMotor, string> = { normal: "Normal", top: "Top", rapido: "Rápido" };

/** Ordem de preferência das linhas no Top (a linha escolhe; a versão sai do catálogo). */
export const ORDEM_DAS_LINHAS_TOP = ["seedance", "veo", "kling", "minimax-h3", "wan", "flux3", "gemini-omni", "happyhorse", "grok", "ltx", "pixverse", "hailuo", "hunyuan", "qwen-angulos", "flux2-angulos", "painel"];

export interface RequisitoDoPedido {
  modo: "texto" | "primeiro_quadro" | "primeiro_ultimo" | "referencia" | "estender" | "imagem" | "angulo" | "avatar";
  audio?: boolean;
  pessoa_real?: boolean;
  referencias?: number;
  formato?: string;
}

/** O motor atende ao pedido? (capacidade, formato, pessoa real) */
export function atende(m: MotorDeVideo, r: RequisitoDoPedido): boolean {
  if (r.modo === "angulo") return m.familia === "angulo";
  if (r.modo === "imagem") return m.familia === "imagem";
  if (r.modo === "avatar") return m.familia === "avatar" && (!r.formato || m.formatos.indexOf(r.formato) >= 0) && (!r.pessoa_real || m.cap.pessoa_real);
  if (m.familia !== "video") return false;
  const c = m.cap;
  if (r.modo === "texto" && !c.texto) return false;
  if (r.modo === "primeiro_quadro" && !c.primeiro_quadro) return false;
  if (r.modo === "primeiro_ultimo" && !c.ultimo_quadro) return false;
  if (r.modo === "referencia" && c.referencias < Math.max(1, r.referencias || 1)) return false;
  if (r.modo === "estender" && !c.estender) return false;
  if (r.audio && !c.audio) return false;
  if (r.pessoa_real && !c.pessoa_real) return false;
  if (r.formato && m.formatos.indexOf(r.formato) < 0) return false;
  return true;
}

/** Preço de comparação: 5 s na resolução padrão. */
const precoDeComparacao = (m: MotorDeVideo) => {
  const c = custoDoMotor(m, { duracao_s: 5 });
  return c.usd === null ? Infinity : c.usd;
};

/**
 * Motor do nível para o pedido: Top = linha preferida que atende (a versão
 * mais nova com preço); Normal = o mais barato que atende (fora os
 * rascunhos); Rápido = o rascunho mais barato que atende.
 */
export function motorDoNivel(nivel: NivelDoMotor, r: RequisitoDoPedido, motores: MotorDeVideo[] = MOTORES_DE_VIDEO, prontos?: string[]): MotorDeVideo | null {
  // Motor de escolha manual (Runway, Higgsfield, HeyGen) nunca vira a sugestão sozinho.
  const ok = motores.filter((m) => usavel(m) && !m.escolha_manual && atende(m, r) && (!prontos || prontos.indexOf(m.id) >= 0));
  if (nivel === "top") {
    const tops = ok.filter((m) => nivelDoMotor(m, motores) === "top");
    const ordenados = tops.slice().sort((a, b) => {
      const ia = ORDEM_DAS_LINHAS_TOP.indexOf(a.linha);
      const ib = ORDEM_DAS_LINHAS_TOP.indexOf(b.linha);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
    return ordenados[0] || null;
  }
  const lista = ok.filter((m) => (nivel === "rapido" ? nivelDoMotor(m, motores) === "rapido" : nivelDoMotor(m, motores) !== "rapido"));
  const ordem = lista.slice().sort((a, b) => precoDeComparacao(a) - precoDeComparacao(b));
  return ordem[0] || (nivel === "rapido" ? motorDoNivel("normal", r, motores, prontos) : null);
}

/** Motor do papel da cena de um kit (hero, fala, transicao...). */
export function motorDoPapel(papel: PapelDoMotor, motores: MotorDeVideo[] = MOTORES_DE_VIDEO, modo?: string): MotorDeVideo | null {
  const m = (modo || "primeiro_quadro") as RequisitoDoPedido["modo"];
  switch (papel) {
    case "imagem":
      return motorDoNivel("top", { modo: "imagem" }, motores);
    case "angulo":
      return motorDoNivel("top", { modo: "angulo" }, motores);
    case "rascunho":
      return motorDoNivel("rapido", { modo: m === "imagem" ? "primeiro_quadro" : m }, motores);
    case "barato":
      return motorDoNivel("normal", { modo: m }, motores);
    case "transicao":
      return motorDoNivel("normal", { modo: "primeiro_ultimo" }, motores);
    case "fala": {
      // Fala em português: o Veo fala melhor; depois Kling e Seedance (a linha manda, a versão sai do catálogo).
      const req: RequisitoDoPedido = { modo: m === "referencia" ? "primeiro_quadro" : m, audio: true };
      for (const linha of ["veo", "kling", "seedance"]) {
        const x = motorDoNivel("top", req, motores.filter((mo) => mo.linha === linha));
        if (x) return x;
      }
      return motorDoNivel("top", { modo: m, audio: true }, motores);
    }
    case "movimento":
      return motorDoNivel("top", { modo: m }, motores.filter((x) => x.linha === "kling" || x.linha === "minimax-h3")) || motorDoNivel("top", { modo: m }, motores);
    case "consistencia":
      return motorDoNivel("top", { modo: m }, motores) || motorDoNivel("top", { modo: "primeiro_quadro" }, motores);
    default:
      return motorDoNivel("top", { modo: m }, motores);
  }
}

// ------------------------------------------------------------------ sincronização com o provedor

/** Como reconhecer a linha e a versão de um endpoint da lista pública do fal. */
export const LINHAS_DO_FAL: { linha: string; re: RegExp; base: string; rotulo: (v: string) => string }[] = [
  { linha: "seedance", re: /^bytedance\/seedance-([0-9.]+)\/(text-to-video|image-to-video|reference-to-video)$/, base: "seedance-2.5", rotulo: (v) => `Seedance ${v}` },
  { linha: "kling", re: /^fal-ai\/kling-video\/v([0-9.]+)\/pro\/(text-to-video|image-to-video)$/, base: "kling-3-pro", rotulo: (v) => `Kling ${v} Pro` },
  { linha: "veo", re: /^fal-ai\/veo([0-9.]+)\/(image-to-video|first-last-frame-to-video|reference-to-video)$/, base: "veo-3.1", rotulo: (v) => `Veo ${v}` },
  { linha: "wan", re: /^alibaba\/wan-([0-9.]+)\/(text-to-video|image-to-video|reference-to-video)$/, base: "wan-3.0", rotulo: (v) => `Wan ${v}` },
  { linha: "minimax-h3", re: /^minimax\/h([0-9.]+)-max\/(text-to-video|image-to-video)$/, base: "minimax-h3-max", rotulo: (v) => `MiniMax H${v} Max` },
  { linha: "ltx", re: /^fal-ai\/ltx-([0-9.]+)\/(text-to-video|image-to-video)$/, base: "ltx-2.3", rotulo: (v) => `LTX-${v} Pro` },
  { linha: "gemini-omni", re: /^google\/gemini-omni-flash\/v([0-9.]+)\/(text-to-video|image-to-video|reference-to-video)$/, base: "gemini-omni-flash-1.1", rotulo: (v) => `Gemini Omni Flash ${v}` },
  { linha: "grok", re: /^xai\/grok-imagine-video\/v([0-9.]+)\/(image-to-video)$/, base: "grok-imagine-1.5", rotulo: (v) => `Grok Imagine Vídeo ${v}` },
  { linha: "qwen-angulos", re: /^fal-ai\/qwen-image-edit-([0-9]+)-multiple-angles()$/, base: "qwen-angulos-2511", rotulo: (v) => `Qwen Edit ${v} Ângulos` },
];

export interface ModeloDoProvedor {
  endpoint_id: string;
  status?: string | null;
}

/** Linha do banco (video_motores): o que a sincronização achou ou o dono mudou. */
export interface LinhaDoCatalogoDeVideo {
  id: string;
  linha: string;
  versao: string;
  rotulo: string;
  endpoints: MotorDeVideo["endpoints"];
  preco: PrecoDoMotor | null;
  novo: boolean;
  disponivel: boolean;
  ativo: boolean;
}

/**
 * Lê a lista pública do provedor e devolve as versões de linhas conhecidas
 * que o catálogo ainda não tem (novas: sem preço, marcadas "novo") e os
 * motores do catálogo que o provedor tirou (só com a lista completa).
 */
export function novidadesDoProvedor(lista: ModeloDoProvedor[], motores: MotorDeVideo[] = MOTORES_DE_VIDEO, completa = false): { novos: LinhaDoCatalogoDeVideo[]; sumiram: string[] } {
  const porVersao: Record<string, LinhaDoCatalogoDeVideo> = {};
  const ativos: string[] = [];
  (lista || []).forEach((x) => {
    const id = String((x && x.endpoint_id) || "");
    if (!id || x.status === "deprecated") return;
    ativos.push(id);
    LINHAS_DO_FAL.forEach((l) => {
      const m = l.re.exec(id);
      if (!m) return;
      const versao = m[1];
      const tipo = m[2] || "";
      if (motores.some((mo) => mo.linha === l.linha && mo.principal && compararVersao(mo.versao, versao) === 0)) return;
      const base = motorPorId(l.base, motores);
      const chave = `${l.linha}:${versao}`;
      if (!porVersao[chave]) porVersao[chave] = { id: `${l.linha}-${versao}`, linha: l.linha, versao, rotulo: l.rotulo(versao), endpoints: {}, preco: null, novo: true, disponivel: true, ativo: true };
      const e = porVersao[chave].endpoints;
      if (tipo === "text-to-video") e.texto = id;
      else if (tipo === "image-to-video") {
        e.imagem = id;
        if (base && base.cap.ultimo_quadro && base.endpoints.ultimo === base.endpoints.imagem) e.ultimo = id;
      } else if (tipo === "first-last-frame-to-video") e.ultimo = id;
      else if (tipo === "reference-to-video") e.referencia = id;
      else if (!tipo) e.angulo = id;
    });
  });
  const sumiram: string[] = [];
  if (completa) {
    motores.forEach((m) => {
      if (m.provedor !== "fal" || m.situacao) return;
      const eps = [m.endpoints.imagem, m.endpoints.texto, m.endpoints.angulo].filter((x): x is string => !!x);
      if (eps.length && eps.every((ep) => ativos.indexOf(ep) < 0)) sumiram.push(m.id);
    });
  }
  return { novos: Object.keys(porVersao).map((k) => porVersao[k]), sumiram };
}

/**
 * Catálogo em uso = código + banco. Linha do banco com o id de um motor do
 * código só desliga (ativo false) ou marca indisponível. Linha nova vira
 * motor (herda capacidades e dialeto da versão anterior da linha); com preço
 * conferido e sendo a mais nova, vira o Top sozinha. Sem preço: aparece como
 * "novo, sem preço" e não gera.
 */
export function catalogoEmUso(banco: LinhaDoCatalogoDeVideo[] | null | undefined, motores: MotorDeVideo[] = MOTORES_DE_VIDEO): { motores: MotorDeVideo[]; desligados: string[] } {
  const desligados: string[] = [];
  const saida = motores.slice();
  (banco || []).forEach((l) => {
    const doCodigo = motores.find((m) => m.id === l.id);
    if (doCodigo) {
      if (!l.ativo || !l.disponivel) desligados.push(doCodigo.id);
      return;
    }
    const irmaos = motores.filter((m) => m.linha === l.linha && m.principal && !m.situacao);
    const base = irmaos.reduce<MotorDeVideo | null>((t, x) => (!t || compararVersao(x.versao, t.versao) > 0 ? x : t), null);
    if (!base) return;
    const temPreco = !!(l.preco && (l.preco.por_segundo || typeof l.preco.por_video === "number" || typeof l.preco.por_imagem === "number"));
    const novo: MotorDeVideo = {
      ...base,
      id: l.id,
      rotulo: l.rotulo || `${base.rotulo} ${l.versao}`,
      versao: l.versao,
      endpoints: { ...l.endpoints },
      preco: temPreco ? l.preco : null,
      novo: l.novo,
      documentado: undefined,
      nota: `Versão nova achada na lista do provedor. Capacidades herdadas de ${base.rotulo}: conferir no primeiro uso.`,
    };
    if (!l.ativo || !l.disponivel) desligados.push(novo.id);
    saida.push(novo);
  });
  return { motores: saida, desligados };
}
