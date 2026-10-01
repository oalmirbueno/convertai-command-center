/**
 * Trocar o cenário com a pessoa fixa (frente TCN, rodada 3 parte 1, 01/10/2026).
 *
 * Mesa Edição: a pessoa escolhe um vídeo (clipe da edição ou do acervo),
 * descreve o cenário (ou toca num da galeria, que é atalho e não limite),
 * escolhe a qualidade, vê a AMOSTRA barata (quadro de amostra, centavos) e
 * só então paga a final. O resultado entra como clipe novo, com Desfazer.
 *
 * Qualidades (preços conferidos AO VIVO nas páginas do fal e na API da Runway
 * em 01/10/2026; pesquisa em C:\AI\acervo-aceleriq\rodada3-materiais\analise):
 * - Rápido (padrão): a pessoa 100% original. Recorte por matting de vídeo
 *   (Bria Video Background Removal v3, alfa em WebM VP9, US$ 0,05/s) sobre o
 *   fundo limpo tirado da amostra escolhida (imagem, centavos), com luz e cor
 *   casadas no worker de render (ffmpeg). Reel de 30 s ~US$ 1,55.
 * - Cinema: vídeo para vídeo, regera o cenário mantendo a pessoa. Kling O3
 *   Edit Standard (US$ 0,126/s, entrada de 3 a 15 s, aceita a amostra como
 *   @Image1, mantém o áudio). Escolhido no lugar do Gemini Omni Edit (US$ 0,10/s
 *   em 720p, sem imagem de referência) porque a amostra que a pessoa escolheu
 *   entra como referência: a final sai parecida com o que ela aprovou.
 *   O Omni fica no catálogo (MOTORES_DA_TROCA) para quem quiser trocar.
 * - Aleph: Runway Aleph 2 (POST /v1/video_to_video, model "aleph2", até 30 s,
 *   US$ 0,28/s), com a amostra como quadro-chave no segundo 0. Só com a chave
 *   da Runway (Configurações › Chaves e custos).
 *
 * Caminho de toda final (sem laço, sem segurar a função):
 *   preparar (worker: corta o trecho, 30 qps, lado menor 720 a 1080, H.264)
 *   -> envios ao provedor (fila do fal ou tarefa da Runway; coleta de 1 min)
 *   -> compor (worker: pessoa sobre o fundo, ou a versão da IA, 1/2/3 faixas,
 *      sempre com o ÁUDIO ORIGINAL) -> pronto (arquivo na Mídia).
 *
 * Puro: sem Deno, sem banco, sem rede. A função, a tela e os testes usam o mesmo.
 */

export type QualidadeDaTroca = "rapido" | "cinema" | "aleph";
export type LayoutDaTroca = "cheio" | "duas_faixas" | "tres_faixas";
export type PapelDoEnvio = "recorte" | "cinema" | "aleph";
export type EstadoDaTroca = "amostrando" | "amostra" | "preparando" | "gerando" | "compondo" | "pronto" | "erro" | "descartado";

export const QUALIDADES_DA_TROCA: QualidadeDaTroca[] = ["rapido", "cinema", "aleph"];
export const LAYOUTS_DA_TROCA: LayoutDaTroca[] = ["cheio", "duas_faixas", "tres_faixas"];
export const ESTADOS_EM_ANDAMENTO: EstadoDaTroca[] = ["preparando", "gerando", "compondo"];

export interface QualidadeInfo {
  id: QualidadeDaTroca;
  rotulo: string;
  /** Uma linha para o "?". */
  nota: string;
  /** Duração aceita do trecho (s). */
  min_s: number;
  max_s: number;
  /** Segredo de que depende (só o nome). */
  chave: string;
}

