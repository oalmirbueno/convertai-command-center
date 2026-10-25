/**
 * Regras puras da Máquina de leads (25/10/2026): a busca pedida, o perfil de cliente ideal da Aceleriq,
 * as perguntas ao Jev (Score de encaixe, uma por candidato) e o candidato que vira lead do CRM.
 * Sem Deno e sem banco: a tela (src/) e o Vitest importam o mesmo arquivo. Sem lookbehind, sem classe
 * Unicode e sem grupo nomeado (Safari 11).
 */

export const FONTES_DA_BUSCA = ["osm", "sites", "cnpj", "lista"] as const;
export type FonteDaBusca = (typeof FONTES_DA_BUSCA)[number];

export const ROTULO_DA_FONTE: Record<FonteDaBusca, string> = {
  osm: "Mapa (OpenStreetMap)",
  sites: "Site da empresa",
  cnpj: "CNPJ (BrasilAPI)",
  lista: "Sites que eu colar",
};

export const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];

export interface PedidoDeBusca {
  nicho: string;
  cidade: string;
  uf: string | null;
  fontes: FonteDaBusca[];
  limite: number;
  campanha_id: string | null;
  entregar_ao_mercurio: boolean;
  urls: string[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const limpo = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** A busca em forma fixa, ou o motivo de não aceitar. */
export function normalizarBusca(o: Record<string, unknown>): { busca: PedidoDeBusca } | { erro: string } {
  const fontes = (Array.isArray(o.fontes) ? o.fontes : ["osm", "sites"])
    .map(String)
    .filter((f, i, l): f is FonteDaBusca => (FONTES_DA_BUSCA as readonly string[]).indexOf(f) >= 0 && l.indexOf(f) === i);
  const urls = (Array.isArray(o.urls) ? o.urls : typeof o.urls === "string" ? String(o.urls).split(/[\s,;]+/) : [])
    .map((u) => limpo(u, 300))
    .filter((u) => /^(https?:\/\/)?[a-z0-9.-]+\.[a-z]{2,}(\/[^\s]*)?$/i.test(u))
    .slice(0, 300);
  if (urls.length && fontes.indexOf("lista") < 0) fontes.push("lista");
  const nicho = limpo(o.nicho, 120);
  const cidade = limpo(o.cidade, 120);
  const soLista = fontes.length === 1 && fontes[0] === "lista";
  if (!fontes.length) return { erro: "Escolha pelo menos uma fonte." };
  if (fontes.indexOf("lista") >= 0 && !urls.length) return { erro: "Cole pelo menos um site para a fonte de sites colados." };
  if (!soLista && nicho.length < 2) return { erro: "Diga o nicho (ex.: pizzaria, dentista, pet shop)." };
  if (!soLista && cidade.length < 2) return { erro: "Diga a cidade." };
  const uf = limpo(o.uf, 2).toUpperCase();
  const limite = Math.max(1, Math.min(300, Math.round(Number(o.limite) || 50)));
  return {
    busca: {
      nicho: nicho || "Sites colados",
      cidade: cidade || "Lista",
      uf: UFS.indexOf(uf) >= 0 ? uf : null,
      fontes,
      limite,
      campanha_id: typeof o.campanha_id === "string" && UUID.test(o.campanha_id) ? o.campanha_id : null,
      entregar_ao_mercurio: o.entregar_ao_mercurio === true,
      urls,
    },
  };
}

/** O perfil de cliente ideal da Aceleriq (o que o Jev compara). A tela pode mandar um texto próprio. */
export const PERFIL_IDEAL_PADRAO =
  "Negócio local brasileiro que vende para o consumidor da região (saúde, estética, alimentação, serviços, varejo, educação, imobiliário, automotivo), com ticket e margem que pagam marketing mensal, presença digital fraca ou mediana (Instagram parado, site antigo ou sem site, sem anúncio) e um canal direto para conversar (WhatsApp ou telefone). Rede grande, franquia com marketing central, órgão público e empresa sem contato público encaixam pouco.";

export const NIVEIS_DE_ENCAIXE = [
  "Não encaixa: não é negócio local que venda para o consumidor, ou é rede, órgão público ou sem nenhum contato público.",
  "Encaixe fraco: pode até ser negócio local, mas faltam sinais de que pague marketing mensal ou de que dá para falar com o dono.",
  "Encaixe médio: negócio local do tipo certo, com algum canal de contato, mas sem sinal claro de presença digital a melhorar.",
  "Bom encaixe: negócio local do tipo certo, com WhatsApp ou telefone e presença digital que dá para melhorar.",
  "Encaixe excelente: negócio local de nicho forte para a Aceleriq, com contato direto do dono e presença digital claramente fraca ou parada.",
];

export interface CandidatoParaJev {
  id: string;
  nome: string;
  categoria?: string | null;
  site?: string | null;
  telefone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  instagram?: string | null;
  endereco?: string | null;
  cidade?: string | null;
  fonte?: string | null;
}

/** O estado do Jev: o perfil ideal, a busca e os candidatos (só o que ajuda a julgar). */
export function estadoDoJev(perfil: string, busca: { nicho: string; cidade: string }, cands: CandidatoParaJev[]) {
  return {
    perfil_de_cliente_ideal: perfil,
    busca: { nicho: busca.nicho, cidade: busca.cidade },
    candidatos: cands.map((c) => ({
      nome: c.nome,
      categoria: c.categoria || null,
      tem_site: !!c.site,
      site: c.site || null,
      tem_whatsapp: !!c.whatsapp,
      tem_telefone: !!c.telefone,
      tem_email: !!c.email,
      instagram: c.instagram || null,
      bairro_ou_endereco: c.endereco || null,
    })),
  };
}

/** Uma pergunta Score por candidato (comparáveis entre si, níveis do pior para o melhor). */
export function perguntasDoJev(n: number): Record<string, { type: "score"; instructions: string; criteria: string[] }> {
  const q: Record<string, { type: "score"; instructions: string; criteria: string[] }> = {};
  for (let i = 0; i < n; i++) {
    q[`encaixe_${i}`] = {
      type: "score",
      instructions: `Quanto o negócio \`candidatos[${i}]\` encaixa no \`perfil_de_cliente_ideal\` da agência, como cliente de marketing mensal? Julgue só pelo que está no candidato e na \`busca\`; o que não aparece não conta a favor.`,
      criteria: NIVEIS_DE_ENCAIXE,
    };
  }
  return q;
}

/** A nota de 0 a 10 (uma casa) a partir do Score (0 a níveis-1) e o porquê (o nível mais perto, encurtado). */
export function notaDoEncaixe(score: number | null): { nota: number | null; porque: string | null } {
  if (score == null || !isFinite(score)) return { nota: null, porque: null };
  const max = NIVEIS_DE_ENCAIXE.length - 1;
  const s = Math.max(0, Math.min(max, score));
  const nivel = NIVEIS_DE_ENCAIXE[Math.round(s)];
  return { nota: Math.round((s / max) * 100) / 10, porque: nivel.split(":")[0] + ":" + nivel.split(":").slice(1).join(":").split(",")[0] };
}

// ------------------------------------------------------------------ do candidato ao lead

export interface CandidatoParaImportar extends CandidatoParaJev {
  fonte_url?: string | null;
  nota?: number | null;
  porque?: string | null;
  evidencias?: unknown;
}

export const soDigitos = (v: unknown) => String(v || "").replace(/\D/g, "");

/** Chaves para achar o mesmo negócio já no CRM: WhatsApp/telefone (8 últimos dígitos), e-mail e nome. */
export function chavesDoContato(c: { whatsapp?: string | null; telefone?: string | null; email?: string | null; nome?: string | null; company?: string | null; name?: string | null }) {
  const fone = soDigitos(c.whatsapp || c.telefone).slice(-8);
  const nome = String(c.nome || c.company || c.name || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return { fone: fone.length === 8 ? fone : "", email: String(c.email || "").trim().toLowerCase(), nome };
}

/** O lead novo do CRM (commercial_leads) a partir do candidato. O contexto vai na qualificação, com a fonte. */
export function leadDoCandidato(c: CandidatoParaImportar, busca: { id: string; nicho: string; cidade: string; uf: string | null; campanha_id: string | null }, o: { mercurio: boolean; criadoPor: string | null }) {
  const contato = c.whatsapp || c.telefone || null;
  const fontes = [c.fonte_url, c.site].filter(Boolean);
  return {
    name: c.nome.slice(0, 200),
    company: c.nome.slice(0, 200),
    email: c.email || null,
    whatsapp: contato,
    origin: "maquina_de_leads",
    stage: "novo",
    campaign_id: busca.campanha_id,
    created_by: o.criadoPor,
    ...(o.mercurio ? { agente_slug: "mercurio" } : {}),
    next_action: o.mercurio ? "Mercúrio faz o primeiro contato" : "Primeiro contato",
    qualificacao: {
      fonte: "maquina_de_leads",
      busca_id: busca.id,
      nicho: busca.nicho,
      cidade: [busca.cidade, busca.uf].filter(Boolean).join("/"),
      site: c.site || null,
      instagram: c.instagram || null,
      telefone: c.telefone || null,
      whatsapp_confirmado: !!c.whatsapp,
      endereco: c.endereco || null,
      categoria: c.categoria || null,
      encaixe_jev: c.nota ?? null,
      encaixe_porque: c.porque || null,
      origem_dos_dados: fontes,
    },
    notes: [
      `Achado pela Máquina de leads (${busca.nicho} em ${busca.cidade}${busca.uf ? `/${busca.uf}` : ""}).`,
      c.nota != null ? `Encaixe pelo Jev: ${c.nota} de 10${c.porque ? ` (${c.porque})` : ""}.` : "",
      fontes.length ? `Fontes: ${fontes.join(" · ")}` : "",
    ].filter(Boolean).join("\n"),
  };
}
