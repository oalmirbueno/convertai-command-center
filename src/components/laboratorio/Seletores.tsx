import type { ReactNode } from "react";
import { Bot, Building2 } from "lucide-react";
import { useClients } from "@/hooks/useSupabaseData";
import { foco, juntar } from "@/components/sistema";
import { MODELOS_DO_LAB } from "@/lib/laboratorio/nos";

/**
 * Seletores compactos do Laboratório: um ícone e um select sem moldura (o
 * nome fica no aria-label e no title). Cliente é opcional: "Livre" usa a
 * carteira do cliente interno e o resultado fica só no Laboratório.
 */

const SELECT = juntar("h-8 min-w-0 max-w-[180px] truncate rounded-md bg-transparent pl-1 pr-6 text-[12px] text-foreground hover:bg-muted", foco);

function Envoltorio({ icone, titulo, children }: { icone: ReactNode; titulo: string; children: ReactNode }) {
  return (
    <span className="inline-flex min-w-0 items-center text-muted-foreground" title={titulo}>
      <span className="mr-0.5 inline-flex shrink-0" aria-hidden="true">{icone}</span>
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
  return (
    <Envoltorio icone={<Building2 className="h-3.5 w-3.5" />} titulo="Cliente (opcional): Livre usa a carteira da agência">
      <select aria-label="Cliente" className={SELECT} value={valor || ""} onChange={(e) => onMudar(e.target.value || null)}>
        <option value="">Livre</option>
        {clientes.map((c) => (
          <option key={c.id} value={c.id}>{c.nome}</option>
        ))}
      </select>
    </Envoltorio>
  );
}

export function SeletorDeModelo({ valor, onMudar, rotulo = "Modelo" }: { valor: string; onMudar: (v: string) => void; rotulo?: string }) {
  return (
    <Envoltorio icone={<Bot className="h-3.5 w-3.5" />} titulo={rotulo}>
      <select aria-label={rotulo} className={SELECT} value={valor} onChange={(e) => onMudar(e.target.value)}>
        {MODELOS_DO_LAB.map((m) => (
          <option key={m.valor} value={m.valor}>{m.rotulo}</option>
        ))}
      </select>
    </Envoltorio>
  );
}

export const nomeDoCliente = (clientes: ClienteDoLab[], id: string | null, padrao = "Livre") => (id ? (clientes.find((c) => c.id === id) || { nome: padrao }).nome : padrao);
