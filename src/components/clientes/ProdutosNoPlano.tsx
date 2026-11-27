import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { KanbanSquare, Link2, Mail, Send, UserPlus } from "lucide-react";
import { casa, copiarLinkDeAcesso, fraseDoErro, type PapelNaConta } from "@/lib/produto/api";
import { avisarComLink } from "@/lib/produto/avisoComLink";
import type { CrmDoCliente } from "@/lib/crmPeloPlano";
import { ROTULO_DO_MODO, lerContaDoCliente, modoDaConta, mudarModoDaConta, type ModoDeCobranca } from "@/lib/produto/produtosDoCliente";
import { botao, etiqueta, foco, juntar, texto } from "@/components/sistema";

const EMAIL = /^[^@\s<>"]+@[^@\s<>"]+\.[^@\s<>"]+$/;
const ESTADO_DA_PESSOA: Record<string, string> = { ativo: "Entrou", convidado: "Convite enviado", pausado: "Pausado" };

/**
 * O E-mail e o CRM do produto dentro do plano do cliente (19/11/2026): ver o que ele tem, dizer como é cobrado
 * (no plano, pelo site ou cortesia, para nada contar duas vezes) e cadastrar quem usa o CRM. Cada pessoa nova
 * recebe na hora o e-mail para criar a senha.
 */
export default function ProdutosNoPlano({ clientId, crm }: { clientId: string; crm: CrmDoCliente | null }) {
  const qc = useQueryClient();
  const conta = useQuery({ queryKey: ["produto-do-cliente", clientId], queryFn: () => lerContaDoCliente(clientId), retry: false });
  const [mudando, setMudando] = useState(false);
  const [convidando, setConvidando] = useState(false);
  const [form, setForm] = useState({ nome: "", email: "", papel: "usuario" as PapelNaConta });
  const c = conta.data;
  if (conta.isLoading || !c) return null;

  const modo = modoDaConta(c);
  const escolher = async (m: ModoDeCobranca) => {
    if (m === modo) return;
    setMudando(true);
    try {
      await mudarModoDaConta(c, m);
      toast.success(`Agora: ${ROTULO_DO_MODO[m].rotulo.toLowerCase()}.`);
      await qc.invalidateQueries({ queryKey: ["produto-do-cliente", clientId] });
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível mudar agora."));
    } finally {
      setMudando(false);
    }
  };
  const convidar = async () => {
    const email = form.email.trim().toLowerCase();
    if (!form.nome.trim() || !EMAIL.test(email)) return void toast.error("Escreva o nome e um e-mail válido.");
    setConvidando(true);
    try {
      const r = await casa.convidar({ conta_id: c.id, nome: form.nome.trim(), email, papel: form.papel });
      await avisarComLink(r.enviado ? `Convite enviado para ${email}.` : `${form.nome.trim()} entrou na equipe. O e-mail não saiu.`, r.link);
      setForm({ nome: "", email: "", papel: "usuario" });
      await qc.invalidateQueries({ queryKey: ["crm-do-cliente", clientId] });
    } catch (e) {
      toast.error(fraseDoErro(e, "Não foi possível convidar agora."));
    } finally {
      setConvidando(false);
    }
  };

  const pessoas = crm && crm.conta_id === c.id ? crm.equipe : [];
  const campo = "h-9 min-w-0 rounded-xl border border-border bg-card px-3 text-[13px] outline-none focus:ring-2 focus:ring-ring";
  return (
    <div className="mt-2 space-y-3 border-t border-border pt-4" data-produtos-no-plano="">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">Produtos da Aceleriq</p>

      {c.email_ativo && (
        <div className="rounded-lg border border-border p-3.5" data-email-no-plano="">
          <div className="flex min-w-0 flex-wrap items-center">
            <Mail className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span className="mr-2 text-[14px] font-semibold">E-mail profissional</span>
            <span className={juntar(texto.auxiliar, "min-w-0 flex-1 truncate")}>{c.dominios.map((d) => d.dominio).join(", ") || "sem domínio"} · {c.caixas} {c.caixas === 1 ? "caixa" : "caixas"}</span>
            <Link to="/produto/email" className={juntar(botao.discreto, "h-8 px-2 text-[13px]")}>Abrir na Central</Link>
          </div>
          {c.extra_id ? (
            <p className={juntar(texto.auxiliar, "mt-2")}>Cobrado junto com o extra do CRM deste cliente.</p>
          ) : (
            <div className="mt-2.5">
              <p className={juntar(texto.auxiliar, "mb-1.5")}>Como é cobrado (assim nada conta duas vezes):</p>
              <div className="-m-1 flex flex-wrap [&>*]:m-1" role="radiogroup" aria-label="Como o e-mail é cobrado">
                {(Object.keys(ROTULO_DO_MODO) as ModoDeCobranca[]).map((m) => (
                  <button key={m} type="button" role="radio" aria-checked={modo === m} disabled={mudando} onClick={() => void escolher(m)} title={ROTULO_DO_MODO[m].ajuda} className={juntar("h-8 rounded-full border px-3 text-[13px] font-medium", foco, modo === m ? "border-primary bg-accent-soft text-primary" : "border-border hover:bg-muted")} data-modo-de-cobranca={m}>
                    {ROTULO_DO_MODO[m].rotulo}
                  </button>
                ))}
              </div>
              <p className={juntar(texto.auxiliar, "mt-1.5")}>{ROTULO_DO_MODO[modo].ajuda}</p>
            </div>
          )}
        </div>
      )}

      {c.crm_ativo && (
        <div className="rounded-lg border border-border p-3.5" data-crm-no-plano="">
          <div className="flex min-w-0 items-center">
            <KanbanSquare className="mr-2 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <span className="mr-2 text-[14px] font-semibold">Quem usa o CRM</span>
            <span className={juntar(texto.auxiliar, "flex-1")}>{pessoas.length} {pessoas.length === 1 ? "pessoa" : "pessoas"}</span>
          </div>
          {pessoas.length > 0 && (
            <ul className="mt-2 space-y-1">
              {pessoas.map((p) => (
                <li key={p.id} className="flex min-w-0 items-center text-[13px]">
                  <span className="min-w-0 flex-1 truncate"><b className="font-medium">{p.nome || p.email}</b> <span className="text-muted-foreground">{p.email}</span></span>
                  <span className={juntar(etiqueta, "ml-2 h-6 px-2.5", p.estado === "ativo" ? "bg-accent-soft text-primary" : "bg-warning-soft text-warning")}>{ESTADO_DA_PESSOA[p.estado] || p.estado}</span>
                  {/* 27/11: o link de acesso de cada pessoa, a qualquer hora (vale uma vez; gerar de novo não estraga nada). */}
                  <button
                    type="button"
                    className={juntar(botao.discreto, "ml-1 h-7 shrink-0 px-2 text-[12px]")}
                    aria-label={`Copiar o link de acesso de ${p.email}`}
                    title="Copiar link de acesso (para mandar por WhatsApp)"
                    onClick={() => void copiarLinkDeAcesso(p.id).then((e) => toast.success(`Link de acesso de ${e} copiado. Vale uma vez.`)).catch((e) => toast.error(fraseDoErro(e)))}
                    data-copiar-link-de-acesso=""
                  >
                    <Link2 className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
                    Link
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex min-w-0 flex-wrap items-center [&>*]:mb-2 [&>*]:mr-2" data-convidar-no-plano="">
            <input value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} placeholder="Nome" aria-label="Nome da pessoa" className={juntar(campo, "w-[150px]")} />
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="e-mail" aria-label="E-mail da pessoa" type="email" className={juntar(campo, "w-[210px]")} />
            <select value={form.papel} onChange={(e) => setForm({ ...form, papel: e.target.value as PapelNaConta })} aria-label="Nível" className={campo}>
              <option value="usuario">Vendedor</option>
              <option value="gerente">Gerente</option>
              <option value="admin">Administrador</option>
            </select>
            <button type="button" className={juntar(botao.primario, "h-9")} onClick={() => void convidar()} disabled={convidando} data-convidar-pessoa="">
              {convidando ? <Send className="mr-1.5 h-4 w-4 animate-pulse" aria-hidden="true" /> : <UserPlus className="mr-1.5 h-4 w-4" aria-hidden="true" />}
              {convidando ? "Enviando..." : "Cadastrar e enviar o acesso"}
            </button>
          </div>
          <p className={texto.auxiliar}>A pessoa recebe um e-mail com o link para criar a senha. No CRM pelo plano, o número de usuários do extra acompanha sozinho.</p>
        </div>
      )}
    </div>
  );
}
