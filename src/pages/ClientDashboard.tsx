import { useState } from "react";
import ProjectCanvas from "@/components/client/ProjectCanvas";
import ProjectView from "@/components/client/ProjectView";

export default function ClientDashboard() {
  const [selectedProject, setSelectedProject] = useState<any>(null);

  if (selectedProject) {
    return <ProjectView project={selectedProject} onBack={() => setSelectedProject(null)} />;
  }

  return <ProjectCanvas onSelectProject={setSelectedProject} />;
}
