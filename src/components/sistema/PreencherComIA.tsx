import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SeletorDeModelo } from "@/components/mesa/Seletores";
import { botao, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { lerCatalogo, modeloDoPapel, textoDoErro, usd, type Papel } from "@/lib/mesa/api";
import {
  estimarPreenchimento,
  fontesDoPapel,
  fontesPadraoDoPapel,
  preencherComIA,
  ROTULO_DA_FONTE,
  valorParaLer,
  type CampoParaPreencher,
  type FonteDoPreenchimento,
  type ResultadoDoPreenchimento,
} from "@/lib/mesa/preencherComIA";
import { campoVazio } from "../../../supabase/functions/_shared/preencher-com-ia";

/**
 * Preencher com IA (frente PIA, 30/09): a peça comum das mesas.
 *
 * Um campo = o botão pequeno do campo; vários = "Preencher tudo" da seção.
 * Nada é gravado sem a pessoa ver: o botão abre um popover com o modelo
 * (padrão do papel, trocável), as fontes, uma instrução opcional,
 * "substituir o que já tem" e o custo antes. Depois vem a prévia campo a
 * campo (antes e depois), as fontes e os avisos; "Aplicar tudo", "Aplicar"
 * por campo ou "Descartar". Aplicar chama `onAplicar` (a mesa grava) e o
 * toast oferece Desfazer, que chama `onDesfazer` com os valores anteriores.
 *
 * Lembra o último modelo por papel e a instrução (useEstadoDaTela). Erro fica
 * visível e a instrução não se perde. Servidor: supabase/functions/preencher-ia.
 */

export type { CampoParaPreencher, ResultadoDoPreenchimento, FonteDoPreenchimento };

export interface PropsDoPreencherComIA {
  /** Papel da mesa: "proposta", "contrato", "identidade", "naming", "site", "briefing", "documento", "conselho", "motion". */
  papel: string;
  clientId: string;
  marcaId?: string | null;
  /** 1 campo = botão pequeno do campo; vários = "Preencher tudo" da seção. */
  campos: CampoParaPreencher[];
  /** O que a tela sabe e o servidor não (texto curto). */
  contexto?: string;
  /** Padrão: contexto, briefing, dossie (e "base", a base de design UI UX Pro Max, nos papéis site e identidade). */
  fontes?: Array<"contexto" | "briefing" | "dossie" | "arquivos" | "conversa" | "web" | "base">;
  /** Padrão "Preencher com IA" / "Preencher tudo". */
  rotulo?: string;
  /** Só o ícone. */
  compacto?: boolean;
  /** A mesa grava; a peça oferece o Desfazer chamando onDesfazer. */
  onAplicar: (valores: Record<string, unknown>, r: ResultadoDoPreenchimento) => void | Promise<void>;
  onDesfazer?: (anteriores: Record<string, unknown>) => void | Promise<void>;
  /** Abre com "Substituir o que já tem" marcado (ex.: sugerir texto de uma cláusula que já tem texto). */
  substituirInicial?: boolean;
}

/** Chave (rota fixa) do último modelo escolhido por papel: vale em todas as mesas. */
export const chaveDoModeloLembrado = (papel: string) => `preencher-ia:modelo:${papel}`;
export const ROTA_DO_MODELO_LEMBRADO = "/preencher-ia";

const ehTexto = (v: unknown) => typeof v === "string";

function assinaturaDosCampos(campos: CampoParaPreencher[]): string {
  return campos.map((c) => `${c.chave}:${c.tipo}:${campoVazio(c.valorAtual) ? 0 : 1}:${c.maximo || ""}`).join("|");
}

export function PreencherComIA(props: PropsDoPreencherComIA): JSX.Element {
  const { papel, clientId, marcaId, campos, contexto, compacto, onAplicar, onDesfazer } = props;
  const rotulo = props.rotulo || (campos.length > 1 ? "Preencher tudo" : "Preencher com IA");
  const [aberto, setAberto] = useState(false);
  const [escolhido, setEscolhido] = useEstadoDaTela<string>(chaveDoModeloLembrado(papel), "", {
    rota: ROTA_DO_MODELO_LEMBRADO,
    esperaMs: 0,
    validar: ehTexto,
  });
  const [instrucao, setInstrucao] = useEstadoDaTela<string>(`preencher-ia:instrucao:${papel}:${clientId}:${campos.length ? campos[0].chave : ""}`, "", { validar: ehTexto });
  const [fontes, setFontes] = useState<FonteDoPreenchimento[]>(() => (props.fontes && props.fontes.length ? props.fontes.slice() : fontesPadraoDoPapel(papel)));
  const [substituir, setSubstituir] = useState(!!props.substituirInicial);
  const [resultado, setResultado] = useState<ResultadoDoPreenchimento | null>(null);
  const [preenchendo, setPreenchendo] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const catalogo = useQuery({ queryKey: ["mesa", "catalogo"], queryFn: lerCatalogo, staleTime: 30 * 60_000, enabled: aberto });
  const modelo = modeloDoPapel(catalogo.data || [], papel as Papel, escolhido || null);
  const modeloId = modelo ? modelo.id : escolhido || null;

  const assinatura = assinaturaDosCampos(campos);
  const estimativa = useQuery({
    queryKey: ["preencher-ia", "estimar", papel, clientId, modeloId, fontes.join(","), substituir, assinatura],
    queryFn: () => estimarPreenchimento({ papel, clientId, marcaId, modeloId, campos, fontes, substituir, contexto, instrucao }),
    enabled: aberto && !!clientId && campos.length > 0 && !resultado,
    staleTime: 60_000,
    retry: false,
  });

  const porChave = useMemo(() => {
    const m: Record<string, CampoParaPreencher> = {};
    for (const c of campos) m[c.chave] = c;
    return m;
  }, [campos]);

  const nadaAPreencher = estimativa.data ? estimativa.data.campos_a_preencher === 0 : false;

  function alternarFonte(f: FonteDoPreenchimento) {
    setFontes((atual) => (atual.indexOf(f) >= 0 ? atual.filter((x) => x !== f) : atual.concat([f])));
  }

  async function preencher() {
    setErro(null);
    setPreenchendo(true);
    try {
      const r = await preencherComIA({ papel, clientId, marcaId, modeloId, campos, fontes, contexto, instrucao, substituir });
      setResultado({ valores: r.valores || {}, modelo_id: r.modelo_id, custo_usd: r.custo_usd, fontes: r.fontes || [], avisos: r.avisos || [] });
    } catch (e) {
      // A instrução continua no campo (useEstadoDaTela): só o erro aparece.
      setErro(textoDoErro(e, "Não foi possível preencher agora. Tente de novo."));
    } finally {
      setPreenchendo(false);
    }
  }

  async function aplicar(chaves: string[]) {
    if (!resultado || !chaves.length) return;
    const valores: Record<string, unknown> = {};
    const anteriores: Record<string, unknown> = {};
    for (const k of chaves) {
      valores[k] = resultado.valores[k];
      const atual = porChave[k] ? porChave[k].valorAtual : undefined;
      anteriores[k] = atual === undefined ? null : atual;
    }
    setErro(null);
    setAplicando(true);
    try {
      await onAplicar(valores, resultado);
    } catch (e) {
      setErro(textoDoErro(e, "Não foi possível aplicar. Nada mudou."));
      return;
    } finally {
      setAplicando(false);
    }
    const resto: Record<string, unknown> = {};
    for (const k of Object.keys(resultado.valores)) if (chaves.indexOf(k) < 0) resto[k] = resultado.valores[k];
    if (Object.keys(resto).length) setResultado({ ...resultado, valores: resto });
    else {
      setResultado(null);
      setAberto(false);
    }
    const n = chaves.length;
    const frase = n === 1 ? `${porChave[chaves[0]] ? porChave[chaves[0]].rotulo : "Campo"} preenchido` : `${n} campos preenchidos`;
    if (onDesfazer) {
      toast.success(frase, {
        duration: 10_000,
        action: {
          label: "Desfazer",
          onClick: () => {
            Promise.resolve()
              .then(() => onDesfazer(anteriores))
              .catch((e) => toast.error(textoDoErro(e, "Não foi possível desfazer.")));
          },
        },
      });
    } else toast.success(frase);
  }

  function descartar() {
    setResultado(null);
    setErro(null);
  }

  const chavesDaPrevia = resultado ? campos.map((c) => c.chave).filter((k) => Object.prototype.hasOwnProperty.call(resultado.valores, k)) : [];

  return (
    <Popover open={aberto} onOpenChange={setAberto}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={compacto ? botao.icone : botao.barra}
          title={rotulo}
          aria-label={rotulo}
          data-preencher-ia={papel}
        >
          <Sparkles className={compacto ? "h-4 w-4" : "mr-1.5 h-3.5 w-3.5"} aria-hidden="true" />
          {!compacto && <span>{rotulo}</span>}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[360px] max-w-[calc(100vw-32px)] p-0">
        <div className="max-h-[70vh] overflow-y-auto p-3" data-preencher-ia-painel="">
          {!resultado ? (
            <div className="space-y-3">
              <div className="flex min-w-0 items-center justify-between">
                <span className={juntar(texto.corpo, "font-medium")}>{rotulo}</span>
                <span className={texto.auxiliar}>{campos.length === 1 ? "1 campo" : `${campos.length} campos`}</span>
              </div>

              <SeletorDeModelo catalogo={catalogo.data || []} tipo="texto" valor={modelo ? modelo.id : ""} onChange={setEscolhido} />

              <div className="min-w-0">
                <span className={juntar(texto.rotulo, "mb-1.5 block")}>Fontes</span>
                <div className="flex flex-wrap">
                  {fontesDoPapel(papel).map((f) => {
                    const ligada = fontes.indexOf(f) >= 0;
                    return (
                      <button
                        key={f}
                        type="button"
                        aria-pressed={ligada}
                        onClick={() => alternarFonte(f)}
                        className={juntar(
                          "toque-compacto mb-1.5 mr-1.5 inline-flex h-7 items-center rounded-full border px-2.5 text-[12px] transition-colors",
                          ligada ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {ROTULO_DA_FONTE[f]}
                      </button>
                    );
                  })}
                </div>
              </div>

              <label className="block min-w-0">
                <span className={juntar(texto.rotulo, "mb-1.5 block")}>Instrução (opcional)</span>
                <textarea
                  className={juntar(campoTexto, "min-h-[64px]")}
                  value={instrucao}
                  maxLength={1500}
                  placeholder="Ex.: tom mais direto, foco no público jovem"
                  onChange={(e) => setInstrucao(e.target.value)}
                />
              </label>

              <label className="flex min-w-0 cursor-pointer items-center">
                <input type="checkbox" className="mr-2 h-4 w-4" checked={substituir} onChange={(e) => setSubstituir(e.target.checked)} />
                <span className={texto.corpo}>Substituir o que já tem</span>
              </label>

              <p className={texto.auxiliar} aria-live="polite">
                {estimativa.isLoading
                  ? "Calculando o custo..."
                  : estimativa.error
                    ? `Custo indisponível: ${textoDoErro(estimativa.error)}`
                    : nadaAPreencher
                      ? "Todos os campos já estão preenchidos. Marque \"Substituir o que já tem\" para refazer."
                      : estimativa.data
                        ? `Custo estimado: ${usd(estimativa.data.custo_usd)}`
                        : ""}
              </p>

              {erro && (
                <p role="alert" className="text-[12px] leading-4 text-destructive">
                  {erro}
                </p>
              )}

              <button
                type="button"
                className={juntar(botao.primario, "w-full")}
                disabled={preenchendo || !clientId || campos.length === 0 || nadaAPreencher}
                onClick={() => void preencher()}
              >
                {preenchendo ? "Preenchendo..." : "Preencher"}
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex min-w-0 items-center justify-between">
                <span className={juntar(texto.corpo, "font-medium")}>Prévia</span>
                <span className={texto.auxiliar}>Custou {usd(resultado.custo_usd)}</span>
              </div>

              {chavesDaPrevia.length ? (
                <ul className="min-w-0 space-y-3" aria-label="Prévia do preenchimento">
                  {chavesDaPrevia.map((k) => {
                    const c = porChave[k];
                    const antes = valorParaLer(c ? c.valorAtual : undefined);
                    return (
                      <li key={k} className="min-w-0" data-chave={k}>
                        <div className="flex min-w-0 items-center justify-between">
                          <span className={texto.rotulo}>{c ? c.rotulo : k}</span>
                          <button type="button" className={botao.barra} disabled={aplicando} onClick={() => void aplicar([k])} aria-label={`Aplicar ${c ? c.rotulo : k}`}>
                            Aplicar
                          </button>
                        </div>
                        {antes && <p className="text-[12px] leading-4 text-muted-foreground line-through [overflow-wrap:anywhere]">{antes}</p>}
                        <p className={juntar(texto.corpo, "whitespace-pre-wrap [overflow-wrap:anywhere]")}>{valorParaLer(resultado.valores[k])}</p>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className={texto.corpo}>Nada para aplicar: as fontes não deram base para estes campos.</p>
              )}

              {resultado.fontes.length > 0 && <p className={juntar(texto.auxiliar, "[overflow-wrap:anywhere]")}>Fontes: {resultado.fontes.join(", ")}</p>}

              {resultado.avisos.length > 0 && (
                <ul className="min-w-0 space-y-1" aria-label="Avisos">
                  {resultado.avisos.map((a, i) => (
                    <li key={i} className="text-[12px] leading-4 text-amber-700 dark:text-amber-400">
                      {a}
                    </li>
                  ))}
                </ul>
              )}

              {erro && (
                <p role="alert" className="text-[12px] leading-4 text-destructive">
                  {erro}
                </p>
              )}

              <div className="flex min-w-0 items-center justify-end">
                <button type="button" className={juntar(botao.discreto, "mr-2")} onClick={descartar} disabled={aplicando}>
                  Descartar
                </button>
                {chavesDaPrevia.length > 0 && (
                  <button type="button" className={botao.primario} onClick={() => void aplicar(chavesDaPrevia)} disabled={aplicando}>
                    Aplicar tudo
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default PreencherComIA;
