import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, Loader2, MessageSquare, TriangleAlert, Wand2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ParteDaEstimativa } from "@/lib/mesa/api";
import { BotaoComCusto } from "./Custo";
import { ImagemDaMesa } from "./MesaContexto";
import type { CardDaDirecao, CardGerado } from "./useItensDoMes";

/**
 * Um card do estúdio. A lâmina vem inteira do gerador, texto incluído: esta
 * tela só mostra a imagem que voltou. O texto exato do card fica AO LADO,
 * como conferência, nunca desenhado por cima da arte.
 */

// O estudio grava a identidade como { nota, escala_max } (Score do Jev de 0 a escala_max).
const pct = (v: unknown): number | null => {
  if (typeof v !== "object" || v === null) return null;
  const nota = Number((v as any).nota ?? (v as any).score);
  const max = Number((v as any).escala_max);
  if (!Number.isFinite(nota) || !Number.isFinite(max) || max <= 0) return null;
  return Math.round(Math.max(0, Math.min(1, nota / max)) * 100);
};

function Selos({ versao, conferindo, acaoConferir }: { versao: CardGerado; conferindo: boolean; acaoConferir: ReactNode }) {
  const v = versao.verificacao || null;
  if (!v || v.pendente) {
    return conferindo ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[10.5px] text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" /> conferindo
      </span>
    ) : (
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="rounded-full bg-secondary px-2 py-0.5 text-[10.5px] text-muted-foreground">sem conferência</span>
        {acaoConferir}
      </div>
    );
  }
  const identidade = pct(v.identidade);
  return (
    <div className="flex flex-wrap gap-1.5">
      {v.ortografia_ok === true && (
        <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2 py-0.5 text-[10.5px] text-success">
          <CheckCircle2 className="h-3 w-3" /> ortografia ok
        </span>
      )}
      {v.ortografia_ok === false && (
        <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[10.5px] text-destructive">
          <TriangleAlert className="h-3 w-3" /> erro de ortografia
        </span>
      )}
      {identidade !== null && (
        <span className={`rounded-full px-2 py-0.5 text-[10.5px] ${identidade >= 70 ? "bg-success/10 text-success" : identidade >= 50 ? "bg-warning/10 text-warning" : "bg-destructive/10 text-destructive"}`}>
          identidade {identidade}%
        </span>
      )}
    </div>
  );
}

