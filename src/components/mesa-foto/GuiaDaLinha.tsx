import { ArrowRight, CalendarPlus, Images, Megaphone, Scissors, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMesa } from "@/components/mesa/MesaContexto";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { foco, juntar } from "@/components/sistema/estilos";
import { useMesaFoto, type EtapaDaMesaFoto } from "./Comuns";
import { useFotos, useKits } from "./fotoApi";
import { marcadasQueContam, OBJETIVOS, objetivoPorValor, prontidaoDasFotos, type Objetivo, type ObjetivoDaFoto, type Prontidao } from "./linhaDeProducao";

/**
 * Peças da linha de produção (frente FTL, 30/09; dono: "a linha de produção
 * das fotos está muito confusa e difícil, facilite").
 *
 * - `useSeguirNaLinha`: o "Continuar" do passo 2 para o 3. Lê o objetivo, as
 *   fotos marcadas e o produto, diz o que falta em uma frase e leva para a
 *   ferramenta certa (a foto marcada já abre no Estúdio ou no Preparar; o
 *   post leva as marcadas para a Agenda).
 * - `GuiaDaLinha`: a faixa no topo das Fotos com o que a pessoa está fazendo,
 *   o que falta e o botão de seguir. Sem objetivo, as 5 opções em pílulas
 *   (escolhe sem sair da tela).
 */

export const ICONES_DOS_OBJETIVOS: Record<ObjetivoDaFoto, typeof Wand2> = {
  compor: Images,
  combinar: Images,
  melhorar: Wand2,
  variacoes: Images,
  modelo: Megaphone,
  fundo: Scissors,
  post: CalendarPlus,
};

export function useSeguirNaLinha(): { objetivo: Objetivo | null; prontidao: Prontidao; seguir: () => void; marcadas: string[] } {
  const { clientId } = useMesa();
  const { objetivo, selecionadas, marcadas: marcadasDaPagina, kitId, irPara, prepararNaAgenda } = useMesaFoto();
  const fotos = useFotos(clientId);
  const kits = useKits(clientId);
  // Só as marcadas que existem e podem sair (referência da internet é uso interno). A página já
  // calcula (mesma regra do Próximo do cabeçalho e da aba 3); fora dela, calcula aqui.
  const marcadas = marcadasDaPagina || marcadasQueContam(selecionadas, fotos.isSuccess ? fotos.data || [] : null);
  const produtos = (kits.data || []).filter((k) => k.status !== "arquivado").length;
  const o = objetivoPorValor(objetivo || null);
  const prontidao = prontidaoDasFotos({ objetivo: objetivo || null, selecionadas: marcadas.length, kitId, produtos });
  const seguir = () => {
    if (!o) {
      irPara("criar");
      return;
    }
    if (!prontidao.pronto) return;
    if (o.requisito === "uma_foto") irPara(o.etapa as EtapaDaMesaFoto, { imagem: marcadas[0] });
    else if (o.requisito === "produto") irPara(o.etapa as EtapaDaMesaFoto);
    else if (prepararNaAgenda) prepararNaAgenda(marcadas.slice(0, 20));
    else irPara("agenda");
  };
  return { objetivo: o, prontidao, seguir, marcadas };
}

/** Faixa do passo 2 (Fotos): o que está fazendo, o que falta e o botão de seguir. */
export default function GuiaDaLinha() {
  const { escolherObjetivo, irPara } = useMesaFoto();
  const { objetivo, prontidao, seguir } = useSeguirNaLinha();

  if (!objetivo) {
    return (
      <div className="flex min-w-0 flex-wrap items-center pb-1" data-guia-da-linha="sem-objetivo">
        <p className="mb-1.5 mr-2 text-[13px] font-medium">O que você quer produzir?</p>
        <div className="flex min-w-0 flex-wrap items-center" role="group" aria-label="O que produzir">
          {OBJETIVOS.map((o) => {
            const Icone = ICONES_DOS_OBJETIVOS[o.valor];
            return (
              <button
                key={o.valor}
                type="button"
                onClick={() => escolherObjetivo && escolherObjetivo(o.valor)}
                title={o.texto}
                className={juntar("mb-1.5 mr-1.5 inline-flex h-7 items-center rounded-full border border-border bg-background px-2.5 text-[12px] text-foreground hover:border-primary/50", foco)}
                data-objetivo-rapido={o.valor}
              >
                <Icone className="mr-1 h-3.5 w-3.5 text-primary" aria-hidden="true" /> {o.titulo}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const Icone = ICONES_DOS_OBJETIVOS[objetivo.valor];
  return (
    <div className="flex min-w-0 flex-wrap items-center pb-1" data-guia-da-linha={objetivo.valor} data-pronto={prontidao.pronto ? "sim" : "nao"}>
      {/* No celular o botão desce para a linha de baixo (o texto não corta). */}
      <div className="mb-1.5 flex w-full min-w-0 items-center sm:mb-1 sm:mr-3 sm:w-auto sm:flex-1">
        <Icone className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <div className="min-w-0">
          <div className="flex min-w-0 items-center text-[13px]">
            <span className="mr-1 shrink-0 text-muted-foreground">Fazendo:</span>
            <span className="min-w-0 truncate font-semibold">{objetivo.titulo}</span>
            <button type="button" className={juntar("ml-2 shrink-0 rounded text-[12px] font-medium text-primary hover:underline", foco)} onClick={() => irPara("criar")}>
              Trocar
            </button>
            <AjudaRecolhida className="ml-1" rotulo="Como funciona este passo">
              {`${objetivo.texto} Precisa de ${objetivo.precisa}. Marque na grade (a caixinha no canto da foto) ou suba novas; depois é só continuar.`}
            </AjudaRecolhida>
          </div>
          <p className="truncate text-[12px] text-muted-foreground" data-falta="">
            {prontidao.pronto ? "Pronto para seguir." : prontidao.falta}
          </p>
        </div>
      </div>
      <Button type="button" size="sm" className="mb-1 h-8 shrink-0 text-[12px]" disabled={!prontidao.pronto} onClick={seguir} data-seguir-na-linha="">
        {prontidao.seguir} <ArrowRight className="ml-1 h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
