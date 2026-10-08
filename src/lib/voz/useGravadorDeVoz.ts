import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { tipoDoAudioParaEnvio } from "@/lib/gestorAnexos";

/**
 * Entrada por voz para qualquer chat de agente (09/10/2026).
 *
 * Pedido do dono: gravação que não corta, transcrição que não perde o fim,
 * áudio que não some quando a transcrição falha e nada enviado sozinho. O
 * texto transcrito volta para quem usa (aoTranscrever) e o chat decide o que
 * fazer: no Gestor ele vai para o campo, editável, e só sai quando o dono manda.
 *
 * O motor (criarGravadorDeVoz) não depende de React; o hook só o embrulha.
 * Quem usa passa a chamada que transcreve (transcrever), então serve para o
 * Gestor, o Hermes, a Mesa ou qualquer outra conversa.
 *
 * Cuidados que o motor garante:
 * - estados explícitos; um clique duplo nunca abre dois gravadores;
 * - o Blob só nasce depois do último pedaço (o stop e o pedaço final podem
 *   chegar em qualquer ordem: Safari antigo manda o pedaço depois do stop);
 * - formato escolhido pelo que o navegador grava (webm/opus, depois mp4 do
 *   Safari, depois o padrão), e o microfone é desligado em toda saída;
 * - teto com aviso antes de parar; quando para no teto, o texto vem com a marca;
 * - áudio vazio ou com menos de 1 s é recusado com motivo claro;
 * - falha de transcrição guarda o áudio para tentar de novo;
 * - ao desmontar, tudo para e nada é transcrito nem enviado.
 */

export type EstadoDaVoz = "ocioso" | "pedindo_permissao" | "gravando" | "finalizando" | "transcrevendo" | "pronto" | "erro";

/** Quem usa transcreve: recebe o áudio, o tipo aceito pelo servidor e a duração medida. */
export type TranscreverAudio = (audio: Blob, mime: string, segundos: number) => Promise<{ texto: string; segundos?: number }>;

export type ResultadoDaVoz = {
  texto: string;
  segundos: number;
  origem: "gravacao" | "arquivo";
  /** A gravação parou sem o dono pedir (microfone caiu, ligação, aba no celular). */
  interrompida: boolean;
  /** Parou porque chegou no teto de duração. */
  noTeto: boolean;
};

export type InstantaneoDaVoz = {
  estado: EstadoDaVoz;
  /** Segundos gravados (atualiza durante a gravação). */
  segundos: number;
  /** Faltando pouco para o teto: a tela avisa antes de parar. */
  perto_do_teto: boolean;
  restante: number;
  erro: string | null;
  /** Há áudio guardado que ainda pode ser transcrito (Tentar de novo). */
  audio_guardado: boolean;
  ultimo: ResultadoDaVoz | null;
};

export type OpcoesDaVoz = {
  transcrever: TranscreverAudio;
  aoTranscrever?: (r: ResultadoDaVoz) => void;
  /** Teto da gravação (padrão: 600 s, o mesmo do servidor). */
  maxSegundos?: number;
  /** Quantos segundos antes do teto o aviso aparece (padrão: 30). */
  avisoSegundos?: number;
  /** Menor gravação aceita (padrão: 1 s). */
  minSegundos?: number;
  /** Maior áudio aceito (padrão: 24 MB, o do servidor). */
  maxBytes?: number;
  /** Para teste ou outro ambiente: de onde vêm o MediaRecorder e o getUserMedia. */
  ambiente?: AmbienteDaVoz;
};

type ConstrutorDoGravador = {
  new (s: MediaStream, o?: MediaRecorderOptions): MediaRecorder;
  isTypeSupported?: (t: string) => boolean;
};

export type AmbienteDaVoz = {
  MediaRecorder?: ConstrutorDoGravador;
  getUserMedia?: (c: MediaStreamConstraints) => Promise<MediaStream>;
};

export const MAX_SEGUNDOS_DA_VOZ = 600;
export const MAX_BYTES_DA_VOZ = 24 * 1024 * 1024;
/** Espera do último pedaço quando o stop chega antes dele (Safari antigo). */
const ESPERA_DO_ULTIMO_PEDACO_MS = 300;
/** Se o navegador nunca disser "parou" (trilha morta), fecha com o que tem. */
const ESPERA_DO_STOP_MS = 4000;

/** Ordem de preferência: webm/opus (Chrome, Firefox, Android), mp4 (Safari/iPhone), ogg; senão o padrão. */
export const FORMATOS_DA_VOZ = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];