export default function CardDoEstudio({
  conversaId,
  direcao,
  versoes,
  ocupado,
  conferindo,
  partesGerar,
  partesAjustar,
  partesConferir,
  onGerar,
  onAjustar,
  onConferir,
  onConcluido,
}: {
  conversaId: string | null;
  direcao: CardDaDirecao;
  versoes: CardGerado[];
  ocupado: boolean;
  /** Este card está na conferência agora (depois de gerar ou ajustar). */
  conferindo: boolean;
  partesGerar: () => ParteDaEstimativa[];
  partesAjustar: () => ParteDaEstimativa[];
  partesConferir: () => ParteDaEstimativa[];
  onGerar: () => Promise<any>;
  onAjustar: (instrucao: string) => Promise<any>;
  onConferir: () => Promise<any>;
  onConcluido: () => void;
}) {
  const ordenadas = versoes.slice().sort((a, b) => a.versao - b.versao);
  const ultima = ordenadas[ordenadas.length - 1] || null;
  const [versaoVista, setVersaoVista] = useState<number | null>(ultima?.versao ?? null);
  const [ajustando, setAjustando] = useState(false);
  const [instrucao, setInstrucao] = useState("");

  // Chegou versão nova: mostra a nova.
  useEffect(() => { setVersaoVista(ultima?.versao ?? null); }, [ultima?.versao]);

  const vista = ordenadas.find((v) => v.versao === versaoVista) || ultima;

  const pedidos = useQuery({
    queryKey: ["mesa", "ajustes", conversaId, direcao.ordem],
    enabled: ajustando && !!conversaId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("agente_mensagens")
        .select("id, papel, conteudo, anexos, criado_em")
        .eq("conversa_id", conversaId)
        .order("criado_em", { ascending: true });
      if (error) throw error;
      return ((data || []) as any[]).filter((m) => {
        const anexos = Array.isArray(m.anexos) ? m.anexos : m.anexos ? [m.anexos] : [];
        return m.papel !== "sistema" && anexos.some((a: any) => Number(a?.ordem) === direcao.ordem);
      });
    },
  });

  return (
    <article className="grid min-w-0 grid-cols-1 gap-4 rounded-xl border border-border bg-card p-3.5 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-2">
        <div className="overflow-hidden rounded-lg border border-border">
          <ImagemDaMesa caminho={vista?.storage_path} alt={`Card ${direcao.ordem}`} className="aspect-[4/5] w-full" />
        </div>
        {ordenadas.length > 1 && (
          <div className="flex flex-wrap gap-1">
            {ordenadas.map((v) => (
              <button
                key={v.versao}
                type="button"
                onClick={() => setVersaoVista(v.versao)}
                className={`rounded-md px-2 py-0.5 text-[11px] ${vista?.versao === v.versao ? "bg-primary/15 text-primary" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
              >
                v{v.versao}
              </button>
            ))}
          </div>
        )}
        {vista && (
          <Selos
            versao={vista}
            conferindo={conferindo && vista.versao === ultima?.versao}
            acaoConferir={
              vista.versao === ultima?.versao ? (
                <BotaoComCusto
                  rotulo="Conferir"
                  titulo={`Conferir o card ${direcao.ordem}`}
                  descricao="A leitura compara o texto da imagem com o texto exato e o Jev confere a identidade."
                  variant="ghost"
                  className="h-6 px-2 text-[11px]"
                  disabled={ocupado}
                  partes={partesConferir}
                  executar={onConferir}
                  aoConcluir={onConcluido}
                />
              ) : null
            }
          />
        )}
      </div>

      <div className="min-w-0 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[12.5px] font-semibold">Card {direcao.ordem}{direcao.funcao ? <span className="font-normal text-muted-foreground"> · {direcao.funcao}</span> : null}</p>
          <div className="flex flex-wrap gap-2">
            <BotaoComCusto
              rotulo={ultima ? "Gerar de novo" : "Gerar card"}
              titulo={`Gerar o card ${direcao.ordem}`}
              descricao="O gerador faz a lâmina inteira com o texto dentro. Depois a leitura confere a ortografia e o Jev confere a identidade."
              variant={ultima ? "outline" : "default"}
              disabled={ocupado}
              partes={partesGerar}
              executar={onGerar}
              aoConcluir={onConcluido}
            />
            {ultima && (
              <Button type="button" size="sm" variant="ghost" onClick={() => setAjustando((v) => !v)} disabled={ocupado}>
                <MessageSquare className="mr-1 h-3.5 w-3.5" /> Ajustar
              </Button>
            )}
          </div>
        </div>

        <div className="rounded-lg bg-secondary/40 p-2.5">
          <p className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Texto exato</p>
          <p className="mt-0.5 whitespace-pre-wrap text-[13px] leading-relaxed [overflow-wrap:anywhere]">{direcao.texto_exato || "Sem texto neste card."}</p>
        </div>
        {direcao.composicao && (
          <div>
            <p className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Composição</p>
            <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{direcao.composicao}</p>
          </div>
        )}
        {vista?.verificacao && !vista.verificacao.pendente && vista.verificacao.ortografia_ok === false && vista.verificacao.texto_lido && (
          <div className="rounded-lg border border-destructive/30 p-2.5">
            <p className="text-[10.5px] uppercase tracking-wide text-destructive">Texto lido na imagem</p>
            <p className="mt-0.5 whitespace-pre-wrap text-[12.5px] [overflow-wrap:anywhere]">{vista.verificacao.texto_lido}</p>
          </div>
        )}

        {ajustando && ultima && (
          <div className="space-y-2 rounded-lg border border-border p-2.5">
            {(pedidos.data || []).length > 0 && (
              <ul className="space-y-1.5">
                {(pedidos.data || []).map((m: any) => (
                  <li key={m.id} className={`rounded-md px-2.5 py-1.5 text-[12px] [overflow-wrap:anywhere] ${m.papel === "usuario" ? "bg-primary/10" : "bg-secondary/60 text-muted-foreground"}`}>
                    {m.conteudo}
                  </li>
                ))}
              </ul>
            )}
            <Textarea value={instrucao} onChange={(e) => setInstrucao(e.target.value)} rows={2} placeholder="Ex.: título maior e a planta mais à esquerda" />
            <div className="flex justify-end">
              <BotaoComCusto
                rotulo={<><Wand2 className="mr-1 h-3.5 w-3.5" /> Ajustar este card</>}
                titulo={`Ajustar o card ${direcao.ordem}`}
                descricao="O diretor transforma o pedido em instrução de edição e o gerador edita a versão atual. A nova versão passa pela conferência."
                disabled={ocupado || !instrucao.trim()}
                partes={partesAjustar}
                executar={() => onAjustar(instrucao.trim())}
                aoConcluir={() => {
                  setInstrucao("");
                  onConcluido();
                }}
              />
            </div>
          </div>
        )}
      </div>
    </article>
  );
}
