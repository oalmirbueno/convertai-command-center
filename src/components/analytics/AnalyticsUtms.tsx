import {
  Copy,
  ExternalLink,
  Link2,
  Megaphone,
  Plus,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  buildUtmUrl,
  type AnalyticsCampaign,
  type AnalyticsUtmLink,
} from "@/lib/analytics";

interface AnalyticsUtmsProps {
  campaigns: AnalyticsCampaign[];
  utmLinks: AnalyticsUtmLink[];
  canManage: boolean;
  onCreateCampaign: () => void;
  onCreateUtm: () => void;
}

const channelLabels: Record<string, string> = {
  meta_ads: "Meta Ads",
  google_ads: "Google Ads",
  tiktok_ads: "TikTok Ads",
  organic: "Orgânico",
  email: "E-mail",
  referral: "Indicação",
  whatsapp: "WhatsApp",
  other: "Outro",
};

async function copyToClipboard(value: string) {
  try {
    await navigator.clipboard.writeText(value);
    toast.success("Link copiado.");
  } catch {
    toast.error("Não foi possível copiar. Selecione o link manualmente.");
  }
}

export default function AnalyticsUtms({
  campaigns,
  utmLinks,
  canManage,
  onCreateCampaign,
  onCreateUtm,
}: AnalyticsUtmsProps) {
  const campaignById = new Map(
    campaigns.map((campaign) => [campaign.id, campaign]),
  );

  return (
    <div className="grid gap-5 xl:grid-cols-[0.72fr_1.48fr]">
      <section
        className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm sm:p-5"
        aria-labelledby="utm-campaigns-title"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2
              id="utm-campaigns-title"
              className="text-base font-semibold text-foreground"
            >
              Campanhas
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Cada link guarda um snapshot do nome UTM.
            </p>
          </div>
          {canManage && (
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="h-11 w-11 shrink-0 sm:h-9 sm:w-9"
              onClick={onCreateCampaign}
              aria-label="Criar campanha"
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>

        {campaigns.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 px-4 py-9 text-center">
            <Megaphone
              className="mx-auto mb-3 h-6 w-6 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-sm font-medium text-foreground">
              Crie uma campanha primeiro
            </p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              A campanha conecta os links, métricas e conversões.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {campaigns.map((campaign) => {
              const linkCount = utmLinks.filter(
                (link) => link.campaign_id === campaign.id,
              ).length;
              return (
                <article
                  key={campaign.id}
                  className="rounded-xl border border-border bg-background/60 p-3.5"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="truncate text-sm font-semibold text-foreground">
                        {campaign.name}
                      </h3>
                      <p className="mt-1 text-[11px] text-muted-foreground">
                        {channelLabels[campaign.channel] || campaign.channel}
                      </p>
                    </div>
                    <Badge variant="secondary">{campaign.status}</Badge>
                  </div>
                  <p className="mt-3 font-mono text-[11px] text-primary">
                    {campaign.utm_campaign}
                  </p>
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    {linkCount} {linkCount === 1 ? "link" : "links"}
                  </p>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section
        className="rounded-2xl border border-border bg-card/80 p-4 shadow-sm sm:p-5"
        aria-labelledby="utm-links-title"
      >
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2
              id="utm-links-title"
              className="text-base font-semibold text-foreground"
            >
              Links rastreáveis
            </h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Parâmetros existentes da URL são preservados. Para mudar o
              tracking, crie um novo link.
            </p>
          </div>
          {canManage && (
            <Button
              type="button"
              className="min-h-11 gap-2 sm:min-h-9"
              onClick={onCreateUtm}
              disabled={campaigns.length === 0}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              Novo link UTM
            </Button>
          )}
        </div>

        {utmLinks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 px-5 py-10 text-center">
            <Link2
              className="mx-auto mb-3 h-6 w-6 text-muted-foreground"
              aria-hidden="true"
            />
            <p className="text-sm font-medium text-foreground">
              Nenhum link rastreável ainda
            </p>
            <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-muted-foreground">
              Gere um link por criativo, canal ou posicionamento. Assim a
              origem não fica escondida dentro de uma campanha genérica.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {utmLinks.map((utmLink) => {
              const campaign = campaignById.get(utmLink.campaign_id);
              const built = buildUtmUrl({
                destinationUrl: utmLink.destination_url,
                source: utmLink.utm_source,
                medium: utmLink.utm_medium,
                campaign: utmLink.utm_campaign,
                content: utmLink.utm_content || "",
                term: utmLink.utm_term || "",
              });
              const finalUrl = built.url || utmLink.destination_url;
              return (
                <article
                  key={utmLink.id}
                  className="rounded-xl border border-border bg-background/60 p-4"
                >
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-foreground">
                          {utmLink.name}
                        </h3>
                        <Badge
                          variant={utmLink.active ? "secondary" : "outline"}
                        >
                          {utmLink.active ? "Ativo" : "Inativo"}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {campaign?.name || "Campanha indisponível"}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-11 w-11 sm:h-9 sm:w-9"
                        onClick={() => copyToClipboard(finalUrl)}
                        aria-label={`Copiar link ${utmLink.name}`}
                      >
                        <Copy className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        className="h-11 w-11 sm:h-9 sm:w-9"
                        asChild
                      >
                        <a
                          href={finalUrl}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Abrir link ${utmLink.name} em nova aba`}
                        >
                          <ExternalLink
                            className="h-4 w-4"
                            aria-hidden="true"
                          />
                        </a>
                      </Button>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="mt-4 block min-h-11 w-full cursor-pointer break-all rounded-lg border border-border bg-muted/25 px-3 py-2 text-left font-mono text-[11px] leading-5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => copyToClipboard(finalUrl)}
                    aria-label={`Copiar URL completa de ${utmLink.name}`}
                  >
                    {finalUrl}
                  </button>

                  <dl className="mt-3 flex flex-wrap gap-2 text-[10px]">
                    <div className="rounded-md bg-muted/60 px-2 py-1">
                      <dt className="inline text-muted-foreground">source </dt>
                      <dd className="inline font-mono text-foreground">
                        {utmLink.utm_source}
                      </dd>
                    </div>
                    <div className="rounded-md bg-muted/60 px-2 py-1">
                      <dt className="inline text-muted-foreground">medium </dt>
                      <dd className="inline font-mono text-foreground">
                        {utmLink.utm_medium}
                      </dd>
                    </div>
                    <div className="rounded-md bg-muted/60 px-2 py-1">
                      <dt className="inline text-muted-foreground">campaign </dt>
                      <dd className="inline font-mono text-foreground">
                        {utmLink.utm_campaign}
                      </dd>
                    </div>
                    {utmLink.utm_content && (
                      <div className="rounded-md bg-muted/60 px-2 py-1">
                        <dt className="inline text-muted-foreground">content </dt>
                        <dd className="inline font-mono text-foreground">
                          {utmLink.utm_content}
                        </dd>
                      </div>
                    )}
                    {utmLink.utm_term && (
                      <div className="rounded-md bg-muted/60 px-2 py-1">
                        <dt className="inline text-muted-foreground">term </dt>
                        <dd className="inline font-mono text-foreground">
                          {utmLink.utm_term}
                        </dd>
                      </div>
                    )}
                  </dl>
                </article>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
