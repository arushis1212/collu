import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function IconBase({ size = 18, children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      {...props}
    >
      {children}
    </svg>
  );
}

export function PlayIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m9 7 8 5-8 5V7Z" fill="currentColor" stroke="currentColor" strokeLinejoin="round" />
    </IconBase>
  );
}

export function PauseIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M8.5 6.5v11M15.5 6.5v11" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
    </IconBase>
  );
}

export function PreviousIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M7 6.5v11M17 7l-7 5 7 5V7Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function NextIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M17 6.5v11M7 7l7 5-7 5V7Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m6.5 12.5 3.5 3.5 7.5-8" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.9" />
    </IconBase>
  );
}

export function LockIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <rect height="9" rx="2" stroke="currentColor" strokeWidth="1.7" width="13" x="5.5" y="11" />
      <path d="M8.5 11V8a3.5 3.5 0 1 1 7 0v3" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </IconBase>
  );
}

export function BoltIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M13 2 5.5 13H11l-1 9 8-12h-5V2Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function ResetIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4.8 8.7A8 8 0 1 1 4 14" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
      <path d="M4 4v5h5" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function RouteIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="6" cy="17" r="2" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="18" cy="7" r="2" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8 17h3a2 2 0 0 0 2-2v-6a2 2 0 0 1 2-2h1" stroke="currentColor" strokeLinecap="round" strokeWidth="1.7" />
    </IconBase>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3 5 6v5c0 4.5 2.8 8 7 10 4.2-2 7-5.5 7-10V6l-7-3Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
      <path d="m9 12 2 2 4-4" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.7" />
    </IconBase>
  );
}

export function EyeIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 12s3.2-5 9-5 9 5 9 5-3.2 5-9 5-9-5-9-5Z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.7" />
      <circle cx="12" cy="12" r="2.3" stroke="currentColor" strokeWidth="1.7" />
    </IconBase>
  );
}

export function ChevronIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m9 6 6 6-6 6" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
    </IconBase>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="m7 7 10 10M17 7 7 17" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" />
    </IconBase>
  );
}
