import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { Campo } from "@/components/mesa/Seletores";
import { dataEHora } from "@/lib/mesa/api";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { Carregando, EstadoDeErro } from "@/components/sistema/Estados";
import { campo, foco, juntar } from "@/components/sistema/estilos";
import { brl } from "./adsApi";
import { chavesMemoria, lerMemoria, PREENCHIDAS_VAZIAS, salvarMemoria, type Preenchidas, type Situacao } from "./memoriaApi";

/**
 * Memória da conta em 8 camadas (12/10/2026, skill memoria-de-conta-ads).
 *
 * O agente de tráfego lê isto em toda conversa e cita a camada quando decide.
 * A equipe preenche o que só o dono sabe (finanças, confiabilidade dos dados,
 * mercado e calendário, comportamento, fonte que prevalece); o resto o painel
 * monta sozinho a partir da conta. CPA máximo e ROAS de equilíbrio são
 * calculados no servidor, nunca pela IA, e viram o custo-alvo da rotina
 * quando o tipo de resultado bate.
 */

const SITUACOES: { valor: Situacao; rotulo: string }[] = [
  { valor: "ok", rotulo: "Funcionando" },
  { valor: "com_problema", rotulo: "Com problema" },
  { valor: "nao_tem", rotulo: "Não instalado" },
  { valor: "nao_sei", rotulo: "Não conferido" },
];
const FONTES = [
  { valor: "nao_definido", rotulo: "Não definido" },
  { valor: "meta", rotulo: "A Meta" },
  { valor: "vendas_registradas", rotulo: "As vendas registradas no painel" },
  { valor: "crm", rotulo: "O CRM do cliente" },
] as const;

const numeroDoCampo = (v: string): number | null => {
  const s = v.trim();
  if (!s) return null;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return isFinite(n) ? n : null;
};
const textoDoNumero = (v: number | null) => (v === null ? "" : String(v).replace(".", ","));
const datasEmTexto = (d: { dia: string; nome: string }[]) => d.map((x) => `${x.dia} ${x.nome}`).join("\n");
const datasDoTexto = (t: string) =>
  t.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
    const m = l.match(/^(\d{4}-\d{2}-\d{2}|\d{2}-\d{2})\s+(.+)$/);
    return m ? { dia: m[1], nome: m[2].trim() } : null;
  }).filter((x): x is { dia: string; nome: string } => !!x);

