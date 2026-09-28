import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, CheckCircle2, ChevronDown, ChevronRight, Loader2, Plus, Scissors, ScanEye, Trash2, Undo2, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import { MiniaturaDoStorage } from "@/components/mesa/ContextoMiniatura";
import CartaoDeAcao from "@/components/agentes/CartaoDeAcao";
import { acaoDoAnexo, type AcaoDoAgente, type PedidoDaAcao, type RespostaDaAcao } from "@/lib/agentes/acoesDoAgente";
import Secao from "@/components/sistema/Secao";
import RegiaoRolavel from "@/components/sistema/RegiaoRolavel";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { CampoDeFormulario, GrupoDeCampos } from "@/components/sistema/Formulario";
import { EstadoVazio } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, campoTexto, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { textoDoErro } from "@/lib/mesa/api";
import { useMotoresDaMesa, useProjetoDoDiretor } from "@/lib/mesa-videos/api";
import { quadroDoVideoNoStorage } from "@/lib/mesa-videos/quadros";
import { duracoesDoMotor, motorPorId, textoDoCusto } from "../../../supabase/functions/_shared/modelos-de-video";
import {
  conferirContinuidade,
  custoDoPlano,
  custoDoRoteiro,
  motorServeAoModo,
  type ModoDoPlano,
  type PlanoDoRoteiro,
  type QuadroDoPlano,
} from "../../../supabase/functions/_shared/diretor-de-video";
import { EscolherImagem } from "./PecasDoGerador";
import type { IrPara } from "./MesaDeVideo";
import { chamarMesaVideos, chaveDosPedidos, useArquivosDeVideo, type ArquivoDeVideo } from "./videosApi";

/**
 * Roteiro do diretor (frente V-A): a lista de planos (shot list) com rolagem
 * própria. Cada plano: duração que o motor aceita, câmera, motor, modo,
 * prompt final, quadro inicial e final, custo e os avisos de continuidade.
 * Gerar os escolhidos passa pelo cartão do contrato comum (custo antes,
 * Confirmar, sem desfazer). Depois: escolher a melhor variação (o Jev ajuda
 * em Avaliar), usar o último quadro no próximo plano e mandar ao editor.
 */

const MODOS: { valor: ModoDoPlano; rotulo: string }[] = [
  { valor: "primeiro_quadro", rotulo: "Parte de uma imagem" },
  { valor: "primeiro_ultimo", rotulo: "Primeiro e último quadro" },
  { valor: "referencia", rotulo: "Referência do personagem" },
  { valor: "texto", rotulo: "Só texto" },
];

const TIPOS_DE_QUADRO: { valor: QuadroDoPlano["tipo"] | ""; rotulo: string }[] = [
  { valor: "", rotulo: "Nenhum" },
  { valor: "arquivo", rotulo: "Imagem escolhida" },
  { valor: "ancora", rotulo: "Âncora do cenário" },
  { valor: "folha", rotulo: "Folha do personagem" },
  { valor: "anterior", rotulo: "Último quadro do plano anterior" },
];

