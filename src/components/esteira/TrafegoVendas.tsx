import { useMemo, useState } from "react";
import { BadgeDollarSign, Plus, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import type { CanalVenda, FatosDoCliente, PlataformaAds } from "@/lib/esteira/esteiraTipos";
import { resumoDeVendas } from "@/lib/esteira/esteiraMontar";
import { CANAIS, apagarVenda, fmtBrl, registrarVenda, rotuloDoCanal } from "@/lib/esteira/esteiraVendas";

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

  return (
    <section className="mt-3 rounded-2xl border border-border bg-card p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-muted-foreground"><BadgeDollarSign className="h-3.5 w-3.5" />Vendas</p>
        {canWrite && (
          <button type="button" onClick={() => setAberto((v) => !v)} className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11.5px] font-semibold ${aberto ? "border border-border text-muted-foreground" : "bg-primary text-primary-foreground"}`}>
            {aberto ? <><X className="h-3.5 w-3.5" />Fechar</> : <><Plus className="h-3.5 w-3.5" />Registrar venda</>}
          </button>
        )}
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2">
        <div className="rounded-xl bg-secondary/60 px-2.5 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">7 dias</p>
          <p className="text-[20px] font-bold leading-tight tabular-nums text-foreground">{r7.total}</p>
          <p className="text-[11px] text-muted-foreground">{r7.receita > 0 ? fmtBrl(r7.receita) : r7.total > 0 ? "sem valor" : "nenhuma"}</p>
        </div>
        <div className="rounded-xl bg-secondary/60 px-2.5 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">30 dias</p>
          <p className="text-[20px] font-bold leading-tight tabular-nums text-foreground">{r30.total}</p>
          <p className="text-[11px] text-muted-foreground">{r30.receita > 0 ? fmtBrl(r30.receita) : r30.total > 0 ? "sem valor" : "nenhuma"}</p>
        </div>
        <div className="rounded-xl bg-secondary/60 px-2.5 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Por onde (30d)</p>
          {r30.porCanal.length === 0 ? (
            <p className="text-[12px] text-muted-foreground/80">–</p>
          ) : r30.porCanal.slice(0, 3).map((c) => (
            <p key={c.canal} className="text-[11.5px] leading-snug text-foreground"><span className="font-semibold tabular-nums">{c.vendas}</span> {rotuloDoCanal(c.canal)}</p>
          ))}
        </div>
      </div>
      {r30.rastreadas > 0 && <p className="mt-1.5 text-[11px] text-muted-foreground">{r30.rastreadas} rastreada{r30.rastreadas === 1 ? "" : "s"} pela plataforma (pixel) nos 30 dias, já somada{r30.rastreadas === 1 ? "" : "s"}.</p>}
      {r30.porCampanha.length > 0 && (
        <p className="mt-1.5 text-[11.5px] text-foreground/90">
          <span className="text-muted-foreground">Campanha que mais vendeu (30d): </span>{r30.porCampanha[0].nome} · {r30.porCampanha[0].vendas} venda{r30.porCampanha[0].vendas === 1 ? "" : "s"}{r30.porCampanha[0].receita > 0 ? ` · ${fmtBrl(r30.porCampanha[0].receita)}` : ""}
        </p>
      )}

      {aberto && (
        <div className="mt-3 rounded-xl border border-primary/30 bg-primary/5 p-3">
          <div className="grid grid-cols-3 gap-2">
            <label className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Dia
              <input type="date" value={data} max={hojeBrt()} onChange={(e) => setData(e.target.value)} className="mt-0.5 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[13px] normal-case tracking-normal text-foreground" />
            </label>
            <label className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Quantas
              <input type="number" min={1} step={1} inputMode="numeric" value={quantidade} onChange={(e) => setQuantidade(e.target.value)} className="mt-0.5 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[13px] normal-case tracking-normal text-foreground" />
            </label>
            <label className="text-[10.5px] uppercase tracking-wider text-muted-foreground">Valor (R$)
              <input type="text" inputMode="decimal" placeholder="se souber" value={valor} onChange={(e) => setValor(e.target.value)} className="mt-0.5 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[13px] normal-case tracking-normal text-foreground placeholder:text-muted-foreground/60" />
            </label>
          </div>
          <p className="mt-2 text-[10.5px] uppercase tracking-wider text-muted-foreground">Por onde veio</p>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {CANAIS.map((c) => (
              <button key={c.key} type="button" onClick={() => setCanal(c.key)} className={`rounded-full border px-2.5 py-1 text-[12px] ${canal === c.key ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-foreground"}`}>{c.rotulo}</button>
            ))}
          </div>
          <label className="mt-2 block text-[10.5px] uppercase tracking-wider text-muted-foreground">Campanha
            <select value={campanha} onChange={(e) => setCampanha(e.target.value)} className="mt-0.5 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[13px] normal-case tracking-normal text-foreground">
              <option value="">Sem campanha específica</option>
              {campanhas.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.ativa ? "" : " (pausada)"}</option>)}
            </select>
          </label>
          <input type="text" value={nota} onChange={(e) => setNota(e.target.value)} placeholder="Observação (opcional): o que vendeu, para quem" className="mt-2 w-full rounded-lg border border-border bg-card px-2 py-1.5 text-[12.5px] text-foreground placeholder:text-muted-foreground/60" />
          <button type="button" onClick={() => void gravar()} disabled={gravando} className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-[12.5px] font-bold text-primary-foreground disabled:opacity-50">
            {gravando ? "Gravando…" : "Gravar venda"}
          </button>
        </div>
      )}

      {lista.length > 0 && (
        <ul className="mt-2.5 divide-y divide-border/70 rounded-xl border border-border/70">
          {lista.map((v) => (
            <li key={v.id} className="flex items-center gap-2 px-2.5 py-1.5">
              <span className="w-10 shrink-0 text-[11px] tabular-nums text-muted-foreground">{fmtDia(v.data)}</span>
              <span className="min-w-0 flex-1 truncate text-[12.5px] text-foreground">
                <span className="font-semibold tabular-nums">{v.quantidade}</span> {v.quantidade === 1 ? "venda" : "vendas"}
                {v.valor !== null ? <span className="tabular-nums"> · {fmtBrl(v.valor)}</span> : <span className="text-muted-foreground"> · sem valor</span>}
                <span className="text-muted-foreground"> · {rotuloDoCanal(v.canal)}{v.campanhaNome ? ` · ${v.campanhaNome}` : ""}{v.origem !== "manual" ? " · rastreada" : ""}</span>
              </span>
              {canWrite && v.origem === "manual" && (
                <button type="button" onClick={() => void apagar(v.id)} aria-label="Apagar venda" className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></button>
              )}
            </li>
          ))}
        </ul>
      )}
      {lista.length === 0 && !aberto && (
        <p className="mt-2 text-[12px] text-muted-foreground">Nenhuma venda registrada nesta plataforma. Quando o cliente fechar uma (WhatsApp, Instagram, loja), registre aqui: é o que faz a leitura da campanha fechar.</p>
      )}
    </section>
  );
}
