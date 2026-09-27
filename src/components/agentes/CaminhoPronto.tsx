import { useEffect, useRef } from "react";
import { useInRouterContext, useLocation, useNavigate } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { caminhoDosAnexos, caminhoSeguro, jaEstaAqui, type CaminhoDoAgente } from "@/lib/agentes/acoesDoAgente";
import { caminhoDaResposta } from "../../../supabase/functions/_shared/mapa-do-painel";

/**
 * O caminho tirado do próprio texto do agente, para quem responde em texto
 * corrido (o chat do Workspace): a primeira área do mapa que a resposta citou
 * vira o botão "Abrir <área>" com o cliente. Rota fora do mapa: nada.
 */
export function CaminhoDoTexto({ texto, clientId, className = "" }: { texto: string; clientId?: string | null; className?: string }) {
  const c = caminhoDaResposta(texto, clientId || null);
  if (!c) return null;
  return (
    <div className="mt-1.5 flex min-w-0 flex-wrap" data-caminho-do-texto="">
      <CaminhoPronto caminho={c} className={className} />
    </div>
  );
}

/**
 * O caminho guardado na mensagem do agente (anexo "caminho_do_agente"), para
 * resposta sem ação: "Isso é na Mesa Ads" vira o botão "Abrir Mesa Ads" já
 * com o cliente. `recente`: a mensagem acabou de chegar nesta tela; só então
 * o "abre pra mim" vai sozinho (reabrir a conversa não navega).
 */
export function CaminhoDaMensagem({ anexos, recente = false, className = "" }: { anexos: unknown; recente?: boolean; className?: string }) {
  const c = caminhoDosAnexos(anexos);
  if (!c) return null;
  return (
    <div className="mt-1.5 flex min-w-0 flex-wrap" data-caminho-da-mensagem="">
      <CaminhoPronto caminho={c} abrirSozinho={recente && c.abrir_sozinho === true} className={className} />
    </div>
  );
}

/**
 * O caminho que o agente deixa quando termina (pedido do dono, 27/09: "quando
 * termina ele dá o caminho pra mim apertar e ir e já fica tudo certinho"):
 * um botão "Ir para ..." que abre a área com o estado certo. Com
 * `abrirSozinho`, vai sozinho uma vez (pedido "faz e me leva"). Qualquer
 * agente usa: no CartaoDeAcao depois de feito, ou solto depois da resposta.
 */
export default function CaminhoPronto({ caminho, abrirSozinho = false, className = "" }: { caminho: CaminhoDoAgente | null | undefined; abrirSozinho?: boolean; className?: string }) {
  const c = caminhoSeguro(caminho);
  const noRoteador = useInRouterContext();
  return c ? <BotaoDoCaminho caminho={c} abrirSozinho={abrirSozinho} noRoteador={noRoteador} className={className} /> : null;
}

function BotaoDoCaminho({ caminho, abrirSozinho, noRoteador, className }: { caminho: CaminhoDoAgente; abrirSozinho: boolean; noRoteador: boolean; className: string }) {
  const ir = noRoteador ? <IrComRoteador caminho={caminho} abrirSozinho={abrirSozinho} className={className} /> : <IrSemRoteador caminho={caminho} abrirSozinho={abrirSozinho} className={className} />;
  return ir;
}

// Já está no endereço do caminho (ex.: o diretor ao lado do próprio item): sem botão, que seria só ruído.
function IrComRoteador(p: { caminho: CaminhoDoAgente; abrirSozinho: boolean; className: string }) {
  const navigate = useNavigate();
  const onde = useLocation();
  if (jaEstaAqui(p.caminho.destino, `${onde.pathname}${onde.search}`)) return null;
  return <Botao {...p} ir={() => navigate(p.caminho.destino)} />;
}

function IrSemRoteador(p: { caminho: CaminhoDoAgente; abrirSozinho: boolean; className: string }) {
  if (typeof window !== "undefined" && window.location && jaEstaAqui(p.caminho.destino, `${window.location.pathname}${window.location.search}`)) return null;
  return <Botao {...p} ir={() => window.location.assign(p.caminho.destino)} />;
}

/**
 * Destinos abertos sozinhos há pouco: a conversa relida do banco remonta a
 * mensagem, e o mesmo "abre pra mim" não pode navegar duas vezes.
 */
const ABERTOS_HA_POUCO: Record<string, number> = {};
const JANELA_DO_ABRIR_MS = 15_000;

function podeAbrirSozinho(destino: string): boolean {
  const agora = Date.now();
  const antes = ABERTOS_HA_POUCO[destino];
  if (antes && agora - antes < JANELA_DO_ABRIR_MS) return false;
  ABERTOS_HA_POUCO[destino] = agora;
  return true;
}

function Botao({ caminho, abrirSozinho, className, ir }: { caminho: CaminhoDoAgente; abrirSozinho: boolean; className: string; ir: () => void }) {
  const foi = useRef(false);
  useEffect(() => {
    if (abrirSozinho && !foi.current) {
      foi.current = true;
      if (podeAbrirSozinho(caminho.destino)) ir();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abrirSozinho, caminho.destino]);
  return (
    <Button type="button" size="sm" className={`mb-1 mr-1.5 h-8 ${className}`} onClick={ir} data-caminho-do-agente={caminho.destino}>
      {caminho.rotulo} <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
    </Button>
  );
}
