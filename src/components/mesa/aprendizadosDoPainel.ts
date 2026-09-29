/**
 * "O que o painel aprendeu" (frente AP, 27/09/2026): o que o cérebro do
 * cliente guardou (public.agente_memoria) com a origem legível para a equipe:
 * entrega, ajuste, reprovação, números reais ou a própria equipe. Puro: a
 * tela e o Vitest usam o mesmo arquivo. Sem travessão.
 */

export type LinhaDaMemoria = {
  id: string;
  agente?: string | null;
  tipo?: string | null;
  texto: string;
  origem?: string | null;
  ativa?: boolean | null;
  criado_em?: string | null;
  categoria?: string | null;
  fonte?: string | null;
  reforcos?: number | null;
  reforcado_em?: string | null;
  area?: string | null;
  motivo?: string | null;
  /** A marca em que a regra foi aprendida (Acerbi ou CME), quando é marca do cliente. */
  referencia_id?: string | null;
  /** As mesas de mídia guardam a marca aqui ("marca:<id>"). */
  evidencia?: string | null;
};

/** Fontes das regras que o dono ensinou pedindo a um agente (esta frente, as mesas de mídia e a Central). */
const FONTES_DE_PEDIDO = ["mesa_foto", "mesa_videos", "mesa_edicao", "mesa_publicidade", "mesa_roteiros", "estilo", "estudio_aprendizado", "mesa_identidade", "mesa_naming", "mesa_site"];
const ehFonteDePedido = (f: unknown) => typeof f === "string" && (f.indexOf("agente_") === 0 || f.indexOf("aprendeu:") === 0 || FONTES_DE_PEDIDO.indexOf(f) >= 0);

/** 29/09: "pedido" = regra que o dono ensinou pedindo a um agente (fonte agente_*), com Esquecer na conversa. */
export type FonteDoAprendizado = "entrega" | "ajuste" | "reprovacao" | "desempenho" | "pedido" | "equipe";

export const ROTULO_DA_FONTE: Record<FonteDoAprendizado, string> = {
  entrega: "entrega",
  ajuste: "ajuste",
  reprovacao: "reprovação",
  desempenho: "números reais",
  pedido: "pedido ao agente",
  equipe: "equipe",
};

export const FILTROS_DOS_APRENDIZADOS: Array<{ valor: "todos" | FonteDoAprendizado; rotulo: string }> = [
  { valor: "todos", rotulo: "Todos" },
  { valor: "entrega", rotulo: "Entregas" },
  { valor: "ajuste", rotulo: "Ajustes" },
  { valor: "reprovacao", rotulo: "Reprovações" },
  { valor: "desempenho", rotulo: "Números reais" },
  { valor: "pedido", rotulo: "Pedidos aos agentes" },
];

/** De onde veio o aprendizado, pelas colunas do cérebro (e pelas antigas, tipo e origem). */
export function fonteDoAprendizado(l: LinhaDaMemoria): FonteDoAprendizado {
  if (l.fonte === "entrega" || l.categoria === "entrega") return "entrega";
  if (l.fonte === "desempenho" || l.categoria === "performou" || l.origem === "metrica") return "desempenho";
  if (l.categoria === "reprovado" || (l.origem === "aprovacao" && l.tipo === "evitar")) return "reprovacao";
  if (l.categoria === "ajuste" || l.origem === "ajuste") return "ajuste";
  if (ehFonteDePedido(l.fonte)) return "pedido";
  return "equipe";
}

/** Qual agente segue a regra, em palavras da equipe (agente_memoria.agente). */
export const ROTULO_DO_AGENTE: Record<string, string> = {
  geral: "Todos os agentes",
  estrategista: "Mês, campanhas e textos",
  diretor_arte: "Arte e fotos",
  estrategista_ads: "Anúncios e redes",
};

export const ROTULO_DA_AREA: Record<string, string> = {
  geral: "geral",
  calendario: "calendário",
  campanha: "campanhas",
  copy: "textos",
  arte: "arte",
  foto: "fotos",
  ads: "anúncios",
  conta: "perfil das redes",
};

/** Quem ensinou a regra (fonte gravada pelo agente). */
export const ROTULO_DA_ORIGEM: Record<string, string> = {
  agente_contexto: "agente de contexto",
  agente_do_mes: "agente do Mês",
  agente_da_campanha: "agente da campanha",
  agente_das_redes: "agente das redes",
  agente_do_perfil: "agente do perfil",
  mesa_foto: "Mesa Foto",
  mesa_videos: "Mesa Vídeos",
  mesa_edicao: "Mesa Edição",
  mesa_publicidade: "Mesa Publicidade",
  mesa_roteiros: "Mesa Roteiros",
  mesa_site: "Mesa Site",
  estilo: "agente de estilo",
  estudio_aprendizado: "Estúdio",
  mesa_identidade: "Mesa Identidade",
  mesa_naming: "criador de nomes",
  "aprendeu:central": "agente da Central",
  "aprendeu:geral": "assistente geral",
  "aprendeu:workspace": "agente do Workspace",
  "aprendeu:trafego": "agente de tráfego",
};

