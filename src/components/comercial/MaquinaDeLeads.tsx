import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ExternalLink, Loader2, MessageCircle, Phone, Plus, Search, Sparkles, Trash2, Undo2, X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AjudaRecolhida, AreaDeTrabalho, CampoDeBusca, RegiaoRolavel, botao, etiqueta, useLargo, campo, campoTexto, juntar, texto } from "@/components/sistema";
import { textoDoErro } from "@/lib/mesa/api";
import { listarCampanhas } from "@/lib/comercial";
import {
  avaliarComJev,
  buscaAndando,
  type BuscaDeLeads,
  cancelarBusca,
  type CandidatoDeLead,
  chavesDaMaquina,
  criarBusca,
  custoDaAvaliacao,
  descartarCandidatos,
  estadoDaBusca,
  importarParaOCrm,
  lerCandidatos,
  linkDoWhatsapp,
  listarBuscas,
  type NovaBusca,
  ROTULO_DA_ORIGEM_DO_DADO,
  telefoneLegivel,
} from "@/lib/comercial/maquinaApi";
import {
  COR_DO_NIVEL, FILTROS_DE_CONTATO, type FiltroDeContato, type NivelDaSaude, ORDENS, type OrdemDosCandidatos,
  dadosDoLugar, nivelDaNota, ordenarCandidatos, passaNoContato, saudeDoCandidato, tetoDoGoogleEmDolar,
} from "@/lib/comercial/saudeDoLead";
import { FONTES_DA_BUSCA, type FonteDaBusca, PAISES, ROTULO_DA_FONTE, UFS } from "../../../supabase/functions/comercial-leads/regras";

/**
 * Máquina de leads (25/10/2026, dono: "junto disso a máquina de leads, e tudo organizado e de forma
 * intuitiva"). Nova busca (nicho, cidade, quantos, fontes, campanha e a chave "Entregar ao Mercúrio"), a
 * lista de buscas com o andamento ao vivo e, aberta uma busca, os candidatos com contato, fonte e a nota do
 * Jev, para avaliar, levar ao CRM ou descartar. Quem busca é o worker "leads" desta casa (workers/leads):
 * OpenStreetMap, Google Maps pelo Apify (pago, com teto) e o site da própria empresa, robots.txt respeitado e sem disfarce.
 *
 * 04/11/2026 (dono: "mais organizada, está com scroll único, filtros para recentes, cores como saudável e nota"):
 * buscas e candidatos rolam cada um por si, a nova busca abre em janela e os candidatos têm filtros e cores.
 */

const SUGESTOES_DE_NICHO = ["Restaurante", "Pizzaria", "Hamburgueria", "Cafeteria", "Padaria", "Academia", "Clínica médica", "Dentista", "Fisioterapia", "Clínica de estética", "Salão de beleza", "Barbearia", "Advocacia", "Contabilidade", "Imobiliária", "Oficina mecânica", "Pet shop", "Veterinária", "Loja de roupas", "Ótica", "Móveis", "Informática", "Escola", "Pousada", "Arquitetura"];
const QUANTOS = [20, 50, 100, 200];
type Filtro = "todos" | "novo" | "importado" | "descartado";
const FILTROS: Array<{ id: Filtro; rotulo: string }> = [
  { id: "todos", rotulo: "Todos" },
  { id: "novo", rotulo: "Novos" },
  { id: "importado", rotulo: "No CRM" },
  { id: "descartado", rotulo: "Descartados" },
];

function Opcao({ ativo, onClick, children, rotulo }: { ativo: boolean; onClick: () => void; children: ReactNode; rotulo?: string }) {
  return (
    <button type="button" aria-pressed={ativo} aria-label={rotulo} onClick={onClick} className={juntar(botao.barra, "border", ativo ? "border-primary bg-primary/10 font-medium text-foreground" : "border-border")}>
      {children}
    </button>
  );
}

