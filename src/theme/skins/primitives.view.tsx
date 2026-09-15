import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactElement,
  ReactNode,
  SVGAttributes,
} from "react";

export type MyneTextTone = "primary" | "secondary" | "muted";
export type MyneStatus =
  | "accent"
  | "danger"
  | "secondary"
  | "success"
  | "warning";
export type MyneActionTone = "accent" | "danger" | "quiet";
export type MyneIconName = "chevron";

interface MyneTextProps extends HTMLAttributes<HTMLElement> {
  as?: "div" | "p" | "span";
  children?: ReactNode;
  status?: MyneStatus;
  tone?: MyneTextTone;
}

export function MyneText({
  as = "span",
  children,
  status,
  tone = "primary",
  className,
  ...props
}: MyneTextProps) {
  const semanticClassName = status ? `myne-status--${status}` : `myne-text--${tone}`;
  const semanticProps = { className: joinClasses("myne-text", semanticClassName, className) };

  if (as === "div") {
    return (
      <div {...props} {...semanticProps}>
        {children}
      </div>
    );
  }

  if (as === "p") {
    return (
      <p {...props} {...semanticProps}>
        {children}
      </p>
    );
  }

  return (
    <span {...props} {...semanticProps}>
      {children}
    </span>
  );
}

interface MyneHeadingProps extends HTMLAttributes<HTMLHeadingElement> {
  children?: ReactNode;
  level: 1 | 2 | 3 | 4;
  tone?: Exclude<MyneTextTone, "muted">;
}

export function MyneHeading({
  children,
  level,
  tone = "primary",
  className,
  ...props
}: MyneHeadingProps) {
  const semanticProps = { className: joinClasses("myne-heading", `myne-text--${tone}`, className) };

  if (level === 1) {
    return (
      <h1 {...props} {...semanticProps}>
        {children}
      </h1>
    );
  }

  if (level === 2) {
    return (
      <h2 {...props} {...semanticProps}>
        {children}
      </h2>
    );
  }

  if (level === 3) {
    return (
      <h3 {...props} {...semanticProps}>
        {children}
      </h3>
    );
  }

  return (
    <h4 {...props} {...semanticProps}>
      {children}
    </h4>
  );
}

interface MyneActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: MyneActionTone;
}

export function MyneAction({ className, tone, type, ...props }: MyneActionProps) {
  return (
    <button
      {...props}
      className={joinClasses("myne-button", tone && `myne-button--${tone}`, className)}
      type={type ?? "button"}
    />
  );
}

interface MyneBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  status?: MyneStatus;
}

export function MyneBadge({ className, status, ...props }: MyneBadgeProps) {
  return <span {...props} className={joinClasses("myne-badge", status && `myne-status--${status}`, className)} />;
}

type MyneCardProps = HTMLAttributes<HTMLDivElement>;

export function MyneCard({ className, ...props }: MyneCardProps) {
  return <div {...props} className={joinClasses("myne-card", className)} />;
}

type MyneDivRowProps = HTMLAttributes<HTMLDivElement> & { as?: "div" };
type MyneButtonRowProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  as: "button";
};
type MyneRowProps = MyneDivRowProps | MyneButtonRowProps;

export function MyneRow(props: MyneDivRowProps): ReactElement;
export function MyneRow(props: MyneButtonRowProps): ReactElement;
export function MyneRow(props: MyneRowProps): ReactElement {
  if (props.as === "button") {
    const { as: _as, className, type, ...buttonProps } = props;

    return (
      <button
        {...buttonProps}
        className={joinClasses("myne-row", className)}
        type={type ?? "button"}
      />
    );
  }

  const { as: _as, className, ...divProps } = props;

  return <div {...divProps} className={joinClasses("myne-row", className)} />;
}

interface MyneIconProps extends SVGAttributes<SVGSVGElement> {
  children?: ReactNode;
  name: MyneIconName;
}

export function MyneIcon({ children, className, name, ...props }: MyneIconProps) {
  return (
    <svg {...props} className={joinClasses("myne-icon", `myne-icon--${name}`, className)}>
      {children}
    </svg>
  );
}

function joinClasses(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}
