

# Login Page - Layout Reorganization

## Current Issues
- Logo is small and tucked in the top-left corner -- user wants it big and centered/prominent
- The consultant image is barely visible due to aggressive masking -- needs to be more present but pushed to the edge
- Text content floats in the middle and overlaps with the faded image zone
- The woman in the image should be looking forward (facing camera)

## Changes

### 1. Generate new consultant image
- Generate a new hero image of a professional woman looking directly at the camera (forward-facing), arms crossed, confident pose
- Save as `src/assets/consultant-hero-flipped.jpg` (replacing current)

### 2. Restructure the left panel layout into clear zones

The left panel will be reorganized into a **two-column internal layout** that prevents any overlap:

```text
+-----------------------------------------------+
|                                                |
|   [WOMAN IMAGE]        [CONTENT AREA]          |
|   Positioned at        Centered vertically:    |
|   far-left edge,                               |
|   bottom-aligned,       - Big Logo (48px icon)  |
|   ~45% of panel         - "Aceleriq" (24px)    |
|   width, masked          - "Performance OS"    |
|   on right edge                                |
|                         - Welcome heading      |
|                         - Description text     |
|                                                |
|                         - 3 value props        |
|                           with Lucide icons    |
|                                                |
|                         - Metrics footer       |
|                         - Copyright            |
+-----------------------------------------------+
```

### 3. Specific layout changes in `src/pages/Login.tsx`

**Image positioning:**
- Keep `absolute left-0 bottom-0` but with `h-[85%]` so she's prominent
- Keep the right-fade mask but less aggressive: fade starts at 60% instead of 50%
- This keeps the woman visible but cleanly fading before the text zone

**Content area (right side of left panel):**
- All content (logo, text, value props, metrics) lives in a single column on the right side of the left panel
- Uses `ml-auto` with fixed `max-width: 320px` and `pr-12 pl-6`
- This ensures zero overlap with the image

**Logo/Branding -- big and prominent:**
- Move the logo from top-left into the content column, at the top of the vertically-centered block
- Icon: 48px square with green gradient
- Text: "Aceleriq" at ~22px bold, "Performance OS" subtitle
- This makes the branding the first thing you see in the content area

**Welcome text:**
- "Bom te ver por aqui!" heading
- Short description paragraph
- Positioned below logo with proper spacing

**Value props:**
- 3 items with Lucide icons (BarChart3, Zap, Target) -- no emojis
- Compact spacing below the welcome text

**Footer metrics + copyright:**
- Pinned to the bottom of the content column
- Animated counter numbers

### 4. No changes to the right panel (form side)
The login/signup form stays exactly as-is.

## Technical Details

### Files Modified
- `src/pages/Login.tsx` -- restructure left panel layout only
- `src/assets/consultant-hero-flipped.jpg` -- new forward-facing image

### Key CSS/Layout Approach
- The image and content never overlap because the content column uses `ml-auto` with a fixed max-width, occupying only the right ~40% of the left panel
- The image occupies the left portion with a gradient mask that fades before reaching the content zone
- The logo moves from a separate top-left position into the main content flow for better visual hierarchy
