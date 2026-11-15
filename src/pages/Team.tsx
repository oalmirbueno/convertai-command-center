import { useEffect, useState } from "react";
import { useTeamMembers, useTasks, useClients } from "@/hooks/useSupabaseData";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { Avatar as Foto, CardSurface, MiniBars, PillTabs, SearchField, StatCard, StatGrid, StatusPill, Toolbar, type Tone } from "@/components/ds";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { UserPlus, Loader2, Trash2, Edit3, AlertTriangle, Check, Search, MoreHorizontal, Users, ListChecks, ShieldCheck, Building2 } from "lucide-react";
import { toast } from "sonner";
import { getSupabaseFunctionErrorMessage } from "@/lib/supabaseFunctionError";
import {
  AjudaRecolhida,
  CabecalhoDePagina,
  CampoDeFormulario,
  Carregando,
  EstadoDeErro,
  EstadoVazio,
  GrupoDeCampos,
  botao,
  campo,
  foco,
  juntar,
  superficie,
  texto,
  useEstadoDaTela,
} from "@/components/sistema";

// Mesma regra do servidor (manage-team): 12+ com maiúscula, minúscula, número e símbolo.
const senhaForte = (senha: string) => senha.length >= 12 && /[a-z]/.test(senha) && /[A-Z]/.test(senha) && /[0-9]/.test(senha) && /[^A-Za-z0-9]/.test(senha);

const roleBadge: Record<string, { tom: Tone; label: string }> = {
  admin: { tom: "accent", label: "Admin" },
  design: { tom: "info", label: "Design" },
  traffic: { tom: "warning", label: "Tráfego" },
  manager: { tom: "success", label: "Manager" },
};

