import { beforeEach, describe, expect, it, vi } from "vitest";

// 10/11/2026: uma chamada de assinatura por arquivo esgotou as conexões do banco (painel parado às 12h29 e
// às 16h51). Os pedidos agora saem juntos, no máximo duas chamadas por vez.
const chamadas: Array<{ bucket: string; caminhos: string[] }> = [];
let soltar: Array<() => void> = [];
let falhar = false;
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: (bucket: string) => ({
        createSignedUrls: (caminhos: string[]) => {
          chamadas.push({ bucket, caminhos });
          return new Promise((ok) => {
            soltar.push(() => ok(falhar
              ? { data: null, error: new Error("fora do ar") }
              : { data: caminhos.map((p) => (p === "sem-acesso" ? { path: p, signedUrl: null, error: "Object not found" } : { path: p, signedUrl: `https://x/${bucket}/${p}?token=1` })), error: null }));
          });
        },
      }),
    },
  },
}));

import { __zerarAssinaturasEmLoteParaTeste, assinarCaminho, assinarCaminhos } from "@/lib/assinaturasEmLote";

const passo = () => new Promise((r) => setTimeout(r, 0));
const soltarTudo = async () => { while (soltar.length) { const s = soltar; soltar = []; s.forEach((f) => f()); await passo(); } };

describe("assinatura de arquivos em lote", () => {
  beforeEach(() => { chamadas.length = 0; soltar = []; falhar = false; __zerarAssinaturasEmLoteParaTeste(); });

  it("300 arquivos pedidos no mesmo instante viram 3 chamadas, nunca mais de 2 ao mesmo tempo", async () => {
    const pedidos = Array.from({ length: 300 }, (_, i) => assinarCaminho("files", `a/${i}.png`));
    await passo();
    expect(chamadas.length).toBe(2);
    expect(chamadas[0].caminhos.length).toBe(100);
    await soltarTudo();
    const linhas = await Promise.all(pedidos);
    expect(chamadas.length).toBe(3);
    expect(linhas[299].signedUrl).toBe("https://x/files/a/299.png?token=1");
  });

  it("o mesmo arquivo pedido várias vezes entra uma vez só e todos recebem a mesma URL", async () => {
    const pedidos = [assinarCaminho("files", "a.png"), assinarCaminho("files", "a.png"), assinarCaminho("files", "b.png")];
    await passo();
    expect(chamadas).toEqual([{ bucket: "files", caminhos: ["a.png", "b.png"] }]);
    await soltarTudo();
    const [a1, a2] = await Promise.all(pedidos);
    expect(a1.signedUrl).toBe(a2.signedUrl);
  });

  it("buckets diferentes não se misturam e a ordem pedida é a ordem devolvida", async () => {
    const lote = assinarCaminhos("mesa", ["m/1.thumb.webp", "m/1.png"]);
    const outro = assinarCaminhos("workspace", ["w.pdf"]).then((l) => l[0]);
    await passo();
    expect(chamadas.map((c) => c.bucket).sort()).toEqual(["mesa", "workspace"]);
    await soltarTudo();
    expect((await lote).map((l) => l.path)).toEqual(["m/1.thumb.webp", "m/1.png"]);
    expect((await outro).signedUrl).toContain("/workspace/w.pdf");
  });

  it("arquivo sem acesso volta com erro sem derrubar os outros; chamada fora do ar rejeita todos", async () => {
    const pedidos = [assinarCaminho("files", "ok.png"), assinarCaminho("files", "sem-acesso")];
    await passo(); await soltarTudo();
    const [ok, ruim] = await Promise.all(pedidos);
    expect(ok.signedUrl).toBeTruthy();
    expect(ruim.signedUrl).toBeNull();
    expect(ruim.error).toBe("Object not found");
    falhar = true;
    const cai = assinarCaminhos("files", ["x.png", "y.png"]);
    await passo(); await soltarTudo();
    await expect(cai).rejects.toThrow("fora do ar");
  });

  it("quem chega enquanto um lote está no ar espera e vai junto no próximo", async () => {
    const a = assinarCaminhos("files", ["1.png"]);
    const b = assinarCaminhos("mesa", ["2.png"]);
    await passo();
    expect(chamadas.length).toBe(2);
    const tardios = [assinarCaminho("files", "3.png"), assinarCaminho("files", "4.png")];
    await passo();
    expect(chamadas.length).toBe(2);
    await soltarTudo();
    await Promise.all([a, b, ...tardios]);
    expect(chamadas[2]).toEqual({ bucket: "files", caminhos: ["3.png", "4.png"] });
  });
});
