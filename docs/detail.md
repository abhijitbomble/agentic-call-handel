# Typography, Font Stack, and Layout Standard for VoiceOps Control

This document turns the design research into a practical standard for the SaaS UI.

## What "type stack" means

A type stack is the ordered list of font families the browser should try, starting with the preferred font and falling back to broadly available system fonts if needed. In product UI, a good stack is not just about appearance. It is also about legibility, performance, accessibility, and consistency across browsers and operating systems.

## What strong design systems do

### Fluent 2

Fluent emphasizes clear typographic hierarchy and explicitly uses native/system fonts per platform. On web, the default ramp uses Segoe UI, with platform-specific stacks for Windows, macOS, iOS, and Android. Fluent also treats spacing as a global ramp, with a 4px base unit and reusable values for layout and component spacing.

### Atlassian Design System

Atlassian treats typography as tokens, not ad-hoc CSS. Its guidance uses font family, size, and line height as part of the token system. It also recommends relative units like `rem`, correct heading hierarchy, and strong separation between spacing, grid, and typography foundations. Its spacing system is built on an 8px base unit.

### Material Design 3

Material 3 centers typography around type tokens, line height, and hierarchy. It also uses an 8dp spacing system and treats layout as a way to group content, direct attention, and make interfaces feel more readable at different densities.

### Carbon Design System

Carbon uses type tokens calibrated for IBM Plex and recommends choosing type styles based on layout or template structure. It combines typography with a 2x grid and a spacing scale built from 2, 4, and 8. Carbon also recommends using tokens and layout utilities instead of scattering raw values throughout the codebase.

## What this means for SaaS products like ours

For an admin-heavy SaaS platform, the most important goal is not “fancy typography.” It is:

1. Fast scanning.
2. Clear hierarchy.
3. Predictable layouts.
4. Stable spacing.
5. Good readability on dense screens.

That means the best default is usually:

- One readable body font.
- One slightly more expressive display font, if branding needs it.
- A tokenized type scale.
- A spacing scale based on 4px or 8px increments.
- Grid-driven layout instead of ad-hoc positioning.

## Recommended standard for this repo

### Current direction

The app already uses:

- `Space Grotesk` for display and headings.
- `Manrope` for body text.

That is a strong branded SaaS pairing because:

- `Manrope` is clean and highly readable for dense dashboards.
- `Space Grotesk` gives the product a more intentional identity for page titles and section headers.

### Recommended token structure

Use typography tokens like this:

- `display`: page titles, hero labels, major module headings.
- `section`: panel titles, section headers, table headings.
- `body`: standard UI text, labels, helper text.
- `meta`: timestamps, status notes, badges, secondary hints.
- `mono`: IDs, phone numbers, code-like values, tokens, logs.

### Recommended sizing

For this product class, a practical scale is:

- Page title: 28-32px
- Section heading: 18-20px
- Card title: 14-16px
- Body: 14px
- Helper/meta text: 12px
- Badge text: 11-12px

Line-height guidance:

- Headings: around 1.15 to 1.25
- Body text: around 1.45 to 1.6
- Dense tables or metadata: around 1.2 to 1.35

### Recommended spacing system

Use a consistent spacing ladder:

- 4, 8, 12, 16, 20, 24, 32, 40, 48

That works well with the existing admin UI because:

- 8px gives a strong rhythm for sections and card padding.
- 4px helps with tighter internal spacing.
- 12px and 16px are useful for forms and data tables.

### Recommended layout model

For this product, the most reliable layout pattern is:

- Left sidebar for primary navigation.
- Top bar for tenant, program, and session controls.
- Main content area with a 12-column or responsive CSS grid.
- Cards for single concepts or summaries.
- Tables for comparable records.
- Lists for repeated items.
- Tree or grouped navigation for hierarchy.

That fits the product because the app has:

- a lot of operational data,
- many related objects per tenant,
- and several real-time surfaces that need to stay scannable.

## What to avoid

- Do not mix many unrelated fonts.
- Do not hardcode random font sizes per screen.
- Do not use margins as the main layout system if the page is already token-driven.
- Do not overuse expressive fonts in body content.
- Do not crowd the page with cards that all compete for attention.
- Do not use a different visual language for every section.

## Practical standard we should follow

If we want this SaaS to feel production-grade, the standard should be:

- Keep the current `Manrope` + `Space Grotesk` pairing.
- Move all visual sizes into tokens or shared constants over time.
- Use 8px as the default spacing rhythm, with 4px for compact inner spacing.
- Keep headings short and strong.
- Keep body content calm and readable.
- Use cards for dashboards, tables for operational records, and sections for configuration.

## Decision

Recommended choice for this product:

- **Body font:** `Manrope`
- **Display font:** `Space Grotesk`
- **Typography style:** tokenized SaaS hierarchy with a calm, high-clarity dashboard feel
- **Layout style:** left-nav admin shell with grid-based cards, dense tables, and clear section separation

That gives the app a branded look without sacrificing the readability expected from a real control plane.

## Source notes

This recommendation is informed by official guidance from Fluent 2, Atlassian Design System, Material Design 3, and Carbon Design System.
