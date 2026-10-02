import { chamarMesaVideos, type ArquivoDeVideo } from "@/components/mesa-videos/videosApi";
import { ErroDaMesa } from "@/lib/mesa/api";
import { lerFalaDaEntrada } from "@/lib/editor/fala";
import { acharLegenda, type LegendaAchada, type QuadroEmLuma } from "../../../supabase/functions/mesa-videos/modulos/deteccao-de-legenda";
import type { AcaoDoTratamento, NivelDaMelhora, RegiaoDaLegenda } from "../../../supabase/functions/mesa-videos/modulos/tratamento-de-video";
import type { LinhaDaLegenda, OrigemDaLegenda } from "../../../supabase/functions/mesa-videos/modulos/legenda-do-final";

/**
 * Ações da Mesa Edição (02/10/2026) com nomes claros, para a tela e para o
 * AGENTE EDITOR chamar (o integrador liga no agente; aqui nada depende dele):
 *
 * - organizarEntrada(clientId, { arquivarRuido? }): propõe pastas, nomes,
 *   melhor take e (se pedido) o ruído para arquivar. Devolve o cartão
 *   (mensagem_id + acao) do contrato comum: confirmar com
 *   `executar_acao_agente` e desfazer com `desfazer_acao_agente` (mesa-videos).
 * - proporEspelhoNoWorkspace / confirmarEspelhoNoWorkspace / desfazerEspelhoNoWorkspace:
 *   a mesma organização no Workspace do cliente (só move e renomeia o que já
 *   está lá; nunca copia nem apaga).
 * - gerarLegendaDoFinal(arquivoId, palavras?): SRT e VTT do vídeo pronto; sem
 *   fala no projeto devolve `precisa_transcrever` e o custo.
 * - gravarLegendaNoVideo(arquivoId, linhas, estilo): registra a versão com a
 *   legenda gravada (a tela pede o render dela pelo editor-video).
 * - acharLegendaNoVideo(url): acha a faixa da legenda gravada (sem custo).
 * - amostraDoTratamento / videoInteiroDoTratamento / statusDosTratamentos:
 *   tirar legenda e melhorar qualidade (amostra com custo antes, depois o inteiro).
 */

// ------------------------------------------------------------------ organizar

export interface ResultadoDaOrganizacao {
  mensagem_id: string | null;
  acao: unknown;
  leitura: { modo: "um_video" | "varios_clipes" | "sem_gravacao"; principal: string | null; brutos: number; resumo: string };
  prefixo: string | null;
  cenas: { numero: number; ids: string[]; por: string }[];
  ruido: number;
  jev: { perguntas: number; respondidas: number; erro: string | null };
}

/** Falas que este navegador guardou por take (Transcrição da Entrada), em texto. */
export function falasGuardadas(clientId: string, arquivos: Pick<ArquivoDeVideo, "id">[]): Record<string, string> {
  const saida: Record<string, string> = {};
  arquivos.forEach((a) => {
    const f = lerFalaDaEntrada(clientId, a.id);
    if (f && f.length) saida[a.id] = f.map((w) => w.t).join(" ").slice(0, 4000);
  });
  return saida;
}

export function organizarEntrada(clientId: string, o: { arquivarRuido?: boolean; falas?: Record<string, string>; melhores?: boolean } = {}): Promise<ResultadoDaOrganizacao> {
  return chamarMesaVideos<ResultadoDaOrganizacao>({ acao: "entrada_organizar_propor", client_id: clientId, falas: o.falas || {}, arquivar_ruido: o.arquivarRuido === true, melhores: o.melhores !== false });
}

// ------------------------------------------------------------------ espelho no Workspace

export interface PlanoDoEspelhoNaTela {
  raiz_id: string | null;
  raiz_nome: string;
  grupos: { caminho: string[]; itens: { id: string; nome: string; ordem?: number | null }[] }[];
  pares: { arquivo_id: string; no_id: string; de: string; para: string }[];
  so_na_mesa: number;
  so_no_workspace: number;
}

export const proporEspelhoNoWorkspace = (clientId: string) => chamarMesaVideos<{ plano: PlanoDoEspelhoNaTela; videos_no_workspace: number }>({ acao: "workspace_espelho_propor", client_id: clientId });

export const confirmarEspelhoNoWorkspace = (clientId: string, grupos: PlanoDoEspelhoNaTela["grupos"]) =>
  chamarMesaVideos<{ registro: unknown; movidos: number; renomeados: number; pastas_criadas: number; falhas: { id: string; nome: string; motivo: string }[] }>({ acao: "workspace_espelho_confirmar", client_id: clientId, grupos });