export const INFO_DAS_QUALIDADES: Record<QualidadeDaTroca, QualidadeInfo> = {
  rapido: { id: "rapido", rotulo: "Rápido", nota: "A pessoa fica 100% original (recorte) sobre o cenário novo, com luz e cor casadas. Troca só o fundo.", min_s: 1, max_s: 60, chave: "FAL_KEY" },
  cinema: { id: "cinema", rotulo: "Cinema", nota: "A IA refaz o vídeo com o cenário novo e mantém a pessoa (Kling O3). Luz mais coerente; o rosto pode variar um pouco.", min_s: 3, max_s: 15, chave: "FAL_KEY" },
  aleph: { id: "aleph", rotulo: "Aleph", nota: "Runway Aleph 2: a edição de vídeo mais forte, mais cara. Usa a amostra como quadro-chave.", min_s: 2, max_s: 30, chave: "RUNWAYML_API_SECRET" },
};

export const ROTULO_DO_LAYOUT: Record<LayoutDaTroca, string> = {
  cheio: "Só o novo",
  duas_faixas: "2 faixas",
  tres_faixas: "3 faixas",
};

export const NOTA_DO_LAYOUT: Record<LayoutDaTroca, string> = {
  cheio: "O vídeo com o cenário novo, no formato do trecho.",
  duas_faixas: "Antes e depois: IA em cima, original embaixo, no formato do projeto.",
  tres_faixas: "Recorte (máscara), IA e original, uma faixa cada.",
};

/** Motores da troca (tabela própria: não entram na lista do gerador da Mesa Vídeos). */
export interface MotorDaTroca {
  id: string;
  papel: PapelDoEnvio;
  rotulo: string;
  provedor: "fal" | "runway";
  /** Endpoint do fal ou rota da Runway. */
  endpoint: string;
  chave_env: string;
  /** US$ por segundo de saída. */
  por_segundo: number;
  /** Segundos mínimos cobrados (Aleph: 56 créditos = 2 s). */
  minimo_s: number;
  /** Minutos até o envio ficar "atrasado" (segue conferido até o teto de 24 h). */
  prazo_min: number;
  fonte: string;
  conferido_em: string;
}

const HOJE = "2026-10-01";

export const MOTORES_DA_TROCA: MotorDaTroca[] = [
  { id: "bria-vrmbg-3", papel: "recorte", rotulo: "Bria VRMBG 3.0 (recorte)", provedor: "fal", endpoint: "bria/video/background-removal/v3", chave_env: "FAL_KEY", por_segundo: 0.05, minimo_s: 1, prazo_min: 30, fonte: "https://fal.ai/models/bria/video/background-removal/v3", conferido_em: HOJE },
  { id: "kling-o3-edit-standard", papel: "cinema", rotulo: "Kling O3 Edit Standard", provedor: "fal", endpoint: "fal-ai/kling-video/o3/standard/video-to-video/edit", chave_env: "FAL_KEY", por_segundo: 0.126, minimo_s: 3, prazo_min: 40, fonte: "https://fal.ai/models/fal-ai/kling-video/o3/standard/video-to-video/edit", conferido_em: HOJE },
  { id: "gemini-omni-flash-1.1-edit", papel: "cinema", rotulo: "Gemini Omni Flash 1.1 Edit (720p)", provedor: "fal", endpoint: "google/gemini-omni-flash/v1.1/edit", chave_env: "FAL_KEY", por_segundo: 0.1, minimo_s: 1, prazo_min: 40, fonte: "https://fal.ai/models/google/gemini-omni-flash/v1.1/edit", conferido_em: HOJE },
  { id: "runway-aleph-2", papel: "aleph", rotulo: "Runway Aleph 2", provedor: "runway", endpoint: "video_to_video", chave_env: "RUNWAYML_API_SECRET", por_segundo: 0.28, minimo_s: 2, prazo_min: 40, fonte: "https://docs.dev.runwayml.com/api/#tag/Start-generating/paths/~1v1~1video_to_video/post", conferido_em: HOJE },
];

export const MOTOR_PADRAO_DO_PAPEL: Record<PapelDoEnvio, string> = {
  recorte: "bria-vrmbg-3",
  cinema: "kling-o3-edit-standard",
  aleph: "runway-aleph-2",
};

