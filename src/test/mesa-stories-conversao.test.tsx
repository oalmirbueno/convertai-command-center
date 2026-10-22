import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Stories que convertem (21/10/2026, dono: "melhore a área dos stories ... gera
 * conteúdo com imagens ... algo que converte ... e que também combine com as
 * campanhas"): a estrutura gancho, problema ou desejo, prova, oferta e CTA com
 * adesivo; os modelos prontos; cada tela com imagem do gerador da casa (Arte
 * rápida 9:16, sem colagem); as telas em cartões na lateral (duplicar,
 * remover, arrastar); gerarStoriesDaCampanha com o vínculo e o custo antes.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), tabelas: {} as Record<string, unknown[]> }));

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
        download: vi.fn(),
        upload: vi.fn(async () => ({ error: null })),
      }),
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn(), message: vi.fn() } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ profile: { role: "admin" }, user: { id: "u-1" } }) }));
vi.mock("@/components/mesa/stories/marcaDosStories", () => ({
  useMarcaDosStories: () => ({ paleta: ["#112233", "#ffcc00"], familia: null, nomeDaFonte: null, fotos: [], carregandoFotos: false, foto: () => null }),
}));

import { TooltipProvider } from "@/components/ui/tooltip";
import { ConfirmDialogProvider } from "@/components/shared/confirmDialog";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import AbaStories from "@/components/mesa/AbaStories";
import { localParaIso } from "../../supabase/functions/estudio-arte/modulos/entrega-na-agenda";
import {
  ADESIVOS_DO_CTA,
  estruturaDaSequencia,
  MODELOS_DE_SEQUENCIA,
  partesDoCustoDosStories,
  pedidoDasImagens,
  planoQueConverteLimpo,
  REGRA_SEM_COLAGEM_DOS_STORIES,
  telasDaEstrutura,
} from "../../supabase/functions/mesa-stories/modulos/sequencia-que-converte";
import { fundoLimpo } from "../../supabase/functions/mesa-stories/modulos/regras-dos-stories";
import {
  gerarStoriesDaCampanha,
  hojeLocal,
  imagemDesatualizada,
  montarLaminas,
  moverNaLista,
  precisaRegistrar,
  somarDias,
  type Sequencia,
  type Story,
} from "@/components/mesa/stories/storiesApi";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");
const CLIENTE = "4dd691a7-d481-451f-800b-5e6b6fdc8721";
const CAMPANHA = "9b1c2d3e-0000-4000-8000-00000000c0a1";
const TRABALHO = "7e7e7e7e-1111-4111-8111-111111111111";
const AMANHA = somarDias(hojeLocal(), 1);

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE, clientName: "AcelerIQ", userId: "u-1", isAdmin: true, podeRecarregar: true, saldoUsd: 50,
  catalogo: [], catalogoCarregando: false, atualizarCusto: vi.fn(), abrirRecarga: vi.fn(), abrirChaves: vi.fn(), abrirModelos: vi.fn(),
});

function story(p: Partial<Story> & { id: string; ordem: number }): Story {
  return {
    sequencia_id: "s1", client_id: CLIENTE, molde: "livre", titulo: `Story ${p.ordem}`, texto_na_tela: `Texto ${p.ordem}`,
    adesivo: { tipo: "nenhum" }, fundo: { tipo: "gerada" }, horario: localParaIso(AMANHA, `${String(8 + p.ordem).padStart(2, "0")}:00`), caminho: "automatico",
    destaque_id: null, file_id: null, editorial_post_id: null, publicacao_id: null, situacao: "rascunho", roteiro_do_adesivo: null, motivo: null,
    criado_em: "2026-10-21T10:00:00Z", atualizado_em: "2026-10-21T10:00:00Z",
    ...p,
  };
}

const PAPEIS = ["gancho", "oferta", "cta"];
const caminhoDaLamina = (o: number, v = 1) => `${CLIENTE}/estudio/${TRABALHO}/card-${o}-v${v}.png`;

