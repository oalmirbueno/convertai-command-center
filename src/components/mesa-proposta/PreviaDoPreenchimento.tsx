import { useMemo, useState } from "react";
import { juntar, lista, texto, botao } from "@/components/sistema/estilos";
import type { ConteudoDaProposta } from "../../../supabase/functions/_shared/proposta-modelo";
import { diferencasDoConteudo, type Diferenca } from "../../../supabase/functions/_shared/proposta-comercial";

/**
 * Prévia do que a IA quer mudar (frente PRO2), campo a campo: antes e
 * depois, com a caixa marcada nos campos que estavam vazios. "Substituir o
 * que já tem" marca todos. Nada muda até "Aplicar". Serve ao Preencher tudo
 * e ao tom da marca; a comparação de versões usa só a lista (sem aplicar).
 */

const corte = (t: string, n = 280) => (t.length > n ? `${t.slice(0, n)}...` : t);

export function ListaDeDiferencas({ diferencas, escolhidas, onEscolher }: { diferencas: Diferenca[]; escolhidas?: string[]; onEscolher?: (chave: string, sim: boolean) => void }) {
  return (
    <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="O que muda">
      {diferencas.map((d) => (
        <li key={d.chave} className="min-w-0 py-2" data-diferenca={d.chave}>
          <label className="flex min-w-0 items-start">
            {onEscolher && escolhidas ? <input type="checkbox" className="mr-2 mt-1 shrink-0" checked={escolhidas.indexOf(d.chave) >= 0} onChange={(e) => onEscolher(d.chave, e.target.checked)} aria-label={`Aplicar ${d.bloco}: ${d.rotulo}`} /> : null}
            <span className="min-w-0 flex-1">
              <span className={juntar(texto.rotulo, "block")}>
                {d.bloco} · {d.rotulo}
                {d.estava_vazio ? " · estava vazio" : ""}
              </span>
              {!d.estava_vazio && <span className={juntar(texto.auxiliar, "block whitespace-pre-wrap line-through [overflow-wrap:anywhere]")}>{corte(d.antes)}</span>}
              <span className={juntar(texto.corpo, "block whitespace-pre-wrap [overflow-wrap:anywhere]")}>{corte(d.depois) || "(vazio)"}</span>
            </span>
          </label>
        </li>
      ))}
    </ul>
  );
}

export default function PreviaDoPreenchimento({
  atual,
  proposto,
  titulo,
  avisos = [],
  onAplicar,
  onDescartar,
  aplicando = false,
}: {
  atual: ConteudoDaProposta;
  proposto: ConteudoDaProposta;
  titulo: string;
  avisos?: string[];
  onAplicar: (chaves: string[]) => void | Promise<void>;
  onDescartar: () => void;
  aplicando?: boolean;
}) {
  const diferencas = useMemo(() => diferencasDoConteudo(atual, proposto).filter((d) => !/\.(visivel|titulo)$/.test(d.chave)), [atual, proposto]);
  const [substituir, setSubstituir] = useState(false);
  const [escolhidas, setEscolhidas] = useState<string[]>(() => diferencas.filter((d) => d.estava_vazio).map((d) => d.chave));
  const marcar = (chave: string, sim: boolean) => setEscolhidas((l) => (sim ? l.concat([chave]) : l.filter((k) => k !== chave)));

  return (
    <div className="min-w-0 space-y-3 border-l-2 border-primary pl-3" data-previa-do-preenchimento="">
      <div className="flex min-w-0 flex-wrap items-center justify-between">
        <p className={juntar(texto.tituloSecao, "mr-3")}>{titulo}</p>
        <span className={texto.auxiliar}>
          {escolhidas.length} de {diferencas.length} campo(s)
        </span>
      </div>
      {avisos.length > 0 && (
        <ul className="list-disc pl-5">
          {avisos.slice(0, 6).map((a) => (
            <li key={a} className={juntar(texto.auxiliar, "text-warning [overflow-wrap:anywhere]")}>
              {a}
            </li>
          ))}
        </ul>
      )}
      {diferencas.length ? (
        <>
          <label className={juntar(texto.corpo, "inline-flex items-center")}>
            <input
              type="checkbox"
              className="mr-2"
              checked={substituir}
              onChange={(e) => {
                setSubstituir(e.target.checked);
                setEscolhidas(e.target.checked ? diferencas.map((d) => d.chave) : diferencas.filter((d) => d.estava_vazio).map((d) => d.chave));
              }}
            />
            Substituir o que já tem
          </label>
          <ListaDeDiferencas diferencas={diferencas} escolhidas={escolhidas} onEscolher={marcar} />
        </>
      ) : (
        <p className={texto.auxiliar}>Nada novo para aplicar.</p>
      )}
      <div className="flex justify-end">
        <button type="button" className={juntar(botao.discreto, "mr-2")} onClick={onDescartar}>
          Descartar
        </button>
        <button type="button" className={botao.primario} onClick={() => void onAplicar(escolhidas)} disabled={!escolhidas.length || aplicando}>
          {aplicando ? "Aplicando..." : `Aplicar ${escolhidas.length === diferencas.length && diferencas.length > 1 ? "tudo" : "os escolhidos"}`}
        </button>
      </div>
    </div>
  );
}
