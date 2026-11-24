// Generated from the mobile Cold Town authored preset. Keep in sync when editing its layers.
export const coldTownComposition = {
  "version": 1,
  "templateId": "cold-town",
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
      "id": "cold_town_top_scrim",
      "name": "Decor",
      "type": "effect",
      "frame": {
        "x": 0,
        "y": -480,
        "width": 1000,
        "height": 760,
        "scale": 1,
        "rotation": 0,
        "opacity": 1,
        "zIndex": 2,
        "locked": true,
        "visible": true
      },
      "interactive": false,
      "anchor": "center",
      "data": {
        "kind": "gradient",
        "borderRadius": 0,
        "gradientColors": [
          "rgba(16,22,30,0.82)",
          "rgba(16,22,30,0.4)",
          "transparent"
        ],
        "gradientStart": {
          "x": 0,
          "y": 0
        },
        "gradientEnd": {
          "x": 0,
          "y": 1
        },
        "frameSize": {
          "width": 1000,
          "height": 760
        }
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
    },
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
        "overlayOpacity": 0.15,
        "songInfoPosition": "top"
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
      "id": "widget-cold-town-primary",
      "name": "Music Widget 1",
      "type": "musicWidget",
      "frame": {
        "x": 0,
        "y": -520,
        "width": 920,
        "height": 440,
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
        "playerVariant": "coldTown",
        "presentationStyle": "default",
        "frameSize": {
          "width": 920,
          "height": 440
        },
        "songIndex": 0,
        "widgetTransforms": [],
        "songTitle": "Blinding Lights",
        "artistName": "The Weeknd",
        "platform": "spotify",
        "durationMs": 200000,
        "progressFraction": 0.35,
        "albumArtUrl": null,
        "accentColor": "#1ED760",
        "weather": {
          "location": {
            "name": "Your City",
            "region": "",
            "country": "",
            "timeZone": "UTC",
            "localTimeEpoch": 1700000000
          },
          "observedAt": "2023-11-14T22:13:20.000Z",
          "fetchedAt": "2023-11-14T22:13:20.000Z",
          "current": {
            "temperatureC": 24,
            "feelsLikeC": 25,
            "humidityPercent": 56,
            "windKph": 10,
            "precipitationMm": 0,
            "condition": "Partly cloudy",
            "conditionCode": 1003,
            "iconUrl": ""
          },
          "today": {
            "highC": 27,
            "lowC": 19,
            "rainChancePercent": 20
          },
          "hourly": [
            {
              "timeEpoch": 1700000000,
              "temperatureC": 24,
              "rainChancePercent": 15,
              "windKph": 10,
              "condition": "Partly cloudy",
              "conditionCode": 1003,
              "iconUrl": ""
            },
            {
              "timeEpoch": 1700003600,
              "temperatureC": 24,
              "rainChancePercent": 25,
              "windKph": 10,
              "condition": "Partly cloudy",
              "conditionCode": 1006,
              "iconUrl": ""
            },
            {
              "timeEpoch": 1700007200,
              "temperatureC": 23,
              "rainChancePercent": 60,
              "windKph": 10,
              "condition": "Partly cloudy",
              "conditionCode": 1183,
              "iconUrl": ""
            },
            {
              "timeEpoch": 1700010800,
              "temperatureC": 23,
              "rainChancePercent": 45,
              "windKph": 10,
              "condition": "Partly cloudy",
              "conditionCode": 1183,
              "iconUrl": ""
            },
            {
              "timeEpoch": 1700014400,
              "temperatureC": 22,
              "rainChancePercent": 20,
              "windKph": 10,
              "condition": "Partly cloudy",
              "conditionCode": 1006,
              "iconUrl": ""
            },
            {
              "timeEpoch": 1700018000,
              "temperatureC": 22,
              "rainChancePercent": 10,
              "windKph": 10,
              "condition": "Partly cloudy",
              "conditionCode": 1003,
              "iconUrl": ""
            },
            {
              "timeEpoch": 1700021600,
              "temperatureC": 21,
              "rainChancePercent": 10,
              "windKph": 10,
              "condition": "Partly cloudy",
              "conditionCode": 1000,
              "iconUrl": ""
            },
            {
              "timeEpoch": 1700025200,
              "temperatureC": 21,
              "rainChancePercent": 10,
              "windKph": 10,
              "condition": "Partly cloudy",
              "conditionCode": 1000,
              "iconUrl": ""
            }
          ]
        },
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
    "singleSong": false,
    "multiSong": false,
    "maxSongs": 0,
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
    "maxPhotos": 1,
    "supportsWeather": true
  },
  "designTokens": {
    "primaryColor": "#ffffff",
    "secondaryColor": "#10161e",
    "accentColor": "#ffffff",
    "widgetAccent": "#ffffff",
    "shadowColor": "#000000",
    "backgroundAccent": "#10161e",
    "radius": 0,
    "spacing": 22
  },
  "constraints": {
    "preferredAspectRatio": "9:16",
    "preferredOrientation": "portrait",
    "maxSongs": 0,
    "minPhotoResolution": {
      "width": 1080,
      "height": 1920
    },
    "photoBrightnessRecommendation": "dark"
  },
  "designerNotes": {
    "author": "Repitair Design",
    "description": "A centered city, temperature, condition and high/low over the chosen photo.",
    "photographyGuidance": "Moody, overcast scenes suit the cool weather header.",
    "bestWith": "Travel, cities, and grey-sky days.",
    "tags": [
      "weather",
      "live",
      "minimal"
    ]
  },
  "migration": {
    "priority": "medium",
    "complexity": "moderate",
    "certificationStatus": "pending"
  }
};
