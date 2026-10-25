import { useState, type ComponentType } from "react";
import { BriefcaseBusiness, Building2, CalendarCheck, Link2, Loader2, Magnet, ShoppingBag, Ticket, UtensilsCrossed } from "lucide-react";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { espaco, juntar, texto } from "@/components/sistema/estilos";
import { OBJETIVOS_DO_SITE } from "../../../supabase/functions/mesa-site/modulos/jornada-do-site";
import { type LinhaDoSite, useSalvarSite } from "./siteApi";
import { jornadaDoSite } from "./jornadaApi";
import { useBarraDaEtapa } from "./BarraDaEtapa";

export const ICONE_DO_OBJETIVO: Record<string, ComponentType<{ className?: string }>> = {
  captar: Magnet,
  vender: ShoppingBag,
  agendar: CalendarCheck,
  marca: Building2,
  portfolio: BriefcaseBusiness,
  evento: Ticket,
  cardapio: UtensilsCrossed,
  bio: Link2,
};

/**
 * Grade das opções dos passos (objetivo e partida), 25/10: a mesma em todos, na largura das mesas
 * (1, 2, 3 e 4 colunas), para o cartão ter o mesmo tamanho de um passo para o outro.
 */
export const gradeDeOpcoes = "grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 desk:grid-cols-4";

/** Opção em grade (item que é uma coisa): borda fina, a escolhida com a cor da marca. */
export const opcaoDaGrade = (escolhida: boolean) =>
  juntar(
    "toque-compacto flex w-full min-w-0 items-center rounded-md border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
    escolhida ? "border-primary bg-primary/5" : "border-border hover:bg-muted",
  );

/**
 * Passo 1 da jornada: o objetivo do site. Escolher já grava (o tipo e o mapa
 * do objetivo entram enquanto nada foi construído) e segue para a partida.
 */
export default function PassoObjetivo({ site, onIrPara }: { site: LinhaDoSite; onIrPara: (etapa: string) => void }) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  const salvar = useSalvarSite(clientId, marca ? marca.id : null);
  const avisarErro = useAvisarErro();
  const atual = jornadaDoSite(site).objetivo;
  const [gravando, setGravando] = useState<string | null>(null);

  useBarraDaEtapa({ estado: atual ? (OBJETIVOS_DO_SITE.find((o) => o.id === atual) || { rotulo: atual }).rotulo : null, motivo: atual ? null : "Escolha o objetivo do site", ocupado: !!gravando });

  const escolher = async (id: string) => {
    if (gravando) return;
    setGravando(id);
    try {
      await salvar("jornada_salvar", { site_id: site.id, objetivo: id });
      onIrPara("partida");
    } catch (e) {
      avisarErro(e, "O objetivo não foi salvo");
    } finally {
      setGravando(null);
    }
  };

  return (
    <div className={espaco.pagina} data-passo-objetivo="">
      <Secao
        titulo="Qual o objetivo do site?"
        descricao={atual ? "Escolhido" : "Um clique e segue"}
        ajuda="O objetivo define o tipo de site, o mapa de seções que converte para ele (gancho, dor, oferta, prova, objeções e chamada) e o próximo passo do visitante. Marca, contexto, contatos e copy aprovada vêm do cliente sozinhos. Com seção já construída, o mapa fica como está."
        recolher={false}
      >
        <ul className={gradeDeOpcoes} data-objetivos="">
          {OBJETIVOS_DO_SITE.map((o) => {
            const Icone = ICONE_DO_OBJETIVO[o.id] || Building2;
            const escolhido = atual === o.id;
            return (
              <li key={o.id} className="min-w-0">
                <button type="button" className={opcaoDaGrade(escolhido)} aria-pressed={escolhido} onClick={() => void escolher(o.id)} disabled={!!gravando} title={o.descricao} data-objetivo={o.id}>
                  {gravando === o.id ? <Loader2 className="mr-3 h-5 w-5 shrink-0 animate-spin text-primary" aria-hidden="true" /> : <Icone className={juntar("mr-3 h-5 w-5 shrink-0", escolhido ? "text-primary" : "text-muted-foreground")} aria-hidden="true" />}
                  <span className="min-w-0 flex-1">
                    <span className={juntar(texto.corpo, "block truncate font-medium")}>{o.rotulo}</span>
                    <span className={juntar(texto.auxiliar, "block truncate")}>{o.descricao}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </Secao>
    </div>
  );
}
