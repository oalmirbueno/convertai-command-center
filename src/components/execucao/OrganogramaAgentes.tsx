import { Bot, Crown, Network, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A pirâmide da casa: quem manda, quem coordena, quem executa.
 *
 * O dono no topo, o Hermes como porta de entrada (é por ele que a
 * conversa chega e volta), o coordenador no meio e os operadores na base.
 * Clicar em qualquer um abre o contexto dele.
 *
 * Uma honestidade que o desenho precisa carregar: o painel NÃO dispara o
 * agente sozinho. Não existe canal do painel para dentro do Hermes; o que
 * existe é o comando pronto para colar no grupo. Um botão chamado
 * "acionar" que na verdade copia texto seria uma promessa falsa, então
 * ele se chama o que é.
 */

export interface NoDoOrganograma {
  id: string;
  nome: string;
  papel: string;
  nivel: "dono" | "gateway" | "coordenador" | "operador";
  ativo?: boolean;
  emAndamento?: number;
  feitas?: number;
  bloqueadas?: number;
  /** Função do agente. É ela que agrupa a base da pirâmide. */
  area?: string | null;
  /** Nome de quem coordena. Vazio = responde direto ao Hermes. */
  chefe?: string | null;
}

export default function OrganogramaAgentes({
  nos,
  aoAbrir,
  nomeDoDono,
}: {
  nos: NoDoOrganograma[];
  aoAbrir: (no: NoDoOrganograma) => void;
  nomeDoDono: string;
}) {
  const coordenadores = nos.filter((n) => n.nivel === "coordenador");
  const operadores = nos.filter((n) => n.nivel === "operador");

  // Agrupa por função, preservando a ordem em que os agentes chegaram (a
  // consulta já vem ordenada por display_order). Quem ainda não tem área
  // vai para o fim, num grupo com nome honesto em vez de sumir da tela.
  const porArea = new Map<string, NoDoOrganograma[]>();
  for (const o of operadores) {
    const chave = o.area?.trim() || "Sem área definida";
    const atual = porArea.get(chave);
    if (atual) atual.push(o);
    else porArea.set(chave, [o]);
  }
  const areas = [...porArea.entries()].sort(([a], [b]) =>
    a === "Sem área definida" ? 1 : b === "Sem área definida" ? -1 : a.localeCompare(b, "pt-BR"),
  );

  const Caixa = ({ no, largura }: { no: NoDoOrganograma; largura?: string }) => (
    <button
      type="button"
      onClick={() => aoAbrir(no)}
      className={cn(
        "rounded-xl border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/50",
        no.nivel === "dono" ? "border-primary/40 bg-primary/[0.04]" : "border-border",
        largura,
      )}
    >
      <div className="flex items-center gap-1.5">
        {no.nivel === "dono" ? (
          <Crown className="h-3.5 w-3.5 shrink-0 text-primary" />
        ) : no.nivel === "gateway" ? (
          <Network className="h-3.5 w-3.5 shrink-0 text-info" />
        ) : (
          <Bot className="h-3.5 w-3.5 shrink-0 text-primary" />
        )}
        <p className="truncate text-[12.5px] font-semibold text-foreground">{no.nome}</p>
        {no.nivel === "coordenador" && (
          <span className="shrink-0 rounded-full bg-primary/10 px-1.5 text-[9px] font-semibold text-primary">
            coordena
          </span>
        )}
        {no.ativo === false && (
          <span className="ml-auto shrink-0 text-[9px] text-muted-foreground">inativo</span>
        )}
      </div>
      <p className="mt-0.5 truncate text-[10px] text-muted-foreground">{no.papel}</p>
      {no.chefe && (
        <p className="truncate text-[9.5px] text-muted-foreground/70">responde a {no.chefe}</p>
      )}
      {(no.emAndamento ?? 0) + (no.feitas ?? 0) + (no.bloqueadas ?? 0) > 0 && (
        <div className="mt-1 flex flex-wrap gap-x-2 text-[9.5px]">
          {(no.emAndamento ?? 0) > 0 && <span className="text-info">{no.emAndamento} em andamento</span>}
          {(no.feitas ?? 0) > 0 && <span className="text-success">{no.feitas} feitas</span>}
          {(no.bloqueadas ?? 0) > 0 && <span className="text-destructive">{no.bloqueadas} bloqueadas</span>}
        </div>
      )}
    </button>
  );

  const Tronco = () => <div className="mx-auto h-4 w-px bg-border" />;

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="mb-3 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        Hierarquia da operação
      </p>

      <div className="flex flex-col items-center">
        <Caixa
          no={{ id: "dono", nome: nomeDoDono, papel: "Dono da operação · decide e aprova", nivel: "dono" }}
          largura="w-full max-w-xs"
        />
        <Tronco />
        <Caixa
          no={{
            id: "hermes",
            nome: "Hermes",
            papel: "Porta de entrada · recebe, organiza e responde no grupo",
            nivel: "gateway",
          }}
          largura="w-full max-w-xs"
        />
        <Tronco />

        {coordenadores.length > 0 && (
          <>
            <div className="flex flex-wrap justify-center gap-2">
              {coordenadores.map((c) => <Caixa key={c.id} no={c} largura="w-56" />)}
            </div>
            <Tronco />
          </>
        )}

        {/* A base, separada por FUNÇÃO. Com quatro agentes uma grade solta
            bastava; a partir do quinto, saber que Vértice e Prisma fazem
            coisas diferentes é o que faz o desenho valer. As áreas saem do
            banco, então um agente novo do Hermes aparece aqui sozinho, no
            grupo certo, sem ninguém mexer em código. */}
        <div className="w-full">
          <div className="mx-auto mb-2 h-px w-3/4 bg-border" />
          <div className="space-y-3">
            {areas.map(([area, doGrupo]) => (
              <div key={area}>
                <p className="mb-1.5 text-[9.5px] font-bold uppercase tracking-wider text-muted-foreground">
                  {area}
                  <span className="ml-1.5 font-normal normal-case tracking-normal opacity-60">
                    {doGrupo.length} {doGrupo.length === 1 ? "agente" : "agentes"}
                  </span>
                </p>
                <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
                  {doGrupo.map((o) => <Caixa key={o.id} no={o} />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <p className="mt-3 inline-flex items-start gap-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
        <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
        Toque em qualquer um para ver o contexto e copiar o comando de acionamento.
        Quem organiza esta hierarquia é o Hermes, pelo próprio MCP, e o painel
        redesenha na hora. O painel não dispara o agente sozinho: quem conversa
        com ele é o grupo.
      </p>
    </div>
  );
}
