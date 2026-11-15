import { Link, useSearchParams } from "react-router-dom";
import { ArrowUpRight, LayoutGrid } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useClients } from "@/hooks/useSupabaseData";
import { MESAS, MESAS_FORA_DO_SELETOR, enderecoDaMesa } from "@/components/mesa-foto/TrocaDeMesas";
import SeletorDeClientesDaMesa from "@/components/mesa/SeletorDeClientesDaMesa";
import { propsDePreCarga } from "@/lib/mesa/preCarga";
import { nomeDoClienteBruto } from "@/components/mesa/clientesDaMesa";
import { PageHeader } from "@/components/ds";
import { foco, juntar, superficie, texto } from "@/components/sistema/estilos";

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
  return <main className="mx-auto w-full min-w-0 max-w-6xl space-y-5 p-4 sm:space-y-6 md:p-6">
    <PageHeader
      title="Mesas"
      help="Escolha o cliente e abra o espaço de produção dele. Cada mesa leva o cliente junto no endereço."
      actions={<SeletorDeClientesDaMesa mesa="foto" clientesBrutos={clientes.data} valor={clientId} nome={nome} carregando={clientes.isLoading} onEscolher={(id) => setParams({ client: id })} />}
    />
    {clientes.isError && <p role="alert" className={juntar(texto.corpo, "rounded-md bg-danger-soft px-3 py-2 text-destructive")}>Não foi possível carregar os clientes. <button className="font-medium underline underline-offset-2" onClick={() => void clientes.refetch()}>Tentar novamente</button></p>}
    <nav aria-label="Todas as mesas" className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 xl:grid-cols-4">{mesas.map((mesa) => {
      const Icone = mesa.icone || LayoutGrid;
      const url = enderecoDaMesa(mesa.valor, clientId);
      const abrir = cliente ? `Abrir ${mesa.rotulo} para ${nome}` : `Abrir ${mesa.rotulo}`;
      return <Link key={mesa.valor} to={url} {...propsDePreCarga(url)} aria-label={abrir} title={mesa.descricao ? `${mesa.descricao}. ${abrir}` : abrir} data-mesa-do-hub={mesa.valor} className={juntar(superficie.painel, "group flex min-h-[116px] min-w-0 flex-col justify-between p-4 transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-primary/50 sm:min-h-[132px] sm:p-5", foco)}>
        <span className="flex items-start justify-between">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-primary transition-colors group-hover:bg-primary group-hover:text-primary-foreground"><Icone className="h-5 w-5" aria-hidden="true" /></span>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors group-hover:bg-muted group-hover:text-foreground"><ArrowUpRight className="h-4 w-4" aria-hidden="true" /></span>
        </span>
        <h2 className={juntar(texto.tituloSecao, "mt-3 min-w-0 truncate")}>{mesa.rotulo}</h2>
      </Link>;
    })}</nav>
  </main>;
}
