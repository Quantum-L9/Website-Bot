// Responsive image attributes. The pipeline emits narrower renditions of each
// re-encoded (source-site or generated) image beside the full-size file; a
// client-provided file is published byte-for-byte and has none, so it renders
// with a plain src. srcset lists every rendition plus the full-size file, so
// the browser can always pick the original width.

export interface ResponsiveImage {
  src: string;
  width: number;
  variants?: ReadonlyArray<{ src: string; width: number }>;
}

/** `srcset` for an image with renditions, else undefined (plain src). */
export function srcsetFor(image: ResponsiveImage): string | undefined {
  const variants = (image.variants ?? []).filter((variant) => variant.width < image.width);
  if (variants.length === 0) return undefined;
  return [...variants, { src: image.src, width: image.width }]
    .sort((left, right) => left.width - right.width)
    .map((entry) => `${entry.src} ${entry.width}w`)
    .join(", ");
}

/** Default grid: minmax(14rem, 1fr) tracks — one, two, then up to four columns. */
const GALLERY_GRID_SIZES = "(min-width: 64rem) 25vw, (min-width: 40rem) 50vw, 100vw";

/**
 * `sizes` for one gallery item, mirroring global.css: from 800px the `mosaic`
 * variant is four columns with the first item spanning two, and the `feature`
 * variant is three columns with the first item spanning the full row. A
 * spanning item advertised at a single column's width would be served a
 * rendition too narrow for it.
 */
export function gallerySizes(variant: string, index: number): string {
  const first = index === 0;
  if (variant === "feature")
    return first ? "100vw" : "(min-width: 800px) 33vw, (min-width: 40rem) 50vw, 100vw";
  if (variant === "mosaic")
    return first
      ? "(min-width: 40rem) 50vw, 100vw"
      : "(min-width: 800px) 25vw, (min-width: 40rem) 50vw, 100vw";
  return GALLERY_GRID_SIZES;
}
