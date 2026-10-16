import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 16/10/2026, o dono: "Quando eu clico no cliente, ele atualiza o painel e
 * reinicia." Com versão nova publicada, a troca de tela recarregava a página
 * inteira (atualizarNaTrocaDeTela). Agora trocar de tela nunca recarrega: a
 * versão nova só acende um ícone no topo, que recarrega quando a pessoa clica.
 * E a equipe baixa as telas em segundo plano, para a navegação não depender
 * dos pedaços que a próxima publicação apaga.
 */

const estado = vi.hoisted(() => {
  (globalThis as { __APP_BUILD_ID__?: string }).__APP_BUILD_ID__ = "versao-aberta";
  return {
    auth: {
      user: { id: "dono" } as null | { id: string },
      profile: { role: "admin", full_name: "Dono" } as null | { role: string; full_name: string },
      loading: false,
      profileError: false,
    },
    agendas: [] as Array<() => ReadonlyArray<() => Promise<unknown>>>,
  };
});

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => estado.auth }));
vi.mock("@/components/AppLayout", async (original) => ({
  ...(await original<typeof import("@/components/AppLayout")>()),
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/lib/appRefresh", async (original) => {
  const real = await original<typeof import("@/lib/appRefresh")>();
  return {
    ...real,
    // Guarda o que seria baixado, sem baixar de verdade no teste.
    agendarPreCargaEmSegundoPlano: (carregadores: () => ReadonlyArray<() => Promise<unknown>>) => {
      estado.agendas.push(carregadores);
      return () => undefined;
    },
  };
});
vi.mock("@/pages/AdminDashboard", () => ({ default: () => <h1>Painel da equipe</h1> }));
vi.mock("@/pages/ClientDashboard", () => ({ default: () => <h1>Painel do cliente</h1> }));
vi.mock("@/pages/Projects", () => ({ default: () => <h1>Tela de projetos</h1> }));
vi.mock("@/pages/Clients", () => ({ default: () => <h1>Tela de clientes</h1> }));

import { AppRoutes } from "@/App";
import { BotaoVersaoNova } from "@/components/AppLayout";
import { startVersionWatch, versaoNovaPendente } from "@/lib/appRefresh";

const TENTATIVAS = "aceleriq-refresh-attempts";
const ATUALIZACOES = "aceleriq-update-reloads";
const lista = (chave: string): number[] => JSON.parse(sessionStorage.getItem(chave) || "[]");
const TITULO = "Nova versão do painel: clique para atualizar";

function Navegar() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => navigate("/projetos")}>ir para projetos</button>
      <button type="button" onClick={() => navigate("/clientes")}>ir para clientes</button>
    </>
  );
}

function montar(caminho = "/dashboard") {
  return render(
    <MemoryRouter initialEntries={[caminho]}>
      <BotaoVersaoNova />
      <AppRoutes />
      <Navegar />
    </MemoryRouter>,
  );
}

/** Abre com a versão aberta; na volta para a aba o servidor já tem a nova. */
async function publicarVersaoNova() {
  let vezes = 0;
  const buscar = vi.fn(async () => {
    vezes += 1;
    return new Response(JSON.stringify({ buildId: vezes === 1 ? "versao-aberta" : "versao-nova" }), { status: 200 });
  });
  vi.stubGlobal("fetch", buscar);
  const parar = startVersionWatch();
  await vi.waitFor(() => expect(buscar).toHaveBeenCalledTimes(1));
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await vi.waitFor(() => expect(versaoNovaPendente()).toBe(true));
  parar();
}

beforeEach(() => {
  sessionStorage.clear();
  estado.agendas = [];
  estado.auth = { user: { id: "dono" }, profile: { role: "admin", full_name: "Dono" }, loading: false, profileError: false };
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("versão nova sem recarregar o painel na troca de tela", () => {
  it("com versão nova pendente, trocar de tela não recarrega; o ícone aparece e recarrega no clique", async () => {
    montar();
    expect(await screen.findByText("Painel da equipe")).toBeInTheDocument();
    expect(screen.queryByTitle(TITULO)).toBeNull();

    await publicarVersaoNova();
    const icone = await screen.findByTitle(TITULO);
    expect(icone).toHaveAttribute("aria-label", TITULO);

    fireEvent.click(screen.getByText("ir para projetos"));
    expect(await screen.findByText("Tela de projetos")).toBeInTheDocument();
    fireEvent.click(screen.getByText("ir para clientes"));
    expect(await screen.findByText("Tela de clientes")).toBeInTheDocument();

    // Nenhuma recarga saiu com as trocas de tela (as duas recargas gravam aqui antes de sair).
    expect(lista(ATUALIZACOES)).toHaveLength(0);
    expect(lista(TENTATIVAS)).toHaveLength(0);

    fireEvent.click(screen.getByTitle(TITULO));
    expect(lista(ATUALIZACOES)).toHaveLength(1);
  });

  it("equipe logada agenda a pré-carga com o mesmo import() de cada rota lazy e das mesas", async () => {
    montar();
    expect(await screen.findByText("Painel da equipe")).toBeInTheDocument();
    expect(estado.agendas).toHaveLength(1);

    const fonte = readFileSync(resolve(process.cwd(), "src/App.tsx"), "utf8");
    const rotasLazy = (fonte.match(/rotas\.lazy\(\(\) => import\(/g) || []).length;
    expect(rotasLazy).toBeGreaterThan(40);
    // Nenhuma tela ficou de fora do registro (lazy puro não entraria na pré-carga).
    expect(fonte).not.toMatch(/= lazy\(\(\) => import\(/);

    const carregadores = estado.agendas[0]();
    // Rotas + páginas e etapas das mesas (admin usa as mesas).
    expect(carregadores.length).toBeGreaterThan(rotasLazy + 11);
    for (const carregar of carregadores) expect(typeof carregar).toBe("function");
  });

  it("cliente não baixa as telas da equipe em segundo plano", async () => {
    estado.auth = { user: { id: "cliente" }, profile: { role: "client", full_name: "Cliente" }, loading: false, profileError: false };
    montar();
    expect(await screen.findByText("Painel do cliente")).toBeInTheDocument();
    expect(estado.agendas).toHaveLength(0);
  });
});
