import { Link, useSearchParams } from "react-router-dom";
import { ArrowUpRight, LayoutGrid } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { MESAS, MESAS_FORA_DO_SELETOR, enderecoDaMesa } from "@/components/mesa-foto/TrocaDeMesas";
import SeletorDeClientesDaMesa from "@/components/mesa/SeletorDeClientesDaMesa";
import { propsDePreCarga } from "@/lib/mesa/preCarga";

export default function Mesas() {
  const { profile } = useAuth();
  const clientes = useClients();
  const [params, setParams] = useSearchParams();
  const clientId = params.get("client") || "";
  const cliente = clientes.data?.find((c) => c.id === clientId);
  const mesas = [...MESAS, ...(["admin", "manager"].includes(profile?.role || "") ? MESAS_FORA_DO_SELETOR : [])];
  return <main className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <header className="flex flex-wrap items-center gap-4"><LayoutGrid className="h-6 w-6 text-primary" /><div className="flex-1"><h1 className="text-xl font-semibold">Mesas</h1><p className="text-sm text-muted-foreground">Escolha o cliente e abra seu espaço de produção.</p></div>
      <SeletorDeClientesDaMesa mesa="foto" clientesBrutos={clientes.data} valor={clientId} nome={cliente?.name || "Escolher cliente"} carregando={clientes.isLoading} onEscolher={(id) => setParams({ client: id })} />
    </header>
    {clientes.isError && <p role="alert">Não foi possível carregar os clientes. <button onClick={() => void clientes.refetch()}>Tentar novamente</button></p>}
    <nav aria-label="Todas as mesas" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{mesas.map((mesa) => {
      const Icone = mesa.icone || LayoutGrid;
      const url = enderecoDaMesa(mesa.valor, clientId);
      return <Link key={mesa.valor} to={url} {...propsDePreCarga(url)} className="group rounded-xl border bg-card p-5 transition-colors hover:border-primary focus-visible:ring-2 focus-visible:ring-primary"><div className="mb-4 flex items-center justify-between"><Icone className="h-6 w-6 text-primary" /><ArrowUpRight className="h-4 w-4 text-muted-foreground" /></div><h2 className="font-semibold">{mesa.rotulo}</h2><p className="mt-2 text-sm text-muted-foreground">{mesa.descricao}</p><p className="mt-4 text-xs text-primary">{cliente ? `Abrir para ${cliente.name}` : "Abrir mesa"}</p></Link>;
    })}</nav>
  </main>;
}
