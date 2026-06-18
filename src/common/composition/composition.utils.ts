import { BadRequestException } from "@nestjs/common";

import {
  COMPOSITION_SCHEMA_VERSION,
  DEFAULT_TEMPLATE_VERSION,
  type CompositionCanvasMeta,
  type CompositionLayer,
  type CompositionLayerEffects,
  type RepitComposition,
  type TemplateComposition,
} from "./composition.types";

type CompositionKind = "repit" | "template";

type ValidateOptions = {
  kind: CompositionKind;
  context: string;
  templateId?: string | null;
  templateVersion?: number | null;
  fallbackCanvasMeta?: CompositionCanvasMeta | null;
};

type NormalizeEntityStateArgs = {
  templateVersion?: number | null;
  canvasMeta?: Record<string, unknown> | CompositionCanvasMeta | null;
  composition?: Record<string, unknown> | RepitComposition | TemplateComposition | null;
};

export const DEFAULT_CANVAS_META: CompositionCanvasMeta = {
  width: 1000,
  height: 1778,
  aspectRatio: "9:16",
  coordinateSpace: "points",
  backgroundColor: "#03170b",
  pixelRatio: null,
};

const SUPPORTED_LAYER_TYPES = new Set<CompositionLayer["type"]>([
  "photo",
  "sceneAccents",
  "musicWidget",
  "lyricsText",
  "dateText",
  "dateTime",
  "text",
  "sticker",
  "decor",
  "decorative",
  "effect",
  "watermark",
  "group",
]);

const VALID_ANCHORS = new Set<NonNullable<CompositionLayer["anchor"]>>([
  "top",
  "center",
  "bottom",
  "left",
  "right",
]);

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function normalizeCanvasMeta(
  raw: unknown,
  fallback: CompositionCanvasMeta | null = DEFAULT_CANVAS_META,
): CompositionCanvasMeta | null {
  if (!isRecord(raw) && !fallback) return null;
  const source = isRecord(raw) ? raw : {};

  const width = Math.max(1, Math.round(toNumber(source.width, fallback?.width ?? DEFAULT_CANVAS_META.width)));
  const height = Math.max(1, Math.round(toNumber(source.height, fallback?.height ?? DEFAULT_CANVAS_META.height)));
  const aspectRatio = typeof source.aspectRatio === "string"
    ? source.aspectRatio
    : (fallback?.aspectRatio ?? DEFAULT_CANVAS_META.aspectRatio);

  return {
    width,
    height,
    aspectRatio,
    coordinateSpace: "points",
    backgroundColor: typeof source.backgroundColor === "string"
      ? source.backgroundColor
      : (fallback?.backgroundColor ?? DEFAULT_CANVAS_META.backgroundColor),
    pixelRatio: typeof source.pixelRatio === "number"
      ? source.pixelRatio
      : (fallback?.pixelRatio ?? DEFAULT_CANVAS_META.pixelRatio),
  };
}

export function assertCanvasMeta(raw: unknown, context: string): CompositionCanvasMeta {
  if (!isRecord(raw)) {
    throw new BadRequestException(`${context} must be an object`);
  }

  if (typeof raw.width !== "number" || !Number.isFinite(raw.width) || raw.width <= 0) {
    throw new BadRequestException(`${context}.width must be a positive number`);
  }

  if (typeof raw.height !== "number" || !Number.isFinite(raw.height) || raw.height <= 0) {
    throw new BadRequestException(`${context}.height must be a positive number`);
  }

  if (typeof raw.aspectRatio !== "string" || !raw.aspectRatio.trim()) {
    throw new BadRequestException(`${context}.aspectRatio must be a non-empty string`);
  }

  return normalizeCanvasMeta(raw, DEFAULT_CANVAS_META) ?? DEFAULT_CANVAS_META;
}

function normalizeEffects(raw: unknown): CompositionLayerEffects | undefined {
  if (!isRecord(raw)) return undefined;
  return raw as CompositionLayerEffects;
}

