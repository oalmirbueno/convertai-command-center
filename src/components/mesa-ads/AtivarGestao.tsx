import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, ChevronDown, KeyRound, Loader2, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { textoDoErro } from "@/lib/mesa/api";
import { META_OAUTH_MESSAGE_TYPE, startAdsOAuth, type MetaOAuthPopupMessage } from "@/lib/socialMetaOAuth";
import { tempoDesde } from "./adsApi";
import { chaveDaGestao, lerGestao, type SituacaoDaGestao } from "./acoesDoAgenteApi";

/**
 * "Ativar gestão de campanhas" (pedido do dono em 26/09: "deixar a função toda
 * preparada, porque só está em leitura. Para quando eu precisar, ele já fique
 * top"). Mostra a situação (conferência guardada, sem perguntar à Meta a cada
 * abertura), os 3 passos do lado da Meta, o login pedindo ads_management e a
 * conferência depois: "Gestão ativa" ou exatamente o que falta.
 * Usado na aba Conta da Mesa Ads (por cliente) e em /anuncios (carteira).
 */

export const PASSOS_DA_GESTAO = [
  "Na Meta for Developers, abra o app do painel, vá em Facebook Login for Business e edite a configuração usada pelo login. Marque a permissão ads_management (gerenciar anúncios) junto das que já estão lá.",
  "Em Revisão do app, peça acesso avançado a ads_management. Sem ele, a permissão só vale para quem tem papel no app.",
  "Volte aqui e clique em Conectar pedindo gestão. Entre com o perfil que administra as contas de anúncio e aceite a permissão nova. O painel confere na hora.",
];

const NOME_DO_ESCOPO: Record<string, string> = { ads_management: "ads_management (gerenciar anúncios)", ads_read: "ads_read (ler anúncios)" };

function Situacao({ g }: { g: SituacaoDaGestao }) {
  if (g.disponivel) {
    return (
      <span className="inline-flex items-center text-[12.5px] font-medium text-success">
        <CheckCircle2 className="mr-1 h-4 w-4" /> Gestão ativa
      </span>
    );
  }
  return (
    <span className="inline-flex items-center text-[12.5px] font-medium text-warning">
      <KeyRound className="mr-1 h-4 w-4" />
      {g.tem_token ? "Só leitura" : "Sem acesso de anúncios"}
    </span>
  );
}

