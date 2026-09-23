import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Check, ChevronLeft, ChevronRight, Loader2, Plus, Search, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { textoDoErro } from "@/lib/mesa/api";
import { Ampliar, type ImagemAmpliavel } from "./Ampliar";
import { ImagemDaMesa, useMesa } from "./MesaContexto";

/**
 * Referências da campanha: as do cliente (ativas e lidas) e o banco da
 * agência (referencias_globais, pins do Pinterest do dono, com busca e
 * páginas de 24). Escolha múltipla até 8; id do banco da agência leva "g:".
 * Controlado por quem usa: o formulário guarda na memória, o detalhe grava
 * em mesa_campanhas.referencias_ids. As consultas usam as mesmas chaves e o
 * mesmo formato das referências do Estúdio (o cache é um só).
 */

interface RefDoCliente {
  id: string;
  papel: "identidade" | "tecnica" | null;
  origem: string | null;
  storage_path: string | null;
  leitura: string | null;
  tags: string[] | null;
}

interface RefGlobal {
  id: string;
  titulo: string | null;
  leitura: string | null;
  tags: string[] | null;
  storage_path: string | null;
}

export const MAX_REFERENCIAS = 8;
const POR_PAGINA = 24;
const PREFIXO_GLOBAL = "g:";

function limparBusca(t: string): string {
  let saida = "";
  const proibidos = ",()*%{}\"\\:";
  for (let i = 0; i < t.length; i++) {
    const c = t.charAt(i);
    saida += proibidos.indexOf(c) >= 0 ? " " : c;
  }
  return saida.split(" ").filter(Boolean).join(" ").trim();
}

function useAtraso<T>(valor: T, ms: number): T {
  const [v, setV] = useState(valor);
  useEffect(() => {
    const id = window.setTimeout(() => setV(valor), ms);
    return () => window.clearTimeout(id);
  }, [valor, ms]);
  return v;
}

function useReferenciasDoCliente(clientId: string) {
  return useQuery({
    queryKey: ["mesa", "referencias", clientId, "estudio"],
    queryFn: async (): Promise<RefDoCliente[]> => {
      const { data, error } = await (supabase as any)
        .from("cliente_referencias")
        .select("id, papel, origem, storage_path, leitura, tags")
        .eq("client_id", clientId)
        .eq("ativa", true)
        .not("leitura", "is", null)
        .order("criado_em", { ascending: false });
      if (error) throw error;
      return (data || []) as RefDoCliente[];
    },
  });
}

function useGlobaisEscolhidas(ids: string[]) {
  const globais = ids.filter((id) => id.indexOf(PREFIXO_GLOBAL) === 0).map((id) => id.slice(PREFIXO_GLOBAL.length));
  return useQuery({
    queryKey: ["mesa", "refs-globais", "escolhidas", globais.slice().sort().join(",")],
    enabled: globais.length > 0,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<RefGlobal[]> => {
      const { data, error } = await (supabase as any)
        .from("referencias_globais")
        .select("id, titulo, leitura, tags, storage_path")
        .in("id", globais);
      if (error) throw error;
      return (data || []) as RefGlobal[];
    },
  });
}

