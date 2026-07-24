# Replacement quality visual QA

**Comparison target**

- Source visual truth:
  - `docs/design/contextual-guide-reset/02-work-layout.png`
  - `docs/design/contextual-guide-reset/07-dm-right-sidecar-muted.png`
- Implementation screenshots:
  - `proof/replacement-quality-inputs/visual-work-expanded.png`
  - `proof/replacement-quality-inputs/visual-dm-right-sidecar.png`
- CSS viewport and implementation pixels: 1440 × 900 at device scale factor 1.
- Source pixels: 1487 × 1058. For comparison, the source was contained at
  1440 × 1025 and centered without cropping; the implementation remained
  1440 × 900 and was centered vertically. The implementation intentionally
  keeps the approved expanded route viewport rather than copying the source's
  smaller home-device scale.
- State: `/library` with Bella's Beads selected; `/library` with the
  provider-free answered DM sidecar open for the shipping-experience question.

**Full-view comparison evidence**

- Work: `/tmp/pr312-work-comparison-hires.png`
- Answered sidecar: `/tmp/pr312-sidecar-comparison-hires.png`
- The comparisons place each binding reference on the left and its current
  implementation on the right in one image.

**Focused-region comparison evidence**

The full-resolution combined images keep the navigation, selected row, project
metadata, answer, source, actions, composer, frame edges, and footer text
readable. Separate focused crops were not required.

**Findings**

- No actionable P0, P1, or P2 differences remain.
- Fonts and typography: the condensed display/mono hierarchy, selected-project
  emphasis, small navigation, answer body, labels, and actions align. The
  implementation uses the repository's production font stack rather than
  raster imitation.
- Spacing and layout rhythm: the expanded route viewport preserves the required
  larger inner screen while matching the source's molded frame hierarchy,
  selected-row geometry, four-row rhythm, integrated right split, and answer /
  action / composer proportions.
- Colors and visual tokens: the purple Work surround, gray answered-state
  surround, dark glass screen, blue selection, muted rules, and foreground
  contrast align with the references.
- Image quality and asset fidelity: the references contain no content imagery or
  logos that require substitution. The rendered Three.js frame is crisp at the
  evidence density and no source asset is replaced by placeholder art.
- Copy and content: project order, titles, approved public descriptors, question,
  answer, source, Open case, View all work, and reset notice match the binding
  state and hierarchy.
- Interaction/accessibility: navigation, selected-row keyboard behavior,
  guide focus/escape behavior, route-reset cancellation, mobile bottom-sheet
  behavior, reduced motion, WebGL fallback, and no-JS usefulness are preserved
  by the browser and provider-free test matrix.

**Comparison history**

1. Initial comparison found a P1: the Work state was a flat, weakly framed list
   with mismatched hierarchy and ordering; the answered guide read as a
   detached utility panel with incorrect answer/action proportions.
2. Fixes: added the molded/glass route frame and state-specific surround,
   restored binding project order and descriptors, enlarged and rebalanced the
   selected-work hierarchy, integrated the guide as a true split, and rebuilt
   question, answer, source, actions, composer, and reset-note hierarchy.
3. Post-fix evidence: both high-resolution combined comparisons above show the
   corrected same-state implementation. A second senior-design pass found no
   unresolved P0, P1, or P2 difference.

**Open Questions**

- None.

**Implementation Checklist**

- [x] Binding Work state aligned at 1440 × 900.
- [x] Binding answered sidecar state aligned at 1440 × 900.
- [x] Expanded route viewport preserved.
- [x] Responsive and fallback behavior retained.
- [x] Independent exact-capture review input required by the package gate.

**Follow-up Polish**

- P3: the live Three.js bevel and scanline rendering will vary slightly from the
  raster references across GPU/antialiasing implementations; this does not alter
  hierarchy, geometry, copy, or interaction.

final result: passed