export function motorDaTroca(papel: PapelDoEnvio, id?: string | null): MotorDaTroca {
  const pedido = id ? MOTORES_DA_TROCA.find((m) => m.id === id && m.papel === papel) : null;
  return pedido || (MOTORES_DA_TROCA.find((m) => m.id === MOTOR_PADRAO_DO_PAPEL[papel]) as MotorDaTroca);
}

// ------------------------------------------------------------------ galeria (atalho, não limite)

export interface CenarioPronto {
  id: string;
  rotulo: string;
  /** Texto que vai para o campo (a pessoa pode editar depois). */
  texto: string;
  /** Duas cores para a miniatura (degradê, sem imagem de terceiro). */
  cores: [string, string];
}

export const GALERIA_DE_CENARIOS: CenarioPronto[] = [
  { id: "loja", rotulo: "Loja", texto: "loja moderna recém-reformada, prateleiras de madeira clara, iluminação quente de vitrine", cores: ["#d9b38c", "#5c4630"] },
  { id: "natal", rotulo: "Natal", texto: "loja decorada para o Natal, luzes douradas desfocadas, árvore e laços vermelhos ao fundo", cores: ["#b3261e", "#1f4d2b"] },
  { id: "fachada_noite", rotulo: "Fachada", texto: "calçada em frente a uma fachada comercial iluminada à noite, letreiro aceso desfocado, luz de rua quente", cores: ["#1b2440", "#f2a541"] },
  { id: "estudio", rotulo: "Estúdio", texto: "estúdio fotográfico com fundo infinito cinza claro e luz suave de janela lateral", cores: ["#e8e8e6", "#9a9a98"] },
  { id: "escritorio", rotulo: "Escritório", texto: "escritório moderno com plantas, mesa de madeira e janelas grandes com a cidade desfocada", cores: ["#c9d6cf", "#3e5a4f"] },
  { id: "cozinha", rotulo: "Cozinha", texto: "cozinha profissional de inox, panelas e vapor leve ao fundo, luz branca de restaurante", cores: ["#cfd8dc", "#455a64"] },
  { id: "praia", rotulo: "Praia", texto: "orla de praia no fim da tarde, sol baixo dourado atrás, mar e coqueiros desfocados", cores: ["#f6c177", "#2a6f97"] },
  { id: "cidade", rotulo: "Cidade", texto: "rua de cidade grande à noite com luzes de neon desfocadas (bokeh) e asfalto molhado", cores: ["#3a0ca3", "#f72585"] },
];

export const cenarioDaGaleria = (id: string | null | undefined): CenarioPronto | null => (id ? GALERIA_DE_CENARIOS.find((c) => c.id === id) || null : null);

// ------------------------------------------------------------------ o que cada final faz

export interface PassosDaFinal {
  envios: PapelDoEnvio[];
  /** O fundo limpo (sem a pessoa) sai da amostra escolhida: só o Rápido precisa. */
  placa: boolean;
  /** Toda final passa pelo worker para cortar e para compor (áudio original, layout). */
  preparar: true;
  compor: true;
}

export function passosDaFinal(q: QualidadeDaTroca, layout: LayoutDaTroca): PassosDaFinal {
  const envios: PapelDoEnvio[] = q === "rapido" ? ["recorte"] : q === "cinema" ? ["cinema"] : ["aleph"];
  // A faixa da máscara vem do mesmo recorte do Rápido; no Cinema e no Aleph ele é pedido a mais.
  if (layout === "tres_faixas" && envios.indexOf("recorte") < 0) envios.push("recorte");
  return { envios, placa: q === "rapido", preparar: true, compor: true };
}

// ------------------------------------------------------------------ custo

const arred4 = (n: number) => Math.round(n * 10000) / 10000;

export const duracaoDoTrecho = (entrada_s: number, saida_s: number) => Math.round(Math.max(0, saida_s - entrada_s) * 100) / 100;

/** Segundos cobrados (segundo começado conta inteiro; mínimo do motor). */
export const segundosCobrados = (m: Pick<MotorDaTroca, "minimo_s">, duracao_s: number) => Math.max(m.minimo_s, Math.ceil(Math.max(0, duracao_s) - 1e-6));

