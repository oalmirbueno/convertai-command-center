import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGravadorDeVoz, type AmbienteDaVoz, type OpcoesDaVoz } from "@/lib/voz/useGravadorDeVoz";
import { BotaoDeVoz, PilulaDeGravacao } from "@/components/agentes/BotaoDeVoz";

/**
 * Entrada por voz compartilhada (useGravadorDeVoz): com um MediaRecorder de
 * mentira, prova o que o dono reclamou (gravação cortada, transcrição sem o
 * fim, áudio perdido, estados confusos e pedido incompleto enviado sozinho).
 */

class TrilhaFalsa {
  onended: (() => void) | null = null;
  parada = false;
  stop() { this.parada = true; }
}
class FluxoFalso {
  trilhas = [new TrilhaFalsa()];
  getTracks() { return this.trilhas as unknown as MediaStreamTrack[]; }
}

type Ordem = "regra" | "safari" | "sem_dados";

class GravadorFalso {
  static instancias: GravadorFalso[] = [];
  static ordem: Ordem = "regra";
  static isTypeSupported = (t: string) => t === "audio/webm;codecs=opus";
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  timeslice: number | undefined;
  constructor(public stream: FluxoFalso, o?: { mimeType?: string }) {
    this.mimeType = (o && o.mimeType) || "";
    GravadorFalso.instancias.push(this);
  }
  start(t?: number) { this.state = "recording"; this.timeslice = t; }
  /** Um pedaço do timeslice chegando durante a gravação. */
  pedaco(bytes: number) { if (this.ondataavailable) this.ondataavailable({ data: new Blob([new Uint8Array(bytes)], { type: "audio/webm" }) }); }
  stop() {
    this.state = "inactive";
    const ordem = GravadorFalso.ordem;
    // Assíncrono, como no navegador. "regra": último pedaço e depois stop; "safari": stop e depois o pedaço.
    setTimeout(() => {
      if (ordem === "regra") { this.pedaco(50); if (this.onstop) this.onstop(); }
      else if (ordem === "safari") { if (this.onstop) this.onstop(); setTimeout(() => this.pedaco(50), 20); }
      else if (this.onstop) this.onstop();
    }, 5);
  }
}

let fluxos: FluxoFalso[] = [];
const getUserMedia = vi.fn(async () => { const f = new FluxoFalso(); fluxos.push(f); return f as unknown as MediaStream; });
const ambiente: AmbienteDaVoz = { MediaRecorder: GravadorFalso as unknown as AmbienteDaVoz["MediaRecorder"], getUserMedia };

const avancar = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

function montar(extra: Partial<OpcoesDaVoz> = {}) {
  const transcrever = vi.fn(async (_a: Blob, _m: string, s: number) => ({ texto: "Criar a tarefa da Acerbi", segundos: Math.round(s) }));
  const aoTranscrever = vi.fn();
  const h = renderHook((p: Partial<OpcoesDaVoz>) => useGravadorDeVoz({ transcrever, aoTranscrever, ambiente, ...p }), { initialProps: extra });
  return { h, transcrever, aoTranscrever };
}

async function gravar(h: { result: { current: ReturnType<typeof useGravadorDeVoz> } }, ms: number) {
  act(() => h.result.current.comecar());
  await avancar(0); // o navegador libera o microfone
  expect(h.result.current.estado).toBe("gravando");
  await avancar(ms);
}

beforeEach(() => {
  vi.useFakeTimers();
  GravadorFalso.instancias = [];
  GravadorFalso.ordem = "regra";
  fluxos = [];
  getUserMedia.mockClear();
});
afterEach(() => { vi.useRealTimers(); });

