import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AtSign, Check, Copy, Download, ExternalLink, Globe2, Languages, Loader2, MessageCircle, RefreshCcw, Search, Send } from "lucide-react";
import { PreencherComIA } from "@/components/sistema";
import { toast } from "sonner";
import { useMesa, useMarcaDaMesa } from "@/components/mesa/MesaContexto";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { copiarTexto } from "@/components/mesa/ContextoPaleta";
import Secao from "@/components/sistema/Secao";
import MenuMais from "@/components/sistema/MenuMais";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { Carregando } from "@/components/sistema/Estados";
import { botao, campo, campoTexto, espaco, etiqueta, foco, juntar, lista, texto, toqueCompacto } from "@/components/sistema/estilos";
import { CRITERIOS_PADRAO, IDIOMAS_DO_TESTE, LIMITES_DO_NAMING, linksDoArroba, ROTULO_DO_RISCO, rotuloDaTecnica, TECNICAS_DE_NAMING, textoDoDominio, type AlvoDoNaming, type CandidatoDeNome, type SituacaoDoDominio } from "../../../supabase/functions/mesa-identidade/modulos/naming";
import { chamarIdentidade, CHAVES, normalizarRodada, useRodadas, useSituacaoDoArquivo, textoDaAprovacao, type RodadaDeNomes } from "./identidadeApi";
import { contextoParaPreencher, Pastilha, partesDoCusto, RotuloComModelo, SeletorDoModelo, useModeloDaAcao, useProjetoOpcional } from "./Comuns";
import VotacaoDosNomes from "./VotacaoDosNomes";
import { salvarArquivo } from "./exportarNoNavegador";

const TOM_DO_DOMINIO: Record<SituacaoDoDominio, "bom" | "ruim" | "neutro"> = { livre: "bom", registrado: "ruim", nao_conferido: "neutro" };

/**
 * Criador de nomes (Mesa Identidade e Mesa → Campanhas). Gera por técnica,
 * confere .com.br e .com no RDAP público, deixa o @ e o INPI a conferir com o
 * link pronto, ranqueia com o Jev pelos critérios do briefing e marca de 3 a
 * 5 finalistas com a justificativa. Baixar em PDF, enviar para aprovação no
 * painel e a mensagem pronta para o grupo (o Hermes envia; o painel registra).
 *
 * UXS 30/09: os finalistas gravam sozinhos 600 ms depois do último clique
 * (com 3 a 5 marcados); a rodada nova começa com as escolhas da última do
 * mesmo escopo ("Voltar ao briefing" desfaz); o aviso do nome escolhido traz
 * "Concluir etapa" (só na Mesa Identidade). Dentro da mesa, o modelo é o do
 * cabeçalho da etapa; fora dela (Campanhas), o seletor fica aqui.
 */