function normalizeLayer(layer: unknown, index: number): CompositionLayer | null {
  if (!isRecord(layer)) return null;

  const type = layer.type;
  if (typeof type !== "string" || !SUPPORTED_LAYER_TYPES.has(type as CompositionLayer["type"])) {
    return null;
  }

  const rawFrame = isRecord(layer.frame) ? layer.frame : {};
  const width = Math.max(1, toNumber(rawFrame.width, 200));
  const height = Math.max(1, toNumber(rawFrame.height, 120));

  return {
    id: typeof layer.id === "string" && layer.id.trim() ? layer.id : `layer-${index + 1}`,
    name: typeof layer.name === "string" && layer.name.trim() ? layer.name : `${type}-${index + 1}`,
    type: type as CompositionLayer["type"],
    interactive: typeof layer.interactive === "boolean" ? layer.interactive : !["sceneAccents", "watermark"].includes(type),
    anchor: typeof layer.anchor === "string" && VALID_ANCHORS.has(layer.anchor as NonNullable<CompositionLayer["anchor"]>)
      ? (layer.anchor as NonNullable<CompositionLayer["anchor"]>)
      : "center",
    frame: {
      x: toNumber(rawFrame.x, 0),
      y: toNumber(rawFrame.y, 0),
      width,
      height,
      scale: clamp(toNumber(rawFrame.scale, 1), 0.1, 12),
      rotation: toNumber(rawFrame.rotation, 0),
      opacity: clamp(toNumber(rawFrame.opacity, 1), 0, 1),
      zIndex: Math.max(0, Math.round(toNumber(rawFrame.zIndex, index))),
      locked: Boolean(rawFrame.locked),
      visible: rawFrame.visible !== false,
    },
    data: isRecord(layer.data) ? layer.data : {},
    bindings: isRecord(layer.bindings)
      ? layer.bindings as CompositionLayer["bindings"]
      : undefined,
    effects: normalizeEffects(layer.effects),
  };
}

export function sanitizeTemplateComposition(
  raw: unknown,
  options: Omit<ValidateOptions, "kind">,
): TemplateComposition | null {
  return sanitizeComposition(raw, { ...options, kind: "template" }) as TemplateComposition | null;
}

export function sanitizeRepitComposition(
  raw: unknown,
  options: Omit<ValidateOptions, "kind">,
): RepitComposition | null {
  return sanitizeComposition(raw, { ...options, kind: "repit" }) as RepitComposition | null;
}

function sanitizeComposition(
  raw: unknown,
  options: ValidateOptions,
): TemplateComposition | RepitComposition | null {
  if (!isRecord(raw)) {
    return null;
  }

  const fallbackCanvasMeta = normalizeCanvasMeta(options.fallbackCanvasMeta, DEFAULT_CANVAS_META);
  const canvasMeta = normalizeCanvasMeta(raw.canvasMeta, fallbackCanvasMeta);
  if (!canvasMeta) {
    return null;
  }

  const layers = Array.isArray(raw.layers)
    ? raw.layers.map((layer, index) => normalizeLayer(layer, index)).filter(Boolean) as CompositionLayer[]
    : [];

  if (layers.length === 0) {
    return null;
  }

  const templateId = typeof raw.templateId === "string" && raw.templateId.trim()
    ? raw.templateId
    : (options.templateId ?? "");

  if (!templateId) {
    return null;
  }

  const templateVersion = Math.max(
    DEFAULT_TEMPLATE_VERSION,
    Math.round(toNumber(raw.templateVersion, options.templateVersion ?? DEFAULT_TEMPLATE_VERSION)),
  );

  const base = {
    version: COMPOSITION_SCHEMA_VERSION,
    templateId,
    templateVersion,
    canvasMeta,
    canvasEffects: isRecord(raw.canvasEffects) ? raw.canvasEffects : undefined,
    layers,
  };

  if (options.kind === "repit") {
    const source = raw.source === "template" || raw.source === "legacy-adapter" || raw.source === "user-edited"
      ? raw.source
      : "legacy-adapter";
    return { ...base, source } satisfies RepitComposition;
  }

  return base satisfies TemplateComposition;
}

