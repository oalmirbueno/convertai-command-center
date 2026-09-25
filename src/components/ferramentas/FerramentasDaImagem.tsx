import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Loader2, Maximize2, Scissors, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { textoDoErro, usd } from "@/lib/mesa/api";
import {
  ampliarImagem,
  type ChaveDaOpcao,
  ehSemChave,
  type EstadoDoAndamento,
  estimarFerramentas,
  type EstimativaDasFerramentas,
  type OpcaoDaFerramenta,
  type ResultadoDaFerramenta,
  textoDoAndamento,
  tirarFundoPro,
} from "./ferramentasApi";

/**
 * Botões das ferramentas profissionais de imagem (26/09), para ligar no
 * Estúdio e na Mesa Foto: "Ampliar 2x (fiel)", "Ampliar 4x (fiel)",
 * opcionalmente "Ampliar 2x (criativo)", e "Tirar fundo (pro)". Cada botão
 * mostra o custo antes (ferramentas_estimar, sem custo), pede segundo clique
 * quando passa de US$ 0,25, mostra o andamento com o tempo corrido e, no fim,
 * entrega a derivada do acervo em `aoConcluir`.
 *
 * Sem a chave no servidor (FAL_KEY), mostra o aviso e deixa os botões
 * desligados.
 */

export interface FerramentasDaImagemProps {
  clientId: string;
  /** Foto do acervo (cliente_imagens). */
  imagemId: string;
  /** Mostra também "Ampliar 2x (criativo)". */
  mostrarCriativo?: boolean;
  /** Esconde o botão de tirar fundo (ex.: foto que já é recorte). */
  semTirarFundo?: boolean;
  /** Chamado com a derivada pronta (nova ou a que já existia). */
  aoConcluir?: (resultado: ResultadoDaFerramenta, opcao: ChaveDaOpcao) => void;
  className?: string;
}

/** Acima disto, o botão pede um segundo clique para confirmar. */
export const LIMITE_SEM_CONFIRMAR_FERRAMENTA_USD = 0.25;

const ROTULOS: Record<ChaveDaOpcao, string> = {
  upscale_2x_fiel: "Ampliar 2x (fiel)",
  upscale_4x_fiel: "Ampliar 4x (fiel)",
  upscale_2x_criativo: "Ampliar 2x (criativo)",
  upscale_4x_criativo: "Ampliar 4x (criativo)",
  remover_fundo: "Tirar fundo (pro)",
};

export function rotuloDoBotao(o: OpcaoDaFerramenta, armado: boolean): string {
  const base = ROTULOS[o.chave];
  if (o.jaExiste) return `${base}: já feita`;
  if (armado && o.estimativaUsd !== null) return `Confirmar ${usd(o.estimativaUsd)}`;
  return o.estimativaUsd !== null ? `${base} · ${usd(o.estimativaUsd)}` : base;
}

