<div align="center">
<img width="1200" height="475" alt="Canvas Banner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Canvas - Advanced AI Creative Studio

Canvas is a powerful, web-based creative studio designed for seamless AI image and video generation. It combines intuitive canvas interactions with state-of-the-art models like **Gemini 2.0** and **Wan 2.6**.

## Key Features

- **Multi-Model Support**: Switch between Gemini 2.0 and Wan 2.6 for high-quality image and video generation.
- **AI Batching**: Optimized Wan API integration for batch image generation, significantly reducing latency.
- **Advanced Editing**:
  - **Auto Combine**: Intelligently merge multiple reference images into a cohesive scene.
  - **Inpainting & Masking**: Precise control over image edits via canvas-based masking.
  - **Background Removal**: One-click professional-grade background removal.
  - **AI Perspective Shift**: Rotate objects and people in 3D space using AI.
- **Interactive Toolset**:
  - **Mirror & Rotate**: Quick horizontal/vertical flips and 90-degree rotations for any element.
  - **Reference Selection**: Crop and set specific areas of any image as a reference for generation.
  - **Vector Drawing**: Integrated drawing, shape, and text tools.
- **Presentation Mode**: Create frames and present your creative workflow with smooth transitions.

### Run Locally

**Prerequisites:** Node.js (v18+)

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure Environment:**
   Set the `GEMINI_API_KEY` and `DASHSCOPE_API_KEY` in `.env.local`.

3. **Launch the app:**
   ```bash
   npm run dev
   ```

## Tech Stack

- **Frontend**: React, TypeScript, Vite
- **Styling**: Tailwind CSS
- **AI**: Google Gemini Pro Vision, Alibaba DashScope (Wan 2.6)
- **Engine**: Custom SVG-based Canvas Engine
