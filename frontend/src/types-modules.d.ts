// Local declarations for packages that ship no types. Narrow, usage-shaped
// stubs — widen only when a new prop/method is consumed.

declare module "react-google-recaptcha" {
  import { Component } from "react";

  export interface ReCAPTCHAProps {
    sitekey: string;
    onChange?: (token: string | null) => void;
    theme?: "light" | "dark";
    size?: "compact" | "normal" | "invisible";
    tabindex?: number;
    style?: React.CSSProperties;
    [key: string]: unknown;
  }

  export default class ReCAPTCHA extends Component<ReCAPTCHAProps> {
    reset(): void;
    getValue(): string | null;
    execute(): Promise<string | null>;
  }
}

declare module "react-highlight-words" {
  import { ComponentType, ReactNode } from "react";

  export interface HighlighterProps {
    highlightClassName?: string;
    searchWords: string[];
    autoEscape?: boolean;
    textToHighlight: string;
    sanitize?: (text: string) => string;
    caseSensitive?: boolean;
    highlightTag?: ComponentType | string;
    unhighlightTag?: ComponentType | string;
    children?: ReactNode;
    [key: string]: unknown;
  }

  const Highlighter: ComponentType<HighlighterProps>;
  export default Highlighter;
}
