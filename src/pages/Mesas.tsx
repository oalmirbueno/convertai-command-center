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
 * Rodada ousada (15/11/2026): azulejos grandes, nome em letra grande, a Mesa
 * do cliente em cartão sólido na cor da marca e a Mesa Ads em cartão de tinta
 * (só esses dois mostram a linha de descrição).
 */
export default function Mesas() {
  const { profile } = useAuth();
  const clientes = useClients();
  const [params, setParams] = useSearchParams();
  const clientId = params.get("client") || "";
  const cliente = clientes.data?.find((c) => c.id === clientId);
  const nome = cliente ? nomeDoClienteBruto(cliente) : "Escolher cliente";
  const mesas = [...MESAS, ...(["admin", "manager"].includes(profile?.role || "") ? MESAS_FORA_DO_SELETOR : [])];
  return <main className="mx-auto w-full min-w-0 max-w-6xl space-y-6 p-4 sm:space-y-8 sm:p-6 lg:p-8">
    <PageHeader
      title="Mesas"
      help="Escolha o cliente e abra o espaço de produção dele. Cada mesa leva o cliente junto no endereço."
      actions={<SeletorDeClientesDaMesa mesa="foto" clientesBrutos={clientes.data} valor={clientId} nome={nome} carregando={clientes.isLoading} onEscolher={(id) => setParams({ client: id })} />}
    />
    {clientes.isError && <p role="alert" className={juntar(texto.corpo, "rounded-md bg-danger-soft px-4 py-3 text-destructive")}>Não foi possível carregar os clientes. <button className="font-medium underline underline-offset-2" onClick={() => void clientes.refetch()}>Tentar novamente</button></p>}
    {/* Rodada ousada (15/11/2026): azulejos grandes; a Mesa do cliente é o cartão sólido na cor da marca e a Mesa Ads o de tinta. */}
    <nav aria-label="Todas as mesas" className="grid min-w-0 grid-cols-2 gap-3 sm:gap-5 lg:grid-cols-3 xl:grid-cols-4">{mesas.map((mesa, i) => {
      const Icone = mesa.icone || LayoutGrid;
      const url = enderecoDaMesa(mesa.valor, clientId);
      const abrir = cliente ? `Abrir ${mesa.rotulo} para ${nome}` : `Abrir ${mesa.rotulo}`;
      const solido = i === 0;
      const tinta = i === 1;
      const destaque = solido || tinta;
      return <Link key={mesa.valor} to={url} {...propsDePreCarga(url)} aria-label={abrir} title={mesa.descricao ? `${mesa.descricao}. ${abrir}` : abrir} data-mesa-do-hub={mesa.valor} data-card={solido ? "accent" : tinta ? "ink" : "default"} className={juntar(superficie.painel, solido && superficie.destaque, tinta && superficie.tinta, "group flex min-h-[148px] min-w-0 flex-col justify-between p-5 transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0 sm:min-h-[184px] sm:p-6", solido && "col-span-2", foco)}>
        <span className="flex items-start justify-between">
          <span className={juntar("flex h-12 w-12 shrink-0 items-center justify-center rounded-full transition-colors", destaque ? "bg-foreground/10 text-foreground" : "bg-accent-soft text-primary group-hover:bg-accent-solid group-hover:text-on-accent")}><Icone className="h-5 w-5" aria-hidden="true" /></span>
          <span className={juntar("flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-colors", destaque ? "bg-foreground/15 text-foreground" : "bg-muted text-foreground group-hover:bg-foreground group-hover:text-background")}><ArrowUpRight className="h-4 w-4" aria-hidden="true" /></span>
        </span>
        <span className="mt-6 block min-w-0">
          <h2 className={juntar("min-w-0 truncate font-semibold tracking-[-0.03em] text-foreground", solido ? "text-[28px] leading-9 sm:text-[36px] sm:leading-[44px]" : "text-[20px] leading-7 sm:text-[24px] sm:leading-8")}>{mesa.rotulo}</h2>
          {destaque && mesa.descricao && <span className="mt-1 block min-w-0 text-[13px] leading-5 text-muted-foreground line-clamp-2">{mesa.descricao}</span>}
        </span>
      </Link>;
    })}</nav>
  </main>;
}