export default function MemoriaDaConta() {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const q = useQuery({ queryKey: chavesMemoria.conta(clientId), queryFn: () => lerMemoria(clientId), enabled: !!clientId, staleTime: 60_000 });
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState<Preenchidas>(PREENCHIDAS_VAZIAS);
  const [datas, setDatas] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (q.data && !editando) {
      setRascunho(q.data.preenchidas);
      setDatas(datasEmTexto(q.data.preenchidas.mercado.datas));
    }
  }, [q.data, editando]);

  if (!clientId) return null;
  if (q.isLoading) return <Carregando forma="lista" rotulo="Lendo a memória da conta" />;
  if (q.error || !q.data) return <EstadoDeErro titulo="Não deu para ler a memória da conta" descricao={q.error instanceof Error ? q.error.message : ""} />;
  const m = q.data;
  const f = m.financas;

  const muda = <K extends keyof Preenchidas>(parte: K, campoNome: keyof Preenchidas[K], valor: unknown) =>
    setRascunho((r) => ({ ...r, [parte]: { ...r[parte], [campoNome]: valor } }));

  async function salvar() {
    setSalvando(true);
    try {
      const nova = await salvarMemoria(clientId, { ...rascunho, mercado: { ...rascunho.mercado, datas: datasDoTexto(datas) } }, m.versao);
      queryClient.setQueryData(chavesMemoria.conta(clientId), nova);
      setEditando(false);
      toast.success("Memória da conta salva", { description: `Versão ${nova.versao}. O agente e a rotina já usam na próxima leitura.` });
    } catch (e) {
      avisarErro(e, "Não deu para salvar a memória");
      void queryClient.invalidateQueries({ queryKey: chavesMemoria.conta(clientId) });
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2 text-[13px]">
        {f.custo_maximo_brl !== null ? (
          <span>
            <span className="text-muted-foreground">{f.por === "lead" ? "Custo máximo por lead" : "CPA máximo"}: </span>
            <span className="font-semibold tabular-nums">{brl(f.custo_maximo_brl)}</span>
          </span>
        ) : (
          <span className="text-warning">Sem custo máximo: falta {f.faltando.join(", ") || "preencher as finanças"}.</span>
        )}
        {f.roas_de_equilibrio !== null && (
          <span>
            <span className="text-muted-foreground">ROAS de equilíbrio: </span>
            <span className="font-semibold tabular-nums">{String(f.roas_de_equilibrio).replace(".", ",")}</span>
          </span>
        )}
        <span className="text-[12px] text-muted-foreground">{m.versao ? `Versão ${m.versao}${m.atualizada_em ? `, ${dataEHora(m.atualizada_em)}` : ""}` : "Ainda não preenchida"}</span>
        <AjudaRecolhida titulo="Como funciona">
          O agente de tráfego lê estas 8 camadas em toda conversa e cita a camada quando decide. O custo máximo sai das finanças (ticket x margem) e vira o custo-alvo da rotina quando o resultado da conta é do mesmo tipo (compra com compra, lead com lead). As camadas marcadas como "conta" o painel monta sozinho.
        </AjudaRecolhida>
        {!editando && (
          <Button type="button" size="sm" variant="outline" className="ml-auto h-8" onClick={() => setEditando(true)} disabled={!m.disponivel}>
            <Pencil className="mr-1 h-3.5 w-3.5" /> Preencher
          </Button>
        )}
      </div>

      {editando ? (
        <div className="min-w-0 space-y-5 border-t border-border pt-4">
          <fieldset className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <legend className="mb-2 text-[13px] font-semibold">C01 Finanças</legend>
            <Campo rotulo="Ticket médio (R$)"><input className={campo} inputMode="decimal" value={textoDoNumero(rascunho.financas.ticket_medio_brl)} onChange={(e) => muda("financas", "ticket_medio_brl", numeroDoCampo(e.target.value))} /></Campo>
            <Campo rotulo="Margem de contribuição (%)"><input className={campo} inputMode="decimal" value={textoDoNumero(rascunho.financas.margem_pct)} onChange={(e) => muda("financas", "margem_pct", numeroDoCampo(e.target.value))} /></Campo>
            <Campo rotulo="O resultado que paga a conta">
              <select className={campo} value={rascunho.financas.conversao} onChange={(e) => muda("financas", "conversao", e.target.value === "lead" ? "lead" : "venda")}>
                <option value="venda">Venda</option>
                <option value="lead">Lead ou conversa</option>
              </select>
            </Campo>
            {rascunho.financas.conversao === "lead" && (
              <Campo rotulo="Leads que viram venda (%)"><input className={campo} inputMode="decimal" value={textoDoNumero(rascunho.financas.taxa_fechamento_pct)} onChange={(e) => muda("financas", "taxa_fechamento_pct", numeroDoCampo(e.target.value))} /></Campo>
            )}
            <Campo rotulo="Compras do mesmo cliente em 12 meses"><input className={campo} inputMode="decimal" value={textoDoNumero(rascunho.financas.compras_no_ano)} onChange={(e) => muda("financas", "compras_no_ano", numeroDoCampo(e.target.value))} /></Campo>
            <Campo rotulo="Observação" className="sm:col-span-2 lg:col-span-3"><input className={campo} value={rascunho.financas.observacoes} onChange={(e) => muda("financas", "observacoes", e.target.value)} /></Campo>
          </fieldset>

          <fieldset className="grid min-w-0 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <legend className="mb-2 text-[13px] font-semibold">C03 Confiabilidade dos dados</legend>
            <Campo rotulo="Pixel">
              <select className={campo} value={rascunho.confiabilidade.pixel} onChange={(e) => muda("confiabilidade", "pixel", e.target.value)}>
                {SITUACOES.map((s) => <option key={s.valor} value={s.valor}>{s.rotulo}</option>)}
              </select>
            </Campo>
            <Campo rotulo="API de Conversões">
              <select className={campo} value={rascunho.confiabilidade.api_de_conversoes} onChange={(e) => muda("confiabilidade", "api_de_conversoes", e.target.value)}>
                {SITUACOES.map((s) => <option key={s.valor} value={s.valor}>{s.rotulo}</option>)}
              </select>
            </Campo>
            <Campo rotulo="Evento principal"><input className={campo} placeholder="Compra, Lead, Conversa iniciada..." value={rascunho.confiabilidade.evento_principal} onChange={(e) => muda("confiabilidade", "evento_principal", e.target.value)} /></Campo>
            <Campo rotulo="Janela de atribuição"><input className={campo} placeholder="7 dias após o clique" value={rascunho.confiabilidade.janela_de_atribuicao} onChange={(e) => muda("confiabilidade", "janela_de_atribuicao", e.target.value)} /></Campo>
            <Campo rotulo="Armadilhas conhecidas" className="sm:col-span-2"><textarea className={juntar(campo, "h-auto min-h-16 py-2")} placeholder="Ex.: a Meta conta resposta como conversa; evento duplicado no site" value={rascunho.confiabilidade.armadilhas} onChange={(e) => muda("confiabilidade", "armadilhas", e.target.value)} /></Campo>
          </fieldset>

          <fieldset className="grid min-w-0 gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-[13px] font-semibold">C06 Mercado e calendário</legend>
            <Campo rotulo="Sazonalidade"><textarea className={juntar(campo, "h-auto min-h-16 py-2")} value={rascunho.mercado.sazonalidade} onChange={(e) => muda("mercado", "sazonalidade", e.target.value)} /></Campo>
            <Campo rotulo="Datas do nicho (uma por linha: AAAA-MM-DD Nome)"><textarea className={juntar(campo, "h-auto min-h-16 py-2")} placeholder={"2026-11-27 Black Friday\n12-24 Véspera de Natal"} value={datas} onChange={(e) => setDatas(e.target.value)} /></Campo>
            <Campo rotulo="Dias entre o primeiro contato e a compra"><input className={campo} inputMode="numeric" value={textoDoNumero(rascunho.mercado.ciclo_de_compra_dias)} onChange={(e) => muda("mercado", "ciclo_de_compra_dias", numeroDoCampo(e.target.value))} /></Campo>
          </fieldset>

          <fieldset className="grid min-w-0 gap-3 sm:grid-cols-2">
            <legend className="mb-2 text-[13px] font-semibold">C00 Comportamento e C07 Fonte que prevalece</legend>
            <Campo rotulo="Como o dono quer que o agente se comporte"><textarea className={juntar(campo, "h-auto min-h-16 py-2")} value={rascunho.comportamento.observacoes} onChange={(e) => muda("comportamento", "observacoes", e.target.value)} /></Campo>
            <Campo rotulo="Quando a Meta e outra fonte discordam, vale">
              <select className={campo} value={rascunho.dados.fonte_que_prevalece} onChange={(e) => muda("dados", "fonte_que_prevalece", e.target.value)}>
                {FONTES.map((s) => <option key={s.valor} value={s.valor}>{s.rotulo}</option>)}
              </select>
            </Campo>
          </fieldset>

          <div className="flex gap-2">
            <Button type="button" size="sm" className="h-8" onClick={() => void salvar()} disabled={salvando}>
              {salvando && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />} Salvar memória
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-8" onClick={() => setEditando(false)} disabled={salvando}>Cancelar</Button>
          </div>
        </div>
      ) : (
        <div className="min-w-0 divide-y divide-border border-y border-border">
          {m.camadas.map((c) => (
            <details key={c.id} className="group min-w-0 py-2" open={c.id === "C01"}>
              <summary className={juntar("flex cursor-pointer list-none items-baseline gap-2 rounded text-[13px]", foco)}>
                <span className="font-mono text-[11px] text-muted-foreground">{c.id}</span>
                <span className="font-medium">{c.titulo}</span>
                <span className="text-[11px] text-muted-foreground">{c.fonte}</span>
              </summary>
              <ul className="mt-1.5 min-w-0 space-y-1 pl-9 text-[12.5px] leading-5 text-muted-foreground">
                {c.linhas.map((l, i) => <li key={i} className="break-words">{l}</li>)}
              </ul>
            </details>
          ))}
        </div>
      )}
    </div>
  );
}