/** As funções falsas (mesa-stories e estudio-arte), com o estado do servidor em memória. */
function servidor(inicio: { sequencias?: Array<Sequencia & { escolha?: unknown }>; stories?: Story[] } = {}) {
  const banco = { sequencias: (inicio.sequencias || []).slice() as any[], stories: (inicio.stories || []).slice() };
  let novo = 0;
  mock.invoke.mockImplementation(async (funcao: string, { body }: { body: any }) => {
    if (funcao === "estudio-arte") {
      if (body.acao === "rapida_preparar") {
        const n = body.peca === "carrossel" ? body.laminas : 1;
        return { data: { trabalho: { id: TRABALHO, direcao: { cards: Array.from({ length: n }).map((_, i) => ({ ordem: i + 1 })) } }, custo_usd: 0.1 }, error: null };
      }
      return { data: { ok: true }, error: null };
    }
    switch (body.acao) {
      case "painel":
        return { data: { sequencias: banco.sequencias, stories: banco.stories, destaques: [], moldes: [] }, error: null };
      case "planejar_sequencia": {
        const sequencia = { id: "s1", client_id: CLIENTE, data: body.data, objetivo: "vender", titulo: "Combo que converte", gancho_de_amanha: null, criado_em: "2026-10-21T10:00:00Z", escolha: { modelo: body.modelo_da_sequencia, estrutura: "conversao" } };
        const stories = PAPEIS.map((p, i) =>
          story({ id: `c${i + 1}`, ordem: i + 1, texto_na_tela: `Tela ${p}`, fundo: { tipo: "gerada", papel: p, cena: `Cena ${p}` }, ...(p === "cta" ? { adesivo: { tipo: "link", texto_do_link: "Pedir" }, caminho: "pelo_app" as const } : {}) }),
        );
        banco.sequencias.push(sequencia);
        banco.stories.push(...stories);
        return { data: { sequencia, stories, custo_usd: 0.02 }, error: null };
      }
      case "ligar_imagens": {
        const stories = body.telas.map((t: any) => {
          const s = banco.stories.find((x) => x.id === t.id)!;
          const n = { ...s, fundo: { ...s.fundo, tipo: "gerada" as const, trabalho_id: body.trabalho_id, lamina: t.lamina, texto: s.texto_na_tela } };
          banco.stories = banco.stories.map((x) => (x.id === n.id ? n : x));
          return n;
        });
        return { data: { stories }, error: null };
      }
      case "registrar_arte": {
        const s = banco.stories.find((x) => x.id === body.id)!;
        const n = { ...s, file_id: `f-${s.id}`, situacao: "arte_pronta" as const, fundo: { ...s.fundo, caminho: caminhoDaLamina(s.fundo.lamina || 1), versao: 1 } };
        banco.stories = banco.stories.map((x) => (x.id === n.id ? n : x));
        return { data: { story: n }, error: null };
      }
      case "salvar_story": {
        const s = story({ ...body.story, id: `n${++novo}`, ordem: banco.stories.length + 1 });
        banco.stories.push(s);
        return { data: { story: s }, error: null };
      }
      case "reordenar": {
        const stories = body.ids.map((id: string, i: number) => ({ ...banco.stories.find((x) => x.id === id)!, ordem: i + 1 }));
        banco.stories = stories;
        return { data: { stories }, error: null };
      }
      case "apagar_story":
        banco.stories = banco.stories.filter((x) => x.id !== body.id);
        return { data: { ok: true }, error: null };
      default:
        return { data: { error: "acao_desconhecida" }, error: null };
    }
  });
  return banco;
}

const chamadas = (funcao: string, acao: string) => mock.invoke.mock.calls.filter((c: any[]) => c[0] === funcao && c[1].body.acao === acao).map((c: any[]) => c[1].body);

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={[`/mesa?client=${CLIENTE}&aba=stories`]}>
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

beforeEach(() => {
  mock.invoke.mockReset();
  mock.tabelas = {};
  window.localStorage.clear();
});

