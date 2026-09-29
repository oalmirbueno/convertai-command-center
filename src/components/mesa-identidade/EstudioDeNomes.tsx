import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AtSign, Check, Copy, Download, ExternalLink, Globe2, Loader2, MessageCircle, RefreshCcw, Search, Send } from "lucide-react";
import { toast } from "sonner";
import { useMesa, useMarcaDaMesa } from "@/components/mesa/MesaContexto";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { copiarTexto } from "@/components/mesa/ContextoPaleta";
import Secao from "@/components/sistema/Secao";
import MenuMais from "@/components/sistema/MenuMais";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { Carregando } from "@/components/sistema/Estados";
import { botao, campo, campoTexto, espaco, etiqueta, foco, juntar, lista, texto } from "@/components/sistema/estilos";
import { CRITERIOS_PADRAO, LIMITES_DO_NAMING, rotuloDaTecnica, TECNICAS_DE_NAMING, textoDoDominio, type AlvoDoNaming, type CandidatoDeNome, type SituacaoDoDominio } from "../../../supabase/functions/_shared/naming";
import { chamarIdentidade, CHAVES, normalizarRodada, useRodadas, useSituacaoDoArquivo, textoDaAprovacao, type RodadaDeNomes } from "./identidadeApi";
import { Pastilha, partesDoCusto } from "./Comuns";
import { salvarArquivo } from "./exportarNoNavegador";

const TOM_DO_DOMINIO: Record<SituacaoDoDominio, "bom" | "ruim" | "neutro"> = { livre: "bom", registrado: "ruim", nao_conferido: "neutro" };

/**
 * Criador de nomes (Mesa Identidade e Mesa → Campanhas). Gera por técnica,
 * confere .com.br e .com no RDAP público, deixa o @ e o INPI a conferir com o
 * link pronto, ranqueia com o Jev pelos critérios do briefing e marca de 3 a
 * 5 finalistas com a justificativa. Baixar em PDF, enviar para aprovação no
 * painel e a mensagem pronta para o grupo (o Hermes envia; o painel registra).
 */
