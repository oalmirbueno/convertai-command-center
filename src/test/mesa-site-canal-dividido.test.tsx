import { createElement as h, useState } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mesa Site ao vivo (EX-08, 30/09). A lateral do agente e a etapa aberta
 * pedem o mesmo canal (motor_trabalhos do site). Antes, cada uma abria o seu
 * com o mesmo nome; o Realtime devolvia o canal que já existia e a etapa que
 * saía fechava o canal das duas: depois da 1ª troca de etapa, a mesa ficava
 * sem tempo real. Agora o canal é dividido e só fecha com a última tela.
 */

const rt = vi.hoisted(() => ({
  criados: [] as string[],
  removidos: 0,
  aoMudar: [] as Array<() => void>,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: (nome: string) => {
      rt.criados.push(nome);
      const canal: any = {
        on: (_t: string, _f: unknown, cb: () => void) => {
          rt.aoMudar.push(cb);
          return canal;
        },
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: () => {
      rt.removidos += 1;
      return Promise.resolve("ok");
    },
  },
}));
vi.mock("@/lib/mesa/api", () => ({
  chamarFuncao: vi.fn(async () => ({ trabalhos: [], executor: null, executor_vivo: false })),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() } }));

import { CHAVES, canaisAoVivoDaMesaSite, useTrabalhos } from "@/components/mesa-site/siteApi";

const SITE = "33333333-3333-4333-8333-333333333333";

function Usa({ nome }: { nome: string }) {
  useTrabalhos("c-1", SITE);
  return h("span", null, nome);
}

let trocarEtapa: (e: string) => void = () => undefined;
let fecharTudo: () => void = () => undefined;

function Mesa() {
  const [etapa, setEtapa] = useState("construcao");
  const [aberta, setAberta] = useState(true);
  trocarEtapa = setEtapa;
  fecharTudo = () => setAberta(false);
  if (!aberta) return null;
  return h("div", null, h(Usa, { nome: "lateral" }), h(Usa, { key: etapa, nome: etapa }));
}

let qc: QueryClient;

beforeEach(() => {
  rt.criados = [];
  rt.removidos = 0;
  rt.aoMudar = [];
  qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Mesa Site: um canal ao vivo por site, dividido", () => {
  it("lateral e etapa dividem um canal; trocar de etapa não fecha; fechar a mesa fecha uma vez", async () => {
    render(h(QueryClientProvider, { client: qc }, h(Mesa)));
    expect(rt.criados.length).toBe(1);
    expect(rt.criados[0].indexOf(`mesa-site:motor_trabalhos:referencia_id=eq.${SITE}`)).toBe(0);
    act(() => trocarEtapa("integracoes"));
    act(() => trocarEtapa("publicacao"));
    // eslint-disable-next-line no-console
    console.log(`[EX-08] depois de 2 trocas de etapa: canais criados=${rt.criados.length} removidos=${rt.removidos}`);
    expect(rt.criados.length).toBe(1);
    expect(rt.removidos).toBe(0);
    expect(canaisAoVivoDaMesaSite()).toBe(1);
    act(() => fecharTudo());
    expect(rt.removidos).toBe(1);
    expect(canaisAoVivoDaMesaSite()).toBe(0);
  });

  it("uma mudança no banco relê a lista uma vez, em 300 ms", async () => {
    vi.useFakeTimers();
    render(h(QueryClientProvider, { client: qc }, h(Mesa)));
    const invalidar = vi.spyOn(qc, "invalidateQueries");
    act(() => trocarEtapa("revisao"));
    act(() => {
      rt.aoMudar[0]();
      rt.aoMudar[0]();
    });
    expect(invalidar).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(invalidar).toHaveBeenCalledTimes(1);
    expect(invalidar.mock.calls[0][0]).toEqual({ queryKey: CHAVES.trabalhos(SITE) });
  });

  it("reabrir logo depois de fechar cria um canal com nome novo (não pega o que ainda está fechando)", () => {
    const { unmount } = render(h(QueryClientProvider, { client: qc }, h(Mesa)));
    unmount();
    render(h(QueryClientProvider, { client: qc }, h(Mesa)));
    expect(rt.criados.length).toBe(2);
    expect(rt.criados[0]).not.toBe(rt.criados[1]);
  });
});
