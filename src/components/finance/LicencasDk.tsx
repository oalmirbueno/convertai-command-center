import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CircleDollarSign, Percent, RefreshCw, Wallet } from "lucide-react";
import { DataTable, HelpTooltip, StatCard, StatGrid, StatusPill, type DataColumn } from "@/components/ds";
import { EstadoDeErro, EstadoVazio, Secao, botao, juntar, texto } from "@/components/sistema";
import { lerEstado, lerLicencas, rotuloDaForma, sincronizarAgora, totaisPorMes, type Mes, type PagamentoDeLicenca } from "@/lib/licencasDk";

const reais = (v: number) => Number(v || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const diaBr = (iso: string | null | undefined) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : "—");
const nomeDoMes = (mes: string) => {
  const [a, m] = mes.split("-").map(Number);
  const n = new Date(a, m - 1, 1).toLocaleDateString("pt-BR", { month: "long" });
  return `${n.charAt(0).toUpperCase()}${n.slice(1)} de ${a}`;
};
const AJUDA =
  "Pagamentos das licenças da plataforma DK Sorteios que caem no Asaas da Aceleriq (referência LIC…). O painel confere o Asaas a cada 10 minutos e grava cada pagamento uma vez só. Bruto é o que o usuário pagou, taxa é o que o Asaas cobrou e líquido é o que fica. Estornos aparecem na lista e ficam fora dos totais. Área interna: o cliente não vê.";

const COLUNAS_DO_MES: DataColumn<Mes>[] = [
  { key: "mes", header: "Mês", cell: (m) => nomeDoMes(m.mes) },
  { key: "pagamentos", header: "Pagamentos", numeric: true, cell: (m) => m.pagamentos },
  { key: "bruto", header: "Bruto", numeric: true, cell: (m) => reais(m.bruto) },
  { key: "taxas", header: "Taxas", numeric: true, cell: (m) => reais(m.taxas) },
  { key: "liquido", header: "Líquido", numeric: true, cell: (m) => <span className="font-medium">{reais(m.liquido)}</span> },
];

const COLUNAS_DOS_PAGAMENTOS: DataColumn<PagamentoDeLicenca>[] = [
  { key: "data", header: "Data", cell: (p) => diaBr(p.recebido_em) },
  { key: "forma", header: "Forma", cell: (p) => rotuloDaForma(p.forma) },
  {
    key: "situacao",
    header: "Situação",
    hideOnMobile: true,
    cell: (p) =>
      p.situacao === "estornado" ? <StatusPill tone="danger" plain>Estornado</StatusPill> : p.situacao === "confirmado" ? <StatusPill tone="warning" plain>A cair</StatusPill> : <StatusPill tone="success" plain>Recebido</StatusPill>,
  },
  { key: "valor", header: "Valor", numeric: true, cell: (p) => reais(Number(p.bruto)) },
  { key: "taxa", header: "Taxa", numeric: true, cell: (p) => reais(Number(p.taxa)) },
  { key: "liquido", header: "Líquido", numeric: true, cell: (p) => reais(Number(p.liquido)) },
];

/**
 * Financeiro › Licenças DK (19/11/2026, só admin): soma ao Financeiro v1 sem mexer nele. Por mês, bruto, taxas e
 * líquido; embaixo, a lista dos pagamentos do mês escolhido.
 */
