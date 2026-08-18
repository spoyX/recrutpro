/**
 * The page numbers a numbered pager should show.
 *
 * Pure arithmetic over what the list endpoints already return — `total` from
 * the server, `offset` and `limit` from the request that produced it. Nothing
 * here invents a page: `pageCount` is the server's own total divided by the
 * page size the request asked for, so a rendered number is always a page the
 * endpoint will actually serve.
 *
 * Shared by /candidates and /interviews, which page identically. It is a
 * function rather than a base class on purpose — the two components have
 * nothing else in common, and inheritance would tie them together to share
 * three lines of division.
 */
export interface PageWindow {
  /** Total pages, at least 1 so an empty list still reads as "page 1 of 1". */
  count: number;
  /** The 1-based page currently shown. */
  current: number;
  /** At most `size` consecutive page numbers, sliding around `current`. */
  numbers: number[];
}

export function pageWindow(
  total: number,
  offset: number,
  pageSize: number,
  size = 5,
): PageWindow {
  const count = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.floor(offset / pageSize) + 1;
  // A 40-page result must not render 40 buttons, and the window must not run
  // off either end: clamp the start to [1, count - width + 1].
  const width = Math.min(size, count);
  const start = Math.max(1, Math.min(current - Math.floor(width / 2), count - width + 1));
  return {
    count,
    current,
    numbers: Array.from({ length: width }, (_, i) => start + i),
  };
}