const usd = (v: number) => `US$ ${v < 0.01 ? v.toFixed(4) : v.toFixed(2)}`.replace(".", ",");
const dataCurta = (iso: string) => {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function FormularioDaBusca({ aoCriar, aoFechar }: { aoCriar: (b: BuscaDeLeads) => void; aoFechar: () => void }) {
  const qc = useQueryClient();
  const [nicho, setNicho] = useState("");
  const [cidade, setCidade] = useState("");
  const [uf, setUf] = useState("");
  const [limite, setLimite] = useState(50);
  const [fontes, setFontes] = useState<FonteDaBusca[]>(["osm", "sites"]);
  const [urls, setUrls] = useState("");
  const [campanha, setCampanha] = useState("");
  const [mercurio, setMercurio] = useState(false);
  const campanhas = useQuery({ queryKey: ["comercial", "campanhas", "para-busca"], queryFn: listarCampanhas, staleTime: 60_000 });
  const soLista = fontes.length === 1 && fontes[0] === "lista";
  const criar = useMutation({
    mutationFn: () => {
      const b: NovaBusca = { nicho: nicho.trim(), cidade: cidade.trim(), uf: uf || null, fontes, limite, campanha_id: campanha || null, entregar_ao_mercurio: mercurio, urls: fontes.indexOf("lista") >= 0 ? urls.split(/[\s,;]+/).filter(Boolean) : [] };
      return criarBusca(b);
    },
    onSuccess: (b) => {
      void qc.invalidateQueries({ queryKey: chavesDaMaquina.buscas });
      toast.success("Busca na fila", { description: "A máquina começa em instantes; a lista mostra o andamento." });
      aoCriar(b);
    },
    onError: (e) => toast.error("Busca não criada", { description: textoDoErro(e) }),
  });
  const alternar = (f: FonteDaBusca) => setFontes((l) => (l.indexOf(f) >= 0 ? l.filter((x) => x !== f) : l.concat([f])));
  const pronta = fontes.length > 0 && (soLista ? urls.trim().length > 3 : nicho.trim().length >= 2 && cidade.trim().length >= 2);
  return (
    <section className="min-w-0 space-y-4" aria-label="Nova busca de leads" data-nova-busca="">
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px]">
        <label className={juntar(texto.rotulo, "block min-w-0")}>
          Nicho
          <input list="nichos-da-maquina" value={nicho} onChange={(e) => setNicho(e.target.value)} placeholder="Ex.: pizzaria, dentista, pet shop" className={juntar(campo, "mt-1")} aria-label="Nicho" />
          <datalist id="nichos-da-maquina">
            {SUGESTOES_DE_NICHO.map((n) => <option key={n} value={n} />)}
          </datalist>
        </label>
        <label className={juntar(texto.rotulo, "block min-w-0")}>
          Cidade
          <input value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Ex.: Curitiba" className={juntar(campo, "mt-1")} aria-label="Cidade" />
        </label>
        <label className={juntar(texto.rotulo, "block min-w-0")}>
          UF
          <select value={uf} onChange={(e) => setUf(e.target.value)} className={juntar(campo, "mt-1")} aria-label="UF">
            <option value="">Todas</option>
            {UFS.map((u) => <option key={u} value={u}>{u}</option>)}
            <optgroup label="Outro país">
              {Object.keys(PAISES).map((p) => <option key={p} value={p}>{PAISES[p]}</option>)}
            </optgroup>
          </select>
        </label>
      </div>
      <div className="grid min-w-0 grid-cols-1 gap-4 lg:grid-cols-2">
      <div className="min-w-0">
        <span className={texto.rotulo}>Quantos</span>
        <div className="mt-1 flex min-w-0 flex-wrap gap-1" role="group" aria-label="Quantos leads">
          {QUANTOS.map((q) => <Opcao key={q} ativo={limite === q} onClick={() => setLimite(q)}>{q}</Opcao>)}
        </div>
      </div>
      <div className="min-w-0">
        <span className={juntar(texto.rotulo, "inline-flex items-center")}>
          Onde buscar
          <AjudaRecolhida className="ml-1" rotulo="De onde vêm os leads">
            Mapa: negócios do OpenStreetMap (base aberta, com nome, telefone, site e endereço). Site da empresa: a máquina lê a página inicial e até 2 páginas de contato ou sobre, e pega WhatsApp, telefone, e-mail, Instagram e CNPJ que a própria empresa publicou. CNPJ: razão social e situação pela BrasilAPI. Sites que eu colar: os endereços que você colar passam pela mesma leitura. Google Maps pelo Apify (pago, com teto de gasto em cada busca): traz telefone, site, avaliações, bairro, horários e os contatos que a empresa publica. Na leitura direta, respeita o robots.txt de cada site, vai devagar e não coleta Instagram nem LinkedIn. Cada dado guarda de onde veio.
          </AjudaRecolhida>
        </span>
        <div className="mt-1 flex min-w-0 flex-wrap gap-1" role="group" aria-label="Fontes da busca">
          {FONTES_DA_BUSCA.map((f) => <Opcao key={f} ativo={fontes.indexOf(f) >= 0} onClick={() => alternar(f)}>{ROTULO_DA_FONTE[f]}</Opcao>)}
        </div>
        {fontes.indexOf("google_maps") >= 0 && <p className={juntar(texto.auxiliar, "mt-1")} data-teto-do-google="">Google Maps: gasta no máximo {usd(tetoDoGoogleEmDolar(limite))} nesta busca.</p>}
      </div>
      </div>
      {fontes.indexOf("lista") >= 0 && (
        <label className={juntar(texto.rotulo, "block min-w-0")}>
          Sites (um por linha)
          <textarea value={urls} onChange={(e) => setUrls(e.target.value)} rows={3} placeholder={"empresa1.com.br\nempresa2.com.br"} className={juntar(campoTexto, "mt-1")} aria-label="Sites colados" />
        </label>
      )}
      <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <label className={juntar(texto.rotulo, "block min-w-0")}>
          Campanha (opcional)
          <select value={campanha} onChange={(e) => setCampanha(e.target.value)} className={juntar(campo, "mt-1")} aria-label="Campanha da busca">
            <option value="">Sem campanha</option>
            {(campanhas.data || []).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label className={juntar(texto.corpo, "flex min-w-0 items-center gap-2 self-end pb-2")}>
          <input type="checkbox" checked={mercurio} onChange={(e) => setMercurio(e.target.checked)} aria-label="Entregar ao Mercúrio" />
          Entregar ao Mercúrio
          <AjudaRecolhida rotulo="O que é entregar ao Mercúrio">
            Marcar é a sua autorização para o Mercúrio, o agente comercial, fazer o primeiro contato com os leads que você levar ao CRM desta busca. Ele respeita o teto diário de primeiros contatos e o horário configurado, registra cada mensagem no lead e avisa na Caixa do comercial quem avançou ou fechou. Sem marcar, os leads entram no CRM só para a equipe.
          </AjudaRecolhida>
        </label>
      </div>
      <div className="flex min-w-0 items-center justify-end gap-2">
        <button type="button" className={botao.discreto} onClick={aoFechar}>Cancelar</button>
        <button type="button" className={botao.primario} onClick={() => criar.mutate()} disabled={!pronta || criar.isPending}>
          {criar.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Search className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          Buscar
        </button>
      </div>
    </section>
  );
}

function ContatosDoCandidato({ c }: { c: CandidatoDeLead }) {
  const link = juntar(texto.auxiliar, "inline-flex max-w-full items-center gap-1 truncate text-primary hover:underline");
  const lugar = dadosDoLugar(c);
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      {c.whatsapp && (
        <a className={link} href={linkDoWhatsapp(c.whatsapp)} target="_blank" rel="noreferrer" aria-label={`WhatsApp de ${c.nome}`}>
          <MessageCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {telefoneLegivel(c.whatsapp)}
        </a>
      )}
      {c.telefone && c.telefone !== c.whatsapp && (
        <a className={link} href={`tel:${c.telefone}`} aria-label={`Telefone de ${c.nome}`}>
          <Phone className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {telefoneLegivel(c.telefone)}
        </a>
      )}
      {c.site && <a className={link} href={c.site} target="_blank" rel="noreferrer">{c.site.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "").slice(0, 40)}</a>}
      {c.instagram && <a className={link} href={`https://instagram.com/${c.instagram}`} target="_blank" rel="noreferrer">@{c.instagram}</a>}
      {c.email && <a className={link} href={`mailto:${c.email}`}>{c.email}</a>}
      {lugar.facebook && <a className={link} href={lugar.facebook} target="_blank" rel="noreferrer">Facebook</a>}
      {lugar.linkedin && <a className={link} href={lugar.linkedin} target="_blank" rel="noreferrer">LinkedIn</a>}
      {!c.whatsapp && !c.telefone && !c.site && !c.email && !c.instagram && <span className={texto.auxiliar}>Sem contato público</span>}
    </div>
  );
}