/** Miniaturas das referências escolhidas (clicar abre grande; o X tira). */
export function ReferenciasEscolhidas({ ids, onTirar, vazio }: { ids: string[]; onTirar?: (id: string) => void; vazio?: string }) {
  const { clientId } = useMesa();
  const doCliente = useReferenciasDoCliente(clientId);
  const globais = useGlobaisEscolhidas(ids);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const miniatura = (id: string): { caminho: string | null; nome: string } => {
    if (id.indexOf(PREFIXO_GLOBAL) === 0) {
      const g = (globais.data || []).find((r) => r.id === id.slice(PREFIXO_GLOBAL.length));
      return { caminho: g ? g.storage_path : null, nome: (g && g.titulo) || "Banco da agência" };
    }
    const c = (doCliente.data || []).find((r) => r.id === id);
    return { caminho: c ? c.storage_path : null, nome: "Do cliente" };
  };
  if (!ids.length) return vazio ? <p className="text-[12px] text-muted-foreground">{vazio}</p> : null;
  const lista = ids.map(miniatura);
  const ampliaveis: ImagemAmpliavel[] = lista.filter((m) => !!m.caminho).map((m) => ({ caminho: m.caminho as string, titulo: m.nome }));
  return (
    <>
      <ul className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
        {ids.map((id, i) => {
          const m = lista[i];
          return (
            <li key={id} className="relative min-w-0">
              <button
                type="button"
                onClick={() => {
                  const j = ampliaveis.findIndex((a) => a.caminho === m.caminho);
                  if (j >= 0) setAmpliada(j);
                }}
                className="relative block w-full cursor-zoom-in overflow-hidden rounded-md border border-border bg-secondary"
                style={{ paddingBottom: "125%" }}
                aria-label={`${m.nome}: ver grande`}
              >
                <ImagemDaMesa caminho={m.caminho} alt={m.nome} className="absolute inset-0 h-full w-full" />
              </button>
              {onTirar && (
                <button
                  type="button"
                  onClick={() => onTirar(id)}
                  aria-label="Tirar esta referência"
                  title="Tirar"
                  className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-background/90 text-foreground shadow-sm"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </li>
          );
        })}
      </ul>
      <Ampliar imagens={ampliaveis} indice={ampliada} onFechar={() => setAmpliada(null)} />
    </>
  );
}

function Miniatura({
  caminho,
  alt,
  marcada,
  bloqueada,
  onAmpliar,
  onAlternar,
}: {
  caminho: string | null;
  alt: string;
  marcada: boolean;
  bloqueada: boolean;
  onAmpliar: () => void;
  onAlternar: () => void;
}) {
  return (
    <div className="min-w-0">
      <button
        type="button"
        onClick={onAmpliar}
        aria-label={`${alt}: ver grande`}
        className={`relative block w-full cursor-zoom-in overflow-hidden rounded-md border-2 bg-secondary transition-colors ${marcada ? "border-primary" : "border-transparent hover:border-primary/40"}`}
        style={{ paddingBottom: "125%" }}
      >
        <ImagemDaMesa caminho={caminho} alt={alt} className="absolute inset-0 h-full w-full" />
      </button>
      <button
        type="button"
        onClick={onAlternar}
        aria-pressed={marcada}
        disabled={!marcada && bloqueada}
        title={!marcada && bloqueada ? `Até ${MAX_REFERENCIAS} referências` : undefined}
        className={`mt-1 flex h-7 w-full items-center justify-center rounded-md border text-[11px] font-medium transition-colors disabled:opacity-40 ${
          marcada ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:text-foreground"
        }`}
      >
        {marcada ? <><Check className="mr-1 h-3 w-3" /> Escolhida</> : <><Plus className="mr-1 h-3 w-3" /> Usar</>}
      </button>
    </div>
  );
}

export default function CampanhaReferencias({ valor, onChange }: { valor: string[]; onChange: (ids: string[]) => void }) {
  const { clientId } = useMesa();
  const [aba, setAba] = useState<"cliente" | "banco">("cliente");
  const [busca, setBusca] = useState("");
  const [pagina, setPagina] = useState(0);
  const [ampliada, setAmpliada] = useState<{ lista: ImagemAmpliavel[]; indice: number } | null>(null);
  const buscaAtrasada = useAtraso(limparBusca(busca), 350);
  useEffect(() => { setPagina(0); }, [buscaAtrasada]);

  const doCliente = useReferenciasDoCliente(clientId);
  const banco = useQuery({
    queryKey: ["mesa", "refs-globais", "pagina", buscaAtrasada, "", pagina],
    enabled: aba === "banco",
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ lista: RefGlobal[]; total: number }> => {
      let q = (supabase as any)
        .from("referencias_globais")
        .select("id, titulo, leitura, tags, storage_path", { count: "exact" })
        .eq("ativa", true);
      if (buscaAtrasada) {
        const termo = `*${buscaAtrasada}*`;
        const partes = [`titulo.ilike.${termo}`, `leitura.ilike.${termo}`];
        if (buscaAtrasada.indexOf(" ") < 0) partes.push(`tags.cs.{${buscaAtrasada}}`);
        q = q.or(partes.join(","));
      }
      const { data, error, count } = await q
        .order("criado_em", { ascending: false })
        .range(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA - 1);
      if (error) throw error;
      return { lista: (data || []) as RefGlobal[], total: Number(count || 0) };
    },
  });

  const cheio = valor.length >= MAX_REFERENCIAS;
  const alternar = (id: string) => {
    if (valor.indexOf(id) >= 0) onChange(valor.filter((x) => x !== id));
    else if (!cheio) onChange(valor.concat([id]));
  };

  const clientes = doCliente.data || [];
  const listaDoBanco = banco.data ? banco.data.lista : [];
  const totalBanco = banco.data ? banco.data.total : 0;
  const paginas = Math.max(1, Math.ceil(totalBanco / POR_PAGINA));

  const ampliar = (lista: { caminho: string | null; titulo?: string; legenda?: string | null }[], indice: number) => {
    const validas = lista.filter((l) => !!l.caminho);
    const i = validas.indexOf(lista[indice]);
    if (i < 0) return;
    setAmpliada({ lista: validas.map((l) => ({ caminho: l.caminho as string, titulo: l.titulo, legenda: l.legenda || undefined })), indice: i });
  };

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex min-w-0 items-center border-b border-border">
        {([
          { valor: "cliente", rotulo: `Do cliente (${clientes.length})` },
          { valor: "banco", rotulo: `Agência${banco.data ? ` (${totalBanco.toLocaleString("pt-BR")})` : ""}` },
        ] as { valor: "cliente" | "banco"; rotulo: string }[]).map((a) => (
          <button
            key={a.valor}
            type="button"
            onClick={() => setAba(a.valor)}
            className={`-mb-px mr-4 h-9 shrink-0 border-b-2 text-[12.5px] transition-colors ${aba === a.valor ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
          >
            {a.rotulo}
          </button>
        ))}
        <span className="ml-auto shrink-0 text-[11.5px] text-muted-foreground">{valor.length} de {MAX_REFERENCIAS}</span>
      </div>

      {aba === "cliente" && (
        <div className="space-y-2">
          {doCliente.isLoading && <p className="text-[12px] text-muted-foreground"><Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />Lendo as referências…</p>}
          {doCliente.isError && <p className="rounded-lg bg-destructive/10 p-2.5 text-[12px]">{textoDoErro(doCliente.error)}</p>}
          {doCliente.data && clientes.length === 0 && <p className="text-[12px] text-muted-foreground">O cliente ainda não tem referências lidas. Escolha no banco da agência.</p>}
          <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
            {clientes.map((r, i) => (
              <li key={r.id} className="min-w-0">
                <Miniatura
                  caminho={r.storage_path}
                  alt="Referência do cliente"
                  marcada={valor.indexOf(r.id) >= 0}
                  bloqueada={cheio}
                  onAmpliar={() => ampliar(clientes.map((c) => ({ caminho: c.storage_path, titulo: "Do cliente", legenda: c.leitura })), i)}
                  onAlternar={() => alternar(r.id)}
                />
              </li>
            ))}
          </ul>
        </div>
      )}

      {aba === "banco" && (
        <div className="space-y-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar no título, na leitura ou nas tags" className="h-9 pl-8 text-[12.5px]" />
          </div>
          {banco.isLoading && <p className="text-[12px] text-muted-foreground"><Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />Buscando…</p>}
          {banco.isError && <p className="rounded-lg bg-destructive/10 p-2.5 text-[12px]">{textoDoErro(banco.error)}</p>}
          {banco.data && listaDoBanco.length === 0 && <p className="text-[12px] text-muted-foreground">Nada encontrado com essa busca.</p>}
          <ul className={`grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 ${banco.isFetching && !banco.isLoading ? "opacity-70" : ""}`}>
            {listaDoBanco.map((r, i) => {
              const id = PREFIXO_GLOBAL + r.id;
              return (
                <li key={r.id} className="min-w-0">
                  <Miniatura
                    caminho={r.storage_path}
                    alt={r.titulo || "Referência do banco"}
                    marcada={valor.indexOf(id) >= 0}
                    bloqueada={cheio}
                    onAmpliar={() => ampliar(listaDoBanco.map((g) => ({ caminho: g.storage_path, titulo: g.titulo || "Banco da agência", legenda: g.leitura })), i)}
                    onAlternar={() => alternar(id)}
                  />
                </li>
              );
            })}
          </ul>
          {totalBanco > POR_PAGINA && (
            <div className="flex items-center justify-between pt-1">
              <Button type="button" size="sm" variant="outline" className="h-8 px-2" disabled={pagina === 0} onClick={() => setPagina((p) => Math.max(0, p - 1))} aria-label="Página anterior">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="text-[12px] text-muted-foreground">Página {pagina + 1} de {paginas}</span>
              <Button type="button" size="sm" variant="outline" className="h-8 px-2" disabled={pagina + 1 >= paginas} onClick={() => setPagina((p) => p + 1)} aria-label="Próxima página">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          )}
        </div>
      )}

      <Ampliar imagens={ampliada ? ampliada.lista : []} indice={ampliada ? ampliada.indice : null} onFechar={() => setAmpliada(null)} />
    </div>
  );
}
