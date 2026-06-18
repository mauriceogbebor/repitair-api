export const COMPOSITION_SCHEMA_VERSION = 1 as const;
export const DEFAULT_TEMPLATE_VERSION = 1 as const;

export type CompositionCoordinateSpace = "points";

export type CompositionCanvasMeta = {
  width: number;
  height: number;
  aspectRatio: string;
  coordinateSpace: CompositionCoordinateSpace;
  backgroundColor?: string | null;
  pixelRatio?: number | null;
};

export type CompositionLayerType =
  | "photo"
  | "sceneAccents"
  | "musicWidget"
  | "lyricsText"
  | "dateText"
  | "dateTime"
  | "text"
  | "sticker"
  | "decor"
  | "decorative"
  | "effect"
  | "watermark"
  | "group";

export type CompositionBindingSource =
  | "photo.background"
  | "song.title"
  | "song.artist"
  | "song.albumArt"
  | "song.platform"
  | "song.durationMs"
  | "song.link"
  | "song.selection"
  | "lyrics.text"
  | "datetime.label"
  | "datetime.dateLine"
  | "datetime.timeLine";

export type CompositionDynamicBinding = {
  source: CompositionBindingSource;
  index?: number;
  fallback?: unknown;
};

export type CompositionLayerEffects = {
  shadow?: Record<string, unknown>;
  blur?: Record<string, unknown>;
  glass?: Record<string, unknown>;
  perspective?: Record<string, unknown>;
  skew?: Record<string, unknown>;
  blend?: Record<string, unknown>;
  background?: Record<string, unknown>;
  borderRadius?: number | Record<string, unknown>;
};

export type CompositionCanvasEffects = {
  backgroundDim?: number;
  gradient?: Record<string, unknown>;
  noise?: Record<string, unknown>;
  vignette?: Record<string, unknown>;
};

export type CompositionLayerFrame = {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  rotation: number;
  opacity: number;
  zIndex: number;
  locked: boolean;
  visible: boolean;
};

export type CompositionLayer = {
  id: string;
  name: string;
  type: CompositionLayerType;
  frame: CompositionLayerFrame;
  interactive: boolean;
  anchor?: "top" | "center" | "bottom" | "left" | "right";
  data: Record<string, unknown>;
  bindings?: Record<string, CompositionDynamicBinding | CompositionDynamicBinding[]>;
  effects?: CompositionLayerEffects;
};

export type BaseComposition = {
  version: typeof COMPOSITION_SCHEMA_VERSION;
  templateId: string;
  templateVersion: number;
  canvasMeta: CompositionCanvasMeta;
  canvasEffects?: CompositionCanvasEffects;
  layers: CompositionLayer[];
};

export type TemplateComposition = BaseComposition;

export type RepitComposition = BaseComposition & {
  source: "template" | "legacy-adapter" | "user-edited";
};
