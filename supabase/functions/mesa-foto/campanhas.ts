/**
 * Mesa Foto ligada à Mesa: as campanhas do cliente (mesa_campanhas, criadas
 * pelo estrategista no agente-calendario) e o calendário editorial do mês
 * (calendario_propostas prontas ou gravadas, com itens datados e ligados à
 * campanha por campanha_id ou pela proposta da campanha).
 *
 * Pedido do dono (25/09): "Na campanha não dá para eu escolher a campanha.
 * Tem que reconhecer a campanha do mês, o calendário." A campanha do mês sai
 * de regra fixa em código (datas), sem IA: acontece hoje, tem conteúdo no
 * calendário deste mês ou o período cai dentro do mês. Encerrada nunca é a do
 * mês, mas continua na lista para escolher.
 *
 * Ação (POST { acao } na função mesa-foto, sem IA, custo zero):
 * - campanhas_listar { client_id } -> { mes, hoje, campanha_do_mes_id, campanhas }
 *
 * O resumo da campanha (tema, período, oferta, identidade, pautas do mês)
 * entra no contexto de todo planejamento da Mesa Foto (index.ts,
 * contextoDoCliente), para a foto nascer dentro da campanha que a Mesa usa.
 */

import type { SupabaseClient } from "npm:@supabase/supabase-js@2";
import { ErroDeRegra, limpo, listaDeTextos, UUID } from "./calculos.ts";
import type { Chamador, FerramentasDaMesa } from "./ferramentas.ts";

// ------------------------------------------------------------------ tipos

export type LinhaCampanhaDaMesa = {
  id: string;
  nome: string | null;
  pedido: string | null;
  objetivo: string | null;
  conceito: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  status: string | null;
  identidade: Record<string, unknown> | null;
  referencias_ids: string[] | null;
  proposta_id: string | null;
  criado_em: string | null;
};

/** Item datado do calendário editorial (itens de calendario_propostas). */
export type ItemDoCalendario = {
  proposta_id: string;
  data: string;
  tema: string;
  formato: string | null;
  campanha_id: string | null;
};

export type IdentidadeDaCampanha = {
  tema_visual: string;
  paleta_apoio: { nome: string; hex: string }[];
  tipografia: string;
  elementos: string;
  tom: string;
};

export type CampanhaParaFoto = {
  id: string;
  nome: string;
  objetivo: string;
  conceito: string;
  pedido: string;
  status: string;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  /** O período veio das datas do calendário (a campanha não tinha período escrito). */
  periodo_pelo_calendario: boolean;
  identidade: IdentidadeDaCampanha;
  referencias_ids: string[];
  /** O período ou algum conteúdo do calendário cai neste mês. */
  no_mes: boolean;
  acontecendo_hoje: boolean;
  conteudos_no_mes: number;
  /** Temas dos conteúdos deste mês (as pautas que vão precisar de foto). */
  pautas_no_mes: string[];
  do_mes: boolean;
  /** Por que é (ou não é) a campanha do mês, em uma frase. */
  motivo: string;
};

export type MesDeReferencia = { mes: string; hoje: string; inicio: string; fim: string };

// ------------------------------------------------------------------ datas

const dois = (n: number) => (n < 10 ? `0${n}` : String(n));
const DATA = /^\d{4}-\d{2}-\d{2}$/;
const dataOuNulo = (v: unknown): string | null => {
  const t = typeof v === "string" ? v.slice(0, 10) : "";
  return DATA.test(t) ? t : null;
};

/**
 * Mês de São Paulo (UTC-3 fixo: o Brasil não tem horário de verão desde
 * 2019). Ex.: 2026-09-30T23:30-03:00 ainda é setembro.
 */
export function mesDeSaoPaulo(agora: Date = new Date()): MesDeReferencia {
  const t = new Date(agora.getTime() - 3 * 3600_000);
  const a = t.getUTCFullYear();
  const m = t.getUTCMonth() + 1;
  const d = t.getUTCDate();
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return { mes: `${a}-${dois(m)}`, hoje: `${a}-${dois(m)}-${dois(d)}`, inicio: `${a}-${dois(m)}-01`, fim: `${a}-${dois(m)}-${dois(ultimo)}` };
}

const dentro = (d: string, inicio: string, fim: string) => d >= inicio && d <= fim;
const sobrepoe = (i1: string | null, f1: string | null, i2: string, f2: string) => {
  if (!i1 && !f1) return false;
  const ini = i1 || f1 || "";
  const fim = f1 || i1 || "";
  return ini <= f2 && fim >= i2;
};
const diaMes = (d: string | null) => (d ? `${d.slice(8, 10)}/${d.slice(5, 7)}` : "");

// ------------------------------------------------------------------ normalizar

