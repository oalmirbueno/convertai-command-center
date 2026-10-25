/**
 * Regras puras do worker da Máquina de leads (25/10/2026): o protocolo de linhas do buscar.py e a linha
 * de leads_candidatos. Sem rede e sem dependência (os testes rodam com node --test).
 */

export type EventoDaBusca =
  | { tipo: "progresso"; etapa: string; feitos: number; total: number }
  | { tipo: "candidato"; [k: string]: unknown }
  | { tipo: "fim"; encontrados: number }
  | { tipo: "erro"; mensagem: string };

/** Uma linha da saída do Python: evento ou null (log, linha vazia, JSON quebrado). */
export function eventoDaLinha(linha: string): EventoDaBusca | null {
  const t = linha.trim();
  if (!t.startsWith("{")) return null;
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    if (o.tipo === "progresso") return { tipo: "progresso", etapa: String(o.etapa || "").slice(0, 160), feitos: Math.max(0, Number(o.feitos) || 0), total: Math.max(0, Number(o.total) || 0) };
    if (o.tipo === "candidato") return o as EventoDaBusca;
    if (o.tipo === "fim") return { tipo: "fim", encontrados: Math.max(0, Number(o.encontrados) || 0) };
    if (o.tipo === "erro") return { tipo: "erro", mensagem: String(o.mensagem || "falha sem mensagem").slice(0, 300) };
  } catch {
    /* não é evento */
  }
  return null;
}

const txt = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

/** O candidato do Python vira a linha de leads_candidatos (só os campos da tabela; o resto vai nas evidências). */
export function linhaDoCandidato(buscaId: string, c: Record<string, unknown>): Record<string, unknown> | null {
  const nome = txt(c.nome, 200);
  const chave = txt(c.chave, 120);
  if (!nome || !chave) return null;
  const evidencias = (Array.isArray(c.evidencias) ? c.evidencias : [])
    .filter((e) => e && typeof e === "object")
    .slice(0, 40)
    .map((e) => {
      const o = e as Record<string, unknown>;
      return { campo: txt(o.campo, 40), valor: txt(o.valor, 600), fonte: txt(o.fonte, 30), url: txt(o.url, 500) };
    });
  if (txt(c.cnpj, 20)) evidencias.push({ campo: "cnpj_numero", valor: txt(c.cnpj, 20), fonte: "site", url: txt(c.site, 500) });
  return {
    busca_id: buscaId,
    chave,
    nome,
    categoria: txt(c.categoria, 80),
    site: txt(c.site, 500),
    telefone: txt(c.telefone, 30),
    whatsapp: txt(c.whatsapp, 30),
    email: txt(c.email, 200),
    instagram: txt(c.instagram, 60),
    endereco: txt(c.endereco, 300),
    cidade: txt(c.cidade, 120),
    fonte: txt(c.fonte, 30) || "osm",
    fonte_url: txt(c.fonte_url, 500),
    evidencias,
  };
}

/** O que vai para leads_buscas.progresso (a tela mostra "Lendo os sites, 12 de 40"). */
export function progressoDaBusca(e: { etapa: string; feitos: number; total: number }) {
  return { etapa: e.etapa, feitos: e.feitos, total: e.total, em: new Date().toISOString() };
}

/** A busca para o Python (só o que ele lê). */
export function entradaDoPython(b: Record<string, unknown>) {
  return {
    id: b.id,
    nicho: String(b.nicho || ""),
    cidade: String(b.cidade || ""),
    uf: b.uf ? String(b.uf) : null,
    fontes: Array.isArray(b.fontes) ? b.fontes.map(String) : ["osm", "sites"],
    limite: Math.max(1, Math.min(300, Number(b.limite) || 50)),
    urls: Array.isArray(b.urls) ? b.urls.map(String).slice(0, 300) : [],
  };
}

/** Tira chave e token de mensagens de erro (nunca vão para o banco nem para o registro). */
export function semSegredo(t: string): string {
  return String(t || "")
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[chave]")
    .replace(/(apikey|authorization|bearer)[=:\s]+[^\s,;]+/gi, "$1 [chave]")
    .slice(0, 300);
}
