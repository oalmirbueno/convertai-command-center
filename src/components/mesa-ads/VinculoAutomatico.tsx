import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Link2, Loader2, RefreshCw, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { AvisoDeErro, useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { usd } from "@/lib/mesa/api";
import { brl, chavesAds } from "./adsApi";
import { Foto } from "./Comuns";
import { chavesVinculo, confirmarVinculo, desfazerVinculo, lerVinculos, rotuloDaConfianca, type ItemDeVinculo } from "./vinculoApi";

/**
 * Vínculo automático (substitui "anúncios sem vínculo", pedido do dono em
 * 26/09/2026): ao abrir, a Mesa Ads casa os anúncios da conta com os
 * criativos dela por imagem, nome, utm, texto, título, campanha e datas, liga
 * sozinha o que é certo e manda o incerto ao Jev (centavos, custo mostrado
 * aqui). Só o que continua incerto pede a confirmação da equipe.
 */

function Miniatura({ src, alt }: { src: string | null; alt: string }) {
  return (
    <span className="relative block w-10 shrink-0 overflow-hidden rounded-md border border-border bg-secondary/40" style={{ paddingTop: "125%" }}>
      <span className="absolute inset-0 block">
        <Foto src={src} alt={alt} className="h-full w-full" />
      </span>
    </span>
  );
}

const ROTULO_DA_ORIGEM: Record<string, string> = {
  automatico: "reconhecido pelo painel",
  jev: "escolhido pelo Jev",
  ja_ligado: "já ligado",
};

export default function VinculoAutomatico() {
  const { clientId, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const q = useQuery({
    queryKey: chavesVinculo.vinculos(clientId),
    queryFn: async () => {
      const v = await lerVinculos(clientId, true);
      if (v.custo_usd > 0) atualizarCusto();
      return v;
    },
    staleTime: 10 * 60_000,
    retry: false,
  });
  const v = q.data || null;
  const confirmar = v ? v.itens.filter((i) => i.origem === "confirmar") : [];
  const novos = v ? v.itens.filter((i) => i.origem === "automatico" || i.origem === "jev") : [];
  const semPar = v ? v.itens.filter((i) => i.origem === "sem_par") : [];

  const depois = async () => {
    await queryClient.invalidateQueries({ queryKey: chavesVinculo.vinculos(clientId) });
    void queryClient.invalidateQueries({ queryKey: chavesAds.criativos(clientId) });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "urls", "ads-conta", clientId] });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "urls", "ads-resultados", clientId] });
    void queryClient.invalidateQueries({ queryKey: ["mesa", "ads", "resultados", clientId] });
  };
  const agir = async (chave: string, fn: () => Promise<unknown>, ok: string) => {
    setOcupado(chave);
    try {
      const r: any = await fn();
      toast.success(ok, r && r.aviso ? { description: r.aviso } : undefined);
      await depois();
    } catch (e) {
      avisarErro(e, "Não foi possível mudar o vínculo");
    } finally {
      setOcupado(null);
    }
  };

  const Candidatos = ({ i }: { i: ItemDeVinculo }) => (
    <ul className="mt-2 space-y-1.5">
      {i.candidatos.map((c) => (
        <li key={c.criativo_id} className="flex min-w-0 flex-wrap items-center rounded-lg bg-muted/50 px-2.5 py-1.5">
          <span className="mr-2 min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium">{c.nome}</span>
            <span className="block text-[11px] text-muted-foreground [overflow-wrap:anywhere]">
              {Math.round(c.confianca * 100)}% ({rotuloDaConfianca(c.confianca)}){c.sinais.length ? `: ${c.sinais.join(", ")}` : ""}
            </span>
          </span>
          <Button type="button" size="sm" className="mr-1 h-7 text-[11.5px]" disabled={!!ocupado} onClick={() => void agir(`${i.peca}:${c.criativo_id}`, () => confirmarVinculo(clientId, c.criativo_id, i.anuncio.ad_id), "Anúncio ligado ao criativo")}>
            {ocupado === `${i.peca}:${c.criativo_id}` ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}É este
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-7 text-[11.5px]" disabled={!!ocupado} onClick={() => void agir(`${i.peca}:${c.criativo_id}:n`, () => desfazerVinculo(clientId, c.criativo_id, i.anuncio.ad_id, true), "Guardado: não é este")}>
            <X className="mr-1 h-3 w-3" />Não é
          </Button>
        </li>
      ))}
    </ul>
  );

  return (
    <section className="min-w-0 rounded-xl border border-border bg-card p-4" aria-label="Vínculo automático">
      <div className="flex min-w-0 flex-wrap items-start">
        <Link2 className="mb-1 mr-2 mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="mb-1 mr-3 min-w-0 flex-1">
          <h3 className="text-[13.5px] font-semibold">Anúncios e criativos da Mesa Ads</h3>
          <p className="text-[11.5px] text-muted-foreground">
            Reconhecidos sozinhos pela imagem, pelo nome, pelo texto, pelo título, pela campanha e pelas datas. O Jev confere os incertos; só o que continua incerto pede a sua confirmação.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" className="mb-1 h-8" disabled={q.isFetching} onClick={() => void q.refetch()} title="Reconhece de novo">
          {q.isFetching ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
          Reconhecer de novo
        </Button>
      </div>
      {q.isError && <AvisoDeErro erro={q.error} />}
      {q.isLoading && (
        <p className="mt-2 flex items-center text-[12px] text-muted-foreground" aria-busy="true">
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Comparando os anúncios da conta com os criativos da Mesa Ads...
        </p>
      )}
      {v && (
        <>
          <div className="mt-2 flex min-w-0 flex-wrap text-[11.5px]" aria-label="Resumo do vínculo">
            <span className="mb-1 mr-2 rounded-full bg-secondary px-2 py-0.5">{v.resumo.ja_ligados} já ligados</span>
            {v.resumo.automaticos > 0 && <span className="mb-1 mr-2 rounded-full bg-success/10 px-2 py-0.5 text-success">{v.resumo.automaticos} reconhecidos agora</span>}
            {v.resumo.pelo_jev > 0 && <span className="mb-1 mr-2 rounded-full bg-success/10 px-2 py-0.5 text-success">{v.resumo.pelo_jev} pelo Jev</span>}
            {v.resumo.confirmar > 0 && <span className="mb-1 mr-2 rounded-full bg-warning/15 px-2 py-0.5 text-warning">{v.resumo.confirmar} para confirmar</span>}
            <span className="mb-1 mr-2 rounded-full bg-secondary px-2 py-0.5 text-muted-foreground">{v.resumo.sem_par} feitos fora da Mesa Ads</span>
            {v.custo_usd > 0 && <span className="mb-1 mr-2 px-1 py-0.5 tabular-nums text-muted-foreground">Conferência do Jev: {usd(v.custo_usd)}</span>}
          </div>
          {v.jev_erro && <p className="mt-1 text-[11.5px] text-muted-foreground">O Jev não respondeu agora; os incertos ficaram para você confirmar.</p>}
          {v.impressoes.pendentes > 0 && <p className="mt-1 text-[11.5px] text-muted-foreground">{v.impressoes.pendentes} imagens ainda não foram comparadas: reconheça de novo para continuar.</p>}
          {!v.historico_disponivel && <p className="mt-1 text-[11px] text-muted-foreground">As recusas ainda não ficam guardadas (banco sem a tabela nova): um par recusado pode voltar como sugestão.</p>}

          {confirmar.length > 0 && (
            <div className="mt-3 min-w-0 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-warning">Confirme ({confirmar.length})</p>
              {confirmar.map((i) => (
                <div key={i.peca} className="min-w-0 rounded-lg border border-border p-2.5">
                  <div className="flex min-w-0 items-start">
                    <Miniatura src={i.anuncio.imagem_url} alt={i.anuncio.nome} />
                    <div className="ml-2.5 min-w-0 flex-1">
                      <p className="truncate text-[12.5px] font-medium">{i.anuncio.nome}</p>
                      <p className="truncate text-[11px] text-muted-foreground">
                        {[i.anuncio.campanha, `${brl(i.anuncio.gasto_90d)} em 90 dias`, i.anuncio.ad_ids.length > 1 ? `mesma arte em ${i.anuncio.ad_ids.length} anúncios` : ""].filter(Boolean).join(" · ")}
                      </p>
                      {i.anuncio.corpo && <p className="mt-0.5 line-clamp-2 text-[11.5px] text-foreground/80 [overflow-wrap:anywhere]">{i.anuncio.corpo}</p>}
                    </div>
                  </div>
                  <Candidatos i={i} />
                </div>
              ))}
            </div>
          )}

          {novos.length > 0 && (
            <details className="mt-3 min-w-0" open={confirmar.length === 0}>
              <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-success">Ligados agora ({novos.length})</summary>
              <ul className="mt-2 space-y-1.5">
                {novos.map((i) => (
                  <li key={i.peca} className="flex min-w-0 items-center rounded-lg border border-border px-2.5 py-1.5">
                    <Miniatura src={i.anuncio.imagem_url} alt={i.anuncio.nome} />
                    <span className="ml-2.5 mr-2 min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium">{i.anuncio.nome}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {i.criativo ? `${i.criativo.nome}` : ""} · {Math.round(i.confianca * 100)}% · {ROTULO_DA_ORIGEM[i.origem] || ""}
                        {i.sinais.length ? ` (${i.sinais.join(", ")})` : ""}
                      </span>
                    </span>
                    {i.criativo && (
                      <Button type="button" size="sm" variant="ghost" className="h-7 shrink-0 text-[11.5px]" disabled={!!ocupado} onClick={() => void agir(`${i.peca}:d`, () => desfazerVinculo(clientId, i.criativo!.id, i.anuncio.ad_id, true), "Vínculo desfeito")}>
                        Desfazer
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {semPar.length > 0 && (
            <details className="mt-3 min-w-0">
              <summary className="cursor-pointer text-[11.5px] text-muted-foreground">
                {semPar.length} anúncio{semPar.length === 1 ? "" : "s"} sem criativo da Mesa Ads (feitos fora da Mesa ou sem par seguro)
              </summary>
              <ul className="mt-2 space-y-1">
                {semPar.slice(0, 30).map((i) => (
                  <li key={i.peca} className="truncate text-[11.5px] text-muted-foreground">
                    {i.anuncio.nome} · {brl(i.anuncio.gasto_90d)}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </section>
  );
}
