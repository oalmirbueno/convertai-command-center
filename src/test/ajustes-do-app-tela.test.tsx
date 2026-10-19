import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { useState } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ajustes do app (20/10/2026, "perfil perfeito" da aba Redes): o bloco da tela (tipo de negócio
 * pelo Jev e troca da equipe, progresso, grupos que recolhem, caixa de marcar com o caminho e o "?"),
 * a linha "Ajustes do app: x de y" no diagnóstico e o contrato da função e da migration.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), erro: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: mock.invoke }, rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() } },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: mock.erro, warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import AjustesDoApp from "@/components/mesa/instagram/AjustesDoApp";
import DiagnosticoDoPerfil from "@/components/mesa/instagram/DiagnosticoDoPerfil";
import { normalizarPainel, normalizarPerfil } from "@/components/mesa/instagram/instagramApi";
import { AJUSTES_DO_APP, type EstadoDosAjustes } from "../../supabase/functions/mesa-instagram/modulos/ajustes-do-app";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const TOTAL = AJUSTES_DO_APP.length;
const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE, clientName: "Pizzaria Teste", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50,
  catalogo: [], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
});

function montar(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={qc}>
        <TooltipProvider>
          <MesaProvider valor={valorDaMesa()}>{filho}</MesaProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** O bloco com o estado de verdade (como a aba faz com o painel guardado). */
function ComEstado({ inicial }: { inicial: EstadoDosAjustes }) {
  const [estado, setEstado] = useState(inicial);
  return <AjustesDoApp clientId={CLIENTE} contaId="conta-1" estado={estado} onMudar={(fn) => setEstado((e) => fn(e))} />;
}

const vazio = (): EstadoDosAjustes => ({ tipo_de_negocio: null, itens: {} });
const comTipo = (tipo: "criador" | "negocio_local" | "loja" | "profissional_liberal" | "nao_sei", origem: "jev" | "equipe" = "equipe"): EstadoDosAjustes => ({
  tipo_de_negocio: { tipo, origem, confianca: 0.8, probabilidades: {}, quando: "2026-10-20T10:00:00Z", por: null },
  itens: {},
});

const chamadasDe = (acao: string) =>
  mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-instagram" && c[1] && c[1].body && c[1].body.acao === acao).map((c: any[]) => c[1].body);

const linhaDo = (chave: string) => document.querySelector(`[data-ajuste="${chave}"]`) as HTMLElement;

beforeEach(() => {
  mock.invoke.mockReset();
  mock.erro.mockReset();
  try {
    localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

describe("bloco Ajustes do app", () => {
  it("sem tipo guardado, o Jev escolhe uma vez e a recomendação se adapta (negócio local mantém o WhatsApp)", async () => {
    mock.invoke.mockImplementation(async (_f: string, { body }: any) => {
      if (body.acao === "ajustes_do_app") return { data: { estado: comTipo("negocio_local", "jev"), custo_usd: 0.0001 }, error: null };
      return { data: null, error: null };
    });
    montar(<ComEstado inicial={vazio()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Tipo de negócio: Negócio local" })).toBeTruthy());
    expect(screen.getByText("escolhido pelo Jev")).toBeTruthy();
    expect(chamadasDe("ajustes_do_app")).toHaveLength(1);
    expect(chamadasDe("ajustes_do_app")[0]).toMatchObject({ client_id: CLIENTE, conta_id: "conta-1" });
    const contato = linhaDo("opcoes_de_contato");
    expect(within(contato).getByText(/Mantenha o WhatsApp Business e o telefone comercial/)).toBeTruthy();
    expect(within(contato).getByText("adaptado")).toBeTruthy();
    expect(within(contato).getByText(/Editar perfil > Opções de contato/)).toBeTruthy();
    expect(screen.getByText(`0 de ${TOTAL} feitos`)).toBeTruthy();
  });

  it("com tipo guardado não chama o Jev; mostra os quatro grupos e o \"?\" de cada item", () => {
    montar(<ComEstado inicial={comTipo("criador")} />);
    expect(chamadasDe("ajustes_do_app")).toHaveLength(0);
    for (const g of ["Editar perfil", "Configurações", "Ao postar foto ou carrossel", "Ao postar Reels"]) expect(screen.getByRole("region", { name: g })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Por que: Selo do Threads" })).toBeTruthy();
    // Criador: o original (apagar o contato) e perguntas frequentes fora da conta.
    expect(within(linhaDo("opcoes_de_contato")).getByText(/Apague e-mail, telefone e WhatsApp/)).toBeTruthy();
    expect(within(linhaDo("perguntas_frequentes")).getByText("não se aplica")).toBeTruthy();
    expect(screen.getByText(`0 de ${TOTAL - 2} feitos`)).toBeTruthy();
  });

  it("marcar um item grava pela função e sobe o progresso; erro volta atrás", async () => {
    mock.invoke.mockImplementation(async (_f: string, { body }: any) => {
      if (body.acao === "marcar_ajuste" && body.chave === "selo_do_threads") {
        return { data: { estado: { tipo_de_negocio: null, itens: { selo_do_threads: { feito: true, quando: "2026-10-20T11:00:00Z", por: "u-1" } } } }, error: null };
      }
      if (body.acao === "marcar_ajuste") return { data: null, error: { message: "falhou", context: null } };
      return { data: null, error: null };
    });
    montar(<ComEstado inicial={comTipo("loja")} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "Selo do Threads: feito" }));
    await waitFor(() => expect(screen.getByText(`1 de ${TOTAL} feitos`)).toBeTruthy());
    expect(chamadasDe("marcar_ajuste")[0]).toMatchObject({ chave: "selo_do_threads", feito: true, conta_id: "conta-1" });
    expect(linhaDo("selo_do_threads").getAttribute("data-feito")).toBe("sim");

    fireEvent.click(screen.getByRole("checkbox", { name: "Presentes: feito" }));
    await waitFor(() => expect(mock.erro).toHaveBeenCalled());
    await waitFor(() => expect(linhaDo("presentes").getAttribute("data-feito")).toBe("nao"));
    expect(screen.getByText(`1 de ${TOTAL} feitos`)).toBeTruthy();
  });

  it("a equipe troca o tipo no topo: grava e a recomendação muda na hora", async () => {
    mock.invoke.mockImplementation(async (_f: string, { body }: any) => {
      if (body.acao === "tipo_de_negocio") return { data: { estado: comTipo(body.tipo, "equipe") }, error: null };
      return { data: null, error: null };
    });
    montar(<ComEstado inicial={comTipo("criador", "jev")} />);
    fireEvent.click(screen.getByRole("button", { name: "Tipo de negócio: Criador de conteúdo" }));
    fireEvent.click(await screen.findByRole("option", { name: /Profissional liberal/ }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Tipo de negócio: Profissional liberal" })).toBeTruthy());
    expect(chamadasDe("tipo_de_negocio")[0]).toMatchObject({ tipo: "profissional_liberal", conta_id: "conta-1" });
    expect(screen.getByText("escolhido pela equipe")).toBeTruthy();
    expect(within(linhaDo("botao_de_acao")).getByText(/botão Agendar/)).toBeTruthy();
    expect(within(linhaDo("perguntas_frequentes")).queryByText("não se aplica")).toBeNull();
  });

  it("não sei: marca os itens que dependem do tipo", () => {
    montar(<ComEstado inicial={comTipo("nao_sei")} />);
    expect(within(linhaDo("opcoes_de_contato")).getByText("depende do tipo")).toBeTruthy();
    expect(within(linhaDo("selo_do_threads")).queryByText("depende do tipo")).toBeNull();
  });

  it("um grupo recolhe e mostra o resumo", () => {
    montar(<ComEstado inicial={comTipo("loja")} />);
    const grupo = document.querySelector('[data-grupo-de-ajustes="postar_reels"]') as HTMLElement;
    fireEvent.click(within(grupo).getByRole("button", { name: /Ao postar Reels/ }));
    expect(grupo.querySelector("[data-ajuste]")).toBeNull();
    expect(within(grupo).getByText("0 de 12")).toBeTruthy();
  });
});

describe("diagnóstico: ajustes do app x de y", () => {
  const perfil = normalizarPerfil({ username: "pizzaria", nome: "Pizzaria", bio: "Pizza", site: "" });

  it("mostra a linha e leva aos ajustes", () => {
    const abrir = vi.fn();
    const estado: EstadoDosAjustes = { ...comTipo("negocio_local"), itens: { selo_do_threads: { feito: true, quando: null, por: null } } };
    montar(<DiagnosticoDoPerfil perfil={perfil} diagnostico={null} onDiagnostico={vi.fn()} ajustes={estado} onAbrirAjustes={abrir} />);
    const botao = screen.getByRole("button", { name: `Ajustes do app: 1 de ${TOTAL}` });
    fireEvent.click(botao);
    expect(abrir).toHaveBeenCalled();
  });

  it("o painel normalizado sempre traz o estado dos ajustes (vazio quando a função antiga não manda)", () => {
    expect(normalizarPainel({}).ajustes_do_app).toEqual({ tipo_de_negocio: null, itens: {} });
    expect(normalizarPainel({ ajustes_do_app: { itens: { presentes: { feito: true } } } }).ajustes_do_app.itens.presentes.feito).toBe(true);
  });
});

describe("contrato: aba, função e migration", () => {
  it("a aba Redes tem a ferramenta Ajustes do app com ícone e o diagnóstico leva até ela", () => {
    const aba = ler("src/components/mesa/AbaInstagram.tsx");
    expect(aba).toContain('{ valor: "ajustes", rotulo: "Ajustes do app", icone: <SlidersHorizontal');
    expect(aba).toContain('onAbrirAjustes={() => setFerramenta("ajustes")}');
    expect(ler("supabase/functions/mesa-instagram/modulos/instagram-do-cliente.ts")).toContain('"redes", "ajustes"] as const;');
  });

  it("a função tem as três ações, grava pela RPC e o Jev nunca passa por cima da equipe", () => {
    const f = ler("supabase/functions/mesa-instagram/index.ts");
    expect(f).toContain("ajustes_do_app: ajustesDoApp,");
    expect(f).toContain("marcar_ajuste: marcarAjuste,");
    expect(f).toContain("tipo_de_negocio: trocarTipoDeNegocio,");
    expect(f).toContain('rpc("mesa_gravar_ajuste_do_app"');
    expect(f).toContain('gravarAjuste(c.clientId, chave, ["tipo_de_negocio"], j.tipo as unknown as Record<string, unknown>, ch.userId, true)');
    expect(f).toContain("questions: perguntaDoTipoDeNegocio()");
    expect(f).toContain("await cobrarJev(r,");
  });

  it("a migration é idempotente e a escrita é só do service_role", () => {
    const m = ler("supabase/migrations/20261020121000_ajustes_do_app_instagram.sql");
    expect(m).toContain("ADD COLUMN IF NOT EXISTS ajustes_do_app jsonb");
    expect(m).toContain("IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'cliente_instagram_planos_ajustes_do_app_objeto')");
    expect(m).toContain("CREATE OR REPLACE FUNCTION public.mesa_gravar_ajuste_do_app(");
    expect(m).toContain("FROM PUBLIC, anon, authenticated;");
    expect(m).toContain("TO service_role;");
  });

  it("os arquivos novos não têm travessão", () => {
    for (const arq of [
      "src/components/mesa/instagram/AjustesDoApp.tsx",
      "supabase/functions/mesa-instagram/modulos/ajustes-do-app.ts",
      "supabase/migrations/20261020121000_ajustes_do_app_instagram.sql",
    ]) expect(/[–—]/.test(ler(arq)), arq).toBe(false);
  });
});
