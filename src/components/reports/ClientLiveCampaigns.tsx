import { useMemo } from "react";
import { Megaphone } from "lucide-react";
import { useAdsCampaigns, useAdsDaily, type AdsDaily } from "@/hooks/useAdsMetrics";
import {
  clientCampaignLine,
  dinheiro,
  numero,
  statusLabel,
  summarizeAccount,
  summarizeCampaign,
  EXPLICACOES,
} from "@/lib/adsLanguage";

/**
 * As campanhas do cliente, ao vivo, na linguagem dele.
 *
 * Complementa os relatórios publicados em vez de substituí-los: o relatório
 * conta a história do período com a leitura da equipe; este bloco responde a
 * pergunta que o cliente faz no meio do mês — "e agora, está rodando?".
 *
 * Regras que valem aqui e não são detalhe:
 *   · nenhuma sigla — nada de CTR, CPC, CPM, impressões;
 *   · nada de ausência — sem dado, o bloco não aparece, em vez de anunciar
 *     que não há nada. Fato ausente não é notícia para o cliente;
 *   · cada número traz embaixo o que ele quer dizer, para ninguém precisar
 *     perguntar no grupo.
 */
export default function ClientLiveCampaigns({ clientId }: { clientId?: string }) {
  const { data: rows } = useAdsDaily(clientId, 30);
  const { data: campaigns } = useAdsCampaigns(clientId);

  const porCampanha = useMemo(() => {
    const mapa = new Map<string, AdsDaily[]>();
    for (const row of rows || []) {
      const lista = mapa.get(row.campaign_id) || [];
      lista.push(row);
      mapa.set(row.campaign_id, lista);
    }
    return [...mapa.entries()]
      .map(([id, lista]) => ({
        resumo: summarizeCampaign(lista)!,
        ficha: (campaigns || []).find((item) => item.campaign_id === id),
      }))
      .filter((item) => item.resumo && item.resumo.investido > 0)
      .sort((a, b) => b.resumo.investido - a.resumo.investido);
  }, [rows, campaigns]);

  // Sem campanha com movimento, o bloco simplesmente não existe.
  if (porCampanha.length === 0) return null;

  const carteira = summarizeAccount(rows || []);

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-center gap-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl border border-primary/20 bg-primary/10">
          <Megaphone className="h-4 w-4 text-primary" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-foreground">Seus anúncios agora</h2>
          <p className="text-[11px] text-muted-foreground">
            Direto do Meta, atualizado ao longo do dia · últimos 30 dias
          </p>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Investido
          </p>
          <p className="mt-0.5 font-mono text-base font-semibold text-foreground">
            {dinheiro(carteira.investido)}
          </p>
          <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
            {EXPLICACOES.investido}
          </p>
        </div>
        <div>
          <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Pessoas alcançadas
          </p>
          <p className="mt-0.5 font-mono text-base font-semibold text-foreground">
            {numero(carteira.alcance)}
          </p>
          <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
            {EXPLICACOES.alcance}
          </p>
        </div>
        {carteira.resultados != null && (
          <div>
            <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
              Resultados
            </p>
            <p className="mt-0.5 font-mono text-base font-semibold text-foreground">
              {numero(carteira.resultados)}
            </p>
            <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
              {EXPLICACOES.resultados}
            </p>
          </div>
        )}
      </div>

      <div className="mt-4 space-y-2">
        {porCampanha.map(({ resumo, ficha }) => {
          const situacao = statusLabel(ficha?.status, ficha?.effective_status);
          return (
            <div
              key={resumo.campaignId}
              className="rounded-lg border border-border/60 bg-secondary/40 p-3"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-semibold text-foreground">{resumo.name}</p>
                {situacao.noAr && (
                  <span className="rounded-md bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold text-success">
                    No ar
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                Para {resumo.goal.label}.
              </p>
              <p className="mt-1.5 text-[11px] font-medium leading-relaxed text-foreground">
                {clientCampaignLine(resumo)}
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
