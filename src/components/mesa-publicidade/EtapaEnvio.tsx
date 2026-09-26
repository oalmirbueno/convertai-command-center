import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { guardarFotosParaUsar } from "@/components/mesa-foto/UsoDaFoto";
import { invalidarFotos } from "@/components/mesa-foto/fotoApi";
import { EstadoVazio } from "@/components/sistema/Estados";
import { botao, juntar, superficie, texto } from "@/components/sistema/estilos";
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
    <div className="min-w-0 space-y-5" data-etapa-publicidade="envio">
      <CabecalhoDaEtapa
        titulo="Envio"
        ajuda="Leve as fotos aprovadas para a Mesa e para a Mesa Ads, com a linhagem registrada: campanha, versão do briefing, território, tomada, versão da foto e fontes do produto."
        estado="Aprovar a foto não aprova anúncio nem verba."
      />
      {!banco && <AvisoDoRascunho />}
      {!aprovadas.length ? (
        <EstadoVazio
          icone={<Send className="h-5 w-5" />}
          titulo="Nenhuma foto aprovada ainda."
          acao={
            <button type="button" className={botao.secundario} onClick={() => irPara("revisao")}>
              Ir para a revisão
            </button>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-aprovadas="">
            {aprovadas.map((r) => {
              const tomada = campanha.tomadas.find((t) => t.foto_tomada_id === r.foto_tomada_id) || null;
              const destinos = campanha.encaminhamentos.filter((e) => e.imagem_id === r.imagem_id).map((e) => (e.destino === "ads" ? "Mesa Ads" : "Mesa"));
              return (
                <div key={`${r.foto_tomada_id}:${r.versao}`} className="min-w-0">
                  <MolduraDaFoto caminho={r.storage_path} alt={`Aprovada v${r.versao}`} rotulo="Gerada" />
                  <p className="mt-1 truncate text-[12px] font-medium">
                    {rotuloDaFuncao(tomada ? tomada.funcao : null)} v{r.versao}
                  </p>
                  <p className="truncate text-[11px] text-muted-foreground">{destinos.length ? `Em ${destinos.join(" e ")}` : "Ainda em nenhuma mesa"}</p>
                </div>
              );
            })}
          </div>
          <ul className={juntar(superficie.painel, "divide-y divide-border")}>
            {DESTINOS.map((d) => {
              const faltam = paraEncaminhar(campanha.revisoes, d.id, campanha.encaminhamentos).vao.length;
              return (
                <li key={d.id} className="flex min-w-0 items-center px-4 py-3" data-destino={d.id}>
                  <div className="mr-3 min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold">{d.rotulo}</p>
                    <p className={juntar(texto.auxiliar, "truncate")} title={d.dica}>
                      {d.dica}
                    </p>
                  </div>
                  <button type="button" className={juntar(faltam ? botao.primario : botao.secundario, "max-w-[55%]")} disabled={!!enviando} onClick={() => void enviar(d.id)}>
                    {enviando === d.id ? <Loader2 className="mr-1.5 h-3.5 w-3.5 shrink-0 animate-spin" /> : faltam ? <Send className="mr-1.5 h-3.5 w-3.5 shrink-0" /> : <ArrowRight className="mr-1.5 h-3.5 w-3.5 shrink-0" />}
                    <span className="min-w-0 truncate">{faltam ? `Mandar ${faltam} ${faltam === 1 ? "foto" : "fotos"}` : "Abrir com as fotos enviadas"}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {campanha.encaminhamentos.length > 0 && (
        <section className="min-w-0 space-y-2" data-linhagem="">
          <CabecalhoDaEtapa
            nivel={3}
            titulo="Linhagem"
            ajuda="Cada foto enviada guarda de onde veio. Anúncio e verba seguem sem aprovação até a Mesa Ads aprovar."
            estado={!campanha.persistida ? "Rascunho: vale só nesta aba até o banco ser publicado." : `${campanha.encaminhamentos.length} ${campanha.encaminhamentos.length === 1 ? "envio" : "envios"}`}
          />
          <ul className="divide-y divide-border border-t border-border text-[12px]">
            {campanha.encaminhamentos.map((e) => (
              <li key={`${e.destino}:${e.imagem_id}`} className="py-1.5 leading-snug [overflow-wrap:anywhere]">
                <span className="font-medium">{e.destino === "ads" ? "Mesa Ads" : "Mesa"}</span>
                <span className="text-muted-foreground">
                  {" "}
                  · {rotuloDaFuncao(e.linhagem.funcao || null)} v{e.linhagem.versao} · território {e.linhagem.territorio_nome || "?"} · briefing v{e.linhagem.briefing_versao} ·{" "}
                  {(e.linhagem.fontes_do_produto || []).length} fontes do produto · anúncio e verba sem aprovação
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
