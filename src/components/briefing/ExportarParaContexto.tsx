import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, Undo2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Carregando, EstadoDeErro, Secao, botao, etiqueta, juntar, lista, texto } from "@/components/sistema";
import { type PreviaDaExportacao, chamarAgenteDoBriefing, textoDoErroDoBriefing } from "@/lib/briefing/api";
import { valorParaLer } from "@/lib/mesa/preencherComIA";
import { ROTULO_DO_CAMPO_SUGERIDO } from "../../../supabase/functions/_shared/briefing-decupagem";

/**
 * Exportar o briefing para o contexto (frente BRF2, 30/09/2026): os campos que
 * o modelo liga ao contexto (negócio, público, oferta, diferenciais) e as
 * respostas inteiras no cérebro do cliente. Prévia antes, Confirmar grava,
 * Desfazer volta (a memória fica, marcada como desfeita). A marca que não é a
 * principal recebe só no contexto dela. Sem IA e sem custo.
 */

const ROTULO_DO_MODO: Record<string, string> = { preencher: "Preencher", juntar: "Somar", substituir: "Trocar" };

export default function ExportarParaContexto({ briefingId, onMudou }: { briefingId: string; onMudou: () => void }) {
  const [aberta, setAberta] = useState(false);
  const previa = useQuery({
    queryKey: ["briefing-exportar", briefingId],
    queryFn: () => chamarAgenteDoBriefing<PreviaDaExportacao>("exportar_contexto", { briefing_id: briefingId }),
    enabled: aberta,
    staleTime: 0,
  });
  const [escolhidas, setEscolhidas] = useState<string[]>([]);
  const [memoria, setMemoria] = useState(true);
  const [ocupado, setOcupado] = useState<"" | "confirmar" | "desfazer">("");
  useEffect(() => {
    if (previa.data) setEscolhidas(previa.data.sugestoes.filter((s) => s.padrao).map((s) => s.id));
  }, [previa.data]);

  const d = previa.data;
  const destino = d ? (d.destino.tipo === "marca" ? `contexto da marca ${d.destino.marca_nome}` : "contexto do cliente") : "contexto";
  const exportado = d && d.exportado;

  const confirmar = async () => {
    setOcupado("confirmar");
    try {
      const r = await chamarAgenteDoBriefing<{ aplicadas: string[]; memoria_id: string | null; aviso: string | null }>("exportar_contexto", { briefing_id: briefingId, confirmar: true, sugestoes: escolhidas, memoria });
      toast.success(`Exportado para o ${destino}${r.memoria_id ? " e para o cérebro" : ""}. Desfazer fica aqui.`);
      if (r.aviso) toast.warning(r.aviso);
      void previa.refetch();
      onMudou();
    } catch (e) {
      toast.error(textoDoErroDoBriefing(e, "Não foi possível exportar."));
    } finally {
      setOcupado("");
    }
  };
  const desfazer = async () => {
    setOcupado("desfazer");
    try {
      const r = await chamarAgenteDoBriefing<{ voltaram: string[]; mantidos: Array<{ campo: string }> }>("desfazer_exportacao", { briefing_id: briefingId });
      toast.success(r.mantidos.length ? `${r.voltaram.length} voltaram; ${r.mantidos.length} mudaram depois e ficaram.` : "Desfeito. O contexto voltou como estava.");
      void previa.refetch();
      onMudou();
    } catch (e) {
      toast.error(textoDoErroDoBriefing(e, "Não foi possível desfazer."));
    } finally {
      setOcupado("");
    }
  };

  return (
    <Secao
      titulo="Exportar para o contexto"
      descricao={exportado ? "exportado" : undefined}
      ajuda="Leva as respostas para o contexto do cliente (ou da marca) e guarda o briefing inteiro no cérebro, para as mesas usarem. Você vê o que muda antes; nada é gravado sem Confirmar, e Desfazer volta como estava."
      recolher={`briefing:exportar:${briefingId}`}
      recolhidaDeInicio
      divisoria
    >
      {!aberta ? (
        <button type="button" onClick={() => setAberta(true)} className={botao.secundario}>
          <Upload className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Ver o que muda
        </button>
      ) : previa.isLoading ? (
        <Carregando linhas={3} rotulo="Montando a prévia" />
      ) : previa.isError || !d ? (
        <EstadoDeErro titulo="A prévia não abriu." descricao={textoDoErroDoBriefing(previa.error)} acao={<button type="button" onClick={() => void previa.refetch()} className={botao.secundario}>Tentar de novo</button>} />
      ) : (
        <div className="min-w-0 space-y-3">
          {!exportado && d.sugestoes.length > 0 && (
            <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="O que vai para o contexto">
              {d.sugestoes.map((s) => {
                const marcada = escolhidas.indexOf(s.id) >= 0;
                return (
                  <li key={s.id} className={juntar(lista.linha, "items-start")}>
                    <input type="checkbox" id={`exp-${s.id}`} className="mr-3 mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={marcada} onChange={() => setEscolhidas((l) => (marcada ? l.filter((x) => x !== s.id) : l.concat(s.id)))} />
                    <label htmlFor={`exp-${s.id}`} className="min-w-0 flex-1 cursor-pointer">
                      <span className="flex min-w-0 items-center">
                        <span className="truncate text-[13px] font-medium text-foreground">{ROTULO_DO_CAMPO_SUGERIDO[s.campo] || s.rotulo}</span>
                        <span className={juntar(etiqueta, "ml-2 shrink-0 bg-muted text-muted-foreground")}>{ROTULO_DO_MODO[s.modo]}</span>
                      </span>
                      <span className={juntar(texto.corpo, "mt-0.5 block text-muted-foreground [overflow-wrap:anywhere]")}>{valorParaLer(s.valor).slice(0, 400)}</span>
                      {s.modo === "substituir" && s.antes != null && <span className={juntar(texto.auxiliar, "mt-0.5 block [overflow-wrap:anywhere]")}>Hoje: {valorParaLer(s.antes).slice(0, 200)}</span>}
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
          {!exportado && (
            <label className="flex min-w-0 items-start text-[13px] text-foreground">
              <input type="checkbox" className="mr-3 mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={memoria} onChange={(e) => setMemoria(e.target.checked)} />
              <span className="min-w-0">
                Guardar as respostas no cérebro do cliente
                <span className={juntar(texto.auxiliar, "block")}>{d.memoria.caracteres} caracteres, por bloco</span>
              </span>
            </label>
          )}
          <div className="flex min-w-0 flex-wrap items-center justify-end [&>*]:m-0.5">
            {exportado ? (
              <>
                <span className={juntar(texto.auxiliar, "mr-2 flex items-center")}>
                  <Check className="mr-1 h-4 w-4 text-primary" aria-hidden="true" />
                  Gravado no {destino}
                </span>
                <button type="button" onClick={() => void desfazer()} disabled={!!ocupado} className={botao.secundario}>
                  {ocupado === "desfazer" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Undo2 className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                  Desfazer
                </button>
              </>
            ) : (
              <button type="button" onClick={() => void confirmar()} disabled={!!ocupado || (!escolhidas.length && !memoria)} className={botao.primario}>
                {ocupado === "confirmar" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />}
                Confirmar
              </button>
            )}
          </div>
        </div>
      )}
    </Secao>
  );
}
