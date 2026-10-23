import {
  BookOpen,
  Building2,
  Bus,
  Coffee,
  DoorOpen,
  Dumbbell,
  GraduationCap,
  House,
  Landmark,
  SquareParking,
  type LucideIcon,
} from 'lucide-react';
import type { Destination, DestinationKind, FilterCategory } from '../types';

export const KIND_ICONS: Record<DestinationKind, LucideIcon> = {
  building: Building2,
  room: DoorOpen,
  cafe: Coffee,
  'study-space': BookOpen,
  sports: Dumbbell,
  'bus-stop': Bus,
  'car-park': SquareParking,
  landmark: Landmark,
};

export const KIND_LABELS: Record<DestinationKind, string> = {
  building: 'Building',
  room: 'Room',
  cafe: 'Café',
  'study-space': 'Study space',
  sports: 'Sports',
  'bus-stop': 'Bus stop',
  'car-park': 'Car park',
  landmark: 'Landmark',
};

export const CATEGORY_ICONS: Record<FilterCategory, LucideIcon> = {
  teaching: GraduationCap,
  food: Coffee,
  study: BookOpen,
  sports: Dumbbell,
  accommodation: House,
  transport: Bus,
};

/** "Cottrell Building · Floor 2", or the kind for outdoor places. */
export function destinationSubtitle(d: Destination): string {
  const parts: string[] = [];
  if (d.kind !== 'building') parts.push(KIND_LABELS[d.kind]);
  if (d.buildingName && d.kind !== 'building') parts.push(d.buildingName);
  if (d.floorName) parts.push(d.floorName);
  if (d.kind === 'building') parts.push('Building');
  return parts.join(' · ');
}
