---
name: JobAgent Portal Design System
description: Minimalist, high-contrast visual design system in light-mode for AI-powered relocation searches.
colors:
  primary: "#4f46e5"
  primary-hover: "#4338ca"
  primary-glow: "rgba(79, 70, 229, 0.08)"
  neutral-bg: "#f8fafc"
  panel-bg: "#ffffff"
  panel-border: "#e2e8f0"
  panel-border-glow: "#cbd5e1"
  text-main: "#0f172a"
  text-muted: "#64748b"
  success: "#059669"
  warning: "#d97706"
  danger: "#dc2626"
typography:
  display:
    fontFamily: "Outfit, sans-serif"
    fontSize: "clamp(1.5rem, 4vw, 2.5rem)"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  body:
    fontFamily: "Inter, sans-serif"
    fontSize: "0.88rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "4px"
  md: "6px"
spacing:
  sm: "0.5rem"
  md: "1.0rem"
  lg: "1.25rem"
  xl: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "#ffffff"
    rounded: "{rounded.md}"
    padding: "0.65rem 1.25rem"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  panel-container:
    backgroundColor: "{colors.panel-bg}"
    rounded: "{rounded.md}"
    padding: "1.25rem"
---

# Design System: JobAgent Portal

## 1. Overview

**Creative North Star: "The Architectural Grid Console"**

The JobAgent visual system is designed to convey structural efficiency, extreme clarity, and clean utility. Rejecting decorative, glowing cyberpunk interfaces and SaaS dashboard clichés, it utilizes crisp `1px` lines, strong contrast, and flat surfaces to present complex relational job search metrics in a highly readable light-mode canvas.

### Key Characteristics:
* **Structural Grids**: Composition is anchored on 1px crisp borders separating inputs, navigation modules, and tables.
* **Typographic Hierarchy**: High-contrast pairing using modern displays and compact, highly-readable tables.
* **Accented Isolation**: Strong, tactical color highlights applied only on critical interactive items (Indigo) and semantic states (Emerald, Amber, Crimson).
* **Flat Elevation**: Depth is conveyed through background layering instead of wide drop shadows.

---

## 2. Colors

The color palette operates on a restrained, high-contrast semantic-first structure in light-mode.

### Primary
* **Tech Indigo** (#4f46e5): Used selectively for principal actions, active triggers, and focus highlights. Never used for general branding decoration.

### Neutral
* **Clean Off-White** (#f8fafc): Canonical page background providing a light, spacious, non-reflective reading canvas.
* **Pure White** (#ffffff): Card container backgrounds used to isolate interface sections.
* **Deep Slate Ink** (#0f172a): Main typography color ensuring highly accessible reading contrast.
* **Slate Muted** (#64748b): Used for supporting labels, inputs placeholders, and headers metadata.
* **Slate Light Border** (#e2e8f0): Thin layout grids and component borders.

### Semantic
* **Emerald Success** (#059669): Completed tasks and visa relocation validation badges.
* **Amber Warning** (#d97706): Salary ranges and pending execution indicators.
* **Crimson Danger** (#dc2626): Failed task alerts and connection error indicators.

### Named Rules
**The Accented Isolation Rule.** Accent colors are applied on less than 10% of any given viewport. Visual impact is derived entirely from their sparse, tactical presence against clean slate-light spaces.

---

## 3. Typography

**Display Font:** Outfit (fallback: system-sans)
**Body Font:** Inter (fallback: system-sans)

### Hierarchy
* **Display** (Bold (700), clamp(1.5rem, 4vw, 2.5rem), Line-height 1.2): Title headers, navigation titles.
* **Headline** (SemiBold (600), 1.05rem, Line-height 1.4): Card and list panel titles.
* **Title** (Medium (500), 0.9rem, Line-height 1.4): Table headers and input form labels.
* **Body** (Regular (400), 0.88rem, Line-height 1.5): Standard descriptions, logs, console output, and data text.
* **Label** (SemiBold (600), 0.72rem, Letter-spacing 0.02em, uppercase): Status badges and relocation pills.

---

## 4. Elevation

Depth is conveyed entirely through high-contrast borders and subtle background layering. Traditional soft, wide drop shadows are prohibited to preserve the structural, architectural flat grid aesthetic.

### Named Rules
**The Flat Grid Rule.** Shadows are completely omitted from component states. Surfaces are distinguished strictly using a 3-level background layering system: Viewport background (`#f8fafc`) → Flat panels (`#ffffff`) → Focused inputs (`#ffffff` with `1px #4f46e5` border and a light `rgba(79, 70, 229, 0.05)` glow).

---

## 5. Components

### Buttons
* **Shape:** Rectangular with a precise micro-radius of 6px (`border-radius: 6px`).
* **Primary:** Background Tech Indigo (`#4f46e5`), white text, Outfit typography, padded `0.65rem 1.25rem`.
* **Hover / Focus:** Transitions smoothly to deep Indigo (`#4338ca`) with a crisp outline ring.

### Badges / Tags
* **Visa Relocation**: Rounded 4px, background Emerald wash (`rgba(5, 150, 105, 0.08)`), text color Emerald (`#059669`), thin border (`1px solid rgba(5, 150, 105, 0.15)`).

### Cards / Containers
* **Corner Style**: Precise 6px border radius (`border-radius: 6px`).
* **Background**: Solid pure white (`#ffffff`).
* **Borders**: Thin slate-light outline (`1px solid #e2e8f0`). No drop shadows.

### Inputs / Fields
* **Background**: White (`#ffffff`).
* **Borders**: Crisp slate border (`1px solid #cbd5e1`), rounded 6px (`border-radius: 6px`).
* **Focus**: Indigo highlight (`border-color: #4f46e5`) with a tight, subtle outline wash (`rgba(79, 70, 229, 0.15)`).

---

## 6. Do's and Don'ts

### Do:
* **Do** enforce a strict 6px radius cap on all panels, forms, inputs, and components to preserve structural utility.
* **Do** maintain a minimum contrast ratio of 4.5:1 on all typography, including muted helper text and form labels.
* **Do** write semantic HTML5 elements (tables, table headers, buttons, labels) to ensure screen-reader clarity.

### Don't:
* **Don't** use neon space-dark cyberpunk gradients, glowing purple shadows, or dark background styling.
* **Don't** apply wide, soft decorative drop shadows (blur ≥ 16px) or floating card borders.
* **Don't** write lowercase uppercase tracked kicker kickers or numbers (`01 / 02`) above headings as scaffolding decoration.
* **Don't** animate elements with aggressive bounces or multi-stage sliding choreography; prioritize subtle transitions.
