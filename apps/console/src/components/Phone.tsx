import Image from "next/image";

/**
 * A screenshot in a phone-like frame. The screenshots are small PNGs already
 * sized for the page, so they are served as they are (images are unoptimised
 * in a static export).
 */
export function Phone({
  src,
  alt,
  width,
  height,
  priority = false,
  className = "",
}: {
  src: string;
  alt: string;
  width: number;
  height: number;
  priority?: boolean;
  className?: string;
}) {
  return (
    <div
      className={`border-espresso bg-espresso shadow-phone overflow-hidden rounded-[1.4rem] border-[5px] ${className}`}
    >
      <Image
        src={src}
        alt={alt}
        width={width}
        height={height}
        priority={priority}
        sizes={`${width}px`}
        className="block h-auto w-full rounded-[1rem]"
      />
    </div>
  );
}
