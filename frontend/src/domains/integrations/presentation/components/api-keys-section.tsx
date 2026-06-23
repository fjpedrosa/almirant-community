import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Key, Loader2, Plus } from "lucide-react";
import { useMemo } from "react";
import { ProviderKeyItemContainer } from "../containers/provider-key-item-container";
import type { ApiKeysSectionProps } from "../../domain/types";

export const ApiKeysSection: React.FC<ApiKeysSectionProps> = ({
  provider,
  connections,
  isLoading,
  defaultConnectionId,
  editingConnectionId,
  editName,
  editToken,
  isSavingEdit,
  onStartEdit,
  onCancelEdit,
  onSaveEdit,
  onSetEditName,
  onSetEditToken,
  onSetDefault,
  onDeleteKey,
  onTestKey,
  onAddKeyClick,
  testingStates,
  testResults,
  onMovePriorityUp,
  onMovePriorityDown,
  isReordering,
  onToggleOrchestration,
  onReconnect,
}) => {
  const keyCount = connections.length;

  // Ensure connections are sorted by priority ASC (backend does this, but be explicit)
  const sorted = useMemo(
    () =>
      [...connections].sort((a, b) => {
        const aPriority = a.priority ?? Number.MAX_SAFE_INTEGER;
        const bPriority = b.priority ?? Number.MAX_SAFE_INTEGER;

        return aPriority - bPriority;
      }),
    [connections],
  );

  return (
    <div>
      {/* Section header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <Key className="h-4 w-4 text-muted-foreground shrink-0" />
        <span className="text-sm font-medium flex-1">API Keys</span>
        {keyCount > 0 && (
          <Badge variant="outline" className="text-[11px]">
            {keyCount}
          </Badge>
        )}
        {!isLoading && (
          <Button
            variant="outline"
            size="sm"
            onClick={onAddKeyClick}
            className="h-7"
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Key
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="space-y-3 px-3 pb-3">
        {isLoading ? (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading connections...
          </div>
        ) : connections.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex items-center justify-center py-8">
              <div className="space-y-2 text-center">
                <Key className="mx-auto h-8 w-8 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  No API keys configured
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onAddKeyClick}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Add Your First Key
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          sorted.map((connection, index) => (
            <ProviderKeyItemContainer
              key={connection.id}
              provider={provider}
              connection={connection}
              isDefault={defaultConnectionId === connection.id}
              isEditing={editingConnectionId === connection.id}
              editName={
                editingConnectionId === connection.id
                  ? editName
                  : connection.name
              }
              editToken={
                editingConnectionId === connection.id ? editToken : ""
              }
              onEditNameChange={onSetEditName}
              onEditTokenChange={onSetEditToken}
              onStartEdit={() => onStartEdit(connection.id)}
              onCancelEdit={onCancelEdit}
              onSaveEdit={onSaveEdit}
              onSetDefault={() => onSetDefault(connection.id)}
              onTest={() => onTestKey(connection.id)}
              onDelete={() => onDeleteKey(connection.id)}
              isSaving={
                isSavingEdit && editingConnectionId === connection.id
              }
              isTesting={testingStates[connection.id] || false}
              testResult={testResults[connection.id]}
              priorityPosition={index + 1}
              totalConnections={sorted.length}
              onMovePriorityUp={onMovePriorityUp ? () => onMovePriorityUp(connection.id) : undefined}
              onMovePriorityDown={onMovePriorityDown ? () => onMovePriorityDown(connection.id) : undefined}
              isReordering={isReordering}
              onToggleOrchestration={onToggleOrchestration ? () => onToggleOrchestration(connection.id) : undefined}
              onReconnect={onReconnect ? () => onReconnect(connection.id) : undefined}
            />
          ))
        )}
      </div>
    </div>
  );
};
