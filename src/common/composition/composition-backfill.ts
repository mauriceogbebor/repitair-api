import { Repit } from "../../entities/repit.entity";
import { Template } from "../../entities/template.entity";
import type {
  CompositionCanvasMeta,
  CompositionLayer,
  RepitComposition,
  TemplateComposition,
} from "./composition.types";
import {
  COMPOSITION_SCHEMA_VERSION,
  DEFAULT_TEMPLATE_VERSION,
} from "./composition.types";
import {
  DEFAULT_CANVAS_META,
  normalizeCanvasMeta,
  sanitizeRepitComposition,
  sanitizeTemplateComposition,
} from "./composition.utils";

type BackfillPayload<TComposition> = {
  templateVersion: number;
  canvasMeta: CompositionCanvasMeta;
  composition: TComposition;
};

function createBaseCanvasMeta(meta?: CompositionCanvasMeta | null) {
  return normalizeCanvasMeta(meta, DEFAULT_CANVAS_META) ?? DEFAULT_CANVAS_META;
}

function createFullCanvasPhotoLayer(canvasMeta: CompositionCanvasMeta): CompositionLayer {
  return {
    id: "photo-background",
    name: "Photo Background",
    type: "photo",
    interactive: true,
    anchor: "center",
    frame: {
      x: 0,
      y: 0,
      width: canvasMeta.width,
      height: canvasMeta.height,
      scale: 1,
      rotation: 0,
      opacity: 1,
      zIndex: 0,
      locked: false,
      visible: true,
    },
    data: {
      fit: "cover",
    },
    bindings: {
      uri: {
        source: "photo.background",
      },
    },
  };
}

function createFallbackMusicWidgetLayer(
  canvasMeta: CompositionCanvasMeta,
  index = 0,
  total = 1,
): CompositionLayer {
  const width = canvasMeta.width * 0.72;
  const height = Math.max(180, canvasMeta.height * 0.16);
  const step = total > 1 ? Math.min(140, canvasMeta.height * 0.08) : 0;
  const centerX = (canvasMeta.width - width) / 2;
  const baseY = canvasMeta.height * 0.58;

  return {
    id: `music-widget-${index + 1}`,
    name: `Music Widget ${index + 1}`,
    type: "musicWidget",
    interactive: true,
    anchor: "center",
    frame: {
      x: centerX + (index % 2 === 0 ? -18 : 18),
      y: baseY + (index * step),
      width,
      height,
      scale: 1,
      rotation: index % 2 === 0 ? -3 : 3,
      opacity: 1,
      zIndex: 20 + index,
      locked: false,
      visible: true,
    },
    data: {
      variant: total > 1 ? "stacked" : "default",
      songIndex: index,
    },
    bindings: {
      title: { source: "song.title", fallback: "Untitled track" },
      artist: { source: "song.artist", fallback: "Unknown artist" },
      albumArtUrl: { source: "song.albumArt" },
      platform: { source: "song.platform", fallback: "spotify" },
      durationMs: { source: "song.durationMs" },
      songLink: { source: "song.link" },
      selection: total > 1
        ? { source: "song.selection", index }
        : { source: "song.selection", fallback: [] },
    },
    effects: {
      glass: {
        enabled: true,
        opacity: 0.18,
        blur: 18,
      },
      shadow: {
        color: "#000000",
        offsetX: 0,
        offsetY: 24,
        radius: 34,
        opacity: 0.24,
      },
      borderRadius: 30,
      background: {
        color: "#121212",
        opacity: 0.42,
      },
    },
  };
}

function createLyricsLayer(canvasMeta: CompositionCanvasMeta): CompositionLayer {
  return {
    id: "lyrics-text",
    name: "Lyrics",
    type: "lyricsText",
    interactive: true,
    anchor: "center",
    frame: {
      x: canvasMeta.width * 0.12,
      y: canvasMeta.height * 0.18,
      width: canvasMeta.width * 0.76,
      height: canvasMeta.height * 0.2,
      scale: 1,
      rotation: 0,
      opacity: 1,
      zIndex: 30,
      locked: false,
      visible: true,
    },
    data: {
      align: "center",
      maxLines: 5,
    },
    bindings: {
      text: {
        source: "lyrics.text",
        fallback: "",
      },
    },
  };
}

