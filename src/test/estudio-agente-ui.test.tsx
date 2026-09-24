import { createElement as h } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Conversar com o diretor no Estúdio (pedido do dono em 24/09): a conversa,
 * os cartões de mudança com "Aplicar" (sem custo) e "Aplicar e refazer" (com
 * o preço da regeneração) e o envio com a lâmina em foco.
 */

const mock = vi.hoisted(() => ({
  invoke: vi.fn(),
  tabelas: {} as Record<string, unknown>,
}));

vi.mock("@/integrations/supabase/client", () => {
  const consulta = (tabela: string) => {
    const dados = mock.tabelas[tabela] === undefined ? [] : mock.tabelas[tabela];
    const b: any = {};
    for (const m of ["select", "eq", "neq", "not", "in", "is", "or", "contains", "order", "limit", "range", "update"]) b[m] = () => b;
    const primeiro = () => ({ data: Array.isArray(dados) ? (dados[0] === undefined ? null : dados[0]) : dados, error: null });
    b.maybeSingle = () => Promise.resolve(primeiro());
    b.single = () => Promise.resolve(primeiro());
    b.then = (ok: any, erro: any) => Promise.resolve({ data: dados, error: null }).then(ok, erro);
    return b;
  };
  return {
    supabase: {
      functions: { invoke: mock.invoke },
      rpc: vi.fn(),
      from: (tabela: string) => consulta(tabela),
      storage: { from: () => ({ createSignedUrl: () => Promise.resolve({ data: { signedUrl: "https://arquivo.test/img.png" }, error: null }) }) },
    },
  };
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }));

import { TooltipProvider } from "@/components/ui/tooltip";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";
import DiretorDoEstudio from "@/components/mesa/DiretorDoEstudio";
import type { Trabalho } from "@/components/mesa/useItensDoMes";
import type { ModeloIa, ParteDaEstimativa } from "@/lib/mesa/api";

const CLIENTE = "11111111-1111-1111-1111-111111111111";
const TRABALHO = "22222222-2222-2222-2222-222222222222";
const MSG = "33333333-3333-3333-3333-333333333333";

const catalogo: ModeloIa[] = [
  {
    id: "openai:diretor", provedor: "openai", modelo_api: "gpt-texto", tipo: "texto", rotulo: "Diretor",
    preco_entrada_1m: 1, preco_saida_1m: 2, preco_cache_1m: null, preco_imagem: null,
    raciocinio: ["low", "medium"], padrao_para: ["diretor_arte", "leitura"], ativo: true,
  },
  {
    id: "openai:imagem", provedor: "openai", modelo_api: "gpt-image", tipo: "imagem", rotulo: "Imagem",
    preco_entrada_1m: null, preco_saida_1m: null, preco_cache_1m: null, preco_imagem: { baixa: 0.01, media: 0.04, alta: 0.17 },
    raciocinio: [], padrao_para: ["imagem"], ativo: true,
  },
];

