import { lazy, Suspense, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Activity, Building2, ExternalLink, Inbox, Mail, Tags, Wallet } from "lucide-react";
import { CabecalhoDePagina, Carregando, Etapas, botao, juntar } from "@/components/sistema";
import ContasDaCasa from "@/components/produto/casa/ContasDaCasa";

const MonitorDoProduto = lazy(() => import("@/components/produto/casa/MonitorDoProduto"));
const EmailDaCasa = lazy(() => import("@/components/produto/casa/EmailDaCasa"));
const PrecosDoProduto = lazy(() => import("@/components/produto/casa/PrecosDoProduto"));
const FaturamentoDoProduto = lazy(() => import("@/components/produto/casa/FaturamentoDoProduto"));
const CaixaDaAceleriq = lazy(() => import("@/components/produto/casa/CaixaDaAceleriq"));

/**
 * A administração do produto CRM e E-mail, dentro do painel da casa (só admin).
 * O monitor (se está tudo em ordem e o CRM de cada empresa ao vivo), empresas e cobrança, a migração de e-mail de cada uma, os preços e o
 * faturamento com os custos. O produto em si abre em /app.
 */

type Area = "monitor" | "empresas" | "email" | "caixa" | "precos" | "faturamento";

const AREAS: Array<{ valor: Area; rotulo: string; icone: ReactNode }> = [
  { valor: "monitor", rotulo: "Monitor", icone: <Activity className="h-4 w-4" /> },
  { valor: "empresas", rotulo: "Empresas", icone: <Building2 className="h-4 w-4" /> },
  { valor: "email", rotulo: "E-mail", icone: <Mail className="h-4 w-4" /> },
  { valor: "caixa", rotulo: "Caixa da Aceleriq", icone: <Inbox className="h-4 w-4" /> },
  { valor: "precos", rotulo: "Preços", icone: <Tags className="h-4 w-4" /> },
  { valor: "faturamento", rotulo: "Faturamento", icone: <Wallet className="h-4 w-4" /> },
];

const AJUDA: Record<Area, string> = {
  monitor: "Se está tudo em ordem (e-mails, cobrança, rotinas, integrações, convites) e o CRM de cada empresa ao vivo. A tela se relê sozinha a cada 15 segundos.",
  empresas: "Quem usa o produto: situação, plano, usuários e mensalidade. Abra uma empresa para ajustar o que foi contratado, convidar pessoas e cobrar.",
  email: "O e-mail profissional numa rota só: as entradas (pedidos) com o marcar como pago e, embaixo, a migração de cada empresa (domínio, passo a passo, caixas, integração com Cloudflare e Zoho e a conferência do DNS).",
  caixa: "A caixa de e-mail oficial da Aceleriq dentro do painel, com o Zoho por trás. Desligada até o dono decidir: ligar pede o plano pago do Zoho.",
  precos: "Planos, preços do e-mail, prazos de teste e de atraso, os custos da casa e a chave que liga a cobrança no cartão.",
  faturamento: "Quanto o produto fatura por mês, o que está em atraso e quanto custa entregar. A mesma leitura aparece no Financeiro.",
};

export default function AdminProduto() {
  const [busca, setBusca] = useSearchParams();
  const pedida = busca.get("area") || "";
  const area: Area = AREAS.some((a) => a.valor === pedida) ? (pedida as Area) : "monitor";
  const irPara = (a: string) => {
    const nova = new URLSearchParams(busca);
    if (a === "monitor") nova.delete("area");
    else nova.set("area", a);
    setBusca(nova, { replace: true });
  };
  return (
    <div className="min-w-0 space-y-5" data-admin-produto="">
      <CabecalhoDePagina
        titulo="CRM e E-mail"
        ajuda={AJUDA[area]}
        aoLado={<Etapas soIcone rotulo="Áreas do produto" itens={AREAS} valor={area} onEscolher={irPara} className="min-w-0 flex-1" />}
        acoes={
          <Link to="/app" className={juntar(botao.icone)} aria-label="Abrir o produto" title="Abrir o produto">
            <ExternalLink className="h-4 w-4" aria-hidden="true" />
          </Link>
        }
      />
      {area === "empresas" && <ContasDaCasa />}
      <Suspense fallback={<Carregando linhas={5} />}>
        {area === "monitor" && <MonitorDoProduto />}
        {area === "email" && <EmailDaCasa />}
        {area === "caixa" && <CaixaDaAceleriq />}
        {area === "precos" && <PrecosDoProduto />}
        {area === "faturamento" && <FaturamentoDoProduto />}
      </Suspense>
    </div>
  );
}