const TECNICAS_PADRAO = ["descritivo", "evocativo", "neologismo", "composto", "metafora"];
const ESPERA_DOS_FINALISTAS = 600;
const mesmoConjunto = (a: string[] | null, b: string[]) => !!a && a.length === b.length && a.every((x) => b.indexOf(x) >= 0);
export default function EstudioDeNomes({
  alvo,
  projetoId = null,
  campanhaId = null,
  criteriosIniciais,
  pedidoInicial = "",
  onEscolhido,
  concluirAoEscolher,
}: {
  alvo: AlvoDoNaming;
  projetoId?: string | null;
  campanhaId?: string | null;
  criteriosIniciais?: string[];
  pedidoInicial?: string;
  onEscolhido?: (nome: string) => void;
  /** Só a etapa Naming passa: o aviso "Nome escolhido" ganha "Concluir etapa". */
  concluirAoEscolher?: (() => void) | null;
}) {
  const mesa = useMesa();
  const { marca } = useMarcaDaMesa();
  const projetoDaMesa = useProjetoOpcional();
  const [modeloId, setModeloId] = useModeloDaAcao("naming");
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const rodadasQ = useRodadas(mesa.clientId, { projetoId, campanhaId });
  const chaveDasRodadas = CHAVES.rodadas(mesa.clientId, projetoId ? `p:${projetoId}` : campanhaId ? `c:${campanhaId}` : "todas");
  const [aberta, setAberta] = useState<string | null>(null);
  const criteriosDoBriefing = (criteriosIniciais && criteriosIniciais.length ? criteriosIniciais : CRITERIOS_PADRAO).join("\n");
  const [tecnicas, setTecnicasBruto] = useState<string[]>(TECNICAS_PADRAO);
  const [quantidade, setQuantidadeBruto] = useState<number>(LIMITES_DO_NAMING.padrao);
  const [criterios, setCriteriosBruto] = useState<string>(criteriosDoBriefing);
  const [pedido, setPedidoBruto] = useState(pedidoInicial);
  const [marcados, setMarcados] = useState<string[] | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [mensagem, setMensagem] = useState<{ texto: string; link: string } | null>(null);
  /** A pessoa já mexeu no formulário: a rodada anterior não passa mais por cima. */
  const mexeu = useRef(false);
  const [daRodada, setDaRodada] = useState<string | null>(null);
  const setTecnicas = (v: string[]) => {
    mexeu.current = true;
    setTecnicasBruto(v);
  };
  const setQuantidade = (v: number) => {
    mexeu.current = true;
    setQuantidadeBruto(v);
  };
  const setCriterios = (v: string) => {
    mexeu.current = true;
    setCriteriosBruto(v);
  };
  const setPedido = (v: string) => {
    mexeu.current = true;
    setPedidoBruto(v);
  };

  const rodadas = rodadasQ.data || [];
  const rodada = rodadas.filter((r) => r.id === aberta)[0] || rodadas[0] || null;
  const situacao = useSituacaoDoArquivo(rodada ? rodada.arquivo_pdf_id : null);

  // Finalistas gravando sozinhos: o temporizador guarda a rodada e some ao trocar de rodada ou sair da tela.
  const agendado = useRef<{ timer: number; rodadaId: string } | null>(null);
  const [gravandoFinalistas, setGravandoFinalistas] = useState(false);
  const cancelarAgendado = () => {
    if (agendado.current) {
      window.clearTimeout(agendado.current.timer);
      agendado.current = null;
    }
  };
  useEffect(() => {
    cancelarAgendado();
    setMarcados(null);
    setMensagem(null);
  }, [rodada ? rodada.id : null]);
  useEffect(() => () => cancelarAgendado(), []);

  // Rodada nova com as escolhas da última do MESMO escopo (projeto ou campanha, e o mesmo alvo); nunca da lista "todas".
  const ultimaDoEscopo = projetoId || campanhaId ? rodadas.filter((r) => (projetoId ? r.projeto_id === projetoId : r.campanha_id === campanhaId) && r.alvo === alvo)[0] || null : null;
  useEffect(() => {
    if (!ultimaDoEscopo || mexeu.current) return;
    if (ultimaDoEscopo.tecnicas.length) setTecnicasBruto(ultimaDoEscopo.tecnicas);
    if (ultimaDoEscopo.criterios.length) setCriteriosBruto(ultimaDoEscopo.criterios.join("\n"));
    setPedidoBruto(ultimaDoEscopo.pedido || "");
    setDaRodada(ultimaDoEscopo.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ultimaDoEscopo ? ultimaDoEscopo.id : null]);

  const ordenados = useMemo(() => (rodada ? rodada.candidatos.slice().sort((a, b) => Number(b.finalista) - Number(a.finalista)) : []), [rodada]);
  const salvos = rodada ? rodada.candidatos.filter((c) => c.finalista).map((c) => c.id) : [];
  const finalistas = marcados || salvos;
  /** Finalistas marcados na tela que ainda não chegaram ao banco (agendado ou indo). */
  const mudouFinalistas = !!marcados || gravandoFinalistas;
  /** Marcação que vai gravar (3 a 5) ou está gravando: o que custa ou envia espera. */
  const aguardandoGravar = (!!marcados && finalistas.length >= LIMITES_DO_NAMING.finalistasMin) || gravandoFinalistas;
  const aprovada = !!rodada && rodada.status === "aprovado";
  const faltamFinalistas = Math.max(0, LIMITES_DO_NAMING.finalistasMin - finalistas.length);

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

  /** Uma gravação de finalistas por vez (a última marcação chega por último). */
  const filaDosFinalistas = useRef<Promise<void>>(Promise.resolve());
  const gravarFinalistas = (ids: string[], rodadaId: string, anteriores: string[] | null): Promise<void> => {
    const vez = filaDosFinalistas.current.then(() => gravarFinalistasAgora(ids, rodadaId, anteriores));
    filaDosFinalistas.current = vez.catch(() => undefined);
    return vez;
  };

  /** Grava os finalistas (sem custo). A resposta só limpa a marcação se ela ainda é a que foi enviada. */
  const gravarFinalistasAgora = async (ids: string[], rodadaId: string, anteriores: string[] | null) => {
    setGravandoFinalistas(true);
    try {
      const r = await chamarIdentidade<{ rodada: RodadaDeNomes }>("naming_finalistas", { rodada_id: rodadaId, ids });
      guardarRodada(r.rodada);
      setMarcados((m) => (mesmoConjunto(m, ids) ? null : m));
      const votos = qc.getQueryData<{ votacao?: { fechada_em: string | null } | null }>(["mesa-identidade", "votos", rodadaId]);
      const votacaoAberta = !!(votos && votos.votacao && !votos.votacao.fechada_em);
      const enviada = !!(rodada && rodada.id === rodadaId && rodada.status !== "rascunho");
      if (anteriores && (enviada || votacaoAberta)) {
        toast.success("Finalistas atualizados", {
          duration: 10_000,
          action: { label: "Desfazer", onClick: () => void gravarFinalistas(anteriores, rodadaId, null) },
        });
      }
    } catch (e) {
      avisarErro(e, "Os finalistas não foram salvos");
      setMarcados((m) => (mesmoConjunto(m, ids) ? null : m));
    } finally {
      setGravandoFinalistas(false);
    }
  };

  const alternarFinalista = (id: string) => {
    if (!rodada || aprovada) return;
    const atual = finalistas.slice();
    const i = atual.indexOf(id);
    if (i >= 0) atual.splice(i, 1);
    else if (atual.length < LIMITES_DO_NAMING.finalistasMax) atual.push(id);
    else {
      toast.info(`No máximo ${LIMITES_DO_NAMING.finalistasMax} finalistas.`);
      return;
    }
    setMarcados(atual);
    cancelarAgendado();
    // Só grava com 3 a 5; abaixo disso a seção diz quantos faltam e o que está gravado continua valendo.
    if (atual.length < LIMITES_DO_NAMING.finalistasMin) return;
    const rodadaId = rodada.id;
    const anteriores = salvos.slice();
    agendado.current = {
      rodadaId,
      timer: window.setTimeout(() => {
        agendado.current = null;
        void gravarFinalistas(atual, rodadaId, anteriores);
      }, ESPERA_DOS_FINALISTAS),
    };
  };

  const baixarPdf = () =>
    rodar("pdf", async () => {
      if (!rodada) return;
      const { gerarPdfDoNaming, nomeDoArquivoDoNaming } = await import("../../../supabase/functions/mesa-identidade/modulos/pdf-identidade");
      const candidatos = rodada.candidatos.map((c) => ({ ...c, finalista: finalistas.indexOf(c.id) >= 0 }));
      const alvoTexto = alvo === "campanha" ? "nome da campanha" : alvo === "produto" ? "nome do produto" : "nome da marca";
      const bytes = gerarPdfDoNaming({ cliente: marca && !marca.principal ? marca.nome : mesa.clientName, alvo: alvoTexto, criterios: rodada.criterios, candidatos });
      salvarArquivo(bytes, nomeDoArquivoDoNaming(mesa.clientName, alvoTexto), "application/pdf");
    });

  // "Preencher com IA" (peça comum) nos critérios e no pedido; na Mesa Identidade leva o que o projeto sabe.
  const marcaId = projetoDaMesa ? projetoDaMesa.projeto.marca_id : marca && !marca.principal ? marca.id : null;
  const contextoDoNome = projetoDaMesa ? contextoParaPreencher(projetoDaMesa.projeto, `Alvo: ${alvo === "campanha" ? "nome de campanha" : alvo === "produto" ? "nome de produto" : "nome da marca"}.`) : `Alvo: ${alvo === "campanha" ? "nome de campanha" : alvo === "produto" ? "nome de produto" : "nome da marca"}.`;
  const preencherNome = (chave: "criterios" | "pedido") => (
    <PreencherComIA
      papel="naming"
      clientId={mesa.clientId}
      marcaId={marcaId}
      compacto
      rotulo={chave === "criterios" ? "Preencher os critérios com IA" : "Preencher o pedido com IA"}
      campos={[
        chave === "criterios"
          ? { chave: "criterios", rotulo: "Critérios do nome", tipo: "lista", valorAtual: criterios.split(/\n+/).map((x) => x.trim()).filter(Boolean), dica: "Critérios para julgar os nomes, ligados ao briefing e à estratégia.", maximo: 6 }
          : { chave: "pedido", rotulo: "Pedido da equipe", tipo: "texto", valorAtual: pedido, dica: "Direção curta para a geração (tom, raízes, idiomas, o que evitar).", maximo: 400 },
      ]}
      contexto={contextoDoNome}
      onAplicar={(v) => {
        if (chave === "criterios") setCriterios((Array.isArray(v.criterios) ? (v.criterios as unknown[]).map(String) : String(v.criterios || "").split(/\n+/)).join("\n"));
        else setPedido(String(v.pedido || ""));
      }}
      onDesfazer={(a) => {
        if (chave === "criterios") setCriterios((Array.isArray(a.criterios) ? (a.criterios as unknown[]).map(String) : []).join("\n"));
        else setPedido(String(a.pedido || ""));
      }}
    />
  );

  const motivoParado = aguardandoGravar ? "Salvando finalistas" : faltamFinalistas ? `Marque mais ${faltamFinalistas}` : null;
  const comSeletor = !projetoDaMesa;
  const rotuloDoModelo = (r: string) => (comSeletor ? r : <RotuloComModelo rotulo={r} papel="naming" modeloId={modeloId} />);

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
        data-bloco-da-etapa="gerar-nomes"
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
          <CampoDeFormulario rotulo={<span className="flex min-w-0 items-center"><span className="mr-1 truncate">Critérios</span>{preencherNome("criterios")}</span>} apoio="Um por linha">
            <textarea className={juntar(campoTexto, "min-h-[96px]")} value={criterios} maxLength={1200} onChange={(e) => setCriterios(e.target.value)} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo={<span className="flex min-w-0 items-center"><span className="mr-1 truncate">Pedido da equipe</span>{preencherNome("pedido")}</span>} apoio="Opcional">
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
        {daRodada && (
          <p className={juntar(texto.auxiliar, "mt-2")} data-da-rodada-anterior="">
            Com as escolhas da última rodada.{" "}
            <button
              type="button"
              className={juntar(toqueCompacto, "rounded px-1 text-[12px] font-medium text-primary underline-offset-2 hover:underline", foco)}
              onClick={() => {
                setCriterios(criteriosDoBriefing);
                setPedido(pedidoInicial);
                setDaRodada(null);
              }}
              data-voltar-ao-briefing=""
            >
              Voltar ao briefing
            </button>
          </p>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-end">
          {comSeletor && <SeletorDoModelo papel="naming" valor={modeloId} onEscolher={setModeloId} />}
          <BotaoComCusto
            rotulo={rotuloDoModelo("Gerar nomes")}
            titulo="Gerar nomes"
            disabled={!tecnicas.length}
            partes={() => partesDoCusto(mesa.catalogo, "naming", modeloId)}
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
                modelo_id: modeloId || undefined,
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
          descricao={`${rodada.candidatos.length} nomes · ${finalistas.length} finalistas${rodada.escolhido ? ` · escolhido: ${rodada.escolhido}` : ""}${aprovada ? " · rodada aprovada: gere outra para mudar" : faltamFinalistas ? ` · marque mais ${faltamFinalistas}` : aguardandoGravar ? " · salvando finalistas" : ""}`}
          recolher={`mesa-identidade:nomes:${rodada.id}`}
          data-bloco-da-etapa="nomes"
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
              <BotaoComCusto
                rotulo={aguardandoGravar ? "Salvando finalistas" : rotuloDoModelo("Testar idiomas")}
                titulo="Pronúncia e significado em outros idiomas"
                descricao={`Finalistas em ${IDIOMAS_DO_TESTE.map((i) => i.rotulo.toLowerCase()).join(", ")}; o risco é aviso do Jev`}
                disabled={mudouFinalistas || salvos.length < LIMITES_DO_NAMING.finalistasMin}
                partes={() => partesDoCusto(mesa.catalogo, "idiomas", modeloId)}
                executar={() => chamarIdentidade<{ rodada: RodadaDeNomes; aviso_jev: string | null }>("naming_idiomas", { rodada_id: rodada.id, modelo_id: modeloId || undefined })}
                aoConcluir={(d) => {
                  guardarRodada(d && d.rodada);
                  if (d && d.aviso_jev) toast.warning(d.aviso_jev);
                }}
                variant="ghost"
                className="m-1 h-8"
              />
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
                travado={aprovada}
                onFinalista={() => alternarFinalista(c.id)}
                onEscolher={() =>
                  void rodar(`escolher-${c.id}`, async () => {
                    guardarRodada((await chamarIdentidade<{ rodada: RodadaDeNomes }>("naming_escolher", { rodada_id: rodada.id, candidato_id: c.id })).rodada);
                    if (projetoId) void qc.invalidateQueries({ queryKey: CHAVES.projeto(projetoId) });
                    toast.success(`Nome escolhido: ${c.nome}`, concluirAoEscolher ? { duration: 10_000, action: { label: "Concluir etapa", onClick: () => concluirAoEscolher() } } : undefined);
                    if (onEscolhido) onEscolhido(c.nome);
                  })
                }
                escolhendo={ocupado === `escolher-${c.id}`}
              />
            ))}
          </ul>
        </Secao>
      )}

      {rodada && <VotacaoDosNomes rodada={rodada} />}

      {rodada && (
        <Secao titulo="Aprovação" divisoria descricao={rodada.arquivo_pdf_id ? textoDaAprovacao(situacao.data) : rodada.enviado_grupo_em ? "Enviado no grupo" : "Ainda não enviado"} recolher={`mesa-identidade:nomes:${rodada.id}:aprovacao`}>
          <div className="-m-1 flex min-w-0 flex-wrap items-center">
            <button type="button" className={juntar(botao.secundario, "m-1")} disabled={!!ocupado || mudouFinalistas || salvos.length < LIMITES_DO_NAMING.finalistasMin} onClick={() => void rodar("aprovar", async () => {
              const r = await chamarIdentidade<{ rodada: RodadaDeNomes; revisao_solicitada: boolean; aviso: string | null }>("naming_pdf_compartilhar", { rodada_id: rodada.id });
              guardarRodada(r.rodada);
              void situacao.refetch();
              toast.success("PDF dos finalistas em Arquivos", { description: r.revisao_solicitada ? "Revisão da agência pedida." : r.aviso || undefined });
            })}>
              {ocupado === "aprovar" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />} Enviar para aprovação
            </button>
            <button type="button" className={juntar(botao.secundario, "m-1")} disabled={!!ocupado || mudouFinalistas || salvos.length < LIMITES_DO_NAMING.finalistasMin} onClick={() => void rodar("mensagem", async () => {
              const r = await chamarIdentidade<{ rodada: RodadaDeNomes; mensagem: string; link_whatsapp: string }>("naming_mensagem", { rodada_id: rodada.id });
              guardarRodada(r.rodada);
              setMensagem({ texto: r.mensagem, link: r.link_whatsapp });
            })}>
              <MessageCircle className="mr-1.5 h-4 w-4" /> Mensagem do grupo
            </button>
            {motivoParado && <span className={juntar(texto.auxiliar, "m-1")} data-motivo-parado="">{motivoParado}</span>}
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

function LinhaDoNome({ c, finalista, escolhido, travado = false, onFinalista, onEscolher, escolhendo }: { c: CandidatoDeNome; finalista: boolean; escolhido: boolean; travado?: boolean; onFinalista: () => void; onEscolher: () => void; escolhendo: boolean }) {
  return (
    <li className={juntar(lista.linha, "items-start", finalista && lista.destaque)} data-nome={c.nome}>
      <input type="checkbox" className="mr-3 mt-1 h-4 w-4 shrink-0 accent-primary" checked={finalista} disabled={travado} title={travado ? "Rodada aprovada: gere outra para mudar" : undefined} onChange={onFinalista} aria-label={`Finalista: ${c.nome}`} />
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
          {finalista &&
            linksDoArroba(c.filtros.arroba)
              .slice(1)
              .map((l) => (
                <a key={l.rede} className={juntar(texto.etiqueta, "m-0.5 inline-flex items-center text-muted-foreground hover:text-foreground")} href={l.link} target="_blank" rel="noopener noreferrer">
                  {l.rede}
                </a>
              ))}
          {c.risco_idioma && (
            <span className="m-0.5">
              <Pastilha tom={c.risco_idioma === "alto" ? "ruim" : c.risco_idioma === "atencao" ? "alerta" : c.risco_idioma === "ok" ? "bom" : "neutro"}>
                <Languages className="mr-1 h-3 w-3" /> {ROTULO_DO_RISCO[c.risco_idioma]}
              </Pastilha>
            </span>
          )}
        </span>
        {c.idiomas && c.idiomas.length > 0 && (
          <details className="mt-1 min-w-0" data-idiomas-do-nome={c.id}>
            <summary className={juntar(texto.etiqueta, "cursor-pointer text-muted-foreground")}>Em outros idiomas</summary>
            <span className="mt-1 grid min-w-0 grid-cols-1 gap-1 sm:grid-cols-2">
              {c.idiomas.map((l) => (
                <span key={l.idioma} className={juntar(texto.auxiliar, "block")}>
                  <strong className="font-medium text-foreground">{(IDIOMAS_DO_TESTE.filter((i) => i.valor === l.idioma)[0] || { rotulo: l.idioma }).rotulo}</strong>
                  {l.pronuncia ? ` (${l.pronuncia})` : ""}: {l.significado}
                </span>
              ))}
            </span>
          </details>
        )}
      </span>
      {finalista && (
        <button type="button" className={juntar(botao.discreto, "ml-2 h-8 shrink-0")} onClick={onEscolher} disabled={escolhendo || escolhido}>
          {escolhendo ? <Loader2 className="h-4 w-4 animate-spin" /> : escolhido ? "Escolhido" : "Escolher"}
        </button>
      )}
    </li>
  );
}
