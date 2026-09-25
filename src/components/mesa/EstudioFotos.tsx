import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { Check, ClipboardPaste, ImagePlus, Images, Loader2, Lock, Maximize2, RefreshCw, Scissors, Sparkles, TriangleAlert, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { chamarFuncao, ErroDaMesa, textoDoErro } from "@/lib/mesa/api";
import { FerramentasDaImagem } from "@/components/ferramentas/FerramentasDaImagem";
import { ehSemChave, tirarFundoPro, type ResultadoDaFerramenta } from "@/components/ferramentas/ferramentasApi";
import { Ampliar } from "./Ampliar";
import { ImagemDaMesa, useMesa } from "./MesaContexto";
import { extensaoDoAnexo, MAX_BYTES_ANEXO } from "./mesaV4Api";
import SeletorDoAcervo, { FotoDoAcervo, useAcervo, type ImagemDoAcervo } from "./SeletorDoAcervo";
import { AVISO_DO_METODO_ANTIGO, corpoDoTirarFundo, jaSemFundo, novoId, ofertaDoRecorteDoGerador } from "./estudioUtil";
import type { CardDaDirecao, FotoLivre as FotoLivreBase } from "./useItensDoMes";

/** Foto da lâmina; `recortada`: pessoa ou produto sem fundo (Tirar fundo), que entra pelo modo recorte. */
export type FotoLivre = FotoLivreBase & { recortada?: boolean };

/**
 * Ferramenta "Fotos" da lâmina: a FOTO DESTA LÂMINA, num lugar só (pedido do
 * dono em 25/09: "escolho do acervo, que são as fotos que foram feitas na
 * Mesa Foto. Não tem aqui"; "salvar lâmina não atualiza"; "tem que ser mais
 * simplificado essa parte de mandar as fotos").
 *
 * Três abas para trazer a foto: Acervo (as pastas do Workspace, Arquivos,
 * enviadas e a pasta Mesa Foto), Mesa Foto (as fotos feitas lá, com filtro
 * de aprovadas, Canvas, detalhe 4K, ensaios) e Subir (colar com Ctrl+V,
 * soltar ou escolher arquivo). A escolha GRAVA NA HORA na lâmina (configurar
 * { card: { ordem, fotos_livres } }, sem custo) e aparece na faixa em cima da
 * lâmina grande; não existe mais o "Salvar na lâmina" separado. A nota grava
 * ao sair do campo.
 *
 * Papel de cada foto: Fundo (a foto é o fundo; sem referência escolhida fica
 * como está e o texto vem por cima) ou Elemento (pessoa, rosto ou objeto que
 * entra como é). Até 1 fundo e 2 elementos. Com referência escolhida, a
 * lâmina replica o layout da referência e a foto é recomposta (o servidor
 * grava modo replicar_referencia; a faixa da lâmina avisa para conferir o rosto).
 *
 * Foto do bucket `mesa` na pasta do cliente (Mesa Foto, enviadas) entra pelo
 * próprio caminho, sem cópia; a de outro bucket (Workspace, Arquivos) é
 * copiada para `<client_id>/estudio/fotos/`, porque o gerador lê só do mesa.
 *
 * Correção de 25/09 (dono: "não consigo escolher as imagens nem abrir as
 * pastas; clico e não funciona"): com o trabalho entregue ou a lâmina cheia,
 * o acervo inteiro ficava com pointer-events-none, então nem as pastas
 * abriam, e a foto já usada ficava desabilitada sem dizer por quê. Agora as
 * pastas sempre abrem, o clique explica o que impede (e o trabalho entregue
 * mostra "Reabrir para corrigir") e clicar numa foto já na lâmina tira ela.
 *
 * Tirar fundo (25/09: "seleciono uma foto, quero essa foto sem o fundo; ele já
 * entra na lâmina real"): com "Tirar fundo" ligado, a foto escolhida passa pelo
 * removedor profissional (26/09: tirarFundoPro, BRIA RMBG 2.0 pela fal.ai; sem a
 * chave no servidor, cai no método antigo da Mesa Foto, preparar
 * fundo_transparente, com o aviso de qualidade), a derivada vai para o acervo e
 * entra na lâmina como ELEMENTO recortado: o estúdio põe a pessoa ou o produto
 * inteiro do lado oposto ao texto, sem caixa, com a referência e a marca em volta.
 * Falhou: o erro fica à vista com "Tentar de novo" e, quando o servidor oferece,
 * "Usar o recorte do gerador" (versão sem garantia de pixels iguais).
 *
 * Ampliar (26/09): cada foto do acervo na lâmina abre as ferramentas
 * profissionais (FerramentasDaImagem); a derivada ampliada troca a foto na lâmina.
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
    const foto: FotoLivre = nota ? { caminho: f.caminho, papel: f.papel, nota } : { caminho: f.caminho, papel: f.papel };
    // Só o elemento usa o recorte (o fundo é a foto inteira).
    if (f.recortada && f.papel === "elemento") foto.recortada = true;
    saida.push(foto);
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

// novoId mora em estudioUtil (arquivo leve): a Mesa Foto e a Mesa Ads usam só
// ele e baixavam este arquivo inteiro junto. Continua exportado daqui.
export { novoId };

const TIPO_DA_EXTENSAO: Record<string, string> = { jpg: "image/jpeg", png: "image/png", webp: "image/webp" };

/** Sobe a foto no bucket mesa e devolve o caminho. */
export async function subirFoto(clientId: string, arquivo: Blob, ext: string): Promise<string> {
  const caminho = caminhoDaFoto(clientId, novoId(), ext);
  const { error } = await supabase.storage.from("mesa").upload(caminho, arquivo, { contentType: TIPO_DA_EXTENSAO[ext] || "image/jpeg", upsert: false });
  if (error) throw error;
  return caminho;
}

/**
 * Caminho da foto do acervo para a lâmina: a do bucket mesa na pasta do
 * cliente entra como está (Mesa Foto, enviadas); null quando precisa copiar.
 */
export function caminhoDiretoDoAcervo(clientId: string, imagem: Pick<ImagemDoAcervo, "storage_bucket" | "storage_path">): string | null {
  const bucket = imagem.storage_bucket || "mesa";
  const caminho = String(imagem.storage_path || "");
  if (bucket !== "mesa" || !clientId) return null;
  if (caminho.indexOf(`${clientId}/`) !== 0 || caminho.indexOf("..") >= 0) return null;
  return caminho;
}

/** Foto do acervo fora do bucket mesa: copiada para a pasta de fotos do estúdio (o gerador lê só do bucket mesa). */
async function copiarDoAcervo(clientId: string, imagem: ImagemDoAcervo): Promise<string> {
  const direto = caminhoDiretoDoAcervo(clientId, imagem);
  if (direto) return direto;
  const ext = extensaoDoAnexo({ name: imagem.storage_path });
  if (!ext) throw new Error("Essa foto do acervo não é JPG, PNG ou WEBP.");
  const { data, error } = await supabase.storage.from(imagem.storage_bucket || "mesa").download(imagem.storage_path);
  if (error || !data) throw error || new Error("Não foi possível ler a foto do acervo.");
  return subirFoto(clientId, data, ext);
}

// ------------------------------------------------------------------ Mesa Foto

/** Foto feita na Mesa Foto (cliente_imagens com origem mesa_foto). */
export interface FotoDaMesaFoto extends ImagemDoAcervo {
  aprovada?: boolean | null;
  gerada?: boolean | null;
  modo?: string | null;
  criado_em?: string | null;
}

export type FiltroDaMesaFoto = "aprovadas" | "todas" | "canvas" | "detalhe" | "ensaios" | "preparadas";

export const FILTROS_DA_MESA_FOTO: { valor: FiltroDaMesaFoto; rotulo: string }[] = [
  { valor: "aprovadas", rotulo: "Aprovadas" },
  { valor: "todas", rotulo: "Todas" },
  { valor: "canvas", rotulo: "Canvas" },
  { valor: "detalhe", rotulo: "Detalhe 4K" },
  { valor: "ensaios", rotulo: "Ensaios" },
  { valor: "preparadas", rotulo: "Preparadas" },
];

const temTag = (f: Pick<FotoDaMesaFoto, "tags">, tag: string) => (f.tags || []).indexOf(tag) >= 0;

/** Referência da internet (foto de loja, "não publicar") não é foto do cliente: fica de fora. */
export function podeIrParaLamina(f: Pick<FotoDaMesaFoto, "tags">): boolean {
  return !temTag(f, "referencia_web") && !temTag(f, "nao_publicar");
}

/** As fotos da Mesa Foto que passam no filtro, mais novas primeiro. Função pura. */
export function filtrarDaMesaFoto(lista: FotoDaMesaFoto[], filtro: FiltroDaMesaFoto): FotoDaMesaFoto[] {
  const saida = lista.filter((f) => {
    if (f.origem && f.origem !== "mesa_foto") return false;
    if (!podeIrParaLamina(f)) return false;
    if (filtro === "aprovadas") return f.aprovada === true;
    if (filtro === "canvas") return f.modo === "canvas" || temTag(f, "canvas");
    if (filtro === "detalhe") return f.modo === "detalhe" || temTag(f, "detalhe_4k");
    if (filtro === "ensaios") return temTag(f, "ensaio") || f.modo === "ensaio";
    if (filtro === "preparadas") return (f.tags || []).some((t) => t.indexOf("preparo:") === 0);
    return true;
  });
  return saida.slice().sort((a, b) => String(b.criado_em || "").localeCompare(String(a.criado_em || "")));
}

/** Filtro que abre: Aprovadas quando há alguma; senão Todas. */
export function filtroInicialDaMesaFoto(lista: FotoDaMesaFoto[]): FiltroDaMesaFoto {
  return filtrarDaMesaFoto(lista, "aprovadas").length ? "aprovadas" : "todas";
}

export const chaveDaMesaFoto = (clientId: string) => ["mesa", "acervo-mesa-foto", clientId];

/**
 * Fotos da Mesa Foto do cliente, lidas à parte do acervo (com aprovada,
 * gerada, modo e data). Relê ao abrir (30 s de prazo) e tem o botão
 * Recarregar: foto aprovada agora na Mesa Foto aparece sem recarregar a página.
 */
export function useFotosDaMesaFoto(ativo = true) {
  const { clientId } = useMesa();
  return useQuery({
    queryKey: chaveDaMesaFoto(clientId),
    enabled: ativo && !!clientId,
    staleTime: 30_000,
    queryFn: async (): Promise<FotoDaMesaFoto[]> => {
      const { data, error } = await (supabase as any)
        .from("cliente_imagens")
        .select("id, storage_bucket, storage_path, nome, pasta, categoria, tags, descricao, origem, workspace_node_id, aprovada, gerada, modo, criado_em")
        .eq("client_id", clientId)
        .eq("origem", "mesa_foto")
        .eq("ativa", true)
        .order("criado_em", { ascending: false })
        .limit(600);
      if (error) throw error;
      return (data || []) as FotoDaMesaFoto[];
    },
  });
}

function RotuloDaFotoDaMesaFoto({ f }: { f: FotoDaMesaFoto }) {
  const rotulo = f.aprovada ? "aprovada" : f.modo === "canvas" ? "canvas" : f.modo === "detalhe" ? "detalhe 4K" : f.gerada ? "gerada" : "original";
  return (
    <span className={`absolute left-1 top-1 rounded-full px-1.5 py-px text-[9.5px] font-medium ${f.aprovada ? "bg-success text-white" : "bg-background/90 text-muted-foreground"}`}>
      {rotulo}
    </span>
  );
}

function AbaMesaFoto({ usadas, onUsar, onTirar }: { usadas: string[]; onUsar: (f: FotoDaMesaFoto) => void; onTirar: (caminho: string) => void }) {
  const { clientId } = useMesa();
  const fotos = useFotosDaMesaFoto();
  const lista = fotos.data || [];
  const [filtro, setFiltro] = useState<FiltroDaMesaFoto | null>(null);
  const filtroReal = filtro || filtroInicialDaMesaFoto(lista);
  const visiveis = useMemo(() => filtrarDaMesaFoto(lista, filtroReal), [lista, filtroReal]);
  const contagem = (f: FiltroDaMesaFoto) => filtrarDaMesaFoto(lista, f).length;

  return (
    <div className="min-w-0 space-y-2.5">
      <div className="flex min-w-0 items-start">
        <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-muted-foreground">
          Fotos feitas na Mesa Foto deste cliente (ensaios, Canvas, detalhe 4K, preparadas). Clique para usar nesta lâmina.
        </p>
        <Button type="button" size="sm" variant="ghost" className="ml-1 h-7 shrink-0 px-2 text-[11.5px]" onClick={() => void fotos.refetch()} disabled={fotos.isFetching} title="Reler as fotos da Mesa Foto">
          <RefreshCw className={`mr-1 h-3 w-3 ${fotos.isFetching ? "animate-spin" : ""}`} /> Recarregar
        </Button>
      </div>
      <div role="group" aria-label="Filtrar as fotos da Mesa Foto" className="flex flex-wrap">
        {FILTROS_DA_MESA_FOTO.map((f) => (
          <button
            key={f.valor}
            type="button"
            onClick={() => setFiltro(f.valor)}
            aria-pressed={filtroReal === f.valor}
            className={`mb-1.5 mr-1.5 rounded-full border px-2.5 py-0.5 text-[11px] transition-colors ${
              filtroReal === f.valor ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.rotulo} {fotos.data ? contagem(f.valor) : ""}
          </button>
        ))}
      </div>
      <div className="min-w-0 overflow-y-auto pr-0.5" style={{ maxHeight: 420 }}>
        {fotos.isLoading && (
          <p className="text-[12px] text-muted-foreground"><Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" />Lendo as fotos da Mesa Foto…</p>
        )}
        {fotos.isError && <p className="rounded-lg bg-destructive/10 p-2.5 text-[12px]">{textoDoErro(fotos.error)}</p>}
        {fotos.data && !lista.length && (
          <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-[12px] leading-relaxed text-muted-foreground">
            Nenhuma foto feita na Mesa Foto ainda.{" "}
            <Link className="font-medium text-foreground hover:underline" to={`/mesa-foto?client=${clientId}`}>Abrir a Mesa Foto</Link>
          </p>
        )}
        {fotos.data && lista.length > 0 && !visiveis.length && <p className="text-[12px] text-muted-foreground">Nenhuma foto neste filtro.</p>}
        <ul className="grid grid-cols-3 gap-2">
          {visiveis.map((f) => {
            const usada = usadas.indexOf(f.storage_path) >= 0;
            return (
              <li key={f.id} className="min-w-0">
                <button
                  type="button"
                  onClick={() => (usada ? onTirar(f.storage_path) : onUsar(f))}
                  title={usada ? "Já está na lâmina: clique para tirar" : f.descricao || f.nome}
                  aria-label={usada ? `Tirar da lâmina: ${f.nome}` : `Usar nesta lâmina: ${f.nome}`}
                  aria-pressed={usada}
                  className={`relative block w-full rounded-lg p-0.5 text-left transition-colors ${usada ? "bg-primary" : "hover:bg-primary/30"}`}
                >
                  <FotoDoAcervo imagem={f} />
                  <RotuloDaFotoDaMesaFoto f={f} />
                </button>
                <p className="mt-1 flex items-start text-[10.5px] leading-tight text-muted-foreground">
                  {usada && <Check className="mr-0.5 h-3 w-3 shrink-0 text-primary" />}
                  <span className="min-w-0 line-clamp-2 [overflow-wrap:anywhere]">{f.nome}</span>
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ tela

type AbaDasFotos = "acervo" | "mesa_foto" | "subir";

const ABAS_DAS_FOTOS: { valor: AbaDasFotos; rotulo: string; icone: typeof Images }[] = [
  { valor: "acervo", rotulo: "Acervo", icone: Images },
  { valor: "mesa_foto", rotulo: "Mesa Foto", icone: Sparkles },
  { valor: "subir", rotulo: "Subir", icone: Upload },
];

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

/** Falha do Tirar fundo mostrada no painel, com o que dá para fazer na hora. */
type FalhaDoFundo = {
  imagem: ImagemDoAcervo & { modo?: string | null };
  trocar?: string;
  mensagem: string;
  codigo: string | null;
  /** Versão do gerador já guardada pelo servidor (sem garantia de pixels iguais). */
  recorteDoGerador: string | null;
  /** O servidor aceita um novo pedido com aceitar_recorte_redesenhado. */
  podeAceitar: boolean;
  metodo: "pro" | "antigo";
};

export default function EstudioFotos({
  card,
  ocupado,
  entregue = false,
  onReabrir,
  temArte,
  onSalvar,
  onTirarFotoAntiga,
}: {
  card: CardDaDirecao;
  /** A lâmina está gerando ou ajustando (ou o trabalho foi entregue). */
  ocupado: boolean;
  /** Trabalho entregue: nada muda até reabrir (a tela diz isso em vez de travar calada). */
  entregue?: boolean;
  /** "Reabrir para corrigir" (estudio-arte reabrir). */
  onReabrir?: () => void;
  /** A lâmina já tem arte (a foto nova vale na próxima geração). */
  temArte: boolean;
  /** Grava as fotos na lâmina (configurar { card: { ordem, fotos_livres } }). */
  onSalvar: (corpo: { card: { ordem: number; fotos_livres: FotoLivre[] } }) => Promise<void>;
  /** Tira a foto do acervo ligada no modo antigo (imagens_ids). */
  onTirarFotoAntiga?: () => Promise<void>;
}) {
  const mesa = useMesa();
  const { clientId } = mesa;
  const queryClient = useQueryClient();
  const salvas = fotosParaSalvar((card.fotos_livres || []) as FotoLivre[]);
  const chaveSalvas = JSON.stringify(salvas);
  const [lista, setLista] = useState<FotoLivre[]>(salvas);
  const [enviando, setEnviando] = useState(0);
  const [gravando, setGravando] = useState(0);
  const [arrastando, setArrastando] = useState(false);
  const [ampliada, setAmpliada] = useState<number | null>(null);
  const [tirandoAntiga, setTirandoAntiga] = useState(false);
  // "Tirar fundo" ligado: a próxima foto escolhida sai sem fundo e entra como elemento.
  const [semFundo, setSemFundo] = useState(false);
  const [tirandoFundo, setTirandoFundo] = useState(0);
  // Falha do Tirar fundo à vista, com as saídas (usar o recorte do gerador ou tentar de novo).
  const [falhaDoFundo, setFalhaDoFundo] = useState<FalhaDoFundo | null>(null);
  // Foto da lâmina com as ferramentas de ampliar abertas (pelo caminho).
  const [ampliando, setAmpliando] = useState<string | null>(null);
  const [params, setParams] = useSearchParams();
  const daMesaFoto = (params.get("fotos") || "").split(",").map((x) => x.trim()).filter(Boolean);
  const [aba, setAba] = useState<AbaDasFotos>(daMesaFoto.length ? "mesa_foto" : "acervo");
  const entrada = useRef<HTMLInputElement>(null);
  // A lista mais recente, para os envios em sequência decidirem o papel certo.
  const atual = useRef<FotoLivre[]>(lista);
  atual.current = lista;
  // Gravações em fila: a última vence e nenhuma se perde no meio.
  const fila = useRef<Promise<void>>(Promise.resolve());

  // Outra lâmina ou fotos gravadas de novo: a lista volta ao que está salvo.
  useEffect(() => {
    setLista(salvas);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.ordem, chaveSalvas]);

  const cheio = papelParaNova(lista) === null;
  const antigas = card.imagens_ids || [];
  const acervo = useAcervo(true);
  const vindasDaMesaFoto = daMesaFoto.length ? (acervo.data || []).filter((i) => daMesaFoto.indexOf(i.id) >= 0) : [];
  const dispensarMesaFoto = () => {
    const p = new URLSearchParams(params);
    p.delete("fotos");
    setParams(p, { replace: true });
  };
  const fotoAntiga = antigas.length ? (acervo.data || []).find((i) => i.id === antigas[0]) || null : null;

  /** Grava a lista inteira na lâmina (na hora); se falhar, volta ao que estava salvo. */
  const gravar = (nova: FotoLivre[], aviso?: string) => {
    atual.current = nova;
    setLista(nova);
    setGravando((n) => n + 1);
    fila.current = fila.current.then(async () => {
      try {
        await onSalvar(corpoDasFotos(card.ordem, nova));
        if (aviso) toast.success(aviso, { description: temArte ? "Gere a lâmina de novo para usar a foto." : undefined });
      } catch (e) {
        setLista(salvas);
        toast.error("Fotos não gravadas na lâmina", { description: textoDoErro(e) });
      } finally {
        setGravando((n) => Math.max(0, n - 1));
      }
    });
  };

  const adicionarCaminho = (caminho: string): boolean => {
    if (atual.current.some((f) => f.caminho === caminho)) return true;
    const papel = papelParaNova(atual.current);
    if (!papel) return false;
    gravar(atual.current.concat([{ caminho, papel }]), papel === "fundo" ? "Foto na lâmina (fundo)" : "Foto na lâmina (elemento)");
    return true;
  };

  /** O que impede mexer nas fotos agora (null = pode). */
  const impedimento = (): string | null => {
    if (entregue) return "Este trabalho já foi entregue. Use \"Reabrir para corrigir\" para trocar as fotos.";
    if (ocupado) return "Espere a lâmina terminar para trocar as fotos.";
    return null;
  };
  const avisarImpedimento = (motivo: string) => {
    toast.error(motivo, entregue && onReabrir ? { action: { label: "Reabrir", onClick: onReabrir } } : undefined);
  };

  /** Tira da lâmina pelo caminho (miniatura marcada no acervo ou na Mesa Foto). */
  const tirarPeloCaminho = (caminho: string) => {
    const motivo = impedimento();
    if (motivo) {
      avisarImpedimento(motivo);
      return;
    }
    gravar(atual.current.filter((f) => f.caminho !== caminho), "Foto tirada da lâmina");
  };

  /** Elemento sem fundo na lâmina: entra como elemento (troca a mesma foto com fundo, se ela já estava). */
  const adicionarRecorte = (caminho: string, trocar?: string) => {
    const base = atual.current.filter((f) => f.caminho !== caminho && f.caminho !== trocar);
    if (contar(base, "elemento") >= LIMITE_DE_ELEMENTOS) {
      toast.error("Limite de elementos", { description: "Até 2 elementos por lâmina. Tire um para pôr a foto sem fundo." });
      return;
    }
    gravar(base.concat([{ caminho, papel: "elemento", recortada: true }]), "Foto sem fundo na lâmina (elemento)");
  };

  /** Caminho da derivada (Tirar fundo pro ou Ampliar) no bucket mesa: a do cliente entra direto; a de fora é copiada. */
  const caminhoDaDerivada = async (imagem: ResultadoDaFerramenta["imagem"]): Promise<string> =>
    caminhoDiretoDoAcervo(clientId, imagem) || (await copiarDoAcervo(clientId, imagem as unknown as ImagemDoAcervo));

  /**
   * Tirar o fundo de uma foto do acervo pelo removedor profissional
   * (tirarFundoPro; custo à vista na Mesa Foto). Sem a chave do provedor, o
   * método antigo (mesa-foto preparar, fundo_transparente) com o aviso de
   * qualidade. A derivada vai para o acervo e entra na lâmina como elemento
   * recortado. Foto que já é recorte entra direto. Falhou: o painel de falha
   * mostra o erro e as saídas; nada tenta de novo sozinho.
   */
  const tirarFundo = async (
    imagem: ImagemDoAcervo & { modo?: string | null },
    trocar?: string,
    opcoes: { metodo?: "pro" | "antigo"; aceitarRedesenhado?: boolean } = {},
  ) => {
    const motivo = impedimento();
    if (motivo) {
      avisarImpedimento(motivo);
      return;
    }
    if (jaSemFundo(imagem)) {
      setEnviando((n) => n + 1);
      try {
        adicionarRecorte(await copiarDoAcervo(clientId, imagem), trocar);
      } catch (e) {
        toast.error("Não foi possível usar a foto", { description: textoDoErro(e) });
      } finally {
        setEnviando((n) => Math.max(0, n - 1));
      }
      return;
    }
    setFalhaDoFundo(null);
    setTirandoFundo((n) => n + 1);
    let metodo: "pro" | "antigo" = opcoes.metodo || "pro";
    try {
      let caminho: string | null = null;
      if (metodo === "pro") {
        try {
          const r = await tirarFundoPro({ clientId, imagemId: imagem.id });
          caminho = r.imagem && r.imagem.storage_path ? await caminhoDaDerivada(r.imagem) : null;
        } catch (e) {
          if (!ehSemChave(e)) throw e;
          metodo = "antigo";
          toast.warning("Removedor profissional sem chave", { description: AVISO_DO_METODO_ANTIGO });
        }
      }
      if (metodo === "antigo") {
        const r = await chamarFuncao<{ imagem?: { storage_path?: string }; aviso?: string }>(
          "mesa-foto",
          corpoDoTirarFundo(clientId, imagem.id, { aceitarRedesenhado: opcoes.aceitarRedesenhado }),
        );
        caminho = (r && r.imagem && r.imagem.storage_path) || null;
        if (r && typeof r.aviso === "string" && r.aviso) toast.warning("Confira o recorte", { description: r.aviso });
      }
      if (!caminho) throw new Error("A foto sem fundo não voltou. Tente de novo.");
      adicionarRecorte(caminho, trocar);
      void queryClient.invalidateQueries({ queryKey: ["mesa", "acervo", clientId] });
      void queryClient.invalidateQueries({ queryKey: chaveDaMesaFoto(clientId) });
    } catch (e) {
      const codigo = e && typeof e === "object" ? (e as { codigo?: string }).codigo : undefined;
      // Já era recorte: entra do jeito que está.
      if (codigo === "ja_e_recorte") {
        try {
          adicionarRecorte(await copiarDoAcervo(clientId, imagem), trocar);
        } catch (e2) {
          toast.error("Não foi possível usar a foto", { description: textoDoErro(e2) });
        }
      } else {
        const oferta = ofertaDoRecorteDoGerador(e instanceof ErroDaMesa ? e.detalhes : null);
        setFalhaDoFundo({ imagem, trocar, mensagem: textoDoErro(e), codigo: codigo || null, recorteDoGerador: oferta.caminho, podeAceitar: oferta.podeAceitar, metodo });
        toast.error("Não foi possível tirar o fundo", { description: textoDoErro(e) });
      }
    } finally {
      setTirandoFundo((n) => Math.max(0, n - 1));
      mesa.atualizarCusto();
    }
  };

  /** "Usar o recorte do gerador": a versão já guardada entra direto; senão, um pedido novo que aceita o redesenho. */
  const usarRecorteDoGerador = (f: FalhaDoFundo) => {
    if (f.recorteDoGerador) {
      setFalhaDoFundo(null);
      adicionarRecorte(f.recorteDoGerador, f.trocar);
      return;
    }
    void tirarFundo(f.imagem, f.trocar, { metodo: "antigo", aceitarRedesenhado: true });
  };

  /** Ampliar (ferramentas pro): a derivada troca a foto na lâmina, com o mesmo papel e a mesma nota. */
  const trocarPelaAmpliada = async (caminhoAntigo: string, r: ResultadoDaFerramenta) => {
    try {
      const caminho = await caminhoDaDerivada(r.imagem);
      if (caminho === caminhoAntigo) return;
      gravar(atual.current.map((f) => (f.caminho === caminhoAntigo ? { ...f, caminho } : f)), "Foto ampliada na lâmina");
      setAmpliando(null);
      void queryClient.invalidateQueries({ queryKey: ["mesa", "acervo", clientId] });
    } catch (e) {
      toast.error("A foto ampliada não entrou na lâmina", { description: textoDoErro(e) });
    }
  };

  /** Foto da lâmina que está no acervo (para tirar o fundo dela). */
  const doAcervoPeloCaminho = (caminho: string) => (acervo.data || []).filter((i) => (i.storage_bucket || "mesa") === "mesa" && i.storage_path === caminho)[0] || null;

  const adicionarArquivos = async (arquivos: File[]) => {
    if (!arquivos.length) return;
    const motivo = impedimento();
    if (motivo) {
      avisarImpedimento(motivo);
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

  const usarDoAcervo = async (imagem: ImagemDoAcervo) => {
    const motivo = impedimento();
    if (motivo) {
      avisarImpedimento(motivo);
      return;
    }
    // Já na lâmina: o clique tira (antes o clique não fazia nada).
    const naLamina = atual.current.some((f) => f.caminho === imagem.storage_path);
    if (naLamina && (imagem.storage_bucket || "mesa") === "mesa") {
      tirarPeloCaminho(imagem.storage_path);
      return;
    }
    if (semFundo) {
      await tirarFundo(imagem);
      return;
    }
    if (papelParaNova(atual.current) === null) {
      toast.error("Limite de fotos", { description: "Até 1 fundo e 2 elementos por lâmina. Tire uma para pôr outra." });
      return;
    }
    setEnviando((n) => n + 1);
    try {
      adicionarCaminho(await copiarDoAcervo(clientId, imagem));
    } catch (e) {
      toast.error("Não foi possível usar a foto", { description: textoDoErro(e) });
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
    const motivo = impedimento();
    if (motivo) {
      avisarImpedimento(motivo);
      return;
    }
    const nova = trocarPapel(lista, i, papel);
    if (!nova) {
      toast.error("Não cabe", { description: "Até 1 fundo e 2 elementos por lâmina." });
      return;
    }
    if (nova !== lista) gravar(nova);
  };
  const mudarNota = (i: number, nota: string) => setLista((l) => l.map((f, j) => (j === i ? { ...f, nota: nota.slice(0, NOTA_MAXIMA) } : f)));
  /** A nota grava ao sair do campo (ou Enter), só se mudou. */
  const gravarNota = () => {
    if (JSON.stringify(fotosParaSalvar(atual.current)) !== chaveSalvas) gravar(atual.current);
  };
  const remover = (i: number) => {
    const motivo = impedimento();
    if (motivo) {
      avisarImpedimento(motivo);
      return;
    }
    gravar(lista.filter((_, j) => j !== i), "Foto tirada da lâmina");
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
    const recebidos = e.dataTransfer && e.dataTransfer.files;
    if (recebidos) for (let i = 0; i < recebidos.length; i++) arquivos.push(recebidos[i]);
    void adicionarArquivos(arquivos);
  };

  const bloqueado = ocupado || entregue || cheio || enviando > 0;
  const usadas = lista.map((f) => f.caminho);
  // Ids do acervo que estão na lâmina: o seletor marca e o clique tira.
  const idsUsados = (acervo.data || []).filter((i) => (i.storage_bucket || "mesa") === "mesa" && usadas.indexOf(i.storage_path) >= 0).map((i) => i.id);

  return (
    <div className="min-w-0 space-y-4">
      {entregue && (
        <div className="flex min-w-0 items-start rounded-lg border border-warning/50 bg-warning/10 px-3 py-2.5 text-[12px] leading-snug" role="status">
          <Lock className="mr-2 mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span className="min-w-0 flex-1">Trabalho entregue: as fotos não mudam. Reabra para corrigir; a entrega anterior fica no histórico.</span>
          {onReabrir && (
            <Button type="button" size="sm" variant="outline" className="ml-2 h-7 shrink-0 px-2 text-[11.5px]" onClick={onReabrir}>
              Reabrir
            </Button>
          )}
        </div>
      )}
      {/* Na lâmina agora: grava na hora, aparece na faixa em cima da lâmina grande. */}
      <section aria-label="Fotos desta lâmina" className="space-y-2">
        <div className="flex min-h-6 min-w-0 items-center">
          <p className="min-w-0 flex-1 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Na lâmina {card.ordem}</p>
          {(gravando > 0 || enviando > 0) && (
            <span className="inline-flex shrink-0 items-center text-[11px] text-muted-foreground">
              <Loader2 className="mr-1 h-3 w-3 animate-spin" /> {enviando > 0 ? "Subindo…" : "Gravando…"}
            </span>
          )}
        </div>
        {falhaDoFundo && (
          <div role="alert" data-falha-do-fundo="" className="rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2.5">
            <p className="flex items-start text-[12px] font-medium text-destructive">
              <TriangleAlert className="mr-1.5 mt-0.5 h-3.5 w-3.5 shrink-0" /> Não foi possível tirar o fundo de {falhaDoFundo.imagem.nome || "a foto"}
            </p>
            <p className="mt-1 text-[11.5px] leading-snug [overflow-wrap:anywhere]">{falhaDoFundo.mensagem}</p>
            {falhaDoFundo.metodo === "antigo" && (
              <p className="mt-1 text-[11px] leading-snug text-muted-foreground">Método antigo (sem o removedor profissional): o gerador redesenha o assunto.</p>
            )}
            <div className="mt-2 flex flex-wrap items-center">
              {(falhaDoFundo.recorteDoGerador || falhaDoFundo.podeAceitar) && (
                <Button
                  type="button"
                  size="sm"
                  className="mb-1 mr-2 h-8 text-[12px]"
                  disabled={tirandoFundo > 0}
                  onClick={() => usarRecorteDoGerador(falhaDoFundo)}
                  title={falhaDoFundo.recorteDoGerador ? "Usa a versão que o gerador devolveu, sem a garantia de pixels iguais aos da foto" : "Pede de novo aceitando o recorte redesenhado pelo gerador (custa 1 imagem)"}
                >
                  Usar o recorte do gerador
                </Button>
              )}
              <Button type="button" size="sm" variant="outline" className="mb-1 mr-2 h-8 text-[12px]" disabled={tirandoFundo > 0} onClick={() => void tirarFundo(falhaDoFundo.imagem, falhaDoFundo.trocar, { metodo: falhaDoFundo.metodo })}>
                {tirandoFundo > 0 ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-1 h-3.5 w-3.5" />} Tentar de novo
              </Button>
              <button type="button" className="mb-1 text-[11.5px] text-muted-foreground hover:text-foreground" onClick={() => setFalhaDoFundo(null)}>
                Fechar
              </button>
            </div>
            {!falhaDoFundo.recorteDoGerador && falhaDoFundo.podeAceitar && (
              <p className="text-[11px] leading-snug text-muted-foreground">Usar o recorte do gerador pede de novo (custa 1 imagem) e os pixels podem não ser os da foto original.</p>
            )}
          </div>
        )}
        {lista.length > 0 ? (
          <ul className="space-y-2.5">
            {lista.map((f, i) => (
              <li key={f.caminho} className="flex min-w-0 items-start rounded-lg border border-border bg-background p-2">
                <div className="shrink-0">
                  <MiniaturaDaFoto foto={f} indice={i} onAmpliar={() => setAmpliada(i)} />
                  {f.recortada && (
                    <span className="mt-1 flex items-center justify-center text-[10px] text-muted-foreground" title="Pessoa ou produto sem fundo: entra inteiro, do lado oposto ao texto">
                      <Scissors className="mr-0.5 h-3 w-3" /> sem fundo
                    </span>
                  )}
                </div>
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
                          onClick={() => mudarPapel(i, p)}
                          className={`h-6 rounded px-2 text-[11px] transition-colors ${f.papel === p ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:bg-secondary hover:text-foreground"}`}
                        >
                          {ROTULO_DO_PAPEL[p]}
                        </button>
                      ))}
                    </div>
                    {!f.recortada && (() => {
                      const doAcervo = doAcervoPeloCaminho(f.caminho);
                      return (
                        <button
                          type="button"
                          onClick={() => doAcervo && void tirarFundo(doAcervo, f.caminho)}
                          disabled={!doAcervo || tirandoFundo > 0}
                          title={doAcervo ? "Tirar o fundo desta foto (custo de 1 imagem): ela vira elemento sem fundo" : "Tirar fundo: escolha a foto pelo Acervo ou pela Mesa Foto"}
                          aria-label={`Tirar o fundo da foto ${i + 1}`}
                          className="ml-1.5 flex h-7 shrink-0 items-center rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
                        >
                          <Scissors className="mr-1 h-3.5 w-3.5" /> Tirar fundo
                        </button>
                      );
                    })()}
                    <button
                      type="button"
                      onClick={() => remover(i)}
                      aria-label={`Remover a foto ${i + 1}`}
                      title="Tirar da lâmina"
                      className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                  <Input
                    value={f.nota || ""}
                    onChange={(e) => mudarNota(i, e.target.value)}
                    onBlur={gravarNota}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") gravarNota();
                    }}
                    maxLength={NOTA_MAXIMA}
                    disabled={ocupado || entregue}
                    placeholder={f.papel === "fundo" ? "Opcional. Ex.: manter a luz da manhã" : "Opcional. Ex.: rosto à direita, olhando para o texto"}
                    className="mt-1.5 h-8 text-[12px]"
                    aria-label={`Como usar a foto ${i + 1}`}
                  />
                  {(() => {
                    const doAcervo = doAcervoPeloCaminho(f.caminho);
                    if (!doAcervo) return null;
                    const aberta = ampliando === f.caminho;
                    return (
                      <div className="mt-1.5">
                        <button
                          type="button"
                          onClick={() => setAmpliando(aberta ? null : f.caminho)}
                          aria-expanded={aberta}
                          disabled={ocupado || entregue}
                          className="flex h-7 items-center rounded-md px-1.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
                          title="Ampliar esta foto com as ferramentas profissionais (custo à vista antes de confirmar)"
                        >
                          <Maximize2 className="mr-1 h-3.5 w-3.5" /> {aberta ? "Fechar ampliar" : "Ampliar a foto"}
                        </button>
                        {aberta && (
                          <FerramentasDaImagem
                            clientId={clientId}
                            imagemId={doAcervo.id}
                            semTirarFundo
                            aoConcluir={(r) => void trocarPelaAmpliada(f.caminho, r)}
                            className="mt-1.5"
                          />
                        )}
                      </div>
                    );
                  })()}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center text-[12px] text-muted-foreground">
            <ImagePlus className="mr-1.5 h-3.5 w-3.5" /> Nenhuma foto nesta lâmina: o gerador cria a imagem inteira.
          </p>
        )}
        <p className="text-[11px] leading-snug text-muted-foreground">
          <span className="text-foreground">Fundo</span>: a foto é o fundo da lâmina. <span className="text-foreground">Elemento</span>: pessoa, rosto ou objeto que
          entra como é. Com referência escolhida, a foto é recomposta para seguir a referência.
        </p>
      </section>

      {vindasDaMesaFoto.length > 0 && (
        <section aria-label="Fotos que vieram da Mesa Foto" className="rounded-lg border border-primary/40 bg-primary/5 p-2.5">
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
                  disabled={enviando > 0}
                  onClick={() => void usarDoAcervo(imagem)}
                >
                  {usadas.indexOf(imagem.storage_path) >= 0 ? "Tirar da lâmina" : semFundo ? "Usar sem fundo" : "Usar nesta lâmina"}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Trazer a foto: Acervo | Mesa Foto | Subir. */}
      <section aria-label="Trazer foto" className="space-y-2.5">
        <div role="tablist" aria-label="De onde vem a foto" className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-background p-1">
          {ABAS_DAS_FOTOS.map((a) => {
            const Icone = a.icone;
            return (
              <button
                key={a.valor}
                type="button"
                role="tab"
                aria-selected={aba === a.valor}
                onClick={() => setAba(a.valor)}
                className={`flex h-8 min-w-0 items-center justify-center truncate rounded-md px-1 text-[12px] transition-colors ${aba === a.valor ? "bg-primary font-medium text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
              >
                <Icone className="mr-1 h-3.5 w-3.5 shrink-0" /> {a.rotulo}
              </button>
            );
          })}
        </div>
        {aba !== "subir" && (
          <button
            type="button"
            role="switch"
            aria-checked={semFundo}
            onClick={() => setSemFundo((v) => !v)}
            className={`flex w-full min-w-0 items-center rounded-lg border px-3 py-2 text-left transition-colors ${semFundo ? "border-primary bg-primary/5" : "border-border bg-background hover:border-primary/50"}`}
            title="Ligado: a foto escolhida sai sem o fundo (custo de 1 imagem por foto) e entra na lâmina como elemento, inteira, do lado oposto ao texto"
          >
            <Scissors className={`mr-2 h-4 w-4 shrink-0 ${semFundo ? "text-primary" : "text-muted-foreground"}`} />
            <span className="min-w-0 flex-1">
              <span className="block text-[12.5px] font-medium">Tirar fundo {semFundo ? "(ligado)" : ""}</span>
              <span className="block text-[11px] leading-snug text-muted-foreground">
                {semFundo ? "Escolha a foto: ela sai sem fundo e entra na lâmina como elemento. Custa 1 imagem." : "Ligue e escolha a foto: pessoa ou produto entra sem fundo, integrado à lâmina."}
              </span>
            </span>
            {tirandoFundo > 0 && <Loader2 className="ml-2 h-4 w-4 shrink-0 animate-spin text-primary" aria-label="Tirando o fundo" />}
          </button>
        )}
        {cheio && !semFundo && <p className="text-[11.5px] text-muted-foreground">A lâmina já tem 1 fundo e 2 elementos. Tire uma foto para pôr outra (clique na marcada para tirar).</p>}

        {/* As pastas sempre abrem; o que impede a escolha aparece no clique (antes o acervo inteiro ficava travado). */}
        {aba === "acervo" && (
          <SeletorDoAcervo titulo="Acervo do cliente (Workspace, Arquivos e Mesa Foto)" escolhidas={idsUsados} onEscolher={(i) => void usarDoAcervo(i)} />
        )}
        {aba === "mesa_foto" && <AbaMesaFoto usadas={usadas} onUsar={(f) => void usarDoAcervo(f)} onTirar={tirarPeloCaminho} />}
        {aba === "subir" && (
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
            <Button type="button" size="sm" variant="outline" className="mt-3 h-8 text-[12px]" disabled={bloqueado} onClick={() => entrada.current && entrada.current.click()}>
              <Upload className="mr-1.5 h-3.5 w-3.5" /> Escolher arquivo
            </Button>
          </div>
        )}
        <input
          ref={entrada}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          aria-label="Escolher foto"
          onChange={(e) => {
            const arquivos: File[] = [];
            const recebidos = e.target.files;
            if (recebidos) for (let i = 0; i < recebidos.length; i++) arquivos.push(recebidos[i]);
            e.target.value = "";
            void adicionarArquivos(arquivos);
          }}
        />
      </section>

      {antigas.length > 0 && (
        <section className="border-t border-border pt-3">
          <p className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Foto base do acervo (modo anterior)</p>
          <div className="flex min-w-0 items-center rounded-lg border border-border bg-background p-2">
            <div className="mr-2.5 w-12 shrink-0">{fotoAntiga ? <FotoDoAcervo imagem={fotoAntiga} /> : <div className="h-12 w-12 animate-pulse rounded-md bg-secondary" />}</div>
            <p className="min-w-0 flex-1 truncate text-[12.5px]">{fotoAntiga ? fotoAntiga.nome : acervo.isLoading ? "carregando…" : "não está mais no acervo"}</p>
            {onTirarFotoAntiga && (
              <Button type="button" size="sm" variant="ghost" className="h-8 shrink-0 px-2 text-[12px] text-destructive hover:text-destructive" disabled={tirandoAntiga || ocupado || entregue} onClick={() => void tirarAntiga()}>
                {tirandoAntiga && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
                Tirar
              </Button>
            )}
          </div>
        </section>
      )}

      <Ampliar
        imagens={lista.map((f, i) => ({ caminho: f.caminho, titulo: `Foto ${i + 1} · ${ROTULO_DO_PAPEL[f.papel]}`, legenda: f.nota || undefined }))}
        indice={ampliada}
        onFechar={() => setAmpliada(null)}
      />
    </div>
  );
}
