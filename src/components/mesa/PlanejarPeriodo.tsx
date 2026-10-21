import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarRange } from "lucide-react";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
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
  catch { return <JanelaCentral aberta={props.aberto} onMudar={props.onAbertoChange} titulo="Novo calendário" icone={<CalendarRange className="h-4 w-4" />} largura="sm"><p className={texto.corpo}>Escolha um mês válido na Agenda para planejar o período.</p></JanelaCentral>; }
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
  // 21/10: no padrão da casa (JanelaCentral, campos do sistema, Safari 11) e sem início no passado do mês atual.
  const minimo = hojeIso().slice(0, 7) === mes.slice(0, 7) ? hojeIso() : mes;
  return <JanelaCentral
    aberta={aberto}
    onMudar={(v) => { if (!rodando) onAbertoChange(v); }}
    titulo="Novo calendário"
    icone={<CalendarRange className="h-4 w-4" />}
    descricao={`Proposta para ${clientName}, revisada com o Agente do mês antes de gravar.`}
    largura="md"
    rodape={<div className="flex min-w-0 flex-wrap items-center justify-end"><button type="button" className={juntar(botao.discreto, "mr-2")} onClick={() => onAbertoChange(false)} disabled={rodando}>Cancelar</button><BotaoComCusto rotulo="Gerar proposta" titulo="Proposta de calendário preparada" descricao="Prepara uma proposta no período escolhido, para revisar antes de gravar na agenda." partes={() => partesDoPedido(catalogo, 0)} executar={executar} disabled={!!erro || rodando} /></div>}
  >
    <fieldset disabled={rodando} className="space-y-4">
      <label className="block space-y-1"><span className={texto.rotulo}>Nicho ou tema (opcional)</span><input className={campo} aria-label="Nicho ou tema do calendário" value={tema} maxLength={500} onChange={(e) => setTema(e.target.value)} placeholder="Usar o contexto real do cliente" /></label>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block space-y-1"><span className={texto.rotulo}>Início</span><input className={campo} aria-label="Início do calendário" type="date" min={minimo} max={fimDoMesDoPeriodo(mes)} value={inicio} onChange={(e) => setInicio(e.target.value)} /></label>
        <label className="block space-y-1"><span className={texto.rotulo}>Período</span><select aria-label="Período do calendário" className={campo} value={dias} onChange={(e) => setDias(Number(e.target.value) as DiasDoPeriodo)}>{PERIODOS_DO_CALENDARIO.map((d) => <option key={d} value={d}>{d} dias</option>)}</select></label>
      </div>
      {intervalo && <p role="status" className={texto.auxiliar}>De {dataBr(intervalo.inicio)} até {dataBr(intervalo.fim)}.{intervalo.limitadoAoMes ? ` Período ajustado para ${intervalo.dias} dias até o fim do mês selecionado.` : ""}</p>}
      <fieldset className="space-y-2"><legend className={texto.rotulo}>Tipos de conteúdo</legend><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{TIPOS_DO_PERIODO.map((t) => <label key={t.valor} className="flex min-w-0 items-center text-[12px]"><input className="mr-2 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]" type="checkbox" checked={tipos.includes(t.valor)} onChange={(e) => setTipos((anteriores) => e.target.checked ? [...anteriores, t.valor] : anteriores.filter((v) => v !== t.valor))} />{t.rotulo}</label>)}</div></fieldset>
    </fieldset>
    <p className={juntar(texto.auxiliar, "mt-4")}>Até 12 conteúdos por proposta, seguindo o plano e a frequência do cliente. Os conteúdos já existentes são preservados.</p>
    {erro && <p role="alert" className="mt-2 text-[12px] text-destructive">{erro}</p>}
  </JanelaCentral>;
}
