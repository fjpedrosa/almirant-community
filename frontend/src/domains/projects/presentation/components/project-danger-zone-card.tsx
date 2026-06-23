import { AlertTriangle, Archive } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ProjectDangerZoneCardProps {
  projectName: string;
  confirmationText: string;
  onConfirmationTextChange: (value: string) => void;
  isConfirmationValid: boolean;
  onArchive: () => void;
  isArchiving: boolean;
}

export const ProjectDangerZoneCard: React.FC<ProjectDangerZoneCardProps> = ({
  projectName,
  confirmationText,
  onConfirmationTextChange,
  isConfirmationValid,
  onArchive,
  isArchiving,
}) => {
  return (
    <Card className="border-destructive">
      <CardHeader>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-destructive" />
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex items-start gap-3">
          <Archive className="h-5 w-5 text-muted-foreground mt-0.5" />
          <div className="space-y-1">
            <h4 className="text-sm font-medium">Archive this project</h4>
            <p className="text-sm text-muted-foreground">
              Once archived, the project will disappear from all normal listings
              and selectors. Its data will not be physically deleted and can be
              restored internally if needed.
            </p>
          </div>
        </div>

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive">
              <Archive className="h-4 w-4 mr-2" />
              Archive project
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Archive project?</AlertDialogTitle>
              <AlertDialogDescription>
                This project will be archived and will no longer appear in your
                project listings or selectors. All data is preserved and can be
                restored if needed.
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className="space-y-2 py-2">
              <Label htmlFor="archive-confirmation">
                Type <span className="font-semibold">{projectName}</span> to
                confirm
              </Label>
              <Input
                id="archive-confirmation"
                value={confirmationText}
                onChange={(e) => onConfirmationTextChange(e.target.value)}
                placeholder={projectName}
                autoComplete="off"
              />
            </div>

            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => onConfirmationTextChange("")}
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={onArchive}
                disabled={!isConfirmationValid || isArchiving}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {isArchiving ? "Archiving..." : "Archive project"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
};
