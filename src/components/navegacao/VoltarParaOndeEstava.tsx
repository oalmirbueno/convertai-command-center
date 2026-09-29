import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, ChevronDown } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useClients } from "@/hooks/useSupabaseData";
import { useCronometro } from "@/components/cronometro/CronometroProvider";
import { chaveDoLugar, lerLugares, lugarAnterior, lugarAtual, registrarLugar, type Lugar } from "@/lib/navegacao/lugares";

/**
 * "Voltar para onde eu estava" no topo (29/09, pedido do dono). Guarda os
 * últimos lugares da aba do navegador (sessionStorage: cada aba tem o seu
 * caminho) e mostra o anterior num botão: um toque volta com o mesmo cliente,
 * a mesma aba e o mesmo filtro. A setinha abre os últimos lugares.
 * Espera um instante antes de registrar, para o cliente em foco (Central,
 * Workspace) e o endereço final da tela assentarem.
 */

const CHAVE = "painel:lugares";
const ESPERA_MS = 700;

function ler(): Lugar[] {
  try {
    return lerLugares(window.sessionStorage.getItem(CHAVE));
  } catch {
    return [];
  }
}

function gravar(lista: Lugar[]) {
  try {
    window.sessionStorage.setItem(CHAVE, JSON.stringify(lista));
  } catch {
    /* sem armazenamento (aba privada restrita): o botão só não lembra */
  }
}

const BOTAO =
  "toque-compacto inline-flex h-8 min-w-0 items-center rounded-lg px-2 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export default function VoltarParaOndeEstava() {
  const location = useLocation();
  const navigate = useNavigate();
  const { cliente: clienteEmFoco } = useCronometro();
  const { data: clientes } = useClients();
  const [lista, setLista] = useState<Lugar[]>(() => ler());
  const ultimo = useRef<string>("");

  const chaveAgora = useMemo(
    () => chaveDoLugar(location.pathname, location.search, clienteEmFoco),
    [location.pathname, location.search, clienteEmFoco],
  );

  useEffect(() => {
    const t = window.setTimeout(() => {
      const lugar = lugarAtual(location.pathname, location.search, clienteEmFoco, Date.now());
      if (!lugar) return;
      const assinatura = `${lugar.chave}#${lugar.url}`;
      if (assinatura === ultimo.current) return;
      ultimo.current = assinatura;
      setLista((antes) => {
        const nova = registrarLugar(antes, lugar);
        gravar(nova);
        return nova;
      });
    }, ESPERA_MS);
    return () => window.clearTimeout(t);
  }, [location.pathname, location.search, clienteEmFoco]);

  const nomeDoCliente = (id: string | null): string | null => {
    if (!id) return null;
    const achado = ((clientes as Array<{ id: string; company_name?: string | null; full_name?: string | null }> | undefined) || []).find((c) => c.id === id);
    return (achado && (achado.company_name || achado.full_name)) || null;
  };
  const rotuloCompleto = (l: Lugar) => {
    const nome = nomeDoCliente(l.cliente);
    return nome ? `${l.rotulo} · ${nome}` : l.rotulo;
  };

  const anterior = lugarAnterior(lista, chaveAgora);
  if (!anterior) return null;
  const outros = lista.filter((l) => l.chave !== chaveAgora && l.chave !== anterior.chave).slice(0, 6);
  const titulo = `Voltar para ${rotuloCompleto(anterior)}`;

  return (
    <div className="flex min-w-0 items-center" data-voltar-para-onde-estava="">
      <button type="button" onClick={() => navigate(anterior.url)} aria-label={titulo} title={titulo} className={`${BOTAO} max-w-[220px]`}>
        <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="ml-1.5 hidden min-w-0 truncate lg:inline">{rotuloCompleto(anterior)}</span>
      </button>
      {outros.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label="Últimos lugares" title="Últimos lugares" className={`${BOTAO} w-6 justify-center px-0`}>
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="text-[11px] font-medium text-muted-foreground">Voltar para</DropdownMenuLabel>
            {[anterior].concat(outros).map((l) => (
              <DropdownMenuItem key={l.chave} onSelect={() => navigate(l.url)} className="text-[13px]">
                <span className="min-w-0 truncate">{rotuloCompleto(l)}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
