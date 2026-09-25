import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { MemoryRouter } from "react-router-dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Decisões do dono sobre o Estúdio (23/09):
 * 1. no carrossel contínuo a ordem das lâminas fica travada (o panorama foi cortado nela);
 * 2. a estimativa do contínuo soma os trechos de panorama que ainda faltam;
 * 3. Ctrl+V na ferramenta Fotos: imagem com texto junto anexa a imagem e deixa o texto colar.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), from: vi.fn(), upload: vi.fn(), download: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    rpc: mock.rpc,
    from: mock.from,
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://x/y.png" }, error: null })),
        upload: mock.upload,
        download: mock.download,
      })),
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import { ConfirmDialogProvider } from "@/components/shared/confirmDialog";
import AbaEstudio, { partesDaLamina, precosPorQualidade } from "@/components/mesa/AbaEstudio";
import EstudioFotos, { decidirColar, textoDoColar } from "@/components/mesa/EstudioFotos";
import PranchetaDoEstudio, { AVISO_DA_ORDEM_NO_CONTINUO } from "@/components/mesa/PranchetaDoEstudio";
import {
  custoDoPanorama,
  fatorDoTrecho,
  NOTA_DO_FUNDO_CONTINUO,
  partesDoPanorama,
  trechoDaLamina,
  trechosQueFaltam,
  usaFundoContinuo,
} from "@/components/mesa/estudioUtil";
import { trechoDaLamina as trechoDoServidor } from "../../supabase/functions/_shared/direcao-arte";
import { estimarLocal, usd, type ModeloIa } from "@/lib/mesa/api";

const raiz = resolve(__dirname, "../..");
const ler = (rel: string) => readFileSync(resolve(raiz, rel), "utf8");

const CLIENTE = "22222222-2222-2222-2222-222222222222";

const modelo = (extra: Partial<ModeloIa>): ModeloIa => ({
  id: "x",
  provedor: "openai",
  modelo_api: "x",
  tipo: "texto",
  rotulo: "X",
  preco_entrada_1m: 1,
  preco_saida_1m: 2,
  preco_cache_1m: null,
  preco_imagem: null,
  raciocinio: [],
  padrao_para: [],
  ativo: true,
  ...extra,
});
const diretor = modelo({ id: "openai:diretor", padrao_para: ["diretor_arte"] });
const leitor = modelo({ id: "openai:leitor", rotulo: "Leitor", padrao_para: ["leitura"], preco_entrada_1m: 0.1, preco_saida_1m: 0.4 });
const imagem = modelo({
  id: "openai:imagem",
  // O contínuo vale pela capacidade (GPT Image), não pelo provedor (25/09).
  modelo_api: "gpt-image-2",
  tipo: "imagem",
  rotulo: "Imagem",
  preco_entrada_1m: 0,
  preco_saida_1m: 0,
  preco_imagem: { baixa: 0.01, media: 0.04, alta: 0.17 },
  padrao_para: ["imagem"],
});
const catalogo = [diretor, leitor, imagem];

const valorDaMesa = (extra: Partial<MesaValor> = {}): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Cliente sintético",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 10,
  catalogo,
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
  ...extra,
});

function envolver(filho: any, valor = valorDaMesa()) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return h(MemoryRouter, null, h(QueryClientProvider, { client: qc }, h(ConfirmDialogProvider, null, h(MesaProvider, { valor }, filho))));
}

