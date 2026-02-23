import { clients } from "@/data/mockData";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserPlus, Link2 } from "lucide-react";

export default function Clients() {
  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Clientes</h1>
          <p className="text-muted-foreground text-sm">Gerencie sua base de clientes.</p>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" className="rounded-xl border-border/50 gap-2 h-10">
            <Link2 className="w-4 h-4" />
            Gerar Link Briefing
          </Button>
          <Button className="rounded-xl bg-primary hover:bg-primary/90 gap-2 h-10">
            <UserPlus className="w-4 h-4" />
            Novo Cliente
          </Button>
        </div>
      </div>

      <Card className="bg-card border-border/50 rounded-2xl overflow-hidden">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow className="border-border/50 hover:bg-transparent">
                <TableHead className="text-muted-foreground text-xs uppercase tracking-wider">Cliente</TableHead>
                <TableHead className="text-muted-foreground text-xs uppercase tracking-wider">Email</TableHead>
                <TableHead className="text-muted-foreground text-xs uppercase tracking-wider">Serviços</TableHead>
                <TableHead className="text-muted-foreground text-xs uppercase tracking-wider text-center">Projetos</TableHead>
                <TableHead className="text-muted-foreground text-xs uppercase tracking-wider text-center">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((c) => (
                <TableRow key={c.id} className="border-border/50 hover:bg-secondary/30">
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="w-9 h-9">
                        <AvatarFallback className="bg-primary/20 text-primary text-xs font-semibold">{c.avatar}</AvatarFallback>
                      </Avatar>
                      <span className="font-medium text-foreground text-sm">{c.name}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">{c.email}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1.5">
                      {c.services.map((s) => (
                        <Badge key={s} variant="outline" className="border-border/50 text-[10px]">{s}</Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-center font-mono text-sm text-foreground">{c.projects}</TableCell>
                  <TableCell className="text-center">
                    <Badge className="bg-success/20 text-success border-0 text-[10px]">{c.status}</Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
