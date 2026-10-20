/**
 * Laboratório (20/10/2026, "nós inteligentes"): regras puras de fontes_do_cliente, no_preencher,
 * ler_documento e do rodar automático. Sem Deno e sem banco (o servidor está em ../inteligencia.ts).
 */
import {
  ALVOS_NO_AR,
  CAMPOS_DO_TIPO,
  CANAIS_DE_MENSAGEM,
  dadosDoTipo,
  FORMATOS_DE_COPY,
  FORMATOS_DO_FILME,
  OBJETIVOS_DA_PAGINA,
  OPCOES_V4,
  PAPEIS_DO_AGENTE,
  PROPORCOES,
  TIPOS_DA_PAGINA_DO_FUNIL,
  TIPOS_DE_PAGINA,
  type TipoDeNo,
} from "./regras.ts";

const txt = (v: unknown, max = 4000) => (typeof v === "string" ? v.trim().slice(0, max) : typeof v === "number" ? String(v) : "");

// ------------------------------------------------------------------ fontes_do_cliente

export type MidiaDoCliente = { id: string; tipo: "imagem" | "video"; url: string; miniatura_url: string | null; nome: string; origem: string; criado_em?: string };
export type DocumentoDoCliente = { id: string; nome: string; tipo: string; url: string };
export type FontesDoCliente = {
  cliente: { id: string; nome: string; nicho: string | null } | null;
  dossie: { resumo: string; pontos: string[] } | null;
  marca: { cores: string[]; fontes: string[]; tom: string; logo_url: string | null; nunca: string[] } | null;
  midias: MidiaDoCliente[];
  documentos: DocumentoDoCliente[];
  /** 20/10: as marcas do cliente (cliente_marcas), para o seletor do nó Marca. Uma marca só ou nenhuma: lista vazia ou de 1. */
  marcas: Array<{ id: string; nome: string }>;
};

export const MAX_MIDIAS_DAS_FONTES = 60;
export const MAX_DOCUMENTOS_DAS_FONTES = 40;
export const MAX_RESUMO_DO_DOSSIE = 1500;

/** Resumo (até 1.500) e os pontos (diferenciais e os movimentos visíveis mais recentes). Nada: null. */
export function montarDossie(o: { dossie: string | null; diferenciais?: unknown; movimentos?: Array<{ quando?: string; titulo?: string }> }): FontesDoCliente["dossie"] {
  const resumo = String(o.dossie || "").replace(/\[[a-z_ ]{2,30}\]\n?/gi, "").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const corte = resumo.length > MAX_RESUMO_DO_DOSSIE ? `${resumo.slice(0, MAX_RESUMO_DO_DOSSIE - 1).replace(/\s+\S*$/, "")}…` : resumo;
  const pontos: string[] = [];
  for (const d of Array.isArray(o.diferenciais) ? o.diferenciais : []) {
    const t = txt(d, 200);
    if (t && pontos.length < 4) pontos.push(t);
  }
  for (const m of (o.movimentos || []).slice(0, 6)) {
    const t = txt(m.titulo, 160);
    const q = txt(m.quando, 10);
    if (t) pontos.push(q ? `${q.slice(8, 10)}/${q.slice(5, 7)}: ${t}` : t);
  }
  if (!corte && !pontos.length) return null;
  return { resumo: corte, pontos };
}

