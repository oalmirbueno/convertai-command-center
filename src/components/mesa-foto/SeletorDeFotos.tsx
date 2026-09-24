import { useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MiniaturaDaFoto, Pilulas } from "./Comuns";
import { classeDaFoto, type FotoDoAcervo } from "./fotoApi";
import { FILTROS_DA_CLASSE, filtrarFotos, type FiltroDaClasse } from "./EtapaAcervo";

/**
 * Escolher fotos do acervo sem sair da etapa (painel no lugar, sem janela):
 * busca, filtro por classe e marcação. Um clique marca; "Usar" devolve os ids.
 */
export default function SeletorDeFotos({
  fotos,
  titulo,
  multiplas = true,
  jaEscolhidas = [],
  filtroInicial = "todas",
  onUsar,
  onFechar,
}: {
  fotos: FotoDoAcervo[];
  titulo: string;
  multiplas?: boolean;
  jaEscolhidas?: string[];
  filtroInicial?: FiltroDaClasse;
  onUsar: (ids: string[]) => void;
  onFechar: () => void;
}) {
  const [busca, setBusca] = useState("");
  const [classe, setClasse] = useState<FiltroDaClasse>(filtroInicial);
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const lista = useMemo(() => filtrarFotos(fotos, classe, "todos", [], busca).slice(0, 120), [fotos, classe, busca]);

  const alternar = (id: string) => {
    if (!multiplas) {
      onUsar([id]);
      return;
    }
    setMarcadas((m) => (m.indexOf(id) >= 0 ? m.filter((x) => x !== id) : m.concat([id])));
  };

  return (
    <section className="min-w-0 space-y-3 rounded-xl border border-primary/40 bg-card p-3.5" aria-label={titulo}>
      <div className="flex min-w-0 items-center">
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{titulo}</p>
        <button type="button" onClick={onFechar} aria-label="Fechar" className="ml-2 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="relative min-w-0">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar no acervo" className="h-9 pl-8" aria-label="Buscar foto" />
      </div>
      <Pilulas rotulo="Tipo de foto" opcoes={FILTROS_DA_CLASSE} valor={classe} onEscolher={setClasse} />
      {lista.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">Nenhuma foto com esse filtro.</p>
      ) : (
        <div className="grid max-h-[50vh] min-w-0 grid-cols-3 gap-1.5 overflow-y-auto sm:grid-cols-4 md:grid-cols-6">
          {lista.map((f) => {
            const ja = jaEscolhidas.indexOf(f.id) >= 0;
            const marcada = marcadas.indexOf(f.id) >= 0;
            return (
              <button
                key={f.id}
                type="button"
                disabled={ja}
                onClick={() => alternar(f.id)}
                aria-pressed={marcada}
                aria-label={`${ja ? "Já no kit: " : ""}${f.nome}${classeDaFoto(f) === "gerada" ? " (gerada)" : ""}`}
                className={`relative min-w-0 rounded-lg border p-0.5 text-left ${marcada ? "border-primary" : "border-transparent hover:border-border"} ${ja ? "opacity-40" : ""}`}
              >
                <MiniaturaDaFoto foto={f} />
                {marcada && (
                  <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-3 w-3" />
                  </span>
                )}
                <span className="mt-0.5 block truncate text-[10.5px] text-muted-foreground">{f.nome}</span>
              </button>
            );
          })}
        </div>
      )}
      {multiplas && (
        <div className="flex items-center justify-end">
          <Button type="button" size="sm" variant="ghost" className="mr-2 h-8 text-[12px]" onClick={onFechar}>
            Cancelar
          </Button>
          <Button type="button" size="sm" className="h-8 text-[12px]" disabled={!marcadas.length} onClick={() => onUsar(marcadas)}>
            Usar {marcadas.length ? marcadas.length : ""} {marcadas.length === 1 ? "foto" : "fotos"}
          </Button>
        </div>
      )}
    </section>
  );
}
