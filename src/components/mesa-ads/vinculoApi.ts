/**
 * Vínculo automático anúncio x criativo (Mesa Ads v5): tipos e normalização
 * da resposta de vinculos_automaticos, e as chamadas de confirmar e desfazer.
 * Normalização tolerante: resposta velha ou incompleta vira lista vazia.
 */
import { chamarAds } from "./adsApi";

export type OrigemDoVinculo = "ja_ligado" | "automatico" | "jev" | "confirmar" | "sem_par";

export interface ItemDeVinculo {
  peca: string;
  origem: OrigemDoVinculo;
  confianca: number;
  sinais: string[];
  anuncio: { ad_id: string; ad_ids: string[]; nome: string; titulo: string; corpo: string; imagem_url: string | null; status: string; campanha: string; gasto_90d: number };
  criativo: { id: string; nome: string; plano: string; angulo: string } | null;
  candidatos: { criativo_id: string; nome: string; confianca: number; sinais: string[] }[];
}

export interface VinculosDaConta {
  itens: ItemDeVinculo[];
  resumo: { ja_ligados: number; automaticos: number; pelo_jev: number; confirmar: number; sem_par: number; criativos_livres: number };
  impressoes: { novas: number; pendentes: number };
  historico_disponivel: boolean;
  jev_erro: string;
  custo_usd: number;
}

const lista = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
const txt = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : isFinite(Number(v)) && v !== null && v !== "" ? Number(v) : 0);
const ORIGENS: OrigemDoVinculo[] = ["ja_ligado", "automatico", "jev", "confirmar", "sem_par"];

export function normalizarVinculos(bruto: unknown): VinculosDaConta {
  const r = obj(bruto);
  const re = obj(r.resumo);
  const im = obj(r.impressoes);
  return {
    itens: lista(r.itens)
      .map((x) => {
        const o = obj(x);
        const a = obj(o.anuncio);
        const c = obj(o.criativo);
        return {
          peca: txt(o.peca),
          origem: (ORIGENS.indexOf(o.origem) >= 0 ? o.origem : "sem_par") as OrigemDoVinculo,
          confianca: num(o.confianca),
          sinais: lista(o.sinais).map((s) => txt(obj(s).detalhe) || txt(s)).filter(Boolean),
          anuncio: {
            ad_id: txt(a.ad_id),
            ad_ids: lista(a.ad_ids).map(txt).filter(Boolean),
            nome: txt(a.nome) || txt(a.titulo) || `Anúncio ${txt(a.ad_id)}`,
            titulo: txt(a.titulo),
            corpo: txt(a.corpo),
            imagem_url: txt(a.imagem_url) || null,
            status: txt(a.status),
            campanha: txt(a.campanha),
            gasto_90d: num(a.gasto_90d),
          },
          criativo: txt(c.id) ? { id: txt(c.id), nome: txt(c.nome) || "Criativo", plano: txt(c.plano), angulo: txt(c.angulo) } : null,
          candidatos: lista(o.candidatos)
            .map((p) => ({ criativo_id: txt(obj(p).criativo_id), nome: txt(obj(p).nome) || "Criativo", confianca: num(obj(p).confianca), sinais: lista(obj(p).sinais).map(txt).filter(Boolean) }))
            .filter((p) => !!p.criativo_id),
        };
      })
      .filter((i) => !!i.anuncio.ad_id),
    resumo: {
      ja_ligados: num(re.ja_ligados),
      automaticos: num(re.automaticos),
      pelo_jev: num(re.pelo_jev),
      confirmar: num(re.confirmar),
      sem_par: num(re.sem_par),
      criativos_livres: num(re.criativos_livres),
    },
    impressoes: { novas: num(im.novas), pendentes: num(im.pendentes) },
    historico_disponivel: r.historico_disponivel !== false,
    jev_erro: txt(r.jev_erro),
    custo_usd: num(r.custo_usd),
  };
}

/** Frase curta da confiança para a tela. */
export function rotuloDaConfianca(c: number): string {
  if (c >= 0.8) return "certeza alta";
  if (c >= 0.6) return "provável";
  if (c >= 0.45) return "incerto";
  return "fraco";
}

export const chavesVinculo = {
  vinculos: (clientId: string) => ["mesa", "urls", "ads-vinculos", clientId] as const,
};

export async function lerVinculos(clientId: string, jev = true): Promise<VinculosDaConta> {
  return normalizarVinculos(await chamarAds("vinculos_automaticos", { client_id: clientId, jev }));
}

export const confirmarVinculo = (clientId: string, criativoId: string, adId: string) => chamarAds("vinculo_confirmar", { client_id: clientId, criativo_id: criativoId, ad_id: adId });
export const desfazerVinculo = (clientId: string, criativoId: string, adId: string, recusar = true) =>
  chamarAds("vinculo_desfazer", { client_id: clientId, criativo_id: criativoId, ad_id: adId, recusar });
