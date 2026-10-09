import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Globe, Loader2, Power, RefreshCw } from "lucide-react";
import { chamarFuncao, textoDoErro } from "@/lib/mesa/api";
import { AjudaRecolhida, useEstadoDaTela, Carregando, botao, juntar } from "@/components/sistema";

/**
 * Navegador remoto da Central (09/10/2026, lote C): um navegador de verdade,
 * fora do computador do dono, ao vivo aqui (Live View do provedor, com
 * controle humano). Um perfil por cliente (o login de um nunca aparece no do
 * outro). Senha não passa pelo painel: o dono entra no site dentro dele.
 * Sem a conta do provedor ligada, a tela diz isso e não finge sessão.
 */

type SessaoViva = { id: string; rodando: boolean; ao_vivo?: string | null; paginas?: Array<{ titulo: string; url: string }> };

export default function NavegadorRemoto({ cliente }: { cliente: { id: string; nome: string } | null }) {
  const qc = useQueryClient();
  const [sessaoId, setSessaoId] = useEstadoDaTela<string>(`execucao:central:navegador:${cliente?.id || "sem"}`, "");
  const estado = useQuery({
    queryKey: ["navegador-remoto", "estado"],
    queryFn: () => chamarFuncao<{ configurado: boolean }>("navegador-remoto", { acao: "estado" }),
    staleTime: 5 * 60_000,
  });
  const sessao = useQuery({
    queryKey: ["navegador-remoto", "sessao", sessaoId],
    enabled: !!sessaoId && !!estado.data?.configurado,
    refetchInterval: 30_000,
    queryFn: async () => (await chamarFuncao<{ sessao: SessaoViva }>("navegador-remoto", { acao: "ver", sessao_id: sessaoId })).sessao,
  });
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
          <AjudaRecolhida rotulo="O que falta?">Falta a conta do provedor (Browserbase) e as chaves no servidor. Enquanto isso, nenhuma sessão é simulada.</AjudaRecolhida>
        </p>
      </div>
    );
  }
  if (!cliente) return <p className="p-3 text-[13px] text-muted-foreground">Abra uma conversa de cliente: cada cliente tem o próprio navegador (login separado).</p>;

  const viva = sessao.data && sessao.data.rodando ? sessao.data : null;
  if (!viva) {
    return (
      <div className="flex flex-col items-start gap-2 p-3 text-[13px]">
        {sessaoId && sessao.data && !sessao.data.rodando && <p className="text-muted-foreground">A sessão anterior terminou. O login continua guardado.</p>}
        <button type="button" disabled={abrir.isPending} onClick={() => abrir.mutate()} className={juntar(botao.primario, "h-9 px-4 text-[13px]")}>
          {abrir.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Globe className="mr-1.5 h-4 w-4" />}Abrir o navegador de {cliente.nome}
        </button>
      </div>
    );
  }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 px-2 py-1.5 text-[12px] text-muted-foreground">
        <span className="h-2 w-2 shrink-0 rounded-full bg-success" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{viva.paginas?.[0]?.titulo || viva.paginas?.[0]?.url || "Navegador ao vivo"} · {cliente.nome}</span>
        <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => void sessao.refetch()} aria-label="Atualizar" title="Atualizar"><RefreshCw className="h-3.5 w-3.5" /></button>
        <button type="button" className={juntar(botao.icone, "h-7 w-7")} onClick={() => encerrar.mutate()} aria-label="Fechar o navegador" title="Fechar o navegador"><Power className="h-3.5 w-3.5" /></button>
      </div>
      {viva.ao_vivo ? (
        <iframe
          src={viva.ao_vivo}
          title={`Navegador remoto de ${cliente.nome}`}
          className="block min-h-0 w-full flex-1 border-0 bg-background"
          sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
          allow="clipboard-read; clipboard-write"
          referrerPolicy="no-referrer"
        />
      ) : <p className="p-3 text-[12px] text-muted-foreground">A sessão está aberta, mas o provedor não devolveu a tela ao vivo agora.</p>}
    </div>
  );
}
