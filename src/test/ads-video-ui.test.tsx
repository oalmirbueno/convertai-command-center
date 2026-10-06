import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, it, vi } from "vitest";
import type { CriativoAds } from "@/components/mesa-ads/adsApi";
const mock = vi.hoisted(() => ({ enviar: vi.fn(), estado: "pronto", uid: 0, success: vi.fn() }));
vi.mock("@/components/mesa/MesaContexto", () => ({ useMesa: () => ({ clientId: "cliente", clientName: "Marca", userId: "user", atualizarCusto: vi.fn(), abrirChaves: vi.fn() }) }));
vi.mock("@/components/sistema/useEstadoDaTela", () => ({ useEstadoDaTela: (_: string, inicial: unknown) => useState(inicial) }));
vi.mock("@/components/mesa/BancadaDaPauta", () => ({ PreviaDaPauta: () => <div>Prévia</div> }));
vi.mock("@/components/mesa-foto/fotoApi", () => ({ useFotos: () => ({ data: [] }) }));
vi.mock("@/components/mesa-videos/videosApi", () => ({ chamarMesaVideos: mock.enviar, chaveDosPedidos: () => ["pedidos"], useArquivosDeVideo: () => ({ data: { arquivos: [] } }), usePedidos: () => ({ data: { itens: [] } }) }));
vi.mock("@/lib/mesa-videos/api", () => ({ novoUid: () => `uid-${++mock.uid}`, custoNaTela: () => ({ usd: 2.77 }), useMotoresDaMesa: () => ({ lista: [{ motor: { id: "higgsfield-cinema-4" }, estado: mock.estado, estado_rotulo: "Precisa de chave" }], recarregar: vi.fn() }) }));
vi.mock("@/components/mesa-videos/GeracoesRecentes", () => ({ default: ({ criativoId }: { criativoId: string }) => <div>Histórico {criativoId}</div> }));
vi.mock("@/components/mesa-videos/PecasDoGerador", () => ({ EscolherImagem: () => <div>Referência</div>, BotaoDeGerar: ({ motivo, onConfirmar }: { motivo: string; onConfirmar: (n: number) => Promise<void> }) => <button disabled={!!motivo} onClick={() => void onConfirmar(2.77).catch(() => undefined)}>Gerar vídeo</button> }));
vi.mock("sonner", () => ({ toast: { success: mock.success, error: vi.fn() } }));
import VideoDoCriativo from "@/components/mesa-ads/VideoDoCriativo";
const criativo = { id: "criativo-1", client_id: "cliente", nome: "Produto real", copy: { texto_principal: "Oferta real" } } as CriativoAds;
function abrir() { return render(<QueryClientProvider client={new QueryClient()}><VideoDoCriativo criativo={criativo} referencia="cliente/base.png" /></QueryClientProvider>); }
beforeEach(() => { mock.enviar.mockReset(); mock.success.mockReset(); mock.estado = "pronto"; mock.uid = 0; });
it("envia contexto, referência, custo e vínculo; não mistura a pauta com o criativo", async () => {
  mock.enviar.mockResolvedValue({ pedido_id: "pedido" }); abrir();
  fireEvent.change(screen.getByLabelText("Conceito"), { target: { value: "demonstracao" } });
  fireEvent.click(screen.getByRole("button", { name: "Gerar vídeo" }));
  await waitFor(() => expect(mock.enviar).toHaveBeenCalledTimes(1));
  expect(mock.enviar.mock.calls[0][0]).toMatchObject({ client_id: "cliente", ads_criativo_id: "criativo-1", motor: "higgsfield-cinema-4", referencias_paths: ["cliente/base.png"], custo_confirmado_usd: 2.77, camera: "tracking" });
  expect(mock.enviar.mock.calls[0][0].prompt).toContain("Oferta real");
  expect(mock.enviar.mock.calls[0][0]).not.toHaveProperty("task_id");
  expect(screen.getByText("Histórico criativo-1")).toBeInTheDocument();
});
it("reutiliza idempotência quando a resposta se perde, sem anunciar sucesso", async () => {
  mock.enviar.mockRejectedValue(new Error("rede")); abrir();
  fireEvent.click(screen.getByRole("button", { name: "Gerar vídeo" }));
  await waitFor(() => expect(mock.enviar).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: "Gerar vídeo" }));
  await waitFor(() => expect(mock.enviar).toHaveBeenCalledTimes(2));
  expect(mock.enviar.mock.calls[0][0].uid).toBe(mock.enviar.mock.calls[1][0].uid);
  expect(mock.success).not.toHaveBeenCalled();
});
it("não chama o provedor sem chave; mantém direção e áudio editáveis", () => {
  mock.estado = "precisa_chave"; abrir();
  expect(screen.getByRole("button", { name: "Gerar vídeo" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Câmera e áudio" }));
  fireEvent.click(screen.getByLabelText("Gerar áudio com o vídeo"));
  expect(screen.getByLabelText(/Narração sugerida/)).toBeInTheDocument();
  expect(mock.enviar).not.toHaveBeenCalled();
});
