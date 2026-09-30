import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Clapperboard, ExternalLink, Film, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import Secao from "@/components/sistema/Secao";
import { botao, campo, juntar, lista, texto } from "@/components/sistema/estilos";
import { estimarLocal, modeloDoPapel, modelosAtivos, nomeDoModelo, usd } from "@/lib/mesa/api";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { STORYBOARDS_DO_MOTION } from "../../../supabase/functions/mesa-identidade/modulos/completar-marca";
import { CHAVES, type ProjetoDeIdentidade } from "./identidadeApi";
import { Pastilha, useProjetoDaMesa } from "./Comuns";
import { criarVideosDaMarca, Rodada } from "./rodadaDoCompletar";
import { andamentoDoFilme, lerFilme, montarFilme, pedirRenderDasCenas, registrarEntregaDoFilme, videoParaAprovacao, videosProntos, type FilmeResumo } from "./videosDaMarca";

const ROTULO_DO_TIPO: Record<string, string> = { apresentacao: "Apresentação em motion", filme_marca: "Filme cinematográfico" };

/** Seletor do modelo do motion (padrão do papel motion, trocável por qualquer modelo de texto). */
export function SeletorDoMotion({ valor, onEscolher }: { valor: string; onEscolher: (id: string) => void }) {
  const { catalogo } = useMesa();
  const padrao = modeloDoPapel(catalogo, "motion");
  const ativos = modelosAtivos(catalogo, "texto");
  return (
    <select className={juntar(campo, "m-1 h-8 w-auto max-w-[240px] text-[12px]")} value={ativos.some((m) => m.id === valor) ? valor : ""} onChange={(e) => onEscolher(e.target.value)} aria-label="Modelo de IA do filme" data-seletor-de-modelo="motion">
      <option value="">{padrao ? `Padrão: ${nomeDoModelo(padrao)}` : "Padrão do papel"}</option>
      {ativos.map((m) => (
        <option key={m.id} value={m.id}>
          {nomeDoModelo(m)}
        </option>
      ))}
    </select>
  );
}

export function custoDoFilmeCinematografico(catalogo: ReturnType<typeof useMesa>["catalogo"], modeloId: string): number | null {
  const m = modeloDoPapel(catalogo, "motion", modeloId || null);
  return estimarLocal([{ modeloId: m ? m.id : null, tipo: "texto", tokensEntrada: STORYBOARDS_DO_MOTION.entrada, tokensSaida: STORYBOARDS_DO_MOTION.saida }], catalogo);
}

/**
 * Vídeo da marca (IDV3, adendo do dono): cria na Mesa Motion a apresentação
 * em motion (os slides viram cenas do kit, sem IA) e, se pedir, o filme
 * cinematográfico (3 storyboards com IA, custo antes), já com logo, paleta,
 * tipografia, grafismos, estratégia, tom e tagline do projeto; mostra o
 * andamento (render da fila) e manda o vídeo pronto para aprovação.
 */
