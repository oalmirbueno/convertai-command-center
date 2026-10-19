import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Aba Stories da Mesa (20/10/2026, docs/mesa/STORIES.md): a tela contra o
 * contrato da função mesa-stories (falsa aqui). Abre a aba, planeja com o
 * agente, edita um cartão, mostra "Pelo app" quando há adesivo, agenda; os
 * Virais entram na sequência aberta; a Agenda mostra a situação e o Postei.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    rpc: vi.fn(async () => ({ data: null, error: null })),
    auth: { getUser: async () => ({ data: { user: { id: "u-1" } } }) },
    from: () => {
      const q: any = {};
      for (const m of ["select", "eq", "in", "order", "limit", "is", "not", "upsert", "update"]) q[m] = () => q;
      q.maybeSingle = async () => ({ data: null, error: null });
      q.then = (ok: any) => Promise.resolve({ data: [], error: null }).then(ok);
      return q;
    },
    storage: {
      from: () => ({
        createSignedUrl: async (c: string) => ({ data: { signedUrl: `https://assinada.test/${c}` }, error: null }),
        download: vi.fn(),
        upload: vi.fn(async () => ({ error: null })),
      }),
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
// A marca da arte (kit, fonte e acervo) sem o banco: duas cores e nenhuma foto.
vi.mock("@/components/mesa/stories/marcaDosStories", () => ({
  useMarcaDosStories: () => ({ paleta: ["#112233", "#ffcc00"], familia: null, nomeDaFonte: null, fotos: [], carregandoFotos: false, foto: () => null }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmDialogProvider } from "@/components/shared/confirmDialog";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import AbaStories from "@/components/mesa/AbaStories";
import { localParaIso } from "../../supabase/functions/estudio-arte/modulos/entrega-na-agenda";
import {
  caminhoDoAdesivo,
  hojeLocal,
  normalizarPainelDosStories,
  roteiroDoAdesivo,
  sequenciaQueAbre,
  somarDias,
  TIPOS_DE_ADESIVO,
  type Sequencia,
  type Story,
} from "@/components/mesa/stories/storiesApi";
import { adesivoNaZonaSegura, contraste, corDaLetra, quebrarEmLinhas, ZONA_SEGURA } from "@/components/mesa/stories/layoutDoStory";
import { segundaDaSemana, storiesDaSemana } from "@/components/mesa/stories/BlocoAgenda";
import { precisaDeArte, prontoParaAgendar } from "@/components/mesa/stories/BlocoSequencia";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");
const CLIENTE = "4dd691a7-d481-451f-800b-5e6b6fdc8721";
const TRAVESSAO = new RegExp("[" + String.fromCharCode(8212, 8211) + "]");
const AMANHA = somarDias(hojeLocal(), 1);

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE, clientName: "AcelerIQ", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50,
  catalogo: [], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
});

function story(p: Partial<Story> & { id: string; ordem: number }): Story {
  return {
    sequencia_id: "s1", client_id: CLIENTE, molde: "", titulo: `Story ${p.ordem}`, texto_na_tela: `Texto ${p.ordem}`,
    adesivo: { tipo: "nenhum" }, fundo: { tipo: "cor", cor: "#112233" }, horario: localParaIso(AMANHA, `${String(8 + p.ordem).padStart(2, "0")}:00`), caminho: "automatico",
    destaque_id: null, file_id: null, editorial_post_id: null, publicacao_id: null, situacao: "rascunho", roteiro_do_adesivo: null, motivo: null,
    criado_em: "2026-10-20T10:00:00Z", atualizado_em: "2026-10-20T10:00:00Z",
    ...p,
  };
}

const SEQUENCIA: Sequencia = { id: "s1", client_id: CLIENTE, data: AMANHA, objetivo: "vender", titulo: "Novela do combo", gancho_de_amanha: "Amanhã eu conto o segredo", criado_em: "2026-10-20T10:00:00Z" };
const MOLDE = { chave: "me_ajude", nome: "Me ajudem nessa", o_que_e: "Pede ajuda ao público numa decisão real", quando_usar: "Antes de lançar um sabor", exemplo: ["Qual capa?", "Resultado amanhã"], adesivo: "enquete" };

/** A função mesa-stories falsa, com o estado do servidor em memória. */
function servidor(inicio: { sequencias?: Sequencia[]; stories?: Story[] } = {}) {
  const banco = { sequencias: (inicio.sequencias || []).slice(), stories: (inicio.stories || []).slice() };
  let novo = 0;
  mock.invoke.mockImplementation(async (funcao: string, { body }: { body: any }) => {
    if (funcao !== "mesa-stories") return { data: {}, error: null };
    switch (body.acao) {
      case "painel":
        return { data: { sequencias: banco.sequencias, stories: banco.stories, destaques: [{ id: "d1", nome: "Cardápio", caminho: null }], moldes: [MOLDE] }, error: null };
      case "planejar_sequencia": {
        const sequencia = { ...SEQUENCIA, data: body.data, objetivo: body.objetivo };
        const stories = [
          story({ id: "a1", ordem: 1, file_id: "f1", situacao: "arte_pronta" }),
          story({ id: "a2", ordem: 2, adesivo: { tipo: "enquete", pergunta: "Qual sabor?", opcoes: ["Morango", "Chocolate"] }, caminho: "pelo_app", file_id: "f2", situacao: "arte_pronta" }),
        ];
        banco.sequencias.push(sequencia);
        banco.stories.push(...stories);
        return { data: { sequencia, stories }, error: null };
      }
      case "adaptar_molde":
        return { data: { story: { texto_na_tela: "Morango ou chocolate?", adesivo: { tipo: "enquete", pergunta: "Qual leva?", opcoes: ["Morango", "Chocolate"] } } }, error: null };
      case "salvar_story": {
        // Como a função: texto, adesivo ou fundo novo tira a arte antiga e o story volta a rascunho.
        const antes = banco.stories.find((x) => x.id === body.story.id);
        const mexeu = !!antes && ["texto_na_tela", "adesivo", "fundo"].some((k) => JSON.stringify(body.story[k]) !== JSON.stringify((antes as any)[k]));
        const s = story({ ...(antes || {}), ...body.story, id: body.story.id || `n${++novo}`, ordem: body.story.ordem, ...(mexeu || !antes ? { file_id: null, situacao: "rascunho" } : {}) });
        banco.stories = banco.stories.filter((x) => x.id !== s.id).concat([s]);
        return { data: { story: s }, error: null };
      }
      case "agendar": {
        const stories = banco.stories.filter((s) => body.ids.indexOf(s.id) >= 0).map((s) => ({ ...s, situacao: s.caminho === "pelo_app" ? "postar_pelo_app" : "agendado" }));
        return { data: { stories }, error: null };
      }
      case "marcar_postado": {
        const s = banco.stories.find((x) => x.id === body.id)!;
        return { data: { story: { ...s, situacao: "publicado" } }, error: null };
      }
      default:
        return { data: { error: "acao_desconhecida" }, error: null };
    }
  });
  return banco;
}

const chamadasDe = (acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === "mesa-stories" && c[1].body.acao === acao).map((c: any[]) => c[1].body);

function montar(endereco = `/mesa?client=${CLIENTE}&aba=stories`) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[endereco]}>
      <QueryClientProvider client={qc}>
        <TooltipProvider>
          <ConfirmDialogProvider>
            <MesaProvider valor={valorDaMesa()}>
              <AbaStories />
            </MesaProvider>
          </ConfirmDialogProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const abrirBloco = (valor: string) => {
  const nav = screen.getByRole("navigation", { name: "Blocos dos stories" });
  fireEvent.click(nav.querySelector(`[data-etapa="${valor}"]`) as HTMLElement);
};

beforeEach(() => {
  mock.invoke.mockReset();
  window.localStorage.clear();
});

describe("aba Stories: sequência", () => {
  it("abre a aba, planeja com o agente, edita um cartão, mostra Pelo app com adesivo e agenda", { timeout: 60_000 }, async () => {
    servidor();
    montar();
    expect(await screen.findByText("Nenhuma sequência ainda")).toBeTruthy();
    const nav = screen.getByRole("navigation", { name: "Blocos dos stories" });
    expect(Array.from(nav.querySelectorAll("[data-etapa]")).map((b) => b.getAttribute("data-etapa"))).toEqual(["sequencia", "virais", "destaques", "agenda"]);

    // Planejar com o agente: dia, objetivo e quantidade vão no pedido.
    fireEvent.change(screen.getByLabelText("Objetivo"), { target: { value: "vender" } });
    fireEvent.change(screen.getByLabelText("Stories"), { target: { value: "4" } });
    fireEvent.click(screen.getByRole("button", { name: "Planejar com o agente" }));
    await waitFor(() => expect(document.querySelectorAll("[data-story]").length).toBe(2));
    expect(chamadasDe("planejar_sequencia")[0]).toMatchObject({ client_id: CLIENTE, data: AMANHA, objetivo: "vender", quantidade: 4 });
    expect(screen.getByText("Novela do combo")).toBeTruthy();
    expect(screen.getByText(/Amanhã eu conto o segredo/)).toBeTruthy();

    // Selo: sem adesivo, Automático; com enquete, Pelo app (e a enquete desenhada no cartão).
    const c1 = document.querySelector('[data-story="a1"]') as HTMLElement;
    const c2 = document.querySelector('[data-story="a2"]') as HTMLElement;
    expect(within(c1).getByText("Automático")).toBeTruthy();
    expect(within(c2).getByText("Pelo app")).toBeTruthy();
    expect(c2.querySelector('[data-area-do-adesivo="enquete"]')).toBeTruthy();
    expect(within(c2).getByText("Qual sabor?")).toBeTruthy();
    expect(within(c2).getByRole("button", { name: "Baixar a arte do story 2" })).toBeTruthy();

    // Editar o cartão 1: texto novo e um adesivo de link; vira Pelo app.
    fireEvent.click(within(c1).getByRole("button", { name: "Editar o story 1" }));
    const janela = await screen.findByRole("dialog");
    fireEvent.change(within(janela).getByLabelText("Texto na tela"), { target: { value: "Combo novo hoje" } });
    fireEvent.change(within(janela).getByLabelText("Adesivo"), { target: { value: "link" } });
    fireEvent.change(within(janela).getByLabelText("Endereço do link"), { target: { value: "https://loja.test/combo" } });
    expect(within(janela).getAllByText("Pelo app").length).toBeGreaterThan(0);
    expect(within(janela).getByText(/Adesivo Link\. Endereço: https:\/\/loja\.test\/combo/)).toBeTruthy();
    fireEvent.click(within(janela).getByRole("button", { name: "Salvar" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const salvo = chamadasDe("salvar_story")[0].story;
    expect(salvo).toMatchObject({ id: "a1", sequencia_id: "s1", texto_na_tela: "Combo novo hoje", caminho: "pelo_app", adesivo: { tipo: "link", url: "https://loja.test/combo" } });
    expect(typeof salvo.horario).toBe("string");
    await waitFor(() => expect(within(document.querySelector('[data-story="a1"]') as HTMLElement).getByText("Combo novo hoje")).toBeTruthy());

    // Agendar a sequência: os prontos (arte e horário) vão juntos.
    // O texto mudou: a função tira a arte antiga e o story volta a pedir arte.
    await waitFor(() => expect(screen.getByRole("button", { name: /Gerar artes/ }).textContent).toContain("(1)"));
    // Agendar a sequência: vão os prontos (arte e horário); o editado espera a arte nova.
    fireEvent.click(screen.getByRole("button", { name: "Agendar a sequência" }));
    await waitFor(() => expect(chamadasDe("agendar").length).toBe(1));
    expect(chamadasDe("agendar")[0].ids).toEqual(["a2"]);
    await waitFor(() => expect(within(document.querySelector('[data-story="a2"]') as HTMLElement).getByText("Postar pelo app")).toBeTruthy());
  });

  it("erro da função vira o estado de erro com Tentar de novo", async () => {
    mock.invoke.mockImplementation(async () => ({ data: { error: "falhou_aqui" }, error: null }));
    montar();
    expect(await screen.findByText("Não foi possível abrir a aba Stories.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Tentar de novo" })).toBeTruthy();
  });
});

describe("aba Stories: virais e agenda", () => {
  it("Usar na sequência adapta o molde e insere no fim da sequência aberta", async () => {
    servidor({ sequencias: [SEQUENCIA], stories: [story({ id: "a1", ordem: 1 }), story({ id: "a2", ordem: 2 })] });
    montar(`/mesa?client=${CLIENTE}&aba=stories&bloco=virais`);
    const molde = await screen.findByText("Me ajudem nessa");
    const cartao = molde.closest("[data-molde]") as HTMLElement;
    expect(within(cartao).getByText("Pede ajuda ao público numa decisão real")).toBeTruthy();
    expect(within(cartao).getByText("Qual capa?")).toBeTruthy();
    fireEvent.click(within(cartao).getByRole("button", { name: "Usar na sequência" }));
    await waitFor(() => expect(document.querySelectorAll("[data-story]").length).toBe(3));
    expect(chamadasDe("adaptar_molde")[0]).toMatchObject({ client_id: CLIENTE, molde: "me_ajude" });
    expect(chamadasDe("salvar_story")[0].story).toMatchObject({ sequencia_id: "s1", ordem: 3, molde: "me_ajude", caminho: "pelo_app", texto_na_tela: "Morango ou chocolate?" });
    expect(within(document.querySelector('[data-story="n1"]') as HTMLElement).getByText("Pelo app")).toBeTruthy();
  });

  it("a Agenda mostra a semana com a situação de cada story e o Postei dos que vão pelo app", async () => {
    const hoje = hojeLocal();
    servidor({
      sequencias: [{ ...SEQUENCIA, data: hoje }],
      stories: [
        story({ id: "p1", ordem: 1, horario: localParaIso(hoje, "10:00"), adesivo: { tipo: "caixinha", pergunta: "Me pergunte" }, caminho: "pelo_app", file_id: "f1", situacao: "postar_pelo_app" }),
        story({ id: "p2", ordem: 2, horario: localParaIso(hoje, "12:00"), file_id: "f2", situacao: "agendado" }),
      ],
    });
    montar();
    await screen.findByText("Novela do combo");
    abrirBloco("agenda");
    const item = await waitFor(() => document.querySelector('[data-story-na-agenda="p1"]') as HTMLElement);
    expect(within(item).getByText("Postar pelo app")).toBeTruthy();
    expect(within(document.querySelector('[data-story-na-agenda="p2"]') as HTMLElement).getByText("Agendado")).toBeTruthy();
    expect(document.querySelector(`[data-dia="${hoje}"]`)!.querySelectorAll("[data-story-na-agenda]").length).toBe(2);
    expect(within(document.querySelector('[data-story-na-agenda="p2"]') as HTMLElement).queryByRole("button", { name: "Postei" })).toBeNull();
    fireEvent.click(within(item).getByRole("button", { name: "Postei" }));
    await waitFor(() => expect(within(document.querySelector('[data-story-na-agenda="p1"]') as HTMLElement).getByText("Publicado")).toBeTruthy());
    expect(chamadasDe("marcar_postado")[0]).toMatchObject({ client_id: CLIENTE, id: "p1" });
  });
});

describe("regras da tela dos stories", () => {
  it("com adesivo vai pelo app; o roteiro do adesivo é exato", () => {
    expect(caminhoDoAdesivo({ tipo: "nenhum" })).toBe("automatico");
    for (const t of TIPOS_DE_ADESIVO.filter((x) => x !== "nenhum")) expect(caminhoDoAdesivo({ tipo: t })).toBe("pelo_app");
    expect(roteiroDoAdesivo({ adesivo: { tipo: "enquete", pergunta: "Qual?", opcoes: ["A", "B"] }, roteiro_do_adesivo: null })).toBe("Adesivo Enquete. Pergunta: Qual? Opções: A / B.");
    expect(roteiroDoAdesivo({ adesivo: { tipo: "quiz", pergunta: "Qual o sabor", opcoes: ["Morango", "Uva"] }, roteiro_do_adesivo: null })).toBe("Adesivo Quiz. Pergunta: Qual o sabor. Opções: Morango / Uva. A certa é a primeira.");
    expect(roteiroDoAdesivo({ adesivo: { tipo: "enquete" }, roteiro_do_adesivo: "Do servidor" })).toBe("Do servidor");
  });

  it("a área do adesivo nunca entra nas zonas seguras (14% em cima, 20% embaixo)", () => {
    expect(ZONA_SEGURA).toEqual({ topo: 0.14, baixo: 0.2 });
    for (const t of TIPOS_DE_ADESIVO) expect(adesivoNaZonaSegura(t)).toBe(true);
  });

  it("a letra contrasta com o fundo e o texto quebra na largura", () => {
    expect(contraste("#000000", "#ffffff")).toBeCloseTo(21, 0);
    expect(corDaLetra("#112233", ["#112233", "#ffcc00"])).toBe("#ffcc00");
    expect(corDaLetra("#eeeeee", ["#efefef"])).toBe("#111111");
    expect(corDaLetra("#222222", ["#232323"])).toBe("#ffffff");
    expect(quebrarEmLinhas("um dois tres quatro", 9, (t) => t.length)).toEqual(["um dois", "tres", "quatro"]);
    expect(quebrarEmLinhas("linha um\nlinha dois", 100, (t) => t.length)).toEqual(["linha um", "linha dois"]);
  });

  it("a sequência que abre, a semana da agenda e o que falta para agendar", () => {
    const a = { ...SEQUENCIA, id: "a", data: "2026-10-18" };
    const b = { ...SEQUENCIA, id: "b", data: "2026-10-22" };
    const c = { ...SEQUENCIA, id: "c", data: "2026-10-25" };
    expect(sequenciaQueAbre([a, c, b], "2026-10-20")!.id).toBe("b");
    expect(sequenciaQueAbre([a], "2026-10-20")!.id).toBe("a");
    expect(sequenciaQueAbre([], "2026-10-20")).toBeNull();
    expect(segundaDaSemana("2026-10-22")).toBe("2026-10-19");
    expect(segundaDaSemana("2026-10-25")).toBe("2026-10-19");
    const semana = storiesDaSemana([story({ id: "x", ordem: 1, horario: localParaIso("2026-10-21", "09:00") }), story({ id: "y", ordem: 2, horario: localParaIso("2026-10-21", "08:00") })], "2026-10-19");
    expect(semana.map((d) => d.dia)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
    expect(semana[2].stories.map((s) => s.id)).toEqual(["y", "x"]);
    expect(prontoParaAgendar(story({ id: "z", ordem: 1, file_id: "f", situacao: "arte_pronta" }))).toBe(true);
    expect(prontoParaAgendar(story({ id: "z", ordem: 1, file_id: null }))).toBe(false);
    expect(prontoParaAgendar(story({ id: "z", ordem: 1, file_id: "f", horario: null }))).toBe(false);
    expect(precisaDeArte(story({ id: "z", ordem: 1 }))).toBe(true);
    expect(precisaDeArte(story({ id: "z", ordem: 1, file_id: "f", situacao: "agendado" }))).toBe(false);
  });

  it("o painel normaliza campo faltando sem quebrar a tela", () => {
    const p = normalizarPainelDosStories({ stories: [{ id: "s", adesivo: { tipo: "inventado" } }], moldes: [{ chave: "x", adesivo: "quiz" }], sequencias: null });
    expect(p.sequencias).toEqual([]);
    expect(p.stories[0].adesivo.tipo).toBe("nenhum");
    expect(p.stories[0].caminho).toBe("automatico");
    expect(p.stories[0].situacao).toBe("rascunho");
    expect(p.moldes[0]).toMatchObject({ chave: "x", nome: "x", adesivo: "quiz", exemplo: [] });
  });

  it("os arquivos da aba não têm travessão nem regex que o iPhone antigo não lê", () => {
    const arquivos = [
      "src/components/mesa/AbaStories.tsx",
      "src/components/mesa/stories/storiesApi.ts",
      "src/components/mesa/stories/layoutDoStory.ts",
      "src/components/mesa/stories/arteDoStory.ts",
      "src/components/mesa/stories/marcaDosStories.ts",
      "src/components/mesa/stories/PreviaDoStory.tsx",
      "src/components/mesa/stories/EditorDoStory.tsx",
      "src/components/mesa/stories/BlocoSequencia.tsx",
      "src/components/mesa/stories/BlocoVirais.tsx",
      "src/components/mesa/stories/BlocoDestaques.tsx",
      "src/components/mesa/stories/BlocoAgenda.tsx",
      "src/components/mesa/stories/AgenteDosStories.tsx",
    ];
    for (const arq of arquivos) {
      const fonte = ler(arq);
      expect(TRAVESSAO.test(fonte), arq).toBe(false);
      expect(fonte.indexOf("(?<"), arq).toBe(-1);
      expect(/\\p\{/.test(fonte), arq).toBe(false);
    }
    // A função nova fala pelo mesmo caminho das outras (nome amigável no erro).
    expect(ler("src/lib/mesa/api.ts")).toContain('"mesa-stories": "agente dos stories"');
    expect(ler("src/lib/navegacao/lugares.ts")).toContain('stories: "Stories"');
  });
});
