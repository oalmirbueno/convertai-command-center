import { lazyComPreCarga } from "@/lib/lazyComPreCarga";
import MesaDeVideo from "@/components/mesa-videos/MesaDeVideo";
import { ETAPAS_DA_MESA_EDICAO, etapaValidaDaEdicao } from "@/components/mesa-edicao/Comuns";

/**
 * Mesa Edição (/mesa-edicao, só equipe: admin, gestor e design), frente E2
 * (26/09). Separada da Mesa Vídeos (que ficou só com a geração por IA).
 * Endereço: /mesa-edicao?client=<id>&etapa=organizar
 *
 * Etapas: Entrada (subir vídeos de fora arrastando; duração e resolução lidas
 * no navegador; os gerados que a Mesa Vídeos aprovou chegam sozinhos;
 * transcrição e legenda como pedido preparado), Organizar (o organizador
 * separa por roteiro, cena e tomada, sugere nomes e os melhores takes; a
 * equipe confirma e desfaz) e Editar (edição dinâmica pelo método Brabo:
 * área do editor com o projeto de edição, pacote para editar ou para o
 * Remotion, versões com comentário no tempo e aprovação). O agente de edição
 * fica fixo ao lado. Usa as tabelas e a função da Mesa Vídeos (mesa-videos).
 */

const carregarEntrada = () => import("@/components/mesa-edicao/EtapaEntrada");
const carregarOrganizar = () => import("@/components/mesa-edicao/EtapaOrganizar");
const carregarEditar = () => import("@/components/mesa-edicao/EtapaEditar");
// Mesmas chaves da pré-carga do painel (src/lib/mesa/preCarga.ts).
const EtapaEntrada = lazyComPreCarga("mesa-edicao/entrada", carregarEntrada);
const EtapaOrganizar = lazyComPreCarga("mesa-edicao/organizar", carregarOrganizar);
const EtapaEditar = lazyComPreCarga("mesa-edicao/editar", carregarEditar);
// Frente Q (26/09): na etapa Editar a lateral é o agente editor (modelo e custo em cima).
const AgenteDeEdicao = lazyComPreCarga("mesa-edicao/agente", () => import("@/components/mesa-edicao/AgenteDaEdicao"));

export { ETAPAS_DA_MESA_EDICAO };

export default function MesaEdicao() {
  return (
    <MesaDeVideo
      mesa="edicao"
      titulo="Mesa Edição"
      etapas={ETAPAS_DA_MESA_EDICAO}
      etapaValida={etapaValidaDaEdicao}
      prefixoOnde="mesa-edicao:onde:"
      vazio={{ titulo: "Escolha um cliente", descricao: "Suba os vídeos, organize por cena e tomada e prepare a edição. Nada gasta sem o seu clique." }}
      preCarregar={[EtapaEntrada, EtapaOrganizar, EtapaEditar, AgenteDeEdicao]}
      Agente={AgenteDeEdicao}
      rotuloDoAgente={(etapa) => (etapa === "editar" ? "Agente editor" : "Agente de edição")}
    >
      {(etapa, irPara) => (
        <>
          {etapa === "entrada" && <EtapaEntrada irPara={irPara} />}
          {etapa === "organizar" && <EtapaOrganizar irPara={irPara} />}
          {etapa === "editar" && <EtapaEditar irPara={irPara} />}
        </>
      )}
    </MesaDeVideo>
  );
}
