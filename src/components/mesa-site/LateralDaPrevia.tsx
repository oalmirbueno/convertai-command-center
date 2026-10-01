import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Eye, EyeOff, Hammer, RotateCcw } from "lucide-react";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { botao, campo, etiqueta, juntar, lista, texto } from "@/components/sistema/estilos";
import { haQuanto, ROTULO_DO_ESTADO_DA_SECAO, type EstadoDaSecao, type PapelDaCor, type PapelDaFonte } from "../../../supabase/functions/mesa-site/modulos/site-previa";
import type { DadosDaPrevia, EdicaoRegistrada } from "./previaApi";
import type { SecaoDaPrevia } from "./previaEstatica";

const PONTO: Record<EstadoDaSecao, string> = {
  pronta: "bg-primary",
  construindo: "bg-primary animate-pulse motion-reduce:animate-none",
  na_fila: "bg-muted-foreground/60",
  falhou: "bg-destructive",
  pendente: "bg-border",
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Uma cor da marca neste site: as da paleta num toque, o código à mão e "da marca" para voltar. */
function LinhaDaCor({ papel, rotulo, dados, ocupado, onEscolher }: { papel: PapelDaCor; rotulo: string; dados: DadosDaPrevia; ocupado: boolean; onEscolher: (papel: PapelDaCor, hex: string | null) => void }) {
  const atual = dados.cores[papel];
  const ajustada = !!dados.ajustes[papel];
  const [digitado, setDigitado] = useState(atual);
  useEffect(() => setDigitado(atual), [atual]);
  const aplicar = () => {
    const v = digitado.trim().toLowerCase();
    if (HEX.test(v) && v !== atual.toLowerCase()) onEscolher(papel, v);
    else setDigitado(atual);
  };
  const paleta = dados.paleta_da_marca.filter((h, i, l) => HEX.test(h) && l.indexOf(h) === i).slice(0, 8);
  return (
    <div className="min-w-0 py-1.5" data-cor-da-previa={papel}>
      <div className="flex min-w-0 items-center">
        <span aria-hidden="true" className="mr-2 inline-block h-4 w-4 shrink-0 rounded border border-border" style={{ background: atual }} />
        <span className={juntar(texto.corpo, "min-w-0 flex-1 truncate")}>{rotulo}</span>
        {ajustada ? (
          <button type="button" className={juntar(botao.discreto, "h-7 px-1.5 text-[12px]")} disabled={ocupado} onClick={() => onEscolher(papel, null)} title="Voltar para a cor da marca">
            Da marca
          </button>
        ) : (
          <span className={texto.auxiliar}>da marca</span>
        )}
      </div>
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center">
        {paleta.map((h) => (
          <button key={h} type="button" className={juntar("toque-compacto mb-1 mr-1 h-6 w-6 shrink-0 rounded border", h.toLowerCase() === atual.toLowerCase() ? "border-foreground" : "border-border")} style={{ background: h }} aria-label={`Usar ${h}`} title={h} disabled={ocupado} onClick={() => onEscolher(papel, h.toLowerCase())} />
        ))}
        <input value={digitado} onChange={(e) => setDigitado(e.target.value)} onBlur={aplicar} onKeyDown={(e) => e.key === "Enter" && aplicar()} className={juntar(campo, "mb-1 h-7 w-[92px] px-2 text-[12px]")} aria-label={`Código da ${rotulo.toLowerCase()}`} maxLength={7} spellCheck={false} disabled={ocupado} />
      </div>
    </div>
  );
}

function LinhaDaFonte({ papel, rotulo, dados, ocupado, onEscolher }: { papel: PapelDaFonte; rotulo: string; dados: DadosDaPrevia; ocupado: boolean; onEscolher: (papel: PapelDaFonte, nome: string | null) => void }) {
  const chave = papel === "titulo" ? "fonte_titulo" : "fonte_texto";
  const ajustada = dados.ajustes[chave] || "";
  const daMarca = papel === "titulo" ? dados.fontes.titulo : dados.fontes.texto;
  return (
    <label className="block min-w-0 py-1.5" data-fonte-da-previa={papel}>
      <span className={juntar(texto.rotulo, "mb-1 block")}>{rotulo}</span>
      <select
        className={juntar(campo, "h-8 text-[12px]")}
        value={ajustada}
        disabled={ocupado}
        onChange={(e) => onEscolher(papel, e.target.value || null)}
        aria-label={`Fonte ${rotulo.toLowerCase()}`}
      >
        <option value="">{ajustada ? "A da marca" : `A da marca${daMarca ? ` (${daMarca})` : ""}`}</option>
        {dados.fontes_disponiveis.map((f) => (
          <option key={f.familia} value={f.familia}>
            {f.familia}
          </option>
        ))}
      </select>
    </label>
  );
}

/**
 * A lateral da prévia (SPV, 30/09): seções (estado da construção, subir,
 * descer, esconder e mostrar), marca deste site (cores e fontes, sem mexer no
 * kit das outras mesas) e o histórico de edições com Desfazer. Cada grupo
 * recolhe; a lateral inteira recolhe para o lado.
 */
export default function LateralDaPrevia({
  secoes,
  dados,
  edicoes,
  avisoDoHistorico,
  ocupado,
  onEditar,
  onDesfazer,
  onIr,
  onPedirAjuste,
}: {
  secoes: SecaoDaPrevia[];
  dados: DadosDaPrevia | null;
  edicoes: EdicaoRegistrada[];
  avisoDoHistorico: string | null;
  ocupado: boolean;
  onEditar: (edicao: Record<string, unknown>) => void;
  onDesfazer: (id: string) => void;
  onIr: (uid: string) => void;
  onPedirAjuste: (uid: string) => void;
}) {
  const [secoesRecolhidas, setSecoesRecolhidas] = useRecolhido("mesa-site:previa:secoes", false);
  const [marcaRecolhida, setMarcaRecolhida] = useRecolhido("mesa-site:previa:marca", true);
  const [edicoesRecolhidas, setEdicoesRecolhidas] = useRecolhido("mesa-site:previa:edicoes", false);
  const visiveis = secoes.filter((s) => !s.oculta);
  const ocultas = secoes.filter((s) => s.oculta);
  const naPagina = visiveis.filter((s) => !s.global);
  const prontas = visiveis.filter((s) => s.estado === "pronta").length;
  const abertas = edicoes.filter((e) => !e.desfeita_em);

  return (
    <div className="min-w-0 space-y-5" data-lateral-da-previa="">
      <div className="min-w-0">
        <TituloRecolhivel titulo="Seções" recolhido={secoesRecolhidas} onAlternar={() => setSecoesRecolhidas(!secoesRecolhidas)} resumo={`${prontas} de ${visiveis.length} prontas${ocultas.length ? ` · ${ocultas.length} escondida${ocultas.length === 1 ? "" : "s"}` : ""}`} />
        {!secoesRecolhidas && (
          <ul className={juntar(lista.aberta, "mt-1")}>
            {visiveis.map((s) => {
              const i = naPagina.indexOf(s);
              return (
                <li key={s.uid} className={juntar(lista.linha, "py-1.5")} data-secao-da-lateral={s.uid} data-estado={s.estado}>
                  <span aria-hidden="true" className={juntar("mr-2 inline-block h-2 w-2 shrink-0 rounded-full", PONTO[s.estado])} />
                  <button type="button" className="mr-1 min-w-0 flex-1 truncate text-left text-[13px]" onClick={() => onIr(s.uid)} title={`${s.rotulo} · ${ROTULO_DO_ESTADO_DA_SECAO[s.estado]}`}>
                    {s.rotulo}
                  </button>
                  {!s.global && (
                    <>
                      <button type="button" className={juntar(botao.icone, "h-7 w-7")} aria-label={`Subir ${s.rotulo}`} title="Subir" disabled={ocupado || i <= 0} onClick={() => onEditar({ tipo: "secao_mover", secao: s.uid, direcao: "subir" })}>
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" className={juntar(botao.icone, "h-7 w-7")} aria-label={`Descer ${s.rotulo}`} title="Descer" disabled={ocupado || i < 0 || i >= naPagina.length - 1} onClick={() => onEditar({ tipo: "secao_mover", secao: s.uid, direcao: "descer" })}>
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                    </>
                  )}
                  <button type="button" className={juntar(botao.icone, "h-7 w-7")} aria-label={`Pedir ajuste em ${s.rotulo}`} title="Pedir ajuste ao motor" disabled={ocupado} onClick={() => onPedirAjuste(s.uid)}>
                    <Hammer className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" className={juntar(botao.icone, "h-7 w-7")} aria-label={`Esconder ${s.rotulo}`} title="Esconder do site" disabled={ocupado || (!s.global && naPagina.length <= 1)} onClick={() => onEditar({ tipo: "secao_visivel", secao: s.uid, visivel: false })}>
                    <EyeOff className="h-3.5 w-3.5" />
                  </button>
                </li>
              );
            })}
            {ocultas.map((s) => (
              <li key={s.uid} className={juntar(lista.linha, "py-1.5 opacity-70")} data-secao-oculta={s.uid}>
                <span aria-hidden="true" className="mr-2 inline-block h-2 w-2 shrink-0 rounded-full bg-border" />
                <span className="mr-1 min-w-0 flex-1 truncate text-[13px] line-through">{s.rotulo}</span>
                <button type="button" className={juntar(botao.discreto, "h-7 px-1.5 text-[12px]")} disabled={ocupado} onClick={() => onEditar({ tipo: "secao_visivel", secao: s.uid, visivel: true })}>
                  <Eye className="mr-1 h-3.5 w-3.5" />
                  Mostrar
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="min-w-0">
        <TituloRecolhivel titulo="Marca deste site" recolhido={marcaRecolhida} onAlternar={() => setMarcaRecolhida(!marcaRecolhida)} resumo={dados && Object.keys(dados.ajustes).length ? "com ajuste só neste site" : "igual ao kit da marca"} />
        {!marcaRecolhida && (
          <div className="mt-1 min-w-0">
            {!dados && <p className={texto.auxiliar}>Lendo a marca</p>}
            {dados && (
              <>
                <LinhaDaCor papel="destaque" rotulo="Destaque" dados={dados} ocupado={ocupado} onEscolher={(papel, hex) => onEditar({ tipo: "cor", papel, hex })} />
                <LinhaDaCor papel="fundo" rotulo="Fundo" dados={dados} ocupado={ocupado} onEscolher={(papel, hex) => onEditar({ tipo: "cor", papel, hex })} />
                <LinhaDaCor papel="texto" rotulo="Texto" dados={dados} ocupado={ocupado} onEscolher={(papel, hex) => onEditar({ tipo: "cor", papel, hex })} />
                <LinhaDaFonte papel="titulo" rotulo="Títulos" dados={dados} ocupado={ocupado} onEscolher={(papel, nome) => onEditar({ tipo: "fonte", papel, nome })} />
                <LinhaDaFonte papel="texto" rotulo="Texto corrido" dados={dados} ocupado={ocupado} onEscolher={(papel, nome) => onEditar({ tipo: "fonte", papel, nome })} />
              </>
            )}
          </div>
        )}
      </div>

      <div className="min-w-0">
        <TituloRecolhivel titulo="Edições" recolhido={edicoesRecolhidas} onAlternar={() => setEdicoesRecolhidas(!edicoesRecolhidas)} resumo={abertas.length ? `${abertas.length} para desfazer` : "nenhuma"} />
        {!edicoesRecolhidas && (
          <div className="mt-1 min-w-0">
            {avisoDoHistorico && <p className={juntar(texto.auxiliar, "mb-1 whitespace-normal text-amber-700 dark:text-amber-400")}>{avisoDoHistorico}</p>}
            {!edicoes.length && !avisoDoHistorico && <p className={texto.auxiliar}>Clique num texto, numa imagem ou numa seção da prévia com Editar ligado.</p>}
            <ul className={lista.aberta}>
              {edicoes.slice(0, 15).map((e) => (
                <li key={e.id} className={juntar(lista.linha, "py-1.5", e.desfeita_em && "opacity-60")} data-edicao={e.id}>
                  <span className="mr-1 min-w-0 flex-1">
                    <span className={juntar(texto.corpo, "block truncate", e.desfeita_em && "line-through")} title={e.resumo}>
                      {e.resumo}
                    </span>
                    <span className={juntar(texto.auxiliar, "block truncate")}>
                      {haQuanto(e.criado_em)}
                      {e.modo === "ajuste" ? " · no motor" : ""}
                      {e.desfeita_em ? " · desfeita" : ""}
                    </span>
                  </span>
                  {e.modo === "ajuste" && !e.desfeita_em && <span className={juntar(etiqueta, "mr-1 bg-muted text-muted-foreground")}>motor</span>}
                  {!e.desfeita_em && (
                    <button type="button" className={juntar(botao.icone, "h-7 w-7")} aria-label={`Desfazer: ${e.resumo}`} title="Desfazer" disabled={ocupado} onClick={() => onDesfazer(e.id)} data-desfazer-edicao={e.id}>
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
