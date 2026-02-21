import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Trash2, ArrowRight } from "lucide-react";
import type { ProjectData } from "@/lib/api";

interface ProjectCardProps {
  project: ProjectData;
  onDelete: (id: string) => void;
}

export default function ProjectCard({ project, onDelete }: ProjectCardProps) {
  const navigate = useNavigate();

  return (
    <Card className="group hover:border-primary/50 transition-colors">
      <CardHeader>
        <CardTitle className="text-lg">{project.name}</CardTitle>
        {project.description && (
          <CardDescription>{project.description}</CardDescription>
        )}
      </CardHeader>
      <CardContent>
        <p className="text-xs text-muted-foreground">
          Updated {new Date(project.updated_at).toLocaleDateString()}
        </p>
      </CardContent>
      <CardFooter className="justify-between">
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive"
          onClick={(e) => {
            e.stopPropagation();
            onDelete(project.id);
          }}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button size="sm" onClick={() => navigate(`/builder/${project.id}`)}>
          Open <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </CardFooter>
    </Card>
  );
}
