import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Columns2, Loader2, Minus, RefreshCw, ScanSearch, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Ampliar } from "@/components/mesa/Ampliar";
import { BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { padraoPara, usd } from "@/lib/mesa/api";
import { Cartao, FotoInteira, MiniaturaDaFoto, Moldura, Pilulas, useMesaFoto, Vazio } from "./Comuns";
import {
  chaveDosEnsaios,
  conferirVersao,
  decidirVersao,
  ESTADOS_DA_TOMADA,
  gerarTomada,
  guardarEnsaio,
  invalidarFotos,
  partesDaConferencia,
  partesDaGeracao,
  proporcaoDoFormato,
  resumoDoEnsaio,
  rotuloDaCamera,
  rotuloDoPapel,
  useEnsaios,
  useFotos,
  useKits,
  type Conferencia,
  type Ensaio,
  type FotoDoAcervo,
  type KitDeFoto,
  type Tomada,
  type VersaoDaTomada,
} from "./fotoApi";

/**
 * Etapa 5, Revisar: cada tomada com as versões lado a lado e as fontes do
 * kit ao lado, para comparar. A conferência (visão + Jev) é um aviso, nunca
 * decide sozinha. Aprovar trava a versão e cria a derivada no acervo;
 * rejeitar pede o motivo. Refazer gera uma variação nova, com custo à vista.
 */

export const MOTIVOS_RAPIDOS = ["Produto diferente", "Texto ou rótulo errado", "Proporção errada", "Rosto mudou", "Mãos estranhas", "Ingrediente inventado", "Luz ou cor fora"];

function ConferenciaNaTela({ conferencia }: { conferencia: Conferencia }) {
  // ok null = não deu para avaliar (a parte não aparece nas fontes): não é falha.
  const falhas = conferencia.pontos.filter((p) => p.ok === false);
  return (
    <div className={`space-y-1 rounded-lg p-2 ${falhas.length || conferencia.alertas.length || conferencia.aviso_jev ? "bg-warning/10" : "bg-success/10"}`} data-conferencia="">
      <p className="text-[11px] font-medium">Conferência (aviso, a decisão é sua)</p>
      {conferencia.resumo && <p className="text-[11.5px] leading-snug [overflow-wrap:anywhere]">{conferencia.resumo}</p>}
      <ul className="space-y-0.5">
        {conferencia.pontos.map((p) => (
          <li key={p.criterio} className="flex items-start text-[11.5px] leading-snug">
            {p.ok === true ? (
              <Check className="mr-1 mt-0.5 h-3 w-3 shrink-0 text-success" />
            ) : p.ok === false ? (
              <X className="mr-1 mt-0.5 h-3 w-3 shrink-0 text-destructive" />
            ) : (
              <Minus className="mr-1 mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" aria-label="não avaliado" />
            )}
            <span className="min-w-0 [overflow-wrap:anywhere]">
              <span className="font-medium">{p.criterio}</span>
              {p.nota ? `: ${p.nota}` : ""}
            </span>
          </li>
        ))}
      </ul>
      {conferencia.aviso_jev && (
        <p className="flex items-start text-[11.5px] leading-snug">
          <AlertTriangle className="mr-1 mt-0.5 h-3 w-3 shrink-0 text-warning" /> <span className="min-w-0">O Jev vê divergência crítica com o assunto real. Compare antes de aprovar.</span>
        </p>
      )}
      {conferencia.alertas.map((a) => (
        <p key={a} className="flex items-start text-[11.5px] leading-snug">
          <AlertTriangle className="mr-1 mt-0.5 h-3 w-3 shrink-0 text-warning" /> <span className="min-w-0 [overflow-wrap:anywhere]">{a}</span>
        </p>
      ))}
    </div>
  );
}

function Rejeitar({ onRejeitar, ocupado }: { onRejeitar: (motivo: string) => void; ocupado: boolean }) {
  const [aberto, setAberto] = useState(false);
  const [motivo, setMotivo] = useState("");
  if (!aberto) {
    return (
      <Button type="button" size="sm" variant="ghost" className="mb-1 mr-1 h-8 px-2 text-[12px] text-destructive hover:text-destructive" onClick={() => setAberto(true)} disabled={ocupado}>
        <X className="mr-1 h-3.5 w-3.5" /> Rejeitar
      </Button>
    );
  }
  return (
    <div className="w-full min-w-0 space-y-1.5 rounded-lg border border-destructive/30 p-2" data-rejeitar="">
      <div className="flex min-w-0 flex-wrap">
        {MOTIVOS_RAPIDOS.map((m) => (
          <button key={m} type="button" onClick={() => setMotivo(m)} className={`mb-1 mr-1 rounded-full border px-2 py-0.5 text-[11px] ${motivo === m ? "border-destructive text-destructive" : "border-border text-muted-foreground"}`}>
            {m}
          </button>
        ))}
      </div>
      <Input value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="O que está errado" aria-label="Motivo da rejeição" className="h-8 text-[12px]" />
      <div className="flex justify-end">
        <Button type="button" size="sm" variant="ghost" className="mr-1 h-7 text-[11.5px]" onClick={() => setAberto(false)}>
          Cancelar
        </Button>
        <Button type="button" size="sm" variant="destructive" className="h-7 text-[11.5px]" disabled={!motivo.trim() || ocupado} onClick={() => onRejeitar(motivo)}>
          Rejeitar com motivo
        </Button>
      </div>
    </div>
  );
}

function CartaoDaVersao({
  ensaio,
  tomada,
  versao,
  onComparar,
  onAmpliar,
}: {
  ensaio: Ensaio;
  tomada: Tomada;
  versao: VersaoDaTomada;
  onComparar: () => void;
  onAmpliar: () => void;
}) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [decidindo, setDecidindo] = useState(false);
  const [conferenciaLocal, setConferenciaLocal] = useState<Conferencia | null>(null);
  const conferencia = versao.conferencia || conferenciaLocal;
  const travada = tomada.versoes.some((v) => v.aprovada);

  const decidir = async (decisao: "aprovar" | "rejeitar", motivo?: string) => {
    setDecidindo(true);
    try {
      const r = await decidirVersao({ ensaioId: ensaio.id, tomadaId: tomada.id, versao: versao.versao, decisao, motivo });
      if (r.ensaio) guardarEnsaio(queryClient, clientId, r.ensaio);
      invalidarFotos(queryClient, clientId);
      toast.success(decisao === "aprovar" ? "Versão aprovada e travada" : "Versão rejeitada", {
        description: decisao === "aprovar" ? "Ela entrou no acervo como gerada e aprovada. Ajustes criam uma derivada nova." : "O motivo fica guardado para a próxima variação.",
      });
    } catch (e) {
      avisarErro(e, decisao === "aprovar" ? "Não aprovada" : "Não rejeitada");
    } finally {
      setDecidindo(false);
    }
  };

  const leitor = padraoPara(catalogo, "leitura");
  return (
    <li
      className={`min-w-0 rounded-xl border bg-card p-2 ${versao.aprovada ? "border-success/60" : versao.rejeitada ? "border-destructive/30 opacity-80" : "border-border"}`}
      data-versao={versao.versao}
    >
      <button type="button" onClick={onAmpliar} className="block w-full cursor-zoom-in" aria-label={`Ver a versão ${versao.versao} grande`}>
        <Moldura proporcao={proporcaoDoFormato(tomada.formato)} className="border border-border">
          <ImagemDaMesa caminho={versao.storage_path} alt={`${tomada.nome}, versão ${versao.versao}`} className="h-full w-full !object-contain" />
        </Moldura>
      </button>
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center text-[11.5px]">
        <span className="mr-1.5 font-semibold">v{versao.versao}</span>
        <span className="mr-1.5 rounded-full border border-primary/30 px-1.5 py-px text-[10px] font-semibold text-primary" data-selo="gerada">
          gerada
        </span>
        {versao.aprovada && <span className="mr-1.5 rounded-full bg-success/15 px-1.5 py-px text-[10px] font-medium text-success">aprovada</span>}
        {versao.rejeitada && <span className="mr-1.5 rounded-full bg-destructive/10 px-1.5 py-px text-[10px] font-medium text-destructive">rejeitada</span>}
        {versao.custo_usd !== null && <span className="text-muted-foreground">{usd(versao.custo_usd)}</span>}
      </div>
      {versao.rejeitada && versao.motivo_rejeicao && <p className="mt-1 text-[11.5px] text-muted-foreground [overflow-wrap:anywhere]">Motivo: {versao.motivo_rejeicao}</p>}
      {conferencia && (
        <div className="mt-1.5">
          <ConferenciaNaTela conferencia={conferencia} />
        </div>
      )}
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center">
        <Button type="button" size="sm" variant="ghost" className="mb-1 mr-1 h-8 px-2 text-[12px]" onClick={onComparar}>
          <Columns2 className="mr-1 h-3.5 w-3.5" /> Comparar
        </Button>
        {!conferencia && !versao.rejeitada && (
          <BotaoComCusto
            rotulo={
              <>
                <ScanSearch className="mr-1 h-3.5 w-3.5" /> Conferir
              </>
            }
            titulo="Versão conferida"
            descricao="A visão compara com as fontes do kit (produto, rótulo, proporção, rosto, mãos, ingredientes, reflexos, sombra). Só avisa; não corrige sozinha."
            variant="ghost"
            className="mb-1 mr-1 h-8 px-2 text-[12px]"
            disabled={!leitor}
            partes={() => partesDaConferencia(catalogo)}
            executar={() => conferirVersao(ensaio.id, tomada.id, versao.versao)}
            aoConcluir={(data) => {
              if (data && data.ensaio) guardarEnsaio(queryClient, clientId, data.ensaio);
              if (data && data.conferencia) setConferenciaLocal(data.conferencia);
              // versao_conferir grava a conferência no ensaio e não devolve o ensaio: relê.
              void queryClient.invalidateQueries({ queryKey: chaveDosEnsaios(clientId) });
            }}
          />
        )}
        {!travada && !versao.rejeitada && (
          <>
            <Button type="button" size="sm" className="mb-1 mr-1 h-8 px-2.5 text-[12px]" disabled={decidindo} onClick={() => void decidir("aprovar")}>
              {decidindo ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />} Aprovar
            </Button>
            <Rejeitar ocupado={decidindo} onRejeitar={(m) => void decidir("rejeitar", m)} />
          </>
        )}
      </div>
    </li>
  );
}