export function escolherFormato(C: ConstrutorDoGravador | undefined): string | undefined {
  if (!C || typeof C.isTypeSupported !== "function") return undefined;
  for (const t of FORMATOS_DA_VOZ) {
    try { if (C.isTypeSupported(t)) return t; } catch { /* navegador que lança no teste de tipo */ }
  }
  return undefined;
}

function ambientePadrao(): AmbienteDaVoz {
  if (typeof window === "undefined") return {};
  const w = window as unknown as { MediaRecorder?: ConstrutorDoGravador };
  const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  return {
    MediaRecorder: typeof w.MediaRecorder === "function" ? w.MediaRecorder : undefined,
    getUserMedia: md && typeof md.getUserMedia === "function" ? (c) => md.getUserMedia(c) : undefined,
  };
}

/** O navegador grava áudio aqui? (sem isso, o botão do microfone nem aparece) */
export function vozPossivel(ambiente?: AmbienteDaVoz): boolean {
  const a = ambiente || ambientePadrao();
  return !!a.MediaRecorder && !!a.getUserMedia;
}

/** Motivo do microfone recusado, em português curto. */
export function motivoDoMicrofone(e: unknown): string {
  const nome = e && typeof e === "object" && "name" in e ? String((e as { name: unknown }).name) : "";
  if (nome === "NotAllowedError" || nome === "SecurityError" || nome === "PermissionDeniedError") return "O navegador não liberou o microfone. Libere para este site e tente de novo.";
  if (nome === "NotFoundError" || nome === "OverconstrainedError" || nome === "DevicesNotFoundError") return "Nenhum microfone encontrado neste aparelho.";
  if (nome === "NotReadableError" || nome === "AbortError" || nome === "TrackStartError") return "O microfone está em uso por outro app. Feche o outro app e tente de novo.";
  return "Não deu para abrir o microfone. Tente de novo.";
}

const extDoTipo = (mime: string) => (mime.indexOf("mp4") >= 0 ? "m4a" : mime.indexOf("ogg") >= 0 ? "ogg" : mime.indexOf("wav") >= 0 ? "wav" : mime.indexOf("mpeg") >= 0 ? "mp3" : "webm");

export type GravadorDeVoz = {
  ler: () => InstantaneoDaVoz;
  assinar: (fn: () => void) => () => void;
  comecar: () => Promise<void>;
  parar: () => void;
  cancelar: () => void;
  tentarDeNovo: () => Promise<void>;
  descartar: () => void;
  transcreverArquivo: (audio: Blob, nome: string, segundos: number) => boolean;
  ativar: () => void;
  destruir: () => void;
};

