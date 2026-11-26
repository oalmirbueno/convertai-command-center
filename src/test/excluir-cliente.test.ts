import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { nomeConfere } from "@/lib/clientes/excluirCliente";

describe("excluir cliente: conferência do nome", () => {
  it("aceita o nome sem diferenciar acento, caixa e espaços", () => {
    expect(nomeConfere("  para si   otica ", "Para Si Ótica")).toBe(true);
    expect(nomeConfere("Para Si Ótica", "Para Si Ótica")).toBe(true);
  });
  it("recusa nome parcial, vazio ou de outro cliente", () => {
    expect(nomeConfere("Para Si", "Para Si Ótica")).toBe(false);
    expect(nomeConfere("", "Para Si Ótica")).toBe(false);
    expect(nomeConfere("", "")).toBe(false);
    expect(nomeConfere("Stop", "Stop Informatica")).toBe(false);
  });
});
