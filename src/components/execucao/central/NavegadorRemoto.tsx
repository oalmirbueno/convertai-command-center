import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Globe, KeyRound, Loader2, Maximize2, Minimize2, Plus, Power, RefreshCw, Users, X } from "lucide-react";
import { chamarFuncao, textoDoErro } from "@/lib/mesa/api";
import { AjudaRecolhida, useEstadoDaTela, Carregando, botao, juntar } from "@/components/sistema";
import { nomeDoCliente, type ClienteDoAgente } from "@/components/admin/agente/SeletoresDoAgente";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

/**
 * Navegador remoto da Central (09/10/2026, lote C): um navegador de verdade,
 * fora do computador do dono, ao vivo aqui (Live View do provedor, com
 * controle humano). Um perfil por cliente (o login de um nunca aparece no do
 * outro). Senha não passa pelo painel: o dono entra no site dentro dele.
 * Sem a conta do provedor ligada, a tela diz isso e não finge sessão.
 */

type Pagina = { id?: string; titulo: string; url: string; ao_vivo?: string | null };
type SessaoViva = { id: string; rodando: boolean; ao_vivo?: string | null; comandada_por?: string | null; paginas?: Pagina[] };
type ResultadoDaAcao = { resultado: { sessao_id: string; aba_id?: string } };
type AcaoRegistrada = { id: string; agente: string; acao: string; alvo: string | null; ok: boolean; url: string | null; titulo: string | null; erro: string | null; evidencia_url: string | null; criado_em: string };
type Conta = { projetos: Array<{ simultaneas: number; minutos_usados: number | null }>; abertas_agora: number };
const QUEM: Record<string, string> = { hermes: "Hermes", gestor: "Gestor", equipe: "equipe" };
/**
 * 15/10 (dono: "as letras estão muito pequenas"): a tela remota nasce do tamanho do quadro ampliado
 * (a janela menos a margem e as barras de cima e de baixo), para a letra ficar perto do tamanho real.
 */
const telaDoQuadroAmpliado = () => typeof window === "undefined" ? null : { largura: Math.round(window.innerWidth - 32), altura: Math.round(window.innerHeight - 32 - 104) };
const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

