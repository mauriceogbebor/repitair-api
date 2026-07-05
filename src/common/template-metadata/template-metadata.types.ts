/**
 * Template-First Metadata Types (Backend)
 *
 * Canonical source: @repitair/template-core/types
 *
 * These types are structurally identical to the shared package.
 * The backend defines them locally because NestJS's rootDir constraint
 * prevents importing from outside src/. TypeScript's structural typing
 * ensures interoperability. Keep in sync with template-core/src/types.ts.
 *
 * Sprint D: Template Authoring Studio
 * Sprint F: Shared Template Core Extraction
 */

/* ── Layer Edit Permissions ─────────────────────────────────────── */

export type LayerEditPermissions = {
  canMove?: boolean;
  canResize?: boolean;
  canRotate?: boolean;
  canDelete?: boolean;
  canDuplicate?: boolean;
  canEditContent?: boolean;
  canEditStyle?: boolean;
  canEditOpacity?: boolean;
  canToggleVisibility?: boolean;
  canReorder?: boolean;
};

/* ── Template Editor Mode ───────────────────────────────────────── */

export type TemplateEditorMode = "content-first" | "full-editor";

/* ── Template Capabilities ──────────────────────────────────────── */

export type TemplateCapabilities = {
  editorMode?: TemplateEditorMode;
  singleSong?: boolean;
  multiSong?: boolean;
  maxSongs?: number;
  supportsLyrics?: boolean;
  supportsManualLyrics?: boolean;
  supportsDate?: boolean;
  supportsPhoto?: boolean;
  supportsAspectRatios?: string[];
  supportsWidgetMovement?: boolean;
  supportsVideo?: boolean;
  supportsDecorativeLayers?: boolean;
  supportsCrop?: boolean;
  maxPhotos?: number;
};

/* ── Template Design Tokens ─────────────────────────────────────── */

export type TemplateDesignTokens = {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  widgetAccent?: string;
  lyricsPrimary?: string;
  lyricsSecondary?: string;
  shadowColor?: string;
  glowColor?: string;
  backgroundAccent?: string;
  radius?: number;
  spacing?: number;
};

/* ── Template Constraints ───────────────────────────────────────── */

export type TemplateConstraints = {
  preferredAspectRatio?: string;
  preferredOrientation?: "portrait" | "landscape";
  maxSongs?: number;
  minPhotoResolution?: { width: number; height: number };
  maxLyricsLength?: number;
  photoBrightnessRecommendation?: "dark" | "medium" | "light" | "any";
  faceSafeArea?: { x: number; y: number; width: number; height: number };
  photoSafeArea?: { x: number; y: number; width: number; height: number };
};

/* ── Designer Notes ─────────────────────────────────────────────── */

export type TemplateDesignerNotes = {
  author?: string;
  creativeIntent?: string;
  mood?: string;
  inspiration?: string;
  bestUseCases?: string;
  restrictions?: string;
  recommendedPhotoStyle?: string;
  recommendedMusicStyle?: string;
  internalComments?: string;
  description?: string;
  photographyGuidance?: string;
  bestWith?: string;
  tags?: string[];
};

/* ── Workflow Configuration ─────────────────────────────────────── */

export type WorkflowStepType = "photo" | "song" | "playlist" | "lyrics" | "date";

export type WorkflowStepConfig = {
  type: WorkflowStepType;
  label: string;
  description: string;
  icon?: string;
  actionLabel?: string;
};

export type TemplateWorkflowConfig = {
  steps: WorkflowStepConfig[];
  completionMessage?: string;
};

/* ── Certification Metadata ─────────────────────────────────────── */

export type TemplateCertificationStatus =
  | "draft"
  | "designer-review"
  | "qa-review"
  | "product-review"
  | "approved"
  | "certified"
  | "published"
  | "archived";

export type TemplateCertificationMeta = {
  status?: TemplateCertificationStatus;
  assignedReviewer?: string;
  reviewNotes?: string;
  certifiedAt?: string;
  certifiedBy?: string;
  lastReviewedAt?: string;
  lastReviewedBy?: string;
};
