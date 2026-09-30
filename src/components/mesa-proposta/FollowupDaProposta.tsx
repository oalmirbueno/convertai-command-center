import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { BellRing, Copy, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { botao, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import { hojeEmSaoPaulo } from "../../../supabase/functions/_shared/proposta-modelo";
import { followupDaProposta } from "../../../supabase/functions/_shared/proposta-comercial";
import { CHAVES, chamarProposta, relerTudo, type Proposta } from "./propostaApi";

/**
 * Follow-up da proposta (frente PRO2): quando a proposta foi vista e não
 * teve resposta, não foi aberta ou vence logo, aparece aqui o lembrete com a
 * mensagem pronta (nome do contato e link). Quem manda é a pessoa: o painel
 * abre o WhatsApp ou copia, e "Já mandei" registra o follow-up (o lembrete
 * volta em 3 dias se ainda não houver resposta).
 */
export default function FollowupDaProposta({ proposta }: { proposta: Proposta }) {
  const mesa = useMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const f = followupDaProposta(proposta, hojeEmSaoPaulo());
  const [pronto, setPronto] = useState<{ mensagem: string; numero: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  if (!f) return null;

  const preparar = async () => {
    setOcupado(true);
    try {
      const d = await chamarProposta<any>("followup", { proposta_id: proposta.id });
      if (d && typeof d.mensagem === "string") setPronto({ mensagem: d.mensagem, numero: String(d.numero || "") });
      else toast.info("Sem follow-up pendente agora.");
    } catch (e) {
      avisarErro(e, "A mensagem não foi preparada");
    } finally {
      setOcupado(false);
    }
  };

  const registrar = async (canal: string) => {
    setOcupado(true);
    try {
      await chamarProposta("followup_registrar", { proposta_id: proposta.id, canal });
      relerTudo(qc, mesa.clientId, proposta.id);
      void qc.invalidateQueries({ queryKey: CHAVES.propostas(mesa.clientId) });
      setPronto(null);
      toast.success("Follow-up registrado. O lembrete volta em 3 dias se não houver resposta.");
    } catch (e) {
      avisarErro(e, "O follow-up não foi registrado");
    } finally {
      setOcupado(false);
    }
  };

  const copiar = async (t: string) => {
    try {
      await navigator.clipboard.writeText(t);
      toast.success("Mensagem copiada.");
    } catch {
      toast.error("Não deu para copiar. Selecione e copie à mão.");
    }
  };

  return (
    <Secao
      titulo="Follow-up"
      divisoria
      recolher={false}
      descricao={<span className="text-warning">{f.texto}</span>}
      ajuda="Lembrete de quem viu e não respondeu, de quem ainda não abriu e de proposta que vence em até 2 dias. A mensagem sai pronta; o painel não manda nada sozinho."
      acao={
        !pronto ? (
          <button type="button" className={botao.primario} onClick={() => void preparar()} disabled={ocupado}>
            <BellRing className="mr-1.5 h-4 w-4" /> Preparar mensagem
          </button>
        ) : null
      }
    >
      {pronto ? (
        <div className="min-w-0 space-y-3" data-followup-pronto="">
          <CampoDeFormulario rotulo="Mensagem do follow-up">
            <textarea value={pronto.mensagem} onChange={(e) => setPronto({ ...pronto, mensagem: e.target.value })} className={juntar(campoTexto, "min-h-[100px]")} />
          </CampoDeFormulario>
          <div className="flex min-w-0 flex-wrap [&>*]:mb-2 [&>*]:mr-2">
            <a className={botao.secundario} href={`https://wa.me/${pronto.numero}?text=${encodeURIComponent(pronto.mensagem)}`} target="_blank" rel="noopener noreferrer">
              <MessageCircle className="mr-1.5 h-4 w-4" /> Abrir no WhatsApp
            </a>
            <button type="button" className={botao.secundario} onClick={() => void copiar(pronto.mensagem)}>
              <Copy className="mr-1.5 h-4 w-4" /> Copiar
            </button>
            <button type="button" className={botao.primario} onClick={() => void registrar("whatsapp")} disabled={ocupado}>
              Já mandei
            </button>
          </div>
        </div>
      ) : (
        <p className={texto.auxiliar}>{f.situacao === "nao_abriu" ? "Confirme se o link chegou." : f.situacao === "vence_logo" ? "Lembre a validade." : "Pergunte se ficou alguma dúvida."}</p>
      )}
    </Secao>
  );
}
