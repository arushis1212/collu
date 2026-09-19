"use client";

import {
  createContext,
  forwardRef,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ComponentPropsWithoutRef,
  type ElementRef,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { CloseIcon, PanelLeftIcon } from "../Icons";

const MOBILE_QUERY = "(max-width: 767px)";
const SIDEBAR_SHORTCUT = "b";

type SidebarState = "expanded" | "collapsed";

type SidebarContextValue = {
  isMobile: boolean;
  mobileOpen: boolean;
  open: boolean;
  setMobileOpen: (value: boolean | ((current: boolean) => boolean)) => void;
  setOpen: (value: boolean | ((current: boolean) => boolean)) => void;
  sidebarId: string;
  state: SidebarState;
  toggleSidebar: () => void;
};

const SidebarContext = createContext<SidebarContextValue | null>(null);

function classes(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

export function useSidebar() {
  const value = useContext(SidebarContext);
  if (!value) {
    throw new Error("useSidebar must be used inside SidebarProvider.");
  }
  return value;
}

export type SidebarProviderProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  defaultMobileOpen?: boolean;
  defaultOpen?: boolean;
  mobileOpen?: boolean;
  onMobileOpenChange?: (open: boolean) => void;
  onOpenChange?: (open: boolean) => void;
  open?: boolean;
};

export function SidebarProvider({
  children,
  className,
  defaultMobileOpen = false,
  defaultOpen = true,
  mobileOpen: controlledMobileOpen,
  onMobileOpenChange,
  onOpenChange,
  open: controlledOpen,
  style,
  ...props
}: SidebarProviderProps) {
  const isMobile = useMediaQuery(MOBILE_QUERY);
  const generatedId = useId();
  const sidebarId = `security-sidebar-${generatedId.replace(/:/g, "")}`;
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const [internalMobileOpen, setInternalMobileOpen] = useState(defaultMobileOpen);
  const open = controlledOpen ?? internalOpen;
  const mobileOpen = controlledMobileOpen ?? internalMobileOpen;

  const setOpen = useCallback<SidebarContextValue["setOpen"]>(
    (next) => {
      const resolved = typeof next === "function" ? next(open) : next;
      if (controlledOpen === undefined) setInternalOpen(resolved);
      onOpenChange?.(resolved);
    },
    [controlledOpen, onOpenChange, open],
  );

  const setMobileOpen = useCallback<SidebarContextValue["setMobileOpen"]>(
    (next) => {
      const resolved = typeof next === "function" ? next(mobileOpen) : next;
      if (controlledMobileOpen === undefined) setInternalMobileOpen(resolved);
      onMobileOpenChange?.(resolved);
    },
    [controlledMobileOpen, mobileOpen, onMobileOpenChange],
  );

  const toggleSidebar = useCallback(() => {
    if (isMobile) setMobileOpen((current) => !current);
    else setOpen((current) => !current);
  }, [isMobile, setMobileOpen, setOpen]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && isMobile && mobileOpen) {
        event.preventDefault();
        setMobileOpen(false);
        return;
      }

      if (
        event.key.toLowerCase() === SIDEBAR_SHORTCUT
        && (event.metaKey || event.ctrlKey)
        && !event.altKey
      ) {
        event.preventDefault();
        toggleSidebar();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isMobile, mobileOpen, setMobileOpen, toggleSidebar]);

  useEffect(() => {
    if (!isMobile && mobileOpen) setMobileOpen(false);
  }, [isMobile, mobileOpen, setMobileOpen]);

  const value = useMemo<SidebarContextValue>(
    () => ({
      isMobile,
      mobileOpen,
      open,
      setMobileOpen,
      setOpen,
      sidebarId,
      state: open ? "expanded" : "collapsed",
      toggleSidebar,
    }),
    [isMobile, mobileOpen, open, setMobileOpen, setOpen, sidebarId, toggleSidebar],
  );

  return (
    <SidebarContext.Provider value={value}>
      <div
        className={classes("sidebar-wrapper", className)}
        data-mobile={isMobile ? "true" : "false"}
        data-slot="sidebar-wrapper"
        data-state={isMobile ? (mobileOpen ? "expanded" : "collapsed") : value.state}
        style={style as CSSProperties}
        {...props}
      >
        {children}
      </div>
    </SidebarContext.Provider>
  );
}

export type SidebarProps = ComponentPropsWithoutRef<"aside"> & {
  collapsible?: "offcanvas" | "icon" | "none";
  side?: "left" | "right";
};

