import { cn } from '@/lib/utils'

/**
 * Renders any SVG as a single-color (currentColor) silhouette using a CSS mask.
 */
export function MaskIcon({
  src,
  label,
  className,
}: {
  src: string
  label: string
  className?: string
}) {
  return (
    <span
      role="img"
      aria-label={label}
      className={cn('inline-block bg-current', className)}
      style={{
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
        WebkitMaskRepeat: 'no-repeat',
        maskRepeat: 'no-repeat',
        WebkitMaskPosition: 'center',
        maskPosition: 'center',
        WebkitMaskSize: 'contain',
        maskSize: 'contain',
      }}
    />
  )
}