/** A marca para a tela: cores (#hex), fontes, tom, logo e o que ela nunca faz. Tudo vazio: null. */
export function marcaParaATela(m: { paleta?: Array<{ hex?: string }>; fontes?: Array<{ nome?: string }>; tomDeVoz?: string | null; estilo?: string | null; regras?: string | null } | null, logoUrl: string | null): FontesDoCliente["marca"] {
  if (!m) return null;
  const cores = (m.paleta || []).map((p) => txt(p && p.hex, 9).toLowerCase()).filter((h, i, a) => /^#[0-9a-f]{3}([0-9a-f]{3})?$/.test(h) && a.indexOf(h) === i).slice(0, 8);
  const fontes = (m.fontes || []).map((f) => txt(f && f.nome, 80)).filter((f, i, a) => f && a.indexOf(f) === i).slice(0, 6);
  const tom = txt(m.tomDeVoz, 600) || txt(m.estilo, 600);
  const nunca = txt(m.regras, 3000).split(/\n|;|•/).map((l) => l.replace(/^[-*\s]+/, "").trim()).filter((l) => l.length > 2).slice(0, 8);
  if (!cores.length && !fontes.length && !tom && !logoUrl && !nunca.length) return null;
  return { cores, fontes, tom, logo_url: logoUrl, nunca };
}

/** Tipo da mídia pelo mime ou pela extensão (null = não é imagem nem vídeo). */
export function tipoDaMidia(mime: string | null | undefined, nome: string): "imagem" | "video" | null {
  const m = String(mime || "").toLowerCase();
  if (m.indexOf("image/") === 0 || /\.(png|jpe?g|webp|gif|avif)$/i.test(nome)) return "imagem";
  if (m.indexOf("video/") === 0 || /\.(mp4|mov|webm|m4v)$/i.test(nome)) return "video";
  return null;
}

/** Junta as mídias (mais recentes primeiro, sem repetir o id), até 60. */
export function juntarMidias(listas: MidiaDoCliente[][], max = MAX_MIDIAS_DAS_FONTES): MidiaDoCliente[] {
  const vistos = new Set<string>();
  return listas
    .flat()
    .filter((m) => m.url && !vistos.has(m.id) && vistos.add(m.id))
    .sort((a, b) => String(b.criado_em || "").localeCompare(String(a.criado_em || "")))
    .slice(0, max);
}

// ------------------------------------------------------------------ no_preencher

/**
 * Campos que a IA NÃO preenche: técnicos (modelo, motor, operador, qualidade), anexos, o que multiplica o
 * custo (quantidade, lâminas, variações...), o destino do Pôr no ar e o que é fato do dono (links de
 * pagamento, domínio, gateway, data, remetente, responsável, transcrição). Inventar isso seria pior que
 * deixar em branco.
 */
export const CAMPOS_FORA_DO_PREENCHER = [
  "modelo_id", "motor", "operador", "qualidade", "auto",
  "imagens", "referencias", "arquivos", "logo", "midias",
  "quantidade", "laminas", "n", "mensagens", "perguntas", "modulos", "aulas_por_modulo", "toques", "duracao", "variacoes", "poses",
  "alvo", "gateway", "link_pagamento", "order_bump", "upsell", "produto_externo_id", "link_externo", "link", "link_video", "url_base",
  "dominio", "subdominio", "registrador", "redirecionamentos", "links", "transcricao", "data", "remetente", "responsavel", "lote", "client_id",
] as const;

/** Os campos que a IA pode preencher neste tipo (pedidos: só esses, se vierem). */
export function camposPreenchiveis(tipo: TipoDeNo, pedidos?: unknown): string[] {
  const todos = (CAMPOS_DO_TIPO[tipo] || []).filter((c) => (CAMPOS_FORA_DO_PREENCHER as readonly string[]).indexOf(c) < 0);
  if (!Array.isArray(pedidos) || !pedidos.length) return todos;
  const lista = pedidos.map((p) => String(p));
  return todos.filter((c) => lista.indexOf(c) >= 0);
}

/** As opções de um campo de escolha (null = texto livre). */
export function opcoesDoCampo(tipo: TipoDeNo, campo: string): readonly string[] | null {
  if (campo === "proporcao") return PROPORCOES;
  if (campo === "formato") return tipo === "filme" ? FORMATOS_DO_FILME : FORMATOS_DE_COPY;
  if (campo === "tipo_pagina") return tipo === "pagina" ? TIPOS_DA_PAGINA_DO_FUNIL : TIPOS_DE_PAGINA;
  if (campo === "canal") return CANAIS_DE_MENSAGEM;
  if (campo === "alvo") return ALVOS_NO_AR;
  if (campo === "papel") return PAPEIS_DO_AGENTE;
  if (campo === "objetivo" && tipo === "pagina") return OBJETIVOS_DA_PAGINA;
  return OPCOES_V4[campo] || null;
}

/** Esquema da resposta: um campo por chave (escolha com a lista, vazio permitido) e a explicação. */
export function esquemaDoPreenchimento(tipo: TipoDeNo, campos: string[]) {
  const props: Record<string, unknown> = {};
  for (const c of campos) {
    const op = opcoesDoCampo(tipo, c);
    props[c] = op ? { type: "string", enum: [...op, ""] } : { type: "string" };
  }
  props.explicacao = { type: "string" };
  return { nome: "preenchimento_do_no", schema: { type: "object", additionalProperties: false, required: [...campos, "explicacao"], properties: props } };
}

export const SISTEMA_DO_PREENCHER = `Você preenche os campos de UM nó do Laboratório da Aceleriq (agência de marketing), em português do Brasil, a partir das fontes que vierem: as entradas ligadas ao nó, o dossiê e a marca do cliente, os documentos anexados e o pedido do dono.
- Preencha só os campos pedidos, curto e pronto para usar (o nó vai rodar com eles). Campo de escolha: um dos valores da lista, ou vazio.
- NÃO INVENTE: preço, número, porcentagem, prazo, depoimento, nome de cliente ou resultado só entram se estiverem nas fontes. Sem fonte, deixe o campo vazio ou escreva [PREENCHER: o que falta].
- Use o tom e as palavras da marca quando vierem. Sem travessão e sem clichê de IA.
- "explicacao": uma frase (até 300 caracteres) dizendo de onde veio o que você preencheu e o que ficou para o dono preencher.`;

/** Números (preço, %, quantidade) que o texto tem e as fontes não: viram [PREENCHER: número]. */
export function marcarNumerosSemFonte(valor: string, fontes: string): string {
  const base = fontes.replace(/\s+/g, " ");
  return valor.replace(/(R\$\s?)?\d+(?:[.,]\d+)*(\s?%)?/g, (m) => {
    const so = m.replace(/^R\$\s?/, "").replace(/\s?%$/, "");
    // Número pequeno solto (1 a 10: passos, dias, itens de lista) não é afirmação de fato.
    if (!/R\$|%/.test(m) && /^\d{1,2}$/.test(so) && Number(so) <= 10) return m;
    return base.indexOf(so) >= 0 ? m : "[PREENCHER: número]";
  });
}

/**
 * A resposta do modelo vira `dados` do nó: só os campos pedidos (e que o tipo aceita, pela dadosDoTipo),
 * sem vazio, com número sem fonte marcado. A explicação até 300 caracteres.
 */
export function limparPreenchimento(tipo: TipoDeNo, campos: string[], json: unknown, fontes: string): { dados: Record<string, unknown>; explicacao: string; ignorados: string[] } {
  const o = json && typeof json === "object" && !Array.isArray(json) ? (json as Record<string, unknown>) : {};
  const bruto: Record<string, unknown> = {};
  for (const c of campos) {
    const v = o[c];
    if (typeof v !== "string" || !v.trim()) continue;
    bruto[c] = opcoesDoCampo(tipo, c) ? v.trim() : marcarNumerosSemFonte(v.trim(), fontes);
  }
  const { dados, ignorados } = dadosDoTipo(tipo, bruto);
  return { dados, explicacao: txt(o.explicacao, 300), ignorados };
}

/** Tokens de entrada estimados do preenchimento (sistema + fontes) e a saída esperada. */
export function tamanhoDoPreenchimento(fontes: string, campos: number): { entrada: number; saida: number } {
  return { entrada: 900 + Math.ceil(fontes.length / 3.5), saida: Math.min(3000, 250 + campos * 220) };
}

// ------------------------------------------------------------------ rodar automático

/** Teto do automático do projeto (config.auto_ate_usd): número de 0 a 5; o resto vira 0. */
export const TETO_MAXIMO_DO_AUTOMATICO = 5;
export function tetoDoAutomatico(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.round(Math.min(TETO_MAXIMO_DO_AUTOMATICO, n) * 100) / 100;
}

/** O valor pedido para o teto: null quando não é número de 0 a 5 (a ação recusa, não corrige). */
export function tetoPedido(v: unknown): number | null {
  const n = typeof v === "number" ? v : NaN;
  if (!Number.isFinite(n) || n < 0 || n > TETO_MAXIMO_DO_AUTOMATICO) return null;
  return Math.round(n * 100) / 100;
}

export type DecisaoDoAutomatico = { ok: boolean; motivo: string };

/**
 * Roda sem a confirmação (sem o 409)? Só se a tela pediu automatico, o nó tem auto: true, o projeto tem
 * teto e o custo estimado cabe nele. O crédito é conferido depois, na reserva (sem saldo: 402).
 */
export function decidirAutomatico(o: { automatico: unknown; auto: unknown; custo: number; teto: number }): DecisaoDoAutomatico {
  if (o.automatico !== true) return { ok: false, motivo: "" };
  if (o.auto !== true) return { ok: false, motivo: "Este nó não está no automático." };
  if (!(o.teto > 0)) return { ok: false, motivo: "O projeto não tem teto para rodar sozinho (config.auto_ate_usd)." };
  if (!(o.custo >= 0) || o.custo > o.teto) return { ok: false, motivo: `Custa cerca de US$ ${o.custo.toFixed(4)}, acima do teto de US$ ${o.teto.toFixed(2)} do automático.` };
  return { ok: true, motivo: "" };
}

/** config do projeto lida do banco (só o que a função usa). */
export function configDoProjeto(v: unknown): { auto_ate_usd: number } {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  return { auto_ate_usd: tetoDoAutomatico(o.auto_ate_usd) };
}