/** Banco falso: cada tabela devolve as linhas que passam nos filtros usados pela tela. */
function bancoFalso(tabelas: Record<string, any[]>) {
  return (nome: string) => {
    const filtros: ((r: any) => boolean)[] = [];
    const b: any = {
      select: () => b,
      order: () => b,
      eq: (c: string, v: unknown) => { filtros.push((r) => r[c] === v); return b; },
      neq: (c: string, v: unknown) => { filtros.push((r) => r[c] !== v); return b; },
      in: (c: string, vs: unknown[]) => { filtros.push((r) => vs.indexOf(r[c]) >= 0); return b; },
      is: (c: string, v: unknown) => { filtros.push((r) => (r[c] === undefined ? null : r[c]) === v); return b; },
      not: (c: string) => { filtros.push((r) => r[c] !== null && r[c] !== undefined); return b; },
      overlaps: (c: string, vs: unknown[]) => { filtros.push((r) => (r[c] || []).some((x: unknown) => vs.indexOf(x) >= 0)); return b; },
      gte: (c: string, v: string) => { filtros.push((r) => String(r[c]) >= v); return b; },
      lt: (c: string, v: string) => { filtros.push((r) => String(r[c]) < v); return b; },
      limit: () => b,
      range: () => b,
      contains: () => b,
      or: () => b,
      update: () => b,
      maybeSingle: () => Promise.resolve({ data: (tabelas[nome] || []).filter((r) => filtros.every((f) => f(r)))[0] || null, error: null }),
      then: (ok: any, erro: any) =>
        Promise.resolve({ data: (tabelas[nome] || []).filter((r) => filtros.every((f) => f(r))), error: null, count: 0 }).then(ok, erro),
    };
    return b;
  };
}

