import { pageWindow } from './page-window';

describe('pageWindow', () => {
  it('reads as page 1 of 1 when the list is empty', () => {
    const w = pageWindow(0, 0, 20);
    expect(w.count).toBe(1);
    expect(w.current).toBe(1);
    expect(w.numbers).toEqual([1]);
  });

  it('never offers a page the endpoint does not have', () => {
    // 45 items at 20 per page is three pages, not four.
    const w = pageWindow(45, 0, 20);
    expect(w.count).toBe(3);
    expect(w.numbers).toEqual([1, 2, 3]);
  });

  it('caps the window rather than rendering one button per page', () => {
    expect(pageWindow(800, 0, 20).numbers.length).toBe(5);
  });

  it('slides the window around the current page', () => {
    // Page 10 of 40 — centred.
    expect(pageWindow(800, 9 * 20, 20).numbers).toEqual([8, 9, 10, 11, 12]);
  });

  it('clamps at both ends instead of running off', () => {
    expect(pageWindow(800, 0, 20).numbers).toEqual([1, 2, 3, 4, 5]);
    expect(pageWindow(800, 39 * 20, 20).numbers).toEqual([36, 37, 38, 39, 40]);
  });

  it('reports the current page from the offset', () => {
    expect(pageWindow(100, 40, 20).current).toBe(3);
  });
});
