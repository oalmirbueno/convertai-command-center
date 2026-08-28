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

        {/* A base: linha ligando os operadores, para a pirâmide se ler como
            uma só estrutura e não como cartões soltos. */}
        <div className="w-full">
          <div className="mx-auto mb-2 h-px w-3/4 bg-border" />
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
            {operadores.map((o) => <Caixa key={o.id} no={o} />)}
          </div>
        </div>
      </div>

      <p className="mt-3 inline-flex items-start gap-1.5 text-[10.5px] leading-relaxed text-muted-foreground">
        <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
        Toque em qualquer um para ver o contexto e copiar o comando de acionamento.
        O painel não dispara o agente sozinho: quem conversa com ele é o grupo do Hermes.
      </p>
    </div>
  );
}
