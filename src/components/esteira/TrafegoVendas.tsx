import { useMemo, useState } from "react";
import { BadgeDollarSign, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { CanalVenda, FatosDoCliente, PlataformaAds } from "@/lib/esteira/esteiraTipos";
import { resumoDeVendas } from "@/lib/esteira/esteiraMontar";
import { CANAIS, apagarVenda, fmtBrl, registrarVenda, rotuloDoCanal } from "@/lib/esteira/esteiraVendas";
import { CampoDeFormulario, GrupoDeCampos, SeletorCompacto, Secao, botao, campo, juntar, superficie, texto } from "@/components/sistema";

function hojeBrt(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

function fmtDia(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

interface Props {
  fatos: FatosDoCliente;
  plataforma: PlataformaAds;
  hoje: Date;
  canWrite: boolean;
  onMudou: () => void;
}

/**
 * Bloco "Vendas" da aba Trafego: o numero que fecha o funil, registrado a
 * mao (WhatsApp, Instagram, balcao) ou rastreado pela plataforma. Cada
 * venda vai para o diario e o dossie le "teve uma venda" ao otimizar.
 */
export default function TrafegoVendas({ fatos, plataforma, hoje, canWrite, onMudou }: Props) {
  const [aberto, setAberto] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [data, setData] = useState(hojeBrt());
  const [quantidade, setQuantidade] = useState("1");
  const [valor, setValor] = useState("");
  const [canal, setCanal] = useState<CanalVenda>("whatsapp");
  const [campanha, setCampanha] = useState<string>("");
  const [nota, setNota] = useState("");

  const campanhas = useMemo(() => fatos.campanhas.filter((c) => c.plataforma === plataforma).sort((a, b) => Number(b.ativa) - Number(a.ativa) || a.nome.localeCompare(b.nome)), [fatos.campanhas, plataforma]);
  const r7 = useMemo(() => resumoDeVendas(fatos, hoje, 7, 0, plataforma), [fatos, hoje, plataforma]);
  const r30 = useMemo(() => resumoDeVendas(fatos, hoje, 30, 0, plataforma), [fatos, hoje, plataforma]);
  const lista = useMemo(() => fatos.vendas.filter((v) => v.plataforma === plataforma).slice(0, 8), [fatos.vendas, plataforma]);

  const gravar = async () => {
    if (!canWrite) { toast.error("Só admin ou manager registra venda."); return; }
    const q = Math.floor(Number(quantidade));
    if (!Number.isFinite(q) || q < 1) { toast.error("Quantas vendas? Pelo menos 1."); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) { toast.error("Data inválida."); return; }
    const v = valor.trim() ? Number(valor.replace(/\./g, "").replace(",", ".")) : null;
    if (v !== null && (!Number.isFinite(v) || v < 0)) { toast.error("Valor inválido. Deixe em branco se não souber."); return; }
    const camp = campanhas.find((c) => c.id === campanha) ?? null;
    setGravando(true);
    try {
      const id = await registrarVenda({ clientId: fatos.clientId, data, plataforma, campanhaId: camp?.id ?? null, campanhaNome: camp?.nome ?? null, canal, quantidade: q, valor: v, nota });
      if (!id) { toast.error("Não consegui gravar a venda."); return; }
      toast.success(`${q} ${q === 1 ? "venda registrada" : "vendas registradas"}${v !== null ? ` (${fmtBrl(v)})` : ""}. O dossiê já lê.`);
      setQuantidade("1"); setValor(""); setNota(""); setAberto(false);
      onMudou();
    } finally { setGravando(false); }
  };

  const apagar = async (id: string) => {
    if (!canWrite) return;
    if (!window.confirm("Apagar esta venda? Ela some da leitura; o registro no diário fica.")) return;
    const ok = await apagarVenda(id);
    if (ok) { toast.success("Venda apagada."); onMudou(); } else toast.error("Não consegui apagar.");
  };

  const bloco = (rotulo: string, valorGrande: string | number, apoio: string) => (
    <div className={juntar(superficie.poco, "min-w-0 px-3 py-2")}>
      <p className={texto.rotulo}>{rotulo}</p>
      <p className="text-[20px] font-semibold leading-7 tabular-nums text-foreground">{valorGrande}</p>
      <p className={juntar(texto.auxiliar, "truncate")}>{apoio}</p>
    </div>
  );

  // Sistema de design: seção sem caixa, ação na linha do título, números em
  // poços, formulário com rótulo em cima e a lista com divisória.
  return (
    <Secao
      nivel={3}
      divisoria
      recolher={`ciclo:folha:vendas:${fatos.clientId}`}
      resumo={`${r30.total} em 30 dias`}
      titulo={<span className="inline-flex items-center"><BadgeDollarSign className="mr-1.5 h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />Vendas</span>}
      ajuda="O número que fecha o funil. Registre a venda que o cliente fechou (WhatsApp, Instagram, loja) ou veja as rastreadas pela plataforma. Cada venda vai para o diário e o dossiê lê ao otimizar a campanha."
      acao={canWrite ? (
        <button type="button" onClick={() => setAberto((v) => !v)} className={juntar(aberto ? botao.discreto : botao.secundario, "h-8 text-[12px]")}>
          {aberto ? <><X className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Fechar</> : <><Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Registrar venda</>}
        </button>
      ) : undefined}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {bloco("7 dias", r7.total, r7.receita > 0 ? fmtBrl(r7.receita) : r7.total > 0 ? "sem valor" : "nenhuma")}
        {bloco("30 dias", r30.total, r30.receita > 0 ? fmtBrl(r30.receita) : r30.total > 0 ? "sem valor" : "nenhuma")}
        <div className={juntar(superficie.poco, "col-span-2 min-w-0 px-3 py-2 sm:col-span-1")}>
          <p className={texto.rotulo}>Por onde (30d)</p>
          {r30.porCanal.length === 0 ? (
            <p className="text-[12px] text-muted-foreground/80">–</p>
          ) : r30.porCanal.slice(0, 3).map((c) => (
            <p key={c.canal} className="truncate text-[12px] leading-5 text-foreground"><span className="font-semibold tabular-nums">{c.vendas}</span> {rotuloDoCanal(c.canal)}</p>
          ))}
        </div>
      </div>
      {r30.rastreadas > 0 && <p className={juntar(texto.auxiliar, "mt-2")}>{r30.rastreadas} rastreada{r30.rastreadas === 1 ? "" : "s"} pela plataforma nos 30 dias, já somada{r30.rastreadas === 1 ? "" : "s"}.</p>}
      {r30.porCampanha.length > 0 && (
        <p className="mt-2 text-[12px] leading-4 text-foreground/90">
          <span className="text-muted-foreground">Mais vendeu (30d): </span>{r30.porCampanha[0].nome} · {r30.porCampanha[0].vendas} venda{r30.porCampanha[0].vendas === 1 ? "" : "s"}{r30.porCampanha[0].receita > 0 ? ` · ${fmtBrl(r30.porCampanha[0].receita)}` : ""}
        </p>
      )}

      {aberto && (
        <div className={juntar(superficie.poco, "mt-3 space-y-4 p-3")}>
          <GrupoDeCampos colunas={3}>
            <CampoDeFormulario rotulo="Dia">
              <input type="date" value={data} max={hojeBrt()} onChange={(e) => setData(e.target.value)} className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Quantas">
              <input type="number" min={1} step={1} inputMode="numeric" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Valor (R$)">
              <input type="text" inputMode="decimal" placeholder="se souber" value={valor} onChange={(e) => setValor(e.target.value)} className={campo} />
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Por onde veio">
              <div>
                <SeletorCompacto rotulo="Por onde veio" valor={canal} onEscolher={(v) => setCanal(v as CanalVenda)} opcoes={CANAIS.map((c) => ({ valor: c.key, rotulo: c.rotulo }))} className="w-full" />
              </div>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Campanha">
              <select value={campanha} onChange={(e) => setCampanha(e.target.value)} className={campo}>
                <option value="">Sem campanha específica</option>
                {campanhas.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.ativa ? "" : " (pausada)"}</option>)}
              </select>
            </CampoDeFormulario>
            <CampoDeFormulario rotulo="Observação">
              <input type="text" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Opcional: o que vendeu, para quem" className={campo} />
            </CampoDeFormulario>
          </GrupoDeCampos>
          <div className="flex justify-end">
            <button type="button" onClick={() => void gravar()} disabled={gravando} className={botao.primario}>
              {gravando ? "Gravando…" : "Gravar venda"}
            </button>
          </div>
        </div>
      )}

      {lista.length > 0 && (
        <ul className="mt-3 divide-y divide-border border-t border-border">
          {lista.map((v) => (
            <li key={v.id} className="flex min-w-0 items-center py-2">
              <span className="mr-2 w-10 shrink-0 text-[11.5px] tabular-nums text-muted-foreground">{fmtDia(v.data)}</span>
              <span className="mr-2 min-w-0 flex-1 truncate text-[12.5px] text-foreground">
                <span className="font-semibold tabular-nums">{v.quantidade}</span> {v.quantidade === 1 ? "venda" : "vendas"}
                {v.valor !== null ? <span className="tabular-nums"> · {fmtBrl(v.valor)}</span> : <span className="text-muted-foreground"> · sem valor</span>}
                <span className="text-muted-foreground"> · {rotuloDoCanal(v.canal)}{v.campanhaNome ? ` · ${v.campanhaNome}` : ""}{v.origem !== "manual" ? " · rastreada" : ""}</span>
              </span>
              {canWrite && v.origem === "manual" && (
                <button type="button" onClick={() => void apagar(v.id)} aria-label="Apagar venda" className={juntar(botao.icone, "hover:text-destructive")}><Trash2 className="h-3.5 w-3.5" aria-hidden="true" /></button>
              )}
            </li>
          ))}
        </ul>
      )}
      {lista.length === 0 && !aberto && (
        <p className={juntar(texto.auxiliar, "mt-2")}>Nenhuma venda registrada nesta plataforma.</p>
      )}
    </Secao>
  );
}
