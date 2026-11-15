import { useMemo, useState } from "react";
import { CampoDeBusca, foco, juntar, texto } from "@/components/sistema";
import type { FaixaDaEsteira } from "@/lib/esteiraLinha/esteiraLinha";
import {
  alternarCliente, buscarClientesPeloNome, corDeApoioDoCliente, escolherModo, prioritariosDeHoje, type FiltroDeClientes,
} from "@/lib/esteiraLinha/filtroDeClientes";

/** Chip do seletor: 32 px de altura, no padrão dos botões compactos do sistema. */
const CHIP = juntar(
  "toque-compacto inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full border px-3 text-[12px] font-medium transition-colors",
  foco,
);
const LIGADO = "border-primary bg-primary/10 text-foreground";
const DESLIGADO = "border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground";

/**
 * "Clientes da Esteira": escolhe quais faixas aparecem. "Todos" e "Só
 * prioritários hoje" são modos; os chips dos clientes são multi-seleção.
 * No celular a fileira de chips rola na horizontal sem alargar a página.
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

  const resumo = filtro.modo === "todos" ? `Mostrando todos os ${faixas.length} clientes.`
    : filtro.modo === "prioritarios_hoje" ? `Mostrando só quem tem dia prioritário hoje (${quantosHoje}).`
      : `Mostrando ${escolhidos.size} de ${faixas.length} clientes.`;

  return (
    <section aria-labelledby="clientes-da-esteira-titulo" className="min-w-0 space-y-2" data-seletor-de-clientes={filtro.modo}>
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 id="clientes-da-esteira-titulo" className="text-[14px] font-medium leading-5 text-foreground">Clientes da Esteira</h2>
          <p className={texto.auxiliar} role="status" data-resumo-do-filtro="">{resumo}</p>
        </div>
        <CampoDeBusca valor={busca} onMudar={setBusca} placeholder="Buscar cliente" rotulo="Buscar cliente na Esteira" className="w-full sm:w-64" />
      </div>

      <div
        role="group"
        aria-label="Clientes da Esteira"
        className="-mx-1 flex min-w-0 flex-nowrap gap-1.5 overflow-x-auto px-1 pb-1 sm:flex-wrap sm:overflow-visible"
        data-chips-de-clientes=""
      >
        <button type="button" className={juntar(CHIP, filtro.modo === "todos" ? LIGADO : DESLIGADO)} aria-pressed={filtro.modo === "todos"} onClick={() => onMudar(escolherModo("todos"))}>
          Todos
        </button>
        <button
          type="button"
          className={juntar(CHIP, filtro.modo === "prioritarios_hoje" ? LIGADO : DESLIGADO)}
          aria-pressed={filtro.modo === "prioritarios_hoje"}
          onClick={() => onMudar(escolherModo("prioritarios_hoje"))}
        >
          Só prioritários hoje
          <span className="ml-1.5 tabular-nums text-muted-foreground">{quantosHoje}</span>
        </button>
        <span className="mx-1 w-px shrink-0 self-stretch bg-border" aria-hidden="true" />
        {achados.map((f) => {
          const ligado = escolhidos.has(f.clientId);
          return (
            <button
              key={f.clientId}
              type="button"
              className={juntar(CHIP, ligado ? LIGADO : DESLIGADO)}
              aria-pressed={ligado}
              onClick={() => onMudar(alternarCliente(filtro, f.clientId))}
              data-chip-do-cliente={f.clientId}
            >
              <span className={juntar("mr-1.5 h-2 w-2 rounded-full", corDeApoioDoCliente(f.clientId).ponto)} aria-hidden="true" />
              {f.nome}
            </button>
          );
        })}
        {achados.length === 0 && <p className={juntar(texto.auxiliar, "self-center whitespace-nowrap")}>Nenhum cliente com esse nome.</p>}
      </div>
    </section>
  );
}
