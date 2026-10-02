import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Eraser, Loader2, ScanSearch, Sparkles } from "lucide-react";
import { toast } from "sonner";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import ComparadorAntesDepois from "@/components/comparar/ComparadorAntesDepois";
import { botao, campo, juntar, texto } from "@/components/sistema/estilos";
import { useMesa, useUrlDaMesa } from "@/components/mesa/MesaContexto";
import { textoDoErro, usd } from "@/lib/mesa/api";
import { chaveDosArquivos, duracaoCurta, type ArquivoDeVideo } from "@/components/mesa-videos/videosApi";
import {
  acharLegendaNoVideo,
  amostraDoTratamento,
  custoPedido,
  novoUid,
  statusDosTratamentos,
  videoInteiroDoTratamento,
  type MotorNaTela,
  type TratamentoNaTela,
} from "@/lib/edicao/acoesDaEdicao";
import {
  AMOSTRA_PADRAO_S,
  custoDoTratamento,
  fatorDoNivel,
  janelaDaAmostra,
  motorDoTratamento,
  motoresDaAcao,
  type AcaoDoTratamento,
  type NivelDaMelhora,
  type RegiaoDaLegenda,
} from "../../../supabase/functions/mesa-videos/modulos/tratamento-de-video";

/**
 * Tratar um vídeo (Mesa Edição, 02/10): tirar a legenda que já veio gravada
 * ou melhorar a qualidade. Janela central, um passo de cada vez:
 * 1) tirar legenda: acha a faixa da legenda sozinho (quadros no navegador, sem
 *    custo) e a pessoa ajusta; melhorar: escolhe o tamanho;
 * 2) amostra de 5 s com o custo no botão; 3) compara antes e depois;
 * 4) o vídeo inteiro com o custo no botão. O original nunca muda; o vídeo
 *    novo entra na pasta "Antes e depois".
 */

const EM_ANDAMENTO = ["preparando", "gerando", "compondo"];
const CONSULTA_MS = 15_000;
const FAIXA_PADRAO: RegiaoDaLegenda = { x: 0.06, y: 0.76, w: 0.88, h: 0.14 };

const pct = (n: number) => Math.round(n * 100);

function Faixa({ vista, regiao, carregando }: { vista: string | null; regiao: RegiaoDaLegenda; carregando: boolean }) {
  if (carregando) return <div className="h-56 animate-pulse rounded-md bg-muted" aria-busy="true" />;
  if (!vista) return <p className={texto.auxiliar}>Sem quadro para mostrar. Ajuste a faixa pelos números.</p>;
  return (
    <div className="relative mx-auto w-fit max-w-full" data-faixa-da-legenda="">
      <img src={vista} alt="Quadro do vídeo" className="block max-h-[46vh] max-w-full rounded-md" />
      <div
        className="pointer-events-none absolute rounded-sm border-2 border-primary bg-primary/20"
        style={{ left: `${regiao.x * 100}%`, top: `${regiao.y * 100}%`, width: `${regiao.w * 100}%`, height: `${regiao.h * 100}%` }}
        aria-label="Faixa da legenda"
      />
    </div>
  );
}