function createDateTimeLayer(canvasMeta: CompositionCanvasMeta): CompositionLayer {
  return {
    id: "datetime-text",
    name: "Date Time",
    type: "dateTime",
    interactive: true,
    anchor: "top",
    frame: {
      x: canvasMeta.width * 0.12,
      y: canvasMeta.height * 0.08,
      width: canvasMeta.width * 0.76,
      height: 72,
      scale: 1,
      rotation: 0,
      opacity: 1,
      zIndex: 10,
      locked: false,
      visible: true,
    },
    data: {
      align: "center",
    },
    bindings: {
      label: {
        source: "datetime.label",
        fallback: "",
      },
      dateLine: {
        source: "datetime.dateLine",
        fallback: "",
      },
      timeLine: {
        source: "datetime.timeLine",
        fallback: "",
      },
    },
  };
}

function buildMinimalTemplateComposition(template: Template): TemplateComposition {
  const canvasMeta = createBaseCanvasMeta(template.canvasMeta);

  return {
    version: COMPOSITION_SCHEMA_VERSION,
    templateId: template.id,
    templateVersion: template.templateVersion ?? DEFAULT_TEMPLATE_VERSION,
    canvasMeta,
    canvasEffects: {
      backgroundDim: Math.max(0, Math.min(1, template.overlayOpacity ?? 0.3)),
      gradient: {
        enabled: true,
        color: "#000000",
        opacity: Math.max(0.18, Math.min(0.6, template.overlayOpacity ?? 0.3)),
      },
    },
    layers: [
      createFullCanvasPhotoLayer(canvasMeta),
      createFallbackMusicWidgetLayer(canvasMeta),
    ],
  };
}

function buildMinimalRepitComposition(repit: Repit): RepitComposition {
  const canvasMeta = createBaseCanvasMeta(repit.canvasMeta);
  const selectionCount = Array.isArray(repit.selectedSongs) && repit.selectedSongs.length > 0
    ? repit.selectedSongs.length
    : 1;
  const layers: CompositionLayer[] = [
    createFullCanvasPhotoLayer(canvasMeta),
    ...Array.from({ length: Math.min(selectionCount, 6) }, (_, index) =>
      createFallbackMusicWidgetLayer(canvasMeta, index, selectionCount)),
  ];

  if (repit.editorState?.lyrics) {
    layers.push(createLyricsLayer(canvasMeta));
  }

  if (repit.editorState?.showDate || repit.editorState?.showTime || repit.editorState?.showDay) {
    layers.push(createDateTimeLayer(canvasMeta));
  }

  return {
    version: COMPOSITION_SCHEMA_VERSION,
    templateId: repit.templateId,
    templateVersion: repit.templateVersion ?? DEFAULT_TEMPLATE_VERSION,
    canvasMeta,
    canvasEffects: repit.editorState?.compositionEffects && typeof repit.editorState.compositionEffects === "object"
      ? repit.editorState.compositionEffects as Record<string, unknown>
      : undefined,
    source: "legacy-adapter",
    layers,
  };
}

function cloneTemplateCompositionAsRepit(composition: TemplateComposition): RepitComposition {
  return {
    ...JSON.parse(JSON.stringify(composition)),
    source: "legacy-adapter",
  } as RepitComposition;
}

export function buildTemplateCompositionBackfillPayload(
  template: Template,
): BackfillPayload<TemplateComposition> | null {
  const existing = sanitizeTemplateComposition(template.composition, {
    context: "template.backfill",
    templateId: template.id,
    templateVersion: template.templateVersion,
    fallbackCanvasMeta: createBaseCanvasMeta(template.canvasMeta),
  });

  if (existing) {
    return null;
  }

  const composition = buildMinimalTemplateComposition(template);
  return {
    templateVersion: template.templateVersion ?? composition.templateVersion,
    canvasMeta: createBaseCanvasMeta(template.canvasMeta ?? composition.canvasMeta),
    composition,
  };
}

export function buildRepitCompositionBackfillPayload(
  repit: Repit,
  template?: Template | null,
): BackfillPayload<RepitComposition> | null {
  const existing = sanitizeRepitComposition(repit.composition, {
    context: "repit.backfill",
    templateId: repit.templateId,
    templateVersion: repit.templateVersion,
    fallbackCanvasMeta: createBaseCanvasMeta(repit.canvasMeta),
  });

  if (existing) {
    return null;
  }

  const templateComposition = template
    ? sanitizeTemplateComposition(template.composition, {
      context: "template.backfill",
      templateId: template.id,
      templateVersion: template.templateVersion,
      fallbackCanvasMeta: createBaseCanvasMeta(template.canvasMeta),
    })
    : null;

  const composition = templateComposition
    ? cloneTemplateCompositionAsRepit(templateComposition)
    : buildMinimalRepitComposition(repit);

  return {
    templateVersion: repit.templateVersion ?? composition.templateVersion,
    canvasMeta: createBaseCanvasMeta(repit.canvasMeta ?? composition.canvasMeta),
    composition,
  };
}
