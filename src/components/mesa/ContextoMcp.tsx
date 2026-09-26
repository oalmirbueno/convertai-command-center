import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plug } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { textoDoErro } from "@/lib/mesa/api";
import { useMesa } from "./MesaContexto";
import {
  ativarItemMcp,
  chaveDoMcp,
  comItemTrocado,
  filtrarItensMcp,
  lerItensMcp,
  resumoDoMcp,
  ROTULO_DA_FONTE,
  type FonteMcp,
  type ItemMcp,
  type ListaDoMcp,
} from "./mcpDoClienteApi";

const FILTROS: Array<{ valor: FonteMcp | "todas"; rotulo: string }> = [
  { valor: "todas", rotulo: "Tudo" },
  { valor: "orientacao", rotulo: "Orientações" },
  { valor: "dossie", rotulo: "Dossiê" },
  { valor: "memoria", rotulo: "Memórias" },
  { valor: "arquivo", rotulo: "Arquivos" },
  { valor: "rascunho", rotulo: "Rascunhos" },
];

const tamanho = (i: ItemMcp) =>
  i.fonte === "arquivo"
    ? i.tamanho >= 1024 * 1024 ? `${(i.tamanho / (1024 * 1024)).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(i.tamanho / 1024))} KB`
    : `${i.tamanho.toLocaleString("pt-BR")} caracteres`;

const dia = (q: string | null) => (q ? `${q.slice(8, 10)}/${q.slice(5, 7)}/${q.slice(0, 4)}` : "");

/**
 * Área MCP do Contexto do cliente: o que chegou pelo MCP do painel e a chave
 * "vale para o planejamento" de cada item. O agente do Mês e os geradores
 * (Mês, pedido livre, gerador de meses) leem só os itens ligados.
 */
export default function ContextoMcp() {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const [filtro, setFiltro] = useEstadoDaTela<FonteMcp | "todas">(`mesa:contexto:mcp:filtro:${clientId}`, "todas", {
    validar: (v) => FILTROS.some((f) => f.valor === v),
  });
  const [trocando, setTrocando] = useState<string | null>(null);
  const lista = useQuery({ queryKey: chaveDoMcp(clientId), queryFn: () => lerItensMcp(clientId) });

  const trocar = async (i: ItemMcp, ativo: boolean) => {
    const chave = chaveDoMcp(clientId);
    const antes = queryClient.getQueryData<ListaDoMcp>(chave);
    if (antes) queryClient.setQueryData(chave, comItemTrocado(antes, i.fonte, i.id, ativo));
    setTrocando(`${i.fonte}:${i.id}`);
    try {
      await ativarItemMcp(clientId, i.fonte, i.id, ativo);
    } catch (e) {
      if (antes) queryClient.setQueryData(chave, antes);
      toast.error("Não foi possível trocar", { description: textoDoErro(e) });
    } finally {
      setTrocando(null);
    }
  };

  if (lista.isLoading) return <Carregando forma="lista" linhas={3} rotulo="Lendo o que chegou pelo MCP" />;
  if (lista.isError) return <EstadoDeErro descricao={textoDoErro(lista.error)} acao={<button type="button" className="text-[12.5px] underline" onClick={() => void lista.refetch()}>Tentar de novo</button>} />;
  const dados = lista.data || { itens: [], tabela: true };
  const itens = filtrarItensMcp(dados.itens, filtro);

  return (
    <div className="min-w-0 space-y-3" data-area-mcp="">
      <div className="flex min-w-0 flex-wrap items-center">
        <p className="mr-2 min-w-0 flex-1 truncate text-[12px] text-muted-foreground">{resumoDoMcp(dados.itens)}</p>
        <AjudaRecolhida className="mr-2" rotulo="O que é a área MCP">
          O que o ChatGPT, o Codex ou o Hermes mandaram pelo MCP para este cliente. Ligado, o item vale para o planejamento: o agente do mês e os geradores leem. Orientação chega por aceleriq_client_instruction; orientações e dossiê começam ligados.
        </AjudaRecolhida>
        {dados.itens.length > 0 && (
          <SeletorCompacto rotulo="Filtrar o MCP" opcoes={FILTROS.map((f) => ({ valor: f.valor, rotulo: f.rotulo }))} valor={filtro} onEscolher={(v) => setFiltro(v as FonteMcp | "todas")} />
        )}
      </div>
      {!dados.tabela && dados.itens.length > 0 && (
        <p className="text-[11.5px] text-muted-foreground">Valem os padrões (orientações e dossiê ligados). Para trocar, falta aplicar o SQL M-01.</p>
      )}
      {dados.itens.length === 0 ? (
        <EstadoVazio
          compacto
          icone={<Plug className="h-5 w-5" />}
          titulo="Nada chegou pelo MCP"
          descricao="Orientações, dossiê, memórias e arquivos mandados pelo MCP aparecem aqui."
        />
      ) : itens.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">Nada nesta categoria.</p>
      ) : (
        <ul className="divide-y divide-border" aria-label="Itens do MCP">
          {itens.map((i) => {
            const chave = `${i.fonte}:${i.id}`;
            return (
              <li key={chave} className="flex min-w-0 items-start py-2.5" data-item-mcp={chave} data-ativo={i.ativo ? "sim" : "nao"}>
                <div className="mr-3 min-w-0 flex-1">
                  <p className="flex min-w-0 items-center text-[13px]">
                    <span className="mr-1.5 shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10.5px] text-muted-foreground">{ROTULO_DA_FONTE[i.fonte]}</span>
                    <span className="min-w-0 truncate font-medium">{i.titulo}</span>
                  </p>
                  <p className="mt-0.5 truncate text-[12px] text-muted-foreground">
                    {[i.origem, dia(i.quando), tamanho(i)].filter(Boolean).join(" · ")}
                    {i.publico ? ` · público: ${i.publico}` : ""}
                  </p>
                  {i.resumo && <p className="mt-0.5 truncate text-[12px] text-muted-foreground">{i.resumo}</p>}
                </div>
                <Switch
                  checked={i.ativo}
                  disabled={trocando === chave}
                  onCheckedChange={(v) => void trocar(i, v === true)}
                  aria-label={`${i.titulo}: vale para o planejamento`}
                  className="mt-0.5"
                />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
