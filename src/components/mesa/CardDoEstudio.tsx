import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronDown,
  Crop,
  ImageIcon,
  Loader2,
  MessageSquare,
  Paintbrush,
  Pencil,
  RefreshCw,
  TriangleAlert,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { dataEHora, textoDoErro, type ParteDaEstimativa } from "@/lib/mesa/api";
import { BotaoComCusto } from "./Custo";
import { ImagemDaMesa } from "./MesaContexto";
import Moldura45 from "./Moldura45";
import { Cronometro } from "./PranchetaDoEstudio";
import SeletorDeAreas from "./SeletorDeAreas";
import SeletorDoAcervo, { FotoDoAcervo, ROTULO_DA_CATEGORIA, useAcervo, type ImagemDoAcervo } from "./SeletorDoAcervo";
import type { Area } from "./estudioUtil";
import type { CardDaDirecao, CardGerado, Verificacao } from "./useItensDoMes";

/**
 * Painel da lâmina escolhida. A lâmina vem inteira do gerador, texto
 * incluído: esta tela só mostra a imagem que voltou. O texto exato fica AO
 * LADO, como conferência, nunca desenhado por cima da arte. No ajuste por
 * área, os retângulos são divs com borda (SeletorDeAreas), sem pintar nada.
 *
 * Três abas: Direção (texto, composição e a foto real da lâmina), Ajustar
 * (pedido livre, uma área ou só o fundo, sempre com o preço ao lado) e
 * Versões. A conferência fica num bloco recolhível com selos.
 */

export type PainelDaLamina = "direcao" | "livre" | "areas" | "fundo" | "versoes";

export interface OpcoesDoAjuste {
  areas?: Area[];
  tipo?: "livre" | "fundo";
  imagem_id?: string;
}

// O estúdio grava a identidade como { nota, escala_max } (Score do Jev de 0 a escala_max).
const pct = (v: unknown): number | null => {
  if (typeof v !== "object" || v === null) return null;
  const nota = Number((v as any).nota ?? (v as any).score);
  const max = Number((v as any).escala_max);
  if (!Number.isFinite(nota) || !Number.isFinite(max) || max <= 0) return null;
  return Math.round(Math.max(0, Math.min(1, nota / max)) * 100);
};

function Selo({ tom, children }: { tom: "ok" | "alerta" | "erro" | "neutro"; children: ReactNode }) {
  const cor =
    tom === "ok" ? "bg-success/10 text-success" : tom === "alerta" ? "bg-warning/15 text-warning" : tom === "erro" ? "bg-destructive/10 text-destructive" : "bg-secondary text-muted-foreground";
  return <span className={`mb-1 mr-1 inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium ${cor}`}>{children}</span>;
}

function SelosDaConferencia({ v }: { v: Verificacao }) {
  const identidade = pct(v.identidade);
  return (
    <>
      {v.ortografia_ok === true && <Selo tom="ok"><CheckCircle2 className="mr-1 h-3 w-3" /> ortografia ok</Selo>}
      {v.ortografia_ok === false && <Selo tom="erro"><TriangleAlert className="mr-1 h-3 w-3" /> erro de texto</Selo>}
      {identidade !== null && <Selo tom={identidade >= 70 ? "ok" : identidade >= 50 ? "alerta" : "erro"}>identidade {identidade}%</Selo>}
      {v.logo_ok === true && <Selo tom="ok">logo ok</Selo>}
      {v.logo_ok === false && <Selo tom="alerta">{v.logo_presente ? "logo sobrando" : "logo faltando"}</Selo>}
      {v.erro && <Selo tom="alerta">conferência incompleta</Selo>}
    </>
  );
}

