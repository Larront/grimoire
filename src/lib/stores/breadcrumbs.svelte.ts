export interface BreadcrumbSegment {
  label: string;
  href?: string;
}

let segments = $state<BreadcrumbSegment[]>([]);

export const breadcrumbs = {
  get segments() {
    return segments;
  },
  set(newSegments: BreadcrumbSegment[]) {
    segments = newSegments;
  },
  clear() {
    segments = [];
  },
};
