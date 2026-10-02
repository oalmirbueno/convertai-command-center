import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  corpoDoEnvio,
  custoDaAmostra,
  custoDaFinal,
  custoDoEnvio,
  custoRegistrado,
  faltaNoTrecho,
  GALERIA_DE_CENARIOS,
  INFO_DAS_QUALIDADES,
  MOTORES_DA_TROCA,
  passosDaFinal,
  promptDaAmostra,
  promptDoAleph,
  proximoPasso,
  textoDoEstado,
} from "../../supabase/functions/mesa-videos/modulos/troca-de-cenario";
import { ROTAS_DA_RUNWAY } from "../../supabase/functions/mesa-videos/modulos/video-provedor-runway";
import { clipesDeVideo, ondeEntra, origemDoAcervo, pedirComCusto, prontasParaEntrar, trechoNoLimite, type TrocaNaTela } from "@/lib/editor/cenario";
import { ErroDaMesa } from "@/lib/mesa/api";
import { projetoDosTakes } from "../../supabase/functions/_shared/projeto-de-edicao";
import { aplicarOperacoes } from "@/lib/editor/operacoes";
import { opsParaInserir } from "@/lib/editor/biblioteca";

/**
 * Frente TCN (rodada 3, parte 1, 01/10/2026): trocar o cenário com a pessoa fixa.
 * Regras puras (custo, limites, pedidos aos modelos, máquina de estados), o
 * custo antes do Confirmar, a entrada na linha do tempo e as guardas da migration.
 */

const ler = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8").replace(/\r\n/g, "\n");