function QuadroDoPlanoCampo({ rotulo, valor, onMudar, opcoesDeRef }: { rotulo: string; valor: QuadroDoPlano | null; onMudar: (q: QuadroDoPlano | null) => void; opcoesDeRef: { ancora: { id: string; nome: string }[]; folha: { id: string; nome: string }[] } }) {
  const tipo = valor ? valor.tipo : "";
  return (
    <div className="min-w-0 space-y-2">
      <CampoDeFormulario rotulo={rotulo}>
        <select className={campo} value={tipo} onChange={(e) => onMudar(e.target.value ? { tipo: e.target.value as QuadroDoPlano["tipo"], ref: null } : null)}>
          {TIPOS_DE_QUADRO.map((t) => (
            <option key={t.valor} value={t.valor}>
              {t.rotulo}
            </option>
          ))}
        </select>
      </CampoDeFormulario>
      {valor && valor.tipo === "arquivo" && <EscolherImagem rotulo={`${rotulo}: imagem`} valor={valor.ref} onEscolher={(c) => onMudar({ tipo: "arquivo", ref: c })} />}
      {valor && (valor.tipo === "ancora" || valor.tipo === "folha") && (
        <select className={campo} value={valor.ref || ""} onChange={(e) => onMudar({ tipo: valor.tipo, ref: e.target.value || null })} aria-label={`${rotulo}: de quem`}>
          <option value="">{valor.tipo === "ancora" ? "O único cenário" : "O único personagem"}</option>
          {(valor.tipo === "ancora" ? opcoesDeRef.ancora : opcoesDeRef.folha).map((o) => (
            <option key={o.id} value={o.id}>
              {o.nome}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}

export default function EtapaRoteiro({ irPara }: { irPara: IrPara }) {
  const { clientId, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const motores = useMotoresDaMesa();
  const arquivosQ = useArquivosDeVideo(clientId);
  const { projeto, mudar, desfazer, podeDesfazer } = useProjetoDoDiretor(clientId);
  const [aberto, setAberto] = useEstadoDaTela<string>(`mesa-videos:roteiro:aberto:${clientId}`, "p1");
  const [marcados, setMarcados] = useEstadoDaTela<string[]>(`mesa-videos:roteiro:marcados:${clientId}`, [], { validar: (v) => Array.isArray(v) });
  const [variacoes, setVariacoes] = useEstadoDaTela<number>(`mesa-videos:roteiro:variacoes:${clientId}`, 2);
  const [proposta, setProposta] = useState<{ mensagem_id: string; acao: AcaoDoAgente } | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const b = projeto.biblia;
  const planos = projeto.roteiro.planos;
  const avisos = useMemo(() => conferirContinuidade(b, projeto.roteiro, motores.motores), [b, projeto.roteiro, motores.motores]);
  const total = custoDoRoteiro(projeto.roteiro, motores.motores, variacoes);
  const arquivos = (arquivosQ.data && arquivosQ.data.arquivos) || [];
  const resultadosDo = (p: PlanoDoRoteiro): ArquivoDeVideo[] => arquivos.filter((a) => a.tipo === "gerado" && a.estado !== "arquivado" && a.cena_ref === p.ref && (!projeto.titulo || !a.grupo || a.grupo.indexOf(projeto.titulo) === 0));
  const refs = { ancora: b.cenarios.map((c) => ({ id: c.id, nome: c.nome })), folha: b.personagens.map((p) => ({ id: p.id, nome: p.nome })) };

  const mudarPlano = (ref: string, m: Partial<PlanoDoRoteiro>) =>
    mudar((p) => ({
      ...p,
      roteiro: {
        ...p.roteiro,
        planos: p.roteiro.planos.map((x) => {
          if (x.ref !== ref) return x;
          const novo = { ...x, ...m };
          novo.custo_usd = custoDoPlano(novo, motores.motores);
          return novo;
        }),
      },
    }));

  const renumerar = (lista: PlanoDoRoteiro[]) => lista.map((x, i) => ({ ...x, ordem: i + 1, ref: `p${i + 1}` }));
  const mover = (i: number, d: -1 | 1) =>
    mudar((p) => {
      const l = p.roteiro.planos.slice();
      const j = i + d;
      if (j < 0 || j >= l.length) return p;
      const t = l[i];
      l[i] = l[j];
      l[j] = t;
      return { ...p, roteiro: { ...p.roteiro, planos: renumerar(l) } };
    }, true);
  const novoPlano = () =>
    mudar((p) => {
      const ultimo = p.roteiro.planos[p.roteiro.planos.length - 1];
      const plano: PlanoDoRoteiro = {
        ref: `p${p.roteiro.planos.length + 1}`,
        ordem: p.roteiro.planos.length + 1,
        titulo: "Plano novo",
        cena_do_kit: null,
        duracao_s: 5,
        personagens: ultimo ? ultimo.personagens.slice() : [],
        cenario: ultimo ? ultimo.cenario : null,
        enquadramento: "",
        angulo: "",
        movimento: "",
        acao: "",
        fala: null,
        texto_na_tela: null,
        motor: ultimo ? ultimo.motor : "seedance-2.5",
        modo: "primeiro_quadro",
        prompt: "",
        quadro_inicial: ultimo ? { tipo: "anterior", ref: null } : null,
        quadro_final: null,
        custo_usd: null,
        escolhido: null,
        pedidos: [],
      };
      return { ...p, roteiro: { ...p.roteiro, planos: p.roteiro.planos.concat([plano]) } };
    }, true);
  const tirar = (ref: string) => mudar((p) => ({ ...p, roteiro: { ...p.roteiro, planos: renumerar(p.roteiro.planos.filter((x) => x.ref !== ref)) } }), true);

  const proporGerar = async () => {
    setOcupado("gerar");
    try {
      const r = await chamarMesaVideos<{ mensagem_id: string | null; acao: unknown }>({ acao: "diretor_propor_gerar", client_id: clientId, projeto, planos: marcados, variacoes });
      const a = acaoDoAnexo(r.acao);
      if (!r.mensagem_id || !a) toast.info("Nenhum plano pronto para gerar.");
      else setProposta({ mensagem_id: r.mensagem_id, acao: a });
    } catch (e) {
      toast.error("Não foi possível preparar", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setOcupado(null);
    }
  };

  const onPedido = (pedido: PedidoDaAcao): Promise<RespostaDaAcao> => {
    if (!proposta) return Promise.reject(new Error("Sem proposta."));
    const corpo: Record<string, unknown> = { acao: pedido === "desfazer" ? "desfazer_acao_agente" : "executar_acao_agente", mensagem_id: proposta.mensagem_id, acao_id: proposta.acao.id };
    if (pedido === "descartar") corpo.descartar = true;
    if (pedido === "parar") corpo.parar = true;
    return chamarMesaVideos<RespostaDaAcao>(corpo);
  };

  const usarUltimoQuadro = async (i: number) => {
    const p = planos[i];
    const a = arquivos.find((x) => x.id === p.escolhido);
    const prox = planos[i + 1];
    if (!a || !prox) return;
    setOcupado(`quadro-${p.ref}`);
    try {
      const caminho = await quadroDoVideoNoStorage(clientId, a.storage_bucket, a.storage_path, "ultimo");
      void chamarMesaVideos({ acao: "quadro_registrar", client_id: clientId, storage_path: caminho, posicao: "ultimo", origem_arquivo_id: a.id }).catch(() => null);
      mudarPlano(prox.ref, { quadro_inicial: { tipo: "arquivo", ref: caminho } });
      toast.success(`O último quadro de ${p.ref} é o começo de ${prox.ref}`);
    } catch (e) {
      toast.error("Não foi possível tirar o quadro", { description: textoDoErro(e) });
    } finally {
      setOcupado(null);
    }
  };

  const avaliar = async (p: PlanoDoRoteiro) => {
    const ids = resultadosDo(p).slice(0, 4).map((a) => a.id);
    if (!ids.length) return;
    setOcupado(`avaliar-${p.ref}`);
    try {
      const r = await chamarMesaVideos<{ melhor: string | null; variacoes: { id: string; nota: number | null; ok: boolean }[]; aviso?: string; custo_usd?: number }>({ acao: "diretor_avaliar", client_id: clientId, projeto, plano_ref: p.ref, arquivo_ids: ids });
      atualizarCusto();
      const ruins = r.variacoes.filter((v) => !v.ok).length;
      if (r.melhor) mudarPlano(p.ref, { escolhido: r.melhor });
      toast.success(r.melhor ? "A melhor variação foi escolhida" : "Avaliado", { description: r.aviso || (ruins ? `${ruins} ${ruins === 1 ? "variação foge" : "variações fogem"} da bíblia.` : "Todas seguem a bíblia.") });
    } catch (e) {
      toast.error("Não foi possível avaliar", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setOcupado(null);
    }
  };

  const mandarAoEditor = async () => {
    setOcupado("editor");
    try {
      const r = await chamarMesaVideos<{ versao: { id: string }; faltando: string[] }>({ acao: "diretor_para_editor", client_id: clientId, projeto });
      toast.success("Mandado ao editor", {
        description: r.faltando.length ? `Sem resultado escolhido: ${r.faltando.join(", ")}.` : "Todos os planos entraram na ordem do roteiro.",
        action: { label: "Desfazer", onClick: () => void chamarMesaVideos({ acao: "diretor_editor_desfazer", versao_id: r.versao.id }) },
      });
    } catch (e) {
      toast.error("Não foi possível mandar ao editor", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setOcupado(null);
    }
  };

  const erros = avisos.filter((a) => a.nivel === "erro").length;

  return (
    <div className="min-w-0 pb-6">
      <Secao
        titulo="Roteiro"
        descricao={`${planos.length} planos · ${total.segundos} s · ${total.incompleto ? "~" : ""}US$ ${total.usd.toFixed(2).replace(".", ",")} com ${variacoes} ${variacoes === 1 ? "variação" : "variações"}${erros ? ` · ${erros} ${erros === 1 ? "erro" : "erros"}` : ""}`}
        ajuda="Marque os planos e gere: o cartão mostra o custo e pede confirmação. Depois escolha a melhor variação (Avaliar usa o Jev contra a bíblia), passe o último quadro para o próximo plano e mande ao editor."
        acao={
          <>
            {podeDesfazer && (
              <button type="button" className={botao.icone} onClick={() => desfazer()} aria-label="Desfazer" title="Desfazer">
                <Undo2 className="h-3.5 w-3.5" />
              </button>
            )}
            <SeletorCompacto rotulo="Variações por plano" opcoes={[1, 2, 3, 4].map((n) => ({ valor: String(n), rotulo: `${n}x` }))} valor={String(variacoes)} onEscolher={(v) => setVariacoes(Number(v))} className="ml-1" />
            <button type="button" className={juntar(botao.secundario, "ml-1")} onClick={novoPlano} aria-label="Novo plano">
              <Plus className="h-3.5 w-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">Plano</span>
            </button>
            <button type="button" className={juntar(botao.secundario, "ml-1")} onClick={() => void mandarAoEditor()} disabled={!!ocupado || !planos.some((p) => p.escolhido)} aria-label="Mandar ao editor">
              {ocupado === "editor" ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-1.5" /> : <Scissors className="h-3.5 w-3.5 sm:mr-1.5" />}
              <span className="hidden sm:inline">Editor</span>
            </button>
            <button type="button" className={juntar(botao.primario, "ml-1")} onClick={() => void proporGerar()} disabled={!!ocupado || !marcados.length} aria-label="Gerar os planos marcados">
              {ocupado === "gerar" ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-1.5" /> : <Wand2 className="h-3.5 w-3.5 sm:mr-1.5" />}
              <span className="hidden sm:inline">Gerar {marcados.length || ""}</span>
            </button>
          </>
        }
        data-roteiro=""
      >
        {proposta && (
          <div className="mb-4">
            <CartaoDeAcao
              acao={proposta.acao}
              titulo="Gerar planos"
              observacao={`Custo estimado US$ ${Number(proposta.acao.custo_estimado_usd || 0).toFixed(2).replace(".", ",")} na carteira do cliente. Sem desfazer.`}
              onPedido={onPedido}
              onFeito={(_p, resposta) => {
                const novo = acaoDoAnexo(resposta && resposta.anexo);
                if (novo) setProposta({ mensagem_id: proposta.mensagem_id, acao: novo });
                void queryClient.invalidateQueries({ queryKey: chaveDosPedidos(clientId) });
                atualizarCusto();
              }}
            />
          </div>
        )}
        {!planos.length ? (
          <EstadoVazio titulo="Nenhum plano ainda" descricao="Use um kit ou peça ao diretor para montar o roteiro." acao={<button type="button" className={botao.secundario} onClick={() => irPara("kit")}>Escolher kit</button>} />
        ) : (
          {/* 28/09: sem altura fixa. A principal da AreaDeTrabalho já rola; a caixa
              de 100vh-260px criava rolagem dentro de rolagem e sobra ou corte na tela cheia. */}
          <RegiaoRolavel rotulo="Planos do roteiro" memoria={`mesa-videos:roteiro:${clientId}`}>
            <ol className="divide-y divide-border" aria-label="Planos">
              {planos.map((p, i) => {
                const m = motorPorId(p.motor, motores.motores);
                const doPlano = avisos.filter((a) => a.ref === p.ref);
                const res = resultadosDo(p);
                const estaAberto = aberto === p.ref;
                const marcado = marcados.indexOf(p.ref) >= 0;
                const custo = custoDoPlano(p, motores.motores, variacoes);
                return (
                  <li key={p.ref} className="py-2" data-plano={p.ref}>
                    <div className="flex min-w-0 items-center">
                      <input type="checkbox" className="mr-2 h-4 w-4 shrink-0 accent-primary" checked={marcado} onChange={(e) => setMarcados(e.target.checked ? marcados.concat([p.ref]) : marcados.filter((x) => x !== p.ref))} aria-label={`Marcar ${p.ref} para gerar`} />
                      <button type="button" className="mr-2 flex min-w-0 flex-1 items-center text-left" onClick={() => setAberto(estaAberto ? "" : p.ref)} aria-expanded={estaAberto}>
                        {estaAberto ? <ChevronDown className="mr-1 h-3.5 w-3.5 shrink-0" /> : <ChevronRight className="mr-1 h-3.5 w-3.5 shrink-0" />}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium">
                            {p.ordem}. {p.titulo}
                          </span>
                          <span className={juntar(texto.auxiliar, "block truncate")}>
                            {p.duracao_s} s · {m ? m.rotulo : "sem motor"} · {p.movimento || "câmera livre"}
                          </span>
                        </span>
                      </button>
                      {doPlano.some((a) => a.nivel === "erro") && <span className={juntar(etiqueta, "mr-1 bg-destructive/10 text-destructive")}>{doPlano.filter((a) => a.nivel === "erro").length}</span>}
                      {p.escolhido && <CheckCircle2 className="mr-1 h-3.5 w-3.5 shrink-0 text-primary" aria-label="Com resultado escolhido" />}
                      <span className="mr-1 text-[12px] tabular-nums text-muted-foreground">{custo === null ? "Sem cotação" : textoDoCusto({ usd: custo, incerto: !!(m && m.preco && m.preco.incerto) })}</span>
                    </div>
                    {estaAberto && (
                      <div className="mt-3 space-y-4 pl-6">
                        {doPlano.length > 0 && (
                          <ul className="space-y-0.5">
                            {doPlano.map((a) => (
                              <li key={a.texto} className={juntar(texto.auxiliar, a.nivel === "erro" ? "text-destructive" : "")}>
                                {a.texto}
                              </li>
                            ))}
                          </ul>
                        )}
                        <GrupoDeCampos colunas={3}>
                          <CampoDeFormulario rotulo="Título">
                            <input className={campo} value={p.titulo} maxLength={100} onChange={(e) => mudarPlano(p.ref, { titulo: e.target.value })} />
                          </CampoDeFormulario>
                          <CampoDeFormulario rotulo="Modo">
                            <select className={campo} value={p.modo} onChange={(e) => mudarPlano(p.ref, { modo: e.target.value as ModoDoPlano })}>
                              {MODOS.map((x) => (
                                <option key={x.valor} value={x.valor}>
                                  {x.rotulo}
                                </option>
                              ))}
                            </select>
                          </CampoDeFormulario>
                          <CampoDeFormulario rotulo="Motor" apoio={m ? motorServeAoModo(m, p.modo) || m.nota : undefined}>
                            <select className={campo} value={p.motor} onChange={(e) => mudarPlano(p.ref, { motor: e.target.value })}>
                              {motores.lista
                                .filter((x) => x.motor.familia === "video" && !x.motor.situacao)
                                .map((x) => (
                                  <option key={x.motor.id} value={x.motor.id} disabled={!!motorServeAoModo(x.motor, p.modo)}>
                                    {x.motor.rotulo} ({x.nivel === "top" ? "Top" : x.nivel === "rapido" ? "Rápido" : "Normal"})
                                  </option>
                                ))}
                            </select>
                          </CampoDeFormulario>
                          <CampoDeFormulario rotulo="Duração">
                            <select className={campo} value={p.duracao_s} onChange={(e) => mudarPlano(p.ref, { duracao_s: Number(e.target.value) })}>
                              {(m ? duracoesDoMotor(m) : [5]).map((d) => (
                                <option key={d} value={d}>
                                  {d} s
                                </option>
                              ))}
                            </select>
                          </CampoDeFormulario>
                          <CampoDeFormulario rotulo="Enquadramento e ângulo">
                            <input className={campo} value={[p.enquadramento, p.angulo].filter(Boolean).join(", ")} maxLength={160} onChange={(e) => mudarPlano(p.ref, { enquadramento: e.target.value, angulo: "" })} />
                          </CampoDeFormulario>
                          <CampoDeFormulario rotulo="Movimento de câmera">
                            <input className={campo} value={p.movimento} maxLength={80} onChange={(e) => mudarPlano(p.ref, { movimento: e.target.value })} />
                          </CampoDeFormulario>
                          <CampoDeFormulario rotulo="Cenário">
                            <select className={campo} value={p.cenario || ""} onChange={(e) => mudarPlano(p.ref, { cenario: e.target.value || null })}>
                              <option value="">Nenhum</option>
                              {b.cenarios.map((c) => (
                                <option key={c.id} value={c.id}>
                                  {c.nome}
                                </option>
                              ))}
                            </select>
                          </CampoDeFormulario>
                          {b.personagens.length > 0 && <CampoDeFormulario rotulo="Personagens">
                            <select className={campo} multiple value={p.personagens} onChange={(e) => mudarPlano(p.ref, { personagens: (Array.prototype.filter.call(e.target.options, (o: HTMLOptionElement) => o.selected) as HTMLOptionElement[]).map((o) => o.value) })} style={{ height: "auto", minHeight: "2.25rem" }}>
                              {b.personagens.map((x) => (
                                <option key={x.id} value={x.id}>
                                  {x.nome}
                                </option>
                              ))}
                            </select>
                          </CampoDeFormulario>}
                          <CampoDeFormulario rotulo="Texto na tela (edição)">
                            <input className={campo} value={p.texto_na_tela || ""} maxLength={80} onChange={(e) => mudarPlano(p.ref, { texto_na_tela: e.target.value || null })} />
                          </CampoDeFormulario>
                        </GrupoDeCampos>
                        <CampoDeFormulario rotulo="Prompt final (inglês)" largo>
                          <textarea className={juntar(campoTexto, "min-h-[96px]")} value={p.prompt} maxLength={1800} onChange={(e) => mudarPlano(p.ref, { prompt: e.target.value })} />
                        </CampoDeFormulario>
                        <GrupoDeCampos colunas={3}>
                          <CampoDeFormulario rotulo="Fala (português)">
                            <input className={campo} value={p.fala || ""} maxLength={200} onChange={(e) => mudarPlano(p.ref, { fala: e.target.value || null })} />
                          </CampoDeFormulario>
                          <QuadroDoPlanoCampo rotulo="Quadro inicial" valor={p.quadro_inicial} onMudar={(q) => mudarPlano(p.ref, { quadro_inicial: q })} opcoesDeRef={refs} />
                          {p.modo === "primeiro_ultimo" && <QuadroDoPlanoCampo rotulo="Último quadro" valor={p.quadro_final} onMudar={(q) => mudarPlano(p.ref, { quadro_final: q })} opcoesDeRef={refs} />}
                        </GrupoDeCampos>
                        {res.length > 0 && (
                          <div>
                            <div className="mb-2 flex min-w-0 items-center">
                              <p className={juntar(texto.rotulo, "flex-1")}>Resultados ({res.length})</p>
                              <button type="button" className={botao.discreto} disabled={!!ocupado} onClick={() => void avaliar(p)} aria-label={`Avaliar os resultados de ${p.ref}`}>
                                {ocupado === `avaliar-${p.ref}` ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-1.5" /> : <ScanEye className="h-3.5 w-3.5 sm:mr-1.5" />}
                                <span className="hidden sm:inline">Avaliar</span>
                              </button>
                              {p.escolhido && planos[i + 1] && (
                                <button type="button" className={botao.discreto} disabled={!!ocupado} onClick={() => void usarUltimoQuadro(i)}>
                                  {ocupado === `quadro-${p.ref}` ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                                  Fim no próximo
                                </button>
                              )}
                            </div>
                            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4" aria-label={`Resultados de ${p.ref}`}>
                              {res.map((a) => (
                                <li key={a.id}>
                                  <button type="button" onClick={() => mudarPlano(p.ref, { escolhido: p.escolhido === a.id ? null : a.id })} className={juntar("relative block w-full overflow-hidden rounded-md bg-muted", p.escolhido === a.id ? "ring-2 ring-primary" : "")} style={{ paddingBottom: "125%" }} aria-label={`${p.escolhido === a.id ? "Tirar" : "Escolher"} ${a.nome}`}>
                                    <MiniaturaDoStorage bucket={a.storage_bucket || "mesa"} caminho={a.storage_path} alt={a.nome} className="absolute inset-0 h-full w-full" />
                                  </button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <div className="flex min-w-0 items-center justify-end">
                          <button type="button" className={botao.icone} onClick={() => mover(i, -1)} disabled={i === 0} aria-label="Subir o plano">
                            <ArrowUp className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" className={botao.icone} onClick={() => mover(i, 1)} disabled={i === planos.length - 1} aria-label="Descer o plano">
                            <ArrowDown className="h-3.5 w-3.5" />
                          </button>
                          <button type="button" className={botao.icone} onClick={() => tirar(p.ref)} aria-label={`Tirar ${p.ref}`}>
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          </RegiaoRolavel>
        )}
      </Secao>
      <p className="sr-only" aria-live="polite">
        {ocupado ? "Trabalhando" : ""}
      </p>
    </div>
  );
}