const hoje = () => {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const layout = { zona_texto: "base-esquerda" };

function tabelas(direcao: Record<string, unknown>) {
  return {
    projects: [{ id: "p1", client_id: CLIENTE, deleted_at: null }],
    tasks: [{ id: "i-9", title: "Carrossel da cena", due_date: hoje(), delivery_type: "carousel", status: "todo", project_id: "p1", deleted_at: null }],
    estudio_trabalhos: [
      {
        id: "t-9",
        client_id: CLIENTE,
        task_id: "i-9",
        status: "dirigido",
        direcao,
        modelo_imagem_id: imagem.id,
        qualidade: "media",
        cards: [],
        file_ids: [],
        custo_usd: 0,
        conversa_id: null,
        legenda: null,
        hashtags: [],
        atualizado_em: "2026-09-23T00:00:00Z",
        criado_em: "2026-09-23",
      },
    ],
    editorial_post_internal: [],
    editorial_posts: [],
    editorial_publications: [],
    staff_files_secure: [],
    calendario_propostas: [],
    task_attachments: [],
  };
}

const tresLaminas = [
  { ordem: 1, funcao: "capa", texto_exato: "Capa", layout },
  { ordem: 2, texto_exato: "Meio", layout },
  { ordem: 3, funcao: "cta", texto_exato: "Fim", layout },
];

async function comLargura<T>(largura: number, fn: () => Promise<T>): Promise<T> {
  const antes = window.innerWidth;
  (window as any).innerWidth = largura;
  try {
    return await fn();
  } finally {
    (window as any).innerWidth = antes;
  }
}

function montarAba() {
  return render(envolver(h(AbaEstudio, { mes: "2026-09-01", onMes: vi.fn(), tarefaId: "i-9", onTarefa: vi.fn() })));
}

beforeEach(() => {
  vi.clearAllMocks();
  try {
    window.sessionStorage.clear();
    window.localStorage.clear();
  } catch {
    /* sem storage */
  }
});

// ---------------------------------------------------------------- 1. ordem travada no contínuo

describe("reordenar lâminas no carrossel contínuo", () => {
  const props = (extra: Record<string, unknown>) => ({
    cards: tresLaminas,
    ultimas: new Map(),
    selecionado: 1,
    onSelecionar: vi.fn(),
    andamento: {},
    infinito: true,
    largura: 112,
    orientacao: "vertical",
    podeReordenar: true,
    onReordenar: vi.fn(),
    ...extra,
  });

  it("prancheta: com o aviso, nenhuma alça arrasta e o tooltip explica; sem ele, arrasta", () => {
    const { unmount } = render(envolver(h(PranchetaDoEstudio, props({ avisoDaOrdem: AVISO_DA_ORDEM_NO_CONTINUO }) as any)));
    expect(screen.queryByLabelText(/Arrastar a lâmina/)).toBeNull();
    const travadas = Array.from(document.querySelectorAll("[data-ordem-travada]")) as HTMLElement[];
    expect(travadas.length).toBe(3);
    expect(travadas[0].getAttribute("title")).toBe(
      "No carrossel contínuo a ordem faz parte da cena. Desligue o contínuo ou use Refazer o fundo para reordenar.",
    );
    expect(travadas[0].getAttribute("aria-disabled")).toBe("true");
    unmount();

    render(envolver(h(PranchetaDoEstudio, props({ infinito: false }) as any)));
    expect(screen.getAllByLabelText(/Arrastar a lâmina/).length).toBe(3);
    expect(document.querySelector("[data-ordem-travada]")).toBeNull();
  });

  it("aba: contínuo ligado trava a ordem (e o reordenar recusa); desligado, reordena igual", async () => {
    mock.from.mockImplementation(bancoFalso(tabelas({ conceito: "Cena", carrossel_infinito: true, cards: tresLaminas })));
    await comLargura(1440, async () => {
      const { unmount } = montarAba();
      await screen.findByText("Prancheta");
      await waitFor(() => expect(document.querySelectorAll("[data-ordem-travada]").length).toBe(3));
      expect(screen.queryByLabelText(/Arrastar a lâmina/)).toBeNull();
      unmount();
    });

    mock.from.mockImplementation(bancoFalso(tabelas({ conceito: "Cena", carrossel_infinito: false, cards: tresLaminas })));
    await comLargura(1440, async () => {
      montarAba();
      await screen.findByText("Prancheta");
      await waitFor(() => expect(screen.getAllByLabelText(/Arrastar a lâmina/).length).toBe(3));
      expect(document.querySelector("[data-ordem-travada]")).toBeNull();
    });

    const estudio = ler("src/components/mesa/AbaEstudio.tsx");
    expect(estudio).toContain("const ordemTravada = infinito && cardsDaDirecao.length > 1;");
    expect(estudio).toContain("podeReordenar={!ocupado && cardsDaDirecao.length > 1 && !entregue && !ordemTravada}");
    const reordenar = estudio.slice(estudio.indexOf("const reordenar = async"), estudio.indexOf("const ok = await confirmar", estudio.indexOf("const reordenar = async")));
    expect(reordenar).toContain("if (ordemTravada)");
  });
});

// ---------------------------------------------------------------- 2. estimativa com o panorama

describe("a estimativa do contínuo conta o panorama", () => {
  it("trechoDaLamina espelha o servidor", () => {
    for (let total = 1; total <= 10; total++) {
      for (let ordem = 1; ordem <= total; ordem++) expect(trechoDaLamina(ordem, total)).toEqual(trechoDoServidor(ordem, total));
    }
    expect(trechoDaLamina(2, 5)).toEqual({ inicio: 1, fim: 3 });
    expect(trechoDaLamina(4, 5)).toEqual({ inicio: 3, fim: 5 });
    expect(trechoDaLamina(6, 6)).toEqual({ inicio: 5, fim: 6 });
  });

  it("fator de área: (k*1088*1360)/(1024*1536) arredondado para cima em 1 casa", () => {
    expect(fatorDoTrecho(1)).toBe(1);
    expect(fatorDoTrecho(2)).toBe(1.9);
    expect(fatorDoTrecho(3)).toBe(2.9);
  });

  it("conta só os trechos que faltam; fundo existente não conta; trecho repetido conta uma vez", () => {
    // 5 lâminas, nada pronto: 1..3 e 3..5.
    expect(trechosQueFaltam([1, 2, 3, 4, 5], 5, {}).map((t) => [t.inicio, t.fim])).toEqual([[1, 3], [3, 5]]);
    expect(custoDoPanorama([1, 2, 3, 4, 5], 5, null, 0.04)).toBeCloseTo((2.9 + 2.9) * 0.04, 6);
    // Trecho 1..3 pronto: só 3..5 (a ligação já tem fundo).
    const pronto = { "1": "a", "2": "b", "3": "c" };
    expect(trechosQueFaltam([4, 5], 5, pronto).map((t) => [t.inicio, t.fim])).toEqual([[3, 5]]);
    expect(custoDoPanorama([4, 5], 5, pronto, 0.04)).toBeCloseTo(2.9 * 0.04, 6);
    // Tudo pronto: zero.
    expect(custoDoPanorama([1, 2, 3, 4, 5], 5, { ...pronto, "4": "d", "5": "e" }, 0.04)).toBe(0);
    // Refazer uma lâmina com fundo pronto não paga panorama.
    expect(custoDoPanorama([2], 5, pronto, 0.17)).toBe(0);
    // Lâmina 5 sozinha sem nada pronto: o servidor faz o trecho anterior primeiro (a ligação).
    expect(trechosQueFaltam([5], 5, {}).map((t) => [t.inicio, t.fim])).toEqual([[1, 3], [3, 5]]);
    // Trecho de 2 lâminas no fim (6 lâminas: 5..6).
    expect(trechosQueFaltam([6], 6, { "5": "x" })).toEqual([{ inicio: 5, fim: 6, k: 2, fator: 1.9 }]);
    // Uma lâmina só não tem panorama.
    expect(custoDoPanorama([1], 1, {}, 0.04)).toBe(0);
  });

  it("a qualidade escolhida muda o preço (reusa o preço de imagem do catálogo)", () => {
    const partes = (q: "baixa" | "media" | "alta") => partesDoPanorama([1, 2, 3], 3, {}, imagem.id, q);
    expect(estimarLocal(partes("baixa"), catalogo)).toBeCloseTo(custoDoPanorama([1, 2, 3], 3, {}, 0.01), 6);
    expect(estimarLocal(partes("media"), catalogo)).toBeCloseTo(custoDoPanorama([1, 2, 3], 3, {}, 0.04), 6);
    expect(estimarLocal(partes("alta"), catalogo)).toBeCloseTo(custoDoPanorama([1, 2, 3], 3, {}, 0.17), 6);
    expect(partesDoPanorama([1, 2, 3], 3, {}, "", "media")).toEqual([]);
    // Seletor: preço médio por lâmina com o fundo que falta, maior que sem ele.
    const sem = precosPorQualidade(imagem.id, leitor.id, catalogo);
    const com = precosPorQualidade(imagem.id, leitor.id, catalogo, { laminas: 3, partes: (q) => partesDoPanorama([1, 2, 3], 3, {}, imagem.id, q) });
    const porLamina = (estimarLocal(partesDaLamina(imagem.id, leitor.id, "alta", 3).concat(partesDoPanorama([1, 2, 3], 3, {}, imagem.id, "alta")), catalogo) as number) / 3;
    expect(com.alta).toBe(`~${usd(porLamina)}`);
    expect(com.alta).not.toBe(sem.alta);
  });

  it("lâmina com foto própria ou sem layout não usa o fundo contínuo", () => {
    expect(usaFundoContinuo({ layout })).toBe(true);
    expect(usaFundoContinuo({})).toBe(false);
    expect(usaFundoContinuo({ layout, imagens_ids: ["a"] })).toBe(false);
    expect(usaFundoContinuo({ layout, fotos_livres: [{ caminho: "x", papel: "fundo" }] })).toBe(false);
  });

  it("aba: 'Gerar todas' soma o panorama e o tooltip diz que inclui o fundo contínuo", async () => {
    mock.from.mockImplementation(bancoFalso(tabelas({ conceito: "Cena", carrossel_infinito: true, cards: tresLaminas, panorama: null })));
    await comLargura(1440, async () => {
      montarAba();
      const botao = (await screen.findByRole("button", { name: /Gerar todas \(3\)/ })) as HTMLButtonElement;
      const esperado = estimarLocal(partesDaLamina(imagem.id, leitor.id, "media", 3).concat(partesDoPanorama([1, 2, 3], 3, {}, imagem.id, "media")), catalogo);
      expect(botao.textContent).toContain(`~${usd(esperado)}`);
      expect(botao.getAttribute("title")).toContain(NOTA_DO_FUNDO_CONTINUO);
      const padrao = screen.getByRole("radio", { name: /Padrão/ });
      expect(padrao.getAttribute("title")).toContain("inclui o fundo contínuo");
    });
  });

  it("aba: com o panorama pronto (ou sem o contínuo) o preço é o de sempre, sem a nota", async () => {
    const fundos = { "1": "c/f1.png", "2": "c/f2.png", "3": "c/f3.png" };
    mock.from.mockImplementation(bancoFalso(tabelas({ conceito: "Cena", carrossel_infinito: true, cards: tresLaminas, panorama: { fundos } })));
    const semFundo = estimarLocal(partesDaLamina(imagem.id, leitor.id, "media", 3), catalogo);
    await comLargura(1440, async () => {
      const { unmount } = montarAba();
      const botao = (await screen.findByRole("button", { name: /Gerar todas \(3\)/ })) as HTMLButtonElement;
      expect(botao.textContent).toContain(`~${usd(semFundo)}`);
      expect(botao.getAttribute("title")).not.toContain(NOTA_DO_FUNDO_CONTINUO);
      unmount();
    });
    mock.from.mockImplementation(bancoFalso(tabelas({ conceito: "Cena", carrossel_infinito: false, cards: tresLaminas })));
    await comLargura(1440, async () => {
      montarAba();
      const botao = (await screen.findByRole("button", { name: /Gerar todas \(3\)/ })) as HTMLButtonElement;
      expect(botao.textContent).toContain(`~${usd(semFundo)}`);
      expect(botao.getAttribute("title")).not.toContain(NOTA_DO_FUNDO_CONTINUO);
    });
  });
});

// ---------------------------------------------------------------- 3. Ctrl+V na ferramenta Fotos

describe("Ctrl+V na ferramenta Fotos", () => {
  const arquivo = () => new File(["x"], "foto.png", { type: "image/png" });
  const itemImagem = (f: File) => ({ kind: "file", type: "image/png", getAsFile: () => f });
  const itemTexto = { kind: "string", type: "text/plain", getAsFile: () => null };
  const dados = (itens: any[], texto = "") =>
    ({ items: itens, files: [], getData: (t: string) => (t === "text/plain" ? texto : "") }) as unknown as DataTransfer;

  it("regra pura: imagem só bloqueia; imagem com texto não bloqueia; só texto passa", () => {
    const f = arquivo();
    expect(decidirColar(dados([itemImagem(f)]))).toEqual({ imagens: [f], bloquear: true });
    expect(decidirColar(dados([itemImagem(f), itemTexto], "Legenda do post"))).toEqual({ imagens: [f], bloquear: false });
    expect(decidirColar(dados([itemTexto], "só texto"))).toEqual({ imagens: [], bloquear: false });
    expect(decidirColar(null)).toEqual({ imagens: [], bloquear: false });
    // Texto em branco não conta como texto.
    expect(textoDoColar(dados([itemImagem(f)], "   "))).toBe(false);
  });

  function colar(clipboardData: DataTransfer) {
    const e = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(e, "clipboardData", { value: clipboardData });
    act(() => { window.dispatchEvent(e); });
    return e;
  }

  it("imagem com texto: anexa a imagem sem bloquear o texto", async () => {
    mock.upload.mockResolvedValue({ data: {}, error: null });
    render(envolver(h(EstudioFotos, { card: { ordem: 1, fotos_livres: [] }, ocupado: false, temArte: false, onSalvar: vi.fn() })));
    const e = colar(dados([itemImagem(arquivo()), itemTexto], "Texto que veio junto"));
    expect(e.defaultPrevented).toBe(false);
    await waitFor(() => expect(mock.upload).toHaveBeenCalledTimes(1));
  });

  it("só imagem: bloqueia o colar padrão e anexa", async () => {
    mock.upload.mockResolvedValue({ data: {}, error: null });
    render(envolver(h(EstudioFotos, { card: { ordem: 1, fotos_livres: [] }, ocupado: false, temArte: false, onSalvar: vi.fn() })));
    const e = colar(dados([itemImagem(arquivo())]));
    expect(e.defaultPrevented).toBe(true);
    await waitFor(() => expect(mock.upload).toHaveBeenCalledTimes(1));
  });

  it("só texto: nunca é interceptado e não sobe nada", () => {
    render(envolver(h(EstudioFotos, { card: { ordem: 1, fotos_livres: [] }, ocupado: false, temArte: false, onSalvar: vi.fn() })));
    const e = colar(dados([itemTexto], "texto"));
    expect(e.defaultPrevented).toBe(false);
    expect(mock.upload).not.toHaveBeenCalled();
  });
});
