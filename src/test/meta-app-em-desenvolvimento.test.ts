import { describe, expect, it } from "vitest";
import { motivoDoErroDaMeta, MOTIVO_APP_EM_DESENVOLVIMENTO } from "../../supabase/functions/mesa-ads/acoes-conta";

describe("anúncio recusado pelo app em modo de desenvolvimento (27/10, RD AR)", () => {
  it("o subcódigo 1885183 vira a instrução para pôr o app ao vivo", () => {
    const corpo = { error: { code: 100, error_subcode: 1885183, message: "Invalid parameter", error_user_msg: "O post do criativo dos anúncios foi criado por um app que está em modo de desenvolvimento." } };
    expect(motivoDoErroDaMeta(corpo, 400)).toBe(MOTIVO_APP_EM_DESENVOLVIMENTO);
    expect(MOTIVO_APP_EM_DESENVOLVIMENTO).toMatch(/Aceleriq Insights.*Ao vivo.*aceleriq\.com\/privacidade/);
  });
  it("também pela frase em inglês, sem subcódigo", () => {
    expect(motivoDoErroDaMeta({ error: { code: 100, message: "Ads creative post was created by an app that is in development mode" } }, 400)).toBe(MOTIVO_APP_EM_DESENVOLVIMENTO);
  });
  it("os outros erros continuam iguais", () => {
    expect(motivoDoErroDaMeta({ error: { code: 190, message: "x" } }, 400)).toMatch(/venceu/);
    expect(motivoDoErroDaMeta({ error: { code: 100, error_user_msg: "Orçamento baixo" } }, 400)).toBe("A Meta recusou: Orçamento baixo");
  });
});
