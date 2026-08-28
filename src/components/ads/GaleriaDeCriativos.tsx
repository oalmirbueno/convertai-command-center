import { useEffect, useMemo, useState } from "react";
import { X, ImageOff, Video, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Os criativos de um cliente, com a peça à vista e o número ao lado.
 *
 * A pergunta que esta tela responde, e que a de campanhas não responde:
 * campanha diz quanto se gastou; criativo diz QUAL arte fez o trabalho. É
 * a diferença entre "a campanha rendeu" e "este vídeo rendeu, aquela arte
 * não" — e só a segunda dá o que fazer na semana seguinte.
 *
 * SOBRE A MINIATURA: o endereço vem da Meta e EXPIRA. Imagem que não
 * carrega aqui é normal, não é defeito, e por isso o lugar dela nunca fica
 * vazio: aparece o nome da peça sobre um fundo sólido. Um buraco branco na
 * grade faria qualquer pessoa achar que o painel quebrou.
 */

export interface CriativoDeAnuncio {
  ad_id: string;
  ad_name: string | null;
  campaign_id: string | null;
  thumbnail_url: string | null;
  image_url: string | null;
  video_id: string | null;
  titulo: string | null;
  corpo: string | null;
  effective_status: string | null;
  gasto: number;
  impressoes: number;
  cliques: number;
  cliques_no_link: number;
  maior_alcance: number;
  ctr: number | null;
  custo_no_link: number | null;
  dias_com_dado: number;
}

const dinheiro = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const inteiro = (v: number) => v.toLocaleString("pt-BR");

function Miniatura({ c, grande }: { c: CriativoDeAnuncio; grande?: boolean }) {
  const [falhou, setFalhou] = useState(false);
  const src = grande ? (c.image_url || c.thumbnail_url) : (c.thumbnail_url || c.image_url);

  if (!src || falhou) {
    return (
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-1.5 bg-secondary p-3 text-center",
          grande ? "h-[60vh] w-full" : "aspect-square w-full",
        )}
      >
        <ImageOff className="h-5 w-5 text-muted-foreground" />
        <p className="line-clamp-3 text-[10.5px] leading-tight text-muted-foreground">
          {c.ad_name || "Peça sem nome"}
        </p>
        <p className="text-[9.5px] text-muted-foreground/70">
          a imagem expirou na Meta
        </p>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={c.ad_name || "Criativo"}
      loading="lazy"
      onError={() => setFalhou(true)}
      className={cn(
        "bg-secondary object-cover",
        grande ? "max-h-[60vh] w-auto object-contain" : "aspect-square w-full",
      )}
    />
  );
}

function Numero({ rotulo, valor, tom }: { rotulo: string; valor: string; tom?: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-2.5 py-1.5">
      <p className={cn("text-[13px] font-bold tabular-nums leading-none", tom ?? "text-foreground")}>
        {valor}
      </p>
      <p className="mt-1 text-[9.5px] leading-tight text-muted-foreground">{rotulo}</p>
    </div>
  );
}

