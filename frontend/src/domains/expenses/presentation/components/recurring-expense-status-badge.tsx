import { Badge } from "@/components/ui/badge";

interface Props {
  isActive: boolean;
  cancelledAt: string | null;
}

export const RecurringExpenseStatusBadge = ({ isActive, cancelledAt }: Props) => {
  if (cancelledAt) return <Badge variant="destructive">Cancelled</Badge>;
  if (isActive) return <Badge className="bg-green-100 text-green-800">Active</Badge>;
  return <Badge variant="secondary">Inactive</Badge>;
};
