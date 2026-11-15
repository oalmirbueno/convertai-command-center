import { useMemo, useState } from "react";
import { Check, ChevronDown, Users } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CampoDeBusca, botao, foco, juntar, texto } from "@/components/sistema";
import type { FaixaDaEsteira } from "@/lib/esteiraLinha/esteiraLinha";
import {
  alternarCliente, buscarClientesPeloNome, corDeApoioDoCliente, escolherModo, prioritariosDeHoje, type FiltroDeClientes,
} from "@/lib/esteiraLinha/filtroDeClientes";

/** Linha do seletor: 32 px de altura, no padrão dos botões compactos do sistema. */
const OPCAO = juntar(
  "toque-compacto flex h-8 w-full min-w-0 items-center rounded-md px-2 text-left text-[13px] transition-colors",
  foco,
);
const LIGADA = "bg-primary/10 font-medium text-foreground";
const DESLIGADA = "text-muted-foreground hover:bg-muted hover:text-foreground";

/** O que o botão da barra diz: curto, numa linha. */
function rotuloDoSeletor(filtro: FiltroDeClientes, faixas: Pick<FaixaDaEsteira, "clientId" | "nome">[]): string {
  if (filtro.modo === "todos") return "Todos os clientes";
  if (filtro.modo === "prioritarios_hoje") return "Prioritários hoje";
  if (filtro.ids.length === 1) return faixas.find((f) => f.clientId === filtro.ids[0])?.nome ?? "1 cliente";
  return `${filtro.ids.length} clientes`;
}

/**
 * "Clientes da Esteira" (limpeza de 14/11/2026, 21h53): um botão só na barra
 * do topo, ao lado do período, que abre a escolha. Dentro: "Todos", "Só
 * prioritários hoje", a busca e os clientes (multi-seleção). A escolha fica
 * lembrada no aparelho (filtroDeClientes.ts).
 */
export default function SeletorDeClientes({
  faixas,
  filtro,
  diaDeHoje,
  onMudar,
}: {
  /** A carteira inteira, na ordem da grade. */
  faixas: FaixaDaEsteira[];
  filtro: FiltroDeClientes;
  diaDeHoje: number;
  onMudar: (f: FiltroDeClientes) => void;
}) {
  const [busca, setBusca] = useState("");
  const achados = useMemo(() => buscarClientesPeloNome(faixas, busca), [faixas, busca]);
  const quantosHoje = useMemo(() => prioritariosDeHoje(faixas, diaDeHoje).length, [faixas, diaDeHoje]);
  const escolhidos = new Set(filtro.modo === "clientes" ? filtro.ids : []);
  const rotulo = rotuloDoSeletor(filtro, faixas);

  const resumo = filtro.modo === "todos" ? `Mostrando todos os ${faixas.length} clientes.`
    : filtro.modo === "prioritarios_hoje" ? `Mostrando só quem tem dia prioritário hoje (${quantosHoje}).`
      : `Mostrando ${escolhidos.size} de ${faixas.length} clientes.`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={juntar(botao.secundario, "h-8 max-w-[220px] px-2.5", filtro.modo !== "todos" && "border-primary/60")}
          aria-label={`Clientes da Esteira: ${rotulo}`}
          title={resumo}
          data-seletor-de-clientes={filtro.modo}
        >
          <Users className="mr-1.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 truncate">{rotulo}</span>
          <ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[300px] p-2">
        <section aria-labelledby="clientes-da-esteira-titulo" className="min-w-0 space-y-2">
          <div className="px-1">
            <h2 id="clientes-da-esteira-titulo" className="text-[13px] font-medium leading-5 text-foreground">Clientes da Esteira</h2>
            <p className={texto.auxiliar} role="status" data-resumo-do-filtro="">{resumo}</p>
          </div>
          <div role="group" aria-label="Clientes da Esteira" className="space-y-0.5" data-chips-de-clientes="">
            <button type="button" className={juntar(OPCAO, filtro.modo === "todos" ? LIGADA : DESLIGADA)} aria-pressed={filtro.modo === "todos"} onClick={() => onMudar(escolherModo("todos"))}>
              <span className="min-w-0 flex-1 truncate">Todos</span>
              {filtro.modo === "todos" && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
            </button>
            <button
              type="button"
              className={juntar(OPCAO, filtro.modo === "prioritarios_hoje" ? LIGADA : DESLIGADA)}
              aria-pressed={filtro.modo === "prioritarios_hoje"}
              onClick={() => onMudar(escolherModo("prioritarios_hoje"))}
            >
              <span className="min-w-0 flex-1 truncate">Só prioritários hoje</span>
              <span className="ml-1.5 tabular-nums text-muted-foreground">{quantosHoje}</span>
            </button>
            <div className="py-1">
              <CampoDeBusca valor={busca} onMudar={setBusca} placeholder="Buscar cliente" rotulo="Buscar cliente na Esteira" className="w-full" />
            </div>
            <div className="max-h-[50vh] overflow-y-auto overscroll-contain" data-lista-de-clientes="">
              {achados.map((f) => {
                const ligado = escolhidos.has(f.clientId);
                return (
                  <button
                    key={f.clientId}
                    type="button"
                    className={juntar(OPCAO, ligado ? LIGADA : DESLIGADA)}
                    aria-pressed={ligado}
                    onClick={() => onMudar(alternarCliente(filtro, f.clientId))}
                    data-chip-do-cliente={f.clientId}
                  >
                    <span className={juntar("mr-2 h-2 w-2 shrink-0 rounded-full", corDeApoioDoCliente(f.clientId).ponto)} aria-hidden="true" />
                    <span className="min-w-0 flex-1 truncate">{f.nome}</span>
                    {ligado && <Check className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
                  </button>
                );
              })}
              {achados.length === 0 && <p className={juntar(texto.auxiliar, "px-2 py-1.5")}>Nenhum cliente com esse nome.</p>}
            </div>
          </div>
        </section>
      </PopoverContent>
    </Popover>
  );
}