export default function VideoDaMarca({ titulo = "Vídeo da marca" }: { titulo?: string }) {
  const mesa = useMesa();
  const { marca } = useMarcaDaMesa();
  const { projeto, guardar } = useProjetoDaMesa();
  const qc = useQueryClient();
  const avisarErro = useAvisarErro();
  const [aberta, setAberta] = useState(false);
  const [pedido, setPedido] = useState({ apresentacao: true, filme: false });
  const [modeloMotion, setModeloMotion] = useEstadoDaTela<string>("mesa-identidade:modelo:motion", "", { validar: (v) => typeof v === "string" });
  const [ocupado, setOcupado] = useState<string | null>(null);
  const videos = (Array.isArray(projeto.dados.videos) ? projeto.dados.videos : []) as Array<{ filme_id: string; tipo: string; nome: string }>;
  const filmes = useQueries({
    queries: videos.map((v) => ({ queryKey: ["mesa-identidade", "filme", v.filme_id], queryFn: () => lerFilme(v.filme_id), staleTime: 30_000, retry: 1 })),
  });
  const temApresentacao = videos.some((v) => v.tipo === "apresentacao");
  const custoFilme = pedido.filme ? custoDoFilmeCinematografico(mesa.catalogo, modeloMotion) : 0;
  const marcaId = projeto.marca_id || (marca && !marca.principal ? marca.id : null);
  const enderecoDoFilme = (id: string) => `/mesa-motion?client=${mesa.clientId}${marcaId ? `&marca=${marcaId}` : ""}&filme=${id}`;

  const criar = async () => {
    setOcupado("criar");
    try {
      const r = new Rodada(projeto, { clientId: mesa.clientId, marcaId: projeto.marca_id, nomeDaMarca: String((projeto.dados.naming && projeto.dados.naming.nome) || mesa.clientName || "Marca"), modelos: { motion: modeloMotion || null }, opcoes: {}, kit: null, guardar: (p: ProjetoDeIdentidade) => guardar(p) });
      const v = await criarVideosDaMarca(r, pedido);
      toast.success(v.filmes.length === 1 ? "Filme criado na Mesa Motion" : `${v.filmes.length} filmes criados na Mesa Motion`, v.custo ? { description: `Custo: ${usd(v.custo)}` } : undefined);
      mesa.atualizarCusto();
      setAberta(false);
    } catch (e) {
      avisarErro(e, "O vídeo da marca não foi criado");
    } finally {
      setOcupado(null);
    }
  };

  const agir = async (chave: string, fn: () => Promise<unknown>, frase: string, filmeId: string) => {
    setOcupado(chave);
    try {
      await fn();
      toast.success(frase);
      void qc.invalidateQueries({ queryKey: ["mesa-identidade", "filme", filmeId] });
    } catch (e) {
      avisarErro(e, "Não foi possível concluir");
    } finally {
      setOcupado(null);
    }
  };

  const aprovar = async (f: FilmeResumo, links: Record<string, string>) => {
    const prontos = videosProntos(f, links);
    if (!prontos.length) {
      toast.info("Registre a entrega do filme antes (o render final precisa terminar).");
      return;
    }
    setOcupado(`aprovar-${f.id}`);
    try {
      const avisos: string[] = [];
      for (const v of prontos) {
        const r = await videoParaAprovacao({ clientId: mesa.clientId, filmeId: f.id, formato: v.formato, url: v.url, nome: f.nome });
        if (r.aviso) avisos.push(r.aviso);
      }
      toast.success(`${prontos.length} ${prontos.length === 1 ? "vídeo foi" : "vídeos foram"} para Arquivos com a revisão da agência`, avisos.length ? { description: avisos[0] } : undefined);
      void qc.invalidateQueries({ queryKey: CHAVES.projeto(projeto.id) });
    } catch (e) {
      avisarErro(e, "O vídeo não foi para aprovação");
    } finally {
      setOcupado(null);
    }
  };

  return (
    <Secao
      titulo={titulo}
      divisoria
      descricao={videos.length ? `${videos.length} na Mesa Motion` : "Nenhum ainda"}
      recolher={`mesa-identidade:${projeto.id}:video`}
      ajuda="O filme nasce na Mesa Motion já com a logo, as versões, a paleta, a tipografia, os grafismos, a estratégia, o tom, a tagline e as peças do projeto. A entrevista é pulada (as respostas vêm da estratégia). A apresentação em motion não usa IA: os slides viram cenas do kit. O render é da fila; o vídeo pronto entra no pacote, no brandbook web e vai para aprovação."
      acao={
        <button type="button" className={juntar(botao.secundario, "m-1 h-8")} onClick={() => setAberta(true)} data-criar-video-da-marca="">
          <Clapperboard className="mr-1.5 h-3.5 w-3.5" /> Criar vídeo
        </button>
      }
    >
      {!videos.length && <p className={texto.auxiliar}>A apresentação da marca em vídeo e o filme saem daqui.</p>}
      {videos.length > 0 && (
        <ul className={juntar(lista.aberta, lista.divisoria)} aria-label="Vídeos da marca">
          {videos.map((v, i) => {
            const q = filmes[i];
            const f = q && q.data ? q.data.filme : null;
            const links = q && q.data ? q.data.links : {};
            const a = f ? andamentoDoFilme(f) : null;
            const prontos = f ? videosProntos(f, links).length : 0;
            return (
              <li key={v.filme_id} className={juntar(lista.linha, "flex-wrap")} data-video-da-marca={v.tipo}>
                <Film className="mr-3 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className={juntar(texto.corpo, "block truncate")}>{v.nome || ROTULO_DO_TIPO[v.tipo] || "Filme"}</span>
                  <span className={juntar(texto.auxiliar, "block truncate")}>
                    {q && q.isLoading ? "Lendo o andamento" : q && q.isError ? "Andamento indisponível" : a ? `${ROTULO_DO_TIPO[v.tipo] || v.tipo} · ${a.comFinal} de ${a.cenas} cenas com render final${a.entregue ? ` · ${a.entregue} formatos prontos` : a.montado ? " · montagem na fila" : ""}` : ""}
                  </span>
                </span>
                {f && f.arquivado_em && <Pastilha tom="alerta">Arquivado</Pastilha>}
                {f && a && !f.arquivado_em && a.cenas > 0 && a.comFinal < a.cenas && (
                  <button type="button" className={juntar(botao.discreto, "m-1 h-8")} disabled={ocupado === `render-${f.id}`} onClick={() => void agir(`render-${f.id}`, () => pedirRenderDasCenas(f), "Render das cenas pedido à fila", f.id)}>
                    {ocupado === `render-${f.id}` ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null} Pedir o render
                  </button>
                )}
                {f && a && !f.arquivado_em && a.cenas > 0 && a.comFinal === a.cenas && !a.montado && (
                  <button type="button" className={juntar(botao.discreto, "m-1 h-8")} disabled={ocupado === `montar-${f.id}`} onClick={() => void agir(`montar-${f.id}`, () => montarFilme(f), "Montagem na fila", f.id)}>
                    Montar o vídeo
                  </button>
                )}
                {f && a && !f.arquivado_em && a.montado && !a.entregue && (
                  <button type="button" className={juntar(botao.discreto, "m-1 h-8")} disabled={ocupado === `entregar-${f.id}`} onClick={() => void agir(`entregar-${f.id}`, () => registrarEntregaDoFilme(f), "Entrega registrada", f.id)}>
                    Registrar entrega
                  </button>
                )}
                {f && prontos > 0 && (
                  <button type="button" className={juntar(botao.discreto, "m-1 h-8")} disabled={ocupado === `aprovar-${f.id}`} onClick={() => void aprovar(f, links)}>
                    {ocupado === `aprovar-${f.id}` ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1.5 h-3.5 w-3.5" />} Para aprovação
                  </button>
                )}
                <Link className={juntar(botao.discreto, "m-1 h-8")} to={enderecoDoFilme(v.filme_id)}>
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" /> Mesa Motion
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <Dialog open={aberta} onOpenChange={(v) => !ocupado && setAberta(v)}>
        <DialogContent className="max-w-lg" data-janela-do-video="">
          <DialogHeader>
            <DialogTitle>Criar o vídeo da marca</DialogTitle>
            <DialogDescription>O filme abre na Mesa Motion com os insumos do projeto. Nada é enviado ao cliente.</DialogDescription>
          </DialogHeader>
          <div className="grid min-w-0">
            <label className={juntar(texto.corpo, "flex items-start py-2")}>
              <input type="checkbox" className="mr-2 mt-0.5 h-4 w-4 accent-primary" checked={pedido.apresentacao} onChange={(e) => setPedido({ ...pedido, apresentacao: e.target.checked })} />
              <span className="min-w-0">
                <span className="block">Apresentação em motion{temApresentacao ? " (já existe uma)" : ""}</span>
                <span className={juntar(texto.auxiliar, "block")}>Logo sting, abertura, paleta, tipografia, aplicações e cartão final. Sem IA.</span>
              </span>
            </label>
            <label className={juntar(texto.corpo, "flex items-start py-2")}>
              <input type="checkbox" className="mr-2 mt-0.5 h-4 w-4 accent-primary" checked={pedido.filme} onChange={(e) => setPedido({ ...pedido, filme: e.target.checked })} />
              <span className="min-w-0">
                <span className="block">Filme cinematográfico</span>
                <span className={juntar(texto.auxiliar, "block")}>3 storyboards com IA para escolher na Mesa Motion.</span>
              </span>
            </label>
            {pedido.filme && (
              <div className="flex min-w-0 flex-wrap items-center">
                <span className={juntar(texto.rotulo, "m-1")}>Modelo</span>
                <SeletorDoMotion valor={modeloMotion} onEscolher={setModeloMotion} />
              </div>
            )}
          </div>
          <DialogFooter>
            <button type="button" className={botao.discreto} onClick={() => setAberta(false)} disabled={!!ocupado}>
              Cancelar
            </button>
            <button type="button" className={botao.primario} disabled={!!ocupado || (!pedido.apresentacao && !pedido.filme)} onClick={() => void criar()} data-confirmar-video="">
              {ocupado === "criar" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Confirmar{custoFilme == null ? " (preço a conferir)" : custoFilme > 0 ? ` (${usd(custoFilme)})` : " (sem custo de IA)"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Secao>
  );
}
