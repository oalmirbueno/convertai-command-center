import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { CheckCircle2, Clock, Link2Off, Loader2, RotateCcw, Send, Users } from "lucide-react";
import { toast } from "sonner";
import { fireWebhook, webhooks } from "@/lib/webhooks";
import { safeStorage } from "@/lib/safeStorage";
import {
  BarraDeAcoes,
  Carregando,
  CampoDeFormulario,
  EstadoDeErro,
  EstadoVazio,
  GrupoDeCampos,
  Secao,
  botao,
  juntar,
  superficie,
  texto,
} from "@/components/sistema";
import CascaPublica, { campoTextoPublico } from "@/components/publico/CascaPublica";
import CampoDoBriefingUI, { idDoCampo } from "@/components/briefing/CamposDoBriefing";
import RespostasEmLeitura from "@/components/briefing/RespostasEmLeitura";
import {
  type BriefingPublico,
  abrirBriefingPublico,
  anexarArquivo,
  enviarBriefing,
  capaDoBriefing,
  pedirDecupagem,
  pedirReabertura,
  removerAnexo,
  salvarParcial,
  transcreverAudio,
  textoDoErroDoBriefing,
} from "@/lib/briefing/api";
import {
  type AnexoDoBriefing,
  type CampoDoBriefing,
  type Respostas,
  ANEXO_MAX_BYTES,
  campoVisivel,
  erroDoCampo,
  faltandoNoBriefing,
  modeloDoLink,
  progressoDoBriefing,
} from "../../supabase/functions/_shared/briefing-modelos";
import { juntarTranscricao } from "../../supabase/functions/briefing-publico/modulos/briefing-audio";

/**
 * Página pública do briefing (/briefing/:token), frente BRF (30/09/2026).
 *
 * Um link, qualquer modelo (diagnóstico, site, landing, identidade, naming,
 * redes e peças, vídeo). O que ela garante:
 * - salva sozinha no servidor (por chave, a cada pausa) e no aparelho: dá
 *   para fechar e voltar pelo mesmo link, de outro aparelho inclusive;
 * - a equipe pode preencher junto, na mesma tela, logada (aviso no topo);
 * - envio único: depois de enviado fica travado, com "Pedir reabertura";
 * - link expirado diz que expirou (nunca finge que salvou);
 * - falha de rede nunca vira "link inválido" nem apaga o que foi respondido.
 * Chaves do aparelho de antes (briefing_answers_<token>) continuam valendo.
 */
type Fase = "carregando" | "falha_ao_abrir" | "invalido" | "expirado" | "respondendo" | "enviando" | "falha_ao_enviar" | "enviado" | "concluido";

const chaveDasRespostas = (token: string) => `briefing_answers_${token}`;
const chaveDoIndice = (token: string) => `briefing_idx_${token}`;
const chaveDoPendente = (token: string) => `briefing_pendente_${token}`;
const ESPERA_PARA_SALVAR_MS = 1200;

function lerLocal(token: string): { respostas: Respostas | null; pendentes: string[] | null } {
  let respostas: Respostas | null = null;
  let pendentes: string[] | null = null;
  try {
    const bruto = safeStorage.get(chaveDasRespostas(token));
    if (bruto) respostas = JSON.parse(bruto);
  } catch { /* ignora */ }
  try {
    const bruto = safeStorage.get(chaveDoPendente(token));
    if (bruto) pendentes = JSON.parse(bruto);
  } catch { /* ignora */ }
  return { respostas: respostas && typeof respostas === "object" ? respostas : null, pendentes: Array.isArray(pendentes) ? pendentes : null };
}

function limparLocal(token: string) {
  safeStorage.remove(chaveDasRespostas(token));
  safeStorage.remove(chaveDoIndice(token));
  safeStorage.remove(chaveDoPendente(token));
}

const hora = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
};
const dia = (iso: string | null | undefined) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
};

