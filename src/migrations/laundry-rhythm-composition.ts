// Generated from the mobile Laundry Rhythm authored preset. Keep in sync when editing its layers.
export const laundryRhythmComposition = {
  "version": 1,
  "templateId": "laundry-rhythm",
  "templateVersion": 1,
  "canvasMeta": {
    "width": 1000,
    "height": 1778,
    "aspectRatio": "9:16",
    "coordinateSpace": "points",
    "backgroundColor": "#03170b"
  },
  "canvasEffects": {
    "backgroundDim": 0,
    "gradient": {
      "enabled": false,
      "color": "#000000",
      "opacity": 0.5
    },
    "noise": {
      "enabled": false,
      "opacity": 0.15
    },
    "vignette": {
      "enabled": false,
      "intensity": 0.6
    }
  },
  "layers": [
    {
      "id": "photo",
      "name": "Photo",
      "type": "photo",
      "frame": {
        "x": 0,
        "y": 0,
        "width": 1000,
        "height": 1778,
        "scale": 1,
        "rotation": 0,
        "opacity": 1,
        "zIndex": 1,
        "locked": true,
        "visible": true
      },
      "interactive": false,
      "anchor": "center",
      "data": {
        "uri": null,
        "displayMode": "fill",
        "photoStyle": "fullbleed",
        "overlayOpacity": 0.2,
        "songInfoPosition": "center"
      },
      "bindings": {
        "uri": {
          "source": "photo.background"
        }
      },
      "editPermissions": {
        "canMove": false,
        "canResize": false,
        "canRotate": false,
        "canDelete": false,
        "canDuplicate": false,
        "canEditContent": true,
        "canEditStyle": false,
        "canEditOpacity": false,
        "canToggleVisibility": false,
        "canReorder": false
      }
    },
    {
      "id": "widget-laundry-rhythm-primary",
      "name": "Music Widget 1",
      "type": "musicWidget",
      "frame": {
        "x": 0,
        "y": 0,
        "width": 820,
        "height": 420,
        "scale": 1,
        "rotation": 0,
        "opacity": 1,
        "zIndex": 18,
        "locked": false,
        "visible": true
      },
      "interactive": true,
      "anchor": "center",
      "data": {
        "playerVariant": "laundryRhythm",
        "presentationStyle": "default",
        "frameSize": {
          "width": 820,
          "height": 420
        },
        "songIndex": 0,
        "widgetTransforms": [],
        "songTitle": "Blinding Lights",
        "artistName": "The Weeknd",
        "platform": "spotify",
        "durationMs": 200000,
        "progressFraction": 0.5,
        "albumArtUrl": null,
        "accentColor": "#1ED760",
        "songs": [
          {
            "songTitle": "Blinding Lights",
            "artistName": "The Weeknd",
            "albumArtUrl": null,
            "platform": "spotify",
            "durationMs": 200000,
            "songLink": null,
            "isExplicit": null,
            "progressFraction": null
          },
          {
            "songTitle": "Starboy",
            "artistName": "The Weeknd",
            "albumArtUrl": null,
            "platform": "spotify",
            "durationMs": 230000,
            "songLink": null,
            "isExplicit": null,
            "progressFraction": null
          },
          {
            "songTitle": "After Hours",
            "artistName": "The Weeknd",
            "albumArtUrl": null,
            "platform": "spotify",
            "durationMs": 241000,
            "songLink": null,
            "isExplicit": null,
            "progressFraction": null
          },
          {
            "songTitle": "Die For You",
            "artistName": "The Weeknd",
            "albumArtUrl": null,
            "platform": "spotify",
            "durationMs": 256000,
            "songLink": null,
            "isExplicit": null,
            "progressFraction": null
          },
          {
            "songTitle": "Save Your Tears",
            "artistName": "The Weeknd",
            "albumArtUrl": null,
            "platform": "spotify",
            "durationMs": 215000,
            "songLink": null,
            "isExplicit": null,
            "progressFraction": null
          },
          {
            "songTitle": "Less Than Zero",
            "artistName": "The Weeknd",
            "albumArtUrl": null,
            "platform": "spotify",
            "durationMs": 211000,
            "songLink": null,
            "isExplicit": null,
            "progressFraction": null
          },
          {
            "songTitle": "Take My Breath",
            "artistName": "The Weeknd",
            "albumArtUrl": null,
            "platform": "spotify",
            "durationMs": 221000,
            "songLink": null,
            "isExplicit": null,
            "progressFraction": null
          },
          {
            "songTitle": "In Your Eyes",
            "artistName": "The Weeknd",
            "albumArtUrl": null,
            "platform": "spotify",
            "durationMs": 237000,
            "songLink": null,
            "isExplicit": null,
            "progressFraction": null
          }
        ]
      },
      "bindings": {
        "songTitle": {
          "source": "song.title",
          "index": 0,
          "fallback": "Blinding Lights"
        },
        "artistName": {
          "source": "song.artist",
          "index": 0,
          "fallback": "The Weeknd"
        },
        "albumArtUrl": {
          "source": "song.albumArt",
          "index": 0,
          "fallback": null
        },
        "platform": {
          "source": "song.platform",
          "index": 0,
          "fallback": "spotify"
        },
        "durationMs": {
          "source": "song.durationMs",
          "index": 0,
          "fallback": 200000
        },
        "songLink": {
          "source": "song.link",
          "index": 0,
          "fallback": null
        },
        "songs": {
          "source": "song.selection",
          "fallback": [
            {
              "songTitle": "Blinding Lights",
              "artistName": "The Weeknd",
              "albumArtUrl": null,
              "platform": "spotify",
              "durationMs": 200000,
              "songLink": null,
              "isExplicit": null,
              "progressFraction": null
            },
            {
              "songTitle": "Starboy",
              "artistName": "The Weeknd",
              "albumArtUrl": null,
              "platform": "spotify",
              "durationMs": 230000,
              "songLink": null,
              "isExplicit": null,
              "progressFraction": null
            },
            {
              "songTitle": "After Hours",
              "artistName": "The Weeknd",
              "albumArtUrl": null,
              "platform": "spotify",
              "durationMs": 241000,
              "songLink": null,
              "isExplicit": null,
              "progressFraction": null
            },
            {
              "songTitle": "Die For You",
              "artistName": "The Weeknd",
              "albumArtUrl": null,
              "platform": "spotify",
              "durationMs": 256000,
              "songLink": null,
              "isExplicit": null,
              "progressFraction": null
            },
            {
              "songTitle": "Save Your Tears",
              "artistName": "The Weeknd",
              "albumArtUrl": null,
              "platform": "spotify",
              "durationMs": 215000,
              "songLink": null,
              "isExplicit": null,
              "progressFraction": null
            },
            {
              "songTitle": "Less Than Zero",
              "artistName": "The Weeknd",
              "albumArtUrl": null,
              "platform": "spotify",
              "durationMs": 211000,
              "songLink": null,
              "isExplicit": null,
              "progressFraction": null
            },
            {
              "songTitle": "Take My Breath",
              "artistName": "The Weeknd",
              "albumArtUrl": null,
              "platform": "spotify",
              "durationMs": 221000,
              "songLink": null,
              "isExplicit": null,
              "progressFraction": null
            },
            {
              "songTitle": "In Your Eyes",
              "artistName": "The Weeknd",
              "albumArtUrl": null,
              "platform": "spotify",
              "durationMs": 237000,
              "songLink": null,
              "isExplicit": null,
              "progressFraction": null
            }
          ]
        }
      },
      "effects": {
        "shadow": {
          "color": "#000000",
          "offsetX": 0,
          "offsetY": 2,
          "radius": 8,
          "opacity": 0.3
        },
        "glass": {
          "enabled": false,
          "opacity": 0,
          "blur": 0,
          "highlightOpacity": 0
        },
        "borderRadius": 0
      },
      "editPermissions": {
        "canMove": true,
        "canResize": false,
        "canRotate": false,
        "canDelete": false,
        "canDuplicate": false,
        "canEditContent": false,
        "canEditStyle": false,
        "canEditOpacity": false,
        "canToggleVisibility": false,
        "canReorder": false
      }
    },
    {
      "id": "watermark",
      "name": "Watermark",
      "type": "watermark",
      "frame": {
        "x": -348,
        "y": -94,
        "width": 184,
        "height": 50,
        "scale": 1,
        "rotation": 0,
        "opacity": 1,
        "zIndex": 40,
        "locked": true,
        "visible": true
      },
      "interactive": false,
      "anchor": "bottom",
      "data": {
        "text": "Made with Repitair"
      },
      "editPermissions": {
        "canMove": false,
        "canResize": false,
        "canRotate": false,
        "canDelete": false,
        "canDuplicate": false,
        "canEditContent": false,
        "canEditStyle": false,
        "canEditOpacity": false,
        "canToggleVisibility": false,
        "canReorder": false
      }
    }
  ],
  "capabilities": {
    "requiresBackgroundRemoval": false,
    "editorMode": "content-first",
    "singleSong": true,
    "multiSong": false,
    "maxSongs": 1,
    "supportsLyrics": false,
    "supportsManualLyrics": false,
    "supportsDate": false,
    "supportsPhoto": true,
    "supportsAspectRatios": [
      "9:16"
    ],
    "supportsWidgetMovement": true,
    "supportsVideo": false,
    "supportsDecorativeLayers": true,
    "supportsCrop": true,
    "maxPhotos": 1
  },
  "designTokens": {
    "primaryColor": "#f3e6ff",
    "secondaryColor": "#3a1e4a",
    "accentColor": "#f3e6ff",
    "widgetAccent": "#f3e6ff",
    "shadowColor": "#280a3c",
    "backgroundAccent": "#3a1e4a",
    "radius": 0,
    "spacing": 22
  },
  "constraints": {
    "preferredAspectRatio": "9:16",
    "preferredOrientation": "portrait",
    "maxSongs": 1,
    "minPhotoResolution": {
      "width": 1080,
      "height": 1920
    },
    "photoBrightnessRecommendation": "dark"
  },
  "designerNotes": {
    "author": "Repitair Design",
    "description": "A centered lilac player with bold type over the chosen photo.",
    "photographyGuidance": "Neon, night, and saturated scenes keep the lilac player glowing.",
    "bestWith": "Night scenes, laundromats, and moody color.",
    "tags": [
      "single-song",
      "minimal",
      "neon"
    ]
  },
  "migration": {
    "priority": "medium",
    "complexity": "simple",
    "certificationStatus": "pending"
  }
};
