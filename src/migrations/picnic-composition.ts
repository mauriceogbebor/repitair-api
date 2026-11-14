// Generated from the mobile Picnic authored preset. Keep in sync when editing its layers.
export const picnicComposition = {
  "version": 1,
  "templateId": "picnic",
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
        "overlayOpacity": 0.08,
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
      "id": "widget-picnic-primary",
      "name": "Music Widget 1",
      "type": "musicWidget",
      "frame": {
        "x": 0,
        "y": 0,
        "width": 680,
        "height": 980,
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
        "playerVariant": "picnic",
        "presentationStyle": "default",
        "frameSize": {
          "width": 680,
          "height": 980
        },
        "songIndex": 0,
        "widgetTransforms": [],
        "songTitle": "Blinding Lights",
        "artistName": "The Weeknd",
        "platform": "spotify",
        "durationMs": 200000,
        "progressFraction": 0.24,
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
          "offsetY": 14,
          "radius": 32,
          "opacity": 0.34
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
    "primaryColor": "#ffffff",
    "secondaryColor": "#1c1917",
    "accentColor": "#ffffff",
    "widgetAccent": "#ffffff",
    "shadowColor": "#000000",
    "backgroundAccent": "#1c1917",
    "radius": 30,
    "spacing": 20
  },
  "constraints": {
    "preferredAspectRatio": "9:16",
    "preferredOrientation": "portrait",
    "maxSongs": 1,
    "minPhotoResolution": {
      "width": 1080,
      "height": 1920
    },
    "photoBrightnessRecommendation": "any"
  },
  "designerNotes": {
    "author": "Repitair Design",
    "description": "A large upright charcoal player card with big album art and simple controls over the chosen photo.",
    "photographyGuidance": "Open, bright scenes let the solid charcoal card stand out.",
    "bestWith": "Outdoors, daylight, and relaxed lifestyle scenes.",
    "tags": [
      "single-song",
      "card",
      "minimal"
    ]
  },
  "migration": {
    "priority": "medium",
    "complexity": "simple",
    "certificationStatus": "pending"
  }
};
