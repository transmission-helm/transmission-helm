<script lang="ts" module>
  /**
   * 16x16 stroke icons drawn with currentColor on a 16px grid: 1.5px stroke, round caps and
   * joins, ~1.75px optical padding. Hand-written, no icon font. Small dots are drawn as tiny
   * circles so they keep the same stroke weight as everything else.
   */
  const DOT = (x: number, y: number): string => `M${x - 0.5} ${y}a.5.5 0 101 0a.5.5 0 10-1 0`

  export const ICONS = {
    addFile: 'M4 1.75h4.75L12 5v9.25H4z M8.75 1.75V5H12 M8 7.25v4.5 M5.75 9.5h4.5',
    link: 'M6.75 9.25l2.5-2.5 M7.25 4.75l1-1a2.47 2.47 0 013.5 3.5l-1 1 M8.75 11.25l-1 1a2.47 2.47 0 01-3.5-3.5l1-1',
    plus: 'M8 3.25v9.5 M3.25 8h9.5',
    play: 'M5 3.25v9.5L12.5 8z',
    pause: 'M5.75 3.5v9 M10.25 3.5v9',
    trash:
      'M2.75 4.5h10.5 M6.25 4.5V2.75h3.5V4.5 M4.25 4.5l.75 9.25h6l.75-9.25 M6.75 7v4.25 M9.25 7v4.25',
    sliders:
      'M2 4.5h3 M8 4.5h6 M2 11.5h7 M12 11.5h2 M6.5 4.5m-1.5 0a1.5 1.5 0 103 0a1.5 1.5 0 10-3 0 M10.5 11.5m-1.5 0a1.5 1.5 0 103 0a1.5 1.5 0 10-3 0',
    gauge: 'M2.25 11.5a5.75 5.75 0 1111.5 0 M8 11.5l2.75-3.75 ' + DOT(8, 11.5),
    queueUp: 'M8 13.5v-10 M4 7.5l4-4 4 4',
    queueDown: 'M8 2.5v10 M4 8.5l4 4 4-4',
    server: 'M2.5 2.75h11v4.5h-11z M2.5 8.75h11v4.5h-11z ' + DOT(5, 5) + ' ' + DOT(5, 11),
    chevronDown: 'M4.5 6.25L8 9.75l3.5-3.5',
    chevronRight: 'M6.25 4.5L9.75 8l-3.5 3.5',
    search: 'M7 7m-4.5 0a4.5 4.5 0 109 0a4.5 4.5 0 10-9 0 M10.25 10.25l3.5 3.5',
    magnifier: 'M7 7m-4.5 0a4.5 4.5 0 109 0a4.5 4.5 0 10-9 0 M10.25 10.25l3.5 3.5',
    close: 'M4.5 4.5l7 7 M11.5 4.5l-7 7',
    arrowDown: 'M8 2.5v10.5 M4 9l4 4 4-4',
    arrowUp: 'M8 13.5V3 M4 7l4-4 4 4',
    check: 'M3 8.5l3.25 3.25L13 5',
    warning: 'M8 1.75l6.5 11.75h-13z M8 6.25v3.25 ' + DOT(8, 11.5),
    clock: 'M8 8m-6 0a6 6 0 1012 0a6 6 0 10-12 0 M8 4.5V8l2.5 1.5',
    more: DOT(3.5, 8) + ' ' + DOT(8, 8) + ' ' + DOT(12.5, 8),
    dot: 'M8 8m-3 0a3 3 0 106 0a3 3 0 10-6 0',
    folder: 'M1.75 4a1 1 0 011-1h3.5l1.5 1.75h5.5a1 1 0 011 1v6.5a1 1 0 01-1 1H2.75a1 1 0 01-1-1z',
    tag: 'M1.75 2.75a1 1 0 011-1h4.5l7 7-5.5 5.5-7-7z ' + DOT(5, 5),
    globe:
      'M8 8m-6.25 0a6.25 6.25 0 1012.5 0a6.25 6.25 0 10-12.5 0 M1.75 8h12.5 M8 1.75c-2.25 2.5-2.25 10 0 12.5 M8 1.75c2.25 2.5 2.25 10 0 12.5',
    moon: 'M13 9.75A5.75 5.75 0 016.25 3a5.75 5.75 0 106.75 6.75z',
    plug: 'M5.5 1.75v3 M10.5 1.75v3 M3.5 4.75h9V8a4.5 4.5 0 01-9 0z M8 12.5v1.75',
    inbox:
      'M1.75 9l2-6.25h8.5l2 6.25v3.25a1 1 0 01-1 1H2.75a1 1 0 01-1-1z M1.75 9h3.5l1 1.75h3.5l1-1.75h3.5',
    transfer: 'M5 2.5v11 M2.5 11l2.5 2.5 2.5-2.5 M11 13.5v-11 M8.5 5L11 2.5 13.5 5',
    activity: 'M1.75 8.5h2.5l2-5 3.5 9 2-4h2.5',
    list:
      'M5.75 4h7.5 M5.75 8h7.5 M5.75 12h7.5 ' +
      DOT(2.75, 4) +
      ' ' +
      DOT(2.75, 8) +
      ' ' +
      DOT(2.75, 12),
    rows: 'M2.5 3.25h11 M2.5 6.25h11 M2.5 9.25h11 M2.5 12.25h11',
    sun: 'M8 8m-2.75 0a2.75 2.75 0 105.5 0a2.75 2.75 0 10-5.5 0 M8 1.5v1.25 M8 13.25v1.25 M1.5 8h1.25 M13.25 8h1.25 M3.4 3.4l.9.9 M11.7 11.7l.9.9 M3.4 12.6l.9-.9 M11.7 4.3l.9-.9',
    contrast: 'M8 8m-6 0a6 6 0 1012 0a6 6 0 10-12 0 M8 2v12 M8 4.75h4.5 M8 8h6 M8 11.25h4.5',
    wheel:
      'M8 8m-4.25 0a4.25 4.25 0 108.5 0a4.25 4.25 0 10-8.5 0 M8 8m-1.25 0a1.25 1.25 0 102.5 0a1.25 1.25 0 10-2.5 0 M8 1v5.75 M8 9.25V15 M1 8h5.75 M9.25 8H15 M3.05 3.05l4.07 4.07 M8.88 8.88l4.07 4.07 M3.05 12.95l4.07-4.07 M8.88 7.12l4.07-4.07',
    refresh:
      'M13.75 8a5.75 5.75 0 11-5.75-5.75c1.6 0 3.15.64 4.3 1.75l1.45 1.45 M13.75 2.25v3.25H10.5'
  } as const

  export type IconName = keyof typeof ICONS

  /** Icons that read as solid shapes rather than outlines. */
  const SOLID: ReadonlySet<IconName> = new Set<IconName>(['dot'])

  export function isSolid(name: IconName): boolean {
    return SOLID.has(name)
  }
</script>

<script lang="ts">
  let {
    name,
    size = 16,
    filled = false
  }: { name: IconName; size?: number; filled?: boolean } = $props()

  let solid = $derived(filled || isSolid(name))
</script>

<svg
  class="icon"
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill={solid ? 'currentColor' : 'none'}
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={ICONS[name]} />
</svg>

<style>
  .icon {
    flex: none;
    display: block;
  }
</style>
