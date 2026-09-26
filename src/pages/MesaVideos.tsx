import { useNavigate } from "react-router-dom";
import { lazyComPreCarga } from "@/lib/lazyComPreCarga";
import MesaDeVideo from "@/components/mesa-videos/MesaDeVideo";
import { ETAPAS_DA_MESA_VIDEOS, etapaAntigaDaEdicao, etapaValida } from "@/components/mesa-videos/Comuns";

/**
 * Mesa Vídeos (/mesa-videos, só equipe: admin, gestor e design): GERAÇÃO de
 * cenas e vídeos com modelos de IA (frente V2, 25/09; separada da Mesa Edição
 * na frente E2, 26/09). Endereço: /mesa-videos?client=<id>&etapa=gerar
 *
 * Frente V-A (26/09): entre a Base e o Gerar, Kit (kits por nicho e templates),
 * Bíblia e Roteiro do agente diretor; Gerar ganhou modo livre, ângulo,
 * continuar/transição e antes e depois; o agente ganhou o modo Diretor.
 *
 * Etapas: Base (cenas da História do Canvas, roteiros aprovados, personagens,
 * clones autorizados e produtos), Gerar (cena, modelo de vídeo, duração,
 * câmera e formato, com o custo antes; o pedido fica preparado sem gastar
 * enquanto nenhum motor de vídeo estiver ligado) e Resultados (vídeos gerados:
 * aprovar manda para a Entrada da Mesa Edição). O agente de vídeo fica fixo ao
 * lado. Subir vídeos de fora, organizar e editar moram na Mesa Edição
 * (/mesa-edicao); endereço antigo de edição ou versões vai para lá.
 */

const carregarBase = () => import("@/components/mesa-videos/EtapaBase");
const carregarGerar = () => import("@/components/mesa-videos/EtapaGerar");
const carregarResultados = () => import("@/components/mesa-videos/EtapaResultados");
// Mesmas chaves da pré-carga do painel (src/lib/mesa/preCarga.ts).
const EtapaBase = lazyComPreCarga("mesa-videos/base", carregarBase);
const EtapaGerar = lazyComPreCarga("mesa-videos/gerar", carregarGerar);
const EtapaResultados = lazyComPreCarga("mesa-videos/resultados", carregarResultados);
// Frente V-A (26/09): kit ou template, bíblia e roteiro do diretor.
const EtapaKit = lazyComPreCarga("mesa-videos/kit", () => import("@/components/mesa-videos/EtapaKit"));
const EtapaBiblia = lazyComPreCarga("mesa-videos/biblia", () => import("@/components/mesa-videos/EtapaBiblia"));
const EtapaRoteiro = lazyComPreCarga("mesa-videos/roteiro", () => import("@/components/mesa-videos/EtapaRoteiro"));
const AgenteDaMesaDeVideo = lazyComPreCarga("mesa-videos/agente", () => import("@/components/mesa-videos/AgenteDaMesaDeVideo"));

export { ETAPAS_DA_MESA_VIDEOS };

export default function MesaVideos() {
  const navigate = useNavigate();
  return (
    <MesaDeVideo
      mesa="videos"
      titulo="Mesa Vídeos"
      etapas={ETAPAS_DA_MESA_VIDEOS}
      etapaValida={etapaValida}
      prefixoOnde="mesa-videos:onde:"
      vazio={{ titulo: "Escolha um cliente", descricao: "Gere cenas e vídeos com IA a partir da História, dos roteiros e das fotos do cliente. Nada gasta sem o seu clique." }}
      preCarregar={[EtapaBase, EtapaKit, EtapaBiblia, EtapaRoteiro, EtapaGerar, EtapaResultados, AgenteDaMesaDeVideo]}
      Agente={AgenteDaMesaDeVideo}
      rotuloDoAgente="Agente de vídeo"
      antesDaEtapa={(etapaUrl, clientId) => {
        const naEdicao = etapaAntigaDaEdicao(etapaUrl);
        if (!naEdicao) return false;
        navigate(`/mesa-edicao?client=${clientId}&etapa=${naEdicao}`, { replace: true });
        return true;
      }}
    >
      {(etapa, irPara) => (
        <>
          {etapa === "base" && <EtapaBase irPara={irPara} />}
          {etapa === "kit" && <EtapaKit irPara={irPara} />}
          {etapa === "biblia" && <EtapaBiblia irPara={irPara} />}
          {etapa === "roteiro" && <EtapaRoteiro irPara={irPara} />}
          {etapa === "gerar" && <EtapaGerar irPara={irPara} />}
          {etapa === "resultados" && <EtapaResultados irPara={irPara} />}
        </>
      )}
    </MesaDeVideo>
  );
}
