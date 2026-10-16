import { Clapperboard, Images, Mic, ListVideo, MoreHorizontal } from "lucide-react";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { botao, juntar } from "@/components/sistema/estilos";
import { MODOS_DO_GERAR, modoDoGerarValido, type ModoDoGerar } from "./modosDoGerar";

const PRINCIPAIS = [
  { id: "livre", nome: "Criar vídeo", Icone: Clapperboard },
  { id: "antes_depois", nome: "Antes e depois", Icone: Images },
  { id: "labial", nome: "Foto que fala", Icone: Mic },
  { id: "cena", nome: "Cena do roteiro", Icone: ListVideo },
] as const;
export default function JeitosDeCriarVideo({ modo, onEscolher }: { modo: ModoDoGerar; onEscolher: (modo: ModoDoGerar) => void }) {
  // 16/10/2026: abas só em ícone, sem borda (o nome vai no aria-label e no title).
  return <div className="mb-4 flex min-w-0 flex-wrap items-center gap-1" role="group" aria-label="Jeito de criar vídeo">
    {PRINCIPAIS.map(({id, nome, Icone}) => <button type="button" key={id} aria-pressed={modo === id} aria-label={nome} title={nome} onClick={() => onEscolher(id)} className={juntar(botao.icone, "h-9 w-9", modo === id && "bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary")}><Icone className="h-4 w-4" /></button>)}
    <SeletorCompacto rotulo="Mais ferramentas" modo="lista" icone={<MoreHorizontal className="h-4 w-4" />} opcoes={MODOS_DO_GERAR.filter((m) => !PRINCIPAIS.some((p) => p.id === m.valor)).map((m) => ({ valor: m.valor, rotulo: m.rotulo, descricao: m.descricao }))} valor={modo} onEscolher={(v) => onEscolher(modoDoGerarValido(v))} />
  </div>;
}
