import { useMemo } from "react";
import { Megaphone } from "lucide-react";
import { Secao, juntar, superficie, texto } from "@/components/sistema";
import { StatCard, StatGrid, StatusPill } from "@/components/ds";
import { Bolha } from "@/components/client/pecasOusadas";
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
      const dias = mapa.get(row.campaign_id) || [];
      dias.push(row);
      mapa.set(row.campaign_id, dias);
    }
    return [...mapa.entries()]
      .map(([id, dias]) => ({
        resumo: summarizeCampaign(dias)!,
        ficha: (campaigns || []).find((item) => item.campaign_id === id),
      }))
      .filter((item) => item.resumo && item.resumo.investido > 0)
      .sort((a, b) => b.resumo.investido - a.resumo.investido);
  }, [rows, campaigns]);

  // Sem campanha com movimento, o bloco simplesmente não existe.
  if (porCampanha.length === 0) return null;

  const carteira = summarizeAccount(rows || []);

  // Seção aberta (sem caixa), que recolhe; os números numa faixa e as
  // campanhas numa lista com divisória. O que cada número quer dizer fica na
  // linha de apoio embaixo dele (uma linha, o texto inteiro no "title").
  return (
    <Secao
      titulo="Seus anúncios agora"
      descricao="Últimos 30 dias"
      ajuda="Direto do Meta, atualizado ao longo do dia."
    >
      <StatGrid cols={3} label="Seus anúncios nos últimos 30 dias">
        <StatCard variant="ink" size="xl" label="Investido" value={dinheiro(carteira.investido)} hint={EXPLICACOES.investido} />
        <StatCard variant="accent" size="xl" label="Pessoas alcançadas" value={numero(carteira.alcance)} hint={EXPLICACOES.alcance} />
        {carteira.resultados != null && (
          <StatCard size="xl" className="max-lg:col-span-2" label="Resultados" value={numero(carteira.resultados)} hint={EXPLICACOES.resultados} />
        )}
      </StatGrid>

      <ul className={juntar(superficie.painel, "mt-4 min-w-0 divide-y divide-border/70 px-2 py-2 sm:mt-5 sm:px-3")} aria-label="Campanhas">
        {porCampanha.map(({ resumo, ficha }) => {
          const situacao = statusLabel(ficha?.status, ficha?.effective_status, (ficha as { stop_time?: string | null } | undefined)?.stop_time);
          return (
            <li key={resumo.campaignId} className="flex min-w-0 items-start px-3 py-4">
              <Bolha tom={situacao.noAr ? "solido" : "neutro"} className="mr-4"><Megaphone className="h-4 w-4" /></Bolha>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center">
                  <p className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-5 text-foreground">{resumo.name}</p>
                  {situacao.noAr && (
                    <StatusPill tone="success" pulse className="ml-2">No ar</StatusPill>
                  )}
                </div>
                <p className={juntar(texto.auxiliar, "mt-0.5")}>
                  Para {resumo.goal.label}.
                </p>
                <p className={juntar(texto.corpo, "mt-1.5")}>
                  {clientCampaignLine(resumo)}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
    </Secao>
  );
}