describe("troca de cenário: custo e limites", () => {
  it("Rápido de 30 s fica em ~US$ 1,55 (recorte + fundo limpo), abaixo dos US$ 2,40 do estudo", () => {
    const c = custoDaFinal("rapido", "cheio", 30, 0.045);
    expect(c.usd).toBeCloseTo(1.545, 4);
    expect(c.partes.map((p) => p.rotulo)).toEqual(["recorte da pessoa", "fundo limpo"]);
  });

  it("Cinema e Aleph cobram pelo segundo começado; 3 faixas pede o recorte a mais", () => {
    expect(custoDoEnvio("cinema", 8.2).usd).toBeCloseTo(0.126 * 9, 4);
    expect(custoDoEnvio("aleph", 1).usd).toBeCloseTo(0.56, 4); // mínimo de 2 s (56 créditos)
    expect(custoDaFinal("cinema", "tres_faixas", 10, 0).partes.map((p) => p.rotulo)).toEqual(["Cinema", "recorte da pessoa"]);
    expect(custoDaFinal("aleph", "cheio", 10, 0.04).usd).toBeCloseTo(2.8, 4);
    expect(passosDaFinal("rapido", "tres_faixas").envios).toEqual(["recorte"]);
  });

  it("a amostra custa centavos e vai de 1 a 3", () => {
    expect(custoDaAmostra(2, 0.0153).usd).toBeCloseTo(0.0306, 4);
    expect(custoDaAmostra(9, 0.01).partes[0].rotulo).toBe("3 amostras");
  });

  it("limites por qualidade (Kling de 3 a 15 s, Aleph até 30 s, Rápido até 60 s)", () => {
    expect(faltaNoTrecho("cinema", 0, 2)).toMatch(/pelo menos 3 s/);
    expect(faltaNoTrecho("cinema", 0, 16)).toMatch(/até 15 s.*Rápido/);
    expect(faltaNoTrecho("aleph", 0, 30)).toBeNull();
    expect(faltaNoTrecho("rapido", 5, 4)).toMatch(/início e o fim/);
    expect(INFO_DAS_QUALIDADES.aleph.chave).toBe("RUNWAYML_API_SECRET");
  });

  it("preços com fonte e data conferidos ao vivo", () => {
    MOTORES_DA_TROCA.forEach((m) => {
      expect(m.fonte).toMatch(/^https:\/\//);
      expect(m.conferido_em).toBe("2026-10-01");
      expect(m.por_segundo).toBeGreaterThan(0);
    });
  });
});

describe("troca de cenário: pedidos aos modelos", () => {
  it("amostra mantém a pessoa idêntica e troca só o fundo", () => {
    const p = promptDaAmostra("praia no fim da tarde");
    expect(p).toMatch(/Keep the person EXACTLY identical/);
    expect(p).toMatch(/Replace ONLY the background and setting with: praia no fim da tarde/);
  });

  it("recorte com alfa, Kling com a amostra como @Image1, Aleph com quadro-chave no segundo 0", () => {
    const r = corpoDoEnvio("recorte", { trecho_url: "https://t", amostra_url: null, cenario: "x" });
    expect(r.motor.endpoint).toBe("bria/video/background-removal/v3");
    expect(r.corpo).toMatchObject({ video_url: "https://t", background_color: "Transparent", output_container_and_codec: "webm_vp9" });
    const k = corpoDoEnvio("cinema", { trecho_url: "https://t", amostra_url: "https://a", cenario: "loja" });
    expect(k.corpo).toMatchObject({ video_url: "https://t", image_urls: ["https://a"], keep_audio: true });
    expect(String(k.corpo.prompt)).toMatch(/@Video1.*@Image1/);
    const o = corpoDoEnvio("cinema", { trecho_url: "https://t", amostra_url: "https://a", cenario: "loja" }, "gemini-omni-flash-1.1-edit");
    expect(o.corpo).toEqual(expect.objectContaining({ video_url: "https://t", resolution: "720p" }));
    const a = corpoDoEnvio("aleph", { trecho_url: "https://t", amostra_url: "https://a", cenario: "loja", seed: 7 });
    expect(a.motor.provedor).toBe("runway");
    expect(a.corpo).toMatchObject({ model: "aleph2", videoUri: "https://t", keyframes: [{ uri: "https://a", seconds: 0 }], seed: 7 });
    expect(promptDoAleph("x".repeat(2000)).length).toBeLessThanOrEqual(1000);
    expect(ROTAS_DA_RUNWAY).toContain("video_to_video");
  });

  it("a galeria é atalho: 8 cenários com texto editável e sem imagem de terceiro", () => {
    expect(GALERIA_DE_CENARIOS.length).toBe(8);
    GALERIA_DE_CENARIOS.forEach((c) => {
      expect(c.texto.length).toBeGreaterThan(20);
      expect(c.cores.every((x) => /^#[0-9a-f]{6}$/i.test(x))).toBe(true);
    });
  });
});

describe("troca de cenário: máquina de estados (sem laço)", () => {
  it("preparo -> enviar -> consultar -> compor -> pronto; erro do worker ou do provedor encerra", () => {
    expect(proximoPasso("preparando", {}, null).passo).toBe("esperar_preparo");
    expect(proximoPasso("preparando", {}, { estado: "pronto" }).passo).toBe("enviar");
    expect(proximoPasso("preparando", {}, { estado: "cancelado", erro: "máquina desligada" })).toMatchObject({ passo: "erro" });
    const envio = (estado: string) => ({ papel: "recorte", estado, erro: estado === "erro" ? "recusou" : null }) as never;
    expect(proximoPasso("gerando", { envios: [envio("gerando")] }, null).passo).toBe("consultar");
    expect(proximoPasso("gerando", { envios: [envio("pronto")] }, null).passo).toBe("compor");
    expect(proximoPasso("gerando", { envios: [envio("pronto"), envio("erro")] }, null)).toMatchObject({ passo: "erro", motivo: "recusou" });
    expect(proximoPasso("compondo", {}, { estado: "rodando" }).passo).toBe("esperar_composicao");
    expect(proximoPasso("compondo", {}, { estado: "pronto" }).passo).toBe("nada");
    expect(proximoPasso("pronto", {}, null).passo).toBe("nada");
    expect(textoDoEstado("gerando", { envios: [envio("pronto"), envio("gerando")] })).toBe("Gerando (1 de 2)");
  });

  it("custo registrado só soma o que foi cobrado", () => {
    expect(custoRegistrado([{ custo_usd: 0.01 }, { custo_usd: 0.02 }], { placa: { path: "p", custo_usd: 0.04, uso_id: "u" }, envios: [{ uso_id: "u", custo_usd: 0.4 } as never, { uso_id: null, custo_usd: 0.9 } as never] })).toBeCloseTo(0.47, 4);
  });
});

describe("troca de cenário: tela", () => {
  it("custo antes: sem o valor volta a estimativa; com o valor e o uid, gera", async () => {
    const chamadas: Record<string, unknown>[] = [];
    const chamar = async (c: Record<string, unknown>) => {
      chamadas.push(c);
      if (c.custo_confirmado_usd === undefined) throw new ErroDaMesa("confirmar_custo", "Confirme", { custo_estimado: { usd: 0.03, detalhe: "2 amostras" } });
      return { troca: { id: "t1" } };
    };
    const a = await pedirComCusto(chamar, { acao: "cenario_amostra", custo_confirmado_usd: 9 });
    expect(a).toEqual({ tipo: "custo", custo: { usd: 0.03, detalhe: "2 amostras" }, mudou: false });
    expect(chamadas[0].custo_confirmado_usd).toBeUndefined();
    const b = await pedirComCusto(chamar, { acao: "cenario_amostra" }, { usd: 0.03, uid: "clique-1" });
    expect(b).toMatchObject({ tipo: "feito", troca: { id: "t1" } });
    expect(chamadas[1]).toMatchObject({ custo_confirmado_usd: 0.03, uid: "clique-1" });
    const c = await pedirComCusto(async () => {
      throw new ErroDaMesa("acao_desconhecida", "x");
    }, {});
    expect(c).toMatchObject({ tipo: "erro", mensagem: expect.stringMatching(/em preparação/) });
  });

  it("origem: clipes de vídeo do projeto com o trecho; acervo começa no zero e respeita o teto", () => {
    let p = projetoDosTakes({ titulo: "Teste", formato: "9:16", takes: [] });
    const item = { id: "a1", arquivo_id: "a1", nome: "fala.mp4", tipo: "bruto", storage_bucket: "mesa", storage_path: "c/video/brutos/fala.mp4", duracao_s: 40, largura: 1080, altura: 1920, origem: "enviado" as const };
    p = aplicarOperacoes(p, opsParaInserir(p, item, "fim"));
    const clipes = clipesDeVideo(p);
    expect(clipes.length).toBe(1);
    expect(clipes[0]).toMatchObject({ fonte_path: "c/video/brutos/fala.mp4", arquivo_id: "a1", entrada_s: 0, saida_s: 40 });
    expect(trechoNoLimite(0, 40, 15, 40)).toEqual({ entrada_s: 0, saida_s: 15 });
    expect(origemDoAcervo({ id: "b", nome: "b.mp4", storage_bucket: "mesa", storage_path: "c/b.mp4", duracao_s: 90 }, 60).saida_s).toBe(60);
    // O resultado entra logo depois do clipe de origem (ou no fim, se ele saiu).
    expect(ondeEntra(p, { clipe_ref: clipes[0].clipe_ref })).toEqual({ depoisDe: clipes[0].clipe_ref });
    expect(ondeEntra(p, { clipe_ref: "sumiu" })).toBe("fim");
  });

  it("só a troca pronta desta versão, ainda não posta, entra na linha do tempo", () => {
    const base = { estado: "pronto", inserido_em: null, versao_id: "v1", resultado: { id: "r" } } as unknown as TrocaNaTela;
    const lista = [{ ...base, id: "a" }, { ...base, id: "b", inserido_em: "2026-10-01" }, { ...base, id: "c", versao_id: "v2" }, { ...base, id: "d", estado: "gerando" }, { ...base, id: "e" }] as TrocaNaTela[];
    expect(prontasParaEntrar(lista, "v1", { e: true }).map((t) => t.id)).toEqual(["a"]);
  });
});

describe("troca de cenário: guardas", () => {
  it("migration: RLS por cliente, escrita só pelo servidor, termo de imagem obrigatório e worker com tcn-", () => {
    const sql = ler("supabase/migrations/20260930327000_troca_de_cenario.sql");
    expect(sql).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/public\.can_access_client\(client_id\)/);
    expect(sql).toMatch(/REVOKE INSERT, UPDATE, DELETE ON public\.video_cenarios FROM authenticated/);
    expect(sql).toMatch(/\(autorizacao->>'confirmada'\) = 'true'/);
    expect(sql).toMatch(/LIKE '%tcn-%'/);
    expect(sql).toMatch(/video_cenarios\s+where estado in \('preparando', 'gerando', 'compondo'\)/);
  });

  it("worker sobe a versão e trata o tipo cenario", () => {
    expect(ler("workers/render/principal.ts")).toMatch(/VERSAO_DO_WORKER = "edt-1\.0\+mot-1\.0\+mtr-1\+tcn-1(\+trt-1)?\+mov-1"/);
    expect(ler("workers/render/trabalho.ts")).toMatch(/p\.tipo === "cenario"/);
  });

  it("função: ações registradas, chave só pelo nome e nada de prompt-e-parse", () => {
    const idx = ler("supabase/functions/mesa-videos/index.ts");
    ["cenario_amostra", "cenario_gerar", "cenario_status", "cenario_inserido", "cenario_descartar"].forEach((a) => expect(idx).toContain(`${a}:`));
    expect(idx).toMatch(/cenariosColetar\(baseDoCron\)/);
    const c = ler("supabase/functions/mesa-videos/cenario.ts");
    expect(c).not.toMatch(/Deno\.env\.get\("FAL_KEY"\)/);
    expect(c).toMatch(/chaveCarregada\(provedor === "runway" \? "RUNWAYML_API_SECRET" : "FAL_KEY"\)/);
  });
});
