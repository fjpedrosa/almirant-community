import {
  BookOpen,
  Bot,
  Code,
  Database,
  FileText,
  Folder,
  Globe,
  Lightbulb,
  Lock,
  Mail,
  MessageSquare,
  Network,
  PenTool,
  Server,
  Settings,
  Shield,
  StickyNote,
  Terminal,
  Users,
  Video,
  Wrench,
  type LucideIcon,
  type LucideProps,
} from "lucide-react";

/**
 * Maps icon name strings (stored in DB) to Lucide React icon components.
 * Icon names use kebab-case to match Lucide naming conventions.
 */
const iconMap: Record<string, LucideIcon> = {
  "book-open": BookOpen,
  bot: Bot,
  code: Code,
  database: Database,
  "file-text": FileText,
  folder: Folder,
  globe: Globe,
  lightbulb: Lightbulb,
  lock: Lock,
  mail: Mail,
  "message-square": MessageSquare,
  network: Network,
  "pen-tool": PenTool,
  server: Server,
  settings: Settings,
  shield: Shield,
  "sticky-note": StickyNote,
  terminal: Terminal,
  users: Users,
  video: Video,
  wrench: Wrench,
};

export interface DynamicIconProps extends Omit<LucideProps, "name"> {
  name: string | null | undefined;
}

/**
 * Renders a Lucide icon by its kebab-case name (as stored in the database).
 * Returns null if the name is not found in the icon map.
 */
export const DynamicIcon: React.FC<DynamicIconProps> = ({ name, ...props }) => {
  if (!name) return null;
  const Icon = iconMap[name];
  if (!Icon) return null;
  return <Icon {...props} />;
};

/**
 * Checks whether a given icon name has a corresponding Lucide component.
 */
export const hasIcon = (iconName: string | null | undefined): boolean => {
  if (!iconName) return false;
  return iconName in iconMap;
};