describe("estrutura de conversão e modelos", () => {
  it("toda sequência começa no gancho e fecha no CTA com adesivo, de 3 a 8 telas, em todos os modelos", () => {
    expect(MODELOS_DE_SEQUENCIA.map((m) => m.chave)).toEqual(["conversao", "lancamento", "bastidores", "prova_social", "oferta_relampago", "enquete_engajamento", "tutorial"]);
    for (const m of MODELOS_DE_SEQUENCIA) {
      expect(m.telas.map((t) => t.papel), m.chave).toEqual(["gancho", "problema_ou_desejo", "prova", "oferta", "cta"]);
      expect(ADESIVOS_DO_CTA.indexOf(m.telas[4].adesivo), m.chave).toBeGreaterThanOrEqual(0);
      for (const n of [3, 4, 5, 6, 8]) {
        const t = telasDaEstrutura(m, n);
        expect(t.length, `${m.chave} ${n}`).toBe(n);
        expect(t[0].papel).toBe("gancho");
        expect(t[n - 1].papel).toBe("cta");
      }
    }
    expect(telasDaEstrutura(MODELOS_DE_SEQUENCIA[0], 7).map((t) => t.papel)).toEqual(["gancho", "problema_ou_desejo", "prova", "prova", "prova", "oferta", "cta"]);
    expect(telasDaEstrutura(MODELOS_DE_SEQUENCIA[0], 3).map((t) => t.papel)).toEqual(["gancho", "oferta", "cta"]);
  });

  it("o plano do roteirista entra na estrutura: papel pela posição, cena para o gerador e CTA sem adesivo ganha um", () => {
    const telas = telasDaEstrutura(MODELOS_DE_SEQUENCIA[0], 5);
    const bruto = {
      titulo: "Combo",
      gancho_de_amanha: "",
      stories: ["Para tudo", "Cansou de fila?", "300 pedidos no mês", "Combo por 29", "Peça agora"].map((t, i) => ({ papel: "prova", texto_na_tela: t, cena: `Cena ${i}`, adesivo: { tipo: "nenhum" }, titulo: "", roteiro_do_adesivo: "" })),
    };
    const plano = planoQueConverteLimpo(bruto, telas, { cta: "Pedir o combo" });
    expect(plano.stories.map((s) => s.papel)).toEqual(["gancho", "problema_ou_desejo", "prova", "oferta", "cta"]);
    expect(plano.stories.every((s) => s.fundo.tipo === "gerada" && !!s.fundo.cena)).toBe(true);
    const cta = plano.stories[4];
    expect(cta.adesivo).toMatchObject({ tipo: "link", texto_do_link: "Pedir o combo" });
    expect(cta.caminho).toBe("pelo_app");
    expect(estruturaDaSequencia(plano.stories).completa).toBe(true);
    expect(estruturaDaSequencia(plano.stories.slice(0, 4)).ctaComAdesivo).toBe(false);
  });

  it("o fundo gerado aceita só lâmina do Estúdio do cliente (sem caminho de fora)", () => {
    const f = fundoLimpo({ tipo: "gerada", papel: "oferta", cena: "x", trabalho_id: TRABALHO, lamina: 2, caminho: caminhoDaLamina(2), versao: 3, texto: "Oi" });
    expect(f).toMatchObject({ tipo: "gerada", papel: "oferta", trabalho_id: TRABALHO, lamina: 2, caminho: caminhoDaLamina(2), versao: 3, texto: "Oi" });
    expect(fundoLimpo({ tipo: "gerada", trabalho_id: TRABALHO, lamina: 1, caminho: "outro/../segredo.png" }).caminho).toBeUndefined();
    expect(fundoLimpo({ tipo: "gerada", trabalho_id: TRABALHO, lamina: 1, caminho: `${CLIENTE}/stories/x.png` }).caminho).toBeUndefined();
  });
});