export function assertTemplateComposition(
  raw: unknown,
  options: Omit<ValidateOptions, "kind">,
): TemplateComposition {
  const composition = sanitizeTemplateComposition(raw, options);
  if (!composition) {
    throw new BadRequestException(`${options.context} must be a valid template composition payload`);
  }
  if (options.templateId && composition.templateId !== options.templateId) {
    throw new BadRequestException(`${options.context}.templateId must match "${options.templateId}"`);
  }
  if (
    typeof options.templateVersion === "number"
    && Number.isFinite(options.templateVersion)
    && composition.templateVersion !== options.templateVersion
  ) {
    throw new BadRequestException(`${options.context}.templateVersion must match ${options.templateVersion}`);
  }
  return composition;
}

export function assertRepitComposition(
  raw: unknown,
  options: Omit<ValidateOptions, "kind">,
): RepitComposition {
  const composition = sanitizeRepitComposition(raw, options);
  if (!composition) {
    throw new BadRequestException(`${options.context} must be a valid repit composition payload`);
  }
  if (options.templateId && composition.templateId !== options.templateId) {
    throw new BadRequestException(`${options.context}.templateId must match "${options.templateId}"`);
  }
  if (
    typeof options.templateVersion === "number"
    && Number.isFinite(options.templateVersion)
    && composition.templateVersion !== options.templateVersion
  ) {
    throw new BadRequestException(`${options.context}.templateVersion must match ${options.templateVersion}`);
  }
  return composition;
}

export function normalizeTemplateState<T extends NormalizeEntityStateArgs>(
  value: T,
): T & {
  templateVersion: number;
  canvasMeta: CompositionCanvasMeta;
  composition: TemplateComposition | null;
} {
  const composition = sanitizeTemplateComposition(value.composition, {
    context: "template.composition",
    templateId: typeof value.composition === "object" && value.composition
      ? (value.composition as { templateId?: string }).templateId ?? null
      : null,
    templateVersion: value.templateVersion ?? DEFAULT_TEMPLATE_VERSION,
    fallbackCanvasMeta: normalizeCanvasMeta(value.canvasMeta, DEFAULT_CANVAS_META),
  });

  const templateVersion = composition?.templateVersion
    ?? (typeof value.templateVersion === "number" && Number.isFinite(value.templateVersion)
      ? value.templateVersion
      : DEFAULT_TEMPLATE_VERSION);

  const canvasMeta = composition?.canvasMeta
    ?? normalizeCanvasMeta(value.canvasMeta, DEFAULT_CANVAS_META)
    ?? DEFAULT_CANVAS_META;

  return {
    ...value,
    templateVersion,
    canvasMeta,
    composition,
  };
}

export function normalizeRepitState<T extends NormalizeEntityStateArgs>(
  value: T,
): T & {
  templateVersion: number;
  canvasMeta: CompositionCanvasMeta | null;
  composition: RepitComposition | null;
} {
  const composition = sanitizeRepitComposition(value.composition, {
    context: "repit.composition",
    templateId: typeof value.composition === "object" && value.composition
      ? (value.composition as { templateId?: string }).templateId ?? null
      : null,
    templateVersion: value.templateVersion ?? DEFAULT_TEMPLATE_VERSION,
    fallbackCanvasMeta: normalizeCanvasMeta(value.canvasMeta, DEFAULT_CANVAS_META),
  });

  const templateVersion = composition?.templateVersion
    ?? (typeof value.templateVersion === "number" && Number.isFinite(value.templateVersion)
      ? value.templateVersion
      : DEFAULT_TEMPLATE_VERSION);

  const canvasMeta = composition?.canvasMeta
    ?? normalizeCanvasMeta(value.canvasMeta, null)
    ?? null;

  return {
    ...value,
    templateVersion,
    canvasMeta,
    composition,
  };
}
