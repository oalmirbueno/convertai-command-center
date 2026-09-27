import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import TextoDoAgente from "@/components/agentes/TextoDoAgente";
import { CaminhoDaMensagem } from "@/components/agentes/CaminhoPronto";
import { Check, ImagePlus, Loader2, Palette, Send, ThumbsDown, ThumbsUp, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { AjudaRecolhida, EstadoVazio, PainelDoAgente, SeletorCompacto, botao, campo, juntar, texto, useEstadoDaTela } from "@/components/sistema";
import CartaoDeAcao, { OQuePossoFazer } from "@/components/agentes/CartaoDeAcao";
import { BotaoComCusto, EstimativaInline, useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { acoesDaMensagem, chamarAcaoDoAgente } from "@/lib/agentes/acoesDoAgente";
import { padraoPara, textoDoErro, usd } from "@/lib/mesa/api";
import {
  type AnexoParaEnviar,
  CAMPOS_DAS_REGRAS,
  chamarEstilo,
  chaveDoEstilo,
  chaveDoEstiloLeve,
  type EstadoDoEstilo,
  type GuiaDoEstilo,
  guiaComConteudo,
  guiaDoFormulario,
  imagensDe,
  MAX_ANEXOS_POR_MENSAGEM,
  MAX_TESTES_POR_VEZ,
  type MensagemDoEstilo,
  normalizarEstado,
  prepararAnexo,
  ROTULOS_DAS_REGRAS,
} from "./estiloApi";
import AbaTemplates, { PropostasDaAcao, type ReferenciaParaCombinar } from "./AbaTemplates";

/**
 * Painel do agente de estilo (frente S2). Três abas, pouco texto:
 * - Conversa: fala com o diretor de estilo, anexa várias referências de uma
 *   vez (arrastar, colar ou escolher), vê a proposta em blocos e confirma.
 * - Estilo: o guia atual legível e editável, referências, aprendizados e as
 *   versões com "voltar para esta".
 * - Testes: gera 1 a 4 imagens com o gerador do Estúdio (custo antes),
 *   aprova (vai para Arquivos e vira referência) ou descarta.
 * - Templates (frente T): moldes e referências de carrossel, combinar
 *   (AbaTemplates.tsx). A aba aberta fica lembrada por cliente.
 */

type Aba = "conversa" | "estilo" | "templates" | "testes";
const ABAS: Aba[] = ["conversa", "estilo", "templates", "testes"];

const ATALHOS = [
  { rotulo: "Montar o estilo", texto: "Estude este cliente e monte o estilo de design dele." },
  { rotulo: "Tendências do nicho", texto: "Pesquise o que chama atenção no nicho deste cliente e diga o que vale trazer para o estilo." },
  { rotulo: "Cliente não gostou", texto: "O cliente não gostou de " },
  { rotulo: "Gerar 2 testes", texto: "Gere 2 imagens de teste do estilo atual." },
  { rotulo: "Template de carrossel", texto: "Quero carrossel nessa pegada, com essa continuidade. Monte o template." },
];
const CAPACIDADES = ["ler várias referências", "propor e gravar o estilo", "registrar o que o cliente gostou", "gerar testes", "montar e combinar templates"];

const ORIGEM_DA_VERSAO: Record<string, string> = {
  agente: "Agente",
  equipe: "Equipe",
  voltou: "Voltou",
  teste_aprovado: "Teste aprovado",
  referencias: "Referências",
};

const quando = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};

/** O guia em blocos claros (proposta do agente e aba Estilo). */
export function GuiaLegivel({ guia, compacto = false }: { guia: GuiaDoEstilo; compacto?: boolean }) {
  return (
    <div className="min-w-0 space-y-2" data-guia-legivel="">
      {guia.resumo && <p className={juntar(texto.corpo, "[overflow-wrap:anywhere]")}>{guia.resumo}</p>}
      <dl className={juntar("grid grid-cols-1 gap-x-4 gap-y-2", compacto ? "" : "sm:grid-cols-2")}>
        {CAMPOS_DAS_REGRAS.filter((c) => guia.regras && guia.regras[c] && guia.regras[c].length > 0).map((c) => (
          <div key={c} className="min-w-0">
            <dt className={texto.rotulo}>{ROTULOS_DAS_REGRAS[c]}</dt>
            <dd className="mt-0.5 text-[12.5px] leading-5 text-foreground [overflow-wrap:anywhere]">
              {guia.regras[c].map((r, i) => (
                <span key={i} className="block">
                  {r}
                </span>
              ))}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Caixa de imagem 4:5 sem aspect-ratio (Safari 11): altura pelo padding. */
function Miniatura({ url, alt, children }: { url: string; alt: string; children?: ReactNode }) {
  return (
    <div className="relative w-full overflow-hidden rounded-md bg-muted" style={{ paddingBottom: "125%" }}>
      {url ? <img src={url} alt={alt} loading="lazy" className="absolute inset-0 h-full w-full object-cover" /> : null}
      {children}
    </div>
  );
}

export default function PainelDoEstilo({ modeloImagemId }: { modeloImagemId?: string | null }) {
  const { clientId, clientName, catalogo, atualizarCusto, marca } = useMesa();
  const marcaId = marca && !marca.principal ? marca.id : null;
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const chave = chaveDoEstilo(clientId, marcaId);
  const [aba, setAba] = useEstadoDaTela<Aba>(`estilo:aba:${clientId}`, "conversa", { validar: (v) => ABAS.indexOf(v as Aba) >= 0 });

  const consulta = useQuery({
    queryKey: chave,
    queryFn: async () => normalizarEstado(await chamarEstilo("estado", clientId, marcaId)),
    staleTime: 60_000,
    placeholderData: (anterior) => anterior,
  });
  const estado = consulta.data || null;
  const guardar = (d: any) => {
    const n = normalizarEstado(d);
    if (!n) return;
    queryClient.setQueryData(chave, (antes: EstadoDoEstilo | null | undefined) => ({ ...n, conversa_id: antes ? antes.conversa_id : n.conversa_id, mensagens: antes ? antes.mensagens : n.mensagens }));
    queryClient.setQueryData(chaveDoEstiloLeve(clientId, marcaId), { ativo: n.ativo, versao_atual: n.versao_atual });
  };

  // ------------------------------------------------------------ conversa
  const [mensagens, setMensagens] = useState<MensagemDoEstilo[]>([]);
  const [conversaId, setConversaId] = useState<string | null>(null);
  const [nova, setNova] = useState(false);
  const [textoMsg, setTextoMsg] = useState("");
  const [anexos, setAnexos] = useState<AnexoParaEnviar[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const lista = useRef<HTMLDivElement | null>(null);
  const escolher = useRef<HTMLInputElement | null>(null);
  const carregou = useRef(false);

  useEffect(() => {
    if (carregou.current || !estado || !estado.mensagens) return;
    carregou.current = true;
    setMensagens(estado.mensagens);
    setConversaId(estado.conversa_id || null);
  }, [estado]);

  useEffect(() => {
    if (lista.current) lista.current.scrollTop = lista.current.scrollHeight;
  }, [mensagens.length, aba]);

  useEffect(() => () => anexos.forEach((a) => URL.revokeObjectURL(a.previa)), []); // eslint-disable-line react-hooks/exhaustive-deps

  const anexar = async (arquivos: File[]) => {
    if (!arquivos.length) return;
    const vagas = MAX_ANEXOS_POR_MENSAGEM - anexos.length;
    if (vagas <= 0) {
      toast.info(`Até ${MAX_ANEXOS_POR_MENSAGEM} imagens por mensagem.`);
      return;
    }
    const prontos: AnexoParaEnviar[] = [];
    for (const f of arquivos.slice(0, vagas)) {
      try {
        prontos.push(await prepararAnexo(f));
      } catch (e) {
        toast.error("Imagem não anexada", { description: textoDoErro(e) });
      }
    }
    if (prontos.length) {
      setAnexos((l) => l.concat(prontos));
      setAba("conversa");
    }
  };

  const enviar = async () => {
    const m = textoMsg.trim();
    if ((!m && !anexos.length) || enviando) return;
    setEnviando(true);
    const enviados = anexos;
    setMensagens((l) => l.concat([{ id: null, papel: "usuario", conteudo: m || `${enviados.length} referência(s) anexada(s).`, anexos: enviados.map((a) => ({ tipo: "imagem", url: a.previa })) }]));
    setTextoMsg("");
    setAnexos([]);
    try {
      const d = await chamarEstilo<any>("conversar", clientId, marcaId, {
        mensagem: m,
        anexos: enviados.map((a) => ({ nome: a.nome, mime: a.mime, base64: a.base64 })),
        conversa_id: conversaId || undefined,
        nova_conversa: nova || undefined,
        modelo_imagem_id: modeloImagemId || undefined,
      });
      setNova(false);
      setConversaId(d && d.conversa_id ? String(d.conversa_id) : conversaId);
      setMensagens((l) =>
        l.concat([{ id: d && d.mensagem_id ? String(d.mensagem_id) : null, papel: "agente", conteudo: String((d && d.resposta) || ""), anexos: d && Array.isArray(d.anexos) ? d.anexos : [], custo_usd: d && typeof d.custo_usd === "number" ? d.custo_usd : null, nova: true }]),
      );
      if (d && typeof d.aviso_dos_templates === "string") toast.info(d.aviso_dos_templates);
      atualizarCusto();
    } catch (e) {
      avisarErro(e, "O agente de estilo não respondeu");
      setAnexos(enviados);
    } finally {
      setEnviando(false);
    }
  };

  const diretor = padraoPara(catalogo, "diretor_arte");
  const leitor = padraoPara(catalogo, "leitura");
  const gerador = modeloImagemId ? catalogo.find((m) => m.id === modeloImagemId) || padraoPara(catalogo, "imagem") : padraoPara(catalogo, "imagem");
  const partesDaConversa = diretor
    ? [
        { modeloId: diretor.id, tipo: "texto" as const, tokensEntrada: 9_000, tokensSaida: 2_500 },
        ...(anexos.length && leitor ? [{ modeloId: leitor.id, tipo: "texto" as const, tokensEntrada: 1_500 * anexos.length, tokensSaida: 1_500 }] : []),
      ]
    : null;

  // ------------------------------------------------------------ ações diretas (sem IA)
  const [ocupado, setOcupado] = useState<string | null>(null);
  const direto = async (acao: string, corpo: Record<string, unknown>, rotulo: string) => {
    setOcupado(acao + JSON.stringify(corpo));
    try {
      guardar(await chamarEstilo(acao, clientId, marcaId, corpo));
      return true;
    } catch (e) {
      avisarErro(e, rotulo);
      return false;
    } finally {
      setOcupado(null);
    }
  };

  // ------------------------------------------------------------ edição do guia
  const [editando, setEditando] = useState(false);
  const [resumo, setResumo] = useState("");
  const [campos, setCampos] = useState<Record<string, string>>({});
  const abrirEdicao = () => {
    const g = estado && estado.guia;
    setResumo(g ? g.resumo : "");
    const c: Record<string, string> = {};
    for (const k of CAMPOS_DAS_REGRAS) c[k] = g && g.regras && g.regras[k] ? g.regras[k].join("\n") : "";
    setCampos(c);
    setEditando(true);
  };

  // ------------------------------------------------------------ testes
  const [quantos, setQuantos] = useState("2");
  const [tema, setTema] = useState("");

  const temGuia = !!estado && guiaComConteudo(estado.guia);
  const descricao = estado
    ? `${estado.marca_nome || clientName}${estado.versao_atual ? ` · versão ${estado.versao_atual} · ${estado.ativo ? "ligado" : "desligado"}` : " · sem estilo ainda"}`
    : clientName;

  const soltar = (e: React.DragEvent) => {
    e.preventDefault();
    setArrastando(false);
    void anexar(imagensDe(e.dataTransfer ? e.dataTransfer.files : null));
  };

  const compositorDaConversa = (
    <>
      <OQuePossoFazer capacidades={CAPACIDADES} atalhos={ATALHOS} onAtalho={(t) => setTextoMsg(t)} />
      {anexos.length > 0 && (
        <div className="grid grid-cols-6 gap-1.5" data-anexos-do-estilo="">
          {anexos.map((a, i) => (
            <div key={a.previa} className="relative">
              <Miniatura url={a.previa} alt={a.nome} />
              <button
                type="button"
                onClick={() => {
                  URL.revokeObjectURL(a.previa);
                  setAnexos((l) => l.filter((_, k) => k !== i));
                }}
                className="absolute right-0.5 top-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full bg-background/90 text-foreground"
                aria-label={`Tirar ${a.nome}`}
              >
                <X className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end">
        <button type="button" className={juntar(botao.icone, "mb-1 mr-1.5 h-10 w-10")} onClick={() => escolher.current?.click()} aria-label="Anexar referências" title="Anexar referências (ou arraste e cole)">
          <ImagePlus className="h-4 w-4" aria-hidden="true" />
        </button>
        <input
          ref={escolher}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            void anexar(imagensDe(e.target.files));
            e.target.value = "";
          }}
        />
        <Textarea
          value={textoMsg}
          onChange={(e) => setTextoMsg(e.target.value)}
          onPaste={(e) => {
            const imgs = imagensDe(e.clipboardData ? e.clipboardData.items : null);
            if (imgs.length) {
              e.preventDefault();
              void anexar(imgs);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void enviar();
            }
          }}
          rows={2}
          maxLength={4000}
          placeholder="Ex.: o cliente gostou deste jeito, monte o estilo a partir destas referências"
          className="mr-2 min-w-0 flex-1 text-[12.5px]"
          aria-label="Mensagem ao agente de estilo"
        />
        <button type="button" className={juntar(botao.primario, "h-10 w-10 px-0")} onClick={() => void enviar()} disabled={enviando || (!textoMsg.trim() && !anexos.length)} aria-label="Enviar ao agente de estilo">
          {enviando ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
        </button>
      </div>
      <p className="text-right">
        <EstimativaInline partes={partesDaConversa} />
      </p>
    </>
  );

  const n = Math.max(1, Math.min(MAX_TESTES_POR_VEZ, Number(quantos) || 1));
  const compositorDosTestes = (
    <div className="flex flex-wrap items-center">
      <SeletorCompacto
        rotulo="Quantas imagens"
        opcoes={["1", "2", "3", "4"].map((v) => ({ valor: v, rotulo: v }))}
        valor={quantos}
        onEscolher={setQuantos}
        className="mb-1 mr-2"
      />
      <input value={tema} onChange={(e) => setTema(e.target.value)} maxLength={200} placeholder="Tema (opcional)" aria-label="Tema das imagens de teste" className={juntar(campo, "mb-1 mr-2 w-auto min-w-0 flex-1")} />
      <BotaoComCusto
        rotulo={`Gerar ${n}`}
        titulo="Imagens de teste do estilo"
        descricao="Gera com o mesmo gerador do Estúdio."
        partes={() => (gerador ? [{ modeloId: gerador.id, tipo: "imagem", imagens: n, qualidade: "media" }] : [])}
        disabled={!temGuia}
        className="mb-1"
        executar={() => chamarEstilo("teste_gerar", clientId, marcaId, { quantos: n, tema: tema.trim() || undefined, modelo_imagem_id: modeloImagemId || undefined })}
        aoConcluir={(d) => {
          guardar(d);
          if (d && Array.isArray(d.avisos) && d.avisos.length) toast.info(d.avisos.join(" "));
        }}
      />
    </div>
  );

  const conteudoDaConversa = (
    <>
      {!mensagens.length && (
        <EstadoVazio
          compacto
          icone={<Palette className="h-4 w-4" />}
          titulo="Converse sobre o estilo deste cliente"
          descricao="Mande referências (várias de uma vez), conte o que o cliente gostou e peça para montar o estilo."
        />
      )}
      {mensagens.map((m, i) => {
        const acoes = acoesDaMensagem(m.anexos);
        const imagens = (m.anexos || []).filter((a: any) => a && a.tipo === "imagem" && a.url);
        const leitura = (m.anexos || []).find((a: any) => a && a.tipo === "leitura_de_referencias" && a.texto);
        return (
          <div key={m.id || `m-${i}`} className={m.papel === "usuario" ? "ml-8" : "mr-2"}>
            {imagens.length > 0 && (
              <div className="mb-1 ml-auto grid max-w-[260px] grid-cols-3 gap-1">
                {imagens.map((a: any, k: number) => (
                  <Miniatura key={k} url={a.url} alt={`Referência ${k + 1}`} />
                ))}
              </div>
            )}
            <div className={m.papel === "usuario" ? "flex justify-end" : ""}>
              <div
                className={juntar(
                  "max-w-full rounded-2xl px-3 py-2 text-[12.5px] leading-relaxed [overflow-wrap:anywhere]",
                  m.papel === "usuario" ? "bg-primary/10" : m.papel === "sistema" ? "bg-muted text-muted-foreground" : "bg-muted/40",
                )}
              >
                <TextoDoAgente texto={m.conteudo} clientId={clientId} />
                {m.custo_usd != null && <p className="mt-1 text-[10.5px] text-muted-foreground">Custo: {usd(m.custo_usd)}</p>}
              </div>
            </div>
            {m.papel === "agente" && <CaminhoDaMensagem anexos={m.anexos} recente={!!m.nova} />}
            {leitura && (
              <details className="mt-1.5 rounded-md bg-muted/40 px-3 py-2">
                <summary className="cursor-pointer text-[12px] text-muted-foreground">Leitura das referências</summary>
                <p className="mt-1 whitespace-pre-wrap text-[12px] leading-5">{leitura.texto}</p>
              </details>
            )}
            {m.id &&
              acoes.map((a) => {
                const proposta = a.contexto && (a.contexto as any).proposta ? ((a.contexto as any).proposta as GuiaDoEstilo) : null;
                const deTemplate = !!(a.contexto && (a.contexto as any).templates);
                if (deTemplate) {
                  return (
                    <div key={a.id} className="mt-2 space-y-2">
                      <PropostasDaAcao acao={a} />
                      <CartaoDeAcao
                        acao={a}
                        recemFeita={!!m.nova}
                        titulo="O agente vai fazer nos templates"
                        observacao={a.custo_estimado_usd ? `Custo estimado: ${usd(a.custo_estimado_usd)}. Imagens de teste não voltam.` : "Dá para desfazer."}
                        onPedido={(p) => chamarAcaoDoAgente("agente-estilo", String(m.id), a.id, p, { client_id: clientId })}
                        onFeito={(p) => {
                          if (p === "descartar") return;
                          void queryClient.invalidateQueries({ queryKey: ["estilo-templates", clientId] });
                          atualizarCusto();
                        }}
                      />
                    </div>
                  );
                }
                return (
                  <div key={a.id} className="mt-2 space-y-2">
                    {proposta && (
                      <div className="mr-6 rounded-lg border border-border p-3" data-proposta-de-estilo="">
                        <p className={juntar(texto.rotulo, "mb-2")}>Estilo proposto</p>
                        <GuiaLegivel guia={proposta} compacto />
                      </div>
                    )}
                    <CartaoDeAcao
                      acao={a}
                      recemFeita={!!m.nova}
                      titulo="O agente vai fazer no estilo"
                      observacao={a.custo_estimado_usd ? `Custo estimado: ${usd(a.custo_estimado_usd)}. Imagens de teste não voltam.` : "Sem custo. Dá para desfazer."}
                      onPedido={(p) => chamarAcaoDoAgente("agente-estilo", String(m.id), a.id, p, { client_id: clientId })}
                      onFeito={(p, r) => {
                        if (p === "descartar") return;
                        const novo = r && (r as any).estado;
                        if (novo) guardar(novo);
                        else void queryClient.invalidateQueries({ queryKey: chave });
                        atualizarCusto();
                      }}
                    />
                  </div>
                );
              })}
          </div>
        );
      })}
      {enviando && (
        <p className="flex items-center text-[12px] text-muted-foreground">
          <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Estudando o estilo...
        </p>
      )}
    </>
  );

  const conteudoDoEstilo = !estado ? (
    <p className="flex items-center text-[12px] text-muted-foreground">
      <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> Carregando...
    </p>
  ) : (
    <div className="space-y-5" data-aba-estilo="">
      <div className="flex min-w-0 flex-wrap items-center">
        <Switch
          id="estilo-ligado"
          checked={estado.ativo}
          disabled={!temGuia || !!ocupado}
          onCheckedChange={(v) => void direto("estilo_ativar", { ativo: v === true }, "Não foi possível mudar")}
          aria-label="Estilo ligado"
        />
        <label htmlFor="estilo-ligado" className="ml-2 mr-1 text-[13px]">
          {estado.ativo ? "Estilo ligado" : "Estilo desligado"}
        </label>
        <AjudaRecolhida rotulo="O que é estilo ligado">Ligado, o estilo pode ser usado no Estúdio quando o interruptor da geração estiver ligado. Desligado, nenhuma geração usa.</AjudaRecolhida>
        <span className="flex-1" />
        {!editando && (
          <button type="button" className={botao.secundario} onClick={abrirEdicao}>
            {temGuia ? "Editar" : "Escrever"}
          </button>
        )}
      </div>

      {editando ? (
        <div className="space-y-3" data-editar-estilo="">
          <div>
            <label className={texto.rotulo} htmlFor="estilo-resumo">
              Resumo
            </label>
            <Textarea id="estilo-resumo" value={resumo} onChange={(e) => setResumo(e.target.value)} rows={2} maxLength={600} className="mt-1 text-[12.5px]" />
          </div>
          {CAMPOS_DAS_REGRAS.map((c) => (
            <div key={c}>
              <label className={texto.rotulo} htmlFor={`estilo-${c}`}>
                {ROTULOS_DAS_REGRAS[c]}
              </label>
              <Textarea
                id={`estilo-${c}`}
                value={campos[c] || ""}
                onChange={(e) => {
                  const v = e.target.value;
                  setCampos((x) => ({ ...x, [c]: v }));
                }}
                rows={2}
                placeholder="Uma regra por linha"
                className="mt-1 text-[12.5px]"
              />
            </div>
          ))}
          <div className="flex justify-end">
            <button type="button" className={juntar(botao.discreto, "mr-2")} onClick={() => setEditando(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className={botao.primario}
              disabled={!!ocupado}
              onClick={async () => {
                const ok = await direto("estilo_salvar", { guia: guiaDoFormulario(resumo, campos) }, "Não foi possível salvar o estilo");
                if (ok) {
                  setEditando(false);
                  toast.success("Estilo salvo", { description: "Virou uma versão nova." });
                }
              }}
            >
              Salvar versão
            </button>
          </div>
        </div>
      ) : temGuia && estado.guia ? (
        <GuiaLegivel guia={estado.guia} />
      ) : (
        <EstadoVazio compacto titulo="Ainda sem estilo" descricao="Converse com o agente ou escreva o estilo aqui." />
      )}

      {estado.referencias.length > 0 && (
        <section>
          <h3 className={juntar(texto.rotulo, "mb-2")}>Referências do estilo</h3>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {estado.referencias.map((r) => (
              <div key={r.id} className="min-w-0">
                <Miniatura url={r.url} alt={r.nome}>
                  <button
                    type="button"
                    className="absolute right-1 top-1 inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/90 text-foreground"
                    onClick={() => void direto("referencia_tirar", { referencia_id: r.id }, "Não foi possível tirar")}
                    disabled={!!ocupado}
                    aria-label={`Tirar ${r.nome} do estilo`}
                    title="Tirar do estilo"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </Miniatura>
                <p className="mt-1 truncate text-[11px] text-muted-foreground">{r.nome}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {estado.sugeridas_pelas_entregas.length > 0 && (
        <section>
          <h3 className={juntar(texto.rotulo, "mb-2 flex items-center")}>
            Sugeridas pelas entregas
            <AjudaRecolhida titulo="Sugeridas pelas entregas">As artes entregues que renderam melhor ou foram aprovadas sem ajuste. Entram no estilo só quando você usar.</AjudaRecolhida>
          </h3>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
            {estado.sugeridas_pelas_entregas.map((s) => (
              <div key={s.trabalho_id} className="min-w-0">
                <Miniatura url={s.url} alt={s.titulo} />
                <p className="mt-1 truncate text-[11px] text-muted-foreground" title={s.motivo}>{s.motivo}</p>
                <button
                  type="button"
                  className={juntar(botao.barra, "mt-0.5 px-1.5 text-primary")}
                  disabled={!!ocupado}
                  onClick={async () => {
                    const antes = estado.versao_atual;
                    const ok = await direto("referencia_da_entrega", { trabalho_id: s.trabalho_id }, "Não foi possível usar esta arte");
                    if (ok) {
                      toast.success("Arte no estilo", {
                        description: "Virou uma versão nova do estilo.",
                        action: antes > 0 ? { label: "Desfazer", onClick: () => void direto("versao_voltar", { numero: antes }, "Não foi possível desfazer") } : undefined,
                      });
                    }
                  }}
                  aria-label={`Usar ${s.titulo} no estilo`}
                >
                  <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Usar
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {estado.aprendizados.length > 0 && (
        <section>
          <h3 className={juntar(texto.rotulo, "mb-2")}>O que o cliente ensinou</h3>
          <ul className="space-y-1.5">
            {estado.aprendizados.map((a) => (
              <li key={a.id} className="flex min-w-0 items-start text-[12.5px]">
                {a.tipo === "gostou" ? <ThumbsUp className="mr-2 mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" aria-label="Gostou" /> : <ThumbsDown className="mr-2 mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-label="Não gostou" />}
                <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{a.texto}</span>
                <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">{quando(a.em)}</span>
                <button type="button" className={juntar(botao.icone, "-my-1 ml-1 h-7 w-7")} onClick={() => void direto("aprendizado_apagar", { id: a.id }, "Não foi possível apagar")} aria-label="Apagar aprendizado">
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {estado.versoes.length > 0 && (
        <section>
          <h3 className={juntar(texto.rotulo, "mb-2")}>Versões</h3>
          <ul className="divide-y divide-border rounded-md border border-border">
            {estado.versoes.map((v) => (
              <li key={v.numero} className="flex min-w-0 items-center px-3 py-2 text-[12.5px]">
                <span className="mr-2 shrink-0 font-medium tabular-nums">v{v.numero}</span>
                <span className="mr-2 shrink-0 text-muted-foreground">{ORIGEM_DA_VERSAO[v.origem] || v.origem}</span>
                <span className="min-w-0 flex-1 truncate text-muted-foreground" title={v.nota}>
                  {v.nota}
                </span>
                <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">{quando(v.criado_em)}</span>
                {v.numero === estado.versao_atual ? (
                  <span className="ml-2 inline-flex shrink-0 items-center text-[11.5px] text-primary">
                    <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Atual
                  </span>
                ) : (
                  <button type="button" className={juntar(botao.barra, "ml-2")} disabled={!!ocupado} onClick={() => void direto("versao_voltar", { numero: v.numero }, "Não foi possível voltar")}>
                    <Undo2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Voltar para esta
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );

  const testes = estado ? estado.testes.filter((t) => t.status !== "descartado") : [];
  // Referências que podem entrar numa combinação: as do estilo (já lidas) e as anexadas na conversa.
  const referenciasParaCombinar: ReferenciaParaCombinar[] = [];
  for (const r of estado ? estado.referencias : []) if (r.origem === "referencia" && !referenciasParaCombinar.some((x) => x.id === r.id)) referenciasParaCombinar.push({ id: r.id, nome: r.nome, url: r.url });
  for (const m of mensagens) for (const a of m.anexos || []) if (a && a.tipo === "imagem" && a.referencia_id && a.url && !referenciasParaCombinar.some((x) => x.id === a.referencia_id)) referenciasParaCombinar.push({ id: String(a.referencia_id), nome: "anexada na conversa", url: String(a.url) });
  const conteudoDosTestes = !temGuia ? (
    <EstadoVazio compacto titulo="Sem estilo para testar" descricao="Grave um estilo na conversa ou na aba Estilo." />
  ) : !testes.length ? (
    <EstadoVazio compacto titulo="Nenhum teste ainda" descricao="Gere de 1 a 4 imagens com o gerador do Estúdio." />
  ) : (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testes-do-estilo="">
      {testes.map((t) => (
        <div key={t.id} className="min-w-0">
          <Miniatura url={t.url} alt={t.tema || "Teste do estilo"} />
          <p className="mt-1 truncate text-[11.5px] text-muted-foreground">
            v{t.versao}
            {t.tema ? ` · ${t.tema}` : ""}
          </p>
          {t.status === "aprovado" ? (
            <p className="mt-1 inline-flex items-center text-[12px] text-primary">
              <Check className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> Em Arquivos e nas referências
            </p>
          ) : (
            <div className="mt-1 flex">
              <button
                type="button"
                className={juntar(botao.primario, "mr-1.5 h-8 flex-1 px-2 text-[12px]")}
                disabled={!!ocupado}
                onClick={async () => {
                  const ok = await direto("teste_aprovar", { teste_id: t.id }, "Não foi possível aprovar");
                  if (ok) toast.success("Aprovada", { description: "Foi para Arquivos e virou referência do cliente." });
                }}
              >
                Aprovar
              </button>
              <button type="button" className={juntar(botao.secundario, "h-8 px-2 text-[12px]")} disabled={!!ocupado} onClick={() => void direto("teste_descartar", { teste_id: t.id }, "Não foi possível descartar")}>
                Descartar
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div
      className="relative h-full min-h-0"
      onDragOver={(e) => {
        if (e.dataTransfer && Array.prototype.indexOf.call(e.dataTransfer.types || [], "Files") >= 0) {
          e.preventDefault();
          setArrastando(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setArrastando(false);
      }}
      onDrop={soltar}
      data-painel-do-estilo=""
    >
      <PainelDoAgente
        semMoldura
        titulo="Estilo do cliente"
        descricao={descricao}
        icone={<Palette className="h-4 w-4" />}
        acoes={
          aba === "conversa" && mensagens.length > 0 ? (
            <button
              type="button"
              className={botao.barra}
              onClick={() => {
                setMensagens([]);
                setConversaId(null);
                setNova(true);
              }}
            >
              Nova conversa
            </button>
          ) : undefined
        }
        topo={
          <SeletorCompacto
            rotulo="Parte do estilo"
            larguraTotal
            opcoes={[
              { valor: "conversa", rotulo: "Conversa" },
              { valor: "estilo", rotulo: "Estilo", contador: estado && estado.versao_atual ? estado.versao_atual : null },
              { valor: "templates", rotulo: "Templates" },
              { valor: "testes", rotulo: "Testes", contador: testes.length || null },
            ]}
            valor={aba}
            onEscolher={(v) => setAba(v as Aba)}
          />
        }
        avisos={estado && estado.aviso ? <p className="rounded-md bg-muted/60 px-3 py-2 text-[11.5px] text-muted-foreground">{estado.aviso}</p> : undefined}
        compositor={aba === "conversa" ? compositorDaConversa : aba === "testes" && temGuia ? compositorDosTestes : undefined}
        refDasMensagens={lista}
        rotuloDasMensagens="Estilo do cliente"
      >
        {aba === "conversa" ? conteudoDaConversa : aba === "estilo" ? conteudoDoEstilo : aba === "templates" ? <AbaTemplates modeloImagemId={modeloImagemId} referencias={referenciasParaCombinar} conversaId={conversaId} /> : conteudoDosTestes}
      </PainelDoAgente>
      {arrastando && (
        <div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-background/80 text-[13px] font-medium text-primary">
          Solte as referências aqui
        </div>
      )}
    </div>
  );
}
