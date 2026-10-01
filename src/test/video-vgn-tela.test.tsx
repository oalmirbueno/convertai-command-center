import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import { MOTORES_DE_VIDEO, motorPorId } from "../../supabase/functions/mesa-videos/modulos/modelos-de-video";
import { oQueFaltaParaGerar, podeRecuperar, proximaConferencia, resumoDaColeta } from "../../supabase/functions/mesa-videos/modulos/coleta-de-video";
import { guiaDoMotor, lerPromptDoDiretor, mensagemDoPrompt, sistemaDoPrompt } from "../../supabase/functions/mesa-videos/modulos/prompt-do-motor";

/**
 * Frente VGN (30/09/2026): coleta sem tela, recuperar, o que falta para gerar
 * (chave e carteira), o diretor que escreve o prompt e a foto que fala.
 * Tudo com rede e banco simulados: nada sai para o provedor.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = () => {
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update", "insert"]) b[m] = () => b;
    b.maybeSingle = () => Promise.resolve({ data: null, error: null });
    b.single = b.maybeSingle;
    b.then = (ok: any, falha: any) => Promise.resolve({ data: [], error: null }).then(ok, falha);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      from: () => consulta(),
      storage: { from: () => ({ list: () => Promise.resolve({ data: [], error: null }), createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://x.supabase.co/a" }, error: null }) }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));

import SituacaoDoGerador, { resumoDosProvedores } from "@/components/mesa-videos/SituacaoDoGerador";
import FotoQueFala from "@/components/mesa-videos/FotoQueFala";
import { BotaoDeGerar } from "@/components/mesa-videos/PecasDoGerador";
import { MODOS_DO_GERAR } from "@/components/mesa-videos/modosDoGerar";

const CLIENTE = "11111111-1111-4111-8111-111111111111";
const valor = (saldo: number): MesaValor => ({ clientId: CLIENTE, clientName: "Café", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: saldo, catalogo: [], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn() });
function montar(filho: any, saldo = 10) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const v = valor(saldo);
  const r = render(h(QueryClientProvider, { client: qc }, h(MemoryRouter, { initialEntries: [`/mesa-videos?client=${CLIENTE}&etapa=gerar`] }, h(TooltipProvider, null, h(MesaProvider, { valor: v, children: filho })))));
  return { ...r, valor: v };
}
/** O estado que a função devolveria hoje: só FAL_KEY existe (dado real de 30/09). */
const estadosReais = () => ({
  motores: MOTORES_DE_VIDEO.map((m) => {
    const semChave = m.provedor !== "fal" && m.provedor !== "painel" && !m.situacao;
    return { id: m.id, estado: m.situacao || (semChave ? "precisa_chave" : "pronto"), estado_rotulo: semChave ? "Precisa de chave" : "Pronto", nivel: "normal", novo: false, chave: semChave ? [m.chave_env, m.segredo_env || ""].filter(Boolean).join(", ") : null };
  }),
});

beforeEach(() => {
  vi.clearAllMocks();
  try {
    window.localStorage.clear();
  } catch {
    /* sem armazenamento */
  }
  (window as any).IntersectionObserver = class {
    observe() {}
    disconnect() {}
  };
});

describe("coleta e recuperar (puro)", () => {
  const envio = { estado: "erro", erro: "Passou do prazo de 10 min sem terminar. Nada foi cobrado.", request_id: "01a0e9d7", status_url: "https://queue.fal.run/x/requests/01a0e9d7/status", arquivo_id: null, enviado_em: "2026-09-28T21:06:43.539Z" };
  it("o pedido real de 28/09 (venceu por prazo) pode ser recuperado; erro do provedor não", () => {
    const agora = Date.parse("2026-09-30T20:00:00Z");
    expect(podeRecuperar(envio, agora)).toBe(true);
    expect(podeRecuperar({ ...envio, erro: "O provedor recusou os parâmetros: prompt" }, agora)).toBe(false);
    expect(podeRecuperar({ ...envio, arquivo_id: "a1" }, agora)).toBe(false);
    expect(podeRecuperar({ ...envio, request_id: "" }, agora)).toBe(false);
    expect(podeRecuperar(envio, Date.parse("2026-10-09T00:00:00Z"))).toBe(false);
  });
  it("tela aberta confere em 20 s, 40 s, 80 s, até 2 min; sem pedido, não confere", () => {
    expect([0, 1, 2, 3, 9].map((n) => proximaConferencia(n, 1))).toEqual([20000, 40000, 80000, 120000, 120000]);
    expect(proximaConferencia(0, 0)).toBeNull();
  });
  it("resumo da coleta", () => {
    expect(resumoDaColeta([{ id: "a", estado: "gerando" }, { id: "b", estado: "gerando" }], [{ id: "a", estado: "pronto" }, { id: "b", estado: "erro" }])).toEqual({ conferidos: 2, prontos: 1, erros: 1 });
  });
  it("o que falta: chave, depois carteira (com os valores)", () => {
    expect(oQueFaltaParaGerar({ motorRotulo: "Runway Gen-4.5", estado: "precisa_chave", chave: "RUNWAYML_API_SECRET", custoUsd: 0.6, saldoUsd: 10 })).toMatch(/RUNWAYML_API_SECRET/);
    expect(oQueFaltaParaGerar({ custoUsd: 2.37, saldoUsd: 0.07 })).toBe("A carteira de IA do cliente tem US$ 0,07 e este vídeo custa US$ 2,37. Recarregue a carteira do cliente para gerar.");
    expect(oQueFaltaParaGerar({ custoUsd: 0.5, saldoUsd: 10 })).toBeNull();
    expect(oQueFaltaParaGerar({ custoUsd: 0.5, saldoUsd: null })).toBeNull();
  });
});

