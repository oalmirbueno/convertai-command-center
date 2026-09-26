/**
 * Guardar o resultado do provedor no Storage SEM carregar o arquivo inteiro
 * na memória (frente V-A, rodada 2, 26/09/2026).
 *
 * A Edge Function tem ~256 MB de memória e 2 s de CPU: um vídeo de 100 a 400
 * MB não pode virar um ArrayBuffer. Dois caminhos, escolhidos UMA vez (sem
 * repetir com o outro quando falha; o erro fica registrado e o botão
 * "Baixar de novo" da tela pede outra vez):
 *
 * 1. Tamanho conhecido (o provedor manda content-length): upload resumível
 *    TUS do Storage em partes de 6 MB (o tamanho que o Supabase exige),
 *    lendo o corpo do provedor aos poucos. Memória: uma parte por vez.
 *    Docs: supabase.com/docs/guides/storage/uploads/resumable-uploads
 *    (POST /storage/v1/upload/resumable com Upload-Length e Upload-Metadata;
 *    PATCH na Location com Upload-Offset e application/offset+octet-stream).
 * 2. Tamanho desconhecido: o corpo do provedor (ReadableStream) vai direto
 *    no corpo do POST /storage/v1/object/<bucket>/<caminho> com
 *    duplex "half" (transmissão, sem buffer; o storage-js faz o mesmo quando
 *    recebe um ReadableStream).
 *
 * Imagem pequena (ângulo) continua em memória: precisa dos bytes para a
 * miniatura e cabe (teto de 25 MB).
 *
 * Sem Deno.env aqui: a URL do projeto, a chave de serviço e o fetch vêm por
 * parâmetro (a função passa os do ambiente; o teste passa falsos).
 */

export const TAMANHO_DA_PARTE = 6 * 1024 * 1024;
export const MAX_BYTES_EM_MEMORIA = 25 * 1024 * 1024;
export const MAX_BYTES_DO_RESULTADO = 2 * 1024 * 1024 * 1024;

type Buscar = typeof fetch;

export interface DestinoNoStorage {
  supabaseUrl: string;
  chaveDeServico: string;
  bucket: string;
  caminho: string;
  contentType: string;
  fetchImpl?: Buscar;
}

const b64 = (s: string) => {
  const u = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < u.length; i++) bin += String.fromCharCode(u[i]);
  return btoa(bin);
};

function cabecalhosBase(d: DestinoNoStorage): Record<string, string> {
  return { Authorization: `Bearer ${d.chaveDeServico}`, apikey: d.chaveDeServico };
}

/** Metadado do TUS do Supabase: pares "chave base64" separados por vírgula. */
export function metadadoDoTus(d: Pick<DestinoNoStorage, "bucket" | "caminho" | "contentType">): string {
  return [`bucketName ${b64(d.bucket)}`, `objectName ${b64(d.caminho)}`, `contentType ${b64(d.contentType)}`, `cacheControl ${b64("3600")}`].join(",");
}

/**
 * Lê o corpo e entrega partes de exatamente `tamanho` bytes (a última pode
 * ser menor). Guarda no máximo uma parte na memória.
 */
export async function* emPartes(corpo: ReadableStream<Uint8Array>, tamanho = TAMANHO_DA_PARTE): AsyncGenerator<Uint8Array> {
  const leitor = corpo.getReader();
  let parte = new Uint8Array(tamanho);
  let cheio = 0;
  try {
    while (true) {
      const { value, done } = await leitor.read();
      if (done) break;
      let pos = 0;
      while (value && pos < value.byteLength) {
        const cabe = Math.min(tamanho - cheio, value.byteLength - pos);
        parte.set(value.subarray(pos, pos + cabe), cheio);
        cheio += cabe;
        pos += cabe;
        if (cheio === tamanho) {
          yield parte;
          parte = new Uint8Array(tamanho);
          cheio = 0;
        }
      }
    }
    if (cheio > 0) yield parte.subarray(0, cheio);
  } finally {
    leitor.releaseLock();
  }
}

