/**
 * Plugin governance: capability tiers, authority disclosure, and profile health.
 *
 * The premise is that a user cannot consent to what they were not told. DSH
 * plugins are npm packages that run in the Host process with the user's own
 * authority, and the model's tool-approval prompts do not cover them — so this
 * package derives what a package can do from what it declares and states it in
 * consequences before anything is installed.
 * @module @dsh-foundry/plugin-governance
 */
export {
  AUTHORITY_WARNING,
  UNKNOWN_AUTHORITY,
  deriveAuthority,
  describeAuthority,
  installsAutomatically,
} from './authority.ts'
export type { DisclosureLine, PackageManifest } from './authority.ts'
export { classifyTier, inspectProfile, renderReport, reviewInstall } from './doctor.ts'
export type { DoctorOptions, InstallReview, ProfileHealth } from './doctor.ts'
export { EXCLUDED_FROM_REPORTS, redact, redactDeep } from './redact.ts'
export { harnessHome, listProfiles, runDoctor } from './cli.ts'
export type { DoctorResult } from './cli.ts'
export { REQUIRED_FORM, classifySource, planRemoval, renderPlan } from './lifecycle.ts'
export type { LifecycleOperation, LifecyclePlan, PackageFootprint, SourceKind, SourceVerdict } from './lifecycle.ts'
export { GOVERNANCE_SCOPE_NOTE, TIER_NOTE, buildGovernanceView, operationsFor } from './view.ts'
export type { GovernanceRow, GovernanceView } from './view.ts'
export {
  PRE_INSTALL_WARNING,
  PROVISIONAL_NOTE,
  compareAuthority,
  discloseBeforeInstall,
  orderCatalog,
  toCatalogEntry,
} from './catalog.ts'
export type { AuthorityChange, CatalogEntry, PreInstallDisclosure, RegistryMetadata } from './catalog.ts'
export {
  FOUNDRY_DISTRIBUTION,
  OFFICIAL_SCOPE,
  PROVENANCE_SOURCES,
  USER_AUTHORITY_WARNING,
  deriveProvenance,
  describeDisableImpact,
  isFoundryVerified,
  matchesQuery,
} from './provenance.ts'
export type { PackageMetadata, PluginProvenance, ProvenanceEvidence, ProvenanceSource } from './provenance.ts'
export { REQUIRED_FOUNDRY_PACKAGES, inventoryHome, inventoryProfile, summarize } from './inventory.ts'
export type { InventorySummary, ProfileInventory } from './inventory.ts'
