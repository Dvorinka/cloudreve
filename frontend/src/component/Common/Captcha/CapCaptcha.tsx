import React, { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useAppSelector } from "../../../redux/hooks.ts";
import { CaptchaParams } from "./Captcha.tsx";
import { Box, useTheme } from "@mui/material";

// Cap Widget URLs. hashwx.wasm ships with @cap.js/wasm 0.0.8+ and must follow
// the same asset source as cap_wasm_bg.wasm (cloudreve/cloudreve#3617).
const CAP_WASM_UNPKG_URL = "https://unpkg.com/@cap.js/wasm/browser/cap_wasm_bg.wasm";
const CAP_WASM_JSDELIVR_URL = "https://cdn.jsdelivr.net/npm/@cap.js/wasm/browser/cap_wasm_bg.wasm";
const CAP_HASHWX_UNPKG_URL = "https://unpkg.com/@cap.js/wasm/browser/hashwx.wasm";
const CAP_HASHWX_JSDELIVR_URL = "https://cdn.jsdelivr.net/npm/@cap.js/wasm/browser/hashwx.wasm";
const CAP_WIDGET_UNPKG_URL = "https://unpkg.com/@cap.js/widget";
const CAP_WIDGET_JSDELIVR_URL = "https://cdn.jsdelivr.net/npm/@cap.js/widget";

export interface CapAssetURLs {
  wasm: string;
  hashwx: string;
  widget: string;
}

// capAssetURLs picks the widget, proof-of-work wasm, and HashWX wasm from the
// same origin. Older Cap instances that do not serve hashwx.wasm fail that
// one request; leaving it on a public CDN would keep a dependency the
// self-hosted setting exists to remove.
export function capAssetURLs(assetServer: string | undefined, instanceURL: string | undefined): CapAssetURLs {
  const base = (instanceURL || "").replace(/\/$/, "");
  if (assetServer === "instance" && base) {
    return {
      wasm: `${base}/assets/cap_wasm_bg.wasm`,
      hashwx: `${base}/assets/hashwx.wasm`,
      widget: `${base}/assets/widget.js`,
    };
  }
  if (assetServer === "unpkg") {
    return {
      wasm: CAP_WASM_UNPKG_URL,
      hashwx: CAP_HASHWX_UNPKG_URL,
      widget: CAP_WIDGET_UNPKG_URL,
    };
  }
  return {
    wasm: CAP_WASM_JSDELIVR_URL,
    hashwx: CAP_HASHWX_JSDELIVR_URL,
    widget: CAP_WIDGET_JSDELIVR_URL,
  };
}

export interface CapProps {
  onStateChange: (state: CaptchaParams) => void;
  generation: number;
}

// Standard input height
const STANDARD_INPUT_HEIGHT = "56px";