function FontesDoKit({ kit, fotos, onAbrir }: { kit: KitDeFoto | null; fotos: FotoDoAcervo[]; onAbrir: (f: FotoDoAcervo) => void }) {
  if (!kit || !kit.refs.length) return <p className="text-[11.5px] text-muted-foreground">Sem fontes no kit.</p>;
  return (
    <div className="grid min-w-0 grid-cols-4 gap-1.5 md:grid-cols-2">
      {kit.refs.slice(0, 8).map((r) => {
        const f = fotos.find((x) => x.id === r.imagem_id);
        return (
          <button key={`${r.imagem_id}-${r.papel}`} type="button" onClick={() => f && onAbrir(f)} className="min-w-0 text-left" title={`${rotuloDoPapel(r.papel)}${f ? `: ${f.nome}` : ""}`}>
            {f ? <MiniaturaDaFoto foto={f} /> : <div className="rounded-lg bg-muted" style={{ paddingBottom: "100%" }} />}
            <span className="block truncate text-[10px] text-muted-foreground">{rotuloDoPapel(r.papel)}</span>
          </button>
        );
      })}
    </div>
  );
}

function LinhaDaTomada({
  ensaio,
  tomada,
  kit,
  fotos,
  onComparar,
  onAmpliar,
}: {
  ensaio: Ensaio;
  tomada: Tomada;
  kit: KitDeFoto | null;
  fotos: FotoDoAcervo[];
  onComparar: (v: VersaoDaTomada, fonte: FotoDoAcervo | null) => void;
  onAmpliar: (caminho: string, titulo: string) => void;
}) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const estado = ESTADOS_DA_TOMADA[tomada.status] || ESTADOS_DA_TOMADA.pendente;
  const travada = tomada.versoes.some((v) => v.aprovada);
  const imagem = padraoPara(catalogo, "imagem");
  const identidade = kit ? kit.refs.find((r) => r.papel === "identidade" || r.papel === "rosto") || kit.refs[0] : null;
  const fonte = identidade ? fotos.find((f) => f.id === identidade.imagem_id) || null : null;
  return (
    <li className="min-w-0 rounded-xl border border-border bg-card p-3" data-revisar-tomada={tomada.id}>
      <div className="mb-2 flex min-w-0 flex-wrap items-center">
        <p className="mr-2 min-w-0 truncate text-[13px] font-semibold">{tomada.nome}</p>
        <span className={`mr-2 rounded-full px-1.5 py-px text-[10.5px] font-medium ${estado.cor}`}>{estado.rotulo}</span>
        <span className="mr-auto min-w-0 truncate text-[11.5px] text-muted-foreground">{rotuloDaCamera(tomada.camera)}</span>
        {!travada && tomada.status !== "bloqueada" && tomada.status !== "gerando" && (
          <BotaoComCusto
            rotulo={
              <>
                <RefreshCw className="mr-1 h-3.5 w-3.5" /> Nova variação
              </>
            }
            titulo="Variação gerada"
            descricao="Gera uma versão nova desta tomada, com variação real. As versões antigas ficam."
            variant="outline"
            className="h-8 text-[12px]"
            disabled={!imagem}
            partes={() => partesDaGeracao(imagem ? imagem.id : null, "alta")}
            executar={async () => {
              const r = await gerarTomada({ ensaioId: ensaio.id, tomadaId: tomada.id, modeloImagemId: imagem ? imagem.id : null, qualidade: "alta" });
              if (r.ensaio) guardarEnsaio(queryClient, clientId, r.ensaio);
              invalidarFotos(queryClient, clientId);
              return r;
            }}
          />
        )}
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-[150px_minmax(0,1fr)]">
        <div className="min-w-0">
          <p className="mb-1 text-[11px] font-medium text-muted-foreground">Fontes do kit</p>
          <FontesDoKit kit={kit} fotos={fotos} onAbrir={(f) => onAmpliar(f.storage_path, `Fonte: ${f.nome}`)} />
        </div>
        {tomada.versoes.length === 0 ? (
          <p className="self-center text-[12px] text-muted-foreground">{tomada.status === "bloqueada" ? tomada.motivo_bloqueio || "Bloqueada por falta de evidência." : "Ainda sem versão. Gere na etapa Ensaio."}</p>
        ) : (
          <ul className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {tomada.versoes
              .slice()
              .reverse()
              .map((v) => (
                <CartaoDaVersao
                  key={v.versao}
                  ensaio={ensaio}
                  tomada={tomada}
                  versao={v}
                  onComparar={() => onComparar(v, fonte)}
                  onAmpliar={() => v.storage_path && onAmpliar(v.storage_path, `${tomada.nome}, v${v.versao} (gerada)`)}
                />
              ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function Comparar({
  aberto,
  onFechar,
  versao,
  tomada,
  fonteInicial,
  kit,
  fotos,
}: {
  aberto: boolean;
  onFechar: () => void;
  versao: VersaoDaTomada | null;
  tomada: Tomada | null;
  fonteInicial: FotoDoAcervo | null;
  kit: KitDeFoto | null;
  fotos: FotoDoAcervo[];
}) {
  const [fonteId, setFonteId] = useState<string | null>(null);
  const fontes = kit ? kit.refs.map((r) => fotos.find((f) => f.id === r.imagem_id) || null).filter((f): f is FotoDoAcervo => !!f) : [];
  const fonte = (fonteId && fontes.find((f) => f.id === fonteId)) || fonteInicial || fontes[0] || null;
  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-16px)] max-w-5xl overflow-y-auto p-4">
        <DialogTitle className="text-[14px]">Comparar com a fonte</DialogTitle>
        <DialogDescription className="text-[12px]">Confira produto, texto, proporção, rosto, mãos, ingredientes, reflexos e sombra.</DialogDescription>
        {fontes.length > 1 && (
          <Pilulas
            rotulo="Fonte para comparar"
            opcoes={fontes.map((f) => ({ valor: f.id, rotulo: f.nome.length > 24 ? `${f.nome.slice(0, 24)}...` : f.nome }))}
            valor={fonte ? fonte.id : null}
            onEscolher={setFonteId}
          />
        )}
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <p className="mb-1 text-[11.5px] font-medium text-muted-foreground">Fonte real</p>
            {fonte ? <FotoInteira foto={fonte} /> : <p className="text-[12px] text-muted-foreground">Sem fonte no kit.</p>}
          </div>
          <div className="min-w-0">
            <p className="mb-1 text-[11.5px] font-medium text-muted-foreground">
              {tomada ? tomada.nome : "Versão"}
              {versao ? `, v${versao.versao}` : ""} <span className="text-primary">(gerada)</span>
            </p>
            {versao && versao.storage_path && (
              <Moldura proporcao={proporcaoDoFormato(tomada ? tomada.formato : "1:1")} className="border border-border">
                <ImagemDaMesa caminho={versao.storage_path} alt="Versão gerada" className="h-full w-full !object-contain" />
              </Moldura>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function EtapaRevisar() {
  const { clientId } = useMesa();
  const { ensaioId, escolherEnsaio, irPara } = useMesaFoto();
  const ensaios = useEnsaios(clientId);
  const kits = useKits(clientId);
  const fotos = useFotos(clientId);
  const lista = useMemo(() => ensaios.data || [], [ensaios.data]);
  const todas = useMemo(() => fotos.data || [], [fotos.data]);
  const ensaio = ensaioId ? lista.find((e) => e.id === ensaioId) || null : null;
  const kit = ensaio && ensaio.kit_id ? (kits.data || []).find((k) => k.id === ensaio.kit_id) || null : null;
  const [so, setSo] = useState<"revisar" | "todas">("revisar");
  const [comparando, setComparando] = useState<{ versao: VersaoDaTomada; tomada: Tomada; fonte: FotoDoAcervo | null } | null>(null);
  const [ampliada, setAmpliada] = useState<{ caminho: string; titulo: string } | null>(null);

  if (!ensaio) {
    return (
      <div className="min-w-0 space-y-4 pb-24">
        {ensaios.isLoading ? (
          <p className="flex items-center text-[12px] text-muted-foreground">
            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> Lendo os ensaios...
          </p>
        ) : lista.length ? (
          <Cartao titulo="Qual ensaio revisar?">
            <ul className="space-y-1.5">
              {lista.map((e) => {
                const r = resumoDoEnsaio(e);
                return (
                  <li key={e.id}>
                    <button type="button" onClick={() => escolherEnsaio(e.id)} className="flex w-full min-w-0 items-center rounded-lg border border-border px-3 py-2 text-left hover:border-primary/40">
                      <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{e.receita_id || "Ensaio"}</span>
                      <span className="ml-2 shrink-0 text-[11.5px] text-muted-foreground">
                        {r.paraRevisar} para revisar · {r.aprovadas} aprovadas
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </Cartao>
        ) : (
          <Vazio
            titulo="Nada para revisar ainda"
            acao={
              <Button type="button" size="sm" className="h-8 text-[12px]" onClick={() => irPara("ensaio")}>
                Montar um ensaio
              </Button>
            }
          />
        )}
      </div>
    );
  }

  const resumo = resumoDoEnsaio(ensaio);
  const tomadas = ensaio.tomadas.filter((t) => (so === "todas" ? true : t.versoes.length > 0 && !t.versoes.some((v) => v.aprovada)));

  return (
    <div className="min-w-0 space-y-3 pb-24">
      <div className="flex min-w-0 flex-wrap items-center">
        <p className="mb-1.5 mr-auto text-[12.5px] text-muted-foreground">
          <span className="font-semibold text-foreground">{resumo.paraRevisar}</span> para revisar · {resumo.aprovadas} de {resumo.total} aprovadas · {resumo.versoes} versões · {usd(resumo.custo)} no ensaio
        </p>
        <Pilulas
          rotulo="Mostrar"
          opcoes={[
            { valor: "revisar" as const, rotulo: "Para revisar" },
            { valor: "todas" as const, rotulo: "Todas as tomadas" },
          ]}
          valor={so}
          onEscolher={setSo}
        />
      </div>
      {tomadas.length === 0 ? (
        <Vazio titulo={so === "revisar" ? "Nada esperando revisão" : "Sem tomadas"}>
          {resumo.aprovadas ? (
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => irPara("usar")}>
              Ir para Usar as {resumo.aprovadas} aprovadas
            </button>
          ) : (
            "Gere as tomadas na etapa Ensaio."
          )}
        </Vazio>
      ) : (
        <ul className="space-y-3">
          {tomadas.map((t) => (
            <LinhaDaTomada
              key={t.id}
              ensaio={ensaio}
              tomada={t}
              kit={kit}
              fotos={todas}
              onComparar={(v, fonte) => setComparando({ versao: v, tomada: t, fonte })}
              onAmpliar={(caminho, titulo) => setAmpliada({ caminho, titulo })}
            />
          ))}
        </ul>
      )}
      {resumo.aprovadas > 0 && (
        <div className="flex justify-end">
          <Button type="button" size="sm" className="h-9 text-[12.5px]" onClick={() => irPara("usar")}>
            Usar as {resumo.aprovadas} aprovadas
          </Button>
        </div>
      )}
      <Comparar
        aberto={!!comparando}
        onFechar={() => setComparando(null)}
        versao={comparando ? comparando.versao : null}
        tomada={comparando ? comparando.tomada : null}
        fonteInicial={comparando ? comparando.fonte : null}
        kit={kit}
        fotos={todas}
      />
      <Ampliar imagens={ampliada ? [{ caminho: ampliada.caminho, titulo: ampliada.titulo }] : []} indice={ampliada ? 0 : null} onFechar={() => setAmpliada(null)} />
    </div>
  );
}
