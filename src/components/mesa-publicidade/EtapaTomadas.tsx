import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Camera, ExternalLink, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { useMesa } from "@/components/mesa/MesaContexto";
import { padraoPara } from "@/lib/mesa/api";
import {
  ESTADOS_DA_TOMADA,
  gerarTomada,
  guardarEnsaio,
  partesDaGeracao,
  partesDoPlanoDeLote,
  useEnsaios,
  type Ensaio,
} from "@/components/mesa-foto/fotoApi";
import { Carregando, EstadoVazio } from "@/components/sistema/Estados";
import { botao, campo, juntar, superficie, texto } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { AvisoDoRascunho, CabecalhoDaEtapa, RotuloLargo, SemCampanha, useMesaPublicidade } from "./Comuns";
import { FORMATOS_DA_CAMPANHA, FUNCOES_DAS_TOMADAS, pedirTomadas, salvarTomadas, type CampanhaDePublicidade, type TomadaDePublicidade } from "./publicidadeApi";

/**
 * Passo 3: o plano de seis tomadas (uma por função) e o pedido à Mesa Foto.
 * A Mesa Foto produz: o pedido vira um ensaio de campanha dela
 * (campanha_planejar), com o produto das fontes do kit preservado e a pessoa
 * sintética do casting. Gerar cada foto também é da Mesa Foto (tomada_gerar,
 * mesma carteira): aqui só há o atalho. Nada é gerado por fora.
 *
 * Sistema de design (26/09): o plano é uma lista só (sem cartão por tomada),
 * salvar e pedir ficam na linha do título, e o rascunho do plano fica guardado
 * por campanha (sair e voltar não perde a edição).
 */

