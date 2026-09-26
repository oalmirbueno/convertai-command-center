import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { Camera, ExternalLink, Loader2, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { AvisoDoRascunho, CabecalhoDaEtapa, SemCampanha, useMesaPublicidade } from "./Comuns";
import { FORMATOS_DA_CAMPANHA, FUNCOES_DAS_TOMADAS, pedirTomadas, salvarTomadas, type TomadaDePublicidade } from "./publicidadeApi";

/**
 * Passo 3: o plano de seis tomadas (uma por função) e o pedido à Mesa Foto.
 * A Mesa Foto produz: o pedido vira um ensaio de campanha dela
 * (campanha_planejar), com o produto das fontes do kit preservado e a pessoa
 * sintética do casting. Gerar cada foto também é da Mesa Foto (tomada_gerar,
 * mesma carteira): aqui só há o atalho. Nada é gerado por fora.
 */

const rotuloDaFuncao = (f: string) => (FUNCOES_DAS_TOMADAS.find((x) => x.id === f) || { rotulo: f }).rotulo;

function PlanoEditavel({ tomadas, onSalvar, salvando }: { tomadas: TomadaDePublicidade[]; onSalvar: (t: TomadaDePublicidade[]) => void; salvando: boolean }) {
  const [lista, setLista] = useState<TomadaDePublicidade[]>(tomadas);
  const chave = tomadas.map((t) => `${t.funcao}:${t.descricao}:${t.formato}`).join("|");
  useEffect(() => setLista(tomadas), [chave]); // eslint-disable-line react-hooks/exhaustive-deps
  const mudou = JSON.stringify(lista) !== JSON.stringify(tomadas);
  const mudar = (i: number, parcial: Partial<TomadaDePublicidade>) => setLista((l) => l.map((t, j) => (j === i ? { ...t, ...parcial } : t)));
  return (
    <section className="space-y-2" data-plano-de-tomadas="">
      {lista.map((t, i) => (
        <div key={t.funcao} className="rounded-xl border border-border bg-card p-3" data-tomada={t.funcao}>
          <div className="flex flex-wrap items-center">
            <span className="mr-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10.5px] font-semibold text-primary-foreground">{t.ordem}</span>
            <p className="mr-2 text-[13px] font-semibold">{rotuloDaFuncao(t.funcao)}</p>
            <span className="text-[11px] text-muted-foreground">{t.com_pessoa ? "com a pessoa do casting" : "sem pessoa"}</span>
          </div>
          <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 md:grid-cols-2">
            <Input value={t.descricao} onChange={(e) => mudar(i, { descricao: e.target.value })} maxLength={400} className="h-9 text-[12.5px]" aria-label="Descrição da tomada" />
            <Input value={t.enquadramento} onChange={(e) => mudar(i, { enquadramento: e.target.value })} maxLength={200} className="h-9 text-[12.5px]" aria-label="Enquadramento" />
            <Input value={t.ambiente} onChange={(e) => mudar(i, { ambiente: e.target.value })} maxLength={300} placeholder="Ambiente" className="h-9 text-[12.5px]" aria-label="Ambiente" />
            <div className="flex min-w-0">
              <Input value={t.luz} onChange={(e) => mudar(i, { luz: e.target.value })} maxLength={200} placeholder="Luz" className="mr-1.5 h-9 min-w-0 text-[12.5px]" aria-label="Luz" />
              <select value={t.formato} onChange={(e) => mudar(i, { formato: e.target.value })} className="h-9 w-20 shrink-0 rounded-md border border-input bg-background px-1.5 text-[12.5px]" aria-label="Formato">
                {FORMATOS_DA_CAMPANHA.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <label className="mt-1.5 inline-flex items-center text-[11.5px] text-muted-foreground">
            <input type="checkbox" className="mr-1.5" checked={t.com_pessoa} onChange={(e) => mudar(i, { com_pessoa: e.target.checked })} />
            Com a pessoa do casting
          </label>
          <label className="ml-3 mt-1.5 inline-flex items-center text-[11.5px] text-muted-foreground">
            <input type="checkbox" className="mr-1.5" checked={t.espaco_para_texto} onChange={(e) => mudar(i, { espaco_para_texto: e.target.checked })} />
            Espaço para texto
          </label>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" className="h-8" disabled={!mudou || salvando} onClick={() => onSalvar(lista)}>
        {salvando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Save className="mr-1.5 h-3.5 w-3.5" />}
        Salvar o plano
      </Button>
    </section>
  );
}

function TomadasNaMesaFoto({ ensaio }: { ensaio: Ensaio }) {
  const { clientId, catalogo } = useMesa();
  const { campanha } = useMesaPublicidade();
  const queryClient = useQueryClient();
  const [progresso, setProgresso] = useState<{ feitos: number; total: number } | null>(null);
  const pendentes = ensaio.tomadas.filter((t) => !t.versoes.length && t.status !== "bloqueada" && t.status !== "gerando");
  const modeloImagem = padraoPara(catalogo, "imagem");
  return (
    <section className="rounded-xl border border-border bg-card p-3.5" data-ensaio-da-campanha={ensaio.id}>
      <div className="mb-2 flex flex-wrap items-center">
        <p className="mr-2 text-[13px] font-semibold">Na Mesa Foto</p>
        <Link to={`/mesa-foto?client=${clientId}&etapa=campanha&ensaio=${ensaio.id}`} className="inline-flex items-center text-[12px] font-medium text-primary hover:underline">
          Abrir o ensaio na Mesa Foto <ExternalLink className="ml-1 h-3 w-3" />
        </Link>
      </div>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {ensaio.tomadas.map((t, i) => {
          const nossa = campanha ? campanha.tomadas.find((x) => x.foto_tomada_id === t.id) : null;
          const estado = ESTADOS_DA_TOMADA[t.status] || { rotulo: t.status, cor: "" };
          return (
            <li key={t.id} className="flex min-w-0 items-center px-2.5 py-1.5 text-[12px]">
              <span className="mr-2 w-5 shrink-0 text-muted-foreground">{i + 1}.</span>
              <span className="min-w-0 flex-1 truncate">
                {t.nome}
                {nossa && <span className="text-muted-foreground"> · {rotuloDaFuncao(nossa.funcao)}</span>}
              </span>
              <span className="ml-2 shrink-0 text-[11px] text-muted-foreground">
                {estado.rotulo}
                {t.versoes.length ? ` · v${t.versoes[t.versoes.length - 1].versao}` : ""}
              </span>
            </li>
          );
        })}
      </ul>
      {pendentes.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center">
          <BotaoComCusto
            rotulo={
              <>
                <Camera className="mr-1.5 h-3.5 w-3.5" />
                {progresso ? `Gerando ${progresso.feitos} de ${progresso.total}` : `Gerar ${pendentes.length} ${pendentes.length === 1 ? "foto" : "fotos"} na Mesa Foto`}
              </>
            }
            titulo="Fotos geradas na Mesa Foto"
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
          <span className="ml-2 text-[11px] text-muted-foreground">Uma a uma, pelo motor da Mesa Foto.</span>
        </div>
      )}
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
  if (!campanha) return <SemCampanha etapa="as tomadas" />;
  const territorio = campanha.territorios.find((t) => t.id === campanha.territorio_id) || null;
  const ensaio = campanha.ensaio_id ? (ensaios.data || []).find((e) => e.id === campanha.ensaio_id) || null : null;

  if (!territorio) {
    return (
      <div className="space-y-3" data-etapa-publicidade="tomadas">
        <CabecalhoDaEtapa titulo="Tomadas" descricao="Seis tomadas, uma por função, pedidas à Mesa Foto." />
        <div className="rounded-xl border border-dashed border-border p-6 text-center">
          <p className="text-[13.5px] font-medium">Aprove um território antes.</p>
          <button type="button" className="mt-2 text-[12.5px] font-medium text-primary hover:underline" onClick={() => irPara("direcao")}>
            Ir para a direção
          </button>
        </div>
      </div>
    );
  }

  const salvar = async (t: TomadaDePublicidade[]) => {
    setSalvando(true);
    try {
      const r = await salvarTomadas(campanha, t);
      aplicar(r.campanha);
      toast.success("Plano salvo");
    } catch (e) {
      avisarErro(e, "Plano não salvo");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <div className="space-y-4" data-etapa-publicidade="tomadas">
      <CabecalhoDaEtapa
        titulo="Tomadas"
        descricao={`Território aprovado: ${territorio.nome}. Seis funções: atrair, apresentar, contexto, detalhe, conceito e apoiar a ação.`}
        acoes={
          campanha.ensaio_id ? (
            <Button type="button" size="sm" className="h-8" onClick={() => irPara("revisao")}>
              Seguir para a revisão
            </Button>
          ) : null
        }
      />
      {!banco && <AvisoDoRascunho />}
      {!campanha.ensaio_id ? (
        <>
          <PlanoEditavel tomadas={campanha.tomadas} onSalvar={(t) => void salvar(t)} salvando={salvando} />
          <section className="rounded-xl border border-primary/30 bg-primary/5 p-3.5" data-pedir-tomadas="">
            <p className="text-[13px] font-semibold">Pedir as 6 tomadas à Mesa Foto</p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              O diretor de fotografia monta o ensaio com as fontes reais do produto, a pessoa sintética do casting e o que não pode mudar. As fotos saem da Mesa Foto, na carteira do cliente.
            </p>
            <div className="mt-2">
              <BotaoComCusto
                rotulo={
                  <>
                    <Camera className="mr-1.5 h-3.5 w-3.5" />
                    Pedir as 6 tomadas
                  </>
                }
                titulo="Tomadas pedidas à Mesa Foto"
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
            </div>
          </section>
        </>
      ) : ensaio ? (
        <TomadasNaMesaFoto ensaio={ensaio} />
      ) : (
        <div className="h-28 animate-pulse rounded-xl bg-muted/70" aria-busy="true" />
      )}
    </div>
  );
}
