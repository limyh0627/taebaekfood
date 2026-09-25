type TimestampLike = { toDate?: () => Date; seconds?: number; _seconds?: number };

// 오피스톡은 출장이든 해외 기기든 한국 근무일로 읽어야 해서 브라우저 로컬 시간대를 쓰지 않는다.
const kstFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

/** 옛 Firestore Timestamp가 문자열로 이관되지 않은 메시지도 화면에서 읽는다. */
const messageDate = (value: unknown): Date | null => {
  let date: Date;
  if (value instanceof Date) date = value;
  else if (typeof value === 'string') date = new Date(value);
  else if (typeof value === 'number') date = new Date(value);
  else if (value && typeof value === 'object') {
    const stamp = value as TimestampLike;
    if (typeof stamp.toDate === 'function') date = stamp.toDate();
    else if (typeof stamp.seconds === 'number') date = new Date(stamp.seconds * 1000);
    else if (typeof stamp._seconds === 'number') date = new Date(stamp._seconds * 1000);
    else return null;
  } else return null;
  return Number.isFinite(date.getTime()) ? date : null;
};

export const officeTalkSortTime = (value: unknown): number | null => messageDate(value)?.getTime() ?? null;

export const officeTalkStamp = (value: unknown): { day: string; label: string } => {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return { day: value, label: `${value.replace(/-/g, '.')} · 시각 미상` };
  }
  const date = messageDate(value);
  if (!date) return { day: '', label: '날짜·시각 미상' };
  const parts = Object.fromEntries(kstFormatter.formatToParts(date).map(part => [part.type, part.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  return { day, label: `${day.replace(/-/g, '.')} ${parts.hour}:${parts.minute} KST` };
};
