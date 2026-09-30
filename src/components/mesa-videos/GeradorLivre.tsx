import { useQueryClient } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { toast } from "sonner";
import { useMesa } from "@/components/mesa/MesaContexto";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { CampoDeFormulario, GrupoDeCampos } from "@/components/sistema/Formulario";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import { custoNaTela, novoUid, useMotoresDaMesa } from "@/lib/mesa-videos/api";
import { duracaoNoMotor, duracoesDoMotor, motorDoNivel, motorPorId, type NivelDoMotor, resolucaoNoMotor } from "../../../supabase/functions/mesa-videos/modulos/modelos-de-video";
import { BotaoDeGerar, EscolherImagem, SeletorDeCamera, SeletorDeMotor } from "./PecasDoGerador";
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
}

const INICIAL: Rascunho = { nivel: "normal", motor: "", prompt: "", negativo: "", duracao: 5, formato: "9:16", resolucao: "", audio: false, variacoes: 1, inicial: null, final: null, referencias: [], camera: "" };

export default function GeradorLivre() {
  const { clientId, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const motores = useMotoresDaMesa();
  const [r, setR] = useEstadoDaTela<Rascunho>(`mesa-videos:livre:${clientId}`, INICIAL, { validar: (v) => !!v && typeof v === "object", esperaMs: 300 });
  const mudar = (m: Partial<Rascunho>) => setR((x) => ({ ...x, ...m }));
  const modo = r.inicial && r.final ? "primeiro_ultimo" : r.inicial ? "primeiro_quadro" : r.referencias.length ? "referencia" : "texto";
  const requisito = { modo, formato: r.formato, referencias: r.referencias.length || undefined } as const;
  const motor = motorPorId(r.motor, motores.motores) || motorDoNivel(r.nivel, requisito, motores.motores);
  const duracoes = motor ? duracoesDoMotor(motor) : [5];
  const duracao = motor ? duracaoNoMotor(motor, r.duracao) : r.duracao;
  const resolucao = motor ? resolucaoNoMotor(motor, r.resolucao) : "";
  const custo = custoNaTela(motor, { duracao_s: duracao, resolucao, audio: r.audio, variacoes: r.variacoes, referencias: r.referencias.length });
  const estado = motor ? motores.lista.find((x) => x.motor.id === motor.id) : null;
  const motivo = !motor
    ? "Nenhum motor faz isso neste nível."
    : estado && estado.estado !== "pronto"
      ? `${motor.rotulo}: ${estado.estado_rotulo.toLowerCase()}${estado.chave ? ` (${estado.chave})` : ""}.`
      : !r.prompt.trim()
        ? "Escreva o que acontece."
        : null;

  const gerar = async (usd: number) => {
    if (!motor) return;
    const resp = await chamarMesaVideos<{ pedido_id: string }>({
      acao: "gerar_video",
      tipo: "gerar_livre",
      client_id: clientId,
      motor: motor.id,
      modo,
      prompt: r.prompt,
      negativo: r.negativo,
      duracao_s: duracao,
      formato: r.formato,
      resolucao,
      audio: r.audio,
      variacoes: r.variacoes,
      quadro_inicial_path: r.inicial,
      quadro_final_path: r.final,
      referencias_paths: r.referencias,
      camera: motor.cap.camera && r.camera ? r.camera : null,
      uid: novoUid(),
      custo_confirmado_usd: usd,
    });
    void queryClient.invalidateQueries({ queryKey: chaveDosPedidos(clientId) });
    atualizarCusto();
    toast.success("Vídeo enviado para gerar", { description: `Pedido ${String(resp.pedido_id || "").slice(0, 8)}. Acompanhe nos Resultados.` });
  };

  return (
    <div className="min-w-0 space-y-5" data-gerador-livre="">
      <SeletorDeMotor lista={motores.lista} requisito={requisito} valor={motor ? motor.id : ""} nivel={r.nivel} onNivel={(n) => mudar({ nivel: n, motor: "" })} onEscolher={(id) => mudar({ motor: id })} />
      <GrupoDeCampos colunas={3}>
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
      <BotaoDeGerar custo={custo} motivo={motivo} onConfirmar={gerar} icone={<Plus className="mr-1.5 h-3.5 w-3.5" />} extra={`${motor ? motor.rotulo : ""}, ${duracao} s, ${r.variacoes} ${r.variacoes === 1 ? "variação" : "variações"}`} />
    </div>
  );
}