export default function Team() {
  const { data: members, isLoading, isError, refetch } = useTeamMembers();
  const { data: allTasks } = useTasks();
  const { data: clients } = useClients();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [editMember, setEditMember] = useState<any>(null);
  const [removeMember, setRemoveMember] = useState<any>(null);
  const [removing, setRemoving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("design");
  const [assignedClientIds, setAssignedClientIds] = useState<string[]>([]);
  const [initialAssignedIds, setInitialAssignedIds] = useState<string[]>([]);
  const [clientSearch, setClientSearch] = useState("");
  const [assignments, setAssignments] = useState<Record<string, string[]>>({});
  const [busca, setBusca] = useEstadoDaTela("equipe:busca", "");
  const [papel, setPapel] = useEstadoDaTela("equipe:papel", "todos", {
    validar: (v) => v === "todos" || (typeof v === "string" && v in roleBadge),
  });

  const taskCountFor = (userId: string) => (allTasks || []).filter((t: any) => t.assigned_to === userId && t.status !== "done").length;

  // Load assignments map for all team members (badge counts on list)
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("team_client_assignments").select("user_id, client_id");
      const map: Record<string, string[]> = {};
      (data || []).forEach((r: any) => {
        (map[r.user_id] ||= []).push(r.client_id);
      });
      setAssignments(map);
    })();
  }, [members]);

  const callManageTeam = async (body: any) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error("Não autenticado");

    const res = await supabase.functions.invoke("manage-team", {
      body,
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (res.data?.error) throw new Error(res.data.error);
    if (res.error) {
      throw new Error(
        await getSupabaseFunctionErrorMessage(res.error, "Erro"),
      );
    }
    return res.data;
  };

  const persistAssignments = async (userId: string) => {
    if (role === "admin") return; // admin sees everything
    const toRemove = initialAssignedIds.filter((id) => !assignedClientIds.includes(id));
    const toAdd = assignedClientIds.filter((id) => !initialAssignedIds.includes(id));
    if (toRemove.length) {
      const { error } = await supabase
        .from("team_client_assignments")
        .delete()
        .eq("user_id", userId)
        .in("client_id", toRemove);
      if (error) throw error;
    }
    if (toAdd.length) {
      const { error } = await supabase
        .from("team_client_assignments")
        .insert(toAdd.map((cid) => ({ user_id: userId, client_id: cid })));
      if (error) throw error;
    }
  };

  const handleCreate = async () => {
    if (!name.trim() || !email.trim()) { toast.error("Preencha nome e email"); return; }
    if (!password || !senhaForte(password)) { toast.error("Defina uma senha inicial com no mínimo 12 caracteres, com maiúscula, minúscula, número e símbolo"); return; }
    setSaving(true);
    try {
      const res = await callManageTeam({ action: "create", email: email.trim(), full_name: name.trim(), role, password });
      const newUserId = res?.user_id || res?.user?.id;
      if (newUserId && role !== "admin" && assignedClientIds.length) {
        const { error } = await supabase.from("team_client_assignments").insert(
          assignedClientIds.map((cid) => ({ user_id: newUserId, client_id: cid }))
        );
        if (error) throw new Error("Membro criado, mas não foi possível atribuir os clientes");
      }
      toast.success("Membro criado com a senha definida.");
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
      setCreateOpen(false);
      resetForm();
    } catch (err: any) {
      toast.error(err.message || "Erro ao criar membro");
    }
    setSaving(false);
  };

  const handleEdit = async () => {
    if (!editMember || !name.trim()) { toast.error("Preencha o nome"); return; }
    if (password && !senhaForte(password)) { toast.error("Senha deve ter no mínimo 12 caracteres, com maiúscula, minúscula, número e símbolo"); return; }
    setSaving(true);
    try {
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ full_name: name.trim() })
        .eq("id", editMember.id);
      if (profileError) throw profileError;

      if (role !== editMember.role) {
        await callManageTeam({ action: "update_role", user_id: editMember.id, role });
      }

      if (password) {
        await callManageTeam({ action: "update_password", user_id: editMember.id, password });
      }

      await persistAssignments(editMember.id);

      toast.success("Membro atualizado.");
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      setEditMember(null);
      resetForm();
    } catch (err: any) {
      toast.error(err.message || "Erro ao salvar");
    }
    setSaving(false);
  };

  const handleRemove = async () => {
    if (!removeMember) return;
    setRemoving(true);
    try {
      /*
       * Excluir primeiro, desativar se houver histórico.
       *
       * A exclusão recusa quem participou da trilha editorial — e está
       * certa: apagar o autor tornaria o histórico mentiroso. Antes o dono
       * batia nessa recusa e ficava sem saída nenhuma. Agora a recusa vira
       * a saída correta: o acesso cai, o nome some da equipe ativa, e o
       * que a pessoa fez continua registrado.
       */
      try {
        await callManageTeam({ action: "delete", user_id: removeMember.id });
        toast.success("Membro removido com sucesso");
      } catch (err: any) {
        const temHistorico = /hist[oó]rico editorial|editorial_history_conflict/i
          .test(String(err?.message || ""));
        if (!temHistorico) throw err;
        await callManageTeam({ action: "deactivate", user_id: removeMember.id });
        toast.success(
          `${removeMember.full_name} foi desativado: perdeu o acesso e saiu da equipe. ` +
          "O histórico do que ele fez continua registrado, porque apagá-lo tornaria a trilha falsa.",
        );
      }
      queryClient.invalidateQueries({ queryKey: ["team-members"] });
      setRemoveMember(null);
    } catch (err: any) {
      toast.error(err.message || "Erro ao remover");
    }
    setRemoving(false);
  };

  const openEdit = (m: any) => {
    setEditMember(m);
    setName(m.full_name || "");
    setEmail(m.email || "");
    setRole(m.role || "design");
    const current = assignments[m.id] || [];
    setAssignedClientIds(current);
    setInitialAssignedIds(current);
    setClientSearch("");
  };

  const resetForm = () => {
    setName(""); setEmail(""); setPassword(""); setRole("design");
    setAssignedClientIds([]); setInitialAssignedIds([]); setClientSearch("");
  };

  const closeModal = () => {
    setCreateOpen(false);
    setEditMember(null);
    resetForm();
  };

  const toggleClient = (id: string) => {
    setAssignedClientIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const isModalOpen = createOpen || !!editMember;
  const showClientPicker = role !== "admin";
  const filteredClients = (clients || []).filter((c: any) => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return true;
    return (c.full_name || "").toLowerCase().includes(q) || (c.company_name || "").toLowerCase().includes(q);
  });


  // ---- Filtros da lista (lembram ao sair e voltar) ----
  const buscaNormalizada = busca.trim().toLowerCase();
  const lista = (members || []) as any[];
  const visiveis = lista.filter((m: any) => {
    if (papel !== "todos" && m.role !== papel) return false;
    if (!buscaNormalizada) return true;
    return (m.full_name || "").toLowerCase().includes(buscaNormalizada) || (m.email || "").toLowerCase().includes(buscaNormalizada);
  });
  const contagemPorPapel = (valor: string) => lista.filter((m: any) => m.role === valor).length;
  const abasDePapel = [
    { value: "todos", label: "Todos", count: lista.length },
    ...Object.keys(roleBadge).map((valor) => ({ value: valor, label: roleBadge[valor].label, count: contagemPorPapel(valor) })),
  ];

  const clientesDe = (m: any) => (assignments[m.id]?.length || 0);
  // Números da fileira de cima: só o que a tela já tem (membros, tarefas em aberto por pessoa, clientes atribuídos).
  const tarefasPorMembro = lista.map((m: any) => taskCountFor(m.id));
  const tarefasEmAberto = tarefasPorMembro.reduce((soma, n) => soma + n, 0);
  const clientesComResponsavel = Object.keys(
    Object.keys(assignments).reduce((mapa: Record<string, true>, userId) => {
      assignments[userId].forEach((clientId) => { mapa[clientId] = true; });
      return mapa;
    }, {}),
  ).length;

  const menuDaLinha = (m: any) => (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" className={botao.icone} aria-label={`Ações de ${m.full_name || "membro"}`}>
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={() => openEdit(m)}>
          <Edit3 className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Editar
        </DropdownMenuItem>
        {m.role !== "admin" && (
          <DropdownMenuItem
            onSelect={() => setRemoveMember(m)}
            className="text-destructive focus:text-destructive"
            title="Remove da equipe. Se a pessoa tiver histórico, ela é desativada em vez de apagada."
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Remover da equipe
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  const etiquetaDoPapel = (r: string) => {
    const badge = roleBadge[r] || roleBadge.admin;
    return <StatusPill tone={badge.tom}>{badge.label}</StatusPill>;
  };

  return (
    <div className="min-w-0 space-y-6 sm:space-y-8">
      <CabecalhoDePagina
        titulo="Equipe"
        descricao={members ? `${lista.length} ${lista.length === 1 ? "membro" : "membros"}` : undefined}
        ajuda="Quem trabalha no painel, o papel de cada um e os clientes que cada pessoa acessa. Admin vê todos os clientes."
        acoes={
          <button
            type="button"
            onClick={() => { closeModal(); setCreateOpen(true); }}
            className={juntar(botao.primario, "px-2.5 sm:px-3.5")}
            aria-label="Adicionar membro"
          >
            <UserPlus className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
            <span className="hidden sm:inline">Adicionar membro</span>
          </button>
        }
      />

      {/* Enquanto carrega, a fileira já ocupa o lugar dela (com "–"): a busca e a lista não pulam quando os números chegam. */}
      {((isLoading && !members) || (members && lista.length > 0)) && (
        <StatGrid cols={4} label="Números da equipe">
          <StatCard variant="ink" icon={<Users className="h-4 w-4" />} label="Membros" value={members ? lista.length : "–"} hint={`${Object.keys(roleBadge).filter((r) => contagemPorPapel(r) > 0).length} papéis em uso`} />
          <StatCard
            variant="accent"
            icon={<ListChecks className="h-4 w-4" />}
            label="Tarefas abertas"
            value={members ? tarefasEmAberto : "–"}
            hint="Somando a equipe"
            chart={tarefasPorMembro.length > 1 && tarefasEmAberto > 0 ? <MiniBars values={tarefasPorMembro} height={40} label="Tarefas em aberto por membro" /> : undefined}
            chartPosition="side"
          />
          <StatCard icon={<Building2 className="h-4 w-4" />} label="Clientes atribuídos" value={members ? clientesComResponsavel : "–"} hint="Com responsável" />
          <StatCard icon={<ShieldCheck className="h-4 w-4" />} label="Admins" value={members ? contagemPorPapel("admin") : "–"} hint="Veem todos os clientes" />
        </StatGrid>
      )}

      <Toolbar
        label="Buscar e filtrar a equipe"
        search={<SearchField value={busca} onChange={setBusca} placeholder="Buscar por nome ou e-mail" label="Buscar membro" />}
        filters={<PillTabs tabs={abasDePapel} value={papel} onChange={setPapel} label="Papel" />}
      />

      {isLoading && !members ? (
        <Carregando linhas={5} rotulo="Carregando equipe" />
      ) : isError && !members ? (
        <EstadoDeErro
          titulo="Não foi possível carregar a equipe."
          acao={<button type="button" className={botao.secundario} onClick={() => refetch()}>Tentar de novo</button>}
        />
      ) : lista.length === 0 ? (
        <EstadoVazio
          icone={<UserPlus className="h-5 w-5" />}
          titulo="Nenhum membro ainda"
          descricao="Adicione a primeira pessoa da equipe."
          acao={<button type="button" className={botao.primario} onClick={() => { closeModal(); setCreateOpen(true); }}>Adicionar membro</button>}
        />
      ) : visiveis.length === 0 ? (
        <EstadoVazio
          compacto
          titulo="Ninguém com esse filtro."
          acao={<button type="button" className={botao.discreto} onClick={() => { setBusca(""); setPapel("todos"); }}>Limpar filtros</button>}
        />
      ) : (
        /* Rodada ousada (15/11/2026): um cartão por pessoa, com a foto de iniciais grande, o papel em pílula e os dois números. */
        <ul aria-label="Membros da equipe" className="grid min-w-0 grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-5 xl:grid-cols-3">
          {visiveis.map((m: any) => (
            <CardSurface as="li" key={m.id} className="flex flex-col p-4 sm:p-6">
              <div className="flex min-w-0 items-start">
                <Foto name={m.full_name} size="lg" tone={m.role === "admin" ? "ink" : "accent"} />
                <div className="ml-3 min-w-0 flex-1">
                  <button type="button" onClick={() => openEdit(m)} className={juntar("block max-w-full truncate rounded text-left text-[15px] font-semibold leading-6 text-foreground hover:underline", foco)}>
                    {m.full_name}
                  </button>
                  <p className={juntar(texto.auxiliar, "truncate")}>{m.email}</p>
                </div>
                <span className="-mr-2 -mt-1 ml-1 shrink-0">{menuDaLinha(m)}</span>
              </div>
              {/* Celular: papel e os dois números numa linha só (a pessoa cabe em um terço da altura). */}
              <div className="mt-3 flex min-w-0 flex-wrap items-center sm:mt-4">
                {etiquetaDoPapel(m.role)}
                <span className={juntar(texto.auxiliar, "ml-2.5 min-w-0 truncate tabular-nums sm:hidden")}>
                  {m.role === "admin" ? "Todos os clientes" : `${clientesDe(m)} cliente(s)`} · {taskCountFor(m.id)} tarefa(s)
                </span>
              </div>
              <dl className="mt-4 hidden min-w-0 grid-cols-2 gap-3 sm:grid">
                <div className={juntar(superficie.poco, "min-w-0 px-4 py-3")}>
                  <dt className={juntar(texto.auxiliar, "truncate")}>Clientes</dt>
                  <dd className="mt-0.5 truncate text-[24px] font-semibold leading-8 tracking-[-0.02em] tabular-nums text-foreground">{m.role === "admin" ? "Todos" : clientesDe(m)}</dd>
                </div>
                <div className={juntar(superficie.poco, "min-w-0 px-4 py-3")}>
                  <dt className={juntar(texto.auxiliar, "truncate")}>Tarefas</dt>
                  <dd className="mt-0.5 truncate text-[24px] font-semibold leading-8 tracking-[-0.02em] tabular-nums text-foreground">{taskCountFor(m.id)}</dd>
                </div>
              </dl>
            </CardSurface>
          ))}
        </ul>
      )}

      {/* Adicionar / editar */}
      <Dialog open={isModalOpen} onOpenChange={(o) => { if (!o) closeModal(); }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle className={texto.tituloSecao}>{editMember ? "Editar membro" : "Novo membro"}</DialogTitle>
          </DialogHeader>
          <div className="min-w-0 space-y-4">
            <GrupoDeCampos>
              <CampoDeFormulario rotulo="Nome completo" obrigatorio>
                <input value={name} onChange={e => setName(e.target.value)} className={campo} autoComplete="off" />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="E-mail" apoio={editMember ? "O e-mail não muda depois de criado." : undefined} obrigatorio={!editMember}>
                <input value={email} onChange={e => setEmail(e.target.value)} type="email" disabled={!!editMember} className={campo} autoComplete="off" />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Função">
                <select value={role} onChange={e => setRole(e.target.value)} className={campo}>
                  <option value="admin">Admin</option>
                  <option value="design">Design</option>
                  <option value="traffic">Tráfego</option>
                  <option value="manager">Manager</option>
                </select>
              </CampoDeFormulario>
              <CampoDeFormulario
                rotulo={editMember ? "Nova senha" : "Senha Inicial *"}
                apoio={editMember ? "Vazio mantém a senha atual." : "12+ caracteres, maiúscula, minúscula, número e símbolo."}
              >
                <input value={password} onChange={e => setPassword(e.target.value)} type="password" autoComplete="new-password"
                  placeholder={editMember ? "Deixe vazio para manter atual" : "Mínimo 12 caracteres, com maiúscula, número e símbolo"}
                  className={campo} />
              </CampoDeFormulario>
            </GrupoDeCampos>

            {showClientPicker && (
              <div className="min-w-0">
                <div className="mb-1.5 flex min-w-0 items-center">
                  <span className={juntar(texto.rotulo, "min-w-0 flex-1 truncate")}>Clientes atribuídos</span>
                  <AjudaRecolhida className="ml-1 mr-2">Este membro acessa só os clientes marcados. Sem seleção, ele vê apenas clientes de tarefas atribuídas a ele.</AjudaRecolhida>
                  <span className={juntar(texto.auxiliar, "shrink-0 tabular-nums")}>
                    {assignedClientIds.length} selecionado{assignedClientIds.length === 1 ? "" : "s"}
                  </span>
                </div>
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <input
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    placeholder="Buscar cliente..."
                    aria-label="Buscar cliente"
                    className={juntar(campo, "pl-8")}
                  />
                </div>
                <div className={juntar(superficie.poco, "mt-2 max-h-56 overflow-y-auto overscroll-contain")}>
                  {filteredClients.length === 0 ? (
                    <p className={juntar(texto.auxiliar, "px-3 py-4 text-center")}>Nenhum cliente encontrado</p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {filteredClients.map((c: any) => {
                        const checked = assignedClientIds.includes(c.id);
                        return (
                          <li key={c.id}>
                            <button
                              type="button"
                              role="checkbox"
                              aria-checked={checked}
                              onClick={() => toggleClient(c.id)}
                              className={juntar("flex w-full min-w-0 items-center px-3 py-2 text-left transition-colors hover:bg-muted", foco)}
                            >
                              <span className={`mr-3 flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors ${checked ? "border-primary bg-primary" : "border-border bg-transparent"}`} aria-hidden="true">
                                {checked && <Check className="h-3 w-3 text-primary-foreground" />}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className={juntar(texto.corpo, "block truncate")}>{c.full_name || "(sem nome)"}</span>
                                {c.company_name && <span className={juntar(texto.auxiliar, "block truncate")}>{c.company_name}</span>}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="flex min-w-0 flex-wrap justify-end border-t border-border pt-4 [&>*+*]:ml-2">
            <button type="button" onClick={closeModal} className={botao.secundario}>Cancelar</button>
            <button type="button" onClick={editMember ? handleEdit : handleCreate} disabled={saving} className={botao.primario}>
              {saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              {saving ? "Salvando..." : editMember ? "Salvar" : "Criar"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Remover */}
      <Dialog open={!!removeMember} onOpenChange={(o) => { if (!o && !removing) setRemoveMember(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className={juntar(texto.tituloSecao, "flex items-center")}>
              <AlertTriangle className="mr-2 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" /> Remover membro
            </DialogTitle>
            <DialogDescription className="text-[13px] leading-5">
              <span className="font-medium text-foreground">{removeMember?.full_name}</span> sai da equipe e perde o acesso.
              Sem histórico, a conta é <span className="font-medium text-destructive">excluída de vez</span>. Com histórico editorial, ela é desativada e o registro do que fez continua.
            </DialogDescription>
          </DialogHeader>
          <div className="flex min-w-0 flex-wrap justify-end border-t border-border pt-4 [&>*+*]:ml-2">
            <button type="button" onClick={() => setRemoveMember(null)} disabled={removing} className={botao.secundario}>
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleRemove}
              disabled={removing}
              className={juntar(botao.primario, "bg-destructive text-destructive-foreground hover:bg-destructive/90")}
            >
              {removing && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              {removing ? "Removendo..." : "Sim, remover"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
