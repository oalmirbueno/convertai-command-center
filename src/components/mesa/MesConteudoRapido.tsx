import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarCheck2, ExternalLink, Plus, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { BotaoComCusto } from "./Custo";
import { BlocoDaProposta, CartaoDoConteudo } from "./ConteudosPropostos";
import { Cronometro } from "./Cronometro";
import { Ditado } from "./Ditado";
import { useMesa } from "./MesaContexto";
import { AGENTE_ESCOLHE, FRAMEWORKS, TIPOS_DE_CONTEUDO } from "./MesConhecimento";
import {
  atualizarAgenda,
  chaves,
  conteudoRapido,
  diaCurto,
  hojeIso,
  lerCampanhas,
  partesDoConteudoRapido,
  type ItemProposto,
  type PropostaV4,
} from "./mesaV4Api";

/**
 * Conteúdo rápido do Mês (pedido do dono em 25/09): "hoje o cliente pediu uma
 * arte para tal campanha; escrevo, ele já gera o dia no calendário e eu já
 * puxo para o estúdio". Um campo (texto ou ditado), campanha opcional, dia
 * (hoje, próximo dia livre ou uma data) e formato. UMA chamada rápida
 * (conteudo_rapido) escreve o roteiro, grava no dia e deixa a direção pronta
 * no Estúdio; o botão "Abrir no Estúdio" leva direto.
 */

type Dia = "hoje" | "livre" | "data";
const SEM_CAMPANHA = "nenhuma";

interface Resultado {
  proposta: PropostaV4 | null;
  item: ItemProposto | null;
  task_id: string | null;
  mes: string;
  data: string;
  sem_projeto: boolean;
  resposta: string;
}

