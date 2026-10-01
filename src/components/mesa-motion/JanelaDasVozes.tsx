import { useState } from "react";
import { Archive, Check, Loader2, Mic, Search, Sparkles, Star, Upload, Wand2 } from "lucide-react";
import { toast } from "sonner";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useMarcaDaMesa, useMesa } from "@/components/mesa/MesaContexto";
import { useAvisarErro } from "@/components/mesa/Custo";
import CampoDeBusca from "@/components/sistema/CampoDeBusca";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { botao, campo, campoTexto, juntar, lista, texto } from "@/components/sistema/estilos";
import { usd } from "@/lib/mesa/api";
import { estimarDesenho } from "../../../supabase/functions/mesa-motion/modulos/narracao";
import { chamarMotion, type Filme } from "./motionApi";
import { previaDaVoz, useGuardarVozes, useSituacaoDaVoz, type VozDaBiblioteca, type VozSalva } from "./vozApi";

/**
 * Janela das vozes (frente MOV): as vozes da marca aberta (a padrão, usar no
 * filme, arquivar), a biblioteca da ElevenLabs (busca, prévia, o Jev sugere a
 * que combina com a marca), o desenho de uma voz nova por descrição (3
 * prévias, custo antes) e o clone da voz de uma pessoa, só com a
 * autorização dela registrada. Tudo fica por cliente e marca: a marca que
 * não é a principal nunca herda a voz da outra.
 */

type Aba = "marca" | "biblioteca" | "desenhar" | "clonar";
type Previa = { generated_voice_id: string; path: string; url: string | null; duracao_s: number };

const nomeSeguro = (n: string) => n.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "-").slice(-80) || "amostra";