export function custoDoEnvio(papel: PapelDoEnvio, duracao_s: number, motorId?: string | null): { usd: number; detalhe: string } {
  const m = motorDaTroca(papel, motorId);
  const s = segundosCobrados(m, duracao_s);
  return { usd: arred4(m.por_segundo * s), detalhe: `${m.rotulo}: US$ ${m.por_segundo}/s x ${s} s` };
}

export interface ParteDoCusto {
  rotulo: string;
  usd: number;
}

export interface CustoDaTroca {
  usd: number;
  partes: ParteDoCusto[];
  detalhe: string;
}

const somar = (partes: ParteDoCusto[]): CustoDaTroca => ({ usd: arred4(partes.reduce((s, p) => s + p.usd, 0)), partes, detalhe: partes.map((p) => `${p.rotulo} US$ ${p.usd.toFixed(3)}`).join(" + ") });

/** Amostra: N quadros editados pelo modelo de imagem do painel (o valor por imagem vem da tabela do catálogo). */
export function custoDaAmostra(variacoes: number, porImagem: number): CustoDaTroca {
  const n = Math.max(1, Math.min(MAX_AMOSTRAS, Math.round(variacoes || 1)));
  return somar([{ rotulo: `${n} ${n === 1 ? "amostra" : "amostras"}`, usd: arred4(Math.max(0, porImagem) * n) }]);
}

/** Final: envios ao provedor + o fundo limpo (Rápido). O worker é da agência: US$ 0. */
export function custoDaFinal(q: QualidadeDaTroca, layout: LayoutDaTroca, duracao_s: number, porImagem: number, motores: Partial<Record<PapelDoEnvio, string>> = {}): CustoDaTroca {
  const p = passosDaFinal(q, layout);
  const partes: ParteDoCusto[] = p.envios.map((papel) => {
    const c = custoDoEnvio(papel, duracao_s, motores[papel]);
    return { rotulo: papel === "recorte" ? "recorte da pessoa" : papel === "cinema" ? "Cinema" : "Aleph", usd: c.usd };
  });
  if (p.placa) partes.push({ rotulo: "fundo limpo", usd: arred4(Math.max(0, porImagem)) });
  return somar(partes);
}

export const MAX_AMOSTRAS = 3;

// ------------------------------------------------------------------ validação

export function faltaNoTrecho(q: QualidadeDaTroca, entrada_s: number, saida_s: number): string | null {
  if (!isFinite(entrada_s) || !isFinite(saida_s) || entrada_s < 0 || saida_s <= entrada_s) return "Escolha o início e o fim do trecho.";
  const d = duracaoDoTrecho(entrada_s, saida_s);
  const i = INFO_DAS_QUALIDADES[q];
  if (d < i.min_s) return `${i.rotulo} precisa de pelo menos ${i.min_s} s de trecho.`;
  if (d > i.max_s + 0.05) return `${i.rotulo} aceita até ${i.max_s} s por vez. Escolha um trecho menor${q === "rapido" ? "" : " ou use o Rápido"}.`;
  return null;
}

export function limparCenario(t: unknown): string {
  return String(t ?? "").replace(/\s+/g, " ").trim().slice(0, 600);
}

// ------------------------------------------------------------------ pedidos aos modelos

/** Amostra: a mesma pessoa, cenário novo (a pessoa vê o resultado antes de pagar a final). */
export function promptDaAmostra(cenario: string): string {
  return [
    "Edit this exact video frame.",
    "Keep the person EXACTLY identical: same face, hair, skin, body, clothing, pose, hands, expression, same position and same size in the frame.",
    `Replace ONLY the background and setting with: ${cenario}.`,
    "Same camera angle, lens and perspective as the original; light on the background coming from the same direction as the light on the person; natural depth of field.",
    "Photorealistic. No text, no logos, no watermarks, no extra people.",
  ].join(" ");
}

