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
