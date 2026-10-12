/**
 * Layout for simultaneous events in a calendar day column.
 * Intervals are [start, end), so events that only touch at an edge are not overlapping.
 * Connected collision groups are laid out separately; columns are reused where possible.
 */
export interface CalendarInterval {
  id: string;
  start: number;
  end: number;
}

export interface CalendarPlacement {
  leftPercent: number;
  widthPercent: number;
  column: number;
  columns: number;
}

export function layoutOverlappingEvents(events: CalendarInterval[]): Map<string, CalendarPlacement> {
  const ordered = events
    .filter(e => Number.isFinite(e.start) && Number.isFinite(e.end) && e.end > e.start)
    .slice()
    .sort((a, b) => a.start - b.start || b.end - a.end || a.id.localeCompare(b.id));
  const placements = new Map<string, CalendarPlacement>();
  let group: CalendarInterval[] = [];
  let groupEnd = -Infinity;

  const flush = () => {
    if (!group.length) return;
    const columnEnds: number[] = [];
    const assigned: { event: CalendarInterval; column: number }[] = [];
    for (const event of group) {
      let column = columnEnds.findIndex(end => end <= event.start);
      if (column < 0) column = columnEnds.length;
      columnEnds[column] = event.end;
      assigned.push({ event, column });
    }
    const columns = columnEnds.length;
    const baseWidth = 100 / columns;
    // Slight horizontal overlap mimics Google Calendar while keeping every item selectable.
    const overlap = columns === 1 ? 0 : Math.min(6, baseWidth * .16);
    for (const { event, column } of assigned) {
      placements.set(event.id, {
        leftPercent: column * baseWidth,
        widthPercent: baseWidth + (column < columns - 1 ? overlap : 0),
        column,
        columns,
      });
    }
    group = [];
    groupEnd = -Infinity;
  };

  for (const event of ordered) {
    if (group.length && event.start >= groupEnd) flush();
    group.push(event);
    groupEnd = Math.max(groupEnd, event.end);
  }
  flush();
  return placements;
}
