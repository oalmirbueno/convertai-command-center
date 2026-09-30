import { lazy, Suspense, useContext, useEffect, useState } from "react";
import { useSearchParams, useNavigate, UNSAFE_NavigationContext } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useClients } from "@/hooks/useSupabaseData";
import { ImpersonationProvider } from "@/contexts/ImpersonationContext";
import {
  ArrowLeft, Eye, LayoutDashboard, CheckSquare, CalendarDays,
  FileText, BarChart3, DollarSign, ShoppingBag, KeyRound, Users,
} from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  CabecalhoDePagina,
  Carregando,
  EstadoVazio,
  Etapas,
  SeletorCompacto,
  botao,
  foco,
  juntar,
  lista,
  texto,
} from "@/components/sistema";
import type { UserProfile } from "@/contexts/AuthContext";
import { PROFILE_SAFE_SELECT } from "@/lib/profileFields";

// Cada aba do portal baixa só quando abre. São os mesmos import() do App.tsx,
// então o arquivo é o mesmo e fica no mesmo cache. Antes, as 9 páginas vinham
// de uma vez (cerca de 570 KB comprimidos) para mostrar uma só.
const carregarAba = {
  dashboard: () => import("@/pages/ClientDashboard"),
  "onde-estamos": () => import("@/pages/ClientJourneyUpdates"),
  aprovacoes: () => import("@/pages/ClientApprovals"),
  calendario: () => import("@/pages/EditorialCalendar"),
  documentos: () => import("@/pages/ClientDocuments"),
  relatorios: () => import("@/pages/ClientReports"),
  pedidos: () => import("@/pages/ClientRequests"),
  cofre: () => import("@/pages/ClientVaultPage"),
  financeiro: () => import("@/pages/ClientFinanceiro"),
} as const;
const ClientDashboard = lazy(carregarAba.dashboard);
const ClientJourneyUpdates = lazy(carregarAba["onde-estamos"]);
const ClientApprovals = lazy(carregarAba.aprovacoes);
const EditorialCalendar = lazy(carregarAba.calendario);
const ClientDocuments = lazy(carregarAba.documentos);
const ClientReports = lazy(carregarAba.relatorios);
const ClientRequests = lazy(carregarAba.pedidos);
const ClientVaultPage = lazy(carregarAba.cofre);
const ClientFinanceiro = lazy(carregarAba.financeiro);

const clientTabs = [
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "onde-estamos", label: "Onde Estamos", icon: BarChart3 },
  { id: "aprovacoes", label: "Aprovações", icon: CheckSquare },
  { id: "calendario", label: "Agenda", icon: CalendarDays },
  { id: "documentos", label: "Documentos", icon: FileText },
  { id: "relatorios", label: "Relatórios", icon: BarChart3 },
  { id: "pedidos", label: "Pedidos", icon: ShoppingBag },
  { id: "cofre", label: "Cofre", icon: KeyRound },
  { id: "financeiro", label: "Financeiro", icon: DollarSign },
];

