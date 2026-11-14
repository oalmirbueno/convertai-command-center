import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { criarFetchComPrazo } from "@/integrations/supabase/fetchComPrazo";
import {
  CHAVE_DA_MARCA_EM_VOO,
  CHAVE_DOS_TROCADOS,
  JANELA_DA_PROTECAO_MS,
  PRAZO_PARA_SOLTAR_RENOVACAO_MS,
  VALIDADE_DA_MARCA_MS,
  ehPedidoDeRenovacao,
  esquecerMapaDeTrocasParaTeste,
  esquecerRenovacaoEmVooParaTeste,
  esquecerTokensMortos,
  haRenovacaoEmVoo,
  outraAbaRenovando,
  protegerSessaoGuardada,
  registrarTokenMorto,
  tokenEstaMorto,
  tokenJaFoiTrocado,
} from "@/integrations/supabase/renovacaoSegura";

const CHAVE_PADRAO = "sb-x-auth-token";

function lockManagerFalso() {
  const filas = new Map<string, Promise<unknown>>();
  const ocupadas = new Set<string>();
  return {
    request(nome: string, opcoes: { ifAvailable?: boolean; signal?: AbortSignal }, fn: (lock: unknown) => Promise<unknown>) {
      if (opcoes.ifAvailable && ocupadas.has(nome)) return fn(null);
      const antes = filas.get(nome) || Promise.resolve();
      const vez = antes.then(async () => {
        ocupadas.add(nome);
        try {
          return await fn({ name: nome });
        } finally {
          ocupadas.delete(nome);
        }
      });
      filas.set(nome, vez.catch(() => undefined));
      return vez;
    },
  };
}

const travaOriginal = Object.getOwnPropertyDescriptor(globalThis.navigator, "locks");

afterEach(() => {
  esquecerTokensMortos();
  esquecerRenovacaoEmVooParaTeste();
  localStorage.removeItem(CHAVE_PADRAO);
  if (travaOriginal) Object.defineProperty(globalThis.navigator, "locks", travaOriginal);
  else delete (globalThis.navigator as unknown as { locks?: unknown }).locks;
  vi.useRealTimers();
});

const RENOVAR = "https://x.supabase.co/auth/v1/token?grant_type=refresh_token";
const corpo = (t: string) => ({ method: "POST", body: JSON.stringify({ refresh_token: t }) });

function presoAteAbortar() {
  return vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("abortado", "AbortError")));
    }),
  ) as unknown as typeof fetch;
}

describe("login com prazo (26/09: painel parado na logo)", () => {
  it("pedido de login por senha preso é cancelado no prazo", async () => {
    const f = criarFetchComPrazo(presoAteAbortar(), 30);
    await expect(f("https://x.supabase.co/auth/v1/token?grant_type=password", { method: "POST" })).rejects.toThrow();
  });

  it("banco, storage e funções não ganham prazo", async () => {
    const base = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => new Response(init?.signal ? "com" : "sem")) as unknown as typeof fetch;
    const f = criarFetchComPrazo(base, 30);
    expect(await (await f("https://x.supabase.co/rest/v1/tasks")).text()).toBe("sem");
    expect(await (await f("https://x.supabase.co/functions/v1/estudio-arte", { method: "POST" })).text()).toBe("sem");
    expect(await (await f("https://x.supabase.co/auth/v1/user")).text()).toBe("com");
  });

  it("login que responde a tempo passa normal", async () => {
    const base = vi.fn(async () => new Response("ok")) as unknown as typeof fetch;
    const f = criarFetchComPrazo(base, 1000);
    expect(await (await f("https://x.supabase.co/auth/v1/token")).text()).toBe("ok");
  });
});

