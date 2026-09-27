import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { chaveDoFormatoDoPerfil, salvarFormatoDoPerfil, useFormatoDoPerfil } from "./agendaApi";
import { DICA_DO_PERFIL, FORMATOS_DO_PERFIL, ROTULO_DO_PERFIL, type FormatoDoPerfil } from "../../../supabase/functions/_shared/post-de-fotos";

/**
 * Formato do perfil do cliente (pedido do dono, 27/09: "quando qualquer
 * cliente quiser só fotos no perfil a gente faz só fotos por ali, ou alternar
 * a gente usa as duas mesas"): só fotos, só artes ou alternar. O agente do
 * Mês lê ao gravar o plano e marca cada item com a mesa certa (Mesa Foto ou
 * Estúdio de design). Aparece no Post na Agenda da Mesa Foto e no Mês da
 * Mesa. Só admin ou gestor muda (mesa_config_formato_do_perfil, SQL MF-01).
 */
export default function SeletorDoPerfil({ className = "" }: { className?: string } = {}) {
  const { clientId, podeRecarregar } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const perfil = useFormatoDoPerfil(clientId);
  const [salvando, setSalvando] = useState(false);
  const disponivel = !!(perfil.data && perfil.data.disponivel);
  const valor = perfil.data ? perfil.data.formato : "artes";
  const escolher = async (v: string) => {
    if (!podeRecarregar || !disponivel || v === valor) return;
    setSalvando(true);
    try {
      await salvarFormatoDoPerfil(clientId, v as FormatoDoPerfil);
      queryClient.setQueryData(chaveDoFormatoDoPerfil(clientId), { formato: v, disponivel: true });
      toast.success(`Perfil do cliente: ${ROTULO_DO_PERFIL[v as FormatoDoPerfil]}`, { description: `${DICA_DO_PERFIL[v as FormatoDoPerfil]} Vale no próximo plano do mês.` });
    } catch (e) {
      avisarErro(e, "Formato do perfil não salvo");
    } finally {
      setSalvando(false);
    }
  };
  return (
    <div className={`flex min-w-0 flex-wrap items-center ${className}`} data-formato-do-perfil={valor}>
      <span className="mb-1 mr-2 text-[12px] text-muted-foreground">Perfil do cliente:</span>
      <SeletorCompacto
        modo="lista"
        rotulo="Formato do perfil"
        opcoes={FORMATOS_DO_PERFIL.map((f) => ({ valor: f, rotulo: ROTULO_DO_PERFIL[f], descricao: DICA_DO_PERFIL[f], desativada: !podeRecarregar || !disponivel }))}
        valor={valor}
        onEscolher={(v) => void escolher(v)}
        className="mb-1"
      />
      {salvando && <Loader2 className="mb-1 ml-2 h-3.5 w-3.5 animate-spin text-muted-foreground" />}
      <AjudaRecolhida className="mb-1 ml-1" rotulo="Sobre o formato do perfil">
        {disponivel
          ? "Só fotos: o plano do mês manda todo post para a Mesa Foto. Só artes: tudo no Estúdio de design. Alternar: cada post vai para a mesa que combina com ele, metade e metade. Só admin ou gestor muda."
          : "Falta aplicar o SQL MF-01 (formato do perfil). Até lá o plano segue como sempre: só artes."}
      </AjudaRecolhida>
    </div>
  );
}