export default function BriefingPublic() {
  const { token = "" } = useParams<{ token: string }>();
  const [fase, setFase] = useState<Fase>("carregando");
  const [dados, setDados] = useState<BriefingPublico | null>(null);
  const [respostas, setRespostas] = useState<Respostas>({});
  const [anexos, setAnexos] = useState<AnexoDoBriefing[]>([]);
  const [retomou, setRetomou] = useState(false);
  const [tentativa, setTentativa] = useState(0);
  const [mostrarErros, setMostrarErros] = useState(false);
  const [salvo, setSalvo] = useState<{ estado: "salvo" | "salvando" | "local"; em?: string | null }>({ estado: "salvo" });
  const [enviandoAnexo, setEnviandoAnexo] = useState(false);
  const [logo, setLogo] = useState<string | null>(null);
  const [agencia, setAgencia] = useState<string | null>(null);
  const pendentes = useRef<Set<string>>(new Set());
  const respostasRef = useRef<Respostas>({});
  const timer = useRef<number | null>(null);
  respostasRef.current = respostas;

  const modelo = useMemo(() => modeloDoLink(dados?.modelo, dados?.modelo_conteudo), [dados?.modelo, dados?.modelo_conteudo]);
  const prefill = (dados?.prefill || {}) as Record<string, string>;
  const ehDiagnostico = modelo.slug === "diagnostico";

  // ---------------------------------------------------------------- abrir
  useEffect(() => {
    if (!token) {
      setFase("invalido");
      return;
    }
    let vivo = true;
    setFase("carregando");
    (async () => {
      let b: BriefingPublico | null = null;
      try {
        b = await abrirBriefingPublico(token);
      } catch (e) {
        if (!vivo) return;
        // Rede ou servidor fora: não é link inválido e o que foi respondido fica.
        console.error("[briefing] falha ao abrir:", e);
        setFase("falha_ao_abrir");
        return;
      }
      if (!vivo) return;
      if (!b) {
        limparLocal(token);
        setFase("invalido");
        return;
      }
      setDados(b);
      if (b.expirado) {
        setFase("expirado");
        return;
      }
      const doServidor = (b.responses || {}) as Respostas;
      setAnexos(b.anexos || []);
      if (b.submitted) {
        limparLocal(token);
        setRespostas(doServidor);
        setFase("enviado");
        return;
      }
      // Junta o que está no aparelho: as chaves que não chegaram ao servidor vencem;
      // do formato antigo (sem a lista de pendentes), só o que o servidor não tem.
      const local = lerLocal(token);
      const juntas: Respostas = { ...doServidor };
      const pend = new Set<string>();
      if (local.respostas) {
        Object.keys(local.respostas).forEach((k) => {
          const vale = local.pendentes ? local.pendentes.indexOf(k) >= 0 : !(k in doServidor);
          if (vale) {
            juntas[k] = local.respostas![k];
            pend.add(k);
          }
        });
      }
      pendentes.current = pend;
      setRespostas(juntas);
      const temAlgo = Object.keys(juntas).some((k) => {
        const v = juntas[k];
        return Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.trim().length > 0 : v != null;
      });
      setRetomou(temAlgo || Number(safeStorage.get(chaveDoIndice(token)) || 0) > 0);
      setSalvo({ estado: pend.size ? "local" : "salvo", em: b.rascunho_salvo_em });
      setFase("respondendo");
      if (b.tem_cliente) {
        capaDoBriefing(token).then(
          (c) => {
            setLogo(c.logo);
            setAgencia(c.agencia);
          },
          (e) => console.error("[briefing] capa do briefing:", e),
        );
      }
    })();
    return () => {
      vivo = false;
    };
  }, [token, tentativa]);

  // ---------------------------------------------------------------- salvar
  const guardarNoAparelho = useCallback(() => {
    if (!token) return;
    safeStorage.set(chaveDasRespostas(token), JSON.stringify(respostasRef.current));
    safeStorage.set(chaveDoPendente(token), JSON.stringify(Array.from(pendentes.current)));
  }, [token]);

  const salvarAgora = useCallback(async (): Promise<boolean> => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const chaves = Array.from(pendentes.current);
    if (!chaves.length) return true;
    const enviadas: Respostas = {};
    chaves.forEach((k) => {
      enviadas[k] = respostasRef.current[k] === undefined ? null : respostasRef.current[k];
    });
    setSalvo((s) => ({ estado: "salvando", em: s.em }));
    try {
      const r = await salvarParcial(token, enviadas);
      if (!r.ok) {
        if (r.motivo === "enviado" || r.motivo === "expirado" || r.motivo === "inexistente") {
          setTentativa((n) => n + 1);
          return false;
        }
        if (r.motivo === "grande") toast.error("As respostas passaram do tamanho aceito. Encurte os textos longos.");
        setSalvo((s) => ({ estado: "local", em: s.em }));
        return false;
      }
      // Só sai da fila o que não mudou enquanto salvava.
      chaves.forEach((k) => {
        if (JSON.stringify(respostasRef.current[k] ?? null) === JSON.stringify(enviadas[k] ?? null)) pendentes.current.delete(k);
      });
      // O que outra pessoa salvou (outra tela, reunião) aparece aqui, sem pisar no que está pendente.
      if (r.respostas) {
        setRespostas((atual) => {
          const novo: Respostas = { ...(r.respostas as Respostas) };
          pendentes.current.forEach((k) => {
            novo[k] = atual[k];
          });
          return novo;
        });
      }
      guardarNoAparelho();
      setSalvo({ estado: pendentes.current.size ? "local" : "salvo", em: r.salvo_em || new Date().toISOString() });
      return pendentes.current.size === 0;
    } catch (e) {
      console.error("[briefing] falha ao salvar:", e);
      setSalvo((s) => ({ estado: "local", em: s.em }));
      return false;
    }
  }, [token, guardarNoAparelho]);

  const agendarSalvar = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void salvarAgora(), ESPERA_PARA_SALVAR_MS);
  }, [salvarAgora]);

  useEffect(() => {
    if (fase !== "respondendo") return;
    const sair = () => {
      if (pendentes.current.size) void salvarAgora();
    };
    window.addEventListener("pagehide", sair);
    return () => window.removeEventListener("pagehide", sair);
  }, [fase, salvarAgora]);

  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  const mudar = useCallback((key: string, valor: unknown) => {
    // Na hora (sem esperar o render): duas mudanças seguidas (confirmar = valor + ok) não se perdem.
    const novo = { ...respostasRef.current };
    if (valor === null || valor === undefined) delete novo[key];
    else novo[key] = valor;
    respostasRef.current = novo;
    setRespostas(novo);
    pendentes.current.add(key);
    guardarNoAparelho();
    setSalvo((s) => ({ estado: "local", em: s.em }));
    agendarSalvar();
  }, [agendarSalvar, guardarNoAparelho]);

  // ---------------------------------------------------------------- anexos
  const anexar = useCallback(async (campo: CampoDoBriefing, arquivos: File[]): Promise<AnexoDoBriefing[]> => {
    const prontos: AnexoDoBriefing[] = [];
    setEnviandoAnexo(true);
    try {
      for (const arq of arquivos.slice(0, 10)) {
        if (arq.size > ANEXO_MAX_BYTES) {
          toast.error(`${arq.name}: passa de 25 MB.`);
          continue;
        }
        try {
          const a = await anexarArquivo(token, arq, campo.key, campo.categoria || "referencias");
          prontos.push(a);
          setAnexos((lista) => lista.concat(a));
        } catch (e) {
          console.error("[briefing] anexo falhou:", e);
          toast.error(`${arq.name}: ${textoDoErroDoBriefing(e)}`);
        }
      }
    } finally {
      setEnviandoAnexo(false);
    }
    return prontos;
  }, [token]);

  const tirarAnexo = useCallback(async (a: AnexoDoBriefing) => {
    setAnexos((lista) => lista.filter((x) => x.id !== a.id));
    try {
      await removerAnexo(token, a.id);
    } catch (e) {
      console.error("[briefing] tirar anexo falhou:", e);
      toast.error(`Não foi possível tirar ${a.nome}: ${textoDoErroDoBriefing(e)}`);
      setAnexos((lista) => (lista.some((x) => x.id === a.id) ? lista : lista.concat(a)));
    }
  }, [token]);

  // ---------------------------------------------------------------- áudio (frente BRF2)
  const transcrever = useCallback(async (campo: CampoDoBriefing, audio: Blob, segundos: number) => {
    try {
      const r = await transcreverAudio(token, audio, campo.key, segundos);
      const atual = typeof respostasRef.current[campo.key] === "string" ? (respostasRef.current[campo.key] as string) : "";
      let novo = juntarTranscricao(atual, r.texto, true);
      if (campo.maxChars && novo.length > campo.maxChars) {
        novo = novo.slice(0, campo.maxChars);
        toast.info("A transcrição passou do limite desta pergunta e foi cortada. Confira o final.");
      }
      mudar(campo.key, novo);
    } catch (e) {
      console.error("[briefing] transcrição falhou:", e);
      throw new Error(textoDoErroDoBriefing(e, "Não foi possível transcrever. Escreva a resposta ou tente de novo."));
    }
  }, [token, mudar]);

  // ---------------------------------------------------------------- enviar
  const faltando = useMemo(() => faltandoNoBriefing(modelo, respostas, anexos), [modelo, respostas, anexos]);
  const progresso = useMemo(() => progressoDoBriefing(modelo, respostas, anexos), [modelo, respostas, anexos]);

  const enviar = async () => {
    if (faltando.length) {
      setMostrarErros(true);
      const alvo = document.getElementById(idDoCampo(faltando[0].key));
      if (alvo) {
        try {
          alvo.scrollIntoView({ behavior: "smooth", block: "center" });
        } catch {
          if (typeof alvo.scrollIntoView === "function") alvo.scrollIntoView();
        }
        try {
          (alvo as HTMLElement).focus({ preventScroll: true } as FocusOptions);
        } catch { /* sem foco */ }
      }
      return;
    }
    setFase("enviando");
    let aceito = false;
    try {
      aceito = await enviarBriefing(token, respostasRef.current);
    } catch (e) {
      console.error("[briefing] falha ao enviar:", e);
    }
    if (!aceito) {
      // Recusado: pode ter expirado ou sido enviado em outra tela. Relê para mostrar o certo.
      try {
        const b = await abrirBriefingPublico(token);
        if (b && (b.submitted || b.expirado)) {
          setTentativa((n) => n + 1);
          return;
        }
      } catch { /* segue como falha de envio */ }
      setFase("falha_ao_enviar");
      return;
    }
    limparLocal(token);
    pendentes.current.clear();
    void pedirDecupagem(token);
    if (ehDiagnostico) {
      fireWebhook(webhooks.processDiagnostic, {
        diagnostic_id: dados?.id,
        client_name: String(respostasRef.current.companyName || "Sem nome"),
        company: String(respostasRef.current.companyName || ""),
        answers: respostasRef.current,
      });
    }
    setFase("concluido");
  };

  // ---------------------------------------------------------------- telas
  const marcaDoCliente = dados?.marca_nome || dados?.cliente_nome || "";
  const cabecalhoDoCliente = marcaDoCliente ? (
    <div className="mb-5 flex min-w-0 items-center">
      {logo ? (
        <img src={logo} alt={marcaDoCliente} className="mr-3 h-10 w-10 shrink-0 rounded-md bg-white object-contain p-1" />
      ) : (
        <span className="mr-3 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary/15 text-[15px] font-semibold text-primary" aria-hidden="true">
          {marcaDoCliente.charAt(0).toUpperCase()}
        </span>
      )}
      <span className="min-w-0">
        <span className={juntar(texto.rotulo, "block truncate")}>{agencia ? `${agencia} preparou para` : "Preparado para"}</span>
        <span className="block truncate text-[15px] font-semibold leading-5 text-foreground">{marcaDoCliente}</span>
      </span>
    </div>
  ) : null;

  if (fase === "carregando") {
    return (
      <CascaPublica largura="larga" centralizar={false}>
        <Carregando forma="aba" rotulo="Abrindo o briefing" />
      </CascaPublica>
    );
  }

  if (fase === "falha_ao_abrir") {
    return (
      <CascaPublica largura="larga" centralizar={false}>
        <EstadoDeErro
          titulo="Não foi possível carregar."
          descricao="Confira a internet e tente de novo. O link continua valendo e o que você já respondeu está guardado."
          acao={<button type="button" onClick={() => setTentativa((n) => n + 1)} className={botao.primario}>Tentar de novo</button>}
        />
      </CascaPublica>
    );
  }

  if (fase === "invalido") {
    return (
      <CascaPublica largura="larga" centralizar={false}>
        <EstadoVazio icone={<Link2Off className="h-5 w-5" />} titulo="Link inválido ou já utilizado" descricao="Este briefing já foi enviado ou o link não existe mais." />
      </CascaPublica>
    );
  }

  if (fase === "expirado") {
    return (
      <CascaPublica largura="larga" centralizar={false}>
        {cabecalhoDoCliente}
        <EstadoVazio
          icone={<Clock className="h-5 w-5" />}
          titulo="Este link expirou"
          descricao={`O prazo para responder terminou${dados?.expira_em ? ` em ${dia(dados.expira_em)}` : ""}. Peça um novo link à equipe da Aceleriq: o que já foi salvo continua lá.`}
        />
      </CascaPublica>
    );
  }

  if (fase === "concluido") {
    return (
      <CascaPublica
        largura="larga"
        centralizar={false}
        titulo={ehDiagnostico ? "Diagnóstico enviado" : "Briefing enviado"}
        descricao="Obrigado pelo tempo."
        ajuda="Cada resposta ajuda a montar o melhor trabalho para o seu negócio."
        acimaDoTitulo={
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary/15 text-primary" aria-hidden="true">
            <CheckCircle2 className="h-6 w-6" />
          </div>
        }
      >
        <Secao divisoria titulo="O que acontece agora" recolher={false}>
          <ol className="divide-y divide-border">
            {modelo.proximosPassos.map((p, i) => (
              <li key={p.titulo} className="flex min-w-0 items-start py-3">
                <span className={juntar("mr-3 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums", i === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{i + 1}</span>
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-foreground">{p.titulo}</span>
                  <span className={juntar(texto.auxiliar, "block leading-5")}>{p.texto}</span>
                </span>
              </li>
            ))}
          </ol>
        </Secao>
      </CascaPublica>
    );
  }

  if (fase === "enviado") {
    return <EnviadoTravado token={token} dados={dados!} modelo={modelo} respostas={respostas} anexos={anexos} cabecalho={cabecalhoDoCliente} />;
  }

  const enviandoTudo = fase === "enviando";
  const statusDoSalvar =
    salvo.estado === "salvando" ? "Salvando..." : salvo.estado === "local" ? "Salvo neste aparelho" : salvo.em ? `Salvo às ${hora(salvo.em)}` : "Salva sozinho";

  return (
    <CascaPublica
      largura="larga"
      centralizar={false}
      titulo={dados?.titulo || modelo.titulo}
      descricao={modelo.slug === "diagnostico" ? modelo.descricao : `${modelo.descricao}${dados?.expira_em ? ` · até ${dia(dados.expira_em)}` : ""}`}
      ajuda={modelo.ajuda}
      aoLadoDaMarca={<span className={juntar(texto.auxiliar, "tabular-nums")} aria-live="polite">{statusDoSalvar}</span>}
      acimaDoTitulo={cabecalhoDoCliente}
    >
      {dados?.equipe && (
        <p className={juntar(superficie.poco, texto.corpo, "mb-4 flex items-center px-3 py-2")}>
          <Users className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          Você está como equipe. Preencha junto com o cliente: tudo salva neste mesmo link.
        </p>
      )}
      {retomou && (
        <p className={juntar(superficie.poco, texto.corpo, "px-3 py-2")}>
          Você já tinha começado. As respostas salvas estão abaixo: continue de onde parou.
        </p>
      )}

      <div className={juntar(retomou && "mt-6", "space-y-8")}>
        {modelo.blocos.map((bloco, i) => {
          const visiveis = bloco.campos.filter((c) => campoVisivel(c, respostas));
          if (!visiveis.length) return null;
          return (
            <Secao key={bloco.id} divisoria={i > 0} recolher={false}>
              <GrupoDeCampos titulo={bloco.titulo}>
                {visiveis.map((c) => (
                  <CampoDoBriefingUI
                    key={c.key}
                    campo={c}
                    respostas={respostas}
                    prefill={prefill}
                    anexos={anexos}
                    erro={mostrarErros ? erroDoCampo(c, respostas, anexos) : null}
                    enviando={enviandoAnexo}
                    somenteLeitura={enviandoTudo}
                    onMudar={mudar}
                    onAnexar={anexar}
                    onRemoverAnexo={(a) => void tirarAnexo(a)}
                    onTranscrever={dados?.tem_cliente ? transcrever : undefined}
                  />
                ))}
              </GrupoDeCampos>
            </Secao>
          );
        })}
      </div>

      {fase === "falha_ao_enviar" && (
        <EstadoDeErro className="mt-6" titulo="Não conseguimos enviar." descricao="Suas respostas continuam aqui, nada foi perdido. Confira a internet e envie de novo." />
      )}

      <BarraDeAcoes
        fixa
        className="mt-6"
        inicio={
          <span className="flex min-w-0 items-center">
            <span className="mr-2 hidden h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-muted sm:block" aria-hidden="true">
              <span className="block h-full rounded-full bg-primary transition-all" style={{ width: `${progresso.pct}%` }} />
            </span>
            <span className="truncate tabular-nums">
              {progresso.respondidos} de {progresso.total} respondidas
              {mostrarErros && faltando.length > 0 ? <span className="text-destructive"> · faltam {faltando.length}</span> : null}
            </span>
          </span>
        }
      >
        <button type="button" onClick={() => void enviar()} disabled={enviandoTudo || enviandoAnexo} className={botao.primario}>
          {enviandoTudo ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          {enviandoTudo ? "Enviando..." : fase === "falha_ao_enviar" ? "Enviar de novo" : ehDiagnostico ? "Enviar diagnóstico" : "Enviar briefing"}
        </button>
      </BarraDeAcoes>
    </CascaPublica>
  );
}

/** Depois de enviado: o que foi respondido, travado, com o pedido de reabertura. */
function EnviadoTravado({
  token,
  dados,
  modelo,
  respostas,
  anexos,
  cabecalho,
}: {
  token: string;
  dados: BriefingPublico;
  modelo: ReturnType<typeof modeloDoLink>;
  respostas: Respostas;
  anexos: AnexoDoBriefing[];
  cabecalho: React.ReactNode;
}) {
  const [pedindo, setPedindo] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [pedidoEm, setPedidoEm] = useState<string | null>(dados.reabertura_pedida_em || null);
  const [abrirPedido, setAbrirPedido] = useState(false);

  const pedir = async () => {
    setPedindo(true);
    try {
      const ok = await pedirReabertura(token, motivo);
      if (!ok) throw new Error("O pedido não foi aceito. Recarregue a página.");
      setPedidoEm(new Date().toISOString());
      setAbrirPedido(false);
      toast.success("Pedido enviado. A equipe reabre o link e avisa você.");
    } catch (e) {
      console.error("[briefing] pedido de reabertura falhou:", e);
      toast.error(textoDoErroDoBriefing(e, "Não foi possível pedir agora. Tente de novo."));
    } finally {
      setPedindo(false);
    }
  };

  return (
    <CascaPublica
      largura="larga"
      centralizar={false}
      titulo={dados.titulo || modelo.titulo}
      descricao={dados.enviado_em ? `Enviado em ${dia(dados.enviado_em)} às ${hora(dados.enviado_em)}` : "Enviado"}
      ajuda="Depois de enviado, o briefing fica travado para a equipe trabalhar com a versão que você mandou. Precisa mudar algo? Peça a reabertura: a equipe libera o mesmo link."
      acimaDoTitulo={cabecalho}
    >
      <div className={juntar(superficie.poco, "mb-6 min-w-0 px-3 py-3")}>
        {pedidoEm ? (
          <p className={juntar(texto.corpo, "flex items-center")}>
            <RotateCcw className="mr-2 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
            Reabertura pedida em {dia(pedidoEm)}. A equipe libera o link e avisa você.
          </p>
        ) : abrirPedido ? (
          <div className="min-w-0">
            <CampoDeFormulario rotulo="O que você quer mudar" apoio="Opcional. Ajuda a equipe a entender.">
              <textarea value={motivo} onChange={(e) => setMotivo(e.target.value.slice(0, 500))} rows={3} className={juntar(campoTextoPublico, "resize-none")} />
            </CampoDeFormulario>
            <div className="mt-3 flex justify-end [&>*+*]:ml-2">
              <button type="button" onClick={() => setAbrirPedido(false)} disabled={pedindo} className={botao.secundario}>Cancelar</button>
              <button type="button" onClick={() => void pedir()} disabled={pedindo} className={botao.primario}>
                {pedindo && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" />}
                Enviar pedido
              </button>
            </div>
          </div>
        ) : (
          <div className="flex min-w-0 flex-wrap items-center">
            <p className={juntar(texto.corpo, "mr-3 min-w-0 flex-1")}>Briefing recebido e travado para edição.</p>
            <button type="button" onClick={() => setAbrirPedido(true)} className={juntar(botao.secundario, "mt-2 sm:mt-0")}>
              <RotateCcw className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Pedir reabertura
            </button>
          </div>
        )}
      </div>
      <RespostasEmLeitura modelo={modelo} respostas={respostas} anexos={anexos} />
    </CascaPublica>
  );
}
