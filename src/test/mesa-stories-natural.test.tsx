import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Stories naturais (22/10/2026). O dono viu a tela da Thainá com "Quem mora
 * com você conta?" em título de cartaz (serifa grande vermelha sobre uma foto
 * de mesa de jantar) e pediu: "mais realista, mais natural de story ...
 * momento cotidiano, humanizado; e também opção de baixar ali mesmo pra
 * postar; mas também com opção de escolher para destaque". Este arquivo é o
 * caso de teste desse print: a foto vem do gerador sem texto nenhum e o texto
 * é a camada nativa do Instagram (Clássico, Moderno, Máquina, Forte), nunca
 * um título de cartaz desenhado na imagem.
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  tabelas: {} as Record<string, unknown[]>,
  salvos: [] as string[],
  zip: [] as string[],
  finais: [] as Array<{ texto: unknown; adesivo: unknown }>,
  uploads: [] as string[],
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    rpc: vi.fn(async () => ({ data: null, error: null })),
    auth: { getUser: async () => ({ data: { user: { id: "u-1" } } }) },
    from: (tabela: string) => {
      const q: any = {};
      for (const m of ["select", "eq", "in", "order", "limit", "is", "not", "upsert", "update"]) q[m] = () => q;
      q.maybeSingle = async () => ({ data: null, error: null });
      q.then = (ok: any) => Promise.resolve({ data: mock.tabelas[tabela] || [], error: null }).then(ok);
      return q;
    },
    storage: {
      from: () => ({
        createSignedUrl: async (c: string) => ({ data: { signedUrl: `https://assinada.test/${c}` }, error: null }),
        download: vi.fn(async () => ({ data: new Blob(["x"]), error: null })),
        upload: vi.fn(async (c: string) => {
          mock.uploads.push(c);
          return { error: null };
        }),
      }),
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
vi.mock("@/components/mesa/stories/marcaDosStories", () => ({
  useMarcaDosStories: () => ({ paleta: ["#7a1f2b", "#f4efe8"], familia: null, nomeDaFonte: null, fotos: [], carregandoFotos: false, foto: () => null }),
}));
// O canvas não existe no jsdom: o PNG final é trocado por um registro do que iria nele.
vi.mock("@/components/mesa/stories/textoNativo", async (original) => {
  const real: any = await original();
  return {
    ...real,
    montarStoryFinal: vi.fn(async (o: { texto: unknown; adesivo: unknown }) => {
      mock.finais.push({ texto: o.texto, adesivo: o.adesivo });
      return new Blob(["png"], { type: "image/png" });
    }),
  };
});
vi.mock("@/components/mesa/instagram/capaDoDestaque", async (original) => {
  const real: any = await original();
  return { ...real, salvarBlob: (_b: Blob, nome: string) => mock.salvos.push(nome), baixarDoStorage: async () => new Blob(["foto"]) };
});
vi.mock("jszip", () => ({
  default: class {
    file(nome: string) {
      mock.zip.push(nome);
    }
    generateAsync() {
      return Promise.resolve(new Blob(["zip"]));
    }
  },
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmDialogProvider } from "@/components/shared/confirmDialog";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import AbaStories from "@/components/mesa/AbaStories";
import PreviaDoStory from "@/components/mesa/stories/PreviaDoStory";
import { localParaIso } from "../../supabase/functions/estudio-arte/modulos/entrega-na-agenda";
import { promptDaCapaDoStory, promptDaFotoNatural, REGRA_DA_FOTO_NATURAL, textoNativoPadrao } from "../../supabase/functions/mesa-stories/modulos/foto-natural-do-story";
import { MODELOS_DE_SEQUENCIA, pedidoDaSequenciaQueConverte, planoQueConverteLimpo, telasDaEstrutura } from "../../supabase/functions/mesa-stories/modulos/sequencia-que-converte";
import { fundoLimpo } from "../../supabase/functions/mesa-stories/modulos/regras-dos-stories";
import { baixarStory, baixarTodosOsStories, registrarStoryNatural } from "@/components/mesa/stories/baixarStories";
import { ESTILOS_DO_TEXTO, nomeDoPngDoStory, textoNativoDoStory } from "@/components/mesa/stories/textoNativo";
import { capaDeDestaqueDoStory, corpoDasImagens, hojeLocal, precisaDeImagem, somarDias, type Story } from "@/components/mesa/stories/storiesApi";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");
const CLIENTE = "4dd691a7-d481-451f-800b-5e6b6fdc8721";
const AMANHA = somarDias(hojeLocal(), 1);
const FOTO = `${CLIENTE}/stories/bbbbbbbb-0000-4000-8000-000000000001/natural-1.png`;
const MARCA = { paleta: ["#7a1f2b", "#f4efe8"], familia: null };

function story(p: Partial<Story> & { id: string; ordem: number }): Story {
  return {
    sequencia_id: "s1", client_id: CLIENTE, molde: "livre", titulo: "", texto_na_tela: "Quem mora com você conta?",
    adesivo: { tipo: "nenhum" }, fundo: { tipo: "natural", papel: "gancho", caminho: FOTO, versao: 1, estilo_texto: "classico", caixa: false, posicao: "topo" },
    horario: localParaIso(AMANHA, "14:30"), caminho: "automatico", destaque_id: null, file_id: null, editorial_post_id: null, publicacao_id: null,
    situacao: "rascunho", roteiro_do_adesivo: null, motivo: null, criado_em: "2026-10-22T10:00:00Z", atualizado_em: "2026-10-22T10:00:00Z",
    ...p,
  };
}

const chamadas = (funcao: string, acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === funcao && c[1].body.acao === acao).map((c: any[]) => c[1].body);

beforeEach(() => {
  mock.invoke.mockReset();
  mock.tabelas = {};
  mock.salvos = [];
  mock.zip = [];
  mock.finais = [];
  mock.uploads = [];
  window.localStorage.clear();
});

describe("o print do dono: story natural com texto nativo, nunca título de cartaz", () => {
  it("a prévia mostra a foto inteira e o texto nativo do Instagram por cima (sans do app, sem serifa de cartaz)", () => {
    const s = story({ id: "t1", ordem: 1 });
    const { container } = render(
      <MemoryRouter>
        <QueryClientProvider client={new QueryClient()}>
          <PreviaDoStory story={s} largura={270} paleta={MARCA.paleta} familia={null} foto={null} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    const quadro = container.querySelector("[data-estilo-da-imagem]") as HTMLElement;
    expect(quadro.getAttribute("data-estilo-da-imagem")).toBe("natural");
    expect(quadro.getAttribute("data-imagem-gerada")).toBe("natural");
    const texto = container.querySelector("[data-texto-nativo]") as HTMLElement;
    expect(texto.getAttribute("data-texto-nativo")).toBe("classico");
    expect(texto.textContent).toBe("Quem mora com você conta?");
    expect(texto.style.fontFamily).toContain("Helvetica");
    expect(texto.style.fontFamily.toLowerCase()).not.toContain("serif\"");
    expect(texto.style.fontFamily.toLowerCase()).not.toMatch(/georgia|times|playfair/);
    // Um texto só na tela: nada desenhado pela arte antiga por cima da foto.
    expect(container.querySelectorAll("[data-texto-do-story]").length).toBe(0);
  });

  it("os estilos do app: Clássico, Moderno, Máquina de escrever e Forte; com adesivo o texto sobe", () => {
    expect(Object.keys(ESTILOS_DO_TEXTO)).toEqual(["classico", "moderno", "maquina", "forte"]);
    expect(ESTILOS_DO_TEXTO.maquina.familia).toContain("Courier");
    expect(ESTILOS_DO_TEXTO.forte.maiusculas && ESTILOS_DO_TEXTO.forte.italico).toBe(true);
    const comEnquete = textoNativoDoStory(story({ id: "x", ordem: 1, adesivo: { tipo: "enquete", pergunta: "Sim?" }, fundo: { tipo: "natural", posicao: "meio" } }));
    expect(comEnquete.posicao).toBe("topo");
    expect(textoNativoPadrao("gancho", false)).toEqual({ estilo_texto: "forte", caixa: false, posicao: "topo" });
    expect(fundoLimpo({ tipo: "natural", estilo_texto: "cartaz", posicao: "lado", caminho: FOTO, versao: 2 })).toMatchObject({ tipo: "natural", estilo_texto: "classico", posicao: "topo", caminho: FOTO, versao: 2 });
    expect(fundoLimpo({ tipo: "natural", caminho: `${CLIENTE}/estudio/x/card.png` }).caminho).toBeUndefined();
  });
});

describe("estilo Natural no pedido ao gerador", () => {
  it("o prompt é de foto cotidiana de celular, humanizada, sem texto dentro, com as fotos reais do cliente como referência", () => {
    const p = promptDaFotoNatural({ cena: "mesa da advogada com processos e café", papel: "gancho", texto: "Quem mora com você conta?", negocio: "advocacia de família", comReferencia: true });
    expect(p).toContain("tirada com o celular na mão");
    expect(p).toContain("momento real do dia");
    expect(p).toContain("Cena: mesa da advogada com processos e café.");
    expect(p).toContain("advocacia de família");
    expect(p).toContain("leve granulado");
    expect(p).toContain("Nada de cara de anúncio");
    expect(p).toContain("referência da pessoa e do ambiente");
    expect(p).toContain("não copie a foto e não cole nada");
    expect(p.endsWith(REGRA_DA_FOTO_NATURAL)).toBe(true);
    expect(REGRA_DA_FOTO_NATURAL).toContain("SEM NENHUM TEXTO");
    // Sem cena: o momento vem do papel na estrutura.
    expect(promptDaFotoNatural({ papel: "prova", comReferencia: false })).toContain("bastidor real");
  });

  it("o roteirista recebe o estilo natural e cada tela nasce com a foto a gerar e o texto nativo", () => {
    const telas = telasDaEstrutura(MODELOS_DE_SEQUENCIA[0], 3);
    const pedido = pedidoDaSequenciaQueConverte({ modelo: MODELOS_DE_SEQUENCIA[0], telas, data: AMANHA, estilo: "natural" });
    expect(pedido).toContain("ESTILO DAS IMAGENS: Natural, padrão de story");
    expect(pedido).toContain("mão segurando um documento");
    const plano = planoQueConverteLimpo({ titulo: "x", gancho_de_amanha: "", stories: ["Oi", "Consulta hoje", "Me chama"].map((t) => ({ texto_na_tela: t, cena: "escritório", adesivo: { tipo: "nenhum" } })) }, telas, null, "natural");
    expect(plano.stories.map((s) => s.fundo.tipo)).toEqual(["natural", "natural", "natural"]);
    expect(plano.stories[0].fundo).toMatchObject({ estilo_texto: "forte", posicao: "topo" });
    expect(precisaDeImagem(story({ id: "a", ordem: 1, fundo: { tipo: "natural" } }))).toBe(true);
    expect(precisaDeImagem(story({ id: "a", ordem: 1 }))).toBe(false);
  });

  it("a função gera só a foto (1088 x 1920, custo antes) e usa da campanha só o tom e a paleta", () => {
    const f = ler("supabase/functions/mesa-stories/index.ts");
    const corpo = f.slice(f.indexOf("async function fotoNatural"), f.indexOf("async function caminhoDaImagemDaTela"));
    expect(corpo.indexOf('"confirmar_custo"')).toBeGreaterThan(0);
    expect(corpo.indexOf("chamarImagem(")).toBeGreaterThan(corpo.indexOf('"confirmar_custo"'));
    expect(corpo).toContain('tamanho: "1088x1920"');
    expect(corpo).toContain("promptDaFotoNatural(");
    expect(corpo).toContain("climaDaCampanhaDoStory(");
    // No Natural o padrão da campanha não vira imagem de referência (sem forçar arte).
    expect(corpo).not.toContain("caminhos");
    const p = promptDaFotoNatural({ comReferencia: false, campanha: { tom: "acolhedor", paleta: ["#7a1f2b"], tratamento: "luz quente" } });
    expect(p).toContain("só no tom da foto");
    expect(p).toContain("#7a1f2b");
    expect(p).not.toContain("anexad");
  });
});

describe("estilo Destaque com referência", () => {
  it("o padrão visual da campanha vai ao gerador como referência de estilo (só da pasta do cliente), nunca colagem", () => {
    const c = corpoDasImagens({
      clientId: CLIENTE,
      titulo: "Oferta",
      stories: [story({ id: "d1", ordem: 1, fundo: { tipo: "gerada", papel: "oferta", cena: "mesa", referencia_id: "11111111-1111-4111-8111-111111111111" } })],
      campanha: { id: "camp", nome: "Guarda", fase: "lancamento", padrao: { caminhos: [`${CLIENTE}/referencias/a.png`, "outro-cliente/b.png"], resumo: "editorial sóbrio, vinho e creme" } },
    });
    const arquivos = c.arquivos as Array<Record<string, unknown>>;
    expect(arquivos[0]).toEqual({ caminho: `${CLIENTE}/referencias/a.png`, nome: "Padrão da campanha 1", papel: "referencia" });
    expect(arquivos.some((a) => a.caminho === "outro-cliente/b.png")).toBe(false);
    expect(arquivos.every((a) => a.papel === "referencia")).toBe(true);
    expect(c).toMatchObject({ formato: "stories_9x16", campanha_id: "camp", fidelidade: "criativo" });
    expect(String(c.pedido)).toContain("Padrão visual da campanha: editorial sóbrio, vinho e creme");
    expect(String(c.pedido)).toContain("referência de estilo");
    expect(String(c.pedido)).toContain("nunca cole");
  });
});

describe("baixar ali mesmo", () => {
  it("cada tela baixa o PNG final com o texto nativo e o adesivo; o nome traz a ordem e o horário", async () => {
    const s = story({ id: "b1", ordem: 2, fundo: { tipo: "natural", papel: "problema_ou_desejo", caminho: FOTO, estilo_texto: "maquina", caixa: true, posicao: "topo" }, adesivo: { tipo: "enquete", pergunta: "Mora sozinho?", opcoes: ["Sim", "Não"] } });
    await baixarStory(s, MARCA);
    expect(mock.salvos).toEqual(["story-02-14h30-problema-ou-desejo.png"]);
    expect(mock.finais[0].texto).toMatchObject({ texto: "Quem mora com você conta?", estilo: "maquina", caixa: true });
    expect(mock.finais[0].adesivo).toMatchObject({ tipo: "enquete" });
    expect(nomeDoPngDoStory({ ordem: 11, horario: null, titulo: "", texto_na_tela: "Oi", fundo: { tipo: "natural" } }, null)).toBe("story-11-sem-hora-oi.png");
  });

  it("Baixar todas faz um ZIP na ordem e conta as telas sem imagem", async () => {
    const r = await baixarTodosOsStories(
      [story({ id: "z2", ordem: 2, horario: localParaIso(AMANHA, "11:00") }), story({ id: "z1", ordem: 1, horario: localParaIso(AMANHA, "09:00") }), story({ id: "z3", ordem: 3, fundo: { tipo: "natural" } })],
      MARCA,
      { nome: "Família em pauta" },
    );
    expect(r).toEqual({ baixadas: 2, deFora: [3] });
    expect(mock.zip).toEqual(["story-01-09h00-gancho.png", "story-02-11h00-gancho.png"]);
    expect(mock.salvos).toEqual(["stories-familia-em-pauta.zip"]);
  });

  it("a arte da Agenda no Natural leva o texto e não o adesivo (o adesivo entra pelo app)", async () => {
    mock.invoke.mockImplementation(async (_f: string, { body }: { body: any }) => ({ data: { story: { ...story({ id: body.id, ordem: 1 }), file_id: "f1", situacao: "arte_pronta" } }, error: null }));
    const s = story({ id: "r1", ordem: 1, adesivo: { tipo: "link", texto_do_link: "Agendar" }, caminho: "pelo_app" });
    const novo = await registrarStoryNatural(CLIENTE, s, MARCA);
    expect(mock.finais[0].adesivo).toBeNull();
    expect(mock.finais[0].texto).toMatchObject({ texto: "Quem mora com você conta?" });
    expect(mock.uploads[0].indexOf(`${CLIENTE}/stories/r1/`)).toBe(0);
    expect(chamadas("mesa-stories", "registrar_arte")[0]).toMatchObject({ id: "r1", caminho: mock.uploads[0] });
    expect(novo.file_id).toBe("f1");
  });
});

describe("capa de destaque a partir de uma tela", () => {
  it("pede a capa no estilo Destaque com a tela como referência e o custo já confirmado", async () => {
    mock.invoke.mockImplementation(async () => ({ data: { story: { ...story({ id: "c1", ordem: 1 }), destaque_id: "d-novo" }, destaque: { id: "d-novo", nome: "Família", caminho: `${CLIENTE}/instagram/destaques/d-novo.png` }, custo_usd: 0.04 }, error: null }));
    const r = await capaDeDestaqueDoStory(CLIENTE, { id: "c1" }, { nome: "Família", paleta: MARCA.paleta });
    expect(chamadas("mesa-stories", "capa_do_story")[0]).toMatchObject({ id: "c1", nome: "Família", paleta: MARCA.paleta, confirmado: true });
    expect(r.story.destaque_id).toBe("d-novo");
    expect(r.destaque.nome).toBe("Família");
    const p = promptDaCapaDoStory({ nome: "Família", cena: "sala", paleta: ["#7a1f2b"], comSelo: false });
    expect(p).toContain("Estilo Destaque (designer)");
    expect(p).toContain("A imagem anexada é a tela do story");
    expect(p).toContain("Sem texto");
    const f = ler("supabase/functions/mesa-stories/index.ts");
    const corpo = f.slice(f.indexOf("async function capaDoStory"), f.indexOf("// ------------------------------------------------------------------ adaptar molde"));
    expect(corpo.indexOf('"confirmar_custo"')).toBeLessThan(corpo.indexOf("chamarImagem("));
    expect(corpo).toContain('imagemDeReferencia("mesa", caminhoDaTela, "tela-do-story")');
    expect(corpo).toContain('from("cliente_instagram_destaques").insert(');
    expect(corpo).toContain("gravarMudanca(c.clientId, s.id, { destaque_id: id })");
  });
});

describe("o painel da tela, organizado", () => {
  const valorDaMesa = (): MesaValor => ({
    clientId: CLIENTE, clientName: "Thainá Lima Rosa", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50,
    catalogo: [], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
  });

  it("seções Texto, Imagem, Adesivo, Horário e Destaque; o estilo do texto grava no story; baixar em cada tela e Baixar todas", async () => {
    const s = story({ id: "aaaaaaaa-0000-4000-8000-000000000001", ordem: 1, file_id: "f1", situacao: "arte_pronta" });
    mock.invoke.mockImplementation(async (funcao: string, { body }: { body: any }) => {
      if (funcao !== "mesa-stories") return { data: {}, error: null };
      if (body.acao === "painel")
        return { data: { sequencias: [{ id: "s1", client_id: CLIENTE, data: AMANHA, objetivo: "vender", titulo: "Família em pauta", gancho_de_amanha: null, criado_em: "x", escolha: { modelo: "conversao", estilo: "natural" } }], stories: [s], destaques: [], moldes: [] }, error: null };
      if (body.acao === "salvar_story") return { data: { story: { ...s, ...body.story, fundo: body.story.fundo || s.fundo } }, error: null };
      return { data: {}, error: null };
    });
    render(
      <MemoryRouter initialEntries={[`/mesa?client=${CLIENTE}&aba=stories`]}>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
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
    const painel = await waitFor(() => {
      const el = document.querySelector("[data-painel-da-tela]") as HTMLElement;
      expect(el).toBeTruthy();
      return el;
    });
    expect(Array.from(painel.querySelectorAll("[data-secao-da-tela]")).map((x) => x.getAttribute("data-secao-da-tela"))).toEqual(["Texto", "Imagem", "Adesivo", "Horário", "Destaque"]);
    fireEvent.click(within(painel).getByRole("radio", { name: "Forte" }));
    await waitFor(() => expect(chamadas("mesa-stories", "salvar_story").length).toBe(1));
    expect(chamadas("mesa-stories", "salvar_story")[0].story).toMatchObject({ id: s.id, fundo: { tipo: "natural", estilo_texto: "forte", caminho: FOTO } });
    expect(within(painel).getByRole("tab", { name: "Natural" }).getAttribute("aria-selected")).toBe("true");
    expect(within(painel).getByRole("button", { name: /Usar como capa/ })).toBeTruthy();
    expect(within(document.querySelector(`[data-story="${s.id}"]`) as HTMLElement).getByRole("button", { name: "Baixar o story 1" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Baixar todas/ }));
    await waitFor(() => expect(mock.salvos).toEqual(["stories-familia-em-pauta.zip"]));
  });
});
