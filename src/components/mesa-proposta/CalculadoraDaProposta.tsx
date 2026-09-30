import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Calculator } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import FaixaDeNumeros from "@/components/sistema/FaixaDeNumeros";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { botao, campo, juntar, lista, texto } from "@/components/sistema/estilos";
import { reais } from "../../../supabase/functions/_shared/proposta-modelo";
import { lerMargem, margemDosItens } from "../../../supabase/functions/_shared/proposta-comercial";
import { aplicarNaLista, chamarProposta, useHoraTecnica, type Proposta } from "./propostaApi";

/**
 * Calculadora de hora técnica na proposta (frente PRO2): custo e preço da
 * hora (custos do Financeiro, horas vendáveis, impostos e margem, da
 * Biblioteca), a margem real dos itens que têm horas e o ajuste dos preços
 * para uma margem pedida, com prévia antes e Desfazer depois.
 */

type Mudanca = { id: string; nome: string; antes: number; depois: number };

export default function CalculadoraDaProposta({ proposta, onParametros }: { proposta: Proposta; onParametros: () => void }) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const [ligada, setLigada] = useState(false);
  const comHoras = proposta.itens.some((i) => !!i.horas);
  const hora = useHoraTecnica(ligada || comHoras);
  const [margem, setMargem] = useState("");
  const [previa, setPrevia] = useState<{ margem: number; mudados: Mudanca[]; sem_horas: string[] } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const atual = hora.data ? margemDosItens(proposta.itens, hora.data.parametros) : null;
  const alvo = lerMargem(margem || (hora.data ? String(hora.data.parametros.margem_pct) : ""));

  const verPrevia = async () => {
    if (alvo === null) {
      toast.error("Diga a margem em % (de 0 a 80).");
      return;
    }
    setOcupado(true);
    try {
      const d = await chamarProposta<any>("margem_ajustar", { proposta_id: proposta.id, margem_pct: alvo, previa: true });
      setPrevia({ margem: alvo, mudados: Array.isArray(d && d.mudados) ? d.mudados : [], sem_horas: Array.isArray(d && d.sem_horas) ? d.sem_horas : [] });
    } catch (e) {
      avisarErro(e, "A conta não foi feita");
    } finally {
      setOcupado(false);
    }
  };

  const aplicar = async () => {
    if (!previa) return;
    setOcupado(true);
    const versaoAntes = proposta.versao;
    try {
      const d = await chamarProposta<any>("margem_ajustar", { proposta_id: proposta.id, margem_pct: previa.margem });
      aplicarNaLista(qc, mesa.clientId, d && d.proposta);
      setPrevia(null);
      toast.success(`Preços na margem de ${previa.margem}%.`, {
        duration: 10_000,
        action: {
          label: "Desfazer",
          onClick: () => {
            chamarProposta<any>("versao_restaurar", { proposta_id: proposta.id, versao: versaoAntes })
              .then((r) => aplicarNaLista(qc, mesa.clientId, r && r.proposta))
              .catch((e) => avisarErro(e, "Não foi possível desfazer"));
          },
        },
      });
    } catch (e) {
      avisarErro(e, "Os preços não mudaram");
    } finally {
      setOcupado(false);
    }
  };

  return (
    <Secao
      titulo="Hora técnica"
      divisoria
      recolhidaDeInicio={!comHoras}
      descricao={atual && atual.margem_pct !== null ? `Margem dos itens: ${atual.margem_pct}%` : comHoras ? undefined : "Itens sem horas"}
      ajuda="O custo da hora sai dos custos do Financeiro (ou dos digitados na Biblioteca), dividido pelas horas vendáveis do mês. O preço da hora soma impostos e margem. Ponha as horas de cada item no Investimento para ver a margem real e ajustar os preços para a margem que você quer."
      acao={
        <button type="button" className={botao.discreto} onClick={onParametros}>
          Parâmetros
        </button>
      }
    >
      {!hora.data && !hora.isLoading && !ligada ? (
        <button type="button" className={botao.secundario} onClick={() => setLigada(true)}>
          <Calculator className="mr-1.5 h-4 w-4" /> Abrir a calculadora
        </button>
      ) : hora.isLoading ? (
        <p className={texto.auxiliar}>Lendo a calculadora...</p>
      ) : hora.isError || !hora.data ? (
        <p className={juntar(texto.auxiliar, "text-warning")}>A calculadora não foi lida agora.</p>
      ) : (
        <div className="min-w-0 space-y-4">
          <FaixaDeNumeros
            colunas={3}
            semMoldura
            itens={[
              { rotulo: "Custo da hora", valor: reais(hora.data.custo_hora) },
              { rotulo: "Preço da hora", valor: reais(hora.data.preco_hora), apoio: `margem ${hora.data.parametros.margem_pct}%` },
              { rotulo: "Margem da proposta", valor: atual && atual.margem_pct !== null ? `${atual.margem_pct}%` : "sem horas", apoio: atual && atual.itens_sem_horas ? `${atual.itens_sem_horas} item(ns) sem horas` : undefined },
            ]}
          />
          {hora.data.aviso && <p className={juntar(texto.auxiliar, "text-warning")}>{hora.data.aviso}</p>}
          <div className="grid min-w-0 items-end gap-2 sm:grid-cols-[140px_auto]">
            <CampoDeFormulario rotulo="Margem desejada (%)">
              <input value={margem} onChange={(e) => setMargem(e.target.value.replace(/[^\d.,]/g, ""))} inputMode="decimal" className={campo} placeholder={String(hora.data.parametros.margem_pct)} />
            </CampoDeFormulario>
            <button type="button" className={botao.secundario} onClick={() => void verPrevia()} disabled={ocupado || !comHoras || proposta.status === "aceita"}>
              Ver os preços nessa margem
            </button>
          </div>
          {previa && (
            <div className="min-w-0" aria-label="Prévia dos preços">
              {previa.mudados.length ? (
                <ul className={juntar(lista.aberta, lista.divisoria)}>
                  {previa.mudados.map((m) => (
                    <li key={m.id} className={lista.linha}>
                      <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>{m.nome}</span>
                      <span className={juntar(texto.auxiliar, "ml-3 shrink-0 tabular-nums")}>
                        {reais(m.antes)} → {reais(m.depois)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className={texto.auxiliar}>Nenhum preço muda nessa margem.</p>
              )}
              {previa.sem_horas.length > 0 && <p className={juntar(texto.auxiliar, "mt-2")}>Sem horas (fica o preço de hoje): {previa.sem_horas.join(", ")}</p>}
              <div className="mt-3 flex justify-end">
                <button type="button" className={juntar(botao.discreto, "mr-2")} onClick={() => setPrevia(null)}>
                  Descartar
                </button>
                <button type="button" className={botao.primario} onClick={() => void aplicar()} disabled={ocupado || !previa.mudados.length}>
                  Aplicar os preços
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </Secao>
  );
}
