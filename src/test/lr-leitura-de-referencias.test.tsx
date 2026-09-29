import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente LR (29/09): "Ler as pendentes (12)" do Rd Ar girava, dizia "Custo
 * real: US$ 0,00" e não lia nada. Causa: um PNG cortado no envio (96 KB sem o
 * fim) no meio das 12 imagens de uma chamada só; o provedor recusava o pedido
 * inteiro (400 "does not represent a valid image") e o montar engolia o erro
 * em `{ lidas: 0, custo: 0 }`. Estes testes provam a leitura em lotes, o
 * arquivo quebrado fora da fila com motivo e a resposta que sinaliza a falha.
 */

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: vi.fn() }, rpc: vi.fn(), from: vi.fn(), storage: { from: vi.fn() } },
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
vi.mock("sonner", () => ({ toast: toasts }));

import {
  camposDaLeitura,
  defeitoDaImagem,
  dividirEmLotes,
  lerEmLotes,
  MAX_BASE64_POR_LOTE,
  MAX_IMAGENS_POR_LOTE,
  type DependenciasDaLeitura,
  type LeituraDoModelo,
} from "../../supabase/functions/agente-contexto/leitura-em-lotes";
import { BotaoComCusto, situacaoDaResposta } from "@/components/mesa/Custo";
import { MesaProvider, type MesaValor } from "@/components/mesa/MesaContexto";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

// ------------------------------------------------------------ imagens sintéticas

const PNG_ASSINATURA = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** PNG "inteiro" (assinatura, IHDR fictício, enchimento e IEND + CRC). */
function png(tamanho = 200, inteiro = true): Uint8Array {
  const b = new Uint8Array(tamanho);
  b.set(PNG_ASSINATURA, 0);
  b.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8);
  if (inteiro) b.set([0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82], tamanho - 12);
  return b;
}
function jpeg(tamanho = 200, inteiro = true): Uint8Array {
  const b = new Uint8Array(tamanho);
  b.set([0xff, 0xd8, 0xff, 0xe0], 0);
  if (inteiro) b.set([0xff, 0xd9], tamanho - 2);
  return b;
}
function webp(tamanho = 200, declarado = tamanho - 8): Uint8Array {
  const b = new Uint8Array(tamanho);
  b.set([0x52, 0x49, 0x46, 0x46], 0);
  b[4] = declarado & 0xff;
  b[5] = (declarado >> 8) & 0xff;
  b[6] = (declarado >> 16) & 0xff;
  b[7] = (declarado >> 24) & 0xff;
  b.set([0x57, 0x45, 0x42, 0x50], 8);
  return b;
}

/** Bytes "grandes" sem alocar: só o byteLength importa para os lotes. */
const deTamanho = (n: number) => ({ byteLength: n }) as unknown as Uint8Array;

type Item = { id: string; imagem: { bytes: Uint8Array } };
const item = (id: string, bytes: Uint8Array = png()) => ({ id, imagem: { bytes } });

/** Erro do provedor no formato do motor (IaMotorErro), sem importar o Deno. */
class ErroFalso extends Error {
  constructor(public codigo: string, mensagem: string, public detalhes: Record<string, unknown> = {}) {
    super(mensagem);
  }
}

function deps(over: Partial<DependenciasDaLeitura<Item>> = {}) {
  const gravadas: string[] = [];
  const invalidas: { id: string; motivo: string }[] = [];
  const chamadas: string[][] = [];
  const log = vi.fn();
  const d: DependenciasDaLeitura<Item> = {
    lerLote: async (lote) => {
      chamadas.push(lote.map((i) => i.id));
      return { leituras: lote.map((_, i): LeituraDoModelo => ({ imagem: i + 1, tecnica: `técnica ${i + 1}`, tags: ["Grid"] })), custo: 0.001 };
    },
    gravar: async (i) => {
      gravadas.push(i.id);
      return true;
    },
    marcarInvalida: async (i, motivo) => {
      invalidas.push({ id: i.id, motivo });
    },
    erroQueParaTudo: (e) => e instanceof ErroFalso && e.codigo === "saldo_insuficiente",
    recusouImagem: (e) => e instanceof ErroFalso && e.codigo === "provedor_erro" && Number(e.detalhes.status_provedor) === 400 && /image/i.test(e.message),
    descrever: (e) => (e as Error).message,
    log,
    ...over,
  };
  return { d, gravadas, invalidas, chamadas, log };
}

// ------------------------------------------------------------ formato inválido

