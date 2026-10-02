import { CalendarPlus, Megaphone, PackagePlus, PenTool, Shuffle, SlidersHorizontal, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMesa } from "@/components/mesa/MesaContexto";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { juntar } from "@/components/sistema/estilos";
import { useMesaFoto } from "./Comuns";
import { gravarNaSessao } from "./sessao";
import { useLevarParaAsMesas } from "./UsoDaFoto";
import { fotoDaVersao, type Ensaio, type FotoDoAcervo } from "./fotoApi";

/**
 * Depois de aprovar (02/10, dono: "Aprovar não tem lógica; depois de gerar:
 * grade, selecionar, aprovar e a próxima ação clara"): as aprovadas agora
 * seguem num clique para Agenda, Estúdio, Mesa, Ads, Kit ou Variar. Cada ação
 * é ícone e nome; o que ela faz fica no "?" do bloco e na dica do botão.
 */

export type AcaoDepoisDeAprovar = "agenda" | "estudio" | "mesa" | "ads" | "kit" | "variar";

export interface OpcaoDepoisDeAprovar {
  acao: AcaoDepoisDeAprovar;
  rotulo: string;
  dica: string;
  icone: LucideIcon;
}

const TODAS: OpcaoDepoisDeAprovar[] = [
  { acao: "agenda", rotulo: "Agenda", dica: "Post na Agenda: foto única ou carrossel, com legenda, data e aprovação do cliente.", icone: CalendarPlus },
  { acao: "estudio", rotulo: "Estúdio", dica: "Abre a primeira no Estúdio de fotos para luz, cor, fundo e recorte.", icone: SlidersHorizontal },
  { acao: "mesa", rotulo: "Mesa", dica: "Usa na Mesa (Estúdio de artes) sem subir de novo.", icone: PenTool },
  { acao: "ads", rotulo: "Ads", dica: "Usa na Mesa Ads (criativos de anúncio).", icone: Megaphone },
  { acao: "kit", rotulo: "Kit", dica: "Monta um kit de produto com estas fotos, sem gastar IA.", icone: PackagePlus },
  { acao: "variar", rotulo: "Variar", dica: "Mais fotos parecidas com estas, do mesmo produto.", icone: Shuffle },
];

/** As ações que valem para as fotos aprovadas (pura: os testes usam). Sem foto, nenhuma; referência da internet nunca sai. */
export function acoesDepoisDeAprovar(fotos: Pick<FotoDoAcervo, "id" | "aprovada" | "referencia_web" | "kit_id">[]): OpcaoDepoisDeAprovar[] {
  const prontas = fotos.filter((f) => f.aprovada && !f.referencia_web);
  if (!prontas.length) return [];
  // Variar abre Fotos do produto já no produto da foto (sem produto, o seletor de produto de lá decide).
  return TODAS.slice();
}

export default function DepoisDeAprovar({ fotos, onFeito, className = "" }: { fotos: FotoDoAcervo[]; onFeito?: () => void; className?: string }) {
  const { clientId } = useMesa();
  const { prepararNaAgenda, abrirNoEstudio, irPara, escolherKit, escolherObjetivo } = useMesaFoto();
  const levar = useLevarParaAsMesas();
  const prontas = fotos.filter((f) => f.aprovada && !f.referencia_web);
  const opcoes = acoesDepoisDeAprovar(prontas);
  if (!opcoes.length) return null;
  const executar = (a: AcaoDepoisDeAprovar) => {
    const ids = prontas.map((f) => f.id);
    if (a === "agenda") {
      if (prepararNaAgenda) prepararNaAgenda(ids.slice(0, 20));
      else irPara("agenda");
    } else if (a === "estudio") {
      if (abrirNoEstudio) abrirNoEstudio(ids[0]);
      else irPara("estudio", { imagem: ids[0] });
    } else if (a === "mesa" || a === "ads") levar(a, prontas);
    else if (a === "kit") {
      gravarNaSessao(clientId, "kit-com-fotos", ids);
      irPara("kits", { kit: null });
    } else {
      const kit = prontas.find((f) => !!f.kit_id);
      if (kit && kit.kit_id) escolherKit(kit.kit_id);
      if (escolherObjetivo) escolherObjetivo("variacoes");
      irPara("ensaio");
    }
    if (onFeito) onFeito();
  };
  return (
    <div className={juntar("flex min-w-0 flex-wrap items-center rounded-lg border border-success/40 px-3 py-2", className)} data-depois-de-aprovar={prontas.length}>
      <span className="mb-1 mr-2 text-[12.5px] font-medium">
        {prontas.length} {prontas.length === 1 ? "aprovada" : "aprovadas"}. E agora?
      </span>
      {opcoes.map((o, i) => {
        const Icone = o.icone;
        return (
          <Button
            key={o.acao}
            type="button"
            size="sm"
            variant={i === 0 ? "default" : "outline"}
            className="mb-1 mr-1.5 h-8 px-2.5 text-[12px]"
            title={o.dica}
            onClick={() => executar(o.acao)}
            data-proxima-acao={o.acao}
          >
            <Icone className="mr-1.5 h-3.5 w-3.5" /> {o.rotulo}
          </Button>
        );
      })}
      <AjudaRecolhida className="mb-1" rotulo="O que cada saída faz">
        {opcoes.map((o) => `${o.rotulo}: ${o.dica}`).join(" ")}
      </AjudaRecolhida>
    </div>
  );
}

/** As fotos do acervo das versões aprovadas de um lote (Fotos do produto ou Foto com modelo). */
export function fotosAprovadasDoEnsaio(ensaio: Pick<Ensaio, "tomadas">, fotos: FotoDoAcervo[]): FotoDoAcervo[] {
  const saida: FotoDoAcervo[] = [];
  ensaio.tomadas.forEach((t) => {
    const v = t.versoes.find((x) => x.aprovada);
    const f = v ? fotoDaVersao(fotos, v) : null;
    if (f && saida.indexOf(f) < 0) saida.push(f.aprovada ? f : { ...f, aprovada: true });
  });
  return saida;
}