function DeOndeVeio({ c }: { c: CandidatoDeLead }) {
  const [aberto, setAberto] = useState(false);
  const lista = (c.evidencias || []).filter((e) => e.campo && e.campo !== "credito" && e.campo.indexOf("nota_") !== 0);
  return (
    <div className="min-w-0">
      <button type="button" className={juntar(texto.auxiliar, "hover:underline")} onClick={() => setAberto(!aberto)} aria-expanded={aberto}>
        {aberto ? "Fechar a origem" : "De onde veio"}
      </button>
      {aberto && (
        <ul className="mt-1 min-w-0 space-y-0.5" aria-label={`Origem dos dados de ${c.nome}`}>
          {lista.map((e, k) => (
            <li key={k} className={juntar(texto.auxiliar, "truncate")}>
              {e.campo}: {String(e.valor || "").slice(0, 80)} ·{" "}
              {e.url ? <a className="underline" href={e.url} target="_blank" rel="noreferrer">{ROTULO_DA_ORIGEM_DO_DADO[e.fonte || ""] || e.fonte}</a> : ROTULO_DA_ORIGEM_DO_DADO[e.fonte || ""] || e.fonte}
            </li>
          ))}
          {c.fonte === "osm" && <li className={texto.auxiliar}>Dados do mapa: © OpenStreetMap contributors</li>}
        </ul>
      )}
    </div>
  );
}

