import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { CampoDeFormulario, Carregando, EstadoDeErro, GrupoDeCampos, PreencherComIA, Secao, botao, campo as estiloDoCampo, campoTexto, etiqueta, juntar, lista, texto } from "@/components/sistema";
import type { CampoParaPreencher } from "@/components/sistema";
import { ImagemDaMesa } from "@/components/mesa/MesaContexto";
import { textoDoErro } from "@/lib/mesa/api";
import { lerRascunho, salvarRascunho, type PedidoDoDocumento, type VistaDoRascunho } from "@/lib/documentos/registrarEntrega";
import BotaoDocumentoDaEntrega from "./BotaoDocumentoDaEntrega";
import {
  DEFINICOES_DE_DOCUMENTO,
  MODELOS_DE_DOCUMENTO,
  type ModeloDeDocumento,
  type RascunhoDoDocumento,
} from "../../../supabase/functions/_shared/documento-modelos";
import { moverItem } from "../../../supabase/functions/briefing-agente/modulos/briefing-editor";

/**
 * Editar o documento de entrega antes do PDF (frente BRF2, 30/09/2026):
 * - o modelo (mensal, projeto, campanha, site, identidade) com as seções dele;
 * - o texto de cada seção, com "Preencher com IA" por seção e "Preencher
 *   tudo" (peça comum, papel "documento"; a IA só usa o que aconteceu);
 * - as provas: escolher e ordenar (arrastar ou setas), com a legenda;
 * - os números: os reais do painel, e os que a equipe acrescenta só com fonte;
 * - a capa com a identidade do cliente (logo e cor, pelo código).
 * Salvar guarda o rascunho; Gerar faz o PDF com o texto da equipe (sem IA
 * quando o resumo está escrito). Nada vai ao cliente daqui.
 */

const MAX_PROVAS_NO_PDF = 8;

function contextoDosEventos(v: VistaDoRascunho | undefined): string {
  if (!v) return "";
  const linhas = v.eventos.slice(0, 60).map((e) => `${e.quando.slice(8, 10)}/${e.quando.slice(5, 7)} ${e.grupo}: ${e.titulo}${e.detalhe ? ` (${e.detalhe})` : ""}`);
  const numeros = v.numeros.map((n) => `${n.rotulo}: ${n.valor} (fonte: ${n.fonte})`);
  return [`EVENTOS REAIS DO PAINEL (${v.eventos.length}):`, ...linhas, numeros.length ? "NÚMEROS COM FONTE:" : "", ...numeros].filter(Boolean).join("\n").slice(0, 2900);
}

/** Campo de texto com o botão da IA fora do rótulo (botão dentro de <label> atrapalha o clique e o leitor de tela). */
function CampoDeTexto({ id, rotulo, ia, apoio, children }: { id: string; rotulo: string; ia: ReactNode; apoio?: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex min-w-0 items-center">
        <label htmlFor={id} className={juntar(texto.rotulo, "min-w-0 truncate")}>{rotulo}</label>
        {ia && <span className="ml-1 shrink-0">{ia}</span>}
      </div>
      {children}
      {apoio && <p className="mt-1.5 text-[12px] leading-4 text-muted-foreground">{apoio}</p>}
    </div>
  );
}

export default function EditorDoDocumento({
  aberto,
  onFechar,
  alvo,
  marcaId,
}: {
  aberto: boolean;
  onFechar: () => void;
  /** Documento que já existe, ou o pedido de um novo (cliente, tipo, referência). */
  alvo: { documentoId: string; clientId: string } | (PedidoDoDocumento & { modelo?: ModeloDeDocumento }) | null;
  marcaId?: string | null;
}) {
  const qc = useQueryClient();
  const chave = alvo ? ("documentoId" in alvo && !("tipo" in alvo) ? alvo.documentoId : `${alvo.clientId}:${(alvo as PedidoDoDocumento).tipo}:${(alvo as PedidoDoDocumento).referencia}`) : "";
  const vista = useQuery({
    queryKey: ["documento-rascunho", chave],
    enabled: aberto && !!alvo,
    queryFn: () => lerRascunho(alvo as Parameters<typeof lerRascunho>[0]),
    staleTime: 0,
  });
  const [r, setR] = useState<RascunhoDoDocumento | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [novoNumero, setNovoNumero] = useState({ rotulo: "", valor: "", fonte: "" });
  useEffect(() => {
    if (vista.data) setR(vista.data.rascunho);
  }, [vista.data]);

  const v = vista.data;
  const clientId = v ? v.documento.client_id : alvo ? alvo.clientId : "";
  const contexto = useMemo(() => contextoDosEventos(v), [v]);
  const incluidas = r ? r.provas.filter((p) => p.incluir).length : 0;
  const mudou = !!r && !!v && JSON.stringify(r) !== JSON.stringify(v.rascunho);

  const salvar = async (): Promise<boolean> => {
    if (!r || !v) return false;
    setSalvando(true);
    try {
      const s = await salvarRascunho(v.documento.id, r);
      qc.setQueryData(["documento-rascunho", chave], { ...v, rascunho: s.rascunho, documento: { ...v.documento, ...s.documento } });
      void qc.invalidateQueries({ queryKey: ["documentos-da-entrega", clientId] });
      toast.success("Rascunho salvo.");
      return true;
    } catch (e) {
      toast.error(textoDoErro(e, "Não foi possível salvar o rascunho."));
      return false;
    } finally {
      setSalvando(false);
    }
  };

  const mudarSecao = (id: string, textoNovo: string) => r && setR({ ...r, secoes: r.secoes.map((s) => (s.id === id ? { ...s, texto: textoNovo } : s)) });
  const camposDaIa: CampoParaPreencher[] = r
    ? [
        { chave: "resumo", rotulo: "Resumo", tipo: "texto_longo", valorAtual: r.resumo, maximo: 1800, dica: "2 a 5 frases para o cliente, só com os eventos e números da tela. Nunca número sem fonte, nunca promessa de resultado." },
        ...r.secoes.map((s): CampoParaPreencher => ({ chave: `secao.${s.id}`, rotulo: s.titulo, tipo: "texto_longo", valorAtual: s.texto, maximo: 1500, dica: (DEFINICOES_DE_DOCUMENTO[r.modelo].secoes.find((d) => d.id === s.id) || { dica: "" }).dica })),
        { chave: "proximos", rotulo: "Próximos passos", tipo: "lista", valorAtual: r.proximos, maximo: 4, dica: "Passos práticos que decorrem dos eventos. Sem prazo que não esteja na tela." },
      ]
    : [];
  const aplicarIa = (valores: Record<string, unknown>) => {
    if (!r) return;
    let novo = { ...r };
    Object.keys(valores).forEach((k) => {
      const val = valores[k];
      if (k === "resumo" && typeof val === "string") novo = { ...novo, resumo: val };
      else if (k === "proximos" && Array.isArray(val)) novo = { ...novo, proximos: val.map(String).slice(0, 6) };
      else if (k.indexOf("secao.") === 0 && typeof val === "string") novo = { ...novo, secoes: novo.secoes.map((s) => (s.id === k.slice(6) ? { ...s, texto: val } : s)) };
    });
    setR(novo);
  };
  const campoUnico = (chaveDoCampo: string) => camposDaIa.filter((c) => c.chave === chaveDoCampo);
  const ia = (campos: CampoParaPreencher[], rotulo?: string) =>
    clientId && campos.length ? (
      <PreencherComIA papel="documento" clientId={clientId} marcaId={marcaId ?? (v ? v.documento.marca_id : null)} campos={campos} contexto={contexto} fontes={["contexto", "dossie", "briefing"]} rotulo={rotulo} compacto={!rotulo} onAplicar={(valores) => aplicarIa(valores)} onDesfazer={(anteriores) => aplicarIa(anteriores)} />
    ) : null;

  return (
    <Dialog open={aberto} onOpenChange={(o) => { if (!o) onFechar(); }}>
      <DialogContent className="flex max-h-[92vh] w-[calc(100vw-16px)] max-w-4xl flex-col gap-0 p-0 sm:w-[calc(100vw-48px)]">
        <div className="shrink-0 border-b border-border px-5 py-4 pr-12">
          <DialogTitle className={juntar(texto.tituloSecao, "truncate")}>{r ? r.titulo || "Documento da entrega" : "Documento da entrega"}</DialogTitle>
          <DialogDescription className={texto.auxiliar}>
            {v ? `${v.eventos.length} itens do painel · ${incluidas} de ${MAX_PROVAS_NO_PDF} provas${mudou ? " · não salvo" : ""}` : "Abrindo"}
          </DialogDescription>
        </div>
        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
          {vista.isLoading || (!r && !vista.isError) ? (
            <Carregando linhas={5} rotulo="Montando o rascunho" />
          ) : vista.isError || !r || !v ? (
            <EstadoDeErro titulo="O rascunho não abriu." descricao={textoDoErro(vista.error)} acao={<button type="button" onClick={() => void vista.refetch()} className={botao.secundario}>Tentar de novo</button>} />
          ) : (
            <>
              <GrupoDeCampos colunas={2}>
                <CampoDeFormulario rotulo="Título">
                  <input className={estiloDoCampo} value={r.titulo} maxLength={140} onChange={(e) => setR({ ...r, titulo: e.target.value })} aria-label="Título do documento" />
                </CampoDeFormulario>
                <CampoDeFormulario rotulo="Modelo">
                  <select className={estiloDoCampo} value={r.modelo} onChange={(e) => {
                    const m = e.target.value as ModeloDeDocumento;
                    const def = DEFINICOES_DE_DOCUMENTO[m];
                    // Troca as seções do modelo e guarda o texto das que continuam.
                    const secoes = def.secoes.map((d) => ({ id: d.id, titulo: d.titulo, texto: (r.secoes.find((s) => s.id === d.id) || { texto: "" }).texto }));
                    setR({ ...r, modelo: m, secoes });
                  }} aria-label="Modelo do documento">
                    {MODELOS_DE_DOCUMENTO.map((m) => <option key={m} value={m}>{DEFINICOES_DE_DOCUMENTO[m].nome}</option>)}
                  </select>
                </CampoDeFormulario>
              </GrupoDeCampos>
              <label className="flex min-w-0 items-center text-[13px] text-foreground">
                <input type="checkbox" className="mr-2 h-4 w-4 accent-primary" checked={r.capa.identidade_do_cliente} onChange={(e) => setR({ ...r, capa: { identidade_do_cliente: e.target.checked } })} />
                Capa com a identidade do cliente (logo e cor da marca)
              </label>

              <Secao titulo="Texto" recolher={false} acao={ia(camposDaIa, "Preencher tudo")} ajuda="O resumo e as seções do modelo. A IA escreve só com os itens e números do painel; o texto final é o seu. Com o resumo escrito, gerar o PDF não chama IA.">
                <div className="min-w-0 space-y-4">
                  <CampoDeTexto id="doc-resumo" rotulo="Resumo" ia={ia(campoUnico("resumo"))}>
                    <textarea id="doc-resumo" className={campoTexto} rows={4} value={r.resumo} maxLength={1800} onChange={(e) => setR({ ...r, resumo: e.target.value })} />
                  </CampoDeTexto>
                  {r.secoes.map((s) => (
                    <CampoDeTexto key={s.id} id={`doc-secao-${s.id}`} rotulo={s.titulo} ia={ia(campoUnico(`secao.${s.id}`))} apoio={(DEFINICOES_DE_DOCUMENTO[r.modelo].secoes.find((d) => d.id === s.id) || { dica: "" }).dica}>
                      <textarea id={`doc-secao-${s.id}`} className={campoTexto} rows={3} value={s.texto} maxLength={3000} onChange={(e) => mudarSecao(s.id, e.target.value)} />
                    </CampoDeTexto>
                  ))}
                  <CampoDeTexto id="doc-proximos" rotulo="Próximos passos" ia={ia(campoUnico("proximos"))} apoio="Um por linha.">
                    <textarea id="doc-proximos" className={campoTexto} rows={3} value={r.proximos.join("\n")} onChange={(e) => setR({ ...r, proximos: e.target.value.split("\n").map((x) => x.slice(0, 240)).slice(0, 6) })} />
                  </CampoDeTexto>
                </div>
              </Secao>

              <Secao titulo="Provas" descricao={`${incluidas} de ${MAX_PROVAS_NO_PDF} no PDF`} recolher={false} divisoria ajuda="As imagens reais das entregas. Marque as que entram, na ordem que o cliente vai ver (arrastar ou setas), e ajuste a legenda.">
                {!r.provas.length ? (
                  <p className={texto.auxiliar}>Nenhuma entrega com imagem neste período.</p>
                ) : (
                  <ol className={juntar(lista.aberta, lista.divisoria)} aria-label="Provas do documento">
                    {r.provas.map((p, i) => {
                      const c = v.candidatos.find((x) => x.id === p.evento_id);
                      if (!c) return null;
                      return (
                        <li key={p.evento_id} className={juntar(lista.linha, "items-start")} data-prova={p.evento_id}>
                          <input type="checkbox" className="mr-3 mt-3 h-4 w-4 shrink-0 accent-primary" checked={p.incluir} disabled={!p.incluir && incluidas >= MAX_PROVAS_NO_PDF} onChange={(e) => setR({ ...r, provas: r.provas.map((x, k) => (k === i ? { ...x, incluir: e.target.checked } : x)) })} aria-label={`Incluir ${c.titulo}`} />
                          <span className="mr-3 h-12 w-12 shrink-0 overflow-hidden rounded-md bg-muted">
                            {c.imagem && <ImagemDaMesa caminho={c.imagem.caminho} bucket={c.imagem.bucket} alt={c.titulo} className="h-12 w-12 object-cover" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 items-center">
                              <span className="truncate text-[13px] font-medium text-foreground">{c.titulo}</span>
                              {c.forte && <span className={juntar(etiqueta, "ml-2 bg-primary/10 text-primary")}>aprovada</span>}
                            </span>
                            <input className={juntar(estiloDoCampo, "mt-1 h-8")} value={p.legenda} maxLength={200} onChange={(e) => setR({ ...r, provas: r.provas.map((x, k) => (k === i ? { ...x, legenda: e.target.value } : x)) })} aria-label={`Legenda de ${c.titulo}`} />
                          </span>
                          <button type="button" onClick={() => setR({ ...r, provas: moverItem(r.provas, i, i - 1) })} disabled={i === 0} className={juntar(botao.icone, "ml-1")} aria-label={`Subir ${c.titulo}`}>
                            <ArrowUp className="h-4 w-4" aria-hidden="true" />
                          </button>
                          <button type="button" onClick={() => setR({ ...r, provas: moverItem(r.provas, i, i + 1) })} disabled={i === r.provas.length - 1} className={botao.icone} aria-label={`Descer ${c.titulo}`}>
                            <ArrowDown className="h-4 w-4" aria-hidden="true" />
                          </button>
                        </li>
                      );
                    })}
                  </ol>
                )}
              </Secao>

              <Secao titulo="Números" descricao={`${r.numeros.filter((n) => n.incluir).length} no PDF`} recolher={false} divisoria ajuda="Os números vêm do painel com a fonte. Número que você acrescenta só entra com a fonte escrita (ex.: Gerenciador de Anúncios, 30/09).">
                {r.numeros.length > 0 && (
                  <ul className={juntar(lista.aberta, lista.divisoria)}>
                    {r.numeros.map((n, i) => (
                      <li key={`${n.rotulo}-${i}`} className={lista.linha}>
                        <input type="checkbox" className="mr-3 h-4 w-4 shrink-0 accent-primary" checked={n.incluir} onChange={(e) => setR({ ...r, numeros: r.numeros.map((x, k) => (k === i ? { ...x, incluir: e.target.checked } : x)) })} aria-label={`Incluir ${n.rotulo}`} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-foreground">{n.rotulo}: {n.valor}</span>
                          <span className={juntar(texto.auxiliar, "block truncate")}>Fonte: {n.fonte}{n.manual ? " (equipe)" : ""}</span>
                        </span>
                        {n.manual && (
                          <button type="button" onClick={() => setR({ ...r, numeros: r.numeros.filter((_, k) => k !== i) })} className={botao.icone} aria-label={`Tirar ${n.rotulo}`}>
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-2 grid min-w-0 grid-cols-1 items-end gap-2 sm:grid-cols-[1fr_120px_1fr_auto]">
                  <input className={estiloDoCampo} value={novoNumero.rotulo} placeholder="O que é" maxLength={60} onChange={(e) => setNovoNumero({ ...novoNumero, rotulo: e.target.value })} aria-label="Rótulo do número" />
                  <input className={estiloDoCampo} value={novoNumero.valor} placeholder="Valor" inputMode="decimal" onChange={(e) => setNovoNumero({ ...novoNumero, valor: e.target.value })} aria-label="Valor do número" />
                  <input className={estiloDoCampo} value={novoNumero.fonte} placeholder="Fonte (obrigatória)" maxLength={160} onChange={(e) => setNovoNumero({ ...novoNumero, fonte: e.target.value })} aria-label="Fonte do número" />
                  <button
                    type="button"
                    className={botao.secundario}
                    disabled={!novoNumero.rotulo.trim() || novoNumero.fonte.trim().length < 3 || !isFinite(Number(novoNumero.valor.replace(",", "."))) || !novoNumero.valor.trim()}
                    onClick={() => {
                      setR({ ...r, numeros: r.numeros.concat({ rotulo: novoNumero.rotulo.trim(), valor: Number(novoNumero.valor.replace(",", ".")), fonte: novoNumero.fonte.trim(), incluir: true, manual: true }) });
                      setNovoNumero({ rotulo: "", valor: "", fonte: "" });
                    }}
                  >
                    <Plus className="mr-1 h-4 w-4" aria-hidden="true" />
                    Número
                  </button>
                </div>
              </Secao>

              {v.avisos.length > 0 && (
                <ul className="list-disc space-y-1 pl-5" aria-label="Avisos da leitura">
                  {v.avisos.map((a, i) => <li key={i} className="text-[12px] leading-5 text-muted-foreground">{a}</li>)}
                </ul>
              )}
            </>
          )}
        </div>
        {r && v && (
          <div className="flex shrink-0 flex-wrap items-center justify-end border-t border-border px-5 py-3 [&>*]:m-0.5">
            <button type="button" onClick={() => void salvar()} disabled={!mudou || salvando} className={botao.secundario}>
              {salvando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Save className="mr-1.5 h-4 w-4" aria-hidden="true" />}
              Salvar rascunho
            </button>
            <BotaoDocumentoDaEntrega
              pedido={{ clientId: v.documento.client_id, marcaId: v.documento.marca_id, tipo: v.documento.tipo, referencia: v.documento.referencia, titulo: r.titulo || null, usarRascunho: true, documentoId: v.documento.id }}
              rotulo="Gerar PDF"
              variante="primario"
              // Gerar sempre com o rascunho salvo: salva antes quando mudou.
              antesDeGerar={() => (mudou ? salvar() : Promise.resolve(true))}
              onGerado={() => onFechar()}
            />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