const rotuloDaFuncao = (f: string) => (FUNCOES_DAS_TOMADAS.find((x) => x.id === f) || { rotulo: f }).rotulo;
const assinatura = (t: TomadaDePublicidade[]) => JSON.stringify(t);
/** Resumo curto do plano salvo (djb2): plano novo do servidor, chave nova de rascunho. */
function resumo(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

function PlanoEditavel({ lista, mudar }: { lista: TomadaDePublicidade[]; mudar: (i: number, parcial: Partial<TomadaDePublicidade>) => void }) {
  return (
    <ol className={juntar(superficie.painel, "divide-y divide-border")} data-plano-de-tomadas="">
      {lista.map((t, i) => (
        <li key={t.funcao} className="min-w-0 px-4 py-3" data-tomada={t.funcao}>
          <div className="flex min-w-0 items-center">
            <span className="mr-2 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-[10.5px] font-semibold text-primary-foreground">{t.ordem}</span>
            <p className="mr-2 min-w-0 truncate text-[13px] font-semibold">{rotuloDaFuncao(t.funcao)}</p>
            <span className={juntar(texto.auxiliar, "ml-auto shrink-0")}>{t.com_pessoa ? "com a pessoa" : "sem pessoa"}</span>
          </div>
          <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2">
            <input value={t.descricao} onChange={(e) => mudar(i, { descricao: e.target.value })} maxLength={400} placeholder="Descrição" className={campo} aria-label={`Descrição da tomada ${t.ordem}`} />
            <input value={t.enquadramento} onChange={(e) => mudar(i, { enquadramento: e.target.value })} maxLength={200} placeholder="Enquadramento" className={campo} aria-label={`Enquadramento da tomada ${t.ordem}`} />
            <input value={t.ambiente} onChange={(e) => mudar(i, { ambiente: e.target.value })} maxLength={300} placeholder="Ambiente" className={campo} aria-label={`Ambiente da tomada ${t.ordem}`} />
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_88px] gap-2">
              <input value={t.luz} onChange={(e) => mudar(i, { luz: e.target.value })} maxLength={200} placeholder="Luz" className={campo} aria-label={`Luz da tomada ${t.ordem}`} />
              <select value={t.formato} onChange={(e) => mudar(i, { formato: e.target.value })} className={campo} aria-label={`Formato da tomada ${t.ordem}`}>
                {FORMATOS_DA_CAMPANHA.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center text-[12px] text-muted-foreground">
            <label className="mr-4 inline-flex items-center py-1">
              <input type="checkbox" className="mr-1.5" checked={t.com_pessoa} onChange={(e) => mudar(i, { com_pessoa: e.target.checked })} />
              Com a pessoa do casting
            </label>
            <label className="inline-flex items-center py-1">
              <input type="checkbox" className="mr-1.5" checked={t.espaco_para_texto} onChange={(e) => mudar(i, { espaco_para_texto: e.target.checked })} />
              Espaço para texto
            </label>
          </div>
        </li>
      ))}
    </ol>
  );
}

function TomadasNaMesaFoto({ ensaio, campanha }: { ensaio: Ensaio; campanha: CampanhaDePublicidade }) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const [progresso, setProgresso] = useState<{ feitos: number; total: number } | null>(null);
  const pendentes = ensaio.tomadas.filter((t) => !t.versoes.length && t.status !== "bloqueada" && t.status !== "gerando");
  const modeloImagem = padraoPara(catalogo, "imagem");
  return (
    <section className="min-w-0 space-y-3" data-ensaio-da-campanha={ensaio.id}>
      <CabecalhoDaEtapa
        nivel={3}
        titulo="Na Mesa Foto"
        ajuda="As fotos saem uma a uma, pelo motor da Mesa Foto, na carteira do cliente."
        estado={`${ensaio.tomadas.length} ${ensaio.tomadas.length === 1 ? "tomada" : "tomadas"}${pendentes.length ? ` · ${pendentes.length} sem foto` : ""}`}
        acoes={
          <>
            <Link to={`/mesa-foto?client=${clientId}&etapa=campanha&ensaio=${ensaio.id}`} className={botao.discreto} aria-label="Abrir o ensaio na Mesa Foto">
              <ExternalLink className="h-3.5 w-3.5" />
              <RotuloLargo>Abrir o ensaio na Mesa Foto</RotuloLargo>
            </Link>
            {pendentes.length > 0 && (
              <BotaoComCusto
                rotulo={
                  <>
                    <Camera className="mr-1.5 h-3.5 w-3.5" />
                    {progresso ? `Gerando ${progresso.feitos} de ${progresso.total}` : `Gerar ${pendentes.length} ${pendentes.length === 1 ? "foto" : "fotos"}`}
                  </>
                }
                titulo="Fotos geradas na Mesa Foto"
                className="h-9"
                fecharAoConfirmar
                partes={() => partesDaGeracao(modeloImagem ? modeloImagem.id : null, "media", pendentes.length)}
                executar={async () => {
                  let custo = 0;
                  let falhas = 0;
                  setProgresso({ feitos: 0, total: pendentes.length });
                  try {
                    for (let k = 0; k < pendentes.length; k++) {
                      try {
                        const r = await gerarTomada({ ensaioId: ensaio.id, tomadaId: pendentes[k].id });
                        custo += Number(r.custo_usd) || 0;
                        if (r.ensaio) guardarEnsaio(queryClient, clientId, r.ensaio);
                      } catch {
                        falhas++;
                      }
                      setProgresso({ feitos: k + 1, total: pendentes.length });
                    }
                  } finally {
                    setProgresso(null);
                  }
                  if (falhas) toast.warning(`${falhas} ${falhas === 1 ? "foto não saiu" : "fotos não saíram"}`, { description: "Veja o motivo no ensaio da Mesa Foto." });
                  else toast.success("Fotos geradas", { description: "Siga para a revisão: o produto é conferido antes da estética." });
                  return { custo_usd: custo };
                }}
              />
            )}
          </>
        }
      />
      <ul className={juntar(superficie.painel, "divide-y divide-border")}>
        {ensaio.tomadas.map((t, i) => {
          const nossa = campanha.tomadas.find((x) => x.foto_tomada_id === t.id) || null;
          const estado = ESTADOS_DA_TOMADA[t.status] || { rotulo: t.status, cor: "" };
          return (
            <li key={t.id} className="flex min-w-0 items-center px-4 py-2 text-[12.5px]">
              <span className="mr-2 w-5 shrink-0 tabular-nums text-muted-foreground">{i + 1}.</span>
              <span className="min-w-0 flex-1 truncate">
                {t.nome}
                {nossa && <span className="text-muted-foreground"> · {rotuloDaFuncao(nossa.funcao)}</span>}
              </span>
              <span className="ml-2 shrink-0 text-[11.5px] text-muted-foreground">
                {estado.rotulo}
                {t.versoes.length ? ` · v${t.versoes[t.versoes.length - 1].versao}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

export default function EtapaTomadas() {
  const { clientId, catalogo } = useMesa();
  const { campanha, banco, aplicar, irPara } = useMesaPublicidade();
  const avisarErro = useAvisarErro();
  const queryClient = useQueryClient();
  const ensaios = useEnsaios(clientId);
  const [salvando, setSalvando] = useState(false);
  const base = campanha ? campanha.tomadas : [];
  // Rascunho do plano por campanha e pelo plano salvo: chegou plano novo do servidor, vale ele.
  const [lista, setLista] = useEstadoDaTela<TomadaDePublicidade[]>(
    `mesa-publicidade:plano:${clientId}:${campanha ? campanha.id || "rascunho" : "nenhuma"}:${resumo(assinatura(base))}`,
    base,
    { validar: (v) => Array.isArray(v) && v.length === base.length, esperaMs: 300 },
  );
  if (!campanha) return <SemCampanha etapa="as tomadas" />;
  const territorio = campanha.territorios.find((t) => t.id === campanha.territorio_id) || null;
  const ensaio = campanha.ensaio_id ? (ensaios.data || []).find((e) => e.id === campanha.ensaio_id) || null : null;

  if (!territorio) {
    return (
      <div className="min-w-0 space-y-5" data-etapa-publicidade="tomadas">
        <CabecalhoDaEtapa titulo="Tomadas" ajuda="Seis tomadas, uma por função, pedidas à Mesa Foto." />
        <EstadoVazio
          icone={<Camera className="h-5 w-5" />}
          titulo="Aprove um território antes."
          acao={
            <button type="button" className={botao.secundario} onClick={() => irPara("direcao")}>
              Ir para a direção
            </button>
          }
        />
      </div>
    );
  }

  const mudou = assinatura(lista) !== assinatura(campanha.tomadas);
  const mudar = (i: number, parcial: Partial<TomadaDePublicidade>) => setLista((l) => l.map((t, j) => (j === i ? { ...t, ...parcial } : t)));

  const salvar = async () => {
    if (salvando) return;
    setSalvando(true);
    try {
      const r = await salvarTomadas(campanha, lista);
      aplicar(r.campanha);
      setLista(r.campanha.tomadas);
      toast.success("Plano salvo");
    } catch (e) {
      avisarErro(e, "Plano não salvo");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="min-w-0 space-y-5" data-etapa-publicidade="tomadas">
      <CabecalhoDaEtapa
        titulo="Tomadas"
        ajuda="Seis funções: atrair, apresentar, contexto, detalhe, conceito e apoiar a ação. O diretor de fotografia monta o ensaio com as fontes reais do produto, a pessoa sintética do casting e o que não pode mudar. As fotos saem da Mesa Foto, na carteira do cliente."
        estado={`Território aprovado: ${territorio.nome}`}
        acoes={
          campanha.ensaio_id ? (
            <button type="button" className={botao.primario} onClick={() => irPara("revisao")} aria-label="Seguir para a revisão">
              <ArrowRight className="h-3.5 w-3.5" />
              <RotuloLargo>Seguir para a revisão</RotuloLargo>
            </button>
          ) : (
            <>
              <button type="button" className={botao.secundario} disabled={!mudou || salvando} onClick={() => void salvar()} aria-label="Salvar o plano">
                {salvando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                <RotuloLargo>Salvar o plano</RotuloLargo>
              </button>
              <span className="inline-flex" data-pedir-tomadas="">
                <BotaoComCusto
                  rotulo={
                    <>
                      <Camera className="mr-1.5 h-3.5 w-3.5" />
                      Pedir as 6 tomadas
                    </>
                  }
                  titulo="Tomadas pedidas à Mesa Foto"
                  className="h-9"
                  partes={() => partesDoPlanoDeLote(catalogo, 0)}
                  executar={async () => {
                    const r = await pedirTomadas(campanha);
                    aplicar(r.campanha);
                    if (r.bruto && r.bruto.ensaio_id) void queryClient.invalidateQueries({ queryKey: ["mesa-foto", "ensaios", clientId] });
                    const lacunas: string[] = r.bruto && Array.isArray(r.bruto.lacunas) ? r.bruto.lacunas : [];
                    if (lacunas.length) toast.message("Lacunas da Mesa Foto", { description: lacunas.slice(0, 3).join(" "), duration: 9000 });
                    return r.bruto;
                  }}
                />
              </span>
            </>
          )
        }
      />
      {!banco && <AvisoDoRascunho />}
      {!campanha.ensaio_id ? (
        <PlanoEditavel lista={lista} mudar={mudar} />
      ) : ensaio ? (
        <TomadasNaMesaFoto ensaio={ensaio} campanha={campanha} />
      ) : ensaios.isLoading || ensaios.isFetching ? (
        <Carregando forma="lista" linhas={6} rotulo="Lendo o ensaio" />
      ) : (
        <EstadoVazio compacto titulo="Ensaio não encontrado na Mesa Foto." descricao="Abra a Mesa Foto para conferir." />
      )}
    </div>
  );
}
