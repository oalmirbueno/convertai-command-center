import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement as h } from "react";
import { MemoryRouter } from "react-router-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Ajustar no celular (17/10/2026, dono: "no mobile está faltando um botão ali de ajustar. Ele não tem, então
 * adiciona essa parte embaixo ali: ajustar arte, assim por diante, ajustar lâmina"):
 * 1. Estúdio em pilha (abaixo do lg): embaixo da lâmina grande, "Ajustar lâmina" e "Ajustar arte" com nome à vista;
 * 2. prancheta: o ajuste de cada lâmina tem ícone próprio (lápis), nome "Ajustar lâmina N" e alvo de 36 px no toque;
 * 3. aba Ajustes: o botão principal diz "Ajustar" no celular;
 * 4. galeria da entrega (Execução): no celular o corpo rola e o "Pedir ajuste desta peça" fica ao alcance.
 */

const mock = vi.hoisted(() => ({ invoke: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: mock.invoke },
    rpc: mock.rpc,
    from: mock.from,
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://x/y.png" }, error: null })),
        upload: vi.fn(),
        download: vi.fn(),
      })),
    },
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import { ConfirmDialogProvider } from "@/components/shared/confirmDialog";
import AbaEstudio from "@/components/mesa/AbaEstudio";
import PranchetaDoEstudio from "@/components/mesa/PranchetaDoEstudio";
import type { ModeloIa } from "@/lib/mesa/api";

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
const catalogo = [
  modelo({ id: "openai:diretor", padrao_para: ["diretor_arte"] }),
  modelo({ id: "openai:leitor", rotulo: "Leitor", padrao_para: ["leitura"], preco_entrada_1m: 0.1, preco_saida_1m: 0.4 }),
  modelo({
    id: "openai:imagem",
    modelo_api: "gpt-image-2",
    tipo: "imagem",
    rotulo: "Imagem",
    preco_entrada_1m: 0,
    preco_saida_1m: 0,
    preco_imagem: { baixa: 0.01, media: 0.04, alta: 0.17 },
    padrao_para: ["imagem"],
  }),
];

const valorDaMesa = (): MesaValor => ({
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
});

function envolver(filho: any) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return h(MemoryRouter, null, h(QueryClientProvider, { client: qc }, h(ConfirmDialogProvider, null, h(MesaProvider, { valor: valorDaMesa() }, filho))));
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

