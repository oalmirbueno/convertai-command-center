/**
 * Resposta com fôlego para ações longas (IA, rodadas de qualidade, imagem).
 *
 * A plataforma derruba com 504 a função que não começa a responder em 150 s
 * ("request idle timeout"), mesmo com o relógio de 400 s do plano Pro. Aqui a
 * resposta começa na hora: cabeçalho 200 com JSON, um espaço a cada poucos
 * segundos enquanto o trabalho roda e, no fim, o corpo JSON do trabalho.
 * Espaço antes do JSON é válido para JSON.parse, então o supabase-js lê igual.
 *
 * O status HTTP real do trabalho não chega ao navegador (o cabeçalho já saiu
 * com 200). Por isso o corpo de erro precisa ter o campo `error` com o código,
 * que é o que a tela lê (chamarFuncao em src/lib/mesa/api.ts); o status fica
 * em `status_http` para quem precisar.
 */
export const INTERVALO_DO_FOLEGO_MS = 10_000;

export function respostaComFolego(
  trabalho: () => Promise<Response>,
  cabecalhos: Record<string, string>,
  intervaloMs = INTERVALO_DO_FOLEGO_MS,
): Response {
  const codificar = new TextEncoder();
  let relogio: ReturnType<typeof setInterval> | undefined;
  const corpo = new ReadableStream<Uint8Array>({
    async start(controle) {
      const soltar = (texto: string) => {
        try {
          controle.enqueue(codificar.encode(texto));
        } catch { /* o navegador já fechou a conexão */ }
      };
      soltar(" ");
      relogio = setInterval(() => soltar(" "), intervaloMs);
      let final: string;
      try {
        const r = await trabalho();
        const texto = await r.text();
        final = r.ok ? texto : comStatus(texto, r.status);
      } catch (e) {
        console.error("resposta-com-folego: falha inesperada", { erro: e instanceof Error ? e.name : "desconhecido" });
        final = JSON.stringify({ error: "falha_interna", mensagem: "O serviço falhou ao processar o pedido. Tente de novo.", status_http: 500 });
      } finally {
        if (relogio !== undefined) clearInterval(relogio);
      }
      soltar(final);
      try {
        controle.close();
      } catch { /* já fechado */ }
    },
    cancel() {
      if (relogio !== undefined) clearInterval(relogio);
    },
  });
  return new Response(corpo, {
    status: 200,
    headers: { ...cabecalhos, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

/** Garante `error` e `status_http` no corpo de uma resposta de erro. */
function comStatus(texto: string, status: number): string {
  try {
    const obj = JSON.parse(texto);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      if (typeof obj.error !== "string") obj.error = typeof obj.codigo === "string" ? obj.codigo : "falha_interna";
      obj.status_http = status;
      return JSON.stringify(obj);
    }
  } catch { /* corpo não é JSON */ }
  return JSON.stringify({ error: "falha_interna", mensagem: texto.slice(0, 500) || "Falha no serviço.", status_http: status });
}
