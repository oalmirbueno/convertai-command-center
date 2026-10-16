import Etapas from "@/components/sistema/Etapas";
import { etapasEmIcone } from "@/components/mesa-foto/IconesDasEtapas";

/**
 * Etapas da Mesa Vídeos. 16/10/2026 (dono: "em tudo que tem texto e ícone,
 * deixa só o ícone"): o "Criar vídeo", o "Resultados" e o seletor
 * "Planejamento" viraram uma linha só de etapas em ícone (Etapas soIcone),
 * igual às outras mesas. Criar e Resultados primeiro; o planejamento depois.
 */
const ETAPAS = [
  { valor: "gerar", rotulo: "Criar vídeo" },
  { valor: "resultados", rotulo: "Resultados" },
  { valor: "base", rotulo: "Materiais", dica: "Cenas, personagens e produtos" },
  { valor: "kit", rotulo: "Modelos prontos", dica: "Kits e templates" },
  { valor: "biblia", rotulo: "Identidade do vídeo", dica: "Cenário, luz e continuidade" },
  { valor: "roteiro", rotulo: "Roteiro", dica: "Planejar as cenas" },
];

export default function NavegacaoVideo({ etapa, onEscolher }: { etapa: string; onEscolher: (etapa: string) => void }) {
  return <Etapas rotulo="Etapas da Mesa Vídeos" soIcone itens={etapasEmIcone("videos", ETAPAS)} valor={etapa} onEscolher={onEscolher} />;
}
