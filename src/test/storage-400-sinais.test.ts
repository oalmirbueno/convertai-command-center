import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { caminhosDeImagemDosAnexos } from "@/lib/mesa/imagensDosAnexos";
import {
  caminhoDaMedia,
  COPIA_AUSENTE_MS,
  copiaSabidamenteAusente,
  esquecerCopiasAusentes,
  lembrarCopiasAusentes,
  objetoNaoExiste,
  reduzidaSemTransformacao,
} from "../../supabase/functions/_shared/imagem-reduzida.ts";

/**
 * Log de produção (17/10, Storage do projeto jjjtkowvxemvituvywvf):
 * - 18x POST /object/sign/mesa/grande e 15x /object/sign/mesa/conversa, do
 *   navegador: o anexo "Método:" (metodo_usado) tem `caminho` com o rótulo do
 *   método e as conversas o tratavam como imagem;
 * - 111x GET mesa/<cliente>/marca/logo-...png.media.jpg e 53x
 *   perfis/.../*.jpg.media.jpg, das funções: a cópia média que nunca existe
 *   para original de até 2048 px, pedida de novo a cada geração.
 */
const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

describe("anexo Método não vira pedido de URL assinada", () => {
  const metodo = (caminho: string) => ({ tipo: "metodo_usado", ids: ["entender"], fonte: "injetado", caminho, prova: "ok", versao: "x" });

  it("rótulos do método ficam de fora e as imagens ficam, na ordem", () => {
    const anexos = [{ caminho: "cli/agente/a.png" }, metodo("grande"), metodo("conversa"), { proposta_id: "p1" }, { caminho: "cli/agente/b.jpg" }];
    expect(caminhosDeImagemDosAnexos(anexos)).toEqual(["cli/agente/a.png", "cli/agente/b.jpg"]);
  });

  it("nem rótulo solto sem pasta vira caminho (pequeno, viabilidade)", () => {
    expect(caminhosDeImagemDosAnexos([{ caminho: "pequeno" }, { caminho: "viabilidade" }, null, 3])).toEqual([]);
    expect(caminhosDeImagemDosAnexos(null)).toEqual([]);
  });

  it("Mesa Ads: caminho em texto só com aceitarTexto", () => {
    expect(caminhosDeImagemDosAnexos(["cli/ads/x.png", "grande", metodo("grande")], true)).toEqual(["cli/ads/x.png"]);
    expect(caminhosDeImagemDosAnexos(["cli/ads/x.png"])).toEqual([]);
  });

  it("as quatro conversas usam o filtro e não leem mais todo `caminho` como imagem", () => {
    for (const f of ["src/components/mesa/AgenteDoMes.tsx", "src/components/mesa/CampanhaAgente.tsx"]) {
      const s = ler(f);
      expect(s).toContain("const imagensDaMensagem = (m: MensagemDoAgente) => caminhosDeImagemDosAnexos(m.anexos);");
      expect(s).not.toContain('(a && a.caminho ? String(a.caminho) : "")');
    }
    for (const f of ["src/components/mesa-ads/AgenteDaOferta.tsx", "src/components/mesa-ads/ConversaDoPlano.tsx"]) {
      const s = ler(f);
      expect(s).toContain("const imagens = caminhosDeImagemDosAnexos(m.anexos, true);");
      expect(s).not.toContain("a && a.caminho ? String(a.caminho)");
    }
  });
});

/** PNG mínimo: assinatura + IHDR com largura e altura (o que o cabeçalho lê). */
function png(largura: number, altura: number): Uint8Array {
  const b = new Uint8Array(40);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  const v = new DataView(b.buffer);
  v.setUint32(16, largura);
  v.setUint32(20, altura);
  return b;
}

function bancoFalso(arquivos: Record<string, Uint8Array>, erroDaFalta: Record<string, unknown> = { message: "Object not found", statusCode: "404", status: 400 }) {
  const pedidos: string[] = [];
  const db = {
    storage: {
      from: (_bucket: string) => ({
        download: async (caminho: string) => {
          pedidos.push(caminho);
          const a = arquivos[caminho];
          // Blob do jsdom não tem arrayBuffer(): o mínimo que baixarBytes usa.
          return a ? { data: { size: a.byteLength, arrayBuffer: async () => a.slice().buffer }, error: null } : { data: null, error: erroDaFalta };
        },
      }),
    },
  };
  return { db: db as unknown as Parameters<typeof reduzidaSemTransformacao>[0], pedidos };
}

describe("cópia média que nunca existe não é pedida a cada geração", () => {
  const caminho = "cli/perfis/p1/post.jpg";
  beforeEach(() => esquecerCopiasAusentes("mesa", caminho));

  it("faltou e o original serviu: a próxima chamada vai direto ao original", async () => {
    const { db, pedidos } = bancoFalso({ [caminho]: png(1080, 1350) });
    const r1 = await reduzidaSemTransformacao(db, "mesa", caminho, 1080, 1350, { folga: 1.05 });
    expect(r1?.cabe).toBe(true);
    expect(pedidos).toEqual([caminhoDaMedia(caminho), caminho]);
    expect(copiaSabidamenteAusente("mesa", caminhoDaMedia(caminho))).toBe(true);

    pedidos.length = 0;
    const r2 = await reduzidaSemTransformacao(db, "mesa", caminho, 1080, 1350, { folga: 1.05 });
    expect(r2?.cabe).toBe(true);
    expect(r2?.origem).toBe("original");
    expect(pedidos).toEqual([caminho]);
  });

  it("a lembrança vence no prazo e esquecerCopiasAusentes apaga na hora", () => {
    const agora = 1_000_000;
    lembrarCopiasAusentes("mesa", [caminhoDaMedia(caminho)], agora);
    expect(copiaSabidamenteAusente("mesa", caminhoDaMedia(caminho), agora + 1)).toBe(true);
    expect(copiaSabidamenteAusente("mesa", caminhoDaMedia(caminho), agora + COPIA_AUSENTE_MS + 1)).toBe(false);
    lembrarCopiasAusentes("mesa", [caminhoDaMedia(caminho)]);
    esquecerCopiasAusentes("mesa", caminho);
    expect(copiaSabidamenteAusente("mesa", caminhoDaMedia(caminho))).toBe(false);
  });

  it("erro que não é 'não existe' (rede, prazo) não vira lembrança", async () => {
    const { db, pedidos } = bancoFalso({ [caminho]: png(1080, 1350) }, { message: "fetch failed" });
    await reduzidaSemTransformacao(db, "mesa", caminho, 1080, 1350, { folga: 1.05 });
    expect(copiaSabidamenteAusente("mesa", caminhoDaMedia(caminho))).toBe(false);
    pedidos.length = 0;
    await reduzidaSemTransformacao(db, "mesa", caminho, 1080, 1350, { folga: 1.05 });
    expect(pedidos[0]).toBe(caminhoDaMedia(caminho));
  });

  it("reconhece o 'não existe' do Storage", () => {
    expect(objetoNaoExiste({ message: "Object not found", statusCode: "404" })).toBe(true);
    expect(objetoNaoExiste({ message: "not_found" })).toBe(true);
    expect(objetoNaoExiste({ message: "fetch failed" })).toBe(false);
    expect(objetoNaoExiste(null)).toBe(false);
  });

  it("pedirCopiaLeve apaga a lembrança quando a copias-leves gravou", () => {
    const f = ler("supabase/functions/_shared/imagem-reduzida.ts");
    expect(f).toContain("if (r.ok) esquecerCopiasAusentes(bucket, caminho);");
  });
});
