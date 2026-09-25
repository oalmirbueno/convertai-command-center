import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  acompanharPedido,
  assinarFicha,
  baixarResultado,
  chaveDoProvedor,
  concluirPedido,
  conferirSaida,
  custoDoMotor,
  dimensoesDoCabecalho,
  entradaDoProvedor,
  enviarParaFila,
  erroDoProvedor,
  etiquetaDoResultado,
  FerramentaImagemErro,
  ferramentasConfiguradas,
  fichaDoPlano,
  lerFicha,
  lerPedidoDeFundo,
  lerPedidoDeUpscale,
  MAX_BYTES_SAIDA,
  MOTOR_PADRAO,
  MOTORES,
  planoDaFicha,
  planoDoFundo,
  planoDoUpscale,
  PROVEDORES,
  type Rede,
  temCanalAlfa,
  urlDeResultadoSegura,
  VALIDADE_DA_FICHA_MS,
} from "../../supabase/functions/_shared/ferramentas-imagem";

const invocar = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: (...a: unknown[]) => invocar(...a) } } }));

import { ampliarImagem, ehSemChave, estimarFerramentas, normalizarEstimativa, textoDoAndamento, tirarFundoPro } from "@/components/ferramentas/ferramentasApi";
import { rotuloDoBotao } from "@/components/ferramentas/FerramentasDaImagem";

const ler = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8").replace(/\r\n/g, "\n");

// ------------------------------------------------------------ imagens de mentira (só cabeçalho)

function png(largura: number, altura: number, tipoDeCor = 6, comTrns = false): Uint8Array {
  const u32 = (v: number) => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
  const bloco = (nome: string, dados: number[]) => [...u32(dados.length), ...nome.split("").map((c) => c.charCodeAt(0)), ...dados, 0, 0, 0, 0];
  return new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10,
    ...bloco("IHDR", [...u32(largura), ...u32(altura), 8, tipoDeCor, 0, 0, 0]),
    ...(comTrns ? bloco("tRNS", [0, 0, 0, 0, 0, 0]) : []),
    ...bloco("IDAT", [1, 2, 3]),
  ]);
}

function jpeg(largura: number, altura: number): Uint8Array {
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0];
  const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, altura >> 8, altura & 255, largura >> 8, largura & 255, 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1];
  return new Uint8Array([0xff, 0xd8, ...app0, ...sof, 0xff, 0xd9, 0, 0, 0, 0]);
}

/** Rede falsa: relógio que anda com `esperar` e respostas por URL. */
function redeFalsa(responder: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  let agora = 0;
  const chamadas: { url: string; init?: RequestInit }[] = [];
  const rede: Rede = {
    fetch: (async (url: string, init?: RequestInit) => {
      chamadas.push({ url: String(url), init });
      return await responder(String(url), init);
    }) as unknown as typeof fetch,
    esperar: async (ms) => {
      agora += ms;
    },
    agora: () => agora,
  };
  return { rede, chamadas };
}

const json = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
const PEDIDO = "764cabcf-b745-4b3e-ae38-1200304cf45b";
const FILA = {
  request_id: PEDIDO,
  status_url: `https://queue.fal.run/fal-ai/topaz/requests/${PEDIDO}/status`,
  response_url: `https://queue.fal.run/fal-ai/topaz/requests/${PEDIDO}`,
};

// ------------------------------------------------------------ contrato e validação

