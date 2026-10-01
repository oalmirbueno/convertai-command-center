/**
 * O que o Aceleriq Motores fala com o projeto Supabase (frente SUP, 01/10/2026).
 * Só `fetch`, sem dependência (o supervisor não precisa de npm ci).
 *
 * - batida da máquina (RPC motores_maquina_sinal): diz o que roda aqui e recebe
 *   de volta os motores desta máquina, se foi removida e a versão publicada;
 * - chaves dos provedores (RPC chaves_do_cofre, a mesma que as funções usam);
 * - o pacote de uma versão (Storage privado `motores-pacotes`, por URL assinada).
 *
 * A chave de serviço só vai em cabeçalho, nunca em URL nem em registro.
 */

export const BUCKET_DOS_PACOTES = "motores-pacotes";

export interface VersaoPublicada {
  versao: string;
  sha256: string;
  caminho: string;
  tamanho: number | null;
  publicada_em?: string | null;
}

export interface RespostaDoSinal {
  maquina_id: string;
  revogada: boolean;
  nome: string | null;
  motores: string[] | null;
  versao_alvo: VersaoPublicada | null;
}

export interface Banco {
  sinal(dados: {
    maquina_id: string | null;
    nome: string;
    hostname: string;
    sistema: string;
    versao: string | null;
    estado: Record<string, unknown>;
    executores: Record<string, string>;
  }): Promise<RespostaDoSinal>;
  chaves(nomes: string[]): Promise<Record<string, string>>;
  urlDoPacote(caminho: string, segundos?: number): Promise<string>;
  baixar(url: string): Promise<Uint8Array>;
}

type Buscar = (url: string, init?: RequestInit) => Promise<Response>;

function comPrazo(ms: number): AbortSignal | undefined {
  const t = (AbortSignal as unknown as { timeout?: (n: number) => AbortSignal }).timeout;
  return typeof t === "function" ? t.call(AbortSignal, ms) : undefined;
}

export function bancoSupabase(url: string, chave: () => string, buscar: Buscar = fetch): Banco {
  const base = url.replace(/\/+$/, "");
  const cab = () => ({ apikey: chave(), Authorization: `Bearer ${chave()}`, "Content-Type": "application/json" });
  async function rpc<T>(nome: string, corpo: Record<string, unknown>, prazo = 15_000): Promise<T> {
    const r = await buscar(`${base}/rest/v1/rpc/${nome}`, { method: "POST", headers: cab(), body: JSON.stringify(corpo), signal: comPrazo(prazo) });
    const texto = await r.text();
    if (!r.ok) {
      let msg = texto.slice(0, 200);
      try {
        const j = JSON.parse(texto) as { message?: string; code?: string };
        msg = `${j.code || ""} ${j.message || ""}`.trim() || msg;
      } catch {
        /* texto puro */
      }
      throw new Error(`${nome} respondeu ${r.status}: ${msg}`);
    }
    return (texto ? JSON.parse(texto) : null) as T;
  }
  return {
    async sinal(d) {
      const r = await rpc<RespostaDoSinal>("motores_maquina_sinal", {
        _maquina: d.maquina_id,
        _nome: d.nome,
        _hostname: d.hostname,
        _sistema: d.sistema,
        _versao: d.versao,
        _estado: d.estado,
        _executores: d.executores,
      });
      return {
        maquina_id: String(r?.maquina_id || d.maquina_id || ""),
        revogada: !!r?.revogada,
        nome: typeof r?.nome === "string" ? r.nome : null,
        motores: Array.isArray(r?.motores) ? r.motores.map(String) : null,
        versao_alvo: r?.versao_alvo && typeof r.versao_alvo === "object" && r.versao_alvo.versao ? r.versao_alvo : null,
      };
    },
    async chaves(nomes) {
      const d = (await rpc<Record<string, unknown>>("chaves_do_cofre", { _nomes: nomes }, 8000)) || {};
      const s: Record<string, string> = {};
      for (const k of Object.keys(d)) if (typeof d[k] === "string" && String(d[k]).trim()) s[k] = String(d[k]).trim();
      return s;
    },
    async urlDoPacote(caminho, segundos = 900) {
      const r = await buscar(`${base}/storage/v1/object/sign/${BUCKET_DOS_PACOTES}/${caminho.split("/").map(encodeURIComponent).join("/")}`, {
        method: "POST",
        headers: cab(),
        body: JSON.stringify({ expiresIn: segundos }),
        signal: comPrazo(15_000),
      });
      if (!r.ok) throw new Error(`o Storage não assinou o pacote (${r.status})`);
      const j = (await r.json()) as { signedURL?: string; signedUrl?: string };
      const assinado = j.signedURL || j.signedUrl;
      if (!assinado) throw new Error("o Storage não devolveu a URL do pacote");
      return /^https?:\/\//.test(assinado) ? assinado : `${base}/storage/v1${assinado.startsWith("/") ? "" : "/"}${assinado}`;
    },
    async baixar(u) {
      const r = await buscar(u, { signal: comPrazo(10 * 60_000) });
      if (!r.ok) throw new Error(`download do pacote respondeu ${r.status}`);
      return new Uint8Array(await r.arrayBuffer());
    },
  };
}