export default function AdminViewAsClient() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const clientId = searchParams.get("client");
  const { navigator } = useContext(UNSAFE_NavigationContext);

  // Dentro do espelho do cliente, qualquer atalho interno das paginas
  // (Aprovacoes, Onde Estamos, Cofre...) navegava para a rota REAL e jogava
  // o admin de volta nas telas dele. Aqui a navegacao e interceptada e vira
  // troca de aba, mantendo o admin vendo exatamente o que o cliente ve.
  useEffect(() => {
    if (!clientId) return;
    const tabByPath: Record<string, string> = {
      "/dashboard": "dashboard",
      "/onde-estamos": "onde-estamos",
      "/aprovacoes": "aprovacoes",
      "/calendario": "calendario",
      "/documentos": "documentos",
      "/relatorios": "relatorios",
      "/pedidos": "pedidos",
      "/cofre": "cofre",
      "/financeiro": "financeiro",
      "/projetos": "dashboard",
    };
    const originalPush = navigator.push;
    const guardedPush: typeof navigator.push = (...args: any[]) => {
      const target = typeof args[0] === "string" ? args[0] : args[0]?.pathname || "";
      const tab = tabByPath[target.split("?")[0]];
      if (tab) {
        originalPush.call(navigator, `/ver-como-cliente?client=${clientId}&tab=${tab}`);
        return;
      }
      originalPush.apply(navigator, args as any);
    };
    navigator.push = guardedPush;
    return () => {
      if (navigator.push === guardedPush) navigator.push = originalPush;
    };
  }, [navigator, clientId]);
  const projectId = searchParams.get("project");
  const tabParam = searchParams.get("tab") || "dashboard";
  const activeTab = clientTabs.some((tab) => tab.id === tabParam)
    ? tabParam
    : "dashboard";
  // Baixa a aba aberta junto com o perfil do cliente, sem esperar um pelo
  // outro. Sem cliente escolhido a tela é só a lista: nada a baixar. Uma falha
  // aqui é ignorada de propósito: o lazy() tenta de novo e, se falhar, o erro
  // vai para o RouteErrorBoundary como hoje.
  useEffect(() => {
    if (!clientId) return;
    carregarAba[activeTab as keyof typeof carregarAba]().catch(() => undefined);
  }, [activeTab, clientId]);
  const { data: clients, isLoading: loadingClients } = useClients();
  const [selectedClient, setSelectedClient] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (projectId && !clientId) {
      (async () => {
        const { data } = await supabase
          .from("projects")
          .select("client_id")
          .eq("id", projectId)
          .maybeSingle();
        if (cancelled) return;
        if (data?.client_id) {
          setSearchParams(
            (current) => {
              const next = new URLSearchParams(current);
              next.set("client", data.client_id);
              return next;
            },
            { replace: true },
          );
        } else {
          navigate("/clientes");
        }
      })();
      return () => {
        cancelled = true;
      };
    }

    if (!clientId && !projectId) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    if (clientId) {
      setLoading(true);
      setSelectedClient(null);
      (async () => {
        const { data } = await supabase
          .from("profiles")
          .select(PROFILE_SAFE_SELECT)
          .eq("id", clientId)
          .maybeSingle();
        if (cancelled) return;
        if (!data) {
          navigate("/clientes");
          return;
        }
        setSelectedClient(data);
        setLoading(false);
      })();
    }

    return () => {
      cancelled = true;
    };
  }, [
    clientId,
    navigate,
    projectId,
    setSearchParams,
  ]);

  const selectClient = (c: any) => {
    setSelectedClient(c);
    const next = new URLSearchParams(searchParams);
    next.set("client", c.id);
    next.set("tab", activeTab);
    next.delete("project");
    next.delete("content");
    setSearchParams(next);
    setLoading(false);
  };

  const switchTab = (tabId: string) => {
    if (clientId) {
      const next = new URLSearchParams(searchParams);
      next.set("client", clientId);
      next.set("tab", tabId);
      next.delete("content");
      setSearchParams(next);
    }
  };

  // Build impersonated profile for context
  const impersonatedProfile: UserProfile | null = selectedClient
    ? {
        id: selectedClient.id,
        full_name: selectedClient.full_name,
        email: selectedClient.email,
        company_name: selectedClient.company_name,
        avatar_url: selectedClient.avatar_url,
        plan_renewal_date: selectedClient.plan_renewal_date,
        plan_status: selectedClient.plan_status,
        services_config: selectedClient.services_config,
        onboarding_done: selectedClient.onboarding_done,
        role: "client" as const,
      }
    : null;

  const ativos = (clients || []).filter((c: any) => c.plan_status === "active");
  const iniciais = (c: any) => (c.full_name || c.company_name || "?").split(" ").map((n: string) => n[0]).join("").slice(0, 2);

  // No client selected - show client picker
  if (!clientId && !projectId && !loading) {
    return (
      <div className="min-w-0 space-y-5">
        <CabecalhoDePagina
          titulo="Ver como cliente"
          voltar={{ para: "/clientes", rotulo: "Clientes" }}
          descricao={ativos.length ? `${ativos.length} ${ativos.length === 1 ? "cliente ativo" : "clientes ativos"}` : undefined}
          ajuda="Selecione um cliente para navegar pelo painel completo como se fosse ele, em modo somente leitura."
        />

        {/* Lista aberta em duas colunas no computador (sem caixa em volta e sem
            um cartão por cliente). */}
        {loadingClients ? (
          <Carregando linhas={4} rotulo="Carregando clientes" />
        ) : ativos.length === 0 ? (
          <EstadoVazio icone={<Eye className="h-5 w-5" />} titulo="Nenhum cliente ativo" descricao="Clientes com plano ativo aparecem aqui." />
        ) : (
          <ul aria-label="Clientes ativos" className={juntar(lista.aberta, "grid grid-cols-1 gap-x-6 sm:grid-cols-2")}>
            {ativos.map((c: any) => (
              <li key={c.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => selectClient(c)}
                  className={juntar("group flex h-full w-full min-w-0 items-center rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-muted/40", foco)}
                >
                  <Avatar className="mr-3 h-8 w-8 shrink-0">
                    <AvatarFallback className="bg-primary/15 text-[11px] font-semibold text-primary">{iniciais(c)}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium leading-5 text-foreground">{c.company_name || c.full_name}</span>
                    <span className={juntar(texto.auxiliar, "block truncate")}>{c.email}</span>
                  </span>
                  <Eye className="ml-3 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-primary" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (loading) {
    return <Carregando forma="aba" rotulo="Carregando o portal do cliente" />;
  }

  const renderTabContent = () => {
    switch (activeTab) {
      case "onde-estamos":
        return <ClientJourneyUpdates />;
      case "aprovacoes":
        return <ClientApprovals />;
      case "calendario":
        return <EditorialCalendar />;
      case "documentos":
        return <ClientDocuments />;
      case "relatorios":
        return <ClientReports />;
      case "pedidos":
        return <ClientRequests />;
      case "financeiro":
        return <ClientFinanceiro />;
      case "cofre":
        return <ClientVaultPage />;
      default:
        return (
          <ClientDashboard
            impersonateClientId={selectedClient?.id}
            impersonateClientName={selectedClient?.company_name || selectedClient?.full_name}
          />
        );
    }
  };

  const nomeDoCliente = selectedClient?.company_name || selectedClient?.full_name || "";

  return (
    <ImpersonationProvider profile={impersonatedProfile} clientId={selectedClient?.id}>
      <div className="min-w-0">
        {/* Faixa do modo espelho: fina, numa linha, com a troca de cliente à direita */}
        <div className="mb-3 flex min-w-0 items-center rounded-lg border border-sky-500/20 bg-sky-500/[0.06] px-2 py-1.5">
          <button
            type="button"
            onClick={() => navigate("/clientes")}
            className={juntar(botao.icone, "text-sky-500 hover:bg-sky-500/10 hover:text-sky-400")}
            aria-label="Voltar para Clientes"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          </button>
          <Eye className="ml-1 mr-2 h-4 w-4 shrink-0 text-sky-500" aria-hidden="true" />
          {/* No celular o nome do cliente fica só no seletor (sem repetir e cortar). */}
          <p className="mr-2 shrink-0 truncate text-[12px] font-medium text-sky-500 sm:min-w-0 sm:flex-1 sm:shrink">
            Somente leitura<span className="hidden sm:inline"> · visualizando como: {nomeDoCliente}</span>
          </p>
          <div className="ml-auto flex min-w-0 flex-1 justify-end sm:flex-none">
          <SeletorCompacto
            rotulo="Trocar cliente"
            modo="lista"
            icone={<Users className="h-3.5 w-3.5" />}
            valor={clientId || ""}
            onEscolher={(id) => {
              const c = ativos.find((x: any) => x.id === id);
              if (c) selectClient(c);
            }}
            opcoes={ativos.map((c: any) => ({ valor: c.id, rotulo: c.company_name || c.full_name || "Cliente", descricao: c.email || undefined }))}
            className="h-8 max-w-full sm:max-w-[260px]"
          />
          </div>
        </div>

        {/* Abas do portal (as mesmas do cliente); a aba mora no endereço */}
        <Etapas
          rotulo="Áreas do portal do cliente"
          valor={activeTab}
          onEscolher={switchTab}
          itens={clientTabs.map((tab) => ({ valor: tab.id, rotulo: tab.label, icone: <tab.icon className="h-3.5 w-3.5" /> }))}
          className="mb-6 border-b border-border"
        />

        {/* Tab content */}
        <div className="min-w-0">
          {/* A chave troca a aba na hora, mesmo dentro da transição do roteador. */}
          <Suspense key={activeTab} fallback={<Carregando forma="aba" rotulo="Abrindo a área do cliente" />}>
            {renderTabContent()}
          </Suspense>
        </div>
      </div>
    </ImpersonationProvider>
  );
}
