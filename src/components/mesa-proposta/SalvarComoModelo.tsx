import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { LayoutTemplate } from "lucide-react";
import { toast } from "sonner";
import { useAvisarErro } from "@/components/mesa/Custo";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import { CHAVES, chamarProposta, type Proposta } from "./propostaApi";

/**
 * Salvar como modelo (frente UXS, 30/09): saiu da Revisão e mora no menu da
 * seção Envio, numa janela central. Guarda a estrutura, o processo, as
 * condições e os próximos passos (sem o texto do cliente) para as próximas
 * propostas; o modelo aparece em Nova proposta. Vale também para proposta
 * aceita (a que deu certo é o melhor modelo).
 */
export default function SalvarComoModelo({ proposta, aberta, onAberta }: { proposta: Proposta; aberta: boolean; onAberta: (v: boolean) => void }) {
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const [nome, setNome] = useState("");
  const [padrao, setPadrao] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const salvar = async () => {
    setSalvando(true);
    try {
      await chamarProposta("modelo_salvar", { proposta_id: proposta.id, nome: nome.trim(), padrao });
      void qc.invalidateQueries({ queryKey: CHAVES.modelos() });
      onAberta(false);
      toast.success("Modelo salvo. Ele aparece em Nova proposta.");
    } catch (e) {
      avisarErro(e, "O modelo não foi salvo");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <JanelaCentral
      aberta={aberta}
      onMudar={onAberta}
      largura="sm"
      icone={<LayoutTemplate className="h-4 w-4" />}
      titulo="Salvar como modelo"
      descricao={`Da proposta ${proposta.numero}`}
      ajuda="Guarda a estrutura, o processo, as condições e os próximos passos desta proposta (sem o texto do cliente) para as próximas. O modelo aparece em Nova proposta; o Padrão já vem escolhido."
      rodape={
        <div className="flex min-w-0 justify-end">
          <button type="button" className={juntar(botao.discreto, "mr-2")} onClick={() => onAberta(false)} disabled={salvando}>
            Cancelar
          </button>
          <button type="button" className={botao.primario} onClick={() => void salvar()} disabled={nome.trim().length < 3 || salvando}>
            {salvando ? "Salvando..." : "Salvar modelo"}
          </button>
        </div>
      }
      data-salvar-como-modelo=""
    >
      <div className="min-w-0 space-y-3">
        <CampoDeFormulario rotulo="Nome do modelo">
          <input value={nome} onChange={(e) => setNome(e.target.value)} maxLength={80} className={campo} placeholder="Ex.: Identidade visual" />
        </CampoDeFormulario>
        <label className={juntar(texto.corpo, "inline-flex items-center")}>
          <input type="checkbox" className="mr-2" checked={padrao} onChange={(e) => setPadrao(e.target.checked)} />
          Padrão
        </label>
      </div>
    </JanelaCentral>
  );
}