describe("useGravadorDeVoz", () => {
  it("o último pedaço entra no áudio, chegue antes ou depois do stop; o microfone é desligado", async () => {
    for (const ordem of ["regra", "safari"] as Ordem[]) {
      GravadorFalso.ordem = ordem;
      const { h, transcrever, aoTranscrever } = montar();
      await gravar(h, 2500);
      const g = GravadorFalso.instancias[GravadorFalso.instancias.length - 1];
      expect(g.mimeType).toBe("audio/webm;codecs=opus");
      expect(g.timeslice).toBe(1000);
      act(() => { g.pedaco(100); g.pedaco(100); });
      act(() => h.result.current.parar());
      expect(h.result.current.estado).toBe("finalizando");
      await avancar(400);
      expect(transcrever).toHaveBeenCalledTimes(1);
      const [audio, mime, segundos] = transcrever.mock.calls[0];
      expect(audio.size).toBe(250); // 100 + 100 + o pedaço final (50)
      expect(mime).toBe("audio/webm");
      expect(segundos).toBeGreaterThanOrEqual(2.4);
      expect(h.result.current.estado).toBe("pronto");
      expect(aoTranscrever).toHaveBeenCalledWith(expect.objectContaining({ texto: "Criar a tarefa da Acerbi", origem: "gravacao", interrompida: false }));
      expect(fluxos[fluxos.length - 1].trilhas[0].parada).toBe(true);
      h.unmount();
    }
  });

  it("clique duplo não abre dois gravadores nem pede o microfone duas vezes", async () => {
    const { h } = montar();
    act(() => { h.result.current.comecar(); h.result.current.comecar(); });
    await avancar(0);
    act(() => h.result.current.comecar());
    await avancar(0);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(GravadorFalso.instancias).toHaveLength(1);
    expect(h.result.current.estado).toBe("gravando");
  });

  it("clique duplo no botão do microfone também abre um só", async () => {
    function Chat() {
      const voz = useGravadorDeVoz({ transcrever: async () => ({ texto: "ok" }), ambiente });
      return <div><BotaoDeVoz voz={voz} /><PilulaDeGravacao voz={voz} /></div>;
    }
    render(<Chat />);
    const botao = screen.getByRole("button", { name: "Gravar áudio" });
    fireEvent.click(botao);
    fireEvent.click(botao);
    await avancar(0);
    expect(GravadorFalso.instancias).toHaveLength(1);
    expect(screen.getByText(/Gravando 0:00/)).toBeTruthy();
    await avancar(3000);
    expect(screen.getByText(/Gravando 0:03/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar a gravação" }));
    expect(screen.queryByText(/Gravando/)).toBeNull();
  });

  it("áudio curto (menos de 1 s) ou vazio é recusado com motivo e não vai para transcrever", async () => {
    const curto = montar();
    await gravar(curto.h, 500);
    act(() => { GravadorFalso.instancias[0].pedaco(80); curto.h.result.current.parar(); });
    await avancar(400);
    expect(curto.h.result.current.estado).toBe("erro");
    expect(curto.h.result.current.erro).toMatch(/curto demais/);
    expect(curto.transcrever).not.toHaveBeenCalled();
    curto.h.unmount();

    GravadorFalso.ordem = "sem_dados";
    const vazio = montar();
    await gravar(vazio.h, 3000);
    act(() => vazio.h.result.current.parar());
    await avancar(400);
    expect(vazio.h.result.current.estado).toBe("erro");
    expect(vazio.h.result.current.erro).toMatch(/Nada foi gravado/);
    expect(vazio.transcrever).not.toHaveBeenCalled();
  });

  it("transcrição que falha guarda o áudio; Tentar de novo usa o mesmo áudio e o texto chega", async () => {
    const { h, transcrever, aoTranscrever } = montar();
    transcrever.mockRejectedValueOnce(new Error("A transcrição demorou demais. Tente de novo."));
    await gravar(h, 2000);
    act(() => { GravadorFalso.instancias[0].pedaco(300); h.result.current.parar(); });
    await avancar(400);
    expect(h.result.current.estado).toBe("erro");
    expect(h.result.current.erro).toMatch(/demorou demais/);
    expect(h.result.current.audio_guardado).toBe(true);
    expect(aoTranscrever).not.toHaveBeenCalled();
    const primeiro = transcrever.mock.calls[0][0];
    act(() => h.result.current.tentarDeNovo());
    await avancar(0);
    expect(transcrever).toHaveBeenCalledTimes(2);
    expect(transcrever.mock.calls[1][0]).toBe(primeiro);
    expect(h.result.current.estado).toBe("pronto");
    expect(h.result.current.audio_guardado).toBe(false);
    expect(aoTranscrever).toHaveBeenCalledTimes(1);
  });

  it("cancelar descarta: nada é transcrito, o microfone desliga e nada chega depois", async () => {
    const { h, transcrever, aoTranscrever } = montar();
    await gravar(h, 4000);
    act(() => { GravadorFalso.instancias[0].pedaco(300); h.result.current.cancelar(); });
    expect(h.result.current.estado).toBe("ocioso");
    expect(fluxos[0].trilhas[0].parada).toBe(true);
    await avancar(5000);
    expect(transcrever).not.toHaveBeenCalled();
    expect(aoTranscrever).not.toHaveBeenCalled();
    expect(h.result.current.estado).toBe("ocioso");
  });

  it("cancelar enquanto o navegador pede o microfone devolve o microfone assim que ele chega", async () => {
    const { h } = montar();
    act(() => h.result.current.comecar());
    expect(h.result.current.estado).toBe("pedindo_permissao");
    act(() => h.result.current.cancelar());
    await avancar(0);
    expect(h.result.current.estado).toBe("ocioso");
    expect(GravadorFalso.instancias).toHaveLength(0);
    expect(fluxos[0].trilhas[0].parada).toBe(true);
  });

  it("perto do teto avisa; no teto para sozinho e o texto vem marcado (nada é enviado)", async () => {
    const { h, transcrever, aoTranscrever } = montar({ maxSegundos: 6, avisoSegundos: 3 });
    await gravar(h, 2000);
    expect(h.result.current.perto_do_teto).toBe(false);
    act(() => GravadorFalso.instancias[0].pedaco(300));
    await avancar(1500);
    expect(h.result.current.perto_do_teto).toBe(true);
    await avancar(3000);
    expect(transcrever).toHaveBeenCalledTimes(1);
    expect(aoTranscrever).toHaveBeenCalledWith(expect.objectContaining({ noTeto: true }));
  });

  it("microfone que cai no meio guarda o que foi gravado e marca como interrompida", async () => {
    const { h, aoTranscrever } = montar();
    await gravar(h, 3000);
    act(() => { GravadorFalso.instancias[0].pedaco(300); const t = fluxos[0].trilhas[0]; if (t.onended) t.onended(); });
    await avancar(400);
    expect(aoTranscrever).toHaveBeenCalledWith(expect.objectContaining({ interrompida: true }));
  });

  it("sair da tela no meio da gravação desliga o microfone e não transcreve nada", async () => {
    const { h, transcrever } = montar();
    await gravar(h, 3000);
    act(() => GravadorFalso.instancias[0].pedaco(300));
    h.unmount();
    await avancar(5000);
    expect(fluxos[0].trilhas[0].parada).toBe(true);
    expect(transcrever).not.toHaveBeenCalled();
  });

  it("microfone recusado vira erro claro e o botão volta", async () => {
    getUserMedia.mockImplementationOnce(async () => { throw Object.assign(new Error("negado"), { name: "NotAllowedError" }); });
    const { h } = montar();
    act(() => h.result.current.comecar());
    await avancar(0);
    expect(h.result.current.estado).toBe("erro");
    expect(h.result.current.erro).toMatch(/não liberou o microfone/);
  });
});
