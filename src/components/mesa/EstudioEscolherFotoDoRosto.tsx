import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderOpen, HardDrive, Images, Loader2, ScanFace, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { botao, CampoDeBusca, JanelaDoCelular, juntar, SeletorCompacto, useEstadoDaTela } from "@/components/sistema";
import { chamarFuncao, ehImagem, textoDoErro } from "@/lib/mesa/api";
import { imagensDoWorkspace, pastaDaFoto, pastasDoAcervo, pastasDoWorkspace, RAIZ, useArvoreDoWorkspace, type PastaDoExplorador } from "@/lib/mesa/pastas";
import { MiniaturaDoStorage } from "./ContextoMiniatura";
import { ExploradorDePastas } from "./NavegadorDePastas";

/**
 * Escolher a foto do rosto (frente R2, pedido do dono em 26/09: "posso buscar
 * qualquer foto que tiver pessoas, abrir a pasta, selecionar qualquer foto e
 * também o clone já gerado"). Janela com as fontes do cliente (Acervo, com a
 * pasta Mesa Foto; Workspace; Arquivos) e os Clones (fotos de origem, geradas
 * e vistas aprovadas, só com autorização válida). Filtro "Só com pessoa" pelos
 * metadados e pela leitura por visão guardada ("Marcar pessoas" lê uma vez as
 * que ainda não têm leitura). Seleção de 1 a 3. Aba, pasta, filtro e busca
 * lembrados por trabalho. Miniaturas próprias, nunca a transformação do Storage.
 */

export type AbaDaFotoDoRosto = "acervo" | "workspace" | "arquivo" | "clones";
export const MAX_ESCOLHIDAS = 3;

export type FotoParaRosto = {
  /** i:<uuid> acervo, w:<uuid> Workspace, a:<uuid> Arquivos, k:<clone>:<foto> clone. */
  id: string;
  nome: string;
  pasta: string;
  bucket: string;
  caminho: string | null;
  url?: string | null;
  /** true: tem pessoa; false: não tem; null: sem leitura ainda. */
  pessoa: boolean | null;
  busca: string;
  detalhe?: string | null;
};

export type LeituraDaPessoa = { pessoa: boolean; rosto: boolean };
export type FotoDeClone = { id: string; nome: string; papel: "origem" | "gerada" | "vista"; url: string | null };
export type CloneComFotos = { id: string; nome: string; grupo: "cliente" | "equipe"; fotos: FotoDeClone[] };

type EstadoDoNavegador = { aba: AbaDaFotoDoRosto; pasta: string; soPessoas: boolean; busca: string };
const ESTADO_INICIAL: EstadoDoNavegador = { aba: "acervo", pasta: RAIZ, soPessoas: true, busca: "" };
const ABAS: AbaDaFotoDoRosto[] = ["acervo", "workspace", "arquivo", "clones"];
const LIMITE_NA_BUSCA = 120;
const MAX_POR_LEITURA = 12;

export const chaveDoNavegadorDoRosto = (trabalhoId: string) => `mesa:estudio:rosto-fotos:${trabalhoId}`;

export function estadoDoNavegadorValido(v: unknown): boolean {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return ABAS.indexOf(o.aba as AbaDaFotoDoRosto) >= 0 && typeof o.pasta === "string" && typeof o.soPessoas === "boolean" && typeof o.busca === "string";
}

const PAPEL_DO_CLONE: Record<FotoDeClone["papel"], string> = { origem: "Foto de origem", gerada: "Gerada", vista: "Vista da folha" };

