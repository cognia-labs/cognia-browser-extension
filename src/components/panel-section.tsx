import type { ComponentType, ReactNode } from "react"
import { Button, Card, cn } from "@cognia/plugin-ui"

/**
 * The panel's building blocks: a card for each part of it, headed by an icon,
 * a title and a line saying what the part is for; and the tiles the inspect
 * tools sit on. Colours come from the Host's palette — `info`, `success` and
 * `warning` — so a custom theme recolours them with everything else.
 */

export type SectionTone = "neutral" | "info" | "success" | "warning"

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean | "true" }>

const TONES: Record<SectionTone, string> = {
  neutral: "bg-muted text-foreground",
  info: "bg-info/12 text-info",
  success: "bg-success/12 text-success",
  warning: "bg-warning/15 text-warning",
}

export function SectionIcon({
  icon: IconComponent,
  tone = "neutral",
  className,
}: {
  icon: Icon
  tone?: SectionTone
  className?: string
}) {
  return (
    <span
      className={cn(
        "flex size-7 shrink-0 items-center justify-center rounded-lg",
        TONES[tone],
        className
      )}
    >
      <IconComponent className="size-4" aria-hidden="true" />
    </span>
  )
}

/** An icon, a title and what the part is for: a card's heading, or a collapsible's trigger. */
export function SectionHeading({
  icon,
  tone,
  title,
  subtitle,
  level = "h2",
}: {
  icon: Icon
  tone?: SectionTone
  title: ReactNode
  subtitle?: ReactNode
  level?: "h1" | "h2" | "span"
}) {
  const Title = level
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2.5 text-left">
      <SectionIcon icon={icon} {...(tone ? { tone } : {})} />
      <span className="flex min-w-0 flex-1 flex-col">
        <Title className="text-sm leading-tight font-semibold text-foreground">{title}</Title>
        {subtitle ? (
          <span className="truncate text-[11px] leading-snug font-normal text-muted-foreground">
            {subtitle}
          </span>
        ) : null}
      </span>
    </span>
  )
}

/** The look of a collapsible section's trigger: the whole heading is the button. */
export const SECTION_TRIGGER_CLASS =
  "h-auto w-full justify-between gap-2 rounded-xl px-3 py-2.5 whitespace-normal hover:bg-accent/60"

export function PanelSection({
  icon,
  tone,
  title,
  subtitle,
  action,
  level,
  children,
  className,
  testId,
}: {
  icon: Icon
  tone?: SectionTone
  title: ReactNode
  subtitle?: ReactNode
  /** Beside the heading, such as a button that acts on the whole section. */
  action?: ReactNode
  level?: "h1" | "h2"
  children?: ReactNode
  className?: string
  testId?: string
}) {
  return (
    <Card className={cn("gap-3 px-3 py-3", className)} data-testid={testId}>
      <div className="flex items-center gap-2">
        <SectionHeading
          icon={icon}
          title={title}
          {...(tone ? { tone } : {})}
          {...(subtitle ? { subtitle } : {})}
          {...(level ? { level } : {})}
        />
        {action}
      </div>
      {children}
    </Card>
  )
}

/** A card whose body opens and closes under a heading that is its trigger. */
export function CollapsibleCard({ children }: { children: ReactNode }) {
  return <Card className="gap-0 py-0">{children}</Card>
}

/** One of the inspect tools: an icon over its name, pressed while it runs. */
export function ToolTile({
  icon,
  tone,
  label,
  hint,
  pressed = false,
  disabled = false,
  onClick,
  testId,
}: {
  icon: Icon
  tone?: SectionTone
  label: string
  hint?: string
  pressed?: boolean
  disabled?: boolean
  onClick: () => void
  testId: string
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className={cn(
        "h-auto min-h-16 flex-col items-start justify-between gap-2 rounded-xl px-2.5 py-2.5 text-left text-xs font-medium whitespace-normal shadow-none transition-[transform,box-shadow,background-color,border-color] duration-150 hover:-translate-y-px hover:shadow-sm active:translate-y-0 active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none",
        // Running reads as on, not as unavailable, though it cannot start twice.
        pressed && "border-info/50 bg-info/10 ring-1 ring-info/20 disabled:opacity-100"
      )}
      aria-pressed={pressed}
      disabled={disabled}
      title={hint}
      onClick={onClick}
      data-testid={testId}
    >
      <SectionIcon icon={icon} {...(tone ? { tone } : {})} />
      {label}
    </Button>
  )
}

/** What is running on the page now, and how to end it. */
export function ActivityStrip({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div
      className="flex animate-enter flex-wrap items-center gap-2 rounded-lg border border-info/30 bg-info/10 px-2.5 py-2 motion-reduce:animate-none"
      data-testid={testId}
    >
      <span className="relative flex size-2 shrink-0" aria-hidden="true">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-info opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-info" />
      </span>
      {children}
    </div>
  )
}
