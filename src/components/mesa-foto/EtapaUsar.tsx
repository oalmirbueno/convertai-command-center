import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowUpRight, Loader2, Megaphone, PenTool } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Ampliar } from "@/components/mesa/Ampliar";
import { AvisoDeErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { BotoesDeUso } from "./AcoesDeUso";
import { Cartao, MiniaturaDaFoto, Pilulas, SeloDaFoto, useMesaFoto, Vazio } from "./Comuns";
import { classeDaFoto, useEnsaios, useFotos, type FotoDoAcervo } from "./fotoApi";

/**
 * Etapa 6, Usar: as fotos aprovadas saem da Mesa Foto. Baixar em ZIP,
 * mandar para Arquivos ou para aprovação, e levar para a Mesa ou a Mesa Ads.
 * A foto aprovada já está no acervo único do cliente (cliente_imagens): o
 * Estúdio das duas mesas a encontra em "Fotos > Do acervo", sem upload de
 * novo e sem perder a origem. Aprovar a foto não aprova a arte ou o anúncio.
 */

/** Guarda as fotos escolhidas para o Estúdio da outra mesa (sessão do navegador). */
export const chaveDasFotosParaUsar = (clientId: string) => `mesa-foto:para-usar:${clientId}`;

export function guardarFotosParaUsar(clientId: string, ids: string[]) {
  try {
    window.sessionStorage.setItem(chaveDasFotosParaUsar(clientId), JSON.stringify({ ids: ids.slice(0, 20), em: Date.now() }));
  } catch {
    /* sem armazenamento: a foto segue no acervo do mesmo jeito */
  }
}

/** Endereço do Estúdio da mesa de destino, com as fotos escolhidas no endereço. */
export function enderecoParaUsar(destino: "mesa" | "ads", clientId: string, ids: string[]): string {
  const fotos = ids.slice(0, 20).join(",");
  return destino === "mesa" ? `/mesa?client=${clientId}&aba=estudio&fotos=${fotos}` : `/mesa-ads?client=${clientId}&etapa=estudio&fotos=${fotos}`;
}

type Origem = "aprovadas" | "ensaio" | "todas_tratadas";

export default function EtapaUsar() {
  const { clientId } = useMesa();
  const navigate = useNavigate();
  const { ensaioId, irPara } = useMesaFoto();
  const fotos = useFotos(clientId);
  const ensaios = useEnsaios(clientId);
  const todas = useMemo(() => fotos.data || [], [fotos.data]);
  const ensaio = ensaioId ? (ensaios.data || []).find((e) => e.id === ensaioId) || null : null;
  const [origem, setOrigem] = useState<Origem>(ensaio ? "ensaio" : "aprovadas");
  const [marcadas, setMarcadas] = useState<string[] | null>(null);
  const [ampliada, setAmpliada] = useState<number | null>(null);

  const idsDoEnsaio = useMemo(() => {
    const ids: string[] = [];
    if (ensaio) {
      for (const t of ensaio.tomadas) {
        for (const v of t.versoes) if (v.aprovada && v.imagem_id) ids.push(v.imagem_id);
      }
    }
    return ids;
  }, [ensaio]);

  const lista: FotoDoAcervo[] = useMemo(() => {
    if (origem === "ensaio") return todas.filter((f) => idsDoEnsaio.indexOf(f.id) >= 0 || (f.aprovada && ensaio && f.kit_id === ensaio.kit_id && classeDaFoto(f) === "gerada"));
    if (origem === "todas_tratadas") return todas.filter((f) => f.aprovada || classeDaFoto(f) === "derivada");
    return todas.filter((f) => f.aprovada);
  }, [todas, origem, idsDoEnsaio, ensaio]);

  // Começa com todas as da lista marcadas; trocar a lista marca de novo.
  useEffect(() => setMarcadas(null), [origem]);
  const escolhidasIds = marcadas === null ? lista.map((f) => f.id) : marcadas.filter((id) => lista.some((f) => f.id === id));
  const escolhidas = lista.filter((f) => escolhidasIds.indexOf(f.id) >= 0);
  const geradas = escolhidas.filter((f) => classeDaFoto(f) === "gerada").length;

  const alternar = (id: string) => {
    const base = escolhidasIds;
    setMarcadas(base.indexOf(id) >= 0 ? base.filter((x) => x !== id) : base.concat([id]));
  };

  const usarEm = (destino: "mesa" | "ads") => {
    if (!escolhidas.length) return;
    const ids = escolhidas.map((f) => f.id);
    guardarFotosParaUsar(clientId, ids);
    toast.success(destino === "mesa" ? "Abrindo o Estúdio da Mesa" : "Abrindo o Estúdio da Mesa Ads", {
      description: `${ids.length === 1 ? "A foto já está" : `As ${ids.length} fotos já estão`} no acervo do cliente: na lâmina, abra Fotos e depois Do acervo${escolhidas[0] ? ` (busque "${escolhidas[0].nome}")` : ""}.`,
      duration: 9000,
    });
    navigate(enderecoParaUsar(destino, clientId, ids));
  };

  const opcoes: { valor: Origem; rotulo: string }[] = [{ valor: "aprovadas", rotulo: "Todas as aprovadas" }];
  if (ensaio) opcoes.push({ valor: "ensaio", rotulo: "Deste ensaio" });
  opcoes.push({ valor: "todas_tratadas", rotulo: "Aprovadas e tratadas" });

  return (
    <div className="min-w-0 space-y-4 pb-24">
      <Cartao
        titulo="Fotos prontas para usar"
        dica="Aprovar a foto não aprova a arte ou o anúncio feito com ela. Foto gerada sai sempre marcada."
        acao={<Pilulas rotulo="Quais fotos" opcoes={opcoes} valor={origem} onEscolher={setOrigem} />}
      >
        {fotos.isLoading && (
          <p className="flex items-center text-[12px] text-muted-foreground">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Lendo o acervo...
          </p>
        )}
        {fotos.isError && <AvisoDeErro erro={fotos.error} />}
        {fotos.isSuccess && lista.length === 0 && (
          <Vazio
            titulo="Nenhuma foto aprovada aqui"
            acao={
              <Button type="button" size="sm" variant="outline" className="h-8 text-[12px]" onClick={() => irPara("revisar")}>
                Revisar as tomadas
              </Button>
            }
          >
            Aprove versões na etapa Revisar ou trate fotos na etapa Preparar.
          </Vazio>
        )}
        {lista.length > 0 && (
          <>
            <div className="mb-2 flex min-w-0 flex-wrap items-center text-[12px] text-muted-foreground">
              <span className="mr-3">
                {escolhidas.length} de {lista.length} {lista.length === 1 ? "escolhida" : "escolhidas"}
                {geradas ? ` · ${geradas} ${geradas === 1 ? "gerada" : "geradas"}` : ""}
              </span>
              <button type="button" className="mr-3 font-medium text-primary hover:underline" onClick={() => setMarcadas(lista.map((f) => f.id))}>
                Marcar todas
              </button>
              <button type="button" className="font-medium text-primary hover:underline" onClick={() => setMarcadas([])}>
                Desmarcar
              </button>
            </div>
            <ul className="grid min-w-0 grid-cols-3 gap-1.5 sm:grid-cols-4 md:grid-cols-6 xl:grid-cols-8">
              {lista.map((f, i) => {
                const marcada = escolhidasIds.indexOf(f.id) >= 0;
                return (
                  <li key={f.id} className={`relative min-w-0 rounded-xl border bg-card p-1.5 ${marcada ? "border-primary" : "border-border opacity-70"}`}>
                    <button type="button" className="block w-full min-w-0 text-left" onClick={() => setAmpliada(i)} aria-label={`Ver ${f.nome} grande`}>
                      <MiniaturaDaFoto foto={f} />
                    </button>
                    <span className="mt-1 block truncate px-0.5 text-[11.5px] font-medium">{f.nome}</span>
                    <span className="block min-h-[18px] px-0.5">
                      <SeloDaFoto foto={f} compacto />
                    </span>
                    <label className="absolute right-2.5 top-2.5 flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-border bg-card shadow-sm">
                      <input type="checkbox" checked={marcada} onChange={() => alternar(f.id)} className="h-3.5 w-3.5" aria-label={`Usar ${f.nome}`} />
                    </label>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </Cartao>

      {lista.length > 0 && (
        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2">
          <Cartao titulo="Levar para fora">
            <BotoesDeUso fotos={escolhidas} />
          </Cartao>
          <Cartao titulo="Usar nas mesas" dica="A foto entra no Estúdio pelo acervo, sem upload de novo.">
            <div className="flex min-w-0 flex-wrap">
              <Button type="button" size="sm" className="mb-1.5 mr-1.5 h-8 text-[12px]" disabled={!escolhidas.length} onClick={() => usarEm("mesa")}>
                <PenTool className="mr-1.5 h-3.5 w-3.5" /> Usar na Mesa <ArrowUpRight className="ml-1 h-3 w-3" />
              </Button>
              <Button type="button" size="sm" variant="outline" className="mb-1.5 h-8 text-[12px]" disabled={!escolhidas.length} onClick={() => usarEm("ads")}>
                <Megaphone className="mr-1.5 h-3.5 w-3.5" /> Usar na Mesa Ads <ArrowUpRight className="ml-1 h-3 w-3" />
              </Button>
            </div>
          </Cartao>
        </div>
      )}

      <Ampliar
        imagens={lista.map((f) => ({
          caminho: f.storage_path,
          bucket: f.storage_bucket || "mesa",
          titulo: f.nome,
          legenda: classeDaFoto(f) === "gerada" ? "Imagem gerada por IA" : undefined,
          proporcao: f.largura && f.altura ? f.largura / f.altura : undefined,
        }))}
        indice={ampliada}
        onFechar={() => setAmpliada(null)}
      />
    </div>
  );
}