export const Sidebar = forwardRef<ElementRef<"aside">, SidebarProps>(function Sidebar(
  {
    children,
    className,
    collapsible = "icon",
    side = "left",
    ...props
  },
  ref,
) {
  const { isMobile, mobileOpen, open, setMobileOpen, sidebarId, state } = useSidebar();
  const visible = isMobile ? mobileOpen : open || collapsible !== "offcanvas";
  const renderedState = isMobile ? (mobileOpen ? "expanded" : "collapsed") : state;

  return (
    <>
      {isMobile && mobileOpen && (
        <button
          aria-label="Close sidebar"
          className="sidebar-backdrop"
          data-slot="sidebar-backdrop"
          onClick={() => setMobileOpen(false)}
          type="button"
        />
      )}
      <aside
        aria-hidden={!visible}
        aria-modal={isMobile && mobileOpen ? true : undefined}
        className={classes("sidebar", className)}
        data-collapsible={collapsible}
        data-mobile={isMobile ? "true" : "false"}
        data-side={side}
        data-slot="sidebar"
        data-state={renderedState}
        id={sidebarId}
        inert={!visible ? true : undefined}
        ref={ref}
        role={isMobile ? "dialog" : undefined}
        {...props}
      >
        <div className="sidebar-surface" data-slot="sidebar-surface">
          {children}
        </div>
      </aside>
    </>
  );
});

export const SidebarTrigger = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function SidebarTrigger({ className, onClick, title, ...props }, ref) {
    const { isMobile, mobileOpen, open, sidebarId, toggleSidebar } = useSidebar();
    const expanded = isMobile ? mobileOpen : open;

    return (
      <button
        aria-controls={sidebarId}
        aria-expanded={expanded}
        aria-label={expanded ? "Collapse sidebar" : "Expand sidebar"}
        className={classes("sidebar-trigger", className)}
        data-slot="sidebar-trigger"
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) toggleSidebar();
        }}
        ref={ref}
        title={title ?? `${expanded ? "Collapse" : "Expand"} sidebar (Ctrl/Command+B)`}
        type="button"
        {...props}
      >
        <PanelLeftIcon size={18} />
      </button>
    );
  },
);

export const SidebarClose = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function SidebarClose({ className, onClick, ...props }, ref) {
    const { setMobileOpen } = useSidebar();
    return (
      <button
        aria-label="Close sidebar"
        className={classes("sidebar-close", className)}
        data-slot="sidebar-close"
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) setMobileOpen(false);
        }}
        ref={ref}
        type="button"
        {...props}
      >
        <CloseIcon size={18} />
      </button>
    );
  },
);

export const SidebarRail = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function SidebarRail({ className, onClick, ...props }, ref) {
    const { open, toggleSidebar } = useSidebar();
    return (
      <button
        aria-label={open ? "Collapse sidebar" : "Expand sidebar"}
        className={classes("sidebar-rail", className)}
        data-slot="sidebar-rail"
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) toggleSidebar();
        }}
        ref={ref}
        tabIndex={-1}
        title={open ? "Collapse sidebar" : "Expand sidebar"}
        type="button"
        {...props}
      />
    );
  },
);

export const SidebarInset = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function SidebarInset({ className, ...props }, ref) {
    return (
      <div
        className={classes("sidebar-inset", className)}
        data-slot="sidebar-inset"
        ref={ref}
        {...props}
      />
    );
  },
);

function sidebarPart(name: string, baseClass: string) {
  return forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(function SidebarPart(
    { className, ...props },
    ref,
  ) {
    return (
      <div
        className={classes(baseClass, className)}
        data-slot={name}
        ref={ref}
        {...props}
      />
    );
  });
}

export const SidebarHeader = sidebarPart("sidebar-header", "sidebar-header");
export const SidebarContent = sidebarPart("sidebar-content", "sidebar-content");
export const SidebarFooter = sidebarPart("sidebar-footer", "sidebar-footer");
export const SidebarGroup = sidebarPart("sidebar-group", "sidebar-group");

export const SidebarGroupLabel = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  function SidebarGroupLabel({ className, ...props }, ref) {
    return (
      <div
        className={classes("sidebar-group-label", className)}
        data-slot="sidebar-group-label"
        ref={ref}
        {...props}
      />
    );
  },
);

export const SidebarSeparator = forwardRef<HTMLHRElement, ComponentPropsWithoutRef<"hr">>(
  function SidebarSeparator({ className, ...props }, ref) {
    return (
      <hr
        className={classes("sidebar-separator", className)}
        data-slot="sidebar-separator"
        ref={ref}
        {...props}
      />
    );
  },
);