// Reutiliza o cofre já autorizado do OS. A senha é vista/copiada somente pela
// pessoa autenticada; nunca é enviada ao MCP, iframe, logs ou agente.
const ClientVault = lazy(() => import("@/components/vault/ClientVault"));
function CofreRapido({ cliente }: { cliente: { id: string; nome: string } }) {
  const [aberto, setAberto] = useState(false);
  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger asChild>
        <button type="button" className={juntar(botao.secundario, "h-7 shrink-0 gap-1 px-2 text-[11px]")} aria-label={`Abrir cofre de ${cliente.nome}`}>
          <KeyRound className="h-3.5 w-3.5" /> Cofre
        </button>
      </DialogTrigger>
      <DialogContent className="z-[70] flex max-h-[86vh] w-[min(96vw,36rem)] flex-col gap-0 p-0">
        <DialogHeader className="shrink-0 border-b border-border px-4 py-3 text-left">
          <DialogTitle>Acessos de {cliente.nome}</DialogTitle>
          <DialogDescription>Cadastre ou copie o acesso para preencher diretamente na sessão remota. Nunca compartilhe senhas no chat do agente.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {aberto && <Suspense fallback={<Carregando linhas={2} rotulo="Abrindo cofre" />}><ClientVault clientId={cliente.id} canManage /></Suspense>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Clientes do painel (papel client, sem os apagados), para escolher o navegador quando a conversa não tem cliente. */
async function lerClientes(): Promise<ClienteDoAgente[]> {
  const { data: papeis } = await supabase.from("user_roles").select("user_id").eq("role", "client");
  const ids = ((papeis as { user_id: string }[] | null) || []).map((r) => r.user_id);
  if (!ids.length) return [];
  const { data } = await supabase.from("profiles").select("id, full_name, company_name, email").in("id", ids).is("deleted_at", null);
  return ((data as ClienteDoAgente[] | null) || []).sort((a, b) => nomeDoCliente(a).localeCompare(nomeDoCliente(b)));
}

export default function NavegadorRemoto({ cliente: daConversa, podeGerirCofre = false }: { cliente: { id: string; nome: string } | null; podeGerirCofre?: boolean }) {
  const qc = useQueryClient();
  // A conversa sem cliente (visão geral) ainda abre o navegador: o dono escolhe o cliente aqui.
  const [escolhido, setEscolhido] = useEstadoDaTela<string>("execucao:central:navegador:cliente", "");
  const clientes = useQuery({ queryKey: ["navegador-remoto", "clientes"], enabled: !daConversa, staleTime: 10 * 60_000, queryFn: lerClientes });
  const doSeletor = !daConversa && escolhido ? (clientes.data || []).find((c) => c.id === escolhido) || null : null;
  const cliente = daConversa || (doSeletor ? { id: doSeletor.id, nome: nomeDoCliente(doSeletor) } : null);
  const [ampliado, setAmpliado] = useState(false);
  const seletor = !daConversa && !ampliado ? (
    // 15/10 (dono: "seletor de cliente bem minimalista, que não polui"): uma linha só, sem caixa.
    <div className="flex shrink-0 items-center gap-1.5 px-3 pt-2 text-[12px] text-muted-foreground">
      <Users className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <select
        value={escolhido}
        onChange={(e) => setEscolhido(e.target.value)}
        aria-label="Cliente do navegador"
        className="h-7 min-w-0 max-w-[240px] cursor-pointer truncate rounded-md bg-transparent px-1 text-[12px] text-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        <option value="">Escolher cliente</option>
        {(clientes.data || []).map((c) => <option key={c.id} value={c.id}>{nomeDoCliente(c)}</option>)}
      </select>
    </div>
  ) : null;
  const [sessaoId, setSessaoId] = useEstadoDaTela<string>(`execucao:central:navegador:${cliente?.id || "sem"}`, "");
  const [abaId, setAbaId] = useEstadoDaTela<string>(`execucao:central:navegador:aba:${cliente?.id || "sem"}:${sessaoId}`, "");
  const [novaAbaAberta, setNovaAbaAberta] = useState(false);
  const [enderecoNovaAba, setEnderecoNovaAba] = useState("");
  const [telaFixada, setTelaFixada] = useState<{ chave: string; url: string } | null>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const quadroAtual = useRef("");
  const contextoAtual = useRef({ clienteId: cliente?.id, sessaoId });
  contextoAtual.current = { clienteId: cliente?.id, sessaoId };
  useEffect(() => {
    if (!ampliado) return;
    const anterior = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const inertes: Array<{ el: HTMLElement; antes: boolean }> = [];
    for (let no: HTMLElement | null = raiz.current; no?.parentElement; no = no.parentElement) {
      for (const irmao of no.parentElement.children) {
        if (irmao !== no && irmao instanceof HTMLElement) {
          inertes.push({ el: irmao, antes: irmao.inert });
          irmao.inert = true;
        }
      }
    }
    raiz.current?.focus();
    const manterFoco = (e: FocusEvent) => {
      // O Cofre usa seu próprio Dialog em portal; ele assume o foco enquanto aberto.
      if (!raiz.current?.contains(e.target as Node) && !document.querySelector('[role="dialog"][data-state="open"]')) raiz.current?.focus();
    };
    document.addEventListener("focusin", manterFoco);
    return () => {
      document.removeEventListener("focusin", manterFoco);
      document.body.style.overflow = overflow;
      for (const { el, antes } of inertes) el.inert = antes;
      anterior?.focus();
    };
  }, [ampliado, cliente?.id]);
  const estado = useQuery({
    queryKey: ["navegador-remoto", "estado"],
    queryFn: () => chamarFuncao<{ configurado: boolean }>("navegador-remoto", { acao: "estado" }),
    staleTime: 5 * 60_000,
  });
  const sessao = useQuery({
    queryKey: ["navegador-remoto", "sessao", cliente?.id, sessaoId],
    enabled: !!sessaoId && !!estado.data?.configurado,
    // 15/10: a cada 3 s, para o pop-up de login ("Continuar com Facebook") aparecer logo. A consulta
    // também diz ao zelador que alguém está usando a sessão (senão ele fecha no meio do login).
    refetchInterval: (q) => (q.state.data && !q.state.data.rodando ? false : 3_000),
    queryFn: async () => (await chamarFuncao<{ sessao: SessaoViva }>("navegador-remoto", { acao: "ver", sessao_id: sessaoId })).sessao,
  });
  useEffect(() => {
    setAmpliado(false);
    setNovaAbaAberta(false);
    setEnderecoNovaAba("");
  }, [cliente?.id]);
  useEffect(() => { if (!sessao.data?.rodando) setAmpliado(false); }, [sessao.data?.rodando]);
  // O que Hermes, Gestor e a equipe fizeram neste navegador (com a captura de tela de cada ação).
  const acoes = useQuery({
    queryKey: ["navegador-remoto", "acoes", cliente?.id || ""],
    enabled: !!cliente && !!estado.data?.configurado,
    refetchInterval: 15_000,
    queryFn: async () => (await chamarFuncao<{ acoes?: AcaoRegistrada[] }>("navegador-remoto", { acao: "acoes", cliente_id: cliente!.id, limite: 8 })).acoes || [],
  });
  const conta = useQuery({
    queryKey: ["navegador-remoto", "conta"],
    enabled: !!estado.data?.configurado,
    staleTime: 5 * 60_000,
    queryFn: () => chamarFuncao<Conta>("navegador-remoto", { acao: "conta" }),
  });
  const uso = conta.data && Array.isArray(conta.data.projetos) && conta.data.projetos[0] ? `${conta.data.projetos[0].minutos_usados ?? 0} min usados · ${conta.data.abertas_agora}/${conta.data.projetos[0].simultaneas} sessões abertas` : null;
  // O provedor pode devolver uma URL de debugger diferente em cada consulta
  // (polling a cada 15s). A URL do iframe deve permanecer fixada enquanto
  // estivermos na mesma sessão/aba, senão o navegador parece reiniciar.
  const paginas = sessao.data?.rodando ? sessao.data.paginas || [] : [];
  const indiceDoId = paginas.findIndex((p) => p.id === abaId);
  const abaValida = indiceDoId >= 0 ? indiceDoId : 0;
  const paginaSelecionada = paginas[abaValida];
  const chaveDoQuadro = `${cliente?.id || "sem"}:${sessaoId}:${paginaSelecionada?.id || "sessao"}`;
  quadroAtual.current = chaveDoQuadro;
  // 15/10 (dono: "não entra e reinicia"): sem aba escolhida, a tela seguia a primeira da lista, e a
  // ordem muda quando o site abre ou foca outra aba; a tela trocava sozinha no meio do login. A aba
  // exibida fica fixada até o dono escolher outra. 15/10, depois ("tem que abrir o pop-up"): aba que
  // nasce sozinha (pop-up de login) passa a ser a exibida; quando ela fecha, volta a de antes.
  const vistas = useRef<{ sessao: string; ids: Set<string>; pilha: string[] } | null>(null);
  const idsDasPaginas = paginas.map((p) => p.id).filter((x): x is string => !!x);
  const chaveDosIds = idsDasPaginas.join(",");
  useEffect(() => {
    if (!sessaoId || !idsDasPaginas.length) return;
    let v = vistas.current;
    if (!v || v.sessao !== sessaoId) v = vistas.current = { sessao: sessaoId, ids: new Set(idsDasPaginas), pilha: [] };
    const novas = idsDasPaginas.filter((id) => !v!.ids.has(id));
    idsDasPaginas.forEach((id) => v!.ids.add(id));
    if (novas.length) {
      if (abaId && idsDasPaginas.includes(abaId)) v.pilha.push(abaId);
      setAbaId(novas[novas.length - 1]);
      return;
    }
    if (abaId && idsDasPaginas.includes(abaId)) return;
    while (v.pilha.length) {
      const anterior = v.pilha.pop()!;
      if (idsDasPaginas.includes(anterior)) { setAbaId(anterior); return; }
    }
    if (paginaSelecionada?.id) setAbaId(paginaSelecionada.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessaoId, chaveDosIds, abaId]);
  const candidatoAoVivo = paginas[abaValida]?.ao_vivo || sessao.data?.ao_vivo || null;
  useEffect(() => {
    if (!sessao.data?.rodando || !candidatoAoVivo) return;
    setTelaFixada((anterior) => anterior?.chave === chaveDoQuadro ? anterior : { chave: chaveDoQuadro, url: candidatoAoVivo });
  }, [sessao.data?.rodando, chaveDoQuadro, candidatoAoVivo]);
  const telaAoVivo = telaFixada?.chave === chaveDoQuadro ? telaFixada.url : null;

  const ativarAba = useMutation({
    mutationFn: (alvo: { clienteId: string; sessaoId: string; abaId: string }) => chamarFuncao<ResultadoDaAcao>("navegador-remoto", { acao: "agir", cliente_id: alvo.clienteId, sessao_id: alvo.sessaoId, acao_do_navegador: "ativar_aba", aba_id: alvo.abaId, pedido: "Selecionar aba existente no navegador remoto" }),
    onSuccess: (r, alvo) => {
      if (contextoAtual.current.clienteId !== alvo.clienteId || contextoAtual.current.sessaoId !== alvo.sessaoId) return;
      if (r.resultado.sessao_id !== alvo.sessaoId) { toast.error("A sessão mudou. Reabra o navegador do cliente."); return; }
      setAbaId(alvo.abaId);
      void sessao.refetch();
    },
    onError: (e) => toast.error(textoDoErro(e)),
  });
  const criarAba = useMutation({
    mutationFn: (alvo: { clienteId: string; sessaoId: string; url: string }) => chamarFuncao<ResultadoDaAcao>("navegador-remoto", { acao: "agir", cliente_id: alvo.clienteId, sessao_id: alvo.sessaoId, acao_do_navegador: "nova_aba", url: alvo.url, pedido: "Abrir outra aba no mesmo perfil persistente do cliente" }),
    onSuccess: (r, alvo) => {
      if (contextoAtual.current.clienteId !== alvo.clienteId || contextoAtual.current.sessaoId !== alvo.sessaoId) return;
      if (r.resultado.sessao_id !== alvo.sessaoId) { toast.error("A sessão mudou. Reabra o navegador do cliente."); return; }
      setNovaAbaAberta(false);
      setEnderecoNovaAba("");
      if (r.resultado.aba_id) setAbaId(r.resultado.aba_id);
      void sessao.refetch();
    },
    onError: (e) => toast.error(textoDoErro(e)),
  });
  const fecharAba = useMutation({
    mutationFn: (alvo: { clienteId: string; sessaoId: string; abaId: string }) => chamarFuncao<ResultadoDaAcao>("navegador-remoto", { acao: "agir", cliente_id: alvo.clienteId, sessao_id: alvo.sessaoId, acao_do_navegador: "fechar_aba", aba_id: alvo.abaId, pedido: "Fechar aba sobrando no navegador remoto" }),
    onSuccess: (_r, alvo) => {
      if (contextoAtual.current.clienteId !== alvo.clienteId || contextoAtual.current.sessaoId !== alvo.sessaoId) return;
      void sessao.refetch();
    },
    onError: (e) => toast.error(textoDoErro(e)),
  });
  const registro = (acoes.data || []).length ? (
    <details className="shrink-0 border-t border-border/60 px-2 py-1.5 text-[13px]" data-registro-do-navegador="">
      <summary className="cursor-pointer text-muted-foreground">Ações registradas ({(acoes.data || []).length}){uso ? ` · ${uso}` : ""}</summary>
      <ul className="mt-1 max-h-40 space-y-1 overflow-y-auto">
        {(acoes.data || []).map((a) => (
          <li key={a.id} className="flex min-w-0 items-center gap-1.5">
            <span className={juntar("h-1.5 w-1.5 shrink-0 rounded-full", a.ok ? "bg-success" : "bg-destructive")} aria-hidden="true" />
            <span className="shrink-0 text-muted-foreground">{hora(a.criado_em)}</span>
            <span className="shrink-0 font-medium">{QUEM[a.agente] || a.agente}</span>
            <span className="min-w-0 flex-1 truncate" title={a.erro || a.url || ""}>{a.acao}{a.titulo || a.alvo ? `: ${a.titulo || a.alvo}` : ""}{a.erro ? ` (${a.erro})` : ""}</span>
            {a.evidencia_url && <a href={a.evidencia_url} target="_blank" rel="noreferrer noopener" className="shrink-0 text-primary underline-offset-2 hover:underline">captura</a>}
          </li>
        ))}
      </ul>
    </details>
  ) : null;
  const abrir = useMutation({
    mutationFn: (clienteId: string) => chamarFuncao<{ sessao: SessaoViva; reaproveitada: boolean }>("navegador-remoto", { acao: "abrir", cliente_id: clienteId, origem: "central", tela: telaDoQuadroAmpliado() }),
    onSuccess: (r, clienteId) => {
      if (contextoAtual.current.clienteId !== clienteId) return;
      qc.setQueryData(["navegador-remoto", "sessao", clienteId, r.sessao.id], r.sessao);
      setSessaoId(r.sessao.id);
    },
    onError: (e) => toast.error(textoDoErro(e)),
  });
  const encerrar = useMutation({
    mutationFn: (alvo: { clienteId: string; sessaoId: string }) => chamarFuncao("navegador-remoto", { acao: "encerrar", sessao_id: alvo.sessaoId }),
    onSuccess: (_r, alvo) => {
      if (contextoAtual.current.clienteId !== alvo.clienteId || contextoAtual.current.sessaoId !== alvo.sessaoId) return;
      setSessaoId(""); setAmpliado(false);
      toast.success("Navegador fechado. O login do cliente fica guardado para a próxima vez.");
    },
    onError: (e) => toast.error(textoDoErro(e)),
  });

  if (estado.isLoading) return <Carregando linhas={3} rotulo="Conferindo o navegador remoto" />;
  if (!estado.data?.configurado) {
    return (
      <div className="space-y-2 p-3 text-[13px]">
        <p className="flex items-center gap-1.5 font-medium">O navegador remoto ainda não está ligado.
          <AjudaRecolhida rotulo="O que falta?">Falta a conta do provedor (Browserbase) e a chave dela no servidor. Enquanto isso, nenhuma sessão é simulada.</AjudaRecolhida>
        </p>
      </div>
    );
  }
  if (!cliente) return <div className="flex flex-col">{seletor}<p className="p-3 text-[13px] text-muted-foreground">Escolha o cliente acima (ou abra uma conversa de cliente): cada cliente tem o próprio navegador (login separado).</p></div>;

  const viva = sessao.data && sessao.data.rodando ? sessao.data : null;
  const paginaAtual = paginas[abaValida] || null;
  if (!viva) {
    return (
      <div className="flex flex-col">
      {seletor}
      <div className="flex flex-col items-start gap-2 p-3 text-[13px]">
        {podeGerirCofre && <CofreRapido key={cliente.id} cliente={cliente} />}
        {sessaoId && sessao.data && !sessao.data.rodando && <p className="text-muted-foreground">A sessão anterior terminou. O login continua guardado.</p>}
        <button type="button" disabled={abrir.isPending} onClick={() => abrir.mutate(cliente.id)} className={juntar(botao.primario, "h-9 px-4 text-[13px]")}>
          {abrir.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Globe className="mr-1.5 h-4 w-4" />}Abrir o navegador de {cliente.nome}
        </button>
      </div>
      {registro}
      </div>
    );
  }
  return (
    <div
      ref={raiz}
      className={juntar("flex min-h-0 flex-col bg-background", ampliado ? "fixed inset-2 z-[60] rounded-lg border border-border shadow-2xl sm:inset-4" : "h-full")}
      role={ampliado ? "dialog" : undefined}
      aria-modal={ampliado || undefined}
      aria-label={ampliado ? `Navegador de ${cliente.nome} ampliado` : undefined}
      tabIndex={ampliado ? -1 : undefined}
      onKeyDown={(e) => {
        if (!ampliado || e.defaultPrevented || !raiz.current?.contains(e.target as Node)) return;
        if (e.key === "Escape") { e.preventDefault(); setAmpliado(false); }
        if (e.key === "Tab") {
          const itens = [...raiz.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), a[href], iframe, [tabindex="0"]')];
          const primeiro = itens[0], ultimo = itens[itens.length - 1];
          if (e.shiftKey && (document.activeElement === primeiro || document.activeElement === raiz.current)) { e.preventDefault(); ultimo?.focus(); }
          else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primeiro?.focus(); }
        }
      }}
    >
      {seletor}
      <div className="flex shrink-0 items-center gap-1 px-2 py-1.5 text-[13px] text-muted-foreground">
        <span className="h-2 w-2 shrink-0 rounded-full bg-success" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{paginaAtual?.titulo || paginaAtual?.url || "Navegador ao vivo"} · {cliente.nome}{viva.comandada_por ? ` · comandado por ${QUEM[viva.comandada_por] || viva.comandada_por}` : ""}</span>
        {podeGerirCofre && <CofreRapido key={cliente.id} cliente={cliente} />}
        {/* 15/10 (dono: "fica ruim de voltar"): o botão diz o que faz; Esc também volta. */}
        <button type="button" className={juntar(botao.secundario, "h-7 shrink-0 gap-1 px-2 text-[12px]")} onClick={() => setAmpliado((v) => !v)} aria-label={ampliado ? "Reduzir navegador remoto" : "Ampliar navegador remoto"} title={ampliado ? "Voltar ao tamanho normal (Esc)" : "Ampliar para ler e usar"}>{ampliado ? <><Minimize2 className="h-3.5 w-3.5" /> Voltar</> : <><Maximize2 className="h-3.5 w-3.5" /> Ampliar</>}</button>
        <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => void sessao.refetch().then((r) => {
          if (contextoAtual.current.clienteId !== cliente.id || contextoAtual.current.sessaoId !== sessaoId || quadroAtual.current !== chaveDoQuadro) return;
          const pagina = paginaSelecionada?.id ? r.data?.paginas?.find((p) => p.id === paginaSelecionada.id) : r.data?.paginas?.[0];
          const url = pagina?.ao_vivo || r.data?.ao_vivo;
          if (url) setTelaFixada({ chave: chaveDoQuadro, url });
        })} aria-label="Atualizar visualização" title="Atualizar visualização"><RefreshCw className="h-3.5 w-3.5" /></button>
        <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => encerrar.mutate({ clienteId: cliente.id, sessaoId })} aria-label="Fechar o navegador" title="Fechar o navegador"><Power className="h-3.5 w-3.5" /></button>
      </div>
      {paginas.length > 0 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto px-2 pb-1.5" role="tablist" aria-label={`Abas do navegador de ${cliente.nome}`}>
          {paginas.map((p, i) => (
            <div key={p.id || `legado-${i}`} className={juntar("flex max-w-[14rem] shrink-0 items-center rounded-md", i === abaValida ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50")}>
              <button
                type="button"
                role="tab"
                aria-selected={i === abaValida}
                onClick={() => p.id && ativarAba.mutate({ clienteId: cliente.id, sessaoId, abaId: p.id })}
                disabled={!p.id || ativarAba.isPending || criarAba.isPending}
                title={p.url}
                className="min-w-0 truncate px-2 py-1 text-[12px]"
              >
                {p.titulo || p.url || `Aba ${i + 1}`}
              </button>
              {paginas.length > 1 && p.id && (
                <button type="button" className="mr-1 shrink-0 rounded p-0.5 opacity-60 hover:bg-background/60 hover:opacity-100" aria-label={`Fechar a aba ${p.titulo || p.url || i + 1}`} title="Fechar esta aba" disabled={fecharAba.isPending} onClick={() => fecharAba.mutate({ clienteId: cliente.id, sessaoId, abaId: p.id! })}>
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          ))}
          <button type="button" className={juntar(botao.icone, "h-7 w-7 shrink-0")} aria-label="Nova aba" title="Nova aba" onClick={() => setNovaAbaAberta((v) => !v)}><Plus className="h-4 w-4" /></button>
        </div>
      )}
      {novaAbaAberta && (
        <form className="flex shrink-0 gap-2 px-2 pb-2" onSubmit={(e) => { e.preventDefault(); if (enderecoNovaAba.trim()) criarAba.mutate({ clienteId: cliente.id, sessaoId, url: enderecoNovaAba.trim() }); }}>
          <input type="url" required value={enderecoNovaAba} onChange={(e) => setEnderecoNovaAba(e.target.value)} placeholder="https://..." aria-label="Endereço da nova aba" className="h-8 min-w-0 flex-1 rounded-md border border-input bg-background px-2 text-[13px]" />
          <button type="submit" disabled={criarAba.isPending} className={juntar(botao.primario, "h-8 shrink-0 px-3 text-[13px]")}>{criarAba.isPending ? "Abrindo" : "Abrir"}</button>
        </form>
      )}
      {telaAoVivo ? (
        <iframe
          key={chaveDoQuadro}
          src={telaAoVivo}
          title={`Navegador remoto de ${cliente.nome}`}
          className="block min-h-0 w-full flex-1 border-0 bg-background"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          allow="clipboard-read; clipboard-write"
          referrerPolicy="no-referrer"
        />
      ) : <p className="p-3 text-[12px] text-muted-foreground">A sessão está aberta, mas o provedor não devolveu a tela ao vivo agora.</p>}
      {registro}
    </div>
  );
}
