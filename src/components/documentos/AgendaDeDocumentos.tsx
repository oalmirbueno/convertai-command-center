import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { CampoDeFormulario, GrupoDeCampos, Secao, botao, campo as estiloDoCampo, juntar, texto } from "@/components/sistema";
import { textoDoErro } from "@/lib/mesa/api";
import { lerAgendas, salvarAgenda } from "@/lib/documentos/registrarEntrega";
import { DEFINICOES_DE_DOCUMENTO, MODELOS_DE_DOCUMENTO, type ModeloDeDocumento, rotuloDoMesDeReferencia } from "../../../supabase/functions/_shared/documento-modelos";

/**
 * Documento mensal automático (frente BRF2, 30/09/2026): no dia marcado, o
 * painel monta o rascunho do documento do mês anterior só com o que
 * aconteceu (sem IA e sem custo) e avisa a equipe. Gerar o PDF e mandar ao
 * cliente continuam com Confirmar. Uma agenda por cliente (e marca).
 */

const DIAS = [1, 2, 3, 5, 7, 10, 15];

export default function AgendaDeDocumentos({ clientId, marcaId = null }: { clientId: string; marcaId?: string | null }) {
  const qc = useQueryClient();
  const chave = ["documentos-agenda", clientId];
  const consulta = useQuery({ queryKey: chave, queryFn: () => lerAgendas(clientId), enabled: !!clientId, staleTime: 60_000 });
  const atual = (consulta.data || []).find((a) => (a.marca_id || null) === (marcaId || null)) || null;
  const [ligada, setLigada] = useState(false);
  const [dia, setDia] = useState(3);
  const [modelo, setModelo] = useState<ModeloDeDocumento>("mensal");
  const [salvando, setSalvando] = useState(false);
  useEffect(() => {
    if (atual) {
      setLigada(atual.ligada);
      setDia(atual.dia);
      setModelo(atual.modelo);
    }
  }, [atual?.id, atual?.ligada, atual?.dia, atual?.modelo]); // eslint-disable-line react-hooks/exhaustive-deps

  const mudou = !atual ? ligada : atual.ligada !== ligada || atual.dia !== dia || atual.modelo !== modelo;
  const salvar = async () => {
    setSalvando(true);
    try {
      await salvarAgenda({ clientId, marcaId, ligada, dia, modelo });
      toast.success(ligada ? `Agenda ligada: todo dia ${dia}, o rascunho do mês anterior fica pronto e a equipe é avisada.` : "Agenda desligada.");
      void qc.invalidateQueries({ queryKey: chave });
    } catch (e) {
      toast.error(textoDoErro(e, "Não foi possível salvar a agenda."));
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Secao
      titulo="Documento mensal automático"
      nivel={3}
      descricao={atual && atual.ligada ? `todo dia ${atual.dia}` : "desligado"}
      ajuda="No dia marcado, o painel monta o rascunho do documento do mês anterior só com o que aconteceu (sem IA e sem custo) e avisa a equipe. A equipe revisa, gera o PDF e manda ao cliente, sempre com Confirmar."
      recolher={`documentos:agenda:${clientId}`}
      recolhidaDeInicio
      divisoria
    >
      {consulta.isError ? (
        <p className={juntar(texto.auxiliar, "text-destructive")}>{textoDoErro(consulta.error, "A agenda não abriu.")}</p>
      ) : (
        <div className="min-w-0 space-y-3">
          <label className="flex min-w-0 items-center text-[13px] text-foreground">
            <input type="checkbox" className="mr-2 h-4 w-4 accent-primary" checked={ligada} onChange={(e) => setLigada(e.target.checked)} />
            Montar o rascunho todo mês
          </label>
          <GrupoDeCampos colunas={2}>
            <CampoDeFormulario rotulo="Dia do mês">
              <select className={estiloDoCampo} value={dia} onChange={(e) => setDia(Number(e.target.value))} disabled={!ligada} aria-label="Dia do mês">
                {DIAS.map((d) => <option key={d} value={d}>Dia {d}</option>)}
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Modelo">
              <select className={estiloDoCampo} value={modelo} onChange={(e) => setModelo(e.target.value as ModeloDeDocumento)} disabled={!ligada} aria-label="Modelo do documento mensal">
                {MODELOS_DE_DOCUMENTO.map((m) => <option key={m} value={m}>{DEFINICOES_DE_DOCUMENTO[m].nome}</option>)}
              </select>
            </CampoDeFormulario>
          </GrupoDeCampos>
          {atual && (atual.ultimo_mes || atual.ultimo_erro) && (
            <p className={juntar(texto.auxiliar, atual.ultimo_erro && "text-amber-700 dark:text-amber-300")}>
              {atual.ultimo_mes ? `Último mês preparado: ${rotuloDoMesDeReferencia(atual.ultimo_mes)}.` : ""} {atual.ultimo_erro || ""}
            </p>
          )}
          <div className="flex justify-end">
            <button type="button" onClick={() => void salvar()} disabled={!mudou || salvando} className={botao.secundario}>
              {salvando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <CalendarClock className="mr-1.5 h-4 w-4" aria-hidden="true" />}
              Salvar agenda
            </button>
          </div>
        </div>
      )}
    </Secao>
  );
}
