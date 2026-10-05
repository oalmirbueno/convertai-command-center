import { useMemo, useState } from "react";
import { Check, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MiniaturaDaFoto, Pilulas } from "./Comuns";
import { classeDaFoto, type FotoDoAcervo } from "./fotoApi";
import { juntar, superficie } from "@/components/sistema/estilos";
import { FILTROS_DA_CLASSE, filtrarFotos, type FiltroDaClasse } from "./EtapaAcervo";
import { ehSoFoto, ladoDaFoto, type LadoDaFoto } from "./tipoDaFoto";

import { useMesa } from "@/components/mesa/MesaContexto";
import { useArvoreDoWorkspace, pastasDoAcervo, pastaDaFoto, montarArvore, trilhaAte } from "@/lib/mesa/pastas";

const LADOS: { valor: "todos" | LadoDaFoto; rotulo: string }[] = [
  { valor: "todos", rotulo: "Todas" },
  { valor: "produto", rotulo: "Produto" },
  { valor: "modelo", rotulo: "Modelo" },
];

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
  const { clientId } = useMesa();
  const workspace = useArvoreDoWorkspace(clientId);
  const [pasta, setPasta] = useState("__todas");
  const [limite, setLimite] = useState(120);
  const espelho = useMemo(() => pastasDoAcervo(workspace.data || [], fotos), [workspace.data, fotos]);
  const arvore = useMemo(() => montarArvore(espelho.pastas, {}), [espelho]);
  const [busca, setBusca] = useState("");
  const [classe, setClasse] = useState<FiltroDaClasse>(filtroInicial);
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [lado, setLado] = useState<"todos" | LadoDaFoto>("todos");
  // 02/10: só fotos (artes, carrosséis e logos ficam na Mesa), com o lado produto ou modelo.
  const soFotos = useMemo(() => fotos.filter((f) => ehSoFoto(f) && (lado === "todos" || ladoDaFoto(f) === lado)), [fotos, lado]);
  const filtradas = useMemo(() => filtrarFotos(soFotos, classe, "todos", [], busca).filter((f) => {
    if (pasta === "__todas") return true;
    const id = pastaDaFoto(f, espelho.pastaDoNo);
    return id === pasta || trilhaAte(arvore, id).some((p) => p.id === pasta);
  }), [soFotos, classe, busca, pasta, espelho, arvore]);
  const lista = filtradas.slice(0, limite);

  const alternar = (id: string) => {
    if (!multiplas) {
      onUsar([id]);
      return;
    }
    setMarcadas((m) => (m.indexOf(id) >= 0 ? m.filter((x) => x !== id) : m.concat([id])));
  };

  return (
    // Escolha aberta dentro da etapa: é uma janela no lugar (cartão com função). 28/09: sem rolagem
    // própria (uma por região); as ações ficam na linha do título, à vista mesmo com muitas fotos.
    <section className={juntar(superficie.painel, "min-w-0 space-y-3 border-primary/40 p-3.5")} aria-label={titulo}>
      <div className="flex min-w-0 items-center">
        <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{titulo}</p>
        {multiplas && (
          <>
            <Button type="button" size="sm" variant="ghost" className="ml-2 h-8 shrink-0 text-[12px]" onClick={onFechar}>
              Cancelar
            </Button>
            <Button type="button" size="sm" className="ml-1 h-8 shrink-0 text-[12px]" disabled={!marcadas.length} onClick={() => onUsar(marcadas)}>
              Usar {marcadas.length ? marcadas.length : ""} {marcadas.length === 1 ? "foto" : "fotos"}
            </Button>
          </>
        )}
        <button type="button" onClick={onFechar} aria-label="Fechar" className="ml-2 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      </div>
      <label className="block text-[12px]">Pasta do Workspace ou acervo<select aria-label="Pasta das fotos" className="mt-1 w-full rounded-md border bg-background p-2" value={pasta} onChange={(e) => { setPasta(e.target.value); setLimite(120); }}><option value="__todas">Todas as pastas ({soFotos.length} fotos)</option><option value="">Raiz do Workspace</option>{espelho.pastas.map((p) => <option key={p.id} value={p.id}>{trilhaAte(arvore, p.id).map((x) => x.nome).join(" / ")}</option>)}</select></label>
      {workspace.isError && <p role="alert" className="text-[12px]">Não foi possível ler as pastas. <button type="button" onClick={() => void workspace.refetch()}>Recarregar</button></p>}
      <div className="relative min-w-0">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar no acervo" className="h-9 pl-8" aria-label="Buscar foto" />
      </div>
      <div className="flex min-w-0 flex-wrap items-center">
        <Pilulas rotulo="Lado das fotos" opcoes={LADOS} valor={lado} onEscolher={setLado} className="mr-2" />
        <Pilulas rotulo="Tipo de foto" opcoes={FILTROS_DA_CLASSE} valor={classe} onEscolher={setClasse} />
      </div>
      {multiplas && filtradas.length > 0 && <button type="button" className="text-[12px] text-primary" onClick={() => setMarcadas(filtradas.filter((f) => !jaEscolhidas.includes(f.id)).map((f) => f.id))}>Selecionar as {filtradas.length} fotos deste filtro</button>}
      {lista.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">Nenhuma foto com esse filtro.</p>
      ) : (
        <div className="grid min-w-0 grid-cols-3 gap-1.5 scrollbar-hidden sm:grid-cols-4 md:grid-cols-6 lg:max-h-[50vh] lg:overflow-y-auto lg:overscroll-contain" data-rolagem-do-seletor="">
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
                className={`relative min-w-0 rounded-lg p-0.5 text-left ${marcada ? "ring-1 ring-primary" : "hover:bg-muted/40"} ${ja ? "opacity-40" : ""}`}
              >
                <MiniaturaDaFoto foto={f} />
                {marcada && (
                  <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="h-3 w-3" />
                  </span>
                )}
                <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{f.nome}</span>
              </button>
            );
          })}
        </div>
      )}
      {filtradas.length > limite && <button type="button" className="text-[12px] text-primary" onClick={() => setLimite((n) => n + 120)}>Mostrar mais ({filtradas.length - limite} fotos)</button>}
    </section>
  );
}
