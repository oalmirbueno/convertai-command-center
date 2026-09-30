import { useMemo, useState } from "react";
import { Check, Wand2 } from "lucide-react";
import { useMesa } from "@/components/mesa/MesaContexto";
import { BotaoComCusto } from "@/components/mesa/Custo";
import { botao, campo, juntar, lista, texto } from "@/components/sistema/estilos";
import { normalizarHex, ROTULO_DO_PAPEL_DA_COR, textoSobre, type PapelDaCor } from "../../../supabase/functions/_shared/cores-da-marca";
import { avisosDeContraste, escalaDaCor, HARMONIAS, paletaHarmonica, paresParaTexto, type CorDaPaleta, type Harmonia } from "../../../supabase/functions/mesa-identidade/modulos/paleta-da-marca";
import { chamarIdentidade, type ProjetoDeIdentidade } from "./identidadeApi";
import { partesDoCusto, SeletorDoModelo, useModeloDaAcao, useProjetoDaMesa } from "./Comuns";

type Cor = { nome: string; papel: PapelDaCor; hex: string };

function Faixa({ cores, altura = 40 }: { cores: Array<{ hex: string; nome?: string }>; altura?: number }) {
  return (
    <span className="flex min-w-0 overflow-hidden rounded-md border border-border" style={{ height: altura }}>
      {cores.map((c, i) => (
        <span key={`${c.hex}-${i}`} className="flex min-w-0 flex-1 items-end px-1.5 pb-1" style={{ background: c.hex, color: textoSobre(c.hex) }} title={`${c.nome || ""} ${c.hex}`}>
          <span className="truncate text-[11px]">{c.hex}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * Contraste WCAG da paleta atual (aviso, nunca trava): os pares que servem
 * para texto corrido e o que merece atenção.
 */
export function ContrasteDaPaleta({ cores }: { cores: Cor[] }) {
  const validas = cores.filter((c) => normalizarHex(c.hex)).map((c) => ({ ...c, hex: normalizarHex(c.hex) as string }));
  const pares = useMemo(() => paresParaTexto(validas.map((c) => c.hex)).slice(0, 8), [validas.map((c) => c.hex).join("|")]);
  const avisos = useMemo(() => avisosDeContraste(validas), [JSON.stringify(validas)]);
  if (validas.length < 2) return null;
  return (
    <div className="mt-4 min-w-0" data-contraste-da-paleta="">
      <p className={juntar(texto.rotulo, "mb-2")}>Contraste para texto (WCAG)</p>
      <div className="-m-1 flex min-w-0 flex-wrap">
        {pares.map((p) => (
          <span key={`${p.frente}-${p.fundo}`} className="m-1 inline-flex h-8 items-center rounded-md border border-border px-2.5 text-[13px] font-semibold" style={{ background: p.fundo, color: p.frente }} title={`${p.frente} sobre ${p.fundo}: ${p.razao.toFixed(2)}:1 (${p.nivel})`}>
            Aa <span className="ml-1.5 text-[11px] font-medium">{p.nivel} {p.razao.toFixed(1)}</span>
          </span>
        ))}
        {!pares.length && <span className={juntar(texto.auxiliar, "m-1 text-warning")}>Nenhum par da paleta passa de AA para texto.</span>}
      </div>
      {avisos.map((a) => (
        <p key={a} className={juntar(texto.auxiliar, "mt-1 text-warning")}>
          {a}
        </p>
      ))}
    </div>
  );
}

/**
 * Gerador de paleta (IDV2): harmonia a partir da cor base (a primária atual
 * ou outra), com neutras tingidas e a escala de apoio. Conta, sem custo. E as
 * 3 paletas propostas pelo diretor (IA, custo antes), cada uma com o
 * contraste conferido. "Usar" troca a paleta do sistema (dá para voltar pelo
 * Desfazer do aviso).
 */
export default function GeradorDePaleta({ cores, onUsar }: { cores: Cor[]; onUsar: (novas: Cor[], origem: string) => void }) {
  const mesa = useMesa();
  const { projeto, guardar } = useProjetoDaMesa();
  const [modeloId, setModeloId] = useModeloDaAcao("identidade");
  const primaria = cores.filter((c) => c.papel === "primaria" && normalizarHex(c.hex))[0];
  const [base, setBase] = useState<string>((primaria && normalizarHex(primaria.hex)) || "#157330");
  const [harmonia, setHarmonia] = useState<Harmonia>("complementar");
  const [pedido, setPedido] = useState("");
  const baseValida = normalizarHex(base);
  const gerada: CorDaPaleta[] = useMemo(() => (baseValida ? paletaHarmonica(baseValida, harmonia) : []), [baseValida, harmonia]);
  const escala = useMemo(() => (baseValida ? escalaDaCor(baseValida) : []), [baseValida]);
  const propostas = (((projeto.dados.sistema || {}) as Record<string, any>).propostas_de_paleta || []) as Array<{ id: string; nome: string; ideia: string; cores: CorDaPaleta[]; avisos: string[] }>;
  const explica = HARMONIAS.filter((h) => h.valor === harmonia)[0];

  return (
    <div className="mt-6 min-w-0 border-t border-border pt-5" data-gerador-de-paleta="">
      <div className="mb-3 flex min-w-0 flex-wrap items-end">
        <label className="m-1 grid min-w-0">
          <span className={juntar(texto.rotulo, "mb-1.5")}>Cor base</span>
          <span className="flex items-center">
            <input type="color" className="mr-2 h-9 w-10 cursor-pointer rounded-md border border-border bg-transparent" value={baseValida || "#157330"} onChange={(e) => setBase(e.target.value.toUpperCase())} aria-label="Escolher a cor base" />
            <input className={juntar(campo, "w-28 font-mono")} value={base} maxLength={7} onChange={(e) => setBase(e.target.value)} aria-label="HEX da cor base" />
          </span>
        </label>
        <label className="m-1 grid min-w-0">
          <span className={juntar(texto.rotulo, "mb-1.5")}>Harmonia</span>
          <select className={juntar(campo, "w-56")} value={harmonia} onChange={(e) => setHarmonia(e.target.value as Harmonia)}>
            {HARMONIAS.map((h) => (
              <option key={h.valor} value={h.valor}>
                {h.rotulo}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={juntar(botao.secundario, "m-1")} disabled={!gerada.length} onClick={() => onUsar(gerada.map((c) => ({ nome: c.nome, papel: c.papel, hex: c.hex })), `harmonia ${explica ? explica.rotulo.toLowerCase() : ""}`)}>
          <Check className="mr-1.5 h-4 w-4" /> Usar esta paleta
        </button>
      </div>
      {explica && <p className={juntar(texto.auxiliar, "mb-2")}>{explica.explica}</p>}
      <Faixa cores={gerada} altura={56} />
      <div className="mt-2 grid min-w-0 grid-cols-2 gap-x-4 sm:grid-cols-4">
        {gerada.map((c) => (
          <span key={c.hex} className={juntar(texto.etiqueta, "truncate text-muted-foreground")}>
            {ROTULO_DO_PAPEL_DA_COR[c.papel]}: {c.nome}
          </span>
        ))}
      </div>
      {escala.length > 0 && (
        <div className="mt-4 min-w-0">
          <p className={juntar(texto.rotulo, "mb-1.5")}>Cores de apoio (escala da base)</p>
          <Faixa cores={escala.map((e) => ({ hex: e.hex, nome: String(e.passo) }))} altura={32} />
        </div>
      )}

      <div className="mt-6 min-w-0" data-propostas-de-paleta="">
        <div className="mb-2 flex min-w-0 flex-wrap items-center">
          <span className={juntar(texto.rotulo, "m-1 min-w-0 flex-1")}>Três paletas do diretor de marca</span>
          <input className={juntar(campo, "m-1 h-8 w-56 text-[12px]")} value={pedido} maxLength={400} placeholder="Pedido (opcional)" onChange={(e) => setPedido(e.target.value)} aria-label="Pedido para as paletas" />
          <SeletorDoModelo papel="identidade" valor={modeloId} onEscolher={setModeloId} />
          <BotaoComCusto
            rotulo={propostas.length ? "Propor de novo" : "Propor 3 paletas"}
            titulo="Paletas da marca"
            partes={() => partesDoCusto(mesa.catalogo, "paletas", modeloId)}
            executar={() => chamarIdentidade<{ projeto: ProjetoDeIdentidade }>("paletas_propor", { projeto_id: projeto.id, modelo_id: modeloId || undefined, pedido: pedido.trim() || undefined })}
            aoConcluir={(d) => guardar(d && d.projeto)}
            variant="outline"
            className="m-1 h-8"
          />
        </div>
        {propostas.length > 0 && (
          <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Paletas propostas">
            {propostas.map((p) => (
              <li key={p.id} className={juntar(lista.linha, "items-start")} data-paleta-proposta={p.id}>
                <span className="min-w-0 flex-1">
                  <span className={juntar(texto.corpo, "block truncate font-medium")}>{p.nome}</span>
                  {p.ideia && <span className={juntar(texto.auxiliar, "mb-2 block")}>{p.ideia}</span>}
                  <Faixa cores={p.cores} altura={36} />
                  {p.avisos.length > 0 && <span className={juntar(texto.auxiliar, "mt-1 block text-warning")}>{p.avisos[0]}</span>}
                </span>
                <button type="button" className={juntar(botao.discreto, "ml-2 h-8 shrink-0")} onClick={() => onUsar(p.cores.map((c) => ({ nome: c.nome, papel: c.papel, hex: c.hex })), `proposta ${p.nome}`)}>
                  <Wand2 className="mr-1.5 h-3.5 w-3.5" /> Usar
                </button>
              </li>
            ))}
          </ul>
        )}
        {!propostas.length && <p className={texto.auxiliar}>Nenhuma proposta ainda.</p>}
      </div>
    </div>
  );
}

export { Faixa };
