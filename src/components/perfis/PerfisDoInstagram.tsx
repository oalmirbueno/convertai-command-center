import { lazy, Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Instagram, Loader2, Plus, Radar } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import AjudaRecolhida from "@/components/sistema/AjudaRecolhida";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import { Carregando, EstadoDeErro, EstadoVazio } from "@/components/sistema/Estados";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { botao, campo, etiqueta, juntar, texto } from "@/components/sistema/estilos";
import { useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import { urlsLevesEmLote } from "@/lib/miniaturas";
import {
  chamarPerfis,
  chaveDaLista,
  dataCurta,
  type ListaDePerfis,
  type MudancaNosConcorrentes,
  normalizarHandle,
  normalizarLista,
  numeroCurto,
  type PapelDoPerfil,
  type PerfilNaLista,
  ROTULO_DO_PAPEL,
} from "./perfisApi";

const PerfilAberto = lazy(() => import("./PerfilAberto"));

/**
 * Perfis do Instagram do cliente (frente P), dentro do Contexto da Mesa.
 * Um recurso, dois papéis: Referências (inspiração de estilo e editorial) e
 * Concorrentes (monitorados toda semana, quando ligado). Limite de 6 por
 * papel. Abrir um perfil mostra a grade, o resumo e o agente do perfil.
 * Papel escolhido e perfil aberto ficam lembrados por cliente.
 */

const AJUDA =
  "Perfis que o estúdio e os agentes conhecem. Referências servem de inspiração de estilo e de plano editorial; concorrentes podem ser monitorados toda semana, com ideias de resposta. A captura usa a API oficial do Instagram (perfil Business ou Creator) ou prints e links.";

export const validarPapel = (v: unknown) => v === "referencia" || v === "concorrente";

/** Fotos dos perfis numa chamada só (miniatura própria quando existe). */
function useFotos(clientId: string, perfis: PerfilNaLista[]) {
  const caminhos = perfis.map((p) => p.foto_caminho).filter((c): c is string => !!c);
  return useQuery({
    queryKey: ["perfis-instagram", clientId, "fotos", caminhos.join("|")],
    enabled: caminhos.length > 0,
    staleTime: 40 * 60_000,
    queryFn: () => urlsLevesEmLote("mesa", caminhos),
  });
}

function Foto({ url, handle, tamanho = "h-9 w-9" }: { url?: string; handle: string; tamanho?: string }) {
  return (
    <span className={juntar("inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted text-muted-foreground", tamanho)}>
      {url ? <img src={url} alt={`Foto de @${handle}`} loading="lazy" className="h-full w-full object-cover" /> : <Instagram className="h-4 w-4" aria-hidden="true" />}
    </span>
  );
}

function LinhaDoPerfil({
  p,
  foto,
  onAbrir,
  onMonitorar,
  mudando,
}: {
  p: PerfilNaLista;
  foto?: string;
  onAbrir: () => void;
  onMonitorar: (ligado: boolean) => void;
  mudando: boolean;
}) {
  const partes = [
    p.nome || "",
    p.seguidores !== null ? `${numeroCurto(p.seguidores)} seguidores` : "",
    p.contagem.posts ? `${p.contagem.posts} posts` : "sem posts",
    p.capturado_em ? `capturado ${dataCurta(p.capturado_em)}` : p.origem === "manual" ? "manual" : "",
  ].filter(Boolean);
  return (
    <li className="flex min-w-0 items-center py-2" data-perfil={p.handle}>
      <button
        type="button"
        onClick={onAbrir}
        className="-mx-2 flex min-w-0 flex-1 items-center rounded-md px-2 py-1 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Foto url={foto} handle={p.handle} />
        <span className="ml-3 min-w-0 flex-1">
          <span className="flex min-w-0 items-center">
            <span className="truncate text-[13px] font-medium text-foreground">@{p.handle}</span>
            {p.contagem.fora > 0 && (
              <span className={juntar(etiqueta, "ml-2 bg-primary/15 text-foreground")} title="Posts fora da curva (2x a mediana ou mais)">
                {p.contagem.fora} fora da curva
              </span>
            )}
          </span>
          <span className={juntar(texto.auxiliar, "block truncate")}>{partes.join(" · ")}</span>
          {p.ultimo_erro && (
            <span className="mt-0.5 flex min-w-0 items-center text-[12px] text-destructive" title={p.ultimo_erro}>
              <AlertTriangle className="mr-1 h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{p.ultimo_erro}</span>
            </span>
          )}
        </span>
      </button>
      {p.papel === "concorrente" && (
        <label className="ml-2 flex shrink-0 items-center text-[12px] text-muted-foreground" title="Rodada automática uma vez por semana">
          <span className="mr-2 hidden sm:inline">Monitorar</span>
          <Switch checked={p.monitorar} disabled={mudando} onCheckedChange={onMonitorar} aria-label={`Monitorar @${p.handle} toda semana`} />
        </label>
      )}
    </li>
  );
}

function MudancasDosConcorrentes({ mudancas }: { mudancas: MudancaNosConcorrentes[] }) {
  const lista = mudancas.slice(0, 5);
  if (!lista.length) return null;
  return (
    <section className="mt-4 min-w-0 border-t border-border pt-3" aria-label="O que mudou nos concorrentes" data-mudancas-concorrentes="">
      <div className="flex min-w-0 items-center">
        <Radar className="mr-1.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
        <h4 className={texto.tituloSecao}>O que mudou</h4>
        <AjudaRecolhida className="ml-1.5" rotulo="O que é O que mudou">
          As últimas rodadas dos concorrentes: posts novos, os que ficaram fora da curva e as ideias de resposta. As ideias também vão como sinal para o Radar de ideias.
        </AjudaRecolhida>
      </div>
      <ul className="mt-1 divide-y divide-border">
        {lista.map((m) => (
          <li key={m.id} className="min-w-0 py-2">
            <p className={juntar(texto.corpo, "truncate")}>
              {m.handle ? `@${m.handle}` : "Perfil"} · {dataCurta(m.iniciada_em)} ·{" "}
              {m.status === "erro" ? "não rodou" : m.tipo === "ideias" ? "ideias pedidas" : `${m.novos} novos, ${m.fora_da_curva} fora da curva`}
            </p>
            {(m.ideias || []).slice(0, 3).map((i, k) => (
              <p key={k} className={juntar(texto.auxiliar, "truncate")} title={i.por_que || i.gancho || ""}>
                {k + 1}. {i.tema}
              </p>
            ))}
          </li>
        ))}
      </ul>
    </section>
  );
}

function JanelaDeAdicionar({
  aberta,
  onFechar,
  papel,
  lista,
  onAdicionado,
}: {
  aberta: boolean;
  onFechar: () => void;
  papel: PapelDoPerfil;
  lista: ListaDePerfis;
  onAdicionado: (perfilId: string) => void;
}) {
  const { clientId, marca } = useMesa();
  const marcaId = marca && !marca.principal ? marca.id : null;
  const avisarErro = useAvisarErro();
  const [valor, setValor] = useState("");
  const [enviando, setEnviando] = useState(false);
  useEffect(() => {
    if (!aberta) setValor("");
  }, [aberta]);
  const handle = normalizarHandle(valor);
  const erro = valor.trim() && !handle ? "Digite o @ ou cole o link do perfil." : undefined;

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    if (!handle || enviando) return;
    setEnviando(true);
    try {
      const r = await chamarPerfis<{ perfil: { id: string } }>("adicionar", clientId, marcaId, { papel, handle });
      toast.success(`@${handle} em ${ROTULO_DO_PAPEL[papel]}`);
      onAdicionado(r.perfil.id);
      onFechar();
      if (lista.captura_api.disponivel) {
        // Captura pela API na hora (sem IA, sem custo); falha só avisa.
        chamarPerfis<{ novos: number }>("capturar", clientId, marcaId, { perfil_id: r.perfil.id })
          .then((c) => toast.success(`${c.novos} posts capturados de @${handle}`))
          .catch((err) => avisarErro(err, `Captura de @${handle}`))
          .then(() => onAdicionado(r.perfil.id));
      }
    } catch (err) {
      avisarErro(err, "Perfil não adicionado");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog open={aberta} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="w-[calc(100vw-32px)] max-w-md">
        <DialogTitle className={texto.tituloSecao}>Adicionar a {ROTULO_DO_PAPEL[papel]}</DialogTitle>
        <DialogDescription className="sr-only">Digite o @ do perfil do Instagram ou cole o link.</DialogDescription>
        <form onSubmit={enviar} className="space-y-3">
          <CampoDeFormulario
            rotulo="@ ou link do perfil"
            apoio={lista.captura_api.disponivel ? "Captura pela API se o perfil for Business ou Creator." : "Sem captura pela API agora: depois envie prints e links."}
            erro={erro}
          >
            <input className={campo} value={valor} onChange={(e) => setValor(e.target.value)} placeholder="@perfil" autoFocus autoComplete="off" />
          </CampoDeFormulario>
          <div className="flex items-center justify-end">
            <button type="button" className={juntar(botao.discreto, "mr-2")} onClick={onFechar}>
              Cancelar
            </button>
            <button type="submit" className={botao.primario} disabled={!handle || enviando}>
              {enviando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
              Adicionar
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function PerfisDoInstagram() {
  const { clientId, marca } = useMesa();
  const marcaId = marca && !marca.principal ? marca.id : null;
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [papel, setPapel] = useEstadoDaTela<PapelDoPerfil>(`mesa:perfis:papel:${clientId}`, "referencia", { validar: validarPapel });
  const [aberto, setAberto] = useEstadoDaTela<string>(`mesa:perfis:aberto:${clientId}`, "", { validar: (v) => typeof v === "string", esperaMs: 0 });
  const [adicionando, setAdicionando] = useState(false);
  const [mudando, setMudando] = useState<string | null>(null);

  const consulta = useQuery({
    // Frente MC: a lista é da marca aberta (referências e concorrentes da CME não são os da Acerbi).
    queryKey: [...chaveDaLista(clientId), marca ? marca.id : ""],
    queryFn: async () => normalizarLista(await chamarPerfis("listar", clientId, marca ? marca.id : null)),
    staleTime: 60_000,
    placeholderData: (anterior) => anterior,
  });
  const lista = consulta.data || null;
  const perfis = useMemo(() => (lista ? lista.perfis : []), [lista]);
  const doPapel = perfis.filter((p) => p.papel === papel);
  const fotos = useFotos(clientId, perfis);
  const perfilAberto = aberto ? perfis.find((p) => p.id === aberto) || null : null;
  const reler = () => queryClient.invalidateQueries({ queryKey: chaveDaLista(clientId) });

  // Perfil lembrado que saiu da lista (arquivado em outra tela): volta para a lista.
  useEffect(() => {
    if (aberto && lista && !consulta.isFetching && !perfis.some((p) => p.id === aberto)) setAberto("");
  }, [aberto, lista, perfis, consulta.isFetching, setAberto]);

  const trocarMonitorar = async (p: PerfilNaLista, ligado: boolean) => {
    setMudando(p.id);
    try {
      await chamarPerfis("monitorar", clientId, marcaId, { perfil_id: p.id, ligado });
      toast.success(ligado ? `@${p.handle} entra na rodada da semana` : `@${p.handle} sem monitoramento`);
      await reler();
    } catch (e) {
      avisarErro(e, "Monitoramento não mudou");
    } finally {
      setMudando(null);
    }
  };

  if (consulta.isLoading && !lista) return <Carregando forma="lista" linhas={3} rotulo="Carregando os perfis" />;
  if (consulta.isError && !lista) {
    return (
      <EstadoDeErro
        descricao="Os perfis do Instagram não carregaram."
        acao={
          <button type="button" className={botao.secundario} onClick={() => void consulta.refetch()}>
            Tentar de novo
          </button>
        }
      />
    );
  }
  if (!lista) return null;
  if (lista.sql_pendente) {
    return <EstadoVazio compacto icone={<Instagram className="h-4 w-4" />} titulo="Falta o banco dos perfis" descricao={lista.aviso || "O SQL dos Perfis do Instagram ainda não foi aplicado."} />;
  }

  if (perfilAberto) {
    return (
      <Suspense fallback={<Carregando forma="aba" rotulo="Abrindo o perfil" />}>
        <PerfilAberto perfil={perfilAberto} fotoUrl={fotos.data ? fotos.data[perfilAberto.foto_caminho || ""] : undefined} capturaApi={lista.captura_api} onVoltar={() => setAberto("")} />
      </Suspense>
    );
  }

  const cheio = doPapel.length >= lista.limite_por_papel;
  return (
    <div className="min-w-0" data-perfis-do-instagram="">
      <div className="flex min-w-0 items-center">
        <SeletorCompacto
          rotulo="Tipo de perfil"
          valor={papel}
          onEscolher={(v) => setPapel(v as PapelDoPerfil)}
          opcoes={(["referencia", "concorrente"] as PapelDoPerfil[]).map((v) => ({ valor: v, rotulo: ROTULO_DO_PAPEL[v], contador: perfis.filter((p) => p.papel === v).length || null }))}
        />
        <AjudaRecolhida className="ml-1.5" rotulo="O que são os Perfis do Instagram">
          {AJUDA}
        </AjudaRecolhida>
        <button
          type="button"
          className={juntar(botao.secundario, "ml-auto")}
          onClick={() => setAdicionando(true)}
          disabled={cheio}
          title={cheio ? `Limite de ${lista.limite_por_papel}. Arquive um para trocar.` : "Adicionar perfil"}
          aria-label="Adicionar perfil"
        >
          <Plus className="h-4 w-4 sm:mr-1.5" aria-hidden="true" />
          <span className="hidden sm:inline">Adicionar</span>
        </button>
      </div>
      {!lista.captura_api.disponivel && lista.captura_api.motivo && (
        <p className={juntar(texto.auxiliar, "mt-2 truncate")} title={lista.captura_api.motivo}>
          {lista.captura_api.motivo}
        </p>
      )}
      {doPapel.length === 0 ? (
        <EstadoVazio
          compacto
          className="mt-3"
          icone={<Instagram className="h-4 w-4" />}
          titulo={papel === "concorrente" ? "Nenhum concorrente" : "Nenhuma referência"}
          descricao={`Até ${lista.limite_por_papel} por cliente.`}
        />
      ) : (
        <ul className="mt-2 divide-y divide-border" aria-label={ROTULO_DO_PAPEL[papel]}>
          {doPapel.map((p) => (
            <LinhaDoPerfil
              key={p.id}
              p={p}
              foto={fotos.data ? fotos.data[p.foto_caminho || ""] : undefined}
              onAbrir={() => setAberto(p.id)}
              onMonitorar={(ligado) => void trocarMonitorar(p, ligado)}
              mudando={mudando === p.id}
            />
          ))}
        </ul>
      )}
      {papel === "concorrente" && <MudancasDosConcorrentes mudancas={lista.mudancas} />}
      <JanelaDeAdicionar aberta={adicionando} onFechar={() => setAdicionando(false)} papel={papel} lista={lista} onAdicionado={() => void reler()} />
    </div>
  );
}
