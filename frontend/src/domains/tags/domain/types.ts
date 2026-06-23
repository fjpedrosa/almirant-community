import type { UseFormReturn } from "react-hook-form";

// Tag entity
export interface Tag {
  id: string;
  name: string;
  color: string;
  createdAt: Date;
}

// Create tag request
export interface CreateTagRequest {
  name: string;
  color?: string;
}

// Update tag request
export interface UpdateTagRequest {
  name?: string;
  color?: string;
}

// Tag with lead count
export interface TagWithCount extends Tag {
  leadCount: number;
}

// Form data for creating a tag
export interface TagFormData {
  name: string;
  color: string;
}

// Component props - Presentation layer
export interface TagCardProps {
  tag: TagWithCount;
  onDelete: (id: string, name: string) => void;
}

export interface TagsListProps {
  tags: TagWithCount[];
  isLoading: boolean;
  onDelete: (id: string, name: string) => void;
  onCreateClick: () => void;
}

export interface CreateTagDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  form: UseFormReturn<TagFormData>;
  isPending: boolean;
  onSubmit: (data: TagFormData) => void;
  colorOptions: string[];
}