export default function JanelaDeTratamento({ arquivo, acao, aberta, onFechar }: { arquivo: ArquivoDeVideo; acao: AcaoDoTratamento; aberta: boolean; onFechar: () => void }) {
  const { clientId, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const url = useUrlDaMesa(aberta ? arquivo.storage_path : null, arquivo.storage_bucket);
  const motores = motoresDaAcao(acao);
  const [motorId, setMotorId] = useState(motorDoTratamento(acao).id);
  const [nivel, setNivel] = useState<NivelDaMelhora>("mesmo_tamanho");
  const [regiao, setRegiao] = useState<RegiaoDaLegenda>(FAIXA_PADRAO);
  const [achando, setAchando] = useState(false);
  const [vista, setVista] = useState<string | null>(null);
  const [achou, setAchou] = useState<string | null>(null);
  const [inicio, setInicio] = useState(0);
  const [tratamento, setTratamento] = useState<TratamentoNaTela | null>(null);
  const [estadoDosMotores, setEstadoDosMotores] = useState<MotorNaTela[]>([]);
  const [ocupado, setOcupado] = useState<"amostra" | "final" | null>(null);
  const procurou = useRef(false);

  const medidas = { largura: arquivo.largura, altura: arquivo.altura, fps: 30 };
  const motor = motorDoTratamento(acao, motorId);
  const fator = acao === "melhorar" ? fatorDoNivel(nivel, medidas) : 1;
  const duracao = arquivo.duracao_s || 0;
  const janela = janelaDaAmostra(duracao, inicio, AMOSTRA_PADRAO_S);
  const custoDaAmostra = useMemo(() => custoDoTratamento(motor, janela.inicio_s, janela.fim_s, medidas, fator), [motor, janela.inicio_s, janela.fim_s, medidas.largura, medidas.altura, fator]); // eslint-disable-line react-hooks/exhaustive-deps
  const custoDoInteiro = useMemo(() => custoDoTratamento(motor, 0, duracao, medidas, fator), [motor, duracao, medidas.largura, medidas.altura, fator]); // eslint-disable-line react-hooks/exhaustive-deps
  const semChave = estadoDosMotores.find((m) => m.id === motor.id && !m.pronto) || null;

  // Ao abrir: o último tratamento deste vídeo e desta ação (para voltar ao meio do caminho) e as chaves.
  useEffect(() => {
    if (!aberta) return;
    let vivo = true;
    statusDosTratamentos(clientId, arquivo.id)
      .then((r) => {
        if (!vivo) return;
        setEstadoDosMotores(r.motores || []);
        const ultimo = (r.tratamentos || []).find((t) => t.acao === acao && t.arquivo_id === arquivo.id) || null;
        if (ultimo && ultimo.estado !== "pronto") setTratamento(ultimo);
      })
      .catch(() => undefined);
    return () => {
      vivo = false;
    };
  }, [aberta, clientId, arquivo.id, acao]);

  // Tirar legenda: acha a faixa sozinho uma vez (quadros no navegador, sem custo).
  useEffect(() => {
    if (!aberta || acao !== "tirar_legenda" || !url.data || procurou.current) return;
    procurou.current = true;
    setAchando(true);
    acharLegendaNoVideo(url.data)
      .then((r) => {
        setVista(r.vista);
        if (r.achada) {
          setRegiao(r.achada.regiao);
          setAchou(r.achada.parado ? "Achei um texto parado (pode ser logo). Confira a faixa." : `Achei a legenda (${pct(r.achada.confianca)}% de certeza).`);
        } else setAchou("Não achei legenda gravada. Marque a faixa à mão.");
      })
      .catch(() => setAchou("Não deu para ler os quadros aqui. Marque a faixa à mão."))
      .finally(() => setAchando(false));
  }, [aberta, acao, url.data]);

  // Andamento: consulta a cada 15 s só enquanto anda.
  useEffect(() => {
    if (!aberta || !tratamento || EM_ANDAMENTO.indexOf(tratamento.estado) < 0) return;
    const t = window.setTimeout(() => {
      statusDosTratamentos(clientId, arquivo.id)
        .then((r) => {
          const novo = (r.tratamentos || []).find((x) => x.id === tratamento.id);
          if (!novo) return;
          setTratamento(novo);
          if (novo.estado === "pronto") {
            void queryClient.invalidateQueries({ queryKey: chaveDosArquivos(clientId) });
            atualizarCusto();
            toast.success(`${novo.acao_rotulo}: pronto`, { description: "O vídeo novo está na pasta Antes e depois. O original não mudou." });
          }
          if (novo.estado === "amostra") atualizarCusto();
        })
        .catch(() => undefined);
    }, CONSULTA_MS);
    return () => window.clearTimeout(t);
  }, [aberta, tratamento, clientId, arquivo.id, queryClient, atualizarCusto]);

  const pedirAmostra = async () => {
    setOcupado("amostra");
    const uid = novoUid();
    try {
      const r = await amostraDoTratamento({ clientId, arquivoId: arquivo.id, acao, motor: motor.id, regiao: acao === "tirar_legenda" ? regiao : null, nivel, inicio_s: janela.inicio_s, medidas, uid, custoConfirmadoUsd: custoDaAmostra.usd });
      setTratamento(r.tratamento);
    } catch (e) {
      const outro = custoPedido(e);
      toast.error("A amostra não começou", { description: outro !== null ? `O custo confirmado pelo servidor é ${usd(outro)}. Confira e peça de novo.` : textoDoErro(e), duration: 9000 });
    } finally {
      setOcupado(null);
    }
  };

  const pedirInteiro = async () => {
    if (!tratamento) return;
    setOcupado("final");
    try {
      const r = await videoInteiroDoTratamento(tratamento.id, novoUid(), custoDoInteiro.usd);
      setTratamento(r.tratamento);
    } catch (e) {
      const outro = custoPedido(e);
      toast.error("O vídeo inteiro não começou", { description: outro !== null ? `O custo confirmado pelo servidor é ${usd(outro)}. Confira e peça de novo.` : textoDoErro(e), duration: 9000 });
    } finally {
      setOcupado(null);
    }
  };

  const andando = !!tratamento && EM_ANDAMENTO.indexOf(tratamento.estado) >= 0;
  const amostraPronta = !!tratamento && !!tratamento.amostra && !!tratamento.amostra.depois_url;
  const proporcao = arquivo.largura && arquivo.altura ? arquivo.altura / arquivo.largura : 16 / 9;
  const titulo = acao === "tirar_legenda" ? "Tirar legenda" : "Melhorar qualidade";

  return (
    <JanelaCentral
      aberta={aberta}
      onFechar={onFechar}
      largura="lg"
      icone={acao === "tirar_legenda" ? <Eraser className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
      titulo={titulo}
      descricao={`${arquivo.nome} · ${duracaoCurta(arquivo.duracao_s)}`}
      ajuda={
        acao === "tirar_legenda"
          ? "Acha a faixa da legenda que já veio gravada, refaz só essa faixa com IA e cola de volta sobre o vídeo original. O resto do quadro e o áudio ficam iguais. Primeiro uma amostra de 5 s; depois o vídeo inteiro. O original não muda."
          : "Mais nitidez e detalhe sem suavizar a pele e sem trocar o rosto (contra o aspecto de cera). O áudio fica o original. Primeiro uma amostra de 5 s para comparar; depois o vídeo inteiro. O original não muda."
      }
      rodape={
        <div className="flex w-full flex-wrap items-center justify-end">
          {amostraPronta && tratamento && (tratamento.estado === "amostra" || (tratamento.estado === "erro" && tratamento.fase === "final")) ? (
            <button type="button" className={juntar(botao.primario, "mb-1")} disabled={!!ocupado || !!semChave || !duracao} onClick={() => void pedirInteiro()} data-tratar-inteiro="">
              {ocupado === "final" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Fazer o vídeo inteiro por {usd(custoDoInteiro.usd)}
            </button>
          ) : (
            <button type="button" className={juntar(botao.primario, "mb-1")} disabled={!!ocupado || andando || !!semChave || !duracao || (acao === "tirar_legenda" && achando)} onClick={() => void pedirAmostra()} data-tratar-amostra="">
              {ocupado === "amostra" && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Amostra de {Math.round(janela.fim_s - janela.inicio_s)} s por {usd(custoDaAmostra.usd)}
            </button>
          )}
        </div>
      }
    >
      <div className="space-y-4" data-janela-de-tratamento={acao}>
        <div className="flex min-w-0 flex-wrap items-center">
          <SeletorCompacto
            rotulo="Modelo"
            className="mr-2"
            valor={motor.id}
            onEscolher={(v) => setMotorId(v)}
            opcoes={motores.map((m) => ({ valor: m.id, rotulo: m.rotulo, desativada: estadoDosMotores.some((x) => x.id === m.id && !x.pronto) }))}
          />
          <AjudaRecolhida rotulo="Sobre o modelo">{motor.nota}</AjudaRecolhida>
          {acao === "melhorar" && (
            <SeletorCompacto
              rotulo="Tamanho"
              className="ml-auto"
              valor={nivel}
              onEscolher={(v) => setNivel(v === "dobro" ? "dobro" : "mesmo_tamanho")}
              opcoes={[
                { valor: "mesmo_tamanho", rotulo: "Mesmo tamanho" },
                { valor: "dobro", rotulo: "Dobro (até 4K)" },
              ]}
            />
          )}
        </div>
        {semChave && <p className={juntar(texto.auxiliar, "text-warning")}>{semChave.motivo}</p>}

        {acao === "tirar_legenda" && !amostraPronta && (
          <div className="space-y-2">
            <p className={juntar(texto.auxiliar, "flex items-center")}>
              {achando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ScanSearch className="mr-1.5 h-3.5 w-3.5" />}
              {achando ? "Procurando a legenda nos quadros" : achou || "Faixa da legenda"}
            </p>
            <Faixa vista={vista} regiao={regiao} carregando={achando || url.isLoading} />
            <div className="grid grid-cols-2 gap-2">
              <label className={texto.rotulo}>
                Topo da faixa ({pct(regiao.y)}%)
                <input type="range" min={0} max={95} value={pct(regiao.y)} onChange={(e) => setRegiao((r) => ({ ...r, y: Math.min(0.97 - r.h, Number(e.target.value) / 100) }))} className="w-full" aria-label="Topo da faixa da legenda" />
              </label>
              <label className={texto.rotulo}>
                Altura da faixa ({pct(regiao.h)}%)
                <input type="range" min={3} max={60} value={pct(regiao.h)} onChange={(e) => setRegiao((r) => ({ ...r, h: Math.min(1 - r.y, Number(e.target.value) / 100) }))} className="w-full" aria-label="Altura da faixa da legenda" />
              </label>
            </div>
          </div>
        )}

        {!amostraPronta && (
          <label className={juntar(texto.rotulo, "block")}>
            Amostra a partir de (s)
            <input className={juntar(campo, "mt-1 h-8 w-28")} inputMode="decimal" value={String(inicio)} onChange={(e) => setInicio(Math.max(0, Number(e.target.value.replace(",", ".")) || 0))} aria-label="Início da amostra em segundos" />
          </label>
        )}

        {tratamento && (
          <div className="space-y-2" data-tratamento={tratamento.id} data-estado={tratamento.estado}>
            <p className={juntar(texto.auxiliar, "flex items-center")}>
              {andando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              {tratamento.estado_texto}
              {tratamento.custo_usd > 0 && <span className="ml-2 tabular-nums">{usd(tratamento.custo_usd)} até agora</span>}
            </p>
            {tratamento.erro && <p className={juntar(texto.auxiliar, "text-destructive")}>{tratamento.erro}</p>}
            {amostraPronta && tratamento.amostra && tratamento.amostra.antes_url && tratamento.amostra.depois_url && (
              <ComparadorAntesDepois tipo="video" antes={{ src: tratamento.amostra.antes_url, rotulo: "Antes" }} depois={{ src: tratamento.amostra.depois_url, rotulo: "Depois" }} proporcao={proporcao} />
            )}
            {tratamento.estado === "pronto" && <p className={texto.corpo}>Pronto. O vídeo novo está na pasta Antes e depois; o original não mudou.</p>}
          </div>
        )}
      </div>
    </JanelaCentral>
  );
}
