import SugestoesDoAgente from "@/components/agentes/SugestoesDoAgente";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { campo, foco, juntar } from "@/components/sistema/estilos";
import { ATALHOS_DO_AGENTE, type AtalhoDoAgente, type ServicoDoAgente } from "@/lib/lancador";

/**
 * Os dois seletores do topo do agente Aceleriq (Cliente e Serviço) e os
 * atalhos de ação. Ficam num arquivo próprio para o VoiceAssistant não
 * crescer mais e para os testes olharem só o topo.
 *
 * A lista abre logo abaixo do botão, dentro do painel (sem portal): no
 * celular o painel é tela cheia e um balão por fora ficaria atrás dele.
 */

const norm = (s: string) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

export interface ClienteDoAgente {
  id: string;
  company_name?: string | null;
  full_name?: string | null;
  email?: string | null;
}

export const nomeDoCliente = (c: ClienteDoAgente | null | undefined) => (c ? c.company_name || c.full_name || c.email || "Cliente" : "");

function Lista({
  aberto,
  onFechar,
  children,
  rotulo,
}: {
  aberto: boolean;
  onFechar: () => void;
  children: ReactNode;
  rotulo: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node;
      const pai = ref.current && ref.current.parentElement;
      if (pai && !pai.contains(alvo)) onFechar();
    };
    document.addEventListener("mousedown", fora);
    return () => document.removeEventListener("mousedown", fora);
  }, [aberto, onFechar]);
  if (!aberto) return null;
  return (
    <div
      ref={ref}
      role="listbox"
      aria-label={rotulo}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onFechar();
        }
      }}
      className="absolute left-0 top-full z-10 mt-1 w-72 max-w-[calc(100vw-32px)] rounded-lg border border-border bg-popover p-1.5 shadow-lg"
    >
      {children}
    </div>
  );
}

const gatilho = juntar(
  "inline-flex h-8 min-w-0 max-w-full items-center rounded-md border border-border bg-background px-2.5 text-[12.5px] text-foreground transition-colors hover:bg-muted",
  foco,
);

export function SeletorDeCliente({
  clientes,
  valor,
  onEscolher,
}: {
  clientes: ClienteDoAgente[];
  valor: string | null;
  onEscolher: (id: string | null) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [busca, setBusca] = useState("");
  const atual = clientes.find((c) => c.id === valor) || null;
  const filtrados = (busca ? clientes.filter((c) => norm(`${c.company_name || ""} ${c.full_name || ""} ${c.email || ""}`).includes(norm(busca))) : clientes).slice(0, 60);
  const fechar = () => {
    setAberto(false);
    setBusca("");
  };
  return (
    <div className="relative min-w-0" data-seletor-cliente="">
      <button type="button" className={gatilho} aria-haspopup="listbox" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
        <span className="mr-1 shrink-0 text-muted-foreground">Cliente</span>
        <span className="min-w-0 truncate font-medium">{atual ? nomeDoCliente(atual) : "Nenhum"}</span>
        <ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
      <Lista aberto={aberto} onFechar={fechar} rotulo="Clientes">
        <div className="relative mb-1">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          <input
            autoFocus
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder={`Buscar entre ${clientes.length} clientes`}
            aria-label="Buscar cliente"
            className={juntar(campo, "h-8 pl-8 text-[12.5px]")}
          />
        </div>
        <ul className="max-h-60 overflow-y-auto">
          <li>
            <button type="button" role="option" aria-selected={!valor} onClick={() => { onEscolher(null); fechar(); }} className="flex w-full items-center rounded-md px-2 py-1.5 text-left text-[12.5px] text-muted-foreground hover:bg-muted">
              <span className="min-w-0 flex-1 truncate">Sem cliente (geral)</span>
              {!valor && <Check className="ml-2 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />}
            </button>
          </li>
          {filtrados.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                role="option"
                aria-selected={c.id === valor}
                data-cliente-id={c.id}
                onClick={() => { onEscolher(c.id); fechar(); }}
                className="flex w-full min-w-0 items-center rounded-md px-2 py-1.5 text-left text-[12.5px] text-foreground hover:bg-muted"
              >
                <span className="min-w-0 flex-1 truncate">{nomeDoCliente(c)}</span>
                {c.id === valor && <Check className="ml-2 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />}
              </button>
            </li>
          ))}
          {filtrados.length === 0 && <li className="px-2 py-2 text-[12px] text-muted-foreground">{clientes.length ? "Nenhum cliente com esse nome." : "Carregando clientes."}</li>}
        </ul>
      </Lista>
    </div>
  );
}

export function SeletorDeServico({
  servicos,
  valor,
  onEscolher,
}: {
  servicos: Array<ServicoDoAgente & { contratado: boolean }>;
  valor: string;
  onEscolher: (chave: string) => void;
}) {
  const [aberto, setAberto] = useState(false);
  const atual = servicos.find((s) => s.chave === valor) || servicos[0];
  return (
    <div className="relative min-w-0" data-seletor-servico="">
      <button type="button" className={gatilho} aria-haspopup="listbox" aria-expanded={aberto} onClick={() => setAberto((a) => !a)}>
        <span className="mr-1 shrink-0 text-muted-foreground">Serviço</span>
        <span className="min-w-0 truncate font-medium">{atual ? atual.rotulo : "Geral"}</span>
        <ChevronDown className="ml-1 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
      <Lista aberto={aberto} onFechar={() => setAberto(false)} rotulo="Serviços">
        <ul className="max-h-64 overflow-y-auto">
          {servicos.map((s) => (
            <li key={s.chave}>
              <button
                type="button"
                role="option"
                aria-selected={s.chave === valor}
                data-servico={s.chave}
                onClick={() => { onEscolher(s.chave); setAberto(false); }}
                className="flex w-full min-w-0 items-center rounded-md px-2 py-1.5 text-left text-[12.5px] text-foreground hover:bg-muted"
              >
                <span className="min-w-0 flex-1 truncate">{s.rotulo}</span>
                {s.contratado && <span className="ml-2 shrink-0 text-[10.5px] text-muted-foreground">contratado</span>}
                {s.chave === valor && <Check className="ml-2 h-3.5 w-3.5 shrink-0 text-primary" aria-hidden="true" />}
              </button>
            </li>
          ))}
        </ul>
      </Lista>
    </div>
  );
}

/** Chips pequenos com as ações mais comuns. Os que precisam de cliente ficam apagados sem ele. */
export function AtalhosDoAgente({
  temCliente,
  ocupado,
  onAtalho,
}: {
  temCliente: boolean;
  ocupado: boolean;
  onAtalho: (chave: AtalhoDoAgente) => void;
}) {
  return (
    <SugestoesDoAgente><div className="flex min-w-0 flex-wrap" role="group" aria-label="Atalhos do agente" data-atalhos-do-agente="">
      {ATALHOS_DO_AGENTE.map((a) => {
        const desligado = ocupado || (a.precisaCliente && !temCliente);
        return (
          <button
            key={a.chave}
            type="button"
            data-atalho={a.chave}
            disabled={desligado}
            title={a.precisaCliente && !temCliente ? "Escolha um cliente primeiro" : undefined}
            onClick={() => onAtalho(a.chave)}
            className={juntar(
              "mb-1 mr-1 inline-flex h-7 max-w-full items-center truncate rounded-full border border-border bg-background px-2.5 text-[11.5px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
              foco,
            )}
          >
            {a.rotulo}
          </button>
        );
      })}
    </div></SugestoesDoAgente>
  );
}