/** A marca da regra: "marca:<id>" na evidência (mesas de mídia) ou referencia_id (agentes da Mesa do cliente). */
export function marcaDoAprendizado(l: Pick<LinhaDaMemoria, "referencia_id" | "evidencia">): string | null {
  const m = /marca:([0-9a-f-]{36})/i.exec(String(l.evidencia || ""));
  if (m) return m[1];
  return l.referencia_id ? String(l.referencia_id) : null;
}

export type AprendizadoNaTela = {
  id: string;
  texto: string;
  motivo: string | null;
  fonte: FonteDoAprendizado;
  /** Quantas vezes o mesmo aprendizado se repetiu (1 = uma vez). */
  forca: number;
  data: string | null;
  /** 29/09: quem segue (agente), onde vale (área), se é "não fazer" e a marca. */
  agente: string;
  area: string | null;
  evitar: boolean;
  marca: string | null;
  origem: string | null;
};

/** O plano do mês combinado com o agente tem tela própria: fica fora desta lista. */
const ehPlanoDoMes = (t: string) => /^Plano do m[eê]s \d{4}-\d{2}:/.test(t);

/**
 * A lista da tela: só o que está valendo, fora o plano do mês, filtrada pela
 * origem, mais forte e mais recente primeiro.
 */
export function aprendizadosDoPainel(linhas: LinhaDaMemoria[] | null | undefined, filtro: "todos" | FonteDoAprendizado = "todos"): AprendizadoNaTela[] {
  return (linhas || [])
    .filter((l) => l && l.ativa !== false && typeof l.texto === "string" && l.texto.trim() && !ehPlanoDoMes(l.texto))
    .map((l) => ({
      id: String(l.id),
      texto: l.texto.trim(),
      motivo: l.motivo && String(l.motivo).trim() ? String(l.motivo).trim() : null,
      fonte: fonteDoAprendizado(l),
      forca: Math.max(1, Math.round(Number(l.reforcos) || 1)),
      data: l.reforcado_em || l.criado_em || null,
      agente: String(l.agente || "estrategista"),
      area: l.area ? String(l.area) : null,
      evitar: l.categoria === "evitar" || l.categoria === "reprovado" || (!l.categoria && l.tipo === "evitar"),
      marca: marcaDoAprendizado(l),
      origem: l.fonte && ROTULO_DA_ORIGEM[String(l.fonte)] ? ROTULO_DA_ORIGEM[String(l.fonte)] : null,
    }))
    .filter((a) => filtro === "todos" || a.fonte === filtro)
    .sort((a, b) => b.forca - a.forca || String(b.data || "").localeCompare(String(a.data || "")));
}

/** Resumo de uma linha do hub: quantos por origem. */
export function resumoDosAprendizados(lista: AprendizadoNaTela[]): string {
  if (!lista.length) return "Nada aprendido ainda";
  const conta = (f: FonteDoAprendizado) => lista.filter((a) => a.fonte === f).length;
  const partes = [
    conta("entrega") ? `${conta("entrega")} de entregas` : "",
    conta("ajuste") ? `${conta("ajuste")} de ajustes` : "",
    conta("reprovacao") ? `${conta("reprovacao")} de reprovações` : "",
    conta("desempenho") ? `${conta("desempenho")} de números reais` : "",
  ].filter(Boolean);
  return partes.length ? partes.join(" · ") : `${lista.length} da equipe`;
}

export const dataCurtaDoAprendizado = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : "");

/**
 * Filtro da marca (29/09): "todas" mostra tudo; uma marca mostra o que vale
 * nela (sem marca e o dela). A regra de outra marca do cliente fica de fora.
 * referencia_id que não é marca (tarefa, peça) conta como sem marca.
 */
export function aprendizadosDaMarca(lista: AprendizadoNaTela[], marcaId: string | null | "todas", marcasDoCliente: string[]): AprendizadoNaTela[] {
  if (!marcaId || marcaId === "todas") return lista;
  const marcas = new Set(marcasDoCliente);
  return lista.filter((a) => !a.marca || !marcas.has(a.marca) || a.marca === marcaId);
}

/** Grupos da tela: por agente, na ordem Todos, Mês, Arte, Anúncios; dentro, "não fazer" primeiro. */
export function gruposDosAprendizados(lista: AprendizadoNaTela[]): Array<{ agente: string; rotulo: string; itens: AprendizadoNaTela[] }> {
  const ordem = ["geral", "estrategista", "diretor_arte", "estrategista_ads"];
  const grupos = new Map<string, AprendizadoNaTela[]>();
  for (const a of lista) {
    const k = ordem.indexOf(a.agente) >= 0 ? a.agente : "estrategista";
    grupos.set(k, (grupos.get(k) || []).concat(a));
  }
  return ordem
    .filter((k) => grupos.has(k))
    .map((k) => ({
      agente: k,
      rotulo: ROTULO_DO_AGENTE[k] || k,
      itens: (grupos.get(k) || []).slice().sort((x, y) => Number(y.evitar) - Number(x.evitar)),
    }));
}

/** Chave de deduplicação do cérebro (espelho de chaveDoAprendizado em _shared/cerebro-do-cliente.ts), para a edição do texto. */
export function chaveDoTexto(texto: string): string {
  return String(texto || "")
    .normalize("NFD")
    .replace(new RegExp(`[${String.fromCharCode(0x300)}-${String.fromCharCode(0x36f)}]`, "g"), "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160);
}