export function FerramentasDaImagem({ clientId, imagemId, mostrarCriativo = false, semTirarFundo = false, aoConcluir, className = "" }: FerramentasDaImagemProps) {
  const [estimativa, setEstimativa] = useState<EstimativaDasFerramentas | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [semChave, setSemChave] = useState<string | null>(null);
  const [erroDaEstimativa, setErroDaEstimativa] = useState<string | null>(null);
  const [rodando, setRodando] = useState<ChaveDaOpcao | null>(null);
  const [armado, setArmado] = useState<ChaveDaOpcao | null>(null);
  const [andamento, setAndamento] = useState<EstadoDoAndamento | null>(null);
  const [segundos, setSegundos] = useState(0);
  const vivo = useRef(true);

  useEffect(() => {
    vivo.current = true;
    return () => {
      vivo.current = false;
    };
  }, []);

  const carregar = () => {
    setCarregando(true);
    setErroDaEstimativa(null);
    estimarFerramentas(clientId, imagemId)
      .then((e) => {
        if (!vivo.current) return;
        setEstimativa(e);
        setSemChave(e.configurada ? null : e.aviso || `Configure ${e.segredo} no Supabase para ligar estas ferramentas.`);
      })
      .catch((e) => {
        if (vivo.current) setErroDaEstimativa(textoDoErro(e, "Não foi possível calcular o custo agora."));
      })
      .then(() => {
        if (vivo.current) setCarregando(false);
      });
  };

  useEffect(() => {
    if (clientId && imagemId) carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, imagemId]);

  // Relógio do andamento (o servidor segura a conexão enquanto o provedor trabalha).
  useEffect(() => {
    if (!rodando) return;
    setSegundos(0);
    const inicio = Date.now();
    const id = window.setInterval(() => setSegundos(Math.round((Date.now() - inicio) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [rodando]);

  const clicar = async (o: OpcaoDaFerramenta) => {
    if (rodando || o.impedimento || semChave) return;
    const caro = o.estimativaUsd === null || o.estimativaUsd > LIMITE_SEM_CONFIRMAR_FERRAMENTA_USD;
    if (caro && !o.jaExiste && armado !== o.chave) {
      setArmado(o.chave);
      window.setTimeout(() => setArmado((a) => (a === o.chave ? null : a)), 6000);
      return;
    }
    setArmado(null);
    setRodando(o.chave);
    setAndamento(null);
    try {
      const r = o.tarefa === "remover_fundo"
        ? await tirarFundoPro({ clientId, imagemId }, setAndamento)
        : await ampliarImagem({ clientId, imagemId, fator: o.fator === 4 ? 4 : 2, modo: o.modo === "criativo" ? "criativo" : "fiel" }, setAndamento);
      toast.success(r.jaExistia ? "Esta versão já estava no acervo" : o.tarefa === "remover_fundo" ? "Fundo removido" : "Imagem ampliada", {
        description: r.jaExistia ? "Sem custo novo." : `Custo ${usd(r.custoUsd)}. A nova versão foi para o acervo.`,
      });
      if (aoConcluir) aoConcluir(r, o.chave);
      if (vivo.current) carregar();
    } catch (e) {
      if (ehSemChave(e)) setSemChave(textoDoErro(e));
      else toast.error(o.tarefa === "remover_fundo" ? "Não foi possível tirar o fundo" : "Não foi possível ampliar", { description: textoDoErro(e) });
    } finally {
      if (vivo.current) {
        setRodando(null);
        setAndamento(null);
      }
    }
  };

  const visiveis = (estimativa ? estimativa.opcoes : []).filter((o) => {
    if (o.chave === "upscale_4x_criativo") return false;
    if (o.chave === "upscale_2x_criativo") return mostrarCriativo;
    if (o.chave === "remover_fundo") return !semTirarFundo;
    return true;
  });

  return (
    <div className={`flex flex-col gap-2 ${className}`} data-ferramentas-da-imagem="">
      {semChave ? (
        <div role="status" className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[12.5px] text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{semChave}</span>
        </div>
      ) : null}
      {erroDaEstimativa ? (
        <div className="flex items-center gap-2 text-[12.5px] text-muted-foreground">
          <span>{erroDaEstimativa}</span>
          <Button variant="link" size="sm" className="h-auto p-0" onClick={carregar}>
            Tentar de novo
          </Button>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {carregando && !estimativa ? (
          <span className="flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Calculando o custo
          </span>
        ) : null}
        {visiveis.map((o) => {
          const Icone = o.tarefa === "remover_fundo" ? Scissors : o.modo === "criativo" ? Sparkles : Maximize2;
          const esteRodando = rodando === o.chave;
          const titulo = o.impedimento
            ? o.impedimento.mensagem
            : [o.saida ? `Resultado: ${o.saida.largura} x ${o.saida.altura} px` : "", o.rotuloDoMotor ? `Motor: ${o.rotuloDoMotor}` : ""].concat(o.avisos).filter(Boolean).join(". ");
          return (
            <Button
              key={o.chave}
              type="button"
              size="sm"
              variant={armado === o.chave ? "default" : "outline"}
              disabled={!!semChave || !!o.impedimento || (rodando !== null && !esteRodando)}
              title={titulo || undefined}
              aria-busy={esteRodando}
              onClick={() => void clicar(o)}
            >
              {esteRodando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Icone className="mr-1 h-3.5 w-3.5" />}
              {esteRodando ? textoDoAndamento(andamento, segundos) : rotuloDoBotao(o, armado === o.chave)}
            </Button>
          );
        })}
      </div>
      {rodando ? (
        <p className="text-[12px] text-muted-foreground">
          {rodando === "remover_fundo" ? "Costuma levar de 5 a 20 s." : "Costuma levar de 10 a 90 s. Deixe esta tela aberta até terminar."}
        </p>
      ) : null}
    </div>
  );
}

export default FerramentasDaImagem;
