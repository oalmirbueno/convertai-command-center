import { Clapperboard, Film, FolderOpen } from "lucide-react";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";

const PLANEJAMENTO = [
  { valor: "base", rotulo: "Materiais", descricao: "Cenas, personagens e produtos" },
  { valor: "kit", rotulo: "Modelos prontos", descricao: "Kits e templates" },
  { valor: "biblia", rotulo: "Identidade do vídeo", descricao: "Cenário, luz e continuidade" },
  { valor: "roteiro", rotulo: "Roteiro", descricao: "Planejar as cenas" },
];

export default function NavegacaoVideo({ etapa, onEscolher }: { etapa: string; onEscolher: (etapa: string) => void }) {
  return <nav aria-label="Etapas da Mesa Vídeos" className="flex min-w-0 flex-wrap items-center gap-1">
    {([{ id: "gerar", nome: "Criar vídeo", Icone: Clapperboard }, { id: "resultados", nome: "Resultados", Icone: Film }]).map(({ id, nome, Icone }) => <button type="button" key={id} aria-current={etapa === id ? "page" : undefined} onClick={() => onEscolher(id)} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-sm transition-colors ${etapa === id ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}><Icone className="h-4 w-4" />{nome}</button>)}
    <SeletorCompacto rotulo="Planejamento" icone={<FolderOpen className="h-4 w-4" />} valor={PLANEJAMENTO.some((p) => p.valor === etapa) ? etapa : ""} opcoes={PLANEJAMENTO} modo="lista" onEscolher={onEscolher} />
  </nav>;
}
