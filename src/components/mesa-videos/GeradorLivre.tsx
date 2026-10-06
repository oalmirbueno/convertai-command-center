import type { DirecaoDeVideoDaPauta } from "../../../supabase/functions/_shared/video-da-pauta";
import { AcoesDaBancada } from "@/components/mesa/BancadaDaPauta";
import { useEffect, useRef, lazy, Suspense, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useFotos } from "@/components/mesa-foto/fotoApi";
import { subirQuadro } from "@/lib/mesa-videos/quadros";
const DiretorDeFotos = lazy(() => import("@/components/mesa-foto/AgenteDiretor"));
const SeletorDeFotos = lazy(() => import("@/components/mesa-foto/SeletorDeFotos"));
import { useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { CampoDeFormulario, GrupoDeCampos } from "@/components/sistema/Formulario";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import { custoNaTela, novoUid, useMotoresDaMesa } from "@/lib/mesa-videos/api";
import { atende, duracaoNoMotor, duracoesDoMotor, motorDoNivel, motorPorId, type NivelDoMotor, resolucaoNoMotor } from "../../../supabase/functions/mesa-videos/modulos/modelos-de-video";
import { BotaoDeGerar, EscolherImagem, SeletorDeCamera, SeletorDeMotor } from "./PecasDoGerador";
import DiretorDoPrompt from "./DiretorDoPrompt";
import { chamarMesaVideos, chaveDosPedidos } from "./videosApi";

/**
 * Modo livre (tipo Kling, frente V-A): qualquer motor do catálogo, quadro
 * inicial e final, referências de personagem ou produto e 1 a 4 variações,
 * com o custo antes. A tela só mostra o que o motor escolhido faz (último
 * quadro, referências, áudio, resoluções e durações dele).
 * Frente V-C (26/09): Runway e Higgsfield entram na mesma lista (escolha
 * manual); com a Higgsfield aparece a câmera pronta (33 movimentos).
 */

interface Rascunho {
  nivel: NivelDoMotor;
  motor: string;
  prompt: string;
  negativo: string;
  duracao: number;
  formato: string;
  resolucao: string;
  audio: boolean;
  variacoes: number;
  inicial: string | null;
  final: string | null;
  referencias: string[];
  /** Movimento pronto de câmera (Higgsfield). */
  camera?: string;
  narracao?: string;
}

const INICIAL: Rascunho = { nivel: "normal", motor: "", prompt: "", negativo: "", duracao: 5, formato: "9:16", resolucao: "", audio: false, variacoes: 1, inicial: null, final: null, referencias: [], camera: "" };

export default function GeradorLivre({ escopo, pauta, direcaoInicial, promptInicial = "", aoGerar }: { escopo?: string; pauta?: { id: string; title: string }; direcaoInicial?: DirecaoDeVideoDaPauta; promptInicial?: string; aoGerar?: (id: string) => void } = {}) {
  const { clientId, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const motores = useMotoresDaMesa();
  const fotosQ = useFotos(clientId);
  const [buscandoFoto, setBuscandoFoto] = useState<"inicial" | "final" | "referencia" | null>(null);
  const [copiando, setCopiando] = useState(false);
  const [diretorAberto, setDiretorAberto] = useState(false);
  const [destinoDoDiretor, setDestinoDoDiretor] = useState<"inicial" | "final" | "referencia">("inicial");
  const [r, setR] = useEstadoDaTela<Rascunho>(escopo || `mesa-videos:livre:${clientId}`, { ...INICIAL, prompt: promptInicial, ...(direcaoInicial ? { narracao: direcaoInicial.narracao, audio: !!direcaoInicial.narracao, formato: direcaoInicial.formato } : {}) }, { validar: (v) => !!v && typeof v === "object", esperaMs: 300 });
  const mudar = (m: Partial<Rascunho>) => setR((x) => ({ ...x, ...m }));
  const fotosDaDirecao = (direcaoInicial?.referencias || []).map((id) => fotosQ.data?.find((f) => f.client_id === clientId && f.ativa && !f.referencia_web && (f.id === id || f.workspace_node_id === id || f.storage_path === id))).filter((f) => f && (f.storage_bucket || "mesa") === "mesa" && f.storage_path.startsWith(`${clientId}/`));
  const preCarregou = useRef(false);
  useEffect(() => {
    if (!fotosQ.data || preCarregou.current) return;
    if (r.inicial || r.final || r.referencias.length) { preCarregou.current = true; return; }
    if (fotosDaDirecao[0]) {
      preCarregou.current = true;
      mudar({ inicial: fotosDaDirecao[0].storage_path, ...(fotosDaDirecao[1] ? { final: fotosDaDirecao[1].storage_path } : {}) });
    }
  }, [fotosQ.data, direcaoInicial, r.inicial, r.final, r.referencias.length]);
  const modo = r.inicial && r.final ? "primeiro_ultimo" : r.inicial ? "primeiro_quadro" : r.referencias.length ? "referencia" : "texto";
  const requisito = { modo, formato: r.formato, referencias: r.referencias.length || undefined } as const;
  const motor = motorPorId(r.motor, motores.motores) || motorDoNivel(r.nivel, requisito, motores.motores);
  const duracoes = motor ? duracoesDoMotor(motor) : [5];
  const duracao = motor ? duracaoNoMotor(motor, r.duracao) : r.duracao;
  const resolucao = motor ? resolucaoNoMotor(motor, r.resolucao) : "";
  const custo = custoNaTela(motor, { duracao_s: duracao, resolucao, audio: !!(motor?.cap.audio && r.audio), variacoes: r.variacoes, referencias: r.referencias.length });
  const estado = motor ? motores.lista.find((x) => x.motor.id === motor.id) : null;
  const motivo = copiando ? "Aguarde o carregamento da foto." : r.final && !r.inicial ? "Escolha a foto inicial para usar a foto final." : !motor
    ? "Nenhum motor faz isso neste nível."
    : !atende(motor, requisito) ? "Escolha um motor compatível com estas fotos e formato." : estado && estado.estado !== "pronto"
      ? `${motor.rotulo}: ${estado.estado_rotulo.toLowerCase()}${estado.chave ? ` (${estado.chave})` : ""}.`
      : !r.prompt.trim()
        ? "Escreva o que acontece."
        : null;

  const usarFotos = async (ids: string[], destino: "inicial" | "final" | "referencia") => {
        const foto = fotosQ.data?.find((f) => f.id === ids[0]);
        if (!foto || foto.client_id !== clientId || copiando) throw new Error("A foto não está disponível para este cliente.");
        setCopiando(true);
        try {
          let path = foto.storage_path;
          if ((foto.storage_bucket || "mesa") !== "mesa" || !path.startsWith(`${clientId}/`)) {
            const { data, error } = await supabase.storage.from(foto.storage_bucket || "mesa").download(path);
            if (error || !data) throw new Error("A foto do Workspace não pôde ser carregada.");
            if (data.size > 20 * 1024 * 1024) throw new Error("Use uma foto de até 20 MB.");
            path = await subirQuadro(clientId, data, foto.nome);
          }
          if (destino === "referencia") mudar({ referencias: Array.from(new Set([...r.referencias, path])) });
          else if (destino === "inicial") mudar({ inicial: path });
          else if (destino === "final") mudar({ final: path });
          setBuscandoFoto(null);
          toast.success(`${foto.nome} carregada no vídeo.`);
        } finally { setCopiando(false); }

  };

  const gerar = async (usd: number) => {
    if (!motor) return;
    const resp = await chamarMesaVideos<{ pedido_id: string }>({
      acao: "gerar_video",
      tipo: "gerar_livre",
      client_id: clientId,
      motor: motor.id,
      modo,
      prompt: motor.cap.audio && r.audio && r.narracao?.trim() ? `${r.prompt}\nNarração em português brasileiro, voz natural e clara, sem alterar o texto: ${r.narracao.trim()}` : r.prompt,
      task_id: pauta?.id,
      titulo: pauta?.title,
      negativo: r.negativo,
      duracao_s: duracao,
      formato: r.formato,
      resolucao,
      audio: !!(motor?.cap.audio && r.audio),
      variacoes: r.variacoes,
      quadro_inicial_path: r.inicial,
      quadro_final_path: r.final,
      referencias_paths: r.referencias,
      camera: motor.cap.camera && r.camera ? r.camera : null,
      uid: novoUid(),
      custo_confirmado_usd: usd,
    });
    if (!resp.pedido_id) throw new Error("O servidor não confirmou o pedido de geração.");
    aoGerar?.(resp.pedido_id);
    void queryClient.invalidateQueries({ queryKey: chaveDosPedidos(clientId) });
    atualizarCusto();
    toast.success("Vídeo enviado para gerar", { description: `Pedido ${String(resp.pedido_id || "").slice(0, 8)}. Acompanhe nos Resultados.` });
  };

  return (
    <div className="min-w-0 space-y-5" data-gerador-livre="">
      {pauta && <div className="space-y-2"><p className="text-[12px] font-medium">Fotos reais do Workspace</p><div className="flex flex-wrap gap-2">{([['inicial','Foto inicial'],['final','Foto final'],['referencia','Referência']] as const).map(([id,nome]) => <button type="button" className="rounded-md border px-2 py-1 text-[12px]" key={id} disabled={copiando} onClick={() => setBuscandoFoto(id)}>{nome}</button>)}</div></div>}
      {buscandoFoto && <Suspense fallback={<p role="status">Lendo as pastas…</p>}><SeletorDeFotos fotos={(fotosQ.data || []).filter((f) => !f.referencia_web)} titulo="Fotos reais do Workspace" multiplas={false} onFechar={() => setBuscandoFoto(null)} onUsar={(ids) => { void usarFotos(ids, buscandoFoto).catch((e) => toast.error(e instanceof Error ? e.message : "Não foi possível usar a foto.")); }} /></Suspense>}
      {pauta && <div className="rounded-lg border p-3"><button type="button" className="text-[12px] text-primary" aria-expanded={diretorAberto} onClick={() => setDiretorAberto(!diretorAberto)}>Pedir ao diretor para buscar fotos numa pasta</button>{diretorAberto && <><label className="my-2 block text-[12px]">Usar a foto encontrada como<select className={campo} value={destinoDoDiretor} onChange={(e) => setDestinoDoDiretor(e.target.value as typeof destinoDoDiretor)}><option value="inicial">Quadro inicial</option><option value="final">Quadro final</option><option value="referencia">Referência</option></select></label><p className="text-[12px] text-muted-foreground">Diga a pasta. Confira a primeira foto encontrada no campo escolhido antes de gerar.</p><Suspense fallback={<p role="status">Abrindo diretor…</p>}><DiretorDeFotos escopo={`${pauta.id}:video:${escopo || "livre"}`} pautaId={pauta.id} aoSelecionarFotos={(ids) => usarFotos(ids, destinoDoDiretor)} /></Suspense></>}</div>}
      {copiando && <p role="status">Preparando a foto real para o vídeo…</p>}
      <SeletorDeMotor lista={motores.lista} requisito={requisito} valor={motor ? motor.id : ""} nivel={r.nivel} onNivel={(n) => mudar({ nivel: n, motor: "" })} onEscolher={(id) => mudar({ motor: id })} />
      <GrupoDeCampos colunas={pauta ? 1 : 3}>
        <EscolherImagem rotulo="Quadro inicial" opcional valor={r.inicial} onEscolher={(c) => mudar({ inicial: c })} />
        {(!motor || motor.cap.ultimo_quadro) && <EscolherImagem rotulo="Último quadro" opcional valor={r.final} onEscolher={(c) => mudar({ final: c })} />}
        {motor && motor.cap.referencias > 0 && (
          <div className="min-w-0">
            <p className={juntar(texto.rotulo, "mb-1.5")}>
              Referências ({r.referencias.length} de {motor.cap.referencias})
            </p>
            <ul className="space-y-1">
              {r.referencias.map((c) => (
                <li key={c} className="flex min-w-0 items-center">
                  <span className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate")}>{c.split("/").pop()}</span>
                  <button type="button" className={botao.icone} onClick={() => mudar({ referencias: r.referencias.filter((x) => x !== c) })} aria-label="Tirar referência">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </li>
              ))}
            </ul>
            {r.referencias.length < motor.cap.referencias && (
              <EscolherImagem rotulo="Mais uma referência" opcional valor={null} onEscolher={(c) => c && r.referencias.indexOf(c) < 0 && mudar({ referencias: r.referencias.concat([c]) })} />
            )}
          </div>
        )}
      </GrupoDeCampos>
      {/* Frente VGN: o diretor escreve o prompt no jeito do motor, com a marca (prévia, Aplicar e Desfazer). */}
      <div className="flex min-w-0 justify-end">
        <DiretorDoPrompt
          motor={motor}
          modo={modo}
          formato={r.formato}
          duracao={duracao}
          audio={!!(motor && motor.cap.audio && r.audio)}
          referencias={r.referencias.length}
          temInicial={!!r.inicial}
          temFinal={!!r.final}
          texto={r.prompt}
          atual={{ prompt: r.prompt, negativo: r.negativo }}
          onAplicar={(p) => mudar({ prompt: p.prompt, negativo: p.negativo })}
        />
      </div>
      <CampoDeFormulario rotulo="O que acontece" largo apoio={modo === "referencia" ? "Cite as referências como @Image1, @Image2 quando o motor pedir." : undefined}>
        <textarea className={juntar(campoTexto, "min-h-[96px]")} value={r.prompt} maxLength={2400} onChange={(e) => mudar({ prompt: e.target.value })} placeholder="Ex.: a mulher da foto abre a porta da cozinha nova e sorri, câmera lenta de frente" />
      </CampoDeFormulario>
      <GrupoDeCampos>
        <CampoDeFormulario rotulo="Duração">
          <select className={campo} value={duracao} onChange={(e) => mudar({ duracao: Number(e.target.value) })}>
            {duracoes.map((d) => (
              <option key={d} value={d}>
                {d} s
              </option>
            ))}
          </select>
        </CampoDeFormulario>
        <CampoDeFormulario rotulo="Resolução">
          <select className={campo} value={resolucao} onChange={(e) => mudar({ resolucao: e.target.value })}>
            {(motor ? motor.resolucoes : []).map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </CampoDeFormulario>
        <div className="min-w-0">
          <p className={juntar(texto.rotulo, "mb-1.5")}>Formato</p>
          <SeletorCompacto rotulo="Formato" larguraTotal opcoes={(motor ? motor.formatos : ["9:16", "16:9"]).map((f) => ({ valor: f, rotulo: f }))} valor={r.formato} onEscolher={(v) => mudar({ formato: v })} />
        </div>
        <div className="min-w-0">
          <p className={juntar(texto.rotulo, "mb-1.5")}>Variações</p>
          <SeletorCompacto rotulo="Variações" larguraTotal opcoes={[1, 2, 3, 4].map((n) => ({ valor: String(n), rotulo: String(n) }))} valor={String(r.variacoes)} onEscolher={(v) => mudar({ variacoes: Number(v) })} />
        </div>
        {motor && motor.cap.audio && (
          <label className="flex min-w-0 items-center self-end pb-2 text-[13px]">
            <input type="checkbox" className="mr-2 h-4 w-4 accent-primary" checked={r.audio} onChange={(e) => mudar({ audio: e.target.checked })} />
            Áudio do motor
          </label>
        )}
        {motor && motor.cap.camera && <SeletorDeCamera valor={r.camera || ""} onEscolher={(v) => mudar({ camera: v })} />}
        <CampoDeFormulario rotulo="Evitar">
          <input className={campo} value={r.negativo} maxLength={600} onChange={(e) => mudar({ negativo: e.target.value })} placeholder="Opcional" />
        </CampoDeFormulario>
      </GrupoDeCampos>
      {motor?.cap.audio && r.audio && <CampoDeFormulario rotulo="Narração (opcional)"><textarea aria-label="Texto da narração" className={campoTexto} rows={2} maxLength={600} value={r.narracao || ""} onChange={(e) => mudar({ narracao: e.target.value })} placeholder="Texto curto para o motor narrar neste vídeo" /><p className="text-[12px] text-muted-foreground">Confira a fala no resultado antes de enviar.</p></CampoDeFormulario>}
      <AcoesDaBancada><BotaoDeGerar custo={custo} motivo={motivo} onConfirmar={gerar} icone={<Plus className="mr-1.5 h-3.5 w-3.5" />} extra={`${motor ? motor.rotulo : ""}, ${duracao} s, ${r.variacoes} ${r.variacoes === 1 ? "variação" : "variações"}`} /></AcoesDaBancada>
    </div>
  );
}
