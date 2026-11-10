"use client";
import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** A QR code for `value`, drawn as SVG. Always dark on white so every phone camera reads it. */
export function QrCode({ value, size = 220, label }: { value: string; size?: number; label: string }) {
  const [svg, setSvg] = useState("");
  useEffect(() => {
    QRCode.toString(value, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then(setSvg, () => setSvg(""));
  }, [value]);
  return (
    <div className="qr" role="img" aria-label={label} style={{ width: size, height: size }}
      // The SVG comes from the qrcode library, built only from `value`.
      dangerouslySetInnerHTML={{ __html: svg }} />
  );
}