/** Conferência compacta: selos no cabeçalho; texto lido e diferenças só aberto. */
function Conferencia({ versao, conferindo, acaoConferir }: { versao: CardGerado; conferindo: boolean; acaoConferir: ReactNode }) {
  const [aberta, setAberta] = useState(false);
  const v = versao.verificacao || null;
  const pendente = !v || v.pendente;

  if (pendente) {
    return (
      <div className="flex flex-wrap items-center rounded-xl border border-border bg-background px-3 py-2.5">
        <span className="mr-2 text-[11.5px] font-medium">Conferência</span>
        {conferindo ? (
          <span className="inline-flex items-center text-[11.5px] text-muted-foreground"><Loader2 className="mr-1 h-3 w-3 animate-spin" /> conferindo</span>
        ) : (
          <>
            <span className="mr-2 text-[11.5px] text-muted-foreground">ainda não feita</span>
            {acaoConferir}
          </>
        )}
      </div>
    );
  }

  const identidade = v && typeof v.identidade === "object" && v.identidade && "nivel" in v.identidade ? (v.identidade as any).nivel : null;
  return (
    <div className="rounded-xl border border-border bg-background">
      <button type="button" onClick={() => setAberta((a) => !a)} aria-expanded={aberta} className="flex w-full items-start rounded-xl px-3 py-2.5 text-left hover:bg-secondary">
        <span className="min-w-0 flex-1">
          <span className="mb-1 flex items-center text-[11.5px] font-medium">
            Conferência
            {conferindo && <Loader2 className="ml-1.5 h-3 w-3 animate-spin text-muted-foreground" />}
          </span>
          <span className="flex flex-wrap">{v && <SelosDaConferencia v={v} />}</span>
        </span>
        <ChevronDown className={`mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform ${aberta ? "rotate-180" : ""}`} />
      </button>
      {aberta && v && (
        <div className="space-y-2.5 border-t border-border px-3 pb-3 pt-2.5 text-[12px]">
          {v.faltando && v.faltando.length > 0 && (
            <p className="[overflow-wrap:anywhere]"><span className="text-destructive">Faltou na arte:</span> {v.faltando.join(", ")}</p>
          )}
          {v.sobrando && v.sobrando.length > 0 && (
            <p className="[overflow-wrap:anywhere]"><span className="text-warning">Apareceu a mais:</span> {v.sobrando.join(", ")}</p>
          )}
          {identidade && <p className="text-muted-foreground">Identidade: {identidade}</p>}
          {v.texto_lido && (
            <div>
              <p className="text-[10.5px] uppercase tracking-wide text-muted-foreground">Texto lido na imagem</p>
              <p className="mt-0.5 whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">{v.texto_lido}</p>
            </div>
          )}
          {v.erro && <p className="text-muted-foreground [overflow-wrap:anywhere]">A conferência não terminou ({v.erro}).</p>}
          {v.conferido_em && <p className="text-[11px] text-muted-foreground">Conferida em {dataEHora(v.conferido_em)}</p>}
          <div>{acaoConferir}</div>
        </div>
      )}
    </div>
  );
}

const ABAS: { valor: "direcao" | "ajustar" | "versoes"; rotulo: string }[] = [
  { valor: "direcao", rotulo: "Direção" },
  { valor: "ajustar", rotulo: "Ajustar" },
  { valor: "versoes", rotulo: "Versões" },
];

const MODOS_DE_AJUSTE: { valor: "livre" | "areas" | "fundo"; rotulo: string; icone: ReactNode }[] = [
  { valor: "livre", rotulo: "Pedido livre", icone: <MessageSquare className="mr-1.5 h-3.5 w-3.5" /> },
  { valor: "areas", rotulo: "Ajustar uma área", icone: <Crop className="mr-1.5 h-3.5 w-3.5" /> },
  { valor: "fundo", rotulo: "Trocar só o fundo", icone: <Paintbrush className="mr-1.5 h-3.5 w-3.5" /> },
];

