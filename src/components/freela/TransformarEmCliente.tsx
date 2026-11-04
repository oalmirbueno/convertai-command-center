import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CampoDeFormulario, GrupoDeCampos, SeletorCompacto, botao, campo, juntar, texto } from "@/components/sistema";
import { generatePassword } from "@/components/admin/CreateClientModal";
import { PROJECT_TYPES } from "@/components/admin/CreateProjectModal";
import { useFinancePlans } from "@/hooks/useFinanceV2";
import { fmtMoeda, hojeISO, somarMeses } from "@/lib/freela/freelaLib";
import type { Tables } from "@/integrations/supabase/types";

type Proposta = Tables<"freela_propostas">;
type Contato = Tables<"freela_contatos">;

const PORTAL_URL = "https://aceleriq.online";

/**
 * 04/11/2026 (dono: "eu aperto, transforma em cliente, já cria o projeto; me pergunta se foi pago ou vai pagar e qual
 * o plano; se foi pago vai direto para o financeiro e conta como recorrente"). A conta nasce pelo manage-team, como no
 * cadastro de cliente; o resto (perfil, projeto e cobrança) é uma transação só no banco, e repetir não duplica.
 */
export default function TransformarEmCliente({ proposta, contato, onFechar }: {
  proposta: Proposta | null;
  contato: Contato | null;
  onFechar: () => void;
}) {
  const queryClient = useQueryClient();
  const { data: planos } = useFinancePlans();
  const [nome, setNome] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [email, setEmail] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [modelo, setModelo] = useState<"recorrente" | "avulso">("recorrente");
  const [planoNome, setPlanoNome] = useState("");
  const [valor, setValor] = useState("");
  const [pago, setPago] = useState<"sim" | "nao">("sim");
  const [vencimento, setVencimento] = useState(hojeISO());
  const [tipoProjeto, setTipoProjeto] = useState("other");
  const [prazo, setPrazo] = useState(somarMeses(hojeISO(), 1));
  const [convidar, setConvidar] = useState(false);
  const [salvando, setSalvando] = useState(false);

  const emDolar = proposta?.moeda === "USD";

  useEffect(() => {
    if (!proposta) return;
    setNome(contato?.nome || "");
    setEmpresa(contato?.empresa || "");
    setEmail(contato?.email || "");
    setWhatsapp(contato?.whatsapp || "");
    setModelo(proposta.moeda === "USD" ? "avulso" : "recorrente");
    setPlanoNome("");
    setValor(String(proposta.valor ?? ""));
    setPago("sim");
    setVencimento(hojeISO());
    setTipoProjeto("other");
    setPrazo(somarMeses(hojeISO(), 1));
    setConvidar(false);
  }, [proposta, contato]);

  const confirmar = async () => {
    if (!proposta || !contato) return;
    const emailLimpo = email.trim().toLowerCase();
    const valorNum = Number(String(valor).replace(",", "."));
    if (!nome.trim()) return void toast.error("Informe o nome do cliente.");
    if (!/^\S+@\S+\.\S+$/.test(emailLimpo)) return void toast.error("O cliente precisa de um e-mail válido para ter acesso.");
    if (!Number.isFinite(valorNum) || valorNum <= 0) return void toast.error("Informe um valor maior que zero.");
    if (pago === "nao" && !vencimento) return void toast.error("Informe quando ele vai pagar.");

    setSalvando(true);
    try {
      const { error: erroContato } = await supabase
        .from("freela_contatos")
        .update({ nome: nome.trim(), empresa: empresa.trim() || null, email: emailLimpo, whatsapp: whatsapp.trim() || null })
        .eq("id", contato.id);
      if (erroContato) throw new Error(erroContato.message);

      // Quem já tem conta com esse e-mail só ganha o vínculo; nasce conta só para quem não tem.
      const { data: existente, error: erroBusca } = await supabase
        .from("profiles")
        .select("id")
        .ilike("email", emailLimpo)
        .maybeSingle();
      if (erroBusca) throw new Error(erroBusca.message);
      let contaNova = false;
      if (!existente) {
        const { data: criado, error: erroConta } = await supabase.functions.invoke("manage-team", {
          body: { action: "create", email: emailLimpo, full_name: nome.trim(), role: "client", password: generatePassword() },
        });
        const falhou = (criado as { error?: unknown } | null)?.error;
        if (erroConta || falhou) throw new Error(typeof falhou === "string" ? falhou : "Não consegui criar a conta do cliente.");
        contaNova = true;
      }

      const { data, error } = await supabase.rpc("freela_transformar_em_cliente", {
        p_proposta_id: proposta.id,
        p_modelo: modelo,
        p_valor: valorNum,
        p_plano_nome: modelo === "recorrente" ? planoNome.trim() || undefined : undefined,
        p_pago: pago === "sim",
        p_vencimento: pago === "sim" ? undefined : vencimento,
        p_tipo_projeto: tipoProjeto,
        p_prazo: prazo || undefined,
      });
      if (error) throw new Error(error.message);
      const clientId = (data as { client_id?: string } | null)?.client_id;

      let avisoDoConvite = "";
      if (convidar && contaNova && clientId) {
        const { data: emissao, error: erroEmissao } = await supabase.rpc("issue_first_access_token", { p_profile_id: clientId });
        const token = (emissao as { token?: string } | null)?.token;
        if (erroEmissao || !token) {
          avisoDoConvite = " O convite não saiu: envie pela ficha do cliente.";
        } else {
          const { error: erroEmail } = await supabase.functions.invoke("send-transactional-email", {
            body: {
              templateName: "client-welcome",
              recipientEmail: emailLimpo,
              idempotencyKey: `client-welcome-${clientId}`,
              templateData: {
                name: nome.trim(),
                company: empresa.trim() || nome.trim(),
                email: emailLimpo,
                firstAccessUrl: `${PORTAL_URL}/primeiro-acesso?token=${token}`,
              },
            },
          });
          if (erroEmail) avisoDoConvite = " O convite não saiu: envie pela ficha do cliente.";
        }
      }

      toast.success(`${empresa.trim() || nome.trim()} virou cliente, com o projeto criado.${avisoDoConvite}`);
      await Promise.all(
        ["freela", "clients", "billing", "projects"].map((chave) => queryClient.invalidateQueries({ queryKey: [chave] })),
      );
      onFechar();
    } catch (erro) {
      toast.error(erro instanceof Error ? erro.message : "Não consegui transformar em cliente.");
    } finally {
      setSalvando(false);
    }
  };

  const planosAtivos = (planos || []).filter((p) => p.isActive);

  return (
    <Dialog open={!!proposta} onOpenChange={(aberto) => { if (!aberto && !salvando) onFechar(); }}>
      <DialogContent className="max-h-[92vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Transformar em cliente</DialogTitle>
          <DialogDescription>
            {proposta && `${proposta.titulo} · ${fmtMoeda(proposta.valor, proposta.moeda)}. Cria o cliente, o projeto e o lançamento no financeiro.`}
          </DialogDescription>
        </DialogHeader>
        <GrupoDeCampos colunas={2}>
          <CampoDeFormulario rotulo="Nome" obrigatorio>
            <input value={nome} onChange={(e) => setNome(e.target.value)} className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Empresa">
            <input value={empresa} onChange={(e) => setEmpresa(e.target.value)} className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="E-mail" obrigatorio>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={campo} />
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="WhatsApp">
            <input value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className={campo} />
          </CampoDeFormulario>

          <CampoDeFormulario rotulo="O que foi fechado" largo apoio={emDolar ? "Em dólar fica no caixa do Freela, separado do real." : undefined}>
            <SeletorCompacto
              opcoes={emDolar
                ? [{ valor: "avulso", rotulo: "Projeto único" }]
                : [{ valor: "recorrente", rotulo: "Plano mensal" }, { valor: "avulso", rotulo: "Projeto único" }]}
              valor={modelo}
              onEscolher={(v) => setModelo(v as "recorrente" | "avulso")}
              rotulo="O que foi fechado"
            />
          </CampoDeFormulario>
          {modelo === "recorrente" && (
            <CampoDeFormulario rotulo="Plano">
              <select
                value={planosAtivos.find((p) => p.name === planoNome)?.id || ""}
                onChange={(e) => {
                  const plano = planosAtivos.find((p) => p.id === e.target.value);
                  setPlanoNome(plano ? plano.name : "");
                  const versao = plano ? plano.currentVersion || plano.versions[0] : null;
                  if (versao) setValor(String(versao.finalAmount || versao.amount));
                }}
                className={campo}
              >
                <option value="">Sem plano do catálogo</option>
                {planosAtivos.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </CampoDeFormulario>
          )}
          <CampoDeFormulario rotulo={modelo === "recorrente" ? "Valor por mês" : "Valor do projeto"} obrigatorio largo={modelo !== "recorrente"}>
            <input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} className={campo} />
          </CampoDeFormulario>

          <CampoDeFormulario rotulo="Já foi pago?" largo={pago === "sim"}>
            <SeletorCompacto
              opcoes={[{ valor: "sim", rotulo: "Já pagou" }, { valor: "nao", rotulo: "Vai pagar" }]}
              valor={pago}
              onEscolher={(v) => setPago(v as "sim" | "nao")}
              rotulo="Já foi pago?"
            />
          </CampoDeFormulario>
          {pago === "nao" && (
            <CampoDeFormulario rotulo="Vai pagar em" obrigatorio>
              <input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} className={campo} />
            </CampoDeFormulario>
          )}

          <CampoDeFormulario rotulo="Tipo do projeto">
            <select value={tipoProjeto} onChange={(e) => setTipoProjeto(e.target.value)} className={campo}>
              {PROJECT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </CampoDeFormulario>
          <CampoDeFormulario rotulo="Prazo do projeto">
            <input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} className={campo} />
          </CampoDeFormulario>
        </GrupoDeCampos>

        <label className={juntar(texto.corpo, "mt-3 flex items-center")}>
          <input type="checkbox" checked={convidar} onChange={(e) => setConvidar(e.target.checked)} className="mr-2 h-4 w-4" />
          Enviar agora o convite de acesso por e-mail
        </label>

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onFechar} disabled={salvando} className={botao.secundario}>Cancelar</button>
          <button type="button" onClick={() => void confirmar()} disabled={salvando} className={botao.primario}>
            {salvando ? "Transformando..." : "Transformar em cliente"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