describe("arquivo quebrado é pego antes de gastar", () => {
  it("PNG sem o fim (o do Rd Ar: 98.304 bytes, sem IEND) é png_truncado; o inteiro passa", () => {
    expect(defeitoDaImagem(png(98_304, false))).toBe("png_truncado");
    expect(defeitoDaImagem(png(98_304, true))).toBeNull();
  });

  it("JPEG sem FF D9, WebP menor que o declarado, GIF e vazio têm motivo", () => {
    expect(defeitoDaImagem(jpeg(500, false))).toBe("jpeg_truncado");
    expect(defeitoDaImagem(jpeg(500, true))).toBeNull();
    expect(defeitoDaImagem(webp(500, 900))).toBe("webp_truncado");
    expect(defeitoDaImagem(webp(500))).toBeNull();
    const gif = new Uint8Array(100);
    gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
    expect(defeitoDaImagem(gif)).toBe("formato_nao_suportado");
    expect(defeitoDaImagem(new Uint8Array(0))).toBe("arquivo_vazio");
    expect(defeitoDaImagem(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>"))).toBe("formato_nao_suportado");
  });

  it("arquivo acima do teto é grande_demais", () => {
    expect(defeitoDaImagem(png(2000), 1000)).toBe("grande_demais");
  });
});

// ------------------------------------------------------------ lote grande

describe("lote grande se divide em pedaços que cabem no teto", () => {
  it("12 imagens de 2 MB viram 3 lotes de 4", () => {
    const itens = Array.from({ length: 12 }, (_, i) => item(`r${i}`, deTamanho(2 * 1024 * 1024)));
    const lotes = dividirEmLotes(itens);
    expect(lotes.map((l) => l.length)).toEqual([4, 4, 4]);
    expect(MAX_IMAGENS_POR_LOTE).toBe(4);
  });

  it("imagens pesadas: nenhum lote passa de 12 MB em base64 (uma sozinha sempre vai)", () => {
    const itens = [5, 5, 5, 1, 20].map((mb, i) => item(`r${i}`, deTamanho(mb * 1024 * 1024)));
    const lotes = dividirEmLotes(itens);
    expect(lotes.map((l) => l.map((i) => i.id))).toEqual([["r0"], ["r1"], ["r2", "r3"], ["r4"]]);
    for (const l of lotes.filter((l) => l.length > 1)) {
      const b64 = l.reduce((s, i) => s + Math.ceil(i.imagem.bytes.byteLength / 3) * 4, 0);
      expect(b64).toBeLessThanOrEqual(MAX_BASE64_POR_LOTE);
    }
  });

  it("lerEmLotes lê as 12 em 3 chamadas e grava todas", async () => {
    const { d, gravadas, chamadas } = deps();
    const itens = Array.from({ length: 12 }, (_, i) => item(`r${i}`));
    const r = await lerEmLotes(itens, d);
    expect(chamadas.length).toBe(3);
    expect(r.lidas).toBe(12);
    expect(gravadas.length).toBe(12);
    expect(r.falharam).toEqual([]);
    expect(r.motivo).toBeNull();
    expect(r.custo).toBeCloseTo(0.003);
  });
});

// ------------------------------------------------------------ leitura falhando

describe("leitura falhando nunca termina em silêncio", () => {
  it("provedor recusa o lote por imagem inválida: lê uma por uma, tira só a quebrada da fila", async () => {
    const { d, gravadas, invalidas, chamadas, log } = deps({
      lerLote: async (lote) => {
        chamadas.push(lote.map((i) => i.id));
        if (lote.some((i) => i.id === "ruim")) {
          throw new ErroFalso("provedor_erro", "openrouter respondeu 400: Provider returned error (The image data you provided does not represent a valid image.)", { status_provedor: 400 });
        }
        return { leituras: lote.map((_, i) => ({ imagem: i + 1, tecnica: "ok", tags: [] })), custo: 0.001 };
      },
    });
    const r = await lerEmLotes([item("a"), item("ruim"), item("b"), item("c"), item("d")], d);
    expect(chamadas[0]).toEqual(["a", "ruim", "b", "c"]);
    expect(chamadas).toContainEqual(["ruim"]);
    expect(gravadas.sort()).toEqual(["a", "b", "c", "d"]);
    expect(invalidas).toEqual([{ id: "ruim", motivo: "imagem_recusada" }]);
    expect(r.lidas).toBe(4);
    expect(r.falharam).toEqual([{ id: "ruim", motivo: "o provedor de IA recusou a imagem como inválida" }]);
    expect(r.motivo).toContain("1 referência não foi lida");
    expect(log).toHaveBeenCalled();
  });

  it("erro qualquer do provedor: as do lote falham com o motivo e os outros lotes seguem", async () => {
    let n = 0;
    const { d, log } = deps({
      lerLote: async (lote) => {
        n++;
        if (n === 1) throw new ErroFalso("provedor_timeout", "O provedor openrouter nao respondeu em 120 s.");
        return { leituras: lote.map((_, i) => ({ imagem: i + 1, tecnica: "ok", tags: [] })), custo: 0.001 };
      },
      paralelos: 1,
    });
    const r = await lerEmLotes(Array.from({ length: 6 }, (_, i) => item(`r${i}`)), d);
    expect(r.lidas).toBe(2);
    expect(r.falharam.length).toBe(4);
    expect(r.falharam[0].motivo).toContain("nao respondeu em 120 s");
    expect(r.motivo).toContain("4 referências não foram lidas");
    expect(log).toHaveBeenCalledWith("agente-contexto: lote de leitura falhou", expect.anything());
  });

  it("saldo insuficiente para tudo e volta em erroQueParou (a resposta vira 402)", async () => {
    const { d } = deps({
      lerLote: async () => {
        throw new ErroFalso("saldo_insuficiente", "Saldo insuficiente na carteira de IA do cliente.");
      },
      paralelos: 1,
    });
    const r = await lerEmLotes(Array.from({ length: 8 }, (_, i) => item(`r${i}`)), d);
    expect(r.lidas).toBe(0);
    expect(r.erroQueParou).toBeInstanceOf(ErroFalso);
    expect(r.restantes).toBe(8);
    expect(r.motivo).toContain("Saldo insuficiente");
  });

  it("o leitor devolve menos leituras que imagens: as que faltam falham com motivo", async () => {
    const { d } = deps({ lerLote: async () => ({ leituras: [{ imagem: 1, tecnica: "ok", tags: [] }], custo: 0.001 }) });
    const r = await lerEmLotes([item("a"), item("b")], d);
    expect(r.lidas).toBe(1);
    expect(r.falharam).toEqual([{ id: "b", motivo: "o leitor não devolveu a leitura desta imagem" }]);
  });

  it("tempo com teto: o que não coube fica em restantes, com o motivo", async () => {
    let t = 0;
    const { d } = deps({
      agora: () => t,
      prazoMs: 1000,
      paralelos: 1,
      lerLote: async (lote) => {
        t += 800;
        return { leituras: lote.map((_, i) => ({ imagem: i + 1, tecnica: "ok", tags: [] })), custo: 0 };
      },
    });
    const r = await lerEmLotes(Array.from({ length: 12 }, (_, i) => item(`r${i}`)), d);
    expect(r.lidas).toBe(8);
    expect(r.restantes).toBe(4);
    expect(r.motivo).toContain("4 ficaram para a próxima leitura (o tempo da chamada acabou)");
  });
});

// ------------------------------------------------------------ resposta do montar

describe("resposta do montar sinaliza a falha", () => {
  it("nada lido com falha: falhou + motivo; montagem feita: vira parcial; tudo lido: sem falha", () => {
    const falha = { tentadas: 12, lidas: 0, custo: 0, falharam: [{ id: "x", motivo: "o PNG está cortado (o envio não terminou)" }], restantes: 0, motivo: "1 referência saiu da fila (o PNG está cortado)." };
    expect(camposDaLeitura(falha)).toMatchObject({ falhou: true, referencias_lidas: 0, referencias_falharam: 1, motivo: falha.motivo });
    expect(camposDaLeitura(falha, { principalFeito: true })).toMatchObject({ parcial: true, motivo: falha.motivo });
    expect(camposDaLeitura(falha, { principalFeito: true })).not.toHaveProperty("falhou");
    const ok = camposDaLeitura({ tentadas: 4, lidas: 4, custo: 0.01, falharam: [], restantes: 0, motivo: null });
    expect(ok).not.toHaveProperty("falhou");
    expect(ok).not.toHaveProperty("parcial");
    const nadaPendente = camposDaLeitura({ tentadas: 0, lidas: 0, custo: 0, falharam: [], restantes: 0, motivo: null });
    expect(nadaPendente).not.toHaveProperty("falhou");
  });

  it("montar não engole mais o erro da leitura e não deixa promise sem handler", () => {
    const f = ler("supabase/functions/agente-contexto/index.ts");
    const i = f.indexOf("async function montar(");
    const corpo = f.slice(i, f.indexOf("\n}\n", i));
    expect(corpo).not.toContain("return { lidas: 0, custo: 0 }");
    expect(corpo).not.toMatch(/\.catch\(\(\) => null\)/);
    expect(corpo).toContain("const leituraEmCurso: Promise<ResultadoDaLeitura> = lerReferenciasPendentes(ch, clientId);");
    expect(corpo).toContain("if (leitura.erroQueParou && leitura.lidas === 0) throw leitura.erroQueParou;");
    expect(corpo).toContain("...camposDaLeitura(leitura, { principalFeito: true })");
    const ler2 = f.slice(f.indexOf("async function lerReferenciasPendentes("), f.indexOf("async function lerComOLeitor("));
    expect(ler2).toContain('console.error("agente-contexto: leitura das referências falhou"');
    expect(ler2).toContain("textoDoMotivo(s.motivo)");
  });

  it("a leitura usa cópia leve (copias-leves) e confere o original antes", () => {
    const f = ler("supabase/functions/agente-contexto/index.ts");
    const i = f.indexOf("async function imagemDaReferencia(");
    const corpo = f.slice(i, f.indexOf("\n}\n", i));
    expect(corpo.indexOf("defeitoDaImagem(original")).toBeGreaterThan(0);
    expect(corpo.indexOf("defeitoDaImagem(original")).toBeLessThan(corpo.indexOf("reduzidaSemTransformacao("));
    expect(corpo).toContain("pedirCopia: true");
    expect(corpo).toContain("maxPixels: 700_000");
  });

  it("Atualizar contexto manda atualizar: true (antes caía no caminho sem novidade e não montava)", () => {
    const f = ler("src/components/mesa/ContextoAutomatico.tsx");
    expect(f).toContain('{ acao: "montar", client_id: clientId, ...(contextoMontado ? { atualizar: true } : {}) }');
  });

  it("o motor mostra o motivo real do OpenRouter (error.metadata.raw), não só 'Provider returned error'", () => {
    const f = ler("supabase/functions/_shared/ia-motor.ts");
    expect(f).toContain("corpo.error?.metadata?.raw");
  });
});

// ------------------------------------------------------------ tela

const valorDaMesa = (): MesaValor => ({
  clientId: "11111111-1111-1111-1111-111111111111",
  clientName: "Cliente sintético",
  userId: "u-1",
  isAdmin: true,
  podeRecarregar: true,
  saldoUsd: 10,
  catalogo: [
    { id: "x", provedor: "openai", modelo_api: "x", tipo: "texto", rotulo: "X", preco_entrada_1m: 1, preco_saida_1m: 1, preco_cache_1m: null, preco_imagem: null, raciocinio: [], padrao_para: [], ativo: true } as any,
  ],
  catalogoCarregando: false,
  atualizarCusto: vi.fn(),
  abrirRecarga: vi.fn(),
  abrirChaves: vi.fn(),
  abrirModelos: vi.fn(),
});

function botao(resposta: unknown) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <MesaProvider valor={valorDaMesa()}>
        <BotaoComCusto
          rotulo="Ler as pendentes"
          titulo="Ler as referências pendentes"
          partes={() => [{ modeloId: "x", tipo: "texto", tokensEntrada: 1000, tokensSaida: 1000 }]}
          executar={() => Promise.resolve(resposta)}
        />
      </MesaProvider>
    </QueryClientProvider>,
  );
}