describe("ferramentas de imagem: contrato do pedido", () => {
  it("tem um motor padrão por tarefa, todos no provedor fal com segredo FAL_KEY", () => {
    expect(MOTOR_PADRAO).toEqual({ upscale_fiel: "topaz", upscale_criativo: "clarity", remover_fundo: "bria" });
    expect(PROVEDORES.fal.segredo).toBe("FAL_KEY");
    for (const m of Object.values(MOTORES)) {
      expect(m.provedor).toBe("fal");
      expect(m.fonte_preco).toMatch(/^https:\/\/fal\.ai\/models\//);
    }
    expect(MOTORES.topaz.modo).toBe("fiel");
    expect(MOTORES.clarity.modo).toBe("criativo");
  });

  it("upscale aceita só fator 2 ou 4 e modo fiel ou criativo, com o motor do modo", () => {
    expect(lerPedidoDeUpscale({ fator: 4, modo: "fiel" })).toMatchObject({ fator: 4, modo: "fiel", motor: "topaz", conteudo: "foto", refazer: false });
    expect(lerPedidoDeUpscale({ fator: "2", modo: "criativo" })).toMatchObject({ fator: 2, motor: "clarity" });
    expect(lerPedidoDeUpscale({})).toMatchObject({ fator: 2, modo: "fiel" });
    const codigo = (f: () => unknown) => {
      try {
        f();
      } catch (e) {
        return (e as FerramentaImagemErro).codigo;
      }
      return null;
    };
    expect(codigo(() => lerPedidoDeUpscale({ fator: 3 }))).toBe("fator_invalido");
    expect(codigo(() => lerPedidoDeUpscale({ fator: 2, modo: "magico" }))).toBe("modo_invalido");
    expect(codigo(() => lerPedidoDeUpscale({ fator: 2, modo: "fiel", motor: "clarity" }))).toBe("motor_invalido");
    expect(codigo(() => lerPedidoDeUpscale({ fator: 2, modo: "fiel", motor: "bria" }))).toBe("motor_invalido");
    expect(codigo(() => lerPedidoDeUpscale({ fator: 2, conteudo: "video" }))).toBe("conteudo_invalido");
    expect(lerPedidoDeFundo({})).toEqual({ motor: "bria", refazer: false });
    expect(lerPedidoDeFundo({ motor: "birefnet", refazer: true })).toEqual({ motor: "birefnet", refazer: true });
    expect(codigo(() => lerPedidoDeFundo({ motor: "topaz" }))).toBe("motor_invalido");
  });

  it("monta a entrada de cada modelo sem inventar parâmetro", () => {
    const fiel = planoDoUpscale(lerPedidoDeUpscale({ fator: 2 }), { largura: 1000, altura: 800 }, "image/jpeg");
    expect(entradaDoProvedor(fiel, "https://x/a.jpg")).toEqual({
      image_url: "https://x/a.jpg", model: "Standard V2", upscale_factor: 2, output_format: "jpeg", face_enhancement: true, face_enhancement_creativity: 0,
    });
    const texto = planoDoUpscale(lerPedidoDeUpscale({ fator: 2, conteudo: "texto" }), { largura: 1000, altura: 800 }, "image/png");
    expect(entradaDoProvedor(texto, "u")).toMatchObject({ model: "Text Refine", output_format: "png", face_enhancement: false });
    const fundo = planoDoFundo(lerPedidoDeFundo({ motor: "birefnet" }), { largura: 1200, altura: 1600 });
    expect(entradaDoProvedor(fundo, "u")).toEqual({ image_url: "u", model: "General Use (Heavy)", operating_resolution: "2048x2048", output_format: "png", refine_foreground: true });
    expect(entradaDoProvedor(planoDoFundo(lerPedidoDeFundo({}), { largura: 800, altura: 800 }), "u")).toEqual({ image_url: "u" });
  });

  it("etiqueta identifica a derivada (evita pagar duas vezes pela mesma ferramenta)", () => {
    const p = planoDoUpscale(lerPedidoDeUpscale({ fator: 4 }), { largura: 900, altura: 900 }, "image/jpeg");
    expect(etiquetaDoResultado(p)).toBe("upscale:4x:fiel:topaz");
    expect(etiquetaDoResultado(planoDoFundo(lerPedidoDeFundo({}), { largura: 900, altura: 900 }))).toBe("sem_fundo:bria");
  });
});

// ------------------------------------------------------------ limites e custo

describe("ferramentas de imagem: limites e custo", () => {
  it("2x fiel de uma foto comum custa a primeira faixa da Topaz", () => {
    const p = planoDoUpscale(lerPedidoDeUpscale({ fator: 2 }), { largura: 1000, altura: 800 }, "image/jpeg");
    expect(p.saida).toEqual({ largura: 2000, altura: 1600 });
    expect(p.fator_efetivo).toBe(2);
    expect(p.estimativa_usd).toBe(0.08);
    expect(p.avisos).toEqual([]);
  });

  it("4x que passaria do limite é reduzido e avisa; a faixa de preço segue a saída", () => {
    const p = planoDoUpscale(lerPedidoDeUpscale({ fator: 4 }), { largura: 3000, altura: 2000 }, "image/jpeg");
    expect(p.fator_efetivo).toBeLessThan(4);
    expect((p.saida.largura * p.saida.altura) / 1e6).toBeLessThanOrEqual(40);
    expect(Math.max(p.saida.largura, p.saida.altura)).toBeLessThanOrEqual(8192);
    expect(p.estimativa_usd).toBe(0.16);
    expect(p.avisos[0]).toMatch(/ajustada/);
  });

  it("PNG tem teto menor de megapixels", () => {
    const p = planoDoUpscale(lerPedidoDeUpscale({ fator: 4 }), { largura: 2000, altura: 2000 }, "image/png");
    expect((p.saida.largura * p.saida.altura) / 1e6).toBeLessThanOrEqual(24);
    expect(p.formato_saida).toBe("png");
  });

  it("recusa ampliar o que já está grande e o que é pequeno ou sem tamanho", () => {
    expect(() => planoDoUpscale(lerPedidoDeUpscale({ fator: 2 }), { largura: 7800, altura: 5200 }, "image/jpeg")).toThrow(/grande/);
    const erro = (e: { largura: number; altura: number }) => {
      try {
        planoDoUpscale(lerPedidoDeUpscale({ fator: 2 }), e, "image/jpeg");
      } catch (x) {
        return (x as FerramentaImagemErro).codigo;
      }
      return null;
    };
    expect(erro({ largura: 40, altura: 400 })).toBe("imagem_pequena_demais");
    expect(erro({ largura: 0, altura: 0 })).toBe("dimensoes_desconhecidas");
    expect(erro({ largura: 9000, altura: 400 })).toBe("imagem_grande_demais");
    expect(() => planoDoFundo(lerPedidoDeFundo({}), { largura: 6000, altura: 5000 })).toThrow(/MP/);
  });

  it("criativo cobra por megapixel da saída e avisa que a IA reconstrói", () => {
    const p = planoDoUpscale(lerPedidoDeUpscale({ fator: 2, modo: "criativo" }), { largura: 1024, altura: 1024 }, "image/jpeg");
    expect(p.estimativa_usd).toBeCloseTo(2048 * 2048 / 1e6 * 0.03, 6);
    expect(p.avisos.join(" ")).toMatch(/criativo/i);
    const grande = planoDoUpscale(lerPedidoDeUpscale({ fator: 4, modo: "criativo" }), { largura: 2000, altura: 2000 }, "image/jpeg");
    expect((grande.saida.largura * grande.saida.altura) / 1e6).toBeLessThanOrEqual(16);
  });

  it("tabela: por imagem, por segundo (com o tempo real quando vem) e faixas", () => {
    expect(custoDoMotor(MOTORES.bria, { largura: 10, altura: 10 })).toBe(0.018);
    expect(custoDoMotor(MOTORES.birefnet, { largura: 10, altura: 10 })).toBe(0.012);
    expect(custoDoMotor(MOTORES.birefnet, { largura: 10, altura: 10 }, 3)).toBe(0.0024);
    expect(custoDoMotor(MOTORES.topaz, { largura: 8000, altura: 6000 })).toBe(0.16);
    expect(custoDoMotor(MOTORES.seedvr, { largura: 100, altura: 100 })).toBe(0.001);
  });
});

// ------------------------------------------------------------ chave

describe("ferramentas de imagem: sem chave", () => {
  it("sem FAL_KEY: erro claro com o nome do segredo e nunca um valor", () => {
    const vazio = { get: () => undefined };
    expect(ferramentasConfiguradas("fal", vazio)).toBe(false);
    try {
      chaveDoProvedor("fal", vazio);
      throw new Error("deveria falhar");
    } catch (e) {
      const err = e as FerramentaImagemErro;
      expect(err.codigo).toBe("ferramenta_sem_chave");
      expect(err.status).toBe(503);
      expect(err.message).toMatch(/configure FAL_KEY/);
      expect(err.extra).toEqual({ segredo: "FAL_KEY", provedor: "fal" });
    }
  });

  it("com a chave: lê do ambiente (aparando espaços)", () => {
    const env = { get: (n: string) => (n === "FAL_KEY" ? "  segredo-de-teste  " : undefined) };
    expect(ferramentasConfiguradas("fal", env)).toBe(true);
    expect(chaveDoProvedor("fal", env)).toBe("segredo-de-teste");
  });

  it("nenhum arquivo novo guarda chave, loga chave ou usa travessão", () => {
    const arquivos = [
      "supabase/functions/_shared/ferramentas-imagem.ts",
      "supabase/functions/mesa-foto/ferramentas-pro.ts",
      "src/components/ferramentas/ferramentasApi.ts",
      "src/components/ferramentas/FerramentasDaImagem.tsx",
      "docs/ferramentas-imagem/PESQUISA.md",
    ];
    for (const a of arquivos) {
      const t = ler(a);
      expect(t, a).not.toMatch(/[—–]/);
      expect(t, a).not.toMatch(/console\.(log|error|warn)\([^)]*chave/);
      expect(t, a).not.toMatch(/Key [0-9a-f]{8}-[0-9a-f]{4}/);
    }
    // O módulo compartilhado roda nos testes: sem import de Deno, npm ou URL.
    expect(ler("supabase/functions/_shared/ferramentas-imagem.ts")).not.toMatch(/^import /m);
  });
});

// ------------------------------------------------------------ conferência do resultado

describe("ferramentas de imagem: conferência do resultado", () => {
  it("lê tamanho de PNG e JPEG pelo cabeçalho e o alfa do PNG", () => {
    expect(dimensoesDoCabecalho(png(1200, 900))).toEqual({ largura: 1200, altura: 900 });
    expect(dimensoesDoCabecalho(jpeg(4000, 3000))).toEqual({ largura: 4000, altura: 3000 });
    expect(temCanalAlfa(png(10, 10, 6))).toBe(true);
    expect(temCanalAlfa(png(10, 10, 2))).toBe(false);
    expect(temCanalAlfa(png(10, 10, 2, true))).toBe(true);
    expect(temCanalAlfa(jpeg(10, 10))).toBe(false);
  });

  it("upscale: aceita maior e com a mesma proporção; recusa sem ampliar, deformado e não imagem", () => {
    const plano = { tarefa: "upscale" as const, entrada: { largura: 1000, altura: 800 } };
    expect(conferirSaida(jpeg(2000, 1600), plano)).toMatchObject({ mime: "image/jpeg", largura: 2000, altura: 1600 });
    expect(() => conferirSaida(jpeg(1000, 800), plano)).toThrow(/sem ampliar/);
    expect(() => conferirSaida(jpeg(2000, 2000), plano)).toThrow(/proporção/);
    expect(() => conferirSaida(new TextEncoder().encode("<html>erro do provedor</html>"), plano)).toThrow(/não é PNG/);
  });

  it("tirar fundo: exige transparência e a mesma proporção", () => {
    const plano = { tarefa: "remover_fundo" as const, entrada: { largura: 1000, altura: 1500 } };
    expect(conferirSaida(png(1000, 1500, 6), plano).mime).toBe("image/png");
    expect(() => conferirSaida(png(1000, 1500, 2), plano)).toThrow(/sem transparência/);
    expect(() => conferirSaida(jpeg(1000, 1500), plano)).toThrow(/sem transparência/);
    expect(() => conferirSaida(png(1500, 1500, 6), plano)).toThrow(/proporção/);
  });

  it("resultado só de https público e com teto de bytes", async () => {
    expect(urlDeResultadoSegura("https://v3.fal.media/files/x.png")).toBe(true);
    expect(urlDeResultadoSegura("http://v3.fal.media/files/x.png")).toBe(false);
    expect(urlDeResultadoSegura("https://localhost/x.png")).toBe(false);
    expect(urlDeResultadoSegura("https://169.254.169.254/latest")).toBe(false);
    expect(urlDeResultadoSegura("file:///etc/passwd")).toBe(false);
    const { rede } = redeFalsa(() => new Response(new Uint8Array(20), { headers: { "content-length": String(MAX_BYTES_SAIDA + 1) } }));
    await expect(baixarResultado("https://v3.fal.media/files/x.png", rede)).rejects.toMatchObject({ codigo: "resultado_grande_demais" });
    const pequeno = redeFalsa(() => new Response(new Uint8Array(50)));
    await expect(baixarResultado("https://v3.fal.media/x.png", pequeno.rede, 10)).rejects.toMatchObject({ codigo: "resultado_grande_demais" });
  });
});

// ------------------------------------------------------------ fila do provedor

describe("ferramentas de imagem: fila assíncrona da fal.ai", () => {
  it("envia com a chave só para a fila, consulta até ficar pronto e baixa sem a chave", async () => {
    let consultas = 0;
    const { rede, chamadas } = redeFalsa((url) => {
      if (url === "https://queue.fal.run/fal-ai/topaz/upscale/image") return json(FILA);
      if (url === FILA.status_url) {
        consultas++;
        return json(consultas < 3 ? { status: consultas === 1 ? "IN_QUEUE" : "IN_PROGRESS", queue_position: 0 } : { status: "COMPLETED", metrics: { inference_time: 7.5 } });
      }
      if (url === FILA.response_url) return json({ image: { url: "https://v3.fal.media/files/saida.jpg" } });
      if (url === "https://v3.fal.media/files/saida.jpg") return new Response(jpeg(2000, 1600));
      return json({ detail: "não esperado" }, 404);
    });
    const plano = planoDoUpscale(lerPedidoDeUpscale({ fator: 2 }), { largura: 1000, altura: 800 }, "image/jpeg");
    const pedido = await enviarParaFila(plano, "https://assinada/foto.jpg", "chave-teste", rede);
    expect(pedido).toEqual(FILA);
    const envio = chamadas[0];
    expect(envio.init?.method).toBe("POST");
    const cab = envio.init?.headers as Record<string, string>;
    expect(cab.Authorization).toBe("Key chave-teste");
    expect(JSON.parse(cab["X-Fal-Object-Lifecycle-Preference"])).toEqual({ expiration_duration_seconds: 86400 });
    expect(JSON.parse(String(envio.init?.body))).toMatchObject({ image_url: "https://assinada/foto.jpg", upscale_factor: 2 });

    const andamento = await acompanharPedido(pedido, "chave-teste", rede);
    expect(andamento).toEqual({ situacao: "pronto", imagem_url: "https://v3.fal.media/files/saida.jpg", segundos: 7.5 });

    const registrar = vi.fn(async () => ({ usoId: "uso-1", saldoUsd: 9.92 }));
    const r = await concluirPedido(plano, andamento as Extract<typeof andamento, { situacao: "pronto" }>, pedido, { rede, jaCobrado: async () => null, registrar });
    expect(r).toMatchObject({ custoUsd: 0.08, usoId: "uso-1", saldoUsd: 9.92, referenciaId: PEDIDO, cobradoAgora: true });
    expect(registrar).toHaveBeenCalledTimes(1);
    expect(registrar).toHaveBeenCalledWith(expect.objectContaining({ custoUsd: 0.08, qualidade: "upscale_2x_fiel", referenciaId: PEDIDO, tarefa: "upscale" }));
    const download = chamadas.find((c) => c.url.indexOf("fal.media") >= 0);
    expect(download?.init?.headers).toBeUndefined();
  });

  it("retomar um pedido já cobrado não cobra de novo", async () => {
    const { rede } = redeFalsa(() => new Response(png(800, 800, 6)));
    const plano = planoDoFundo(lerPedidoDeFundo({}), { largura: 800, altura: 800 });
    const registrar = vi.fn(async () => ({ usoId: "novo", saldoUsd: 1 }));
    const r = await concluirPedido(plano, { situacao: "pronto", imagem_url: "https://v3.fal.media/r.png", segundos: null }, FILA, {
      rede,
      jaCobrado: async () => ({ usoId: "antigo", custoUsd: 0.018 }),
      registrar,
    });
    expect(registrar).not.toHaveBeenCalled();
    expect(r).toMatchObject({ usoId: "antigo", cobradoAgora: false });
  });

  it("resultado errado não é cobrado", async () => {
    const { rede } = redeFalsa(() => new Response(jpeg(800, 800)));
    const plano = planoDoFundo(lerPedidoDeFundo({}), { largura: 800, altura: 800 });
    const registrar = vi.fn(async () => ({ usoId: "x", saldoUsd: 1 }));
    await expect(concluirPedido(plano, { situacao: "pronto", imagem_url: "https://v3.fal.media/r.jpg", segundos: null }, FILA, { rede, jaCobrado: async () => null, registrar }))
      .rejects.toMatchObject({ codigo: "recorte_sem_transparencia" });
    expect(registrar).not.toHaveBeenCalled();
  });

  it("passou do prazo: devolve o andamento para a tela retomar", async () => {
    const { rede } = redeFalsa(() => json({ status: "IN_PROGRESS" }));
    const andamento = await acompanharPedido(FILA, "k", rede, 10_000);
    expect(andamento).toEqual({ situacao: "processando", posicao: null });
  });

  it("não segue URL de fila que não seja da fal.ai", async () => {
    const { rede } = redeFalsa(() => json({ request_id: PEDIDO, status_url: "https://mal.example/status", response_url: "https://mal.example/r" }));
    const plano = planoDoFundo(lerPedidoDeFundo({}), { largura: 800, altura: 800 });
    await expect(enviarParaFila(plano, "u", "k", rede)).rejects.toMatchObject({ codigo: "provedor_resposta_invalida" });
    await expect(acompanharPedido({ ...FILA, status_url: "https://mal.example/s" }, "k", rede)).rejects.toMatchObject({ codigo: "pedido_invalido" });
  });

  it("erros do provedor viram códigos nossos e a chave nunca volta no detalhe", async () => {
    expect((await erroDoProvedor(json({ detail: "Invalid Key abcd1234efgh" }, 401), "enviar")).codigo).toBe("ferramenta_chave_recusada");
    expect((await erroDoProvedor(json({ detail: "User is locked. Reason: Exhausted balance." }, 403), "enviar")).codigo).toBe("provedor_sem_credito");
    expect((await erroDoProvedor(json({ detail: [{ msg: "image too large" }] }, 422), "enviar")).codigo).toBe("provedor_recusou");
    expect((await erroDoProvedor(new Response("x", { status: 429 }), "consultar")).codigo).toBe("provedor_ocupado");
    expect((await erroDoProvedor(new Response("x", { status: 500 }), "consultar")).codigo).toBe("provedor_erro");
    const redigido = await erroDoProvedor(json({ detail: "bad Key abcd1234-ffff:9999" }, 401), "enviar");
    expect(String(redigido.extra.detalhe)).not.toMatch(/abcd1234/);
  });
});

// ------------------------------------------------------------ ficha

describe("ferramentas de imagem: ficha para retomar", () => {
  const plano = planoDoUpscale(lerPedidoDeUpscale({ fator: 2 }), { largura: 1000, altura: 800 }, "image/jpeg");
  const dados = fichaDoPlano(plano, "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", FILA, 1_000);

  it("assina e lê de volta o mesmo plano", async () => {
    const ficha = await assinarFicha(dados, "segredo-servidor");
    const lida = await lerFicha(ficha, "segredo-servidor", 2_000);
    expect(lida).toEqual(dados);
    expect(planoDaFicha(lida)).toMatchObject({ tarefa: "upscale", fator_efetivo: 2, estimativa_usd: 0.08, motor: MOTORES.topaz });
    expect(ficha).not.toMatch(/segredo-servidor/);
  });

  it("recusa ficha alterada, de outro segredo ou vencida", async () => {
    const ficha = await assinarFicha(dados, "segredo-servidor");
    const [corpo, assinatura] = ficha.split(".");
    const outro = Buffer.from(JSON.stringify({ ...dados, client_id: "33333333-3333-4333-8333-333333333333" })).toString("base64url");
    await expect(lerFicha(`${outro}.${assinatura}`, "segredo-servidor", 2_000)).rejects.toMatchObject({ codigo: "ficha_invalida" });
    await expect(lerFicha(`${corpo}.${assinatura}`, "outro-segredo", 2_000)).rejects.toMatchObject({ codigo: "ficha_invalida" });
    await expect(lerFicha("lixo", "segredo-servidor")).rejects.toMatchObject({ codigo: "ficha_invalida" });
    await expect(lerFicha(ficha, "segredo-servidor", 1_000 + VALIDADE_DA_FICHA_MS + 1)).rejects.toMatchObject({ codigo: "ficha_vencida" });
  });
});

// ------------------------------------------------------------ servidor ligado ao index e ao acervo

describe("ferramentas de imagem: ligação na Mesa Foto", () => {
  const index = ler("supabase/functions/mesa-foto/index.ts");
  const pro = ler("supabase/functions/mesa-foto/ferramentas-pro.ts");

  it("o index registra as ações e todas são longas (resposta com fôlego)", () => {
    expect(index).toMatch(/import \{ ACOES_LONGAS_DAS_FERRAMENTAS_PRO, acoesDasFerramentasPro \} from "\.\/ferramentas-pro\.ts";/);
    expect(index).toMatch(/const FERRAMENTAS_PRO = acoesDasFerramentasPro\(FERRAMENTAS\);/);
    expect(index).toMatch(/\.\.\.FERRAMENTAS_PRO\.acoes,/);
    expect(index).toMatch(/\.\.\.ACOES_LONGAS_DAS_FERRAMENTAS_PRO,/);
    expect(pro).toMatch(/ACOES_LONGAS_DAS_FERRAMENTAS_PRO = \["ferramentas_estimar", "upscale", "remover_fundo", "ferramenta_retomar"\]/);
    for (const a of ["ferramentas_estimar: estimar", "upscale,", "remover_fundo: removerFundo", "ferramenta_retomar: retomar"]) expect(pro).toContain(a);
  });

  it("cobra pelo registro do motor, confere saldo antes e grava a derivada no acervo", () => {
    expect(pro).toMatch(/import \{ garantirSaldo, IaMotorErro, lerSaldo, type ModeloIa, type Qualidade, registrarUso \} from "\.\.\/_shared\/ia-motor\.ts";/);
    expect(pro).toMatch(/tarefa: "estudio",\n\s+agente: "gerador_imagem"/);
    expect(pro).toMatch(/origem: "agencia"/);
    expect(pro.indexOf("await garantirSaldo(clientId, plano.estimativa_usd)")).toBeLessThan(pro.indexOf("await enviarParaFila("));
    expect(pro).toMatch(/derivada_de: origem\.id/);
    expect(pro).toMatch(/modo: upscale \? "detalhe" : "preservar"/);
    expect(pro).toMatch(/upscale \? "upscale" : "sem_fundo"/);
    expect(pro).toMatch(/"ja_e_recorte"/);
    // A lógica do motor não foi mexida: o registro é chamado, não reescrito.
    expect(ler("supabase/functions/_shared/ia-motor.ts")).not.toMatch(/fal\.ai|FAL_KEY|ferramenta_imagem/);
  });

  it("a pesquisa registra fontes e recomendação", () => {
    const doc = ler("docs/ferramentas-imagem/PESQUISA.md");
    expect(doc).toMatch(/FAL_KEY/);
    expect(doc).toMatch(/https:\/\/fal\.ai\/models\/fal-ai\/topaz\/upscale\/image/);
    expect(doc).toMatch(/https:\/\/fal\.ai\/models\/fal-ai\/bria\/background\/remove/);
    expect(doc).toMatch(/Recomenda/);
  });
});

// ------------------------------------------------------------ front

describe("ferramentas de imagem: API da tela", () => {
  beforeEach(() => invocar.mockReset());

  it("estimativa normalizada e aviso de chave", async () => {
    invocar.mockResolvedValueOnce({
      data: {
        configurada: false,
        segredo: "FAL_KEY",
        provedor: "fal.ai",
        aviso: "Configure FAL_KEY nos segredos das funções do Supabase para ligar Ampliar e Tirar fundo (pro).",
        imagem: { id: "i1", largura: 1000, altura: 800 },
        saldo_usd: 5,
        opcoes: [
          { chave: "upscale_2x_fiel", motor: { rotulo: "Topaz (fiel)" }, fator: 2, fator_efetivo: 2, modo: "fiel", saida: { largura: 2000, altura: 1600 }, estimativa_usd: 0.08, avisos: [], impedimento: null, ja_existe: null },
          { chave: "remover_fundo", impedimento: { codigo: "ja_e_recorte", mensagem: "Esta foto já está sem fundo." }, ja_existe: null },
          { lixo: true },
        ],
      },
      error: null,
    });
    const e = await estimarFerramentas("c1", "i1");
    expect(invocar).toHaveBeenCalledWith("mesa-foto", expect.objectContaining({ body: expect.objectContaining({ acao: "ferramentas_estimar", client_id: "c1", imagem_id: "i1" }) }));
    expect(e.configurada).toBe(false);
    expect(e.aviso).toMatch(/FAL_KEY/);
    expect(e.opcoes).toHaveLength(2);
    expect(e.opcoes[0]).toMatchObject({ chave: "upscale_2x_fiel", estimativaUsd: 0.08, rotuloDoMotor: "Topaz (fiel)" });
    expect(e.opcoes[1].impedimento?.codigo).toBe("ja_e_recorte");
    expect(rotuloDoBotao(e.opcoes[0], false)).toMatch(/^Ampliar 2x \(fiel\) · US\$ 0,08/);
    expect(rotuloDoBotao({ ...e.opcoes[0], jaExiste: "d1" }, false)).toBe("Ampliar 2x (fiel): já feita");
    expect(normalizarEstimativa(null).opcoes).toEqual([]);
  });

  it("sem chave vira erro reconhecível pela tela", async () => {
    invocar.mockResolvedValueOnce({ data: { error: "ferramenta_sem_chave", mensagem: "Ampliar e Tirar fundo (pro) ainda não estão ligados: configure FAL_KEY.", segredo: "FAL_KEY" }, error: null });
    const erro = await ampliarImagem({ clientId: "c1", imagemId: "i1", fator: 2, modo: "fiel" }).catch((e) => e);
    expect(ehSemChave(erro)).toBe(true);
    expect(String(erro.message)).toMatch(/configure FAL_KEY/);
  });

  it("pedido lento: retoma pela ficha até ficar pronto e informa o andamento", async () => {
    invocar
      .mockResolvedValueOnce({ data: { situacao: "em_andamento", ficha: "f1", andamento: "processando", posicao: null }, error: null })
      .mockResolvedValueOnce({ data: { situacao: "pronto", imagem: { id: "d1", storage_bucket: "mesa", storage_path: "c1/foto/ferramentas/x.png", nome: "x", tags: ["sem_fundo"] }, url: "https://u", custo_usd: 0.018, cobrado: true }, error: null });
    const etapas: string[] = [];
    const r = await tirarFundoPro({ clientId: "c1", imagemId: "i1" }, (e) => etapas.push(e.etapa));
    expect(r).toMatchObject({ custoUsd: 0.018, cobrado: true, url: "https://u" });
    expect(r.imagem.tags).toEqual(["sem_fundo"]);
    expect(invocar.mock.calls[1][1].body).toMatchObject({ acao: "ferramenta_retomar", client_id: "c1", ficha: "f1" });
    expect(etapas).toEqual(["enviando", "processando"]);
    expect(textoDoAndamento({ etapa: "na_fila", posicao: 3, tentativa: 1 }, 12)).toBe("Na fila do provedor, posição 3 (12 s)");
  });

  it("gravação que falhou depois de pronto é retomada pela ficha, sem cobrar de novo", async () => {
    invocar
      .mockResolvedValueOnce({ data: { error: "gravacao_falhou", mensagem: "não entrou", ficha: "f2" }, error: null })
      .mockResolvedValueOnce({ data: { situacao: "pronto", imagem: { id: "d2", storage_bucket: "mesa", storage_path: "p", nome: "n", tags: [] }, url: null, custo_usd: 0, cobrado: false, ja_existia: true }, error: null });
    const r = await ampliarImagem({ clientId: "c1", imagemId: "i1", fator: 4, modo: "fiel" });
    expect(invocar.mock.calls[0][1].body).toMatchObject({ acao: "upscale", fator: 4, modo: "fiel" });
    expect(invocar.mock.calls[1][1].body).toMatchObject({ acao: "ferramenta_retomar", ficha: "f2" });
    expect(r).toMatchObject({ jaExistia: true, custoUsd: 0 });
  });
});
