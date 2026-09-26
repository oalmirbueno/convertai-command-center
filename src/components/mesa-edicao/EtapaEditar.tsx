import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, History, Loader2, Monitor, Package, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useMesa } from "@/components/mesa/MesaContexto";
import { textoDoErro } from "@/lib/mesa/api";
import Secao from "@/components/sistema/Secao";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { CampoDeFormulario, GrupoDeCampos } from "@/components/sistema/Formulario";
import { EstadoVazio } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, campoTexto, etiqueta, juntar, superficie, texto } from "@/components/sistema/estilos";
import { montarPacote } from "../../../supabase/functions/_shared/pacote-de-edicao";
import { FONTE_BRABO, MODOS_DE_COMPOSICAO } from "../../../supabase/functions/_shared/conhecimento-edicao";
import { ROTULO_DA_TAREFA } from "../../../supabase/functions/_shared/computador-do-agente";
import type { IrPara } from "@/components/mesa-videos/MesaDeVideo";
import {
  BUCKET_DOS_VIDEOS,
  chamarMesaVideos,
  chaveDasVersoes,
  duracaoCurta,
  naEntradaDaEdicao,
  useArquivosDeVideo,
  useFilaDoComputador,
  useHistorias,
  usePedidos,
  useRoteirosAprovados,
} from "@/components/mesa-videos/videosApi";
import AreaDoEditor from "./AreaDoEditor";
import { entradaDoPacote } from "./pacote";
import Versoes from "./Versoes";
import { useParte } from "./useParte";

/**
 * Editar (Mesa Edição, frente E2): edição dinâmica pelo método Brabo.
 *
 * Em cima, a ÁREA DO EDITOR (AreaDoEditor.tsx): a montagem do projeto de
 * edição (_shared/projeto-de-edicao.ts) com o que a equipe escolheu aqui e,
 * ao abrir, o editor de vídeo completo da frente V-B (preview com Remotion
 * Player, linha do tempo, skills, câmera, timestamp, referências e agente). Embaixo, o que já existe: a direção e o pacote para
 * editar (o edl.json e o projeto.json saem do projeto), as versões (salvar o
 * projeto como versão, comentar no tempo, aprovar) e a fila do computador do
 * agente (desligada). Nada aqui gasta.
 */

const PARTES = ["pacote", "versoes"] as const;
type ParteDoEditar = (typeof PARTES)[number];

interface Escolhas {
  titulo: string;
  roteiroId: string;
  canvasId: string;
  quais: "melhores" | "todos";
  destino: "editor" | "remotion";
  fps: string;
  formato: string;
  direcao: string;
}

const ESCOLHAS: Escolhas = { titulo: "", roteiroId: "", canvasId: "", quais: "melhores", destino: "editor", fps: "", formato: "9:16", direcao: "" };