export const desfazerEspelhoNoWorkspace = (clientId: string, registro: unknown) =>
  chamarMesaVideos<{ restaurados: number; pulados: { motivo: string }[] }>({ acao: "workspace_espelho_desfazer", client_id: clientId, registro });

// ------------------------------------------------------------------ legenda do vídeo pronto

export interface LegendaGerada {
  linhas: LinhaDaLegenda[];
  origem: OrigemDaLegenda | null;
  srt?: string;
  vtt?: string;
  urls?: { srt: string | null; vtt: string | null };
  /** Caminhos no bucket mesa (ao lado do vídeo). */
  caminhos?: { srt: string; vtt: string };
  /** A legenda também foi para o Workspace (Vídeos / título / Finais). */
  workspace?: { estado: string; pasta_id: string | null };
  precisa_transcrever: boolean;
  custo_transcricao_usd?: number;
  duracao_s?: number | null;
}

export const gerarLegendaDoFinal = (arquivoId: string, palavras?: { t: string; i: number; f: number }[]) =>
  chamarMesaVideos<LegendaGerada>({ acao: "final_legenda_gerar", arquivo_id: arquivoId, ...(palavras && palavras.length ? { palavras } : {}) });

export const gravarLegendaNoVideo = (arquivoId: string, linhas: LinhaDaLegenda[], estilo: "simples" | "caixa" = "simples") =>
  chamarMesaVideos<{ versao: { id: string; numero: number; titulo: string; projeto?: { revisao?: number } | null } }>({ acao: "final_legenda_versao", arquivo_id: arquivoId, linhas, estilo });

// ------------------------------------------------------------------ achar a legenda gravada

function esperar(el: HTMLVideoElement, evento: string, ms: number): Promise<void> {
  return new Promise((ok, falha) => {
    const t = window.setTimeout(() => {
      el.removeEventListener(evento, fim);
      falha(new Error("O vídeo demorou para responder."));
    }, ms);
    function fim() {
      window.clearTimeout(t);
      el.removeEventListener(evento, fim);
      ok();
    }
    el.addEventListener(evento, fim);
  });
}

/** Tempos dos quadros de amostra: espalhados entre 5% e 95% do vídeo (ou da janela pedida). */
export function temposDasAmostras(duracao: number, n = 8, inicio = 0, fim?: number): number[] {
  const a = Math.max(0, inicio);
  const b = Math.min(duracao, fim === undefined ? duracao : fim);
  if (!(b > a)) return [0];
  return Array.from({ length: n }, (_, k) => Math.round((a + (b - a) * (0.05 + (0.9 * k) / Math.max(1, n - 1))) * 1000) / 1000);
}

/**
 * Quadros pequenos (luminância) e um quadro de vista (JPEG) do vídeo, no
 * navegador. O vídeo precisa permitir leitura (URL assinada do Storage permite).
 */
export async function quadrosDoVideo(url: string, o: { n?: number; largura?: number; inicio?: number; fim?: number } = {}): Promise<{ quadros: QuadroEmLuma[]; vista: string | null; tempoDaVista: number; duracao: number; largura: number; altura: number }> {
  const el = document.createElement("video");
  el.crossOrigin = "anonymous";
  el.muted = true;
  el.preload = "auto";
  el.setAttribute("playsinline", "");
  el.src = url;
  try {
    await esperar(el, "loadeddata", 20000);
    const W = el.videoWidth;
    const H = el.videoHeight;
    if (!W || !H) throw new Error("O vídeo não tem imagem.");
    const largura = Math.min(o.largura || 192, W);
    const altura = Math.max(2, Math.round((H * largura) / W));
    const c = document.createElement("canvas");
    c.width = largura;
    c.height = altura;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("O navegador não desenhou o quadro.");
    const tempos = temposDasAmostras(el.duration, o.n || 8, o.inicio || 0, o.fim);
    const quadros: QuadroEmLuma[] = [];
    let vista: string | null = null;
    let tempoDaVista = 0;
    for (const t of tempos) {
      el.currentTime = t;
      await esperar(el, "seeked", 15000);
      ctx.drawImage(el, 0, 0, largura, altura);
      const px = ctx.getImageData(0, 0, largura, altura).data;
      const luma = new Uint8Array(largura * altura);
      for (let i = 0, j = 0; i < px.length; i += 4, j++) luma[j] = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
      quadros.push({ largura, altura, luma });
      if (!vista && quadros.length === Math.ceil(tempos.length / 2)) {
        const v = document.createElement("canvas");
        const k = Math.min(1, 480 / Math.max(W, H));
        v.width = Math.round(W * k);
        v.height = Math.round(H * k);
        const vctx = v.getContext("2d");
        if (vctx) {
          vctx.drawImage(el, 0, 0, v.width, v.height);
          vista = v.toDataURL("image/jpeg", 0.8);
          tempoDaVista = t;
        }
      }
    }
    return { quadros, vista, tempoDaVista, duracao: el.duration, largura: W, altura: H };
  } finally {
    el.removeAttribute("src");
    try {
      el.load();
    } catch {
      /* nada */
    }
  }
}

