interface TaskIdLinkProps {
  taskId: string;
  workItemId: string;
  boardArea: string;
}

export const TaskIdLink: React.FC<TaskIdLinkProps> = ({
  taskId,
  workItemId,
  boardArea,
}) => (
  <a
    href={`/board/${boardArea}?workItemId=${workItemId}`}
    target="_blank"
    rel="noopener noreferrer"
    className="inline-flex items-center bg-muted/60 hover:bg-muted px-1.5 py-0.5 rounded text-xs font-mono text-primary transition-colors"
  >
    {taskId}
  </a>
);
