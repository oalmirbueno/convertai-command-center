import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CI_E2E_API_ORIGIN } from "../../config/ci-e2e-environment";

export const USER_ROLES = [
  "admin", "assignedStaff", "unassignedStaff", "clientA", "clientB",
] as const;
export type UserRole = typeof USER_ROLES[number];
export type ClientKey = "clientA" | "clientB";

export interface CiFixture {
  supabaseUrl: string;
  users: Record<UserRole, { id: string; email: string; password: string }>;
  projects: Record<ClientKey, { id: string; clientId: string; name: string }>;
  tasks: Record<ClientKey, { id: string; projectId: string; title: string }>;
}

export function readCiFixture(): CiFixture {
  // This file contains only disposable credentials. Never log its contents or
  // use storageState/API login to turn those credentials into a browser session.
  const fixture: CiFixture = JSON.parse(readFileSync(
    resolve("e2e/.auth/ci-fixture.json"), "utf8",
  ));
  if (fixture.supabaseUrl !== CI_E2E_API_ORIGIN) {
    throw new Error("E2E fixture does not identify the fixed local API.");
  }
  const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
  for (const role of USER_ROLES) {
    const user = fixture.users?.[role];
    if (!user || !uuid.test(user.id)
      || !user.email.startsWith("ci-e2e." + role.toLowerCase() + "+")
      || !user.email.endsWith("@example.test")
      || typeof user.password !== "string" || user.password.length < 12) {
      throw new Error("E2E fixture requires five distinct synthetic accounts.");
    }
  }
  if (new Set(USER_ROLES.map((role) => fixture.users[role].id)).size !== 5) {
    throw new Error("E2E roles must use separate accounts.");
  }
  for (const key of ["clientA", "clientB"] as const) {
    const project = fixture.projects?.[key];
    const task = fixture.tasks?.[key];
    if (!project || !task || !uuid.test(project.id) || !uuid.test(task.id)
      || project.clientId !== fixture.users[key].id || task.projectId !== project.id
      || !project.name || !task.title) {
      throw new Error("E2E fixture has incomplete project/task ownership.");
    }
  }
  if (fixture.projects.clientA.id === fixture.projects.clientB.id
    || fixture.tasks.clientA.id === fixture.tasks.clientB.id) {
    throw new Error("Cross-client fixtures must be distinct.");
  }
  return fixture;
}
