import type { ReactNode } from "react";
import { Bot, Building2, ChevronDown } from "lucide-react";
import { useClients } from "@/hooks/useSupabaseData";
import { MODELOS_DO_LAB } from "@/lib/laboratorio/nos";

/**
 * Seletores compactos do Laboratório: ícone + nome curto truncado, sem
 * moldura (o nome inteiro fica no aria-label do select e no title). O select
 * nativo fica invisível por cima (abre a lista do aparelho no celular) e o
 * texto à vista é curto, para a caixa de pedido caber numa linha a 390 px.
 * Cliente é opcional: "Livre" usa a carteira do cliente interno e o
 * resultado fica só no Laboratório.
 */

const SELECT = "absolute inset-0 h-full w-full cursor-pointer appearance-none opacity-0";

function Compacto({ icone, titulo, visivel, children }: { icone: ReactNode; titulo: string; visivel: string; children: ReactNode }) {
  return (
    <span
      className="relative inline-flex h-8 min-w-0 items-center rounded-md px-1 text-muted-foreground hover:bg-muted focus-within:ring-2 focus-within:ring-ring"
      title={titulo}
      data-seletor-compacto=""
    >
      <span className="mr-1 inline-flex shrink-0" aria-hidden="true">{icone}</span>
      <span className="min-w-0 max-w-[76px] truncate text-[12px] text-foreground sm:max-w-[160px]" aria-hidden="true" data-nome-curto="">
        {visivel}
      </span>
      <ChevronDown className="ml-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
      {children}
    </span>
  );
}

export interface ClienteDoLab {
  id: string;
  nome: string;
}

export function useClientesDoLab(): ClienteDoLab[] {
  const q = useClients();
  const lista = (q.data || []) as Array<{ id: string; company_name?: string | null }>;
  return lista.map((c) => ({ id: c.id, nome: c.company_name || "Cliente" })).sort((a, b) => a.nome.localeCompare(b.nome));
}

export function SeletorDeCliente({ valor, onMudar, clientes }: { valor: string | null; onMudar: (id: string | null) => void; clientes: ClienteDoLab[] }) {
  const nome = nomeDoCliente(clientes, valor);
  return (
    <Compacto icone={<Building2 className="h-3.5 w-3.5" />} titulo={`Cliente: ${nome} (opcional: Livre usa a carteira da agência)`} visivel={nome}>
      <select aria-label="Cliente" className={SELECT} value={valor || ""} onChange={(e) => onMudar(e.target.value || null)}>
        <option value="">Livre</option>
        {clientes.map((c) => (
          <option key={c.id} value={c.id}>{c.nome}</option>
        ))}
      </select>
    </Compacto>
  );
}

export function SeletorDeModelo({ valor, onMudar, rotulo = "Modelo" }: { valor: string; onMudar: (v: string) => void; rotulo?: string }) {
  const atual = MODELOS_DO_LAB.find((m) => m.valor === valor) || MODELOS_DO_LAB[0];
  return (
    <Compacto icone={<Bot className="h-3.5 w-3.5" />} titulo={`${rotulo}: ${atual.rotulo}`} visivel={atual.curto}>
      <select aria-label={rotulo} className={SELECT} value={valor} onChange={(e) => onMudar(e.target.value)}>
        {MODELOS_DO_LAB.map((m) => (
          <option key={m.valor} value={m.valor}>{m.rotulo}</option>
        ))}
      </select>
    </Compacto>
  );
}

export const nomeDoCliente = (clientes: ClienteDoLab[], id: string | null, padrao = "Livre") => (id ? (clientes.find((c) => c.id === id) || { nome: padrao }).nome : padrao);
