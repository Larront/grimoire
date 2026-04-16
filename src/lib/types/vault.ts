export interface FileNode {
  name: string;
  path: string;
  is_dir: boolean;
  note_id: number | null;
  map_id: number | null;
  children: FileNode[];
}

export interface Note {
  id: number;
  path: string;
  title: string;
  icon: string | null;
  cover_image: string | null;
  parent_path: string | null;
  archived: number;
  modified_at: string;
}

export interface Map {
  id: number;
  title: string;
  image_path: string | null;
  image_width: number | null;
  image_height: number | null;
  created_at: string;
  modified_at: string;
}

export type PinShape = 'circle' | 'pin' | 'diamond' | 'headstone' | 'shield' | 'banner';

export type PinIcon =
  | 'star' | 'sword' | 'shield' | 'crown' | 'skull' | 'house'
  | 'anchor' | 'flame' | 'eye' | 'scroll' | 'footprints' | 'castle'
  | 'gem' | 'cross' | 'flag' | 'tree-pine';

export interface PinCategory {
  id: number;
  map_id: number | null;
  name: string;
  icon: PinIcon;
  color: string;
  shape: PinShape;
}

export interface Pin {
  id: number;
  map_id: number;
  x: number;
  y: number;
  title: string;
  description: string | null;
  category_id: number | null;
  note_id: number | null;
  created_at: string;
  shape: PinShape | null;
  icon: PinIcon | null;
  color: string | null;
}

export interface Scene {
  id: number;
  name: string;
  favorited: number;
  created_at: string;
}

export interface SceneWithCount {
  id: number;
  name: string;
  favorited: number;
  created_at: string;
  slot_count: number;
}

export interface SceneSlot {
  id: number;
  scene_id: number;
  source: string;
  source_id: string;
  label: string;
  volume: number;
  loop: boolean;
  slot_order: number;
  shuffle: number;
}

export interface SpotifyAuthStatus {
  is_connected: boolean;
  expires_at: string;
}
