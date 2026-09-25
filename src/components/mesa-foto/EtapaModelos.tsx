import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { AlertTriangle, Check, Crown, Images, Loader2, Plus, RefreshCw, ScanSearch, ShieldCheck, Sparkles, UserRound, Wand2, Workflow, X, ZoomIn } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Ampliar, type ImagemAmpliavel } from "@/components/mesa/Ampliar";
import { AvisoDeErro, BotaoComCusto, useAvisarErro } from "@/components/mesa/Custo";
import { ImagemDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { SeletorDeQualidade } from "@/components/mesa/Seletores";
import { padraoPara, precoDoModelo, textoDoErro, usd, type Qualidade } from "@/lib/mesa/api";
import { useCampanhaEscolhida } from "./CampanhaDaMesa";
import { Cartao, MiniaturaDaFoto, Moldura, Pilulas, useMesaFoto, Vazio } from "./Comuns";
import { ZonaDeEnvio } from "./EtapaAcervo";
import SeletorDeFotos from "./SeletorDeFotos";
import { acrescentarFotos, invalidarFotos, subirOriginais, useFotos } from "./fotoApi";
import {
  acharNoCatalogo,
  aplicarSugestaoNaPersona,
  candidatasPorMotor,
  caminhoDaImagem,
  chaveDasImagensDaPersona,
  chaveDasPersonas,
  chaveDoAndamento,
  conferirImagemDaPersona,
  criarPersona,
  decidirImagemDaPersona,
  detalharImagem,
  emParalelo,
  escolherAncora,
  extrasDaEstimativaDaCandidata,
  extrasDaEstimativaDoDetalhe,
  gerarCandidata,
  gerarVista,
  GENEROS,
  guardarImagemDaPersona,
  guardarPersona,
  IDADE_MINIMA,
  letraDoMotor,
  marcarAndamento,
  MOTOR_DO_DETALHE,
  motoresDaRodada,
  novoIdDeRodada,
  partesDaConferenciaDaPersona,
  partesDaRodada,
  partesDaSugestaoDePersona,
  partesDaVista,
  pedirAoCanvas,
  problemasDaPersona,
  proporcaoDaImagem,
  rascunhoVazio,
  resumoDaPersona,
  rotuloDaVista,
  sugerirPersona,
  rotuloDoMotor,
  STATUS_DA_PERSONA,
  useAncoras,
  useAndamentos,
  useImagensDaPersona,
  usePersonas,
  usePrecoNoServidor,
  USOS_DA_REFERENCIA,
  VISTAS_DA_FOLHA,
  type ConferenciaDaPersona,
  type ImagemDaPersona,
  type OpcaoDeMotor,
  type Persona,
  type RascunhoDaPersona,
  type SugestaoDePersona,
  type UsoDaReferencia,
} from "./modelosApi";

/**
 * Modelos (docs/mesa-foto/MODELOS-E-CANVAS.md, seção 9.1): a galeria das
 * personas sintéticas do cliente e da agência, e o caminho de cada uma:
 * ficha, rodada lado a lado com vários geradores (o dono escolhe a mais
 * real), âncora, folha de 6 vistas e "Detalhar em 4K" com antes e depois.
 *
 * 25/09 (pedido do dono: "dá para simplificar e preencher com base no
 * brief"): a ficha nova começa em "Sugerir pelo brief" (modelo_sugerir, que
 * lê o contexto do cliente que a Mesa usa e a campanha escolhida ou do mês);
 * na tela ficam nome, idade, apresentação e estilo, e o resto em "Mais
 * detalhes".
 *
 * Regras: pessoa sintética e adulta (idade aparente mínima 21), sem
 * semelhança com pessoa real (referência do dono só como estilo, pose, luz ou
 * roupa), toda imagem com o selo de gerada, conferência só como aviso (sem
 * laço, sem escolha automática), custo sempre antes. Nada escurece a foto.
 */

const MAX_REFERENCIAS = 4;
const FILTROS = [
  { valor: "todas" as const, rotulo: "Todas" },
  { valor: "cliente" as const, rotulo: "Do cliente" },
  { valor: "agencia" as const, rotulo: "Da agência" },
];
type Filtro = (typeof FILTROS)[number]["valor"];

const chaveDaEscolhida = (clientId: string) => `mesa-foto:persona:${clientId}`;
function lerEscolhida(clientId: string): string | null {
  try {
    return window.sessionStorage.getItem(chaveDaEscolhida(clientId));
  } catch {
    return null;
  }
}
function gravarEscolhida(clientId: string, id: string | null) {
  try {
    if (id) window.sessionStorage.setItem(chaveDaEscolhida(clientId), id);
    else window.sessionStorage.removeItem(chaveDaEscolhida(clientId));
  } catch {
    /* sem armazenamento: abre a primeira */
  }
}

// ------------------------------------------------------------------ peças

/** Pílula "gerada" em cima da imagem (clara, nunca véu escuro). */
function SeloGerada() {
  return (
    <span className="pointer-events-none absolute left-1 top-1 inline-flex items-center rounded-full border border-primary/30 bg-card px-1.5 py-px text-[9.5px] font-semibold text-primary" data-selo="gerada">
      <Sparkles className="mr-0.5 h-2.5 w-2.5" /> gerada
    </span>
  );
}

function ImagemDaPersonaNaTela({ imagem, alt, className = "" }: { imagem: ImagemDaPersona; alt: string; className?: string }) {
  return <ImagemDaMesa caminho={caminhoDaImagem(imagem)} bucket={imagem.storage_bucket || "mesa"} alt={alt} className={`h-full w-full ${className}`} />;
}

const ampliavel = (i: ImagemDaPersona, titulo: string): ImagemAmpliavel => ({
  caminho: caminhoDaImagem(i),
  bucket: i.storage_bucket || "mesa",
  titulo: `${titulo} (gerada)`,
  legenda: "Pessoa sintética gerada por IA. Ao publicar, ligue o rótulo de IA.",
  proporcao: proporcaoDaImagem(i),
});

function NotasDaConferencia({ conferencia }: { conferencia: ConferenciaDaPersona }) {
  return (
    <div className="mt-1.5 min-w-0 rounded-md border border-border bg-background p-1.5 text-[10.5px] leading-snug" data-conferencia="">
      <p className="mb-0.5 font-medium text-muted-foreground">Conferência (aviso, você decide)</p>
      {conferencia.alertas.map((a) => (
        <p key={a} className="flex items-start text-warning [overflow-wrap:anywhere]">
          <AlertTriangle className="mr-1 mt-px h-3 w-3 shrink-0" /> {a}
        </p>
      ))}
      {conferencia.pontos.map((p) => (
        <p key={p.criterio} className={p.ok === false ? "text-warning" : "text-muted-foreground"}>
          {p.ok === false ? "Atenção" : "Ok"}: {p.criterio}
          {p.nota ? `, ${p.nota}` : ""}
        </p>
      ))}
      {conferencia.notas.length > 0 && (
        <p className="text-muted-foreground">
          {conferencia.notas.map((n) => `${n.criterio} ${Math.round(n.valor * (n.valor <= 1 ? 100 : 1))}`).join(" · ")}
        </p>
      )}
      {conferencia.observado.slice(0, 4).map((o) => (
        <p key={o} className="text-muted-foreground [overflow-wrap:anywhere]">
          {o}
        </p>
      ))}
    </div>
  );
}

function BotaoConferir({ persona, imagem, onConferencia }: { persona: Persona; imagem: ImagemDaPersona; onConferencia: (c: ConferenciaDaPersona | null) => void }) {
  const { clientId, catalogo } = useMesa();
  return (
    <BotaoComCusto
      rotulo={
        <>
          <ScanSearch className="mr-1 h-3 w-3" /> Conferir
        </>
      }
      titulo="Conferência pronta"
      descricao="A visão descreve pele, olhos, mãos, luz e se lembra alguém conhecido. É só aviso: quem escolhe é você."
      variant="ghost"
      className="h-7 px-1.5 text-[11px]"
      partes={() => partesDaConferenciaDaPersona(padraoPara(catalogo, "leitura"))}
      executar={() => conferirImagemDaPersona(clientId, persona.id, imagem.id)}
      aoConcluir={(data) => onConferencia(data ? data.conferencia : null)}
    />
  );
}

// ------------------------------------------------------------------ gerar fora da tela

function avisarFimDoLote(rotulo: string, feitas: number, falhas: number, custo: number, atualizar: () => void) {
  atualizar();
  if (feitas) toast.success(`${feitas} ${feitas === 1 ? rotulo : `${rotulo}s`} pronta${feitas === 1 ? "" : "s"}`, { description: `Custo real: ${usd(custo)}.${falhas ? ` ${falhas} não saiu; tente de novo nesse motor.` : ""}` });
  else if (falhas) toast.error("Nenhuma imagem saiu", { description: "Veja o erro em cada motor e tente de novo." });
}

/**
 * A rodada: uma chamada de modelo_candidata_gerar por motor, todas juntas.
 * Erro de um motor fica escrito na coluna dele, sem derrubar os outros.
 */
async function rodarCandidatas(p: {
  queryClient: QueryClient;
  clientId: string;
  persona: Persona;
  motores: OpcaoDeMotor[];
  qualidade: Qualidade;
  pedido: string;
  atualizar: () => void;
}) {
  let feitas = 0;
  let falhas = 0;
  let custo = 0;
  // Uma rodada = um id só, criado aqui: as chamadas saem juntas, nenhuma espera a outra.
  const rodadaId = novoIdDeRodada();
  p.motores.forEach((m) => marcarAndamento(chaveDoAndamento(p.persona.id, "candidata", m.id), { estado: "gerando", erro: "" }));
  await emParalelo(p.motores, 4, async (m) => {
    const chave = chaveDoAndamento(p.persona.id, "candidata", m.id);
    try {
      const r = await gerarCandidata({ clientId: p.clientId, modeloId: p.persona.id, motorId: m.id, resolucao: m.resolucao, qualidade: p.qualidade, pedido: p.pedido, rodadaId });
      if (r.imagem) guardarImagemDaPersona(p.queryClient, { ...r.imagem, motor_id: r.imagem.motor_id || m.id });
      custo += Number(r.custo_usd || 0);
      feitas++;
      marcarAndamento(chave, null);
    } catch (e) {
      falhas++;
      marcarAndamento(chave, { estado: "falhou", erro: textoDoErro(e) });
    }
  });
  void p.queryClient.invalidateQueries({ queryKey: chaveDasImagensDaPersona(p.persona.id) });
  void p.queryClient.invalidateQueries({ queryKey: chaveDasPersonas(p.clientId) });
  avisarFimDoLote("candidata", feitas, falhas, custo, p.atualizar);
}

async function rodarVistas(p: { queryClient: QueryClient; clientId: string; persona: Persona; vistas: string[]; qualidade: Qualidade; atualizar: () => void }) {
  let feitas = 0;
  let falhas = 0;
  let custo = 0;
  p.vistas.forEach((v) => marcarAndamento(chaveDoAndamento(p.persona.id, "vista", v), { estado: "gerando", erro: "" }));
  // Vistas em até 3 juntas: cada uma usa a âncora como referência.
  await emParalelo(p.vistas, 3, async (v) => {
    const chave = chaveDoAndamento(p.persona.id, "vista", v);
    try {
      // O gerador é o da âncora, escolhido pela função.
      const r = await gerarVista({ clientId: p.clientId, modeloId: p.persona.id, vista: v, qualidade: p.qualidade });
      if (r.imagem) guardarImagemDaPersona(p.queryClient, { ...r.imagem, papel: "vista", vista: r.imagem.vista || v });
      if (r.persona) guardarPersona(p.queryClient, p.clientId, r.persona);
      custo += Number(r.custo_usd || 0);
      feitas++;
      marcarAndamento(chave, null);
    } catch (e) {
      falhas++;
      marcarAndamento(chave, { estado: "falhou", erro: textoDoErro(e) });
    }
  });
  void p.queryClient.invalidateQueries({ queryKey: chaveDasImagensDaPersona(p.persona.id) });
  void p.queryClient.invalidateQueries({ queryKey: chaveDasPersonas(p.clientId) });
  avisarFimDoLote("vista", feitas, falhas, custo, p.atualizar);
}

// ------------------------------------------------------------------ galeria

function CartaoDaPersona({ persona, ancora, ativa, onAbrir }: { persona: Persona; ancora: ImagemDaPersona | null; ativa: boolean; onAbrir: () => void }) {
  const status = STATUS_DA_PERSONA[persona.status];
  return (
    <li className="min-w-0" data-persona={persona.id}>
      <button
        type="button"
        onClick={onAbrir}
        aria-pressed={ativa}
        aria-label={`Abrir a persona ${persona.nome}`}
        className={`block w-full min-w-0 rounded-xl border p-1.5 text-left transition-colors ${ativa ? "border-primary bg-primary/5" : "border-border bg-card hover:border-primary/40"}`}
      >
        <Moldura proporcao={0.8}>
          {ancora ? (
            <>
              <ImagemDaPersonaNaTela imagem={ancora} alt={persona.nome} />
              <SeloGerada />
            </>
          ) : (
            <span className="flex h-full w-full items-center justify-center text-muted-foreground">
              <UserRound className="h-6 w-6" />
            </span>
          )}
        </Moldura>
        <p className="mt-1.5 truncate px-0.5 text-[12.5px] font-semibold">{persona.nome}</p>
        <div className="flex min-w-0 flex-wrap items-center px-0.5">
          <span className={`mb-0.5 mr-1 rounded-full px-1.5 py-px text-[10px] font-medium ${status.cor}`}>{status.rotulo}</span>
          <span className="mb-0.5 truncate text-[10px] text-muted-foreground">{persona.client_id ? "do cliente" : "da agência"}</span>
        </div>
      </button>
    </li>
  );
}

function Galeria({ personas, escolhida, onEscolher, onNova, novaAberta }: { personas: Persona[]; escolhida: string | null; onEscolher: (id: string) => void; onNova: () => void; novaAberta: boolean }) {
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const lista = personas.filter((p) => (filtro === "todas" ? p.status !== "arquivada" : filtro === "cliente" ? !!p.client_id : !p.client_id));
  const ancoras = useAncoras(personas.map((p) => p.ancora_imagem_id || ""));
  return (
    <Cartao
      titulo={`Personas · ${personas.length}`}
      dica="Pessoas sintéticas para usar nas fotos. As da agência servem para qualquer cliente."
      acao={
        <Button type="button" size="sm" className="h-8 text-[12px]" onClick={onNova} disabled={novaAberta}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Nova persona
        </Button>
      }
    >
      <Pilulas rotulo="Filtrar personas" opcoes={FILTROS} valor={filtro} onEscolher={setFiltro} />
      {lista.length === 0 ? (
        <p className="mt-1 text-[12px] text-muted-foreground">{personas.length ? "Nenhuma persona neste filtro." : "Nenhuma persona ainda. Crie a primeira."}</p>
      ) : (
        <ul className="mt-1 grid min-w-0 grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-3" aria-label="Galeria de personas">
          {lista.map((p) => (
            <CartaoDaPersona key={p.id} persona={p} ativa={p.id === escolhida} ancora={(ancoras.data || []).find((i) => i.id === p.ancora_imagem_id) || null} onAbrir={() => onEscolher(p.id)} />
          ))}
        </ul>
      )}
    </Cartao>
  );
}

// ------------------------------------------------------------------ nova persona

function Campo({ rotulo, children, className = "" }: { rotulo: string; children: ReactNode; className?: string }) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="mb-1 block text-[11.5px] text-muted-foreground">{rotulo}</span>
      {children}
    </label>
  );
}

