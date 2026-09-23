import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { CalendarCheck, Check, FolderCheck, FolderOpen, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { faltaEnviar, textoDaEntrega } from "./EstudioSituacao";
import type { Trabalho } from "./useItensDoMes";

/**
 * Último posto da esteira, no próprio Estúdio (pedido do dono em 23/09:
 * "quando manda para Arquivos, se tivesse já as opções para andar para
 * aprovação seria mais fácil"). Antes de entregar: entregar e já enviar para
 * aprovação num clique, ou só entregar. Depois de entregar, o mesmo lugar
 * mostra "Enviar para aprovação" (design: "Pedir revisão da agência") e o
 * link para Arquivos, pela mesma regra da aba Entrega (faltaEnviar).
 */

function Passo({ feito, atual, titulo, detalhe }: { feito: boolean; atual: boolean; titulo: string; detalhe: ReactNode }) {
  return (
    <li className="flex items-start">
      <span
        className={`mr-2.5 mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10.5px] font-semibold ${
          feito ? "border-success bg-success/10 text-success" : atual ? "border-primary bg-primary text-primary-foreground" : "border-border text-muted-foreground"
        }`}
      >
        {feito ? <Check className="h-3 w-3" /> : null}
      </span>
      <span className="min-w-0">
        <span className="block text-[12.5px] font-medium leading-tight">{titulo}</span>
        <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{detalhe}</span>
      </span>
    </li>
  );
}

export default function EstudioEntrega({
  trabalho,
  laminasFeitas,
  laminasTotal,
  legendaEscrita,
  ehDesign,
  entregando,
  enviando,
  ocupado,
  erroDoEnvio,
  linkArquivos,
  linkAgenda,
  onEntregar,
  onEnviar,
}: {
  trabalho: Trabalho;
  laminasFeitas: number;
  laminasTotal: number;
  legendaEscrita: boolean;
  /** Quem é design pede a revisão da agência; admin e gestor liberam ao cliente. */
  ehDesign: boolean;
  entregando: boolean;
  enviando: boolean;
  /** Lâminas gerando ou direção sendo montada. */
  ocupado: boolean;
  erroDoEnvio: string | null;
  linkArquivos: string;
  linkAgenda: string | null;
  onEntregar: (tambemEnviar: boolean) => void;
  onEnviar: () => void;
}) {
  const entregue = trabalho.status === "entregue" || trabalho.entrega_status === "agendado";
  const todas = laminasTotal > 0 && laminasFeitas >= laminasTotal;
  const falta = faltaEnviar(trabalho);
  const rotuloEnviar = ehDesign ? "Pedir revisão da agência" : "Enviar para aprovação";
  const enviado = entregue && !falta;

  return (
    <div className="min-w-0 space-y-4">
      {trabalho.entrega_status === "reprovado" && trabalho.status !== "entregue" && (
        <div className="rounded-lg border border-warning/50 bg-background p-3 text-[12.5px]">
          <p className="font-semibold text-warning">Pediram ajuste nesta arte</p>
          {trabalho.entrega_aviso && <p className="mt-1 [overflow-wrap:anywhere]">“{trabalho.entrega_aviso}”</p>}
          <p className="mt-1 leading-snug text-muted-foreground">Ajuste as lâminas e entregue de novo: vira um arquivo novo e volta para a aprovação.</p>
        </div>
      )}

      <ol className="space-y-3" aria-label="Caminho até a Agenda">
        <Passo feito={todas} atual={!todas} titulo="Lâminas" detalhe={`${laminasFeitas} de ${laminasTotal} com arte`} />
        <Passo feito={legendaEscrita} atual={false} titulo="Legenda" detalhe={legendaEscrita ? "Escrita, vai junto com a arte" : "Vazia: vai a legenda da pauta, se houver"} />
        <Passo feito={entregue} atual={todas && !entregue} titulo="Arquivos" detalhe={entregue ? "Entregue, ligado a este item da agenda" : "O post é criado em Arquivos"} />
        <Passo feito={enviado} atual={falta} titulo="Aprovação" detalhe={entregue ? textoDaEntrega(trabalho) : "Depois de entregar"} />
      </ol>

      {!entregue ? (
        <div className="space-y-2">
          <Button type="button" className="h-10 w-full" onClick={() => onEntregar(true)} disabled={!todas || ocupado || entregando}>
            {entregando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
            {ehDesign ? "Entregar e pedir revisão" : "Entregar e enviar para aprovação"}
          </Button>
          <Button type="button" variant="outline" className="h-10 w-full" onClick={() => onEntregar(false)} disabled={!todas || ocupado || entregando}>
            <FolderCheck className="mr-1.5 h-4 w-4" /> Só entregar em Arquivos
          </Button>
          {!todas && <p className="text-center text-[11.5px] text-muted-foreground">Gere todas as lâminas para entregar.</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {falta && (
            <Button type="button" className="h-10 w-full" onClick={onEnviar} disabled={enviando}>
              {enviando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
              {rotuloEnviar}
            </Button>
          )}
          {erroDoEnvio && (
            <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-2.5 text-[12px] leading-snug [overflow-wrap:anywhere]">
              {erroDoEnvio}
            </p>
          )}
          <Button asChild variant="outline" className="h-10 w-full">
            <Link to={linkArquivos}>
              <FolderOpen className="mr-1.5 h-4 w-4" /> Abrir em Arquivos
            </Link>
          </Button>
          {linkAgenda && (
            <Button asChild variant="ghost" className="h-10 w-full">
              <Link to={linkAgenda}>
                <CalendarCheck className="mr-1.5 h-4 w-4" /> Abrir na Agenda
              </Link>
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
