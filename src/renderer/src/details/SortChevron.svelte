<script lang="ts">
  /** Small sort-direction chevron for table headers. */
  let { dir }: { dir: 1 | -1 } = $props()
</script>

<svg class="dp-sort" viewBox="0 0 8 8" aria-hidden="true"
  ><path
    d={dir === 1 ? 'M1.5 5.25 4 2.75l2.5 2.5' : 'M1.5 2.75 4 5.25l2.5-2.5'}
    fill="none"
    stroke="currentColor"
    stroke-width="1.4"
    stroke-linecap="round"
    stroke-linejoin="round"
  /></svg
>
