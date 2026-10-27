import { useId, useState, type ComponentType, type ReactNode } from "react"
import { Button, Card, cn } from "@cognia/plugin-ui"
import { ChevronDownIcon } from "lucide-react"

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
  collapsible = false,
  defaultOpen = true,
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
  collapsible?: boolean
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const contentId = useId()
  const Title = level ?? "h2"
  const heading = (
    <SectionHeading
      icon={icon}
      title={title}
      {...(tone ? { tone } : {})}
      {...(subtitle ? { subtitle } : {})}
      level={collapsible ? "span" : level}
    />
  )
  return (
    <Card className={cn("gap-2.5 px-3 py-2.5", className)} data-testid={testId}>
      <div className="flex items-center gap-2">
        {collapsible ? (
          <Title className="min-w-0 flex-1">
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md text-left focus-visible:outline-2 focus-visible:outline-ring"
              aria-expanded={open}
              aria-controls={contentId}
              onClick={() => setOpen(!open)}
            >
              {heading}
              <ChevronDownIcon
                className={cn(
                  "size-4 shrink-0 text-muted-foreground transition-transform",
                  open && "rotate-180"
                )}
                aria-hidden="true"
              />
            </button>
          </Title>
        ) : (
          heading
        )}
        {action}
      </div>
      {collapsible ? (
        <div id={contentId} hidden={!open} className="space-y-2.5">
          {children}
        </div>
      ) : (
        children
      )}
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
        "h-10 min-w-0 justify-start gap-2 rounded-lg px-2 text-left text-xs font-medium shadow-none transition-[transform,box-shadow,background-color,border-color] duration-150 hover:-translate-y-px hover:shadow-sm active:translate-y-0 active:scale-[0.98] motion-reduce:transform-none motion-reduce:transition-none",
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
      <span className="min-w-0 truncate">{label}</span>
    </Button>
  )
}

/** What is running on the page now, and how to end it. */
export function ActivityStrip({
  children,
  actions,
  testId,
}: {
  children: ReactNode
  actions?: ReactNode
  testId?: string
}) {
  return (
    <div
      className="flex animate-enter flex-wrap items-center gap-2 rounded-lg border border-info/30 bg-info/10 px-2.5 py-2 motion-reduce:animate-none"
      data-testid={testId}
    >
      <div className="flex min-w-0 basis-32 grow items-center gap-2">
        <span className="relative flex size-2 shrink-0" aria-hidden="true">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-info opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-info" />
        </span>
        {children}
      </div>
      {actions ? (
        <div className="ml-auto flex shrink-0 items-center justify-end gap-1.5">{actions}</div>
      ) : null}
    </div>
  )
}

/** Tool controls stay mounted while folded, preserving drafts and results. */
export function ToolSection({
  title,
  hint,
  actions,
  active = false,
  testId,
  children,
}: {
  title: string
  hint: string
  actions?: ReactNode
  active?: boolean
  testId: string
  children?: ReactNode
}) {
  const [open, setOpen] = useState<boolean | null>(null)
  const expanded = open ?? active
  const contentId = useId()
  return (
    <section className="min-w-0 py-2 first:pt-0 last:pb-0" data-testid={testId}>
      <div className="flex min-w-0 items-center gap-2">
        <h3 className="min-w-0 flex-1">
          <button
            type="button"
            className="flex w-full min-w-0 items-center gap-1.5 rounded-md py-1 text-left text-xs font-medium focus-visible:outline-2 focus-visible:outline-ring"
            aria-expanded={expanded}
            aria-controls={contentId}
            title={hint}
            onClick={() => setOpen(!expanded)}
          >
            <ChevronDownIcon
              className={cn(
                "size-3.5 shrink-0 text-muted-foreground transition-transform",
                expanded && "rotate-180"
              )}
              aria-hidden="true"
            />
            <span className="min-w-0 truncate">{title}</span>
          </button>
        </h3>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      <div id={contentId} hidden={!expanded} className="space-y-2 pt-1.5">
        <p className="truncate text-[11px] text-muted-foreground" title={hint}>
          {hint}
        </p>
        {children}
      </div>
    </section>
  )
}
