import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BellRing, FileSignature, Loader2 } from "lucide-react";
import { botao, juntar, texto } from "@/components/sistema/estilos";
import { Avatar, Card, StatCard, StatGrid, StatusDot, StatusPill } from "@/components/ds";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { textoDoErro } from "@/lib/mesa/api";
import { chamarContratos, CHAVES_DOS_CONTRATOS, type RespostaDoPainel } from "@/lib/contratos/api";
import { JanelaDeLembrete } from "./JanelasDoCiclo";
import EsqueletoDoPainel from "./EsqueletoDoPainel";
import { moedaBr } from "../../../supabase/functions/_shared/contrato-modelo";

/**
 * Painel dos contratos (frente CON2, 30/09): a vencer (com a renovação
 * pronta), esperando assinatura (há quantos dias), assinados no mês e o
 * valor recorrente em vigor. Clicar no número abre a lista; clicar na linha
 * abre o contrato (ou a renovação pronta). Lembrar e Preparar renovação são
 * atalhos das mesmas ações do contrato (UXS, 30/09); nada é enviado sozinho:
 * o lembrete continua sendo mensagem pronta que a pessoa envia.
 */

export default function PainelDosContratos({ clientId, nomeDoCliente, aoAbrir }: { clientId: string | null; nomeDoCliente: (id: string) => string; aoAbrir: (id: string, clientId: string) => void }) {
  const qc = useQueryClient();
  const consulta = useQuery({ queryKey: CHAVES_DOS_CONTRATOS.painel(clientId), queryFn: () => chamarContratos<RespostaDoPainel>("painel", clientId ? { client_id: clientId } : {}), staleTime: 60_000 });
  const [aberta, setAberta] = useEstadoDaTela<string>(`contratos:painel:${clientId || "todos"}`, "", { validar: (v) => typeof v === "string" });
  // Uma janela de lembrete só, para a linha escolhida.
  const [lembrete, setLembrete] = useState<string | null>(null);
  const [renovando, setRenovando] = useState<string | null>(null);
  const d = consulta.data;
  if (!d) return consulta.isPending ? <EsqueletoDoPainel /> : null;
  const p = d.painel;
  const alternar = (qual: string) => setAberta(aberta === qual ? "" : qual);
  const dias = (n: number) => (n === 0 ? "vence hoje" : n > 0 ? `vence em ${n} ${n === 1 ? "dia" : "dias"}` : `venceu há ${-n} ${n === -1 ? "dia" : "dias"}`);

  const preparar = async (id: string, cliente: string) => {
    setRenovando(id);
    try {
      const novo = await chamarContratos("renovar", { contract_id: id });
      qc.setQueryData(CHAVES_DOS_CONTRATOS.um(novo.contrato.id), novo);
      void qc.invalidateQueries({ queryKey: CHAVES_DOS_CONTRATOS.painel(clientId) });
      void qc.invalidateQueries({ queryKey: CHAVES_DOS_CONTRATOS.lista });
      toast.success(novo.ja_existia ? "A renovação já estava pronta" : `Renovação ${novo.contrato.numero || ""} em rascunho`, { description: novo.ja_existia ? undefined : "Começa no dia seguinte ao fim deste contrato. Confira os valores." });
      aoAbrir(novo.contrato.id, cliente);
    } catch (e) {
      toast.error("A renovação não foi preparada", { description: textoDoErro(e) });
    } finally {
      setRenovando(null);
    }
  };

  return (
    <div className="min-w-0 space-y-5" data-painel-dos-contratos="">
      {/* Rodada ousada (15/11/2026): os quatro números em cartões (assinados no mês em sólido, recorrente em
          tinta). A vencer e Esperando assinatura continuam abrindo a lista embaixo. */}
      <StatGrid cols={4} label="Painel dos contratos">
        <StatCard
          label={
            <>
              <StatusDot tone={p.aVencer.some((x) => x.dias < 0) ? "danger" : p.aVencer.length ? "warning" : "neutral"} className="mr-2" />
              {`A vencer em ${d.janela_dias} dias`}
            </>
          }
          value={p.aVencer.length}
          hint={p.aVencer.length ? (aberta === "vencer" ? "recolher" : "ver quais") : "nada a vencer"}
          onClick={p.aVencer.length ? () => alternar("vencer") : undefined}
          className={juntar("max-sm:[&_.truncate]:whitespace-normal", aberta === "vencer" && "ring-2 ring-foreground")}
        />
        <StatCard
          label={
            <>
              <StatusDot tone={p.pendentes.some((x) => x.dias >= d.lembrete_dias) ? "warning" : "neutral"} className="mr-2" />
              Esperando assinatura
            </>
          }
          value={p.pendentes.length}
          hint={p.pendentes.length ? (aberta === "pendentes" ? "recolher" : "ver quais") : "nada pendente"}
          onClick={p.pendentes.length ? () => alternar("pendentes") : undefined}
          className={juntar("max-sm:[&_.truncate]:whitespace-normal", aberta === "pendentes" && "ring-2 ring-foreground")}
        />
        <StatCard variant="accent" label="Assinados no mês" value={p.assinadosNoMes} />
        <StatCard variant="ink" label="Recorrente em vigor" value={moedaBr(p.recorrenteMensal)} hint={`${p.ativos} ${p.ativos === 1 ? "contrato ativo" : "contratos ativos"}`} />
      </StatGrid>
      {aberta === "vencer" && p.aVencer.length > 0 && (
        <Card title="A vencer" subtitle={`${p.aVencer.length} ${p.aVencer.length === 1 ? "contrato" : "contratos"} nos próximos ${d.janela_dias} dias`} flush>
        <ul className="min-w-0 px-2 pb-2" aria-label="Contratos a vencer">
          {p.aVencer.map((x) => (
            <li key={x.id} className="flex min-w-0 items-center rounded-md px-2 transition-colors hover:bg-muted/50">
              <button type="button" className="flex min-w-0 flex-1 items-center py-3.5 text-left" onClick={() => aoAbrir(x.renovacao_id || x.id, x.client_id)}>
                <Avatar name={nomeDoCliente(x.client_id)} className="mr-3 max-sm:hidden" />
                <span className="block min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold leading-5 tracking-[-0.01em] text-foreground">
                    {x.numero} · {x.titulo}
                  </span>
                  <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")}>{nomeDoCliente(x.client_id)}</span>
                </span>
                <StatusPill tone={x.dias < 0 ? "danger" : x.dias <= 7 ? "warning" : "neutral"} className="ml-3 min-w-0 shrink">
                  {dias(x.dias)} · {x.renovacao_id ? "renovação pronta" : "sem renovação"}
                </StatusPill>
              </button>
              {!x.renovacao_id && (
                <button
                  type="button"
                  className={juntar(botao.barra, "ml-2 bg-foreground font-medium text-background hover:bg-foreground/90 hover:text-background")}
                  onClick={() => void preparar(x.id, x.client_id)}
                  disabled={renovando === x.id}
                  aria-label={`Preparar renovação de ${x.numero || x.titulo}`}
                  title="Preparar renovação"
                >
                  {renovando === x.id ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-1" aria-hidden="true" /> : <FileSignature className="h-3.5 w-3.5 sm:mr-1" aria-hidden="true" />}
                  <span className="hidden sm:inline">Preparar renovação</span>
                </button>
              )}
            </li>
          ))}
        </ul>
        </Card>
      )}
      {aberta === "pendentes" && p.pendentes.length > 0 && (
        <Card title="Esperando assinatura" subtitle={`${p.pendentes.length} ${p.pendentes.length === 1 ? "contrato" : "contratos"}`} flush>
        <ul className="min-w-0 px-2 pb-2" aria-label="Contratos esperando assinatura">
          {p.pendentes.map((x) => (
            <li key={x.id} className="flex min-w-0 items-center rounded-md px-2 transition-colors hover:bg-muted/50">
              <button type="button" className="flex min-w-0 flex-1 items-center py-3.5 text-left" onClick={() => aoAbrir(x.id, x.client_id)}>
                <Avatar name={nomeDoCliente(x.client_id)} className="mr-3 max-sm:hidden" />
                <span className="block min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-semibold leading-5 tracking-[-0.01em] text-foreground">
                    {x.numero} · {x.titulo}
                  </span>
                  <span className={juntar(texto.auxiliar, "mt-0.5 block truncate")}>{nomeDoCliente(x.client_id)}</span>
                </span>
                <StatusPill tone={x.dias >= d.lembrete_dias ? "warning" : "neutral"} className="ml-3 min-w-0 shrink">
                  há {x.dias} {x.dias === 1 ? "dia" : "dias"}
                  {x.lembrete_em ? ` · lembrete em ${new Date(x.lembrete_em).toLocaleDateString("pt-BR")}` : ""}
                </StatusPill>
              </button>
              <button type="button" className={juntar(botao.barra, "ml-2 bg-muted text-foreground")} onClick={() => setLembrete(x.id)} aria-label={`Lembrete de assinatura de ${x.numero || x.titulo}`} title="Lembrar">
                <BellRing className="h-3.5 w-3.5 sm:mr-1" aria-hidden="true" />
                <span className="hidden sm:inline">Lembrar</span>
              </button>
            </li>
          ))}
        </ul>
        </Card>
      )}
      {lembrete && (
        <JanelaDeLembrete
          aberta
          contratoId={lembrete}
          aoFechar={() => {
            setLembrete(null);
            // O "lembrete em dd/mm" da linha atualiza.
            void qc.invalidateQueries({ queryKey: CHAVES_DOS_CONTRATOS.painel(clientId) });
          }}
        />
      )}
    </div>
  );
}
