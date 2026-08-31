/**
 * Bridge/re-export layer over @nocturnalflow/design-system. This is the
 * *only* place the app should import that package from — screens import
 * from '@components/design-system', not from '@nocturnalflow/design-system'
 * directly, so a future wrapping/rename here doesn't ripple through every
 * screen.
 *
 * Do not build new primitives (Button, Input, Avatar, Card, ...) in this
 * directory — everything visual comes from the design system package. See
 * that package's own CLAUDE.md (NocturnalFlowRN/packages/design-system)
 * for the full component/prop/token reference.
 */
export * from '@nocturnalflow/design-system';