/** O motor, sem React: um gravador por vez, com estados explícitos. */
export function criarGravadorDeVoz(pegarOpcoes: () => OpcoesDaVoz): GravadorDeVoz {
  const op = () => pegarOpcoes();
  const maxSeg = () => op().maxSegundos || MAX_SEGUNDOS_DA_VOZ;
  const avisoSeg = () => (op().avisoSegundos !== undefined ? Number(op().avisoSegundos) : 30);
  const minSeg = () => (op().minSegundos !== undefined ? Number(op().minSegundos) : 1);
  const maxBytes = () => op().maxBytes || MAX_BYTES_DA_VOZ;
  const ambiente = () => op().ambiente || ambientePadrao();

  let snap: InstantaneoDaVoz = { estado: "ocioso", segundos: 0, perto_do_teto: false, restante: maxSeg(), erro: null, audio_guardado: false, ultimo: null };
  const ouvintes = new Set<() => void>();
  const mudar = (p: Partial<InstantaneoDaVoz>) => {
    snap = { ...snap, ...p };
    ouvintes.forEach((f) => f());
  };

  // Cada gravação (ou transcrição) tem um número; resposta de uma antiga é ignorada.
  let geracao = 0;
  let vivo = true;
  let fluxo: MediaStream | null = null;
  let gravador: MediaRecorder | null = null;
  let pedacos: Blob[] = [];
  let formato: string | undefined;
  let inicio = 0;
  let fim = 0;
  let relogio: ReturnType<typeof setInterval> | null = null;
  let esperaDoPedaco: ReturnType<typeof setTimeout> | null = null;
  let esperaDoStop: ReturnType<typeof setTimeout> | null = null;
  let pararPedido = false;
  let pedacoDepoisDoParar = false;
  let interrompida = false;
  let noTeto = false;
  let fechada = false;
  let guardado: { audio: Blob; mime: string; segundos: number; origem: ResultadoDaVoz["origem"]; interrompida: boolean; noTeto: boolean } | null = null;

  const limparRelogios = () => {
    if (relogio) { clearInterval(relogio); relogio = null; }
    if (esperaDoPedaco) { clearTimeout(esperaDoPedaco); esperaDoPedaco = null; }
    if (esperaDoStop) { clearTimeout(esperaDoStop); esperaDoStop = null; }
  };
  const desligarMicrofone = () => {
    if (fluxo) {
      fluxo.getTracks().forEach((t) => { try { t.onended = null; t.stop(); } catch { /* já parada */ } });
      fluxo = null;
    }
  };
  const soltarGravador = () => {
    const g = gravador;
    gravador = null;
    if (!g) return;
    g.ondataavailable = null;
    g.onstop = null;
    g.onerror = null;
    try { if (g.state !== "inactive") g.stop(); } catch { /* já parado */ }
  };
  const decorrido = () => (inicio ? ((fim || Date.now()) - inicio) / 1000 : 0);

  const transcreverGuardado = async () => {
    const g = guardado;
    if (!g || !vivo) return;
    const minha = ++geracao;
    mudar({ estado: "transcrevendo", erro: null, audio_guardado: true });
    try {
      const r = await op().transcrever(g.audio, g.mime, g.segundos);
      if (minha !== geracao || !vivo) return;
      const texto = String((r && r.texto) || "").trim();
      if (!texto) throw new Error("Não deu para entender o áudio. Tente de novo mais perto do microfone.");
      const resultado: ResultadoDaVoz = { texto, segundos: Math.max(1, Math.round(Number(r.segundos) || g.segundos)), origem: g.origem, interrompida: g.interrompida, noTeto: g.noTeto };
      guardado = null;
      mudar({ estado: "pronto", erro: null, audio_guardado: false, ultimo: resultado });
      const fn = op().aoTranscrever;
      if (fn) fn(resultado);
    } catch (e) {
      if (minha !== geracao || !vivo) return;
      // O áudio fica guardado: nada se perde, o dono tenta de novo ou descarta.
      mudar({ estado: "erro", erro: e instanceof Error && e.message ? e.message : "Não deu para transcrever o áudio.", audio_guardado: true });
    }
  };

  const fecharGravacao = () => {
    if (fechada) return;
    fechada = true;
    limparRelogios();
    const g = gravador;
    const mimeDoGravador = (g && g.mimeType) || (pedacos[0] && pedacos[0].type) || formato || "";
    soltarGravador();
    desligarMicrofone();
    if (!vivo) return;
    const segundos = Math.round(decorrido() * 10) / 10;
    inicio = 0;
    fim = 0;
    const tipo = tipoDoAudioParaEnvio({ name: `gravacao.${extDoTipo(mimeDoGravador)}`, type: mimeDoGravador });
    const audio = new Blob(pedacos, { type: tipo });
    pedacos = [];
    if (!audio.size) {
      mudar({ estado: "erro", erro: "Nada foi gravado. Confira o microfone e grave de novo.", audio_guardado: false, segundos, perto_do_teto: false });
      return;
    }
    if (segundos < minSeg()) {
      mudar({ estado: "erro", erro: "Áudio curto demais. Grave pelo menos 1 segundo.", audio_guardado: false, segundos, perto_do_teto: false });
      return;
    }
    if (audio.size > maxBytes()) {
      mudar({ estado: "erro", erro: "O áudio passou de 24 MB. Grave em partes menores.", audio_guardado: false, segundos, perto_do_teto: false });
      return;
    }
    guardado = { audio, mime: tipo, segundos, origem: "gravacao", interrompida, noTeto };
    mudar({ segundos, perto_do_teto: false });
    void transcreverGuardado();
  };

  /** Para de gravar e espera o último pedaço antes de montar o áudio. */
  const pararInterno = (motivo: "dono" | "teto" | "interrompida") => {
    if (snap.estado !== "gravando") return;
    if (motivo === "teto") noTeto = true;
    if (motivo === "interrompida") interrompida = true;
    pararPedido = true;
    pedacoDepoisDoParar = false;
    fim = Date.now();
    if (relogio) { clearInterval(relogio); relogio = null; }
    mudar({ estado: "finalizando", segundos: decorrido() });
    const g = gravador;
    if (!g || g.state === "inactive") { fecharGravacao(); return; }
    esperaDoStop = setTimeout(fecharGravacao, ESPERA_DO_STOP_MS);
    try { g.stop(); } catch { fecharGravacao(); }
  };

  const comecar = async () => {
    // Um gravador por vez: o estado muda na hora, antes de qualquer espera (clique duplo não abre dois).
    if (!vivo || (snap.estado !== "ocioso" && snap.estado !== "pronto" && snap.estado !== "erro")) return;
    const amb = ambiente();
    if (!amb.MediaRecorder || !amb.getUserMedia) {
      mudar({ estado: "erro", erro: "Este navegador não grava áudio. Anexe um arquivo de áudio ou escreva.", audio_guardado: !!guardado });
      return;
    }
    const minha = ++geracao;
    mudar({ estado: "pedindo_permissao", erro: null, segundos: 0, perto_do_teto: false, restante: maxSeg() });
    let s: MediaStream;
    try {
      s = await amb.getUserMedia({ audio: true });
    } catch (e) {
      if (minha !== geracao || !vivo) return;
      mudar({ estado: "erro", erro: motivoDoMicrofone(e), audio_guardado: !!guardado });
      return;
    }
    if (minha !== geracao || !vivo) {
      // Cancelou (ou saiu da tela) enquanto o navegador perguntava: devolve o microfone.
      s.getTracks().forEach((t) => { try { t.stop(); } catch { /* já parada */ } });
      return;
    }
    fluxo = s;
    const C = amb.MediaRecorder;
    formato = escolherFormato(C);
    let g: MediaRecorder;
    try {
      g = formato ? new C(s, { mimeType: formato }) : new C(s);
    } catch {
      try { formato = undefined; g = new C(s); } catch {
        desligarMicrofone();
        mudar({ estado: "erro", erro: "Este navegador não conseguiu gravar. Anexe um arquivo de áudio ou escreva.", audio_guardado: !!guardado });
        return;
      }
    }
    // A gravação nova substitui o áudio antigo que falhou (o dono escolheu gravar de novo).
    guardado = null;
    gravador = g;
    pedacos = [];
    pararPedido = false;
    pedacoDepoisDoParar = false;
    interrompida = false;
    noTeto = false;
    fechada = false;
    g.ondataavailable = (e: BlobEvent) => {
      if (gravador !== g) return;
      if (e.data && e.data.size) pedacos.push(e.data);
      if (pararPedido) {
        pedacoDepoisDoParar = true;
        // O stop já chegou e só faltava este pedaço: fecha agora.
        if (esperaDoPedaco) { clearTimeout(esperaDoPedaco); esperaDoPedaco = null; fecharGravacao(); }
      }
    };
    g.onstop = () => {
      if (gravador !== g) return;
      if (!pararPedido) { pararPedido = true; interrompida = true; fim = Date.now(); }
      if (esperaDoStop) { clearTimeout(esperaDoStop); esperaDoStop = null; }
      if (snap.estado === "gravando") mudar({ estado: "finalizando", segundos: decorrido() });
      if (relogio) { clearInterval(relogio); relogio = null; }
      // Pela regra o último pedaço chega antes do stop; no Safari antigo, depois. Espera um pouco por ele.
      if (pedacoDepoisDoParar) fecharGravacao();
      else esperaDoPedaco = setTimeout(() => { esperaDoPedaco = null; fecharGravacao(); }, ESPERA_DO_ULTIMO_PEDACO_MS);
    };
    g.onerror = () => {
      if (gravador !== g) return;
      // Erro do gravador: fica o que já foi gravado (o navegador ainda manda o stop).
      if (snap.estado === "gravando") pararInterno("interrompida");
    };
    // Microfone caiu (fone desconectado, ligação, iPhone tirou o microfone da aba): fecha com o que tem.
    s.getTracks().forEach((t) => {
      t.onended = () => { if (gravador === g && snap.estado === "gravando") pararInterno("interrompida"); };
    });
    try {
      // webm/ogg em pedaços de 1 s (perde menos se o navegador cair); mp4 do Safari num pedaço só (arquivo inteiro).
      if (formato && formato.indexOf("mp4") < 0) g.start(1000);
      else g.start();
    } catch {
      soltarGravador();
      desligarMicrofone();
      mudar({ estado: "erro", erro: "Este navegador não conseguiu gravar. Anexe um arquivo de áudio ou escreva.", audio_guardado: false });
      return;
    }
    inicio = Date.now();
    fim = 0;
    mudar({ estado: "gravando", segundos: 0, perto_do_teto: false, restante: maxSeg(), erro: null, audio_guardado: false });
    relogio = setInterval(() => {
      if (snap.estado !== "gravando") return;
      const seg = decorrido();
      const restante = Math.max(0, maxSeg() - seg);
      mudar({ segundos: seg, restante, perto_do_teto: restante <= avisoSeg() });
      if (seg >= maxSeg()) pararInterno("teto");
    }, 250);
  };

  const cancelar = () => {
    geracao++;
    const estado = snap.estado;
    limparRelogios();
    fechada = true;
    pedacos = [];
    soltarGravador();
    desligarMicrofone();
    inicio = 0;
    fim = 0;
    if (estado === "transcrevendo") guardado = null;
    if (!vivo) return;
    if (estado === "pedindo_permissao" || estado === "gravando" || estado === "finalizando" || estado === "transcrevendo") {
      mudar({ estado: "ocioso", segundos: 0, perto_do_teto: false, erro: null, audio_guardado: !!guardado });
    }
  };

  const descartar = () => {
    if (snap.estado === "gravando" || snap.estado === "finalizando" || snap.estado === "pedindo_permissao") { cancelar(); }
    geracao++;
    guardado = null;
    if (vivo) mudar({ estado: "ocioso", erro: null, audio_guardado: false, segundos: 0, perto_do_teto: false });
  };

  /** Áudio anexado: mesmo caminho (estados, guarda e Tentar de novo). Falso quando há outro áudio em curso. */
  const transcreverArquivo = (audio: Blob, nome: string, segundos: number): boolean => {
    if (!vivo) return false;
    if (snap.estado === "pedindo_permissao" || snap.estado === "gravando" || snap.estado === "finalizando" || snap.estado === "transcrevendo") return false;
    if (!audio || !audio.size) { mudar({ estado: "erro", erro: "O áudio chegou vazio.", audio_guardado: false }); guardado = null; return true; }
    if (audio.size > maxBytes()) { mudar({ estado: "erro", erro: "O áudio passou de 24 MB. Mande em partes menores.", audio_guardado: false }); guardado = null; return true; }
    const mime = tipoDoAudioParaEnvio({ name: nome, type: audio.type });
    guardado = { audio, mime, segundos: Math.max(0, Number(segundos) || 0), origem: "arquivo", interrompida: false, noTeto: false };
    mudar({ segundos: guardado.segundos });
    void transcreverGuardado();
    return true;
  };

  return {
    ler: () => snap,
    assinar: (fn) => { ouvintes.add(fn); return () => { ouvintes.delete(fn); }; },
    comecar,
    parar: () => pararInterno("dono"),
    cancelar,
    tentarDeNovo: async () => { if (guardado && snap.estado !== "transcrevendo" && snap.estado !== "gravando") await transcreverGuardado(); },
    descartar,
    transcreverArquivo,
    ativar: () => { vivo = true; },
    destruir: () => {
      // Saiu da tela: para tudo, devolve o microfone e não transcreve nem manda nada.
      cancelar();
      guardado = null;
      vivo = false;
    },
  };
}

