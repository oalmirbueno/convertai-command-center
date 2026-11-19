import { lazy, Suspense, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Activity, Building2, ExternalLink, Globe, HeartPulse, Inbox, Mail, MonitorSmartphone, Tags, Wallet } from "lucide-react";
import { CabecalhoDePagina, Carregando, Etapas, botao, juntar } from "@/components/sistema";
import ContasDaCasa from "@/components/produto/casa/ContasDaCasa";

const MonitorDoProduto = lazy(() => import("@/components/produto/casa/MonitorDoProduto"));
const EmailDaCasa = lazy(() => import("@/components/produto/casa/EmailDaCasa"));
const PrecosDoProduto = lazy(() => import("@/components/produto/casa/PrecosDoProduto"));
const FaturamentoDoProduto = lazy(() => import("@/components/produto/casa/FaturamentoDoProduto"));
const CentralDeEmail = lazy(() => import("@/components/produto/casa/CentralDeEmail"));
const CaixaDaAceleriq = lazy(() => import("@/components/produto/casa/CaixaDaAceleriq"));
const CentralDeDominios = lazy(() => import("@/components/produto/casa/CentralDeDominios"));

/**
 * A gestão dos produtos vendidos, dentro do painel da casa (só admin).
 * 18/11/2026 (dono: "separar a gestão de cada um, para não dar confusão"): o CRM e o E-mail viraram
 * duas telas, cada uma com as suas abas e a sua rota:
 *   /produto/crm[/empresas|/precos|/faturamento]       visão geral, empresas, planos e faturamento
 *   /produto/email[/entradas|/caixa|/precos]           central, entradas e migrações, caixa e preços
 *   /produto/dominios[/sites]                          central de domínios e sites dos clientes (19/11/2026)
 * Os endereços antigos (/produto, ?area=, /produto/central...) caem na tela certa.
 */

export type Produto = "crm" | "email" | "dominios";
type Aba = { valor: string; rotulo: string; icone: ReactNode; ajuda: string };

const ABAS: Record<Produto, Aba[]> = {
  crm: [
    { valor: "inicio", rotulo: "Visão geral", icone: <Activity className="h-4 w-4" />, ajuda: "Se está tudo em ordem (cobrança, rotinas, integrações, convites) e o CRM de cada empresa ao vivo. A tela se relê sozinha a cada 15 segundos." },
    { valor: "empresas", rotulo: "Empresas", icone: <Building2 className="h-4 w-4" />, ajuda: "Quem usa o CRM: situação, plano, usuários e mensalidade. Abra uma empresa para ajustar o que foi contratado, convidar pessoas e cobrar." },
    { valor: "precos", rotulo: "Planos e preços", icone: <Tags className="h-4 w-4" />, ajuda: "Os planos do CRM (preço por usuário), prazos de teste e de atraso, os custos da casa e a chave que liga a cobrança no cartão." },
    { valor: "faturamento", rotulo: "Faturamento", icone: <Wallet className="h-4 w-4" />, ajuda: "Quanto as empresas pagam por mês (o CRM e o e-mail que vai junto na mesma cobrança), o que está em atraso e quanto custa entregar. A mesma leitura aparece no Financeiro." },
  ],
  email: [
    { valor: "inicio", rotulo: "Central", icone: <HeartPulse className="h-4 w-4" />, ajuda: "A saúde do e-mail de cada cliente: pagamento, vencimento do domínio e do plano, DNS, limite de caixas e pedidos parados. Do mais urgente para o mais tranquilo." },
    { valor: "entradas", rotulo: "Entradas e migrações", icone: <Mail className="h-4 w-4" />, ajuda: "As entradas (pedidos) com o marcar como pago e, embaixo, a migração de cada empresa: domínio, passo a passo, caixas, integração com Cloudflare e Zoho e a conferência do DNS." },
    { valor: "caixa", rotulo: "Caixa da Aceleriq", icone: <Inbox className="h-4 w-4" />, ajuda: "A caixa de e-mail oficial da Aceleriq dentro do painel, com o Zoho por trás. Desligada até o dono decidir: ligar pede o plano pago do Zoho." },
    { valor: "precos", rotulo: "Preços", icone: <Tags className="h-4 w-4" />, ajuda: "Quanto custa o e-mail profissional: migração, mensalidade, caixas incluídas e caixa adicional, e quanto cada caixa extra custa para a casa." },
  ],
  dominios: [
    { valor: "inicio", rotulo: "Domínios", icone: <Globe className="h-4 w-4" />, ajuda: "Todos os domínios dos clientes num lugar só: registrador, onde está o DNS, quando vence, se o e-mail está certo, quanto custa e quanto a casa cobra." },
    { valor: "sites", rotulo: "Sites", icone: <MonitorSmartphone className="h-4 w-4" />, ajuda: "Os sites publicados na Cloudflare da casa e os de fora: se abrem, SSL, última publicação, domínio ligado, custo e preço." },
  ],
};