/** Acha a faixa da legenda gravada no vídeo (sem custo). null = não achou (a pessoa marca à mão). */
export async function acharLegendaNoVideo(url: string): Promise<{ achada: LegendaAchada | null; vista: string | null; tempoDaVista: number; duracao: number }> {
  const r = await quadrosDoVideo(url, { n: 8, largura: 192 });
  return { achada: acharLegenda(r.quadros), vista: r.vista, tempoDaVista: r.tempoDaVista, duracao: r.duracao };
}

// ------------------------------------------------------------------ tratar vídeo

export interface TratamentoNaTela {
  id: string;
  arquivo_id: string | null;
  nome_do_antes: string;
  acao: AcaoDoTratamento;
  acao_rotulo: string;
  motor: string;
  parametros: { regiao?: RegiaoDaLegenda | null; nivel?: NivelDaMelhora; fator?: number };
  estado: "preparando" | "gerando" | "compondo" | "amostra" | "pronto" | "erro" | "descartado";
  fase: "amostra" | "final";
  estado_texto: string;
  amostra: { inicio_s: number; fim_s: number; antes_url: string | null; depois_url: string | null; custo_previsto_usd: number | null } | null;
  envios: { parte: number; estado: string; posicao: number | null; erro: string | null }[];
  custo_usd: number;
  resultado_arquivo_id: string | null;
  erro: string | null;
  criado_em: string;
}

export interface MotorNaTela {
  id: string;
  acao: AcaoDoTratamento;
  rotulo: string;
  nota: string;
  pronto: boolean;
  motivo: string | null;
}

export const statusDosTratamentos = (clientId: string, arquivoId?: string | null) =>
  chamarMesaVideos<{ tratamentos: TratamentoNaTela[]; motores: MotorNaTela[] }>({ acao: "tratamento_status", client_id: clientId, ...(arquivoId ? { arquivo_id: arquivoId } : {}) });

export const novoUid = () => `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export function amostraDoTratamento(e: {
  clientId: string;
  arquivoId: string;
  acao: AcaoDoTratamento;
  motor?: string | null;
  regiao?: RegiaoDaLegenda | null;
  nivel?: NivelDaMelhora;
  inicio_s?: number;
  medidas?: { largura?: number | null; altura?: number | null; fps?: number | null };
  uid: string;
  custoConfirmadoUsd: number;
}) {
  return chamarMesaVideos<{ tratamento: TratamentoNaTela; ja_existia?: boolean }>({
    acao: "tratamento_amostra",
    client_id: e.clientId,
    arquivo_id: e.arquivoId,
    // `acao` é a ação da chamada; o tipo do tratamento vai em `tipo`.
    tipo: e.acao,
    motor: e.motor || null,
    regiao: e.regiao || null,
    nivel: e.nivel || "mesmo_tamanho",
    inicio_s: e.inicio_s || 0,
    medidas: e.medidas || {},
    uid: e.uid,
    custo_confirmado_usd: e.custoConfirmadoUsd,
  });
}

export const videoInteiroDoTratamento = (tratamentoId: string, uid: string, custoConfirmadoUsd: number) =>
  chamarMesaVideos<{ tratamento: TratamentoNaTela; ja_existia?: boolean }>({ acao: "tratamento_final", tratamento_id: tratamentoId, uid, custo_confirmado_usd: custoConfirmadoUsd });

export const descartarTratamento = (tratamentoId: string) => chamarMesaVideos<{ tratamento: TratamentoNaTela }>({ acao: "tratamento_descartar", tratamento_id: tratamentoId });

/** Custo que o servidor mandou confirmar (409 confirmar_custo / custo_mudou), ou null. */
export function custoPedido(e: unknown): number | null {
  if (!(e instanceof ErroDaMesa)) return null;
  const extra = (e as unknown as { detalhes?: Record<string, unknown> }).detalhes || {};
  const c = extra.custo_estimado as { usd?: unknown } | undefined;
  return c && typeof c.usd === "number" ? c.usd : null;
}
