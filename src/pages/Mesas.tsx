import { Link, useSearchParams } from "react-router-dom";
import { ArrowUpRight, LayoutGrid } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { MESAS, MESAS_FORA_DO_SELETOR, enderecoDaMesa } from "@/components/mesa-foto/TrocaDeMesas";
import SeletorDeClientesDaMesa from "@/components/mesa/SeletorDeClientesDaMesa";
import { propsDePreCarga } from "@/lib/mesa/preCarga";
import { nomeDoClienteBruto } from "@/components/mesa/clientesDaMesa";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { foco, juntar } from "@/components/sistema/estilos";

/**
 * Hub das mesas (/mesas). 16/10/2026 (dono: "em tudo que tem texto e ícone,
 * deixa só o ícone"): o subtítulo foi para o "?", o "Abrir para <cliente>"
 * de cada cartão virou só a seta (o nome vai no aria-label) e a descrição da
 * mesa mora no title do cartão. O cartão fica com o ícone e o nome da mesa.
 */
export default function Mesas() {
  const { profile } = useAuth();
  const clientes = useClients();
  const [params, setParams] = useSearchParams();
  const clientId = params.get("client") || "";
  const cliente = clientes.data?.find((c) => c.id === clientId);
  const nome = cliente ? nomeDoClienteBruto(cliente) : "Escolher cliente";
  const mesas = [...MESAS, ...(["admin", "manager"].includes(profile?.role || "") ? MESAS_FORA_DO_SELETOR : [])];
  return <main className="mx-auto w-full max-w-6xl space-y-6 p-4 md:p-6">
    <header className="flex flex-wrap items-center gap-2">
      <LayoutGrid className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
      <h1 className="text-[20px] leading-7 font-semibold">Mesas</h1>
      <AjudaRecolhida rotulo="O que são as mesas?">Escolha o cliente e abra o espaço de produção dele. Cada mesa leva o cliente junto no endereço.</AjudaRecolhida>
      <div className="ml-auto min-w-0 max-w-full">
        <SeletorDeClientesDaMesa mesa="foto" clientesBrutos={clientes.data} valor={clientId} nome={nome} carregando={clientes.isLoading} onEscolher={(id) => setParams({ client: id })} />
      </div>
    </header>
    {clientes.isError && <p role="alert">Não foi possível carregar os clientes. <button onClick={() => void clientes.refetch()}>Tentar novamente</button></p>}
    <nav aria-label="Todas as mesas" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{mesas.map((mesa) => {
      const Icone = mesa.icone || LayoutGrid;
      const url = enderecoDaMesa(mesa.valor, clientId);
      const abrir = cliente ? `Abrir ${mesa.rotulo} para ${nome}` : `Abrir ${mesa.rotulo}`;
      return <Link key={mesa.valor} to={url} {...propsDePreCarga(url)} aria-label={abrir} title={mesa.descricao ? `${mesa.descricao}. ${abrir}` : abrir} data-mesa-do-hub={mesa.valor} className={juntar("group flex min-w-0 items-center rounded-xl border bg-card p-4 transition-colors hover:border-primary", foco)}>
        <Icone className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
        <h2 className="ml-3 min-w-0 flex-1 truncate font-semibold">{mesa.rotulo}</h2>
        <ArrowUpRight className="ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden="true" />
      </Link>;
    })}</nav>
  </main>;
}
