import { Suspense, lazy, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, LayoutGrid, Mail, Shield } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { definirEscopoDoCrm } from "@/lib/comercial/escopo";
import { linkDoCorreio } from "@/lib/produto/rotas-do-correio";
import { Carregando, foco, juntar } from "@/components/sistema";
import LogoDoCrm from "@/components/produto/LogoDoCrm";
import { BotaoDoTema, CHAVE_DO_TEMA_DO_CRM, useTemaDoCorreio } from "@/components/correio/TemaDoCorreio";
import "@/components/correio/correio-tema.css";

const AdminComercial = lazy(() => import("@/pages/AdminComercial"));

/**
 * O CRM da Aceleriq na casca nova (19/11/2026, pedido do dono: "o que vai ser usado é o completo novo; no painel
 * só acompanho"). Mesmos dados do Comercial do painel (as tabelas commercial_*), então os dois ficam sempre iguais:
 * o Rafael, o Pix, as propostas e os agentes continuam funcionando sem mudar nada. O que muda é a casa: o visual
 * claro e colorido do Correio, tema escuro no botão, e as abas em /vendas.
 */
export default function CrmDaCasa() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const tema = useTemaDoCorreio(CHAVE_DO_TEMA_DO_CRM);
  const [aberto, setAberto] = useState(false);
  // Antes do primeiro desenho: escopo da casa com as abas em /vendas; se veio do CRM de um cliente, o que
  // ficou guardado de lá sai.
  useState(() => {
    qc.removeQueries({ predicate: (q) => typeof q.queryKey[0] === "string" && String(q.queryKey[0]).indexOf("comercial") === 0 });
    return null;
  });
  definirEscopoDoCrm({ modo: "casa", base: "/vendas" });
  useEffect(() => () => definirEscopoDoCrm(null), []);
  useEffect(() => {
    const antes = document.title;
    document.title = "CRM | Aceleriq";
    return () => {
      document.title = antes;
    };
  }, []);

  const destinos = [
    { id: "correio", rotulo: "Correio", ajuda: "A caixa de e-mail", icone: Mail, ir: () => navigate(linkDoCorreio("painel")) },
    { id: "painel", rotulo: "Painel", ajuda: "Clientes, ciclo e financeiro", icone: LayoutGrid, ir: () => navigate("/dashboard") },
    { id: "produto", rotulo: "CRMs dos clientes", ajuda: "Administrar o produto", icone: Shield, ir: () => navigate("/produto") },
  ];

  return (
    <div className="correio-tema min-h-[100dvh] min-w-0 text-foreground" data-crm-da-casa="" data-tema={tema.tema}>
      <div className="mx-auto min-w-0 max-w-[1680px] p-3 sm:p-4">
        <header className="mb-4 flex min-w-0 items-center rounded-3xl bg-card p-2 [&>*]:mr-2 [&>*:last-child]:mr-0" data-topo-do-crm="">
          <Link to="/dashboard" className={juntar("flex h-11 shrink-0 items-center rounded-2xl bg-muted px-3 text-[14px] font-semibold hover:bg-[hsl(var(--correio-menta))]", foco)} title="Voltar ao painel" data-voltar-do-crm="">
            <ArrowLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Painel
          </Link>
          <span className="flex h-11 min-w-0 flex-1 items-center pl-1"><LogoDoCrm tamanho={34} rotulo="CRM de vendas" /></span>
          <Popover open={aberto} onOpenChange={setAberto}>
            <PopoverTrigger asChild>
              <button type="button" className={juntar("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl hover:bg-muted", foco)} aria-label="Ir para outro lugar" title="Ir para" data-ir-para="">
                <LayoutGrid className="h-[18px] w-[18px]" aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-[280px] rounded-3xl p-2">
              <p className="px-3 pb-1.5 pt-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Ir para</p>
              <ul>
                {destinos.map((d) => {
                  const Icone = d.icone;
                  return (
                    <li key={d.id}>
                      <button type="button" onClick={() => { setAberto(false); d.ir(); }} className={juntar("flex w-full min-w-0 items-center rounded-2xl p-2.5 text-left hover:bg-muted", foco)} data-destino={d.id}>
                        <span className="mr-3 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-muted" aria-hidden="true"><Icone className="h-4 w-4" /></span>
                        <span className="min-w-0">
                          <span className="block text-[14px] font-medium">{d.rotulo}</span>
                          <span className="block truncate text-[12px] text-muted-foreground">{d.ajuda}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </PopoverContent>
          </Popover>
          <BotaoDoTema tema={tema.tema} aoAlternar={tema.alternar} />
        </header>
        <main className="min-w-0" data-crm-corpo="">
          <Suspense fallback={<div className="rounded-3xl bg-card p-5"><Carregando forma="aba" rotulo="Abrindo o CRM" /></div>}>
            <AdminComercial />
          </Suspense>
        </main>
      </div>
    </div>
  );
}
