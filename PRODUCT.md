# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People supervising coding agents and projects in the AO desktop application. Memory v1 serves someone inspecting stored project knowledge and its provenance.

## Product Purpose

AO coordinates agent work. The requested Memory surface provides read-only inspection of visible stored knowledge and its real links in an explicitly selected project, worktree, or session scope.

## Operating Context

The desktop renderer communicates with the local AO daemon. Memory data comes from the configured local Jarvis Core producer, with visibility filtering applied before graph counts and edges are returned.

## Capabilities and Constraints

Memory must expose bounded graph results and truncation, search, type and status filters, navigation, details and provenance, clear loading, empty, no-match, error and unavailable states, and keyboard access. Scope and filter changes must not retain stale details. No inferred support or contradiction edges or similarity-as-truth claims. Follow existing AO design and theme conventions.

## Evidence on Hand

The user brief, root DESIGN.md, and the existing renderer and daemon source are the authorities. No example memory content should be invented for the product.
