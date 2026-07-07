// ============================================================
// B4Y SuperAPP – <SignedImage>: <img> für private Storage-Buckets
// Löst den gespeicherten Wert (URL/Pfad) zur signierten URL auf (F-02).
// Während des Auflösens wird nichts gerendert (kein Broken-Image-Flash).
// ============================================================
import { ImgHTMLAttributes } from "react";
import { useSignedUrl, StorageBucket } from "../lib/storage";

type Props = Omit<ImgHTMLAttributes<HTMLImageElement>, "src"> & {
  bucket: StorageBucket;
  value: string | null | undefined;
};

export default function SignedImage({ bucket, value, ...img }: Props) {
  const src = useSignedUrl(bucket, value);
  if (!src) return null;
  return <img src={src} {...img} />;
}
