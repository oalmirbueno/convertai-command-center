import { useMesa } from "@/components/mesa/MesaContexto";
import AgenteDaMesaDeVideo from "@/components/mesa-videos/AgenteDaMesaDeVideo";
import type { PropsDoAgenteDaMesa } from "@/components/mesa-videos/MesaDeVideo";
import { naEntradaDaEdicao, useArquivosDeVideo } from "@/components/mesa-videos/videosApi";
import AgenteEditor from "./editor/AgenteEditor";
import { usePonteDoAgente } from "./editor/ponteDoAgente";

/**
 * Lateral fixa da Mesa Edição (frente Q, 26/09). Entrada e Organizar: o agente
 * de edição (organiza os takes, abre partes, resume). Editar: o AGENTE EDITOR,
 * com o seletor de modelo e o custo em cima, mexendo no mesmo projeto que o
 * editor da região principal abriu (ponteDoAgente.ts). Antes a etapa Editar
 * mostrava o agente de organizar e o agente editor ficava escondido numa aba
 * do editor, que só abria depois do clique em "Editar".
 */

function AgenteDaEtapaEditar() {
  const { clientId } = useMesa();
  const ponte = usePonteDoAgente(clientId);
  const arquivosQ = useArquivosDeVideo(clientId);
  // Trocar de versão começa uma conversa nova (uma proposta de uma versão nunca cai na outra).
  if (ponte) return <AgenteEditor key={ponte.versaoId} projeto={ponte.projeto} controle={ponte.controle} onAplicarProjeto={ponte.aplicarProjeto} urls={ponte.urls} versaoId={ponte.versaoId} selecao={ponte.selecao} cursor={ponte.cursor} />;
  const semVideo = !!arquivosQ.data && !((arquivosQ.data.arquivos || []).filter(naEntradaDaEdicao).length);
  return (
    <AgenteEditor
      projeto={null}
      controle={null}
      onAplicarProjeto={null}
      urls={{}}
      semEditor={semVideo ? "Nenhum vídeo na Entrada. Suba um vídeo e marque os melhores takes em Organizar." : "Abrindo o editor. O agente edita o vídeo que estiver aberto nele."}
    />
  );
}

export default function AgenteDaEdicao(props: PropsDoAgenteDaMesa) {
  if (props.etapa === "editar") return <AgenteDaEtapaEditar />;
  return <AgenteDaMesaDeVideo {...props} />;
}