describe("diretor escreve o prompt (puro)", () => {
  it("guia do motor e instruções com a marca como dado", () => {
    expect(guiaDoMotor(motorPorId("seedance-2.5")!)).toMatch(/@Image1/);
    expect(guiaDoMotor(motorPorId("kling-o3-pro")!)).toMatch(/@Element1/);
    expect(guiaDoMotor(motorPorId("luma-ray-3.2")!)).toMatch(/no audio/);
    const s = sistemaDoPrompt(motorPorId("veo-3.1")!, "Marca: Café da Serra. Paleta: verde e creme.");
    expect(s).toMatch(/Café da Serra/);
    expect(s).toMatch(/Nunca invente produto, preço/);
    expect(s).toMatch(/Nada de logo, texto na tela/);
    // Revisão: com dossiê e consolidado longos, o kit, o tom e o briefing (que vêm logo depois da marca) chegam ao modelo.
    const longo = ["Cliente: Café da Serra", "Kit da marca: verde #1F5E3B e creme", "Estratégia aprovada: tom acolhedor e direto; tagline \"Café de quem acorda cedo\"", "Briefing: lançamento do blend de inverno", `Contexto consolidado: ${"x".repeat(3000)}`, `Dossiê:\n${"d".repeat(4000)}`].join("\n\n");
    const comLongo = sistemaDoPrompt(motorPorId("veo-3.1")!, longo);
    expect(comLongo).toMatch(/#1F5E3B/);
    expect(comLongo).toMatch(/tom acolhedor e direto/);
    expect(comLongo).toMatch(/blend de inverno/);
    expect(comLongo).toContain("d".repeat(4000));
    expect(mensagemDoPrompt({ texto: "a dona abre a loja", modo: "primeiro_quadro", formato: "9:16", duracao_s: 6, audio: true, referencias: 0, tem_quadro_inicial: true, tem_quadro_final: false })).toMatch(/quadro inicial/);
  });
  it("limpa a resposta: sem travessão, listas curtas; sem prompt não aplica", () => {
    const r = lerPromptDoDiretor({ prompt: "Medium shot of a barista — slow dolly in, warm window light", negativo: "text, logo", fala_pt: "Bom dia!", notas: ["a", "b", "c", "d"], avisos: [] })!;
    expect(r.prompt).toBe("Medium shot of a barista, slow dolly in, warm window light");
    expect(r.notas).toHaveLength(3);
    expect(lerPromptDoDiretor({ prompt: "" })).toBeNull();
  });
});

describe("tela", () => {
  it("modo Foto que fala entra no Gerar", () => {
    expect(MODOS_DO_GERAR.map((m) => m.valor)).toContain("labial");
  });

  it("situação do gerador: fal pronto, Runway/Higgsfield/HeyGen opcionais com o nome da chave e a carteira curta", async () => {
    mock.invoke.mockImplementation((_f: string, { body }: any) => Promise.resolve({ data: body.acao === "motores_estado" ? estadosReais() : {}, error: null }));
    montar(h(SituacaoDoGerador), 0.07);
    await waitFor(() => expect(document.body.textContent).toMatch(/Carteira do cliente com US\$ 0,07: não cobre um vídeo/), { timeout: 8000 });
    // A seção nasce aberta (padrão do sistema): as linhas já estão à vista.
    await waitFor(() => expect(document.body.textContent).toMatch(/falta RUNWAYML_API_SECRET \(opcional\)/));
    expect(document.body.textContent).toMatch(/fal\.ai/);
    expect(document.body.textContent).toMatch(/Recarregue para gerar/);
    fireEvent.click(screen.getByRole("button", { name: "Recarregar" }));
  });

  it("botão de gerar trava com a carteira curta ANTES do clique e diz os valores", () => {
    montar(h(BotaoDeGerar, { custo: { usd: 2.365, detalhe: "US$ 0.473/s x 5 s", incerto: false }, onConfirmar: vi.fn() }), 0.07);
    const b = screen.getByRole("button", { name: /Gerar/ });
    expect(b.hasAttribute("disabled")).toBe(true);
    expect(document.body.textContent).toMatch(/tem US\$ 0,07 e este vídeo custa US\$ 2,37/);
  });

  it("resumo dos provedores pela lista da tela (só nomes de chave)", () => {
    const lista = MOTORES_DE_VIDEO.map((m) => ({ motor: m, estado: (m.provedor === "runway" ? "precisa_chave" : "pronto") as any, estado_rotulo: "", nivel: "normal" as const, novo: false, chave: m.provedor === "runway" ? m.chave_env : null }));
    const r = resumoDosProvedores(lista);
    expect(r[0].provedor).toBe("fal");
    expect(r.find((x) => x.provedor === "runway")!.faltam).toEqual(["RUNWAYML_API_SECRET"]);
  });

  it("foto que fala: sem áudio no acervo, pede para subir e não gera", async () => {
    mock.invoke.mockImplementation((_f: string, { body }: any) => Promise.resolve({ data: body.acao === "motores_estado" ? estadosReais() : {}, error: null }));
    montar(h(FotoQueFala));
    await waitFor(() => expect(document.body.textContent).toMatch(/H3 Max Lip Sync/), { timeout: 8000 });
    expect(document.body.textContent).toMatch(/Escolha a foto de quem fala/);
    const b = screen.getByRole("button", { name: /Gerar a fala/ });
    expect(b.hasAttribute("disabled")).toBe(true);
    expect(mock.invoke.mock.calls.some((c: any[]) => c[1] && c[1].body && c[1].body.acao === "labial_gerar")).toBe(false);
  });
});
