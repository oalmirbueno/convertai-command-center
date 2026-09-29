import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente OR (29/09): a tela do "Organizar" do Workspace. Prova o fluxo que a
 * pessoa vê: quanto custa, leitura com progresso, prévia em cartões com as
 * pastas e os nomes novos, tirar um item, mudar o nome da pasta, confirmar
 * (só o que ficou) e desfazer (volta com o registro guardado).
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke },
    storage: { from: () => ({ createSignedUrls: vi.fn(async () => ({ data: [] })), list: vi.fn(async () => ({ data: [] })) }) },
  },
}));
vi.mock("@/lib/miniaturas", () => ({ urlsLevesEmLote: vi.fn(async () => ({})) }));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

import OrganizadorInteligente from "@/components/workspace/OrganizadorInteligente";

const CLIENTE = "4dd691a7-d481-451f-800b-5e6b6fdc8721";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const candidatos = [1, 2, 3].map((n) => ({ id: id(n), nome: `IMG_${n}.png`, mime: "image/png", tamanho: 100 + n, duracao: null, storage_path: `c/IMG_${n}.png`, caminho: [], leitura: "imagem", situacao: null }));

const previa = {
  grupos: [
    {
      chave: "carrosseis/dicas",
      categoria: "carrosseis",
      caminho: ["Carrosséis", "Dicas de sofá"],
      ideia: "2 lâminas de \"Dicas de sofá\", na ordem da numeração da arte",
      itens: [
        { id: id(1), nome_atual: "IMG_1.png", nome_novo: "01 - capa.png", tipo: "carrossel", ordem: 1, motivo: "lâmina 1 de 2", duvida: null, situacao: null, storage_path: "c/IMG_1.png", mime: "image/png", ja_esta_aqui: false },
        { id: id(2), nome_atual: "IMG_2.png", nome_novo: "02 - Aspire.png", tipo: "carrossel", ordem: 2, motivo: "lâmina 2 de 2", duvida: null, situacao: "publicado", storage_path: "c/IMG_2.png", mime: "image/png", ja_esta_aqui: false },
      ],
    },
    {
      chave: "posts",
      categoria: "posts",
      caminho: ["Posts"],
      ideia: "artes únicas de feed",
      itens: [{ id: id(3), nome_atual: "IMG_3.png", nome_novo: "Promoção.png", tipo: "post", ordem: null, motivo: "arte única", duvida: "tipo em dúvida", situacao: null, storage_path: "c/IMG_3.png", mime: "image/png", ja_esta_aqui: false }],
    },
  ],
  ficam: [],
  duvidas: 1,
  ja_organizados: 0,
  duplicadas: 0,
  resumo: "3 arquivos organizados em 2 pastas, 1 carrossel.",
  decisoes_do_jev: 2,
};

const registro = { versao: 1, client_id: CLIENTE, parent_id: null, feito_em: "2026-09-29T12:00:00Z", itens: [{ id: id(1), antes: { parent_id: null, name: "IMG_1.png", sort_index: 0 }, depois: { parent_id: id(90), name: "01 - capa.png", sort_index: 1 } }], pastas_criadas: [id(90)] };

function responder() {
  invoke.mockImplementation(async (_nome: string, { body }: { body: any }) => {
    switch (body.acao) {
      case "preparar":
        return { data: { candidatos, imagens: 3, videos: 0, outros: 0, estimativa_usd: 0.0015, por_imagem_usd: 0.0005, modelo: "GPT Luna", max_por_chamada: 8 }, error: null };
      case "ler":
        return { data: { lidos: body.itens.map((i: any) => ({ id: i.id, leitura: { tipo: "post", confianca: 0.9, tema: "x", texto: "", descricao: "", identidade: "", paleta: [], numero: null, total: null, capa: false, fechamento: false, objeto: "" }, hash: "h", largura: 1080, altura: 1350 })), falhas: [], restantes: [], custo_usd: 0.0012, parou: null }, error: null };
      case "propor":
        return { data: { previa, custo_jev_usd: 0.00002, aviso: null, parent_id: null, tudo: false }, error: null };
      case "confirmar":
        return { data: { registro, movidos: 2, renomeados: 2, pastas_criadas: 2, falhas: [] }, error: null };
      case "desfazer":
        return { data: { restaurados: 2, pulados: [], pastas_tiradas: 2, pastas_mantidas: 0 }, error: null };
      default:
        return { data: { error: "acao_desconhecida" }, error: null };
    }
  });
}

