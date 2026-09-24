import { useEffect, useRef, useState, type DragEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { ClipboardPaste, ImagePlus, Images, Loader2, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { textoDoErro } from "@/lib/mesa/api";
import { Ampliar } from "./Ampliar";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import { extensaoDoAnexo, MAX_BYTES_ANEXO } from "./mesaV4Api";
import SeletorDoAcervo, { FotoDoAcervo, useAcervo, type ImagemDoAcervo } from "./SeletorDoAcervo";
import type { CardDaDirecao, FotoLivre } from "./useItensDoMes";

/**
 * Ferramenta "Fotos" da lâmina: FOTO REAL COMPOSTA (pedido do dono em 23/09:
 * "foto real não é arte: é a foto que eu trago para compor. Ex.: quero esta
 * foto de fundo e que trabalhem junto com esta foto do rosto das pessoas.
 * Ter opção de colar e reconhecer").
 *
 * A pessoa cola (Ctrl+V), arrasta, escolhe um arquivo ou uma foto do acervo.
 * A foto sobe direto para o bucket `mesa` em
 * `<client_id>/estudio/fotos/<uuid>.<ext>` (a do acervo é copiada para lá) e
 * ganha um papel: Fundo (fica como está, o design vem por cima) ou Elemento
 * (pessoa, rosto ou objeto que entra como é), com uma nota opcional. Até 1
 * fundo e 2 elementos. "Salvar na lâmina" grava pelo configurar, sem custo
 * (contrato V5: card.fotos_livres); a próxima geração usa.
 *
 * O Ctrl+V só é interceptado quando há ARQUIVO de imagem na área de
 * transferência: colar texto em qualquer campo continua normal. Imagem com
 * texto junto: a imagem é anexada e o texto cola normal no campo em foco.
 */

export const LIMITE_DE_FUNDOS = 1;
export const LIMITE_DE_ELEMENTOS = 2;
export const NOTA_MAXIMA = 200;

const ROTULO_DO_PAPEL: Record<FotoLivre["papel"], string> = { fundo: "Fundo", elemento: "Elemento" };
const DICA_DO_PAPEL: Record<FotoLivre["papel"], string> = {
  fundo: "A foto é o fundo da lâmina: fica como está e o texto e o design vêm por cima",
  elemento: "Pessoa, rosto ou objeto real que entra na composição exatamente como é",
};

const contar = (lista: FotoLivre[], papel: FotoLivre["papel"]) => lista.filter((f) => f.papel === papel).length;

/** Papel da próxima foto: fundo se ainda não há; senão elemento; null quando está cheio. */
export function papelParaNova(lista: FotoLivre[]): FotoLivre["papel"] | null {
  if (contar(lista, "fundo") < LIMITE_DE_FUNDOS) return "fundo";
  if (contar(lista, "elemento") < LIMITE_DE_ELEMENTOS) return "elemento";
  return null;
}

/**
 * Troca o papel de uma foto. Virar fundo quando já há um: o fundo anterior
 * vira elemento (se couber). Devolve null quando a troca estoura o limite.
 */
export function trocarPapel(lista: FotoLivre[], indice: number, papel: FotoLivre["papel"]): FotoLivre[] | null {
  const alvo = lista[indice];
  if (!alvo || alvo.papel === papel) return lista;
  let nova = lista.map((f, i) => (i === indice ? { ...f, papel } : f));
  if (papel === "fundo" && contar(nova, "fundo") > LIMITE_DE_FUNDOS) {
    nova = nova.map((f, i) => (i !== indice && f.papel === "fundo" ? { ...f, papel: "elemento" as const } : f));
  }
  if (contar(nova, "fundo") > LIMITE_DE_FUNDOS || contar(nova, "elemento") > LIMITE_DE_ELEMENTOS) return null;
  return nova;
}

/** Só as fotos válidas, na forma do contrato (nota aparada, até 200 caracteres, sem nota vazia). */
export function fotosParaSalvar(lista: FotoLivre[]): FotoLivre[] {
  let fundos = 0;
  let elementos = 0;
  const saida: FotoLivre[] = [];
  for (const f of lista) {
    if (!f || !f.caminho) continue;
    if (f.papel === "fundo" ? fundos >= LIMITE_DE_FUNDOS : elementos >= LIMITE_DE_ELEMENTOS) continue;
    if (f.papel === "fundo") fundos++;
    else elementos++;
    const nota = (f.nota || "").trim().slice(0, NOTA_MAXIMA);
    saida.push(nota ? { caminho: f.caminho, papel: f.papel, nota } : { caminho: f.caminho, papel: f.papel });
  }
  return saida;
}

/** Corpo do configurar (contrato V5): { card: { ordem, fotos_livres } }; [] limpa. */
export function corpoDasFotos(ordem: number, lista: FotoLivre[]): { card: { ordem: number; fotos_livres: FotoLivre[] } } {
  return { card: { ordem, fotos_livres: fotosParaSalvar(lista) } };
}

/** Imagens (arquivos) que vieram no colar; texto não conta. */
export function imagensDoColar(dados: DataTransfer | null | undefined): File[] {
  const saida: File[] = [];
  if (!dados) return saida;
  const itens = dados.items;
  if (itens && itens.length) {
    for (let i = 0; i < itens.length; i++) {
      const it = itens[i];
      if (it && it.kind === "file" && String(it.type || "").indexOf("image/") === 0) {
        const f = it.getAsFile();
        if (f) saida.push(f);
      }
    }
  }
  if (!saida.length && dados.files && dados.files.length) {
    for (let i = 0; i < dados.files.length; i++) {
      const f = dados.files[i];
      if (f && String(f.type || "").indexOf("image/") === 0) saida.push(f);
    }
  }
  return saida;
}

/** O colar traz texto junto (text/plain não vazio)? Ex.: imagem copiada com a legenda. */
export function textoDoColar(dados: DataTransfer | null | undefined): boolean {
  if (!dados) return false;
  try {
    if (typeof dados.getData === "function") {
      const texto = dados.getData("text/plain");
      if (texto && texto.trim()) return true;
    }
  } catch {
    /* navegador que não deixa ler: olha os itens */
  }
  const itens = dados.items;
  if (itens && itens.length) {
    for (let i = 0; i < itens.length; i++) {
      const it = itens[i];
      if (it && it.kind === "string" && it.type === "text/plain") return true;
    }
  }
  return false;
}

/**
 * O que fazer com um Ctrl+V: as imagens a anexar e se o colar padrão é
 * bloqueado. Só bloqueia quando há imagem e NENHUM texto junto; com texto,
 * o texto cola normal no campo em foco e a imagem é anexada do mesmo jeito.
 * Colar só texto nunca é interceptado.
 */
export function decidirColar(dados: DataTransfer | null | undefined): { imagens: File[]; bloquear: boolean } {
  const imagens = imagensDoColar(dados);
  if (!imagens.length) return { imagens, bloquear: false };
  return { imagens, bloquear: !textoDoColar(dados) };
}

export const caminhoDaFoto =(clientId: string, id: string, ext: string) => `${clientId}/estudio/fotos/${id}.${ext}`;

/** UUID v4 (randomUUID quando existe; senão getRandomValues, que o Safari 11 tem). */
export function novoId(): string {
  const c: any = typeof crypto !== "undefined" ? crypto : null;
  if (c && typeof c.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  let h = "";
  for (let i = 0; i < 16; i++) h += (b[i] < 16 ? "0" : "") + b[i].toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const TIPO_DA_EXTENSAO: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Sobe a foto no bucket mesa e devolve o caminho. */
export async function subirFoto(clientId: string, arquivo: Blob, ext: string): Promise<string> {
  const caminho = caminhoDaFoto(clientId, novoId(), ext);
  const { error } = await supabase.storage.from("mesa").upload(caminho, arquivo, { contentType: TIPO_DA_EXTENSAO[ext] || "image/jpeg", upsert: false });
  if (error) throw error;
  return caminho;
}

/** Foto do acervo: copiada para a pasta de fotos do estúdio (o gerador lê só do bucket mesa). */
async function copiarDoAcervo(clientId: string, imagem: ImagemDoAcervo): Promise<string> {
  const ext = extensaoDoAnexo({ name: imagem.storage_path });
  if (!ext) throw new Error("Essa foto do acervo não é JPG, PNG ou WEBP.");
  const { data, error } = await supabase.storage.from(imagem.storage_bucket || "mesa").download(imagem.storage_path);
  if (error || !data) throw error || new Error("Não foi possível ler a foto do acervo.");
  return subirFoto(clientId, data, ext);
}

function MiniaturaDaFoto({ foto, indice, onAmpliar }: { foto: FotoLivre; indice: number; onAmpliar: () => void }) {
  return (
    <button
      type="button"
      onClick={onAmpliar}
      title="Ver grande"
      aria-label={`Ver a foto ${indice + 1} grande`}
      className="relative block h-16 w-16 shrink-0 overflow-hidden rounded-md border border-border bg-secondary"
    >
      <ImagemDaMesa caminho={foto.caminho} alt={`Foto ${indice + 1}`} className="h-full w-full" />
    </button>
  );
}

export default function EstudioFotos({
  card,
  ocupado,
  temArte,
  onSalvar,
  onTirarFotoAntiga,
}: {
  card: CardDaDirecao;
  /** A lâmina está gerando ou ajustando, ou já foi entregue. */
  ocupado: boolean;
  /** A lâmina já tem arte (a foto nova vale na próxima geração). */
  temArte: boolean;
  /** Grava as fotos na lâmina (configurar { card: { ordem, fotos_livres } }). */
  onSalvar: (corpo: { card: { ordem: number; fotos_livres: FotoLivre[] } }) => Promise<void>;
  /** Tira a foto do acervo ligada no modo antigo (imagens_ids). */
  onTirarFotoAntiga?: () => Promise<void>;
}) {
  const { clientId } = useMesa();
  const salvas = fotosParaSalvar(card.fotos_livres || []);
  const chaveSalvas = JSON.stringify(salvas);
  const [rascunho, setRascunho] = useState<FotoLivre[]>(salvas);
  const [enviando, setEnviando] = useState(0);
  const [salvando, setSalvando] = useState(false);
  const [acervoAberto, setAcervoAberto] = useState(false);
  const [arrastando, setArrastando] = useState(false);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const [tirandoAntiga, setTirandoAntiga] = useState(false);
  const entrada = useRef<HTMLInputElement>(null);
  // O rascunho mais recente, para os envios em sequência decidirem o papel certo.
  const atual = useRef<FotoLivre[]>(rascunho);
  atual.current = rascunho;

  // Outra lâmina ou fotos gravadas de novo: o rascunho volta ao que está salvo.
  useEffect(() => {
    setRascunho(salvas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.ordem, chaveSalvas]);

  const mudou = JSON.stringify(fotosParaSalvar(rascunho)) !== chaveSalvas;
  const cheio = papelParaNova(rascunho) === null;
  const antigas = card.imagens_ids || [];
  // Fotos aprovadas que vieram da Mesa Foto ("Usar na Mesa": &fotos=<ids>).
  const [params, setParams] = useSearchParams();
  const daMesaFoto = (params.get("fotos") || "").split(",").map((x) => x.trim()).filter(Boolean);
  const acervo = useAcervo(antigas.length > 0 || daMesaFoto.length > 0);
  const vindasDaMesaFoto = daMesaFoto.length ? (acervo.data || []).filter((i) => daMesaFoto.indexOf(i.id) >= 0) : [];
  const dispensarMesaFoto = () => {
    const p = new URLSearchParams(params);
    p.delete("fotos");
    setParams(p, { replace: true });
  };
  const fotoAntiga = antigas.length ? (acervo.data || []).find((i) => i.id === antigas[0]) || null : null;

  const adicionarCaminho = (caminho: string): boolean => {
    const papel = papelParaNova(atual.current);
    if (!papel) return false;
    const nova = atual.current.concat([{ caminho, papel }]);
    atual.current = nova;
    setRascunho(nova);
    return true;
  };

  const adicionarArquivos = async (arquivos: File[]) => {
    if (!arquivos.length) return;
    if (ocupado) {
      toast.error("Espere a lâmina terminar para trocar as fotos");
      return;
    }
    for (const arquivo of arquivos) {
      if (papelParaNova(atual.current) === null) {
        toast.error("Limite de fotos", { description: "Até 1 fundo e 2 elementos por lâmina. Tire uma para pôr outra." });
        return;
      }
      const ext = extensaoDoAnexo(arquivo);
      if (!ext) {
        toast.error(`${arquivo.name || "Imagem"}: envie JPG, PNG ou WEBP.`);
        continue;
      }
      if (arquivo.size > MAX_BYTES_ANEXO) {
        toast.error(`${arquivo.name || "Imagem"}: acima de 12 MB.`);
        continue;
      }
      setEnviando((n) => n + 1);
      try {
        const caminho = await subirFoto(clientId, arquivo, ext);
        adicionarCaminho(caminho);
      } catch (e) {
        toast.error("A foto não subiu", { description: textoDoErro(e) });
      } finally {
        setEnviando((n) => Math.max(0, n - 1));
      }
    }
  };

  const escolherDoAcervo = async (imagem: ImagemDoAcervo) => {
    setAcervoAberto(false);
    if (papelParaNova(atual.current) === null) {
      toast.error("Limite de fotos", { description: "Até 1 fundo e 2 elementos por lâmina." });
      return;
    }
    setEnviando((n) => n + 1);
    try {
      adicionarCaminho(await copiarDoAcervo(clientId, imagem));
    } catch (e) {
      toast.error("Não foi possível usar a foto do acervo", { description: textoDoErro(e) });
    } finally {
      setEnviando((n) => Math.max(0, n - 1));
    }
  };

  // Ctrl+V com a ferramenta aberta: só quando há arquivo de imagem na área de
  // transferência. Com texto junto, o texto cola normal e a imagem é anexada.
  useEffect(() => {
    const aoColar = (e: ClipboardEvent) => {
      const { imagens, bloquear } = decidirColar(e.clipboardData);
      if (!imagens.length) return;
      if (bloquear) e.preventDefault();
      void adicionarArquivos(imagens);
    };
    window.addEventListener("paste", aoColar);
    return () => window.removeEventListener("paste", aoColar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, ocupado]);

  const mudarPapel = (i: number, papel: FotoLivre["papel"]) => {
    const nova = trocarPapel(rascunho, i, papel);
    if (!nova) {
      toast.error("Não cabe", { description: "Até 1 fundo e 2 elementos por lâmina." });
      return;
    }
    setRascunho(nova);
  };
  const mudarNota = (i: number, nota: string) => setRascunho((l) => l.map((f, j) => (j === i ? { ...f, nota: nota.slice(0, NOTA_MAXIMA) } : f)));
  const remover = (i: number) => setRascunho((l) => l.filter((_, j) => j !== i));

  const salvar = async () => {
    setSalvando(true);
    try {
      await onSalvar(corpoDasFotos(card.ordem, rascunho));
      toast.success(rascunho.length ? "Fotos salvas na lâmina" : "Fotos tiradas da lâmina", {
        description: temArte ? "Gere a lâmina de novo para compor com as fotos." : undefined,
      });
    } catch (e) {
      toast.error("Fotos não salvas", { description: textoDoErro(e) });
    } finally {
      setSalvando(false);
    }
  };

  const tirarAntiga = async () => {
    if (!onTirarFotoAntiga) return;
    setTirandoAntiga(true);
    try {
      await onTirarFotoAntiga();
    } catch (e) {
      toast.error("Não foi possível tirar", { description: textoDoErro(e) });
    } finally {
      setTirandoAntiga(false);
    }
  };

  const soltar = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setArrastando(false);
    const arquivos: File[] = [];
    const lista = e.dataTransfer && e.dataTransfer.files;
    if (lista) for (let i = 0; i < lista.length; i++) arquivos.push(lista[i]);
    void adicionarArquivos(arquivos);
  };

  return (
    <div className="min-w-0 space-y-4">
      {vindasDaMesaFoto.length > 0 && (
        <section aria-label="Fotos da Mesa Foto" className="rounded-lg border border-primary/40 bg-primary/5 p-2.5">
          <div className="mb-2 flex min-w-0 items-center">
            <p className="min-w-0 flex-1 text-[12px] font-medium">Fotos que vieram da Mesa Foto</p>
            <button type="button" className="text-[11px] text-muted-foreground hover:text-foreground" onClick={dispensarMesaFoto}>Dispensar</button>
          </div>
          <ul className="grid grid-cols-3 gap-2">
            {vindasDaMesaFoto.map((imagem) => (
              <li key={imagem.id} className="min-w-0">
                <FotoDoAcervo imagem={imagem} />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-1 h-7 w-full px-1 text-[11px]"
                  disabled={ocupado || cheio || enviando > 0}
                  onClick={() => void escolherDoAcervo(imagem)}
                >
                  Usar nesta lâmina
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <p className="text-[12px] leading-relaxed text-muted-foreground">
        Foto real não é arte: é a foto que você traz para compor esta lâmina. <span className="text-foreground">Fundo</span> fica como está, com o texto
        e o design por cima. <span className="text-foreground">Elemento</span> é pessoa, rosto ou objeto que entra exatamente como é.
      </p>

      <div
        onDragOver={(e) => { e.preventDefault(); if (!arrastando) setArrastando(true); }}
        onDragLeave={() => setArrastando(false)}
        onDrop={soltar}
        aria-label="Soltar fotos aqui"
        className={`rounded-lg border border-dashed px-3 py-4 text-center transition-colors ${arrastando ? "border-primary bg-primary/5" : "border-border bg-background"} ${cheio ? "opacity-60" : ""}`}
      >
        {enviando > 0 ? (
          <p className="inline-flex items-center text-[12px] text-muted-foreground"><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Subindo a foto…</p>
        ) : (
          <>
            <p className="flex items-center justify-center text-[12.5px] font-medium">
              <ClipboardPaste className="mr-1.5 h-4 w-4 text-primary" /> Cole com Ctrl+V ou solte a foto aqui
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">JPG, PNG ou WEBP · até 1 fundo e 2 elementos</p>
          </>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-center">
          <Button type="button" size="sm" variant="outline" className="mb-1 mr-2 h-8 text-[12px]" disabled={cheio || ocupado || enviando > 0} onClick={() => entrada.current && entrada.current.click()}>
            <Upload className="mr-1.5 h-3.5 w-3.5" /> Escolher arquivo
          </Button>
          <Button type="button" size="sm" variant="outline" className="mb-1 h-8 text-[12px]" disabled={cheio || ocupado || enviando > 0} onClick={() => setAcervoAberto((a) => !a)}>
            <Images className="mr-1.5 h-3.5 w-3.5" /> Do acervo
          </Button>
          <input
            ref={entrada}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            aria-label="Escolher foto"
            onChange={(e) => {
              const arquivos: File[] = [];
              const lista = e.target.files;
              if (lista) for (let i = 0; i < lista.length; i++) arquivos.push(lista[i]);
              e.target.value = "";
              void adicionarArquivos(arquivos);
            }}
          />
        </div>
      </div>

      {acervoAberto && (
        <SeletorDoAcervo titulo="Foto real para compor" onEscolher={(i) => void escolherDoAcervo(i)} onFechar={() => setAcervoAberto(false)} />
      )}

      {rascunho.length > 0 ? (
        <ul className="space-y-2.5" aria-label="Fotos da lâmina">
          {rascunho.map((f, i) => (
            <li key={f.caminho} className="flex min-w-0 items-start rounded-lg border border-border bg-background p-2">
              <MiniaturaDaFoto foto={f} indice={i} onAmpliar={() => setAmpliada(i)} />
              <div className="ml-2.5 min-w-0 flex-1">
                <div className="flex min-w-0 items-center">
                  <div className="grid grid-cols-2 gap-0.5 rounded-md border border-border p-0.5" role="radiogroup" aria-label={`Papel da foto ${i + 1}`}>
                    {(["fundo", "elemento"] as const).map((p) => (
                      <button
                        key={p}
                        type="button"
                        role="radio"
                        aria-checked={f.papel === p}
                        title={DICA_DO_PAPEL[p]}
                        disabled={ocupado}
                        onClick={() => mudarPapel(i, p)}
                        className={`h-6 rounded px-2 text-[11px] transition-colors ${f.papel === p ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
                      >
                        {ROTULO_DO_PAPEL[p]}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => remover(i)}
                    disabled={ocupado}
                    aria-label={`Remover a foto ${i + 1}`}
                    title="Remover"
                    className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-destructive"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <Input
                  value={f.nota || ""}
                  onChange={(e) => mudarNota(i, e.target.value)}
                  maxLength={NOTA_MAXIMA}
                  disabled={ocupado}
                  placeholder={f.papel === "fundo" ? "Opcional. Ex.: manter a luz da manhã" : "Opcional. Ex.: rosto à direita, olhando para o texto"}
                  className="mt-1.5 h-8 text-[12px]"
                  aria-label={`Como usar a foto ${i + 1}`}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center text-[12px] text-muted-foreground">
          <ImagePlus className="mr-1.5 h-3.5 w-3.5" /> Nenhuma foto nesta lâmina: o gerador cria a imagem inteira.
        </p>
      )}

      <div className="flex min-h-9 items-center justify-end">
        {mudou ? (
          <>
            <Button type="button" size="sm" variant="ghost" className="mr-2 h-8" onClick={() => setRascunho(salvas)} disabled={salvando}>
              Desfazer
            </Button>
            <Button type="button" size="sm" className="h-8" onClick={() => void salvar()} disabled={salvando || ocupado || enviando > 0}>
              {salvando && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
              Salvar na lâmina
            </Button>
          </>
        ) : (
          <span className="text-[11.5px] text-muted-foreground">{salvas.length ? `${salvas.length} foto${salvas.length === 1 ? "" : "s"} na lâmina` : ""}</span>
        )}
      </div>

      {antigas.length > 0 && (
        <section className="border-t border-border pt-3">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Foto base do acervo (modo anterior)</p>
          <div className="flex min-w-0 items-center rounded-lg border border-border bg-background p-2">
            <div className="mr-2.5 w-12 shrink-0">{fotoAntiga ? <FotoDoAcervo imagem={fotoAntiga} /> : <div className="h-12 w-12 animate-pulse rounded-md bg-secondary" />}</div>
            <p className="min-w-0 flex-1 truncate text-[12.5px]">{fotoAntiga ? fotoAntiga.nome : acervo.isLoading ? "carregando…" : "não está mais no acervo"}</p>
            {onTirarFotoAntiga && (
              <Button type="button" size="sm" variant="ghost" className="h-8 shrink-0 px-2 text-[12px] text-destructive hover:text-destructive" disabled={tirandoAntiga || ocupado} onClick={() => void tirarAntiga()}>
                {tirandoAntiga && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                Tirar
              </Button>
            )}
          </div>
        </section>
      )}

      <Ampliar
        imagens={rascunho.map((f, i) => ({ caminho: f.caminho, titulo: `Foto ${i + 1} · ${ROTULO_DO_PAPEL[f.papel]}`, legenda: f.nota || undefined }))}
        indice={ampliada}
        onFechar={() => setAmpliada(null)}
      />
    </div>
  );
}
