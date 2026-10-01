// @vitest-environment jsdom
import { createElement as h } from "react";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

/**
 * Frente MTR, rodada 2: "Conferir de novo" nas Gerações da Mesa Vídeos.
 * O pedido de 28/09 (troca de ângulo que venceu o prazo com a tela fechada)
 * ganha o botão; erro do provedor e cancelado não ganham. O toque chama
 * gerar_reconferir UMA vez (sem laço).
 */

const { chamar, pedidos } = vi.hoisted(() => ({ chamar: vi.fn(), pedidos: { itens: [] as unknown[] } }));
vi.mock("@/components/mesa/MesaContexto", () => ({ useMesa: () => ({ clientId: "c-1", atualizarCusto: vi.fn() }) }));
vi.mock("@/components/mesa/ContextoMiniatura", () => ({ MiniaturaDoStorage: () => null }));
vi.mock("@/lib/mesa-videos/quadros", () => ({ gravarMiniaturaDoVideo: vi.fn() }));
vi.mock("@/components/mesa-videos/videosApi", () => ({
  chamarMesaVideos: (...a: unknown[]) => chamar(...a),
  chaveDosArquivos: (c: string) => ["arquivos", c],
  chaveDosPedidos: (c: string) => ["pedidos", c],
  usePedidos: () => ({ data: pedidos }),
}));

import GeracoesRecentes from "@/components/mesa-videos/GeracoesRecentes";

const envio = (erro: string, extra: Record<string, unknown> = {}) => ({ n: 1, estado: "erro", erro, posicao: null, storage_path: null, custo_usd: null, request_id: "req-28-09", uso_id: null, arquivo_id: null, ...extra });
const pedido = (id: string, envios: unknown[]) => ({ id, tipo: "angulo", estado: "erro", executor: "qwen-angulos-2511", alvo: { titulo: id }, parametros: { prompt: "" }, custo_estimado: { usd: 0.03 }, resultado: { envios } });

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(h(QueryClientProvider, { client: qc }, h(GeracoesRecentes, { arquivos: [] })));
}

describe("Gerações: Conferir de novo (rodada 2)", () => {
  it("só o que venceu o prazo e ainda tem o pedido no provedor ganha o botão; o toque chama gerar_reconferir uma vez", async () => {
    pedidos.itens = [
      pedido("vencido", [envio("Passou do prazo de 10 min sem terminar. Nada foi cobrado.")]),
      pedido("recusado", [envio("conteúdo recusado")]),
      pedido("cancelado", [envio("Cancelado. Nada foi cobrado.")]),
    ];
    chamar.mockResolvedValue({ pedidos: [], reabertos: 1 });
    montar();
    const botoes = Array.from(document.querySelectorAll("button[aria-label^='Conferir de novo']"));
    expect(botoes.map((b) => b.getAttribute("aria-label"))).toEqual(["Conferir de novo vencido"]);
    fireEvent.click(botoes[0]);
    await waitFor(() => expect(chamar).toHaveBeenCalledWith({ acao: "gerar_reconferir", pedido_id: "vencido" }));
    expect(chamar).toHaveBeenCalledTimes(1);
  });
});
