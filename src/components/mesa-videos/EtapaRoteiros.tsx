import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link2, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { textoDoErro } from "@/lib/mesa/api";
import { Cartao, Vazio } from "@/components/mesa-foto/Comuns";
import { VIEW_DOS_ROTEIROS } from "../../../supabase/functions/_shared/roteiros-para-video";
import { AvisoDeAtivacao } from "./Comuns";
import {
  chamarMesaVideos,
  chaveDosVinculos,
  useArquivosDeVideo,
  useHistorias,
  useRoteirosAprovados,
  useVinculos,
  type VinculoDeRoteiro,
} from "./videosApi";

/**
 * Roteiro e cenas: os roteiros aprovados da Mesa Roteiros (frente R2) ligados
 * às cenas da História do Canvas. A ligação é só pelo roteiro_id e pela
 * referência da cena (contrato em roteiros-para-video.ts); nada do código da
 * Mesa Roteiros é usado aqui. Cada ligação se desfaz na hora.
 */

const campo = "h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-[12px]";

export default function EtapaRoteiros() {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const roteirosQ = useRoteirosAprovados(clientId);
  const historiasQ = useHistorias(clientId);
  const vinculosQ = useVinculos(clientId);
  const arquivosQ = useArquivosDeVideo(clientId);
  const roteiros = (roteirosQ.data && roteirosQ.data.roteiros) || [];
  const [roteiroId, setRoteiroId] = useState<string>("");
  const [salvando, setSalvando] = useState<string | null>(null);
  useEffect(() => {
    if (!roteiroId && roteiros.length) setRoteiroId(roteiros[0].id);
  }, [roteiroId, roteiros]);
  const roteiro = roteiros.find((r) => r.id === roteiroId) || null;
  const cenasDoCanvas = useMemo(
    () =>
      ((historiasQ.data && historiasQ.data.historias) || []).reduce(
        (lista, h) => lista.concat(h.cenas.map((c) => ({ chave: `${c.canvas_id}|${c.no_id}`, canvas_id: c.canvas_id, no_id: c.no_id, rotulo: `${h.nome} · ${c.numero}. ${c.titulo || "Cena"}` }))),
        [] as { chave: string; canvas_id: string; no_id: string; rotulo: string }[],
      ),
    [historiasQ.data],
  );
  const vinculos = (vinculosQ.data && vinculosQ.data.itens) || [];
  const arquivos = (arquivosQ.data && arquivosQ.data.arquivos) || [];

  const recarregar = () => void queryClient.invalidateQueries({ queryKey: chaveDosVinculos(clientId) });

  const ligar = async (cenaRef: string, chave: string) => {
    const alvo = cenasDoCanvas.find((c) => c.chave === chave);
    if (!alvo || !roteiro) return;
    setSalvando(cenaRef);
    try {
      await chamarMesaVideos({ acao: "vinculo_salvar", client_id: clientId, roteiro_id: roteiro.id, cena_ref: cenaRef, canvas_id: alvo.canvas_id, no_id: alvo.no_id });
      recarregar();
    } catch (e) {
      toast.error("Não foi possível ligar", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setSalvando(null);
    }
  };

  const desligar = async (v: VinculoDeRoteiro) => {
    setSalvando(v.cena_ref);
    try {
      await chamarMesaVideos({ acao: "vinculo_remover", vinculo_id: v.id });
      recarregar();
      toast.success("Ligação removida", {
        action: {
          label: "Desfazer",
          onClick: () => {
            void chamarMesaVideos({ acao: "vinculo_salvar", client_id: clientId, roteiro_id: v.roteiro_id, cena_ref: v.cena_ref, canvas_id: v.canvas_id, no_id: v.no_id }).then(recarregar, (e) =>
              toast.error("Não foi possível refazer", { description: textoDoErro(e) }),
            );
          },
        },
      });
    } catch (e) {
      toast.error("Não foi possível remover", { description: textoDoErro(e) });
    } finally {
      setSalvando(null);
    }
  };

  if (roteirosQ.isLoading) return <div className="h-40 animate-pulse rounded-xl bg-muted" aria-busy="true" />;
  if (roteirosQ.data && !roteirosQ.data.disponivel) {
    return (
      <Cartao titulo="Roteiros aprovados" dica="Vêm da Mesa Roteiros, só pelo id do roteiro.">
        <AvisoDeAtivacao>
          A Mesa Roteiros ainda não publicou os roteiros aprovados para a Mesa Vídeos (view {VIEW_DOS_ROTEIROS}). Enquanto isso, os takes se organizam pelos nomes e grupos na Edição.
        </AvisoDeAtivacao>
      </Cartao>
    );
  }
  if (!roteiros.length) {
    return <Vazio titulo="Nenhum roteiro aprovado">Aprove um roteiro na Mesa Roteiros. Ele aparece aqui para ligar às cenas e aos takes.</Vazio>;
  }

  return (
    <div className="space-y-4">
      {vinculosQ.data && !vinculosQ.data.disponivel && <AvisoDeAtivacao>As ligações de roteiro e cena ainda não foram ativadas no banco (SQL V2-01).</AvisoDeAtivacao>}
      <Cartao
        titulo="Roteiro e cenas"
        dica="Ligue cada cena do roteiro à cena da História que vai virar vídeo. Os takes gravados de cada cena aparecem ao lado."
        acao={
          <select className={`${campo} w-auto max-w-[260px]`} value={roteiroId} onChange={(e) => setRoteiroId(e.target.value)} aria-label="Roteiro aprovado">
            {roteiros.map((r) => (
              <option key={r.id} value={r.id}>
                {r.titulo}
              </option>
            ))}
          </select>
        }
      >
        {roteiro && roteiro.cenas.length ? (
          <ol className="divide-y divide-border" aria-label={`Cenas de ${roteiro.titulo}`}>
            {roteiro.cenas.map((c) => {
              const ligados = vinculos.filter((v) => v.roteiro_id === roteiro.id && v.cena_ref === c.ref);
              const takes = arquivos.filter((a) => a.roteiro_id === roteiro.id && a.cena_ref === c.ref && a.estado !== "arquivado");
              const livres = cenasDoCanvas.filter((x) => !ligados.some((v) => v.canvas_id === x.canvas_id && v.no_id === x.no_id));
              return (
                <li key={c.ref} className="grid min-w-0 gap-2 py-2 md:grid-cols-2" data-cena-do-roteiro={c.ref}>
                  <div className="min-w-0">
                    <p className="text-[12.5px] font-medium">
                      {c.ordem}. {c.titulo || "Cena"}
                    </p>
                    {c.fala && <p className="line-clamp-3 text-[11.5px] text-muted-foreground">{c.fala}</p>}
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {takes.length ? `${takes.length} ${takes.length === 1 ? "take" : "takes"}${takes.some((t) => t.melhor) ? ", com melhor marcado" : ""}` : "Sem take ligado"}
                    </p>
                  </div>
                  <div className="min-w-0">
                    {ligados.map((v) => {
                      const x = cenasDoCanvas.find((k) => k.canvas_id === v.canvas_id && k.no_id === v.no_id);
                      return (
                        <p key={v.id} className="mb-1 flex min-w-0 items-center rounded-md bg-muted px-2 py-1 text-[11.5px]">
                          <Link2 className="mr-1.5 h-3 w-3 shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{x ? x.rotulo : "Cena que saiu da História"}</span>
                          <button type="button" className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-foreground" aria-label="Remover ligação" onClick={() => void desligar(v)}>
                            <X className="h-3 w-3" />
                          </button>
                        </p>
                      );
                    })}
                    {livres.length > 0 ? (
                      <div className="flex min-w-0 items-center">
                        <select className={campo} value="" onChange={(e) => e.target.value && void ligar(c.ref, e.target.value)} aria-label={`Ligar a cena ${c.ordem} a uma cena da História`} disabled={salvando === c.ref}>
                          <option value="">Ligar a uma cena da História...</option>
                          {livres.map((x) => (
                            <option key={x.chave} value={x.chave}>
                              {x.rotulo}
                            </option>
                          ))}
                        </select>
                        {salvando === c.ref && <Loader2 className="ml-1.5 h-3.5 w-3.5 shrink-0 animate-spin" />}
                      </div>
                    ) : (
                      !cenasDoCanvas.length && <p className="text-[11px] text-muted-foreground">Nenhuma cena na História do Canvas ainda.</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        ) : (
          <p className="text-[12px] text-muted-foreground">Este roteiro não tem cenas.</p>
        )}
      </Cartao>
    </div>
  );
}
