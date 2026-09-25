import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { ArrowLeft, Building2, Check, ChevronsUpDown, Loader2, RotateCcw, Search, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/contexts/AuthContext";
import { filtrarPorBusca, NOME_DA_MESA, REGRA_DA_MESA, type ClienteBruto, type ClienteDaMesa, type MesaDeClientes } from "./clientesDaMesa";
import { useClientesDaMesa } from "./useClientesDaMesa";

/**
 * Seletor de cliente das mesas (Mesa, Mesa Ads, Mesa Foto). Mostra só os
 * clientes desta mesa (padrão + escolha da equipe, ver clientesDaMesa.ts), em
 * ordem alfabética, com busca. Admin e gestor têm "Gerenciar clientes" no pé
 * da lista: incluir ou retirar qualquer cliente, como o "Quem entra" do Ciclo.
 * A escolha vai para o banco e vale para a equipe toda.
 *
 * O cliente aberto pelo endereço continua abrindo mesmo fora da mesa (vindo de
 * outra mesa pela troca rápida, por exemplo): ele aparece na lista com a nota
 * "fora desta mesa".
 */
export default function SeletorDeClientesDaMesa({
  mesa,
  clientesBrutos,
  valor,
  nome,
  carregando,
  onEscolher,
}: {
  mesa: MesaDeClientes;
  clientesBrutos: ClienteBruto[] | null | undefined;
  valor: string;
  nome: string;
  carregando: boolean;
  onEscolher: (id: string) => void;
}) {
  const { profile } = useAuth();
  const role = (profile && profile.role) || "";
  const podeGerenciar = role === "admin" || role === "manager";
  const { todos, visiveis, mostrandoTodos, definir } = useClientesDaMesa(mesa, clientesBrutos);

  const [aberto, setAberto] = useState(false);
  const [gerenciando, setGerenciando] = useState(false);
  const [busca, setBusca] = useState("");
  const [ativo, setAtivo] = useState(0);
  const [gravando, setGravando] = useState<string | null>(null);
  const lista = useRef<HTMLUListElement>(null);

  // O cliente aberto entra na lista mesmo fora da mesa, no lugar dele na ordem.
  const daLista = useMemo(() => {
    if (!valor || visiveis.some((c) => c.id === valor)) return visiveis;
    const atual = todos.find((c) => c.id === valor);
    if (!atual) return visiveis;
    const i = visiveis.findIndex((c) => c.nome.localeCompare(atual.nome, "pt-BR") > 0);
    const copia = visiveis.slice();
    copia.splice(i < 0 ? copia.length : i, 0, atual);
    return copia;
  }, [todos, visiveis, valor]);
  const filtrados = useMemo(() => filtrarPorBusca(daLista, busca), [daLista, busca]);
  const paraGerenciar = useMemo(() => filtrarPorBusca(todos, busca), [todos, busca]);
  const naMesa = paraGerenciar.filter((c) => c.naMesa);
  const fora = paraGerenciar.filter((c) => !c.naMesa);

  useEffect(() => {
    if (!aberto) return;
    setBusca("");
    setGerenciando(false);
    const i = daLista.findIndex((c) => c.id === valor);
    setAtivo(i >= 0 ? i : 0);
    // Só ao abrir: a lista relida enquanto está aberta não mexe no item ativo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto]);

  useEffect(() => {
    const el = lista.current ? (lista.current.querySelector(`[data-indice="${ativo}"]`) as HTMLElement | null) : null;
    if (el && typeof el.scrollIntoView === "function") {
      try {
        el.scrollIntoView({ block: "nearest" });
      } catch {
        /* navegador antigo: segue sem rolar */
      }
    }
  }, [ativo]);

  const escolher = (id: string) => {
    setAberto(false);
    if (id !== valor) onEscolher(id);
  };

  const teclas = (e: KeyboardEvent<HTMLInputElement>) => {
    if (gerenciando) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setAtivo((a) => Math.min(filtrados.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setAtivo((a) => Math.max(0, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const c = filtrados[ativo] || filtrados[0];
      if (c) escolher(c.id);
    }
  };

  const alternar = async (c: ClienteDaMesa, querNaMesa: boolean) => {
    setGravando(c.id);
    const erro = await definir(c, querNaMesa);
    setGravando(null);
    if (erro) toast.error("Escolha não gravada", { description: erro });
  };

  const rotulo = valor ? nome || "Carregando..." : carregando ? "Carregando clientes..." : "Escolha o cliente";

  const linhaDeGerenciar = (c: ClienteDaMesa) => (
    <li key={c.id} className="flex min-w-0 items-center rounded-md px-2 py-1.5" data-cliente-da-mesa={c.id}>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] text-foreground">{c.nome}</span>
        <span className="block truncate text-[10.5px] text-muted-foreground">{c.motivo}</span>
      </span>
      {c.escolha && (
        <button
          type="button"
          title="Voltar ao padrão da mesa"
          aria-label={`Voltar ${c.nome} ao padrão da mesa`}
          disabled={gravando === c.id}
          onClick={() => void alternar(c, c.padrao)}
          className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          <RotateCcw className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        aria-label={`${c.naMesa ? "Retirar" : "Incluir"} ${c.nome}`}
        disabled={gravando === c.id}
        onClick={() => void alternar(c, !c.naMesa)}
        className={`ml-1 inline-flex h-7 shrink-0 items-center rounded-md border px-2 text-[11.5px] transition-colors disabled:opacity-50 ${
          c.naMesa ? "border-border text-muted-foreground hover:border-destructive/50 hover:text-foreground" : "border-primary/40 text-primary hover:bg-primary/5"
        }`}
      >
        {gravando === c.id && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
        {c.naMesa ? "Retirar" : "Incluir"}
      </button>
    </li>
  );

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={aberto}
          aria-haspopup="listbox"
          aria-label={valor ? `Cliente: ${rotulo}. Trocar de cliente` : "Escolher o cliente"}
          className="flex h-8 min-w-0 max-w-full items-center rounded-lg border border-border bg-card px-2.5 text-left text-[13px] font-semibold text-foreground transition-colors hover:border-primary/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:max-w-[240px]"
        >
          <Building2 className="mr-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span className={`min-w-0 flex-1 truncate ${valor ? "" : "font-normal text-muted-foreground"}`}>{rotulo}</span>
          <ChevronsUpDown className="ml-1.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-[calc(100vw-24px)] max-w-[340px] p-0">
        {gerenciando && (
          <div className="flex min-w-0 items-start border-b border-border px-2 py-2">
            <button
              type="button"
              aria-label="Voltar à lista de clientes"
              onClick={() => {
                setGerenciando(false);
                setBusca("");
              }}
              className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
            </button>
            <div className="min-w-0 pt-0.5">
              <p className="text-[12.5px] font-semibold">Clientes da {NOME_DA_MESA[mesa]}</p>
              <p className="text-[11px] leading-snug text-muted-foreground">{REGRA_DA_MESA[mesa]} Inclua ou retire quem quiser. Vale para a equipe toda.</p>
            </div>
          </div>
        )}
        <div className="flex items-center border-b border-border px-2.5">
          <Search className="mr-2 h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={busca}
            onChange={(e) => {
              setBusca(e.target.value);
              setAtivo(0);
            }}
            onKeyDown={teclas}
            placeholder="Buscar cliente"
            aria-label="Buscar cliente"
            aria-controls={gerenciando ? undefined : `mesa-${mesa}-lista-de-clientes`}
            className="h-10 min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
        </div>

        {gerenciando ? (
          <div className="max-h-[50vh] overflow-y-auto overscroll-contain p-1" data-gerenciar-clientes={mesa}>
            {naMesa.length > 0 && (
              <>
                <p className="px-2 pb-0.5 pt-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Na mesa ({naMesa.length})</p>
                <ul aria-label="Clientes na mesa">{naMesa.map(linhaDeGerenciar)}</ul>
              </>
            )}
            {fora.length > 0 && (
              <>
                <p className="px-2 pb-0.5 pt-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">Fora da mesa ({fora.length})</p>
                <ul aria-label="Clientes fora da mesa">{fora.map(linhaDeGerenciar)}</ul>
              </>
            )}
            {paraGerenciar.length === 0 && <p className="px-2 py-3 text-[12.5px] text-muted-foreground">Nenhum cliente com essa busca.</p>}
          </div>
        ) : (
          <>
            <ul id={`mesa-${mesa}-lista-de-clientes`} ref={lista} role="listbox" aria-label="Clientes" className="max-h-[50vh] overflow-y-auto overscroll-contain p-1">
              {carregando && daLista.length === 0 && (
                <li className="flex items-center px-2 py-3 text-[12.5px] text-muted-foreground">
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Carregando clientes...
                </li>
              )}
              {!carregando && filtrados.length === 0 && <li className="px-2 py-3 text-[12.5px] text-muted-foreground">Nenhum cliente com essa busca.</li>}
              {filtrados.map((c, i) => {
                const foraDaMesa = !mostrandoTodos && !c.naMesa;
                return (
                  <li key={c.id} role="option" aria-selected={c.id === valor} data-indice={i}>
                    <button
                      type="button"
                      onClick={() => escolher(c.id)}
                      onMouseMove={() => setAtivo(i)}
                      className={`flex w-full min-w-0 items-center rounded-md px-2 py-1.5 text-left text-[13px] ${i === ativo ? "bg-muted text-foreground" : "text-foreground/90"}`}
                    >
                      <span className="min-w-0 flex-1 truncate">{c.nome}</span>
                      {foraDaMesa && (
                        <span aria-hidden="true" className="ml-2 shrink-0 text-[10.5px] text-muted-foreground">
                          fora desta mesa
                        </span>
                      )}
                      {c.id === valor && <Check className="ml-2 h-3.5 w-3.5 shrink-0 text-primary" />}
                    </button>
                  </li>
                );
              })}
            </ul>
            {(mostrandoTodos || podeGerenciar) && (
              <div className="flex min-w-0 items-center border-t border-border px-2 py-1.5">
                <p className="min-w-0 flex-1 truncate text-[10.5px] text-muted-foreground">
                  {mostrandoTodos ? "Ninguém no padrão desta mesa. Mostrando todos." : `${visiveis.length} ${visiveis.length === 1 ? "cliente" : "clientes"} nesta mesa`}
                </p>
                {podeGerenciar && (
                  <button
                    type="button"
                    onClick={() => {
                      setGerenciando(true);
                      setBusca("");
                    }}
                    className="ml-2 inline-flex h-7 shrink-0 items-center rounded-md px-1.5 text-[11.5px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <Settings2 className="mr-1 h-3.5 w-3.5" /> Gerenciar clientes
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