describe("BotaoComCusto mostra o erro quando a resposta diz que falhou", () => {
  beforeEach(() => vi.clearAllMocks());

  it("situacaoDaResposta lê falhou, parcial e aviso_da_acao", () => {
    expect(situacaoDaResposta({ falhou: true, motivo: "PNG cortado" })).toEqual({ tipo: "falhou", texto: "PNG cortado" });
    expect(situacaoDaResposta({ parcial: true, motivo: "2 não lidas" })).toEqual({ tipo: "parcial", texto: "2 não lidas" });
    expect(situacaoDaResposta({ aviso_da_acao: "Nada novo" })).toEqual({ tipo: "aviso", texto: "Nada novo" });
    expect(situacaoDaResposta({ custo_usd: 0.01 })).toBeNull();
  });

  it("falhou: toast de erro com o motivo, nunca 'Custo real: US$ 0,00' de sucesso", async () => {
    botao({ falhou: true, motivo: "1 referência saiu da fila (o PNG está cortado).", referencias_lidas: 0, custo_usd: 0 });
    fireEvent.click(await screen.findByRole("button", { name: /Ler as pendentes/ }));
    await waitFor(() => expect(toasts.error).toHaveBeenCalledTimes(1));
    expect(toasts.error.mock.calls[0][0]).toContain("não concluído");
    expect(toasts.error.mock.calls[0][1].description).toContain("PNG está cortado");
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("parcial: alerta com o motivo e o custo", async () => {
    botao({ parcial: true, motivo: "2 referências não foram lidas.", referencias_lidas: 10, custo_usd: 0.004 });
    fireEvent.click(await screen.findByRole("button", { name: /Ler as pendentes/ }));
    await waitFor(() => expect(toasts.warning).toHaveBeenCalledTimes(1));
    expect(toasts.warning.mock.calls[0][1].description).toContain("2 referências não foram lidas.");
    expect(toasts.success).not.toHaveBeenCalled();
  });

  it("deu certo: continua o sucesso com o custo real", async () => {
    botao({ referencias_lidas: 12, custo_usd: 0.004 });
    fireEvent.click(await screen.findByRole("button", { name: /Ler as pendentes/ }));
    await waitFor(() => expect(toasts.success).toHaveBeenCalledTimes(1));
    expect(toasts.error).not.toHaveBeenCalled();
  });
});
