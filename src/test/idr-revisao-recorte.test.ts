import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Frente IDR, revisão de 01/10. O que o revisor achou e o que mudou:
 * - franja nunca sai sozinha (Estúdio, selo, versões da logo): só na janela;
 * - a borda limpa do Tirar fundo (pro) é um passo à parte, depois do pago;
 * - a janela grava na resolução da logo (até 4096 px) e a conta vai ao worker;
 * - mockups: logo com fundo branco não vira caixa;
 * - Mesa Foto: a limpeza tem orçamento de tempo.
 */

const invocar = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invocar(...a) } } }));

import { contaDaLimpeza } from "@/lib/recorte/contaDaLimpeza";
import { AREA_MAXIMA, escalaQueCabe, LADO_MAXIMO, limparForaDaTela } from "@/lib/recorte/limpezaDaLogo";
import { tirarFundoPro } from "@/components/ferramentas/ferramentasApi";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");

type Rgb = [number, number, number];
/** Logo de teste: disco azul com um quadrado branco dentro (branco cercado = desenho), sobre `fundo` (null = transparente). */
function logo(W: number, H: number, fundo: Rgb | null): Uint8ClampedArray {
  const d = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const dx = x + 0.5 - W / 2, dy = y + 0.5 - H / 2;
      const dentro = Math.hypot(dx, dy) < W / 3;
      const branco = Math.abs(dx) < W / 10 && Math.abs(dy) < H / 10;
      const c: Rgb | null = dentro ? (branco ? [255, 255, 255] : [20, 60, 170]) : fundo;
      if (!c) continue;
      d[i] = c[0];
      d[i + 1] = c[1];
      d[i + 2] = c[2];
      d[i + 3] = 255;
    }
  }
  return d;
}

describe("mockups: logo com fundo branco não vira caixa", () => {
  it("o fundo branco sai, o branco cercado pelo desenho fica e o desenho continua opaco", () => {
    const W = 120, H = 120;
    const data = logo(W, H, [255, 255, 255]);
    const r = contaDaLimpeza({ op: "mockup", data, largura: W, altura: H });
    expect(r.data).not.toBeNull();
    const a = (x: number, y: number) => r.data![(y * W + x) * 4 + 3];
    expect(a(2, 2)).toBe(0); // canto: era a caixa branca
    expect(a(W - 3, H - 3)).toBe(0);
    expect(a(60, 60)).toBe(255); // quadrado branco cercado pelo azul: desenho
    expect(a(60, 30)).toBe(255); // azul
  });

  it("PNG transparente e logo em fundo escuro ficam como vieram (nada muda sem prévia)", () => {
    expect(contaDaLimpeza({ op: "mockup", data: logo(80, 80, null), largura: 80, altura: 80 }).data).toBeNull();
    expect(contaDaLimpeza({ op: "mockup", data: logo(80, 80, [10, 10, 10]), largura: 80, altura: 80 }).data).toBeNull();
  });

  it("carregarLogos passa toda logo pelo recorte limpo antes de compor (kit e Identidade)", () => {
    const r = ler("src/lib/mockups/renderizar.ts");
    expect(r).toContain("const img = await logoSemCaixaBranca(await carregarImagem(onde.caminho, onde.bucket));");
    expect(r).toContain('limparForaDaTela({ op: "mockup"');
    expect(r).toContain("if (fundo.tipo !== \"solido\" || !fundo.claro) return img;");
  });
});

