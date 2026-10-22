import { useEffect, useState } from "react";
import { Copy, ImagePlus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import JanelaCentral from "@/components/sistema/JanelaCentral";
import { CampoDeFormulario } from "@/components/sistema/Formulario";
import SeletorCompacto from "@/components/sistema/SeletorCompacto";
import { botao, campo, campoTexto, juntar, texto } from "@/components/sistema/estilos";
import { useConfirm } from "@/components/shared/confirmDialog";
import { textoDoErro } from "@/lib/mesa/api";
import SeletorDoAcervo, { FotoDoAcervo } from "../SeletorDoAcervo";
import { copiarTexto } from "../instagram/instagramApi";
import { noFuso } from "../instagram/calendario-da-grade";
import { localParaIso } from "../../../../supabase/functions/estudio-arte/modulos/entrega-na-agenda";
import PreviaDoStory, { IconeDoAdesivo, SeloDoCaminho } from "./PreviaDoStory";
import type { MarcaDosStories } from "./marcaDosStories";
import {
  caminhoDoAdesivo,
  chamarStories,
  normalizarStory,
  roteiroDoAdesivo,
  ROTULO_DO_ADESIVO,
  TIPOS_DE_ADESIVO,
  type Adesivo,
  type DestaqueDoPerfil,
  type Fundo,
  type Story,
  type TipoDeAdesivo,
} from "./storiesApi";

/**
 * Editor de um story, na janela do centro: a prévia ao vivo à esquerda e, à
 * direita, texto na tela, adesivo, imagem (do gerador ou só a cor da marca),
 * horário e destaque. O caminho sai do adesivo: com adesivo, pelo app.
 * Story novo (sem id) nasce na sequência aberta; Salvar grava pela função.
 * 21/10 (regra da casa: nada colado por cima): a foto do acervo não é mais
 * fundo com texto em cima; vai inteira como referência da imagem gerada.
 */

/** O fundo como o editor mostra: foto antiga vira referência da imagem gerada. */
export function fundoNoEditor(f: Fundo | undefined | null, paleta: string[]): Fundo {
  if (!f) return { tipo: "gerada" };
  if (f.tipo === "foto") return { tipo: "gerada", ...(f.papel ? { papel: f.papel } : {}), ...(f.imagem_id ? { referencia_id: f.imagem_id } : {}) };
  if (f.tipo === "cor") return { ...f, cor: f.cor || paleta[0] };
  return { ...f };
}

/** O fundo que o Salvar manda (o servidor guarda o trabalho, a lâmina e a versão). */
export function fundoParaSalvar(f: Fundo, paleta: string[]): Fundo {
  if (f.tipo === "cor") return { tipo: "cor", cor: f.cor || paleta[0] || "#111111", ...(f.papel ? { papel: f.papel } : {}) };
  const saida: Fundo = { ...f, tipo: "gerada" };
  delete saida.imagem_id;
  if (saida.cena !== undefined) saida.cena = saida.cena.trim();
  if (!saida.cena) delete saida.cena;
  if (!saida.referencia_id) delete saida.referencia_id;
  return saida;
}

export type StoryNoEditor = Partial<Story> & { sequencia_id: string | null; ordem: number };

const PERGUNTA_DO_ADESIVO: Partial<Record<TipoDeAdesivo, string>> = {
  enquete: "Pergunta da enquete",
  quiz: "Pergunta do quiz",
  caixinha: "Texto da caixinha",
  contagem: "Nome da contagem",
  localizacao: "Lugar",
  reacao: "Pergunta da reação",
  mencao: "Conta marcada",
};

const COM_OPCOES: TipoDeAdesivo[] = ["enquete", "quiz"];

/** Texto na tela: até 2 linhas curtas (regra da novela). */
export const LIMITE_DO_TEXTO = 90;

function opcoesIniciais(tipo: TipoDeAdesivo, atuais: string[] | undefined): string[] {
  const base = (atuais || []).slice(0, 4);
  const minimo = tipo === "quiz" ? 3 : 2;
  while (base.length < minimo) base.push("");
  return base;
}

export default function EditorDoStory({
  aberto,
  clientId,
  diaDaSequencia,
  destaques,
  marca,
  onFechar,
  onSalvo,
  onApagado,
}: {
  aberto: StoryNoEditor | null;
  clientId: string;
  /** Dia da sequência (AAAA-MM-DD): o horário do story é nesse dia. */
  diaDaSequencia: string | null;
  destaques: DestaqueDoPerfil[];
  marca: MarcaDosStories;
  onFechar: () => void;
  onSalvo: (s: Story) => void;
  onApagado: (id: string) => void;
}) {
  const confirmar = useConfirm();
  const [textoNaTela, setTextoNaTela] = useState("");
  const [titulo, setTitulo] = useState("");
  const [adesivo, setAdesivo] = useState<Adesivo>({ tipo: "nenhum" });
  const [fundo, setFundo] = useState<Fundo>({ tipo: "cor" });
  const [hora, setHora] = useState("");
  const [destaque, setDestaque] = useState("");
  const [escolhendoFoto, setEscolhendoFoto] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const dia = (aberto && aberto.horario ? noFuso(aberto.horario).dia : null) || diaDaSequencia;

  useEffect(() => {
    if (!aberto) return;
    setTextoNaTela(aberto.texto_na_tela || "");
    setTitulo(aberto.titulo || "");
    setAdesivo(aberto.adesivo ? { ...aberto.adesivo } : { tipo: "nenhum" });
    setFundo(fundoNoEditor(aberto.fundo, marca.paleta));
    setHora(aberto.horario ? noFuso(aberto.horario).hora : "");
    setDestaque(aberto.destaque_id || "");
    setEscolhendoFoto(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberto && aberto.id, aberto]);

  if (!aberto) return null;

  const tipo = adesivo.tipo;
  const opcoes = COM_OPCOES.indexOf(tipo) >= 0 ? opcoesIniciais(tipo, adesivo.opcoes) : [];
  const mudarAdesivo = (m: Partial<Adesivo>) => setAdesivo((a) => ({ ...a, ...m }));
  const referencia = fundo.tipo === "gerada" ? marca.foto(fundo.referencia_id) : null;
  const previa = { texto_na_tela: textoNaTela, adesivo, fundo };
  const peloApp = caminhoDoAdesivo(adesivo) === "pelo_app";
  const roteiro = roteiroDoAdesivo({ adesivo, roteiro_do_adesivo: null });
  const textoLongo = textoNaTela.length > LIMITE_DO_TEXTO;
  // Link do adesivo: só https:// (regra do contrato).
  const linkRuim = tipo === "link" && !!(adesivo.url || "").trim() && (adesivo.url || "").trim().indexOf("https://") !== 0;

  const salvar = async () => {
    if (linkRuim) {
      toast.error("O link precisa começar com https://");
      return;
    }
    const horario = hora && dia ? localParaIso(dia, hora) : null;
    const limpo: Adesivo = { tipo };
    if (PERGUNTA_DO_ADESIVO[tipo] && adesivo.pergunta) limpo.pergunta = adesivo.pergunta.trim();
    if (COM_OPCOES.indexOf(tipo) >= 0) limpo.opcoes = opcoes.map((o) => o.trim()).filter(Boolean);
    if (tipo === "link") {
      limpo.url = (adesivo.url || "").trim();
      if (adesivo.texto_do_link) limpo.texto_do_link = adesivo.texto_do_link.trim();
    }
    if (tipo === "contagem" && adesivo.quando) limpo.quando = adesivo.quando;
    const story: Record<string, unknown> = {
      ...(aberto.id ? { id: aberto.id } : {}),
      sequencia_id: aberto.sequencia_id,
      ordem: aberto.ordem,
      molde: aberto.molde || "",
      titulo: titulo.trim(),
      texto_na_tela: textoNaTela.trim(),
      adesivo: limpo,
      fundo: fundoParaSalvar(fundo, marca.paleta),
      horario,
      caminho: caminhoDoAdesivo(limpo),
      destaque_id: destaque || null,
    };
    setSalvando(true);
    try {
      const r = await chamarStories<{ story: unknown }>("salvar_story", clientId, { story });
      onSalvo(normalizarStory(r && r.story ? r.story : story));
      onFechar();
    } catch (e) {
      toast.error("Não deu para salvar o story", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };

  const apagar = async () => {
    if (!aberto.id) return;
    const ok = await confirmar({ title: "Apagar este story?", description: "Ele sai da sequência e da agenda.", confirmLabel: "Apagar", destructive: true });
    if (!ok) return;
    try {
      await chamarStories("apagar_story", clientId, { id: aberto.id });
      onApagado(aberto.id);
      onFechar();
    } catch (e) {
      toast.error("Não deu para apagar", { description: textoDoErro(e) });
    }
  };

  return (
    <JanelaCentral
      aberta={!!aberto}
      onFechar={onFechar}
      titulo={aberto.id ? `Story ${aberto.ordem}` : "Story novo"}
      descricao={aberto.molde ? `Molde ${aberto.molde.replace(/_/g, " ")}` : undefined}
      ajuda="Com adesivo, o story vai pelo app: a arte sai com a área do adesivo livre e o roteiro exato para a equipe. Sem adesivo, o painel publica sozinho no horário."
      largura="xl"
      data-editor-do-story=""
      rodape={
        <div className="flex min-w-0 items-center">
          {aberto.id ? (
            <button type="button" className={juntar(botao.discreto, "text-destructive")} onClick={() => void apagar()}>
              <Trash2 className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Apagar
            </button>
          ) : null}
          <span className="flex-1" />
          <button type="button" className={juntar(botao.secundario, "mr-2")} onClick={onFechar}>
            Cancelar
          </button>
          <button type="button" className={botao.primario} onClick={() => void salvar()} disabled={salvando}>
            {salvando ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            Salvar
          </button>
        </div>
      }
    >
      <div className="grid min-w-0 gap-6 md:grid-cols-[260px_minmax(0,1fr)]">
        <div className="min-w-0">
          <PreviaDoStory story={previa} largura={260} paleta={marca.paleta} familia={marca.familia} foto={null} mostrarZona className="mx-auto" />
          <p className={juntar(texto.auxiliar, "mt-2 text-center")}>Tracejado: zona segura</p>
        </div>

        <div className="min-w-0 space-y-4">
          <CampoDeFormulario rotulo="Texto na tela" apoio={`${textoNaTela.length}/${LIMITE_DO_TEXTO}, até 2 linhas curtas`} erro={textoLongo ? "Texto longo demais para o story: corte para caber em 2 linhas." : undefined}>
            <textarea className={juntar(campoTexto, "min-h-[64px]")} rows={2} value={textoNaTela} onChange={(e) => setTextoNaTela(e.target.value)} />
          </CampoDeFormulario>

          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <CampoDeFormulario rotulo="Adesivo">
              <select className={campo} value={tipo} onChange={(e) => setAdesivo((a) => ({ ...a, tipo: e.target.value as TipoDeAdesivo }))}>
                {TIPOS_DE_ADESIVO.map((t) => (
                  <option key={t} value={t}>
                    {ROTULO_DO_ADESIVO[t]}
                  </option>
                ))}
              </select>
            </CampoDeFormulario>
            <div className="flex min-w-0 items-end pb-2">
              <IconeDoAdesivo tipo={tipo} className="mr-2 h-4 w-4 text-muted-foreground" />
              <SeloDoCaminho adesivo={adesivo} />
            </div>
          </div>

          {PERGUNTA_DO_ADESIVO[tipo] ? (
            <CampoDeFormulario rotulo={PERGUNTA_DO_ADESIVO[tipo] as string}>
              <input className={campo} value={adesivo.pergunta || ""} onChange={(e) => mudarAdesivo({ pergunta: e.target.value })} />
            </CampoDeFormulario>
          ) : null}

          {opcoes.length ? (
            <div className="min-w-0">
              <p className={texto.rotulo}>Opções</p>
              <div className="mt-1 grid min-w-0 gap-2 sm:grid-cols-2">
                {opcoes.map((o, i) => (
                  <input
                    key={i}
                    className={campo}
                    value={o}
                    aria-label={tipo === "quiz" && i === 0 ? "Opção 1 (a certa)" : `Opção ${i + 1}`}
                    placeholder={tipo === "quiz" && i === 0 ? "A resposta certa" : undefined}
                    onChange={(e) => {
                      const l = opcoes.slice();
                      l[i] = e.target.value;
                      mudarAdesivo({ opcoes: l });
                    }}
                  />
                ))}
              </div>
              {opcoes.length < 4 ? (
                <button type="button" className={juntar(botao.discreto, "mt-1 h-8 px-2")} onClick={() => mudarAdesivo({ opcoes: opcoes.concat([""]) })}>
                  Mais uma opção
                </button>
              ) : null}
            </div>
          ) : null}

          {tipo === "link" ? (
            <div className="grid min-w-0 gap-4 sm:grid-cols-2">
              <CampoDeFormulario rotulo="Endereço do link" erro={linkRuim ? "Só https://" : undefined}>
                <input className={campo} type="url" value={adesivo.url || ""} onChange={(e) => mudarAdesivo({ url: e.target.value })} placeholder="https://" />
              </CampoDeFormulario>
              <CampoDeFormulario rotulo="Texto do link">
                <input className={campo} value={adesivo.texto_do_link || ""} onChange={(e) => mudarAdesivo({ texto_do_link: e.target.value })} />
              </CampoDeFormulario>
            </div>
          ) : null}

          {tipo === "contagem" ? (
            <CampoDeFormulario rotulo="Termina em">
              <input className={campo} value={adesivo.quando || ""} onChange={(e) => mudarAdesivo({ quando: e.target.value })} placeholder="25/10 às 19h" />
            </CampoDeFormulario>
          ) : null}

          {peloApp ? (
            <div className={juntar("flex min-w-0 items-start rounded-md bg-muted/50 px-3 py-2")} data-roteiro-do-adesivo="">
              <p className={juntar(texto.corpo, "mr-2 min-w-0 flex-1 [overflow-wrap:anywhere]")}>{roteiro}</p>
              <button
                type="button"
                className={botao.icone}
                aria-label="Copiar o roteiro do adesivo"
                title="Copiar o roteiro do adesivo"
                onClick={() => void copiarTexto(roteiro).then((ok) => (ok ? toast.success("Roteiro copiado") : toast.error("Não deu para copiar")))}
              >
                <Copy className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          ) : null}

          <div className="min-w-0">
            <div className="flex min-w-0 items-center justify-between">
              <p className={texto.rotulo}>Imagem</p>
              <SeletorCompacto
                rotulo="Imagem do story"
                valor={fundo.tipo === "cor" ? "cor" : "gerada"}
                onEscolher={(v) =>
                  setFundo(v === "cor" ? { tipo: "cor", cor: fundo.cor || marca.paleta[0], ...(fundo.papel ? { papel: fundo.papel } : {}) } : fundoNoEditor(aberto.fundo && aberto.fundo.tipo !== "cor" ? aberto.fundo : { tipo: "gerada", ...(fundo.papel ? { papel: fundo.papel } : {}) }, marca.paleta))
                }
                opcoes={[
                  { valor: "gerada", rotulo: "Do gerador" },
                  { valor: "cor", rotulo: "Só a cor da marca" },
                ]}
              />
            </div>
            {fundo.tipo !== "cor" ? (
              <div className="mt-2 min-w-0 space-y-3">
                <CampoDeFormulario rotulo="Cena da imagem" apoio="O que a imagem mostra; o gerador desenha a tela com o texto integrado">
                  <textarea className={juntar(campoTexto, "min-h-[56px]")} rows={2} value={fundo.cena || ""} maxLength={400} onChange={(e) => setFundo({ ...fundo, cena: e.target.value })} placeholder="Ex.: o combo na mesa de madeira, luz da tarde" />
                </CampoDeFormulario>
                <div className="flex min-w-0 items-center">
                  {referencia ? (
                    <span className="mr-3 block w-16 shrink-0">
                      <FotoDoAcervo imagem={referencia} />
                    </span>
                  ) : null}
                  <button type="button" className={botao.secundario} onClick={() => setEscolhendoFoto(!escolhendoFoto)} aria-expanded={escolhendoFoto}>
                    <ImagePlus className="mr-1.5 h-4 w-4" aria-hidden="true" />
                    {referencia ? "Trocar a referência" : "Foto real de referência"}
                  </button>
                  {referencia ? (
                    <button type="button" className={juntar(botao.icone, "ml-1")} onClick={() => setFundo({ ...fundo, referencia_id: undefined })} aria-label="Tirar a foto de referência" title="Tirar a foto de referência">
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  ) : null}
                </div>
                <p className={texto.auxiliar}>A foto vai inteira para o gerador como referência, nunca colada na arte.</p>
                {!marca.fotos.length && !marca.carregandoFotos ? <p className={texto.auxiliar}>O acervo do cliente ainda não tem fotos</p> : null}
                {escolhendoFoto ? (
                  <div className="min-w-0">
                    <SeletorDoAcervo
                      titulo="Foto de referência do story"
                      escolhidas={fundo.referencia_id ? [fundo.referencia_id] : []}
                      onFechar={() => setEscolhendoFoto(false)}
                      onEscolher={(img) => {
                        setFundo({ ...fundo, referencia_id: img.id });
                        setEscolhendoFoto(false);
                      }}
                    />
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="mt-2 flex min-w-0 flex-wrap" role="radiogroup" aria-label="Cor da marca">
                {marca.paleta.length ? (
                  marca.paleta.map((c) => (
                    <button
                      key={c}
                      type="button"
                      role="radio"
                      aria-checked={(fundo.cor || marca.paleta[0]) === c}
                      aria-label={`Cor ${c}`}
                      title={c}
                      onClick={() => setFundo({ ...fundo, tipo: "cor", cor: c })}
                      className={juntar("mb-1 mr-1.5 h-7 w-7 rounded-full border border-border", (fundo.cor || marca.paleta[0]) === c ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : "")}
                      style={{ backgroundColor: c }}
                    />
                  ))
                ) : (
                  <p className={texto.auxiliar}>Sem cores no kit: defina a paleta em Contexto</p>
                )}
              </div>
            )}
          </div>

          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <CampoDeFormulario rotulo="Horário" apoio={dia ? `no dia ${dia.split("-").reverse().join("/")}` : undefined}>
              <input className={campo} type="time" value={hora} onChange={(e) => setHora(e.target.value)} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Destaque depois">
              <select className={campo} value={destaque} onChange={(e) => setDestaque(e.target.value)}>
                <option value="">Nenhum</option>
                {destaques.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.nome}
                  </option>
                ))}
              </select>
            </CampoDeFormulario>
          </div>

          <CampoDeFormulario rotulo="Nome interno">
            <input className={campo} value={titulo} onChange={(e) => setTitulo(e.target.value)} placeholder="Gancho, prova, convite..." />
          </CampoDeFormulario>
        </div>
      </div>
    </JanelaCentral>
  );
}