export default function CardDoEstudio({
  conversaId,
  direcao,
  versoes,
  ocupado,
  conferindo,
  gerandoDesde,
  painel,
  onPainel,
  partesGerar,
  partesAjustar,
  partesConferir,
  onGerar,
  onAjustar,
  onConferir,
  onConfigurar,
  onConcluido,
}: {
  conversaId: string | null;
  direcao: CardDaDirecao;
  versoes: CardGerado[];
  /** Esta lâmina está gerando, ajustando ou na fila agora. */
  ocupado: boolean;
  /** Este card está na conferência agora (depois de gerar ou ajustar). */
  conferindo: boolean;
  gerandoDesde?: number;
  painel: PainelDaLamina;
  onPainel: (p: PainelDaLamina) => void;
  partesGerar: () => ParteDaEstimativa[];
  partesAjustar: () => ParteDaEstimativa[];
  partesConferir: () => ParteDaEstimativa[];
  onGerar: () => Promise<any>;
  onAjustar: (instrucao: string, opcoes?: OpcoesDoAjuste) => Promise<any>;
  onConferir: () => Promise<any>;
  /** Grava na lâmina sem custo (estudio-arte "configurar"). */
  onConfigurar: (card: { imagens_ids?: string[]; texto_exato?: string }) => Promise<void>;
  onConcluido: () => void;
}) {
  const ordenadas = versoes.slice().sort((a, b) => a.versao - b.versao);
  const ultima = ordenadas[ordenadas.length - 1] || null;
  const [versaoVista, setVersaoVista] = useState<number | null>(ultima?.versao ?? null);
  const [instrucao, setInstrucao] = useState("");
  const [areas, setAreas] = useState<Area[]>([]);
  const [fundoId, setFundoId] = useState<string | null>(null);
  const [acervoAberto, setAcervoAberto] = useState<"lamina" | "fundo" | null>(null);
  const [salvandoFoto, setSalvandoFoto] = useState(false);
  const [editandoTexto, setEditandoTexto] = useState(false);
  const [texto, setTexto] = useState(direcao.texto_exato || "");
  const [salvandoTexto, setSalvandoTexto] = useState(false);

  // Chegou versão nova: mostra a nova.
  useEffect(() => { setVersaoVista(ultima?.versao ?? null); }, [ultima?.versao]);
  useEffect(() => { if (!editandoTexto) setTexto(direcao.texto_exato || ""); }, [direcao.texto_exato, editandoTexto]);

  const vista = ordenadas.find((v) => v.versao === versaoVista) || ultima;
  const aba: "direcao" | "ajustar" | "versoes" = !ultima ? "direcao" : painel === "versoes" ? "versoes" : painel === "direcao" ? "direcao" : "ajustar";
  const modoAjuste: "livre" | "areas" | "fundo" = painel === "areas" || painel === "fundo" ? painel : "livre";
  const desenhando = aba === "ajustar" && modoAjuste === "areas" && !!ultima;

  const fotosIds = direcao.imagens_ids || [];
  const precisaAcervo = fotosIds.length > 0 || !!fundoId || acervoAberto !== null;
  const acervo = useAcervo(precisaAcervo);
  const achar = (id: string | null): ImagemDoAcervo | null => (id ? (acervo.data || []).find((i) => i.id === id) || null : null);
  const foto = achar(fotosIds[0] || null);
  const fundo = achar(fundoId);

  const pedidos = useQuery({
    queryKey: ["mesa", "ajustes", conversaId, direcao.ordem],
    enabled: aba === "ajustar" && !!conversaId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("agente_mensagens")
        .select("id, papel, conteudo, anexos, criado_em")
        .eq("conversa_id", conversaId)
        .order("criado_em", { ascending: true });
      if (error) throw error;
      return ((data || []) as any[]).filter((m) => {
        const anexos = Array.isArray(m.anexos) ? m.anexos : m.anexos ? [m.anexos] : [];
        return m.papel !== "sistema" && anexos.some((a: any) => Number(a?.ordem) === direcao.ordem);
      });
    },
  });

  const escolherFoto = async (i: ImagemDoAcervo | null) => {
    setSalvandoFoto(true);
    try {
      await onConfigurar({ imagens_ids: i ? [i.id] : [] });
      setAcervoAberto(null);
      toast.success(i ? "Foto real ligada à lâmina" : "Foto real removida", {
        description: i && ultima ? "Gere a lâmina de novo para usar a foto." : undefined,
      });
    } catch (e) {
      toast.error("Não foi possível salvar", { description: textoDoErro(e) });
    } finally {
      setSalvandoFoto(false);
    }
  };

  const salvarTexto = async () => {
    setSalvandoTexto(true);
    try {
      await onConfigurar({ texto_exato: texto.trim() });
      setEditandoTexto(false);
      toast.success("Texto salvo", { description: ultima ? "Gere de novo para a arte mostrar o texto novo." : undefined });
    } catch (e) {
      toast.error("Texto não salvo", { description: textoDoErro(e) });
    } finally {
      setSalvandoTexto(false);
    }
  };

  const aoAjustar = () => {
    setInstrucao("");
    setAreas([]);
    setFundoId(null);
    onConcluido();
  };

  const acaoConferir = vista && vista.versao === ultima?.versao ? (
    <BotaoComCusto
      rotulo={<><RefreshCw className="mr-1 h-3 w-3" /> Conferir</>}
      titulo={`Conferir a lâmina ${direcao.ordem}`}
      descricao="A leitura compara o texto da imagem com o texto exato e o Jev confere a identidade."
      variant="outline"
      className="h-7 px-2 text-[11px]"
      disabled={ocupado}
      partes={partesConferir}
      executar={onConferir}
      aoConcluir={onConcluido}
    />
  ) : null;

  return (
    <article className="grid min-w-0 grid-cols-1 gap-6 rounded-2xl border border-border bg-card p-5 md:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-3">
        {desenhando ? (
          <SeletorDeAreas caminho={ultima?.storage_path} areas={areas} onMudar={setAreas} disabled={ocupado} />
        ) : (
          <div className="overflow-hidden rounded-lg border border-border">
            <Moldura45>
              <ImagemDaMesa caminho={vista?.storage_path} alt={`Lâmina ${direcao.ordem}`} className="h-full w-full" />
            </Moldura45>
          </div>
        )}
        {ordenadas.length > 1 && (
          <div className="flex flex-wrap">
            {ordenadas.map((v) => (
              <button
                key={v.versao}
                type="button"
                onClick={() => setVersaoVista(v.versao)}
                disabled={desenhando}
                className={`mb-1 mr-1 rounded-md px-2 py-0.5 text-[11px] transition-colors ${vista?.versao === v.versao ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground hover:text-foreground"}`}
              >
                v{v.versao}
              </button>
            ))}
          </div>
        )}
        {vista && !desenhando && <Conferencia versao={vista} conferindo={conferindo && vista.versao === ultima?.versao} acaoConferir={acaoConferir} />}
      </div>

      <div className="min-w-0 space-y-5">
        <div className="flex flex-wrap items-center">
          <div className="mb-2 mr-3 min-w-0 flex-1">
            <p className="text-[15px] font-semibold leading-tight">
              Lâmina {direcao.ordem}
              <span className="font-normal text-muted-foreground"> · {direcao.ordem === 1 || direcao.funcao === "capa" ? "capa" : direcao.funcao === "cta" ? "fechamento" : "conteúdo"}</span>
            </p>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {gerandoDesde !== undefined ? (
                <span className="inline-flex items-center text-primary"><Loader2 className="mr-1 h-3 w-3 animate-spin" /> gerando há <span className="ml-1 tabular-nums"><Cronometro desde={gerandoDesde} /></span></span>
              ) : ultima ? (
                `${ordenadas.length} ${ordenadas.length === 1 ? "versão" : "versões"} · vendo v${vista?.versao}`
              ) : (
                "Ainda sem arte"
              )}
            </p>
          </div>
          <div className="mb-2">
            <BotaoComCusto
              rotulo={<><Wand2 className="mr-1 h-3.5 w-3.5" /> {ultima ? "Gerar de novo" : "Gerar lâmina"}</>}
              titulo={`Gerar a lâmina ${direcao.ordem}`}
              descricao="O gerador faz a lâmina inteira com o texto dentro. Depois a leitura confere a ortografia e o Jev confere a identidade."
              variant={ultima ? "outline" : "default"}
              disabled={ocupado}
              partes={partesGerar}
              executar={onGerar}
              aoConcluir={onConcluido}
            />
          </div>
        </div>

        <div className="flex border-b border-border" role="tablist">
          {ABAS.map((a) => {
            const desligada = a.valor !== "direcao" && !ultima;
            const ativa = aba === a.valor;
            return (
              <button
                key={a.valor}
                type="button"
                role="tab"
                aria-selected={ativa}
                disabled={desligada}
                onClick={() => onPainel(a.valor === "ajustar" ? modoAjuste : a.valor)}
                className={`-mb-px mr-5 border-b-2 pb-2 text-[13px] transition-colors disabled:opacity-40 ${ativa ? "border-primary font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {a.rotulo}
                {a.valor === "versoes" && ordenadas.length > 0 ? <span className="ml-1 text-[11px] text-muted-foreground">{ordenadas.length}</span> : null}
              </button>
            );
          })}
        </div>

        {aba === "direcao" && (
          <div className="space-y-5">
            <div className="rounded-xl border border-border bg-background p-4">
              <div className="flex items-center">
                <p className="flex-1 text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">Texto exato</p>
                {!editandoTexto && (
                  <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11.5px]" onClick={() => setEditandoTexto(true)} disabled={ocupado}>
                    <Pencil className="mr-1 h-3 w-3" /> Editar
                  </Button>
                )}
              </div>
              {editandoTexto ? (
                <div className="mt-2 space-y-2">
                  <Textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={4} className="text-[13px]" />
                  <div className="flex justify-end">
                    <Button type="button" size="sm" variant="ghost" className="mr-2" onClick={() => { setEditandoTexto(false); setTexto(direcao.texto_exato || ""); }}>
                      Cancelar
                    </Button>
                    <Button type="button" size="sm" onClick={() => void salvarTexto()} disabled={salvandoTexto || texto.trim() === (direcao.texto_exato || "").trim()}>
                      {salvandoTexto && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
                      Salvar texto
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="mt-1.5 whitespace-pre-wrap text-[14px] leading-relaxed [overflow-wrap:anywhere]">{direcao.texto_exato || "Sem texto nesta lâmina."}</p>
              )}
            </div>

            {direcao.composicao && (
              <div>
                <p className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">Composição</p>
                <p className="mt-1 whitespace-pre-wrap text-[12.5px] leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">{direcao.composicao}</p>
              </div>
            )}

            <div className="space-y-3 rounded-xl border border-border bg-background p-4">
              <div>
                <p className="text-[12.5px] font-semibold">Imagem real desta lâmina</p>
                <p className="mt-0.5 text-[11.5px] leading-relaxed text-muted-foreground">A foto real é usada como está: só a área do texto é desenhada por cima dela pelo gerador.</p>
              </div>
              {fotosIds.length > 0 ? (
                <div className="flex items-center">
                  <div className="mr-3 w-16 shrink-0">
                    {foto ? <FotoDoAcervo imagem={foto} /> : <div className="h-16 w-16 animate-pulse rounded-md bg-secondary" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium">{foto ? foto.nome : "Foto do acervo"}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {foto ? [ROTULO_DA_CATEGORIA[foto.categoria || ""] || foto.categoria, foto.pasta].filter(Boolean).join(" · ") : acervo.isLoading ? "carregando…" : "não está mais no acervo"}
                    </p>
                  </div>
                  <div className="ml-2 flex shrink-0 flex-wrap justify-end">
                    <Button type="button" size="sm" variant="outline" className="mb-1 ml-1 h-8" disabled={salvandoFoto || ocupado} onClick={() => setAcervoAberto(acervoAberto === "lamina" ? null : "lamina")}>
                      Trocar
                    </Button>
                    <Button type="button" size="sm" variant="ghost" className="mb-1 ml-1 h-8 text-destructive hover:text-destructive" disabled={salvandoFoto || ocupado} onClick={() => void escolherFoto(null)}>
                      {salvandoFoto && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                      Remover
                    </Button>
                  </div>
                </div>
              ) : (
                <Button type="button" size="sm" variant="outline" disabled={salvandoFoto || ocupado} onClick={() => setAcervoAberto(acervoAberto === "lamina" ? null : "lamina")}>
                  {salvandoFoto ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="mr-1.5 h-3.5 w-3.5" />}
                  Escolher do acervo
                </Button>
              )}
              {acervoAberto === "lamina" && (
                <SeletorDoAcervo
                  titulo="Foto real para esta lâmina"
                  escolhidas={fotosIds}
                  onEscolher={(i) => void escolherFoto(i)}
                  onFechar={() => setAcervoAberto(null)}
                />
              )}
            </div>
          </div>
        )}

        {aba === "ajustar" && ultima && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-1 rounded-xl border border-border bg-background p-1 sm:grid-cols-3">
              {MODOS_DE_AJUSTE.map((m) => (
                <button
                  key={m.valor}
                  type="button"
                  onClick={() => onPainel(m.valor)}
                  className={`flex min-w-0 items-center justify-center rounded-lg px-2 py-2 text-[12.5px] transition-colors ${
                    modoAjuste === m.valor ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                  }`}
                >
                  {m.icone}
                  <span className="truncate">{m.rotulo}</span>
                </button>
              ))}
            </div>

            {modoAjuste === "livre" && (
              <div className="space-y-2.5">
                <p className="text-[12px] leading-relaxed text-muted-foreground">Descreva a mudança. O diretor vira o pedido em instrução e o gerador edita a versão atual inteira.</p>
                <Textarea value={instrucao} onChange={(e) => setInstrucao(e.target.value)} rows={3} placeholder="Ex.: título maior e a planta mais à esquerda" />
                <div className="flex justify-end">
                  <BotaoComCusto
                    rotulo={<><Wand2 className="mr-1 h-3.5 w-3.5" /> Ajustar esta lâmina</>}
                    titulo={`Ajustar a lâmina ${direcao.ordem}`}
                    descricao="O diretor transforma o pedido em instrução de edição e o gerador edita a versão atual. A nova versão passa pela conferência."
                    disabled={ocupado || !instrucao.trim()}
                    partes={partesAjustar}
                    executar={() => onAjustar(instrucao.trim())}
                    aoConcluir={aoAjustar}
                  />
                </div>
              </div>
            )}

            {modoAjuste === "areas" && (
              <div className="space-y-2.5">
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  Arraste sobre a lâmina, à esquerda, para marcar uma ou mais áreas. Só o que estiver dentro delas muda; o resto fica igual.
                </p>
                <div className="flex items-center">
                  <span className={`flex-1 text-[12px] ${areas.length ? "font-medium text-primary" : "text-muted-foreground"}`}>
                    {areas.length ? `${areas.length} área${areas.length === 1 ? "" : "s"} marcada${areas.length === 1 ? "" : "s"}` : "Nenhuma área marcada ainda"}
                  </span>
                  {areas.length > 0 && (
                    <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11.5px]" onClick={() => setAreas([])}>
                      Limpar áreas
                    </Button>
                  )}
                </div>
                <Textarea value={instrucao} onChange={(e) => setInstrucao(e.target.value)} rows={3} placeholder="O que mudar nas áreas marcadas. Ex.: trocar o copo por uma xícara branca" />
                <div className="flex justify-end">
                  <BotaoComCusto
                    rotulo={<><Crop className="mr-1 h-3.5 w-3.5" /> Ajustar só as áreas</>}
                    titulo={`Ajustar áreas da lâmina ${direcao.ordem}`}
                    descricao="O gerador edita só dentro das áreas marcadas (máscara). A nova versão passa pela conferência."
                    disabled={ocupado || !instrucao.trim() || areas.length === 0}
                    partes={partesAjustar}
                    executar={() => onAjustar(instrucao.trim(), { areas })}
                    aoConcluir={aoAjustar}
                  />
                </div>
              </div>
            )}

            {modoAjuste === "fundo" && (
              <div className="space-y-2.5">
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  Mantém o texto e o primeiro plano e troca só o fundo. Escolha uma foto do acervo para o novo fundo ou descreva como ele deve ser.
                </p>
                {fundoId ? (
                  <div className="flex items-center rounded-xl border border-border bg-background p-2.5">
                    <div className="mr-3 w-14 shrink-0">{fundo ? <FotoDoAcervo imagem={fundo} /> : <div className="h-14 w-14 animate-pulse rounded-md bg-secondary" />}</div>
                    <p className="min-w-0 flex-1 truncate text-[12.5px]">{fundo ? fundo.nome : "Foto do acervo"}</p>
                    <Button type="button" size="sm" variant="ghost" className="h-7 px-2 text-[11.5px]" onClick={() => setFundoId(null)}>
                      Tirar
                    </Button>
                  </div>
                ) : (
                  <Button type="button" size="sm" variant="outline" onClick={() => setAcervoAberto(acervoAberto === "fundo" ? null : "fundo")}>
                    <ImageIcon className="mr-1.5 h-3.5 w-3.5" /> Usar uma foto do acervo como fundo
                  </Button>
                )}
                {acervoAberto === "fundo" && (
                  <SeletorDoAcervo
                    titulo="Novo fundo"
                    escolhidas={fundoId ? [fundoId] : []}
                    onEscolher={(i) => { setFundoId(i.id); setAcervoAberto(null); }}
                    onFechar={() => setAcervoAberto(null)}
                  />
                )}
                <Textarea value={instrucao} onChange={(e) => setInstrucao(e.target.value)} rows={2} placeholder="Opcional. Ex.: fundo de madeira clara, luz de manhã" />
                <div className="flex justify-end">
                  <BotaoComCusto
                    rotulo={<><Paintbrush className="mr-1 h-3.5 w-3.5" /> Trocar o fundo</>}
                    titulo={`Trocar o fundo da lâmina ${direcao.ordem}`}
                    descricao="O gerador troca só o fundo, mantendo o texto e o primeiro plano. A nova versão passa pela conferência."
                    disabled={ocupado || (!instrucao.trim() && !fundoId)}
                    partes={partesAjustar}
                    executar={() => onAjustar(instrucao.trim() || "Trocar só o fundo, mantendo o texto e o primeiro plano.", { tipo: "fundo", imagem_id: fundoId || undefined })}
                    aoConcluir={aoAjustar}
                  />
                </div>
              </div>
            )}

            {(pedidos.data || []).length > 0 && (
              <div className="space-y-2 border-t border-border pt-4">
                <p className="text-[10.5px] font-medium uppercase tracking-wider text-muted-foreground">Pedidos anteriores desta lâmina</p>
                <ul className="space-y-1.5">
                  {(pedidos.data || []).slice(-6).map((m: any) => (
                    <li
                      key={m.id}
                      className={`rounded-lg px-3 py-2 text-[12px] leading-relaxed [overflow-wrap:anywhere] ${m.papel === "usuario" ? "bg-primary/10 text-foreground" : "bg-secondary text-muted-foreground"}`}
                    >
                      {m.conteudo}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {aba === "versoes" && (
          <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
            {ordenadas.slice().reverse().map((v) => (
              <li key={v.versao} className="min-w-0">
                <button
                  type="button"
                  onClick={() => setVersaoVista(v.versao)}
                  className={`block w-full overflow-hidden rounded-lg border-2 transition-all ${vista?.versao === v.versao ? "border-primary shadow-md" : "border-border hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"}`}
                >
                  <Moldura45>
                    <ImagemDaMesa caminho={v.storage_path} alt={`Versão ${v.versao}`} className="h-full w-full" />
                  </Moldura45>
                </button>
                <p className="mt-1.5 text-[11.5px] font-medium">
                  v{v.versao}
                  <span className="font-normal text-muted-foreground"> · {v.origem === "ajuste" ? "ajuste" : "geração"}{v.versao === ultima?.versao ? " · atual" : ""}</span>
                </p>
                {v.instrucao && <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground [overflow-wrap:anywhere]" title={v.instrucao}>{v.instrucao}</p>}
                {v.criado_em && <p className="text-[10.5px] text-muted-foreground">{dataEHora(v.criado_em)}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </article>
  );
}
