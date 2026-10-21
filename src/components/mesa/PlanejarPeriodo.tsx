import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { BotaoComCusto } from "./Custo";
import type { PedidoEmAndamento } from "./AgenteDoMes";
import { useMarcaDaMesa, useMesa } from "./MesaContexto";
import { chaves, hojeIso, partesDoPedido, pedidoLivre } from "./mesaV4Api";
import {
  fimDoMesDoPeriodo, inicioPadraoDoPeriodo, intervaloDoCalendario, pedidoDoCalendario,
  PERIODOS_DO_CALENDARIO, TIPOS_DO_PERIODO, TIPOS_INICIAIS_DO_PERIODO,
  type DiasDoPeriodo, type TipoDoPeriodo,
} from "./pedidoDoPeriodo";

interface Props {
  aberto: boolean;
  onAbertoChange: (aberto: boolean) => void;
  mes: string;
  onPedidoInicio: (pedido: PedidoEmAndamento) => void;
  onPedidoFim: () => void;
}

/** Cada cliente/marca/mês recebe seu formulário; uma troca nunca reaproveita o pedido anterior. */
export default function PlanejarPeriodo(props: Props) {
  const { clientId } = useMesa();
  const { marca } = useMarcaDaMesa();
  try { fimDoMesDoPeriodo(props.mes); }
  catch { return <Dialog open={props.aberto} onOpenChange={props.onAbertoChange}><DialogContent><DialogHeader><DialogTitle>Novo calendário</DialogTitle><DialogDescription>Escolha um mês válido na Agenda para planejar o período.</DialogDescription></DialogHeader><Button variant="outline" onClick={() => props.onAbertoChange(false)}>Fechar</Button></DialogContent></Dialog>; }
  return <FormularioDoPeriodo key={`${clientId}:${marca?.id || "-"}:${props.mes}`} {...props} />;
}

function FormularioDoPeriodo({ aberto, onAbertoChange, mes, onPedidoInicio, onPedidoFim }: Props) {
  const { clientId, clientName, catalogo } = useMesa();
  const qc = useQueryClient();
  const [tema, setTema] = useState("");
  const [inicio, setInicio] = useState(() => inicioPadraoDoPeriodo(mes, hojeIso()));
  const [dias, setDias] = useState<DiasDoPeriodo>(7);
  const [tipos, setTipos] = useState<TipoDoPeriodo[]>(() => [...TIPOS_INICIAIS_DO_PERIODO]);
  const [rodando, setRodando] = useState(false);
  let erro = "";
  let intervalo: ReturnType<typeof intervaloDoCalendario> | null = null;
  try {
    intervalo = intervaloDoCalendario(mes, inicio, dias);
    pedidoDoCalendario({ clientId, mes, inicio, dias, tema, tipos });
  } catch (e) { erro = e instanceof Error ? e.message : "Confira o período e os tipos escolhidos."; }
  const executar = async () => {
    const pedido = pedidoDoCalendario({ clientId, mes, inicio, dias, tema, tipos });
    setRodando(true);
    onAbertoChange(false);
    onPedidoInicio({ mensagem: pedido.mensagem, desde: Date.now() });
    try {
      // Pedido livre só prepara proposta; gravar continua sendo uma ação humana separada.
      const resposta = await pedidoLivre(pedido);
      await qc.invalidateQueries({ queryKey: chaves.agente(clientId) });
      return resposta;
    } finally { setRodando(false); onPedidoFim(); }
  };
  const dataBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  return <Dialog open={aberto} onOpenChange={(v) => { if (!rodando) onAbertoChange(v); }}>
    <DialogContent className="max-h-[92vh] max-w-xl overflow-y-auto">
      <DialogHeader><DialogTitle>Novo calendário</DialogTitle><DialogDescription>Prepare uma proposta para {clientName}. Revise os conteúdos com o Agente do mês antes de gravar na agenda.</DialogDescription></DialogHeader>
      <fieldset disabled={rodando} className="space-y-4">
        <label className="block space-y-1 text-[13px]"><span>Nicho ou tema <span className="text-muted-foreground">(opcional)</span></span><Input aria-label="Nicho ou tema do calendário" value={tema} maxLength={500} onChange={(e) => setTema(e.target.value)} placeholder="Usar o contexto real do cliente" /></label>
        <div className="grid grid-cols-2 gap-3">
          <label className="block space-y-1 text-[13px]"><span>Início</span><Input aria-label="Início do calendário" type="date" min={mes} max={fimDoMesDoPeriodo(mes)} value={inicio} onChange={(e) => setInicio(e.target.value)} /></label>
          <label className="block space-y-1 text-[13px]"><span>Período</span><select aria-label="Período do calendário" className="h-10 w-full rounded-md border border-input bg-background px-3 text-[13px]" value={dias} onChange={(e) => setDias(Number(e.target.value) as DiasDoPeriodo)}>{PERIODOS_DO_CALENDARIO.map((d) => <option key={d} value={d}>{d} dias</option>)}</select></label>
        </div>
        {intervalo && <p role="status" className="text-[12px] text-muted-foreground">De {dataBr(intervalo.inicio)} até {dataBr(intervalo.fim)}.{intervalo.limitadoAoMes ? ` Período ajustado para ${intervalo.dias} dias até o fim do mês selecionado.` : ""}</p>}
        <fieldset className="space-y-2"><legend className="text-[13px] font-medium">Tipos de conteúdo</legend><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{TIPOS_DO_PERIODO.map((t) => <label key={t.valor} className="flex items-center gap-2 text-[12px]"><input type="checkbox" checked={tipos.includes(t.valor)} onChange={(e) => setTipos((anteriores) => e.target.checked ? [...anteriores, t.valor] : anteriores.filter((v) => v !== t.valor))} />{t.rotulo}</label>)}</div></fieldset>
      </fieldset>
      <p className="text-[12px] text-muted-foreground">Até 12 conteúdos por proposta, seguindo o plano e a frequência do cliente. Os conteúdos já existentes são preservados.</p>
      {erro && <p role="alert" className="text-[12px] text-destructive">{erro}</p>}
      <DialogFooter><Button variant="outline" onClick={() => onAbertoChange(false)} disabled={rodando}>Cancelar</Button><BotaoComCusto rotulo="Gerar proposta" titulo="Proposta de calendário preparada" descricao="Prepara uma proposta no período escolhido, para revisar antes de gravar na agenda." partes={() => partesDoPedido(catalogo, 0)} executar={executar} disabled={!!erro || rodando} /></DialogFooter>
    </DialogContent>
  </Dialog>;
}
