import { useState } from "react";
import { Link as LinkDoRouter } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Link2, Loader2, Megaphone, Unlink } from "lucide-react";
import { toast } from "sonner";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { textoDoErro } from "@/lib/mesa/api";
import { botao, juntar, texto } from "@/components/sistema";
import { useMesa } from "./MesaContexto";
import type { Campanha } from "./mesaV4Api";
import { trocarCampanhaNoCache } from "./campanhasApi";
import { adsDaCampanha, chavesDoAds, lerCampanhasDeAds, lerDiasDoAds, linkDaMesaAds, numerosDoAds, vincularAds } from "./campanhaAdsApi";

/**
 * Vínculo opcional com a campanha de anúncios (22/10/2026). Sem vínculo: um botão abre a lista das campanhas
 * de Ads do cliente (as sincronizadas da Meta). Com vínculo: o nome, o gasto e os leads dos últimos 30 dias, o
 * frescor da leitura e o atalho para a Mesa Ads com as peças prontas. Nada sobe para a Meta daqui.
 */

const moeda = (v: number) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function haQuanto(iso: string | null): string {
  if (!iso) return "sem leitura";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (!isFinite(min) || min < 0) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `há ${h} h` : `há ${Math.round(h / 24)} dias`;
}

export default function CampanhaAds({ campanha }: { campanha: Campanha }) {
  const { clientId } = useMesa();
  const qc = useQueryClient();
  const vinculo = adsDaCampanha(campanha);
  const [escolhendo, setEscolhendo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const campanhas = useQuery({ queryKey: chavesDoAds.campanhas(clientId), enabled: escolhendo, staleTime: 60_000, queryFn: () => lerCampanhasDeAds(clientId) });
  const dias = useQuery({
    queryKey: chavesDoAds.numeros(clientId, vinculo ? vinculo.campaign_id : ""),
    enabled: !!vinculo,
    staleTime: 60_000,
    queryFn: () => lerDiasDoAds(clientId, vinculo ? vinculo.campaign_id : ""),
  });
  const n = dias.data ? numerosDoAds(dias.data) : null;

  const salvar = async (escolhida: string | null) => {
    setSalvando(true);
    try {
      const ads = escolhida ? (campanhas.data || []).filter((c) => c.campaign_id === escolhida)[0] || null : null;
      if (escolhida && !ads) return;
      const r = await vincularAds(campanha, ads);
      if (r && r.campanha) trocarCampanhaNoCache(qc, clientId, r.campanha);
      setEscolhendo(false);
      toast.success(ads ? "Campanha de anúncios vinculada" : "Vínculo desfeito");
    } catch (e) {
      toast.error("Vínculo não salvo", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };

  if (!vinculo) {
    return (
      <div className="flex min-w-0 flex-wrap items-center" data-campanha-ads="sem-vinculo">
        <Megaphone className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className={juntar(texto.auxiliar, "mr-2 min-w-0 flex-1 truncate")}>Anúncios: sem vínculo</span>
        {escolhendo ? (
          <Select onValueChange={(v) => void salvar(v)} disabled={salvando || campanhas.isLoading}>
            <SelectTrigger className="h-8 w-full min-w-0 text-[12px] sm:w-[260px]" aria-label="Campanha de anúncios">
              <SelectValue placeholder={campanhas.isLoading ? "Lendo campanhas…" : (campanhas.data || []).length ? "Escolha a campanha de anúncios" : "Nenhuma campanha de anúncios"} />
            </SelectTrigger>
            <SelectContent>
              {(campanhas.data || []).map((c) => (
                <SelectItem key={c.campaign_id} value={c.campaign_id}>
                  {c.name || c.campaign_id}{c.effective_status ? ` · ${c.effective_status === "ACTIVE" ? "ativa" : "pausada"}` : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <button type="button" className={botao.icone} onClick={() => setEscolhendo(true)} aria-label="Vincular a uma campanha de anúncios" title="Vincular a uma campanha de anúncios (opcional)">
            <Link2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="min-w-0" data-campanha-ads="vinculada">
      <div className="flex min-w-0 items-center">
        <Megaphone className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <span className="mr-2 min-w-0 flex-1 truncate text-[13px] font-medium" title={vinculo.nome}>{vinculo.nome}</span>
        {salvando && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Salvando" />}
        <LinkDoRouter to={linkDaMesaAds(clientId, campanha.id)} className={juntar(botao.icone, "text-primary hover:text-primary")} aria-label="Abrir na Mesa Ads" title="Abrir na Mesa Ads com as peças prontas como criativos">
          <ExternalLink className="h-4 w-4" aria-hidden="true" />
        </LinkDoRouter>
        <button type="button" className={botao.icone} onClick={() => void salvar(null)} disabled={salvando} aria-label="Desvincular a campanha de anúncios" title="Desvincular a campanha de anúncios">
          <Unlink className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <p className={juntar(texto.auxiliar, "mt-1")} data-numeros-do-ads="">
        {dias.isLoading
          ? "Lendo os números…"
          : n && n.dias
            ? `30 dias: ${moeda(n.gasto)} gastos · ${n.leads} ${n.leads === 1 ? "lead" : "leads"} · Meta lida ${haQuanto(n.lidoEm)}`
            : "Sem números da Meta ainda."}
      </p>
    </div>
  );
}