export default function JanelaDasVozes({ aberta, onFechar, filme, temChave, onUsar }: { aberta: boolean; onFechar: () => void; filme: Filme; temChave: boolean; onUsar: (v: Pick<VozSalva, "voice_id" | "nome" | "origem">) => void }) {
  const { clientId, atualizarCusto, saldoUsd } = useMesa();
  const { marca } = useMarcaDaMesa();
  const marcaId = marca ? marca.id : null;
  const avisarErro = useAvisarErro();
  const situacao = useSituacaoDaVoz(clientId, marcaId);
  const guardarVozes = useGuardarVozes(clientId, marcaId);
  const [aba, setAba] = useState<Aba>("marca");
  const [busca, setBusca] = useState("");
  const [buscaFeita, setBuscaFeita] = useState("");
  const [indo, setIndo] = useState<string | null>(null);
  const [sugerida, setSugerida] = useState<{ voice_id: string; confianca: number | null } | null>(null);
  const [descricao, setDescricao] = useState("");
  const [amostra, setAmostra] = useState("");
  const [previas, setPrevias] = useState<Previa[]>([]);
  const [escolhida, setEscolhida] = useState<string>("");
  const [nome, setNome] = useState(marca ? `Voz ${marca.nome}` : "Voz da marca");
  const [arquivos, setArquivos] = useState<Array<{ path: string; nome: string }>>([]);
  const [quem, setQuem] = useState("");
  const [como, setComo] = useState("");
  const [confirmo, setConfirmo] = useState(false);
  const [semRuido, setSemRuido] = useState(true);
  const [confirmarDesenho, setConfirmarDesenho] = useState(false);
  // Biblioteca: a Voice Library pública da ElevenLabs (português) ou as vozes da conta da agência.
  const [fonte, setFonte] = useState<"conta" | "publica">("publica");
  const [locale, setLocale] = useState<"pt-BR" | "pt-PT" | "todos">("pt-BR");
  const [pagina, setPagina] = useState(0);

  const vozes = situacao.data ? situacao.data.vozes : [];
  const biblioteca = useQuery({
    queryKey: ["mesa-motion", "biblioteca", clientId, buscaFeita],
    enabled: aberta && aba === "biblioteca" && fonte === "conta" && temChave,
    staleTime: 10 * 60_000,
    queryFn: () => chamarMotion<{ vozes: VozDaBiblioteca[]; proxima: string | null }>("vozes_biblioteca", { client_id: clientId, busca: buscaFeita || undefined }),
  });
  const publica = useQuery({
    queryKey: ["mesa-motion", "voice-library", clientId, buscaFeita, locale, pagina],
    enabled: aberta && aba === "biblioteca" && fonte === "publica" && temChave,
    staleTime: 10 * 60_000,
    queryFn: () => chamarMotion<{ vozes: VozDaBiblioteca[]; proxima: number | null }>("vozes_compartilhadas", { client_id: clientId, busca: buscaFeita || undefined, locale, pagina }),
  });
  const consulta = fonte === "publica" ? publica : biblioteca;

  const executar = async <T,>(chave: string, fn: () => Promise<T>, erro: string): Promise<T | null> => {
    setIndo(chave);
    try {
      return await fn();
    } catch (e) {
      avisarErro(e, erro);
      return null;
    } finally {
      setIndo(null);
    }
  };

  const usarDaBiblioteca = async (v: VozDaBiblioteca) => {
    const d = await executar(`usar:${v.voice_id}`, () => chamarMotion<{ voice_id?: string; vozes: VozSalva[] }>("voz_escolher", { client_id: clientId, marca_id: marcaId || undefined, voice_id: v.voice_id, public_owner_id: v.public_owner_id || undefined, nome: v.nome, descricao: v.descricao, previa_url: v.previa_pt || v.previa_url || undefined }), "A voz não foi salva");
    if (!d) return;
    guardarVozes(d.vozes);
    // Voz da Voice Library pública: o id que vale é o da conta da agência (o servidor devolve).
    onUsar({ voice_id: d.voice_id || v.voice_id, nome: v.nome, origem: "biblioteca" });
    toast.success(`${v.nome} é a voz da marca`, { description: "Vale para os próximos filmes desta marca." });
    onFechar();
  };

  const sugerir = async () => {
    const candidatas = ((consulta.data && consulta.data.vozes) || []).slice(0, 10).map((v) => ({ voice_id: v.voice_id, nome: v.nome, descricao: v.descricao, rotulos: v.rotulos }));
    const d = await executar("sugerir", () => chamarMotion<{ voice_id: string | null; confianca: number | null; custo_usd: number }>("voz_sugerir", { client_id: clientId, marca_id: marcaId || undefined, filme_id: filme.id, candidatas }), "O Jev não sugeriu");
    if (!d || !d.voice_id) return;
    setSugerida({ voice_id: d.voice_id, confianca: d.confianca });
    atualizarCusto();
  };

  const padrao = async (v: VozSalva) => {
    const d = await executar(`padrao:${v.id}`, () => chamarMotion<{ vozes: VozSalva[] }>("voz_padrao", { voz_id: v.id }), "A voz padrão não mudou");
    if (d) guardarVozes(d.vozes);
  };

  const arquivar = async (v: VozSalva, arquivarSim = true) => {
    const d = await executar(`arquivar:${v.id}`, () => chamarMotion<{ vozes: VozSalva[] }>("voz_arquivar", { voz_id: v.id, arquivar: arquivarSim }), "A voz não foi arquivada");
    if (!d) return;
    guardarVozes(d.vozes);
    if (arquivarSim) toast.success(`${v.nome} arquivada`, { duration: 9000, action: { label: "Desfazer", onClick: () => void arquivar(v, false) } });
  };

  const desenhar = async () => {
    const d = await executar("desenhar", () => chamarMotion<{ previas: Previa[]; custo_usd: number }>("voz_desenhar", { client_id: clientId, marca_id: marcaId || undefined, descricao, texto: amostra.trim().length >= 100 ? amostra.trim() : undefined }), "As prévias não foram geradas");
    if (!d) return;
    setPrevias(d.previas || []);
    setEscolhida(d.previas && d.previas[0] ? d.previas[0].generated_voice_id : "");
    atualizarCusto();
    toast.success("3 prévias prontas", { description: `Custo real: ${usd(d.custo_usd)}. Ouça e salve a melhor.` });
  };

  const salvarDesenhada = async () => {
    const p = previas.find((x) => x.generated_voice_id === escolhida);
    if (!p) return;
    const d = await executar("salvar", () => chamarMotion<{ voice_id: string; vozes: VozSalva[] }>("voz_salvar_desenhada", { client_id: clientId, marca_id: marcaId || undefined, generated_voice_id: p.generated_voice_id, nome, descricao, previa_path: p.path }), "A voz não foi salva");
    if (!d) return;
    guardarVozes(d.vozes);
    onUsar({ voice_id: d.voice_id, nome, origem: "desenhada" });
    toast.success(`${nome} salva como voz da marca`);
    setPrevias([]);
    onFechar();
  };

  const subir = async (files: FileList | null) => {
    if (!files || !files.length) return;
    await executar(
      "subir",
      async () => {
        const novos: Array<{ path: string; nome: string }> = [];
        for (const f of Array.from(files).slice(0, 5)) {
          if (f.size > 20 * 1024 * 1024) throw new Error(`${f.name} passa de 20 MB.`);
          const path = `${clientId}/video/motion/vozes/amostras/${Date.now().toString(36)}-${nomeSeguro(f.name)}`;
          const { error } = await supabase.storage.from("mesa").upload(path, f, { contentType: f.type || "audio/mpeg", upsert: false });
          if (error) throw error;
          novos.push({ path, nome: f.name });
        }
        setArquivos((a) => a.concat(novos).slice(0, 5));
      },
      "A gravação não subiu",
    );
  };

  const clonar = async () => {
    const d = await executar("clonar", () => chamarMotion<{ voice_id: string; precisa_verificar: boolean; vozes: VozSalva[] }>("voz_clonar", { client_id: clientId, marca_id: marcaId || undefined, nome, caminhos: arquivos.map((a) => a.path), autorizacao: { quem, como }, confirma: confirmo, remover_ruido: semRuido }), "A voz não foi clonada");
    if (!d) return;
    guardarVozes(d.vozes);
    onUsar({ voice_id: d.voice_id, nome, origem: "clonada" });
    toast.success(`${nome} clonada`, { description: d.precisa_verificar ? "A ElevenLabs pede a verificação da voz na conta antes do uso comercial." : "Autorização registrada com a voz." });
    onFechar();
  };

  const listaDaBiblioteca = (consulta.data && consulta.data.vozes) || [];
  const ordenada = sugerida ? listaDaBiblioteca.slice().sort((a, b) => (a.voice_id === sugerida.voice_id ? -1 : b.voice_id === sugerida.voice_id ? 1 : 0)) : listaDaBiblioteca;

  return (
    <JanelaCentral
      aberta={aberta}
      onMudar={(v) => !v && onFechar()}
      titulo="Vozes da marca"
      icone={<Mic className="h-4 w-4" />}
      largura="lg"
      descricao={marca ? `Marca ${marca.nome}` : "Marca principal"}
      ajuda="A voz escolhida vira a voz padrão desta marca e já vem nos próximos filmes. Biblioteca: vozes prontas da ElevenLabs (as que falam português aparecem com PT). Desenhar: descreva a voz e ouça 3 prévias. Clonar: só com a autorização da pessoa, registrada aqui."
      abaixoDoTitulo={
        <SeletorCompacto
          opcoes={[
            { valor: "marca", rotulo: `Da marca (${vozes.length})` },
            { valor: "biblioteca", rotulo: "Biblioteca" },
            { valor: "desenhar", rotulo: "Desenhar" },
            { valor: "clonar", rotulo: "Clonar" },
          ]}
          valor={aba}
          onEscolher={(v) => setAba(v as Aba)}
          rotulo="Onde escolher a voz"
          listaQuandoNaoCabe
        />
      }
      data-janela-das-vozes=""
    >
      {!temChave && aba !== "marca" && <p className={juntar(texto.auxiliar, "mb-3 text-warning")}>A chave da ElevenLabs não está no servidor: biblioteca, desenho e clone voltam quando um admin cadastrar a ELEVENLABS_API_KEY.</p>}

      {aba === "marca" && (
        <div className="min-w-0">
          {!vozes.length && <p className={texto.auxiliar}>Nenhuma voz salva para esta marca. Escolha na Biblioteca, desenhe ou clone.</p>}
          <ul className={juntar(lista.aberta, lista.divisoria)}>
            {vozes.map((v) => (
              <li key={v.id} className={juntar(lista.linha, "flex-wrap")} data-voz-da-marca={v.voice_id}>
                <span className="mr-3 min-w-0 flex-1">
                  <span className={juntar(texto.corpo, "block truncate")}>
                    {v.nome} {v.padrao && <Star className="ml-1 inline h-3 w-3 text-primary" aria-label="padrão" />}
                  </span>
                  <span className={texto.auxiliar}>{v.origem === "clonada" ? "Clonada (com autorização)" : v.origem === "desenhada" ? "Desenhada" : "Biblioteca"}</span>
                </span>
                {previaDaVoz(v) && <audio controls preload="none" className="mr-2 h-8 w-[200px] max-w-full" src={previaDaVoz(v) || undefined} aria-label={`Prévia de ${v.nome}`} />}
                <button type="button" className={juntar(botao.secundario, "mr-1 h-8")} onClick={() => { onUsar(v); onFechar(); }}>
                  <Check className="mr-1 h-3.5 w-3.5" />
                  Usar
                </button>
                {!v.padrao && (
                  <button type="button" className={juntar(botao.discreto, "mr-1 h-8")} onClick={() => void padrao(v)} disabled={!!indo}>
                    Padrão
                  </button>
                )}
                <button type="button" className={juntar(botao.icone, "h-8 w-8")} onClick={() => void arquivar(v)} disabled={!!indo} aria-label={`Arquivar ${v.nome}`}>
                  <Archive className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {aba === "biblioteca" && (
        <div className="min-w-0 space-y-3">
          <form
            className="flex min-w-0 items-center"
            onSubmit={(e) => {
              e.preventDefault();
              setBuscaFeita(busca.trim());
              setPagina(0);
            }}
          >
            <CampoDeBusca valor={busca} onMudar={setBusca} placeholder="Buscar: narrador, feminina, calma, brasileira..." rotulo="Buscar voz" className="mr-2 flex-1" />
            <button type="submit" className={juntar(botao.secundario, "mr-2")} disabled={!temChave}>
              <Search className="mr-1 h-3.5 w-3.5" />
              Buscar
            </button>
            <button type="button" className={botao.secundario} onClick={() => void sugerir()} disabled={!temChave || listaDaBiblioteca.length < 2 || indo === "sugerir"} title="O Jev compara as vozes da lista com a marca" data-sugerir-voz="">
              {indo === "sugerir" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1 h-3.5 w-3.5" />}
              Sugerir
            </button>
          </form>
          <div className="flex min-w-0 flex-wrap items-center" data-fonte-da-biblioteca={fonte}>
            <SeletorCompacto
              opcoes={[
                { valor: "publica", rotulo: "Voice Library (português)" },
                { valor: "conta", rotulo: "Vozes da conta" },
              ]}
              valor={fonte}
              onEscolher={(v) => {
                setFonte(v as "conta" | "publica");
                setPagina(0);
              }}
              rotulo="De onde vêm as vozes"
            />
            {fonte === "publica" && (
              <span className="ml-2">
                <SeletorCompacto
                  opcoes={[
                    { valor: "pt-BR", rotulo: "Brasil" },
                    { valor: "pt-PT", rotulo: "Portugal" },
                    { valor: "todos", rotulo: "Todos os sotaques" },
                  ]}
                  valor={locale}
                  onEscolher={(v) => {
                    setLocale(v as "pt-BR" | "pt-PT" | "todos");
                    setPagina(0);
                  }}
                  rotulo="Sotaque"
                />
              </span>
            )}
          </div>
          {consulta.isLoading && temChave && <p className={juntar(texto.auxiliar, "flex items-center")}><Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />Lendo a biblioteca</p>}
          {consulta.isError && <p className={juntar(texto.auxiliar, "text-warning")}>{consulta.error instanceof Error ? consulta.error.message : "A biblioteca não carregou."}</p>}
          <ul className={juntar(lista.aberta, lista.divisoria)}>
            {ordenada.map((v) => (
              <li key={v.voice_id} className={juntar(lista.linha, "flex-wrap", sugerida && sugerida.voice_id === v.voice_id ? lista.destaque : "")} data-voz-da-biblioteca={v.voice_id}>
                <span className="mr-3 min-w-0 flex-1">
                  <span className={juntar(texto.corpo, "block truncate")}>
                    {v.nome}
                    {v.idiomas.indexOf("pt") >= 0 && <span className={juntar(texto.etiqueta, "ml-2 rounded bg-primary/10 px-1.5 text-primary")}>{v.locale === "pt-BR" ? "PT-BR" : "PT"}</span>}
                    {sugerida && sugerida.voice_id === v.voice_id && <span className={juntar(texto.etiqueta, "ml-2 text-primary")}>sugerida pelo Jev{sugerida.confianca !== null ? ` (${Math.round(sugerida.confianca * 100)}%)` : ""}</span>}
                  </span>
                  <span className={juntar(texto.auxiliar, "block truncate")}>{v.descricao || Object.keys(v.rotulos).map((k) => v.rotulos[k]).join(", ")}</span>
                </span>
                {(v.previa_pt || v.previa_url) && <audio controls preload="none" className="mr-2 h-8 w-[200px] max-w-full" src={v.previa_pt || v.previa_url || undefined} aria-label={`Prévia de ${v.nome}`} />}
                <button type="button" className={juntar(botao.secundario, "h-8")} onClick={() => void usarDaBiblioteca(v)} disabled={!!indo}>
                  {indo === `usar:${v.voice_id}` ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
                  Usar
                </button>
              </li>
            ))}
          </ul>
          {fonte === "publica" && (pagina > 0 || (publica.data && publica.data.proxima !== null)) && (
            <div className="flex min-w-0 justify-end">
              <button type="button" className={juntar(botao.discreto, "mr-2 h-8")} onClick={() => setPagina(Math.max(0, pagina - 1))} disabled={pagina === 0 || publica.isFetching}>
                Anterior
              </button>
              <button type="button" className={juntar(botao.discreto, "h-8")} onClick={() => setPagina(pagina + 1)} disabled={!publica.data || publica.data.proxima === null || publica.isFetching} data-proxima-pagina="">
                Mais vozes
              </button>
            </div>
          )}
        </div>
      )}

      {aba === "desenhar" && (
        <div className="min-w-0 space-y-3">
          <label className="block min-w-0">
            <span className={texto.rotulo}>Como é a voz</span>
            <textarea className={juntar(campoTexto, "min-h-[72px]")} value={descricao} maxLength={1000} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: mulher brasileira de 35 anos, sotaque paulista leve, voz quente e confiante, ritmo tranquilo, de quem explica bem" aria-label="Descrição da voz" />
          </label>
          <label className="block min-w-0">
            <span className={texto.rotulo}>Texto da prévia (opcional, 100 a 1.000 caracteres)</span>
            <textarea className={juntar(campoTexto, "min-h-[56px]")} value={amostra} maxLength={1000} onChange={(e) => setAmostra(e.target.value)} placeholder="Vazio: a ElevenLabs escreve um texto de amostra" aria-label="Texto da prévia" />
          </label>
          <button type="button" className={botao.primario} onClick={() => setConfirmarDesenho(true)} disabled={!temChave || descricao.trim().length < 20 || indo === "desenhar"} data-desenhar-voz="">
            {indo === "desenhar" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Wand2 className="mr-1 h-3.5 w-3.5" />}
            Gerar 3 prévias · ~{usd(estimarDesenho())}
          </button>
          {previas.length > 0 && (
            <div className="min-w-0 space-y-2" role="radiogroup" aria-label="Prévias da voz">
              {previas.map((p, i) => (
                <label key={p.generated_voice_id} className={juntar(lista.linha, "cursor-pointer flex-wrap", escolhida === p.generated_voice_id ? lista.destaque : "")}>
                  <input type="radio" name="previa" className="mr-2 h-4 w-4 accent-primary" checked={escolhida === p.generated_voice_id} onChange={() => setEscolhida(p.generated_voice_id)} />
                  <span className={juntar(texto.corpo, "mr-3")}>Prévia {i + 1}</span>
                  {p.url && <audio controls preload="none" className="h-8 w-[240px] max-w-full" src={p.url} aria-label={`Prévia ${i + 1}`} />}
                </label>
              ))}
              <div className="flex min-w-0 items-end">
                <label className="mr-2 min-w-0 flex-1">
                  <span className={texto.rotulo}>Nome da voz</span>
                  <input className={campo} value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} />
                </label>
                <button type="button" className={botao.primario} onClick={() => void salvarDesenhada()} disabled={!escolhida || !nome.trim() || indo === "salvar"} data-salvar-voz-desenhada="">
                  {indo === "salvar" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Check className="mr-1 h-3.5 w-3.5" />}
                  Salvar como voz da marca
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {aba === "clonar" && (
        <div className="min-w-0 space-y-3">
          <p className={texto.auxiliar}>Grave de 1 a 3 minutos da pessoa falando, sem música e sem eco. Até 5 arquivos.</p>
          <label className={juntar(botao.secundario, "cursor-pointer")}>
            {indo === "subir" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />}
            Enviar gravações
            <input type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg,.webm,.aac,.flac" multiple className="hidden" onChange={(e) => void subir(e.target.files)} />
          </label>
          {arquivos.length > 0 && (
            <ul className={lista.aberta}>
              {arquivos.map((a) => (
                <li key={a.path} className={lista.linha}>
                  <span className={juntar(texto.corpo, "min-w-0 truncate")}>{a.nome}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="min-w-0">
              <span className={texto.rotulo}>Nome da voz</span>
              <input className={campo} value={nome} maxLength={80} onChange={(e) => setNome(e.target.value)} />
            </label>
            <label className="min-w-0">
              <span className={texto.rotulo}>Quem autorizou</span>
              <input className={campo} value={quem} maxLength={120} onChange={(e) => setQuem(e.target.value)} placeholder="Nome da pessoa dona da voz" />
            </label>
          </div>
          <label className="block min-w-0">
            <span className={texto.rotulo}>Como autorizou</span>
            <input className={campo} value={como} maxLength={300} onChange={(e) => setComo(e.target.value)} placeholder="E-mail de 30/09, cláusula do contrato, áudio no grupo..." />
          </label>
          <label className={juntar(texto.corpo, "flex items-start")}>
            <input type="checkbox" className="mr-2 mt-0.5 h-4 w-4 shrink-0 accent-primary" checked={confirmo} onChange={(e) => setConfirmo(e.target.checked)} />
            Confirmo que a pessoa autorizou o uso da voz dela, gerada por IA, nos vídeos desta marca.
          </label>
          <label className={juntar(texto.auxiliar, "flex items-center")}>
            <input type="checkbox" className="mr-2 h-4 w-4 accent-primary" checked={semRuido} onChange={(e) => setSemRuido(e.target.checked)} />
            Tirar o ruído de fundo das gravações
          </label>
          <button type="button" className={botao.primario} onClick={() => void clonar()} disabled={!temChave || !arquivos.length || !confirmo || quem.trim().length < 2 || como.trim().length < 3 || indo === "clonar"} data-clonar-voz="">
            {indo === "clonar" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Mic className="mr-1 h-3.5 w-3.5" />}
            Clonar a voz
          </button>
        </div>
      )}
      <JanelaCentral
        aberta={confirmarDesenho}
        onMudar={(v) => !v && setConfirmarDesenho(false)}
        titulo="Gerar 3 prévias da voz"
        icone={<Wand2 className="h-4 w-4" />}
        largura="sm"
        descricaoOculta="Confirme o custo das prévias"
        rodape={
          <div className="flex min-w-0 justify-end">
            <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={() => setConfirmarDesenho(false)}>
              Cancelar
            </button>
            <button
              type="button"
              className={botao.primario}
              onClick={() => {
                setConfirmarDesenho(false);
                void desenhar();
              }}
              disabled={saldoUsd !== null && saldoUsd < estimarDesenho()}
              data-confirmar-desenho=""
            >
              Gerar · ~{usd(estimarDesenho())}
            </button>
          </div>
        }
      >
        <div className="min-w-0 space-y-2">
          <p className={texto.corpo}>A ElevenLabs gera 3 prévias pela descrição. Custo estimado pelo preço de tabela: ~{usd(estimarDesenho())}, na carteira do cliente.</p>
          {saldoUsd !== null && (
            <p className={juntar(texto.auxiliar, saldoUsd < estimarDesenho() ? "text-warning" : "")}>
              Saldo da carteira: {usd(saldoUsd)}
              {saldoUsd < estimarDesenho() ? " (não cobre)" : ""}.
            </p>
          )}
        </div>
      </JanelaCentral>
    </JanelaCentral>
  );
}
