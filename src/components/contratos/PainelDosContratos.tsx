import { useQuery } from "@tanstack/react-query";
import FaixaDeNumeros from "@/components/sistema/FaixaDeNumeros";
import { juntar, lista, texto } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { chamarContratos, CHAVES_DOS_CONTRATOS, type RespostaDoPainel } from "@/lib/contratos/api";
import { moedaBr } from "../../../supabase/functions/_shared/contrato-modelo";

/**
 * Painel dos contratos (frente CON2, 30/09): a vencer (com a renovação
 * pronta), esperando assinatura (há quantos dias), assinados no mês e o
 * valor recorrente em vigor. Clicar no número abre a lista; clicar na linha
 * abre o contrato. Só leitura: renovar e lembrar ficam no contrato.
 */
export default function PainelDosContratos({ clientId, nomeDoCliente, aoAbrir }: { clientId: string | null; nomeDoCliente: (id: string) => string; aoAbrir: (id: string, clientId: string) => void }) {
  const consulta = useQuery({ queryKey: CHAVES_DOS_CONTRATOS.painel(clientId), queryFn: () => chamarContratos<RespostaDoPainel>("painel", clientId ? { client_id: clientId } : {}), staleTime: 60_000 });
  const [aberta, setAberta] = useEstadoDaTela<string>(`contratos:painel:${clientId || "todos"}`, "", { validar: (v) => typeof v === "string" });
  const d = consulta.data;
  if (!d) return null;
  const p = d.painel;
  const alternar = (qual: string) => setAberta(aberta === qual ? "" : qual);
  const dias = (n: number) => (n === 0 ? "vence hoje" : n > 0 ? `vence em ${n} ${n === 1 ? "dia" : "dias"}` : `venceu há ${-n} ${n === -1 ? "dia" : "dias"}`);
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
            <li key={x.id}>
              <button type="button" className={juntar(lista.linha, "flex w-full min-w-0 items-center text-left")} onClick={() => aoAbrir(x.renovacao_id || x.id, x.client_id)}>
                <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>
                  {x.numero} · {x.titulo}
                  <span className={juntar(texto.auxiliar, "ml-2")}>{nomeDoCliente(x.client_id)}</span>
                </span>
                <span className={juntar(texto.auxiliar, "ml-2 shrink-0", x.dias < 0 ? "text-destructive" : x.dias <= 7 ? "text-warning" : "")}>
                  {dias(x.dias)} · {x.renovacao_id ? "renovação pronta" : "sem renovação"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {aberta === "pendentes" && p.pendentes.length > 0 && (
        <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Contratos esperando assinatura">
          {p.pendentes.map((x) => (
            <li key={x.id}>
              <button type="button" className={juntar(lista.linha, "flex w-full min-w-0 items-center text-left")} onClick={() => aoAbrir(x.id, x.client_id)}>
                <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>
                  {x.numero} · {x.titulo}
                  <span className={juntar(texto.auxiliar, "ml-2")}>{nomeDoCliente(x.client_id)}</span>
                </span>
                <span className={juntar(texto.auxiliar, "ml-2 shrink-0", x.dias >= d.lembrete_dias ? "text-warning" : "")}>
                  há {x.dias} {x.dias === 1 ? "dia" : "dias"}
                  {x.lembrete_em ? ` · lembrete em ${new Date(x.lembrete_em).toLocaleDateString("pt-BR")}` : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
