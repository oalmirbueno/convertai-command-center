import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { guardarFotosParaUsar } from "@/components/mesa-foto/UsoDaFoto";
import { invalidarFotos } from "@/components/mesa-foto/fotoApi";
import { AvisoDoRascunho, CabecalhoDaEtapa, MolduraDaFoto, SemCampanha, useMesaPublicidade } from "./Comuns";
import { DESTINOS, encaminhar, enderecoDoDestino, FUNCOES_DAS_TOMADAS, paraEncaminhar, type DestinoDoAtivo } from "./publicidadeApi";

/**
 * Passo 5: as fotos aprovadas vão para a Mesa (orgânico, Estúdio) e para a
 * Mesa Ads (Estúdio Ads, base de criativo), pelo mesmo caminho do "Usar" da
 * Mesa Foto (&fotos=), com a linhagem registrada: campanha, versão do
 * briefing, território, tomada, versão da foto e fontes do produto.
 * Aprovar a foto não aprova anúncio nem verba.
 */

const rotuloDaFuncao = (f: string | null) => (f ? (FUNCOES_DAS_TOMADAS.find((x) => x.id === f) || { rotulo: f }).rotulo : "Foto");

export default function EtapaEnvio() {
  const { clientId } = useMesa();
  const { campanha, banco, aplicar, irPara } = useMesaPublicidade();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [enviando, setEnviando] = useState<DestinoDoAtivo | null>(null);
  if (!campanha) return <SemCampanha etapa="o envio" />;
  const aprovadas = campanha.revisoes.filter((r) => r.decisao === "aprovada" && r.avaliacao.veredito !== "reprovada");

  const enviar = async (destino: DestinoDoAtivo) => {
    if (enviando) return;
    setEnviando(destino);
    try {
      const r = await encaminhar(campanha, destino);
      aplicar(r.campanha);
      const ids: string[] = r.bruto && Array.isArray(r.bruto.imagem_ids) ? r.bruto.imagem_ids : [];
      const todas = r.campanha.encaminhamentos.filter((e) => e.destino === destino).map((e) => e.imagem_id);
      if (!ids.length && !todas.length) {
        toast.warning("Nenhuma foto para enviar", { description: "Aprove as fotos na revisão antes." });
        return;
      }
      guardarFotosParaUsar(clientId, todas);
      invalidarFotos(queryClient, clientId);
      toast.success(destino === "ads" ? "Fotos na Mesa Ads" : "Fotos na Mesa", {
        description: `${ids.length ? `${ids.length} ${ids.length === 1 ? "nova" : "novas"}, ` : ""}com a linhagem registrada. Anúncio e verba têm aprovação própria.`,
        duration: 9000,
      });
      navigate(enderecoDoDestino(destino, clientId, todas));
    } catch (e) {
      avisarErro(e, "Envio não feito");
    } finally {
      setEnviando(null);
    }
  };

  return (
    <div className="space-y-4" data-etapa-publicidade="envio">
      <CabecalhoDaEtapa titulo="Envio" descricao="Leve as fotos aprovadas para a Mesa e para a Mesa Ads. Aprovar a foto não aprova anúncio nem verba." />
      {!banco && <AvisoDoRascunho />}
      {!aprovadas.length ? (
        <div className="rounded-xl border border-dashed border-border p-6 text-center">
          <p className="text-[13.5px] font-medium">Nenhuma foto aprovada ainda.</p>
          <button type="button" className="mt-2 text-[12.5px] font-medium text-primary hover:underline" onClick={() => irPara("revisao")}>
            Ir para a revisão
          </button>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-aprovadas="">
            {aprovadas.map((r) => {
              const tomada = campanha.tomadas.find((t) => t.foto_tomada_id === r.foto_tomada_id) || null;
              const destinos = campanha.encaminhamentos.filter((e) => e.imagem_id === r.imagem_id).map((e) => (e.destino === "ads" ? "Mesa Ads" : "Mesa"));
              return (
                <div key={`${r.foto_tomada_id}:${r.versao}`} className="min-w-0">
                  <MolduraDaFoto caminho={r.storage_path} alt={`Aprovada v${r.versao}`} rotulo="Gerada" />
                  <p className="mt-1 truncate text-[11.5px] font-medium">
                    {rotuloDaFuncao(tomada ? tomada.funcao : null)} v{r.versao}
                  </p>
                  <p className="truncate text-[10.5px] text-muted-foreground">{destinos.length ? `Em ${destinos.join(" e ")}` : "Ainda em nenhuma mesa"}</p>
                </div>
              );
            })}
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
            {DESTINOS.map((d) => {
              const faltam = paraEncaminhar(campanha.revisoes, d.id, campanha.encaminhamentos).vao.length;
              return (
                <section key={d.id} className="rounded-xl border border-border bg-card p-3.5" data-destino={d.id}>
                  <p className="text-[13px] font-semibold">{d.rotulo}</p>
                  <p className="mt-0.5 text-[12px] text-muted-foreground">{d.dica}</p>
                  <Button type="button" size="sm" className="mt-2 h-9" disabled={!!enviando} onClick={() => void enviar(d.id)}>
                    {enviando === d.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : faltam ? <Send className="mr-1.5 h-3.5 w-3.5" /> : <ArrowRight className="mr-1.5 h-3.5 w-3.5" />}
                    {faltam ? `Mandar ${faltam} ${faltam === 1 ? "foto" : "fotos"}` : "Abrir com as fotos já enviadas"}
                  </Button>
                </section>
              );
            })}
          </div>
        </>
      )}
      {campanha.encaminhamentos.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-3.5" data-linhagem="">
          <p className="text-[13px] font-semibold">Linhagem</p>
          <ul className="mt-1.5 divide-y divide-border text-[11.5px]">
            {campanha.encaminhamentos.map((e) => (
              <li key={`${e.destino}:${e.imagem_id}`} className="py-1 leading-snug [overflow-wrap:anywhere]">
                <span className="font-medium">{e.destino === "ads" ? "Mesa Ads" : "Mesa"}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {rotuloDaFuncao(e.linhagem.funcao || null)} v{e.linhagem.versao} · território {e.linhagem.territorio_nome || "?"} · briefing v{e.linhagem.briefing_versao} ·{" "}
                  {(e.linhagem.fontes_do_produto || []).length} fontes do produto · anúncio e verba sem aprovação
                </span>
              </li>
            ))}
          </ul>
          {!campanha.persistida && <p className="mt-1 text-[11px] text-muted-foreground">Rascunho: a linhagem vale só nesta aba até o banco ser publicado.</p>}
        </section>
      )}
    </div>
  );
}