const CapCaptcha = ({ onStateChange, generation, fullWidth, ...rest }: CapProps & { fullWidth?: boolean }) => {
  const captchaRef = useRef<HTMLDivElement>(null);
  const widgetRef = useRef<any>(null);
  const onStateChangeRef = useRef(onStateChange);
  const scriptLoadedRef = useRef(false);
  const theme = useTheme();
  const { t } = useTranslation("common");

  const capInstanceURL = useAppSelector((state) => state.siteConfig.basic.config.captcha_cap_instance_url);
  const capSiteKey = useAppSelector((state) => state.siteConfig.basic.config.captcha_cap_site_key);
  const capAssetServer = useAppSelector((state) => state.siteConfig.basic.config.captcha_cap_asset_server);

  // Keep callback reference up to date
  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  // Apply responsive styles for fullWidth mode
  const applyFullWidthStyles = (widget: HTMLElement) => {
    const applyStyles = () => {
      // Style widget container
      widget.style.width = "100%";
      widget.style.display = "block";
      widget.style.boxSizing = "border-box";

      // Style internal captcha element
      const captchaElement = widget.shadowRoot?.querySelector(".captcha") || widget.querySelector(".captcha");
      if (captchaElement) {
        const captchaEl = captchaElement as HTMLElement;
        captchaEl.style.width = "100%";
        captchaEl.style.maxWidth = "none";
        captchaEl.style.minWidth = "0";
        captchaEl.style.boxSizing = "border-box";
        return true;
      }
      return false;
    };

    // Apply immediately or wait for DOM changes
    if (!applyStyles()) {
      const observer = new MutationObserver(() => {
        if (applyStyles()) {
          observer.disconnect();
        }
      });

      observer.observe(widget, {
        childList: true,
        subtree: true,
        attributes: true,
      });

      // Fallback timeout
      setTimeout(() => {
        applyStyles();
        observer.disconnect();
      }, 500);
    }
  };

  const createWidget = () => {
    if (!captchaRef.current || !capInstanceURL || !capSiteKey) {
      return;
    }

    // Clean up existing widget
    if (widgetRef.current) {
      widgetRef.current.remove?.();
      widgetRef.current = null;
    }

    // Clear container
    captchaRef.current.innerHTML = "";

    if (typeof window !== "undefined" && (window as any).Cap) {
      const widget = document.createElement("cap-widget");

      // Cap 2.0 API format: {instanceURL}/{siteKey}/
      const apiEndpoint = `${capInstanceURL.replace(/\/$/, "")}/${capSiteKey}/`;
      widget.setAttribute("data-cap-api-endpoint", apiEndpoint);
      widget.id = "cap-widget";

      // Set internationalization attributes (Cap official i18n format)
      widget.setAttribute("data-cap-i18n-initial-state", t("captcha.cap.human"));
      widget.setAttribute("data-cap-i18n-verifying-label", t("captcha.cap.verifying"));
      widget.setAttribute("data-cap-i18n-solved-label", t("captcha.cap.verified"));

      captchaRef.current.appendChild(widget);

      widget.addEventListener("solve", (e: any) => {
        const token = e.detail.token;
        if (token) {
          onStateChangeRef.current({ ticket: token });
        }
      });

      // Apply fullWidth styles if needed
      if (fullWidth) {
        applyFullWidthStyles(widget);
      }

      widgetRef.current = widget;
    }
  };

  useEffect(() => {
    if (generation > 0) {
      createWidget();
    }
  }, [generation, t]);

  useEffect(() => {
    if (!capInstanceURL || !capSiteKey) {
      return;
    }

    // Set both wasm URLs before the widget script loads. The widget reads
    // CAP_CUSTOM_HASHWX_URL for the HashWX proof-of-work module and otherwise
    // falls back to jsDelivr (cloudreve/cloudreve#3617).
    const assets = capAssetURLs(capAssetServer, capInstanceURL);
    (window as any).CAP_CUSTOM_WASM_URL = assets.wasm;
    (window as any).CAP_CUSTOM_HASHWX_URL = assets.hashwx;

    const scriptId = "cap-widget-script";
    let script = document.getElementById(scriptId) as HTMLScriptElement;

    const initWidget = () => {
      scriptLoadedRef.current = true;

      // Add a small delay to ensure DOM is ready
      setTimeout(() => {
        createWidget();
      }, 100);
    };

    if (!script) {
      script = document.createElement("script");
      script.id = scriptId;

      script.src = assets.widget;
      script.async = true;
      script.onload = initWidget;
      script.onerror = () => {
        if (capAssetServer === "instance") {
          console.error("Failed to load Cap widget script from instance server");
        } else if (capAssetServer === "unpkg") {
          console.error("Failed to load Cap widget script from unpkg CDN");
        } else {
          console.error("Failed to load Cap widget script from jsDelivr CDN");
        }
      };
      document.head.appendChild(script);
    } else if (scriptLoadedRef.current || (window as any).Cap) {
      // Script already loaded
      initWidget();
    } else {
      // Script exists but not loaded yet
      script.onload = initWidget;
    }

    return () => {
      // Cleanup widget (keep script for reuse)
      if (widgetRef.current) {
        widgetRef.current.remove?.();
        widgetRef.current = null;
      }
      if (captchaRef.current) {
        captchaRef.current.innerHTML = "";
      }
    };
  }, [capInstanceURL, capSiteKey, capAssetServer, t]);

  if (!capInstanceURL || !capSiteKey) {
    return null;
  }

  return (
    <Box
      sx={{
        // Container full width when needed
        ...(fullWidth && { width: "100%" }),

        // CSS variables for Cloudreve theme adaptation
        "& cap-widget": {
          "--cap-border-radius": `${theme.shape.borderRadius}px`,
          "--cap-background": theme.palette.background.paper,
          "--cap-border-color": theme.palette.divider,
          "--cap-color": theme.palette.text.primary,
          "--cap-widget-height": fullWidth ? STANDARD_INPUT_HEIGHT : "auto",
          "--cap-widget-padding": "16px",
          "--cap-gap": "12px",
          "--cap-checkbox-size": "20px",
          "--cap-checkbox-border-radius": "4px",
          "--cap-checkbox-background": theme.palette.action.hover,
          "--cap-checkbox-border": `1px solid ${theme.palette.divider}`,
          "--cap-font": String(theme.typography.fontFamily || "Roboto, sans-serif"),
          "--cap-spinner-color": theme.palette.primary.main,
          "--cap-spinner-background-color": theme.palette.action.hover,
          "--cap-credits-font-size": String(theme.typography.caption.fontSize || "12px"),
          "--cap-opacity-hover": "0.7",
        } as React.CSSProperties,
      }}
    >
      <div ref={captchaRef} {...rest} />
    </Box>
  );
};

export default CapCaptcha;
