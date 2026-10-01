import { useState } from "react";
import { Check, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import ModeloDoAgente from "@/components/agentes/ModeloDoAgente";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import { modeloDoPapel, textoDoErro, usd } from "@/lib/mesa/api";
import type { MotorDeVideo } from "../../../supabase/functions/mesa-videos/modulos/modelos-de-video";
import { chamarMesaVideos } from "./videosApi";

/**
 * O diretor escreve o prompt do motor (frente VGN, 30/09/2026). A pessoa diz
 * em português o que quer; o diretor devolve o prompt no jeito do motor
 * escolhido, com a marca e o contexto completo do cliente. Prévia antes de
 * tudo: nada muda até "Aplicar", e o aviso traz o Desfazer (volta o prompt que
 * estava). Modelo trocável na hora, com o custo de uma escrita à vista.
 */

export interface PromptAplicado {
  prompt: string;
  negativo: string;
}

interface Resposta extends PromptAplicado {
  fala_pt: string | null;
  notas: string[];
  avisos: string[];
  custo_usd: number;
  modelo_id: string;
}

/** Uma escrita: o contexto da marca entra (até ~6 mil tokens) e sai um prompt curto. */
const PARTES = (modeloId: string) => [{ modeloId, tipo: "texto" as const, tokensEntrada: 7000, tokensSaida: 900 }];

export default function DiretorDoPrompt({
  motor,
  modo,
  formato,
  duracao,
  audio,
  referencias = 0,
  temInicial = false,
  temFinal = false,
  texto: textoInicial,
  cena,
  atual,
  onAplicar,
}: {
  motor: MotorDeVideo | null;
  modo: string;
  formato: string;
  duracao: number;
  audio: boolean;
  referencias?: number;
  temInicial?: boolean;
  temFinal?: boolean;
  /** O que já está escrito (vira o pedido em português). */
  texto: string;
  cena?: string | null;
  /** O que está no campo agora (o Desfazer volta para isto). */
  atual: PromptAplicado;
  onAplicar: (p: PromptAplicado) => void;
}) {
  const { clientId, catalogo, catalogoCarregando, atualizarCusto } = useMesa();
  const { marca } = useMarcaDaMesa();
  const [aberta, setAberta] = useState(false);
  const [pedido, setPedido] = useState("");
  const [escrevendo, setEscrevendo] = useState(false);
  const [resposta, setResposta] = useState<Resposta | null>(null);
  const [modeloEscolhido, setModeloEscolhido] = useEstadoDaTela<string>("mesa-videos:diretor-do-prompt:modelo", "", { validar: (v) => typeof v === "string" });
  const modelo = modeloDoPapel(catalogo, "motion", modeloEscolhido || null);

  const abrir = () => {
    setPedido(textoInicial || "");
    setResposta(null);
    setAberta(true);
  };

  const escrever = async () => {
    if (!motor || !pedido.trim()) return;
    setEscrevendo(true);
    try {
      const r = await chamarMesaVideos<Resposta>({
        acao: "diretor_prompt",
        client_id: clientId,
        marca_id: marca ? marca.id : null,
        modelo_id: modelo ? modelo.id : null,
        motor: motor.id,
        modo,
        formato,
        duracao_s: duracao,
        audio,
        referencias,
        tem_quadro_inicial: temInicial,
        tem_quadro_final: temFinal,
        texto: pedido,
        cena: cena || null,
      });
      setResposta(r);
      atualizarCusto();
    } catch (e) {
      toast.error("O diretor não escreveu", { description: textoDoErro(e), duration: 9000 });
    } finally {
      setEscrevendo(false);
    }
  };

  const aplicar = () => {
    if (!resposta) return;
    const antes = { ...atual };
    onAplicar({ prompt: resposta.prompt, negativo: resposta.negativo });
    setAberta(false);
    toast.success("Prompt do diretor aplicado", {
      description: resposta.avisos[0] || "Confira antes de gerar.",
      action: { label: "Desfazer", onClick: () => onAplicar(antes) },
      duration: 12000,
    });
  };

  return (
    <>
      <button type="button" className={juntar(botao.discreto, "h-8 px-2 text-[12px]")} onClick={abrir} disabled={!motor} title={motor ? `O diretor escreve o prompt no jeito do ${motor.rotulo}, com a marca` : "Escolha o motor antes"} data-diretor-do-prompt="">
        <Sparkles className="mr-1.5 h-3.5 w-3.5" />
        Diretor escreve o prompt
      </button>
      <JanelaCentral
        aberta={aberta}
        onMudar={setAberta}
        titulo="Diretor escreve o prompt"
        icone={<Sparkles className="h-4 w-4" />}
        descricao={motor ? `${motor.rotulo} · ${formato} · ${duracao} s` : undefined}
        ajuda="Diga em português o que acontece. O diretor lê a marca aberta (kit, estratégia, briefing, decisões e dossiê) e escreve o prompt no jeito do motor escolhido: enquadramento, ação, câmera, luz, som e o que evitar. Nada muda até Aplicar, e o aviso traz o Desfazer. A escrita custa pouco e sai da carteira do cliente; o vídeo só é cobrado quando você gerar."
        largura="lg"
        rodape={
          <div className="flex min-w-0 items-center">
            <div className="mr-2 min-w-0 flex-1">
              <ModeloDoAgente catalogo={catalogo} modelo={modelo} escolhido={modeloEscolhido} onEscolher={setModeloEscolhido} partes={PARTES} carregando={catalogoCarregando} disabled={escrevendo} />
            </div>
            {resposta ? (
              <>
                <button type="button" className={juntar(botao.discreto, "mr-1")} onClick={() => void escrever()} disabled={escrevendo || !pedido.trim()}>
                  {escrevendo ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                  Escrever de novo
                </button>
                <button type="button" className={botao.primario} onClick={aplicar} disabled={escrevendo} data-aplicar-prompt="">
                  <Check className="mr-1.5 h-3.5 w-3.5" />
                  Aplicar
                </button>
              </>
            ) : (
              <button type="button" className={botao.primario} onClick={() => void escrever()} disabled={escrevendo || !pedido.trim() || !motor} data-escrever-prompt="">
                {escrevendo ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                Escrever
              </button>
            )}
          </div>
        }
      >
        <div className="space-y-4">
          <CampoDeFormulario rotulo="O que acontece (em português)" largo>
            <textarea className={juntar(campoTexto, "min-h-[88px]")} value={pedido} maxLength={1500} onChange={(e) => setPedido(e.target.value)} placeholder="Ex.: a dona da loja arruma a vitrine de manhã, luz de janela, clima acolhedor" />
          </CampoDeFormulario>
          {resposta && (
            <div className="space-y-3" data-previa-do-prompt="">
              <CampoDeFormulario rotulo="Prompt do motor (prévia)" largo>
                <textarea className={juntar(campoTexto, "min-h-[120px]")} value={resposta.prompt} maxLength={2400} onChange={(e) => setResposta({ ...resposta, prompt: e.target.value })} />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Evitar" largo>
                <textarea className={juntar(campoTexto, "min-h-[48px]")} value={resposta.negativo} maxLength={600} onChange={(e) => setResposta({ ...resposta, negativo: e.target.value })} />
              </CampoDeFormulario>
              {resposta.fala_pt && <p className={texto.corpo}>Fala: “{resposta.fala_pt}”</p>}
              {resposta.notas.length > 0 && (
                <ul className={juntar(texto.auxiliar, "list-disc space-y-0.5 pl-5")}>
                  {resposta.notas.map((n, i) => (
                    <li key={i}>{n}</li>
                  ))}
                </ul>
              )}
              {resposta.avisos.map((a, i) => (
                <p key={i} className={juntar(texto.auxiliar, "text-amber-700 dark:text-amber-400")}>
                  {a}
                </p>
              ))}
              <p className={texto.auxiliar}>Esta escrita custou {usd(resposta.custo_usd)}.</p>
            </div>
          )}
        </div>
      </JanelaCentral>
    </>
  );
}
