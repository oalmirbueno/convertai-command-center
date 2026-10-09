import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Globe, Loader2, Power, RefreshCw } from "lucide-react";
import { chamarFuncao, textoDoErro } from "@/lib/mesa/api";
import { AjudaRecolhida, useEstadoDaTela, Carregando, botao, juntar } from "@/components/sistema";
import { SeletorDeCliente, nomeDoCliente, type ClienteDoAgente } from "@/components/admin/agente/SeletoresDoAgente";
import { supabase } from "@/integrations/supabase/client";

/**
 * Navegador remoto da Central (09/10/2026, lote C): um navegador de verdade,
 * fora do computador do dono, ao vivo aqui (Live View do provedor, com
 * controle humano). Um perfil por cliente (o login de um nunca aparece no do
 * outro). Senha não passa pelo painel: o dono entra no site dentro dele.
 * Sem a conta do provedor ligada, a tela diz isso e não finge sessão.
 */

type SessaoViva = { id: string; rodando: boolean; ao_vivo?: string | null; comandada_por?: string | null; paginas?: Array<{ titulo: string; url: string; ao_vivo?: string | null }> };
type AcaoRegistrada = { id: string; agente: string; acao: string; alvo: string | null; ok: boolean; url: string | null; titulo: string | null; erro: string | null; evidencia_url: string | null; criado_em: string };
type Conta = { projetos: Array<{ simultaneas: number; minutos_usados: number | null }>; abertas_agora: number };
const QUEM: Record<string, string> = { hermes: "Hermes", gestor: "Gestor", equipe: "equipe" };
const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

/** Clientes do painel (papel client, sem os apagados), para escolher o navegador quando a conversa não tem cliente. */
async function lerClientes(): Promise<ClienteDoAgente[]> {
  const { data: papeis } = await supabase.from("user_roles").select("user_id").eq("role", "client");
  const ids = ((papeis as { user_id: string }[] | null) || []).map((r) => r.user_id);
  if (!ids.length) return [];
  const { data } = await supabase.from("profiles").select("id, full_name, company_name, email").in("id", ids).is("deleted_at", null);
  return ((data as ClienteDoAgente[] | null) || []).sort((a, b) => nomeDoCliente(a).localeCompare(nomeDoCliente(b)));
}

export default function NavegadorRemoto({ cliente: daConversa }: { cliente: { id: string; nome: string } | null }) {
  const qc = useQueryClient();
  // A conversa sem cliente (visão geral) ainda abre o navegador: o dono escolhe o cliente aqui.
  const [escolhido, setEscolhido] = useEstadoDaTela<string>("execucao:central:navegador:cliente", "");
  const clientes = useQuery({ queryKey: ["navegador-remoto", "clientes"], enabled: !daConversa, staleTime: 10 * 60_000, queryFn: lerClientes });
  const doSeletor = !daConversa && escolhido ? (clientes.data || []).find((c) => c.id === escolhido) || null : null;
  const cliente = daConversa || (doSeletor ? { id: doSeletor.id, nome: nomeDoCliente(doSeletor) } : null);
  const seletor = !daConversa ? (
    <div className="shrink-0 px-2 pt-2">
      <SeletorDeCliente clientes={clientes.data || []} valor={escolhido || null} onEscolher={(id) => setEscolhido(id || "")} />
    </div>
  ) : null;
  const [sessaoId, setSessaoId] = useEstadoDaTela<string>(`execucao:central:navegador:${cliente?.id || "sem"}`, "");
  const [aba, setAba] = useState(0);
  const estado = useQuery({
    queryKey: ["navegador-remoto", "estado"],
    queryFn: () => chamarFuncao<{ configurado: boolean }>("navegador-remoto", { acao: "estado" }),
    staleTime: 5 * 60_000,
  });
  const sessao = useQuery({
    queryKey: ["navegador-remoto", "sessao", sessaoId],
    enabled: !!sessaoId && !!estado.data?.configurado,
    refetchInterval: 15_000,
    queryFn: async () => (await chamarFuncao<{ sessao: SessaoViva }>("navegador-remoto", { acao: "ver", sessao_id: sessaoId })).sessao,
  });
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
  const registro = (acoes.data || []).length ? (
    <details className="shrink-0 border-t border-border/60 px-2 py-1.5 text-[12px]" data-registro-do-navegador="">
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
    mutationFn: () => chamarFuncao<{ sessao: SessaoViva; reaproveitada: boolean }>("navegador-remoto", { acao: "abrir", cliente_id: cliente!.id, origem: "central" }),
    onSuccess: (r) => { setSessaoId(r.sessao.id); qc.setQueryData(["navegador-remoto", "sessao", r.sessao.id], r.sessao); },
    onError: (e) => toast.error(textoDoErro(e)),
  });
  const encerrar = useMutation({
    mutationFn: () => chamarFuncao("navegador-remoto", { acao: "encerrar", sessao_id: sessaoId }),
    onSuccess: () => { setSessaoId(""); toast.success("Navegador fechado. O login do cliente fica guardado para a próxima vez."); },
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
  // Abas de verdade do navegador remoto (link aberto em nova aba vira outra): cada uma tem a própria tela ao vivo.
  const paginas = (viva && viva.paginas) || [];
  const abaValida = aba < paginas.length ? aba : 0;
  const paginaAtual = paginas[abaValida] || null;
  const telaAoVivo = (paginaAtual && paginaAtual.ao_vivo) || (viva && viva.ao_vivo) || null;
  if (!viva) {
    return (
      <div className="flex flex-col">
      {seletor}
      <div className="flex flex-col items-start gap-2 p-3 text-[13px]">
        {sessaoId && sessao.data && !sessao.data.rodando && <p className="text-muted-foreground">A sessão anterior terminou. O login continua guardado.</p>}
        <button type="button" disabled={abrir.isPending} onClick={() => abrir.mutate()} className={juntar(botao.primario, "h-9 px-4 text-[13px]")}>
          {abrir.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Globe className="mr-1.5 h-4 w-4" />}Abrir o navegador de {cliente.nome}
        </button>
      </div>
      {registro}
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      {seletor}
      <div className="flex shrink-0 items-center gap-1 px-2 py-1.5 text-[12px] text-muted-foreground">
        <span className="h-2 w-2 shrink-0 rounded-full bg-success" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{paginaAtual?.titulo || paginaAtual?.url || "Navegador ao vivo"} · {cliente.nome}{viva.comandada_por ? ` · comandado por ${QUEM[viva.comandada_por] || viva.comandada_por}` : ""}</span>
        <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => void sessao.refetch()} aria-label="Atualizar" title="Atualizar"><RefreshCw className="h-3.5 w-3.5" /></button>
        <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => encerrar.mutate()} aria-label="Fechar o navegador" title="Fechar o navegador"><Power className="h-3.5 w-3.5" /></button>
      </div>
      {paginas.length > 1 && (
        <div className="flex shrink-0 gap-1 overflow-x-auto px-2 pb-1.5" role="tablist" aria-label={`Abas do navegador de ${cliente.nome}`}>
          {paginas.map((p, i) => (
            <button
              key={`${i}-${p.url}`}
              type="button"
              role="tab"
              aria-selected={i === abaValida}
              onClick={() => setAba(i)}
              title={p.url}
              className={juntar("max-w-[11rem] shrink-0 truncate rounded-md px-2 py-1 text-[11px]", i === abaValida ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted/50")}
            >
              {p.titulo || p.url || `Aba ${i + 1}`}
            </button>
          ))}
        </div>
      )}
      {telaAoVivo ? (
        <iframe
          key={telaAoVivo}
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
