/**
 * One destination in a section's dark bar. The array order is the keyboard map:
 * the first tab is Alt+1, the second Alt+2, and so on.
 */
export interface SectionTab {
  label: string;
  /** Route path relative to the section root, e.g. 'worklist'. */
  link: string;
  /** Count shown beside the label. History never carries one — nothing in it is pending. */
  badge?: number;
  badgeTone?: 'warn' | 'ok';
}
