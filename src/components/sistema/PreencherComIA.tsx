import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SeletorDeModelo } from "@/components/mesa/Seletores";
import { botao, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import TituloRecolhivel, { useRecolhido } from "@/components/sistema/TituloRecolhivel";
import { gravarEstadoDaTela, lerEstadoDaTela, useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { useAtraso } from "@/lib/useAtraso";
import { lerCatalogo, modeloDoPapel, nomeDoModelo, textoDoErro, usd, type Papel } from "@/lib/mesa/api";
import {
  estimarPreenchimento,
  FONTES_DO_PREENCHIMENTO,
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
 * Preencher com IA (frente PIA, 30/09; simplificado na frente UXS): a peça
 * comum das mesas.
 *
 * Um campo = o botão pequeno do campo; vários = "Preencher tudo" da seção.
 * Nada é gravado sem a pessoa ver. O ✨ abre um popover com a instrução
 * (opcional) e o primário "Preencher · US$ x" já com o foco: Enter preenche
 * (Ctrl ou Cmd+Enter na instrução também). Modelo (padrão do papel,
 * trocável), fontes e "substituir o que já tem" ficam em "Ajustes",
 * recolhido, com o resumo à vista. O custo aparece antes, numa linha de
 * estado. Depois vem a prévia campo a campo (antes e depois), com os avisos
 * em cima; "Aplicar" (um campo) ou "Aplicar tudo" no rodapé fixo, "Aplicar"
 * por campo e "Descartar". Aplicar chama `onAplicar` (a mesa grava) e o
 * aviso oferece Desfazer, que chama `onDesfazer` com os valores anteriores.
 *
 * - O ✨ de um campo já preenchido abre com "substituir" marcado (refazer).
 * - Lembra o último modelo por papel, as fontes por papel e padrão da mesa
 *   (só quando a pessoa mexe) e a instrução. Erro fica visível e a instrução
 *   não se perde. Prévia pronta com o popover fechado: ponto verde no ✨.
 *
 * Servidor: supabase/functions/preencher-ia.
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
  /**
   * Só com `compacto` (UXS 30/09): no computador com mouse, o ícone aparece ao
   * passar o mouse ou ao focar o campo (quem chama põe `group` no bloco do
   * campo). Some só por opacidade: continua no Tab, com foco visível e nome.
   * No toque e abaixo de 768 px fica sempre à vista; aberto, fica à vista.
   */
  revelar?: boolean;
}

const REVELAR_NO_MOUSE =
  "[@media(hover:hover)_and_(min-width:768px)]:opacity-0 [@media(hover:hover)_and_(min-width:768px)]:group-hover:opacity-100 [@media(hover:hover)_and_(min-width:768px)]:group-focus-within:opacity-100 [@media(hover:hover)_and_(min-width:768px)]:focus-visible:opacity-100 data-[state=open]:opacity-100";

/** Chave (rota fixa) do último modelo escolhido por papel: vale em todas as mesas. */
export const chaveDoModeloLembrado = (papel: string) => `preencher-ia:modelo:${papel}`;
export const ROTA_DO_MODELO_LEMBRADO = "/preencher-ia";

/**
 * Chave (rota fixa) das fontes escolhidas: por papel e pelo conjunto padrão
 * da mesa (Pesquisa com web, cláusula sem arquivos...), para um padrão não
 * sobrescrever o outro.
 */
export const chaveDasFontesLembradas = (papel: string, padrao: string[]) => `preencher-ia:fontes:${papel}:${padrao.slice().sort().join(",")}`;

const ehTexto = (v: unknown) => typeof v === "string";
const ehListaDeFontes = (v: unknown) => Array.isArray(v) && v.every((f) => typeof f === "string" && (FONTES_DO_PREENCHIMENTO as string[]).indexOf(f) >= 0);

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
  // O "Preencher tudo" e o ✨ do primeiro campo não dividem o mesmo rascunho.
  const [instrucao, setInstrucao] = useEstadoDaTela<string>(
    `preencher-ia:instrucao:${papel}:${clientId}:${campos.length ? campos[0].chave : ""}${campos.length > 1 ? ":tudo" : ""}`,
    "",
    { validar: ehTexto },
  );
  const padraoDasFontes = props.fontes && props.fontes.length ? props.fontes.slice() : fontesPadraoDoPapel(papel);
  const chaveDasFontes = chaveDasFontesLembradas(papel, padraoDasFontes);
  // null = a pessoa ainda não mexeu: vale o padrão da mesa. Relido a cada abertura (o ✨ de outro campo pode ter mudado).
  const [fontesEscolhidas, setFontesEscolhidas] = useState<FonteDoPreenchimento[] | null>(() =>
    lerEstadoDaTela<FonteDoPreenchimento[] | null>(chaveDasFontes, null, ehListaDeFontes, ROTA_DO_MODELO_LEMBRADO),
  );
  const fontes = fontesEscolhidas || padraoDasFontes;
  const [substituir, setSubstituir] = useState(!!props.substituirInicial);
  const [resultado, setResultado] = useState<ResultadoDoPreenchimento | null>(null);
  const [preenchendo, setPreenchendo] = useState(false);
  const [aplicando, setAplicando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [antesAberto, setAntesAberto] = useState<Record<string, boolean>>({});
  const primarioRef = useRef<HTMLButtonElement>(null);

  const catalogo = useQuery({ queryKey: ["mesa", "catalogo"], queryFn: lerCatalogo, staleTime: 30 * 60_000, enabled: aberto });
  const modelo = modeloDoPapel(catalogo.data || [], papel as Papel, escolhido || null);
  const modeloId = modelo ? modelo.id : escolhido || null;
  // Com o catálogo ainda chegando, o modelo não está decidido: a estimativa espera (uma chamada, não duas).
  const catalogoChegando = aberto && catalogo.isLoading;

  // Custo antes, com respiro de 300 ms entre cliques (uma chamada só); a primeira da abertura vai na hora.
  const assinatura = assinaturaDosCampos(campos);
  const pedidoAgora = JSON.stringify({ m: modeloId, f: fontes, s: substituir, a: assinatura });
  const pedidoAberto = aberto && !resultado && !catalogoChegando ? pedidoAgora : "";
  const pedidoAtrasado = useAtraso(pedidoAberto, 300);
  // Enquanto o respiro não tem valor (acabou de abrir), vale o primeiro pedido da abertura, não cada clique.
  const primeiroPedido = useRef("");
  if (!pedidoAberto) primeiroPedido.current = "";
  else if (!primeiroPedido.current) primeiroPedido.current = pedidoAberto;
  const pedidoUsado = pedidoAtrasado || primeiroPedido.current || pedidoAgora;
  const estimativa = useQuery({
    queryKey: ["preencher-ia", "estimar", papel, clientId, pedidoUsado],
    queryFn: () => {
      const p = JSON.parse(pedidoUsado) as { m: string | null; f: FonteDoPreenchimento[]; s: boolean };
      return estimarPreenchimento({ papel, clientId, marcaId, modeloId: p.m, campos, fontes: p.f, substituir: p.s, contexto, instrucao });
    },
    enabled: aberto && !catalogoChegando && !!clientId && campos.length > 0 && !resultado,
    staleTime: 60_000,
    retry: false,
    placeholderData: keepPreviousData,
  });
  const defasada = pedidoUsado !== pedidoAgora || estimativa.isPlaceholderData || estimativa.isFetching;
  const calculando = catalogoChegando || estimativa.isLoading || (defasada && !estimativa.isError);
  const fresca = !defasada && !estimativa.isError && estimativa.data ? estimativa.data : null;
  // "Nada a preencher" só com o dado fresco: marcar "Substituir" não deixa a mensagem velha nem o botão travado.
  const nadaAPreencher = !!fresca && fresca.campos_a_preencher === 0;

  const porChave = useMemo(() => {
    const m: Record<string, CampoParaPreencher> = {};
    for (const c of campos) m[c.chave] = c;
    return m;
  }, [campos]);

  function abrirOuFechar(v: boolean) {
    if (v && !resultado) {
      // O ✨ de um campo já preenchido é "refazer este texto": abre com substituir marcado.
      // O "Preencher tudo" de uma seção inteira preenchida continua sem (não propõe reescrever tudo de uma vez).
      // substituirInicial (a mesa pede, ex.: sugerir texto de uma cláusula que já tem texto) sempre vale.
      setSubstituir(!!props.substituirInicial || (campos.length === 1 && !campoVazio(campos[0].valorAtual)));
      setFontesEscolhidas(lerEstadoDaTela<FonteDoPreenchimento[] | null>(chaveDasFontes, null, ehListaDeFontes, ROTA_DO_MODELO_LEMBRADO));
      const lembrado = lerEstadoDaTela<string>(chaveDoModeloLembrado(papel), "", ehTexto, ROTA_DO_MODELO_LEMBRADO);
      if (lembrado !== escolhido) setEscolhido(lembrado);
    }
    setAberto(v);
  }

  function alternarFonte(f: FonteDoPreenchimento) {
    const novo = fontes.indexOf(f) >= 0 ? fontes.filter((x) => x !== f) : fontes.concat([f]);
    setFontesEscolhidas(novo);
    gravarEstadoDaTela(chaveDasFontes, novo, ROTA_DO_MODELO_LEMBRADO);
  }

  const podePreencher = !preenchendo && !!clientId && campos.length > 0 && !nadaAPreencher && !calculando;

  async function preencher() {
    // Trava do primário (aria-disabled mantém o foco): calculando, nada a preencher ou já preenchendo.
    if (!podePreencher) return;
    setErro(null);
    setPreenchendo(true);
    try {
      const r = await preencherComIA({ papel, clientId, marcaId, modeloId, campos, fontes, contexto, instrucao, substituir });
      setAntesAberto({});
      setResultado({ valores: r.valores || {}, modelo_id: r.modelo_id, custo_usd: r.custo_usd, fontes: r.fontes || [], avisos: r.avisos || [] });
    } catch (e) {
      // A instrução continua no campo (useEstadoDaTela): só o erro aparece.
      setErro(textoDoErro(e, "Não foi possível preencher agora. Tente de novo."));
    } finally {
      setPreenchendo(false);
    }
  }

  function semRepeticao(e: KeyboardEvent<HTMLButtonElement>) {
    // Segurar o Enter no botão não dispara vários preenchimentos.
    if (e.repeat && (e.key === "Enter" || e.key === " ")) e.preventDefault();
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

  // Prévia chegou (ou voltou ao formulário) com o popover aberto: o foco vai para o primário da fase.
  useEffect(() => {
    if (!aberto) return;
    const el = primarioRef.current;
    if (el && document.activeElement !== el) el.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultado]);

  function descartar() {
    setResultado(null);
    setErro(null);
  }

  const chavesDaPrevia = resultado ? campos.map((c) => c.chave).filter((k) => Object.prototype.hasOwnProperty.call(resultado.valores, k)) : [];
  const previaPronta = !!resultado && chavesDaPrevia.length > 0 && !aberto;
  const rotuloDoGatilho = previaPronta ? `${rotulo}, prévia pronta` : rotulo;
  const larga = !!resultado && chavesDaPrevia.length > 3;

  const rotuloDoPrimario = preenchendo
    ? "Preenchendo..."
    : calculando
      ? "Preencher · calculando..."
      : fresca && !nadaAPreencher
        ? `Preencher · ${usd(fresca.custo_usd)}`
        : "Preencher";
  const resumoDosAjustes = `${modelo ? nomeDoModelo(modelo) : "Modelo padrão"} · ${fontes.length ? fontes.map((f) => ROTULO_DA_FONTE[f]).join(", ") : "sem fontes"}${substituir ? " · substitui o que já tem" : ""}`;

  let estado: ReactNode = "";
  if (catalogoChegando || estimativa.isLoading) estado = "Calculando o custo...";
  else if (estimativa.isError && !estimativa.isFetching && pedidoUsado === pedidoAgora) {
    estado = (
      <>
        <span className="min-w-0">Custo indisponível: {textoDoErro(estimativa.error)}</span>
        <button type="button" className={juntar(botao.discreto, "ml-2 h-7 px-2 text-[12px]")} onClick={() => void estimativa.refetch()}>
          Tentar de novo
        </button>
      </>
    );
  } else if (defasada && estimativa.data) estado = `~${usd(estimativa.data.custo_usd)} · recalculando`;
  else if (nadaAPreencher) {
    estado = (
      <>
        <span className="min-w-0">Todos os campos já estão preenchidos.</span>
        {/* Só marca "Substituir": o custo recalcula e a pessoa confirma no Preencher. */}
        <button type="button" className={juntar(botao.discreto, "ml-2 h-7 px-2 text-[12px]")} onClick={() => setSubstituir(true)}>
          Refazer os campos preenchidos
        </button>
      </>
    );
  } else if (fresca) estado = `Custo estimado: ${usd(fresca.custo_usd)}`;

  return (
    <Popover open={aberto} onOpenChange={abrirOuFechar}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={juntar(compacto && props.revelar ? juntar(botao.icone, REVELAR_NO_MOUSE) : compacto ? botao.icone : botao.barra, "relative")}
          title={rotuloDoGatilho}
          aria-label={rotuloDoGatilho}
          data-preencher-ia={papel}
        >
          <Sparkles className={compacto ? "h-4 w-4" : "mr-1.5 h-3.5 w-3.5"} aria-hidden="true" />
          {!compacto && <span>{rotulo}</span>}
          {/* Prévia já paga esperando: um ponto verde parado (o ::after é a área de toque do toque-compacto). */}
          {previaPronta && <span aria-hidden="true" className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" data-previa-pronta="" />}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className={juntar(larga ? "w-[520px]" : "w-[360px]", "max-w-[calc(100vw-32px)] p-0")}
        onOpenAutoFocus={(e) => {
          // O foco vai para o primário da fase (Preencher ou Aplicar): Enter já faz.
          const el = primarioRef.current;
          if (!el) return;
          e.preventDefault();
          el.focus();
        }}
      >
        <div className="max-h-[70vh] overflow-y-auto p-3" data-preencher-ia-painel="">
          {!resultado ? (
            <div className="space-y-3">
              <div className="flex min-w-0 items-center justify-between">
                <span className={juntar(texto.corpo, "font-medium")}>{rotulo}</span>
                <span className={texto.auxiliar}>{campos.length === 1 ? "1 campo" : `${campos.length} campos`}</span>
              </div>

              <label className="block min-w-0">
                <span className={juntar(texto.rotulo, "mb-1.5 block")}>Instrução (opcional)</span>
                <textarea
                  className={juntar(campoTexto, "min-h-[56px]")}
                  rows={2}
                  value={instrucao}
                  maxLength={1500}
                  placeholder="Ex.: tom mais direto, foco no público jovem"
                  onChange={(e) => setInstrucao(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      e.preventDefault();
                      if (!e.repeat) void preencher();
                    }
                  }}
                />
              </label>

              <button
                ref={primarioRef}
                type="button"
                className={juntar(botao.primario, "w-full", !podePreencher && "cursor-not-allowed opacity-50")}
                aria-disabled={!podePreencher}
                onKeyDown={semRepeticao}
                onClick={() => void preencher()}
                data-preencher-ia-primario=""
              >
                {rotuloDoPrimario}
              </button>

              <p className={juntar(texto.auxiliar, "flex min-w-0 flex-wrap items-center")} aria-live="polite">
                {estado}
              </p>

              {erro && (
                <p role="alert" className="text-[12px] leading-4 text-destructive">
                  {erro}
                </p>
              )}

              <AjustesDoPreenchimento papel={papel} resumo={resumoDosAjustes}>
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

                <label className="flex min-w-0 cursor-pointer items-center">
                  <input type="checkbox" className="mr-2 h-4 w-4" checked={substituir} onChange={(e) => setSubstituir(e.target.checked)} />
                  <span className={texto.corpo}>Substituir o que já tem</span>
                </label>
              </AjustesDoPreenchimento>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex min-w-0 items-center justify-between">
                <span className={juntar(texto.corpo, "font-medium")}>Prévia</span>
                <span className={texto.auxiliar}>Custou {usd(resultado.custo_usd)}</span>
              </div>

              {/* Os avisos antes da lista: com o rodapé fixo, não passam batido. */}
              {resultado.avisos.length > 0 && (
                <ul className="min-w-0 space-y-1" aria-label="Avisos">
                  {resultado.avisos.map((a, i) => (
                    <li key={i} className="text-[12px] leading-4 text-amber-700 dark:text-amber-400">
                      {a}
                    </li>
                  ))}
                </ul>
              )}

              {chavesDaPrevia.length ? (
                <ul className="min-w-0 space-y-3" aria-label="Prévia do preenchimento">
                  {chavesDaPrevia.map((k) => {
                    const c = porChave[k];
                    const antes = valorParaLer(c ? c.valorAtual : undefined);
                    const inteiro = !!antesAberto[k];
                    return (
                      <li key={k} className="min-w-0" data-chave={k}>
                        <div className="flex min-w-0 items-center justify-between">
                          <span className={texto.rotulo}>{c ? c.rotulo : k}</span>
                          {chavesDaPrevia.length > 1 && (
                            <button type="button" className={botao.barra} disabled={aplicando} onClick={() => void aplicar([k])} aria-label={`Aplicar ${c ? c.rotulo : k}`}>
                              Aplicar
                            </button>
                          )}
                        </div>
                        {antes && (
                          <button
                            type="button"
                            className={juntar(
                              "block w-full min-w-0 text-left text-[12px] leading-4 text-muted-foreground line-through",
                              inteiro ? "whitespace-pre-wrap [overflow-wrap:anywhere]" : "truncate",
                            )}
                            aria-expanded={inteiro}
                            title={inteiro ? "Mostrar menos" : "Mostrar o texto anterior inteiro"}
                            onClick={() => setAntesAberto((m) => ({ ...m, [k]: !m[k] }))}
                          >
                            {antes}
                          </button>
                        )}
                        <p className={juntar(texto.corpo, "whitespace-pre-wrap [overflow-wrap:anywhere]")}>{valorParaLer(resultado.valores[k])}</p>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className={texto.corpo}>Nada para aplicar: as fontes não deram base para estes campos.</p>
              )}

              {resultado.fontes.length > 0 && <p className={juntar(texto.auxiliar, "[overflow-wrap:anywhere]")}>Fontes: {resultado.fontes.join(", ")}</p>}

              {chavesDaPrevia.length > 1 ? (
                // Rodapé fixo na região que rola: "Aplicar tudo" sem precisar rolar até o fim.
                <div className="sticky bottom-0 -mx-3 -mb-3 border-t border-border bg-popover px-3 py-2" data-rodape-da-previa="">
                  {erro && (
                    <p role="alert" className="mb-2 text-[12px] leading-4 text-destructive">
                      {erro}
                    </p>
                  )}
                  <div className="flex min-w-0 items-center justify-end">
                    <button type="button" className={juntar(botao.discreto, "mr-2")} onClick={descartar} disabled={aplicando}>
                      Descartar
                    </button>
                    <button ref={primarioRef} type="button" className={botao.primario} onClick={() => void aplicar(chavesDaPrevia)} disabled={aplicando}>
                      Aplicar tudo
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {erro && (
                    <p role="alert" className="text-[12px] leading-4 text-destructive">
                      {erro}
                    </p>
                  )}
                  <div className="flex min-w-0 items-center justify-end">
                    {chavesDaPrevia.length === 1 ? (
                      <>
                        <button type="button" className={juntar(botao.discreto, "mr-2")} onClick={descartar} disabled={aplicando}>
                          Descartar
                        </button>
                        <button
                          ref={primarioRef}
                          type="button"
                          className={botao.primario}
                          onClick={() => void aplicar(chavesDaPrevia)}
                          disabled={aplicando}
                          aria-label={`Aplicar ${porChave[chavesDaPrevia[0]] ? porChave[chavesDaPrevia[0]].rotulo : chavesDaPrevia[0]}`}
                        >
                          Aplicar
                        </button>
                      </>
                    ) : (
                      // Resultado vazio: volta ao formulário (instrução guardada) para trocar as fontes.
                      <button ref={primarioRef} type="button" className={botao.secundario} onClick={descartar} disabled={aplicando}>
                        Voltar e trocar as fontes
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * "Ajustes" do popover (modelo, fontes, substituir): recolhido, com o resumo
 * ao lado, lembrado por pessoa e papel. Monta a cada abertura do popover, e
 * por isso lê a escolha mais nova (o ✨ de outro campo pode ter aberto).
 */
function AjustesDoPreenchimento({ papel, resumo, children }: { papel: string; resumo: string; children: ReactNode }) {
  const [recolhido, setRecolhido] = useRecolhido(`preencher-ia:ajustes:${papel}`, true);
  return (
    <div className="min-w-0 border-t border-border pt-2" data-ajustes-do-preenchimento="">
      <TituloRecolhivel titulo="Ajustes" recolhido={recolhido} onAlternar={() => setRecolhido(!recolhido)} resumo={resumo} />
      {!recolhido && <div className="mt-2 min-w-0 space-y-3">{children}</div>}
    </div>
  );
}

export default PreencherComIA;