export function normalizarIdentidadeDaCampanha(v: unknown): IdentidadeDaCampanha {
  const o = (v && typeof v === "object" && !Array.isArray(v) ? v : {}) as Record<string, unknown>;
  const HEX = /^#[0-9a-f]{6}$/i;
  const apoio = (Array.isArray(o.paleta_apoio) ? o.paleta_apoio : [])
    .map((p) => {
      const x = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
      return { nome: limpo(x.nome, 40), hex: limpo(x.hex, 7).toUpperCase() };
    })
    .filter((p) => HEX.test(p.hex))
    .slice(0, 4);
  return {
    tema_visual: limpo(o.tema_visual, 1200),
    paleta_apoio: apoio,
    tipografia: limpo(o.tipografia, 400),
    elementos: limpo(o.elementos, 800),
    tom: limpo(o.tom, 400),
  };
}

/** Itens datados das propostas (o que o calendário editorial tem para cada dia). */
export function itensDasPropostas(propostas: { id: string; itens: unknown }[]): ItemDoCalendario[] {
  const saida: ItemDoCalendario[] = [];
  for (const p of propostas) {
    if (!Array.isArray(p.itens)) continue;
    for (const bruto of p.itens) {
      const i = (bruto && typeof bruto === "object" ? bruto : {}) as Record<string, unknown>;
      const data = dataOuNulo(i.data);
      if (!data) continue;
      saida.push({
        proposta_id: String(p.id),
        data,
        tema: limpo(i.tema, 160) || limpo(i.gancho, 160),
        formato: limpo(i.formato, 40) || null,
        campanha_id: typeof i.campanha_id === "string" && i.campanha_id ? i.campanha_id : null,
      });
    }
  }
  return saida;
}

/**
 * Marca a campanha do mês pelo calendário (regra fixa, sem IA). Pontos:
 * acontece hoje (3), tem conteúdo no calendário deste mês (2), período dentro
 * do mês (1). Empate: mais conteúdos no mês, depois a que começa mais perto
 * de hoje, depois a mais nova. Encerrada nunca é a do mês.
 */
export function marcarCampanhaDoMes(
  linhas: LinhaCampanhaDaMesa[],
  itens: ItemDoCalendario[],
  agora: Date = new Date(),
): { mes: string; hoje: string; campanha_do_mes_id: string | null; campanhas: CampanhaParaFoto[] } {
  const ref = mesDeSaoPaulo(agora);
  const pontuadas = linhas
    .filter((l) => l && typeof l.id === "string" && l.id)
    .map((l) => {
      const daCampanha = itens.filter((i) => i.campanha_id === l.id || (!!l.proposta_id && i.proposta_id === l.proposta_id && !i.campanha_id));
      const datas = daCampanha.map((i) => i.data).sort();
      let inicio = dataOuNulo(l.periodo_inicio);
      let fim = dataOuNulo(l.periodo_fim);
      const pelo = !inicio && !fim && datas.length > 0;
      if (pelo) {
        inicio = datas[0];
        fim = datas[datas.length - 1];
      }
      const noMesItens = daCampanha.filter((i) => dentro(i.data, ref.inicio, ref.fim));
      const hojeDentro = !!(inicio || fim) && dentro(ref.hoje, inicio || fim || "", fim || inicio || "");
      const periodoNoMes = sobrepoe(inicio, fim, ref.inicio, ref.fim);
      const status = limpo(l.status, 20) || "planejada";
      const encerrada = status === "encerrada";
      const pontos = encerrada ? 0 : (hojeDentro ? 3 : 0) + (noMesItens.length ? 2 : 0) + (periodoNoMes ? 1 : 0);
      const motivo = encerrada
        ? "Campanha encerrada."
        : hojeDentro
          ? `Acontece hoje (${diaMes(inicio)} a ${diaMes(fim)}).`
          : noMesItens.length
            ? `${noMesItens.length} ${noMesItens.length === 1 ? "conteúdo" : "conteúdos"} no calendário deste mês.`
            : periodoNoMes
              ? `Período dentro do mês (${diaMes(inicio)} a ${diaMes(fim)}).`
              : inicio || fim
                ? `Fora deste mês (${diaMes(inicio)} a ${diaMes(fim)}).`
                : "Sem período nem conteúdo no calendário.";
      const campanha: CampanhaParaFoto = {
        id: l.id,
        nome: limpo(l.nome, 120) || "Campanha",
        objetivo: limpo(l.objetivo, 600),
        conceito: limpo(l.conceito, 2000),
        pedido: limpo(l.pedido, 1200),
        status,
        periodo_inicio: inicio,
        periodo_fim: fim,
        periodo_pelo_calendario: pelo,
        identidade: normalizarIdentidadeDaCampanha(l.identidade),
        referencias_ids: listaDeTextos(l.referencias_ids, 12, 60),
        no_mes: periodoNoMes || noMesItens.length > 0,
        acontecendo_hoje: hojeDentro && !encerrada,
        conteudos_no_mes: noMesItens.length,
        pautas_no_mes: listaDeTextos(noMesItens.sort((a, b) => (a.data < b.data ? -1 : 1)).map((i) => `${diaMes(i.data)} ${i.tema}`.trim()), 12, 180),
        do_mes: false,
        motivo,
      };
      const distancia = inicio ? Math.abs(Date.parse(`${inicio}T12:00:00Z`) - Date.parse(`${ref.hoje}T12:00:00Z`)) : Number.MAX_SAFE_INTEGER;
      return { campanha, pontos, distancia, criado: String(l.criado_em || "") };
    });
  const ordem = pontuadas.slice().sort((a, b) =>
    b.pontos - a.pontos ||
    b.campanha.conteudos_no_mes - a.campanha.conteudos_no_mes ||
    a.distancia - b.distancia ||
    (a.criado < b.criado ? 1 : a.criado > b.criado ? -1 : 0)
  );
  const vencedora = ordem.length && ordem[0].pontos > 0 ? ordem[0].campanha : null;
  if (vencedora) vencedora.do_mes = true;
  // Lista: a do mês primeiro, depois as do mês, depois as outras (mais nova antes); encerradas no fim.
  const lista = ordem.map((x) => x.campanha).sort((a, b) => {
    const pa = a.do_mes ? 0 : a.status === "encerrada" ? 3 : a.no_mes ? 1 : 2;
    const pb = b.do_mes ? 0 : b.status === "encerrada" ? 3 : b.no_mes ? 1 : 2;
    return pa - pb;
  });
  return { mes: ref.mes, hoje: ref.hoje, campanha_do_mes_id: vencedora ? vencedora.id : null, campanhas: lista };
}

