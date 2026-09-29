import { juntar, texto } from "@/components/sistema";
import {
  type AnexoDoBriefing,
  type ModeloDeBriefing,
  type Respostas,
  campoVisivel,
  textoDaResposta,
} from "../../../supabase/functions/_shared/briefing-modelos";

/**
 * As respostas do briefing para ler (frente BRF): por bloco, pergunta em
 * cima e resposta embaixo, sem caixa. Serve à página pública depois do envio
 * e à leitura do painel. Pergunta sem resposta fica de fora (ou aparece como
 * "Sem resposta" com `mostrarVazias`).
 */
export default function RespostasEmLeitura({
  modelo,
  respostas,
  anexos = [],
  mostrarVazias = false,
  destacar,
}: {
  modelo: ModeloDeBriefing;
  respostas: Respostas;
  anexos?: AnexoDoBriefing[];
  mostrarVazias?: boolean;
  /** Trechos para grifar (a decupagem): aparecem em negrito verde dentro da resposta. */
  destacar?: string[];
}) {
  const blocos = modelo.blocos
    .map((b) => ({
      ...b,
      itens: b.campos
        .filter((c) => campoVisivel(c, respostas))
        .map((c) => ({ key: c.key, pergunta: c.pergunta, resposta: textoDaResposta(c, respostas, anexos) }))
        .filter((i) => mostrarVazias || i.resposta),
    }))
    .filter((b) => b.itens.length > 0);

  if (!blocos.length) return <p className={texto.auxiliar}>Nenhuma resposta ainda.</p>;

  return (
    <div className="min-w-0 space-y-7">
      {blocos.map((b) => (
        <section key={b.id} className="min-w-0" aria-label={b.titulo}>
          <h3 className={juntar(texto.etiqueta, "mb-3 tracking-wide text-primary")}>{b.titulo}</h3>
          <dl className="min-w-0 space-y-4">
            {b.itens.map((i) => (
              <div key={i.key} className="min-w-0">
                <dt className="text-[12px] font-medium leading-4 text-muted-foreground">{i.pergunta}</dt>
                <dd className={juntar(texto.corpo, "mt-1 whitespace-pre-line [overflow-wrap:anywhere]", !i.resposta && "text-muted-foreground")}>
                  {i.resposta ? <ComGrifos texto={i.resposta} grifos={destacar} /> : "Sem resposta"}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}

/** Grifa os trechos decupados dentro da resposta (busca simples, sem regex do usuário). */
function ComGrifos({ texto: t, grifos }: { texto: string; grifos?: string[] }) {
  const lista = (grifos || []).filter((g) => g && g.length >= 3);
  if (!lista.length) return <>{t}</>;
  const baixo = t.toLowerCase();
  const marcas: Array<[number, number]> = [];
  lista.forEach((g) => {
    const alvo = g.toLowerCase();
    let de = baixo.indexOf(alvo);
    while (de >= 0) {
      const ate = de + alvo.length;
      if (!marcas.some(([a, b]) => de < b && ate > a)) marcas.push([de, ate]);
      de = baixo.indexOf(alvo, ate);
    }
  });
  if (!marcas.length) return <>{t}</>;
  marcas.sort((a, b) => a[0] - b[0]);
  const partes: React.ReactNode[] = [];
  let pos = 0;
  marcas.forEach(([a, b], k) => {
    if (a > pos) partes.push(t.slice(pos, a));
    partes.push(<mark key={k} className="rounded-sm bg-primary/15 px-0.5 font-medium text-foreground">{t.slice(a, b)}</mark>);
    pos = b;
  });
  if (pos < t.length) partes.push(t.slice(pos));
  return <>{partes}</>;
}