describe("janela Limpar fundo: resolução da logo e conta fora da tela", () => {
  const Original = (globalThis as { Worker?: unknown }).Worker;
  afterEach(() => {
    (globalThis as { Worker?: unknown }).Worker = Original;
  });

  it("até 4096 px e 12 MP a logo vai inteira; a de 7.813 px é reduzida (e a janela avisa)", () => {
    expect(LADO_MAXIMO).toBe(4096);
    expect(AREA_MAXIMA).toBe(12_000_000);
    expect(escalaQueCabe(1600, 900)).toBe(1);
    expect(escalaQueCabe(3000, 3000)).toBe(1);
    const e = escalaQueCabe(7813, 2000);
    expect(Math.round(7813 * e)).toBe(4096);
    const quadrada = escalaQueCabe(4000, 4000);
    expect(4000 * quadrada * 4000 * quadrada).toBeLessThanOrEqual(AREA_MAXIMA + 1);
    const tela = ler("src/components/mesa-identidade/RecorteDaLogo.tsx");
    expect(tela).toContain("data-reducao-da-logo");
    expect(tela).toContain("a versão limpa sai com");
    // Gravar: a da prévia quando ela já é a cheia (worker); senão, a conta inteira só em "Usar".
    expect(tela).toContain("if (!cheia) {");
    expect(tela).not.toContain("const LADO = 1600;");
  });

  it("sem worker, a mesma conta roda no fio principal e os pixels de entrada não mudam", async () => {
    (globalThis as { Worker?: unknown }).Worker = undefined;
    const data = logo(60, 60, [255, 255, 255]);
    const copia = new Uint8ClampedArray(data);
    const r = await limparForaDaTela({ op: "limpar", data, largura: 60, altura: 60, furos: "manter" });
    expect(r.diagnostico && r.diagnostico.precisa).toBe("fundo_solido");
    expect(Array.from(r.data!)).toEqual(Array.from(contaDaLimpeza({ op: "limpar", data: copia, largura: 60, altura: 60, furos: "manter" }).data!));
    expect(Array.from(data)).toEqual(Array.from(copia));
  });

  it("com worker, a conta vai para ele com os pixels transferidos (cópia) e volta o resultado", async () => {
    const recebidos: Array<{ msg: { id: number; op: string; data: Uint8ClampedArray }; transferir: unknown[] }> = [];
    class WorkerFalso {
      onmessage: ((e: { data: unknown }) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage(msg: { id: number; op: string; data: Uint8ClampedArray; largura: number; altura: number }, transferir: unknown[]) {
        recebidos.push({ msg, transferir });
        const r = contaDaLimpeza(msg as never);
        setTimeout(() => this.onmessage && this.onmessage({ data: { id: msg.id, ...r } }), 0);
      }
      terminate() {}
    }
    vi.resetModules();
    (globalThis as { Worker?: unknown }).Worker = WorkerFalso;
    const mod = await import("@/lib/recorte/limpezaDaLogo");
    const data = logo(50, 50, [255, 255, 255]);
    const r = await mod.limparForaDaTela({ op: "diagnosticar", data, largura: 50, altura: 50 });
    expect(recebidos).toHaveLength(1);
    expect(recebidos[0].msg.op).toBe("diagnosticar");
    expect(recebidos[0].msg.data).not.toBe(data);
    expect(recebidos[0].transferir).toEqual([recebidos[0].msg.data.buffer]);
    expect(r.diagnostico && r.diagnostico.precisa).toBe("fundo_solido");
  });
});

describe("franja nunca sai sozinha", () => {
  it("logoLimpa (Estúdio e selo) devolve o PNG transparente como veio", () => {
    const s = ler("supabase/functions/_shared/imagem-local.ts");
    const ramo = s.slice(s.indexOf("if (nTransparentes >= nBorda * 0.5) {"), s.indexOf("// IDR (30/09): fundo liso e claro"));
    expect(ramo).not.toContain("tirarFranja");
    expect(ramo).not.toContain("diagnosticarRecorte");
    expect(ramo).toContain("if (fonte === img && l.width === img.width && l.height === img.height) return bytes;");
  });

  it("a leitura da logo (cores, versões, monocromática) não chama tirarFranja; PNG transparente não ganha 'sem fundo'", () => {
    const s = ler("supabase/functions/mesa-identidade/modulos/leitura-da-logo.ts");
    expect(s).not.toContain("tirarFranja");
    expect(s).toContain('if (a.fundo !== "transparente") porCodigo.push("sem_fundo");');
  });
});

describe("Tirar fundo (pro): borda limpa num passo à parte", () => {
  const pro = ler("supabase/functions/mesa-foto/ferramentas-pro.ts");

  it("o resultado pago vai ao acervo sem conta pesada no meio; retomar nunca refaz a borda", () => {
    const concluir = pro.slice(pro.indexOf("async function acompanharEConcluir"), pro.indexOf("async function executar("));
    expect(concluir).toContain("const r = await concluirPedido(plano, andamento, pedido, dependencias(ch, clientId, plano));\n      const { img, ja_existia } = await gravarDerivada(clientId, origem, plano, r);");
    expect(concluir).not.toContain("bordaLimpa(");
    const retomar = pro.slice(pro.indexOf("async function retomar("), pro.indexOf("async function estimar("));
    expect(retomar).not.toContain("bordaLimpa(");
    expect(pro).toContain("ferramenta_borda_limpa: bordaLimpaDoRecorte,");
    expect(ler("supabase/functions/mesa-foto/modulos/ferramentas-imagem.ts")).toContain("export const MP_DA_BORDA_LIMPA = 1.0;");
  });

  it("o passo grava uma derivada nova com id fixo e arquiva (não apaga) o recorte do provedor", () => {
    const passo = pro.slice(pro.indexOf("async function bordaLimpaDoRecorte"), pro.indexOf("// ---------------------------------------------------------------- acervo"));
    expect(passo).toContain("const id = await idDaBordaLimpa(img.id);");
    expect(passo).toContain('tags: Array.from(new Set([...tags, "borda_limpa"])),');
    expect(passo).toContain(".update({ ativa: false })");
    expect(passo).not.toMatch(/\.delete\(\)/);
    expect(passo.indexOf("from(\"cliente_imagens\").insert(")).toBeLessThan(passo.indexOf(".update({ ativa: false })"));
  });

  beforeEach(() => invocar.mockReset());
  const pronto = (extra: Record<string, unknown> = {}) => ({
    data: { situacao: "pronto", imagem: { id: "d1", storage_bucket: "mesa", storage_path: "c1/x.png", nome: "x", tags: ["sem_fundo"] }, url: "https://provedor", custo_usd: 0.018, cobrado: true, ...extra },
    error: null,
  });

  it("a tela pede a borda limpa depois do pronto e troca pela versão limpa (sem custo novo)", async () => {
    invocar
      .mockResolvedValueOnce(pronto({ borda_limpa_pendente: true }))
      .mockResolvedValueOnce({ data: { situacao: "pronto", imagem: { id: "d2", storage_bucket: "mesa", storage_path: "c1/y.png", nome: "x", tags: ["sem_fundo", "borda_limpa"] }, url: "https://limpa", custo_usd: 0, borda_limpa: true }, error: null });
    const etapas: string[] = [];
    const r = await tirarFundoPro({ clientId: "c1", imagemId: "i1" }, (e) => etapas.push(e.etapa));
    expect(invocar.mock.calls[1][1].body).toEqual({ acao: "ferramenta_borda_limpa", client_id: "c1", imagem_id: "d1" });
    expect(r.imagem.id).toBe("d2");
    expect(r.url).toBe("https://limpa");
    expect(r.custoUsd).toBe(0.018);
    expect(r.bordaLimpa).toBe(true);
    expect(etapas).toContain("limpando_borda");
  });

  it("a borda que falha vira aviso: o recorte pago continua o resultado", async () => {
    invocar.mockResolvedValueOnce(pronto({ borda_limpa_pendente: true })).mockResolvedValueOnce({ data: null, error: new Error("CPU Time exceeded") });
    const r = await tirarFundoPro({ clientId: "c1", imagemId: "i1" });
    expect(r.imagem.id).toBe("d1");
    expect(r.cobrado).toBe(true);
    expect(r.avisos.join(" ")).toMatch(/borda limpa não ficou pronta/);
  });

  it("sem pendência (foto grande ou já limpa), nenhuma segunda chamada", async () => {
    invocar.mockResolvedValueOnce(pronto());
    await tirarFundoPro({ clientId: "c1", imagemId: "i1" });
    expect(invocar).toHaveBeenCalledTimes(1);
  });
});

describe("Mesa Foto: a borda tem orçamento de tempo", () => {
  it("pula a limpeza acima de 1,2 s de CPU do pedido ou de 2 MP (fica a borda da máscara)", () => {
    const r = ler("supabase/functions/mesa-foto/recorte.ts");
    expect(r).toContain("export const ORCAMENTO_DA_BORDA_MS = 1200;");
    expect(r).toContain("export const MP_DA_BORDA_NO_RECORTE = 2.0;");
    expect(r).toContain("const limpeza = pulada ? null : limparBordaDoRecorte(");
    const index = ler("supabase/functions/mesa-foto/index.ts");
    // A espera da rede (chamada ao gerador) não entra: só a CPU antes e depois dela.
    expect(index).toContain("const r = await recortePreservandoOriginal(o, g, volta.tela, tVolta - cpuAntes);");
  });
});