function CandidatosDaBusca({ busca, aoAbrirLead }: { busca: BuscaDeLeads; aoAbrirLead?: (leadId: string) => void }) {
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [marcados, setMarcados] = useState<string[]>([]);
  const [mercurio, setMercurio] = useState(busca.entregar_ao_mercurio);
  const lidos = useQuery({
    queryKey: chavesDaMaquina.candidatos(busca.id),
    queryFn: () => lerCandidatos(busca.id),
    refetchInterval: buscaAndando(busca) ? 5000 : false,
  });
  const todos = (lidos.data && lidos.data.candidatos) || [];
  const [busque, setBusque] = useState("");
  const [ordem, setOrdem] = useState<OrdemDosCandidatos>("recentes");
  const [saude, setSaude] = useState<"todas" | NivelDaSaude>("todas");
  const [contato, setContato] = useState<FiltroDeContato>("todos");
  const [faixaDeNota, setFaixaDeNota] = useState<"todas" | "boa" | "sem">("todas");
  const naSituacao = filtro === "todos" ? todos.filter((c) => c.situacao !== "descartado") : todos.filter((c) => c.situacao === filtro);
  const termo = busque.trim().toLowerCase();
  const visiveis = ordenarCandidatos(
    naSituacao.filter((c) =>
      (!termo || `${c.nome} ${c.categoria || ""} ${c.endereco || ""}`.toLowerCase().indexOf(termo) >= 0)
      && (saude === "todas" || saudeDoCandidato(c).nivel === saude)
      && passaNoContato(c, contato)
      && (faixaDeNota === "todas" || (faixaDeNota === "boa" ? (c.nota ?? 0) >= 7 : c.nota == null))),
    ordem,
  );
  const contagemDaSaude = (nivel: NivelDaSaude) => naSituacao.filter((c) => saudeDoCandidato(c).nivel === nivel).length;
  const escolhidos = visiveis.filter((c) => marcados.indexOf(c.id) >= 0);
  const novosEscolhidos = escolhidos.filter((c) => c.situacao === "novo");
  const reler = () => void qc.invalidateQueries({ queryKey: chavesDaMaquina.candidatos(busca.id) });
  const avaliar = useMutation({
    mutationFn: () => avaliarComJev(busca.id, (novosEscolhidos.length ? novosEscolhidos : visiveis.filter((c) => c.situacao === "novo")).map((c) => c.id)),
    onSuccess: (r) => {
      reler();
      toast.success("Avaliados pelo Jev", { description: `${r.avaliados.length} com nota de encaixe · ${usd(r.custo_usd || 0)}` });
    },
    onError: (e) => toast.error("O Jev não avaliou", { description: textoDoErro(e) }),
  });
  const importar = useMutation({
    mutationFn: () => importarParaOCrm(busca.id, novosEscolhidos.map((c) => c.id), mercurio),
    onSuccess: (r) => {
      reler();
      setMarcados([]);
      // A chave dos leads no Comercial é ["comercial-leads"]; ["comercial"] não a alcança e o CRM ficava sem os importados.
      void qc.invalidateQueries({ queryKey: ["comercial-leads"] });
      toast.success(`${r.importados.length} no CRM`, { description: r.repetidos.length ? `${r.repetidos.length} já estavam no CRM e foram ligados ao lead de lá.` : mercurio ? "O Mercúrio faz o primeiro contato." : undefined });
    },
    onError: (e) => toast.error("Não levei ao CRM", { description: textoDoErro(e) }),
  });
  const descartar = useMutation({
    mutationFn: (voltar: boolean) => descartarCandidatos(busca.id, escolhidos.map((c) => c.id), voltar),
    onSuccess: () => {
      reler();
      setMarcados([]);
    },
    onError: (e) => toast.error("Não mudei os candidatos", { description: textoDoErro(e) }),
  });
  const paraAvaliar = novosEscolhidos.length || visiveis.filter((c) => c.situacao === "novo").length;
  const todosMarcados = visiveis.length > 0 && escolhidos.length === visiveis.length;
  if (lidos.isLoading) return <p className={texto.auxiliar}><Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" aria-hidden="true" />Lendo os candidatos…</p>;
  return (
    <section className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1 [&>*+*]:mt-2" aria-label={`Candidatos de ${busca.nicho} em ${busca.cidade}`} data-candidatos-da-busca={busca.id}>
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-1" role="group" aria-label="Filtro dos candidatos">
          {FILTROS.map((f) => (
            <Opcao key={f.id} ativo={filtro === f.id} onClick={() => { setFiltro(f.id); setMarcados([]); }}>
              {f.rotulo} {f.id === "todos" ? todos.filter((c) => c.situacao !== "descartado").length : todos.filter((c) => c.situacao === f.id).length}
            </Opcao>
          ))}
        </div>
        <CampoDeBusca valor={busque} onMudar={setBusque} placeholder="Buscar por nome, categoria ou endereço" rotulo="Buscar nos candidatos" className="min-w-[180px] flex-1 sm:max-w-[320px]" />
      </div>
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2" role="group" aria-label="Filtros e ordem">
        <select value={ordem} onChange={(e) => setOrdem(e.target.value as OrdemDosCandidatos)} className={juntar(campo, "h-8 w-auto text-[12px]")} aria-label="Ordenar candidatos">
          {ORDENS.map((o) => <option key={o.id} value={o.id}>{o.rotulo}</option>)}
        </select>
        <select value={contato} onChange={(e) => setContato(e.target.value as FiltroDeContato)} className={juntar(campo, "h-8 w-auto text-[12px]")} aria-label="Filtrar por contato">
          {FILTROS_DE_CONTATO.map((o) => <option key={o.id} value={o.id}>{o.rotulo}</option>)}
        </select>
        <select value={faixaDeNota} onChange={(e) => setFaixaDeNota(e.target.value as "todas" | "boa" | "sem")} className={juntar(campo, "h-8 w-auto text-[12px]")} aria-label="Filtrar por nota">
          <option value="todas">Qualquer nota</option>
          <option value="boa">Nota 7 ou mais</option>
          <option value="sem">Sem nota</option>
        </select>
        <div className="flex min-w-0 flex-wrap items-center gap-1" role="group" aria-label="Filtrar por saúde">
          {(["saudavel", "atencao", "fraco"] as NivelDaSaude[]).map((nivel) => (
            <button
              key={nivel}
              type="button"
              aria-pressed={saude === nivel}
              onClick={() => setSaude(saude === nivel ? "todas" : nivel)}
              className={juntar(etiqueta, COR_DO_NIVEL[nivel], "cursor-pointer tabular-nums", saude === nivel && "ring-1 ring-current")}
            >
              {nivel === "saudavel" ? "Saudáveis" : nivel === "atencao" ? "Atenção" : "Fracos"} {contagemDaSaude(nivel)}
            </button>
          ))}
          <AjudaRecolhida rotulo="O que é saúde e nota">
            Saúde olha se dá para falar com o negócio e se ele parece vivo: WhatsApp, telefone, site, e-mail, Instagram e as avaliações do Google. Nota é o encaixe de 0 a 10 com o seu cliente ideal, dada pelo Jev. Verde é bom, âmbar pede atenção e vermelho é fraco.
          </AjudaRecolhida>
        </div>
      </div>
      <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-border pb-2">
        <label className={juntar(texto.auxiliar, "flex items-center gap-1.5")}>
          <input type="checkbox" checked={todosMarcados} onChange={(e) => setMarcados(e.target.checked ? visiveis.map((c) => c.id) : [])} aria-label="Marcar todos" />
          {escolhidos.length ? `${escolhidos.length} marcados` : "Marcar todos"}
        </label>
        <span className="flex-1" />
        <button type="button" className={botao.secundario} onClick={() => avaliar.mutate()} disabled={!paraAvaliar || avaliar.isPending} title="O Jev dá a nota de encaixe de 0 a 10 contra o perfil de cliente ideal">
          {avaliar.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Sparkles className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          Avaliar com Jev · {usd(custoDaAvaliacao(paraAvaliar))}
        </button>
        <label className={juntar(texto.corpo, "flex items-center gap-1.5")}>
          <input type="checkbox" checked={mercurio} onChange={(e) => setMercurio(e.target.checked)} aria-label="Mercúrio faz o primeiro contato" />
          Mercúrio contata
        </label>
        <button type="button" className={botao.primario} onClick={() => importar.mutate()} disabled={!novosEscolhidos.length || importar.isPending}>
          {importar.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />}
          Levar ao CRM{novosEscolhidos.length ? ` (${novosEscolhidos.length})` : ""}
        </button>
        {filtro === "descartado" ? (
          <button type="button" className={botao.icone} onClick={() => descartar.mutate(true)} disabled={!escolhidos.length || descartar.isPending} aria-label="Voltar os marcados" title="Voltar para os novos">
            <Undo2 className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className={botao.icone} onClick={() => descartar.mutate(false)} disabled={!escolhidos.filter((c) => c.situacao === "novo").length || descartar.isPending} aria-label="Descartar os marcados" title="Descartar os marcados">
            <Trash2 className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {!visiveis.length ? (
        <p className={texto.auxiliar}>{buscaAndando(busca) ? "Buscando: os candidatos aparecem aqui conforme a máquina acha." : naSituacao.length ? "Nenhum candidato com esses filtros." : "Nada aqui."}</p>
      ) : (
        <RegiaoRolavel rotulo="Lista de candidatos" memoria={`comercial:leads:${busca.id}`} className="min-w-0 lg:pb-12 lg:pr-1">
          <ul className="min-w-0" aria-label="Candidatos">
            {visiveis.map((c) => {
              const estado = saudeDoCandidato(c);
              const lugar = dadosDoLugar(c);
              return (
                <li key={c.id} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-1 border-t border-border py-3 first:border-t-0 lg:grid-cols-[auto_minmax(0,1.1fr)_minmax(0,1.4fr)_132px]" data-candidato={c.id} data-situacao={c.situacao} data-saude={estado.nivel}>
                  <input type="checkbox" className="mt-1" checked={marcados.indexOf(c.id) >= 0} onChange={(e) => setMarcados((l) => (e.target.checked ? l.concat([c.id]) : l.filter((x) => x !== c.id)))} aria-label={`Marcar ${c.nome}`} />
                  <div className="min-w-0 space-y-1">
                    <span className={juntar(texto.corpo, "block truncate font-medium")}>{c.nome}</span>
                    {(c.categoria || lugar.bairro) && <span className={juntar(texto.auxiliar, "block truncate")}>{[c.categoria, lugar.bairro].filter(Boolean).join(" · ")}</span>}
                    {c.porque && <p className={texto.auxiliar}>{c.porque}</p>}
                  </div>
                  <div className="col-start-2 min-w-0 space-y-1 lg:col-start-auto">
                    <ContatosDoCandidato c={c} />
                    <div className="flex min-w-0 items-center gap-3">
                      <DeOndeVeio c={c} />
                      {c.situacao === "importado" && c.lead_id && (
                        <button type="button" className={juntar(texto.auxiliar, "inline-flex items-center gap-1 font-medium text-primary hover:underline")} onClick={() => aoAbrirLead && aoAbrirLead(c.lead_id as string)} disabled={!aoAbrirLead}>
                          No CRM
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="col-start-2 flex min-w-0 flex-wrap items-center gap-1 lg:col-start-auto lg:justify-end">
                    <span className={juntar(etiqueta, COR_DO_NIVEL[estado.nivel])} title={estado.porque}>{estado.rotulo}</span>
                    {c.nota != null ? (
                      <span className={juntar(etiqueta, COR_DO_NIVEL[nivelDaNota(c.nota)], "font-semibold tabular-nums")} title={c.porque || undefined} aria-label={`Encaixe ${c.nota} de 10`}>
                        {c.nota.toFixed(1).replace(".", ",")}
                      </span>
                    ) : (
                      <span className={juntar(etiqueta, "bg-muted text-muted-foreground")}>sem nota</span>
                    )}
                    {lugar.estrelas != null && (
                      <span className={juntar(texto.auxiliar, "tabular-nums")} title={`${lugar.avaliacoes} avaliações no Google`}>★ {String(lugar.estrelas).replace(".", ",")} ({lugar.avaliacoes})</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </RegiaoRolavel>
      )}
    </section>
  );
}

export default function MaquinaDeLeads({ aoAbrirLead }: { aoAbrirLead?: (leadId: string) => void }) {
  const qc = useQueryClient();
  const [novaAberta, setNovaAberta] = useState(false);
  const [abertaId, setAbertaId] = useState<string | null>(null);
  const [filtroDasBuscas, setFiltroDasBuscas] = useState("");
  const [ordemDasBuscas, setOrdemDasBuscas] = useState<"recentes" | "encontrados">("recentes");
  const [situacaoDasBuscas, setSituacaoDasBuscas] = useState("todas");
  // No largo, a busca abre na coluna da direita; no celular, embaixo dela (uma só vez na página).
  const largo = useLargo();
  const buscas = useQuery({
    queryKey: chavesDaMaquina.buscas,
    queryFn: listarBuscas,
    refetchInterval: (q) => (((q.state.data as BuscaDeLeads[] | undefined) || []).some(buscaAndando) ? 4000 : false),
  });
  const lista = buscas.data || [];
  // A busca aberta: a escolhida ou, sem escolha, a mais recente (no largo a coluna da direita nunca fica vazia).
  const aberta = useMemo(() => lista.filter((b) => b.id === abertaId)[0] || lista[0] || null, [lista, abertaId]);
  const cancelar = useMutation({
    mutationFn: (id: string) => cancelarBusca(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: chavesDaMaquina.buscas }),
    onError: (e) => toast.error("Não cancelei", { description: textoDoErro(e) }),
  });
  const termoDaBusca = filtroDasBuscas.trim().toLowerCase();
  const buscasVisiveis = lista
    .filter((b) => (!termoDaBusca || `${b.nicho} ${b.cidade}`.toLowerCase().indexOf(termoDaBusca) >= 0)
      && (situacaoDasBuscas === "todas" || (situacaoDasBuscas === "andando" ? buscaAndando(b) : b.situacao === situacaoDasBuscas)))
    .slice()
    .sort((a, b) => ordemDasBuscas === "encontrados" ? b.encontrados - a.encontrados : String(b.created_at).localeCompare(String(a.created_at)));
  return (
    <AreaDeTrabalho principalRolavel={false} rotuloDoPrincipal="Máquina de leads">
    <div className="flex min-w-0 flex-col lg:min-h-0 lg:flex-1" data-maquina-de-leads="">
      <div className="mb-3 flex min-w-0 shrink-0 items-center gap-2">
        <h2 className={juntar(texto.tituloSecao, "min-w-0 flex-1 truncate")}>Máquina de leads</h2>
        <AjudaRecolhida rotulo="Como a Máquina de leads funciona">
          Diga o nicho e a cidade: a máquina acha os negócios no mapa aberto ou no Google Maps e lê o site de cada um atrás do contato que a própria empresa publicou. Depois, o Jev dá a nota de encaixe com o perfil de cliente ideal, você leva os melhores ao CRM e, se quiser, entrega ao Mercúrio para o primeiro contato. Nada é enviado a ninguém nesta tela.
        </AjudaRecolhida>
        <button type="button" className={botao.primario} onClick={() => setNovaAberta(true)}>
          <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />
          Nova busca
        </button>
      </div>
      <Dialog open={novaAberta} onOpenChange={setNovaAberta}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Nova busca de leads</DialogTitle>
            <DialogDescription>Nicho, cidade e de onde buscar. Nada é enviado a ninguém.</DialogDescription>
          </DialogHeader>
          <FormularioDaBusca aoFechar={() => setNovaAberta(false)} aoCriar={(b) => { setNovaAberta(false); setAbertaId(b.id); }} />
        </DialogContent>
      </Dialog>
      {buscas.isError && <p className={juntar(texto.auxiliar, "text-destructive")}>{textoDoErro(buscas.error)}</p>}
      {buscas.isLoading ? (
        <p className={texto.auxiliar}><Loader2 className="mr-1.5 inline h-3.5 w-3.5 animate-spin" aria-hidden="true" />Lendo as buscas…</p>
      ) : !lista.length ? (
        <p className={texto.auxiliar}>Nenhuma busca ainda. Comece em Nova busca.</p>
      ) : (
        <div className={juntar("grid min-w-0 grid-cols-1 gap-6", largo && "min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)]")}>
        <div className="flex min-w-0 flex-col lg:min-h-0">
          <div className="mb-2 min-w-0 shrink-0 space-y-2">
            <CampoDeBusca valor={filtroDasBuscas} onMudar={setFiltroDasBuscas} placeholder="Buscar nicho ou cidade" rotulo="Buscar nas buscas" />
            <div className="flex min-w-0 gap-2">
              <select value={ordemDasBuscas} onChange={(e) => setOrdemDasBuscas(e.target.value as "recentes" | "encontrados")} className={juntar(campo, "h-8 min-w-0 flex-1 text-[12px]")} aria-label="Ordenar buscas">
                <option value="recentes">Mais recentes</option>
                <option value="encontrados">Mais leads</option>
              </select>
              <select value={situacaoDasBuscas} onChange={(e) => setSituacaoDasBuscas(e.target.value)} className={juntar(campo, "h-8 min-w-0 flex-1 text-[12px]")} aria-label="Situação das buscas">
                <option value="todas">Todas</option>
                <option value="andando">Andando</option>
                <option value="pronta">Prontas</option>
                <option value="falhou">Com falha</option>
              </select>
            </div>
          </div>
        <RegiaoRolavel rotulo="Lista de buscas" memoria="comercial:leads:buscas" className="min-w-0 lg:pb-12 lg:pr-1">
        <ul className="min-w-0" aria-label="Buscas de leads">
          {!buscasVisiveis.length && <li className={juntar(texto.auxiliar, "py-3")}>Nenhuma busca com esses filtros.</li>}
          {buscasVisiveis.map((b) => {
            const andando = buscaAndando(b);
            const abertaAqui = !!aberta && aberta.id === b.id;
            return (
              <li key={b.id} className={juntar("min-w-0 border-t border-border first:border-t-0", largo && abertaAqui && "rounded-md border-transparent bg-muted/50 px-2")} data-busca={b.id} data-situacao={b.situacao}>
                <div className="flex min-w-0 items-center gap-2 py-2.5">
                  <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => setAbertaId(b.id)} aria-expanded={abertaAqui} aria-label={`Abrir a busca ${b.nicho} em ${b.cidade}`}>
                    {andando
                      ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
                      : <span aria-hidden="true" className={juntar("ml-1 mr-1 h-2 w-2 shrink-0 rounded-full", b.situacao === "falhou" ? "bg-destructive" : b.situacao === "pronta" ? "bg-success" : "bg-muted-foreground")} />}
                    <span className="min-w-0 flex-1">
                      <span className={juntar(texto.corpo, "block truncate font-medium")}>{b.nicho} em {b.cidade}{b.uf ? `/${PAISES[b.uf] || b.uf}` : ""}</span>
                      <span className={juntar(texto.auxiliar, "block truncate", b.situacao === "falhou" && "text-destructive")}>
                        {estadoDaBusca(b)} · {dataCurta(b.created_at)}{b.entregar_ao_mercurio ? " · Mercúrio" : ""}
                      </span>
                    </span>
                  </button>
                  {andando && (
                    <button type="button" className={botao.icone} onClick={() => cancelar.mutate(b.id)} disabled={cancelar.isPending} aria-label={`Cancelar a busca ${b.nicho}`} title="Cancelar a busca (o que já achou fica)">
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  )}
                </div>
                {/* No celular a busca abre embaixo dela; no largo, na coluna da direita. */}
                {!largo && abertaAqui && aberta && (
                  <div className="min-w-0 pb-3">
                    <CandidatosDaBusca busca={aberta} aoAbrirLead={aoAbrirLead} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        </RegiaoRolavel>
        </div>
        {largo && (
          <div className="flex min-h-0 min-w-0 flex-col">
            {aberta ? <CandidatosDaBusca key={aberta.id} busca={aberta} aoAbrirLead={aoAbrirLead} /> : <p className={texto.auxiliar}>Escolha uma busca à esquerda.</p>}
          </div>
        )}
        </div>
      )}
    </div>
    </AreaDeTrabalho>
  );
}