export default function LicencasDk() {
  const qc = useQueryClient();
  const [sincronizando, setSincronizando] = useState(false);
  const licencas = useQuery({ queryKey: ["licencas-dk", "pagamentos"], queryFn: lerLicencas });
  const estado = useQuery({ queryKey: ["licencas-dk", "estado"], queryFn: lerEstado });
  const meses = useMemo(() => totaisPorMes(licencas.data || []), [licencas.data]);
  const [mesEscolhido, setMesEscolhido] = useState<string | null>(null);
  const mes = mesEscolhido || meses[0]?.mes || null;
  const doMes = meses.find((m) => m.mes === mes) || null;
  const pagamentosDoMes = (licencas.data || []).filter((p) => mes && String(p.recebido_em).startsWith(mes));

  const sincronizar = async () => {
    setSincronizando(true);
    try {
      const r = await sincronizarAgora();
      toast.success(r.gravados ? `${r.gravados} ${r.gravados === 1 ? "pagamento conferido" : "pagamentos conferidos"} no Asaas.` : "Nenhum pagamento de licença novo no Asaas.");
      await qc.invalidateQueries({ queryKey: ["licencas-dk"] });
    } catch (e) {
      toast.error(`Não foi possível sincronizar: ${(e as Error).message}`.slice(0, 200));
    } finally {
      setSincronizando(false);
    }
  };

  const ultima = estado.data?.ultima_sincronizacao ? new Date(estado.data.ultima_sincronizacao).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : null;

  return (
    <div className="min-w-0 space-y-6" data-licencas-dk="">
      <div className="flex min-w-0 flex-wrap items-center">
        {meses.length > 0 && (
          <select
            className="h-9 rounded-full border border-border bg-background px-3 text-[13px]"
            value={mes || ""}
            onChange={(e) => setMesEscolhido(e.target.value)}
            aria-label="Mês"
          >
            {meses.map((m) => (
              <option key={m.mes} value={m.mes}>
                {nomeDoMes(m.mes)}
              </option>
            ))}
          </select>
        )}
        <span className={juntar(texto.auxiliar, "ml-3 min-w-0 flex-1 truncate")}>
          {estado.data?.ultimo_erro ? <span className="text-destructive">Última conferência falhou: {estado.data.ultimo_erro}</span> : ultima ? `Conferido no Asaas em ${ultima}` : "Ainda não conferido no Asaas"}
        </span>
        <HelpTooltip className="ml-1" title="Licenças DK">{AJUDA}</HelpTooltip>
        <button type="button" className={juntar(botao.secundario, "ml-2 h-8")} onClick={() => void sincronizar()} disabled={sincronizando} aria-label="Sincronizar com o Asaas" data-sincronizar-licencas="">
          <RefreshCw className={juntar("h-4 w-4 sm:mr-1.5", sincronizando && "animate-spin")} aria-hidden="true" />
          <span className="hidden sm:inline">{sincronizando ? "Conferindo…" : "Sincronizar"}</span>
        </button>
      </div>

      {licencas.isError ? (
        <EstadoDeErro titulo="Não foi possível carregar as licenças." acao={<button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void licencas.refetch()}>Tentar de novo</button>} />
      ) : (
        <>
          <StatGrid label="Licenças DK no mês">
            <StatCard size="md" variant="ink" icon={<CircleDollarSign className="h-4 w-4" />} label="Bruto" value={reais(doMes?.bruto || 0)} hint={doMes ? `${doMes.pagamentos} ${doMes.pagamentos === 1 ? "pagamento" : "pagamentos"}` : "sem pagamento"} />
            <StatCard size="md" icon={<Percent className="h-4 w-4" />} label="Taxas do Asaas" value={reais(doMes?.taxas || 0)} />
            <StatCard size="md" icon={<Wallet className="h-4 w-4" />} label="Líquido" value={reais(doMes?.liquido || 0)} hint={doMes?.estornados ? `${doMes.estornados} estornado(s) fora da conta` : undefined} />
          </StatGrid>

          <Secao titulo="Por mês" recolher="financeiro:licencas-dk:meses">
            <DataTable caption="Licenças DK por mês" columns={COLUNAS_DO_MES} rows={meses} rowKey={(m) => m.mes} onRowClick={(m) => setMesEscolhido(m.mes)} dense empty={<EstadoVazio compacto titulo={licencas.isLoading ? "Carregando…" : "Nenhum pagamento de licença ainda."} />} />
          </Secao>

          <Secao titulo={mes ? `Pagamentos de ${nomeDoMes(mes)}` : "Pagamentos"} descricao={`${pagamentosDoMes.length}`}>
            <DataTable caption="Pagamentos de licença" columns={COLUNAS_DOS_PAGAMENTOS} rows={pagamentosDoMes} rowKey={(p) => p.asaas_pagamento_id} dense empty={<EstadoVazio compacto titulo="Nenhum pagamento neste mês." />} />
          </Secao>
        </>
      )}
    </div>
  );
}
