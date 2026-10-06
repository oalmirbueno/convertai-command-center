import { Clapperboard, Images, Mic, ListVideo, MoreHorizontal } from "lucide-react";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { MODOS_DO_GERAR, modoDoGerarValido, type ModoDoGerar } from "./modosDoGerar";

const PRINCIPAIS = [
  { id: "livre", nome: "Criar vídeo", Icone: Clapperboard },
  { id: "antes_depois", nome: "Antes e depois", Icone: Images },
  { id: "labial", nome: "Foto que fala", Icone: Mic },
  { id: "cena", nome: "Cena do roteiro", Icone: ListVideo },
] as const;
export default function JeitosDeCriarVideo({ modo, onEscolher }: { modo: ModoDoGerar; onEscolher: (modo: ModoDoGerar) => void }) {
  return <div className="mb-4 flex flex-wrap items-center gap-2" role="group" aria-label="Jeito de criar vídeo">
    {PRINCIPAIS.map(({id, nome, Icone}) => <button type="button" key={id} aria-pressed={modo === id} onClick={() => onEscolher(id)} className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${modo === id ? "border-primary bg-primary/10 text-primary" : "bg-card text-muted-foreground hover:text-foreground"}`}><Icone className="h-4 w-4" />{nome}</button>)}
    <SeletorCompacto rotulo="Mais ferramentas" modo="lista" icone={<MoreHorizontal className="h-4 w-4" />} opcoes={MODOS_DO_GERAR.filter((m) => !PRINCIPAIS.some((p) => p.id === m.valor)).map((m) => ({ valor: m.valor, rotulo: m.rotulo, descricao: m.descricao }))} valor={modo} onEscolher={(v) => onEscolher(modoDoGerarValido(v))} />
  </div>;
}