const valorDaMesa = (): MesaValor => ({
  clientId: CLIENTE,
  clientName: "Cliente sintético",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 50,
  catalogo,
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

const trabalho = {
  id: TRABALHO,
  task_id: null,
  status: "pronto",
  direcao: {
    conceito: "Rotina real",
    carrossel_infinito: false,
    cards: [
      { ordem: 1, funcao: "capa", texto_exato: "Sua cozinha" },
      { ordem: 2, funcao: "conteudo", texto_exato: "Passo 1" },
    ],
  },
  modelo_imagem_id: "openai:imagem",
  qualidade: "media",
  cards: [{ ordem: 2, versao: 1, storage_path: `${CLIENTE}/estudio/${TRABALHO}/card-2-v1.png` }],
  legenda: null,
  file_ids: [],
  custo_usd: 0,
  conversa_id: null,
  atualizado_em: "2026-09-24T10:00:00Z",
} as unknown as Trabalho;

const mudanca = {
  id: "m1",
  alvo: "lamina",
  ordem: 2,
  titulo: "Cenário ao entardecer",
  motivo: "O passo fala de rotina de fim de dia.",
  campos: { imagem: "cozinha ao entardecer, luz dourada", cor_destaque: "#880516" },
  regerar: [2],
};

function montar(props: Partial<Parameters<typeof DiretorDoEstudio>[0]> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onRefazer = vi.fn().mockResolvedValue({ custo_usd: 0.05 });
  const onAtualizar = vi.fn();
  const partesRefazer = vi.fn((ordens: number[]): ParteDaEstimativa[] => [{ modeloId: "openai:imagem", tipo: "imagem", imagens: 1, qualidade: "media", vezes: ordens.length }]);
  render(
    h(
      QueryClientProvider,
      { client: qc },
      h(
        TooltipProvider,
        null,
        h(
          MesaProvider,
          { valor: valorDaMesa() },
          h(DiretorDoEstudio, {
            trabalho,
            ordemEmFoco: 2,
            ocupado: false,
            partesRefazer,
            onRefazer,
            onAtualizar,
            ...props,
          }),
        ),
      ),
    ),
  );
  return { onRefazer, onAtualizar, partesRefazer };
}

const chamadasDe = (acao: string) =>
  mock.invoke.mock.calls.filter((c) => c[0] === "estudio-arte" && c[1] && c[1].body && c[1].body.acao === acao).map((c) => c[1].body);

beforeEach(() => {
  mock.invoke.mockReset();
  mock.tabelas = {
    agente_conversas: [{ id: "conv-1" }],
    // A tela lê em ordem decrescente e inverte.
    agente_mensagens: [
      { id: MSG, papel: "agente", conteudo: "Sugiro levar a cena para o fim do dia.", anexos: [{ tipo: "mudancas", mudancas: [mudanca], avisos: [], aplicadas: [], em_foco: 2 }], criado_em: "2026-09-24T10:00:01Z" },
      { id: "u1", papel: "usuario", conteudo: "Quero outro cenário", anexos: [{ tipo: "pedido", em_foco: 2 }], criado_em: "2026-09-24T10:00:00Z" },
    ],
  };
});

describe("Conversar com o diretor", () => {
  it("mostra a conversa e o cartão da mudança com Aplicar e Aplicar e refazer (com preço)", async () => {
    montar();
    expect(await screen.findByText("Sugiro levar a cena para o fim do dia.")).toBeTruthy();
    expect(screen.getByText("Quero outro cenário")).toBeTruthy();
    expect(screen.getByText("sobre a lâmina 2")).toBeTruthy();
    expect(screen.getByText("Cenário ao entardecer")).toBeTruthy();
    expect(screen.getByText("Lâmina 2")).toBeTruthy();
    expect(screen.getByText("cozinha ao entardecer, luz dourada")).toBeTruthy();
    expect(screen.getByRole("button", { name: /^Aplicar$/ })).toBeTruthy();
    const refazer = screen.getByRole("button", { name: /Aplicar e refazer a lâmina 2/ });
    expect(refazer.textContent).toContain("~US$");
  });

  it("Aplicar grava sem custo, sem pedir para refazer, e marca a mensagem", async () => {
    mock.invoke.mockResolvedValue({ data: { aplicadas: ["m1"], afetadas: [2], regerar: [], avisos: [], custo_usd: 0 }, error: null });
    const { onRefazer, onAtualizar } = montar();
    fireEvent.click(await screen.findByRole("button", { name: /^Aplicar$/ }));
    await waitFor(() => expect(chamadasDe("aplicar_mudancas")).toHaveLength(1));
    const corpo = chamadasDe("aplicar_mudancas")[0];
    expect(corpo).toMatchObject({ trabalho_id: TRABALHO, mensagem_id: MSG });
    expect(corpo).not.toHaveProperty("regerar");
    expect(corpo.mudancas[0]).toMatchObject({ id: "m1", alvo: "lamina", ordem: 2, campos: mudanca.campos });
    await waitFor(() => expect(onAtualizar).toHaveBeenCalled());
    expect(onRefazer).not.toHaveBeenCalled();
  });

  it("Aplicar e refazer grava e refaz a lâmina pelo fluxo da tela", async () => {
    mock.invoke.mockResolvedValue({ data: { aplicadas: ["m1"], afetadas: [2], regerar: [2], avisos: [], custo_usd: 0 }, error: null });
    const { onRefazer, partesRefazer } = montar();
    fireEvent.click(await screen.findByRole("button", { name: /Aplicar e refazer a lâmina 2/ }));
    await waitFor(() => expect(onRefazer).toHaveBeenCalledWith([2]));
    expect(chamadasDe("aplicar_mudancas")[0]).toMatchObject({ regerar: [2], mensagem_id: MSG });
    expect(partesRefazer).toHaveBeenCalledWith([2], false);
  });

  it("enviar manda a mensagem com a lâmina em foco; sem foco, vai sobre o conjunto", async () => {
    mock.invoke.mockResolvedValue({ data: { resposta: "Pronto.", mudancas: [], avisos: [], custo_usd: 0.01 }, error: null });
    montar();
    const campo = await screen.findByLabelText("Mensagem ao diretor de arte");
    fireEvent.change(campo, { target: { value: "Deixe mais leve" } });
    fireEvent.click(screen.getByRole("button", { name: /^Enviar/ }));
    await waitFor(() => expect(chamadasDe("conversar")).toHaveLength(1));
    expect(chamadasDe("conversar")[0]).toEqual({ acao: "conversar", trabalho_id: TRABALHO, mensagem: "Deixe mais leve", ordem: 2 });

    fireEvent.click(screen.getByRole("button", { name: "Sobre a lâmina 2" }));
    fireEvent.change(campo, { target: { value: "E o conjunto?" } });
    fireEvent.click(screen.getByRole("button", { name: /^Enviar/ }));
    await waitFor(() => expect(chamadasDe("conversar")).toHaveLength(2));
    expect(chamadasDe("conversar")[1]).toEqual({ acao: "conversar", trabalho_id: TRABALHO, mensagem: "E o conjunto?" });
  });

  it("mudança já aplicada mostra Aplicada e só oferece refazer; trabalho entregue não aplica", async () => {
    mock.tabelas.agente_mensagens = [
      { id: MSG, papel: "agente", conteudo: "Feito.", anexos: [{ tipo: "mudancas", mudancas: [mudanca], avisos: ["A cor #00FF00 não está na paleta da marca e ficou de fora."], aplicadas: ["m1"] }], criado_em: "2026-09-24T10:00:01Z" },
    ];
    montar({ bloqueado: true });
    expect(await screen.findByText("Aplicada")).toBeTruthy();
    expect(screen.getByText(/não está na paleta da marca/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Aplicar$/ })).toBeNull();
    expect(screen.getByText(/Arte já entregue/)).toBeTruthy();
  });

  it("conversa vazia explica o que o diretor faz", async () => {
    mock.tabelas.agente_conversas = [];
    montar({ ordemEmFoco: null });
    expect(await screen.findByText("Converse com o diretor de arte")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Sobre a lâmina/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Mudar o cenário" })).toBeTruthy();
  });
});
