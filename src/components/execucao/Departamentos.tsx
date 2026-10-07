import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FolderPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { JanelaCentral, botao, campo } from "@/components/sistema";

export default function Departamentos({ agentes }: { agentes: { slug: string; display_name: string; area?: string | null }[] }) {
  const [aberto, setAberto] = useState(false);
  const [agente, setAgente] = useState("");
  const [nome, setNome] = useState("");
  const qc = useQueryClient();
  const salvar = useMutation({
    mutationFn: async () => {
      if (!agente || !nome.trim()) throw new Error("Escolha o agente e informe o departamento.");
      const { error } = await (supabase as any).rpc("operator_update", { _slug: agente, _actor: "painel", _area: nome.trim() });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["operadores-internos"] }); setAberto(false); toast.success("Departamento atualizado para o painel e o Hermes."); },
    onError: e => toast.error(e.message),
  });
  return <>
    <button type="button" className={botao.secundario} onClick={() => setAberto(true)}><FolderPlus className="mr-1.5 h-3.5 w-3.5" />Departamentos</button>
    <JanelaCentral aberta={aberto} onMudar={setAberto} titulo="Organizar departamentos" largura="md">
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); salvar.mutate(); }}>
        <label className="block space-y-1 text-[13px]">Agente<select required value={agente} onChange={e => { setAgente(e.target.value); setNome(agentes.find(a => a.slug === e.target.value)?.area || ""); }} className={campo}><option value="">Escolher agente</option>{agentes.map(a => <option key={a.slug} value={a.slug}>{a.display_name}</option>)}</select></label>
        <label className="block space-y-1 text-[13px]">Departamento<input required maxLength={60} list="departamentos-existentes" className={campo} value={nome} onChange={e => setNome(e.target.value)} placeholder="Escolha um existente ou crie um nome" /></label>
        <datalist id="departamentos-existentes">{[...new Set(agentes.map(a => a.area).filter(Boolean))].map(a => <option key={a} value={a!} />)}</datalist>
        <button type="submit" disabled={salvar.isPending} className={botao.primario}>{salvar.isPending ? "Salvando…" : "Salvar departamento"}</button>
      </form>
    </JanelaCentral>
  </>;
}
