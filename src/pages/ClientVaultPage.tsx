import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useImpersonation } from "@/contexts/ImpersonationContext";
import ClientVault from "@/components/vault/ClientVault";
import { MoreHorizontal, Search, Trash2, Users } from "lucide-react";
import ConfirmModal from "@/components/ui/ConfirmModal";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { LateralEsquerda } from "@/components/workspace/LateralEsquerda";
import {
  AreaDeTrabalho,
  CabecalhoDePagina,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  RegiaoRolavel,
  SeletorCompacto,
  botao,
  campo,
  juntar,
  texto,
  useEstadoDaTela,
} from "@/components/sistema";

interface ClientOption {
  id: string;
  full_name: string;
  company_name: string | null;
  avatar_url: string | null;
}

const idOuNada = (v: unknown) => v === null || typeof v === "string";

export default function ClientVaultPage() {
  const { profile, user } = useAuth();
  const { impersonatedId } = useImpersonation();
  const role = profile?.role || "client";
  const isAdminOrTeam = role === "admin" || ["design", "traffic", "manager"].includes(role);
  // Hub mode = admin/team browsing all clients (only when NOT impersonating)
  const isHubMode = isAdminOrTeam && !impersonatedId;

  // Cliente escolhido e busca ficam guardados: sair e voltar abre no mesmo lugar.
  const [selectedClientId, setSelectedClientId] = useEstadoDaTela<string | null>("cofre:cliente", null, { validar: idOuNada });
  const [search, setSearch] = useEstadoDaTela<string>("cofre:busca", "");
  const [confirmClearId, setConfirmClearId] = useState<string | null>(null);
  // Lista de clientes recolhida para o lado (SISTEMA.md 4.3): lembra por pessoa.
  const [clientesRecolhidos, setClientesRecolhidos] = useEstadoDaTela<boolean>("cofre:clientes-recolhidos", false, {
    validar: (v) => typeof v === "boolean",
  });
  const [clearing, setClearing] = useState(false);
  const qc = useQueryClient();

  const clearClientVault = async (cid: string) => {
    if (impersonatedId) {
      toast.error("O modo de visualização do cliente é somente leitura");
      return;
    }
    setClearing(true);
    const { error } = await supabase.from("client_vault").delete().eq("client_id", cid);
    setClearing(false);
    if (error) { toast.error(error.message); return; }
    toast.success("Cofre do cliente limpo");
    setConfirmClearId(null);
    qc.invalidateQueries({ queryKey: ["client-vault", cid] });
    qc.invalidateQueries({ queryKey: ["vault-counts", cid] });
  };

  // Load all clients (hub mode only)
  const {
    data: clients,
    isLoading: loadingClients,
    isError: clientsFailed,
    refetch: refetchClients,
    isFetching: fetchingClients,
  } = useQuery({
    queryKey: ["vault-clients-list"],
    queryFn: async () => {
      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "client");
      if (rolesError) throw rolesError;
      const ids = (roles || []).map((r: any) => r.user_id);
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, company_name, avatar_url")
        .in("id", ids)
        .order("full_name", { ascending: true });
      if (error) throw error;
      return (data || []) as ClientOption[];
    },
    enabled: isHubMode,
  });

  // Cliente guardado que não existe mais cai no primeiro da lista.
  const guardadoValido = !!selectedClientId && !!clients && clients.some((c) => c.id === selectedClientId);

  // Effective client id being viewed
  const effectiveClientId = isHubMode
    ? ((guardadoValido ? selectedClientId : null) || clients?.[0]?.id || null)
    : (impersonatedId || user?.id || null);

  // Counts per category for the selected client
  const { data: counts } = useQuery({
    queryKey: ["vault-counts", effectiveClientId],
    queryFn: async () => {
      if (!effectiveClientId) return { password: 0, link: 0, system: 0, total: 0 };
      const { data } = await supabase
        .from("client_vault")
        .select("category")
        .eq("client_id", effectiveClientId);
      const list = (data || []) as { category: string }[];
      return {
        password: list.filter((i) => i.category === "password").length,
        link: list.filter((i) => i.category === "link").length,
        system: list.filter((i) => i.category === "system").length,
        total: list.length,
      };
    },
    enabled: !!effectiveClientId,
  });

  const filteredClients = useMemo(() => {
    if (!clients) return [];
    const q = search.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) =>
        c.full_name?.toLowerCase().includes(q) ||
        c.company_name?.toLowerCase().includes(q)
    );
  }, [clients, search]);

  const selectedClient = clients?.find((c) => c.id === effectiveClientId);

  if (!effectiveClientId && !isAdminOrTeam) return null;

  // Uma linha de estado: o que tem no cofre aberto.
  const resumo = counts
    ? `${counts.total} ${counts.total === 1 ? "item" : "itens"} · ${counts.password} ${counts.password === 1 ? "senha" : "senhas"} · ${counts.link} ${counts.link === 1 ? "link" : "links"} · ${counts.system} ${counts.system === 1 ? "sistema" : "sistemas"}`
    : undefined;
  const podeLimpar = isAdminOrTeam && !!effectiveClientId && isHubMode;
  const nomeDoCliente = (c: ClientOption) => c.company_name || c.full_name;

  // No modo equipe o cliente é o título do bloco, com o "Novo item" na mesma linha.
  // Celular e tablet: o título É o seletor do cliente (a lista lateral só aparece de
  // 1024 px para cima); no computador, o nome (quem escolhe é a lista ao lado).
  const tituloDoCofre = isHubMode && selectedClient && clients ? (
    <>
      <SeletorCompacto
        modo="lista"
        rotulo="Cliente"
        icone={<Users className="h-3.5 w-3.5" />}
        className="lg:hidden"
        valor={selectedClient.id}
        onEscolher={(id) => setSelectedClientId(id)}
        opcoes={clients.map((c) => ({ valor: c.id, rotulo: nomeDoCliente(c), descricao: c.company_name ? c.full_name : undefined }))}
      />
      <span className="hidden lg:inline">
        {selectedClient.full_name}
        {selectedClient.company_name && <span className="font-normal text-muted-foreground"> · {selectedClient.company_name}</span>}
      </span>
    </>
  ) : undefined;
  const conteudo = effectiveClientId ? (
    <ClientVault clientId={effectiveClientId} canManage={isAdminOrTeam && !impersonatedId} titulo={tituloDoCofre} />
  ) : isHubMode && loadingClients ? (
    <Carregando forma="lista" linhas={4} rotulo="Carregando o cofre" />
  ) : isHubMode && clientsFailed ? (
    <EstadoDeErro
      className="lg:hidden"
      titulo="Não foi possível carregar os clientes."
      acao={
        <button type="button" className={botao.secundario} onClick={() => void refetchClients()} disabled={fetchingClients}>
          Tentar de novo
        </button>
      }
    />
  ) : (
    <EstadoVazio icone={<Users className="h-5 w-5" />} titulo="Nenhum cliente" descricao="Cadastre um cliente para guardar os acessos dele." />
  );

  return (
    <div className="min-w-0">
      <CabecalhoDePagina
        titulo="Cofre"
        descricao={resumo}
        ajuda="Senhas, links úteis e sistemas do cliente num lugar só. As senhas ficam mascaradas até alguém pedir para ver."
        acoes={
          <>
            {podeLimpar && (
              <button
                type="button"
                onClick={() => setConfirmClearId(effectiveClientId)}
                className={juntar(botao.discreto, "hidden hover:text-destructive sm:inline-flex")}
                title="Limpar todo o cofre deste cliente"
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                Limpar cofre
              </button>
            )}
            {podeLimpar && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" className={juntar(botao.icone, "sm:hidden")} aria-label="Mais ações">
                    <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem className="text-destructive" onSelect={() => setConfirmClearId(effectiveClientId)}>
                    <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" />
                    Limpar cofre
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        }
      />

      {isHubMode ? (
        // Área de trabalho (SISTEMA.md seção 8): de 1024 px para cima a lista de
        // clientes e os itens do cofre rolam cada um por conta própria, até o fim
        // da janela. No celular a página rola normal e o cliente é o seletor do título.
        <AreaDeTrabalho principalRolavel={false} rotuloDoPrincipal="Cofre" className="mt-4">
          <div
            className={juntar(
              "flex min-w-0 flex-col lg:grid lg:min-h-0 lg:flex-1 lg:grid-rows-[minmax(0,1fr)]",
              clientesRecolhidos ? "lg:grid-cols-[32px_minmax(0,1fr)] lg:gap-3" : "lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-6",
            )}
          >
            {/* Lista de clientes: recolhe para o lado, numa tirinha (SISTEMA.md 4.3). */}
            <LateralEsquerda
              rotulo="Clientes"
              icone={<Users className="h-4 w-4" />}
              recolhida={clientesRecolhidos}
              onAlternar={() => setClientesRecolhidos(!clientesRecolhidos)}
              acao={
                clients ? (
                  <span className={juntar(texto.auxiliar, "ml-2 shrink-0 tabular-nums")}>
                    {filteredClients.length === clients.length ? clients.length : `${filteredClients.length} de ${clients.length}`}
                  </span>
                ) : undefined
              }
            >
              <div className="relative mb-2 shrink-0">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar cliente"
                  aria-label="Buscar cliente"
                  className={juntar(campo, "pl-8")}
                />
              </div>
              {loadingClients && !clients ? (
                <Carregando forma="lista" linhas={6} rotulo="Carregando clientes" />
              ) : clientsFailed && !clients ? (
                <EstadoDeErro
                  titulo="Não foi possível carregar os clientes."
                  acao={
                    <button type="button" className={botao.secundario} onClick={() => void refetchClients()} disabled={fetchingClients}>
                      Tentar de novo
                    </button>
                  }
                />
              ) : filteredClients.length === 0 ? (
                <EstadoVazio compacto titulo="Nenhum cliente encontrado." />
              ) : (
                <RegiaoRolavel memoria="cofre:clientes" rotulo="Lista de clientes">
                  <ul className="divide-y divide-border">
                    {filteredClients.map((c) => {
                      const active = c.id === effectiveClientId;
                      const initials = (c.full_name || "?")
                        .split(" ")
                        .map((n) => n[0])
                        .join("")
                        .slice(0, 2)
                        .toUpperCase();
                      return (
                        <li key={c.id} className="group flex min-w-0 items-center py-1">
                          <button
                            type="button"
                            onClick={() => setSelectedClientId(c.id)}
                            aria-current={active ? "true" : undefined}
                            className={juntar(
                              "flex min-w-0 flex-1 items-center rounded-md px-2 py-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              active ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                            )}
                          >
                            <span className="mr-2.5 flex h-7 w-7 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                              {c.avatar_url ? (
                                <img src={c.avatar_url} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <span className="text-[11px] font-semibold text-primary">{initials}</span>
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-medium">{c.full_name}</span>
                              {c.company_name && <span className="block truncate text-[12px] text-muted-foreground">{c.company_name}</span>}
                            </span>
                            {active && <span className="ml-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" />}
                          </button>
                          {isAdminOrTeam && (
                            <button
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setConfirmClearId(c.id); }}
                              className={juntar(botao.icone, "ml-1 hover:text-destructive")}
                              aria-label={`Limpar cofre de ${c.full_name}`}
                              title="Limpar cofre deste cliente"
                            >
                              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </RegiaoRolavel>
              )}
            </LateralEsquerda>

            {/* Itens do cofre: rolam por dentro no computador, lembrando a posição por cliente. */}
            <section className="flex min-w-0 flex-col lg:min-h-0" aria-label="Itens do cofre">
              <RegiaoRolavel memoria={`cofre:itens:${effectiveClientId || "-"}`} rotulo="Itens do cofre" className="lg:pr-1">
                {conteudo}
              </RegiaoRolavel>
            </section>
          </div>
        </AreaDeTrabalho>
      ) : (
        <section className="mt-5 min-w-0" aria-label="Itens do cofre">
          {conteudo}
        </section>
      )}

      <ConfirmModal
        open={!!confirmClearId}
        title="Limpar cofre do cliente?"
        description="Todos os itens (senhas, links e sistemas) deste cliente serão removidos permanentemente."
        confirmLabel={clearing ? "Removendo..." : "Limpar tudo"}
        onConfirm={() => confirmClearId && clearClientVault(confirmClearId)}
        onCancel={() => !clearing && setConfirmClearId(null)}
      />
    </div>
  );
}
