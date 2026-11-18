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
  return <main className="mx-auto w-full min-w-0 max-w-6xl space-y-5 p-4 sm:space-y-6 sm:p-6 lg:p-8">
    <PageHeader
      eyebrow="Produção"
      title="Mesas"
      help="Escolha o cliente e abra o espaço de produção dele. Cada mesa leva o cliente junto no endereço."
      actions={<SeletorDeClientesDaMesa mesa="foto" clientesBrutos={clientes.data} valor={clientId} nome={nome} carregando={clientes.isLoading} onEscolher={(id) => setParams({ client: id })} />}
    />
    {clientes.isError && <p role="alert" className={juntar(texto.corpo, "rounded-md bg-danger-soft px-4 py-3 text-destructive")}>Não foi possível carregar os clientes. <button className="font-medium underline underline-offset-2" onClick={() => void clientes.refetch()}>Tentar novamente</button></p>}
    {/* v4 (15/11/2026, referências): em cima, os dois cartões de destaque (Mesa na cor da marca, Mesa Ads em tinta)
        com a descrição e a seta em círculo; embaixo, azulejos com o ícone num círculo grande no centro e o nome. */}
    <nav aria-label="Todas as mesas" className="gap-bento grid min-w-0 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">{mesas.map((mesa, i) => {
      const Icone = mesa.icone || LayoutGrid;
      const url = enderecoDaMesa(mesa.valor, clientId);
      const abrir = cliente ? `Abrir ${mesa.rotulo} para ${nome}` : `Abrir ${mesa.rotulo}`;
      const solido = i === 0;
      const tinta = i === 1;
      const comuns = { to: url, ...propsDePreCarga(url), "aria-label": abrir, title: mesa.descricao ? `${mesa.descricao}. ${abrir}` : abrir, "data-mesa-do-hub": mesa.valor };
      if (solido || tinta) return <Link key={mesa.valor} {...comuns} data-card={solido ? "accent" : "ink"} className={juntar(superficie.painel, solido ? superficie.destaque : superficie.tinta, "group relative col-span-2 flex min-h-[168px] min-w-0 flex-col justify-between overflow-hidden p-5 transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0 sm:min-h-[208px] sm:p-6", solido ? "sm:col-span-2 lg:col-span-3" : "sm:col-span-1 lg:col-span-2", foco)}>
        {/* Círculos de fundo, só enfeite: o cartão de destaque das referências nunca é chapado. */}
        <span aria-hidden="true" className="pointer-events-none absolute -right-10 -top-14 h-48 w-48 rounded-full bg-foreground/[0.06]" />
        <span aria-hidden="true" className="pointer-events-none absolute -bottom-20 right-16 h-40 w-40 rounded-full bg-foreground/[0.05]" />
        <span className="relative flex items-start justify-between">
          <span className={juntar("flex h-14 w-14 shrink-0 items-center justify-center rounded-full", solido ? "bg-black/90 text-white" : "bg-accent-solid text-on-accent")}><Icone className="h-6 w-6" aria-hidden="true" /></span>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-foreground/15 text-foreground transition-colors group-hover:bg-foreground group-hover:text-background"><ArrowUpRight className="h-4 w-4" aria-hidden="true" /></span>
        </span>
        <span className="relative mt-6 block min-w-0">
          <h2 className="min-w-0 truncate text-[28px] font-medium leading-9 tracking-[-0.03em] text-foreground sm:text-[36px] sm:leading-[44px]">{mesa.rotulo}</h2>
          {mesa.descricao && <span className="mt-1 block min-w-0 text-[13px] leading-5 text-muted-foreground line-clamp-2">{mesa.descricao}</span>}
        </span>
      </Link>;
      return <Link key={mesa.valor} {...comuns} data-card="default" className={juntar(superficie.painel, "group flex min-h-[148px] min-w-0 flex-col items-center justify-center px-3 py-5 text-center transition-transform duration-200 hover:-translate-y-0.5 active:translate-y-0 sm:min-h-[176px]", foco)}>
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-muted text-foreground transition-colors group-hover:bg-foreground group-hover:text-background sm:h-[76px] sm:w-[76px]"><Icone className="h-6 w-6 sm:h-7 sm:w-7" aria-hidden="true" /></span>
        <h2 className="mt-4 w-full min-w-0 truncate text-[14px] font-medium leading-5 tracking-[-0.01em] text-foreground sm:text-[15px]">{mesa.rotulo}</h2>
      </Link>;
    })}</nav>
  </main>;
}