const daquiATresDias = () => {
  const d = new Date();
  d.setDate(d.getDate() + 3);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const layout = { zona_texto: "base-esquerda" };
const duasLaminas = [
  { ordem: 1, funcao: "capa", texto_exato: "Capa", layout },
  { ordem: 2, funcao: "cta", texto_exato: "Fim", layout },
];
const gerada = (ordem: number) => ({
  ordem,
  versao: 1,
  storage_path: `c/estudio/t-9/card-${ordem}-v1.png`,
  origem: "gerar",
  verificacao: { pendente: false, ok: true, problemas: [] },
});

function tabelas(cards: unknown[]) {
  return {
    projects: [{ id: "p1", client_id: CLIENTE, deleted_at: null }],
    tasks: [{ id: "i-9", title: "Carrossel do ajuste", due_date: daquiATresDias(), delivery_type: "carousel", status: "todo", project_id: "p1", deleted_at: null }],
    estudio_trabalhos: [
      {
        id: "t-9",
        client_id: CLIENTE,
        task_id: "i-9",
        status: "pronto",
        direcao: { conceito: "Cena", carrossel_infinito: false, cards: duasLaminas },
        modelo_imagem_id: "openai:imagem",
        qualidade: "media",
        cards,
        file_ids: [],
        custo_usd: 0,
        conversa_id: null,
        legenda: null,
        hashtags: [],
        atualizado_em: "2026-10-17T00:00:00Z",
        criado_em: "2026-10-17",
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

async function comLargura<T>(largura: number, fn: () => Promise<T>): Promise<T> {
  const antes = window.innerWidth;
  (window as any).innerWidth = largura;
  try {
    return await fn();
  } finally {
    (window as any).innerWidth = antes;
  }
}

const montarAba = () => render(envolver(h(AbaEstudio, { mes: "2026-10-01", onMes: vi.fn(), tarefaId: "i-9", onTarefa: vi.fn() })));

beforeEach(() => {
  vi.clearAllMocks();
  try {
    window.sessionStorage.clear();
    window.localStorage.clear();
  } catch {
    /* sem storage */
  }
});

// ---------------------------------------------------------------- contratos do código

describe("contratos: os ajustes à vista no celular", () => {
  const estudio = ler("src/components/mesa/AbaEstudio.tsx");
  const prancheta = ler("src/components/mesa/PranchetaDoEstudio.tsx");
  const card = ler("src/components/mesa/CardDoEstudio.tsx");
  const prova = ler("src/components/execucao/ProvaDaEntrega.tsx");

  it("Estúdio: a barra embaixo da lâmina grande só existe na pilha, some no lg e abre os dois ajustes", () => {
    const barra = estudio.slice(estudio.indexOf("const barraDeAjusteNoCelular"), estudio.indexOf("const centroDaProducao"));
    expect(barra).toContain('className="mt-3 flex min-w-0 lg:hidden"');
    expect(barra).toContain(">Ajustar lâmina</span>");
    expect(barra).toContain(">Ajustar arte</span>");
    expect(barra).toContain("aria-label={`Ajustar lâmina ${cardSelecionado.ordem}`}");
    expect(barra).toContain('onClick={() => abrirPainel(cardSelecionado.ordem, "livre")}');
    expect(barra).toContain('onClick={() => abrirFerramenta("diretor", false)}');
    // Alvo de toque de 44 px nos dois.
    expect(barra.split("min-h-[44px]").length - 1).toBe(2);
    expect(estudio).toContain(
      "const mostrarAjusteNoCelular = !colunas && !!cardSelecionado && !!ultimaDaEscolhida && !laminaOcupada(cardSelecionado.ordem) && !entregue;",
    );
    // Logo depois da lâmina grande, só no ramo da pilha (o das colunas não tem a barra).
    const pilha = estudio.slice(estudio.indexOf("const centroDaProducao"), estudio.indexOf("const centro ="));
    expect(pilha).toContain('<div className="mt-3 flex min-w-0 flex-col">{laminaGrande}</div>\n      {barraDeAjusteNoCelular}');
    expect(pilha.split("{barraDeAjusteNoCelular}").length - 1).toBe(1);
  });

  it("prancheta: o ajuste de cada lâmina usa o lápis, diz o número e cresce no toque", () => {
    expect(prancheta).toContain('import { Clock, GripVertical, PenLine } from "lucide-react";');
    expect(prancheta).not.toContain("MessageSquare");
    expect(prancheta).toContain("aria-label={`Ajustar lâmina ${card.ordem}`}");
    expect(prancheta).toContain("h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-secondary hover:text-foreground [@media(pointer:coarse)]:h-9 [@media(pointer:coarse)]:w-9");
  });

  it("aba Ajustes: o botão principal mostra \"Ajustar\" abaixo do lg e fica só o ícone no computador", () => {
    expect(card).toContain('<span className="ml-1.5 lg:sr-only" data-rotulo-do-ajustar="">Ajustar</span>');
    expect(card).toContain('className="h-11 gap-0 px-4 lg:h-8 lg:px-2.5"');
  });

  it("galeria da entrega: no celular o corpo rola e a imagem fica em até 55vh; no lg, igual a antes", () => {
    expect(prova).toContain('className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-visible"');
    expect(prova).toContain('className="max-h-[55vh] overflow-auto p-4 lg:max-h-none lg:min-h-0 lg:flex-1"');
    expect(prova).toContain("Pedir ajuste desta peça");
  });

  it("sem travessão nem regex que o celular antigo não lê nos arquivos tocados", () => {
    for (const fonte of [estudio, prancheta, card, prova]) {
      expect(fonte.indexOf("—")).toBe(-1);
      expect(fonte).not.toMatch(/\(\?<[=!]/);
      expect(fonte).not.toMatch(/\\p\{/);
    }
  });
});

// ---------------------------------------------------------------- prancheta renderizada

describe("prancheta: o ajuste da lâmina", () => {
  it("mostra \"Ajustar lâmina N\" só nas lâminas com arte e chama o ajuste daquela lâmina", () => {
    const onAjustar = vi.fn();
    render(
      envolver(
        h(PranchetaDoEstudio, {
          cards: duasLaminas,
          ultimas: new Map([[1, gerada(1)]]),
          selecionado: 1,
          onSelecionar: vi.fn(),
          andamento: {},
          infinito: false,
          largura: 112,
          orientacao: "horizontal",
          podeReordenar: false,
          onReordenar: vi.fn(),
          onAjustar,
        } as any),
      ),
    );
    const botao = screen.getByLabelText("Ajustar lâmina 1");
    expect(botao.hasAttribute("data-ajustar-lamina")).toBe(true);
    expect(screen.queryByLabelText("Ajustar lâmina 2")).toBeNull();
    fireEvent.click(botao);
    expect(onAjustar).toHaveBeenCalledWith(1);
  });
});

// ---------------------------------------------------------------- Estúdio renderizado

describe("Estúdio: a barra de ajuste embaixo da lâmina grande", () => {
  it("no celular aparece com a lâmina gerada; \"Ajustar lâmina\" abre a folha da Lâmina e \"Ajustar arte\" a do Diretor", async () => {
    mock.from.mockImplementation(bancoFalso(tabelas([gerada(1), gerada(2)])));
    await comLargura(390, async () => {
      montarAba();
      await screen.findByText("Prancheta");
      const barra = await waitFor(() => {
        const el = document.querySelector("[data-ajuste-no-celular]");
        expect(el).not.toBeNull();
        return el as HTMLElement;
      });
      expect(barra.className).toContain("lg:hidden");
      const lamina = within(barra).getByRole("button", { name: /^Ajustar lâmina \d+$/ });
      const numero = (lamina.getAttribute("aria-label") || "").replace("Ajustar lâmina ", "");
      expect(lamina.textContent).toContain("Ajustar lâmina");
      expect(within(barra).getByRole("button", { name: /^Ajustar arte/ }).textContent).toContain("Ajustar arte");

      fireEvent.click(lamina);
      // A folha da ferramenta Lâmina sobe já na aba Ajustes, com o campo do pedido.
      expect(await screen.findByLabelText("Pedido de ajuste")).toBeTruthy();
      expect(numero).toMatch(/^[12]$/);
    });
  });

  it("no celular, \"Ajustar arte\" abre o Diretor (o ajuste do conjunto todo)", async () => {
    mock.from.mockImplementation(bancoFalso(tabelas([gerada(1), gerada(2)])));
    await comLargura(390, async () => {
      montarAba();
      await screen.findByText("Prancheta");
      const arte = await screen.findByRole("button", { name: /^Ajustar arte/ });
      fireEvent.click(arte);
      await waitFor(() => expect(document.querySelector('[role="region"][aria-label="Diretor"]')).not.toBeNull());
    });
  });

  it("sem arte gerada a barra não aparece; no computador (colunas) também não", async () => {
    mock.from.mockImplementation(bancoFalso(tabelas([])));
    await comLargura(390, async () => {
      const { unmount } = montarAba();
      await screen.findByText("Prancheta");
      expect(document.querySelector("[data-ajuste-no-celular]")).toBeNull();
      unmount();
    });

    mock.from.mockImplementation(bancoFalso(tabelas([gerada(1), gerada(2)])));
    await comLargura(1440, async () => {
      montarAba();
      await screen.findByText("Prancheta");
      await waitFor(() => expect(screen.getAllByLabelText(/^Ajustar lâmina \d$/).length).toBe(2));
      expect(document.querySelector("[data-ajuste-no-celular]")).toBeNull();
    });
  });
});
