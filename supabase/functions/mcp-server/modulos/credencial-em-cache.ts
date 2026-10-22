/**
 * MCP 2.17 (22/10/2026): a credencial conferida fica lembrada por 45 s.
 *
 * Antes, TODA chamada refazia a conferência inteira: no OAuth são cinco idas ao servidor
 * (RPC da chave de API, JWKS, cliente OAuth permitido, getUser, papéis e clientes da pessoa)
 * antes de a ferramenta começar. Numa conversa de agente com 20 chamadas, isso era o grosso da
 * espera. Agora a primeira chamada confere tudo e as seguintes, por 45 s, reaproveitam.
 *
 * Regras:
 * - só sucesso fica guardado (credencial recusada é conferida de novo na próxima);
 * - a chave do cache é o SHA-256 do token, nunca o token;
 * - nunca passa do vencimento do próprio JWT (exp);
 * - revogar uma chave vale em até 45 s (antes: na hora). Troca aceita pelo ganho de velocidade.
 */

export const TTL_DA_CREDENCIAL_MS = 45_000;
const MAXIMO = 500;

async function sha256(texto: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function bearerDe(req: Request): string | null {
  const h = req.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

/** Vencimento do JWT em ms (null se não for JWT ou não tiver exp). */
export function vencimentoDoJwt(token: string): number | null {
  const partes = token.split('.');
  if (partes.length !== 3) return null;
  try {
    const b64 = partes[1].replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((partes[1].length + 3) % 4);
    const claims = JSON.parse(atob(b64)) as { exp?: unknown };
    const exp = Number(claims.exp);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : null;
  } catch {
    return null;
  }
}

export class CredencialEmCache<R extends { ok: boolean }> {
  private readonly mapa = new Map<string, { resultado: R; ate: number }>();
  constructor(private readonly ttlMs = TTL_DA_CREDENCIAL_MS, private readonly agora: () => number = Date.now) {}

  async autenticar(req: Request, conferir: (req: Request) => Promise<R>): Promise<R> {
    const token = bearerDe(req);
    if (!token) return await conferir(req);
    const chave = await sha256(token);
    const guardada = this.mapa.get(chave);
    if (guardada && guardada.ate > this.agora()) return guardada.resultado;
    if (guardada) this.mapa.delete(chave);
    const resultado = await conferir(req);
    if (resultado.ok) {
      const vence = vencimentoDoJwt(token);
      const ate = Math.min(this.agora() + this.ttlMs, vence ?? Number.POSITIVE_INFINITY);
      if (ate > this.agora()) {
        if (this.mapa.size >= MAXIMO) {
          const primeira = this.mapa.keys().next().value;
          if (primeira !== undefined) this.mapa.delete(primeira);
        }
        this.mapa.set(chave, { resultado, ate });
      }
    }
    return resultado;
  }

  get tamanho() {
    return this.mapa.size;
  }
}