export default function MesConteudoRapido({
  aberto,
  onAbertoChange,
  onAbrirNoEstudio,
  onVerNoMes,
  campanhaInicial = null,
}: {
  aberto: boolean;
  onAbertoChange: (v: boolean) => void;
  onAbrirNoEstudio?: (taskId: string, mes: string) => void;
  onVerNoMes?: (mes: string) => void;
  campanhaInicial?: string | null;
}) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const [pedido, setPedido] = useState("");
  const [campanhaId, setCampanhaId] = useState(campanhaInicial || SEM_CAMPANHA);
  const [dia, setDia] = useState<Dia>("hoje");
  const [data, setData] = useState(hojeIso());
  const [formato, setFormato] = useState<"" | "estatico" | "carrossel">("");
  const [tipo, setTipo] = useState(AGENTE_ESCOLHE);
  const [framework, setFramework] = useState(AGENTE_ESCOLHE);
  const [desde, setDesde] = useState<number | null>(null);
  const [resultado, setResultado] = useState<Resultado | null>(null);

  const campanhas = useQuery({ queryKey: chaves.campanhas(clientId), enabled: aberto, queryFn: () => lerCampanhas(clientId) });
  const ativas = (campanhas.data || []).filter((c) => c.status !== "encerrada");

  const recomecar = () => {
    setResultado(null);
    setPedido("");
  };

  const executar = async () => {
    setDesde(Date.now());
    try {
      return await conteudoRapido({
        clientId,
        pedido: pedido.trim(),
        campanhaId: campanhaId !== SEM_CAMPANHA ? campanhaId : null,
        data: dia === "data" ? data : dia,
        formato: formato || null,
        tipo: tipo !== AGENTE_ESCOLHE ? tipo : null,
        framework: framework !== AGENTE_ESCOLHE ? framework : null,
      });
    } finally {
      setDesde(null);
      // Entrou no dia: a agenda, o Estúdio e a conversa do agente relêem já.
      atualizarAgenda(queryClient, clientId);
      void queryClient.invalidateQueries({ queryKey: chaves.agente(clientId) });
    }
  };

  const concluir = (d: any) => {
    const proposta = d && d.proposta ? (d.proposta as PropostaV4) : null;
    const itens = proposta && Array.isArray(proposta.itens) ? proposta.itens : [];
    const item = (itens[0] || (d && d.item) || null) as ItemProposto | null;
    if (proposta) queryClient.setQueryData(chaves.proposta(proposta.id), proposta);
    setResultado({
      proposta,
      item,
      task_id: d && d.task_id ? String(d.task_id) : item && item.task_id ? String(item.task_id) : null,
      mes: d && d.mes ? String(d.mes) : "",
      data: d && d.data ? String(d.data) : "",
      sem_projeto: !!(d && d.sem_projeto),
      resposta: d && d.resposta ? String(d.resposta) : "",
    });
  };

  const abrirNoEstudio = () => {
    if (!resultado || !resultado.task_id || !onAbrirNoEstudio) return;
    onAbertoChange(false);
    onAbrirNoEstudio(resultado.task_id, resultado.mes);
  };

  const rodando = desde !== null;

  return (
    <Dialog open={aberto} onOpenChange={(v) => { if (!rodando) onAbertoChange(v); }}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-16px)] max-w-xl overflow-y-auto p-4 sm:p-5">
        <DialogTitle className="flex items-center text-[15px]">
          <Zap className="mr-1.5 h-4 w-4 text-primary" /> Conteúdo rápido
        </DialogTitle>
        <DialogDescription className="-mt-1 text-[12px]">
          Escreva ou dite o pedido. O agente prepara o roteiro, grava no dia e deixa a direção pronta no Estúdio.
        </DialogDescription>

        {resultado ? (
          <div className="min-w-0 space-y-3" data-rapido="pronto">
            {resultado.resposta && <p className="text-[12.5px] leading-relaxed [overflow-wrap:anywhere]">{resultado.resposta}</p>}
            {resultado.item && <CartaoDoConteudo item={resultado.item} />}
            {resultado.sem_projeto && resultado.proposta ? (
              <div className="space-y-1.5">
                <p className="text-[12px] text-muted-foreground">O cliente não tem projeto de social marcado. Escolha o projeto para gravar no dia.</p>
                <BlocoDaProposta
                  proposta={resultado.proposta}
                  compacto
                  onGravada={(g) => {
                    const it = g && g.proposta && Array.isArray(g.proposta.itens) ? g.proposta.itens[0] : null;
                    setResultado((r) => (r ? { ...r, sem_projeto: false, task_id: it && it.task_id ? String(it.task_id) : r.task_id, item: it || r.item } : r));
                  }}
                />
              </div>
            ) : (
              <p className="flex items-center text-[12px] text-muted-foreground">
                <CalendarCheck2 className="mr-1.5 h-3.5 w-3.5 shrink-0 text-success" />
                No calendário em {diaCurto(resultado.data)}, com a direção pronta no Estúdio.
              </p>
            )}
            <div className="flex flex-wrap items-center">
              {resultado.task_id && onAbrirNoEstudio && (
                <Button type="button" size="sm" className="mb-1 mr-1.5 h-9" onClick={abrirNoEstudio}>
                  Abrir no Estúdio <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                </Button>
              )}
              {resultado.mes && onVerNoMes && (
                <Button type="button" size="sm" variant="outline" className="mb-1 mr-1.5 h-9" onClick={() => { onAbertoChange(false); onVerNoMes(resultado.mes); }}>
                  Ver no mês
                </Button>
              )}
              <Button type="button" size="sm" variant="ghost" className="mb-1 h-9" onClick={recomecar}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Outro conteúdo
              </Button>
            </div>
          </div>
        ) : (
          <div className="min-w-0 space-y-3">
            <div className="rounded-xl border border-border bg-background p-2 focus-within:border-primary/60">
              <Textarea
                value={pedido}
                onChange={(e) => setPedido(e.target.value)}
                rows={4}
                autoFocus
                disabled={rodando}
                aria-label="Pedido do conteúdo rápido"
                placeholder='Ex.: o cliente pediu uma arte da promoção de sexta, 20% no kit de mudas, chamando no WhatsApp.'
                className="min-h-[88px] resize-none border-0 bg-transparent px-1 py-1 text-[13px] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              />
              <div className="flex justify-end">
                <Ditado valor={pedido} onChange={setPedido} disabled={rodando} />
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <div className="min-w-0">
                <p className="mb-1 text-[11px] font-medium text-muted-foreground">Dia</p>
                <div className="flex min-w-0">
                  <Select value={dia} onValueChange={(v) => setDia(v as Dia)} disabled={rodando}>
                    <SelectTrigger className="h-9 min-w-0 flex-1 text-[12.5px]" aria-label="Dia do conteúdo"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hoje">Hoje</SelectItem>
                      <SelectItem value="livre">Próximo dia livre</SelectItem>
                      <SelectItem value="data">Escolher a data</SelectItem>
                    </SelectContent>
                  </Select>
                  {dia === "data" && (
                    <Input type="date" value={data} min={hojeIso()} onChange={(e) => setData(e.target.value)} className="ml-1.5 h-9 w-[150px] shrink-0" aria-label="Data" disabled={rodando} />
                  )}
                </div>
              </div>
              <div className="min-w-0">
                <p className="mb-1 text-[11px] font-medium text-muted-foreground">Formato</p>
                <div role="radiogroup" aria-label="Formato" className="grid grid-cols-3 gap-1 rounded-lg bg-muted p-0.5">
                  {([["", "Agente escolhe"], ["estatico", "Estático"], ["carrossel", "Carrossel"]] as const).map(([v, r]) => (
                    <button
                      key={v || "auto"}
                      type="button"
                      role="radio"
                      aria-checked={formato === v}
                      disabled={rodando}
                      onClick={() => setFormato(v)}
                      className={`min-w-0 truncate rounded-md px-1.5 py-1.5 text-[11.5px] font-medium ${formato === v ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"}`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {ativas.length > 0 && (
                <Select value={campanhaId} onValueChange={setCampanhaId} disabled={rodando}>
                  <SelectTrigger className="h-9 min-w-0 text-[12px]" aria-label="Campanha"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={SEM_CAMPANHA}>Sem campanha</SelectItem>
                    {ativas.map((c) => <SelectItem key={c.id} value={c.id}>{c.nome}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
              <Select value={tipo} onValueChange={setTipo} disabled={rodando}>
                <SelectTrigger className="h-9 min-w-0 text-[12px]" aria-label="Tipo de conteúdo"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={AGENTE_ESCOLHE}>Tipo: o agente escolhe</SelectItem>
                  {TIPOS_DE_CONTEUDO.map((t) => <SelectItem key={t.id} value={t.id}>{t.nome}</SelectItem>)}
                </SelectContent>
              </Select>
              <Select value={framework} onValueChange={setFramework} disabled={rodando}>
                <SelectTrigger className="h-9 min-w-0 text-[12px]" aria-label="Framework"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={AGENTE_ESCOLHE}>Framework: o agente escolhe</SelectItem>
                  {FRAMEWORKS.map((f) => <SelectItem key={f.id} value={f.id}>{f.nome}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="flex min-w-0 items-center justify-end border-t border-border pt-3">
              {rodando && (
                <span className="mr-auto min-w-0">
                  <Cronometro desde={desde} rotulo="Preparando o conteúdo" previsao="~30s" />
                </span>
              )}
              <BotaoComCusto
                rotulo={<><Zap className="mr-1.5 h-3.5 w-3.5" />Preparar e pôr no dia</>}
                titulo="Conteúdo rápido"
                descricao="Uma chamada rápida do estrategista (raciocínio baixo) escreve o roteiro e grava no dia do calendário."
                partes={() => partesDoConteudoRapido(catalogo)}
                executar={executar}
                aoConcluir={concluir}
                disabled={!pedido.trim() || rodando || (dia === "data" && !data)}
                className="h-9"
              />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