function ReferenciasDeEstilo({ refs, onMudar }: { refs: RascunhoDaPersona["referencias"]; onMudar: (r: RascunhoDaPersona["referencias"]) => void }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const fotos = useFotos(clientId);
  const todas = fotos.data || [];
  const [doAcervo, setDoAcervo] = useState(false);
  const [andamento, setAndamento] = useState<string | null>(null);
  const cheio = refs.length >= MAX_REFERENCIAS;
  const somar = (ids: string[]) => {
    const saida = refs.slice();
    ids.forEach((id) => {
      if (saida.length < MAX_REFERENCIAS && !saida.some((r) => r.imagem_id === id)) saida.push({ imagem_id: id, uso: "estilo" });
    });
    onMudar(saida);
  };
  const subir = async (arquivos: File[]) => {
    if (!arquivos.length || andamento) return;
    setAndamento("Subindo referência");
    try {
      const r = await subirOriginais(clientId, arquivos.slice(0, MAX_REFERENCIAS - refs.length), (feitos, total) => setAndamento(feitos < total ? `Subindo ${feitos} de ${total}` : "Registrando"));
      acrescentarFotos(queryClient, clientId, r.registradas);
      invalidarFotos(queryClient, clientId);
      somar(r.registradas.map((f) => f.id));
    } catch (e) {
      avisarErro(e, "Referência não subiu");
    } finally {
      setAndamento(null);
    }
  };
  return (
    <div className="min-w-0" data-referencias-de-estilo="">
      <p className="mb-1 text-[11.5px] text-muted-foreground">Referências (opcional): só estilo, pose, luz ou roupa. Nunca o rosto de alguém.</p>
      {refs.length > 0 && (
        <ul className="mb-2 min-w-0 space-y-1.5">
          {refs.map((r) => {
            const f = todas.find((x) => x.id === r.imagem_id);
            return (
              <li key={r.imagem_id} className="flex min-w-0 items-center" data-referencia={r.imagem_id}>
                <span className="mr-2 w-10 shrink-0">{f ? <MiniaturaDaFoto foto={f} selo={false} /> : <span className="block h-10 w-10 rounded-lg bg-muted" />}</span>
                <Pilulas
                  rotulo="Usar a referência como"
                  className="min-w-0 flex-1"
                  opcoes={USOS_DA_REFERENCIA}
                  valor={r.uso}
                  onEscolher={(uso: UsoDaReferencia) => onMudar(refs.map((x) => (x.imagem_id === r.imagem_id ? { ...x, uso } : x)))}
                />
                <button type="button" aria-label="Tirar a referência" onClick={() => onMudar(refs.filter((x) => x.imagem_id !== r.imagem_id))} className="ml-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted">
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!cheio && <ZonaDeEnvio compacta onArquivos={(a) => void subir(a)} andamento={andamento} />}
      <Button type="button" size="sm" variant="outline" className="mt-2 h-8 text-[12px]" disabled={cheio} onClick={() => setDoAcervo(true)}>
        <Images className="mr-1.5 h-3.5 w-3.5" /> Do acervo
      </Button>
      {doAcervo && (
        <div className="mt-2">
          <SeletorDeFotos
            fotos={todas}
            titulo="Referências de estilo do acervo"
            jaEscolhidas={refs.map((r) => r.imagem_id)}
            onUsar={(ids) => {
              somar(ids);
              setDoAcervo(false);
            }}
            onFechar={() => setDoAcervo(false)}
          />
        </div>
      )}
    </div>
  );
}

function NovaPersona({ onCriada, onCancelar }: { onCriada: (p: Persona) => void; onCancelar: () => void }) {
  const { clientId, isAdmin, catalogo } = useMesa();
  const avisarErro = useAvisarErro();
  const campanha = useCampanhaEscolhida();
  const [r, setR] = useState<RascunhoDaPersona>(rascunhoVazio);
  const [criando, setCriando] = useState(false);
  const [tentou, setTentou] = useState(false);
  const [avancado, setAvancado] = useState(false);
  const [pedido, setPedido] = useState("");
  const [porque, setPorque] = useState("");
  const [avisos, setAvisos] = useState<string[]>([]);
  const problemas = problemasDaPersona(r);
  const ficha = (campo: keyof RascunhoDaPersona["ficha"], valor: string | number | null) => setR({ ...r, ficha: { ...r.ficha, [campo]: valor } });
  const resumo = [r.ficha.tom_de_pele, r.ficha.cabelo, r.ficha.rosto, r.ficha.olhos, r.ficha.corpo].filter((x) => x && x.trim()).join(" · ");

  const criar = async () => {
    setTentou(true);
    if (problemas.length || criando) return;
    setCriando(true);
    try {
      const p = await criarPersona(clientId, r);
      if (!p) throw new Error("A função não devolveu a persona criada.");
      toast.success(`Persona ${p.nome} criada`, { description: "Agora a rodada: gere candidatas em vários motores e escolha a mais real." });
      onCriada(p);
    } catch (e) {
      avisarErro(e, "Persona não criada");
    } finally {
      setCriando(false);
    }
  };

  return (
    <Cartao titulo="Nova persona" dica="Uma pessoa que não existe. Comece pelo brief: a ficha sai pronta do contexto do cliente (público, marca, campanha da Mesa) e você só ajusta.">
      <div className="min-w-0 rounded-lg border border-primary/30 bg-primary/5 p-2.5" data-sugerir-pelo-brief="">
        <div className="flex min-w-0 flex-wrap items-center">
          <Input
            value={pedido}
            onChange={(e) => setPedido(e.target.value)}
            placeholder="Pedido (opcional). Ex.: mulher de uns 30 anos, estilo urbano"
            aria-label="Pedido para a sugestão"
            className="mb-1.5 mr-2 h-9 min-w-0 flex-1 text-[12.5px]"
          />
          <BotaoComCusto
            rotulo={
              <>
                <Wand2 className="mr-1.5 h-3.5 w-3.5" /> Sugerir pelo brief
              </>
            }
            titulo="Ficha sugerida"
            descricao="O diretor lê o contexto do cliente que a Mesa usa (brief, público, marca e campanha) e preenche a ficha. Não cria nada: você confere e cria."
            className="mb-1.5 h-9 text-[12.5px]"
            partes={() => partesDaSugestaoDePersona(padraoPara(catalogo, "diretor_arte"))}
            executar={() => sugerirPersona(clientId, pedido, campanha.campanhaId)}
            aoConcluir={(s: SugestaoDePersona) => {
              if (!s) return;
              setR((atual) => aplicarSugestaoNaPersona(atual, s));
              setPorque(s.porque);
              setAvisos(s.avisos);
            }}
          />
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">
          Usa o brief do cliente{campanha.campanha ? ` e a campanha ${campanha.campanha.nome}` : ""}. A pessoa é sintética, adulta e sem semelhança com ninguém real.
        </p>
        {porque && <p className="mt-1.5 text-[12px] leading-snug [overflow-wrap:anywhere]" data-porque="">{porque}</p>}
        {avisos.map((a) => (
          <p key={a} className="mt-1 flex items-start text-[11.5px] leading-snug text-warning">
            <AlertTriangle className="mr-1 mt-0.5 h-3 w-3 shrink-0" /> <span className="min-w-0 [overflow-wrap:anywhere]">{a}</span>
          </p>
        ))}
      </div>

      <div className="mt-3 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
        <Campo rotulo="Nome fictício">
          <Input value={r.nome} onChange={(e) => setR({ ...r, nome: e.target.value })} placeholder="Ex.: Marina" aria-label="Nome da persona" className="h-9 text-[12.5px]" />
        </Campo>
        <Campo rotulo={`Idade aparente (mínimo ${IDADE_MINIMA})`}>
          <Input
            type="number"
            inputMode="numeric"
            min={IDADE_MINIMA}
            max={90}
            value={r.ficha.idade_aparente === null ? "" : String(r.ficha.idade_aparente)}
            onChange={(e) => ficha("idade_aparente", e.target.value === "" ? null : Number(e.target.value))}
            aria-label="Idade aparente"
            className="h-9 text-[12.5px]"
          />
        </Campo>
        <div className="min-w-0">
          <p className="mb-1 text-[11.5px] text-muted-foreground">Apresentação</p>
          <Pilulas rotulo="Apresentação da persona" opcoes={GENEROS} valor={r.ficha.genero_apresentado || null} onEscolher={(v) => ficha("genero_apresentado", v)} />
        </div>
        <Campo rotulo="Estilo">
          <Input value={r.ficha.estilo} onChange={(e) => ficha("estilo", e.target.value)} placeholder="Ex.: urbano minimalista, roupa neutra" aria-label="Estilo" className="h-9 text-[12.5px]" />
        </Campo>
      </div>

      {resumo && !avancado && (
        <p className="mt-2 text-[11.5px] leading-snug text-muted-foreground [overflow-wrap:anywhere]" data-resumo-da-ficha="">
          Traços: {resumo}
        </p>
      )}
      <button type="button" className="mt-2 text-[12px] font-medium text-primary hover:underline" onClick={() => setAvancado(!avancado)} aria-expanded={avancado} data-campos-avancados="">
        {avancado ? "Esconder os detalhes" : "Mais detalhes: pele, cabelo, rosto, marcas, corpo, referências"}
      </button>
      {avancado && (
        <div className="mt-2 grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
          <Campo rotulo="Tom de pele">
            <Input value={r.ficha.tom_de_pele} onChange={(e) => ficha("tom_de_pele", e.target.value)} placeholder="Ex.: pele morena clara, subtom quente" aria-label="Tom de pele" className="h-9 text-[12.5px]" />
          </Campo>
          <Campo rotulo="Cabelo">
            <Input value={r.ficha.cabelo} onChange={(e) => ficha("cabelo", e.target.value)} placeholder="Ex.: castanho escuro, ondulado, na altura do ombro" aria-label="Cabelo" className="h-9 text-[12.5px]" />
          </Campo>
          <Campo rotulo="Rosto">
            <Input value={r.ficha.rosto} onChange={(e) => ficha("rosto", e.target.value)} placeholder="Ex.: rosto oval, maçãs altas" aria-label="Rosto e olhos" className="h-9 text-[12.5px]" />
          </Campo>
          <Campo rotulo="Olhos (opcional)">
            <Input value={r.ficha.olhos} onChange={(e) => ficha("olhos", e.target.value)} placeholder="Ex.: castanhos amendoados" aria-label="Olhos" className="h-9 text-[12.5px]" />
          </Campo>
          <Campo rotulo="Marcas (opcional)">
            <Input value={r.ficha.marcas} onChange={(e) => ficha("marcas", e.target.value)} placeholder="Ex.: sardas leves, pinta no queixo" aria-label="Marcas" className="h-9 text-[12.5px]" />
          </Campo>
          <Campo rotulo="Corpo (opcional)">
            <Input value={r.ficha.corpo} onChange={(e) => ficha("corpo", e.target.value)} placeholder="Ex.: altura média, porte atlético" aria-label="Corpo" className="h-9 text-[12.5px]" />
          </Campo>
          <Campo rotulo="O que nunca muda (um por linha, opcional)" className="md:col-span-2">
            <Textarea value={r.invariantes} onChange={(e) => setR({ ...r, invariantes: e.target.value })} rows={2} placeholder={"Ex.: pinta no queixo\ncabelo sempre solto"} aria-label="Invariantes" className="text-[12.5px]" />
          </Campo>
          <div className="min-w-0 md:col-span-2">
            <ReferenciasDeEstilo refs={r.referencias} onMudar={(referencias) => setR({ ...r, referencias })} />
          </div>
          <div className="min-w-0 md:col-span-2">
            <p className="mb-1 text-[11.5px] text-muted-foreground">De quem é</p>
            <Pilulas
              rotulo="De quem é a persona"
              opcoes={[
                { valor: "cliente", rotulo: "Deste cliente" },
                { valor: "agencia", rotulo: "Da agência", dica: isAdmin ? "Serve para qualquer cliente." : "Só admin cria persona da agência." },
              ]}
              valor={r.daAgencia ? "agencia" : "cliente"}
              onEscolher={(v) => setR({ ...r, daAgencia: v === "agencia" && isAdmin })}
            />
          </div>
        </div>
      )}
      <label className="mt-3 flex min-w-0 items-start rounded-lg border border-border bg-background p-2.5 text-[12px] leading-snug" data-etica="">
        <input type="checkbox" className="mr-2 mt-0.5 h-4 w-4 shrink-0" checked={r.etica} onChange={(e) => setR({ ...r, etica: e.target.checked })} aria-label="Declaração ética" />
        <span className="min-w-0">
          <ShieldCheck className="mr-1 inline h-3.5 w-3.5 text-primary" />
          Confirmo: é uma pessoa sintética, adulta (idade aparente de {IDADE_MINIMA} anos ou mais), sem semelhança com nenhuma pessoa real, sem sexualização. As imagens saem marcadas como geradas.
        </span>
      </label>
      {tentou && problemas.length > 0 && (
        <ul className="mt-2 space-y-0.5" role="alert">
          {problemas.map((p) => (
            <li key={p} className="text-[11.5px] text-warning">
              {p}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex min-w-0 flex-wrap items-center">
        <Button type="button" size="sm" className="mb-1 mr-1.5 h-9 text-[12.5px]" onClick={() => void criar()} disabled={criando}>
          {criando ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1.5 h-3.5 w-3.5" />} Criar persona
        </Button>
        <Button type="button" size="sm" variant="ghost" className="mb-1 h-9 text-[12.5px]" onClick={onCancelar}>
          Cancelar
        </Button>
        <span className="mb-1 ml-auto text-[11px] text-muted-foreground">Criar não gasta. O custo aparece antes de cada geração.</span>
      </div>
    </Cartao>
  );
}

// ------------------------------------------------------------------ rodada lado a lado

function CartaoDoMotor({ motor, ligado, qualidade, onAlternar }: { motor: OpcaoDeMotor; ligado: boolean; qualidade: Qualidade; onAlternar: () => void }) {
  const { clientId, catalogo } = useMesa();
  const m = catalogo.find((x) => x.id === motor.id) || null;
  const servidor = usePrecoNoServidor(clientId, "modelo_candidata", extrasDaEstimativaDaCandidata(motor.id, motor.resolucao, qualidade), ligado);
  const preco = typeof servidor.data === "number" ? `~${usd(servidor.data)}` : m ? precoDoModelo(m, qualidade) : "preço a conferir";
  return (
    <li className="min-w-0">
      <button
        type="button"
        role="switch"
        aria-checked={ligado}
        aria-label={`${motor.rotulo}: ${ligado ? "ligado" : "desligado"}`}
        onClick={onAlternar}
        data-motor={motor.id}
        className={`flex h-full w-full min-w-0 flex-col rounded-xl border p-2.5 text-left transition-colors ${ligado ? "border-primary bg-primary/5" : "border-border bg-card opacity-70 hover:opacity-100"}`}
      >
        <span className="flex min-w-0 items-center">
          <span className={`mr-1.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border ${ligado ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>{ligado && <Check className="h-2.5 w-2.5" />}</span>
          <span className="min-w-0 truncate text-[12.5px] font-semibold">{motor.rotulo}</span>
        </span>
        <span className="mt-1 truncate text-[11px] text-muted-foreground">
          {motor.resolucao ? `${motor.resolucao} · ` : ""}
          {preco}
        </span>
      </button>
    </li>
  );
}

function ColunaDoMotor({
  persona,
  motorId,
  opcao,
  titulo,
  imagens,
  qualidade,
  lupa,
  onLupa,
  onAmpliar,
}: {
  persona: Persona;
  motorId: string;
  /** O motor como a rodada o conhece (com a resolução); null para motor que saiu do catálogo. */
  opcao: OpcaoDeMotor | null;
  titulo: string;
  imagens: ImagemDaPersona[];
  qualidade: Qualidade;
  lupa: { x: number; y: number } | null;
  onLupa: (p: { x: number; y: number }) => void;
  onAmpliar: (id: string) => void;
}) {
  const { clientId, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const andamentos = useAndamentos();
  const andamento = andamentos[chaveDoAndamento(persona.id, "candidata", motorId)] || null;
  const [conferencias, setConferencias] = useState<Record<string, ConferenciaDaPersona | null>>({});
  const [escolhendo, setEscolhendo] = useState<string | null>(null);
  const ordenadas = imagens.slice().reverse();

  const escolher = async (img: ImagemDaPersona) => {
    setEscolhendo(img.id);
    try {
      const r = await escolherAncora(persona.id, img.id);
      if (r.persona) guardarPersona(queryClient, clientId, r.persona);
      else guardarPersona(queryClient, clientId, { ...persona, ancora_imagem_id: img.id, motor_preferido_id: img.motor_id || motorId, status: "ancora" });
      void queryClient.invalidateQueries({ queryKey: chaveDasPersonas(clientId) });
      void queryClient.invalidateQueries({ queryKey: chaveDasImagensDaPersona(persona.id) });
      toast.success("Âncora escolhida", { description: "Esta é a pessoa. Agora gere a folha de 6 vistas com o mesmo motor." });
    } catch (e) {
      avisarErro(e, "Âncora não escolhida");
    } finally {
      setEscolhendo(null);
    }
  };

  return (
    <li className="min-w-0 rounded-xl border border-border bg-card p-2" data-coluna-do-motor={motorId}>
      <div className="mb-1.5 flex min-w-0 items-center">
        <p className="min-w-0 flex-1 truncate text-[12px] font-semibold">{titulo}</p>
        {andamento && andamento.estado === "gerando" && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" aria-label="Gerando" />}
      </div>
      {andamento && andamento.estado === "falhou" && (
        <p className="mb-1.5 rounded-md border border-destructive/30 bg-destructive/10 p-1.5 text-[11px] leading-snug [overflow-wrap:anywhere]" role="alert">
          {andamento.erro}
        </p>
      )}
      {andamento && andamento.estado === "gerando" && !ordenadas.length && (
        <Moldura proporcao={0.8}>
          <span className="flex h-full w-full animate-pulse items-center justify-center bg-muted text-[11px] text-muted-foreground">gerando</span>
        </Moldura>
      )}
      <ul className="min-w-0 space-y-2">
        {ordenadas.slice(0, 3).map((img, i) => {
          const ehAncora = persona.ancora_imagem_id === img.id;
          const conf = conferencias[img.id] !== undefined ? conferencias[img.id] : img.conferencia;
          return (
            <li key={img.id} className="min-w-0" data-candidata={img.id}>
              <div className={`relative overflow-hidden rounded-lg ${ehAncora ? "ring-2 ring-primary" : ""}`}>
                <Moldura proporcao={proporcaoDaImagem(img)}>
                  <button
                    type="button"
                    className={`block h-full w-full ${lupa ? "cursor-crosshair" : "cursor-zoom-in"}`}
                    aria-label={lupa ? "Mover a lupa para este ponto" : "Ver grande"}
                    onClick={(e) => {
                      if (!lupa) return onAmpliar(img.id);
                      const caixa = e.currentTarget.getBoundingClientRect();
                      onLupa({ x: Math.round(((e.clientX - caixa.left) / caixa.width) * 100), y: Math.round(((e.clientY - caixa.top) / caixa.height) * 100) });
                    }}
                  >
                    <span
                      className="block h-full w-full"
                      style={lupa ? { transform: "scale(3)", WebkitTransform: "scale(3)", transformOrigin: `${lupa.x}% ${lupa.y}%`, WebkitTransformOrigin: `${lupa.x}% ${lupa.y}%` } : undefined}
                    >
                      <ImagemDaPersonaNaTela imagem={img} alt={`Candidata ${i + 1} de ${titulo}`} />
                    </span>
                  </button>
                  <SeloGerada />
                  {ehAncora && (
                    <span className="pointer-events-none absolute right-1 top-1 inline-flex items-center rounded-full border border-primary/40 bg-card px-1.5 py-px text-[9.5px] font-semibold text-primary">
                      <Crown className="mr-0.5 h-2.5 w-2.5" /> âncora
                    </span>
                  )}
                </Moldura>
              </div>
              <div className="mt-1 flex min-w-0 flex-wrap items-center">
                {!ehAncora && (
                  <Button type="button" size="sm" className="mb-1 mr-1 h-7 px-2 text-[11px]" disabled={!!escolhendo} onClick={() => void escolher(img)}>
                    {escolhendo === img.id ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Crown className="mr-1 h-3 w-3" />} Âncora
                  </Button>
                )}
                <BotaoConferir persona={persona} imagem={img} onConferencia={(c) => setConferencias({ ...conferencias, [img.id]: c })} />
              </div>
              {conf && <NotasDaConferencia conferencia={conf} />}
            </li>
          );
        })}
      </ul>
      <BotaoComCusto
        rotulo={
          <>
            <RefreshCw className="mr-1 h-3 w-3" /> {ordenadas.length ? "Refazer" : "Gerar"}
          </>
        }
        titulo="Candidata nova"
        descricao="Variação real (semente nova) neste motor."
        variant="outline"
        className="mt-1.5 h-7 w-full text-[11px]"
        disabled={!!andamento && andamento.estado === "gerando"}
        fecharAoConfirmar
        partes={() => partesDaRodada([motorId], qualidade)}
        executar={() => {
          void rodarCandidatas({
            queryClient,
            clientId,
            persona,
            motores: [opcao || { id: motorId, rotulo: titulo, resolucao: null, padrao: false, conhecido: false }],
            qualidade,
            pedido: "",
            atualizar: atualizarCusto,
          });
          return Promise.resolve({});
        }}
      />
    </li>
  );
}

function Rodada({ persona, imagens }: { persona: Persona; imagens: ImagemDaPersona[] }) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const { opcoes, faltando } = useMemo(() => motoresDaRodada(catalogo), [catalogo]);
  const [ligados, setLigados] = useState<string[] | null>(null);
  const escolhidos = ligados || opcoes.filter((o) => o.padrao).map((o) => o.id);
  const [qualidade, setQualidade] = useState<Qualidade>("alta");
  const [pedido, setPedido] = useState("");
  const [cega, setCega] = useState(false);
  const [lupa, setLupa] = useState<{ x: number; y: number } | null>(null);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const [mostrarTodos, setMostrarTodos] = useState(false);
  const andamentos = useAndamentos();
  const resumo = resumoDaPersona(persona, imagens);
  const ordemDosMotores = opcoes.map((o) => o.id);
  const grupos = candidatasPorMotor(resumo.candidatas, ordemDosMotores);
  // Coluna aparece também para o motor que está gerando agora (antes da primeira imagem).
  escolhidos.forEach((id) => {
    const a = andamentos[chaveDoAndamento(persona.id, "candidata", id)];
    if (a && !grupos.some((g) => g.motor_id === id)) grupos.push({ motor_id: id, imagens: [] });
  });
  const escondeNome = cega && !persona.ancora_imagem_id;
  const gerando = escolhidos.some((id) => {
    const a = andamentos[chaveDoAndamento(persona.id, "candidata", id)];
    return !!a && a.estado === "gerando";
  });
  const visiveis = mostrarTodos ? opcoes : opcoes.filter((o) => o.conhecido || escolhidos.indexOf(o.id) >= 0);
  const todasAsCandidatas = grupos.reduce((acc, g) => acc.concat(g.imagens.slice().reverse().slice(0, 3)), [] as ImagemDaPersona[]);

  const alternar = (id: string) => setLigados(escolhidos.indexOf(id) >= 0 ? escolhidos.filter((x) => x !== id) : escolhidos.concat([id]));

  return (
    <Cartao
      titulo="1. Rodada lado a lado"
      dica="Cada motor gera uma candidata com a mesma ficha. Compare pele, olhos, mãos e cabelo e escolha a mais real como âncora."
    >
      <ul className="grid min-w-0 grid-cols-2 gap-2 md:grid-cols-4" aria-label="Motores da rodada">
        {visiveis.map((o) => (
          <CartaoDoMotor key={o.id} motor={o} ligado={escolhidos.indexOf(o.id) >= 0} qualidade={qualidade} onAlternar={() => alternar(o.id)} />
        ))}
      </ul>
      <div className="mt-1.5 flex min-w-0 flex-wrap items-center text-[11px] text-muted-foreground">
        {opcoes.length > visiveis.length && (
          <button type="button" className="mb-1 mr-3 font-medium text-primary hover:underline" onClick={() => setMostrarTodos(true)}>
            Ver todos os geradores ({opcoes.length})
          </button>
        )}
        {faltando.length > 0 && <span className="mb-1">Ainda não ativos no catálogo: {faltando.join(", ")}.</span>}
      </div>
      <div className="mt-2 grid min-w-0 grid-cols-1 gap-2 md:grid-cols-3">
        <label className="block min-w-0 md:col-span-2">
          <span className="mb-1 block text-[11.5px] text-muted-foreground">Pedido extra (opcional)</span>
          <Input value={pedido} onChange={(e) => setPedido(e.target.value)} placeholder="Ex.: meio corpo, luz de janela, camiseta branca" aria-label="Pedido extra da rodada" className="h-9 text-[12.5px]" />
        </label>
        <SeletorDeQualidade valor={qualidade} onChange={setQualidade} />
      </div>
      <div className="mt-3 flex min-w-0 flex-wrap items-center">
        <BotaoComCusto
          rotulo={
            <>
              <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Gerar {escolhidos.length} {escolhidos.length === 1 ? "candidata" : "candidatas"}
            </>
          }
          titulo="Rodada"
          descricao="Uma imagem por motor ligado, todas juntas. O que sair fica salvo mesmo se você sair da aba."
          className="mb-1.5 mr-2 h-9 text-[12.5px]"
          disabled={!escolhidos.length || gerando}
          fecharAoConfirmar
          partes={() => partesDaRodada(escolhidos, qualidade, 0)}
          executar={() => {
            void rodarCandidatas({ queryClient, clientId, persona, motores: opcoes.filter((o) => escolhidos.indexOf(o.id) >= 0), qualidade, pedido, atualizar: atualizarCusto });
            return Promise.resolve({});
          }}
        />
        <label className="mb-1.5 mr-3 inline-flex items-center text-[12px]">
          <input type="checkbox" className="mr-1.5 h-3.5 w-3.5" checked={cega} onChange={(e) => setCega(e.target.checked)} aria-label="Comparação às cegas" /> Às cegas
        </label>
        <Button
          type="button"
          size="sm"
          variant={lupa ? "default" : "outline"}
          className="mb-1.5 h-8 text-[12px]"
          aria-pressed={!!lupa}
          onClick={() => setLupa(lupa ? null : { x: 50, y: 35 })}
          title="Toque num ponto do rosto: o mesmo recorte aparece ampliado em todas as candidatas"
        >
          <ZoomIn className="mr-1.5 h-3.5 w-3.5" /> Lupa
        </Button>
      </div>
      {grupos.length > 0 ? (
        <ul className="mt-3 grid min-w-0 grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Candidatas por motor">
          {grupos.map((g, i) => (
            <ColunaDoMotor
              key={g.motor_id}
              persona={persona}
              motorId={g.motor_id}
              opcao={opcoes.find((o) => o.id === g.motor_id) || null}
              titulo={escondeNome ? `Motor ${letraDoMotor(i)}` : rotuloDoMotor(catalogo, g.motor_id)}
              imagens={g.imagens}
              qualidade={qualidade}
              lupa={lupa}
              onLupa={setLupa}
              onAmpliar={(id) => {
                const idx = todasAsCandidatas.findIndex((x) => x.id === id);
                setAmpliada(idx >= 0 ? idx : null);
              }}
            />
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-[12px] text-muted-foreground">Nenhuma candidata ainda. Ligue os motores e gere a rodada.</p>
      )}
      <Ampliar imagens={todasAsCandidatas.map((c) => ampliavel(c, `${persona.nome}, candidata`))} indice={ampliada} onFechar={() => setAmpliada(null)} />
    </Cartao>
  );
}

// ------------------------------------------------------------------ folha

/**
 * Aprovar a vista (modelo_imagem_decidir): só a vista aprovada vira identidade
 * nas próximas vistas e no Canvas; 3 aprovadas deixam a persona pronta.
 */
function AprovarVista({ persona, imagem }: { persona: Persona; imagem: ImagemDaPersona }) {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const avisarErro = useAvisarErro();
  const [salvando, setSalvando] = useState(false);
  if (imagem.aprovada === true) {
    return (
      <p className="inline-flex items-center text-[10.5px] font-medium text-success" data-vista-aprovada={imagem.id}>
        <Check className="mr-0.5 h-3 w-3" /> aprovada
      </p>
    );
  }
  const aprovar = async () => {
    setSalvando(true);
    try {
      const r = await decidirImagemDaPersona(imagem.id, "aprovar");
      guardarImagemDaPersona(queryClient, r.imagem ? { ...r.imagem, papel: "vista", vista: r.imagem.vista || imagem.vista } : { ...imagem, aprovada: true });
      if (r.persona) guardarPersona(queryClient, clientId, r.persona);
      void queryClient.invalidateQueries({ queryKey: chaveDasPersonas(clientId) });
      void queryClient.invalidateQueries({ queryKey: chaveDasImagensDaPersona(persona.id) });
    } catch (e) {
      avisarErro(e, "Vista não aprovada");
    } finally {
      setSalvando(false);
    }
  };
  return (
    <Button type="button" size="sm" variant="outline" className="h-7 w-full px-1 text-[11px]" disabled={salvando} onClick={() => void aprovar()}>
      {salvando ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />} Aprovar
    </Button>
  );
}

function Folha({ persona, imagens }: { persona: Persona; imagens: ImagemDaPersona[] }) {
  const { clientId, catalogo, atualizarCusto } = useMesa();
  const queryClient = useQueryClient();
  const andamentos = useAndamentos();
  const [qualidade, setQualidade] = useState<Qualidade>("alta");
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const resumo = resumoDaPersona(persona, imagens);
  const motorId = persona.motor_preferido_id || (resumo.ancora ? resumo.ancora.motor_id : null);
  const semAncora = !resumo.ancora;
  const faltam = VISTAS_DA_FOLHA.filter((v) => !resumo.vistas[v.valor]).map((v) => v.valor);
  const gerandoAlguma = VISTAS_DA_FOLHA.some((v) => {
    const a = andamentos[chaveDoAndamento(persona.id, "vista", v.valor)];
    return !!a && a.estado === "gerando";
  });
  const prontas = VISTAS_DA_FOLHA.map((v) => resumo.vistas[v.valor]).filter((x): x is ImagemDaPersona => !!x);
  const rodar = (vistas: string[]) => {
    void rodarVistas({ queryClient, clientId, persona, vistas, qualidade, atualizar: atualizarCusto });
    return Promise.resolve({});
  };

  return (
    <Cartao
      className="h-full"
      titulo={`2. Folha de 6 vistas · ${resumo.vistasProntas} de 6`}
      dica={semAncora ? "Escolha a âncora na rodada primeiro: a folha parte dela." : `A mesma pessoa em 6 vistas, com o motor da âncora (${rotuloDoMotor(catalogo, motorId)}). Trocar de motor aumenta a deriva do rosto.`}
      acao={
        !semAncora && faltam.length > 0 ? (
          <BotaoComCusto
            rotulo={
              <>
                <Sparkles className="mr-1.5 h-3.5 w-3.5" /> Gerar {faltam.length === 6 ? "a folha" : `as ${faltam.length} que faltam`}
              </>
            }
            titulo="Folha"
            className="h-8 text-[12px]"
            disabled={gerandoAlguma}
            fecharAoConfirmar
            partes={() => partesDaVista(motorId, qualidade, 1 + resumo.vistasProntas, faltam.length)}
            executar={() => rodar(faltam)}
          />
        ) : undefined
      }
    >
      <div className="mb-2 w-full sm:w-56">
        <SeletorDeQualidade valor={qualidade} onChange={setQualidade} disabled={semAncora} />
      </div>
      <ul className="grid min-w-0 grid-cols-3 gap-2 sm:grid-cols-6 xl:grid-cols-3" aria-label="Vistas da folha">
        {VISTAS_DA_FOLHA.map((v) => {
          const img = resumo.vistas[v.valor];
          const a = andamentos[chaveDoAndamento(persona.id, "vista", v.valor)];
          return (
            <li key={v.valor} className="min-w-0" data-vista={v.valor}>
              <Moldura proporcao={0.8} className="border border-border">
                {img ? (
                  <button type="button" className="block h-full w-full cursor-zoom-in" aria-label={`Ver grande: ${v.rotulo}`} onClick={() => setAmpliada(prontas.indexOf(img))}>
                    <ImagemDaPersonaNaTela imagem={img} alt={`${persona.nome}, ${v.rotulo}`} />
                  </button>
                ) : (
                  <span className={`flex h-full w-full items-center justify-center text-[10.5px] text-muted-foreground ${a && a.estado === "gerando" ? "animate-pulse bg-muted" : ""}`}>
                    {a && a.estado === "gerando" ? "gerando" : "vazia"}
                  </span>
                )}
                {img && <SeloGerada />}
              </Moldura>
              <p className="mt-1 truncate text-[11px] font-medium">{v.rotulo}</p>
              {img && <AprovarVista persona={persona} imagem={img} />}
              {a && a.estado === "falhou" && (
                <p className="text-[10.5px] leading-snug text-destructive [overflow-wrap:anywhere]" role="alert">
                  {a.erro}
                </p>
              )}
              <BotaoComCusto
                rotulo={img ? "Refazer" : "Gerar"}
                titulo={`Vista ${v.rotulo}`}
                variant="ghost"
                className="h-7 w-full px-1 text-[11px]"
                disabled={semAncora || (!!a && a.estado === "gerando")}
                fecharAoConfirmar
                partes={() => partesDaVista(motorId, qualidade, 1 + resumo.vistasProntas)}
                executar={() => rodar([v.valor])}
              />
            </li>
          );
        })}
      </ul>
      <Ampliar imagens={prontas.map((i) => ampliavel(i, `${persona.nome}, ${rotuloDaVista(i.vista)}`))} indice={ampliada !== null && ampliada >= 0 ? ampliada : null} onFechar={() => setAmpliada(null)} />
    </Cartao>
  );
}

// ------------------------------------------------------------------ detalhar em 4K

/** Antes e depois com cortina: a barra (mouse, toque e teclado) mostra mais de um ou de outro. */
export function AntesEDepois({ antes, depois, proporcao }: { antes: ImagemDaPersona; depois: ImagemDaPersona; proporcao: number }) {
  const [pos, setPos] = useState(50);
  const corte = `inset(0 ${100 - pos}% 0 0)`;
  return (
    <div className="min-w-0" data-antes-e-depois="">
      <Moldura proporcao={proporcao} className="border border-border">
        <ImagemDaPersonaNaTela imagem={antes} alt="Antes" className="!object-contain" />
        <span className="absolute inset-0" style={{ clipPath: corte, WebkitClipPath: corte }}>
          <ImagemDaPersonaNaTela imagem={depois} alt="Depois, 4K" className="!object-contain" />
        </span>
        <span className="pointer-events-none absolute bottom-0 top-0 w-px bg-card" style={{ left: `${pos}%` }} />
        <span className="pointer-events-none absolute left-1 top-1 rounded-full border border-primary/30 bg-card px-1.5 py-px text-[9.5px] font-semibold text-primary">depois 4K</span>
        <span className="pointer-events-none absolute right-1 top-1 rounded-full border border-border bg-card px-1.5 py-px text-[9.5px] font-medium text-foreground">antes</span>
      </Moldura>
      <input type="range" min={0} max={100} value={pos} onChange={(e) => setPos(Number(e.target.value))} aria-label="Cortina entre antes e depois" className="mt-2 w-full" />
    </div>
  );
}

function Detalhar({ persona, imagens }: { persona: Persona; imagens: ImagemDaPersona[] }) {
  const { clientId, catalogo } = useMesa();
  const queryClient = useQueryClient();
  const resumo = resumoDaPersona(persona, imagens);
  const fontes = (resumo.ancora ? [resumo.ancora] : []).concat(VISTAS_DA_FOLHA.map((v) => resumo.vistas[v.valor]).filter((x): x is ImagemDaPersona => !!x));
  const [fonteId, setFonteId] = useState<string | null>(null);
  const fonte = fontes.find((f) => f.id === fonteId) || fontes[0] || null;
  const detalhe = fonte ? resumo.detalhes.filter((d) => d.derivada_de === fonte.id).pop() || null : null;
  // O 4K sai do gerador de detalhe (Nano Banana Pro); fora do catálogo, a função usa o padrão dela.
  // Nunca o gerador da âncora por tabela: nem todo gerador faz 4K e a função recusa.
  const motor = acharNoCatalogo(catalogo, MOTOR_DO_DETALHE.procura);
  const motorId = motor ? motor.id : null;
  const servidor = usePrecoNoServidor(clientId, "modelo_detalhar", extrasDaEstimativaDoDetalhe(motorId), !!fonte);

  return (
    <Cartao className="h-full" titulo="3. Detalhar em 4K" dica="Re-renderiza em 4K para ganhar poro, cabelo e tecido. É geração nova: vira versão marcada, com antes e depois; pode mexer em traço fino.">
      {!fonte ? (
        <p className="text-[12px] text-muted-foreground">Escolha a âncora primeiro.</p>
      ) : (
        <div className="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
          <div className="min-w-0">
            <p className="mb-1 text-[11.5px] text-muted-foreground">Imagem para detalhar</p>
            <ul className="flex min-w-0 flex-wrap" aria-label="Imagem para detalhar">
              {fontes.map((f) => (
                <li key={f.id} className="mb-1.5 mr-1.5 w-12">
                  <button type="button" aria-pressed={fonte.id === f.id} aria-label={f.vista ? rotuloDaVista(f.vista) : "Âncora"} onClick={() => setFonteId(f.id)} className={`block w-full rounded-lg border p-0.5 ${fonte.id === f.id ? "border-primary" : "border-transparent"}`}>
                    <Moldura proporcao={0.8}>
                      <ImagemDaPersonaNaTela imagem={f} alt={f.vista ? rotuloDaVista(f.vista) : "Âncora"} />
                    </Moldura>
                  </button>
                </li>
              ))}
            </ul>
            <div className="mt-2 flex min-w-0 flex-wrap items-center">
              <BotaoComCusto
                rotulo={
                  <>
                    <Wand2 className="mr-1.5 h-3.5 w-3.5" /> Detalhar em 4K
                  </>
                }
                titulo="Detalhe em 4K"
                descricao={`${motor ? MOTOR_DO_DETALHE.rotulo : "Gerador 4K padrão da função"}: a imagem escolhida vai como primeira referência, com a âncora.`}
                className="mb-1.5 mr-1.5 h-9 text-[12.5px]"
                partes={() => partesDaVista(motorId, "alta", 2)}
                executar={() => detalharImagem({ clientId, modeloId: persona.id, imagemId: fonte.id, motorId })}
                aoConcluir={(data) => {
                  if (data && data.imagem) guardarImagemDaPersona(queryClient, { ...data.imagem, papel: "detalhe", derivada_de: data.imagem.derivada_de || fonte.id });
                  void queryClient.invalidateQueries({ queryKey: chaveDasImagensDaPersona(persona.id) });
                }}
              />
              <Button type="button" size="sm" variant="outline" className="mb-1.5 h-9 text-[12.5px]" disabled title="Ampliação fiel (sem inventar detalhe) precisa da conta fal.ai com a chave FAL_KEY salva no Supabase.">
                Ampliar fiel
              </Button>
            </div>
            <p className="text-[11px] leading-snug text-muted-foreground">
              {typeof servidor.data === "number" ? `Preço do 4K pela função: ~${usd(servidor.data)}. ` : ""}Ampliar fiel precisa da conta fal.ai.
            </p>
          </div>
          <div className="min-w-0">
            {detalhe ? (
              <AntesEDepois antes={fonte} depois={detalhe} proporcao={proporcaoDaImagem(fonte)} />
            ) : (
              <Moldura proporcao={proporcaoDaImagem(fonte)} className="border border-border">
                <ImagemDaPersonaNaTela imagem={fonte} alt="Imagem escolhida" className="!object-contain" />
                <SeloGerada />
              </Moldura>
            )}
          </div>
        </div>
      )}
    </Cartao>
  );
}

// ------------------------------------------------------------------ persona aberta

/**
 * Coluna da esquerda da persona aberta (pedido do dono, 25/09: "ocupe os
 * espaços, está tudo muito para baixo"): a âncora grande, a ficha curta e as
 * ações. A rodada, a folha e o detalhe 4K ficam à direita.
 */
function PersonaLateral({ persona }: { persona: Persona }) {
  const { clientId } = useMesa();
  const { irPara } = useMesaFoto();
  const imagensQ = useImagensDaPersona(persona.id);
  const imagens = imagensQ.data || [];
  const resumo = resumoDaPersona(persona, imagens);
  const status = STATUS_DA_PERSONA[persona.status];
  const f = persona.ficha;
  const tracos = [f.tom_de_pele, f.cabelo, f.rosto, f.olhos, f.estilo].filter(Boolean);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  return (
    <section className="min-w-0 rounded-xl border border-border bg-card p-3" data-persona-lateral={persona.id} aria-label={`Persona ${persona.nome}`}>
      <div className="grid min-w-0 grid-cols-[96px_minmax(0,1fr)] gap-3 lg:grid-cols-1">
        <Moldura proporcao={resumo.ancora ? proporcaoDaImagem(resumo.ancora) : 0.8} className="border border-border">
          {resumo.ancora ? (
            <button type="button" className="block h-full w-full cursor-zoom-in" aria-label="Ver a âncora grande" onClick={() => setAmpliada(0)}>
              <ImagemDaPersonaNaTela imagem={resumo.ancora} alt={persona.nome} />
            </button>
          ) : (
            <span className="flex h-full w-full flex-col items-center justify-center px-2 text-center text-[11px] text-muted-foreground">
              <UserRound className="mb-1 h-6 w-6" /> Sem âncora: gere a rodada e escolha a mais real.
            </span>
          )}
          {resumo.ancora && <SeloGerada />}
        </Moldura>
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center">
            <p className="mr-2 truncate text-[16px] font-semibold">{persona.nome}</p>
            <span className={`mr-1.5 rounded-full px-1.5 py-px text-[10.5px] font-medium ${status.cor}`}>{status.rotulo}</span>
          </div>
          <span className="mt-1 inline-flex items-center rounded-full border border-primary/30 bg-card px-1.5 py-px text-[10.5px] font-semibold text-primary" data-selo="gerada">
            <Sparkles className="mr-0.5 h-2.5 w-2.5" /> pessoa sintética
          </span>
          <dl className="mt-2 space-y-0.5 text-[11.5px] leading-snug">
            {f.idade_aparente ? (
              <div className="flex min-w-0">
                <dt className="mr-1 text-muted-foreground">Idade:</dt>
                <dd>{f.idade_aparente} anos</dd>
              </div>
            ) : null}
            {tracos.length > 0 && (
              <div className="min-w-0">
                <dt className="text-muted-foreground">Traços:</dt>
                <dd className="[overflow-wrap:anywhere]">{tracos.join(" · ")}</dd>
              </div>
            )}
            <div className="flex min-w-0">
              <dt className="mr-1 text-muted-foreground">Folha:</dt>
              <dd>{resumo.vistasProntas} de 6 vistas</dd>
            </div>
            <div className="flex min-w-0 flex-wrap text-muted-foreground">
              {persona.client_id ? "Deste cliente" : "Da agência"} · versão {persona.versao}
              {persona.custo_usd ? ` · ${usd(persona.custo_usd)} gasto` : ""}
            </div>
          </dl>
          {resumo.ancora && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-2 h-8 w-full text-[12px] sm:w-auto lg:w-full"
              onClick={() => {
                pedirAoCanvas(clientId, persona.id);
                irPara("canvas");
              }}
            >
              <Workflow className="mr-1.5 h-3.5 w-3.5" /> Usar no Canvas
            </Button>
          )}
        </div>
      </div>
      <p className="mt-2 text-[11px] leading-snug text-muted-foreground">Pessoa sintética. Ao publicar, ligue o rótulo de IA do Instagram.</p>
      {resumo.ancora && (
        <Ampliar imagens={[ampliavel(resumo.ancora, `${persona.nome}, âncora`)]} indice={ampliada} onFechar={() => setAmpliada(null)} />
      )}
    </section>
  );
}

function PersonaAberta({ persona }: { persona: Persona }) {
  const imagensQ = useImagensDaPersona(persona.id);
  const imagens = imagensQ.data || [];
  return (
    <div className="min-w-0 space-y-4" data-persona-aberta={persona.id}>
      {imagensQ.isError && <AvisoDeErro erro={imagensQ.error} />}
      <Rodada persona={persona} imagens={imagens} />
      <div className="grid min-w-0 grid-cols-1 gap-4 xl:grid-cols-2" data-folha-e-detalhe="">
        <Folha persona={persona} imagens={imagens} />
        <Detalhar persona={persona} imagens={imagens} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ etapa

export default function EtapaModelos() {
  const { clientId } = useMesa();
  const queryClient = useQueryClient();
  const personasQ = usePersonas(clientId);
  const personas = useMemo(() => personasQ.data || [], [personasQ.data]);
  const [escolhida, setEscolhida] = useState<string | null>(() => lerEscolhida(clientId));
  const [nova, setNova] = useState(false);
  const aberta = personas.find((p) => p.id === escolhida) || (nova ? null : personas.find((p) => p.status !== "arquivada") || null);

  useEffect(() => {
    gravarEscolhida(clientId, aberta ? aberta.id : null);
  }, [clientId, aberta]);

  const escolher = (id: string) => {
    setNova(false);
    setEscolhida(id);
  };

  return (
    <div className="min-w-0 pb-24">
      {personasQ.isError && <AvisoDeErro erro={personasQ.error} className="mb-3" />}
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="min-w-0 space-y-4 lg:col-span-4 xl:col-span-3">
          {!nova && aberta && <PersonaLateral key={`lateral-${aberta.id}`} persona={aberta} />}
          <Galeria personas={personas} escolhida={aberta ? aberta.id : null} onEscolher={escolher} onNova={() => setNova(true)} novaAberta={nova} />
        </div>
        <div className="min-w-0 lg:col-span-8 xl:col-span-9">
          {nova ? (
            <NovaPersona
              onCancelar={() => setNova(false)}
              onCriada={(p) => {
                guardarPersona(queryClient, clientId, p);
                void queryClient.invalidateQueries({ queryKey: chaveDasPersonas(clientId) });
                setNova(false);
                setEscolhida(p.id);
              }}
            />
          ) : aberta ? (
            <PersonaAberta key={aberta.id} persona={aberta} />
          ) : (
            <Vazio
              titulo="Crie a primeira persona"
              acao={
                <Button type="button" size="sm" className="h-8 text-[12px]" onClick={() => setNova(true)}>
                  <Plus className="mr-1 h-3.5 w-3.5" /> Nova persona
                </Button>
              }
            >
              Descreva a pessoa, gere candidatas em vários motores lado a lado e escolha a mais real. Depois a folha de 6 vistas e o detalhe em 4K. Tudo marcado como gerado.
            </Vazio>
          )}
        </div>
      </div>
    </div>
  );
}