/** Upload resumível (TUS) em partes de 6 MB. Devolve os bytes enviados. */
export async function subirPorPartes(d: DestinoNoStorage, corpo: ReadableStream<Uint8Array>, tamanhoTotal: number): Promise<number> {
  const f = d.fetchImpl || fetch;
  const base = d.supabaseUrl.replace(/\/+$/, "");
  const criar = await f(`${base}/storage/v1/upload/resumable`, {
    method: "POST",
    headers: { ...cabecalhosBase(d), "Tus-Resumable": "1.0.0", "Upload-Length": String(tamanhoTotal), "Upload-Metadata": metadadoDoTus(d), "x-upsert": "true" },
  });
  await criar.body?.cancel().catch(() => undefined);
  const local = criar.headers.get("location") || criar.headers.get("Location") || "";
  if (criar.status !== 201 || !local) throw new Error(`O armazenamento não abriu o envio em partes (${criar.status}).`);
  const alvo = /^https?:\/\//.test(local) ? local : `${base}${local.indexOf("/") === 0 ? "" : "/"}${local}`;
  let enviado = 0;
  for await (const parte of emPartes(corpo)) {
    const r = await f(alvo, {
      method: "PATCH",
      headers: { ...cabecalhosBase(d), "Tus-Resumable": "1.0.0", "Upload-Offset": String(enviado), "Content-Type": "application/offset+octet-stream" },
      body: parte as unknown as BodyInit,
    });
    await r.body?.cancel().catch(() => undefined);
    if (r.status !== 204 && r.status !== 200) throw new Error(`O armazenamento recusou uma parte (${r.status}).`);
    enviado += parte.byteLength;
  }
  if (enviado !== tamanhoTotal) throw new Error(`O arquivo chegou incompleto (${enviado} de ${tamanhoTotal} bytes).`);
  return enviado;
}

/** Upload transmitido: o corpo do provedor vai direto (duplex "half"), sem buffer. */
export async function subirPorTransmissao(d: DestinoNoStorage, corpo: ReadableStream<Uint8Array>): Promise<void> {
  const f = d.fetchImpl || fetch;
  const base = d.supabaseUrl.replace(/\/+$/, "");
  const caminho = d.caminho.split("/").map(encodeURIComponent).join("/");
  const r = await f(`${base}/storage/v1/object/${encodeURIComponent(d.bucket)}/${caminho}`, {
    method: "POST",
    headers: { ...cabecalhosBase(d), "Content-Type": d.contentType, "x-upsert": "true", "cache-control": "max-age=3600" },
    body: corpo,
    // deno-lint-ignore no-explicit-any
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  await r.body?.cancel().catch(() => undefined);
  if (r.status < 200 || r.status >= 300) throw new Error(`Não foi possível gravar no armazenamento (${r.status}).`);
}

export interface Guardado {
  bytes: number | null;
  mime: string;
  /** Só para imagem pequena (miniatura). */
  conteudo: Uint8Array | null;
  via: "partes" | "transmissao" | "memoria";
}

/**
 * Baixa do provedor e grava no Storage. Vídeo: nunca em memória inteira.
 * `tipo` diz se o provedor devolveu vídeo ou imagem.
 */
export async function guardarDoProvedor(url: string, tipo: "video" | "imagem", d: Omit<DestinoNoStorage, "contentType">, o: { timeoutMs?: number } = {}): Promise<Guardado> {
  const f = d.fetchImpl || fetch;
  const A = AbortSignal as unknown as { timeout?: (ms: number) => AbortSignal };
  const sinal = typeof A.timeout === "function" ? A.timeout(o.timeoutMs ?? 300_000) : undefined;
  let r: Response;
  try {
    r = await f(url, { signal: sinal });
  } catch {
    throw new Error("O arquivo do provedor não baixou (rede).");
  }
  if (!r.ok || !r.body) {
    await r.body?.cancel().catch(() => undefined);
    throw new Error(`O arquivo do provedor não baixou (${r.status}). O link do provedor pode ter vencido.`);
  }
  const tamanho = Number(r.headers.get("content-length") || 0) || null;
  if (tamanho !== null && tamanho > MAX_BYTES_DO_RESULTADO) {
    await r.body.cancel().catch(() => undefined);
    throw new Error("Arquivo grande demais para guardar.");
  }
  const tipoDoProvedor = (r.headers.get("content-type") || "").split(";")[0].trim();
  const mime = tipo === "video" ? (/^video\//.test(tipoDoProvedor) ? tipoDoProvedor : "video/mp4") : /^image\//.test(tipoDoProvedor) ? tipoDoProvedor : "image/png";
  const destino: DestinoNoStorage = { ...d, contentType: mime };
  if (tipo === "imagem" && (tamanho === null || tamanho <= MAX_BYTES_EM_MEMORIA)) {
    const bytes = new Uint8Array(await r.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES_EM_MEMORIA) throw new Error("Imagem grande demais.");
    const rs = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(bytes); c.close(); } });
    await subirPorPartes(destino, rs, bytes.byteLength);
    return { bytes: bytes.byteLength, mime, conteudo: bytes, via: "memoria" };
  }
  if (tamanho !== null) {
    const n = await subirPorPartes(destino, r.body, tamanho);
    return { bytes: n, mime, conteudo: null, via: "partes" };
  }
  await subirPorTransmissao(destino, r.body);
  return { bytes: null, mime, conteudo: null, via: "transmissao" };
}