describe("imagem pelo gerador da casa (sem colagem)", () => {
  it("o pedido leva o texto exato, a cena, a área do adesivo e a regra sem colagem, dentro de 3.000 caracteres", () => {
    const telas = Array.from({ length: 8 }).map((_, i) => ({ ordem: i + 1, texto_na_tela: `Texto da tela ${i + 1}`, papel: i === 7 ? "cta" : "prova", cena: "x".repeat(400), adesivo: { tipo: i === 7 ? "enquete" : "nenhum" } }));
    const p = pedidoDasImagens({ titulo: "Combo", telas, campanha: { nome: "Verão", fase: "urgencia", identidade: { paleta_apoio: [{ hex: "#ff6600" }], selo: { texto: "Verão 26" } } } });
    expect(p.length).toBeLessThanOrEqual(3000);
    expect(p).toContain('Texto: "Texto da tela 1"');
    expect(p).toContain("9:16");
    expect(p).toContain("Deixe livre o meio de baixo para a enquete");
    expect(p).toContain('Campanha "Verão", fase de urgência');
    expect(p).toContain('selo "Verão 26"');
    expect(p.endsWith(REGRA_SEM_COLAGEM_DOS_STORIES)).toBe(true);
  });

  it("cria a sequência que converte e pede as imagens à Arte rápida 9:16; a imagem pronta vira a arte do story", { timeout: 60_000 }, async () => {
    servidor();
    mock.tabelas.estudio_trabalhos = [{ id: TRABALHO, cards: [1, 2, 3].map((o) => ({ ordem: o, versao: 1, storage_path: caminhoDaLamina(o) })) }];
    montar();
    expect(await screen.findByText("Nenhuma sequência ainda")).toBeTruthy();
    const modelos = document.querySelector("[data-modelos-de-sequencia]") as HTMLElement;
    expect(Array.from(modelos.querySelectorAll("[data-modelo]")).map((b) => b.getAttribute("data-modelo"))).toEqual([
      "conversao", "lancamento", "bastidores", "prova_social", "oferta_relampago", "enquete_engajamento", "tutorial", "novela",
    ]);
    expect(within(modelos).getByRole("radio", { name: /Sequência que converte/ }).getAttribute("aria-checked")).toBe("true");
    fireEvent.change(screen.getByLabelText("Telas"), { target: { value: "3" } });
    // 22/10: o padrão é Natural; este caso é o estilo Destaque (designer, Arte rápida 9:16).
    expect(screen.getByRole("tab", { name: "Natural (padrão de story)" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Destaque (designer)" }));
    expect(Array.from(document.querySelectorAll("[data-estrutura] [data-papel]")).map((x) => x.getAttribute("data-papel"))).toEqual(["gancho", "oferta", "cta"]);

    fireEvent.click(screen.getByRole("button", { name: /Criar a sequência/ }));
    fireEvent.click(screen.getByRole("button", { name: /clique de novo/ }));
    await waitFor(() => expect(chamadas("estudio-arte", "enfileirar").length).toBe(1));
    expect(chamadas("mesa-stories", "planejar_sequencia")[0]).toMatchObject({ modelo_da_sequencia: "conversao", quantidade: 3, data: AMANHA, estilo: "destaque" });

    // A imagem sai do gerador: Arte rápida 9:16, uma lâmina por tela, criativo, foto só como referência.
    const preparo = chamadas("estudio-arte", "rapida_preparar")[0];
    expect(preparo).toMatchObject({ client_id: CLIENTE, formato: "stories_9x16", peca: "carrossel", laminas: 3, fidelidade: "criativo" });
    expect(preparo.pedido).toContain('Texto: "Tela gancho"');
    expect(preparo.pedido).toContain("Cena: Cena oferta");
    expect(preparo.pedido).toContain(REGRA_SEM_COLAGEM_DOS_STORIES);
    expect((preparo.arquivos as Array<{ papel: string }>).every((a) => a.papel === "referencia")).toBe(true);
    expect(chamadas("mesa-stories", "ligar_imagens")[0]).toMatchObject({ trabalho_id: TRABALHO, telas: [{ id: "c1", lamina: 1 }, { id: "c2", lamina: 2 }, { id: "c3", lamina: 3 }] });
    expect(chamadas("estudio-arte", "enfileirar")[0]).toMatchObject({ trabalho_id: TRABALHO, ordens: [1, 2, 3] });

    // As lâminas prontas viram a arte de cada story (registrar_arte da_lamina) e aparecem no celular.
    await waitFor(() => expect(chamadas("mesa-stories", "registrar_arte").length).toBe(3));
    expect(chamadas("mesa-stories", "registrar_arte").every((b) => b.da_lamina === true)).toBe(true);
    await waitFor(() => expect((document.querySelector("[data-celular-do-story]") as HTMLElement).querySelector('[data-imagem-gerada="sim"]')).toBeTruthy());
    expect(document.querySelector("[data-estrutura-completa]")).toBeTruthy();
    // Nada de montagem no navegador (canvas com foto e texto por cima) no bloco da sequência.
    expect(ler("src/components/mesa/stories/BlocoSequencia.tsx")).not.toContain("gerarArteDoStory");
    expect(ler("src/components/mesa/stories/arteDoStory.ts")).not.toContain("export async function gerarArteDoStory");
  });

  it("texto editado depois da imagem fica desatualizado e não vira arquivo até trocar o texto na imagem", () => {
    const s = story({ id: "x", ordem: 1, texto_na_tela: "Novo", fundo: { tipo: "gerada", trabalho_id: TRABALHO, lamina: 1, caminho: caminhoDaLamina(1), versao: 1, texto: "Antigo" } });
    expect(imagemDesatualizada(s)).toBe(true);
    const laminas = montarLaminas([{ id: TRABALHO, cards: [{ ordem: 1, versao: 2, storage_path: caminhoDaLamina(1, 2) }] }], []);
    expect(precisaRegistrar(s, laminas)).toBe(false);
    expect(precisaRegistrar({ ...s, texto_na_tela: "Antigo", file_id: "f" }, laminas)).toBe(true);
    // Na fila, ainda não: espera a versão nova terminar.
    const naFila = montarLaminas([{ id: TRABALHO, cards: [{ ordem: 1, versao: 2, storage_path: caminhoDaLamina(1, 2) }] }], [{ trabalho_id: TRABALHO, status: "rodando", ordem: 1 }]);
    expect(precisaRegistrar({ ...s, texto_na_tela: "Antigo" }, naFila)).toBe(false);
  });
});

describe("telas em cartões na lateral", () => {
  const SEQ: any = { id: "s1", client_id: CLIENTE, data: AMANHA, objetivo: "vender", titulo: "Combo", gancho_de_amanha: null, criado_em: "2026-10-21T10:00:00Z", escolha: { modelo: "conversao" } };
  const tres = () => [1, 2, 3].map((o) => story({ id: `s${o}x`, ordem: o, texto_na_tela: `Tela ${o}`, fundo: { tipo: "gerada", papel: PAPEIS[o - 1] } }));

  it("cada tela vira um cartão com papel, situação, alça de arrastar, duplicar e remover", async () => {
    servidor({ sequencias: [SEQ], stories: tres() });
    montar();
    await waitFor(() => expect(document.querySelectorAll("[data-fila-de-stories] [data-story]").length).toBe(3));
    const c1 = document.querySelector('[data-story="s1x"]') as HTMLElement;
    expect(c1.getAttribute("data-papel")).toBe("gancho");
    expect(within(c1).getByRole("button", { name: "Arrastar o story 1" })).toBeTruthy();
    expect(within(c1).getByText("Sem imagem")).toBeTruthy();

    // Duplicar: a cópia nasce logo depois do original (salvar_story e a ordem nova).
    fireEvent.click(within(c1).getByRole("button", { name: "Duplicar o story 1" }));
    await waitFor(() => expect(chamadas("mesa-stories", "reordenar").length).toBe(1));
    expect(chamadas("mesa-stories", "salvar_story")[0].story).toMatchObject({ sequencia_id: "s1", texto_na_tela: "Tela 1", fundo: { tipo: "gerada", papel: "gancho" } });
    expect(chamadas("mesa-stories", "salvar_story")[0].story.id).toBeUndefined();
    expect(chamadas("mesa-stories", "reordenar")[0].ids).toEqual(["s1x", "n1", "s2x", "s3x"]);
    await waitFor(() => expect(Array.from(document.querySelectorAll("[data-fila-de-stories] [data-story]")).map((x) => x.getAttribute("data-story"))).toEqual(["s1x", "n1", "s2x", "s3x"]));

    // Remover pede confirmação e apaga pela função.
    fireEvent.click(within(document.querySelector('[data-story="s3x"]') as HTMLElement).getByRole("button", { name: "Remover o story 4" }));
    fireEvent.click(await screen.findByRole("button", { name: "Remover" }));
    await waitFor(() => expect(chamadas("mesa-stories", "apagar_story")[0]).toMatchObject({ id: "s3x" }));
    await waitFor(() => expect(document.querySelector('[data-story="s3x"]')).toBeNull());
  });

  it("arrastar troca a ordem (a lista nova vai inteira ao servidor)", () => {
    expect(moverNaLista(["a", "b", "c", "d"], "a", "c")).toEqual(["b", "c", "a", "d"]);
    expect(moverNaLista(["a", "b", "c"], "c", "a")).toEqual(["c", "a", "b"]);
    expect(moverNaLista(["a", "b"], "a", "x")).toEqual(["a", "b"]);
  });

  it("o filtro mostra as sequências de cada campanha", async () => {
    servidor({
      sequencias: [
        { ...SEQ, id: "s1", titulo: "Livre" },
        { ...SEQ, id: "s2", data: somarDias(AMANHA, 1), titulo: "Da Verão", escolha: { modelo: "oferta_relampago", campanha: { campanha_id: CAMPANHA, tema_id: "t-1", fase: "urgencia", nome: "Verão" } } },
      ],
      stories: [story({ id: "a1", ordem: 1, sequencia_id: "s1" }), story({ id: "b1", ordem: 1, sequencia_id: "s2" })],
    });
    montar();
    const filtro = (await screen.findByLabelText("Filtrar por campanha")) as HTMLSelectElement;
    expect(Array.from(filtro.options).map((o) => o.textContent)).toEqual(["Todas as sequências", "Da campanha Verão"]);
    fireEvent.change(filtro, { target: { value: CAMPANHA } });
    await waitFor(() => expect(document.querySelector(`[data-campanha-da-sequencia="${CAMPANHA}"]`)).toBeTruthy());
    expect(screen.getByText(/Da campanha Verão · Urgência/)).toBeTruthy();
  });
});

describe("gerarStoriesDaCampanha (o agente das Campanhas chama)", () => {
  const pedido = { clientId: CLIENTE, campanhaId: CAMPANHA, temaId: "tema-7", briefing: { oferta: "2 por 1", cta: "Garanta o seu" }, identidade: { paleta_apoio: [{ hex: "#ff6600" }], selo: { texto: "Verão" } }, fase: "urgencia" as const, quantidadeDeTelas: 5 };

  it("sem confirmar devolve o custo do 409 e não gasta nada", async () => {
    mock.invoke.mockImplementation(async (funcao: string, { body }: { body: any }) => {
      if (funcao === "mesa-stories" && body.acao === "stories_da_campanha") return { data: { error: "confirmar_custo", mensagem: "Custa cerca de US$ 0,42.", precisa_confirmar: true, custo_estimado_usd: 0.42, telas: 5 }, error: null };
      return { data: {}, error: null };
    });
    const r = await gerarStoriesDaCampanha(pedido);
    expect(r).toMatchObject({ situacao: "confirmar_custo", custo_estimado_usd: 0.42, telas: 5 });
    const corpo = chamadas("mesa-stories", "stories_da_campanha")[0];
    expect(corpo).toMatchObject({ client_id: CLIENTE, campanha_id: CAMPANHA, tema_id: "tema-7", fase: "urgencia", quantidade: 5, briefing: pedido.briefing, identidade: pedido.identidade });
    expect(corpo.confirmado).toBeUndefined();
    expect(mock.invoke.mock.calls.some((c: any[]) => c[0] === "estudio-arte")).toBe(false);
  });

  it("confirmado: planeja com o vínculo { campanha_id, tema_id } e pede as imagens na identidade da campanha", async () => {
    const vinculo = { campanha_id: CAMPANHA, tema_id: "tema-7", fase: "urgencia", nome: "Verão" };
    const stories = PAPEIS.map((p, i) => story({ id: `v${i}`, ordem: i + 1, fundo: { tipo: "gerada", papel: p, cena: "c" } }));
    mock.invoke.mockImplementation(async (funcao: string, { body }: { body: any }) => {
      if (funcao === "estudio-arte" && body.acao === "rapida_preparar") return { data: { trabalho: { id: TRABALHO, direcao: { cards: [{ ordem: 1 }, { ordem: 2 }, { ordem: 3 }] } }, custo_usd: 0.3 }, error: null };
      if (funcao === "estudio-arte") return { data: { ok: true }, error: null };
      if (body.acao === "stories_da_campanha") return { data: { sequencia: { id: "sq", client_id: CLIENTE, data: AMANHA, objetivo: "vender", titulo: "Verão: última chamada", escolha: { modelo: "oferta_relampago", campanha: vinculo } }, stories, ja_existia: false, custo_usd: 0.05 }, error: null };
      if (body.acao === "ligar_imagens") return { data: { stories: body.telas.map((t: any) => ({ ...stories.find((s) => s.id === t.id), fundo: { tipo: "gerada", trabalho_id: TRABALHO, lamina: t.lamina } })) }, error: null };
      return { data: {}, error: null };
    });
    const r = await gerarStoriesDaCampanha({ ...pedido, confirmado: true });
    if (r.situacao !== "pronta") throw new Error("esperava pronta");
    expect(chamadas("mesa-stories", "stories_da_campanha")[0].confirmado).toBe(true);
    expect(r.sequencia.campanha).toEqual(vinculo);
    expect(r.trabalhoId).toBe(TRABALHO);
    expect(r.stories.every((s) => s.fundo.trabalho_id === TRABALHO)).toBe(true);
    expect(r.custo_usd).toBeCloseTo(0.35, 6);
    const preparo = chamadas("estudio-arte", "rapida_preparar")[0];
    // A campanha vai junto: o Estúdio lê a identidade e anexa o selo ao gerador (desenhado, nunca colado).
    expect(preparo).toMatchObject({ campanha_id: CAMPANHA, formato: "stories_9x16", peca: "carrossel", laminas: 3 });
    expect(preparo.pedido).toContain('Campanha "Verão", fase de urgência');
    expect(preparo.pedido).toContain("#ff6600");
  });

  it("retoma a sequência que a campanha já tem: sem roteiro novo e só as imagens que faltam", async () => {
    const pronta = story({ id: "r1", ordem: 1, fundo: { tipo: "gerada", trabalho_id: TRABALHO, lamina: 1 } });
    mock.invoke.mockImplementation(async (funcao: string, { body }: { body: any }) => {
      if (funcao === "mesa-stories" && body.acao === "stories_da_campanha") return { data: { sequencia: { id: "sq", data: AMANHA, titulo: "Já feita", escolha: { campanha: { campanha_id: CAMPANHA, tema_id: "tema-7" } } }, stories: [pronta], ja_existia: true, custo_usd: 0 }, error: null };
      return { data: {}, error: null };
    });
    const r = await gerarStoriesDaCampanha({ ...pedido, confirmado: true });
    expect(r).toMatchObject({ situacao: "pronta", ja_existia: true, trabalhoId: TRABALHO });
    expect(mock.invoke.mock.calls.some((c: any[]) => c[0] === "estudio-arte")).toBe(false);
  });

  it("a função cobra o custo antes, retoma pelo vínculo e grava o vínculo em escolha.campanha", () => {
    const f = ler("supabase/functions/mesa-stories/index.ts");
    const corpo = f.slice(f.indexOf("async function storiesDaCampanha"), f.indexOf("async function sequenciasDaCampanha"));
    // Ordem: retomar (sem custo) -> 409 confirmar_custo -> planejar.
    expect(corpo.indexOf("sequenciaDaCampanha(c, linha.id, temaId)")).toBeGreaterThan(0);
    expect(corpo.indexOf('"confirmar_custo"')).toBeGreaterThan(corpo.indexOf("sequenciaDaCampanha(c, linha.id, temaId)"));
    expect(corpo.indexOf("planejarQueConverte(")).toBeGreaterThan(corpo.indexOf('"confirmar_custo"'));
    expect(f).toContain("escolha.campanha = { campanha_id: e.campanha.id, tema_id: e.campanha.tema_id, fase: e.campanha.fase, nome: e.campanha.nome };");
    expect(f).toContain('.eq("escolha->campanha->>campanha_id", campanhaId)');
    expect(partesDoCustoDosStories(5, { comPlano: true, comImagens: true }).map((p) => `${p.papel}x${p.vezes}`)).toEqual(["planox2", "diretor_artex1", "imagemx5", "leiturax5"]);
  });
});