function salvarBlob(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nome;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function ComputadorDoAgente() {
  const { clientId } = useMesa();
  const filaQ = useFilaDoComputador(clientId);
  const tarefas = (filaQ.data && filaQ.data.itens) || [];
  return (
    <Secao
      divisoria
      nivel={3}
      titulo="Computador do agente"
      descricao="Desligado"
      ajuda="Um agente que opera um programa de computador (organizar o projeto no Premiere, por exemplo). Nenhuma tarefa roda sem aprovação do dono, nada com senha de cliente passa pelo painel e cada passo deixa um print como prova."
      acao={
        <button type="button" className={botao.discreto} disabled title="Desligado. Desenho em docs/motores/COMPUTADOR-DO-AGENTE.md" aria-label="Pedir tarefa">
          <Monitor className="h-3.5 w-3.5 sm:mr-1.5" />
          <span className="hidden sm:inline">Pedir tarefa</span>
        </button>
      }
      data-computador-do-agente="desligado"
    >
      {tarefas.length > 0 && (
        <ul className="divide-y divide-border">
          {tarefas.map((t) => (
            <li key={t.id} className="flex min-w-0 items-center py-1.5 text-[13px]">
              <span className="min-w-0 flex-1 truncate">{t.titulo}</span>
              <span className={juntar(etiqueta, "ml-2 bg-muted text-muted-foreground")}>{ROTULO_DA_TAREFA[t.estado] || t.estado}</span>
            </li>
          ))}
        </ul>
      )}
    </Secao>
  );
}

export default function EtapaEditar({ irPara }: { irPara: IrPara }) {
  const { clientId, clientName } = useMesa();
  const queryClient = useQueryClient();
  const arquivosQ = useArquivosDeVideo(clientId);
  const roteirosQ = useRoteirosAprovados(clientId);
  const historiasQ = useHistorias(clientId);
  const pedidosQ = usePedidos(clientId);
  const [parte, setParte] = useParte<ParteDoEditar>(`mesa-edicao:editar:parte:${clientId}`, PARTES, "pacote");
  const [e, setE] = useEstadoDaTela<Escolhas>(`mesa-edicao:editar:escolhas:${clientId}`, ESCOLHAS, { validar: (v) => !!v && typeof v === "object", esperaMs: 300 });
  const mudar = (m: Partial<Escolhas>) => setE((x) => ({ ...x, ...m }));
  const [baixando, setBaixando] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const roteiros = (roteirosQ.data && roteirosQ.data.roteiros) || [];
  const historias = (historiasQ.data && historiasQ.data.historias) || [];
  const roteiro = roteiros.find((r) => r.id === e.roteiroId) || null;
  const historia = historias.find((h) => h.canvas_id === e.canvasId) || null;
  const arquivos = ((arquivosQ.data && arquivosQ.data.arquivos) || []).filter(naEntradaDaEdicao);
  const pedidos = (pedidosQ.data && pedidosQ.data.itens) || [];

  const entrada = (urls?: Record<string, string>) =>
    entradaDoPacote({
      clienteId: clientId,
      clienteNome: clientName,
      titulo: e.titulo || (roteiro ? roteiro.titulo : historia ? historia.nome : "Vídeo"),
      arquivos,
      quais: e.quais,
      roteiro: roteiro ? { id: roteiro.id, titulo: roteiro.titulo, cenas: roteiro.cenas } : null,
      historia: historia
        ? { canvas_id: historia.canvas_id, nome: historia.nome, cenas: historia.cenas.map((c) => ({ numero: c.numero, no_id: c.no_id, titulo: c.titulo, acao: c.acao, narrativa: c.narrativa, enquadramento: c.enquadramento, imagem_id: c.imagem_id })) }
        : null,
      pedidos,
      destino: e.destino,
      fps: Number(e.fps) > 0 ? Number(e.fps) : null,
      formato: e.formato,
      direcao: e.direcao,
      urls,
      agora: new Date().toISOString(),
    });
  const previa = entrada();
  const pacote = montarPacote(previa);
  const projeto = previa.projeto!;

  const baixar = async () => {
    setBaixando(true);
    try {
      const e0 = entrada();
      const caminhos = e0.takes.map((t) => t.storage_path);
      const urls: Record<string, string> = {};
      if (caminhos.length) {
        const { data } = await supabase.storage.from(BUCKET_DOS_VIDEOS).createSignedUrls(caminhos, 24 * 3600);
        ((data || []) as { path: string | null; signedUrl: string; error: string | null }[]).forEach((x) => {
          if (x.path && x.signedUrl && !x.error) urls[x.path] = x.signedUrl;
        });
      }
      const p = montarPacote(entrada(urls));
      const modulo: any = await import("jszip");
      const JSZip = modulo.default || modulo;
      const zip = new JSZip();
      Object.keys(p.arquivos).forEach((k) => zip.file(k, p.arquivos[k]));
      salvarBlob(await zip.generateAsync({ type: "blob" }), p.nome_do_zip);
      toast.success("Pacote pronto", { description: `${p.resumo.takes} ${p.resumo.takes === 1 ? "take" : "takes"}, ${p.pendencias.length} ${p.pendencias.length === 1 ? "pendência" : "pendências"} no LEIA-ME.` });
    } catch (err) {
      toast.error("Não foi possível montar o pacote", { description: textoDoErro(err) });
    } finally {
      setBaixando(false);
    }
  };

  // O projeto vira uma versão do vídeo (memória por vídeo): comentar, aprovar e o editor completo abrem daqui.
  const salvarVersao = async () => {
    setSalvando(true);
    try {
      await chamarMesaVideos({
        acao: "versao_registrar",
        client_id: clientId,
        titulo: projeto.titulo,
        roteiro_id: roteiro ? roteiro.id : null,
        nota: "Projeto de edição salvo da Mesa Edição.",
        estado: "rascunho",
        projeto,
      });
      void queryClient.invalidateQueries({ queryKey: chaveDasVersoes(clientId) });
      toast.success("Versão salva", { description: "O projeto ficou guardado na versão. Comente e aprove em Versões." });
      setParte("versoes");
    } catch (err) {
      toast.error("Não foi possível salvar", { description: textoDoErro(err), duration: 9000 });
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="min-w-0 space-y-6 pb-6">
      <Secao
        titulo="Editor"
        descricao={`${pacote.resumo.takes} ${pacote.resumo.takes === 1 ? "take" : "takes"}${pacote.resumo.duracao_melhores_s ? ` · ${duracaoCurta(pacote.resumo.duracao_melhores_s)}` : ""}`}
        ajuda="A montagem do projeto de edição: os melhores takes na ordem das cenas. Editar abre o editor completo (linha do tempo, cortes, legendas, skills, troca de câmera, referências e agente), que salva sozinho numa versão rascunho."
      >
        {arquivosQ.isLoading ? (
          <div className="h-48 animate-pulse rounded-md bg-muted" aria-busy="true" aria-label="Lendo os vídeos" />
        ) : !arquivos.length ? (
          <EstadoVazio
            compacto
            titulo="Nenhum vídeo na Entrada."
            acao={
              <button type="button" className={botao.secundario} onClick={() => irPara("entrada")}>
                Entrada
              </button>
            }
          />
        ) : (
          <AreaDoEditor
            projeto={projeto}
            roteiroId={roteiro ? roteiro.id : null}
            cenas={roteiro ? roteiro.cenas.slice().sort((a, b) => a.ordem - b.ordem).map((c) => ({ ref: c.ref, titulo: c.titulo })) : null}
          />
        )}
      </Secao>

      <div className="border-t border-border pt-5">
        <SeletorCompacto
          rotulo="Parte do editar"
          valor={parte}
          onEscolher={(v) => setParte(v as ParteDoEditar)}
          opcoes={[
            { valor: "pacote", rotulo: "Pacote", icone: <Package className="h-3.5 w-3.5" /> },
            { valor: "versoes", rotulo: "Versões", icone: <History className="h-3.5 w-3.5" /> },
          ]}
        />
      </div>

      {parte === "pacote" && (
        <Secao
          titulo="Pacote para editar"
          descricao={`${pacote.pendencias.length} ${pacote.pendencias.length === 1 ? "pendência" : "pendências"}`}
          ajuda="Roteiro, takes na ordem de montar, legendas, direção de edição dinâmica, o projeto de edição e o edl.json dos projetos Remotion, num ZIP para o editor ou para o pipeline Remotion local."
          acao={
            <>
              <button type="button" className={botao.secundario} onClick={() => void salvarVersao()} disabled={salvando || !pacote.resumo.takes} aria-label="Salvar como versão">
                {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-1.5" /> : <Save className="h-3.5 w-3.5 sm:mr-1.5" />}
                <span className="hidden sm:inline">Salvar versão</span>
              </button>
              <button type="button" className={botao.primario} onClick={() => void baixar()} disabled={baixando || !pacote.resumo.takes} aria-label="Baixar pacote">
                {baixando ? <Loader2 className="h-3.5 w-3.5 animate-spin sm:mr-1.5" /> : <Download className="h-3.5 w-3.5 sm:mr-1.5" />}
                <span className="hidden sm:inline">Baixar pacote</span>
              </button>
            </>
          }
        >
          <GrupoDeCampos colunas={3}>
            <CampoDeFormulario rotulo="Nome do vídeo" largo>
              <input className={campo} value={e.titulo} maxLength={120} onChange={(x) => mudar({ titulo: x.target.value })} placeholder={roteiro ? roteiro.titulo : "Ex.: Reel do lançamento"} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Roteiro aprovado">
              <select className={campo} value={e.roteiroId} onChange={(x) => mudar({ roteiroId: x.target.value })} disabled={!roteiros.length}>
                <option value="">{roteiros.length ? "Sem roteiro" : "Nenhum roteiro publicado"}</option>
                {roteiros.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.titulo}
                  </option>
                ))}
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="História do Canvas">
              <select className={campo} value={e.canvasId} onChange={(x) => mudar({ canvasId: x.target.value })} disabled={!historias.length}>
                <option value="">{historias.length ? "Sem história" : "Nenhuma história"}</option>
                {historias.map((h) => (
                  <option key={h.canvas_id} value={h.canvas_id}>
                    {h.nome}
                  </option>
                ))}
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Takes">
              <select className={campo} value={e.quais} onChange={(x) => mudar({ quais: x.target.value === "todos" ? "todos" : "melhores" })}>
                <option value="melhores">Só os melhores (se houver)</option>
                <option value="todos">Todos</option>
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Para quem">
              <select className={campo} value={e.destino} onChange={(x) => mudar({ destino: x.target.value === "remotion" ? "remotion" : "editor" })}>
                <option value="editor">Editor humano</option>
                <option value="remotion">Pipeline Remotion local</option>
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Formato">
              <select className={campo} value={e.formato} onChange={(x) => mudar({ formato: x.target.value })}>
                {["9:16", "4:5", "1:1", "16:9"].map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="FPS">
              <select className={campo} value={e.fps} onChange={(x) => mudar({ fps: x.target.value })}>
                <option value="">Conferir no arquivo</option>
                {["24", "25", "30", "60"].map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario
              rotulo="Direção desta peça"
              largo
              ajuda={`Edição dinâmica pelo método de ${FONTE_BRABO.autor}: ${MODOS_DE_COMPOSICAO.map((m) => m.rotulo.toLowerCase()).join(", ")}; a ilustração executa o verbo, a legenda segue a fala e o áudio é o relógio. A nota daqui vale sobre o método.`}
            >
              <textarea className={juntar(campoTexto, "min-h-[72px]")} value={e.direcao} maxLength={2000} onChange={(x) => mudar({ direcao: x.target.value })} placeholder="Ex.: ritmo calmo, legenda discreta, sem trilha" />
            </CampoDeFormulario>
          </GrupoDeCampos>
          <div className={juntar(superficie.poco, "mt-4 px-3 py-2.5")} data-previa-do-pacote="">
            <p className="text-[12.5px] font-medium">
              {pacote.resumo.takes} {pacote.resumo.takes === 1 ? "take" : "takes"}
              {pacote.resumo.melhores ? `, ${pacote.resumo.melhores} ${pacote.resumo.melhores === 1 ? "melhor" : "melhores"}` : ""}
              {pacote.resumo.duracao_melhores_s ? ` (${duracaoCurta(pacote.resumo.duracao_melhores_s)})` : ""}
            </p>
            <ul className={juntar(texto.auxiliar, "mt-1 space-y-0.5 leading-5")}>
              {pacote.pendencias.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
          <ComputadorDoAgente />
        </Secao>
      )}
      {parte === "versoes" && <Versoes />}
    </div>
  );
}
