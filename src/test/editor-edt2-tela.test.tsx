import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import { projetoDosTakes, type ProjetoDeEdicao } from "../../supabase/functions/_shared/projeto-de-edicao";
import { aplicarOperacao } from "@/lib/editor/operacoes";

/**
 * Tela do editor completo (frente EDT, rodada 2): o "Editar com IA" pelo
 * Plano da casa (sem modelo) monta a edição inteira numa proposta e só muda
 * com Confirmar; a Cor muda na hora e salva; o Exportar mostra a máquina de
 * render antes do clique e pede um render por formato. Função e banco
 * simulados; o Player do Remotion vira uma caixa (o jsdom não toca vídeo).
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = () => {
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update", "insert"]) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    b.single = () => Promise.resolve({ data: null, error: null });
    b.then = (ok: any, falha: any) => Promise.resolve({ data: [], error: null }).then(ok, falha);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      from: () => consulta(),
      storage: {
        from: () => ({
          upload: vi.fn().mockResolvedValue({ data: { path: "x" }, error: null }),
          list: vi.fn().mockResolvedValue({ data: [], error: null }),
          createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://x.supabase.co/v.mp4" }, error: null }),
          createSignedUrls: (caminhos: string[]) => Promise.resolve({ data: caminhos.map((p) => ({ path: p, signedUrl: `https://x.supabase.co/${p}`, error: null })), error: null }),
        }),
      },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
vi.mock("@remotion/player", () => ({ Player: () => h("div", { "data-player-falso": "" }) }));

import EditorDeVideo from "@/components/mesa-edicao/editor/EditorDeVideo";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const VERSAO = "22222222-2222-4222-8222-222222222222";

const valor = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Café Sintético",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 10,
  catalogo: [],
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

function projeto(): ProjetoDeEdicao {
  const p = projetoDosTakes({
    titulo: "Reel",
    fps: 25,
    takes: [{ id: "a", nome: "fala.mp4", tipo: "bruto", storage_bucket: "mesa", storage_path: `${CLIENTE}/video/brutos/a.mp4`, cena_ref: null, melhor: true, duracao_s: 12, largura: 1080, altura: 1920 }],
  });
  const palavras = "Você perde cliente todo dia. Eu vendi 300 cafés em uma semana! Comenta CAFÉ que eu te mando.".split(" ");
  const segmentos = palavras.map((t, k) => ({ t, i: Math.round((0.4 + k * 0.5 + (k > 4 ? 0.8 : 0)) * 1000) / 1000, f: Math.round((0.8 + k * 0.5 + (k > 4 ? 0.8 : 0)) * 1000) / 1000 }));
  return aplicarOperacao(p, { op: "transcricao", fonte: "fala", transcricao: { segmentos, por_palavra: true, origem: "teste", versao: 1, em: null } });
}

function comMusica(p: ProjetoDeEdicao): ProjetoDeEdicao {
  return aplicarOperacao(p, { op: "fonte", fonte: { chave: "trilha-leve", arquivo_id: null, nome: "Trilha leve.mp3", tipo: "audio", storage_bucket: "mesa", storage_path: `${CLIENTE}/audio/trilha.mp3`, duracao_s: 60, largura: null, altura: null, midia: "audio" } });
}

function montar(p: ProjetoDeEdicao = projeto()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, null, h(TooltipProvider, null, h(MesaProvider, { valor: valor(), children: h(EditorDeVideo, { versaoId: VERSAO, projetoInicial: p, revisao: 2 }) })))));
}

const chamadas = (acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[1].body.acao === acao).map((c: any[]) => c[1].body);
const ultimoSalvo = () => {
  const l = chamadas("projeto_salvar");
  return l.length ? l[l.length - 1].projeto : null;
};

async function abrirPainel(nome: RegExp) {
  fireEvent.click(await screen.findByRole("tab", { name: nome }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mock.invoke.mockImplementation((_f: string, { body }: any) => {
    if (body.acao === "projeto_salvar") return Promise.resolve({ data: { versao: { projeto: { revisao: body.revisao_lida + 1 } } }, error: null });
    if (body.acao === "momentos_avaliar") return Promise.resolve({ data: { forca: (body.frases || []).map((f: any, i: number) => ({ k: f.k, nota: i === 1 ? 0.95 : 0.1 })), virais: [] }, error: null });
    if (body.acao === "animacoes_sugerir") return Promise.resolve({ data: { sugestoes: [] }, error: null });
    if (body.acao === "render_pedir") return Promise.resolve({ data: { pedido: { id: `p-${body.uid}`, tipo: body.tipo, estado: "fila", etapa: null, progresso: 0, entrada: body.formato ? { formato: body.formato } : {}, resultado: null, erro_mensagem: null, criado_em: new Date().toISOString(), concluido_em: null, arquivo_id: null, url: null }, ja_existia: false }, error: null });
    return Promise.resolve({ data: {}, error: null });
  });
  Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 });
  (window as any).IntersectionObserver = class {
    observe() {}
    disconnect() {}
  };
  (globalThis as any).CSS = { supports: () => true };
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
});

describe("editor completo na tela", () => {
  it("abre no Editar com IA; o Plano da casa monta tudo e só muda com Confirmar", async () => {
    montar();
    expect(document.querySelector('[data-painel-editar-com-ia="pedido"]')).toBeTruthy();
    fireEvent.click(document.querySelector("[data-plano-da-casa]") as HTMLElement);
    await waitFor(() => expect(document.querySelector("[data-plano-da-edicao]")).toBeTruthy());
    fireEvent.click(document.querySelector("[data-montar-edicao]") as HTMLElement);
    const confirmar = await screen.findByRole("button", { name: "Confirmar" }, { timeout: 5000 });
    // O Jev foi consultado sobre o projeto JÁ cortado e nada mudou ainda.
    expect(chamadas("momentos_avaliar")).toHaveLength(1);
    expect(document.querySelector('[data-clipe^="l"]')).toBeNull();
    expect(document.querySelector("[data-proposta-da-ia]")!.textContent).toMatch(/Legendas/);
    fireEvent.click(confirmar);
    await waitFor(() => expect(document.querySelector('[data-clipe^="l"]')).toBeTruthy());
    await waitFor(() => expect(ultimoSalvo()).toBeTruthy(), { timeout: 4000 });
    const salvo = ultimoSalvo();
    // 02/10: a câmera é por plano (com motivo), não o empurrão da camada de ajuste.
    expect(salvo.trilhas.some((t: any) => t.tipo === "video" && t.clipes.some((c: any) => !!c.zoom))).toBe(true);
    expect(salvo.cor.look).toBe("vivo");
    expect(salvo.skills_aplicadas.some((s: any) => s.skill === "editar_com_ia")).toBe(true);
  }, 30000);

  it("Plano da casa com música na Mídia: a música vem escolhida e sai a trilha com papel trilha", async () => {
    montar(comMusica(projeto()));
    fireEvent.click(document.querySelector("[data-plano-da-casa]") as HTMLElement);
    await waitFor(() => expect(document.querySelector("[data-plano-da-edicao]")).toBeTruthy());
    const musica = document.querySelector("[data-musica-do-plano]") as HTMLSelectElement;
    expect(musica.value).toBe("trilha-leve");
    expect(Array.from(musica.options).map((o) => o.textContent)).toEqual(["Sem música", "Trilha leve.mp3"]);
    fireEvent.click(document.querySelector("[data-montar-edicao]") as HTMLElement);
    const confirmar = await screen.findByRole("button", { name: "Confirmar" }, { timeout: 5000 });
    expect(document.querySelector("[data-proposta-da-ia]")!.textContent).toMatch(/Música/);
    fireEvent.click(confirmar);
    await waitFor(() => expect(ultimoSalvo() && ultimoSalvo().trilhas.some((t: any) => t.tipo === "audio" && t.clipes.some((c: any) => c.fonte === "trilha-leve" && c.estilo && c.estilo.papel === "trilha"))).toBe(true), { timeout: 4000 });
  }, 30000);

  it("Cor: o look muda na hora e salva; Exportar mostra a máquina e pede um render por formato", async () => {
    montar();
    await abrirPainel(/^Cor(?!te)/);
    fireEvent.click(screen.getByRole("button", { name: "Cinema" }));
    await waitFor(() => expect(ultimoSalvo() && ultimoSalvo().cor.look).toBe("cinema"), { timeout: 4000 });

    await abrirPainel(/^Exportar/);
    await waitFor(() => expect(document.querySelector('[data-painel="exportar"] [data-estado-da-maquina="nunca"]')).toBeTruthy());
    fireEvent.click(screen.getByLabelText(/^1:1/));
    fireEvent.click(document.querySelector("[data-exportar-formatos]") as HTMLElement);
    await waitFor(() => expect(chamadas("render_pedir")).toHaveLength(2), { timeout: 5000 });
    const formatos = chamadas("render_pedir").map((b: any) => b.formato || "atual").sort();
    expect(formatos).toEqual(["1:1", "atual"]);
    chamadas("render_pedir").forEach((b: any) => expect(b.tipo).toBe("render_final"));
  }, 30000);
});
