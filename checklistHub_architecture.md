# ChecklistHub V1

## Architecture Specification

---

# Purpose

ChecklistHub helps biodiversity experts validate, review, and publish species checklists through evidence-based taxonomic workflows.

The platform is designed to transform raw species lists into defensible scientific checklists supported by evidence, taxonomic validation, expert review, and publication-ready outputs.

ChecklistHub does not replace experts.

ChecklistHub gathers, organizes, validates, and presents information so experts can make informed taxonomic decisions.

---

# Core Philosophy

Traditional checklist workflows treat species as rows in spreadsheets.

ChecklistHub treats every species as a reviewable scientific object.

Every accepted species should have:

* Taxonomic justification
* Supporting evidence
* Expert review
* Discussion history
* Provenance
* Publication status

The final checklist is therefore not a list of names.

It is a collection of defensible species decisions.

---

# Technology Stack

## Frontend

```text
Next.js

React

TypeScript

TailwindCSS

TanStack Table

TanStack Query
```

Purpose:

```text
Workbench

Collaboration

Species Review

Data Visualization
```

---

## Backend Platform

```text
Supabase
```

Purpose:

```text
Authentication

Database

Realtime Collaboration

Storage

Permissions
```

---

## Database

```text
PostgreSQL

JSONB Hybrid Model
```

Purpose:

```text
Species Objects

Taxonomy

Evidence

Review History

Collaboration
```

---

## Authentication

```text
Google OAuth
```

Future:

```text
ORCID Login
```

---

# System Architecture

```text
ChecklistHub

├── Editor Engine
├── Species Engine
├── Taxonomy Engine
├── Evidence Engine
├── Reconciliation Engine
├── Collaboration Engine
└── Publication Engine
```

All modules operate on Species Objects.

---

# Core Entity

## Species Object

The Species Object is the central entity of ChecklistHub.

Every module either reads from it or writes to it.

The Species Object contains:

```text
Identity

Taxonomy

Evidence

Review

Discussion

History

Publication
```

A species is not a row.

A species is a scientific decision record.

---

# Codebase Structure

```text
src

├── workbench
│
├── modules
│   ├── editor
│   ├── species
│   ├── taxonomy
│   ├── evidence
│   ├── reconciliation
│   ├── collaboration
│   └── publication
│
├── components
├── services
├── hooks
├── stores
├── types
├── lib
└── utils
```

---

# Workbench

The Workbench is the application.

Everything else exists to support what happens inside the Workbench.

Purpose:

```text
Species Review

Evidence Review

Taxonomic Decisions

Collaboration

Publication Preparation
```

---

# Editor Engine

## Purpose

Provides the Notion-style workbench experience.

Responsible for rendering and managing Species Objects.

---

## Features

```text
Workbench

Views

Object Rendering

Object Expansion

Inline Editing

Filtering

Sorting

Selection

Grouping

Object Navigation
```

---

## Responsibilities

```text
Render Species Objects

Manage Workbench State

Manage Views

Manage Object Interaction
```

---

# Species Engine

## Purpose

Manage Species Objects and species lifecycle.

---

## Features

```text
Species Creation

Species Lifecycle

Species Status

Species Metadata

Species Relationships

Species Provenance
```

---

## Responsibilities

```text
Create Species Objects

Store Species State

Track Species History

Serve As Source Of Truth
```

---

# Taxonomy Engine

## Purpose

Understand species names and taxonomic relationships.

---

## Features

```text
Taxonomic Validation

Synonym Resolution

Accepted Name Detection

Taxonomic History

Authority Tracking
```

---

## Data Sources

```text
GBIF Backbone

Catalogue of Life
```

---

## Responsibilities

```text
Validate Names

Resolve Synonyms

Track Taxonomic Changes

Store Taxonomic History
```

---

# Evidence Engine

## Purpose

Gather and organize evidence supporting species inclusion.

---

## Features

```text
Evidence Aggregation

Evidence Strength Model

Deduplication Engine

Occurrence Review

Literature Review

Source Provenance
```

---

## Evidence Sources

```text
GBIF

iNaturalist

eBird

Museum Collections

Published Literature

Regional Checklists

Institutional Databases
```

---

## Responsibilities

```text
Gather Evidence

Deduplicate Records

Track Evidence Sources

Calculate Evidence Strength

Present Evidence
```

---

## Principle

Evidence supports decisions.

Experts make decisions.

---

# Reconciliation Engine

## Purpose

Compare multiple checklists and identify differences.

---

## Features

```text
Shared Species

Missing Species

Synonym Conflicts

Taxonomic Differences

Checklist Comparison
```

---

## Responsibilities

```text
Compare Checklists

Identify Conflicts

Generate Reconciliation Reports
```

---

# Collaboration Engine

## Purpose

Enable collaborative checklist review.

---

## Features

```text
Google Login

Sharing

Invitations

Permissions

Presence

Notifications

Comments

Mentions

Activity Feed
```

---

## Permissions

```text
Owner

Editor

Reviewer

Commenter

Viewer
```

---

## Responsibilities

```text
Authentication

Collaboration

Access Control

Audit Trail

Realtime Updates
```

---

## Collaboration Principle

Users should be able to:

```text
Share Checklist

Invite Collaborators

Review Species

Discuss Evidence

Track Decisions
```

without requiring traditional account registration workflows.

---

# Publication Engine

## Purpose

Generate publication-ready outputs.

---

## Features

```text
Darwin Core Checklist

CSV Export

Excel Export

IPT Export

Publication Metadata
```

---

## Responsibilities

```text
Validate Publication Readiness

Generate Exports

Track Publication Status
```

---

# Species Lifecycle

```text
Imported
    ↓
Evidence Gathered
    ↓
Needs Review
    ↓
Under Review
    ↓
Accepted
    ↓
Published
```

Alternative:

```text
Imported
    ↓
Evidence Gathered
    ↓
Needs Review
    ↓
Under Review
    ↓
Rejected
```

---

# Development Principles

## Principle 1

```text
One Module = One Responsibility
```

---

## Principle 2

```text
Species Object = Source Of Truth
```

---

## Principle 3

```text
Components Never Contain Business Logic
```

---

## Principle 4

```text
Evidence Supports Decisions
Experts Make Decisions
```

---

## Principle 5

```text
Never Auto-Accept Species
```

Every accepted species must be approved by at least one expert reviewer.

---

# V1 Workflow

```text
Upload Checklist
       ↓
Taxonomic Validation
       ↓
Synonym Resolution
       ↓
Taxonomic History
       ↓
Checklist Reconciliation
       ↓
Evidence Review
       ↓
Expert Workbench
       ↓
Publication Export
```

---

# End Goal

Allow biodiversity experts to:

```text
Import Data
       ↓
Validate Taxonomy
       ↓
Review Evidence
       ↓
Collaborate
       ↓
Approve Species
       ↓
Publish Checklists
```

while maintaining a transparent chain of evidence, taxonomic history, review history, and expert decisions for every species included in the final checklist.
