import { afterEach, describe, expect, it, vi } from "vitest";
import { apiDoAmbiente, producaoNaVercel, previaNaVercel } from "../../workers/motor-codigo/lib/vercel.ts";
import { vercelFalsa } from "./vercel-falsa";

/**
 * Conta de time na Vercel da agência (19/10/2026): com VERCEL_TEAM_ID no
 * ambiente do worker (o supervisor repassa do cofre), toda chamada leva
 * ?teamId=; sem ela, nenhuma leva e nada muda.
 */

const TOKEN = "vcp_tokenfalsodotime_0123456789abcdef";
const arquivos = [{ caminho: "index.html", bytes: new Uint8Array(Buffer.from("<h1>oi</h1>")), sha: "a".repeat(40) }];
const esperar = async () => undefined;

afterEach(() => vi.unstubAllEnvs());

describe("vercel.ts: teamId da conta de time", () => {
  it("com VERCEL_TEAM_ID, prévia e publicação mandam teamId em todas as chamadas", async () => {
    vi.stubEnv("VERCEL_TOKEN", TOKEN);
    vi.stubEnv("VERCEL_TEAM_ID", " team_agencia ");
    const v = vercelFalsa({ token: TOKEN, dominio: "cafe.com.br" });
    const api = apiDoAmbiente(v.fetch)!;
    expect(api).not.toBeNull();
    await previaNaVercel(api, { projeto: "cafe", commit: "abc1234", ramo: "main", arquivos, esperar });
    await producaoNaVercel(api, { projeto: "cafe", commit: "abc1234", arquivos, dominio: "cafe.com.br", esperar });
    expect(v.chamadas.length).toBeGreaterThan(4);
    for (const c of v.chamadas) {
      expect(new URL(c.url).searchParams.get("teamId"), c.url).toBe("team_agencia");
      expect(c.url.indexOf(TOKEN)).toBe(-1);
    }
  });

  it("sem VERCEL_TEAM_ID (ou vazia), nenhuma chamada leva teamId", async () => {
    vi.stubEnv("VERCEL_TOKEN", TOKEN);
    for (const time of ["", "   "]) {
      vi.stubEnv("VERCEL_TEAM_ID", time);
      const v = vercelFalsa({ token: TOKEN });
      await previaNaVercel(apiDoAmbiente(v.fetch)!, { projeto: "cafe", commit: "abc1234", ramo: "main", arquivos, esperar });
      expect(v.chamadas.length).toBeGreaterThan(0);
      expect(v.chamadas.every((c) => c.url.indexOf("teamId") < 0)).toBe(true);
    }
  });
});