export default function EstudioDeNomes({
  alvo,
  projetoId = null,
  campanhaId = null,
  criteriosIniciais,
  pedidoInicial = "",
  onEscolhido,
}: {
  alvo: AlvoDoNaming;
  projetoId?: string | null;
  campanhaId?: string | null;
  criteriosIniciais?: string[];
  pedidoInicial?: string;
  onEscolhido?: (nome: string) => void;
}) {
  const mesa = useMesa();
  const { marca } = useMarcaDaMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const rodadasQ = useRodadas(mesa.clientId, { projetoId, campanhaId });
  const chaveDasRodadas = CHAVES.rodadas(mesa.clientId, projetoId ? `p:${projetoId}` : campanhaId ? `c:${campanhaId}` : "todas");
  const [aberta, setAberta] = useState<string | null>(null);
  const [tecnicas, setTecnicas] = useState<string[]>(["descritivo", "evocativo", "neologismo", "composto", "metafora"]);
  const [quantidade, setQuantidade] = useState<number>(LIMITES_DO_NAMING.padrao);
  const [criterios, setCriterios] = useState<string>((criteriosIniciais && criteriosIniciais.length ? criteriosIniciais : CRITERIOS_PADRAO).join("\n"));
  const [pedido, setPedido] = useState(pedidoInicial);
  const [marcados, setMarcados] = useState<string[] | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<{ texto: string; link: string } | null>(null);

  const rodadas = rodadasQ.data || [];
  const rodada = rodadas.filter((r) => r.id === aberta)[0] || rodadas[0] || null;
  const situacao = useSituacaoDoArquivo(rodada ? rodada.arquivo_pdf_id : null);
  useEffect(() => {
    setMarcados(null);
    setMensagem(null);
  }, [rodada ? rodada.id : null]);

  const ordenados = useMemo(() => (rodada ? rodada.candidatos.slice().sort((a, b) => Number(b.finalista) - Number(a.finalista)) : []), [rodada]);
  const finalistas = marcados || (rodada ? rodada.candidatos.filter((c) => c.finalista).map((c) => c.id) : []);
  const mudouFinalistas = !!marcados;

  const guardarRodada = (r: RodadaDeNomes | null | undefined) => {
    const n = normalizarRodada(r);
    if (!n) return;
    qc.setQueryData<RodadaDeNomes[]>(chaveDasRodadas, (l) => [n].concat((l || []).filter((x) => x.id !== n.id)));
    setAberta(n.id);
  };

  const rodar = async (qual: string, fn: () => Promise<void>) => {
    setOcupado(qual);
    try {
      await fn();
    } catch (e) {
      avisarErro(e, "Não foi possível concluir");
    } finally {
      setOcupado(null);
    }
  };

  const alternarFinalista = (id: string) => {
    const atual = finalistas.slice();
    const i = atual.indexOf(id);
    if (i >= 0) atual.splice(i, 1);
    else if (atual.length < LIMITES_DO_NAMING.finalistasMax) atual.push(id);
    else {
      toast.info(`No máximo ${LIMITES_DO_NAMING.finalistasMax} finalistas.`);
      return;
    }
    setMarcados(atual);
  };

  const baixarPdf = () =>
    rodar("pdf", async () => {
      if (!rodada) return;
      const { gerarPdfDoNaming, nomeDoArquivoDoNaming } = await import("../../../supabase/functions/_shared/pdf-identidade");
      const candidatos = rodada.candidatos.map((c) => ({ ...c, finalista: finalistas.indexOf(c.id) >= 0 }));
      const alvoTexto = alvo === "campanha" ? "nome da campanha" : alvo === "produto" ? "nome do produto" : "nome da marca";
      const bytes = gerarPdfDoNaming({ cliente: marca && !marca.principal ? marca.nome : mesa.clientName, alvo: alvoTexto, criterios: rodada.criterios, candidatos });
      salvarArquivo(bytes, nomeDoArquivoDoNaming(mesa.clientName, alvoTexto), "application/pdf");
    });

  const itensDoMenu = rodada
    ? [
        { rotulo: "Conferir domínios de novo", icone: <RefreshCcw className="h-4 w-4" />, aoEscolher: () => void rodar("conferir", async () => guardarRodada((await chamarIdentidade<{ rodada: RodadaDeNomes }>("naming_conferir", { rodada_id: rodada.id })).rodada)) },
        { rotulo: "Baixar PDF", icone: <Download className="h-4 w-4" />, aoEscolher: () => void baixarPdf() },
        { rotulo: "Arquivar esta rodada", perigo: true, aoEscolher: () => void rodar("arquivar", async () => {
          await chamarIdentidade("naming_arquivar", { rodada_id: rodada.id, arquivar: true });
          void qc.invalidateQueries({ queryKey: chaveDasRodadas });
          setAberta(null);
        }) },
      ]
    : [];

  return (
    <div className={espaco.pagina} data-estudio-de-nomes={alvo}>
      <Secao
        titulo="Gerar nomes"
        recolher={`mesa-identidade:nomes:${projetoId || campanhaId || mesa.clientId}:gerar`}
        recolhidaDeInicio={rodadas.length > 0}
        ajuda="Escolha as técnicas e os critérios. A geração usa IA e mostra o custo antes; o ranking é do Jev (julgamento contra os critérios) e o domínio é conferido no RDAP público. O @ do Instagram e o INPI ficam a conferir, com o link pronto: o painel não entra em conta de terceiro."
      >
        <div className="flex min-w-0 flex-wrap -m-1" role="group" aria-label="Técnicas de naming">
          {TECNICAS_DE_NAMING.map((t) => {
            const on = tecnicas.indexOf(t.valor) >= 0;
            return (
              <button
                key={t.valor}
                type="button"
                title={t.explica}
                aria-pressed={on}
                onClick={() => setTecnicas(on ? tecnicas.filter((x) => x !== t.valor) : tecnicas.concat([t.valor]))}
                className={juntar("m-1 inline-flex h-8 items-center rounded-md border px-2.5 text-[12px] transition-colors", on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted", foco)}
              >
                {on && <Check className="mr-1 h-3.5 w-3.5" />}
                {t.rotulo}
              </button>
            );
          })}
        </div>
        <div className="mt-4 grid min-w-0 grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px]">
          <CampoDeFormulario rotulo="Critérios" apoio="Um por linha">
            <textarea className={juntar(campoTexto, "min-h-[96px]")} value={criterios} maxLength={1200} onChange={(e) => setCriterios(e.target.value)} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Pedido da equipe" apoio="Opcional">
            <textarea className={juntar(campoTexto, "min-h-[96px]")} value={pedido} maxLength={2000} placeholder="Ex.: curto, fácil em inglês e português" onChange={(e) => setPedido(e.target.value)} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Quantos">
            <select className={campo} value={quantidade} onChange={(e) => setQuantidade(Number(e.target.value))}>
              {[12, 18, 24, 30, 40].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </CampoDeFormulario>
        </div>
        <div className="mt-3 flex justify-end">
          <BotaoComCusto
            rotulo="Gerar nomes"
            titulo="Gerar nomes"
            disabled={!tecnicas.length}
            partes={() => partesDoCusto(mesa.catalogo, "naming")}
            executar={() =>
              chamarIdentidade<{ rodada: RodadaDeNomes; aviso_jev: string | null }>("naming_gerar", {
                client_id: mesa.clientId,
                projeto_id: projetoId || undefined,
                campanha_id: campanhaId || undefined,
                alvo,
                tecnicas,
                quantidade,
                criterios: criterios.split(/\n+/).map((x) => x.trim()).filter(Boolean),
                pedido: pedido.trim() || undefined,
              })
            }
            aoConcluir={(d) => {
              guardarRodada(d && d.rodada);
              if (d && d.aviso_jev) toast.warning(d.aviso_jev);
              if (projetoId) void qc.invalidateQueries({ queryKey: CHAVES.projeto(projetoId) });
            }}
          />
        </div>
      </Secao>

      {rodadasQ.isLoading && <Carregando forma="lista" linhas={3} rotulo="Lendo as rodadas" />}

      {rodada && (
        <Secao
          titulo="Nomes"
          divisoria
          descricao={`${rodada.candidatos.length} nomes · ${finalistas.length} finalistas${rodada.escolhido ? ` · escolhido: ${rodada.escolhido}` : ""}`}
          recolher={`mesa-identidade:nomes:${rodada.id}`}
          acao={
            <>
              {rodadas.length > 1 && (
                <select className={juntar(campo, "m-1 h-8 w-auto")} value={rodada.id} onChange={(e) => setAberta(e.target.value)} aria-label="Rodada">
                  {rodadas.map((r, i) => (
                    <option key={r.id} value={r.id}>
                      Rodada {rodadas.length - i} · {new Date(r.criado_em).toLocaleDateString("pt-BR")}
                    </option>
                  ))}
                </select>
              )}
              {mudouFinalistas && (
                <button type="button" className={juntar(botao.primario, "m-1 h-8")} disabled={ocupado === "finalistas" || finalistas.length < LIMITES_DO_NAMING.finalistasMin} onClick={() => void rodar("finalistas", async () => {
                  guardarRodada((await chamarIdentidade<{ rodada: RodadaDeNomes }>("naming_finalistas", { rodada_id: rodada.id, ids: finalistas })).rodada);
                  setMarcados(null);
                  toast.success("Finalistas salvos");
                })}>
                  {ocupado === "finalistas" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />} Salvar finalistas
                </button>
              )}
              <MenuMais itens={itensDoMenu} rotulo="Mais ações da rodada" className="m-1" />
            </>
          }
        >
          {rodada.aviso_jev && <p className={juntar(texto.auxiliar, "mb-2 text-warning")}>{rodada.aviso_jev}</p>}
          <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Nomes da rodada">
            {ordenados.map((c) => (
              <LinhaDoNome
                key={c.id}
                c={c}
                finalista={finalistas.indexOf(c.id) >= 0}
                escolhido={rodada.escolhido === c.nome}
                onFinalista={() => alternarFinalista(c.id)}
                onEscolher={() =>
                  void rodar(`escolher-${c.id}`, async () => {
                    guardarRodada((await chamarIdentidade<{ rodada: RodadaDeNomes }>("naming_escolher", { rodada_id: rodada.id, candidato_id: c.id })).rodada);
                    if (projetoId) void qc.invalidateQueries({ queryKey: CHAVES.projeto(projetoId) });
                    toast.success(`Nome escolhido: ${c.nome}`);
                    if (onEscolhido) onEscolhido(c.nome);
                  })
                }
                escolhendo={ocupado === `escolher-${c.id}`}
              />
            ))}
          </ul>
        </Secao>
      )}

      {rodada && (
        <Secao titulo="Aprovação" divisoria descricao={rodada.arquivo_pdf_id ? textoDaAprovacao(situacao.data) : rodada.enviado_grupo_em ? "Enviado no grupo" : "Ainda não enviado"} recolher={`mesa-identidade:nomes:${rodada.id}:aprovacao`}>
          <div className="-m-1 flex min-w-0 flex-wrap items-center">
            <button type="button" className={juntar(botao.secundario, "m-1")} disabled={!!ocupado || mudouFinalistas || finalistas.length < LIMITES_DO_NAMING.finalistasMin} onClick={() => void rodar("aprovar", async () => {
              const r = await chamarIdentidade<{ rodada: RodadaDeNomes; revisao_solicitada: boolean; aviso: string | null }>("naming_pdf_compartilhar", { rodada_id: rodada.id });
              guardarRodada(r.rodada);
              void situacao.refetch();
              toast.success("PDF dos finalistas em Arquivos", { description: r.revisao_solicitada ? "Revisão da agência pedida." : r.aviso || undefined });
            })}>
              {ocupado === "aprovar" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />} Enviar para aprovação
            </button>
            <button type="button" className={juntar(botao.secundario, "m-1")} disabled={!!ocupado || mudouFinalistas || finalistas.length < LIMITES_DO_NAMING.finalistasMin} onClick={() => void rodar("mensagem", async () => {
              const r = await chamarIdentidade<{ rodada: RodadaDeNomes; mensagem: string; link_whatsapp: string }>("naming_mensagem", { rodada_id: rodada.id });
              guardarRodada(r.rodada);
              setMensagem({ texto: r.mensagem, link: r.link_whatsapp });
            })}>
              <MessageCircle className="mr-1.5 h-4 w-4" /> Mensagem do grupo
            </button>
            {rodada.enviado_grupo_em && <Pastilha tom="bom">Enviado no grupo em {new Date(rodada.enviado_grupo_em).toLocaleDateString("pt-BR")}</Pastilha>}
          </div>
          {mensagem && (
            <div className="mt-3 min-w-0">
              <textarea className={juntar(campoTexto, "min-h-[160px]")} readOnly value={mensagem.texto} aria-label="Mensagem para o grupo" />
              <div className="-m-1 mt-1 flex min-w-0 flex-wrap items-center">
                <button type="button" className={juntar(botao.discreto, "m-1")} onClick={() => void copiarTexto(mensagem.texto).then((ok) => (ok ? toast.success("Mensagem copiada") : toast.error("Não deu para copiar")))}>
                  <Copy className="mr-1.5 h-4 w-4" /> Copiar
                </button>
                <a className={juntar(botao.discreto, "m-1")} href={mensagem.link} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-1.5 h-4 w-4" /> Abrir no WhatsApp
                </a>
                <button type="button" className={juntar(botao.secundario, "m-1")} disabled={ocupado === "grupo"} onClick={() => void rodar("grupo", async () => {
                  guardarRodada((await chamarIdentidade<{ rodada: RodadaDeNomes }>("naming_registrar_grupo", { rodada_id: rodada.id })).rodada);
                  toast.success("Envio no grupo registrado");
                })}>
                  <Check className="mr-1.5 h-4 w-4" /> Registrar que foi enviado
                </button>
              </div>
            </div>
          )}
        </Secao>
      )}
    </div>
  );
}

function LinhaDoNome({ c, finalista, escolhido, onFinalista, onEscolher, escolhendo }: { c: CandidatoDeNome; finalista: boolean; escolhido: boolean; onFinalista: () => void; onEscolher: () => void; escolhendo: boolean }) {
  return (
    <li className={juntar(lista.linha, "items-start", finalista && lista.destaque)} data-nome={c.nome}>
      <input type="checkbox" className="mr-3 mt-1 h-4 w-4 shrink-0 accent-primary" checked={finalista} onChange={onFinalista} aria-label={`Finalista: ${c.nome}`} />
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center">
          <span className={juntar(texto.tituloSecao, "mr-2 truncate")}>{c.nome}</span>
          <span className={juntar(etiqueta, "mr-1.5 bg-muted text-muted-foreground")}>{rotuloDaTecnica(c.tecnica)}</span>
          <span className={juntar(etiqueta, "mr-1.5 tabular-nums", c.nota === null ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary")} title="Nota do Jev contra os critérios, com o ajuste do domínio">
            {c.nota === null ? "sem nota" : `nota ${Math.round(c.nota * 100)}`}
          </span>
          {escolhido && <Pastilha tom="bom">Escolhido</Pastilha>}
        </span>
        {c.justificativa && <span className={juntar(texto.auxiliar, "mt-0.5 block")}>{c.justificativa}</span>}
        <span className="-m-0.5 mt-1 flex min-w-0 flex-wrap items-center">
          <span className="m-0.5 inline-flex items-center"><Globe2 className="mr-1 h-3 w-3 text-muted-foreground" aria-hidden /><Pastilha tom={TOM_DO_DOMINIO[c.filtros.com_br]}>.com.br {textoDoDominio(c.filtros.com_br)}</Pastilha></span>
          <span className="m-0.5"><Pastilha tom={TOM_DO_DOMINIO[c.filtros.com]}>.com {textoDoDominio(c.filtros.com)}</Pastilha></span>
          {c.filtros.link_instagram && (
            <a className={juntar(texto.etiqueta, "m-0.5 inline-flex items-center text-muted-foreground hover:text-foreground")} href={c.filtros.link_instagram} target="_blank" rel="noopener noreferrer">
              <AtSign className="mr-0.5 h-3 w-3" /> {c.filtros.arroba} a conferir
            </a>
          )}
          <a className={juntar(texto.etiqueta, "m-0.5 inline-flex items-center text-muted-foreground hover:text-foreground")} href={c.filtros.link_inpi} target="_blank" rel="noopener noreferrer">
            <Search className="mr-0.5 h-3 w-3" /> INPI
          </a>
        </span>
      </span>
      {finalista && (
        <button type="button" className={juntar(botao.discreto, "ml-2 h-8 shrink-0")} onClick={onEscolher} disabled={escolhendo || escolhido}>
          {escolhendo ? <Loader2 className="h-4 w-4 animate-spin" /> : escolhido ? "Escolhido" : "Escolher"}
        </button>
      )}
    </li>
  );
}
