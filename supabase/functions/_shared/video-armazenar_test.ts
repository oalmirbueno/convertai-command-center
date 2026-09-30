/**
 * Guardar o resultado do provedor sem carregar o arquivo inteiro na memória
 * (frente V-A, rodada 2). Um "vídeo" simulado de 300 MB é gerado aos poucos
 * e enviado em partes de 6 MB; a memória residente não pode crescer junto.
 *
 *   deno test supabase/functions/_shared/video-armazenar_test.ts
 */
import { emPartes, guardarDoProvedor, metadadoDoTus, TAMANHO_DA_PARTE } from "../mesa-videos/modulos/video-armazenar.ts";

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const MB = 1024 * 1024;

/** Stream grande sob demanda: pedaços de 64 KB, nunca o todo na memória. */
function streamGrande(total: number, pedaco = 64 * 1024): ReadableStream<Uint8Array> {
  let enviado = 0;
  const bloco = new Uint8Array(pedaco).fill(7);
  return new ReadableStream<Uint8Array>({
    pull(c) {
      if (enviado >= total) return c.close();
      const n = Math.min(pedaco, total - enviado);
      enviado += n;
      c.enqueue(n === pedaco ? bloco.slice() : bloco.slice(0, n));
    },
  });
}

Deno.test("partes de exatamente 6 MB e a última menor", async () => {
  const tamanhos: number[] = [];
  for await (const p of emPartes(streamGrande(13 * MB + 5))) tamanhos.push(p.byteLength);
  assert(JSON.stringify(tamanhos) === JSON.stringify([TAMANHO_DA_PARTE, TAMANHO_DA_PARTE, MB + 5]), `partes: ${tamanhos}`);
});

Deno.test("vídeo de 300 MB vai em partes (TUS) sem a memória crescer junto", async () => {
  const total = 300 * MB;
  const chamadas: { metodo: string; url: string; offset: string | null; bytes: number }[] = [];
  let recebido = 0;
  const falso = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    const h = new Headers(init?.headers);
    if (u.indexOf("https://provedor.test/") === 0) {
      return new Response(streamGrande(total), { status: 200, headers: { "content-length": String(total), "content-type": "video/mp4" } });
    }
    if (u.endsWith("/storage/v1/upload/resumable")) {
      assert(h.get("Upload-Length") === String(total), "Upload-Length");
      assert(h.get("Upload-Metadata") === metadadoDoTus({ bucket: "mesa", caminho: "c/video/gerados/p-1.mp4", contentType: "video/mp4" }), "metadado");
      chamadas.push({ metodo: "POST", url: u, offset: null, bytes: 0 });
      return new Response(null, { status: 201, headers: { Location: "/storage/v1/upload/resumable/abc" } });
    }
    const corpo = init?.body as Uint8Array;
    recebido += corpo.byteLength;
    chamadas.push({ metodo: String(init?.method), url: u, offset: h.get("Upload-Offset"), bytes: corpo.byteLength });
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  const antes = Deno.memoryUsage().rss;
  let pico = antes;
  const relogio = setInterval(() => (pico = Math.max(pico, Deno.memoryUsage().rss)), 5);
  const g = await guardarDoProvedor("https://provedor.test/v.mp4", "video", { supabaseUrl: "https://proj.supabase.co", chaveDeServico: "k", bucket: "mesa", caminho: "c/video/gerados/p-1.mp4", fetchImpl: falso });
  clearInterval(relogio);
  pico = Math.max(pico, Deno.memoryUsage().rss);

  assert(g.via === "partes" && g.bytes === total && g.conteudo === null, `resultado ${JSON.stringify({ ...g, conteudo: null })}`);
  assert(recebido === total, "bytes recebidos");
  const patches = chamadas.filter((c) => c.metodo === "PATCH");
  assert(patches.length === Math.ceil(total / TAMANHO_DA_PARTE), `partes: ${patches.length}`);
  assert(patches[1].offset === String(TAMANHO_DA_PARTE), "offset da segunda parte");
  assert(patches[0].url === "https://proj.supabase.co/storage/v1/upload/resumable/abc", "url da parte");
  const cresceu = (pico - antes) / MB;
  // 300 MB passaram; a memória pode subir algumas partes (e o GC), nunca o arquivo inteiro.
  console.log(`memória: +${cresceu.toFixed(0)} MB para 300 MB transmitidos`);
  assert(cresceu < 120, `memória cresceu ${cresceu.toFixed(0)} MB`);
});

Deno.test("sem content-length: transmissão direta (duplex half), sem buffer", async () => {
  let duplex = "";
  let lidos = 0;
  const falso = (async (url: string | URL | Request, init?: RequestInit & { duplex?: string }) => {
    const u = String(url);
    if (u.indexOf("https://provedor.test/") === 0) return new Response(streamGrande(20 * MB), { status: 200, headers: { "content-type": "video/mp4" } });
    duplex = init?.duplex || "";
    const r = (init?.body as ReadableStream<Uint8Array>).getReader();
    while (true) {
      const { value, done } = await r.read();
      if (done) break;
      lidos += value.byteLength;
    }
    assert(u === "https://proj.supabase.co/storage/v1/object/mesa/c/video/gerados/p%20x-1.mp4", `url ${u}`);
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  const g = await guardarDoProvedor("https://provedor.test/v", "video", { supabaseUrl: "https://proj.supabase.co/", chaveDeServico: "k", bucket: "mesa", caminho: "c/video/gerados/p x-1.mp4", fetchImpl: falso });
  assert(g.via === "transmissao" && duplex === "half" && lidos === 20 * MB, `via ${g.via} duplex ${duplex} lidos ${lidos}`);
});

Deno.test("link vencido do provedor: erro claro, nada enviado", async () => {
  let storage = 0;
  const falso = (async (url: string | URL | Request) => {
    if (String(url).indexOf("https://provedor.test/") === 0) return new Response("expirado", { status: 403 });
    storage++;
    return new Response(null, { status: 204 });
  }) as typeof fetch;
  let msg = "";
  try {
    await guardarDoProvedor("https://provedor.test/v", "video", { supabaseUrl: "https://p", chaveDeServico: "k", bucket: "mesa", caminho: "x.mp4", fetchImpl: falso });
  } catch (e) {
    msg = (e as Error).message;
  }
  assert(/403/.test(msg) && /vencido/.test(msg) && storage === 0, msg);
});
