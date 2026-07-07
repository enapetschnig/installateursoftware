import logoFull from "../assets/logo-full.png";
import logoIcon from "../assets/logo-icon.png";
import { useCompanyLogo } from "../lib/company";
import { APP_NAME } from "../lib/branding";

// Beide Komponenten ziehen automatisch das in den Firmeneinstellungen
// hochgeladene Logo. Solange keins hochgeladen ist (oder noch lädt),
// wird das mitgelieferte App-Logo als Fallback angezeigt.

export function LogoMark({ size = 40 }: { size?: number }) {
  const { iconLogoUrl } = useCompanyLogo();
  return (
    <img src={iconLogoUrl || logoIcon} width={size} height={size} alt={APP_NAME}
      style={{ borderRadius: Math.round(size * 0.22), display: "block" }} />
  );
}

export function LogoFull({ height = 56 }: { height?: number }) {
  const { logoUrl } = useCompanyLogo();
  return (
    <img src={logoUrl || logoFull} alt={APP_NAME}
      style={{ height, width: "auto", display: "block" }} />
  );
}
