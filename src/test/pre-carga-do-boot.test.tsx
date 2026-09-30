import { useEffect } from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * PERF-B06 (30/09/2026): nenhuma tela começava a baixar o próprio código antes
 * de a sessão e o perfil responderem, e os links públicos por token também
 * esperavam o login. Agora:
 * - o link público abre sem a trava do login, na MESMA árvore (sem remontar
 *   quando o login responde);
 * - o boot adianta o download da tela do endereço, em paralelo com o login.
 */

const estado = vi.hoisted(() => ({
  auth: { user: null as null | { id: string }, profile: null as null | { role: string }, loading: true, profileError: false },
  montagens: 0,
  buscas: 0,
  mesa: vi.fn(),
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => estado.auth }));
vi.mock("@/components/AppLayout", () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("@/lib/mesa/preCarga", async (original) => ({
  ...(await original<typeof import("@/lib/mesa/preCarga")>()),
  preCarregarMesa: estado.mesa,
}));
vi.mock("@/pages/ContractPublic", () => ({
  default: function ContratoDeTeste() {
    useEffect(() => {
      estado.montagens += 1;
      estado.buscas += 1;
    }, []);
    return <h1>Contrato de teste</h1>;
  },
}));
vi.mock("@/pages/Login", () => ({ default: () => <h1>Login</h1> }));
vi.mock("@/pages/AdminDashboard", () => ({ default: () => <h1>Painel da equipe</h1> }));
vi.mock("@/pages/ClientDashboard", () => ({ default: () => <h1>Painel do cliente</h1> }));
vi.mock("@/pages/Projects", () => ({ default: () => <h1>Projetos</h1> }));

import { AppRoutes } from "@/App";
import { chaveDoPapel, preCarregarTelaDoEndereco, rotaPublicaPorToken, ROTAS_PUBLICAS_POR_TOKEN } from "@/lib/preCargaDoBoot";

function montar(caminho: string) {
  return render(
    <MemoryRouter initialEntries={[caminho]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  estado.auth = { user: null, profile: null, loading: true, profileError: false };
  estado.montagens = 0;
  estado.buscas = 0;
  estado.mesa.mockClear();
  localStorage.clear();
});

describe("link público por token não espera o login", () => {
  it("com o login ainda carregando, /contrato/:token já mostra o contrato", async () => {
    montar("/contrato/abc");
    expect(await screen.findByRole("heading", { name: "Contrato de teste" })).toBeInTheDocument();
  });

  it("rota com login continua na tela de carregando enquanto o login não responde", async () => {
    montar("/dashboard");
    expect(await screen.findByAltText("Aceleriq")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Painel/ })).toBeNull();
  });

  it("quando o login responde, a página pública não remonta (a busca roda uma vez)", async () => {
    const { rerender } = montar("/contrato/abc");
    expect(await screen.findByRole("heading", { name: "Contrato de teste" })).toBeInTheDocument();
    expect(estado.montagens).toBe(1);

    estado.auth = { user: { id: "u1" }, profile: { role: "client" }, loading: false, profileError: false };
    await act(async () => {
      rerender(
        <MemoryRouter initialEntries={["/contrato/abc"]}>
          <AppRoutes />
        </MemoryRouter>,
      );
    });

    expect(screen.getByRole("heading", { name: "Contrato de teste" })).toBeInTheDocument();
    expect(estado.montagens).toBe(1);
    expect(estado.buscas).toBe(1);
  });

  it("erro de perfil não tampa o link público", async () => {
    estado.auth = { user: { id: "u1" }, profile: null, loading: false, profileError: true };
    montar("/contrato/abc");
    expect(await screen.findByRole("heading", { name: "Contrato de teste" })).toBeInTheDocument();
  });

  it("reconhece só os links públicos por token", () => {
    for (const caminho of ["/briefing/t1", "/contrato/t1", "/marca/t1", "/nomes/t1", "/proposta/t1", "/inbox/t1", "/quiz/t1"]) {
      expect(rotaPublicaPorToken(caminho), caminho).toBe(true);
    }
    for (const caminho of ["/login", "/oauth/consent", "/primeiro-acesso", "/dashboard", "/contrato", "/contratos", "/mesa-proposta"]) {
      expect(rotaPublicaPorToken(caminho), caminho).toBe(false);
    }
  });
});

