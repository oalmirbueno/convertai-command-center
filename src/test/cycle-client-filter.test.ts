import { describe, expect, it } from "vitest";
import { hasService, isInternalClient } from "@/lib/clientFlags";

/**
 * Cada frente do Ciclo mostra só quem contratou aquele serviço. Antes as duas
 * abas listavam a carteira inteira, e cliente sem tráfego aparecia no ciclo
 * de tráfego pedindo etapas que não existem para ele.
 */
describe("recorte de clientes por frente do Ciclo", () => {
  const carteira = [
    { id: "acerbi", services_config: { social: true, trafego: true } },
    { id: "vifut", services_config: { social: false, videos_ia: true } },
    { id: "so-social", services_config: { social: true } },
    { id: "interna", services_config: { internal_company: true, social: true, trafego: true } },
    { id: "sem-config", services_config: null },
  ];

  const daFrente = (area: "social" | "trafego") =>
    carteira.filter((client) => !isInternalClient(client) && hasService(client, area)).map((c) => c.id);

  it("tráfego lista apenas quem tem tráfego no cadastro", () => {
    expect(daFrente("trafego")).toEqual(["acerbi"]);
  });

  it("social lista apenas quem tem social marcado", () => {
    expect(daFrente("social")).toEqual(["acerbi", "so-social"]);
  });

  it("serviço desmarcado não conta como contratado", () => {
    expect(hasService({ services_config: { social: false } }, "social")).toBe(false);
    expect(hasService({ services_config: {} }, "trafego")).toBe(false);
    expect(hasService({ services_config: null }, "social")).toBe(false);
    expect(hasService({}, "social")).toBe(false);
  });

  it("empresa do grupo fica fora das duas frentes", () => {
    expect(daFrente("social")).not.toContain("interna");
    expect(daFrente("trafego")).not.toContain("interna");
  });
});
