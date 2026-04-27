import type { CSSProperties } from "react";
import Image from "next/image";
import Link from "next/link";
import { styles as wingStyles } from "@/Wings4u/styles";

type Props = {
  href?: string;
  ariaLabel?: string;
  className?: string;
  style?: CSSProperties;
  wordmarkClassName?: string;
  wordmarkStyle?: CSSProperties;
  imageSize?: number;
  priority?: boolean;
};

export function WingsBrandLockup({
  href = "/",
  ariaLabel = "Go to home",
  className,
  style,
  wordmarkClassName,
  wordmarkStyle,
  imageSize = 52,
  priority = false,
}: Props) {
  return (
    <Link
      href={href}
      aria-label={ariaLabel}
      className={className}
      style={{ textDecoration: "none", ...wingStyles.navLogo, ...style }}
    >
      <Image
        src="/logo.png"
        alt="Wings 4 U"
        height={imageSize}
        width={imageSize}
        priority={priority}
        style={{ objectFit: "contain", cursor: "pointer" }}
      />
      <span style={wordmarkStyle ?? wingStyles.navBrand} className={wordmarkClassName}>
        W
        <span className="nav-brand-wing-i">
          <span className="nav-brand-wing-i__stem">
            <span className="nav-brand-wing-i__dot" aria-hidden="true" />
            <span className="nav-brand-wing-i__glyph">{"\u0131"}</span>
          </span>
        </span>
        NGS <span style={wingStyles.navBrandAccent}>4</span> U
      </span>
    </Link>
  );
}
