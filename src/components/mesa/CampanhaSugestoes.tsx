import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CalendarClock, Flag, Lightbulb, ListOrdered, Megaphone, Timer } from "lucide-react";
import type { ReactNode } from "react";
import { parteDaConferenciaDoJev } from "@/lib/mesa/api";
import { juntar, texto } from "@/components/sistema";
import { BotaoComCusto } from "./Custo";
import { useMesa } from "./MesaContexto";
import { chaves, hojeIso, lerProposta, type Campanha } from "./mesaV4Api";
import { ordenarSugestoes } from "./campanhasApi";
import { usePecasDaCampanha } from "./CampanhaCompleta";
import { adsDaCampanha, chavesDoAds, diasComLeads, lerDiasDoAds } from "./campanhaAdsApi";
import { ROTULO_DA_FONTE, sugestoesProativas, type FonteDaSugestao, type SugestaoProativa } from "./regrasDaCampanha";
import { datasDoAno } from "./datasDoHype";

/**
 * Sugestões proativas da campanha (22/10/2026): a fase atual contra as peças prontas, o fim chegando, dias
 * sem peça, o anúncio vinculado sem lead e as datas do calendário na janela. Cada uma vira um pedido pronto ao
 * agente, com um clique. A ordem é a da regra; "Ordenar pelo Jev" (centavos, custo antes) reordena pelo julgamento.
 */

const ICONE_DA_FONTE: Record<FonteDaSugestao, ReactNode> = {
  fase: <Flag className="h-3.5 w-3.5" aria-hidden="true" />,
  fim: <Timer className="h-3.5 w-3.5" aria-hidden="true" />,
  agenda: <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" />,
  ads: <Megaphone className="h-3.5 w-3.5" aria-hidden="true" />,
  hype: <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />,
};

/** As sugestões desta campanha, com o que já está em cache (peças, anúncio e datas). */
export function useSugestoesDaCampanha(campanha: Campanha): SugestaoProativa[] {
  const { clientId } = useMesa();
  const proposta = useQuery({ queryKey: chaves.proposta(campanha.proposta_id || ""), enabled: !!campanha.proposta_id, queryFn: () => lerProposta(campanha.proposta_id as string) });
  const { pecas } = usePecasDaCampanha(campanha, proposta.data);
  const vinculo = adsDaCampanha(campanha);
  const dias = useQuery({
    queryKey: chavesDoAds.numeros(clientId, vinculo ? vinculo.campaign_id : ""),
    enabled: !!vinculo,
    staleTime: 60_000,
    queryFn: () => lerDiasDoAds(clientId, vinculo ? vinculo.campaign_id : ""),
  });
  const hoje = hojeIso();
  return useMemo(() => {
    const ano = Number(hoje.slice(0, 4));
    // Só as datas de varejo e as culturais grandes (Black Friday, Natal...): as de nicho entram pelo Mês.
    const datas = datasDoAno(ano).concat(datasDoAno(ano + 1)).filter((d) => d.tipo === "varejo" || d.tipo === "cultural").map((d) => ({ titulo: d.titulo, pico: d.pico }));
    return sugestoesProativas({ campanha, pecas, hoje, adsPorDia: dias.data ? diasComLeads(dias.data) : null, datas });
  }, [campanha, pecas, hoje, dias.data]);
}

export default function CampanhaSugestoes({ campanha, onPedir, compacto = false }: { campanha: Campanha; onPedir: (pedido: string) => void; compacto?: boolean }) {
  const sugestoes = useSugestoesDaCampanha(campanha);
  const [ordem, setOrdem] = useState<string[] | null>(null);
  const lista = ordem ? ordem.map((id) => sugestoes.filter((s) => s.id === id)[0]).filter(Boolean).concat(sugestoes.filter((s) => ordem.indexOf(s.id) < 0)) : sugestoes;
  if (!lista.length) return null;
  return (
    <section className="min-w-0" aria-label="Sugestões da campanha" data-sugestoes-da-campanha="">
      {!compacto && (
        <div className="mb-1.5 flex min-w-0 items-center">
          <p className={juntar(texto.rotulo, "min-w-0 flex-1")}>Sugestões</p>
          {lista.length > 1 && (
            <BotaoComCusto
              rotulo={<><ListOrdered className="h-4 w-4" aria-hidden="true" /><span className="sr-only">Ordenar pelo Jev</span></>}
              titulo="Sugestões ordenadas"
              descricao="Ordenar as sugestões pelo Jev (o que mais muda o resultado agora vem primeiro)"
              partes={() => [parteDaConferenciaDoJev()]}
              executar={async () => {
                const r = await ordenarSugestoes(campanha.id, lista.map((s) => ({ id: s.id, texto: s.texto, fonte: s.fonte })));
                if (r && Array.isArray(r.ordem)) setOrdem(r.ordem.map((o) => o.id));
                return r;
              }}
              variant="ghost"
              className="h-7 gap-0 px-1.5"
            />
          )}
        </div>
      )}
      <ul className="flex min-w-0 flex-wrap" aria-label="Pedidos prontos ao agente">
        {lista.slice(0, compacto ? 3 : 5).map((s) => (
          <li key={s.id} className="mb-1.5 mr-1.5 min-w-0 max-w-full">
            <button
              type="button"
              onClick={() => onPedir(s.pedido)}
              className="inline-flex max-w-full items-center rounded-full border border-border bg-background px-2.5 py-1 text-left text-[12px] transition-colors hover:border-primary/50"
              title={`${ROTULO_DA_FONTE[s.fonte]}: ${s.texto} Clique para levar o pedido ao agente.`}
              data-fonte={s.fonte}
            >
              <span className="mr-1.5 shrink-0 text-primary">{ICONE_DA_FONTE[s.fonte]}</span>
              <span className="min-w-0 truncate">{s.texto}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