describe("o boot adianta o download da tela do endereço", () => {
  const CHAVE_DA_SESSAO = "sb-ci-placeholder-auth-token";
  const entrar = (uid: string, papel?: string) => {
    localStorage.setItem(CHAVE_DA_SESSAO, JSON.stringify({ access_token: "x", user: { id: uid } }));
    if (papel) localStorage.setItem(chaveDoPapel(uid), papel);
  };
  const local = (pathname: string, search = "") => ({ pathname, search });

  it("link público e /login baixam sempre (é o que a pessoa vai ver)", () => {
    expect(preCarregarTelaDoEndereco(local("/contrato/abc"))).toBe("publica");
    expect(preCarregarTelaDoEndereco(local("/login"))).toBe("login");
  });

  it("rota com login e sem sessão guardada adianta o /login, para onde ela vai", () => {
    expect(preCarregarTelaDoEndereco(local("/dashboard"))).toBe("login");
    expect(preCarregarTelaDoEndereco(local("/mesa-ads"))).toBe("login");
  });

  it("tela que depende do papel só baixa com a dica do papel guardada", () => {
    entrar("u1");
    expect(preCarregarTelaDoEndereco(local("/dashboard"))).toBeNull();
    entrar("u1", "admin");
    expect(preCarregarTelaDoEndereco(local("/dashboard"))).toBe("tela");
    entrar("u2", "client");
    expect(preCarregarTelaDoEndereco(local("/"))).toBe("tela");
  });

  it("tela aberta a todos baixa com qualquer sessão", () => {
    entrar("u3");
    expect(preCarregarTelaDoEndereco(local("/projetos"))).toBe("tela");
  });

  it("mesa baixa com a etapa só para os papéis das mesas", () => {
    entrar("u4", "client");
    expect(preCarregarTelaDoEndereco(local("/mesa-ads", "?client=x"))).toBeNull();
    expect(estado.mesa).not.toHaveBeenCalled();
    entrar("u5", "traffic");
    expect(preCarregarTelaDoEndereco(local("/mesa-ads"))).toBeNull();
    entrar("u6", "design");
    expect(preCarregarTelaDoEndereco(local("/mesa-ads", "?client=x"))).toBe("mesa");
    expect(estado.mesa).toHaveBeenCalledWith("/mesa-ads?client=x");
  });

  it("endereço fora das listas não baixa nada", () => {
    entrar("u7", "admin");
    expect(preCarregarTelaDoEndereco(local("/config"))).toBeNull();
    expect(preCarregarTelaDoEndereco(local("/relatorios/123"))).toBeNull();
  });

  it("sessão guardada ilegível não derruba o boot", () => {
    localStorage.setItem(CHAVE_DA_SESSAO, "{quebrado");
    expect(preCarregarTelaDoEndereco(local("/projetos"))).toBe("tela");
    expect(preCarregarTelaDoEndereco(local("/dashboard"))).toBeNull();
  });
});

describe("a pré-carga do boot baixa os mesmos arquivos das rotas", () => {
  const raiz = resolve(__dirname, "../..");
  const app = readFileSync(resolve(raiz, "src/App.tsx"), "utf8");
  const boot = readFileSync(resolve(raiz, "src/lib/preCargaDoBoot.ts"), "utf8");

  it("todo import() do boot é o mesmo de uma rota lazy do App.tsx", () => {
    const caminhos = Array.from(boot.matchAll(/import\("(@\/pages\/[A-Za-z]+)"\)/g), (m) => m[1]);
    expect(caminhos.length).toBeGreaterThan(10);
    for (const caminho of caminhos) {
      expect(app, caminho).toContain(`lazy(() => import("${caminho}"))`);
    }
  });

  it("as rotas públicas da lista existem no App.tsx", () => {
    for (const padrao of ROTAS_PUBLICAS_POR_TOKEN) {
      expect(app, padrao).toContain(`<Route path="${padrao}"`);
    }
  });

  it("o boot chama a pré-carga uma vez, no main.tsx", () => {
    const main = readFileSync(resolve(raiz, "src/main.tsx"), "utf8");
    expect(main.match(/preCarregarTelaDoEndereco\(\)/g)).toHaveLength(1);
  });
});
