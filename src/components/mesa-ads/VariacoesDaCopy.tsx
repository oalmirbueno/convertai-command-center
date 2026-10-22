import { Flame, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { BotaoComCusto } from "@/components/mesa/Custo";
import {
  chamarAds,
  ESTRUTURAS_DE_COPY,
  LIMITE_TEXTO_VISIVEL,
  LIMITE_TITULO,
  notaCurta,
  parteDeTexto,
  rotuloDoAnguloDeVenda,
  rotuloDoCta,
  TAMANHOS_ADS,
  type CopyDoAnuncio,
  type NotasDoJev,
} from "./adsApi";
import type { EstadoDoModeloDaCopy } from "./ModeloDaCopy";

/**
 * As variações do Refinar copy lado a lado (dono, 22/10/2026: "os criativos são
 * pra vender a ideia"). Cada cartão diz o ângulo de venda e a estrutura, traz
 * as notas do Jev (vende a ideia, clareza, nicho, prova e parada) como AVISO,
 * deixa editar o texto principal e o título ali mesmo, "Usar esta" leva ao
 * formulário, e "Mais ousada" ou "Mais segura" pedem, em um clique, duas
 * versões novas a partir daquele cartão (copy_variar com base e ousadia).
 */

/** Variação que o refino devolve: a copy, a estrutura, se é a melhor, o porquê e os avisos do Jev. */
export type VariacaoDoRefino = CopyDoAnuncio & {
  melhor?: boolean;
  porque?: string;
  o_que_mudou?: string;
  avisos_venda?: string[];
  ousadia?: "ousada" | "segura";
};

/** Notas do Jev em uma linha curta ("vende 8 · clareza 7 · nicho 6"), na ordem do que mais pesa. */
export function linhaDoJev(j: NotasDoJev | null | undefined): string {
  if (!j) return "";
  const partes: string[] = [];
  const por = (rotulo: string, v: unknown) => {
    const n = notaCurta(v);
    if (n) partes.push(`${rotulo} ${n}`);
  };
  por("vende", j.vende);
  por("clareza", j.clareza);
  por("nicho", j.nicho);
  por("prova", j.prova_real);
  por("parada", j.parada);
  return partes.join(" · ");
}

/** Avisos do cartão: os de venda do servidor, o risco de política e o genérico (nunca bloqueiam). */
export function avisosDoCartao(v: VariacaoDoRefino): string[] {
  const j = (v.jev || null) as NotasDoJev | null;
  const saida = Array.isArray(v.avisos_venda) ? v.avisos_venda.filter((x) => typeof x === "string" && x) : [];
  if (j && (j.alerta_politica === true || (typeof j.risco_politica === "number" && j.risco_politica < 5))) saida.push("Risco de política pelo Jev: revise antes de subir.");
  if (j && j.generico === true) saida.push("Genérica pelo Jev: serviria a qualquer concorrente.");
  return saida;
}

export default function VariacoesDaCopy({
  variacoes,
  criativoId,
  modelo,
  onMudar,
  onUsar,
  onNovas,
}: {
  variacoes: VariacaoDoRefino[];
  criativoId: string;
  modelo: EstadoDoModeloDaCopy;
  onMudar: (i: number, campos: Partial<CopyDoAnuncio>) => void;
  onUsar: (v: VariacaoDoRefino) => void;
  /** Novas versões pedidas a partir do cartão i (entram logo depois dele). */
  onNovas: (i: number, novas: VariacaoDoRefino[], avisos: string[]) => void;
}) {
  if (!variacoes.length) return null;
  const partes = () => [parteDeTexto(modelo, TAMANHOS_ADS.variarCopy.entrada + 3000, Math.round(TAMANHOS_ADS.variarCopy.saida * 0.7))];
  const pedir = (v: VariacaoDoRefino, ousadia: "ousada" | "segura") =>
    chamarAds<any>("copy_variar", {
      criativo_id: criativoId,
      ousadia,
      quantidade: 2,
      base: {
        texto_principal: v.texto_principal,
        texto_principal_longo: v.texto_principal_longo,
        titulo: v.titulo,
        descricao: v.descricao,
        cta_meta: v.cta_meta,
        framework: v.framework,
        angulo_de_venda: v.angulo_de_venda,
      },
      ...modelo.corpo,
    });
  const receber = (i: number) => (data: any) => {
    const lista = Array.isArray(data && data.variacoes) ? data.variacoes.filter((x: unknown) => x && typeof x === "object") : [];
    onNovas(i, lista, Array.isArray(data && data.avisos) ? data.avisos.map(String) : []);
  };

  return (
    <div className="-mx-1 mt-2 min-w-0 overflow-x-auto px-1 pb-2" aria-label="Variações de copy">
      <ul className="flex min-w-0 items-stretch" data-variacoes-lado-a-lado="">
        {variacoes.map((v, i) => {
          const angulo = rotuloDoAnguloDeVenda(v.angulo_de_venda);
          const jev = linhaDoJev(v.jev as NotasDoJev | null | undefined);
          const avisos = avisosDoCartao(v);
          const texto = v.texto_principal || "";
          const titulo = v.titulo || "";
          return (
            <li
              key={i}
              data-variacao-da-copy={i}
              className={`mr-2 flex w-[272px] shrink-0 flex-col rounded-lg border bg-background p-2.5 last:mr-0 ${v.melhor ? "border-primary/60" : "border-border"}`}
            >
              <p className="mb-1.5 flex min-w-0 flex-wrap items-center text-[11px]">
                {v.melhor && <span className="mb-0.5 mr-1.5 rounded-full bg-primary px-1.5 py-px font-medium text-primary-foreground">Melhor</span>}
                {angulo && (
                  <span className="mb-0.5 mr-1.5 rounded-full bg-primary/10 px-1.5 py-px font-medium text-primary" data-angulo-da-variacao={v.angulo_de_venda || ""}>
                    <span className="mr-1 font-normal opacity-80">Ângulo</span>
                    <span>{angulo}</span>
                  </span>
                )}
                {v.ousadia && <span className="mb-0.5 mr-1.5 rounded-full bg-muted px-1.5 py-px text-muted-foreground">{v.ousadia === "ousada" ? "Mais ousada" : "Mais segura"}</span>}
                {v.framework && <span className="mb-0.5 text-muted-foreground">{ESTRUTURAS_DE_COPY[v.framework] || v.framework}</span>}
              </p>
              {jev && (
                <p className="mb-1 text-[11px] tabular-nums text-muted-foreground" data-nota-do-jev="">
                  Jev: {jev}
                </p>
              )}
              {avisos.length > 0 && (
                <ul className="mb-1.5 space-y-0.5" aria-label="Avisos do Jev">
                  {avisos.map((a, k) => (
                    <li key={k} className="text-[11px] leading-snug text-warning [overflow-wrap:anywhere]" data-aviso-da-variacao="">{a}</li>
                  ))}
                </ul>
              )}
              <label className="block">
                <span className="mb-0.5 flex items-center text-[11px] text-muted-foreground">
                  <span className="flex-1">Texto principal</span>
                  <span className={`tabular-nums ${texto.length > LIMITE_TEXTO_VISIVEL ? "font-medium text-warning" : ""}`}>{texto.length}/{LIMITE_TEXTO_VISIVEL}</span>
                </span>
                <Textarea aria-label={`Texto principal da variação ${i + 1}`} rows={4} className="text-[13px] leading-snug" value={texto} onChange={(e) => onMudar(i, { texto_principal: e.target.value })} />
              </label>
              <label className="mt-1.5 block">
                <span className="mb-0.5 flex items-center text-[11px] text-muted-foreground">
                  <span className="flex-1">Título</span>
                  <span className={`tabular-nums ${titulo.length > LIMITE_TITULO ? "font-medium text-warning" : ""}`}>{titulo.length}/{LIMITE_TITULO}</span>
                </span>
                <Input aria-label={`Título da variação ${i + 1}`} className="h-8 text-[13px] font-semibold" value={titulo} onChange={(e) => onMudar(i, { titulo: e.target.value })} />
              </label>
              {v.porque && <p className="mt-1.5 text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]">{v.porque}</p>}
              <div className="mt-auto pt-2">
                <div className="flex items-center">
                  <span className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{rotuloDoCta(v.cta_meta)}</span>
                  <Button type="button" size="sm" className="h-7 px-2.5 text-[12px]" onClick={() => onUsar(v)}>
                    Usar esta
                  </Button>
                </div>
                <div className="mt-1.5 flex min-w-0 flex-wrap">
                  <BotaoComCusto
                    rotulo={<><Flame className="mr-1 h-3.5 w-3.5" /> Mais ousada</>}
                    titulo="Mais ousada"
                    descricao="Duas versões novas a partir desta, com gancho mais forte e mais inesperado, dentro da política e só com os fatos. O Jev confere e a melhor vem primeiro."
                    variant="outline"
                    className="mb-1 mr-1.5 h-7 px-2 text-[11px]"
                    partes={partes}
                    executar={() => pedir(v, "ousada")}
                    aoConcluir={receber(i)}
                  />
                  <BotaoComCusto
                    rotulo={<><ShieldCheck className="mr-1 h-3.5 w-3.5" /> Mais segura</>}
                    titulo="Mais segura"
                    descricao="Duas versões novas a partir desta, com a mesma ideia de venda e nada que a Meta possa reprovar. O Jev confere e a melhor vem primeiro."
                    variant="outline"
                    className="mb-1 h-7 px-2 text-[11px]"
                    partes={partes}
                    executar={() => pedir(v, "segura")}
                    aoConcluir={receber(i)}
                  />
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