export default function AtivarGestao({
  clientId,
  podeConectar,
  compacto = false,
  className = "",
}: {
  /** Nulo em /anuncios: o token da carteira. */
  clientId: string | null;
  /** Só admin inicia o login de anúncios (regra do banco em ads_oauth_create_session). */
  podeConectar: boolean;
  compacto?: boolean;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const [aberto, setAberto] = useState(!compacto);
  const [conferindo, setConferindo] = useState(false);
  const [conectando, setConectando] = useState(false);
  const esperando = useRef(false);
  const chave = chaveDaGestao(clientId);
  const gestao = useQuery({ queryKey: chave, queryFn: () => lerGestao(clientId), staleTime: 5 * 60_000, retry: false });
  const g = gestao.data || null;

  const conferir = async (depoisDoLogin = false) => {
    setConferindo(true);
    try {
      const nova = await lerGestao(clientId, true);
      queryClient.setQueryData(chave, nova);
      if (nova && nova.disponivel) toast.success("Gestão ativa", { description: "O agente já pode fazer as ações na conta, sempre com a sua confirmação." });
      else if (depoisDoLogin && nova) toast.warning("A Meta não liberou a gestão", { description: nova.faltam.length ? `Falta: ${nova.faltam.join(", ")}. Veja os passos.` : nova.motivo || "Veja os passos." });
    } catch (e) {
      toast.error("Não foi possível conferir", { description: textoDoErro(e) });
    } finally {
      setConferindo(false);
    }
  };

  // O popup do login avisa por mensagem quando termina: confere as permissões na hora.
  useEffect(() => {
    const aoReceber = (evento: MessageEvent) => {
      if (evento.origin !== window.location.origin || !esperando.current) return;
      const msg = evento.data as MetaOAuthPopupMessage | undefined;
      if (!msg || msg.type !== META_OAUTH_MESSAGE_TYPE) return;
      esperando.current = false;
      setConectando(false);
      if (msg.ok === false) {
        toast.error(msg.error);
        return;
      }
      void conferir(true);
    };
    window.addEventListener("message", aoReceber);
    return () => window.removeEventListener("message", aoReceber);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const conectar = async () => {
    const janela = window.open("about:blank", "aceleriq-meta-ads-gestao", "popup=yes,width=620,height=760,resizable=yes,scrollbars=yes");
    if (!janela) {
      toast.error("Autorize pop-ups para conectar com a Meta.");
      return;
    }
    setConectando(true);
    try {
      const { authorization_url } = await startAdsOAuth({ gestao: true });
      esperando.current = true;
      janela.location.replace(authorization_url);
      janela.focus();
    } catch (e) {
      janela.close();
      setConectando(false);
      toast.error("Não foi possível abrir a Meta", { description: textoDoErro(e) });
    }
  };

  const ativa = !!(g && g.disponivel);
  return (
    <section className={`min-w-0 rounded-xl border border-border bg-card px-4 py-3 ${className}`} aria-label="Gestão de campanhas">
      <div className="flex min-w-0 flex-wrap items-center">
        <button type="button" className="mb-1 mr-3 flex min-w-0 flex-1 items-center text-left" onClick={() => setAberto(!aberto)} aria-expanded={aberto}>
          <span className="min-w-0">
            <span className="block text-[13px] font-semibold">Gestão de campanhas pelo agente</span>
            <span className="mt-0.5 flex min-w-0 flex-wrap items-center text-[11.5px] text-muted-foreground">
              {gestao.isLoading ? <span className="h-3 w-40 animate-pulse rounded bg-muted" /> : g ? <Situacao g={g} /> : <span>Situação não lida</span>}
              {g && g.conferido_em && <span className="ml-2">conferido {tempoDesde(g.conferido_em)}</span>}
            </span>
          </span>
          {!ativa && <ChevronDown className={`ml-2 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${aberto ? "rotate-180" : ""}`} />}
        </button>
        <Button type="button" size="sm" variant="ghost" className="mb-1 h-8 text-[12px]" disabled={conferindo} onClick={() => void conferir()} title="Pergunta à Meta agora quais permissões o acesso tem">
          {conferindo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />}
          Conferir agora
        </Button>
      </div>

      {!ativa && aberto && (
        <div className="mt-2 min-w-0 space-y-2 text-[12.5px] leading-snug">
          <p className="text-muted-foreground [overflow-wrap:anywhere]">
            {g && g.motivo ? g.motivo : "Hoje o acesso é só de leitura."} Enquanto isso, o agente trabalha em modo ensaio: propõe as ações e mostra como seria, sem mexer na conta.
          </p>
          {g && g.faltam.length > 0 && (
            <p className="[overflow-wrap:anywhere]">
              <span className="font-medium">Falta:</span> {g.faltam.map((f) => NOME_DO_ESCOPO[f] || f).join(", ")}.
            </p>
          )}
          <ol className="ml-4 list-decimal space-y-1">
            {PASSOS_DA_GESTAO.map((p, k) => (
              <li key={k} className="[overflow-wrap:anywhere]">{p}</li>
            ))}
          </ol>
          <div className="flex min-w-0 flex-wrap items-center">
            {podeConectar ? (
              <Button type="button" size="sm" className="mb-1 mr-3 h-8" disabled={conectando} onClick={() => void conectar()}>
                {conectando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <KeyRound className="mr-1.5 h-3.5 w-3.5" />}
                Conectar pedindo gestão
              </Button>
            ) : (
              <span className="mb-1 mr-3 font-medium">Peça a um admin para conectar pedindo gestão.</span>
            )}
            <span className="mb-1 min-w-0 flex-1 text-[11.5px] text-muted-foreground">
              O painel pede ads_management no login. Se a configuração do Login for Business não tiver a permissão, a Meta não mostra o pedido; depois do login, o painel confere e diz o que faltou.
            </span>
          </div>
          {g && !g.guardada && <p className="text-[11px] text-muted-foreground">A conferência ainda não fica guardada no banco (SQL pendente): o painel confere de novo a cada 10 minutos.</p>}
        </div>
      )}
    </section>
  );
}
