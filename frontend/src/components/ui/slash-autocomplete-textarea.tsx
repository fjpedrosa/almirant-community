"use client";

import {
  useState,
  useRef,
  useCallback,
  useEffect,
  type KeyboardEvent,
  type ChangeEvent,
} from "react";
import {
  Command,
  CommandList,
  CommandEmpty,
  CommandItem,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";

interface SlashAutocompleteTextareaProps {
  value: string;
  onChange: (value: string) => void;
  skills: { slug: string; name: string; description: string | null }[];
  placeholder?: string;
  className?: string;
}

interface SlashMode {
  active: boolean;
  startIndex: number;
  query: string;
}

interface CursorPosition {
  top: number;
  left: number;
}

const MIRROR_STYLE_PROPS = [
  "fontFamily",
  "fontSize",
  "fontWeight",
  "fontStyle",
  "letterSpacing",
  "lineHeight",
  "padding",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "borderWidth",
  "borderTopWidth",
  "borderRightWidth",
  "borderBottomWidth",
  "borderLeftWidth",
  "boxSizing",
  "textIndent",
  "textTransform",
  "wordSpacing",
] as const;

function getCaretCoordinates(
  textarea: HTMLTextAreaElement,
  position: number
): CursorPosition {
  const mirror = document.createElement("div");
  const computed = window.getComputedStyle(textarea);

  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.overflow = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  mirror.style.width = computed.width;

  for (const prop of MIRROR_STYLE_PROPS) {
    mirror.style.setProperty(
      prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`),
      computed.getPropertyValue(
        prop.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
      )
    );
  }

  const textBeforeCursor = textarea.value.substring(0, position);
  const textNode = document.createTextNode(textBeforeCursor);
  const marker = document.createElement("span");
  marker.textContent = "\u200b"; // zero-width space

  mirror.appendChild(textNode);
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const top = marker.offsetTop - textarea.scrollTop;
  const left = marker.offsetLeft;

  document.body.removeChild(mirror);

  return { top, left };
}

function detectSlashMode(text: string, cursorPos: number): SlashMode {
  let i = cursorPos - 1;
  while (i >= 0) {
    const char = text[i];
    if (char === " " || char === "\n" || char === "\t") {
      return { active: false, startIndex: 0, query: "" };
    }
    if (char === "/") {
      if (i === 0 || /\s/.test(text[i - 1])) {
        const query = text.substring(i + 1, cursorPos);
        return { active: true, startIndex: i, query };
      }
      return { active: false, startIndex: 0, query: "" };
    }
    i--;
  }
  return { active: false, startIndex: 0, query: "" };
}

function filterSkills(
  skills: SlashAutocompleteTextareaProps["skills"],
  query: string
) {
  if (!query) return skills;
  const lower = query.toLowerCase();
  return skills.filter(
    (s) =>
      s.slug.toLowerCase().includes(lower) ||
      s.name.toLowerCase().includes(lower)
  );
}

function SlashAutocompleteTextarea({
  value,
  onChange,
  skills,
  placeholder,
  className,
}: SlashAutocompleteTextareaProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [slashMode, setSlashMode] = useState<SlashMode>({
    active: false,
    startIndex: 0,
    query: "",
  });
  const [cursorPos, setCursorPos] = useState<CursorPosition>({
    top: 0,
    left: 0,
  });
  const [selectedIndex, setSelectedIndex] = useState(0);
  const popoverRef = useRef<HTMLDivElement>(null);

  const filteredSkills = filterSkills(skills, slashMode.query);

  const updateSlashMode = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const pos = textarea.selectionStart;
    const mode = detectSlashMode(value, pos);

    if (mode.active) {
      const coords = getCaretCoordinates(textarea, mode.startIndex);
      const lineHeight = parseInt(
        window.getComputedStyle(textarea).lineHeight || "20",
        10
      );
      setCursorPos({ top: coords.top + lineHeight, left: coords.left });
    }

    setSlashMode((prev) => {
      // Reset selection index when query changes
      if (prev.query !== mode.query) {
        setSelectedIndex(0);
      }
      return mode;
    });
  }, [value]);

  const handleChange = useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      onChange(e.target.value);
    },
    [onChange]
  );

  // Re-detect slash mode when value changes
  useEffect(() => {
    const id = requestAnimationFrame(updateSlashMode);
    return () => cancelAnimationFrame(id);
  }, [value, updateSlashMode]);

  const selectSkill = useCallback(
    (slug: string) => {
      const textarea = textareaRef.current;
      if (!textarea) return;

      const before = value.substring(0, slashMode.startIndex);
      const cursorPosition = textarea.selectionStart;
      const after = value.substring(cursorPosition);
      const replacement = `/${slug} `;
      const newValue = before + replacement + after;

      onChange(newValue);
      setSlashMode({ active: false, startIndex: 0, query: "" });

      // Restore focus and set cursor position after the inserted text
      requestAnimationFrame(() => {
        const newPos = before.length + replacement.length;
        textarea.focus();
        textarea.setSelectionRange(newPos, newPos);
      });
    },
    [value, slashMode.startIndex, onChange]
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (!slashMode.active || filteredSkills.length === 0) return;

      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < filteredSkills.length - 1 ? prev + 1 : 0
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : filteredSkills.length - 1
          );
          break;
        case "Enter":
        case "Tab":
          e.preventDefault();
          selectSkill(filteredSkills[selectedIndex].slug);
          break;
        case "Escape":
          e.preventDefault();
          setSlashMode({ active: false, startIndex: 0, query: "" });
          break;
      }
    },
    [slashMode.active, filteredSkills, selectedIndex, selectSkill]
  );

  // Close popover when clicking outside
  useEffect(() => {
    if (!slashMode.active) return;

    const handleClickOutside = (e: MouseEvent) => {
      const textarea = textareaRef.current;
      const popover = popoverRef.current;
      if (
        textarea &&
        !textarea.contains(e.target as Node) &&
        popover &&
        !popover.contains(e.target as Node)
      ) {
        setSlashMode({ active: false, startIndex: 0, query: "" });
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [slashMode.active]);

  // Handle click/keyboard cursor movement in textarea
  const handleSelect = useCallback(() => {
    updateSlashMode();
  }, [updateSlashMode]);

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onSelect={handleSelect}
        placeholder={placeholder}
        className={cn(
          "flex min-h-[120px] w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
      />
      {slashMode.active && filteredSkills.length > 0 && (
        <div
          ref={popoverRef}
          className="absolute z-50 w-64 rounded-md border bg-popover p-1 shadow-md"
          style={{
            top: cursorPos.top,
            left: cursorPos.left,
          }}
        >
          <Command shouldFilter={false}>
            <CommandList className="max-h-[200px] overflow-y-auto">
              <CommandEmpty>No skills found</CommandEmpty>
              {filteredSkills.map((skill, index) => (
                <CommandItem
                  key={skill.slug}
                  value={skill.slug}
                  data-selected={index === selectedIndex}
                  onSelect={() => selectSkill(skill.slug)}
                  className={cn(
                    "flex flex-col items-start gap-0.5 px-2 py-1.5",
                    index === selectedIndex &&
                      "bg-accent text-accent-foreground"
                  )}
                >
                  <span className="font-medium">/{skill.name}</span>
                  {skill.description && (
                    <span className="text-xs text-muted-foreground truncate w-full">
                      {skill.description}
                    </span>
                  )}
                </CommandItem>
              ))}
            </CommandList>
          </Command>
        </div>
      )}
    </div>
  );
}

export { SlashAutocompleteTextarea };
export type { SlashAutocompleteTextareaProps };