/** O que da campanha vai para o diretor (tema, período, oferta, identidade, pautas do mês). */
export function campanhaParaOContexto(c: CampanhaParaFoto, papel: "escolhida" | "do_mes") {
  return {
    como_usar: papel === "escolhida"
      ? "Campanha escolhida pela equipe: as fotos são desta campanha. Siga o tema, o clima e a paleta de apoio dela, sempre dentro da marca do cliente."
      : "Campanha do mês no calendário editorial da Mesa: use o tema e o clima dela quando servirem ao pedido, sempre dentro da marca do cliente.",
    nome: c.nome,
    objetivo: c.objetivo || null,
    conceito: c.conceito || null,
    periodo: c.periodo_inicio || c.periodo_fim ? `${c.periodo_inicio || "?"} a ${c.periodo_fim || "?"}` : null,
    tema_visual: c.identidade.tema_visual || null,
    paleta_de_apoio: c.identidade.paleta_apoio.map((p) => `${p.nome || "apoio"} ${p.hex}`),
    elementos: c.identidade.elementos || null,
    tom: c.identidade.tom || null,
    pautas_do_mes: c.pautas_no_mes.slice(0, 8),
  };
}

// ------------------------------------------------------------------ banco

/**
 * Lê as campanhas do cliente e o calendário do mês (chave de serviço). Tabela
 * ausente ou erro de leitura: lista vazia (a Mesa Foto segue sem campanha).
 */
export async function lerCampanhasParaFoto(db: SupabaseClient, clientId: string, agora: Date = new Date()) {
  const ref = mesDeSaoPaulo(agora);
  const [campanhas, propostas] = await Promise.all([
    db.from("mesa_campanhas")
      .select("id, nome, pedido, objetivo, conceito, periodo_inicio, periodo_fim, status, identidade, referencias_ids, proposta_id, criado_em")
      .eq("client_id", clientId)
      .order("criado_em", { ascending: false })
      .limit(40),
    db.from("calendario_propostas")
      .select("id, itens, status, periodo_inicio, periodo_fim")
      .eq("client_id", clientId)
      .in("status", ["pronta", "gravada"])
      .lte("periodo_inicio", ref.fim)
      .gte("periodo_fim", ref.inicio)
      .order("periodo_inicio", { ascending: false })
      .limit(20),
  ]);
  const linhas = campanhas.error ? [] : ((campanhas.data ?? []) as LinhaCampanhaDaMesa[]);
  const itens = propostas.error ? [] : itensDasPropostas((propostas.data ?? []) as { id: string; itens: unknown }[]);
  return marcarCampanhaDoMes(linhas, itens, agora);
}

// ------------------------------------------------------------------ ação

export function acoesDeCampanhas(f: FerramentasDaMesa) {
  /** campanhas_listar { client_id } -> { mes, hoje, campanha_do_mes_id, campanhas } (sem IA). */
  async function campanhasListar(ch: Chamador, corpo: Record<string, unknown>) {
    const clientId = typeof corpo.client_id === "string" && UUID.test(corpo.client_id) ? corpo.client_id : "";
    if (!clientId) throw new ErroDeRegra(400, "client_id_invalido", "client_id inválido.");
    await f.garantirAcesso(ch, clientId);
    const r = await lerCampanhasParaFoto(f.servico(), clientId);
    return f.json({ ...r, custo_usd: 0 });
  }
  return { campanhas_listar: campanhasListar } as Record<string, (ch: Chamador, corpo: Record<string, unknown>) => Promise<Response>>;
}