/** Fundo limpo do Rápido: a amostra escolhida sem a pessoa (a pessoa original entra por cima). */
export function promptDaPlaca(): string {
  return [
    "Remove the person completely from this image and fill the space with the background that would be behind them, continuing the setting naturally.",
    "Keep everything else identical: setting, camera angle, perspective, light, colors and depth of field.",
    "No people, no text, no logos.",
  ].join(" ");
}

/** Cinema (Kling O3 Edit): molde de troca estrita (o que troca, com a referência; e a lista do que não muda). */
export function promptDoCinema(cenario: string): string {
  return [
    "Use @Video1 as the base footage.",
    `Replace only the background and setting with the scene shown in @Image1 (${cenario}).`,
    "Keep everything else completely unchanged: the person's appearance, face, hair, clothing, hand movements, facial expressions, lip movements, speech and the camera framing.",
    "Only the environment changes. Photorealistic, consistent across all frames.",
  ].join(" ").slice(0, 2400);
}

/** Gemini Omni Edit (sem imagem de referência). */
export function promptDoOmni(cenario: string): string {
  return `Replace only the background and setting with: ${cenario}. Keep the person, face, hair, clothing, gestures, lip movements, speech and the camera framing exactly the same.`.slice(0, 2400);
}

/** Aleph 2 (promptText até 1000 letras). */
export function promptDoAleph(cenario: string): string {
  return `Replace only the background and setting with ${cenario}, as shown in the keyframe. Keep the person, face, hair, clothing, gestures, lip movements and the camera exactly the same. Photorealistic.`.slice(0, 1000);
}

export interface EntradaDoEnvio {
  trecho_url: string;
  amostra_url: string | null;
  cenario: string;
  seed?: number | null;
}

/** Corpo do pedido de cada papel. Nada de chave aqui. */
export function corpoDoEnvio(papel: PapelDoEnvio, e: EntradaDoEnvio, motorId?: string | null): { motor: MotorDaTroca; corpo: Record<string, unknown> } {
  const m = motorDaTroca(papel, motorId);
  if (papel === "recorte") {
    return { motor: m, corpo: { video_url: e.trecho_url, background_color: "Transparent", output_container_and_codec: "webm_vp9", preserve_audio: false } };
  }
  if (papel === "cinema") {
    if (m.id === "gemini-omni-flash-1.1-edit") return { motor: m, corpo: { prompt: promptDoOmni(e.cenario), video_url: e.trecho_url, resolution: "720p" } };
    const corpo: Record<string, unknown> = { prompt: promptDoCinema(e.cenario), video_url: e.trecho_url, keep_audio: true };
    if (e.amostra_url) corpo.image_urls = [e.amostra_url];
    else corpo.prompt = promptDoOmni(e.cenario);
    return { motor: m, corpo };
  }
  const corpo: Record<string, unknown> = { model: "aleph2", videoUri: e.trecho_url, promptText: promptDoAleph(e.cenario), contentModeration: { publicFigureThreshold: "auto" } };
  if (e.amostra_url) corpo.keyframes = [{ uri: e.amostra_url, seconds: 0 }];
  if (typeof e.seed === "number" && isFinite(e.seed)) corpo.seed = Math.max(0, Math.min(4294967295, Math.floor(e.seed)));
  return { motor: m, corpo };
}

// ------------------------------------------------------------------ caminhos

export const pastaDaTroca = (clientId: string, id: string) => `${clientId}/video/cenarios/${id}`;

export const caminhoNaTroca = (clientId: string, id: string, nome: "trecho.mp4" | "placa.png" | "recorte.webm" | "ia.mp4" | "final.mp4" | string) => `${pastaDaTroca(clientId, id)}/${nome}`;

export const nomeDoResultado = (papel: PapelDoEnvio) => (papel === "recorte" ? "recorte.webm" : "ia.mp4");

// ------------------------------------------------------------------ máquina de estados (decisão pura)

export interface EnvioDaTroca {
  papel: PapelDoEnvio;
  motor: string;
  provedor: "fal" | "runway";
  endpoint: string;
  request_id: string;
  status_url: string;
  response_url: string;
  estado: "enviado" | "gerando" | "baixando" | "pronto" | "erro";
  enviado_em: string;
  consultado_em: string | null;
  posicao: number | null;
  erro: string | null;
  custo_previsto_usd: number;
  custo_usd: number | null;
  uso_id: string | null;
  storage_path: string | null;
  tentativas_de_baixar?: number;
}

