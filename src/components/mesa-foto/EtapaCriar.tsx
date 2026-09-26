import { Aperture, ArrowRight, CalendarDays, Images, Megaphone, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useMesa } from "@/components/mesa/MesaContexto";
import { MiniaturaDaFoto, useMesaFoto, Vazio } from "./Comuns";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { foco, juntar } from "@/components/sistema/estilos";
import { periodoDaCampanha, rotuloDoTipo, useCampanhasDaMesa, useEnsaios, useFotos, useKits } from "./fotoApi";

/**
 * Passo 2, Criar: as três formas de criar com o produto aberto, em cartões
 * diretos. Variações (várias fotos do produto de uma vez),
 * Campanha (modelo sintético usando o produto) e Preparar (ajuste fino de
 * uma foto). O ensaio por receita segue dentro de Variações.
 *
 * 26/09 (sistema de design): o produto aberto numa linha com a troca ao lado,
 * sem caixa; a campanha do mês numa linha com a explicação no "?"; os pedidos
 * ao diretor vão para o rascunho do campo dele, na lateral.
 */

const FORMAS = [
  {
    etapa: "ensaio" as const,
    titulo: "Variações do produto",
    texto: "4 a 16 fotos: fundo de cor, lifestyle, na mão, flat lay, macro.",
    icone: Images,
  },
  {
    etapa: "campanha" as const,
    titulo: "Campanha com modelo",
    texto: "Pessoa sintética usando o produto, na pegada da marca.",
    icone: Megaphone,
  },
  {
    etapa: "preparar" as const,
    titulo: "Preparar uma foto",
    texto: "Ajuste fino de uma foto real: fundo, luz, cenário, limpeza.",
    icone: Wand2,
  },
];

export default function EtapaCriar() {
  const { clientId } = useMesa();
  const { kitId, irPara, pedirAoDiretor } = useMesaFoto();
  const kits = useKits(clientId);
  const fotos = useFotos(clientId);
  const ensaios = useEnsaios(clientId);
  const lista = kits.data || [];
  const kit = kitId ? lista.find((k) => k.id === kitId) || null : null;
  const capa = kit ? (fotos.data || []).find((f) => f.id === (kit.frente_imagem_id || (kit.refs[0] && kit.refs[0].imagem_id))) || null : null;
  const doKit = kit ? (ensaios.data || []).filter((e) => e.kit_id === kit.id).length : 0;
  const campanhas = useCampanhasDaMesa(clientId);
  const doMes = campanhas.data && campanhas.data.campanhaDoMesId ? campanhas.data.campanhas.find((c) => c.id === (campanhas.data && campanhas.data.campanhaDoMesId)) || null : null;

  if (kits.isSuccess && !lista.length) {
    return (
      <Vazio
        titulo="Primeiro, o produto"
        acao={
          <Button type="button" size="sm" className="h-8 text-[12px]" onClick={() => irPara("acervo")}>
            Identificar o produto nas fotos <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
          </Button>
        }
      >
        Tudo o que se cria parte das fotos que provam como o produto é.
      </Vazio>
    );
  }

  return (
    <div className="min-w-0 space-y-5">
      <div className="flex min-w-0 items-center" data-produto-aberto="">
        <span className="mr-2.5 w-10 shrink-0">{capa ? <MiniaturaDaFoto foto={capa} selo={false} /> : <span className="block h-10 w-10 rounded-md bg-muted" />}</span>
        <div className="mr-2 min-w-0 flex-1">
          <p className="truncate text-[13px] font-semibold">{kit ? kit.nome : "Nenhum produto escolhido"}</p>
          <p className="truncate text-[11.5px] text-muted-foreground">
            {kit ? `${rotuloDoTipo(kit.tipo)}${kit.variante ? ` · ${kit.variante}` : ""} · ${doKit} ${doKit === 1 ? "lote criado" : "lotes criados"}` : "Escolha o produto na barra de cima ou no passo 1 (Fotos)."}
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" className="h-8 shrink-0 text-[12px]" onClick={() => irPara("acervo")}>
          {kit ? "Trocar" : "Escolher"}
        </Button>
      </div>

      {doMes && (
        <div className="flex min-w-0 items-center text-[12px] text-muted-foreground" data-campanha-do-mes={doMes.id}>
          <CalendarDays className="mr-1.5 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />
          <span className="mr-1 shrink-0">Campanha do mês:</span>
          <span className="mr-1 min-w-0 truncate font-medium text-foreground">{doMes.nome}</span>
          <span className="shrink-0 tabular-nums">({periodoDaCampanha(doMes)})</span>
          <AjudaRecolhida className="ml-1" rotulo="Sobre a campanha do mês">
            Variações e Campanha já partem da campanha do mês na Mesa; dá para trocar lá dentro.
          </AjudaRecolhida>
        </div>
      )}

      <ul className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-3">
        {FORMAS.map((f) => {
          const Icone = f.icone;
          return (
            <li key={f.etapa} className="min-w-0">
              <button
                type="button"
                onClick={() => irPara(f.etapa)}
                disabled={!kit && f.etapa !== "preparar"}
                className={juntar("flex h-full w-full min-w-0 flex-col rounded-lg border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 disabled:opacity-60", foco)}
                data-forma-de-criar={f.etapa}
              >
                <Icone className="h-5 w-5 text-primary" />
                <span className="mt-2 block text-[14px] font-semibold">{f.titulo}</span>
                <span className="mt-1 block text-[12px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{f.texto}</span>
                <span className="mt-3 inline-flex items-center text-[12px] font-medium text-primary">
                  Abrir <ArrowRight className="ml-1 h-3.5 w-3.5" />
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {pedirAoDiretor && kit && (
        <div className="flex min-w-0 flex-wrap items-center text-[12px] text-muted-foreground">
          <Aperture className="mr-1.5 h-3.5 w-3.5 text-primary" />
          <span className="mr-2">Pedir ao diretor:</span>
          <button type="button" className="mr-3 font-medium text-primary hover:underline" onClick={() => pedirAoDiretor("Monte um plano de 8 variações para este produto, com tipos bem diferentes.")}>
            8 variações
          </button>
          <button type="button" className="font-medium text-primary hover:underline" onClick={() => pedirAoDiretor("Monte uma campanha com modelo sintético usando este produto, com a pegada da marca.")}>
            Campanha com modelo
          </button>
        </div>
      )}
    </div>
  );
}
