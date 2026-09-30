import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { BellRing, FileSignature, Loader2 } from "lucide-react";
import FaixaDeNumeros from "@/components/sistema/FaixaDeNumeros";
import { botao, juntar, lista, texto } from "@/components/sistema/estilos";
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
    <div className="min-w-0 space-y-3" data-painel-dos-contratos="">
      <FaixaDeNumeros
        rotulo="Painel dos contratos"
        tamanho="compacto"
        colunas={4}
        itens={[
          { rotulo: `A vencer em ${d.janela_dias} dias`, valor: p.aVencer.length, ponto: p.aVencer.some((x) => x.dias < 0) ? "perigo" : p.aVencer.length ? "alerta" : "neutro", aoClicar: p.aVencer.length ? () => alternar("vencer") : undefined, dica: "Ver quais" },
          { rotulo: "Esperando assinatura", valor: p.pendentes.length, ponto: p.pendentes.some((x) => x.dias >= d.lembrete_dias) ? "alerta" : "neutro", aoClicar: p.pendentes.length ? () => alternar("pendentes") : undefined, dica: "Ver quais" },
          { rotulo: "Assinados no mês", valor: p.assinadosNoMes, ponto: "verde" },
          { rotulo: "Recorrente em vigor", valor: moedaBr(p.recorrenteMensal), apoio: `${p.ativos} ${p.ativos === 1 ? "contrato ativo" : "contratos ativos"}` },
        ]}
      />
      {aberta === "vencer" && p.aVencer.length > 0 && (
        <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Contratos a vencer">
          {p.aVencer.map((x) => (
            <li key={x.id} className="flex min-w-0 items-center">
              <button type="button" className={juntar(lista.linha, "flex min-w-0 flex-1 items-center text-left")} onClick={() => aoAbrir(x.renovacao_id || x.id, x.client_id)}>
                <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>
                  {x.numero} · {x.titulo}
                  <span className={juntar(texto.auxiliar, "ml-2")}>{nomeDoCliente(x.client_id)}</span>
                </span>
                <span className={juntar(texto.auxiliar, "ml-2 min-w-0 shrink truncate", x.dias < 0 ? "text-destructive" : x.dias <= 7 ? "text-warning" : "")}>
                  {dias(x.dias)} · {x.renovacao_id ? "renovação pronta" : "sem renovação"}
                </span>
              </button>
              {!x.renovacao_id && (
                <button
                  type="button"
                  className={juntar(botao.barra, "ml-1")}
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
      )}
      {aberta === "pendentes" && p.pendentes.length > 0 && (
        <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Contratos esperando assinatura">
          {p.pendentes.map((x) => (
            <li key={x.id} className="flex min-w-0 items-center">
              <button type="button" className={juntar(lista.linha, "flex min-w-0 flex-1 items-center text-left")} onClick={() => aoAbrir(x.id, x.client_id)}>
                <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>
                  {x.numero} · {x.titulo}
                  <span className={juntar(texto.auxiliar, "ml-2")}>{nomeDoCliente(x.client_id)}</span>
                </span>
                <span className={juntar(texto.auxiliar, "ml-2 min-w-0 shrink truncate", x.dias >= d.lembrete_dias ? "text-warning" : "")}>
                  há {x.dias} {x.dias === 1 ? "dia" : "dias"}
                  {x.lembrete_em ? ` · lembrete em ${new Date(x.lembrete_em).toLocaleDateString("pt-BR")}` : ""}
                </span>
              </button>
              <button type="button" className={juntar(botao.barra, "ml-1")} onClick={() => setLembrete(x.id)} aria-label={`Lembrete de assinatura de ${x.numero || x.titulo}`} title="Lembrar">
                <BellRing className="h-3.5 w-3.5 sm:mr-1" aria-hidden="true" />
                <span className="hidden sm:inline">Lembrar</span>
              </button>
            </li>
          ))}
        </ul>
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