export default function GaleriaDeCriativos({
  criativos,
  periodoDias,
}: {
  criativos: CriativoDeAnuncio[];
  periodoDias: number;
}) {
  const [aberto, setAberto] = useState<CriativoDeAnuncio | null>(null);
  const [ordem, setOrdem] = useState<"gasto" | "custo" | "ctr">("gasto");

  // Escape fecha. Quem abre uma imagem em tela cheia espera isso, e sem
  // ele a única saída é caçar o X com o mouse.
  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAberto(null);
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [aberto]);

  const ordenados = useMemo(() => {
    const lista = [...criativos];
    if (ordem === "gasto") return lista.sort((a, b) => b.gasto - a.gasto);
    if (ordem === "ctr") return lista.sort((a, b) => (b.ctr ?? -1) - (a.ctr ?? -1));
    // Custo por clique: quem não tem custo vai para o fim, senão o "melhor"
    // do ranking seria justamente quem não gastou nada.
    return lista.sort((a, b) => {
      if (a.custo_no_link === null) return 1;
      if (b.custo_no_link === null) return -1;
      return a.custo_no_link - b.custo_no_link;
    });
  }, [criativos, ordem]);

  if (criativos.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-card p-4 text-center">
        <p className="text-[12px] text-foreground">Nenhum criativo lido ainda.</p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          A leitura das peças acontece junto com a das campanhas, de dez em dez
          minutos. Clique em "Atualizar agora" para apressar a primeira.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-secondary px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-3.5 w-3.5 text-primary" />
          <p className="text-[11.5px] font-bold uppercase tracking-wider text-foreground">
            Criativos · últimos {periodoDias} dias
          </p>
          <span className="text-[10.5px] tabular-nums text-muted-foreground">
            {criativos.length}
          </span>
        </div>
        <div className="flex gap-1">
          {([
            { id: "gasto", rotulo: "Maior gasto" },
            { id: "custo", rotulo: "Menor custo" },
            { id: "ctr", rotulo: "Maior CTR" },
          ] as const).map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => setOrdem(o.id)}
              className={cn(
                "rounded-full border px-2.5 py-1 text-[10.5px] font-semibold transition-colors",
                ordem === o.id
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {o.rotulo}
            </button>
          ))}
        </div>
      </header>

      <div className="grid gap-2.5 p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {ordenados.map((c) => (
          <button
            key={c.ad_id}
            type="button"
            onClick={() => setAberto(c)}
            className="group overflow-hidden rounded-lg border border-border bg-card text-left transition-all hover:-translate-y-px hover:border-primary/60 hover:shadow-lg hover:shadow-black/20"
          >
            <div className="relative overflow-hidden">
              <Miniatura c={c} />
              {c.video_id && (
                <span className="absolute left-1.5 top-1.5 flex items-center gap-1 rounded-md bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                  <Video className="h-2.5 w-2.5" /> vídeo
                </span>
              )}
              {c.effective_status && c.effective_status !== "ACTIVE" && (
                <span className="absolute right-1.5 top-1.5 rounded-md bg-black/70 px-1.5 py-0.5 text-[9px] font-semibold text-white">
                  {c.effective_status.toLowerCase()}
                </span>
              )}
            </div>
            <div className="p-2">
              <p className="truncate text-[11.5px] font-semibold text-foreground">
                {c.ad_name || "Peça sem nome"}
              </p>
              {c.dias_com_dado === 0 ? (
                <p className="mt-1 text-[10px] text-muted-foreground">
                  sem número no período
                </p>
              ) : (
                <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-[10px]">
                  <span className="font-semibold tabular-nums text-foreground">
                    {dinheiro(c.gasto)}
                  </span>
                  {c.ctr !== null && (
                    <span className="tabular-nums text-muted-foreground">
                      CTR {c.ctr.toFixed(2)}%
                    </span>
                  )}
                  {c.custo_no_link !== null && (
                    <span className="tabular-nums text-info">
                      {dinheiro(c.custo_no_link)}/clique
                    </span>
                  )}
                </div>
              )}
            </div>
          </button>
        ))}
      </div>

      {aberto && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
          onClick={() => setAberto(null)}
          role="presentation"
        >
          <div
            className="max-h-full w-full max-w-3xl overflow-y-auto rounded-2xl border border-border bg-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-foreground">
                  {aberto.ad_name || "Peça sem nome"}
                </p>
                <p className="text-[10.5px] text-muted-foreground">
                  {aberto.effective_status?.toLowerCase() || "situação desconhecida"}
                  {aberto.dias_com_dado > 0 && ` · ${aberto.dias_com_dado} dias com número`}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setAberto(null)}
                className="shrink-0 rounded-lg border border-border p-1.5 text-muted-foreground hover:text-foreground"
                aria-label="Fechar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex justify-center bg-secondary">
              <Miniatura c={aberto} grande />
            </div>

            <div className="space-y-3 p-4">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
                <Numero rotulo="gasto" valor={dinheiro(aberto.gasto)} />
                <Numero rotulo="impressões" valor={inteiro(aberto.impressoes)} />
                <Numero
                  rotulo="maior alcance num dia"
                  valor={inteiro(aberto.maior_alcance)}
                />
                <Numero rotulo="cliques" valor={inteiro(aberto.cliques)} />
                <Numero rotulo="cliques no link" valor={inteiro(aberto.cliques_no_link)} tom="text-info" />
                <Numero
                  rotulo="custo por clique no link"
                  valor={aberto.custo_no_link !== null ? dinheiro(aberto.custo_no_link) : "-"}
                  tom="text-success"
                />
              </div>

              {/* Alcance não soma, e dizer isso na tela evita que alguém
                  monte um relatório somando os dias e apresente um número
                  que nunca existiu. */}
              <p className="text-[10px] leading-relaxed text-muted-foreground">
                O alcance mostrado é o maior dia do período, não a soma: a mesma
                pessoa alcançada em dois dias não são duas pessoas.
              </p>

              {(aberto.titulo || aberto.corpo) && (
                <div className="rounded-lg border border-border bg-secondary p-3">
                  {aberto.titulo && (
                    <p className="text-[12px] font-semibold text-foreground">{aberto.titulo}</p>
                  )}
                  {aberto.corpo && (
                    <p className="mt-1 whitespace-pre-line text-[11.5px] leading-relaxed text-muted-foreground">
                      {aberto.corpo}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
