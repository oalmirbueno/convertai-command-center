import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Plus, Search, Star, Tag } from "lucide-react";
import { useMesa } from "./MesaContexto";
import { campo, foco, juntar } from "@/components/sistema/estilos";
import { useEstadoDaTela } from "@/components/sistema/useEstadoDaTela";
import { Ampliar, type ImagemAmpliavel } from "./Ampliar";
import { MiniaturaDaFoto } from "@/components/mesa-foto/Comuns";
import { useFotos, type FotoDoAcervo } from "@/components/mesa-foto/fotoApi";
import {
  acervoDaPauta, ehFavorita, emAlta, FILTROS_DO_ACERVO_DA_PAUTA, MAX_REFERENCIAS_DA_PAUTA, ORDENS_DO_ACERVO_DA_PAUTA, organizarFoto,
  PAPEIS_DA_REFERENCIA, ROTULO_DO_PAPEL, usoDaFoto, USOS_DA_FOTO,
  type FiltroDoAcervoDaPauta, type OrdemDoAcervoDaPauta, type PapelDaReferencia, type ReferenciaDaPauta, type UsoDaFoto,
} from "@/components/mesa-foto/fotoDaPautaApi";

/**
 * Acervo na pauta (27/10/2026): consultar as fotos do cliente com busca,
 * filtros e ordem; organizar (favorita e uso) sem sair da pauta; um clique
 * põe a foto no post ou vira referência do Gerar com o papel escolhido.
 */
