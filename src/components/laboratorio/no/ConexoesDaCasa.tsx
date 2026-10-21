import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Database, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { botao, campo, juntar, texto } from "@/components/sistema";
import { textoDoErro } from "@/lib/mesa/api";
import { catalogoDaCasa, puxarContextoDaCasa, type ContextoDaCasa } from "@/lib/laboratorio/conexoesDaCasa";
import type { NoDoLab } from "@/lib/laboratorio/nos";
import { useAcoesDoQuadro, type AcoesDoQuadro } from "./contexto";

export default function ConexoesDaCasa({ no, acoes }: { no: NoDoLab; acoes?: Partial<AcoesDoQuadro> }) {
  const padrao = useAcoesDoQuadro();
  const a = { ...padrao, ...acoes };
  const { user } = useAuth();
  const [resultado, setResultado] = useState<ContextoDaCasa | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState("");
  const crm = no.tipo === "crm";
  const origem = typeof no.dados.crm_origem === "string" ? no.dados.crm_origem : "";
  const nativo = crm ? !!origem : (no.dados.plataforma || "painel") === "painel";
  const precisaProduto = nativo && (!crm || origem === "cliente");
  const chaveProduto = crm ? "produto_crm_id" : "produto_membros_id";
  const produto = typeof no.dados[chaveProduto] === "string" ? no.dados[chaveProduto] as string : "";
  const assinatura = JSON.stringify([user?.id, a.projetoId, a.clienteId, no.id, no.dados]);
  const assinaturaAtual = useRef(assinatura);
  assinaturaAtual.current = assinatura;
  useEffect(() => { setResultado(null); setErro(""); setOcupado(false); }, [assinatura]);
  const q = useQuery({
    queryKey: ["laboratorio", "conexoes-da-casa", user?.id, a.projetoId, no.tipo],
    queryFn: async () => { await a.antesDeChamar(); return catalogoDaCasa(a.projetoId, no.id); },
    enabled: precisaProduto && !!a.projetoId,
    staleTime: 60_000,
    retry: false,
  });
  const cliente = a.clientes.find((c) => c.id === a.clienteId)?.nome || "cliente do projeto";
  const invalido = !nativo || (precisaProduto && !produto) || (crm && origem === "cliente" && !a.clienteId);
  const mudar = (dados: Record<string, unknown>) => { setResultado(null); setErro(""); a.mudarDados(no.id, dados); };
  const puxar = async () => {
    const leitura = assinatura;
    setOcupado(true); setErro("");
    try {
      await a.antesDeChamar();
      if (assinaturaAtual.current !== leitura) return;
      const contexto = await puxarContextoDaCasa(a.projetoId, no.id);
      if (assinaturaAtual.current === leitura) setResultado(contexto);
    }
    catch (e) { if (assinaturaAtual.current === leitura) setErro(textoDoErro(e)); }
    finally { if (assinaturaAtual.current === leitura) setOcupado(false); }
  };
  return (
    <section className="mb-3 min-w-0 space-y-2" aria-label={crm ? "Conexão com o CRM" : "Produto da biblioteca"}>
      {crm ? <label className="block min-w-0"><span className={juntar(texto.rotulo, "mb-1 block")}>Origem dos dados</span><select className={campo} value={origem} onChange={(e) => mudar({ crm_origem: e.target.value, produto_crm_id: "" })} disabled={a.travado}>
        <option value="">Só preparar a etapa do funil</option><option value="agencia">CRM da agência Aceleriq</option><option value="cliente">CRM de {cliente}</option>
      </select></label> : !nativo ? <button type="button" className={botao.barra} disabled={a.travado} onClick={() => mudar({ plataforma: "painel" })}><BookOpen className="mr-1 h-4 w-4" aria-hidden="true" />Usar a biblioteca do painel</button> : null}
      {crm && origem === "cliente" && !a.clienteId ? <p role="alert" className={texto.auxiliar}>Escolha o cliente do projeto para conectar o CRM dele.</p> : null}
      {precisaProduto ? <label className="block min-w-0"><span className={juntar(texto.rotulo, "mb-1 block")}>{crm ? "Ferramenta CRM" : "Produto existente no painel"}</span><select className={campo} value={produto} disabled={a.travado || q.isLoading} onChange={(e) => mudar({ [chaveProduto]: e.target.value })}>
        <option value="">{q.isLoading ? "Lendo produtos…" : "Escolha um produto"}</option>
        {produto && !q.data?.some((p) => p.id === produto) ? <option value={produto}>Produto vinculado</option> : null}
        {q.data?.map((p) => <option key={p.id} value={p.id}>{p.titulo}{p.estado !== "publicado" ? ` · ${p.estado}` : ""}</option>)}
      </select></label> : null}
      {q.isError && precisaProduto ? <p role="alert" className={juntar(texto.auxiliar, "text-destructive")}>{textoDoErro(q.error)}</p> : null}
      {nativo ? <div className="flex flex-wrap items-center gap-2"><button type="button" className={botao.barra} disabled={invalido || ocupado} onClick={() => void puxar()}>{ocupado ? <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden="true" /> : resultado ? <RefreshCw className="mr-1 h-4 w-4" aria-hidden="true" /> : <Database className="mr-1 h-4 w-4" aria-hidden="true" />}{resultado ? "Atualizar contexto" : "Puxar contexto"}</button><a className={botao.icone} href={crm && origem === "agencia" ? "/comercial" : "/membros/administrar"} target="_blank" rel="noopener noreferrer" title={crm && origem === "agencia" ? "Abrir CRM da agência" : "Abrir administração da biblioteca"} aria-label={crm && origem === "agencia" ? "Abrir CRM da agência" : "Abrir administração da biblioteca"}><ExternalLink className="h-4 w-4" aria-hidden="true" /></a></div> : null}
      {erro ? <p role="alert" className={juntar(texto.auxiliar, "text-destructive")}>{erro}</p> : null}
      {resultado ? <p className={juntar(texto.corpo, "whitespace-pre-wrap break-words rounded-lg bg-muted/30 p-3 leading-relaxed")} role="status">{resultado.texto}</p> : null}
    </section>
  );
}
