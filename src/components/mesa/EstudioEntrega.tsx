import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { CalendarCheck, Check, FileCheck2, FolderCheck, FolderOpen, Loader2, RotateCcw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { juntar } from "@/components/sistema/estilos";
import { opcoesDaEntrega, rotuloDaOpcao, type ModoDeEntrega } from "@/lib/mesa/entregaComOpcoes";
import { faltaEnviar, textoDaEntrega } from "./EstudioSituacao";
import { useEstadoGuardado } from "./estudioUtil";
import type { Trabalho } from "./useItensDoMes";

/**
 * Último posto da esteira, no próprio Estúdio (pedido do dono em 23/09:
 * "quando manda para Arquivos, se tivesse já as opções para andar para
 * aprovação seria mais fácil"). Antes de entregar: entregar e já enviar para
 * aprovação num clique, ou só entregar. Depois de entregar, o mesmo lugar
 * mostra "Enviar para aprovação" (design: "Pedir revisão da agência") e o
 * link para Arquivos, pela mesma regra da aba Entrega (faltaEnviar).
 *
 * Frente EN (28/09, dono: "na hora de entregar, quero três opções"): antes de
 * entregar, um seletor curto escolhe como (pronto para agendar, enviar para
 * aprovação, só Arquivos) e um botão só entrega; a explicação fica no "?".
 * Design não aprova pelo cliente (só admin e gestor). Depois de entregar, o
 * admin ainda pode "Aprovar pelo cliente" enquanto a peça espera a aprovação.
 */

const ICONE_DO_MODO: Record<ModoDeEntrega, typeof Send> = { pronto: FileCheck2, aprovacao: Send, arquivos: FolderCheck };

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
  onAprovarPeloCliente,
  aprovando = false,
  onReabrir,
  reabrindo = false,
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
  /** Frente EN: o modo escolhido e, em "Só Arquivos", se o cliente já vê. */
  onEntregar: (modo: ModoDeEntrega, mostrarAoCliente: boolean) => void;
  onEnviar: () => void;
  /** Frente EN: entregue e esperando a aprovação, o admin aprova pelo cliente e agenda. */
  onAprovarPeloCliente?: () => void;
  aprovando?: boolean;
  /** "Reabrir para corrigir": mesmas lâminas e versões, nova rodada de entrega (arquivo novo). */
  onReabrir?: () => void;
  reabrindo?: boolean;
}) {
  const entregue = trabalho.status === "entregue" || trabalho.entrega_status === "agendado";
  const todas = laminasTotal > 0 && laminasFeitas >= laminasTotal;
  const falta = faltaEnviar(trabalho);
  const rotuloEnviar = ehDesign ? "Pedir revisão da agência" : "Enviar para aprovação";
  const enviado = entregue && !falta;
  // Frente EN: como entregar (fica lembrado na sessão). Design não tem o "pronto para agendar".
  const opcoes = opcoesDaEntrega(!ehDesign);
  const [modoGuardado, setModo] = useEstadoGuardado<ModoDeEntrega>("mesa:estudio:modo-da-entrega", "aprovacao");
  const opcao = opcoes.filter((o) => o.modo === modoGuardado)[0] || opcoes.filter((o) => o.modo === "aprovacao")[0];
  const [mostrarAoCliente, setMostrarAoCliente] = useEstadoGuardado<boolean>("mesa:estudio:entrega-mostrar", false);
  const IconeDoModo = ICONE_DO_MODO[opcao.modo];
  const esperandoAprovacao =
    trabalho.status === "entregue" && (!trabalho.entrega_status || trabalho.entrega_status === "aguardando_cliente" || trabalho.entrega_status === "aguardando_agencia");

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
        <div className="space-y-2" data-entrega-com-opcoes="">
          <div className="flex min-w-0 items-center">
            <p className="text-[13px] font-medium">Como entregar</p>
            <AjudaRecolhida className="ml-1" rotulo="Como entregar">
              Pronto para agendar: o cliente já deu o aval; aprova em nome dele (fica no histórico dele como aprovado por você) e
              agenda na data do conteúdo, no perfil da marca. Sem data que sirva, pergunta a data. Enviar para aprovação: o
              fluxo normal, o cliente aprova no portal. Só Arquivos: fica em Arquivos, sem aprovação e sem post na Agenda;
              marque "Mostrar ao cliente" para ele já ver.
            </AjudaRecolhida>
          </div>
          <div role="radiogroup" aria-label="Como entregar" className="space-y-0.5">
            {opcoes.map((o) => {
              const escolhida = o.modo === opcao.modo;
              return (
                <button
                  key={o.modo}
                  type="button"
                  role="radio"
                  aria-checked={escolhida}
                  title={o.dica}
                  onClick={() => setModo(o.modo)}
                  disabled={entregando}
                  data-modo-da-entrega={o.modo}
                  className={juntar(
                    "flex h-8 w-full min-w-0 items-center rounded-md px-2 text-left text-[13px]",
                    escolhida ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  <span className={juntar("mr-2 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border", escolhida ? "border-primary" : "border-border")} aria-hidden="true">
                    {escolhida && <span className="h-1.5 w-1.5 rounded-full bg-primary" />}
                  </span>
                  <span className="truncate">{o.modo === "aprovacao" && ehDesign ? "Pedir revisão da agência" : o.curto}</span>
                </button>
              );
            })}
          </div>
          {opcao.modo === "arquivos" && !ehDesign && (
            <label className="flex min-h-8 cursor-pointer items-center px-2 text-[13px]">
              <input
                type="checkbox"
                className="mr-2 h-4 w-4 shrink-0 accent-primary"
                checked={mostrarAoCliente}
                onChange={(e) => setMostrarAoCliente(e.target.checked)}
                disabled={entregando}
                data-mostrar-ao-cliente=""
              />
              Mostrar ao cliente
            </label>
          )}
          <Button
            type="button"
            className="h-10 w-full"
            onClick={() => onEntregar(opcao.modo, opcao.modo === "arquivos" && !ehDesign && mostrarAoCliente)}
            disabled={!todas || ocupado || entregando}
          >
            {entregando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <IconeDoModo className="mr-1.5 h-4 w-4" />}
            {rotuloDaOpcao(opcao, ehDesign)}
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
          {!ehDesign && esperandoAprovacao && onAprovarPeloCliente && (
            <Button
              type="button"
              variant="outline"
              className="h-10 w-full"
              onClick={onAprovarPeloCliente}
              disabled={aprovando || enviando}
              title="O cliente deu o aval: aprova em nome dele e agenda na data do conteúdo"
              data-aprovar-pelo-cliente=""
            >
              {aprovando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <FileCheck2 className="mr-1.5 h-4 w-4" />}
              Aprovar pelo cliente e agendar
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
          {onReabrir && (
            <div className="rounded-lg border border-border bg-background p-3">
              <Button type="button" variant={trabalho.entrega_status === "reprovado" ? "default" : "outline"} className="h-10 w-full" onClick={onReabrir} disabled={reabrindo || ocupado}>
                {reabrindo ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <RotateCcw className="mr-1.5 h-4 w-4" />}
                Reabrir para corrigir
              </Button>
              <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
                As lâminas voltam para edição com todas as versões. A entrega de agora fica em Arquivos e no histórico; a próxima vira arquivo novo e passa de novo pela aprovação.
              </p>
            </div>
          )}
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