describe("renovação do token não é cancelada (14/11: 'context canceled' derrubou a sessão)", () => {
  it("renovação nunca ganha prazo nem sinal de cancelamento", async () => {
    vi.useFakeTimers();
    let sinal: AbortSignal | null | undefined = undefined;
    let responder: (r: Response) => void = () => undefined;
    const base = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      sinal = init?.signal;
      return new Promise<Response>((ok) => (responder = ok));
    }) as unknown as typeof fetch;
    const f = criarFetchComPrazo(base, 30, { soltarRenovacaoEmMs: 60_000 });
    const p = f(RENOVAR, corpo("r1"));
    await vi.advanceTimersByTimeAsync(59_000);
    expect(sinal).toBeUndefined();
    responder(new Response(JSON.stringify({ access_token: "novo" }), { status: 200 }));
    expect(await (await p).json()).toEqual({ access_token: "novo" });
  });

  it("renovação pendurada solta quem espera no prazo (falha de rede), sem abortar; a resposta atrasada é gravada e o token velho não sai de novo", async () => {
    vi.useFakeTimers();
    const agora = Math.floor(Date.now() / 1000);
    localStorage.setItem(CHAVE_PADRAO, JSON.stringify({ access_token: "a1", refresh_token: "r1", expires_at: agora + 100, user: { id: "u1" } }));
    let sinal: AbortSignal | null | undefined = undefined;
    let responder: (r: Response) => void = () => undefined;
    const base = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      sinal = init?.signal;
      return new Promise<Response>((ok) => (responder = ok));
    }) as unknown as typeof fetch;
    const f = criarFetchComPrazo(base, 30);
    const primeira = f(RENOVAR, corpo("r1")).then(
      () => "respondeu",
      (e: Error) => e,
    );
    await vi.advanceTimersByTimeAsync(PRAZO_PARA_SOLTAR_RENOVACAO_MS + 10);
    const erro = await primeira;
    expect(erro).toBeInstanceOf(TypeError);
    expect((erro as Error).message).toMatch(/Failed to fetch/);
    expect(sinal).toBeUndefined();
    expect(haRenovacaoEmVoo()).toBe(true);
    expect(JSON.parse(localStorage.getItem(CHAVE_DA_MARCA_EM_VOO) || "{}").ate).toBeGreaterThan(Date.now());

    // Nova tentativa do supabase-js com a renovação ainda no ar: não sai outro POST;
    // o access token gravado ainda vale, então volta ele (sem rede).
    const segunda = await f(RENOVAR, corpo("r1"));
    expect(segunda.status).toBe(200);
    expect((await segunda.json()).access_token).toBe("a1");
    expect(base).toHaveBeenCalledTimes(1);

    // A resposta chega depois: o par novo vai para o storage.
    responder(new Response(JSON.stringify({ access_token: "a2", refresh_token: "r2", expires_in: 3600, user: { id: "u1" } }), { status: 200 }));
    await vi.advanceTimersByTimeAsync(1);
    expect(haRenovacaoEmVoo()).toBe(false);
    expect(JSON.parse(localStorage.getItem(CHAVE_PADRAO) || "{}").refresh_token).toBe("r2");
    expect(localStorage.getItem(CHAVE_DA_MARCA_EM_VOO)).toBeNull();

    // r1 já foi trocado: o próximo pedido com r1 recebe o par novo sem ir ao servidor.
    const atrasada = await f(RENOVAR, corpo("r1"));
    expect((await atrasada.json()).refresh_token).toBe("r2");
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("renovação pendurada e access token já vencido: a nova tentativa falha como rede, sem segundo POST", async () => {
    vi.useFakeTimers();
    localStorage.setItem(CHAVE_PADRAO, JSON.stringify({ access_token: "a1", refresh_token: "r1", expires_at: Math.floor(Date.now() / 1000) - 5, user: { id: "u1" } }));
    const base = vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const f = criarFetchComPrazo(base, 30, { soltarRenovacaoEmMs: 100 });
    const primeira = f(RENOVAR, corpo("r1")).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(150);
    expect(await primeira).toBeInstanceOf(TypeError);
    await expect(f(RENOVAR, corpo("r1"))).rejects.toThrow(/Failed to fetch/);
    await expect(f(RENOVAR, corpo("outro"))).rejects.toThrow(/Failed to fetch/);
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("duas renovações juntas na mesma aba: só sai um POST; a segunda espera e recebe o mesmo par", async () => {
    let responder: (r: Response) => void = () => undefined;
    const base = vi.fn(() => new Promise<Response>((ok) => (responder = ok))) as unknown as typeof fetch;
    const f = criarFetchComPrazo(base);
    const a = f(RENOVAR, corpo("r1"));
    const b = f(RENOVAR, corpo("r1"));
    await new Promise((r) => setTimeout(r, 5));
    expect(base).toHaveBeenCalledTimes(1);
    responder(new Response(JSON.stringify({ access_token: "a2", refresh_token: "r2", expires_in: 3600, user: { id: "u1" } }), { status: 200 }));
    expect((await (await a).json()).refresh_token).toBe("r2");
    expect((await (await b).json()).refresh_token).toBe("r2");
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("outra aba soltou a trava com o mesmo token no ar (marca no localStorage): esta aba não manda POST", async () => {
    const agora = Math.floor(Date.now() / 1000);
    localStorage.setItem(CHAVE_PADRAO, JSON.stringify({ access_token: "a1", refresh_token: "r1", expires_at: agora + 60, user: { id: "u1" } }));
    const base = vi.fn(async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    const f = criarFetchComPrazo(base, 30, { soltarRenovacaoEmMs: 50 });
    // Simula a outra aba: renova r1, solta por prazo e deixa a marca.
    const outra = criarFetchComPrazo(() => new Promise<Response>(() => undefined), 30, { soltarRenovacaoEmMs: 20 });
    await outra(RENOVAR, corpo("r1")).catch(() => undefined);
    const marca = localStorage.getItem(CHAVE_DA_MARCA_EM_VOO);
    expect(marca).toBeTruthy();
    expect(marca).not.toContain("r1"); // a marca não guarda o token
    esquecerRenovacaoEmVooParaTeste(); // "outra aba": aqui não há renovação em voo
    localStorage.setItem(CHAVE_DA_MARCA_EM_VOO, marca!);
    const r = await f(RENOVAR, corpo("r1"));
    expect((await r.json()).access_token).toBe("a1");
    expect(base).not.toHaveBeenCalled();
    // Token diferente do marcado segue normal.
    await f(RENOVAR, corpo("r9"));
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("marca em voo é renovada enquanto o HTTP segue: depois de 68 s outra aba ainda não manda POST", async () => {
    vi.useFakeTimers();
    const agora = Math.floor(Date.now() / 1000);
    localStorage.setItem(CHAVE_PADRAO, JSON.stringify({ access_token: "a1", refresh_token: "r1", expires_at: agora + 600, user: { id: "u1" } }));
    const base = vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const f = criarFetchComPrazo(base, 30);
    const primeira = f(RENOVAR, corpo("r1")).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(PRAZO_PARA_SOLTAR_RENOVACAO_MS + 10);
    expect(await primeira).toBeInstanceOf(TypeError);
    const ateInicial = JSON.parse(localStorage.getItem(CHAVE_DA_MARCA_EM_VOO) || "{}").ate as number;
    expect(ateInicial).toBeGreaterThan(Date.now());

    await vi.advanceTimersByTimeAsync(VALIDADE_DA_MARCA_MS + 8_000);
    expect(outraAbaRenovando("r1")).toBe(true);
    const marca = localStorage.getItem(CHAVE_DA_MARCA_EM_VOO);
    expect(JSON.parse(marca || "{}").ate).toBeGreaterThan(Date.now());
    expect(JSON.parse(marca || "{}").ate).toBeGreaterThan(ateInicial);

    esquecerRenovacaoEmVooParaTeste();
    localStorage.setItem(CHAVE_DA_MARCA_EM_VOO, marca!);
    localStorage.setItem(CHAVE_PADRAO, JSON.stringify({ access_token: "a1", refresh_token: "r1", expires_at: Math.floor(Date.now() / 1000) + 600, user: { id: "u1" } }));
    const outra = criarFetchComPrazo(vi.fn(async () => new Response("{}", { status: 500 })) as unknown as typeof fetch);
    const r = await outra(RENOVAR, corpo("r1"));
    expect((await r.json()).access_token).toBe("a1");
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("aba B não sobrescreve com o par velho depois que A gravou o novo (lista compartilhada)", async () => {
    vi.useFakeTimers();
    const agora = Math.floor(Date.now() / 1000);
    const velha = { access_token: "a1", refresh_token: "r1", expires_at: agora + 100, user: { id: "u1" } };
    localStorage.setItem(CHAVE_PADRAO, JSON.stringify(velha));
    let responder: (r: Response) => void = () => undefined;
    const base = vi.fn(() => new Promise<Response>((ok) => (responder = ok))) as unknown as typeof fetch;
    const f = criarFetchComPrazo(base, 30);
    const primeira = f(RENOVAR, corpo("r1")).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(PRAZO_PARA_SOLTAR_RENOVACAO_MS + 10);
    expect(await primeira).toBeInstanceOf(TypeError);

    // Aba B recebe a sessão velha sem rede e o SDK tentaria gravá-la depois.
    const sintetica = await f(RENOVAR, corpo("r1"));
    expect((await sintetica.json()).refresh_token).toBe("r1");

    responder(new Response(JSON.stringify({ access_token: "a2", refresh_token: "r2", expires_in: 3600, user: { id: "u1" } }), { status: 200 }));
    await vi.advanceTimersByTimeAsync(1);
    expect(JSON.parse(localStorage.getItem(CHAVE_PADRAO) || "{}").refresh_token).toBe("r2");
    expect(tokenJaFoiTrocado("r1")).toBe(true);

    // Outra aba: mapa local vazio, só a lista compartilhada.
    esquecerMapaDeTrocasParaTeste();
    expect(localStorage.getItem(CHAVE_DOS_TROCADOS)).toBeTruthy();
    expect(tokenJaFoiTrocado("r1")).toBe(true);

    const storageB = protegerSessaoGuardada({
      getItem: (k: string) => localStorage.getItem(k),
      setItem: (k: string, v: string) => localStorage.setItem(k, v),
      removeItem: (k: string) => void localStorage.removeItem(k),
    })!;
    storageB.setItem(CHAVE_PADRAO, JSON.stringify(velha));
    expect(JSON.parse(localStorage.getItem(CHAVE_PADRAO) || "{}").refresh_token).toBe("r2");
  });

  it("aba suspensa (sem pulso, marca vencida) não deixa outra aba reenviar: a trava HTTP continua presa", async () => {
    Object.defineProperty(globalThis.navigator, "locks", { value: lockManagerFalso(), configurable: true });
    vi.useFakeTimers();
    localStorage.setItem(CHAVE_PADRAO, JSON.stringify({ access_token: "a1", refresh_token: "r1", expires_at: Math.floor(Date.now() / 1000) + 600, user: { id: "u1" } }));
    const base = vi.fn(() => new Promise<Response>(() => undefined)) as unknown as typeof fetch;
    const f = criarFetchComPrazo(base, 30);
    const primeira = f(RENOVAR, corpo("r1")).catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(PRAZO_PARA_SOLTAR_RENOVACAO_MS + 10);
    expect(await primeira).toBeInstanceOf(TypeError);
    expect(base).toHaveBeenCalledTimes(1);

    // Simula aba A suspensa: mapa local e marca somem, pulso para; o HTTP (e a trava) seguem.
    esquecerRenovacaoEmVooParaTeste();
    expect(localStorage.getItem(CHAVE_DA_MARCA_EM_VOO)).toBeNull();

    const outra = criarFetchComPrazo(vi.fn(async () => new Response("{}", { status: 500 })) as unknown as typeof fetch);
    localStorage.setItem(CHAVE_PADRAO, JSON.stringify({ access_token: "a1", refresh_token: "r1", expires_at: Math.floor(Date.now() / 1000) + 600, user: { id: "u1" } }));
    const r = await outra(RENOVAR, corpo("r1"));
    expect((await r.json()).access_token).toBe("a1");
    expect(base).toHaveBeenCalledTimes(1);
  });

  it("depois de 10 min, setItem do par velho (expires_at menor) ainda não sobrescreve o novo", async () => {
    const agora = Math.floor(Date.now() / 1000);
    localStorage.setItem(CHAVE_PADRAO, JSON.stringify({ access_token: "a2", refresh_token: "r2", expires_at: agora + 3600, user: { id: "u1" } }));
    esquecerMapaDeTrocasParaTeste();
    localStorage.removeItem(CHAVE_DOS_TROCADOS);
    const s = protegerSessaoGuardada({
      getItem: (k: string) => localStorage.getItem(k),
      setItem: (k: string, v: string) => localStorage.setItem(k, v),
      removeItem: (k: string) => void localStorage.removeItem(k),
    })!;
    await s.setItem(CHAVE_PADRAO, JSON.stringify({ access_token: "a1", refresh_token: "r1", expires_at: agora + 100, user: { id: "u1" } }));
    expect(JSON.parse(localStorage.getItem(CHAVE_PADRAO) || "{}").refresh_token).toBe("r2");
  });

  it("o mesmo vale para /oauth/token com grant_type=refresh_token", () => {
    expect(ehPedidoDeRenovacao("https://x.supabase.co/auth/v1/oauth/token", { method: "POST", body: "grant_type=refresh_token&refresh_token=r" })).toBe(true);
    expect(ehPedidoDeRenovacao(RENOVAR)).toBe(true);
    expect(ehPedidoDeRenovacao("https://x.supabase.co/auth/v1/token?grant_type=password")).toBe(false);
    expect(ehPedidoDeRenovacao("https://x.supabase.co/rest/v1/token?grant_type=refresh_token")).toBe(false);
  });

  it("token recusado pelo servidor não é reenviado (para a rajada de refresh_token_not_found)", async () => {
    const base = vi.fn(async () =>
      new Response(JSON.stringify({ code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" }), { status: 400 }),
    ) as unknown as typeof fetch;
    const f = criarFetchComPrazo(base);
    expect((await f(RENOVAR, corpo("morto"))).status).toBe(400);
    expect(tokenEstaMorto("morto")).toBe(true);
    const segunda = await f(RENOVAR, corpo("morto"));
    expect(segunda.status).toBe(400);
    expect((await segunda.json()).error_code).toBe("refresh_token_not_found");
    expect(base).toHaveBeenCalledTimes(1);
    // Outro token segue normal.
    await f(RENOVAR, corpo("vivo"));
    expect(base).toHaveBeenCalledTimes(2);
  });

  it("erro de rede/500 na renovação não marca o token como morto", async () => {
    const base = vi.fn(async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    await criarFetchComPrazo(base)(RENOVAR, corpo("r1"));
    expect(tokenEstaMorto("r1")).toBe(false);
  });
});

describe("storage da sessão: token velho não apaga a sessão nova de outra aba", () => {
  function memoria(inicial: Record<string, string>) {
    const dados = { ...inicial };
    return {
      dados,
      getItem: (k: string) => dados[k] ?? null,
      setItem: (k: string, v: string) => void (dados[k] = v),
      removeItem: (k: string) => void delete dados[k],
    };
  }
  const CHAVE = "sb-x-auth-token";

  it("depois de refresh_token_not_found, se o storage já tem outro token vivo, não apaga", async () => {
    const m = memoria({ [CHAVE]: JSON.stringify({ refresh_token: "novo-da-outra-aba", user: { id: "u1" } }) });
    const s = protegerSessaoGuardada(m)!;
    registrarTokenMorto("velho");
    await s.removeItem(CHAVE);
    expect(m.dados[CHAVE]).toBeDefined();
  });

  it("revisão do Codex: duas (ou mais) remoções seguidas depois do token morto não apagam a sessão nova", async () => {
    const m = memoria({ [CHAVE]: JSON.stringify({ refresh_token: "novo-da-outra-aba", user: { id: "u1" } }) });
    const s = protegerSessaoGuardada(m)!;
    registrarTokenMorto("velho");
    // _callRefreshToken e depois _recoverAndRefresh: o supabase-js apaga duas vezes.
    await s.removeItem(CHAVE);
    await s.removeItem(CHAVE);
    await s.removeItem(CHAVE);
    expect(JSON.parse(m.dados[CHAVE]).refresh_token).toBe("novo-da-outra-aba");
  });

  it("passada a janela da proteção, a remoção apaga", async () => {
    vi.useFakeTimers();
    const m = memoria({ [CHAVE]: JSON.stringify({ refresh_token: "novo-da-outra-aba", user: { id: "u1" } }) });
    const s = protegerSessaoGuardada(m)!;
    registrarTokenMorto("velho");
    await s.removeItem(CHAVE);
    expect(m.dados[CHAVE]).toBeDefined();
    vi.advanceTimersByTime(JANELA_DA_PROTECAO_MS + 1);
    await s.removeItem(CHAVE);
    expect(m.dados[CHAVE]).toBeUndefined();
  });

  it("saída de propósito (esquecerTokensMortos) apaga mesmo dentro da janela", async () => {
    const m = memoria({ [CHAVE]: JSON.stringify({ refresh_token: "novo-da-outra-aba", user: { id: "u1" } }) });
    const s = protegerSessaoGuardada(m)!;
    registrarTokenMorto("velho");
    await s.removeItem(CHAVE);
    expect(m.dados[CHAVE]).toBeDefined();
    esquecerTokensMortos();
    await s.removeItem(CHAVE);
    expect(m.dados[CHAVE]).toBeUndefined();
  });

  it("não volta a gravar um refresh token que já foi trocado neste navegador", async () => {
    let responder: (r: Response) => void = () => undefined;
    const f = criarFetchComPrazo(() => new Promise<Response>((ok) => (responder = ok)));
    const p = f(RENOVAR, corpo("velho"));
    await new Promise((r) => setTimeout(r, 1));
    responder(new Response(JSON.stringify({ access_token: "a2", refresh_token: "novo", expires_in: 3600 }), { status: 200 }));
    await p;
    const m = memoria({ [CHAVE]: JSON.stringify({ refresh_token: "novo", user: { id: "u1" } }) });
    const s = protegerSessaoGuardada(m)!;
    await s.setItem(CHAVE, JSON.stringify({ refresh_token: "velho", user: { id: "u1" } }));
    expect(JSON.parse(m.dados[CHAVE]).refresh_token).toBe("novo");
    await s.setItem(CHAVE, JSON.stringify({ refresh_token: "outro", user: { id: "u1" } }));
    expect(JSON.parse(m.dados[CHAVE]).refresh_token).toBe("outro");
  });

  it("se o storage tem o mesmo token que morreu, apaga (sessão morta de verdade)", async () => {
    const m = memoria({ [CHAVE]: JSON.stringify({ refresh_token: "velho", user: { id: "u1" } }) });
    const s = protegerSessaoGuardada(m)!;
    registrarTokenMorto("velho");
    await s.removeItem(CHAVE);
    expect(m.dados[CHAVE]).toBeUndefined();
  });

  it("saída normal (sem token recusado) apaga como sempre", async () => {
    const m = memoria({ [CHAVE]: JSON.stringify({ refresh_token: "r", user: { id: "u1" } }) });
    await protegerSessaoGuardada(m)!.removeItem(CHAVE);
    expect(m.dados[CHAVE]).toBeUndefined();
  });

  it("sem storage (fora do navegador) continua sem storage", () => {
    expect(protegerSessaoGuardada(undefined)).toBeUndefined();
  });
});

describe("cliente e abertura", () => {
  it("o cliente usa o fetch do login, e a abertura não força renovação", () => {
    const cliente = readFileSync(resolve(__dirname, "../integrations/supabase/client.ts"), "utf8");
    expect(cliente).toContain("global: { fetch: criarFetchComPrazo(undefined, undefined, { storage: armazenamentoDoLogin }) }");
    const auth = readFileSync(resolve(__dirname, "../contexts/AuthContext.tsx"), "utf8");
    // Só comentário pode citar refreshSession: nenhuma chamada.
    expect(auth).not.toMatch(/\.refreshSession\(/);
    // Nenhum signOut sem scope.
    expect(auth).not.toMatch(/signOut\(\s*\)/);
  });
});