describe("tela do Organizar", () => {
  beforeEach(() => {
    invoke.mockReset();
    window.localStorage.clear();
    Object.values(toasts).forEach((f) => f.mockReset());
    responder();
  });

  it("mostra o custo, lê, monta a prévia em cartões, deixa tirar item e renomear pasta, confirma só o que ficou e desfaz", async () => {
    const onMudou = vi.fn();
    render(<OrganizadorInteligente aberto onFechar={vi.fn()} clientId={CLIENTE} parentId={null} nivelNome="a raiz do cliente" onMudou={onMudou} />);

    // Início: quanto entra e quanto custa, antes de gastar.
    expect(await screen.findByText(/3 imagens, 0 vídeos/)).toBeTruthy();
    const ler = screen.getByRole("button", { name: /Ler e montar a prévia/ });
    expect(ler.textContent).toContain("US$");
    fireEvent.click(ler);

    // Prévia: pastas com o caminho, a ideia e os nomes novos.
    expect(await screen.findByText("Dicas de sofá")).toBeTruthy();
    expect(screen.getByText("Carrosséis /")).toBeTruthy();
    expect(screen.getByText("01 - capa.png")).toBeTruthy();
    expect(screen.getByText("publicado")).toBeTruthy();
    expect(screen.getByText(/dúvida: tipo em dúvida/)).toBeTruthy();
    expect(screen.getByText(/Custo real/)).toBeTruthy();
    expect(invoke.mock.calls.filter((c) => c[1].body.acao === "ler")).toHaveLength(1);

    // Tira o post e muda o nome da pasta do carrossel.
    fireEvent.click(screen.getByRole("button", { name: "Tirar IMG_3.png desta pasta (fica onde está)" }));
    fireEvent.click(screen.getByRole("button", { name: "Mudar o nome da pasta Dicas de sofá" }));
    const campo = screen.getByLabelText("Nome da pasta");
    fireEvent.change(campo, { target: { value: "Sofá limpo" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar nome da pasta" }));

    const confirmar = screen.getByRole("button", { name: /Confirmar 2 arquivos/ });
    fireEvent.click(confirmar);
    await waitFor(() => expect(invoke.mock.calls.some((c) => c[1].body.acao === "confirmar")).toBe(true));
    const corpo = invoke.mock.calls.find((c) => c[1].body.acao === "confirmar")![1].body;
    expect(corpo.grupos).toEqual([{ caminho: ["Carrosséis", "Sofá limpo"], itens: [{ id: id(1), nome: "01 - capa.png", ordem: 1 }, { id: id(2), nome: "02 - Aspire.png", ordem: 2 }] }]);
    expect(await screen.findByText(/2 arquivos movidos/)).toBeTruthy();
    expect(onMudou).toHaveBeenCalled();

    // O Desfazer fica guardado e volta pelo registro.
    expect(window.localStorage.getItem(`workspace-organizar:desfazer:v1:${CLIENTE}`)).toContain("01 - capa.png");
    fireEvent.click(screen.getByRole("button", { name: /Desfazer/ }));
    await waitFor(() => expect(invoke.mock.calls.some((c) => c[1].body.acao === "desfazer")).toBe(true));
    expect(invoke.mock.calls.find((c) => c[1].body.acao === "desfazer")![1].body.registro).toEqual(registro);
    await waitFor(() => expect(toasts.success).toHaveBeenCalled());
    expect(window.localStorage.getItem(`workspace-organizar:desfazer:v1:${CLIENTE}`)).toBeNull();
  });

  it("leitura já paga fica guardada: abrir de novo não lê de novo", async () => {
    const { unmount } = render(<OrganizadorInteligente aberto onFechar={vi.fn()} clientId={CLIENTE} parentId={null} nivelNome="raiz" onMudou={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Ler e montar a prévia/ }));
    await screen.findByText("Dicas de sofá");
    unmount();
    invoke.mockClear();
    render(<OrganizadorInteligente aberto onFechar={vi.fn()} clientId={CLIENTE} parentId={null} nivelNome="raiz" onMudou={vi.fn()} />);
    const montar = await screen.findByRole("button", { name: "Montar a prévia" });
    expect(screen.getByText(/3 já lidas antes, sem custo/)).toBeTruthy();
    fireEvent.click(montar);
    await screen.findByText("Dicas de sofá");
    expect(invoke.mock.calls.some((c) => c[1].body.acao === "ler")).toBe(false);
    const propor = invoke.mock.calls.find((c) => c[1].body.acao === "propor")![1].body;
    expect(Object.keys(propor.lidos)).toHaveLength(3);
  });

  it("Parar interrompe a leitura e a prévia sai com o que já foi lido", async () => {
    const muitos = Array.from({ length: 20 }, (_, i) => ({ ...candidatos[0], id: id(100 + i), nome: `IMG_${100 + i}.png`, storage_path: `c/${i}.png` }));
    let soltar: () => void = () => {};
    invoke.mockImplementation(async (_n: string, { body }: { body: any }) => {
      if (body.acao === "preparar") return { data: { candidatos: muitos, imagens: 20, videos: 0, outros: 0, estimativa_usd: 0.01, por_imagem_usd: 0.0005, modelo: "m", max_por_chamada: 8 }, error: null };
      if (body.acao === "ler") {
        await new Promise<void>((ok) => (soltar = ok));
        return { data: { lidos: [], falhas: [], restantes: [], custo_usd: 0.001, parou: null }, error: null };
      }
      if (body.acao === "propor") return { data: { previa: { ...previa, grupos: [] }, custo_jev_usd: 0, aviso: null }, error: null };
      return { data: {}, error: null };
    });
    render(<OrganizadorInteligente aberto onFechar={vi.fn()} clientId={CLIENTE} parentId={null} nivelNome="raiz" onMudou={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Ler e montar a prévia/ }));
    expect(await screen.findByText(/Lendo as imagens: 0 de 20/)).toBeTruthy();
    await waitFor(() => expect(invoke.mock.calls.some((c) => c[1].body.acao === "ler")).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: /Parar/ }));
    soltar();
    expect(await screen.findByText(/Leitura parada/)).toBeTruthy();
    expect(invoke.mock.calls.filter((c) => c[1].body.acao === "ler")).toHaveLength(1);
  });

  it("o Workspace abre o organizador pelo menu e pelo endereço do agente (?organizar=1)", () => {
    const ws = readFileSync(resolve(process.cwd(), "src/pages/Workspace.tsx"), "utf8");
    expect(ws).toContain("<OrganizadorInteligente");
    expect(ws).toContain('parametros.get("organizar") === "1"');
  });
});
