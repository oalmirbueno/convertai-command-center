/**
 * Pacote de contexto do cliente para o prompt de qualquer agente (frente AG,
 * 26/09), no padrão do diretor de fotografia (mesa-foto/diretor.ts,
 * contextoComCache): o cérebro da área e o dossiê atual (contextoParaAgente)
 * com cache curto no servidor e leitura em curso compartilhada. Cada mensagem
 * do agente não relê o banco; trocar de cliente lê de novo.
 *
 * Nunca lança: sem leitura, o texto volta vazio e o agente segue (o cliente
 * sem dossiê ainda tem conversa). Sem travessão.
 */
import { type AreaDoCerebro, type BancoDoCerebro, contextoParaAgente } from "./cerebro-do-cliente.ts";

export const TTL_DO_CONTEXTO_MS = 120_000;
export const MAX_CLIENTES_NO_CACHE = 40;

type Guardado = { em: number; texto: string };

/**
 * Cria o leitor com cache (um por função: o cache vive enquanto a instância
 * da Edge Function estiver quente). `ler` devolve o bloco pronto para o
 * sistema, com teto (cérebro e dossiê cortados).
 */
export function criarContextoDoAgente(opcoes: { ttlMs?: number; max?: number } = {}) {
  const ttl = opcoes.ttlMs ?? TTL_DO_CONTEXTO_MS;
  const max = opcoes.max ?? MAX_CLIENTES_NO_CACHE;
  const guardados = new Map<string, Guardado>();
  const emCurso = new Map<string, Promise<string>>();

  async function ler(
    db: BancoDoCerebro,
    clientId: string,
    areas: AreaDoCerebro[],
    limites: { cerebro?: number; dossie?: number; agora?: number } = {},
  ): Promise<string> {
    const chave = `${clientId}|${areas.join(",")}|${limites.cerebro ?? ""}|${limites.dossie ?? ""}`;
    const agora = limites.agora ?? Date.now();
    const g = guardados.get(chave);
    if (g && agora - g.em <= ttl) return g.texto;
    if (g) guardados.delete(chave);
    const pendente = emCurso.get(chave);
    if (pendente) return await pendente;
    const promessa = contextoParaAgente(db, clientId, areas[0] || "geral", { areas, limiteCerebro: limites.cerebro ?? 1200, limiteDossie: limites.dossie ?? 2500 })
      .then((c) => String(c.texto || "").trim(), () => "")
      .then((texto) => {
        if (guardados.size >= max) {
          const primeira = guardados.keys().next();
          if (!primeira.done) guardados.delete(primeira.value);
        }
        guardados.set(chave, { em: Date.now(), texto });
        return texto;
      });
    emCurso.set(chave, promessa);
    try {
      return await promessa;
    } finally {
      emCurso.delete(chave);
    }
  }

  /** Esquece o cliente (depois de gravar algo que muda o dossiê ou o cérebro). */
  function esquecer(clientId: string) {
    Array.from(guardados.keys()).forEach((k) => {
      if (k.indexOf(`${clientId}|`) === 0) guardados.delete(k);
    });
  }

  return { ler, esquecer, tamanho: () => guardados.size };
}

/** Bloco com título para o sistema do agente (vazio quando não há nada). */
export function blocoDoContextoDoCliente(texto: string, nome?: string | null): string {
  const t = String(texto || "").trim();
  if (!t) return "";
  return `CONTEXTO DO CLIENTE${nome ? ` (${nome})` : ""}: cérebro e dossiê do painel. Use para decidir; não repita inteiro.\n${t}`;
}