const TITULO: Record<Produto, string> = { crm: "CRM", email: "E-mail", dominios: "Domínios e sites" };

/** Endereço antigo (antes da separação) para o novo. Devolve null quando o endereço já é o novo. */
export function enderecoNovo(segmento: string | undefined, consulta: string | null): string | null {
  if (segmento === "crm" || segmento === "email" || segmento === "dominios") return null;
  const antigo = segmento || consulta || "";
  const mapa: Record<string, string> = {
    "": "/produto/crm",
    monitor: "/produto/crm",
    empresas: "/produto/crm/empresas",
    faturamento: "/produto/crm/faturamento",
    precos: "/produto/crm/precos",
    central: "/produto/email",
    caixa: "/produto/email/caixa",
  };
  if (antigo === "email") return "/produto/email/entradas";
  return mapa[antigo] || "/produto/crm";
}

/** A aba pedida na rota, ou a primeira quando não existe. */
export function abaDaRota(produto: Produto, aba: string | undefined): string {
  return aba && aba !== "inicio" && ABAS[produto].some((a) => a.valor === aba) ? aba : "inicio";
}

export default function AdminProduto() {
  const { produto: p, aba: a } = useParams();
  const [busca] = useSearchParams();
  const local = useLocation();
  const navegar = useNavigate();
  const novo = enderecoNovo(p, busca.get("area"));
  if (novo && novo !== local.pathname) return <Navigate to={novo} replace />;
  const produto: Produto = p === "email" ? "email" : p === "dominios" ? "dominios" : "crm";
  const aba = abaDaRota(produto, a);
  const abas = ABAS[produto];
  const atual = abas.find((x) => x.valor === aba) || abas[0];
  const irPara = (v: string) => navegar(v !== "inicio" ? `/produto/${produto}/${v}` : `/produto/${produto}`, { replace: true });
  return (
    <div className="min-w-0 space-y-5" data-admin-produto={produto}>
      <CabecalhoDePagina
        titulo={TITULO[produto]}
        ajuda={atual.ajuda}
        aoLado={<Etapas soIcone rotulo={`Áreas do ${TITULO[produto]}`} itens={abas} valor={aba} onEscolher={irPara} className="min-w-0 flex-1" />}
        acoes={
          produto === "crm" ? (
            <Link to="/app" className={juntar(botao.icone)} aria-label="Abrir o CRM" title="Abrir o CRM">
              <ExternalLink className="h-4 w-4" aria-hidden="true" />
            </Link>
          ) : undefined
        }
      />
      {produto === "crm" && aba === "empresas" && <ContasDaCasa />}
      <Suspense fallback={<Carregando linhas={5} />}>
        {produto === "crm" && aba === "inicio" && <MonitorDoProduto />}
        {produto === "crm" && aba === "precos" && <PrecosDoProduto parte="crm" />}
        {produto === "crm" && aba === "faturamento" && <FaturamentoDoProduto />}
        {produto === "email" && aba === "inicio" && <CentralDeEmail />}
        {produto === "email" && aba === "entradas" && <EmailDaCasa />}
        {produto === "email" && aba === "caixa" && <CaixaDaAceleriq />}
        {produto === "email" && aba === "precos" && <PrecosDoProduto parte="email" />}
        {produto === "dominios" && <CentralDeDominios key={aba} parte={aba === "sites" ? "sites" : "dominios"} />}
      </Suspense>
    </div>
  );
}