/** Texto sem acento e em minúsculas, para a busca (sem classes Unicode na regex, Safari 11). */
export function semAcento(t: string): string {
  return (t || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** O que os metadados do acervo já dizem: pessoa (true), logo (false) ou nada (null). */
export function pessoaPelosMetadados(i: { categoria?: string | null; tags?: string[] | null }): boolean | null {
  const c = String(i.categoria || "");
  if (c === "pessoa" || c === "equipe") return true;
  const tags = (i.tags || []).map((t) => String(t).toLowerCase());
  if (tags.indexOf("tipo:pessoa") >= 0 || tags.indexOf("pessoa_real_autorizada") >= 0 || tags.indexOf("pessoa") >= 0) return true;
  if (c === "logo") return false;
  return null;
}

/** Filtro "Só com pessoa": tira só as que a leitura ou os metadados dizem que não têm pessoa. */
export function filtrarFotos(lista: FotoParaRosto[], e: { soPessoas: boolean; busca: string }): FotoParaRosto[] {
  const termos = semAcento(e.busca).split(" ").filter(Boolean);
  return lista.filter((f) => {
    if (e.soPessoas && f.pessoa === false) return false;
    if (!termos.length) return true;
    const alvo = semAcento(f.busca);
    return termos.every((t) => alvo.indexOf(t) >= 0);
  });
}

/** Marca ou desmarca, no máximo MAX_ESCOLHIDAS (a mais nova não entra quando já tem 3). */
export function alternarEscolha(atual: string[], id: string): { lista: string[]; cheio: boolean } {
  if (atual.indexOf(id) >= 0) return { lista: atual.filter((x) => x !== id), cheio: false };
  if (atual.length >= MAX_ESCOLHIDAS) return { lista: atual, cheio: true };
  return { lista: atual.concat([id]), cheio: false };
}

/** A escolha precisa da confirmação de autorização quando tem foto que não é de clone (o clone já tem a dele registrada). */
export const precisaDeAutorizacao = (itens: string[]) => itens.some((i) => i.indexOf("k:") !== 0);

const leituraDe = (leituras: Record<string, LeituraDaPessoa>, id: string): boolean | null => (leituras[id] ? leituras[id].pessoa === true : null);

type RespostaDasFotos = {
  escolhidas?: { id: string; disponivel: boolean; nome: string | null; url: string | null }[];
  leituras?: Record<string, LeituraDaPessoa>;
  clones?: CloneComFotos[];
};

export const chaveDasFotosDoRosto = (trabalhoId: string) => ["estudio", "rosto-fotos", trabalhoId];

function Miniatura({ foto }: { foto: FotoParaRosto }) {
  if (foto.url) return <img src={foto.url} alt={foto.nome} loading="lazy" className="h-full w-full object-cover" />;
  return <MiniaturaDoStorage bucket={foto.bucket} caminho={foto.caminho} alt={foto.nome} largura={240} className="h-full w-full" />;
}

export default function EstudioEscolherFotoDoRosto({
  aberto,
  onFechar,
  trabalhoId,
  clientId,
  iniciais,
  autorizado,
  onAutorizado,
  onConfirmar,
  salvando = false,
}: {
  aberto: boolean;
  onFechar: () => void;
  trabalhoId: string;
  clientId: string;
  iniciais: string[];
  autorizado: boolean;
  onAutorizado: (v: boolean) => void;
  onConfirmar: (itens: string[]) => void | Promise<void>;
  salvando?: boolean;
}) {
  const queryClient = useQueryClient();
  const [estado, setEstado] = useEstadoDaTela<EstadoDoNavegador>(chaveDoNavegadorDoRosto(trabalhoId), ESTADO_INICIAL, { validar: estadoDoNavegadorValido, esperaMs: 300 });
  const mudar = (m: Partial<EstadoDoNavegador>) => setEstado((e) => ({ ...e, ...m }));
  const [escolha, setEscolha] = useState<string[]>(iniciais);
  const [marcando, setMarcando] = useState(false);
  useEffect(() => {
    if (aberto) setEscolha(iniciais.slice(0, MAX_ESCOLHIDAS));
  }, [aberto]); // eslint-disable-line react-hooks/exhaustive-deps

  const servidor = useQuery({
    queryKey: chaveDasFotosDoRosto(trabalhoId),
    enabled: aberto,
    staleTime: 5 * 60_000,
    queryFn: async () => (await chamarFuncao<RespostaDasFotos>("estudio-arte", { acao: "rostos_fotos", trabalho_id: trabalhoId })) || {},
  });
  const leituras = (servidor.data && servidor.data.leituras) || {};

  const precisaArvore = aberto && (estado.aba === "acervo" || estado.aba === "workspace");
  const arvore = useArvoreDoWorkspace(clientId, precisaArvore);

  const acervo = useQuery({
    queryKey: ["mesa", "rosto-acervo", clientId],
    enabled: aberto && estado.aba === "acervo",
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("cliente_imagens")
        .select("id, storage_bucket, storage_path, nome, pasta, categoria, tags, descricao, origem, workspace_node_id")
        .eq("client_id", clientId)
        .eq("ativa", true)
        .order("nome", { ascending: true })
        .limit(2000);
      if (error) throw error;
      return (data || []) as { id: string; storage_bucket: string; storage_path: string; nome: string; pasta: string | null; categoria: string | null; tags: string[] | null; descricao: string | null; origem: string | null; workspace_node_id: string | null }[];
    },
  });

  const arquivos = useQuery({
    queryKey: ["mesa", "rosto-arquivos", clientId],
    enabled: aberto && estado.aba === "arquivo",
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("files")
        .select("id, file_name, folder, mime_type, storage_bucket, storage_path")
        .eq("client_id", clientId)
        .is("parent_file_id", null)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(1500);
      if (error) throw error;
      return ((data || []) as { id: string; file_name: string; folder: string | null; mime_type: string | null; storage_bucket: string | null; storage_path: string | null }[])
        .filter((f) => !!f.storage_bucket && !!f.storage_path && ehImagem(f.mime_type, f.file_name));
    },
  });

  const { fotos, pastas, carregando, erro } = useMemo((): { fotos: FotoParaRosto[]; pastas: PastaDoExplorador[]; carregando: boolean; erro: string | null } => {
    if (estado.aba === "acervo") {
      const lista = acervo.data || [];
      const espelho = pastasDoAcervo(arvore.data || [], lista);
      return {
        pastas: espelho.pastas,
        carregando: acervo.isLoading,
        erro: acervo.isError ? "Não foi possível ler o acervo." : null,
        fotos: lista.map((i) => {
          const id = `i:${i.id}`;
          const meta = pessoaPelosMetadados(i);
          return {
            id,
            nome: i.nome,
            pasta: pastaDaFoto(i, espelho.pastaDoNo),
            bucket: i.storage_bucket || "mesa",
            caminho: i.storage_path,
            pessoa: meta !== null ? meta : leituraDe(leituras, id),
            busca: [i.nome, i.pasta, i.descricao, i.categoria, (i.tags || []).join(" ")].join(" "),
            detalhe: i.pasta,
          };
        }),
      };
    }
    if (estado.aba === "workspace") {
      const nos = arvore.data || [];
      return {
        pastas: pastasDoWorkspace(nos),
        carregando: arvore.isLoading,
        erro: arvore.isError ? "Não foi possível ler o Workspace." : null,
        fotos: imagensDoWorkspace(nos).map((n) => ({ id: `w:${n.id}`, nome: n.name, pasta: n.parent_id || RAIZ, bucket: "workspace", caminho: n.storage_path, pessoa: leituraDe(leituras, `w:${n.id}`), busca: n.name })),
      };
    }
    if (estado.aba === "arquivo") {
      const lista = arquivos.data || [];
      const nomes: string[] = [];
      const pastaDe = (f: { folder: string | null }) => (f.folder && f.folder.trim() ? f.folder.trim() : "Sem pasta");
      for (const f of lista) if (nomes.indexOf(pastaDe(f)) < 0) nomes.push(pastaDe(f));
      return {
        pastas: nomes.map((n) => ({ id: `pasta:${n}`, nome: n, paiId: RAIZ })),
        carregando: arquivos.isLoading,
        erro: arquivos.isError ? "Não foi possível ler Arquivos." : null,
        fotos: lista.map((f) => ({ id: `a:${f.id}`, nome: f.file_name, pasta: `pasta:${pastaDe(f)}`, bucket: f.storage_bucket || "mesa", caminho: f.storage_path, pessoa: leituraDe(leituras, `a:${f.id}`), busca: `${f.file_name} ${pastaDe(f)}` })),
      };
    }
    const clones = (servidor.data && servidor.data.clones) || [];
    return {
      pastas: clones.map((c) => ({ id: `clone:${c.id}`, nome: c.grupo === "equipe" ? `${c.nome} (equipe)` : c.nome, paiId: RAIZ })),
      carregando: servidor.isLoading,
      erro: servidor.isError ? "Não foi possível ler os clones." : null,
      fotos: clones.flatMap((c) =>
        c.fotos.map((f) => ({ id: f.id, nome: f.nome, pasta: `clone:${c.id}`, bucket: "mesa", caminho: null, url: f.url, pessoa: true, busca: `${c.nome} ${f.nome} ${PAPEL_DO_CLONE[f.papel]}`, detalhe: PAPEL_DO_CLONE[f.papel] })),
      ),
    };
  }, [estado.aba, acervo.data, acervo.isLoading, acervo.isError, arvore.data, arvore.isLoading, arvore.isError, arquivos.data, arquivos.isLoading, arquivos.isError, servidor.data, servidor.isLoading, servidor.isError, leituras]);

  const filtradas = useMemo(() => filtrarFotos(fotos, estado), [fotos, estado]);
  const buscando = semAcento(estado.busca).trim().length > 0;
  const naPasta = filtradas.filter((f) => (f.pasta || RAIZ) === estado.pasta);
  const visiveis = buscando ? filtradas.slice(0, LIMITE_NA_BUSCA) : naPasta;
  const semLeitura = estado.aba === "clones" ? [] : visiveis.filter((f) => f.pessoa === null);

  const clicar = (id: string) => {
    const r = alternarEscolha(escolha, id);
    if (r.cheio) toast.message(`Até ${MAX_ESCOLHIDAS} fotos. Tire uma para trocar.`);
    setEscolha(r.lista);
  };

  const marcarPessoas = async () => {
    if (!semLeitura.length || marcando) return;
    setMarcando(true);
    try {
      const r = await chamarFuncao<{ leituras?: Record<string, LeituraDaPessoa>; lidas?: number }>("estudio-arte", {
        acao: "rostos_marcar",
        trabalho_id: trabalhoId,
        itens: semLeitura.slice(0, MAX_POR_LEITURA).map((f) => f.id),
      });
      queryClient.setQueryData(chaveDasFotosDoRosto(trabalhoId), (antes: RespostaDasFotos | undefined) => ({ ...(antes || {}), leituras: (r && r.leituras) || (antes && antes.leituras) || {} }));
    } catch (e) {
      toast.error("Não foi possível marcar as pessoas", { description: textoDoErro(e) });
    } finally {
      setMarcando(false);
    }
  };

  const falta = precisaDeAutorizacao(escolha) && !autorizado;
  const confirmar = () => {
    if (!escolha.length || falta || salvando) return;
    void onConfirmar(escolha);
  };

  const cartao = (f: FotoParaRosto) => {
    const n = escolha.indexOf(f.id);
    const marcada = n >= 0;
    return (
      <li key={f.id} className="min-w-0">
        <button
          type="button"
          onClick={() => clicar(f.id)}
          aria-pressed={marcada}
          title={f.nome}
          className={juntar("relative block w-full overflow-hidden rounded-md bg-muted", marcada ? "ring-2 ring-primary" : "hover:ring-1 hover:ring-primary/60")}
          style={{ paddingBottom: "100%" }}
        >
          <span className="absolute inset-0">
            <Miniatura foto={f} />
          </span>
          {marcada && (
            <span className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[11px] font-semibold text-primary-foreground">{n + 1}</span>
          )}
          {f.pessoa === null && !marcada && (
            <span className="absolute left-1 top-1 rounded bg-background/85 px-1 text-[10px] text-muted-foreground" title="Ainda sem leitura de pessoa">?</span>
          )}
        </button>
        <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">{f.detalhe ? `${f.detalhe} · ${f.nome}` : f.nome}</p>
      </li>
    );
  };
  const grade = (lista: FotoParaRosto[]) => <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">{lista.map(cartao)}</ul>;

  const opcoes = [
    { valor: "acervo", rotulo: "Acervo", icone: <Images className="h-3.5 w-3.5" /> },
    { valor: "workspace", rotulo: "Workspace", icone: <HardDrive className="h-3.5 w-3.5" /> },
    { valor: "arquivo", rotulo: "Arquivos", icone: <FolderOpen className="h-3.5 w-3.5" /> },
    { valor: "clones", rotulo: "Clones", icone: <UserRound className="h-3.5 w-3.5" /> },
  ];

  return (
    <JanelaDoCelular
      aberta={aberto}
      titulo="Foto do rosto"
      onFechar={onFechar}
      larga
      rotuloDoFundo="Fechar a escolha da foto"
      rodape={
        <div className="border-t border-border px-4 py-3 sm:px-5" data-rodape="foto-do-rosto">
          {precisaDeAutorizacao(escolha) && (
            <label className="mb-2 flex items-start text-[11.5px] leading-snug text-muted-foreground">
              <Checkbox checked={autorizado} onCheckedChange={(v) => onAutorizado(v === true)} className="mr-1.5 mt-px h-3.5 w-3.5" aria-label="Tenho a autorização de uso da imagem" />
              <span>Tenho a autorização de uso da imagem desta pessoa.</span>
            </label>
          )}
          <div className="flex min-w-0 items-center">
            <span className="min-w-0 flex-1 truncate text-[12px] tabular-nums text-muted-foreground">
              {escolha.length} de {MAX_ESCOLHIDAS}
            </span>
            <button type="button" onClick={onFechar} className={juntar(botao.discreto, "h-8 text-[12px]")}>
              Cancelar
            </button>
            <button type="button" onClick={confirmar} disabled={!escolha.length || falta || salvando} className={juntar(botao.primario, "ml-2 h-8 text-[12px]")}>
              {salvando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              Usar {escolha.length === 1 ? "foto" : "fotos"}
            </button>
          </div>
        </div>
      }
    >
      <div className="min-w-0 space-y-3" data-navegador="foto-do-rosto">
        <SeletorCompacto opcoes={opcoes} valor={estado.aba} onEscolher={(v) => mudar({ aba: v as AbaDaFotoDoRosto, pasta: RAIZ })} rotulo="Onde procurar" larguraTotal listaQuandoNaoCabe />
        <div className="flex min-w-0 items-center">
          <CampoDeBusca valor={estado.busca} onMudar={(v) => mudar({ busca: v })} placeholder="Buscar por nome, pasta ou tag" rotulo="Buscar foto" className="flex-1" />
          <label className="ml-3 flex shrink-0 items-center text-[12px] text-foreground">
            <Switch checked={estado.soPessoas} onCheckedChange={(v) => mudar({ soPessoas: v === true })} aria-label="Só com pessoa" />
            <span className="ml-1.5 hidden sm:inline">Só com pessoa</span>
          </label>
        </div>
        {semLeitura.length > 0 && (
          <div className="flex min-w-0 items-center text-[11.5px] text-muted-foreground" data-aviso="sem-leitura">
            <span className="min-w-0 flex-1 truncate">
              {semLeitura.length} {semLeitura.length === 1 ? "foto sem leitura" : "fotos sem leitura"} de pessoa aqui.
            </span>
            <button type="button" onClick={() => void marcarPessoas()} disabled={marcando} className={juntar(botao.discreto, "h-7 px-2 text-[11.5px]")}>
              {marcando ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <ScanFace className="mr-1 h-3.5 w-3.5" aria-hidden="true" />}
              Marcar pessoas{semLeitura.length > MAX_POR_LEITURA ? ` (${MAX_POR_LEITURA})` : ""}
            </button>
          </div>
        )}
        {buscando ? (
          <div className="min-w-0 space-y-2">
            {carregando && <p className="text-[12px] text-muted-foreground">Lendo as fotos...</p>}
            {!carregando && !visiveis.length && <p className="text-[12px] text-muted-foreground">Nenhuma foto com essa busca.</p>}
            {visiveis.length > 0 && grade(visiveis)}
          </div>
        ) : (
          <ExploradorDePastas<FotoParaRosto>
            pastas={pastas}
            itens={filtradas}
            pastaDoItem={(f) => f.pasta}
            atual={estado.pasta}
            onAtual={(p) => mudar({ pasta: p })}
            raizNome={estado.aba === "clones" ? "Clones" : estado.aba === "arquivo" ? "Arquivos" : estado.aba === "workspace" ? "Workspace" : "Acervo"}
            semArvore
            alturaMax="none"
            carregando={carregando}
            erro={erro}
            vazio={estado.aba === "clones" ? "Nenhum clone com autorização válida." : estado.soPessoas ? "Nenhuma foto com pessoa nesta pasta." : "Nenhuma foto nesta pasta."}
            renderizarItens={grade}
          />
        )}
      </div>
    </JanelaDoCelular>
  );
}

/** Para quem mostra a escolha fora da janela: as escolhidas com miniatura e se ainda valem. */
export function useEscolhidasDoRosto(trabalhoId: string, itens: string[]) {
  return useQuery({
    queryKey: ["estudio", "rosto-escolhidas", trabalhoId, itens.join(",")],
    enabled: itens.length > 0,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const r = await chamarFuncao<RespostaDasFotos>("estudio-arte", { acao: "rostos_fotos", trabalho_id: trabalhoId, parte: "escolhidas" });
      return (r && r.escolhidas) || [];
    },
  });
}
