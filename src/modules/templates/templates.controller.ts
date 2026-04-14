import { Controller, Get, UseGuards } from "@nestjs/common";

import { JwtAuthGuard } from "../../common/guards/jwt-auth.guard";

@Controller("templates")
@UseGuards(JwtAuthGuard)
export class TemplatesController {
  @Get()
  getTemplates() {
    return [
      { id: "sunrise", name: "Sunrise", style: "Minimal", category: "All", premium: false },
      { id: "cyber", name: "Cyber", style: "Bold", category: "Mono", premium: false },
      { id: "vinyl", name: "Vinyl", style: "Retro", category: "Vinyl", premium: false },
      { id: "blush", name: "Blush", style: "Soft", category: "Blush", premium: false },
      { id: "aurora", name: "Aurora", style: "Gradient", category: "Sunrise", premium: false },
      { id: "midnight", name: "Midnight", style: "Dark", category: "Mono", premium: false },
      { id: "ocean-wave", name: "Ocean Wave", style: "Flow", category: "Ocean", premium: false },
      { id: "neon-glow", name: "Neon Glow", style: "Vibrant", category: "Mono", premium: true },
      { id: "golden-hour", name: "Golden Hour", style: "Warm", category: "Sunrise", premium: false },
      { id: "storm", name: "Storm", style: "Dramatic", category: "Mono", premium: true },
      { id: "rose-garden", name: "Rose Garden", style: "Elegant", category: "Blush", premium: false },
      { id: "arctic", name: "Arctic", style: "Cool", category: "Ocean", premium: false },
      { id: "lava", name: "Lava", style: "Intense", category: "Sunrise", premium: true },
      { id: "velvet", name: "Velvet", style: "Luxe", category: "Vinyl", premium: true },
      { id: "paper-cut", name: "Paper Cut", style: "Textured", category: "All", premium: false },
      { id: "prism", name: "Prism", style: "Colorful", category: "Blush", premium: false },
    ];
  }
}