export interface PassosDaTroca {
  preparo?: { render_id: string; estado?: string; trecho_path?: string | null; duracao_s?: number | null; largura?: number | null; altura?: number | null } | null;
  envios?: EnvioDaTroca[];
  composicao?: { render_id: string; estado?: string } | null;
  placa?: { path: string; custo_usd: number; uso_id: string | null } | null;
  /** Gancho do documento de entrega (frente DOC): resumo e provas. */
  resumo?: string | null;
}

export type ProximoPasso =
  | { passo: "esperar_preparo" }
  | { passo: "enviar" }
  | { passo: "consultar" }
  | { passo: "compor" }
  | { passo: "esperar_composicao" }
  | { passo: "erro"; motivo: string }
  | { passo: "nada" };

/**
 * O que fazer com a troca agora, a partir do estado gravado e do que o worker
 * respondeu (render: estado do pedido de preparo ou de composição). Nunca
 * manda refazer: erro do provedor ou do worker encerra com o motivo.
 */
export function proximoPasso(estado: EstadoDaTroca, passos: PassosDaTroca, render: { estado: string; erro?: string | null } | null): ProximoPasso {
  if (estado === "preparando") {
    if (!render) return { passo: "esperar_preparo" };
    if (render.estado === "pronto") return { passo: "enviar" };
    if (render.estado === "erro" || render.estado === "cancelado") return { passo: "erro", motivo: `A máquina de render não preparou o trecho${render.erro ? `: ${render.erro}` : ""}. Nada foi gerado no provedor.` };
    return { passo: "esperar_preparo" };
  }
  if (estado === "gerando") {
    const envios = passos.envios || [];
    if (!envios.length) return { passo: "enviar" };
    const comErro = envios.find((e) => e.estado === "erro");
    if (comErro) return { passo: "erro", motivo: comErro.erro || "O provedor não gerou." };
    if (envios.every((e) => e.estado === "pronto")) return { passo: "compor" };
    return { passo: "consultar" };
  }
  if (estado === "compondo") {
    if (!render) return { passo: "esperar_composicao" };
    if (render.estado === "pronto") return { passo: "nada" };
    if (render.estado === "erro" || render.estado === "cancelado") return { passo: "erro", motivo: `A composição na máquina de render falhou${render.erro ? `: ${render.erro}` : ""}. O que o provedor gerou está guardado; peça a final de novo para compor.` };
    return { passo: "esperar_composicao" };
  }
  return { passo: "nada" };
}

/** Custo já registrado da troca (amostras, fundo e envios cobrados). */
export function custoRegistrado(amostras: { custo_usd?: number | null }[], passos: PassosDaTroca): number {
  const a = (amostras || []).reduce((s, x) => s + (Number(x.custo_usd) || 0), 0);
  const p = passos.placa ? Number(passos.placa.custo_usd) || 0 : 0;
  const e = (passos.envios || []).reduce((s, x) => s + (x.uso_id ? Number(x.custo_usd) || 0 : 0), 0);
  return arred4(a + p + e);
}

/** Texto curto do estado para a tela. */
export function textoDoEstado(estado: EstadoDaTroca, passos: PassosDaTroca): string {
  if (estado === "amostrando") return "Gerando as amostras";
  if (estado === "amostra") return "Escolha a amostra";
  if (estado === "preparando") return "Preparando o trecho na máquina";
  if (estado === "gerando") {
    const e = passos.envios || [];
    const prontos = e.filter((x) => x.estado === "pronto").length;
    return e.length > 1 ? `Gerando (${prontos} de ${e.length})` : "Gerando no provedor";
  }
  if (estado === "compondo") return "Montando na máquina";
  if (estado === "pronto") return "Pronto";
  if (estado === "descartado") return "Descartado";
  return "Não deu";
}
