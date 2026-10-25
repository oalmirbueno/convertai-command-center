import { lazy, Suspense, useMemo } from "react";
import { MessagesSquare } from "lucide-react";
import { useMesa } from "@/components/mesa/MesaContexto";
import Secao from "@/components/sistema/Secao";
import { Carregando } from "@/components/sistema/Estados";
import { botao, espaco, juntar } from "@/components/sistema/estilos";
import { comAEdicaoDaPrevia, type LinhaDoSite, useTrabalhos } from "./siteApi";
import PreviaEditavel from "./PreviaEditavel";
import { useBarraDaEtapa } from "./BarraDaEtapa";

const EtapaPublicacao = lazy(() => import("./EtapaPublicacao"));

/** Pedidos prontos para o diretor de site (vão para o campo da conversa; enviar e confirmar continuam com a pessoa). */
export const PEDIDOS_DE_AJUSTE = [
  "Deixe a abertura mais forte, com a promessa do objetivo em destaque",
  "Use mais as fotos reais do cliente nas seções de prova",
  "Deixe o botão principal mais visível em todas as seções",
  "Revise o site no celular e corrija o que estiver apertado",
];

/**
 * Passo 5: ajustar conversando com a IA e publicar. A prévia fica ao centro;
 * cada pedido ao diretor de site (na lateral) vira um cartão com o custo,
 * Confirmar e Desfazer, como no resto da casa. Publicar mora aqui embaixo.
 */
export default function PassoAjustar({ site, onIrPara, onPedirAoDiretor }: { site: LinhaDoSite; onIrPara: (etapa: string) => void; onPedirAoDiretor?: (texto: string) => void }) {
  const { clientId } = useMesa();
  const trabalhosQ = useTrabalhos(clientId, site.id);
  const todos = useMemo(() => comAEdicaoDaPrevia(trabalhosQ.data), [trabalhosQ.data]);
  useBarraDaEtapa({ estado: "Peça ajustes ao diretor de site ou publique" });

  return (
    <div className={espaco.pagina} data-passo-ajustar="">
      {onPedirAoDiretor && (
        <Secao titulo="Ajustar conversando" descricao="Diretor de site ao lado" ajuda="Escreva o que mudar ao diretor de site (na lateral; no celular, no botão de baixo). Ele monta a lista com o custo; nada muda até você confirmar, e cada cartão tem Desfazer." recolher={`mesa-site:jornada:ajustar:${site.id}`}>
          <div className="flex min-w-0 flex-wrap items-center" data-pedidos-de-ajuste="">
            {PEDIDOS_DE_AJUSTE.map((p) => (
              <button key={p} type="button" className={juntar(botao.secundario, "mb-2 mr-2 h-8 max-w-full")} onClick={() => onPedirAoDiretor(p)} title="Levar para o diretor de site">
                <MessagesSquare className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="min-w-0 truncate">{p}</span>
              </button>
            ))}
          </div>
        </Secao>
      )}
      <PreviaEditavel site={site} trabalhos={todos} executor={trabalhosQ.data ? trabalhosQ.data.executor : null} onIrPara={onIrPara} />
      <Suspense fallback={<Carregando forma="lista" rotulo="Abrindo a publicação" />}>
        <EtapaPublicacao site={site} onPedirAoDiretor={onPedirAoDiretor} onIrPara={onIrPara} />
      </Suspense>
    </div>
  );
}