export type VozDoChat = InstantaneoDaVoz & {
  possivel: boolean;
  comecar: () => void;
  parar: () => void;
  cancelar: () => void;
  tentarDeNovo: () => void;
  descartar: () => void;
  /** Falso quando há outra gravação ou transcrição em curso. */
  transcreverArquivo: (audio: Blob, nome: string, segundos: number) => boolean;
  maxSegundos: number;
};

/** Hook do chat: o motor vive enquanto a tela vive; as opções mais novas valem sempre. */
export function useGravadorDeVoz(opcoes: OpcoesDaVoz): VozDoChat {
  const atual = useRef(opcoes);
  atual.current = opcoes;
  const [motor] = useState(() => criarGravadorDeVoz(() => atual.current));
  const snap = useSyncExternalStore(motor.assinar, motor.ler, motor.ler);
  useEffect(() => {
    motor.ativar();
    return () => motor.destruir();
  }, [motor]);
  return {
    ...snap,
    possivel: vozPossivel(opcoes.ambiente),
    comecar: () => void motor.comecar(),
    parar: motor.parar,
    cancelar: motor.cancelar,
    tentarDeNovo: () => void motor.tentarDeNovo(),
    descartar: motor.descartar,
    transcreverArquivo: motor.transcreverArquivo,
    maxSegundos: opcoes.maxSegundos || MAX_SEGUNDOS_DA_VOZ,
  };
}
