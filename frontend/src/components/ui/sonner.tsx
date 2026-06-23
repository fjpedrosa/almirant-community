"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      richColors
      closeButton
      expand
      visibleToasts={3}
      toastOptions={{ style: { overflow: "visible" } }}
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--success-bg": "oklch(0.26 0.13 145)",
          "--success-text": "oklch(0.88 0.18 145)",
          "--success-border": "oklch(0.40 0.14 145)",
          "--error-bg": "oklch(0.25 0.13 25)",
          "--error-text": "oklch(0.88 0.18 25)",
          "--error-border": "oklch(0.38 0.14 25)",
          "--warning-bg": "oklch(0.28 0.13 85)",
          "--warning-text": "oklch(0.90 0.18 85)",
          "--warning-border": "oklch(0.42 0.14 85)",
          "--info-bg": "oklch(0.25 0.12 245)",
          "--info-text": "oklch(0.88 0.16 245)",
          "--info-border": "oklch(0.38 0.14 245)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }
