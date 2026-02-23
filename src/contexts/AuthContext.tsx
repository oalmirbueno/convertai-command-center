import React, { createContext, useContext, useState, ReactNode } from "react";

export type UserRole = "admin" | "client";

export interface User {
  name: string;
  email: string;
  role: UserRole;
  company?: string;
  avatar?: string;
}

interface AuthContextType {
  user: User | null;
  login: (role: UserRole) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const mockUsers: Record<UserRole, User> = {
  admin: {
    name: "Lucas Ferreira",
    email: "lucas@convertai.com",
    role: "admin",
    avatar: "LF",
  },
  client: {
    name: "Maria Acerbi",
    email: "maria@acerbi.com.br",
    role: "client",
    company: "Acerbi Associação",
    avatar: "MA",
  },
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);

  const login = (role: UserRole) => setUser(mockUsers[role]);
  const logout = () => setUser(null);

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