export default function AcervoDaPauta({ taskId, noPost, onUsar, referencias, onReferencias, onAbrirCompleto }: {
  taskId: string; noPost: string[]; onUsar: (ids: string[]) => void;
  referencias: ReferenciaDaPauta[]; onReferencias: (r: ReferenciaDaPauta[]) => void;
  onAbrirCompleto?: () => void;
}) {
  const { clientId } = useMesa();
  const cache = useQueryClient();
  const fotos = useFotos(clientId);
  const chave = (parte: string) => `mesa:foto:acervo-da-pauta:${clientId}:${parte}`;
  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useEstadoDaTela<FiltroDoAcervoDaPauta>(chave("filtro"), "todas");
  const [ordem, setOrdem] = useEstadoDaTela<OrdemDoAcervoDaPauta>(chave("ordem"), "recentes");
  const [aberta, setAberta] = useState<string | null>(null);
  const [limite, setLimite] = useState(24);
  const [zoom, setZoom] = useState<ImagemAmpliavel | null>(null);
  const lista = useMemo(() => acervoDaPauta(fotos.data || [], { clientId, taskId, busca, filtro, ordem }), [fotos.data, clientId, taskId, busca, filtro, ordem]);
  const foto = lista.find((f) => f.id === aberta) || null;
  const organizar = async (f: FotoDoAcervo, mudanca: { favorita?: boolean; uso?: UsoDaFoto | null }) => {
    try { await organizarFoto(cache, clientId, f, mudanca); } catch (e) { toast.error(e instanceof Error ? e.message : "Não foi possível organizar."); }
  };
  const comoReferencia = (f: FotoDoAcervo, papel: PapelDaReferencia) => {
    const outras = referencias.filter((r) => r.imagem_id !== f.id);
    if (outras.length >= MAX_REFERENCIAS_DA_PAUTA) { toast.message(`Use no máximo ${MAX_REFERENCIAS_DA_PAUTA} referências.`); return; }
    onReferencias(outras.concat([{ imagem_id: f.id, papel }]));
    toast.success(`Referência marcada: ${ROTULO_DO_PAPEL[papel]}`, { description: "Ela já está no Gerar." });
  };
  return <section aria-label="Acervo do cliente" className="min-w-0 space-y-3" data-acervo-da-pauta="">
    <div className="relative"><Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" /><input aria-label="Buscar no acervo" value={busca} onChange={(e) => { setBusca(e.target.value); setLimite(24); }} placeholder="Nome, pasta, etiqueta" className={juntar(campo, "pl-8")} /></div>
    <div className="grid grid-cols-2 gap-2">
      <select aria-label="Filtrar o acervo" value={filtro} onChange={(e) => setFiltro(e.target.value as FiltroDoAcervoDaPauta)} className={campo}>{FILTROS_DO_ACERVO_DA_PAUTA.map((f) => <option key={f.valor} value={f.valor}>{f.rotulo}</option>)}</select>
      <select aria-label="Ordenar o acervo" value={ordem} onChange={(e) => setOrdem(e.target.value as OrdemDoAcervoDaPauta)} className={campo}>{ORDENS_DO_ACERVO_DA_PAUTA.map((o) => <option key={o.valor} value={o.valor}>{o.rotulo}</option>)}</select>
    </div>
    <p role="status" className="text-[12px] text-muted-foreground">{fotos.isLoading ? "Lendo o acervo…" : `${lista.length} ${lista.length === 1 ? "foto" : "fotos"}`}</p>
    <ul className="grid grid-cols-2 gap-2" aria-label="Fotos do acervo">
      {lista.slice(0, limite).map((f) => { const noPostJa = noPost.indexOf(f.id) >= 0; const uso = usoDaFoto(f); return <li key={f.id} className="min-w-0" data-foto-do-acervo={f.id}>
        <div className="relative">
          <button type="button" aria-label={`Abrir ${f.nome}`} aria-pressed={aberta === f.id} onClick={() => setAberta(aberta === f.id ? null : f.id)} className={juntar("block w-full overflow-hidden rounded-md border-2", foco, aberta === f.id ? "border-primary" : "border-transparent")}><MiniaturaDaFoto foto={f} /></button>
          <button type="button" aria-label={ehFavorita(f) ? `Desfavoritar ${f.nome}` : `Favoritar ${f.nome}`} aria-pressed={ehFavorita(f)} onClick={() => void organizar(f, { favorita: !ehFavorita(f) })} className="absolute right-1 top-1 rounded-full bg-card/90 p-1 hover:bg-card"><Star className={`h-3.5 w-3.5 ${ehFavorita(f) ? "fill-primary text-primary" : "text-muted-foreground"}`} aria-hidden="true" /></button>
          <button type="button" disabled={noPostJa} aria-label={noPostJa ? `${f.nome} já está no post` : `Usar ${f.nome} no post`} title={noPostJa ? "Já está no post" : "Usar no post"} onClick={() => onUsar([f.id])} className="absolute bottom-1 right-1 rounded-full bg-primary p-1 text-primary-foreground disabled:bg-muted disabled:text-muted-foreground">{noPostJa ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}</button>
        </div>
        <p className="mt-1 truncate text-[11px]">{uso ? `${USOS_DA_FOTO.find((u) => u.valor === uso)?.rotulo} · ` : ""}{f.nome}</p>
      </li>; })}
    </ul>
    {lista.length > limite && <button type="button" className="text-[12px] text-primary" onClick={() => setLimite((l) => l + 24)}>Ver mais ({lista.length - limite})</button>}
    {!fotos.isLoading && !lista.length && <p className="text-[13px] text-muted-foreground">Nenhuma foto neste filtro.</p>}
    {foto && <div className="min-w-0 space-y-3 border-t pt-3" data-foto-aberta={foto.id}>
      <button type="button" className="block w-full cursor-zoom-in" aria-label={`Ampliar ${foto.nome}`} onClick={() => setZoom({ caminho: foto.storage_path, bucket: foto.storage_bucket || "mesa", titulo: foto.nome })}><MiniaturaDaFoto foto={foto} className="rounded-md" /></button>
      <p className="truncate text-[13px] font-medium">{foto.nome}</p>
      <p className="text-[12px] text-muted-foreground">{foto.largura && foto.altura ? `${foto.largura} × ${foto.altura} px${emAlta(foto) === false ? " · abaixo da alta qualidade" : ""}` : "Tamanho ainda não medido"}</p>
      <div className="min-w-0"><p className="mb-1 flex items-center text-[12px] font-medium text-muted-foreground"><Tag className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Uso</p>
        <div role="radiogroup" aria-label="Marcar uso" className="flex flex-wrap">{[{ valor: null as UsoDaFoto | null, rotulo: "Sem uso" }, ...USOS_DA_FOTO].map((u) => <button key={u.valor || "nenhum"} type="button" role="radio" aria-checked={usoDaFoto(foto) === u.valor} onClick={() => void organizar(foto, { uso: u.valor })} className={juntar("mb-1 mr-1 rounded-full border px-2.5 py-1 text-[12px]", foco, usoDaFoto(foto) === u.valor ? "border-primary bg-primary/10" : "border-border text-muted-foreground")}>{u.rotulo}</button>)}</div>
      </div>
      <div className="min-w-0"><p className="mb-1 text-[12px] font-medium text-muted-foreground">Usar como referência do Gerar</p>
        <div className="flex flex-wrap">{PAPEIS_DA_REFERENCIA.map((p) => { const marcada = referencias.some((r) => r.imagem_id === foto.id && r.papel === p); return <button key={p} type="button" aria-pressed={marcada} onClick={() => comoReferencia(foto, p)} className={juntar("mb-1 mr-1 rounded-full border px-2.5 py-1 text-[12px]", foco, marcada ? "border-primary bg-primary/10" : "border-border text-muted-foreground hover:text-foreground")}>{ROTULO_DO_PAPEL[p]}</button>; })}</div>
      </div>
    </div>}
    {onAbrirCompleto && <button type="button" className="text-[12px] text-primary" onClick={onAbrirCompleto}>Abrir acervo completo (subir, pastas, Workspace)</button>}
    <Ampliar imagens={zoom ? [zoom] : []} indice={zoom ? 0 : null} onFechar={() => setZoom(null)} />
  </section>;
}
