/** First letter of up to the first two words of a name, uppercased — for an Avatar's `initials` fallback when there's no image. */
export function initialsFor(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}
